import type { TerrainData, TerrainSettings, TerrainRegion } from '../../../../rust/bridge/terrain';
import type { World } from '../../gen/types';
import type { Decor } from '../../ui/decor';
import { eachBuildingTriangle, isBuildingProjection, type Building3dScene, type BuildingTriangle } from '../../render/urbanBuildingGeometry';
import { assertNotAborted, hashString, type TerrainGrid, type SourceIdentity, type SurfaceCompileInput } from '../model';
import type { TerrainProvider, TerrainRequest } from '../provider';
import { climateFromMagnaQuery, magnaClimateToSurface, MAGNA_CLIMATE_PRESETS } from './climate';
import type { ClimateValues } from '../../../../rust/bridge/terrain';
import { buildingOccupationSurfaces, buildingGroundConstraints } from '../../ui/urbanBuildingProjection';
import { occupationFromMagnaWorld } from './occupation';

/** Magna map XY, altitude Z -> metric horizontal XZ, altitude Y. */
export const magnaToMetric = (x: number, y: number, altitude: number): [number, number, number] => [x, altitude, y];
export const metricToMagna = (x: number, altitude: number, z: number): [number, number, number] => [x, z, altitude];

export function terrainDataToGrid(data: TerrainData, source: SourceIdentity): TerrainGrid {
  const spacingM = data.width / data.resolution;
  return { width: data.resolution, height: data.resolution, originX: data.x + spacingM / 2,
    originZ: data.y + spacingM / 2, spacingM, heights: data.height.slice(), source: { ...source } };
}

export interface InfiniteTerrainReply { terrain: TerrainData; source: SourceIdentity }
/** Inject the existing sampleRustTerrain bridge. Returned provenance must describe the
 * real generator level, independently of the requested display sampling resolution. */
export function createInfiniteTerrainProvider(settings: TerrainSettings,
  sample: (region: TerrainRegion, settings: TerrainSettings, signal?: AbortSignal) => Promise<InfiniteTerrainReply>): TerrainProvider {
  const retained = structuredClone(settings);
  return { id: `infinite:${retained.seed}`, async request(request: TerrainRequest) {
    assertNotAborted(request.signal);
    const b = request.bounds, extent = b.maxX - b.minX;
    if (![b.minX, b.minZ, b.maxX, b.maxZ, request.spacingM].every(Number.isFinite) || !(extent > 0) || Math.abs(extent - (b.maxZ - b.minZ)) > 1e-6 || !(request.spacingM > 0))
      throw new Error('Infinite Generation bridge requires a square region and positive spacing.');
    const resolution = Math.max(64, Math.min(1024, Math.ceil(extent / request.spacingM)));
    const reply = await sample({ x: b.minX, y: b.minZ, extent, resolution }, structuredClone(retained), request.signal);
    assertNotAborted(request.signal);
    return terrainDataToGrid(reply.terrain, reply.source);
  } };
}

/** One worker per request isolates the actual generator's queue from the active
 * page. Aborting terminates that worker, including queued/native computation. */
export async function createLiveInfiniteTerrainProvider(settings: TerrainSettings,
  sourceForReply: (terrain: TerrainData) => SourceIdentity,
  workerFactory: () => Worker = () => new Worker(new URL('./infiniteTerrain.worker.ts', import.meta.url), { type: 'module' })): Promise<TerrainProvider> {
  return createInfiniteTerrainProvider(settings, async (region, retained, signal) => {
    assertNotAborted(signal);
    const terrain = await new Promise<TerrainData>((resolve, reject) => {
      const worker = workerFactory();
      const cleanup = () => { worker.terminate(); signal?.removeEventListener('abort', aborted); };
      const aborted = () => { cleanup(); reject(new DOMException('Surface generation aborted', 'AbortError')); };
      signal?.addEventListener('abort', aborted, { once: true });
      worker.onmessage = (event: MessageEvent<{ terrain?: TerrainData; error?: string }>) => {
        cleanup(); event.data.terrain ? resolve(event.data.terrain) : reject(new Error(event.data.error ?? 'Surface worker returned no terrain.'));
      };
      worker.onerror = event => { cleanup(); reject(new Error(event.message || 'Surface worker failed.')); };
      if (signal?.aborted) { aborted(); return; }
      try { worker.postMessage({ region, settings: retained }); } catch (error) { cleanup(); reject(error); }
    });
    assertNotAborted(signal);
    return { terrain, source: sourceForReply(terrain) };
  });
}

