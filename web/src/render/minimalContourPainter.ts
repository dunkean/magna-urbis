/** Optional motion-only contour pass for MinimalRenderer. Terrain-owned world segments are uploaded once; a frame
 * selects a retained scale level and draws one instanced strip pass, clipped by the GPU to the view. Canvas receives
 * that transparent pass below water and buildings. Rest/captures use the original exact Canvas paths. Without a
 * hardware WebGL2 context, or after context loss, the same painter falls back to those Canvas paths.
 */
import type { View } from './view';
import type { MinimalContourSet } from './minimalContours';
import { PALETTES } from './styles';
import { SOFTWARE_GL } from './softwareGl';

const VERTEX = `#version 300 es
layout(location=0) in vec4 aSegment;
layout(location=1) in float aWeight;
uniform vec4 uView;
uniform vec2 uPixel, uClip;
uniform float uDpr;
out vec2 vDistance;
flat out vec3 vLook;
void main() {
  vec2 delta = (aSegment.zw - aSegment.xy) * uPixel;
  float len = length(delta), halfWidth = mix(0.45, 0.65, aWeight) * uDpr * 0.5;
  vec2 dir = delta / max(len, 1e-6), normal = vec2(-dir.y, dir.x);
  float side = (gl_VertexID & 1) == 0 ? -1.0 : 1.0;
  bool end = gl_VertexID >= 2;
  float reach = halfWidth + 1.0;
  vec2 point = end ? aSegment.zw : aSegment.xy;
  vec2 offset = normal * side * reach + dir * (end ? reach : -reach);
  gl_Position = vec4(point * uView.xy + uView.zw + offset * uClip, 0.0, 1.0);
  vDistance = vec2(end ? len + reach : -reach, side * reach);
  vLook = vec3(len, halfWidth, mix(0.26, 0.4, aWeight));
}`;
const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vDistance;
flat in vec3 vLook;
uniform vec3 uInk;
out vec4 outColor;
void main() {
  float beyond = max(max(-vDistance.x, vDistance.x - vLook.x), 0.0);
  float distance = length(vec2(beyond, vDistance.y));
  float alpha = clamp(vLook.y + 0.5 - distance, 0.0, 1.0) * vLook.z;
  outColor = vec4(uInk * alpha, alpha);
}`;

interface Level {
  scale: number;
  vao: WebGLVertexArrayObject;
  buffer: WebGLBuffer;
  count: number;
}
export interface MinimalContourPainter {
  set(contours: MinimalContourSet): void;
  draw(view: View, width: number, height: number, dpr: number): HTMLCanvasElement | undefined;
  dispose(): void;
}

export function createMinimalContourPainter(): MinimalContourPainter | undefined {
  if (typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas');
  let context: WebGL2RenderingContext | null;
  try {
    context = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  } catch {
    return undefined;
  }
  if (!context) return undefined;
  const gl = context;
  const debug = gl.getExtension('WEBGL_debug_renderer_info'),
    renderer = String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER));
  const lose = (): void => gl.getExtension('WEBGL_lose_context')?.loseContext();
  if (SOFTWARE_GL.test(renderer)) {
    lose();
    return undefined;
  }
  const program = gl.createProgram()!,
    shaders: WebGLShader[] = [];
  try {
    for (const [type, source] of [
      [gl.VERTEX_SHADER, VERTEX],
      [gl.FRAGMENT_SHADER, FRAGMENT],
    ] as const) {
      const shader = gl.createShader(type)!;
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Contour program unavailable');
  } catch {
    gl.deleteProgram(program);
    lose();
    return undefined;
  } finally {
    for (const shader of shaders) gl.deleteShader(shader);
  }
  const uniforms = Object.fromEntries(['uView', 'uPixel', 'uClip', 'uDpr', 'uInk'].map(name => [name, gl.getUniformLocation(program, name)])),
    hex = parseInt(PALETTES.minimal.inkSoft.slice(1), 16);
  gl.useProgram(program);
  gl.uniform3f(uniforms.uInk, (hex >> 16) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
  let retained: MinimalContourSet | undefined,
    levels: Level[] = [],
    lost = false;
  const onLost = (event: Event): void => {
    event.preventDefault();
    lost = true;
  };
  canvas.addEventListener('webglcontextlost', onLost);
  const drop = (): void => {
    for (const level of levels) {
      gl.deleteBuffer(level.buffer);
      gl.deleteVertexArray(level.vao);
    }
    levels = [];
  };
  return {
    set(contours) {
      if (lost || retained === contours) return;
      drop();
      retained = contours;
      for (const level of contours.levels) {
        const buffer = gl.createBuffer()!,
          vao = gl.createVertexArray()!;
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, level.segments, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 20, 0);
        gl.vertexAttribDivisor(0, 1);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 16);
        gl.vertexAttribDivisor(1, 1);
        levels.push({ scale: level.scale, buffer, vao, count: level.segments.length / 5 });
      }
      gl.bindVertexArray(null);
    },
    draw(view, width, height, dpr) {
      if (lost || gl.isContextLost() || !levels.length) return undefined;
      const scale = view.scale * dpr,
        level = levels.find(level => scale <= level.scale);
      // Beyond the retained detail: use the exact Canvas paths, without building a level in a frame.
      if (!level) return undefined;
      const w = Math.max(1, Math.round(width * dpr)),
        h = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(program);
      gl.uniform4f(uniforms.uView, (2 * scale) / w, (-2 * scale) / h, (-2 * view.cx * scale) / w, (2 * view.cy * scale) / h);
      gl.uniform2f(uniforms.uPixel, scale, scale);
      gl.uniform2f(uniforms.uClip, 2 / w, -2 / h);
      gl.uniform1f(uniforms.uDpr, dpr);
      gl.bindVertexArray(level.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, level.count);
      return canvas;
    },
    dispose() {
      canvas.removeEventListener('webglcontextlost', onLost);
      if (!lost) {
        drop();
        gl.deleteProgram(program);
      }
      lost = true;
      retained = undefined;
      canvas.width = canvas.height = 0;
      lose();
    },
  };
}
