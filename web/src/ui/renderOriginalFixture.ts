export type OriginalFormat = 'RF' | 'RGF' | 'RGBA8' | 'R8';
export interface OriginalTexture {
  key: string; width: number; height: number; format: OriginalFormat; glFormat: string;
  levels: Uint8Array[]; sampler: { min: string; mag: string; wrapS: string; wrapT: string };
  generated?: boolean;
}
export interface OriginalDraw {
  program: 'terrain' | 'river' | 'composite' | 'renderWater';
  uniforms: Record<string, number | boolean | number[]>;
  textures: Record<string, string>;
  samplers?: Record<string, {min:string;mag:string;wrapS:string;wrapT:string}>;
  clear?: {color:number[]};
  target: string; primitive: string; instances: number;
  blend: Record<string, string | boolean>; viewport: number[];
}
export function textureDescriptor(texture: OriginalTexture) {
  let offset = 0;
  const mips = texture.levels.map((data, lod) => {
    const result = { width: Math.max(1, texture.width >> lod), height: Math.max(1, texture.height >> lod), byteOffset: offset, byteLength: data.byteLength };
    offset += data.byteLength; return result;
  });
  return { file: `data/${texture.key}.bin`, width: texture.width, height: texture.height, format: texture.format, glFormat: texture.glFormat, mips, sampler: { ...texture.sampler } };
}
export function copyUpload(view: ArrayBufferView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
}
