/**
 * Vertex and bind-group layouts of the WebGPU terrain view, with the small WGSL of mipmap generation and depth readback.
 */
import * as WGSL from '../../terrain3dWgsl.generated';
import { TREE_STRIDE } from '../../terrain3dTrees';

export const SAMPLES = 4,
  DEPTH: GPUTextureFormat = 'depth32float';

export const T = WGSL.WGSL3D_TEXTURES;

export const TERRAIN_TEXTURES = [
  'material',
  'previousMaterial',
  'macroField',
  'uShoreRing',
  'canopyWater',
  'previousCanopyWater',
  'uForestField',
  'uForestBank',
  'uOccupation',
  'uLandDetail',
  'uForestBeach',
  'uForestBrushAtlas',
  'semanticTile',
  'previousSemanticTile',
  'drapedMaterial',
  'previousDrapedMaterial',
] as const;

export type TerrainTexture = (typeof TERRAIN_TEXTURES)[number];

export const PATCH_BUFFERS: GPUVertexBufferLayout[] = [
  {
    arrayStride: 40,
    attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' },
      { shaderLocation: 1, offset: 12, format: 'float32x2' },
      { shaderLocation: 2, offset: 20, format: 'float32x2' },
      { shaderLocation: 3, offset: 28, format: 'float32' },
      { shaderLocation: 4, offset: 32, format: 'float32x2' },
    ],
  },
  { arrayStride: 12, attributes: [{ shaderLocation: 5, offset: 0, format: 'float32x3' }] },
];

export const BILLBOARD_BUFFERS: GPUVertexBufferLayout[] = [
  {
    arrayStride: 48,
    stepMode: 'instance',
    attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x4' },
      { shaderLocation: 1, offset: 16, format: 'float32x4' },
      { shaderLocation: 2, offset: 32, format: 'float32x4' },
    ],
  },
];

export const TREE_BUFFERS: GPUVertexBufferLayout[] = [
  {
    arrayStride: TREE_STRIDE * 4,
    stepMode: 'instance',
    attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x4' },
      { shaderLocation: 1, offset: 16, format: 'float32x4' },
      { shaderLocation: 2, offset: 32, format: 'float32x4' },
    ],
  },
];

export const ROOF_BUFFERS: GPUVertexBufferLayout[] = [
  {
    arrayStride: 20,
    attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' },
      { shaderLocation: 1, offset: 12, format: 'float32x2' },
    ],
  },
];

export const BUILDING_BUFFERS: Record<'color' | 'tex', GPUVertexBufferLayout[]> = {
  color: [
    {
      arrayStride: 40,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' },
        { shaderLocation: 2, offset: 24, format: 'float32x3' },
        { shaderLocation: 4, offset: 36, format: 'float32' },
      ],
    },
  ],
  tex: [
    {
      arrayStride: 40,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' },
        { shaderLocation: 2, offset: 24, format: 'float32x2' },
        { shaderLocation: 3, offset: 32, format: 'float32' },
        { shaderLocation: 4, offset: 36, format: 'float32' },
      ],
    },
  ],
};

/** Mipmaps: each level is drawn from the previous one with bilinear taps at the 2×2 block centres. */
export const MIP_WGSL = `
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;
struct Varying { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn vs(@builtin(vertex_index) i: u32) -> Varying {
  let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  return Varying(vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0), vec2<f32>(p.x, 1.0 - p.y));
}
@fragment fn fs(v: Varying) -> @location(0) vec4<f32> { return textureSampleLevel(source, linearSampler, v.uv, 0.0); }`;

/** Illustration depth: sample 0 of the multisampled depth buffer, as a float target that can be read back. */
export const DEPTH_WGSL = `
@group(0) @binding(0) var depth: texture_depth_multisampled_2d;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> { return vec4<f32>(textureLoad(depth, vec2<i32>(p.xy), 0), 0.0, 0.0, 1.0); }`;
