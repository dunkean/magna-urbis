import { describe, expect, it } from 'vitest';
import { compileSurfaceWorld, deserializeSurfaceWorld, getCanonicalSurfaceContext, retargetSurfaceWorld, sampleSurface, serializeSurfaceWorld } from '../src/surface/compiler';
import { DEFAULT_ROCK_UNITS } from '../src/surface/materials';
import { WaterClass, type TerrainGrid } from '../src/surface/model';
import { generateSurfaceCandidates } from '../src/surface/population';

function terrain(originX: number, originZ: number, width: number, height: number, spacingM: number, detail = false): TerrainGrid {
  return { originX, originZ, width, height, spacingM,
    heights: Float32Array.from({ length: width * height }, (_, i) => {
      const x = originX + i % width * spacingM, z = originZ + Math.floor(i / width) * spacingM;
      return 100 + x * .04 + z * .015 + (detail ? Math.sin(x * .5) * Math.cos(z * .3) * .5 : 0);
    }), source: { id: 'canonical-ig:129', version: 'generation-1', sourceLOD: detail ? 8 : 3, sourceLODKnown: true, nativeSpacingM: spacingM } };
}
function base() {
  const t = terrain(-320, -320, 33, 33, 20), n = t.width * t.height;
  const bedrock = Uint16Array.from({ length: n }, (_, i) => i % 33 < 16 ? 1 : 5);
  const waterClass = new Uint8Array(n), waterLevelM = new Float32Array(n).fill(NaN);
  for (let z = 0; z < 33; z++) { waterClass[z * 33 + 18] = WaterClass.River; waterLevelM[z * 33 + 18] = t.heights[z * 33 + 18] + .2; }
  return compileSurfaceWorld({ seed: 129, terrain: t,
    geology: { version: 'contact', provenance: 'explicit two-rock map', units: [DEFAULT_ROCK_UNITS[0], DEFAULT_ROCK_UNITS[4]], bedrock },
    hydrology: { version: 'water', provenance: 'source water network', waterClass, waterLevelM },
    climate: { version: 'humid', meanAnnualTempC: 12, annualPrecipMm: 1600, elevationCorrected: true } });
}
function canonicalSample(sample: ReturnType<typeof sampleSurface>) { const { heightM: _, localGeometry: _detail, ...rest } = sample; return rest; }

