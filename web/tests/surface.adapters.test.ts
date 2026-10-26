import { describe, expect, it } from 'vitest';
import { createInfiniteTerrainProvider, exportMagnaBuildings, magnaToMetric, metricToMagna, terrainDataToGrid } from '../src/surface/adapters/magna';
import { convertSeasonalLayer, deserializeRegionalPackage, serializeRegionalPackage, type NeuralEarthPackage } from '../src/surface/adapters/neuralEarth';
import type { TerrainData, TerrainSettings } from '../../rust/bridge/terrain';
import type { Building3dScene } from '../src/render/urbanBuildingGeometry';
import { createInfiniteRefinementProvider } from '../src/surface/adapters/infiniteRefinement';
import { createSurfaceStreamHandler } from '../src/surface/adapters/stream';
import reference from '../../rust/fixtures/houses/batch-reference.json';
import { exportSurfacePacket } from '../src/surface/adapters/export';
import type { Decor } from '../src/ui/decor';
import { climateFromMagnaQuery, MAGNA_CLIMATE_PRESETS } from '../src/surface/adapters/climate';
import { readFileSync } from 'node:fs';

describe('renderer independent Magna adapters', () => {
  it('keeps offline climate presets exactly aligned with the existing source and converts units', () => {
    const text = readFileSync(new URL('../../rust/bridge/terrainClimate.ts', import.meta.url), 'utf8');
    const literal = text.match(/export const CLIMATE_VALUES[^=]*=\s*(\{[\s\S]*?\n\});/)?.[1];
    expect(literal).toBeDefined();
    // Evaluate only the checked-in constant object, never import the browser runtime.
    const original = Function(`return (${literal});`)();
    expect(MAGNA_CLIMATE_PRESETS).toEqual(original);
    const arid = climateFromMagnaQuery('climate=arid');
    expect(arid.meanAnnualTempC).toBe(23);
    expect(arid.annualPrecipMm).toBe(150);
    expect(arid.seasonalAmplitudeC).toBeCloseTo(8 * Math.SQRT2);
    const custom = climateFromMagnaQuery('?climate=custom&temperature=-4&temperatureStd=200&precipitation=999');
    expect(custom.meanAnnualTempC).toBe(-4);
    expect(custom.annualPrecipMm).toBe(999);
    expect(custom.seasonalAmplitudeC).toBeCloseTo(2 * Math.SQRT2);
  });
  it('keeps retained water source IDs and source metadata separate from compiled context', () => {
    const decor = { meta: { id: 'capture', seed: 'source-seed', created: '2026-10-22', query: '?source=neural-python',
      terrainDisplay: { sourceCell: 40 } }, raster: { n: 3, width: 120,
      height: new Float32Array([1, 2, 3, 2, 3, 4, 3, 4, 5]), water: new Uint8Array([0, 3, 0, 0, 3, 0, 0, 3, 0]),
      waterLevel: new Float32Array(9).fill(9), riverWidth: new Float32Array(9).fill(2), riverIds: new Int32Array(9).fill(847) } } as Decor;
    const packet = exportSurfacePacket(decor, undefined, { originX: 1000, originZ: 2000 });
    expect(packet.source.water.riverIds).toEqual(Array(9).fill(847));
    expect(packet.source.meta.seed).toBe('source-seed');
    expect(packet.world.terrain.originX).toBe(1020);
    expect(packet.world.terrain.originZ).toBe(2020);
    expect(packet.world.terrain.source.nativeSpacingM).toBe(40);
    expect(packet.world.terrain.source.sourceLODKnown).toBe(false);
    expect([...decor.raster.riverIds]).toEqual(Array(9).fill(847));
  });
  it('uses real refinement endpoints and trusts actual source metadata, never requested LOD', async () => {
    const calls: { url: string; body: any; signal?: AbortSignal | null }[] = [];
    const transport = (async (url: string | URL | Request, options?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(options?.body)), signal: options?.signal });
      if (String(url).endsWith('/register')) return Response.json({ id: 'retained', version: 'refined-v2', minMpp: 1, nativeMpp: 30, decoderUsed: true });
      return new Response(new Float32Array([120, 121, 122, 123, ...Array(60).fill(124)]).buffer, { headers: { 'X-Neural-Meta': JSON.stringify({ id: 'retained', x: 100, y: 200, width: 4, n: 8,
        sourceCell: 2, lod: 7, version: 'refined-v2', decoderUsed: true }) } });
    }) as typeof fetch;
    const field = new Float32Array(64).fill(1);
    const provider = await createInfiniteRefinementProvider('http://localhost:8793', { width: 60, n: 8, data: field }, { seed: '47', source: 'neural-python' }, transport);
    const controller = new AbortController();
    const grid = await provider.request({ bounds: { minX: 100, minZ: 200, maxX: 104, maxZ: 204 }, spacingM: 0.01, worldVersion: 'world', signal: controller.signal });
    expect(calls.map(c => c.url)).toEqual(['http://localhost:8793/refinement/register', 'http://localhost:8793/refinement/tile']);
    expect(calls[1].body.resolution).toBe(8);
    expect(calls[1].signal).toBe(controller.signal);
    expect([grid.originX, grid.originZ, grid.spacingM, grid.source.nativeSpacingM, grid.source.sourceLOD]).toEqual([100.25, 200.25, .5, 2, 7]);
    expect(grid.source.sourceLODKnown).toBe(true);
    expect(grid.source.id).toBe('infinite:47:retained');
    expect(provider.registration.id).toBe('retained');
    expect([...grid.heights].slice(0, 4)).toEqual([120, 121, 122, 123]);
    expect([...field]).toEqual(Array(64).fill(1));
  });
  it('rejects a stream response when the world changed during compilation', async () => {
    let worldId = 'first';
    const grid = { width: 2, height: 2, originX: 0, originZ: 0, spacingM: 1, heights: new Float32Array(4), source: { id: 's', version: 'v', sourceLOD: 3, nativeSpacingM: 1 } };
    const handler = createSurfaceStreamHandler({ id: 'test', request: async () => grid }, () => worldId, () => { worldId = 'edited'; return 'world'; });
    await expect(handler({ id: 'request', worldId: 'first', bounds: { minX: 0, minZ: 0, maxX: 1, maxZ: 1 }, resolutionM: 1 })).rejects.toThrow('Stale');
  });
  it('retains physical source centres, altitude and handedness', () => {
    const data = { x: 100, y: 200, width: 20, resolution: 2, height: new Float32Array([10, 20, 30, 40]) } as TerrainData;
    const source = { id: 'real-generator', version: '2', sourceLOD: 4, nativeSpacingM: 80 };
    const grid = terrainDataToGrid(data, source);
    expect([grid.originX, grid.originZ, grid.spacingM]).toEqual([105, 205, 10]);
    expect(grid.source).toEqual(source);
    grid.heights[0] = 999;
    expect(data.height[0]).toBe(10);
    expect(metricToMagna(...magnaToMetric(3, 4, 50))).toEqual([3, 4, 50]);
  });
  it('requests real generator refinements without upgrading the source LOD from display spacing', async () => {
    const requests: number[] = [];
    const provider = createInfiniteTerrainProvider({ seed: 'infinite' } as TerrainSettings, async region => {
      requests.push(region.resolution);
      return { terrain: { x: region.x, y: region.y, width: region.extent, resolution: region.resolution,
        height: new Float32Array(region.resolution ** 2).fill(requests.length) } as TerrainData,
        source: { id: 'source', version: 'v1', sourceLOD: requests.length, nativeSpacingM: 40 / requests.length } };
    });
    const request = { bounds: { minX: 0, minZ: 0, maxX: 2560, maxZ: 2560 }, spacingM: 40, worldVersion: 'v1' };
    const coarse = await provider.request(request), fine = await provider.request({ ...request, spacingM: 10 });
    expect(requests).toEqual([64, 256]);
    expect([coarse.heights[0], fine.heights[0], fine.source.sourceLOD]).toEqual([1, 2, 2]);
    const controller = new AbortController(); controller.abort();
    await expect(provider.request({ ...request, signal: controller.signal })).rejects.toThrow();
    expect(requests).toHaveLength(2);
  });
  it('never upgrades a cartographic projection to a native building; holes and IDs survive', () => {
    const ring = (a: number, b: number) => [{ x: a, y: a }, { x: b, y: a }, { x: b, y: b }, { x: a, y: b }];
    const footprint = [{ outer: ring(0, 10), holes: [ring(4, 6)] }];
    const scene = { buildings: [{ id: 'native-id-47', parcel_id: 'parcel-9', projection: 'native-building-visual-1',
      nativeRealization: false, ground_z_m: 120, height_m: 8, footprint, roof_footprint: footprint }] } as unknown as Building3dScene;
    const before = JSON.stringify(scene), exported = exportMagnaBuildings(scene), building = exported.buildings[0];
    expect(building.id).toBe('native-id-47');
    expect(building.nativeRealization).toBe(false);
    expect(building.representation).toBe('cartographic-proxy');
    expect(building.footprint[0].holes).toEqual([ring(4, 6)]);
    const area = building.triangles.filter(t => t.surface === 'roof').reduce((sum, t) => {
      const [a, b, c] = t.points;
      expect(t.normal).toEqual([0, 1, 0]);
      expect(a[1]).toBe(128);
      return sum + Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2])) / 2;
    }, 0);
    expect(area).toBe(96);
    building.footprint[0].holes.length = 0;
    expect(JSON.stringify(scene)).toBe(before);
  });
  it('exports existing native roof geometry and material slots without changing its source', () => {
    const unit = reference.units[0], body = unit.bodies[0];
    const source = { id: 'existing-native', parcel_id: 'existing-parcel', ground_z_m: 19,
      footprint: body.footprint, roof_footprint: body.footprint,
      volumes: [{ ...body, roof_mesh: unit.roofs, materials: body.levels[0].materials }], structural_features: [] };
    const before = JSON.stringify(source);
    const result = exportMagnaBuildings({ buildings: [source] } as unknown as Building3dScene).buildings[0];
    expect(result.representation).toBe('native');
    expect(result.nativeRealization).toBe(true);
    expect(result.triangles.some(t => t.surface === 'roof')).toBe(true);
    expect(result.triangles[0].materials).toEqual(body.levels[0].materials);
    expect(JSON.stringify(source)).toBe(before);
  });
  it('exchanges named regional layers, stable geometry IDs and seasonal units losslessly', () => {
    const packet: NeuralEarthPackage = { format: 'surface-regional-exchange', version: 1, id: 'region', seed: 'seed-exact',
      georeference: { crs: 'local-east-up-south', origin: { longitudeDeg: 2.3, latitudeDeg: 48.8, altitudeM: 34 }, zAzimuthDeg: 180, verticalDatum: 'EGM96' },
      features: { 'river:0001': { id: 'source-river-id', holes: [[[1, 2], [3, 4]]] } }, layers: { 'climate/winter': {
        id: 'temp-original', sourceKey: 'neural.temps.winter', units: 'K', originX: 20, originZ: 40, spacingM: 100,
        width: 2, height: 1, values: new Float32Array([273.15, NaN]), sourceLOD: 3, nativeSpacingM: 100,
        provenance: 'Neural Earth test', season: { dayOfYear: 10, elevationCorrected: true } } } };
    const roundtrip = deserializeRegionalPackage(serializeRegionalPackage(packet));
    expect(roundtrip).toEqual(packet);
    const celsius = convertSeasonalLayer(roundtrip.layers['climate/winter'], 'degC');
    expect(celsius.values[0]).toBeCloseTo(0, 3);
    expect(celsius.season?.elevationCorrected).toBe(true);
    expect(celsius.sourceKey).toBe('neural.temps.winter');
    expect(packet.layers['climate/winter'].units).toBe('K');
    expect(() => deserializeRegionalPackage('{"format":"surface-regional-exchange","version":2}')).toThrow();
  });
});
