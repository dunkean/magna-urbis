/** City Bench WebGL2 prototype renderer. The mesh (cityGlMesh) is uploaded once per
 * plan; a camera change only updates one uniform and issues a fixed handful of draw
 * calls (no per-item JavaScript, no Path2D), whatever the city size. A view or
 * palette change rewrites the per-feature colour texture (4 bytes per feature).
 * Labels, landmark glyphs and selection stay on a small Canvas 2D overlay, and
 * picking keeps the CPU spatial bins of cityCanvas (exact polygon test per click). */
import type { CityBuildings, CityLod, CityScene, CityView } from './cityCanvas';
import type { CityGlMesh } from './cityGlMesh';

export interface CityGlBox { minX: number; minY: number; maxX: number; maxY: number }
export interface CityGlDrawOptions { viewport: CityGlBox; mpp: number; lod: CityLod; view: CityView; outlines?: boolean; buildings?: boolean }
export interface CityGlFrame { drawCalls: number; instances: number; triangles: number; cpuMs: number }

const FILL_VS = `#version 300 es
in vec2 aPos; in uint aFeature;
uniform vec4 uView; uniform highp sampler2D uColors; uniform vec4 uTint;
out vec4 vColor;
void main() {
  gl_Position = vec4(aPos * uView.xy + uView.zw, 0.0, 1.0);
  int f = int(aFeature);
  vColor = uTint.a > 0.0 ? uTint : texelFetch(uColors, ivec2(f & 4095, f >> 12), 0);
}`;
const STREET_VS = `#version 300 es
in vec4 aSeg; in vec2 aWidthRank; in uint aFeature;
uniform vec4 uView; uniform highp sampler2D uColors; uniform float uMpp; uniform float uEdgePx; uniform float uCasing;
out vec4 vColor;
void main() {
  float t = float(gl_VertexID >> 1), side = (gl_VertexID & 1) == 0 ? -1.0 : 1.0;
  vec2 a = aSeg.xy, b = aSeg.zw, d = b - a; float len = length(d);
  vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0), n = vec2(-dir.y, dir.x);
  float r = aWidthRank.y;
  float minPx = r < 0.5 ? 3.0 : r < 1.5 ? 2.4 : r < 2.5 ? 1.6 : r < 3.5 ? 1.1 : 0.8;
  float hw = 0.5 * max(aWidthRank.x, minPx * uMpp) + uCasing * uEdgePx * uMpp;
  vec2 p = mix(a, b, t) + n * side * hw + dir * (t * 2.0 - 1.0) * hw;
  gl_Position = vec4(p * uView.xy + uView.zw, 0.0, 1.0);
  int f = int(aFeature);
  vec4 c = texelFetch(uColors, ivec2(f & 4095, f >> 12), 0);
  vColor = uCasing > 0.5 ? vec4(c.rgb * 0.5, c.a) : c;
}`;
const FS = `#version 300 es
precision mediump float;
in vec4 vColor; out vec4 outColor;
void main() { if (vColor.a <= 0.0) discard; outColor = vec4(vColor.rgb * vColor.a, vColor.a); }`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram()!;
  for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const shader = gl.createShader(type)!; gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader');
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link');
  return program;
}