describe('geometry-only surface retargeting', () => {
  it('preserves exact context at arbitrary fixed coordinates across zoom, shifted patches and repeated refinements', () => {
    const canonical = base(), snapshot = serializeSurfaceWorld(canonical);
    const wide = retargetSurfaceWorld(canonical, terrain(-140, -140, 57, 57, 5, true));
    const narrow = retargetSurfaceWorld(wide, terrain(-93, -97, 81, 81, 2, true));
    expect(wide.versions.environment).toBe(canonical.versions.environment);
    expect(wide.versions.hydrology).toBe(canonical.versions.hydrology);
    expect(wide.versions.population).toBe(canonical.versions.population);
    expect(wide.versions.terrain).not.toBe(canonical.versions.terrain);
    expect(wide.id).not.toBe(canonical.id);
    expect(narrow.versions.environment).toBe(canonical.versions.environment);
    expect(narrow.canonicalContext?.id).toBe(wide.canonicalContext?.id);
    expect(narrow.terrain.source.sourceLOD).toBe(8);
    expect(narrow.terrain.source.nativeSpacingM).toBe(2);
    for (const [x, z] of [[-42.3, -11.7], [-9.999, 7.89], [.002, -12.5], [39.9, 24.333], [50.01, 0]]) {
      const expected = canonicalSample(sampleSurface(canonical, x, z));
      expect(canonicalSample(sampleSurface(wide, x, z))).toEqual(expected);
      expect(canonicalSample(sampleSurface(narrow, x, z))).toEqual(expected);
    }
    expect(serializeSurfaceWorld(canonical)).toBe(snapshot);
    expect(sampleSurface(wide, -42.3, -11.7).heightM).not.toBe(sampleSurface(canonical, -42.3, -11.7).heightM);
    expect(sampleSurface(wide,-42.3,-11.7).localGeometry?.normalXYZ).not.toEqual(sampleSurface(canonical,-42.3,-11.7).localGeometry?.normalXYZ);
    expect(wide.geometryDetail?.supportDescriptor.source).toEqual(wide.terrain.source);
  });

  it('keeps candidate identity, acceptance, rank and dimensions exact while source support refines', () => {
    const canonical = base(), fine = retargetSurfaceWorld(canonical, terrain(-240, -240, 97, 97, 5, true));
    const bounds = { minX: -220, minZ: -210, maxX: 200, maxZ: 200 };
    const options = { families: ['tree', 'boulder'] as Array<'tree' | 'boulder'>, retention: .7 };
    const original = generateSurfaceCandidates(canonical, bounds, options), refined = generateSurfaceCandidates(fine, bounds, options);
    expect(original.length).toBeGreaterThan(20);
    expect(refined.map(({ y: _, ...candidate }) => candidate)).toEqual(original.map(({ y: _, ...candidate }) => candidate));
    expect(refined.some((c, i) => c.y !== original[i].y)).toBe(true);
    for (const candidate of refined) expect(candidate.y).toBe(sampleSurface(fine, candidate.x, candidate.z).heightM);
    const again = retargetSurfaceWorld(fine, terrain(-240, -240, 121, 121, 4, true));
    expect(generateSurfaceCandidates(again, bounds, options).map(({ y: _, ...c }) => c)).toEqual(refined.map(({ y: _, ...c }) => c));
  });

  it('projects mineral fractions, categories and water levels semantically without inventing hydrology', () => {
    const canonical = base(), fine = retargetSurfaceWorld(canonical, terrain(-100, -100, 51, 51, 4, true));
    for (let i = 0; i < fine.terrain.heights.length; i++) {
      const x = fine.terrain.originX + i % fine.terrain.width * 4, z = fine.terrain.originZ + Math.floor(i / fine.terrain.width) * 4;
      const expected = sampleSurface(canonical, x, z), f = fine.fields;
      expect(f.sand[i] + f.silt[i] + f.clay[i]).toBeCloseTo(1, 6);
      expect(f.provenance.reduce((sum, a) => sum + a[i], 0)).toBeCloseTo(1, 6);
      expect(f.material[i]).toBe(canonical.materials.findIndex(m => m.id === expected.material.id));
      expect(f.bedrock[i]).toBe(expected.bedrock.id);
      expect(f.waterClass[i]).toBe(expected.waterClass);
      expect(f.waterLevelM[i]).toBe(expected.waterLevelM);
      expect(f.treeCover[i]).toBeCloseTo(expected.treeCover, 6);
      expect(f.slope[i]).toBeCloseTo(expected.slope, 6);
    }
  });

  it('distinguishes centre bounds, source footprint and explicit source padding', () => {
    const canonical = compileSurfaceWorld({ seed: 1, terrain: terrain(10, 10, 3, 3, 20) });
    const fine = terrain(-2.5, -2.5, 14, 14, 5, true);
    expect(() => retargetSurfaceWorld(canonical, fine)).toThrow(/canonical source footprint/);
    const padded = retargetSurfaceWorld(canonical, fine, { bounds: { minX: 0, minZ: 0, maxX: 60, maxZ: 60 } });
    expect(padded.terrain.originX).toBe(-2.5);
    expect(padded.terrain.heights).toEqual(fine.heights);
    expect(sampleSurface(padded, 0, 0).sand).toBeCloseTo(canonical.fields.sand[0]);
    expect(sampleSurface(padded, 60, 60).bedrock.id).toBe(canonical.fields.bedrock[8]);
    expect(padded.diagnostics.warnings.some(w => w.includes('padding'))).toBe(true);
    expect(() => sampleSurface(padded, -1, 0)).toThrow(/outside/);
    expect(() => retargetSurfaceWorld(canonical, fine, { bounds: { minX: 0, minZ: 0, maxX: 60.001, maxZ: 60 } })).toThrow(/footprint/);
  });

  it('rejects other generation identities, stale context versions, invalid arrays, and cancellation', () => {
    const canonical = base(), fine = terrain(-100, -100, 41, 41, 5, true), controller = new AbortController();
    const options = { expectedEnvironmentVersion: canonical.versions.environment, expectedTerrainVersion: canonical.versions.terrain };
    expect(() => retargetSurfaceWorld(canonical, fine, options)).not.toThrow();
    expect(() => retargetSurfaceWorld(canonical, { ...fine, source: { ...fine.source, id: 'another' } })).toThrow(/identity\/version/);
    expect(() => retargetSurfaceWorld(canonical, { ...fine, source: { ...fine.source, version: 'generation-2' } })).toThrow(/identity\/version/);
    expect(() => retargetSurfaceWorld(canonical, fine, { expectedEnvironmentVersion: 'stale' })).toThrow(/Stale/);
    expect(() => retargetSurfaceWorld(canonical, fine, { expectedTerrainVersion: 'stale' })).toThrow(/Stale/);
    expect(() => retargetSurfaceWorld(canonical, { ...fine, heights: new Float32Array(3) })).toThrow(/length/);
    controller.abort();
    expect(() => retargetSurfaceWorld(canonical, fine, { signal: controller.signal })).toThrow(/aborted/);
  });

  it('round-trips exact offline context; slim runtime projections require an explicit matching resolver', () => {
    const canonical = base(), refined = retargetSurfaceWorld(canonical, terrain(-100, -100, 41, 41, 5, true));
    const expected = sampleSurface(refined, -14.25, 22.5);
    const offline = deserializeSurfaceWorld(serializeSurfaceWorld(refined));
    expect(sampleSurface(offline, -14.25, 22.5)).toEqual(expected);
    const slim = serializeSurfaceWorld(refined, { includeCanonicalContext: false });
    expect(JSON.parse(slim).canonicalContext).toBeUndefined();
    expect(JSON.parse(slim).canonicalContextRef.id).toBe(refined.canonicalContextRef?.id);
    const unresolved = deserializeSurfaceWorld(slim);
    expect(unresolved.fields.treeCover).toBeInstanceOf(Float32Array);
    expect(() => sampleSurface(unresolved, 0, 0)).toThrow(/context unavailable/);
    expect(() => generateSurfaceCandidates(unresolved, { minX: -50, minZ: -50, maxX: 50, maxZ: 50 })).toThrow(/context unavailable/);
    const restored = deserializeSurfaceWorld(slim, { resolveCanonicalContext: () => getCanonicalSurfaceContext(canonical) });
    expect(sampleSurface(restored, -14.25, 22.5)).toEqual(expected);
    const other = { ...getCanonicalSurfaceContext(canonical), id: 'wrong' };
    expect(() => deserializeSurfaceWorld(slim, { resolveCanonicalContext: () => other })).toThrow(/identity\/version/);
  });
});
