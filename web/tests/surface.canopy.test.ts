import { describe, expect, it } from 'vitest';
import { compileSurfaceWorld } from '../src/surface/compiler';
import { generateSurfaceCandidates } from '../src/surface/population';
import { expectedTreeCover, treeAcceptanceForCover, TREE_CROWN_RADIUS_RATIO } from '../src/surface/treeCanopy';
import { SURFACE_POPULATION_VERSION, type SurfaceCandidate } from '../src/surface/model';

function world(cover: number) {
  const n = 17, value = compileSurfaceWorld({ seed: 7381, terrain: { width: n, height: n, originX: 0, originZ: 0, spacingM: 64,
    heights: new Float32Array(n * n), source: { id: 'unit-only-flat', version: '1', sourceLOD: 0, nativeSpacingM: 64 } },
    hydrology: { version: 'dry', provenance: 'unit fixture', waterClass: new Uint8Array(n * n) } });
  value.fields.treeCover.fill(cover); return value;
}
function measuredCover(candidates: SurfaceCandidate[], bounds: { minX: number; minZ: number; maxX: number; maxZ: number }) {
  const cell = 8, buckets = new Map<string, SurfaceCandidate[]>();
  for (const c of candidates) {
    const key = `${Math.floor(c.x / cell)}:${Math.floor(c.z / cell)}`;
    const values = buckets.get(key) ?? []; values.push(c); buckets.set(key, values);
  }
  let covered = 0, seed = 93829;
  const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
  const count = 40000;
  for (let i = 0; i < count; i++) {
    const x = bounds.minX + random() * (bounds.maxX - bounds.minX), z = bounds.minZ + random() * (bounds.maxZ - bounds.minZ);
    const bx = Math.floor(x / cell), bz = Math.floor(z / cell);
    let hit = false;
    for (let j = bz - 1; j <= bz + 1 && !hit; j++) for (let k = bx - 1; k <= bx + 1 && !hit; k++) {
      for (const c of buckets.get(`${k}:${j}`) ?? []) if ((x - c.x) ** 2 + (z - c.z) ** 2 <= c.crownRadiusM! ** 2) { hit = true; break; }
    }
    if (hit) covered++;
  }
  return covered / count;
}
describe('physical tree canopy coverage', () => {
  it('matches target mean crown coverage on fixed Monte Carlo probes across sparse and dense forest', () => {
    const bounds = { minX: 256, minZ: 256, maxX: 768, maxZ: 768 };
    for (const target of [0, .1, .3, .6, .9, .97]) {
      const value = world(target), candidates = generateSurfaceCandidates(value, bounds, { families: ['tree'], includeOverhang: true });
      const actual = measuredCover(candidates, bounds);
      expect(actual, `physical crown union target=${target}, actual=${actual}`).toBeCloseTo(target, 1);
      expect(Math.abs(actual - target)).toBeLessThan(.025);
      for (const c of candidates) expect(c.crownRadiusM).toBeCloseTo(TREE_CROWN_RADIUS_RATIO * c.size, 12);
    }
    expect(SURFACE_POPULATION_VERSION).toBe('population-1.2.0');
  });
  it('numerically inverts the actual stratified Boolean law and documents its finite-slot saturation', () => {
    for (const cover of [.01, .1, .5, .9, .99]) expect(expectedTreeCover(treeAcceptanceForCover(cover))).toBeCloseTo(cover, 10);
    expect(expectedTreeCover(1)).toBeGreaterThan(.99);
    expect(expectedTreeCover(1)).toBeLessThan(1);
  });
  it('retains the same objects marks and physical overhang under representation thinning', () => {
    const value = world(.8), bounds = { minX: 256, minZ: 256, maxX: 512, maxZ: 512 };
    const full = generateSurfaceCandidates(value, bounds, { families: ['tree'], includeOverhang: true });
    const thin = generateSurfaceCandidates(value, bounds, { families: ['tree'], includeOverhang: true, retention: .37 });
    expect(thin).toEqual(full.filter(c => c.rank < .37));
    const tree = full.find(c => c.x > 270 && c.x < 490 && c.z > 270 && c.z < 490)!;
    const x = tree.x + tree.crownRadiusM! * .9, z = tree.z;
    const point = { minX: x, maxX: x + .001, minZ: z, maxZ: z + .001 };
    const overhang = generateSurfaceCandidates(value, point, { families: ['tree'], includeOverhang: true });
    expect(overhang.find(c => c.stableId === tree.stableId)).toEqual(tree);
    expect(generateSurfaceCandidates(value, point, { families: ['tree'] }).some(c => c.stableId === tree.stableId)).toBe(false);
  });
});
