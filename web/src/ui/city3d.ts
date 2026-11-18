/** Stable City 3D entry for benches and map hosts. Re-exports contracts/material modes and delegates mounting to view3d/cityMount; owns no state. */
export { CITY_3D_MATERIAL_GROUNDS } from '../render/cityGroundModes';
export { mountCity3d } from './view3d/cityMount';
export type { City3dOptions, City3dGround, City3dViewSettings, City3dSurface, City3dWaterDisplay, City3dRetainedWater, City3dSemantic, City3dPhysicalGround, City3dDetailService, City3d, City3dStats, City3dWallStats } from './view3d/cityTypes';
