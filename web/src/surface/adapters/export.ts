import type { Decor } from '../../ui/decor';
import type { Building3dScene } from '../../render/urbanBuildingGeometry';
import { compileSurfaceWorld, serializeSurfaceWorld } from '../compiler';
import type { Bounds, CompileOptions, SurfaceCompileInput, SurfaceWorld } from '../model';
import { generateSurfaceCandidates } from '../population';
import { decorToSurfaceInput, exportMagnaBuildings } from './magna';

export interface SurfacePacketOptions extends CompileOptions { candidateBounds?: Bounds }
export interface DecorCompileOptions extends SurfacePacketOptions { originX?: number; originZ?: number }
export function compileFromDecor(decor: Decor, options: DecorCompileOptions = {}) {
  const input = decorToSurfaceInput(decor);
  input.terrain.originX += options.originX ?? 0;
  input.terrain.originZ += options.originZ ?? 0;
  return compileSurfaceWorld(input, options);
}

/** Runtime counterpart to the retained-decor export. The caller supplies the
 * actual source grid/seed/context and preserved city/river metadata. */
export function exportSurfaceInputPacket(input: SurfaceCompileInput, scene: Building3dScene = { buildings: [] },
  source: Record<string, unknown> = {}, options: SurfacePacketOptions = {}) {
  const world = compileSurfaceWorld(input, options);
  return { format: 'magna-surface-packet', version: 1, world: JSON.parse(serializeSurfaceWorld(world)),
    urban: exportMagnaBuildings(scene), source: structuredClone(source), ...packetCandidates(world, options) };
}

function packetCandidates(world: SurfaceWorld, options: SurfacePacketOptions) {
  const b = world.bounds, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const candidateBounds = options.candidateBounds ?? { minX: Math.max(b.minX, cx - 160), maxX: Math.min(b.maxX, cx + 160),
    minZ: Math.max(b.minZ, cz - 160), maxZ: Math.min(b.maxZ, cz + 160) };
  return { candidateBounds, candidates: generateSurfaceCandidates(world, candidateBounds, { maxCandidates: 100000, signal: options.signal }) };
}

/** Source metadata/geometry stay separate from compiled fields, preserving river
 * IDs and retained native records that do not belong in a surface raster. */
export function exportSurfacePacket(decor: Decor, scene?: Building3dScene, options: DecorCompileOptions = {}) {
  const retained = decor.meta.pipeline?.urban?.buildingState;
  if (retained?.cold && !scene) throw new Error('Cold native buildings require their retained chunk scene before surface export.');
  const world = compileFromDecor(decor, options);
  return { format: 'magna-surface-packet', version: 1,
    world: JSON.parse(serializeSurfaceWorld(world)), urban: { ...exportMagnaBuildings(scene ?? retained?.scene ?? { buildings: [] }),
      roads: (decor.meta.roads?.segments ?? []).map((road, sourceIndex) => ({ sourceIndex, points: road.path.map(p => [p.x, p.y]),
        widthM: road.width, surface: road.surface, class: road.class })) }, ...packetCandidates(world, options),
    source: { meta: structuredClone(decor.meta), geometry: structuredClone(decor.raster.geometry),
      water: { n: decor.raster.n, width: decor.raster.width, originX: options.originX ?? 0, originZ: options.originZ ?? 0, classes: Array.from(decor.raster.water),
        levelM: Array.from(decor.raster.waterLevel), riverIds: Array.from(decor.raster.riverIds), riverWidthM: Array.from(decor.raster.riverWidth) } } };
}
