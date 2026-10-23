import type { Decor } from '../../ui/decor';
import type { Building3dScene } from '../../render/urbanBuildingGeometry';
import { compileSurfaceWorld, serializeSurfaceWorld } from '../compiler';
import type { Bounds, CompileOptions, SurfaceCompileInput, SurfaceWorld } from '../model';
import { generateSurfaceCandidates } from '../population';
import { occupationFromMagnaScene, type SurfaceRoad } from './occupation';
import { decorToSurfaceInput, exportMagnaBuildings } from './magna';
import { magnaClimateToSurface, MAGNA_CLIMATE_PRESETS } from './climate';
import type { Surface } from '../../../../rust/bridge/housesContract';
import { archiveSurfaceSource } from './sourceArchive';

export interface SurfacePacketOptions extends CompileOptions { candidateBounds?: Bounds | 'all'; candidateLimit?: number; roads?: readonly SurfaceRoad[]; encoding?: 'json' | 'binary' }
export interface DecorCompileOptions extends SurfacePacketOptions {
  /** Common frame translation applied to terrain, visible/accepted buildings and roads. */
  originX?: number; originZ?: number;
  /** Source grid crop corner in the unchanged city/map frame; not a city translation. */
  terrainOriginX?: number; terrainOriginZ?: number;
}
export function compileFromDecor(decor: Decor, options: DecorCompileOptions = {}) {
  const input = decorToSurfaceInput(decor);
  input.terrain.originX += (options.terrainOriginX ?? 0) + (options.originX ?? 0);
  input.terrain.originZ += (options.terrainOriginZ ?? 0) + (options.originZ ?? 0);
  const world = compileSurfaceWorld(input, options);
  addWaterValidationWarning(world, input.sourceWaterValidation);
  return world;
}

/** Runtime counterpart to the retained-decor export. The caller supplies the
 * actual source grid/seed/context and preserved city/river metadata. */
export function exportSurfaceInputPacket(input: SurfaceCompileInput, scene: Building3dScene = { buildings: [] },
  source: Record<string, unknown> = {}, options: SurfacePacketOptions = {}) {
  const occupation = occupationFromMagnaScene(input.terrain, scene, options.roads, input.occupation);
  const world = compileSurfaceWorld({ ...input, occupation, climate: input.climate ?? magnaClimateToSurface(MAGNA_CLIMATE_PRESETS.temperate, 'magna-temperate-default-1') }, options);
  return { format: 'magna-surface-packet', version: 1, world: options.encoding === 'binary' ? world : JSON.parse(serializeSurfaceWorld(world)),
    urban: { ...exportMagnaBuildings(scene), roads: structuredClone(options.roads ?? []) }, source: options.encoding === 'binary' ? archiveSurfaceSource(source) : structuredClone(source), ...packetCandidates(world, options) };
}

function packetCandidates(world: SurfaceWorld, options: SurfacePacketOptions) {
  const b = world.bounds, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const candidateBounds = options.candidateBounds === 'all' ? b : options.candidateBounds ?? { minX: Math.max(b.minX, cx - 160), maxX: Math.min(b.maxX, cx + 160),
    minZ: Math.max(b.minZ, cz - 160), maxZ: Math.min(b.maxZ, cz + 160) };
  return { candidateBounds, candidates: generateSurfaceCandidates(world, candidateBounds, { maxCandidates: options.candidateLimit ?? 100000, signal: options.signal }) };
}
function addWaterValidationWarning(world: SurfaceWorld, validation: ReturnType<typeof decorToSurfaceInput>['sourceWaterValidation']) {
  const removed = validation.sourceWetCells - validation.physicalWetCells;
  if (removed) world.diagnostics.warnings.push(`Retained water safety mask: ${removed}/${validation.sourceWetCells} source cells lack resolved positive water depth and remain Dry in context (${validation.aboveBedCells} above-level beds, ${validation.zeroOrUnresolvedDepthCells} unresolved/zero depth, ${validation.invalidLevelCells} invalid levels, ${validation.ambiguousCaveCells} ambiguous cave labels). Original source raster and river geometry are preserved.`);
}

