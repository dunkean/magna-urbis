import { describe, expect, it } from 'vitest';
import { buildNearTrees, buildNearTreesSteps, TREE_STRIDE, type TreeInputs } from '../src/ui/terrain3dTrees';
import { CLIMATE_ZONES, CLIMATE_ZONE_VALUES, type ClimateZone } from '../../rust/bridge/terrainClimate';
import { FOREST_BIOMES, forestGiant, forestSocial, type ForestSocial } from '../../rust/bridge/terrainForestStature';
import { forestHash } from '../../rust/bridge/terrainForest';

/** A uniform stand: cover, height (x 50 m) and needle share as field bytes, in a climate zone (none: zone 0). */
function stand(cover: number, height: number, needle: number, zone?: ClimateZone): TreeInputs {
  const n = 32,
    rgba = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) rgba.set([cover, height, needle, 255], i * 4);
  const climate = zone ? CLIMATE_ZONE_VALUES[zone] : { temperature: 10, precipitation: 900 };
  return {
    field: { x: -1200, y: -1200, width: 2400, n, rgba, key: `${cover}-${height}-${needle}-${zone}` },
    seed: 5,
    climate: { temperature: climate.temperature, precipitation: climate.precipitation },
    renderV2: 1,
    zone: zone ? CLIMATE_ZONES.indexOf(zone) + 1 : 0,
    season: 0.5,
    water: () => 0,
    height: () => 20,
  };
}
const view = { x: 0, y: 0, forwardX: 0, forwardY: 1, distance: 300 };
const quantile = (xs: number[], p: number): number => [...xs].sort((a, b) => a - b)[Math.floor(p * (xs.length - 1))];
const column = (trees: Float32Array, k: number): number[] => Array.from({ length: trees.length / TREE_STRIDE }, (_, i) => trees[i * TREE_STRIDE + k]);
/** Field height byte of a zone's typical stand (its default climate's field height, terrainForestStature.ts). */
const fieldByte = (metres: number): number => Math.round((metres / 50) * 255);

describe('near trees: stand structure', () => {
  it('spreads heights over the social classes of a stand, with crowns that fit the stem', () => {
    for (const needle of [20, 230]) {
      const trees = buildNearTrees(stand(235, 110, needle), view),
        heights = column(trees, 4),
        crowns = column(trees, 5);
      expect(heights.length).toBeGreaterThan(500);
      const median = quantile(heights, 0.5);
      // Not a carpet: suppressed and young trees well under the canopy, a few predominant ones above it.
      expect(quantile(heights, 0.05) / median).toBeLessThan(0.75);
      expect(quantile(heights, 0.98) / median).toBeGreaterThan(1.12);
      // A closed tall stand keeps most crowns in the canopy.
      expect(quantile(heights, 0.3) / median).toBeGreaterThan(0.85);
      for (let i = 0; i < heights.length; i++) {
        expect(crowns[i]).toBeGreaterThanOrEqual(0.25 * heights[i] - 1e-4);
        expect(crowns[i]).toBeLessThanOrEqual(0.97 * heights[i] + 1e-4);
      }
    }
  });

  it('builds the same stream at once and in steps, partial installs being prefixes of it', () => {
    const inputs = stand(200, 90, 120),
      whole = buildNearTrees(inputs, view),
      partials: Float32Array[] = [];
    const work = buildNearTreesSteps(inputs, view, values => partials.push(values.slice()));
    let step = work.next();
    while (!step.done) step = work.next();
    expect(step.value).toEqual(whole);
    expect(partials.length).toBeGreaterThan(0);
    for (const p of partials) expect(p).toEqual(whole.subarray(0, p.length));
  });
});

describe('near trees: biomes and giants', () => {
  // Typical canopy (median tree, m) per biome, on the field height of the zone's default climate.
  const cases: [ClimateZone, number, number, number, number][] = [
    ['temperate', 18, 60, 20, 30],
    ['mediterranean', 11, 60, 7, 15],
    ['nordic', 21, 220, 12, 20],
    ['arctic', 17, 240, 1.5, 6],
    ['savanna', 6, 0, 6, 12],
    ['tropical', 34, 0, 30, 45],
  ];
  const built = new Map(cases.map(([zone, metres, needle]) => [zone, buildNearTrees(stand(235, fieldByte(metres * 1.05), needle, zone), view)]));

  it('sizes trees at each biome real height and crown width', () => {
    for (const [zone, , , low, high] of cases) {
      const trees = built.get(zone)!,
        heights = column(trees, 4),
        radii = column(trees, 3);
      expect(heights.length, zone).toBeGreaterThan(100);
      expect(quantile(heights, 0.5), zone).toBeGreaterThanOrEqual(low);
      expect(quantile(heights, 0.5), zone).toBeLessThanOrEqual(high);
      if (zone === 'savanna') expect(2 * quantile(radii, 0.5)).toBeGreaterThan(quantile(heights, 0.5)); // wider than tall
      if (zone === 'nordic') expect(quantile(radii, 0.5)).toBeLessThan(2); // slender spires
      if (zone === 'tropical') expect(quantile(radii, 0.5)).toBeGreaterThan(5); // 3D radius = painted radius, no 3D cap
    }
    expect(Math.max(...column(built.get('tropical')!, 4))).toBeGreaterThan(55); // emergents
  });

  it('places rare giants in groves, far above and wider than their stand', () => {
    const trees = built.get('temperate')!,
      heights = column(trees, 4),
      radii = column(trees, 3),
      median = quantile(heights, 0.5),
      giants: number[] = [];
    for (let i = 0; i < heights.length; i++) if (heights[i] > 1.45 * median) giants.push(i);
    expect(giants.length).toBeGreaterThan(5);
    expect(giants.length / heights.length).toBeLessThan(0.03);
    expect(
      quantile(
        giants.map(i => radii[i]),
        0.5,
      ),
    ).toBeGreaterThan(1.3 * quantile(radii, 0.5));
    // Groves: most giants have another giant within 40 m (an even sprinkle at this share would put them ~90 m apart).
    const at = (i: number): [number, number] => [trees[i * TREE_STRIDE], trees[i * TREE_STRIDE + 1]];
    const grouped = giants.filter(i => giants.some(j => j !== i && Math.hypot(at(i)[0] - at(j)[0], at(i)[1] - at(j)[1]) < 40)).length;
    expect(grouped / giants.length).toBeGreaterThan(0.5);
  });

  it('keeps the class and giant rules deterministic and the giant share per biome', () => {
    const a: ForestSocial = { share: 0, width: 0, rank: 0 },
      b: ForestSocial = { share: 0, width: 0, rank: 0 };
    forestSocial(a, 0, 0.3, 0.7, 0.5, 0.2, 0.6, 0, 0, false);
    forestSocial(b, 0, 0.3, 0.7, 0.5, 0.2, 0.6, 0, 0, false);
    expect(a).toEqual(b);
    let hits = 0;
    for (let i = 0; i < 40000; i++) if (forestGiant((i % 200) * 7.3, Math.floor(i / 200) * 7.3, ((i * 2654435761) >>> 0) / 2 ** 32, FOREST_BIOMES[0].giant, 9, forestHash)) hits++;
    expect(hits / 40000).toBeGreaterThan(0.4 * FOREST_BIOMES[0].giant);
    expect(hits / 40000).toBeLessThan(2.5 * FOREST_BIOMES[0].giant);
  });
});