export class CityGlRenderer {
  readonly gl: WebGL2RenderingContext;
  private fill: WebGLProgram; private street: WebGLProgram;
  private fillVao?: WebGLVertexArrayObject; private streetVao?: WebGLVertexArrayObject; private lineBuffer?: WebGLBuffer; private triangleBuffer?: WebGLBuffer;
  private colors: WebGLTexture; private mesh?: CityGlMesh;
  private buffers: WebGLBuffer[] = [];
  constructor(readonly canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: true, alpha: true }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 indisponible');
    this.gl = gl;
    this.fill = compile(gl, FILL_VS, FS); this.street = compile(gl, STREET_VS, FS);
    this.colors = gl.createTexture()!;
  }
  /** Upload once per plan. Returns the CPU time spent in the upload calls. */
  upload(mesh: CityGlMesh): number {
    const gl = this.gl, start = performance.now();
    for (const b of this.buffers) gl.deleteBuffer(b);
    this.buffers = [];
    const buffer = (target: number, data: ArrayBufferView): WebGLBuffer => { const b = gl.createBuffer()!; gl.bindBuffer(target, b); gl.bufferData(target, data, gl.STATIC_DRAW); this.buffers.push(b); return b; };
    this.fillVao = gl.createVertexArray()!; gl.bindVertexArray(this.fillVao);
    buffer(gl.ARRAY_BUFFER, mesh.positions);
    let loc = gl.getAttribLocation(this.fill, 'aPos'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    buffer(gl.ARRAY_BUFFER, mesh.vertexFeatures);
    loc = gl.getAttribLocation(this.fill, 'aFeature'); gl.enableVertexAttribArray(loc); gl.vertexAttribIPointer(loc, 1, gl.UNSIGNED_INT, 0, 0);
    this.triangleBuffer = buffer(gl.ELEMENT_ARRAY_BUFFER, mesh.triangles);
    gl.bindVertexArray(null);
    this.lineBuffer = buffer(gl.ELEMENT_ARRAY_BUFFER, mesh.lines);
    this.streetVao = gl.createVertexArray()!; gl.bindVertexArray(this.streetVao);
    buffer(gl.ARRAY_BUFFER, mesh.segments);
    loc = gl.getAttribLocation(this.street, 'aSeg'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 24, 0); gl.vertexAttribDivisor(loc, 1);
    loc = gl.getAttribLocation(this.street, 'aWidthRank'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 24, 16); gl.vertexAttribDivisor(loc, 1);
    buffer(gl.ARRAY_BUFFER, mesh.segmentFeatures);
    loc = gl.getAttribLocation(this.street, 'aFeature'); gl.enableVertexAttribArray(loc); gl.vertexAttribIPointer(loc, 1, gl.UNSIGNED_INT, 0, 0); gl.vertexAttribDivisor(loc, 1);
    gl.bindVertexArray(null);
    this.mesh = mesh;
    return performance.now() - start;
  }
  /** Per-feature RGBA (feature ids of the mesh), 4096 features per texture row. */
  setColors(rgba: Uint8Array): void {
    const gl = this.gl, rows = Math.max(1, Math.ceil(rgba.length / 4 / 4096)), padded = new Uint8Array(rows * 4096 * 4); padded.set(rgba);
    gl.bindTexture(gl.TEXTURE_2D, this.colors);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 4096, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, padded);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }
  draw(o: CityGlDrawOptions): CityGlFrame {
    const gl = this.gl, mesh = this.mesh, start = performance.now(), frame: CityGlFrame = { drawCalls: 0, instances: 0, triangles: 0, cpuMs: 0 };
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    if (!mesh) return frame;
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const { viewport: v } = o, sx = 2 / (v.maxX - v.minX), sy = -2 / (v.maxY - v.minY);
    const view = [sx, sy, -1 - (v.minX - mesh.origin.x) * sx, 1 - (v.minY - mesh.origin.y) * sy];
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.colors);
    // Fills and outlines.
    gl.useProgram(this.fill);
    gl.uniform4fv(gl.getUniformLocation(this.fill, 'uView'), view); gl.uniform1i(gl.getUniformLocation(this.fill, 'uColors'), 0);
    const tint = gl.getUniformLocation(this.fill, 'uTint');
    gl.bindVertexArray(this.fillVao!);
    const tris = (layer: keyof CityGlMesh['fillRanges']): void => {
      const r = mesh.fillRanges[layer]; if (!r.count) return;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.triangleBuffer!);
      gl.drawElements(gl.TRIANGLES, r.count, gl.UNSIGNED_INT, r.start * 4); frame.drawCalls++; frame.triangles += r.count / 3;
    };
    const lines = (layer: keyof CityGlMesh['lineRanges'], rgba: number[]): void => {
      const r = mesh.lineRanges[layer]; if (!r.count) return;
      gl.uniform4fv(tint, rgba); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.lineBuffer!);
      gl.drawElements(gl.LINES, r.count, gl.UNSIGNED_INT, r.start * 4); frame.drawCalls++;
    };
    gl.uniform4fv(tint, [0, 0, 0, 0]);
    const near = o.lod === 'near' || o.lod === 'close', parcels = o.view !== 'tissue' && (near || o.view === 'roles' || o.view === 'uses');
    if (o.lod === 'far') tris('footprint');
    else { tris('blocks'); if (parcels) tris('parcels'); }
    const buildings = (o.buildings ?? true) && near && (o.view === 'buildings' || o.view === 'roles');
    if (buildings) tris('buildings');
    // Outlines share the vertex buffer but need the line index buffer.
    if (o.outlines ?? near) {
      if (o.lod === 'close' || o.view === 'parcels') lines('parcels', [0.4, 0.35, 0.28, 0.9]);
      lines('blocks', [0.4, 0.35, 0.28, 1]);
      if (buildings && o.lod === 'close') lines('buildings', [0.18, 0.15, 0.11, 1]);
    }
    gl.bindVertexArray(null);
    // Streets: casing then fill, one instanced call each, rank threshold by LOD.
    const maxRank = o.lod === 'far' ? 1 : o.lod === 'mid' ? 2 : 9, first = mesh.rankStart[maxRank], count = mesh.segments.length / 6 - first;
    if (count > 0) {
      gl.useProgram(this.street); gl.bindVertexArray(this.streetVao!);
      gl.uniform4fv(gl.getUniformLocation(this.street, 'uView'), view); gl.uniform1i(gl.getUniformLocation(this.street, 'uColors'), 0);
      gl.uniform1f(gl.getUniformLocation(this.street, 'uMpp'), o.mpp);
      gl.uniform1f(gl.getUniformLocation(this.street, 'uEdgePx'), o.lod === 'far' ? 0 : o.lod === 'mid' ? 0.7 : 0.9);
      // Instance offset: rebase the per-instance attributes (WebGL2 has no baseInstance).
      const rebase = (offset: number): void => {
        const loc = (n: string): number => gl.getAttribLocation(this.street, n);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[this.buffers.length - 2]);
        gl.vertexAttribPointer(loc('aSeg'), 4, gl.FLOAT, false, 24, offset * 24); gl.vertexAttribPointer(loc('aWidthRank'), 2, gl.FLOAT, false, 24, offset * 24 + 16);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[this.buffers.length - 1]); gl.vertexAttribIPointer(loc('aFeature'), 1, gl.UNSIGNED_INT, 0, offset * 4);
      };
      rebase(first);
      for (const casing of o.lod === 'far' ? [0] : [1, 0]) {
        gl.uniform1f(gl.getUniformLocation(this.street, 'uCasing'), casing);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count); frame.drawCalls++; frame.instances += count;
      }
      gl.bindVertexArray(null);
    }
    frame.cpuMs = performance.now() - start;
    return frame;
  }
  dispose(): void { const gl = this.gl; for (const b of this.buffers) gl.deleteBuffer(b); gl.deleteTexture(this.colors); gl.deleteProgram(this.fill); gl.deleteProgram(this.street); }
}

