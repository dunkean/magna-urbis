import { describe, expect, it, vi } from 'vitest';
import type { World } from '../src/gen/types';
import { defaultSettings } from '../src/v2/settings';

const mocked = vi.hoisted(() => ({ capture: undefined as undefined | (() => Promise<any>), viewport: vi.fn(async () => new Blob(['2d'])) }));
vi.mock('../../illustration/web/index.mjs', () => ({
  captureViewport: mocked.viewport,
  mountIllustration: ({ capture }: { capture: () => Promise<any> }) => {
    mocked.capture = capture;
    return { button: { setAttribute() {}, title: '', hidden: false, style: {} }, dialog: { classList: { add() {} }, querySelector: () => ({ open: false, insertBefore() {} }) }, open() {}, dispose() {} };
  },
}));
vi.mock('../src/v2/i18n', () => ({ registerMessages() {}, setText() {}, translate: (text: string) => text }));
import { mountV2Illustration } from '../src/v2/illustration';

describe('V2 illustration capture', () => {
  it('rejects a missing world and captures the actual 2D viewport and view', async () => {
    let world: World | undefined;
    const element = { clientWidth: 800, clientHeight: 600 } as HTMLElement;
    const view = { cx: 200, cy: 100, scale: 2 };
    const beforeCapture2d = vi.fn();
    mountV2Illustration({ host: {} as Element, getWorld: () => world, getSettings: defaultSettings, getViewport: () => ({ element, view }), beforeCapture2d });
    await expect(mocked.capture!()).rejects.toThrow();
    world = { seed: 'world-seed', stats: {}, settlements: [] } as unknown as World;
    const result = await mocked.capture!();
    expect(mocked.viewport).toHaveBeenCalledWith(element);
    expect(beforeCapture2d).toHaveBeenCalledOnce();
    expect(beforeCapture2d.mock.invocationCallOrder[0]).toBeLessThan(mocked.viewport.mock.invocationCallOrder.at(-1)!);
    expect(result.image.size).toBe(2);
    expect(result.context.sourceId).toBe('world-seed');
    expect(result.context.projection).toBe('orthographic');
    expect(result.context.camera).toEqual(view);
  });
});
