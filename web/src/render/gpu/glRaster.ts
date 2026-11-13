import {
  GpuRasterError, IDENTITY, SPRITE_STRIDE,
  type ClipNode, type Composite, type DisplayList, type FillRule, type GpuRasterizer, type ImageSource,
  type Mat, type Paint, type PathGeometry, type RecordedPath, type SpriteOp, type StrokeOp,
} from './displayList';
import { DISC_STRIDE, JOIN_STRIDE, SEGMENT_STRIDE, fillFans, strokeSegments, type StrokeGeometry } from './tessellate';

const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|basic render|microsoft warp|software/i;
const BUDGET = 256 * 1024 * 1024;
/** Textures (patterns, sprite atlases, cut masks) beyond this are dropped least recently used first, never during the render that uses them. */
const TEXTURE_BUDGET = 256 * 1024 * 1024;
const SPRITE_BUDGET = 128 * 1024 * 1024;
type Box = readonly [number, number, number, number];
type Surface = HTMLCanvasElement | OffscreenCanvas;

function compose(a: Mat, b: Mat): Mat {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}
function inverse(m: Mat): Mat | null {
  const d = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(d) || Math.abs(d) < 1e-30) return null;
  return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
}
function matrix(m: Mat): Float32Array { return new Float32Array([m[0], m[1], 0, m[2], m[3], 0, m[4], m[5], 1]); }
function scale(m: Mat): number { return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])); }
function tolerance(m: Mat): number {
  // Largest singular value keeps the flattening error <= .25 px even under shear.
  const a = m[0] * m[0] + m[1] * m[1], b = m[2] * m[2] + m[3] * m[3], c = m[0] * m[2] + m[1] * m[3];
  const s = Math.sqrt((a + b + Math.hypot(a - b, 2 * c)) / 2);
  return 2 ** Math.max(-40, Math.min(40, Math.floor(Math.log2(.25 / Math.max(s, 1e-12)))));
}
function transformedBox(b: Box, m: Mat, pad = 0): Box {
  if (b[2] < b[0] || b[3] < b[1]) return [Infinity, Infinity, -Infinity, -Infinity];
  const x0 = m[0] * b[0], x1 = m[0] * b[2], x2 = m[2] * b[1], x3 = m[2] * b[3];
  const y0 = m[1] * b[0], y1 = m[1] * b[2], y2 = m[3] * b[1], y3 = m[3] * b[3];
  return [Math.min(x0, x1) + Math.min(x2, x3) + m[4] - pad, Math.min(y0, y1) + Math.min(y2, y3) + m[5] - pad,
    Math.max(x0, x1) + Math.max(x2, x3) + m[4] + pad, Math.max(y0, y1) + Math.max(y2, y3) + m[5] + pad];
}
const overlaps = (a: Box, b: Box): boolean => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
const union = (a: Box, b: Box): Box => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
const intersect = (a: Box, b: Box): Box => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];

const COMMON_VS = `
precision highp float;
uniform vec2 uViewport;
uniform mat3 uMatrix, uInverse;
vec2 device(vec2 p) { return (uMatrix * vec3(p, 1.0)).xy; }
vec4 position(vec2 p) { return vec4(p / uViewport * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0); }
vec2 corner(int i) { return vec2(float(i & 1), float(i >> 1)); }
`;
const FAN_VS = `#version 300 es
${COMMON_VS}
layout(location=0) in vec2 aPoint;
void main() { gl_Position = position(device(aPoint)); }
`;
const EMPTY_FS = `#version 300 es
precision highp float;
out vec4 outColor;
void main() { outColor = vec4(0.0); }
`;
const COVER_VS = `#version 300 es
${COMMON_VS}
uniform vec4 uBox;
uniform vec4 uRect;
uniform int uRectMode;
out vec2 vUser;
void main() {
  vec2 p = uRectMode == 0 ? mix(uBox.xy, uBox.zw, corner(gl_VertexID)) : device(uRect.xy + corner(gl_VertexID) * uRect.zw);
  vUser = (uInverse * vec3(p, 1.0)).xy;
  gl_Position = position(p);
}
`;
const PAINT_FS = `
uniform int uPattern;
uniform sampler2D uImage;
uniform mat3 uPatternInverse;
uniform vec2 uImageSize;
uniform ivec2 uRepeat;
uniform vec4 uColor;
uniform float uAlpha;
in vec2 vUser;
vec4 paint() {
  if (uPattern == 0) return vec4(uColor.rgb * uColor.a, uColor.a) * uAlpha;
  vec2 uv = (uPatternInverse * vec3(vUser, 1.0)).xy / uImageSize;
  // Gradients of the unwrapped coordinates: the mip level stays continuous across the fract() seam.
  vec2 gx = dFdx(uv), gy = dFdy(uv);
  if ((uRepeat.x == 0 && (uv.x < 0.0 || uv.x >= 1.0)) || (uRepeat.y == 0 && (uv.y < 0.0 || uv.y >= 1.0))) return vec4(0.0);
  if (uRepeat.x != 0) uv.x = fract(uv.x);
  if (uRepeat.y != 0) uv.y = fract(uv.y);
  return textureGrad(uImage, uv, gx, gy) * uAlpha;
}
`;
const COVER_FS = `#version 300 es
precision highp float;
${PAINT_FS}
out vec4 outColor;
void main() { outColor = paint(); }
`;

