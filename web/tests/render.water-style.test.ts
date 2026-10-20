import { describe, expect, it } from 'vitest';
import { PALETTES } from '../src/render/styles';
import { TERRAIN_STYLE_LIST, terrainStyle, waterShoreColor } from '../src/render/terrainStyle';
import { waterSampler } from '../src/render/waterStyle';
import { encodeWaterField, decodeWaterField, lakeDistances, waterMaterialPixels } from '../src/render/terrainWater';
import { diagnosticDefinition, diagnosticAvailable } from '../src/render/displayDiagnostics';
import { decorWaterSvg } from '../src/ui/decorWater';
import { cropTerrain, terrainFromDecor } from '../src/ui/benchTerrainTransfer';
import type { Decor } from '../src/ui/decor';

function fixture(): Decor {
  const n = 8, width = 800, height = new Float32Array(n * n).fill(10), water = new Uint8Array(n * n);
  for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) water[y * n + x] = 2;
  const field = Float32Array.from(water, value => value === 2 ? 1 : -1);
  return {
    raster: { n, width, height, water, waterLevel: height.slice(), riverWidth: new Float32Array(n * n), riverIds: new Int32Array(n * n) },
    meta: { format: 'magna-decor', version: 1, id: 'water-style', label: '', tags: {}, seed: '42', width, query: '', created: '', settlements: [], roads: null, roadConfig: null,
      waterSvg: '<g fill="#123456"><path class="water-lakes" d="M200,200H600V600H200Z"/><path d="M0,400H200" stroke="#abcdef"/></g>',
      waterMaterial: { field: encodeWaterField(field), n, width, referenceWidth: width, path: 'M200,200H600V600H200Z', sea: { distance: encodeWaterField(new Float32Array(n * n).fill(5)), n } },
      stats: { land: .75, minHeight: 10, maxHeight: 10, riverKm: 0, roadKm: 0 } },
  };
}

describe('shared water appearance and display semantics', () => {
  it.each(TERRAIN_STYLE_LIST.map(style => style.id))('%s retains its ramp endpoints and physical source scale', id => {
    const definition = terrainStyle(id), distance = new Float32Array([0, 2, 8, 16, 100]);
    const sea = waterMaterialPixels(distance, definition.water, 1000);
    const sample = waterSampler(definition.water);
    expect([...sea.slice(0, 3)]).toEqual(sample(0).map(Math.round));
    expect(waterMaterialPixels(Float32Array.from(distance, d => d * 4), definition.water, 4000)).toEqual(sea);
    expect(waterShoreColor(id)).toBe(definition.water.stops[0][1]);
  });

  it('removes conflicting lake and river fill aliases from every palette', () => {
    for (const palette of Object.values(PALETTES)) {
      expect(palette.lakeFill).toBe(palette.seaFill);
      expect(palette.riverFill).toBe(palette.water.stops[0][1]);
    }
  });

  it('keys lake distance caches by dimensions and keeps physical metre units', () => {
    const n = 8, field = Float32Array.from({ length: n * n }, (_, i) => i % n < 4 ? 1 : -1);
    const a = lakeDistances(field, n, 800), b = lakeDistances(field, n, 1600);
    expect(a).not.toBe(b);
    expect(lakeDistances(field, n, 800)).toBe(a);
    for (let i = 0; i < a.length; i++) expect(b[i]).toBeCloseTo(a[i] * 2);
  });

  it('changes retained water style without reusing source colors or frozen material images', () => {
    const decor = fixture(), atlas = decorWaterSvg(decor, 'atlas'), night = decorWaterSvg(decor, 'night');
    expect(atlas).toContain('<image'); expect(night).toContain('<image');
    expect(atlas).not.toBe(night);
    expect(night).not.toContain('#123456'); expect(night).not.toContain('#abcdef');
    const noLakes = decorWaterSvg(decor, 'night', false);
    expect(noLakes).not.toContain('water-lakes'); expect(noLakes).not.toContain('<image');
    expect(noLakes).toContain('M0,400H200');
  });

  it('preserves original material fields, origins and scale through repeated crops', () => {
    const original = fixture(), first = cropTerrain(original, 100, 100, 600), second = cropTerrain(first, 100, 100, 400);
    expect(second.meta.waterMaterial?.field).toBe(original.meta.waterMaterial?.field);
    expect(second.meta.waterMaterial).toMatchObject({ width: 800, referenceWidth: 800, x: 200, y: 200, extent: 400 });
    expect(decorWaterSvg(second, 'atlas')).toContain('viewBox="200 200 400 400"');
    expect(terrainFromDecor(second).waterSurface).toMatchObject({ width: 800, referenceWidth: 800, x: -200, y: -200 });
    expect(decodeWaterField(original.meta.waterMaterial!.field).length).toBe(64);
  });

  it('classifies elevation as a replacement diagnostic and restricts computed overlays to their data source', () => {
    expect(TERRAIN_STYLE_LIST.some(style => style.id === 'copernicus')).toBe(false);
    expect(diagnosticDefinition('elevation')).toMatchObject({ source: 'terrain', composition: 'replacement' });
    expect(diagnosticAvailable('elevation', 'none')).toBe(true);
    expect(diagnosticAvailable('v-basins', 'rust')).toBe(false);
    expect(diagnosticAvailable('basins', 'vector')).toBe(false);
  });
});
