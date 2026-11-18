/**
 * Ground/map shader selection and variants, called by Terrain3d input and draw hooks.
 * Reads/writes: Reads settings, forest and backend capabilities; writes program/variant/status caches and uniform locations on the supplied context.
 */
import { glLandDetailUnit } from '../terrainGl';
import { specializeShader } from '../glVariants';
import { withoutLandDetail } from '../../../../rust/bridge/terrainMaterialOccupation';
import { program } from './webglProgram';
import { vertexShader, TERRAIN_3D_MAP_FRAGMENT, fragmentShader } from './terrainShaders';
import { Terrain3dGroundSettings } from './terrainTypes';
import type { Terrain3dContext } from './terrainContext';

export function selectTerrainProgram(context: Terrain3dContext, procedural: boolean): void {
  context.useMapShader = !!context.options.fastMapShader && !procedural;
  if (context.useMapShader) context.prepareMapShader();
  context.mark('terrainShader', context.useMapShader ? 'map' : 'procedural');
}

export function prepareMapShader(context: Terrain3dContext): void {
  context.mapProgram ??= program(context.gl, vertexShader, TERRAIN_3D_MAP_FRAGMENT);
}

export function getShaderProfile(context: Terrain3dContext): 'map' | 'procedural' {
  return context.useMapShader ? 'map' : 'procedural';
}

/** The settings' ground variant once linked; meanwhile the last drawn one, or the variant without
 * ground material (the projected map, quick to compile), stands in. */
export function groundShader(context: Terrain3dContext, settings: Terrain3dGroundSettings | undefined): WebGLProgram {
  const forest = !!context.forest && !settings?.underdark;
  // The Underdark ground (cave floor, section cut, cave light) is compiled only into the Underdark variant.
  const v = { groundEnabled: +!!settings, uRenderV2: settings?.renderV2 ?? 0, uForest: +forest, uForestBrushes: +!!settings?.forestBrushes, uHasOccupation: +!!context.occupation, uHasForestBank: +(forest && !!context.forest?.bank), uUnderdark: +!!settings?.underdark };
  const variant = (constants: typeof v, wait: boolean) => context.groundVariants.get(Object.values(constants).join('.'), () => [vertexShader, specializeShader(glLandDetailUnit(context.gl) === undefined ? withoutLandDetail(fragmentShader) : fragmentShader, constants)], wait);
  const target = variant(v, false);
  context.mark('groundVariant', target ? 'ready' : 'pending');
  if (target) return (context.lastGround = target);
  const preview = variant({ groundEnabled: 0, uRenderV2: 0, uForest: 0, uForestBrushes: 0, uHasOccupation: 0, uHasForestBank: 0, uUnderdark: 0 }, true);
  if (!context.lastGround && !preview) throw new Error('Shader terrain 3D indisponible.');
  // A material transition uses the lightweight preview, without an old
  // forest/material variant that may be costly or expect different inputs.
  return settings ? preview! : (context.lastGround ?? preview!);
}

/** Uniform locations are constant for one linked program and GL context.
 * Inactive uniforms (null in the map shader) are cached as well. */
export function uniform(context: Terrain3dContext, name: string, shader: WebGLProgram): WebGLUniformLocation | null {
  let locations = context.uniformLocations.get(shader);
  if (!locations) {
    locations = new Map();
    context.uniformLocations.set(shader, locations);
  }
  if (!locations.has(name)) locations.set(name, context.gl.getUniformLocation(shader, name));
  return locations.get(name)!;
}