export function exportMagnaBuildings(scene: Building3dScene) {
  return { schemaVersion: 'magna-building-meshes-1' as const, coordinateSystem: 'x-east,y-up,z-map-y' as const,
    occupationSource: scene.occupationBuildings === undefined ? 'visual-fallback' as const : 'accepted-records' as const,
    occupationBuildings: (scene.occupationBuildings ?? scene.buildings).map(building => ({ id: building.id, parcelId: building.parcel_id,
      representation: isBuildingProjection(building) ? 'cartographic-proxy' as const : 'native' as const,
      nativeRealization: !isBuildingProjection(building), groundHeightM: building.ground_z_m,
      ...(!isBuildingProjection(building) ? { nativeLevels: building.volumes.map(volume => ({ volumeId: volume.id, volumeMaterials: structuredClone(volume.materials), levels: structuredClone(volume.levels) })) } : {}),
      surfaces: structuredClone(buildingOccupationSurfaces(building)), groundConstraints: structuredClone(buildingGroundConstraints(building)) })),
    materials: structuredClone(scene.materials ?? []), buildings: scene.buildings.map(building => {
      const proxy = isBuildingProjection(building), triangles: BuildingTriangle[] = [];
      eachBuildingTriangle(building, t => {
        // Axis permutation changes handedness: reverse winding to retain outward normals.
        const points = [t.points[0], t.points[2], t.points[1]].map(p => magnaToMetric(...p)) as BuildingTriangle['points'];
        const normal = magnaToMetric(...t.normal), [a, b, c] = points;
        const u = b.map((v, i) => v - a[i]), v = c.map((v, i) => v - a[i]);
        const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        if (cross.reduce((sum, value, i) => sum + value * normal[i], 0) < 0) [points[1], points[2]] = [points[2], points[1]];
        triangles.push({ ...structuredClone(t), points, normal });
      });
      return { id: building.id, parcelId: building.parcel_id, representation: proxy ? 'cartographic-proxy' as const : 'native' as const,
        nativeRealization: !proxy, groundHeightM: building.ground_z_m,
        presentation: { sourceSystem: 'magna-native-houses', recipeId: building.recipe_id, variantId: building.variant_id,
          culture: structuredClone(building.culture), function: building.function,
          ...(!proxy ? { simplification: building.simplification } : {}) },
        ...(!proxy ? { nativeLevels: building.volumes.map(volume => ({ volumeId: volume.id, volumeMaterials: structuredClone(volume.materials), levels: structuredClone(volume.levels) })) } : {}),
        footprint: structuredClone(building.footprint), roofFootprint: structuredClone(building.roof_footprint), triangles };
    }) };
}

/** Exact existing city layers; source keys and holes are retained without generating a city. */
export function exportMagnaCity(world: World) {
  return structuredClone({ schemaVersion: 'magna-city-layers-1', sourceId: world.uid ?? world.seed,
    seed: world.seed, mapSizeM: world.mapSize, roads: world.roads, bridges: world.bridges, urban: world.urban,
    landuse: world.landuse, settlements: world.settlements, megaDetail: world.megaDetail,
    water: { seaLevel: world.terrain.seaLevel, coastline: world.terrain.coastline, islands: world.terrain.islands,
      lakes: world.terrain.lakes, rivers: world.terrain.rivers } });
}

