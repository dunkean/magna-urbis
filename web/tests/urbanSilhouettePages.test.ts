import { afterEach, expect, it, vi } from 'vitest';
import type { PlacementBatch } from '../../rust/bridge/urbanArchitecture';
import type { ArchitectureBatchProgress, ArchitectureRequestSource } from '../../rust/bridge/architectureBatch';
import type { UrbanSourceHandle } from '../../rust/bridge/urbanSource';
import type { UrbanSceneResponse, UrbanSceneWorkerMessage } from '../src/ui/urbanSceneProtocol';
import { silhouetteScene, type CityPlacementRequest } from '../src/ui/urbanSilhouettes';
import { streamSilhouetteScene } from '../src/ui/urbanSilhouettePages';
import { createUrbanSceneAccumulator } from '../src/ui/urbanSceneProgress';

const harness = vi.hoisted(() => ({ engine: vi.fn() }));
vi.mock('../../rust/bridge/urban', () => ({ createUrbanEngine: harness.engine }));
afterEach(() => vi.unstubAllGlobals());

const square = (x: number, y: number, s: number) => [
  {
    outer: [
      { x, y },
      { x: x + s, y },
      { x: x + s, y: y + s },
      { x, y: y + s },
    ],
    holes: [],
  },
];
/** Synthetic native sites covering every silhouette branch: city preview, admission
 * hint, buildable land, massed and plain open spaces, empty surfaces, programmes. */
function site(i: number): CityPlacementRequest {
  const fn = (['domestic', 'mixed', 'workshop', 'open_space', 'collective'] as const)[i % 5];
  const massed = i % 7 === 0,
    preview = i % 3 === 0 ? square(i, 2, 3) : null;
  return {
    id: `p${i}/building`,
    parcel_id: `p${i}`,
    seed: `s${i}`,
    function: fn,
    culture: { culture: i % 2 ? 'norse' : 'roman', pack: 'EUR', mode: 'historical_inspired', borrowing: null },
    cadastral: square(i, 0, 10),
    buildable: i % 11 === 5 ? [] : square(i, 1, 8),
    reserves: [],
    placement_hint: i % 4 === 1 ? square(i, 1.5, 6) : null,
    preview,
    accesses:
      i % 6
        ? [
            {
              id: `a${i}`,
              segment: [
                { x: i, y: 0 },
                { x: i + 4, y: 0 },
              ],
              kind: 'public',
              width_m: 4,
            },
          ]
        : [],
    party_boundaries: [],
    neighbors: [],
    terrain: { origin: { x: i, y: 0 }, ground_z_m: i * 0.25, gradient: [0, 0], water_z_m: null, max_foundation_step_m: 1 },
    ...(i % 5 === 4 ? {} : { programme: { role: `role${i % 4}`, households: i % 9, wealth: (i % 10) / 10, ...(massed ? { massing: [{ shape: square(i, 2, 2)[0], floors: 1 + (i % 3) }] } : {}) } as CityPlacementRequest['programme'] }),
  };
}
const sites = Array.from({ length: 300 }, (_, i) => site(i));
/** Pages of varying sizes (a byte budget can cut a page short), never above the asked limit. */
function fakePages(all: CityPlacementRequest[], fail?: (offset: number) => Error | undefined) {
  const reads: number[] = [];
  const pages: ArchitectureRequestSource = {
    total: all.length,
    async read(offset, limit) {
      reads.push(offset);
      const error = fail?.(offset);
      if (error) throw error;
      // Structured clone: like a JSON page, each read returns fresh objects.
      return structuredClone(all.slice(offset, offset + Math.min(limit, 1 + ((offset * 7) % 50))));
    },
  };
  return { pages, reads };
}

it('builds the paged silhouette scene equal to the whole-city scene, in order, with progress', async () => {
  const { pages, reads } = fakePages(sites),
    accumulator = createUrbanSceneAccumulator(),
    progress: number[] = [];
  const counts = await streamSilhouetteScene(pages, {
    progress: completed => progress.push(completed),
    part: (delta, at) => {
      accumulator.append(delta, at);
    },
  });
  expect(reads.length).toBeGreaterThan(6);
  expect(progress.at(-1)).toBe(sites.length);
  expect(progress.every((value, i) => !i || value > progress[i - 1])).toBe(true);
  expect(accumulator.complete(counts)).toStrictEqual(silhouetteScene(structuredClone(sites)));
  // An empty town still yields one empty scene.
  const empty = createUrbanSceneAccumulator();
  const none = await streamSilhouetteScene(fakePages([]).pages, {
    part: (delta, at) => {
      empty.append(delta, at);
    },
  });
  expect(empty.complete(none)).toStrictEqual(silhouetteScene([]));
});

