/** Stable WebGPU 3D entry for backend selection and ground prewarming. Re-exports device preparation and view creation; owns no state. */
export { type GpuImage } from './view3d/gpu/images';
export { prepareTerrain3dGpu, prewarmTerrain3dGround, createTerrain3dGpu } from './view3d/gpu/preparation';
