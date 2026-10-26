import { describe, expect, it } from 'vitest';
import { compileRegionalSurfaceWorld, type RegionalSurfaceMapping } from '../src/surface/adapters/regionalCompiler';
import type { NeuralEarthPackage, RegionalLayer } from '../src/surface/adapters/neuralEarth';
import { DEFAULT_ROCK_UNITS } from '../src/surface/materials';
import { decodeSurfaceBinary, encodeSurfaceBinary } from '../src/surface/binary';
import type { TerrainGrid } from '../src/surface/model';

function fixture() {
  const layer = (id: string, units: string, values: RegionalLayer['values'], corrected = true): RegionalLayer => ({ id, sourceKey: `fixture:${id}`, units,
    originX: 50, originZ: 50, spacingM: 100, width: 4, height: 4, values, sourceLOD: -8, nativeSpacingM: 100,
    provenance: 'Explicit test fixture, not a real regional observation', season: { dayOfYear: 172, elevationCorrected: corrected } });
  const packet: NeuralEarthPackage = { format: 'surface-regional-exchange', version: 1, id: 'unit-regional', seed: 'regional-seed', features: {},
    georeference: { crs: 'unit-local-metres', origin: { longitudeDeg: 4, latitudeDeg: 45, altitudeM: 0 }, verticalDatum: 'test-zero', zAzimuthDeg: 180 },
    layers: { height: layer('height', 'm', new Float32Array(16).fill(100)), geology: layer('geology', 'lithology-code', Uint8Array.from({ length: 16 }, (_, i) => i % 4 < 2 ? 7 : 9)),
      summer: layer('summer', 'K', new Float32Array(16).fill(293.15)), winter: layer('winter', 'K', new Float32Array(16).fill(273.15)),
      summerRain: layer('summerRain', 'mm/half-year', new Float32Array(16).fill(800)), winterRain: layer('winterRain', 'm/half-year', new Float32Array(16).fill(.4)) } };
  const mapping: RegionalSurfaceMapping = { format: 'surface-regional-mapping', version: 1, height: 'height',
    geology: { layer: 'geology', catalogue: { id: 'explicit-unit-catalogue', version: '1', provenance: 'Mapped geological units for test purposes',
      units: [DEFAULT_ROCK_UNITS[0], DEFAULT_ROCK_UNITS[4]], codeToUnit: { 7: 1, 9: 5 } } },
    climate: { summerTemperature: 'summer', winterTemperature: 'winter', summerPrecipitation: 'summerRain', winterPrecipitation: 'winterRain', elevationPolicy: 'preserve-source' } };
  return { packet, mapping };
}
describe('explicit physical regional compilation', () => {
  it('converts seasonal Kelvin and half-year rainfall once while retaining independent geology', () => {
    const { packet, mapping } = fixture();
    const world = compileRegionalSurfaceWorld(decodeSurfaceBinary(encodeSurfaceBinary(packet)), mapping);
    expect(world.climate.meanAnnualTempC).toBeCloseTo(10, 4);
    expect(world.climate.annualPrecipMm).toBeCloseTo(1200, 4);
    expect(world.fields.temperatureC[5]).toBeCloseTo(10, 4);
    expect(world.fields.bedrock[4]).toBe(1); expect(world.fields.bedrock[7]).toBe(5);
    expect(world.fields.sand[4]).not.toBe(world.fields.sand[7]);
    expect(world.regionalSource.layers.find(v => v.key === 'summer')?.units).toBe('K');
    expect(world.regionalSource.limitations.some(v => v.includes('D8'))).toBe(true);
  });
  it('preserves primary generator height bytes/identity and corrects imported elevation exactly once', () => {
    const { packet, mapping } = fixture();
    const terrain: TerrainGrid = { width: 4, height: 4, originX: 50, originZ: 50, spacingM: 100, heights: new Float32Array(16).fill(1100),
      source: { id: 'real-primary-generator', version: 'v2', sourceLOD: -6, nativeSpacingM: 80 } };
    mapping.climate.elevationPolicy = 'correct-to-target'; mapping.climate.referenceElevation = 'height';
    const world = compileRegionalSurfaceWorld(packet, mapping, { terrain });
    expect(world.terrain.heights).toEqual(terrain.heights); expect(world.terrain.source).toEqual(terrain.source);
    expect(world.fields.temperatureC[5]).toBeCloseTo(3.5, 4);
    expect(packet.layers.summer.values[0]).toBeCloseTo(293.15, 4);
  });
  it('rejects missing or unmapped geology, incompatible frames, insufficient coverage and budgets', () => {
    const { packet, mapping } = fixture();
    expect(() => compileRegionalSurfaceWorld(packet, { ...mapping, geology: undefined } as any)).toThrow(/geology/);
    packet.layers.geology.values[0] = 2; expect(() => compileRegionalSurfaceWorld(packet, mapping)).toThrow(/code 2/);
    packet.layers.geology.values[0] = 7; packet.layers.geology.originX += 1000;
    expect(() => compileRegionalSurfaceWorld(packet, mapping)).toThrow(/does not cover/);
    packet.layers.geology.originX -= 1000; packet.georeference.zAzimuthDeg = 0;
    expect(() => compileRegionalSurfaceWorld(packet, mapping)).toThrow(/reprojection/);
    packet.georeference.zAzimuthDeg = 180;
    expect(() => compileRegionalSurfaceWorld(packet, mapping, { memoryBudgetBytes: 1 })).toThrow(/before context allocation/);
  });
  it('rejects implicit climate corrections, resampled drainage indices and externally misregistered geology', () => {
    const { packet, mapping } = fixture();
    mapping.climate.elevationPolicy = 'compiler-lapse';
    expect(() => compileRegionalSurfaceWorld(packet, mapping)).toThrow(/contradicts/);
    mapping.climate.elevationPolicy = 'preserve-source';
    const geology = structuredClone(packet); geology.georeference.origin.latitudeDeg++;
    expect(() => compileRegionalSurfaceWorld(packet, mapping, { geologyPackage: geology })).toThrow(/georeferences differ/);
    packet.layers.routing = { ...packet.layers.height, id: 'routing', units: 'cell-index', values: new Int32Array(16).fill(-1), originX: 0 };
    mapping.hydrology = { downstream: 'routing' };
    expect(() => compileRegionalSurfaceWorld(packet, mapping)).toThrow(/graph indices cannot be resampled/);
  });
  it('invalidates climate identity for changed values and respects pre-start cancellation', () => {
    const { packet, mapping } = fixture(), first = compileRegionalSurfaceWorld(packet, mapping);
    packet.layers.summer.values[0] += 1;
    const second = compileRegionalSurfaceWorld(packet, mapping); expect(first.versions.environment).not.toBe(second.versions.environment);
    const controller = new AbortController(); controller.abort();
    expect(() => compileRegionalSurfaceWorld(packet, mapping, { signal: controller.signal })).toThrow(/abort/i);
  });
  it('retains source water levels adjacent to NaN dry cells without inventing shoreline levels', () => {
    const { packet, mapping } = fixture();
    packet.layers.water = { ...packet.layers.height, id: 'water', units: 'category-id', values: new Uint8Array(16) };
    packet.layers.level = { ...packet.layers.height, id: 'level', units: 'm', values: new Float32Array(16).fill(NaN) };
    packet.layers.water.values[5] = 3; packet.layers.level.values[5] = 110;
    mapping.hydrology = { waterClass: 'water', waterLevel: 'level' };
    const world = compileRegionalSurfaceWorld(packet, mapping);
    expect(world.fields.waterClass[5]).toBe(3); expect(world.fields.waterLevelM[5]).toBe(110);
    expect(Number.isNaN(world.fields.waterLevelM[4])).toBe(true);
  });
});
