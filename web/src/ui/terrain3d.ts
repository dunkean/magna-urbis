/** Stable Terrain3d entry for 3D owners, backend adapters and shader translation. Re-exports view contracts and operations from view3d/; owns no state. */
export { TERRAIN_3D_FOV, TERRAIN_3D_MAX_SCALE, TERRAIN_GROUND_MAX_SCALE } from './view3d/terrain/policy';
export {
  type Terrain3dCamera,
  type Terrain3dTile,
  type Terrain3dTileContent,
  type Terrain3dLookSettings,
  type Terrain3dGroundSettings,
  type Terrain3dForestSettings,
  type Terrain3dOptions,
  type Terrain3dStatus,
  type Patch,
  type MaterialRef,
  type PatchMaterial,
  type FrameGeometry,
  type PatchDraw,
} from './view3d/terrain/contract';
export { TERRAIN_3D_MAP_FRAGMENT, TERRAIN_3D_GLSL } from './view3d/gl/shaders';
export { gridEdgeVertex, fullPatchIndices, patchClipKey, clippedPatchIndices } from './view3d/terrain/patchIndices';
export { paddedMaterial } from './view3d/terrain/materialImages';
export { Terrain3d } from './view3d/terrainView';
