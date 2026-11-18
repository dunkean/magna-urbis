/**
 * Retained GPU data of the GPU town: a fill mesh with its per-state colour tables (`FillPack`) and segment
 * instances with their two colour tables (`StrokePack`). Each owns its buffers and textures; renderer.ts builds
 * them at upload and disposes them.
 */
import { META, STROKE_STRIDE, type CityGlFillMesh, type CityGlStrokes } from '../../cityGlBuild';
import { type CityGlDraws } from './styleTables';
// walls hook (cityWalls.ts)

const TEX_W = 4096;
function uploadTable(gl: WebGL2RenderingContext, texture: WebGLTexture, rgba: Uint8Array): void {
  const rows = Math.max(1, Math.ceil(rgba.length / 4 / TEX_W)),
    data = rgba.length === rows * TEX_W * 4 ? rgba : new Uint8Array(rows * TEX_W * 4);
  if (data !== rgba) data.set(rgba);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, TEX_W, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
}

type FillExtra = 'hatch' | 'grain' | 'rim';
const FILL_EXTRAS: readonly FillExtra[] = ['hatch', 'grain', 'rim'];
/** Colour tables kept per fill mesh: the four levels of detail of a look and a previous look or two. */
const TABLES_KEPT = 6;
/** A fill mesh on the GPU: shared vertices, one VAO for triangles, one for lines, two colour tables per kept state
 * (a zoom across levels of detail, or back to a recent look, binds kept tables instead of rebuilding them). */
