/**
 * The shaped ground of the towns (groundShape.ts) as the terrain shader reads it: a texture array of the drawn heights, one
 * layer per block, and the layer of each block of the map. Owned by the draped ground (drapedGround.ts), uploaded once per
 * shape; a map without shaped ground binds one empty texel of each. GROUND_SHAPE_GLSL is the reader of the vertex shader.
 * The squeeze of the roads on steep slopes (render/steepRoads.ts) is a second array over the same blocks, read per pixel:
 * ROAD_SQUEEZE_FIELD_GLSL is the reader of the fragment shader.
 */
import { ROAD_SQUEEZE_GLSL } from '../steepRoads';
import { SHAPE_BLOCK, SHAPE_SIDE, SHAPE_STEP, SQUEEZE_SIDE, SQUEEZE_STEP, type GroundShape } from './groundShape';

/** `shapeMove(p)`: metres the ground is drawn above (below) the natural ground at the map point p. Two squares of the
 * terrain that share a vertex compute the same p, so the shaped ground has no crack. */
export const GROUND_SHAPE_GLSL = `
uniform highp sampler2DArray uShape;
uniform highp isampler2D uShapeIndex;
// Blocks per side of the map; 0: natural ground.
uniform int uShapeSide;
int shapeLayer(vec2 p) {
  ivec2 block = ivec2(floor(p / ${SHAPE_BLOCK}.0));
  if (any(lessThan(block, ivec2(0))) || any(greaterThanEqual(block, ivec2(uShapeSide)))) return -1;
  return texelFetch(uShapeIndex, block, 0).r;
}
float shapeMove(vec2 p) {
  int layer = shapeLayer(p);
  if (layer < 0) return 0.0;
  vec2 node = (p - floor(p / ${SHAPE_BLOCK}.0) * ${SHAPE_BLOCK}.0) / ${SHAPE_STEP}.0;
  return textureLod(uShape, vec3((node + 0.5) / ${SHAPE_SIDE}.0, float(layer)), 0.0).r;
}`;

/** `roadSqueeze(p, rise)`: metres to add to the map point p to find the picture drawn there, for `rise` metres drawn
 * per metre of height. */
export const ROAD_SQUEEZE_FIELD_GLSL = `
uniform highp sampler2DArray uSqueeze;
uniform highp isampler2D uShapeIndex;
// Blocks per side of the map; 0: no road is squeezed.
uniform int uSqueezeSide;
${ROAD_SQUEEZE_GLSL}
vec2 roadSqueeze(vec2 p, float rise) {
  ivec2 block = ivec2(floor(p / ${SHAPE_BLOCK}.0));
  if (any(lessThan(block, ivec2(0))) || any(greaterThanEqual(block, ivec2(uSqueezeSide)))) return vec2(0.0);
  int layer = texelFetch(uShapeIndex, block, 0).r;
  if (layer < 0) return vec2(0.0);
  vec2 node = (p - vec2(block) * ${SHAPE_BLOCK}.0) / ${SQUEEZE_STEP}.0;
  return squeezePush(textureLod(uSqueeze, vec3((node + 0.5) / ${SQUEEZE_SIDE}.0, float(layer)), 0.0), rise);
}`;

export class GroundShapeTexture {
  private layers?: WebGLTexture;
  private squeeze?: WebGLTexture;
  private index?: WebGLTexture;
  private uploaded?: GroundShape;
  /** Blocks per side of the map on the GPU (uShapeSide), and the same where a road is squeezed (uSqueezeSide). */
  side = 0;
  squeezeSide = 0;

  constructor(private readonly gl: WebGL2RenderingContext) {}

  /** The shape on the GPU. */
  get current(): GroundShape | undefined {
    return this.uploaded;
  }

  /** Puts `shape` on the GPU when it is another one. */
  prepare(shape: GroundShape | undefined): void {
    if (this.layers && this.uploaded === shape) return;
    const gl = this.gl;
    this.dispose();
    this.uploaded = shape;
    const count = Math.max(1, Math.min(shape?.drawn.length ?? 0, Number(gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS)) || 256)),
      size = shape ? SHAPE_SIDE : 1,
      side = shape?.side ?? 1,
      index = shape ? Int16Array.from(shape.index, layer => (layer < count ? layer : -1)) : Int16Array.of(-1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.layers = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.layers);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R16F, size, size, count);
    if (shape) for (let layer = 0; layer < count; layer++) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, size, size, 1, gl.RED, gl.FLOAT, shape.drawn[layer]);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // The squeeze: a layer per block when a road is squeezed, the blocks without one left at zero.
    const squeezed = !!shape?.squeezed,
      squeezeSize = squeezed ? SQUEEZE_SIDE : 1;
    this.squeeze = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.squeeze);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA16F, squeezeSize, squeezeSize, squeezed ? count : 1);
    for (let layer = 0; squeezed && layer < count; layer++) {
      const nodes = shape!.squeeze[layer];
      if (nodes) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, squeezeSize, squeezeSize, 1, gl.RGBA, gl.FLOAT, nodes);
    }
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    this.index = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.index);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R16I, side, side);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, side, side, gl.RED_INTEGER, gl.SHORT, index);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    this.side = shape ? shape.side : 0;
    this.squeezeSide = squeezed ? shape!.side : 0;
  }
  /** Binds the three textures to the units `unit` (heights), `unit + 1` (index) and `unit + 2` (squeeze), or unbinds them. */
  bind(unit: number, on = true): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, on ? (this.layers ?? null) : null);
    gl.activeTexture(gl.TEXTURE0 + unit + 1);
    gl.bindTexture(gl.TEXTURE_2D, on ? (this.index ?? null) : null);
    gl.activeTexture(gl.TEXTURE0 + unit + 2);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, on ? (this.squeeze ?? null) : null);
  }
  /** Every handle is dead: forget them. */
  contextLost(): void {
    this.layers = this.squeeze = this.index = this.uploaded = undefined;
    this.side = this.squeezeSide = 0;
  }
  dispose(): void {
    if (this.layers) this.gl.deleteTexture(this.layers);
    if (this.squeeze) this.gl.deleteTexture(this.squeeze);
    if (this.index) this.gl.deleteTexture(this.index);
    this.contextLost();
  }
}
