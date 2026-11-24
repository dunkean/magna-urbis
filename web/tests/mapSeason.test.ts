import { afterEach, describe, expect, it } from 'vitest';
import { applySeason, mapSnowCover, roofSeasonKey, seasonPaint, setMapClimateZone, setMapSeason } from '../src/render/seasonPalette';
import { CLIMATE_ZONE_VALUES } from '../../rust/bridge/terrainClimate';
import { canopyGlyph } from '../src/render/canopy';
import { createCanvasRenderer, type CanvasLike } from '../src/render/canvas';
import { treeMix } from '../src/render/treeSpecies';
import { PALETTES } from '../src/render/styles';
import { fakeWorld, mockCanvas, MockPath2D } from '../scripts/fakeworld';

const parchment = PALETTES.parchment;
const at = (season: number, zone: Parameters<typeof seasonPaint>[1]) => applySeason(parchment, seasonPaint(season, zone));
const light = (hex: string) => [1, 3, 5].reduce((sum, i) => sum + parseInt(hex.slice(i, i + 2), 16), 0);

afterEach(() => {
  setMapSeason(0.5, undefined, {});
  setMapClimateZone(undefined);
});
describe('the season of the drawn maps', () => {
  it('keeps the authored land in summer and whitens it under the snow of the calendar', () => {
    const summer = at(0.5, 'nordic'),
      winter = at(0, 'nordic');
    expect(summer.land).toEqual(parchment.land);
    expect(summer.season).toMatchObject({ leaf: 1, autumn: 0, snow: 0 });
    expect(light(winter.land.meadow)).toBeGreaterThan(light(summer.land.meadow));
    expect(winter.season!.snow).toBeGreaterThan(0.5);
    setMapSeason(0, 'nordic', {});
    setMapClimateZone('nordic', CLIMATE_ZONE_VALUES.nordic);
    expect(mapSnowCover(0)).toBeGreaterThan(0.9);
  });
  it('bares the deciduous crowns in winter, never the conifers, and turns them in autumn', () => {
    const winter = at(0, 'temperate'),
      summer = at(0.5, 'temperate');
    const lines = (kind: 'forest' | 'conifer', pal: typeof winter) => canopyGlyph(kind, 3, pal, 5).filter(s => s.open).length;
    expect(lines('forest', winter)).toBeGreaterThan(15);
    expect(lines('forest', summer)).toBeLessThan(6);
    expect(lines('conifer', winter)).toBe(0);
    expect(canopyGlyph('forest', 3, at(0.75, 'temperate'), 5)[1].fill).not.toBe(canopyGlyph('forest', 3, summer, 5)[1].fill);
  });
  it('gives two dates with the same snow one roof key', () => {
    setMapClimateZone('mediterranean', CLIMATE_ZONE_VALUES.mediterranean);
    setMapSeason(0.53, 'mediterranean', {});
    const earlier = roofSeasonKey();
    setMapSeason(0.63, 'mediterranean', {});
    expect(roofSeasonKey()).toBe(earlier);
  });
  it('plants the species of the zone', () => {
    expect(treeMix('temperate').conifer).toBeLessThan(0.2);
    expect(treeMix('tropical').palm).toBeGreaterThan(0.2);
    setMapClimateZone('alpine', CLIMATE_ZONE_VALUES.alpine);
    expect(treeMix('temperate')).toMatchObject({ palm: 0 });
    expect(treeMix('temperate').conifer).toBeGreaterThan(0.7);
    expect(treeMix('temperate').larch).toBeGreaterThan(0.2);
  });
  it('paints another season with the same renderer and scene', () => {
    let palette = at(0.5, 'temperate');
    const renderer = createCanvasRenderer(mockCanvas(400, 400).canvas as unknown as CanvasLike, fakeWorld(), 'parchment', { Path2D: MockPath2D as unknown as typeof Path2D, terrain: () => null, raster: false, palette: () => palette });
    renderer.draw({ cx: 200, cy: 200, scale: 1 });
    const scene = renderer.scene;
    expect(renderer.palette).toBe(palette);
    palette = at(0, 'temperate');
    renderer.draw({ cx: 200, cy: 200, scale: 1 });
    expect(renderer.palette).toBe(palette);
    expect(renderer.scene).toBe(scene);
    renderer.dispose();
  });
});