export class FillPack {
  vbo: WebGLBuffer[] = [];
  tri: WebGLVertexArrayObject;
  line: WebGLVertexArrayObject;
  fill: WebGLTexture | null = null;
  edge: WebGLTexture | null = null;
  mats?: WebGLTexture;
  private geometryBytes: number;
  /** Extra per-feature tables of the current state (live look): parchment hatch strength (plan), roof grain data and
   * wall-rim colours (buildings, cityGlStyle CityGlRoofGrain); null when the state has none. */
  hatch: WebGLTexture | null = null;
  grain: WebGLTexture | null = null;
  rim: WebGLTexture | null = null;
  private tables = new Map<string, { fill: WebGLTexture; edge: WebGLTexture; extra: Partial<Record<FillExtra, WebGLTexture>>; draws?: CityGlDraws }>();
  constructor(
    private gl: WebGL2RenderingContext,
    readonly mesh: CityGlFillMesh,
  ) {
    const buffer = (target: number, data: ArrayBufferView): WebGLBuffer => {
      const b = gl.createBuffer()!;
      gl.bindBuffer(target, b);
      gl.bufferData(target, data, gl.STATIC_DRAW);
      this.vbo.push(b);
      return b;
    };
    const pos = buffer(gl.ARRAY_BUFFER, mesh.positions),
      feat = buffer(gl.ARRAY_BUFFER, mesh.vertexFeatures);
    const vao = (indices: Uint32Array): WebGLVertexArrayObject => {
      const v = gl.createVertexArray()!;
      gl.bindVertexArray(v);
      gl.bindBuffer(gl.ARRAY_BUFFER, pos);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, feat);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_INT, 0, 0);
      buffer(gl.ELEMENT_ARRAY_BUFFER, indices);
      gl.bindVertexArray(null);
      return v;
    };
    this.tri = vao(mesh.triangles);
    this.line = vao(mesh.lines);
    this.geometryBytes = mesh.positions.byteLength + mesh.vertexFeatures.byteLength + mesh.triangles.byteLength + mesh.lines.byteLength;
  }
  get bytes(): number {
    return this.geometryBytes + Math.max(1, this.tables.size) * Math.ceil(this.mesh.featureCount / TEX_W) * TEX_W * 8;
  }
  /** Uploads the tables of state `key` (and its extra tables) and makes them current. */
  colors(fill: Uint8Array, edge: Uint8Array, key: string, draws?: CityGlDraws, extra: Partial<Record<FillExtra, Uint8Array>> = {}): void {
    const gl = this.gl;
    let t = this.tables.get(key);
    if (!t) {
      if (this.tables.size >= TABLES_KEPT) {
        const [oldest, old] = this.tables.entries().next().value!;
        this.tables.delete(oldest);
        gl.deleteTexture(old.fill);
        gl.deleteTexture(old.edge);
        for (const x of Object.values(old.extra)) if (x) gl.deleteTexture(x);
      }
      t = { fill: gl.createTexture()!, edge: gl.createTexture()!, extra: {} };
      this.tables.set(key, t);
    }
    t.draws = draws;
    uploadTable(gl, t.fill, fill);
    uploadTable(gl, t.edge, edge);
    for (const name of FILL_EXTRAS) {
      const data = extra[name];
      if (data) uploadTable(gl, (t.extra[name] ??= gl.createTexture()!), data);
      else if (t.extra[name]) {
        gl.deleteTexture(t.extra[name]!);
        delete t.extra[name];
      }
    }
    this.current(t);
  }
  private current(t: { fill: WebGLTexture; edge: WebGLTexture; extra: Partial<Record<FillExtra, WebGLTexture>> }): void {
    this.fill = t.fill;
    this.edge = t.edge;
    this.hatch = t.extra.hatch ?? null;
    this.grain = t.extra.grain ?? null;
    this.rim = t.extra.rim ?? null;
  }
  /** Makes the kept tables of state `key` current; undefined when they are not kept. */
  table(key: string): { draws?: CityGlDraws } | undefined {
    const t = this.tables.get(key);
    if (t) this.current(t);
    return t;
  }
  /** The tables of state `key` are kept (nothing made current). */
  has(key: string): boolean {
    return this.tables.has(key);
  }
  materials(table: Uint8Array): void {
    uploadTable(this.gl, (this.mats ??= this.gl.createTexture()!), table);
  }
  dispose(): void {
    const gl = this.gl;
    if (this.mats) gl.deleteTexture(this.mats);
    this.vbo.forEach(b => gl.deleteBuffer(b));
    gl.deleteVertexArray(this.tri);
    gl.deleteVertexArray(this.line);
    for (const t of this.tables.values()) {
      gl.deleteTexture(t.fill);
      gl.deleteTexture(t.edge);
      for (const x of Object.values(t.extra)) if (x) gl.deleteTexture(x);
    }
    this.tables.clear();
    this.fill = this.edge = this.hatch = this.grain = this.rim = null;
  }
}
/** Segment instances on the GPU (36-byte stride), with outer/inner colour tables. */
export class StrokePack {
  vbo: WebGLBuffer;
  vao: WebGLVertexArrayObject;
  outer: WebGLTexture;
  inner: WebGLTexture;
  mats?: WebGLTexture;
  bytes: number;
  constructor(
    private gl: WebGL2RenderingContext,
    readonly strokes: CityGlStrokes,
    dynamic = false,
  ) {
    this.vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, strokes.data, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    this.vao = gl.createVertexArray()!;
    this.bind(0);
    this.outer = gl.createTexture()!;
    this.inner = gl.createTexture()!;
    this.bytes = strokes.data.byteLength;
  }
  /** Attribute pointers from instance `first` (WebGL2 has no base instance). */
  bind(first: number): void {
    const gl = this.gl,
      stride = STROKE_STRIDE * 4,
      o = first * stride;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, stride, o);
    gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, o + 16);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribIPointer(2, 2, gl.UNSIGNED_INT, stride, o + 28);
    gl.vertexAttribDivisor(2, 1);
  }
  colors(outer: Uint8Array, inner: Uint8Array): void {
    uploadTable(this.gl, this.outer, outer);
    uploadTable(this.gl, this.inner, inner);
  }
  materials(table: Uint8Array): void {
    uploadTable(this.gl, (this.mats ??= this.gl.createTexture()!), table);
  }
  dispose(): void {
    const gl = this.gl;
    if (this.mats) gl.deleteTexture(this.mats);
    gl.deleteBuffer(this.vbo);
    gl.deleteVertexArray(this.vao);
    gl.deleteTexture(this.outer);
    gl.deleteTexture(this.inner);
  }
}
/** First street stroke that is a crossing (bridge, ford, pier, boardwalk): crossings are sorted last. */
export function crossingStart(strokes: CityGlStrokes | undefined): number {
  if (!strokes) return 0;
  const u = new Uint32Array(strokes.data);
  for (let i = 0; i < strokes.count; i++) if (u[i * STROKE_STRIDE + 8] & META.crossing) return i;
  return strokes.count;
}