// Segment, disc and wedge instances share a program and one arena buffer layout.
const STROKE_VS = `#version 300 es
${COMMON_VS}
layout(location=0) in vec4 aData;
layout(location=1) in vec4 aMore;
uniform int uKind, uCap, uDashCount;
uniform float uWidth, uMiterLimit;
out vec2 vUser, vLocal;
flat out float vLength, vUnits, vAlong;
flat out int vFlags, vKind;
void main() {
  float r = uWidth * .5;
  vec2 p;
  vKind = uKind; vFlags = 0; vLength = 0.0; vUnits = 1.0; vAlong = 0.0; vLocal = vec2(0.0);
  if (uKind == 0) {
    vec2 a = device(aData.xy), b = device(aData.zw), d = b - a;
    float len = length(d);
    vec2 t = len > 1e-12 ? d / len : vec2(1.0, 0.0), n = vec2(-t.y, t.x);
    vFlags = int(aMore.y); vAlong = aMore.x; vLength = len;
    vUnits = len > 1e-12 ? length(aData.zw - aData.xy) / len : 1.0;
    float left = uCap != 0 && ((vFlags & 1) != 0 || uDashCount > 0) ? r : 0.0;
    float right = uCap != 0 && ((vFlags & 2) != 0 || uDashCount > 0) ? r : 0.0;
    vLocal = vec2(mix(-left, len + right, corner(gl_VertexID).x), mix(-r, r, corner(gl_VertexID).y));
    p = a + t * vLocal.x + n * vLocal.y;
  } else if (uKind == 1) {
    vAlong = aData.z; vFlags = int(aData.w);
    vLocal = (corner(gl_VertexID) * 2.0 - 1.0) * r;
    p = device(aData.xy) + vLocal;
  } else {
    vec2 a = device(aData.xy), b = device(aData.zw), c = device(aMore.xy);
    vec2 u = normalize(b - a), v = normalize(c - b);
    float turn = u.x * v.y - u.y * v.x, side = turn > 0.0 ? -1.0 : 1.0;
    vec2 n1 = vec2(-u.y, u.x) * side, n2 = vec2(-v.y, v.x) * side;
    float den = 1.0 + dot(n1, n2);
    vec2 m = (n1 + n2) / max(den, 1e-12);
    bool miter = aMore.w > 1.5 && den > 1e-8 && length(m) <= uMiterLimit;
    int k = gl_VertexID;
    vec2 offset = vec2(0.0);
    if (miter) {
      if (k == 1) offset = n1;
      if (k == 2 || k == 4) offset = m;
      if (k == 5) offset = n2;
    } else {
      if (k == 1) offset = n1;
      if (k == 2) offset = n2;
    }
    p = b + offset * r; vAlong = aMore.z;
  }
  vUser = (uInverse * vec3(p, 1.0)).xy;
  gl_Position = position(p);
}
`;
const STROKE_FS = `#version 300 es
precision highp float;
precision highp int;
${PAINT_FS}
in vec2 vLocal;
flat in float vLength, vUnits, vAlong;
flat in int vFlags, vKind;
uniform float uWidth, uDash[16], uDashTotal, uDashOffset;
uniform int uDashCount, uCap;
out vec4 outColor;
bool dashOn(float along, bool interior) {
  if (uDashCount == 0 || uDashTotal <= 0.0) return true;
  float q = mod(along + uDashOffset, uDashTotal), edge = 0.0;
  for (int i = 0; i < 16; i++) {
    if (i >= uDashCount) break;
    float end = edge + uDash[i];
    if (q < end) return (i & 1) == 0 && (!interior || q > edge);
    edge = end;
  }
  return false;
}
bool interval(float lo, float hi, bool capStart, bool capEnd, float along, float across, float units) {
  float d = max(lo - along, along - hi) / max(units, 1e-12);
  if (d <= 0.0) return true;
  if (uCap == 0 || (along < lo ? !capStart : !capEnd)) return false;
  float r = uWidth * .5;
  return uCap == 1 ? d * d + across * across <= r * r : d <= r;
}
bool segment(float s, float across) {
  float a = vAlong, b = a + vLength * vUnits, along = a + s * vUnits;
  if ((vFlags & 8) != 0) return dashOn(a, false);
  if (uDashCount == 0 || uDashTotal <= 0.0) return interval(a, b, (vFlags & 1) != 0, (vFlags & 2) != 0, along, across, vUnits);
  // Intersect painted intervals with this segment before capping them. This prevents
  // a dash beyond an open subpath endpoint from bleeding back into the stroke.
  float cycle = floor((clamp(along, a, b) + uDashOffset) / uDashTotal) * uDashTotal - uDashOffset;
  for (int k = -1; k <= 1; k++) {
    float edge = cycle + float(k) * uDashTotal;
    for (int i = 0; i < 16; i++) {
      if (i >= uDashCount) break;
      float end = edge + uDash[i];
      if ((i & 1) == 0) {
        float lo = max(a, edge), hi = min(b, end);
        bool left = edge >= a || (vFlags & 1) != 0, right = end <= b || (vFlags & 2) != 0;
        if (hi >= lo && (hi > lo || end == edge) && interval(lo, hi, left, right, along, across, vUnits)) return true;
      }
      edge = end;
    }
  }
  return false;
}
void main() {
  float r = uWidth * .5;
  vec4 color = paint(); // derivatives need uniform control flow: sample before discarding
  if (vKind == 0) {
    if (!segment(vLocal.x, abs(vLocal.y))) discard;
  } else {
    if (vKind == 1 && dot(vLocal, vLocal) > r * r) discard;
    if (!dashOn(vAlong, (vFlags & 8) == 0)) discard;
  }
  outColor = color;
}
`;
const SPRITE_VS = `#version 300 es
${COMMON_VS}
layout(location=0) in vec4 aSource;
layout(location=1) in vec4 aDest;
layout(location=2) in vec4 aLinear;
layout(location=3) in vec3 aTail;
uniform mat3 uPost;
uniform int uFull;
uniform vec2 uImageSize;
out vec2 vUV, vDestination;
flat out float vAlpha;
void main() {
  mat3 m = uPost * mat3(aLinear.xy, 0.0, aLinear.zw, 0.0, aTail.xy, 1.0);
  vec2 q = corner(gl_VertexID), p;
  if (uFull != 0) {
    p = q * uViewport;
    float d = determinant(m);
    q = abs(d) > 1e-20 ? ((inverse(m) * vec3(p, 1.0)).xy - aDest.xy) / aDest.zw : vec2(-1.0);
  } else p = (m * vec3(aDest.xy + q * aDest.zw, 1.0)).xy;
  vDestination = q; vUV = (aSource.xy + q * aSource.zw) / uImageSize;
  vAlpha = aTail.z; gl_Position = position(p);
}
`;
const SPRITE_FS = `#version 300 es
precision highp float;
uniform sampler2D uImage;
in vec2 vUV, vDestination;
flat in float vAlpha;
out vec4 outColor;
void main() {
  bool inside = all(greaterThanEqual(vDestination, vec2(0.0))) && all(lessThanEqual(vDestination, vec2(1.0))) && all(greaterThanEqual(vUV, vec2(0.0))) && all(lessThanEqual(vUV, vec2(1.0)));
  outColor = inside ? texture(uImage, vUV) * vAlpha : vec4(0.0);
}
`;

