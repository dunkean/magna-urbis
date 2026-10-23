import { describe, expect, it } from 'vitest';
import { metricHorizontalToEastNorth, eastNorthToMetricHorizontal, serializeRegionalPackage, deserializeRegionalPackage, type NeuralEarthPackage } from '../src/surface/adapters/neuralEarth';
import { createLiveInfiniteTerrainProvider, decorToSurfaceInput } from '../src/surface/adapters/magna';
import { climateFromMagnaQuery } from '../src/surface/adapters/climate';
import { exportSurfacePacket } from '../src/surface/adapters/export';
import type { Decor } from '../src/ui/decor';
import type { TerrainSettings } from '../../rust/bridge/terrain';
import type { Building3dScene } from '../src/render/urbanBuildingGeometry';

const regional = (): NeuralEarthPackage => ({ format: 'surface-regional-exchange', version: 1, id: 'region', seed: '47',
  georeference: { crs: 'local-east-up-south', origin: { longitudeDeg: 2, latitudeDeg: 48, altitudeM: 20 }, zAzimuthDeg: 180, verticalDatum: 'EGM96' },
  layers: { 'source-key': { id: 'layer-id', sourceKey: 'external-key', units: 'm', originX: .5, originZ: .5, width: 4, height: 1,
    spacingM: 1, nativeSpacingM: 10, sourceLOD: -1.5, provenance: 'test only', values: new Float32Array([NaN, Infinity, -Infinity, 4]),
    season: { dayOfYear: 200, elevationCorrected: true } } }, features: { opaque: { arrayType: 'domain-enum', values: [4, 8] } } });
const decor = (): Decor => ({ meta: { id: 'test', seed: 'test', created: 'today', query: '' }, raster: { n: 12, width: 12,
  height: new Float32Array(144).fill(3), water: new Uint8Array(144), waterLevel: new Float32Array(144).fill(3),
  riverWidth: new Float32Array(144), riverIds: new Int32Array(144).fill(-1) } } as Decor);

describe('reviewed physical contract boundaries', () => {
  it('maps east and north without mirroring, and roundtrips rotated frames', () => {
    const ref = regional().georeference;
    const east = metricHorizontalToEastNorth(10, 0, ref), north = metricHorizontalToEastNorth(0, -20, ref);
    expect(east[0]).toBeCloseTo(10); expect(east[1]).toBeCloseTo(0);
    expect(north[0]).toBeCloseTo(0); expect(north[1]).toBeCloseTo(20);
    for (const zAzimuthDeg of [0, 37, 180, 271]) {
      const rotated = { ...ref, zAzimuthDeg }, en = metricHorizontalToEastNorth(31, -44, rotated);
      const xz = eastNorthToMetricHorizontal(...en, rotated);
      expect(xz[0]).toBeCloseTo(31); expect(xz[1]).toBeCloseTo(-44);
    }
  });
  it('roundtrips explicit nonfinite float markers without reviving opaque feature keys', () => {
    const value = regional(), text = serializeRegionalPackage(value), roundtrip = deserializeRegionalPackage(text);
    expect(roundtrip).toEqual(value);
    expect(roundtrip.features.opaque).toEqual({ arrayType: 'domain-enum', values: [4, 8] });
  });
  it('rejects coercion, integer overflow and malformed regional metadata', () => {
    for (const invalid of [null, '12', {}, true, 1e100]) {
      const parsed = JSON.parse(serializeRegionalPackage(regional())); parsed.layers['source-key'].values.values[0] = invalid;
      expect(() => deserializeRegionalPackage(JSON.stringify(parsed))).toThrow();
    }
    for (const invalid of [-1, 256, 1.5, 'NaN', null]) {
      const parsed = JSON.parse(serializeRegionalPackage(regional())); parsed.layers['source-key'].values = { arrayType: 'Uint8Array', values: [invalid, 1, 2, 3] };
      expect(() => deserializeRegionalPackage(JSON.stringify(parsed))).toThrow();
    }
    for (const mutate of [
      (v: any) => v.layers['source-key'].values = [1, 2, 3, 4],
      (v: any) => v.layers['source-key'].originX = Infinity,
      (v: any) => v.layers['source-key'].season.dayOfYear = 0,
      (v: any) => delete v.georeference.origin,
      (v: any) => v.seed = 47,
      (v: any) => v.features = [],
    ]) { const value = regional(); mutate(value); expect(() => serializeRegionalPackage(value)).toThrow(); }
  });
  it('applies a shared export translation to terrain buildings accepted occupation and roads', () => {
    const d = decor(), footprint = [{ outer: [{ x: 2, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 4 }, { x: 2, y: 4 }], holes: [] }];
    const building = { projection: 'native-building-visual-1', nativeRealization: false, id: 'source-house', parcel_id: 'p', ground_z_m: 3, height_m: 4,
      footprint, roof_footprint: footprint, occupation_surfaces: [footprint], ground_constraints: [{ footprint, height_m: 3 }] };
    const scene = { buildings: [building] } as unknown as Building3dScene, before = JSON.stringify(scene);
    const packet = exportSurfacePacket(d, scene, { originX: 100, originZ: 200, roads: [{ id: 'r', points: [[1, 8], [11, 8]], widthM: 1 }], encoding: 'binary' });
    expect([packet.world.terrain.originX, packet.world.terrain.originZ]).toEqual([100.5, 200.5]);
    expect(packet.urban.buildings[0].footprint[0].outer[0]).toEqual({ x: 102, y: 202 });
    expect(packet.urban.buildings[0].triangles[0].points[0]).toEqual([102, 3, 202]);
    expect(packet.urban.occupationBuildings[0].surfaces[0][0].outer[0]).toEqual({ x: 102, y: 202 });
    expect(packet.urban.roads[0].points[0]).toEqual([101, 208]);
    expect(packet.world.terrain.heights).toBeInstanceOf(Float32Array);
    expect(JSON.stringify(scene)).toBe(before);
  });
  it('marks dry water levels as NaN and follows exact bench preset/custom parsing rules', () => {
    const d = decor(); d.raster.water[4] = 3; d.raster.waterLevel[4] = 7;
    const input = decorToSurfaceInput(d);
    expect(Number.isNaN(input.hydrology!.waterLevelM![0])).toBe(true);
    expect(input.hydrology!.waterLevelM![4]).toBe(7);
    expect(climateFromMagnaQuery('climate=arid&temperature=99').meanAnnualTempC).toBe(23);
    expect(climateFromMagnaQuery('climate=custom&temperature=broken&precipitation=900').meanAnnualTempC).toBe(18);
    expect(climateFromMagnaQuery('climate=custom&temperature=  ').meanAnnualTempC).toBe(18);
  });
  it('terminates an abandoned isolated terrain worker before the next page request', async () => {
    let terminated = 0, posted = 0;
    const provider = await createLiveInfiniteTerrainProvider({ seed: '47' } as TerrainSettings,
      () => ({ id: 's', version: 'v', sourceLOD: 0, nativeSpacingM: 1 }),
      () => ({ terminate() { terminated++; }, postMessage() { posted++; } } as unknown as Worker));
    const controller = new AbortController();
    const pending = provider.request({ bounds: { minX: 0, minZ: 0, maxX: 100, maxZ: 100 }, spacingM: 2, worldVersion: 'v', signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(posted).toBe(1); expect(terminated).toBe(1);
  });
});
