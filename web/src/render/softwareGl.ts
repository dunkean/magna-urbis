/**
 * Software WebGL rasterizers (SwiftShader, llvmpipe, softpipe, Microsoft Basic Render / WARP), matched on the
 * unmasked renderer name. They are refused wherever a Canvas 2D or fallback path exists: measured 2 to 10 times slower
 * than Canvas 2D for the town plan, and slower than the fallback view for the compositor. Users: the vector engine's
 * tile rasterizer (gpu/tileRasterizer.ts), the live compositor, the town's WebGL renderer.
 */
export const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|basic render|microsoft warp|software/i;
