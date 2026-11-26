import { afterEach, describe, expect, it } from 'vitest';
import { SeasonColorTable, applySeason, mapLandSeason, mapSnowCover, roofSeasonKey, seasonPaint, setMapClimateZone, setMapSeason } from '../src/render/seasonPalette';
import { CLIMATE_ZONE_VALUES } from '../../rust/bridge/terrainClimate';
import { ParchmentSymbols } from '../src/render/parchmentSymbols';
import { RecordingCanvas } from '../src/render/gpu/recorder';
import { parseColor } from '../src/render/gpu/colors';
import { mixHex } from '../src/render/cartography/geometry';
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
    // A bare crown is its tapered limbs (rust/bridge/bareTree.ts bareLimbs), each a filled quad; a crown in leaf has none.
    const lines = (kind: 'forest' | 'conifer', pal: typeof winter) => canopyGlyph(kind, 3, pal, 5).filter(s => !s.open && !s.line && s.points.length === 4).length;
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
  it('gives the paper ground the snow of the overlay land as uniforms of the date', () => {
    // landSeason of treeSymbolsGlsl.ts, transcribed: the ground lays the date over one summer sheet.
    const ramp = (a: number, b: number, x: number): number => {
      const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const shaderCover = ({ tint, snow }: ReturnType<typeof mapLandSeason>, altitude: number): number => {
      const lapse = 0.0065 * Math.max(0, altitude),
        supply = ramp(0.12, 0.7, snow[3] / Math.max(120, snow[2] - 20 * lapse));
      return Math.max(tint[3], ramp(0.405, 0.465, Math.max(ramp(2, -5, snow[0] - lapse), ramp(2.5, -2.5, snow[1] - lapse)) * supply));
    };
    expect(shaderCover(mapLandSeason(), 3000)).toBe(0);
    setMapClimateZone('alpine', CLIMATE_ZONE_VALUES.alpine);
    for (const date of [0, 0.3, 0.5, 0.8]) {
      setMapSeason(date, 'alpine', {});
      const land = mapLandSeason();
      for (const altitude of [0, 400, 1200, 2600]) expect(shaderCover(land, altitude)).toBeCloseTo(mapSnowCover(altitude), 9);
    }
    setMapSeason(0.5, 'alpine', {});
    expect(mapLandSeason().tint.slice(0, 3)).toEqual([1, 1, 1]);
    expect(shaderCover(mapLandSeason(), 2600)).toBeGreaterThan(shaderCover(mapLandSeason(), 0));
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

it('keeps CPU and replay leaf opacity and derived inks tied to the resolved palette', () => {
  const table = new SeasonColorTable(parchment);
  const slot = table.ink('farmLeaves');
  for (const date of [0.5, 0.75, 0]) {
    const pal = at(date, 'nordic');
    table.update(pal);
    expect(table.ink('farmLeaves')).toBe(slot);
    const alpha = 0.3 + 0.7 * pal.season!.leaf;
    expect(slot.rgba[3]).toBeCloseTo(alpha, 6);
    expect(parseColor(slot.css)![3]).toBeCloseTo(alpha, 6);
    expect(table.ink('sheetGrass').css).toBe(mixHex(pal.inkSoft, pal.grass, 0.3));
    expect(table.ink('sheetWash').css).toBe(mixHex(pal.treeFill, pal.inkSoft, 0.3));
    expect(table.ink('symbolLeaves').rgba[3]).toBeCloseTo(0.25 + 0.75 * pal.season!.leaf, 6);
  }
});

it('reconstructs the coloured Canvas pen sheet from one mask for autumn and snowy winter', () => {
  const makeCanvas = (width: number, height: number) => {
    const pixels = new Uint8ClampedArray(width * height * 4);
    const ctx = { createImageData: () => ({ data: pixels }), putImageData: () => {} };
    return { width, height, pixels, getContext: () => ctx } as unknown as CanvasLike;
  };
  const mask = new ParchmentSymbols(null, 0.6, makeCanvas);
  const recorded = new RecordingCanvas(40, 40);
  const ctx = recorded.getContext('2d')!;
  const table = new SeasonColorTable(parchment);
  let atlas: CanvasImageSource | undefined;
  for (const date of [0.75, 0]) {
    table.update(at(date, 'nordic'));
    const ink = table.ink('sheetGrass'),
      wash = table.ink('sheetWash');
    mask.draw(ctx, 0, 20, 20, 8, [ink, wash]);
    new ParchmentSymbols([ink.css, wash.css], 0.6, makeCanvas).draw(ctx, 0, 20, 20, 8);
    const [masked, cpu] = recorded.finish().ops;
    if (masked?.type !== 'sprites' || cpu?.type !== 'sprites') throw new Error('Missing pen sheet');
    expect(masked.tint).toEqual([ink, wash]);
    if (atlas) expect(masked.source).toBe(atlas);
    atlas = masked.source;
    const data = (image: CanvasImageSource) => (image as unknown as { pixels: Uint8ClampedArray }).pixels;
    const weights = data(masked.source),
      reference = data(cpu.source);
    let maxError = 0,
      maxAlphaError = 0,
      covered = 0;
    for (let i = 0; i < reference.length; i += 4) {
      const a = reference[i + 3];
      if (a) covered++;
      const r = weights[i],
        g = weights[i + 1];
      maxAlphaError = Math.max(maxAlphaError, Math.abs(a - r - g));
      for (let channel = 0; channel < 3; channel++) maxError = Math.max(maxError, Math.abs((reference[i + channel] * a) / 255 - (ink.rgba[channel] * r + wash.rgba[channel] * g)));
    }
    expect(covered).toBeGreaterThan(0);
    expect(maxAlphaError).toBe(0);
    expect(maxError).toBeLessThan(1);
  }
});