function translatedBuildings(scene: Building3dScene, dx: number, dz: number) {
  const packet = exportMagnaBuildings(scene);
  const surface = (s: Surface) => { for (const shape of s) for (const ring of [shape.outer, ...shape.holes]) for (const p of ring) { p.x += dx; p.y += dz; } };
  for (const building of packet.buildings) {
    surface(building.footprint); surface(building.roofFootprint);
    for (const triangle of building.triangles) for (const p of triangle.points) { p[0] += dx; p[2] += dz; }
  }
  for (const building of packet.occupationBuildings) {
    for (const s of building.surfaces) surface(s);
    for (const c of building.groundConstraints) surface(c.footprint);
  }
  return packet;
}

/** Source metadata/geometry stay separate from compiled fields, preserving river
 * IDs and retained native records that do not belong in a surface raster. */
export function exportSurfacePacket(decor: Decor, scene?: Building3dScene, options: DecorCompileOptions = {}) {
  const retained = decor.meta.pipeline?.urban?.buildingState;
  if (retained?.cold && !scene) throw new Error('Cold native buildings require their retained chunk scene before surface export.');
  const input = decorToSurfaceInput(decor);
  const dx = options.originX ?? 0, dz = options.originZ ?? 0;
  if (![dx, dz, options.terrainOriginX ?? 0, options.terrainOriginZ ?? 0].every(Number.isFinite)) throw new Error('Surface export offsets must be finite.');
  input.terrain.originX += options.terrainOriginX ?? 0; input.terrain.originZ += options.terrainOriginZ ?? 0;
  const buildings = scene ?? retained?.scene ?? { buildings: [] };
  const roads: SurfaceRoad[] = options.roads ? [...options.roads] : (decor.meta.roads?.segments ?? []).map(road => ({ points: road.path.map(p => [p.x, p.y]), widthM: road.width }));
  input.occupation = occupationFromMagnaScene(input.terrain, buildings, roads, input.occupation);
  input.terrain.originX += dx; input.terrain.originZ += dz;
  const world = compileSurfaceWorld(input, options);
  addWaterValidationWarning(world, input.sourceWaterValidation);
  const source = { meta: decor.meta, geometry: decor.raster.geometry, sourceToWorldTranslation: { x: dx, z: dz }, sourceWaterValidation: input.sourceWaterValidation,
    water: { n: decor.raster.n, width: decor.raster.width, originX: (options.terrainOriginX ?? 0) + dx, originZ: (options.terrainOriginZ ?? 0) + dz,
      classes: options.encoding === 'binary' ? decor.raster.water : Array.from(decor.raster.water),
      levelM: options.encoding === 'binary' ? decor.raster.waterLevel : Array.from(decor.raster.waterLevel),
      riverIds: options.encoding === 'binary' ? decor.raster.riverIds : Array.from(decor.raster.riverIds),
      riverWidthM: options.encoding === 'binary' ? decor.raster.riverWidth : Array.from(decor.raster.riverWidth) } };
  return { format: 'magna-surface-packet', version: 1,
    world: options.encoding === 'binary' ? world : JSON.parse(serializeSurfaceWorld(world)), urban: { ...translatedBuildings(buildings, dx, dz), roadsCoordinateSystem: 'metric-xz' as const,
      footprintsCoordinateSystem: 'metric-xz-as-xy' as const,
      roads: roads.map((road, sourceIndex) => ({ ...structuredClone(road), sourceIndex, points: road.points.map(([x, z]) => [x + dx, z + dz]),
        ...(!options.roads ? { surface: decor.meta.roads!.segments[sourceIndex].surface, class: decor.meta.roads!.segments[sourceIndex].class } : {}) })) }, ...packetCandidates(world, options),
    source: options.encoding === 'binary' ? archiveSurfaceSource(source) : structuredClone(source) };
}
