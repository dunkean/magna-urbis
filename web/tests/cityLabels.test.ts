import { describe, expect, it } from 'vitest';
import { fakeWorld, mockCanvas, MockPath2D } from '../scripts/fakeworld';
import { createCanvasRenderer, type CanvasLike } from '../src/render/canvas';
import { siteLayer } from '../src/render/landuse';
import { PALETTES } from '../src/render/styles';
import { renderSvg } from '../src/render/svg';

function fixture() {
  const world = fakeWorld({ mapSize: 1600, buildings: 0, streets: 0, landAreas: 0 });
  world.urban = undefined; world.roads = []; world.options.labels = true;
  world.site = { center: { x: 800, y: 800 }, crossing: { x: 700, y: 700 } } as NonNullable<typeof world.site>;
  world.names = { family: 'french', town: 'Ville test', entries: [{ id: 'town', kind: 'town', text: 'Ville test', rank: 0, anchor: { x: 800, y: 800 } }] };
  return world;
}

describe('map annotations in city land-use overlays', () => {
  it('disables custom labels, place names and placeholder pins through the existing canvas overlay flag', () => {
    const world = fixture(), { canvas, log, reset } = mockCanvas(1000, 1000);
    const renderer = createCanvasRenderer(canvas as unknown as CanvasLike, world, 'atlas', { Path2D: MockPath2D as never, terrain: () => null, raster: false });
    renderer.setLabels([{ x: 500, y: 500, text: 'Custom label', priority: 1 }]);
    renderer.setOverlays({ labels: true, legend: false, cartouche: false });
    renderer.draw({ cx: 800, cy: 800, scale: 0.5 });
    expect(log.calls.fillText).toBeGreaterThan(0); expect(log.calls.arc).toBeGreaterThan(0);
    reset(); renderer.setOverlays({ labels: false });
    renderer.draw({ cx: 800, cy: 800, scale: 0.5 });
    expect(log.calls.fillText ?? 0).toBe(0); expect(log.calls.strokeText ?? 0).toBe(0); expect(log.calls.arc ?? 0).toBe(0);
    expect(renderer.lastPlaced()).toEqual([]);
    renderer.dispose();
  });

  it('suppresses SVG land-use pins and map labels, including diagnostic pin text', () => {
    const world = fixture();
    const shown = siteLayer(world, PALETTES.atlas, 1, true);
    expect(shown).toContain('<circle'); expect(shown).toContain('crossing');
    const hidden = siteLayer(world, PALETTES.atlas, 1, true, false);
    expect(hidden).not.toContain('<circle'); expect(hidden).not.toContain('<text');
    const options = { legend: false, cartouche: false, debug: true, raster: false, contours: false, layers: { decor: false } };
    expect(renderSvg(world, { ...options, labels: true })).toContain('class="layer-labels"');
    const svg = renderSvg(world, { ...options, labels: false });
    expect(svg).not.toContain('class="layer-labels"'); expect(svg).not.toContain('<text');
    expect(svg).not.toContain('crossing'); expect(svg).toContain('<g class="layer-site" fill="none"></g>');
  });
});