class Program {
  readonly handle: WebGLProgram;
  private locations = new Map<string, WebGLUniformLocation | null>();
  constructor(private gl: WebGL2RenderingContext, vs: string, fs: string) {
    const compile = (kind: number, source: string): WebGLShader => {
      const s = gl.createShader(kind);
      if (!s) throw new GpuRasterError('Cannot allocate vector shader');
      gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const error = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new GpuRasterError(`Vector shader: ${error}`);
      }
      return s;
    };
    const vertex = compile(gl.VERTEX_SHADER, vs);
    let fragment: WebGLShader | null = null, handle: WebGLProgram | null = null;
    try {
      fragment = compile(gl.FRAGMENT_SHADER, fs); handle = gl.createProgram();
      if (!handle) throw new GpuRasterError('Cannot allocate vector program');
      gl.attachShader(handle, vertex); gl.attachShader(handle, fragment); gl.linkProgram(handle);
      if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) throw new GpuRasterError(`Vector link: ${gl.getProgramInfoLog(handle)}`);
      this.handle = handle;
    } catch (error) { if (handle) gl.deleteProgram(handle); throw error; }
    finally { gl.deleteShader(vertex); if (fragment) gl.deleteShader(fragment); }
  }
  u(name: string): WebGLUniformLocation | null {
    if (!this.locations.has(name)) this.locations.set(name, this.gl.getUniformLocation(this.handle, name));
    return this.locations.get(name) ?? null;
  }
}

interface Block { offset: number; size: number }
interface Page { buffer: WebGLBuffer; capacity: number; free: Block[]; used: number }
interface Slice { page: Page; offset: number; bytes: number; floats: number }

/** Growing slab arena: tiny paths share buffers; empty slabs are deleted on LRU eviction. */
class Arena {
  readonly pages: Page[] = [];
  capacity = 0;
  private nextSize = 64 * 1024;
  constructor(private gl: WebGL2RenderingContext) {}
  upload(data: Float32Array, evict: () => boolean): Slice | null {
    if (!data.length) return null;
    const size = Math.ceil(data.byteLength / 24) * 24; // Both vec2 vertices and six-float instances align.
    if (size > BUDGET) throw new GpuRasterError('Vector geometry exceeds the 256 MiB budget');
    for (;;) {
      for (const page of this.pages) {
        const i = page.free.findIndex(b => b.size >= size);
        if (i < 0) continue;
        const block = page.free[i], offset = block.offset;
        block.offset += size; block.size -= size;
        if (!block.size) page.free.splice(i, 1);
        page.used += size;
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, page.buffer); this.gl.bufferSubData(this.gl.ARRAY_BUFFER, offset, data);
        return { page, offset, bytes: size, floats: data.length };
      }
      const capacity = Math.ceil(Math.max(this.nextSize, size) / 24) * 24;
      if (this.capacity + capacity > BUDGET) {
        if (evict()) continue;
        throw new GpuRasterError('Vector geometry cache is full');
      }
      const buffer = this.gl.createBuffer();
      if (!buffer) throw new GpuRasterError('Cannot allocate vector geometry buffer');
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer); this.gl.bufferData(this.gl.ARRAY_BUFFER, capacity, this.gl.STATIC_DRAW);
      this.pages.push({ buffer, capacity, free: [{ offset: 0, size: capacity }], used: 0 });
      this.capacity += capacity; this.nextSize = Math.min(4 * 1024 * 1024, this.nextSize * 2);
    }
  }
  release(slice: Slice | null): void {
    if (!slice) return;
    const p = slice.page;
    p.used -= slice.bytes;
    if (!p.used) {
      this.gl.deleteBuffer(p.buffer); this.capacity -= p.capacity; this.pages.splice(this.pages.indexOf(p), 1); return;
    }
    p.free.push({ offset: slice.offset, size: slice.bytes }); p.free.sort((a, b) => a.offset - b.offset);
    for (let i = p.free.length - 1; i > 0; i--) {
      const a = p.free[i - 1], b = p.free[i];
      if (a.offset + a.size === b.offset) { a.size += b.size; p.free.splice(i, 1); }
    }
  }
  dispose(): void { for (const p of this.pages) this.gl.deleteBuffer(p.buffer); this.pages.length = 0; this.capacity = 0; }
}
/** Stroke instances of one path (segments, discs, joins), uploaded once and kept in the arena. */
type StrokeSlices = [Slice | null, Slice | null, Slice | null];
type RasterPart = { list: DisplayList; post: Mat; scissor?: readonly [number, number, number, number] };
interface GeometryData {
  version: number; bucket: number; geometry: PathGeometry;
  /** Uploaded on the first fill or clip (undefined: not yet; null: nothing to fill). */
  fan?: Slice | null;
  /** Stroke instances per cap/join, kept on the CPU and streamed per run (one draw per kind for many paths). */
  strokes: Map<string, StrokeSlices>; bytes: number;
}
interface TextureData { texture: WebGLTexture; width: number; height: number; bytes: number; used: number }

export function createGpuRasterizer(canvas?: Surface): GpuRasterizer | null {
  let surface = canvas;
  let gl: WebGL2RenderingContext | null;
  try {
    surface ??= typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : typeof document !== 'undefined' ? document.createElement('canvas') : undefined;
    if (!surface) return null;
    gl = surface.getContext('webgl2', { antialias: true, stencil: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false, depth: false }) as WebGL2RenderingContext | null;
  } catch { return null; }
  if (!surface || !gl || !gl.getContextAttributes()?.stencil) return null;
  return new Rasterizer(surface, gl);
}

let shared: GpuRasterizer | null = null, attempted = false;
export function sharedGpuRasterizer(): GpuRasterizer | null {
  if (shared?.lost) { shared.dispose(); shared = null; attempted = false; }
  if (!attempted) { shared = createGpuRasterizer(); attempted = true; }
  return shared;
}

