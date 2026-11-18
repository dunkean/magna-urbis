/**
 * The WebGPU view's texture handles (texture and view) as they travel through the parts' opaque texture fields, and
 * mip counts.
 */
export const mipCount = (width: number, height: number): number => Math.floor(Math.log2(Math.max(width, height, 1))) + 1;

export interface GpuImage {
  texture: GPUTexture;
  view: GPUTextureView;
}

export const image = (texture: WebGLTexture): GpuImage => texture as GpuImage;
