import type { Decor } from '../../ui/decor';
import type { Building3dScene } from '../../render/urbanBuildingGeometry';
import { compileSurfaceWorld, serializeSurfaceWorld } from '../compiler';
import type { Bounds, CompileOptions, SurfaceCompileInput, SurfaceWorld } from '../model';
import { generateSurfaceCandidates } from '../population';
import { occupationFromMagnaScene, type SurfaceRoad } from './occupation';
import { decorToSurfaceInput } from './magna';
import { magnaClimateToSurface, MAGNA_CLIMATE_PRESETS } from './climate';
import { archiveSurfaceSource } from './sourceArchive';
import { packCandidateColumns } from '../candidateColumns';
import { magnaUrbanPacket, magnaUrbanIdentity, magnaRoads } from './magnaUrban';
import { magnaSurfacePresentation } from '../presentation';
import { magnaSurfaceSource } from './magnaSource';
import { applySurfaceGeology, withSurfaceGeologyQuery, type SurfaceGeologyOptions } from './geology';

export interface SurfacePacketOptions extends CompileOptions, SurfaceGeologyOptions { candidateBounds?: Bounds | 'all'; candidateLimit?: number; roads?: readonly SurfaceRoad[]; encoding?: 'json' | 'binary' }
export interface DecorCompileOptions extends SurfacePacketOptions {
  /** Common frame translation applied to terrain, visible/accepted buildings and roads. */
  originX?: number; originZ?: number;
  /** Source grid crop corner in the unchanged city/map frame; not a city translation. */
  terrainOriginX?: number; terrainOriginZ?: number;
}
export function compileFromDecor(decor: Decor, options: DecorCompileOptions = {}) {
  if (options.geologyScenario) decor = { ...decor, meta: { ...decor.meta, query: withSurfaceGeologyQuery(decor.meta.query, options.geologyScenario) } };
  let input = decorToSurfaceInput(decor, { applyGeology: false });
  input.terrain.originX += (options.terrainOriginX ?? 0) + (options.originX ?? 0);
  input.terrain.originZ += (options.terrainOriginZ ?? 0) + (options.originZ ?? 0);
  input = applySurfaceGeology(input, decor.meta.query, options);
  const world = compileSurfaceWorld(input, options);
  addWaterValidationWarning(world, input.sourceWaterValidation);
  return world;
}

/** Runtime counterpart to the retained-decor export. The caller supplies the
 * actual source grid/seed/context and preserved city/river metadata. */
export function exportSurfaceInputPacket(input: SurfaceCompileInput, scene: Building3dScene = { buildings: [] },
  source: Record<string, unknown> = {}, options: SurfacePacketOptions = {}) {
  const originalMeta = source.meta && typeof source.meta === 'object' ? source.meta as Decor['meta'] : undefined;
  if (options.geologyScenario) source = { ...source, meta: { ...originalMeta, query: withSurfaceGeologyQuery(originalMeta?.query ?? '', options.geologyScenario) } };
  const sourceQuery = (source.meta as Decor['meta'] | undefined)?.query ?? '';
  input = applySurfaceGeology(input, sourceQuery, options);
  const occupation = occupationFromMagnaScene(input.terrain, scene, options.roads, input.occupation);
  const world = compileSurfaceWorld({ ...input, occupation, climate: input.climate ?? magnaClimateToSurface(MAGNA_CLIMATE_PRESETS.temperate, 'magna-temperate-default-1') }, options);
  const meta = source.meta && typeof source.meta === 'object' ? source.meta as Decor['meta'] : undefined;
  const urban = magnaUrbanPacket(meta ? {meta} : undefined, scene, 0, 0, options.roads, options.encoding);
  return { format: 'magna-surface-packet', version: 1, world: options.encoding === 'binary' ? world : JSON.parse(serializeSurfaceWorld(world)),
    presentation: magnaSurfacePresentation(typeof meta?.query === 'string' ? meta.query : ''),
    urban, urbanId: magnaUrbanIdentity(urban), source: options.encoding === 'binary' ? archiveSurfaceSource(source) : structuredClone(source), ...packetCandidates(world, options) };
}

