import { describe, expect, it } from 'vitest';
import { compileSurfaceWorld, deserializeSurfaceWorld, estimateSurfaceCompileBytes, hydrateSurfaceWorld, sampleSurface, serializeSurfaceWorld } from '../src/surface/compiler';
import { DEFAULT_ROCK_UNITS, SURFACE_MATERIALS } from '../src/surface/materials';
import { DepositOrigin, Landform, WaterClass, type TerrainGrid } from '../src/surface/model';
import { generateSurfaceCandidates } from '../src/surface/population';
import { SurfaceTerrainSession } from '../src/surface/provider';

function grid(w = 17, h = 17, spacingM = 20, originX = 0, originZ = 0): TerrainGrid {
  return { width: w, height: h, originX, originZ, spacingM,
    heights: Float32Array.from({ length: w * h }, (_, i) => 200 + (originX + i % w * spacingM) * .1 - (originZ + Math.floor(i / w) * spacingM) * .05),
    source: { id: 'review', version: '1', sourceLOD: -3, nativeSpacingM: spacingM } };
}

describe('phase2 environmental invariants', () => {
  it('takes granite floodplain deposits from basalt headwaters and preserves the steep-channel transported mixture', () => {
    const t = grid(5, 5, 10), altitudes = [40, 28, 5, 4, 3];
    for (let i = 0; i < 25; i++) t.heights[i] = altitudes[Math.floor(i / 5)] + Math.abs(i % 5 - 2) * .5;
    const bedrock = new Uint16Array(25).fill(1); bedrock.fill(5, 0, 10); bedrock[7] = 1;
    const downstream = new Int32Array(25).fill(-1), waterClass = new Uint8Array(25), waterLevelM = new Float32Array(25).fill(NaN);
    for (let z = 0; z < 5; z++) for (let x = 0; x < 5; x++) {
      const i = z * 5 + x;
      downstream[i] = x === 2 ? z < 4 ? (z + 1) * 5 + 2 : -1 : z * 5 + 2;
      if (x === 2) { waterClass[i] = WaterClass.River; waterLevelM[i] = t.heights[i] + .2; }
    }
    const w = compileSurfaceWorld({ seed: 1, terrain: t, geology: { version: 'contact', provenance: 'basalt headwater over granite', units: [DEFAULT_ROCK_UNITS[0], DEFAULT_ROCK_UNITS[4]], bedrock },
      hydrology: { version: 'source', provenance: 'fixture directed network', downstream, waterClass, waterLevelM,
        inflows: [{ cell: 2, contributingAreaM2: 100000, provenance: [{ unitId: 5, fraction: 1 }] }] } });
    const floodplain = 16;
    expect(w.fields.waterClass[floodplain]).toBe(WaterClass.Dry);
    expect(w.fields.drainageCell[floodplain]).toBe(17);
    expect(w.fields.depositOrigin[floodplain]).toBe(DepositOrigin.Alluvial);
    expect(w.fields.bedrock[floodplain]).toBe(1); expect(w.fields.sourceRock[floodplain]).toBe(5);
    expect(w.fields.provenance[1][floodplain]).toBeGreaterThan(.9);
    expect(w.fields.transportedProvenance[1][7]).toBeGreaterThan(.9);
    expect(w.fields.provenance[0][7]).toBe(1);
    expect(w.fields.handM[floodplain]).toBeCloseTo(.3, 5);
  });

  it('invalidates derived hydrology on height edits and resolves recipes by id under catalogue permutation', () => {
    const t = grid(), a = compileSurfaceWorld({ seed: 1, terrain: t });
    t.heights[100] += 1;
    const b = compileSurfaceWorld({ seed: 1, terrain: t });
    expect(b.versions.hydrology).not.toBe(a.versions.hydrology);
    const library = [...SURFACE_MATERIALS].reverse(), c = compileSurfaceWorld({ seed: 1, terrain: t }, { materialLibrary: library });
    expect(c.versions.environment).not.toBe(b.versions.environment);
    for (let i = 0; i < t.heights.length; i++) {
      expect(c.materials[c.fields.material[i]].id).toBe(b.materials[b.fields.material[i]].id);
      expect(c.materials[c.fields.materialSecondary[i]].id).toBe(b.materials[b.fields.materialSecondary[i]].id);
    }
  });

  it('never interpolates unknown HAND as a negative height', () => {
    const w = compileSurfaceWorld({ seed: 1, terrain: grid(3, 3) });
    w.fields.handM[0] = NaN; w.fields.handM[1] = .5; w.fields.handM[3] = NaN; w.fields.handM[4] = .5;
    const a = sampleSurface(w, 5, 5).handM, b = sampleSurface(w, 15, 5).handM;
    expect(Number.isNaN(a)).toBe(true); expect(b).toBe(.5);
    const copy = deserializeSurfaceWorld(serializeSurfaceWorld(w));
    expect(Number.isNaN(copy.fields.handM[0])).toBe(true);
  });

  it('flags source edges and keeps tilted-plane TPI and curvature neutral everywhere', () => {
    const w = compileSurfaceWorld({ seed: 1, terrain: grid(17, 17, 30) }, { topographicRadiiM: [60, 120] });
    for (const layer of w.fields.topographicPosition) for (const value of layer) expect(Math.abs(value)).toBeLessThan(.00002);
    for (const value of w.fields.curvature) expect(Math.abs(value)).toBeLessThan(.0000001);
    expect(w.fields.edgeConfidence[0]).toBe(0); expect(w.fields.edgeConfidence[8 * 17 + 8]).toBe(1);
    expect(Array.from(w.fields.landform).every(v => v === Landform.Slope || v === Landform.Flat)).toBe(true);
  });

  it('uses physical river/floodplain thresholds consistently across exported windows', () => {
    const compile = (t: TerrainGrid) => {
      t.heights = Float32Array.from({ length: t.width * t.height }, (_, i) => 200 - (t.originZ + Math.floor(i / t.width) * 20) * .05);
      return compileSurfaceWorld({ seed: 1, terrain: t,
        hydrology: { version: 'source-area', provenance: 'known exterior catchment areas', contributingAreaM2: Float32Array.from({ length: t.width * t.height }, (_, i) => 200000 + (t.originZ / 20 + Math.floor(i / t.width)) * 100000) } });
    };
    const full = compile(grid(33, 33, 20)), sub = compile(grid(9, 9, 20, 80, 80));
    // These cells reach the same downstream water inside both windows; upstream truncated basins are excluded.
    for (let z = 3; z < 8; z++) for (let x = 1; x < 8; x++) {
      const i = z * 9 + x, j = (z + 4) * 33 + x + 4;
      expect(sub.fields.waterClass[i]).toBe(full.fields.waterClass[j]);
      expect(sub.fields.depositOrigin[i]).toBe(full.fields.depositOrigin[j]);
    }
  });

  it('rejects invalid category/rock/cycle/height/version/climate packets before consumers see them', () => {
    const w = compileSurfaceWorld({ seed: 1, terrain: grid() });
    const check = (mutate: (v: any) => void, error: RegExp) => { const raw = JSON.parse(serializeSurfaceWorld(w)); mutate(raw); expect(() => deserializeSurfaceWorld(JSON.stringify(raw))).toThrow(error); };
    check(v => { v.fields.waterClass[0] = 300; }, /waterClass/);
    check(v => { v.fields.sourceRock[0] = 999; }, /sourceRock/);
    check(v => { v.fields.downstream[0] = 1; v.fields.downstream[1] = 0; }, /cycle/);
    check(v => { v.terrain.heights[0] += 1; }, /Terrain version mismatch/);
    check(v => { v.id = 'tampered'; }, /id\/version mismatch/);
    check(v => { v.climate.temperatureC = [1]; }, /climate/);
    check(v => { v.geology.bedrock = [1]; }, /geology/);
  });

  it('checks memory and population work budgets before allocating output or enumerating empty support', () => {
    const t = grid();
    expect(estimateSurfaceCompileBytes(t, 1, 3)).toBeGreaterThan(1000);
    expect(() => compileSurfaceWorld({ seed: 1, terrain: t }, { memoryBudgetBytes: 1 })).toThrow(/memoryBudgetBytes/);
    const sparse = compileSurfaceWorld({ seed: 1, terrain: grid(17, 17, 5000), climate: { version: 'dry', meanAnnualTempC: 30, annualPrecipMm: 1 } });
    expect(() => generateSurfaceCandidates(sparse, sparse.bounds, { maxCheckedSlots: 10000 })).toThrow(/maxCheckedSlots/);
  });

  it('validates wet levels and declares a missing-level fallback', () => {
    const t = grid(3, 3), waterClass = new Uint8Array(9).fill(WaterClass.Lake);
    for (const bad of [NaN, Infinity, -Infinity, 1]) expect(() => compileSurfaceWorld({ seed: 1, terrain: t, hydrology: { version: 'bad', provenance: 'test', waterClass, waterLevelM: new Float32Array(9).fill(bad) } })).toThrow(/level/);
    const w = compileSurfaceWorld({ seed: 1, terrain: t, hydrology: { version: 'missing-level', provenance: 'test', waterClass } });
    expect(w.diagnostics.warnings.some(v => v.includes('fall back'))).toBe(true);
  });

  it('hydrates typed binary-decoded objects directly and guards oversized JSON before stringify', () => {
    const w = compileSurfaceWorld({ seed: 1, terrain: grid() });
    const typed = structuredClone(w), restored = hydrateSurfaceWorld(typed);
    expect(new Uint8Array(restored.fields.sand.buffer)).toEqual(new Uint8Array(w.fields.sand.buffer));
    expect(new Uint8Array(restored.fields.handM.buffer)).toEqual(new Uint8Array(w.fields.handM.buffer));
    expect(() => serializeSurfaceWorld(w, { maxJsonCharacters: 100 })).toThrow(/binary/);
  });

  it('keeps optional undefined metadata fingerprints stable across JSON and binary manifests', () => {
    const t = grid(); t.source.provenance = undefined;
    const w = compileSurfaceWorld({ seed: 1, terrain: t });
    expect(deserializeSurfaceWorld(serializeSurfaceWorld(w)).versions.terrain).toBe(w.versions.terrain);
    const withoutOptional = { ...t, source: { id: t.source.id, version: t.source.version, sourceLOD: t.source.sourceLOD, nativeSpacingM: t.source.nativeSpacingM } };
    expect(compileSurfaceWorld({ seed: 1, terrain: withoutOptional }).versions.terrain).toBe(w.versions.terrain);
  });

  it('suppresses stale source failures after the request has been superseded', async () => {
    const rejectors: Array<(error: Error) => void> = [];
    const session = new SurfaceTerrainSession({ id: 'late-error', request: () => new Promise((_resolve, reject) => rejectors.push(reject)) }, 'world-1');
    const promise = session.request({ spacingM: 10, bounds: { minX: 0, minZ: 0, maxX: 10, maxZ: 10 } }).catch(error => error);
    session.invalidate('world-2'); rejectors[0](new Error('old server failed'));
    expect(await promise).toMatchObject({ name: 'AbortError' });
  });
});
