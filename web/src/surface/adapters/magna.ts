import type { TerrainData, TerrainSettings, TerrainRegion } from '../../../../rust/bridge/terrain';
import type { World } from '../../gen/types';
import type { Decor } from '../../ui/decor';
import { eachBuildingTriangle, isBuildingProjection, type Building3dScene, type BuildingTriangle } from '../../render/urbanBuildingGeometry';
import { assertNotAborted, hashString, type TerrainGrid, type SourceIdentity, type SurfaceCompileInput } from '../model';
import type { TerrainProvider, TerrainRequest } from '../provider';
import { climateFromMagnaQuery } from './climate';

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
    if (!(extent > 0) || Math.abs(extent - (b.maxZ - b.minZ)) > 1e-6 || !(request.spacingM > 0))
      throw new Error('Infinite Generation bridge requires a square region and positive spacing.');
    const resolution = Math.max(64, Math.min(1024, Math.ceil(extent / request.spacingM)));
    const reply = await sample({ x: b.minX, y: b.minZ, extent, resolution }, structuredClone(retained), request.signal);
    assertNotAborted(request.signal);
    return terrainDataToGrid(reply.terrain, reply.source);
  } };
}

/** Browser/runtime entrypoint to the actual existing Infinite Generation bridge.
 * Keep the import lazy: offline exports and Neural Earth need no WASM or DOM.
 * Explicit source metadata is mandatory; display refinement is not evidence of a new LOD. */
export async function createLiveInfiniteTerrainProvider(settings: TerrainSettings,
  sourceForReply: (terrain: TerrainData) => SourceIdentity): Promise<TerrainProvider> {
  const { sampleRustTerrain } = await import('../../../../rust/bridge/terrain');
  let serial = 0;
  return createInfiniteTerrainProvider(settings, async (region, retained, signal) => {
    assertNotAborted(signal);
    const terrain = await sampleRustTerrain({ id: ++serial, generation: 0, kind: 'detail', settings: retained, region, display: 'gl' });
    assertNotAborted(signal);
    return { terrain, source: sourceForReply(terrain) };
  });
}

export function exportMagnaBuildings(scene: Building3dScene) {
  return { schemaVersion: 'magna-building-meshes-1' as const, coordinateSystem: 'x-east,y-up,z-map-y' as const,
    materials: structuredClone(scene.materials ?? []), buildings: scene.buildings.map(building => {
      const proxy = isBuildingProjection(building), triangles: BuildingTriangle[] = [];
      eachBuildingTriangle(building, t => {
        // Axis permutation changes handedness: reverse winding to retain outward normals.
        triangles.push({ ...structuredClone(t), points: [t.points[0], t.points[2], t.points[1]].map(p => magnaToMetric(...p)) as BuildingTriangle['points'],
          normal: magnaToMetric(...t.normal) });
      });
      return { id: building.id, parcelId: building.parcel_id, representation: proxy ? 'cartographic-proxy' as const : 'native' as const,
        nativeRealization: !proxy, groundHeightM: building.ground_z_m,
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

export function worldToSurfaceInput(world: World, source: SourceIdentity): SurfaceCompileInput {
  const grid = world.terrain.height;
  return { seed: parseInt(hashString(world.seed), 16), terrain: { width: grid.w, height: grid.h,
    originX: grid.cell / 2, originZ: grid.cell / 2, spacingM: grid.cell, heights: grid.data.slice(), source: { ...source } },
    hydrology: { version: source.version, provenance: 'Magna canonical terrain routing', boundary: 'truncated',
      downstream: world.terrain.receiver.slice(), contributingAreaM2: Float32Array.from(world.terrain.flow.data, a => a * grid.cell ** 2),
      waterClass: Uint8Array.from(world.terrain.water, c => c === 1 ? 3 : c === 3 ? 1 : c) } };
}

export function decorToSurfaceInput(decor: Decor): SurfaceCompileInput {
  const r = decor.raster, cell = r.width / r.n, display = decor.meta.terrainDisplay;
  return { seed: parseInt(hashString(decor.meta.seed), 16), terrain: { width: r.n, height: r.n,
    originX: cell / 2, originZ: cell / 2, spacingM: cell, heights: r.height.slice(),
    source: { id: decor.meta.id, version: decor.meta.created, sourceLOD: 0, sourceLODKnown: false,
      nativeSpacingM: display?.sourceCell ?? cell,
      provenance: `Retained Magna decor; seed=${decor.meta.seed}; query=${decor.meta.query}; crop=${JSON.stringify(decor.meta.pipeline?.crop ?? null)}; offline capture (source LOD unrecorded)` } },
    climate: climateFromMagnaQuery(decor.meta.query),
    hydrology: { version: decor.meta.created, provenance: 'Retained decor water raster; source IDs retained in export metadata',
      boundary: 'truncated', waterClass: Uint8Array.from(r.water, c => c === 1 ? 3 : c === 3 ? 1 : c), waterLevelM: r.waterLevel.slice() } };
}