function packetCandidates(world: SurfaceWorld, options: SurfacePacketOptions) {
  const b = world.bounds, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const candidateBounds = options.candidateBounds === 'all' ? b : options.candidateBounds ?? { minX: Math.max(b.minX, cx - 160), maxX: Math.min(b.maxX, cx + 160),
    minZ: Math.max(b.minZ, cz - 160), maxZ: Math.min(b.maxZ, cz + 160) };
  const candidates = generateSurfaceCandidates(world, candidateBounds, { maxCandidates: options.candidateLimit ?? 100000, signal: options.signal });
  return options.encoding === 'binary' ? { candidateBounds, candidateColumns: packCandidateColumns(candidates) } : { candidateBounds, candidates };
}
function addWaterValidationWarning(world: SurfaceWorld, validation: ReturnType<typeof decorToSurfaceInput>['sourceWaterValidation']) {
  const removed = validation.sourceWetCells - validation.physicalWetCells;
  if (removed) world.diagnostics.warnings.push(`Retained water safety mask: ${removed}/${validation.sourceWetCells} source cells lack resolved positive water depth and remain Dry in context (${validation.aboveBedCells} above-level beds, ${validation.zeroOrUnresolvedDepthCells} unresolved/zero depth, ${validation.invalidLevelCells} invalid levels, ${validation.ambiguousCaveCells} ambiguous cave labels). Original source raster and river geometry are preserved.`);
}

/** Source metadata/geometry stay separate from compiled fields, preserving river
 * IDs and retained native records that do not belong in a surface raster. */
export function exportSurfacePacket(decor: Decor, scene?: Building3dScene, options: DecorCompileOptions = {}) {
  const retained = decor.meta.pipeline?.urban?.buildingState;
  if (retained?.cold && !scene) throw new Error('Cold native buildings require their retained chunk scene before surface export.');
  if (options.geologyScenario) decor = { ...decor, meta: { ...decor.meta, query: withSurfaceGeologyQuery(decor.meta.query, options.geologyScenario) } };
  let input = decorToSurfaceInput(decor, { applyGeology: false });
  const dx = options.originX ?? 0, dz = options.originZ ?? 0;
  if (![dx, dz, options.terrainOriginX ?? 0, options.terrainOriginZ ?? 0].every(Number.isFinite)) throw new Error('Surface export offsets must be finite.');
  input.terrain.originX += options.terrainOriginX ?? 0; input.terrain.originZ += options.terrainOriginZ ?? 0;
  const buildings = scene ?? retained?.scene ?? { buildings: [] };
  const roads = magnaRoads(decor, options.roads);
  input.occupation = occupationFromMagnaScene(input.terrain, buildings, roads, input.occupation);
  input.terrain.originX += dx; input.terrain.originZ += dz;
  input = applySurfaceGeology(input, decor.meta.query, options);
  const world = compileSurfaceWorld(input, options);
  addWaterValidationWarning(world, input.sourceWaterValidation);
  const source = magnaSurfaceSource(decor, { encoding: options.encoding, cornerX: (options.terrainOriginX ?? 0) + dx, cornerZ: (options.terrainOriginZ ?? 0) + dz,
    translationX: dx, translationZ: dz, sourceWaterValidation: input.sourceWaterValidation });
  const urban = magnaUrbanPacket(decor, buildings, dx, dz, options.roads, options.encoding);
  return { format: 'magna-surface-packet', version: 1,
    presentation: magnaSurfacePresentation(decor.meta.query),
    world: options.encoding === 'binary' ? world : JSON.parse(serializeSurfaceWorld(world)), urban, urbanId: magnaUrbanIdentity(urban), ...packetCandidates(world, options),
    source };
}
