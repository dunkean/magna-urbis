import './vectorWaterWasm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadRenderGeometry } from '../../rust/bridge/renderGeometry';
import { createCanvasRenderer, type CanvasLike } from '../src/render/canvas';
import { buildScene, type PolyLayer } from '../src/render/scene';
import { boxesOf, TileIndex } from '../src/render/tileindex';
import { fakeWorld, mockCanvas, MockPath2D } from '../scripts/fakeworld';

beforeAll(() => loadRenderGeometry());

const square = (x: number, y: number, size: number) => [
  { x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size },
];
const layer = (name: string, polys: ReturnType<typeof square>[]): PolyLayer => ({
  name, polys, index: new TileIndex(16000, 250, boxesOf(polys)),
});
const worldOf = () => {
  const world = fakeWorld({ mapSize: 16000, buildings: 0, streets: 0, landAreas: 0 });
  world.urban = undefined; world.site = undefined; world.settlements = []; world.roads = [];
  world.terrain.rivers = []; world.terrain.lakes = [];
  world.options.contours = false; world.options.labels = false;
  return world;
};

describe('bounded Canvas vector replay', () => {
  it('submits only locally clipped fill geometry and reuses it on a warm frame', () => {
    class BoundsPath extends MockPath2D {
      points: [number, number][] = [];
      moveTo(...args: number[]) { this.points.push([args[0], args[1]]); super.moveTo(); }
      lineTo(...args: number[]) { this.points.push([args[0], args[1]]); super.lineTo(); }
    }
    const world = worldOf(); world.options.landuse = false;
    const scene = buildScene(world); scene.poly.clear(); scene.lines = [];
    scene.poly.set('sea', layer('sea', [square(0, 0, 16000), square(100, 100, 3000)]));
    const m = mockCanvas(256, 256);
    const renderer = createCanvasRenderer(m.canvas as unknown as CanvasLike, world, 'parchment', {
      scene, raster: false, Path2D: BoundsPath as never, dpr: 1, terrain: () => null,
    });
    renderer.setOverlays({ labels: false, legend: false, cartouche: false });
    const view = { cx: 8000, cy: 8000, scale: 1 };
    try {
      renderer.draw(view);
      const fills = m.log.fills.filter(f => f.path instanceof BoundsPath);
      expect(fills.length).toBeGreaterThan(0);
      for (const fill of fills) for (const [x, y] of (fill.path as BoundsPath).points) {
        expect(x).toBeGreaterThan(7600); expect(x).toBeLessThan(8400);
        expect(y).toBeGreaterThan(7600); expect(y).toBeLessThan(8400);
      }
      expect(renderer.draw(view).pathsBuilt).toBe(0);
    } finally { renderer.dispose(); }
  });

  it('creates raster tiles on CPU contexts before any vector draw', () => {
    const world = worldOf(); world.options.landuse = false;
    const scene = buildScene(world); scene.poly.clear(); scene.lines = [];
    const contexts: (CanvasRenderingContext2DSettings | undefined)[] = [];
    const m = mockCanvas(256, 256);
    const renderer = createCanvasRenderer(m.canvas as unknown as CanvasLike, world, 'parchment', {
      scene, Path2D: MockPath2D as never, dpr: 1, terrain: () => null,
      createCanvas: (w, h) => {
        const tile = mockCanvas(w, h); let first = true;
        return { width: w, height: h, getContext: (_id, options) => {
          if (first) { if (w === 576 && h === 576) contexts.push(options); first = false; }
          return tile.canvas.getContext('2d') as CanvasRenderingContext2D;
        } };
      },
    });
    try {
      expect(renderer.draw({ cx: 8000, cy: 8000, scale: 1 }).rasterBuilt).toBeGreaterThan(0);
      expect(contexts.length).toBeGreaterThan(0);
      expect(contexts.every(c => c?.willReadFrequently === true)).toBe(true);
    } finally { renderer.dispose(); }
  });

  it('builds the CPU preview cooperatively with a fixed polygon/vertex budget', () => {
    const frames = new Map<number, FrameRequestCallback>(); let id = 0, clock = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++id, cb); return id; });
    vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
    const world = worldOf(); world.options.landuse = true;
    const scene = buildScene(world); scene.poly.clear(); scene.lines = [];
    scene.poly.set('lu-meadow', layer('lu-meadow', Array.from({ length: 10000 }, (_, i) => square(i % 100 * 150, Math.floor(i / 100) * 150, 100))));
    const m = mockCanvas(256, 256), preview = mockCanvas(2048, 2048);
    let previewOptions: CanvasRenderingContext2DSettings | undefined;
    const renderer = createCanvasRenderer(m.canvas as unknown as CanvasLike, world, 'parchment', {
      scene, Path2D: MockPath2D as never, dpr: 1, terrain: () => null, now: () => clock++, invalidate() {},
      createCanvas: (w, h) => {
        const target = w === 2048 ? preview : mockCanvas(w, h);
        return { width: w, height: h, getContext: (_id, options) => {
          if (w === 2048 && options) previewOptions = options;
          return target.canvas.getContext('2d') as CanvasRenderingContext2D;
        } };
      },
    });
    try {
      renderer.draw({ cx: 8000, cy: 8000, scale: 1 }, { live: true });
      expect(preview.log.fills.length).toBe(0);
      expect(previewOptions?.willReadFrequently).toBe(true);
      for (let i = 0; frames.size && i < 10000; i++) {
        const [key, cb] = frames.entries().next().value!; frames.delete(key); cb(clock);
      }
      expect(frames.size).toBe(0);
      expect(preview.log.fills.length).toBeGreaterThan(0);
      expect(preview.log.fills.length).toBeLessThanOrEqual(4096);
      expect(preview.log.pathOps).toBeLessThanOrEqual(32768);
    } finally { renderer.dispose(); vi.unstubAllGlobals(); }
  });
});