export function worldToSurfaceInput(world: World, source: SourceIdentity, climate: ClimateValues = MAGNA_CLIMATE_PRESETS.temperate): SurfaceCompileInput {
  const grid = world.terrain.height;
  const terrain = { width: grid.w, height: grid.h, originX: grid.cell / 2, originZ: grid.cell / 2,
    spacingM: grid.cell, heights: grid.data.slice(), source: { ...source } };
  return { seed: parseInt(hashString(world.seed), 16), terrain, occupation: occupationFromMagnaWorld(terrain, world),
    climate: magnaClimateToSurface(climate, `magna-world-climate:${JSON.stringify(climate)}`),
    hydrology: { version: source.version, provenance: 'Magna canonical routing from depression-filled source; heights retain the source physical terrain', boundary: 'external-inflows',
      downstream: world.terrain.receiver.slice(), contributingAreaM2: Float32Array.from(world.terrain.flow.data, a => a * grid.cell ** 2),
      waterClass: Uint8Array.from(world.terrain.water, c => c === 1 ? 3 : c === 3 ? 1 : c) } };
}

export interface DecorWaterValidation {
  policy: 'positive-depth-only-1mm'; sourceWetCells: number; physicalWetCells: number;
  aboveBedCells: number; zeroOrUnresolvedDepthCells: number; invalidLevelCells: number; ambiguousCaveCells: number;
  assumption: string;
}
export function decorToSurfaceInput(decor: Decor): SurfaceCompileInput & { sourceWaterValidation: DecorWaterValidation } {
  const r = decor.raster, cell = r.width / r.n, display = decor.meta.terrainDisplay;
  const waterClass = Uint8Array.from(r.water, c => c === 1 ? 3 : c === 3 ? 1 : c), waterLevelM = new Float32Array(r.height.length).fill(NaN);
  const cavern = new URLSearchParams(decor.meta.query).get('relief') === 'cavern' || decor.meta.tags?.relief === 'cavern';
  const validation: DecorWaterValidation = { policy: 'positive-depth-only-1mm', sourceWetCells: 0, physicalWetCells: 0,
    aboveBedCells: 0, zeroOrUnresolvedDepthCells: 0, invalidLevelCells: 0, ambiguousCaveCells: 0,
    assumption: 'Retained river raster is a conservative safety envelope, not proof of physical inundation. Only finite source levels at least 1 mm above the retained bed define contextual water; other cells are Dry/NaN. Original water classes, levels, river IDs and vector geometry remain unchanged in source. Cave class 2 is ambiguous and not promoted to lake water.' };
  for (let i = 0; i < waterClass.length; i++) {
    if (!waterClass[i]) continue;
    validation.sourceWetCells++;
    const level = r.waterLevel[i], depth = level - r.height[i];
    if (cavern && r.water[i] === 2) validation.ambiguousCaveCells++;
    else if (!Number.isFinite(level)) validation.invalidLevelCells++;
    else if (depth < -.001) validation.aboveBedCells++;
    else if (depth < .001) validation.zeroOrUnresolvedDepthCells++;
    else { validation.physicalWetCells++; waterLevelM[i] = level; continue; }
    waterClass[i] = 0;
  }
  return { seed: parseInt(hashString(decor.meta.seed), 16), terrain: { width: r.n, height: r.n,
    originX: cell / 2, originZ: cell / 2, spacingM: cell, heights: r.height.slice(),
    source: { id: decor.meta.id, version: decor.meta.created, sourceLOD: 0, sourceLODKnown: false,
      nativeSpacingM: display?.sourceCell ?? cell,
      provenance: `Retained Magna settlement raster (may be sampled from the displayed B-spline control grid); seed=${decor.meta.seed}; query=${decor.meta.query}; crop=${JSON.stringify(decor.meta.pipeline?.crop ?? null)}; offline capture (source LOD unrecorded)` } },
    climate: climateFromMagnaQuery(decor.meta.query),
    sourceWaterValidation: validation,
    hydrology: { version: decor.meta.created, provenance: `Retained decor water contextualized with ${validation.policy}: ${validation.physicalWetCells}/${validation.sourceWetCells} source envelope cells have resolved positive depth. Source IDs and original masks/levels remain in export metadata. ${validation.assumption}`,
      boundary: 'truncated', waterClass, waterLevelM } };
}