class Rasterizer implements GpuRasterizer {
  readonly renderer: string;
  readonly software: boolean;
  private contextLost = false;
  private disposed = false;
  private arena: Arena;
  private cache = new Map<RecordedPath, GeometryData>();
  private pinned = new Set<GeometryData>();
  private textures = new Map<ImageSource, TextureData>();
  private textureBytes = 0;
  /** Batch breaks per path list (see fills and strokes). */
  private fillRuns = new WeakMap<readonly RecordedPath[], Uint8Array>();
  private strokeRuns = new WeakMap<readonly RecordedPath[], Uint8Array>();
  private directStrokeRuns = new WeakMap<readonly RecordedPath[], Uint8Array>();
  /** Sprite instance buffers per op (LRU, never evicted during the render that uses them). */
  private spriteBuffers = new Map<SpriteOp, { buffer: WebGLBuffer; bytes: number; used: number }>();
  /** Render counter: textures used by the current render are never evicted. */
  private epoch = 0;
  private stream: WebGLBuffer | null = null;
  private streamBytes = 0;
  private scratch = new Float32Array(4096);
  private clipBox: Box = [0, 0, 1, 1];
  private programs = new Map<string, Program>();
  private vao: WebGLVertexArrayObject | null = null;
  private spriteBuffer: WebGLBuffer | null = null;
  private spriteCapacity = 0;
  private width = 1;
  private height = 1;
  private currentClip: ClipNode | null | undefined;
  private post: Mat = IDENTITY;
  private stats = { drawCalls: 0, triangles: 0, ms: 0, clips: 0, ops: 0 };
  private onLost = (event: Event): void => { event.preventDefault(); this.contextLost = true; };
  constructor(private canvas: Surface, private gl: WebGL2RenderingContext) {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    this.renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    this.software = SOFTWARE_GL.test(this.renderer); this.arena = new Arena(gl);
    canvas.addEventListener('webglcontextlost', this.onLost);
  }
  get lost(): boolean { return this.contextLost || this.disposed || this.gl.isContextLost(); }
  rasterize(list: DisplayList, options?: { post?: Mat }): ImageBitmap {
    if (this.lost) throw new GpuRasterError('Vector WebGL2 context lost or disposed', true);
    if (!('transferToImageBitmap' in this.canvas)) throw new GpuRasterError('ImageBitmap rasterization requires OffscreenCanvas; use rasterizeInto');
    this.render(list, options?.post ?? IDENTITY);
    try { return this.canvas.transferToImageBitmap(); }
    catch (error) { throw new GpuRasterError(`Vector bitmap: ${String(error)}`, this.lost); }
  }
  rasterizeInto(list: DisplayList, target: CanvasRenderingContext2D, x: number, y: number, options?: { post?: Mat; size?: readonly [number, number] }): void {
    this.render(list, options?.post ?? IDENTITY, options?.size); target.drawImage(this.canvas, x, y);
  }
  bytes(): number {
    return this.arena.capacity + this.spriteCapacity + this.streamBytes + this.textureBytes;
  }
  lastStats(): { drawCalls: number; triangles: number; ms: number; clips: number; ops: number } { return { ...this.stats }; }
  invalidateImage(source: ImageSource): void {
    const t = this.textures.get(source);
    if (t) { this.gl.deleteTexture(t.texture); this.textures.delete(source); this.textureBytes -= t.bytes; }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.arena.dispose(); this.cache.clear(); this.pinned.clear();
    for (const t of this.textures.values()) this.gl.deleteTexture(t.texture);
    this.textures.clear(); this.textureBytes = 0;
    this.gl.deleteBuffer(this.stream); this.stream = null; this.streamBytes = 0;
    for (const p of this.programs.values()) this.gl.deleteProgram(p.handle);
    for (const held of this.spriteBuffers.values()) this.gl.deleteBuffer(held.buffer);
    this.spriteBuffers.clear();
    this.programs.clear(); this.gl.deleteVertexArray(this.vao); this.gl.deleteBuffer(this.spriteBuffer);
    this.vao = null; this.spriteBuffer = null; this.spriteCapacity = 0;
  }
  private program(kind: 'fan' | 'cover' | 'stroke' | 'sprite' | 'clear'): Program {
    let p = this.programs.get(kind);
    if (!p) {
      p = new Program(this.gl, kind === 'fan' ? FAN_VS : kind === 'stroke' ? STROKE_VS : kind === 'sprite' ? SPRITE_VS : COVER_VS,
        kind === 'fan' || kind === 'clear' ? EMPTY_FS : kind === 'stroke' ? STROKE_FS : kind === 'sprite' ? SPRITE_FS : COVER_FS);
      this.programs.set(kind, p);
    }
    this.gl.useProgram(p.handle); this.gl.uniform2f(p.u('uViewport'), this.width, this.height);
    return p;
  }
  private matrices(p: Program, m: Mat): void {
    this.gl.uniformMatrix3fv(p.u('uMatrix'), false, matrix(m));
    this.gl.uniformMatrix3fv(p.u('uInverse'), false, matrix(inverse(m) ?? IDENTITY));
  }
  /** Null for a source without pixels (an emptied canvas): its draw is skipped instead of failing the whole replay. */
  private texture(source: ImageSource, smoothing: boolean, repeatX = false, repeatY = false): TextureData | null {
    const gl = this.gl;
    let t = this.textures.get(source);
    gl.activeTexture(gl.TEXTURE0);
    if (!t) {
      const dimensions = source as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number; displayWidth?: number; displayHeight?: number };
      const width = dimensions.naturalWidth ?? dimensions.videoWidth ?? dimensions.displayWidth ?? dimensions.width ?? 0;
      const height = dimensions.naturalHeight ?? dimensions.videoHeight ?? dimensions.displayHeight ?? dimensions.height ?? 0;
      if (!(width > 0 && height > 0)) return null;
      const texture = gl.createTexture();
      if (!texture) throw new GpuRasterError('Cannot allocate vector texture');
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource); }
      catch (error) { gl.deleteTexture(texture); throw error; }
      // Patterns and sprites are often drawn far smaller than their texels (hatches at 14 px per metre, crown atlases):
      // mipmaps keep them from shimmering, like the Canvas high-quality drawImage.
      gl.generateMipmap(gl.TEXTURE_2D);
      t = { texture, width, height, bytes: Math.ceil(width * height * 4 * 4 / 3), used: this.epoch };
      this.textures.set(source, t); this.textureBytes += t.bytes; this.evictTextures();
      gl.bindTexture(gl.TEXTURE_2D, texture);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, t.texture);
      this.textures.delete(source); this.textures.set(source, t); t.used = this.epoch;
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, smoothing ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, smoothing ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeatX ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, repeatY ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    return t;
  }
  private evictSprites(): void {
    for (const [op, held] of this.spriteBuffers) {
      if (this.spriteCapacity <= SPRITE_BUDGET) return;
      if (held.used === this.epoch) continue;
      this.gl.deleteBuffer(held.buffer); this.spriteBuffers.delete(op); this.spriteCapacity -= held.bytes;
    }
  }
  private evictTextures(): void {
    for (const [source, t] of this.textures) {
      if (this.textureBytes <= TEXTURE_BUDGET) return;
      if (t.used === this.epoch) continue;
      this.gl.deleteTexture(t.texture); this.textures.delete(source); this.textureBytes -= t.bytes;
    }
  }
  /** Per-draw instance data, orphaned each time (bufferData) so no draw waits on the previous one. Returns the float count. */
  private streamUpload(parts: readonly Float32Array[]): number {
    let floats = 0;
    for (const a of parts) floats += a.length;
    if (!floats) return 0;
    let data: Float32Array;
    if (parts.length === 1) data = parts[0];
    else {
      if (this.scratch.length < floats) this.scratch = new Float32Array(2 ** Math.ceil(Math.log2(floats)));
      let at = 0; for (const a of parts) { this.scratch.set(a, at); at += a.length; }
      data = this.scratch.subarray(0, floats);
    }
    const gl = this.gl;
    if (!this.stream) { this.stream = gl.createBuffer(); if (!this.stream) throw new GpuRasterError('Cannot allocate vector stream buffer'); }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.stream); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
    this.streamBytes = Math.max(this.streamBytes, data.byteLength);
    return floats;
  }
  private paint(p: Program, paint: Paint, alpha: number): void {
    const gl = this.gl;
    gl.uniform1f(p.u('uAlpha'), alpha);
    gl.uniform1i(p.u('uPattern'), paint.kind === 'pattern' ? 1 : 0);
    if (paint.kind === 'color') { gl.uniform4fv(p.u('uColor'), new Float32Array(paint.rgba)); return; }
    const inv = inverse(paint.transform);
    if (!inv) { gl.uniform1i(p.u('uPattern'), 0); gl.uniform4f(p.u('uColor'), 0, 0, 0, 0); return; }
    const rx = paint.repeat === 'repeat' || paint.repeat === 'repeat-x', ry = paint.repeat === 'repeat' || paint.repeat === 'repeat-y';
    const t = this.texture(paint.source, paint.smoothing, rx, ry);
    if (!t) { gl.uniform1i(p.u('uPattern'), 0); gl.uniform4f(p.u('uColor'), 0, 0, 0, 0); return; }
    gl.uniform1i(p.u('uImage'), 0); gl.uniform2f(p.u('uImageSize'), t.width, t.height);
    gl.uniform2i(p.u('uRepeat'), rx ? 1 : 0, ry ? 1 : 0); gl.uniformMatrix3fv(p.u('uPatternInverse'), false, matrix(inv));
  }
  private release(entry: GeometryData): void {
    this.arena.release(entry.fan ?? null);
    for (const slices of entry.strokes.values()) for (const slice of slices) this.arena.release(slice);
  }
  private evict = (): boolean => {
    for (const [path, entry] of this.cache) {
      if (this.pinned.has(entry)) continue;
      this.release(entry); this.cache.delete(path); return true;
    }
    return false;
  };
  private geometry(path: RecordedPath, m: Mat): GeometryData {
    if (!path.readable) throw new GpuRasterError('Unreadable vector path');
    const bucket = tolerance(m);
    let entry = this.cache.get(path);
    // A straight path returns the same geometry at every tolerance: keep its uploads across zoom levels.
    if (entry && entry.version === path.version && entry.bucket !== bucket && path.geometry(bucket) === entry.geometry) entry.bucket = bucket;
    if (entry && (entry.version !== path.version || entry.bucket !== bucket)) { this.release(entry); this.cache.delete(path); entry = undefined; }
    if (!entry) entry = { version: path.version, bucket, geometry: path.geometry(bucket), strokes: new Map(), bytes: 0 };
    this.cache.delete(path); this.cache.set(path, entry); return entry;
  }
  /** The fill fan, uploaded on first use (strokes never need it). */
  private fanOf(entry: GeometryData): Slice | null {
    if (entry.fan === undefined) {
      this.pinned.add(entry);
      try { entry.fan = this.arena.upload(fillFans(entry.geometry), this.evict); entry.bytes += entry.fan?.bytes ?? 0; }
      finally { this.pinned.delete(entry); }
    }
    return entry.fan ?? null;
  }
  /** Instances depend neither on the width (a uniform) nor on the miter limit (recomputed in the shader): uploaded once
   * per path, cap and join, then replayed from the arena at every frame (map-wide contours never stream again). */
  private strokeSlices(entry: GeometryData, op: StrokeOp): StrokeSlices {
    const key = `${op.cap}/${op.join}`;
    let slices = entry.strokes.get(key);
    if (!slices) {
      const mesh: StrokeGeometry = strokeSegments(entry.geometry, { width: 1, cap: op.cap, join: op.join, miterLimit: op.miterLimit });
      const made: (Slice | null)[] = [];
      this.pinned.add(entry);
      try { for (const data of [mesh.segments, mesh.discs, mesh.joins]) made.push(this.arena.upload(data, this.evict)); }
      catch (error) { for (const slice of made) this.arena.release(slice); throw error; }
      finally { this.pinned.delete(entry); }
      slices = made as StrokeSlices; entry.strokes.set(key, slices);
      for (const slice of slices) entry.bytes += slice?.bytes ?? 0;
    }
    return slices;
  }
  private attributes(buffer: WebGLBuffer, start: number, stride: number, sizes: readonly number[]): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    let offset = start;
    for (let i = 0; i < 4; i++) {
      if (i < sizes.length) {
        gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, sizes[i], gl.FLOAT, false, stride * 4, offset);
        gl.vertexAttribDivisor(i, 1); offset += sizes[i] * 4;
      } else { gl.disableVertexAttribArray(i); gl.vertexAttribDivisor(i, 0); }
    }
  }
  private quad(box: Box, p: Program): void {
    const b: Box = [Math.max(0, Math.floor(box[0])), Math.max(0, Math.floor(box[1])), Math.min(this.width, Math.ceil(box[2])), Math.min(this.height, Math.ceil(box[3]))];
    if (!(b[2] > b[0] && b[3] > b[1])) return;
    this.gl.uniform1i(p.u('uRectMode'), 0);
    this.gl.uniform4fv(p.u('uBox'), new Float32Array(b)); this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
    this.stats.drawCalls++; this.stats.triangles += 2;
  }
  private get viewport(): Box { return [0, 0, this.width, this.height]; }
  private reset(box: Box): void {
    const gl = this.gl, p = this.program('clear');
    gl.colorMask(false, false, false, false); gl.stencilMask(0x7f); gl.stencilFunc(gl.ALWAYS, 0, 0xff);
    gl.stencilOp(gl.ZERO, gl.ZERO, gl.ZERO); this.quad(box, p); gl.colorMask(true, true, true, true);
  }
  private windingState(rule: FillRule): void {
    const gl = this.gl;
    gl.colorMask(false, false, false, false); gl.stencilFunc(gl.EQUAL, 0x80, 0x80);
    gl.stencilMask(rule === 'evenodd' ? 1 : 0x7f);
    if (rule === 'evenodd') gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
    else {
      gl.stencilOpSeparate(gl.FRONT, gl.KEEP, gl.KEEP, gl.INCR_WRAP);
      gl.stencilOpSeparate(gl.BACK, gl.KEEP, gl.KEEP, gl.DECR_WRAP);
    }
  }
  private fan(entry: GeometryData, m: Mat): void {
    const slice = this.fanOf(entry);
    if (!slice) return;
    this.fanSlice(slice, m, slice.floats);
  }
  private fanSlice(slice: Slice, m: Mat, floats: number): void {
    const gl = this.gl, p = this.program('fan');
    this.matrices(p, m); gl.bindBuffer(gl.ARRAY_BUFFER, slice.page.buffer);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, slice.offset); gl.vertexAttribDivisor(0, 0);
    for (let i = 1; i < 4; i++) { gl.disableVertexAttribArray(i); gl.vertexAttribDivisor(i, 0); }
    gl.drawArrays(gl.TRIANGLES, 0, floats / 2); this.stats.drawCalls++; this.stats.triangles += floats / 6;
  }
  private clip(node: ClipNode | null): void {
    if (node === this.currentClip) return;
    const gl = this.gl, chain: ClipNode[] = [];
    this.stats.clips++;
    // A clip pushed on the current one (save, clip) intersects in place; anything else rebuilds from the root.
    if (node && this.currentClip !== undefined && node.parent === this.currentClip) chain.push(node);
    else {
      gl.stencilMask(0xff); gl.clearStencil(0x80); gl.clear(gl.STENCIL_BUFFER_BIT); this.clipBox = this.viewport;
      for (let n = node; n; n = n.parent) chain.push(n);
      chain.reverse();
    }
    for (const n of chain) {
      const m = compose(this.post, n.transform), pathBox = intersect(transformedBox(n.path.bounds(), m, 1), this.viewport);
      this.windingState(n.rule); this.fan(this.geometry(n.path, m), m);
      const p = this.program('clear');
      // Compare against the old clip and zero winding; REPLACE uses the same reference 0x80,
      // so ZERO (equivalent to REPLACE ref 0) clears just bit 7 on matching samples. Bit 7 is only set inside clipBox.
      gl.stencilFunc(gl.EQUAL, 0x80, n.rule === 'evenodd' ? 0x81 : 0xff);
      gl.stencilMask(0x80); gl.stencilOp(gl.KEEP, gl.KEEP, gl.ZERO); this.quad(this.clipBox, p);
      // Winding was only written inside the old clip and the path bounds.
      this.reset(intersect(pathBox, this.clipBox));
      this.clipBox = intersect(this.clipBox, pathBox);
    }
    gl.colorMask(true, true, true, true); this.currentClip = node;
  }
  private blend(composite: Composite, pass = 0): void {
    const gl = this.gl;
    if (composite === 'multiply') {
      if (!pass) gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      else gl.blendFuncSeparate(gl.ONE_MINUS_DST_ALPHA, gl.ONE, gl.ONE_MINUS_DST_ALPHA, gl.ONE);
    } else if (composite === 'destination-out') gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    else if (composite === 'destination-in') gl.blendFunc(gl.ZERO, gl.SRC_ALPHA);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
  /** Cover a retained coverage stencil; both multiply passes see precisely the same samples. */
  private cover(box: Box, m: Mat, paint: Paint, alpha: number, composite: Composite, rule: FillRule | 'stroke'): void {
    const gl = this.gl, p = this.program('cover');
    this.matrices(p, m); this.paint(p, paint, alpha); gl.colorMask(true, true, true, true); gl.stencilMask(0);
    if (rule === 'stroke') gl.stencilFunc(gl.EQUAL, 0x81, 0xff);
    else gl.stencilFunc(gl.LESS, 0x80, rule === 'evenodd' ? 0x81 : 0xff);
    const finish = (): void => { gl.stencilMask(0x7f); gl.stencilOp(gl.ZERO, gl.ZERO, gl.ZERO); };
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    if (composite !== 'multiply' && composite !== 'destination-in') finish();
    this.blend(composite); this.quad(box, p);
    if (composite === 'multiply') { finish(); this.blend(composite, 1); this.quad(box, p); }
    if (composite === 'destination-in') {
      // Canvas destination-in also clears the clipped destination outside source coverage.
      const clear = this.program('clear');
      gl.stencilFunc(gl.EQUAL, 0x80, rule === 'evenodd' ? 0x81 : 0xff);
      gl.blendFunc(gl.ZERO, gl.ZERO); this.quad(this.viewport, clear);
      this.reset(box);
    }
  }
  private fills(paths: readonly RecordedPath[], rule: FillRule, m: Mat, paint: Paint, alpha: number, composite: Composite): void {
    let run: RecordedPath[] = [], boxes: Box[] = [], box: Box = [Infinity, Infinity, -Infinity, -Infinity];
    const flush = (): void => {
      if (!run.length) return;
      this.windingState(rule);
      let first: Slice | null = null, floats = 0;
      const held: GeometryData[] = [];
      const draw = (): void => {
        if (first) this.fanSlice(first, m, floats);
        for (const entry of held) this.pinned.delete(entry);
        held.length = 0; first = null; floats = 0;
      };
      try {
        for (const path of run) {
          const entry = this.geometry(path, m), slice = this.fanOf(entry);
          if (!slice) continue;
          if (first && (first.page !== slice.page || first.offset + floats * 4 !== slice.offset)) draw();
          this.pinned.add(entry); held.push(entry);
          first ??= slice; floats += slice.floats;
          if (floats * 4 >= 4 * 1024 * 1024) draw();
        }
        draw();
      } finally { for (const entry of held) this.pinned.delete(entry); }
      this.cover(box, m, paint, alpha, composite, rule);
      run = []; boxes = []; box = [Infinity, Infinity, -Infinity, -Infinity];
    };
    // Run breaks depend only on which bounds overlap, invariant under the view (scale and translation): computed once per op.
    const known = this.fillRuns.get(paths), breaks = known ?? new Uint8Array(paths.length);
    for (let i = 0; i < paths.length; i++) {
      const b = transformedBox(paths[i].bounds(), m, 1);
      // destination-in affects the whole clip per path, even for disjoint or empty paths.
      if (!known && run.length && (composite === 'destination-in' || boxes.some(other => overlaps(other, b)))) breaks[i] = 1;
      if (breaks[i]) flush();
      run.push(paths[i]); if (!known) boxes.push(b); box = union(box, b);
    }
    if (!known) this.fillRuns.set(paths, breaks);
    flush();
  }
  private strokeInstances(meshes: readonly StrokeSlices[], op: StrokeOp, m: Mat, alpha: number, deviceWidth: number, hair = false): void {
    const gl = this.gl, p = this.program('stroke');
    this.matrices(p, m); this.paint(p, op.paint, alpha);
    gl.uniform1f(p.u('uWidth'), deviceWidth); gl.uniform1f(p.u('uMiterLimit'), op.miterLimit);
    gl.uniform1i(p.u('uCap'), hair || op.cap === 'butt' ? 0 : op.cap === 'round' ? 1 : 2);
    if (op.dash.length > 16) throw new GpuRasterError('GPU strokes support at most sixteen dash entries');
    const dash = new Float32Array(16); dash.set(op.dash);
    const total = op.dash.reduce((a, b) => a + b, 0);
    gl.uniform1fv(p.u('uDash[0]'), dash); gl.uniform1i(p.u('uDashCount'), total > 0 ? op.dash.length : 0);
    gl.uniform1f(p.u('uDashTotal'), total); gl.uniform1f(p.u('uDashOffset'), op.dashOffset);
    // One instanced draw per run of contiguous arena slices (consecutive uploads usually are).
    const draw = (kind: 0 | 1 | 2, stride: number, sizes: readonly number[]): void => {
      let first: Slice | null = null, count = 0;
      const emit = (): void => {
        if (!first || !count) return;
        this.attributes(first.page.buffer, first.offset, stride, sizes); gl.uniform1i(p.u('uKind'), kind);
        gl.drawArraysInstanced(kind === 2 ? gl.TRIANGLES : gl.TRIANGLE_STRIP, 0, kind === 2 ? 6 : 4, count);
        this.stats.drawCalls++; this.stats.triangles += count * 2; first = null; count = 0;
      };
      for (const slices of meshes) {
        const slice = slices[kind]; if (!slice) continue;
        const n = slice.floats / stride;
        if (first && first.page === slice.page && first.offset + count * stride * 4 === slice.offset) count += n;
        else { emit(); first = slice; count = n; }
      }
      emit();
    };
    draw(0, SEGMENT_STRIDE, [4, 2]);
    if (hair) return; // hairlines have neither caps nor joins
    draw(1, DISC_STRIDE, [4]); draw(2, JOIN_STRIDE, [4, 4]);
  }
  private strokes(op: StrokeOp, m: Mat): void {
    const gl = this.gl, s = scale(m), width = op.width * s;
    if (!(op.width > 0) || !(s > 0)) {
      if (op.composite === 'destination-in') this.cover([0, 0, 0, 0], m, op.paint, 0, op.composite, 'stroke');
      return;
    }
    // Sub-pixel strokes follow Skia's modulated hairlines (Chrome's Canvas): 1 px wide, alpha x width, every segment
    // blended on its own, so dense parallel lines (field strips) accumulate instead of drawing once per path.
    const hair = width < 1 && (op.composite === 'source-over' || op.composite === 'destination-out');
    const deviceWidth = hair ? 1 : Math.max(1, width), alpha = op.alpha * Math.min(1, width);
    const direct = hair || op.composite === 'source-over' && op.paint.kind === 'color' && op.paint.rgba[3] === 1 && alpha === 1 && op.dash.length === 0;
    const pad = deviceWidth * Math.max(1, op.join === 'miter' ? op.miterLimit : 1) / 2 + 1;
    // Paths with pairwise disjoint bounds stroke together (one draw per instance kind, one cover): the draw-once
    // stencil then matches per-path Canvas strokes. Opaque direct strokes always batch.
    let meshes: StrokeSlices[] = [], boxes: Box[] = [], box: Box = [Infinity, Infinity, -Infinity, -Infinity];
    // Entries of the pending run stay pinned: a later upload must not evict slices this run is about to draw.
    const held: GeometryData[] = [];
    const flush = (): void => {
      if (!meshes.length) return;
      gl.stencilFunc(gl.EQUAL, 0x80, direct ? 0x80 : 0xff); gl.stencilMask(direct ? 0 : 0x7f);
      gl.stencilOp(gl.KEEP, gl.KEEP, direct ? gl.KEEP : gl.INCR);
      gl.colorMask(direct, direct, direct, direct); this.blend(op.composite);
      this.strokeInstances(meshes, op, m, alpha, deviceWidth, hair);
      if (!direct) this.cover(box, m, op.paint, alpha, op.composite, 'stroke');
      meshes = []; boxes = []; box = [Infinity, Infinity, -Infinity, -Infinity];
      for (const entry of held) this.pinned.delete(entry);
      held.length = 0;
    };
    const cache = direct ? this.directStrokeRuns : this.strokeRuns, known = cache.get(op.paths), breaks = known ?? new Uint8Array(op.paths.length);
    let index = 0;
    try {
      for (const path of op.paths) {
        const entry = this.geometry(path, m), b = transformedBox(entry.geometry.bbox, m, pad);
        if (!direct && (known ? known[index] : boxes.some(other => overlaps(other, b)) ? (breaks[index] = 1) : 0)) flush();
        index++;
        const slices = this.strokeSlices(entry, op);
        this.pinned.add(entry); held.push(entry);
        meshes.push(slices); boxes.push(b); box = union(box, b);
      }
      flush();
      if (!known) cache.set(op.paths, breaks);
    } finally { for (const entry of held) this.pinned.delete(entry); }
  }
  private sprites(op: SpriteOp): void {
    if (!op.count) return;
    const gl = this.gl, p = this.program('sprite'), t = this.texture(op.source, op.smoothing);
    if (!t) return;
    // Instances are uploaded once per op and kept (a retained list replays them at every frame); the view goes in uPost.
    let held = this.spriteBuffers.get(op);
    if (!held) {
      const buffer = gl.createBuffer(); if (!buffer) throw new GpuRasterError('Cannot allocate sprite buffer');
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, op.instances.subarray(0, op.count * SPRITE_STRIDE), gl.STATIC_DRAW);
      held = { buffer, bytes: op.count * SPRITE_STRIDE * 4, used: this.epoch };
      this.spriteBuffers.set(op, held); this.spriteCapacity += held.bytes; this.evictSprites();
    } else { this.spriteBuffers.delete(op); this.spriteBuffers.set(op, held); held.used = this.epoch; }
    gl.bindBuffer(gl.ARRAY_BUFFER, held.buffer);
    gl.uniform1i(p.u('uImage'), 0); gl.uniform2f(p.u('uImageSize'), t.width, t.height);
    gl.uniformMatrix3fv(p.u('uPost'), false, matrix(this.post)); gl.uniform1i(p.u('uFull'), op.composite === 'destination-in' ? 1 : 0);
    const bind = (first: number): void => {
      const sizes = [4, 4, 4, 3]; let offset = first * SPRITE_STRIDE * 4;
      for (let i = 0; i < 4; i++) {
        gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, sizes[i], gl.FLOAT, false, SPRITE_STRIDE * 4, offset); gl.vertexAttribDivisor(i, 1); offset += sizes[i] * 4;
      }
    };
    const draw = (count: number): void => { gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count); this.stats.drawCalls++; this.stats.triangles += count * 2; };
    gl.colorMask(true, true, true, true);
    if (op.composite !== 'multiply') {
      gl.stencilMask(0); gl.stencilFunc(gl.EQUAL, 0x80, 0x80); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      this.blend(op.composite); bind(0); draw(op.count);
    } else {
      // Sequential instances preserve Canvas ordering when translucent sprites overlap.
      // Mark once in pass 1 and consume the marker in pass 2, without an extra coverage draw.
      for (let i = 0; i < op.count; i++) {
        bind(i); gl.stencilMask(0x7f); gl.stencilFunc(gl.EQUAL, 0x80, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
        this.blend('multiply'); draw(1);
        gl.stencilFunc(gl.EQUAL, 0x81, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.DECR);
        this.blend('multiply', 1); draw(1);
      }
    }
  }
  private clear(x: number, y: number, w: number, h: number, m: Mat): void {
    const gl = this.gl, p = this.program('clear');
    this.matrices(p, m); gl.uniform1i(p.u('uRectMode'), 1); gl.uniform4f(p.u('uRect'), x, y, w, h);
    gl.stencilMask(0); gl.stencilFunc(gl.EQUAL, 0x80, 0x80); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    gl.colorMask(true, true, true, true); gl.blendFunc(gl.ZERO, gl.ZERO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); this.stats.drawCalls++; this.stats.triangles += 2;
  }
  private render(list: DisplayList, post: Mat, size?: readonly [number, number]): void {
    this.renderParts([{ list, post }], size ?? [list.width, list.height]);
  }
  /** Replays several lists on one target, each limited to its scissor rectangle (device px of the target, y down). */
  private renderParts(parts: readonly RasterPart[], [width, height]: readonly [number, number]): void {
    if (this.lost) throw new GpuRasterError('Vector WebGL2 context lost or disposed', true);
    const gl = this.gl, start = performance.now();
    this.stats = { drawCalls: 0, triangles: 0, ms: 0, clips: 0, ops: 0 };
    try {
      if (!(width > 0 && height > 0)) throw new GpuRasterError('Vector target must have positive dimensions');
      if (this.canvas.width !== width) this.canvas.width = width;
      if (this.canvas.height !== height) this.canvas.height = height;
      this.width = width; this.height = height; this.epoch++;
      if (!this.vao) { this.vao = gl.createVertexArray(); if (!this.vao) throw new GpuRasterError('Cannot allocate vector vertex array'); }
      gl.bindVertexArray(this.vao); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.width, this.height);
      gl.disable(gl.CULL_FACE); gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST);
      gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.enable(gl.STENCIL_TEST);
      gl.colorMask(true, true, true, true); gl.stencilMask(0xff); gl.clearColor(0, 0, 0, 0); gl.clearStencil(0x80);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      for (const { list, post, scissor } of parts) {
        if (list.unsupported) throw new GpuRasterError(`Unsupported vector list: ${list.unsupported}`);
        if (scissor) {
          const x0 = Math.max(0, Math.round(scissor[0])), y0 = Math.max(0, Math.round(scissor[1]));
          const x1 = Math.min(width, Math.round(scissor[2])), y1 = Math.min(height, Math.round(scissor[3]));
          if (!(x1 > x0 && y1 > y0)) continue;
          gl.enable(gl.SCISSOR_TEST); gl.scissor(x0, height - y1, x1 - x0, y1 - y0);
        } else gl.disable(gl.SCISSOR_TEST);
        // Each part starts from the full clip (the stencil clear of the first clip change respects the scissor).
        this.post = post; this.currentClip = undefined; this.clipBox = this.viewport;
        this.stats.ops += list.ops.length;
        for (const op of list.ops) {
          this.clip(op.clip);
          if (op.type === 'sprites') this.sprites(op);
          else {
            const m = compose(post, op.transform);
            if (op.type === 'clear') this.clear(op.x, op.y, op.w, op.h, m);
            else if (op.type === 'fill') this.fills(op.paths, op.rule, m, op.paint, op.alpha, op.composite);
            else this.strokes(op, m);
          }
        }
      }
      if (this.lost) throw new GpuRasterError('Vector WebGL2 context lost during replay', true);
      const error = gl.getError();
      if (error !== gl.NO_ERROR) throw new GpuRasterError(`Vector WebGL2 error 0x${error.toString(16)}`, this.lost);
    } catch (error) {
      if (error instanceof GpuRasterError) throw error;
      throw new GpuRasterError(`Vector replay: ${String(error)}`, this.lost);
    } finally {
      gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true); gl.stencilMask(0xff); gl.bindVertexArray(null);
      this.stats.ms = performance.now() - start;
    }
  }
  /** Uploads what `list` needs (geometry, stroke instances, sprites, textures) without drawing, so a later replay
   * of a freshly recorded list costs no upload. `post` sets the flattening tolerance as the replay will. */
  prepare(list: DisplayList, post: Mat = IDENTITY): void {
    if (this.lost || list.unsupported) return;
    const clips = new Set<ClipNode>();
    for (const op of list.ops) {
      for (let n = op.clip; n && !clips.has(n); n = n.parent) { clips.add(n); const m = compose(post, n.transform); this.fanOf(this.geometry(n.path, m)); }
      if (op.type === 'sprites') { this.texture(op.source, op.smoothing); continue; }
      if (op.type === 'clear') continue;
      const m = compose(post, op.transform);
      if (op.type === 'fill') { for (const path of op.paths) this.fanOf(this.geometry(path, m)); if (op.paint.kind === 'pattern') this.texture(op.paint.source, op.paint.smoothing); }
      else { for (const path of op.paths) this.strokeSlices(this.geometry(path, m), op); if (op.paint.kind === 'pattern') this.texture(op.paint.source, op.paint.smoothing); }
    }
  }
  rasterizeParts(parts: readonly RasterPart[], target: CanvasRenderingContext2D, x: number, y: number, size: readonly [number, number]): void {
    this.renderParts(parts, size); target.drawImage(this.canvas, x, y);
  }
}
