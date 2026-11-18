/**
 * Opaque WebGPU image handles and mip counts shared by GPU upload/recording modules.
 * Reads/writes: Reads handles/dimensions; writes no state.
 */
export const mipCount = (width: number, height: number): number => Math.floor(Math.log2(Math.max(width, height, 1))) + 1;

export interface GpuImage {
  texture: GPUTexture;
  view: GPUTextureView;
}

export const image = (texture: WebGLTexture): GpuImage => texture as GpuImage;
