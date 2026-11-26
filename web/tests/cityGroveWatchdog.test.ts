import { gzipSync } from 'node:zlib';
import { expect, it, vi } from 'vitest';

const { readDecor } = vi.hoisted(() => ({ readDecor: vi.fn() }));
vi.mock('node:fs', async importOriginal => ({ ...(await importOriginal<typeof import('node:fs')>()), readFileSync: readDecor }));

// The sheet runner is a local artifact. Exercise it with a mock page when present.
const path = '../out/planches-styles-v7/v2drive.mjs';
const drivers = import.meta.glob<{ shootV2(ctx: unknown): Promise<void> }>('../out/planches-styles-v7/v2drive.mjs');

it.skipIf(!drivers[path])('times out a stuck flat capture and skips further views', async () => {
  const meta = Buffer.from(JSON.stringify({ meta: { seed: 'grove' } })),
    header = Buffer.alloc(12);
  header.writeUInt32LE(meta.length, 8);
  readDecor.mockReturnValue(gzipSync(Buffer.concat([header, meta])));
  const { shootV2 } = await drivers[path]();
  const noOp = async () => {};
  const summary = { town: { x: 1, y: 2, buildings: 10 } };
  const hangingView = vi.fn(() => new Promise(() => {}));
  const page = {
    goto: noOp,
    waitForFunction: noOp,
    waitForLoadState: noOp,
    addStyleTag: noOp,
    on: noOp,
    evaluate: async (callback: () => unknown, arg?: unknown) => {
      if (arg === '2d') return hangingView();
      const source = callback.toString();
      if (source.includes('.prepare(')) return { options: [] };
      if (source.includes('.summary(')) return summary;
      if (source.includes('.view(')) return { cx: 1, cy: 2, scale: 0.5 };
    },
  };
  const watchView = vi.fn(async (_p: unknown, _id: string, view: string, report: { stuck?: string }, work: () => Promise<void>) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work().then(() => true),
        new Promise<boolean>(resolve => {
          timer = setTimeout(() => {
            report.stuck = view;
            resolve(false);
          }, 25);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  });
  const report = { map: 'mock', scale: 10000, renders: { '2d': 'satellite' }, timings: {} };
  await shootV2({ p: page, id: 'elven', r: report, culture: 'elven', OUT: '', T: 1000, VIEWS_2D: ['2d', '2d-core'], VIEWS_3D: [], placement: {}, OPTS: [], sleep: noOp, mark: noOp, watchView, t0: Date.now() });
  expect(hangingView).toHaveBeenCalledOnce();
  expect(watchView.mock.calls.map(call => call[2])).toEqual(['2d-frame', '2d']);
  expect(report).toMatchObject({ stuck: '2d', skipped2d: ['2d-core'] });
});