// ---------------------------------------------------------------- colours
const hex = (c: string, a = 1): [number, number, number, number] => { const v = parseInt(c.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255, Math.round(a * 255)]; };
const ZONES: Record<string, string> = { core: '#dfb973', middle: '#bfa4ca', edge: '#91bdc5', faubourg: '#a0bc84', village: '#dfb973' };
const OPEN: Record<string, string> = { garden: '#a8bc89', reserve: '#cbc2a8', common: '#adc5bf', market: '#ead39a', place: '#e6d1a5' };
/** Colour table of a view (an approximation of drawCity's palette, enough to judge cost and legibility). */
export function cityGlColors(scene: CityScene, buildings: CityBuildings | undefined, mesh: CityGlMesh, view: CityView): Uint8Array {
  const out = new Uint8Array(mesh.features.total * 4), put = (id: number, c: [number, number, number, number]): void => { out.set(c, id * 4); };
  scene.footprint.forEach((_, i) => put(mesh.features.footprint + i, hex('#cfb589', 0.9)));
  scene.blocks.forEach((b, i) => {
    const reserve = b.kind.startsWith('reserve');
    put(mesh.features.blocks + i, hex(reserve ? '#cbc2a8' : b.kind === 'common' ? '#adc5bf' : b.kind === 'place' ? '#e8d6ae' : view === 'buildings' ? '#ece2cb' : ZONES[b.zone] ?? ZONES.core, b.peripheral && view !== 'buildings' ? 0.6 : 1));
  });
  scene.parcels.forEach((p, i) => {
    const open = OPEN[p.use];
    if (view === 'parcels') put(mesh.features.parcels + i, hex(open ?? ZONES[p.zone] ?? ZONES.core, p.peripheral ? 0.65 : 1));
    else if (view === 'buildings') put(mesh.features.parcels + i, open ? hex(open) : [0, 0, 0, 0]);
    else put(mesh.features.parcels + i, open ? hex(open) : p.allocation ? hex('#c8862a', 0.45) : [0, 0, 0, 0]);
  });
  buildings?.items.forEach((b, i) => put(mesh.features.buildings + i, hex(b.landmark ? '#3f3329' : '#5a4b3c')));
  scene.streets.forEach((s, i) => put(mesh.features.streets + i, hex(s.role === 'bridge' ? '#ddd3c2' : s.role === 'ford' ? '#b9d0d6' : s.rank <= 1 ? '#f6e3b8' : '#f3dfb3')));
  return out;
}
