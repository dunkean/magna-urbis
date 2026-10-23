import type { Decor } from '../../ui/decor';
import type { Building3dScene } from '../../render/urbanBuildingGeometry';
import { compileSurfaceWorld, serializeSurfaceWorld } from '../compiler';
import type { CompileOptions, SurfaceCompileInput } from '../model';
import { decorToSurfaceInput, exportMagnaBuildings } from './magna';

export interface DecorCompileOptions extends CompileOptions { originX?: number; originZ?: number }
export function compileFromDecor(decor: Decor, options: DecorCompileOptions = {}) {
  const input = decorToSurfaceInput(decor);
  input.terrain.originX += options.originX ?? 0;
  input.terrain.originZ += options.originZ ?? 0;
  return compileSurfaceWorld(input, options);
}

/** Runtime counterpart to the retained-decor export. The caller supplies the
 * actual source grid/seed/context and preserved city/river metadata. */
export function exportSurfaceInputPacket(input: SurfaceCompileInput, scene: Building3dScene = { buildings: [] },
  source: Record<string, unknown> = {}, options: CompileOptions = {}) {
  const world = compileSurfaceWorld(input, options);
  return { format: 'magna-surface-packet', version: 1, world: JSON.parse(serializeSurfaceWorld(world)),
    urban: exportMagnaBuildings(scene), source: structuredClone(source) };
}

/** Source metadata/geometry stay separate from compiled fields, preserving river
 * IDs and retained native records that do not belong in a surface raster. */
export function exportSurfacePacket(decor: Decor, scene?: Building3dScene, options: DecorCompileOptions = {}) {
  const retained = decor.meta.pipeline?.urban?.buildingState;
  if (retained?.cold && !scene) throw new Error('Cold native buildings require their retained chunk scene before surface export.');
  const world = compileFromDecor(decor, options);
  return { format: 'magna-surface-packet', version: 1,
    world: JSON.parse(serializeSurfaceWorld(world)), urban: exportMagnaBuildings(scene ?? retained?.scene ?? { buildings: [] }),
    source: { meta: structuredClone(decor.meta), geometry: structuredClone(decor.raster.geometry),
      water: { n: decor.raster.n, width: decor.raster.width, originX: options.originX ?? 0, originZ: options.originZ ?? 0, classes: Array.from(decor.raster.water),
        levelM: Array.from(decor.raster.waterLevel), riverIds: Array.from(decor.raster.riverIds), riverWidthM: Array.from(decor.raster.riverWidth) } } };
}
