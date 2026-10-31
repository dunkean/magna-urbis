/** Vector content follows the current view scale: screen-size symbols keep their pixel size, and
 * vectors drawn through an image are re-rasterized for the view instead of stretched. */
import { describe, it, expect } from 'vitest';
import { createCanvasRenderer, type CanvasLike } from '../src/render/canvas';
import { buildScene } from '../src/render/scene';
import { viewRect, zoomAt } from '../src/render/view';
import { VIEW_RASTER_COARSE, VIEW_RASTER_MAX_PX, viewRasterFits, viewRasterRegion } from '../src/render/viewRaster';
import { fakeWorld, MockPath2D } from '../scripts/fakeworld';

/** A 2D context recording the radius of every arc, with the transform scale current at the call. */
function arcCanvas(w: number, h: number) {
  const arcs: { r: number; k: number }[] = [];
  let k = 1;
  const state: Record<string, unknown> = { fillStyle: '', strokeStyle: '', globalAlpha: 1 };
  const ctx = new Proxy(state, {
    get(t, name: string) {
      if (name in t) return t[name];
      return (...args: number[]) => {
        if (name === 'setTransform') k = args[0];
        if (name === 'arc') arcs.push({ r: args[2], k });
        if (name === 'measureText') return { width: 6 };
        return undefined;
      };
    },
    set(t, name: string, v) { t[name] = v; return true; },
  });
  return { canvas: { width: w, height: h, getContext: () => ctx }, arcs };
}

describe('view scale invariants', () => {
  it('the V2 site marker keeps one screen size at any zoom', () => {
    const world = { ...fakeWorld({ mapSize: 8000, buildings: 10, streets: 10, clusters: 1, landAreas: 4, seed: 3 }), urban: undefined };
    world.site = { center: { x: 4000, y: 4000 } } as typeof world.site;
    const scene = buildScene(world);
    const radii = [0.1, 1, 6].map(scale => {
      const m = arcCanvas(800, 600);
      const r = createCanvasRenderer(m.canvas as unknown as CanvasLike, world, 'parchment', { Path2D: MockPath2D as never, dpr: 1, scene, terrain: () => null, raster: false });
      r.draw({ cx: 4000, cy: 4000, scale });
      // The marker ring: the largest arc of the frame, in screen pixels.
      return Math.max(...m.arcs.map(a => a.r * a.k));
    });
    expect(radii[0]).toBeGreaterThan(3);
    for (const r of radii) expect(r).toBeCloseTo(radii[0], 6);
  });

  it('a vector raster is re-made once the zoom changes by more than a small factor, and never exceeds its budget', () => {
    const size = 8000, w = 1400, h = 1000, dpr = 2;
    let view = { cx: 4000, cy: 4000, scale: w / size };
    let raster = viewRasterRegion(viewRect(view, w, h), view.scale * dpr, size);
    for (let step = 0; step < 40; step++) {
      view = zoomAt(view, 1.15, w * 0.6, h * 0.4, w, h);
      const rect = viewRect(view, w, h), density = view.scale * dpr;
      if (!viewRasterFits(raster, rect, density, size)) raster = viewRasterRegion(rect, density, size);
      // The drawn raster covers the view at no less than the screen density / COARSE: never a stretched map raster.
      expect(viewRasterFits(raster, rect, density, size)).toBe(true);
      expect(raster.density * VIEW_RASTER_COARSE).toBeGreaterThanOrEqual(Math.min(density, VIEW_RASTER_MAX_PX / Math.max(rect.maxX - rect.minX, rect.maxY - rect.minY)) - 1e-9);
      expect(Math.max(raster.width, raster.height) * raster.density).toBeLessThanOrEqual(VIEW_RASTER_MAX_PX + 1e-6);
    }
    // A whole-map raster of 2048 px cannot serve a close view.
    expect(viewRasterFits({ x: 0, y: 0, width: size, height: size, density: 2048 / size }, viewRect(view, w, h), view.scale * dpr, size, Infinity)).toBe(false);
  });
});
