import { describe, expect, it } from 'vitest';
import { compileSurfaceWorld, deserializeSurfaceWorld, sampleSurface, serializeSurfaceWorld } from '../src/surface/compiler';
import { DEFAULT_ROCK_UNITS, evaluateMaterialPattern, SURFACE_MATERIALS } from '../src/surface/materials';
import { DepositOrigin, Occupation, WaterClass, type SurfaceCompileInput, type TerrainGrid } from '../src/surface/model';
import { generateSurfaceCandidates } from '../src/surface/population';
import { SurfaceTerrainSession, type TerrainProvider } from '../src/surface/provider';

function grid(w = 33, h = 33, d = 20, height: (x: number, z: number) => number = () => 100): TerrainGrid {
  return { width: w, height: h, spacingM: d, originX: -320, originZ: -320,
    heights: Float32Array.from({ length: w * h }, (_, i) => height(i % w, Math.floor(i / w))),
    source: { id: 'unit-test-dem', version: '1', sourceLOD: 3, nativeSpacingM: d } };
}
function humid(terrain = grid()): SurfaceCompileInput {
  return { seed: 9821, terrain, climate: { version: 'humid', meanAnnualTempC: 14, annualPrecipMm: 1800, elevationCorrected: true } };
}

describe('canonical SurfaceWorld', () => {
  it('preserves authoritative heightfield samples, scale and multi-radius morphology', () => {
    const terrain = grid(33, 33, 30, (x, z) => 50 + x * 3 + z * 6);
    const world = compileSurfaceWorld({ seed: 1, terrain }, { topographicRadiiM: [60, 150, 300] });
    expect(Array.from(world.terrain.heights)).toEqual(Array.from(terrain.heights));
    expect(world.terrain.source.sourceLOD).toBe(3);
    const centre = 16 * 33 + 16;
    expect(world.fields.slope[centre]).toBeCloseTo(Math.atan(Math.hypot(.1, .2)), 6);
    for (const layer of world.fields.topographicPosition) expect(layer[centre]).toBeCloseTo(0, 6);
    expect(world.fields.curvature[centre]).toBeCloseTo(0);
    const before = world.fields.slope[centre];
    sampleSurface(world, 160, 160);
    sampleSurface(world, 160.01, 160.01);
    expect(world.fields.slope[centre]).toBe(before);
  });

  it('keeps explicit rock units distinct under identical climate; aridity does not create sand stock', () => {
    const terrain = grid(), n = terrain.heights.length, bedrock = new Uint16Array(n);
    bedrock.forEach((_, i) => { bedrock[i] = i % terrain.width < 16 ? 1 : 5; });
    const world = compileSurfaceWorld({ ...humid(terrain), geology: { version: 'contact', provenance: 'declared lithological contact', units: [DEFAULT_ROCK_UNITS[0], DEFAULT_ROCK_UNITS[4]], bedrock } });
    expect(world.fields.sand[100]).not.toBe(world.fields.sand[120]);
    expect(world.fields.bedrock[100]).toBe(1);
    expect(world.fields.bedrock[120]).toBe(5);
    const dry = compileSurfaceWorld({ seed: 1, terrain, climate: { version: 'dry', meanAnnualTempC: 27, annualPrecipMm: 60 } });
    expect(Array.from(dry.fields.depositOrigin).includes(DepositOrigin.Aeolian)).toBe(false);
    expect(Array.from(dry.fields.material).includes(2)).toBe(false);
  });

  it('maintains sand+silt+clay=1 independently of organic, including interpolated samples', () => {
    const world = compileSurfaceWorld(humid(grid(25, 25, 30, (x, z) => 200 + Math.sin(x / 4) * 80 - z * 2)));
    let organic = 0;
    for (let i = 0; i < world.terrain.heights.length; i++) {
      const f = world.fields;
      expect(f.sand[i] + f.silt[i] + f.clay[i]).toBeCloseTo(1, 6);
      expect(f.organic[i]).toBeGreaterThanOrEqual(0); organic += f.organic[i];
      expect(f.moisture[i]).toBeGreaterThanOrEqual(0); expect(f.moisture[i]).toBeLessThanOrEqual(1);
    }
    expect(organic).toBeGreaterThan(1);
    const s = sampleSurface(world, -205.25, -137.82);
    expect(s.sand + s.silt + s.clay).toBeCloseTo(1, 6);
  });

  it('routes alluvial provenance from upstream rock and external inflows, preserving the source network', () => {
    const terrain = grid(3, 3, 10, (_x, z) => 102 - z);
    const downstream = Int32Array.from([4, 4, 4, 4, 7, 4, 7, -1, 7]);
    const bedrock = new Uint16Array(9).fill(1); bedrock[7] = 5;
    const waterClass = new Uint8Array(9); waterClass[7] = WaterClass.River;
    const world = compileSurfaceWorld({ ...humid(terrain), geology: { version: 'g', provenance: 'fixture contact', units: [DEFAULT_ROCK_UNITS[0], DEFAULT_ROCK_UNITS[4]], bedrock },
      hydrology: { version: 'directed', provenance: 'source-network', downstream, waterClass, boundary: 'external-inflows',
        inflows: [{ cell: 0, contributingAreaM2: 10000, provenance: [{ unitId: 1, fraction: 1 }] }] } });
    expect(Array.from(world.fields.downstream)).toEqual(Array.from(downstream));
    expect(world.fields.contributingAreaM2[7]).toBe(10900);
    expect(world.fields.depositOrigin[7]).toBe(DepositOrigin.Alluvial);
    expect(world.fields.sourceRock[7]).toBe(1);
    expect(world.fields.bedrock[7]).toBe(5);
    expect(world.fields.provenance[0][7]).toBeCloseTo(10800 / 10900, 5);
    expect(world.fields.handM[0]).toBeCloseTo(2);
    expect(world.fields.handM[7]).toBe(0);
  });

  it('connects talus to an upslope basalt source instead of local granite at the foot', () => {
    const heights = [100, 90, 70, 40, 20, 19, 18];
    const terrain = grid(5, 7, 10, (_x, z) => heights[z]), bedrock = new Uint16Array(35).fill(5);
    bedrock.fill(1, 25);
    const world = compileSurfaceWorld({ ...humid(terrain), geology: { version: 'scarp', provenance: 'declared basalt cap', units: [DEFAULT_ROCK_UNITS[0], DEFAULT_ROCK_UNITS[4]], bedrock },
      hydrology: { version: 'dry', provenance: 'dry scarp', waterClass: new Uint8Array(35) } });
    const foot = 5 * 5 + 2;
    expect(world.fields.depositOrigin[foot]).toBe(DepositOrigin.Colluvial);
    expect(world.fields.bedrock[foot]).toBe(1);
    expect(world.fields.sourceRock[foot]).toBe(5);
    expect(world.fields.provenance[1][foot]).toBe(1);
  });

  it('retains closed sinks, rejects cyclic routing and reports truncated basin limits', () => {
    const terrain = grid(5, 5, 10, (x, z) => (x - 2) ** 2 + (z - 2) ** 2);
    const world = compileSurfaceWorld(humid(terrain));
    expect(world.fields.downstream[12]).toBe(-1);
    expect(world.fields.closedBasin[12]).toBe(1);
    expect(world.diagnostics.warnings.some(w => w.includes('truncated'))).toBe(true);
    const downstream = new Int32Array(25).fill(-1); downstream[1] = 2; downstream[2] = 1;
    expect(() => compileSurfaceWorld({ seed: 0, terrain, hydrology: { version: 'bad', provenance: 'invalid', downstream } })).toThrow(/cycle/);
  });

  it('keeps canonical population identical across tile seams, order, seasons and nested LOD', () => {
    const input = humid(), world = compileSurfaceWorld(input), b = world.bounds;
    const opts = { families: ['tree', 'boulder'] as Array<'tree' | 'boulder'> };
    const whole = generateSurfaceCandidates(world, b, opts);
    expect(whole.length).toBeGreaterThan(100);
    const right = generateSurfaceCandidates(world, { ...b, minX: 0 }, opts);
    const left = generateSurfaceCandidates(world, { ...b, maxX: 0 }, opts);
    expect([...right, ...left].sort((a, b) => a.stableId.localeCompare(b.stableId))).toEqual([...whole].sort((a, b) => a.stableId.localeCompare(b.stableId)));
    const coarse = generateSurfaceCandidates(world, b, { ...opts, retention: .25 });
    expect(coarse).toEqual(whole.filter(c => c.rank < .25));
    const winter = compileSurfaceWorld({ ...input, state: { version: 'winter', dayOfYear: 10, snowWaterEquivalentM: .3 } });
    expect(winter.versions.population).toBe(world.versions.population);
    expect(winter.versions.surfaceState).not.toBe(world.versions.surfaceState);
    expect(generateSurfaceCandidates(winter, b, opts)).toEqual(whole);
  });

  it('excludes supports in water, roads and foundations, and preserves field direction', () => {
    const input = humid(), n = input.terrain.heights.length;
    const classes = new Uint8Array(n).fill(Occupation.Road), orientationRadians = new Float32Array(n).fill(.7);
    const road = compileSurfaceWorld({ ...input, occupation: { version: 'road', classes, orientationRadians } });
    expect(generateSurfaceCandidates(road, road.bounds)).toHaveLength(0);
    expect(road.fields.material[100]).toBe(15);
    expect(road.fields.orientation[100]).toBeCloseTo(.7);
    classes.fill(Occupation.Built);
    const built = compileSurfaceWorld({ ...input, occupation: { version: 'built', classes } });
    expect(generateSurfaceCandidates(built, built.bounds)).toHaveLength(0);
    const wet = compileSurfaceWorld({ ...input, hydrology: { version: 'lake', provenance: 'source lake', waterClass: new Uint8Array(n).fill(WaterClass.Lake), waterLevelM: new Float32Array(n).fill(101) } });
    expect(generateSurfaceCandidates(wet, wet.bounds)).toHaveLength(0);
    expect(wet.fields.waterLevelM[100]).toBe(101);
  });

  it('invalidates actual content edits even when source labels are unchanged', () => {
    const input = humid(), a = compileSurfaceWorld(input);
    const b = compileSurfaceWorld({ ...input, terrain: { ...input.terrain, heights: new Float32Array(input.terrain.heights) } });
    expect(b.id).toBe(a.id);
    input.terrain.heights[110] += 1;
    expect(a.terrain.heights[110]).toBe(100);
    const c = compileSurfaceWorld(input);
    expect(c.versions.terrain).not.toBe(a.versions.terrain);
    expect(c.versions.environment).not.toBe(a.versions.environment);
    expect(c.versions.population).not.toBe(a.versions.population);
  });

  it('round-trips neutral JSON arrays, sourceLOD, dry sentinels and categorical identity', () => {
    const world = compileSurfaceWorld(humid()), encoded = serializeSurfaceWorld(world), raw = JSON.parse(encoded);
    expect(Array.isArray(raw.terrain.heights)).toBe(true);
    expect(raw.fields.waterLevelM[0]).toBe(null);
    const restored = deserializeSurfaceWorld(encoded);
    expect(restored.terrain.heights).toBeInstanceOf(Float32Array);
    expect(restored.fields.downstream).toBeInstanceOf(Int32Array);
    expect(restored.terrain.source.sourceLOD).toBe(3);
    expect(sampleSurface(restored, -42.5, 17.25)).toEqual(sampleSurface(world, -42.5, 17.25));
    expect(serializeSurfaceWorld(restored)).toBe(encoded);
    const edited=JSON.parse(encoded);edited.geometryDetail.surfaceConditioning.bedrockExposure[0]=.8;
    expect(()=>deserializeSurfaceWorld(JSON.stringify(edited))).toThrow(/conditioning differs/);
    raw.schemaVersion = 999;
    expect(() => deserializeSurfaceWorld(JSON.stringify(raw))).toThrow(/schema/);
  });

  it('provides all 15 families and evaluates distinct physical pattern policies', () => {
    expect(new Set(SURFACE_MATERIALS.map(m => m.family)).size).toBe(15);
    const s = sampleSurface(compileSurfaceWorld(humid()), 0, 0);
    const results = SURFACE_MATERIALS.map(material => evaluateMaterialPattern({ ...s, material }, 12.3, -5.6));
    expect(new Set(results.map(r => r.heightM)).size).toBeGreaterThan(12);
    for (const r of results) expect(r.colorLinear.every(c => Number.isFinite(c) && c >= 0)).toBe(true);
  });

  it('honours physical imported climate without applying elevation correction twice', () => {
    const terrain = grid(5, 5, 20, () => 2000);
    const world = compileSurfaceWorld({ seed: 1, terrain, climate: { version: 'import', meanAnnualTempC: 8, annualPrecipMm: 800,
      elevationCorrected: true, temperatureC: new Float32Array(25).fill(4), precipitationMm: new Float32Array(25).fill(1100) } });
    expect(world.fields.temperatureC[0]).toBe(4);
    expect(world.fields.precipitationMm[0]).toBe(1100);
  });
});

describe('versioned terrain requests', () => {
  it('rejects cancelled compilation before doing work', () => {
    const controller = new AbortController(); controller.abort();
    expect(() => compileSurfaceWorld(humid(), { signal: controller.signal })).toThrow(/aborted/);
  });
  it('ignores stale async refinements even when the source ignores cancellation', async () => {
    const pending: Array<(terrain: TerrainGrid) => void> = [];
    const provider: TerrainProvider = { id: 'test-ig', request: () => new Promise(resolve => pending.push(resolve)) };
    const session = new SurfaceTerrainSession(provider, 'world-1');
    const bounds = { minX: -100, minZ: -100, maxX: 100, maxZ: 100 };
    const first = session.request({ bounds, spacingM: 30 }).catch(error => error as Error);
    session.invalidate('world-2');
    const second = session.request({ bounds, spacingM: 10 });
    const refined = grid(5, 5, 10); refined.source.sourceLOD = 8;
    pending[1](refined);
    expect((await second).terrain.source.sourceLOD).toBe(8);
    pending[0](grid());
    expect(await first).toMatchObject({ name: 'AbortError' });
  });
});