it('stops between pages when cancelled and rejects on a page error', async () => {
  let cancelled = false;
  const parts: ArchitectureBatchProgress[] = [];
  const first = fakePages(sites);
  await expect(
    streamSilhouetteScene(first.pages, {
      cancelled: () => cancelled,
      part: (_delta, at) => {
        parts.push(at);
        cancelled = true;
      },
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(first.reads).toEqual([0]);
  expect(parts).toHaveLength(1);

  const second = fakePages(sites, offset => (offset > 0 ? new Error('native page failed') : undefined)),
    deltas: PlacementBatch[] = [];
  await expect(
    streamSilhouetteScene(second.pages, {
      part: delta => {
        deltas.push(delta);
      },
    }),
  ).rejects.toThrow('native page failed');
  expect(second.reads).toHaveLength(2);
  expect(deltas).toHaveLength(1);
});

it('reads a retained source by pages in the worker, never the whole city, and the client assembles the same scene', async () => {
  const runtime = { profile: 'local' as const, server: 'http://local.test:8812' };
  const source: UrbanSourceHandle = { version: 1, session: 'paged', terrainRevision: 't', layoutsRevision: 'l', partitionsRevision: 'p' };
  const wire: Record<string, unknown>[] = [];
  const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
      if (String(url).endsWith('/status')) return json({ service: 'magna-urbis-local', capabilities: ['urban.building-site-pages'] });
      const body = JSON.parse(String(options?.body));
      wire.push(body);
      if (body.kind === 'buildingSitesBegin') return json({ ok: true, data: { sourceId: 'index', total: sites.length } });
      const page = sites.slice(body.offset, body.offset + body.limit);
      return json({ placementRequests: page, offset: body.offset, next: body.offset + page.length, total: sites.length });
    }),
  );
  const messages: UrbanSceneResponse[] = [];
  const scope = {
    onmessage: undefined as ((event: MessageEvent<UrbanSceneWorkerMessage>) => void) | undefined,
    postMessage(message: UrbanSceneResponse) {
      messages.push(structuredClone(message));
    },
  };
  vi.stubGlobal('self', scope);
  await import('../src/ui/urbanSceneWorker');
  scope.onmessage!({ data: { id: 1, seed: 'paged', runtime, source, keys: ['city'], mode: 'silhouette' } } as MessageEvent<UrbanSceneWorkerMessage>);
  await vi.waitFor(() => expect(messages.some(message => message.complete || message.error)).toBe(true));
  expect(messages.find(message => message.error)).toBeUndefined();
  expect(harness.engine).not.toHaveBeenCalled();
  expect(wire[0]).toMatchObject({ kind: 'buildingSitesBegin', source, keys: ['city'], seed: 'paged' });
  expect(wire.slice(1).every(body => body.kind === 'buildingSitesPage')).toBe(true);
  expect(messages.some(message => message.scene)).toBe(false);
  expect(messages.filter(message => message.progress).at(-1)?.progress).toEqual({ completed: sites.length, total: sites.length });

  // The page client appends the ordered parts and resolves with the whole scene.
  const workers: { messages: unknown[]; onmessage?(event: MessageEvent<UrbanSceneResponse>): void }[] = [];
  vi.doMock('../src/ui/urbanSceneWorker?worker&inline', () => ({
    default: class {
      messages: unknown[] = [];
      onmessage?: (event: MessageEvent<UrbanSceneResponse>) => void;
      constructor() {
        workers.push(this);
      }
      postMessage(message: unknown) {
        this.messages.push(message);
      }
      terminate() {}
    },
  }));
  const { createUrbanSceneClient } = await import('../src/ui/urbanScene');
  const client = createUrbanSceneClient(),
    progress: number[] = [];
  const result = client.run({ seed: 'paged', runtime, source, keys: ['city'], mode: 'silhouette' }, completed => progress.push(completed));
  for (const message of messages) workers[0].onmessage!({ data: message } as MessageEvent<UrbanSceneResponse>);
  const response = await result;
  expect(response.scene).toStrictEqual(silhouetteScene(structuredClone(sites)));
  expect(progress.at(-1)).toBe(sites.length);
  client.dispose();
});
