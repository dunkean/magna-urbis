/**
 * Entry of the WebGL2 vector rasterizers (design: web/out/vector-gpu-2026-11-12/DESIGN.md). Two instances of one
 * replay core (replay.ts):
 * - the tile rasterizer (tileRasterizer.ts): a private canvas shared by the exact outputs (raster tiles, captures,
 *   the 3D drape), reached through the engine policy (vectorEngine.ts);
 * - the live rasterizer (liveRasterizer.ts): bound to the live compositor's context, for the overlay layer.
 */
export { createGpuRasterizer, sharedGpuRasterizer } from './tileRasterizer';
export { createLiveRasterizer, type BakedPrefix, type LivePart, type LiveRasterizer } from './liveRasterizer';
