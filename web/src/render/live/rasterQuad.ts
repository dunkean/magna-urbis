/**
 * Rasters of the compositor: an image uploaded once as a texture and drawn as one quad.
 *
 * Three things are drawn this way: the stand-in of a layer (its last exact raster, placed on the world square it was
 * painted for), the vector water raster of the page, and the resolved isolated group over the frame.
 */

/** An image and the world square (map metres) it covers. `source` waits for its upload while `pending`. */
export interface Raster {
  texture?: WebGLTexture;
  source?: TexImageSource;
  pending: boolean;
  mipmaps: boolean;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface RasterQuad {
  /** Premultiplied source-over quad; corners in clip space, (x0, y0) is the texel (0, 0). */
  draw(texture: WebGLTexture, x0: number, y0: number, x1: number, y1: number, opacity: number): void;
  dispose(): void;
}

const QUAD_VS = `#version 300 es
uniform vec4 uRect;
out vec2 vUv;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vUv = c;
  gl_Position = vec4(mix(uRect.xy, uRect.zw, c), 0.0, 1.0);
}`;
const QUAD_FS = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
uniform float uOpacity;
in vec2 vUv;
out vec4 color;
void main() { color = texture(uTex, vUv) * uOpacity; }`;

/** Undefined when the context cannot build the program (it is then treated as lost). */
export function createRasterQuad(gl: WebGL2RenderingContext): RasterQuad | undefined {
  const shader = (type: number, source: string): WebGLShader | null => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, source);
    gl.compileShader(s);
    return s;
  };
  const vs = shader(gl.VERTEX_SHADER, QUAD_VS),
    fs = shader(gl.FRAGMENT_SHADER, QUAD_FS),
    program = gl.createProgram(),
    vao = gl.createVertexArray();
  if (!vs || !fs || !program || !vao) return undefined;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  // Once per context, never in a frame: a broken link would otherwise draw nothing without a word.
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('Live compositor: quad program', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    gl.deleteVertexArray(vao);
    return undefined;
  }
  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, 'uTex'), 0);
  gl.useProgram(null);
  const rect = gl.getUniformLocation(program, 'uRect'),
    alpha = gl.getUniformLocation(program, 'uOpacity');
  return {
    draw(texture, x0, y0, x1, y1, opacity) {
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform4f(rect, x0, y0, x1, y1);
      gl.uniform1f(alpha, opacity);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindVertexArray(null);
      gl.useProgram(null);
    },
    dispose() {
      gl.deleteProgram(program);
      gl.deleteVertexArray(vao);
    },
  };
}

function sourceSize(source: TexImageSource): { width: number; height: number } {
  const s = source as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number; displayWidth?: number; displayHeight?: number };
  return { width: s.naturalWidth || s.videoWidth || s.displayWidth || s.width || 0, height: s.naturalHeight || s.videoHeight || s.displayHeight || s.height || 0 };
}

export function dropRaster(gl: WebGL2RenderingContext, raster: Raster): void {
  if (raster.texture) gl.deleteTexture(raster.texture);
  raster.texture = undefined;
  raster.pending = false;
}

/** One upload per source: a 2D canvas goes up premultiplied, as the blending of every layer expects. A source larger
 * than `maxTexture`, or one the context refuses, leaves the raster without a texture. */
export function uploadRaster(gl: WebGL2RenderingContext, raster: Raster, maxTexture: number): void {
  raster.pending = false;
  const source = raster.source;
  if (!source) return;
  const size = sourceSize(source);
  if (!(size.width > 0) || !(size.height > 0) || size.width > maxTexture || size.height > maxTexture) {
    dropRaster(gl, raster);
    return;
  }
  raster.texture ??= gl.createTexture() ?? undefined;
  if (!raster.texture) return;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, raster.texture);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  let failed = false;
  try {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  } catch {
    failed = true;
  }
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
  if (!failed) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, raster.mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (raster.mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
  }
  gl.bindTexture(gl.TEXTURE_2D, null);
  if (failed) dropRaster(gl, raster);
}
