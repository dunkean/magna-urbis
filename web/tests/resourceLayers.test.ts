import { describe, expect, it } from 'vitest';
import { DIAGNOSTICS, RESOURCE_OVERLAYS, diagnosticAvailable } from '../src/render/displayDiagnostics';
import { decodeResources, POTENTIAL_IDS, type ResourcePayload } from '../../rust/bridge/resources';
import { resourcePixels, siteCategory, sitesSvg } from '../src/render/resourceOverlay';
import { ruralSoilField } from '../src/v2/resourceSoil';
import { validateAppearance } from '../src/v2/appearance';

const b64 = (bytes: number[]): string => Buffer.from(bytes).toString('base64');
// 2 x 2 blocks of 100 m: rock classes 0..3, one sea block; arable potential rising, soil depth 3 m, drainage 4.
const payload: ResourcePayload = {
  version: 1, nx: 2, ny: 2, cell: 100, x0: 0, y0: 0, context: 'test',
  rocks: ['granite', 'limestone', 'sandstone', 'marl', 'basalt', 'metamorphic', 'ultrabasic', 'evaporite'],
  bedrock: b64([0, 1, 2, 3]), water: b64([0, 0, 0, 1]),
  fields: [
    { id: 'soil_depth', lo: 0, hi: 3, data: b64([255, 255, 0, 255]) }, { id: 'stoniness', lo: 0, hi: 1, data: b64([0, 0, 255, 0]) },
    { id: 'drainage', lo: 0, hi: 4, data: b64([255, 255, 255, 0]) }, { id: 'arable', lo: 0, hi: 1, data: b64([0, 85, 255, 255]) },
  ],
  deposits: [], anchors: [],
};

describe('resource layers', () => {
  it('decodes the compact payload and rescales fields', () => {
    const grid = decodeResources(payload);
    expect([...grid.bedrock]).toEqual([0, 1, 2, 3]);
    expect(grid.value('soil_depth', 0)).toBeCloseTo(3);
    expect(grid.value('arable', 1)).toBeCloseTo(1 / 3, 2);
    expect(grid.value('missing', 0)).toBe(0);
    expect(() => decodeResources({ ...payload, bedrock: b64([0]) })).toThrow();
  });
  it('lists every resource diagnostic with a label, and accepts them in a recipe', () => {
    for (const id of RESOURCE_OVERLAYS) {
      const definition = DIAGNOSTICS.find(d => d.id === id);
      expect(definition?.legend.length).toBeGreaterThan(10);
      expect(diagnosticAvailable(id, 'none')).toBe(true);
    }
    expect(POTENTIAL_IDS).toHaveLength(20);
    expect(() => validateAppearance({ style: 'parchment', diagnostic: 'res-geology', resourcePotential: 'peat' })).not.toThrow();
    expect(() => validateAppearance({ style: 'parchment', resourcePotential: 'unobtainium' })).toThrow();
  });
  it('colours blocks by layer and leaves the sea transparent', () => {
    const grid = decodeResources(payload), geology = resourcePixels(grid, 'res-geology');
    expect(geology[3]).toBeGreaterThan(0); expect(geology[3 * 4 + 3]).toBe(0);
    expect(new Set([0, 1, 2].map(k => geology.slice(k * 4, k * 4 + 3).join()))).toHaveProperty('size', 3);
    const potential = resourcePixels(grid, 'res-potential', 'arable');
    expect(potential[3]).toBe(0); expect(potential[2 * 4 + 3]).toBeGreaterThan(potential[1 * 4 + 3]);
  });
  it('rural soil: deep drained loam is high, stony ground is low, within -1..1', () => {
    const soil = ruralSoilField(payload);
    expect(soil(50, 50)).toBeGreaterThan(soil(50, 150));
    for (const p of [[0, 0], [150, 50], [5000, -5000]]) expect(Math.abs(soil(p[0], p[1]))).toBeLessThanOrEqual(1);
  });
  it('draws sites with their parent line', () => {
    const site = { id: 'a', template: 'water_mill', mode: 'attached_external', parent: 'p', kind: 'mill_seat', x: 10, y: 10 } as never;
    const svg = sitesSvg([site], new Map([['p', { x: 50, y: 60 }]]), 5);
    expect(svg).toContain('<line'); expect(svg).toContain(siteCategory('mill_seat').color); expect(svg).toContain('water_mill');
  });
});
