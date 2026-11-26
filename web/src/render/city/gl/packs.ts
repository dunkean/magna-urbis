/**
 * Retained GPU data of the GPU town: a fill mesh with its per-state colour tables (`FillPack`) and segment
 * instances with their two colour tables (`StrokePack`). Each owns its buffers and textures; renderer.ts builds
 * them at upload and disposes them.
 */
import { META, STROKE_STRIDE, type CityGlFillMesh, type CityGlStrokes } from '../../cityGlBuild';
import type { CellPageMesh, MeshReindex, MeshUpload } from './cellMesh';
import { type CityGlDraws } from './styleTables';
// walls hook (cityWalls.ts)

const TEX_W = 4096;
export const tableRows = (features: number) => Math.max(1, Math.ceil(features / TEX_W));
function uploadTable(gl: WebGL2RenderingContext, texture: WebGLTexture, rgba: Uint8Array): void {
  const rows = tableRows(rgba.length / 4),
    data = rgba.length === rows * TEX_W * 4 ? rgba : new Uint8Array(rows * TEX_W * 4);
  if (data !== rgba) data.set(rgba);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, TEX_W, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
}

type FillExtra = 'hatch' | 'grain' | 'rim' | 'lay';
const FILL_EXTRAS: readonly FillExtra[] = ['hatch', 'grain', 'rim', 'lay'];
export interface CellColors {
  fill: Uint8Array;
  line: Uint8Array;
  draws?: CityGlDraws;
  extra?: Partial<Record<FillExtra, Uint8Array>>;
}
export interface CellPaint {
  cell: number;
  first: number;
  colors: CellColors;
}
function patchTable(gl: WebGL2RenderingContext, t: WebGLTexture, first: number, rgba: Uint8Array) {
  gl.bindTexture(gl.TEXTURE_2D, t);
  for (let offset = 0; offset < rgba.length;) {
    const x = first % TEX_W,
      width = Math.min(TEX_W - x, (rgba.length - offset) / 4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, Math.floor(first / TEX_W), width, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba.subarray(offset, offset + width * 4));
    first += width;
    offset += width * 4;
  }
}
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
   * wall-rim colours and how the grain tile lies on each pan (buildings, styleTables CityGlRoofGrain); null when the
   * state has none. */
  hatch: WebGLTexture | null = null;
  grain: WebGLTexture | null = null;
  rim: WebGLTexture | null = null;
  lay: WebGLTexture | null = null;
  private tables = new Map<string, { fill: WebGLTexture; edge: WebGLTexture; extra: Partial<Record<FillExtra, WebGLTexture>>; draws?: CityGlDraws; dirty: Set<number>; cellDraws: Map<number, CityGlDraws> }>();
  private matKey?: string;
  private matDirty = new Set<number>();
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
  /** COPY_WRITE_BUFFER does not disturb the element binding of any VAO in the shared context. */
  readonly uploadRange: MeshUpload = (stream, offset, data) => {
    const gl = this.gl,
      i = stream === 'positions' ? 0 : stream === 'vertexFeatures' ? 1 : stream === 'triangles' ? 2 : 3;
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, this.vbo[i]);
    gl.bufferSubData(gl.COPY_WRITE_BUFFER, offset, data);
  };
  readonly moveIndices: MeshReindex = (stream, indices, moves) => {
    const gl = this.gl,
      i = stream === 'triangles' ? 2 : 3,
      vao = stream === 'triangles' ? this.tri : this.line;
    const previous = this.vbo[i],
      next = gl.createBuffer()!;
    // Establish the element-buffer type before a GPU copy from another element buffer.
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, next);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.COPY_READ_BUFFER, previous);
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, next);
    gl.bufferData(gl.COPY_WRITE_BUFFER, indices.byteLength, gl.DYNAMIC_DRAW);
    for (const { from, start, count } of moves) {
      if (from === undefined) gl.bufferSubData(gl.COPY_WRITE_BUFFER, start * 4, indices.subarray(start, start + count));
      else gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, from * 4, start * 4, count * 4);
    }
    gl.deleteBuffer(previous);
    this.vbo[i] = next;
    this.geometryBytes = this.mesh.positions.byteLength + this.mesh.vertexFeatures.byteLength + this.mesh.triangles.byteLength + this.mesh.lines.byteLength;
  };
  removeCell(cell: number): void {
    for (const t of this.tables.values()) {
      t.cellDraws.delete(cell);
      t.dirty.delete(cell);
      t.draws = this.drawFlags(t.cellDraws);
    }
    this.matDirty.delete(cell);
  }
  private drawFlags(flags: Map<number, CityGlDraws>): CityGlDraws | undefined {
    let result: CityGlDraws | undefined;
    for (const d of flags.values()) {
      if (!result) result = { ...d };
      else for (const k of Object.keys(d) as (keyof CityGlDraws)[]) if (d[k]) result[k] = true;
    }
    return result;
  }
  invalidateCell(cell: number): void {
    for (const t of this.tables.values()) t.dirty.add(cell);
    this.matDirty.add(cell);
  }
  needsCell(key: string, cell: number): boolean {
    const t = this.tables.get(key);
    return !t || t.dirty.has(cell);
  }
  private texture(): WebGLTexture {
    const gl = this.gl,
      t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, TEX_W, tableRows(this.mesh.featureCount), 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return t;
  }
  colors(key: string, patches: readonly CellPaint[]): void {
    const gl = this.gl;
    let t = this.tables.get(key);
    if (!t) {
      if (this.tables.size >= TABLES_KEPT) {
        const [oldest, old] = this.tables.entries().next().value!;
        this.tables.delete(oldest);
        gl.deleteTexture(old.fill);
        gl.deleteTexture(old.edge);
        for (const x of Object.values(old.extra)) gl.deleteTexture(x);
      }
      t = { fill: this.texture(), edge: this.texture(), extra: {}, dirty: new Set(), cellDraws: new Map() };
      this.tables.set(key, t);
    }
    for (const { cell, first, colors } of patches) {
      patchTable(gl, t.fill, first, colors.fill);
      patchTable(gl, t.edge, first, colors.line);
      for (const name of FILL_EXTRAS) {
        const data = colors.extra?.[name];
        if (data) patchTable(gl, (t.extra[name] ??= this.texture()), first, data);
        else if (t.extra[name]) patchTable(gl, t.extra[name]!, first, new Uint8Array(colors.fill.length));
      }
      if (colors.draws) t.cellDraws.set(cell, colors.draws);
      t.dirty.delete(cell);
    }
    t.draws = this.drawFlags(t.cellDraws);
    this.current(t);
  }
  private current(t: { fill: WebGLTexture; edge: WebGLTexture; extra: Partial<Record<FillExtra, WebGLTexture>> }): void {
    this.fill = t.fill;
    this.edge = t.edge;
    this.hatch = t.extra.hatch ?? null;
    this.grain = t.extra.grain ?? null;
    this.rim = t.extra.rim ?? null;
    this.lay = t.extra.lay ?? null;
  }
  /** Makes the kept tables of state `key` current; undefined when they are not kept. */
  table(key: string): { draws?: CityGlDraws } | undefined {
    const t = this.tables.get(key);
    if (t) this.current(t);
    return t;
  }
  /** The tables of state `key` are kept (nothing made current). */
  has(key: string): boolean {
    return this.tables.get(key)?.dirty.size === 0;
  }
  materials<T>(key: string, page: CellPageMesh<T>, make: (part: T, mesh: CityGlFillMesh) => Uint8Array): void {
    if (this.matKey === key && !this.matDirty.size) return;
    const t = (this.mats ??= this.texture());
    for (const c of page.cells.values()) if (this.matKey !== key || this.matDirty.has(c.key)) patchTable(this.gl, t, page.slots.get(c.key)!.feature.start, make(c.part, c.mesh));
    this.matKey = key;
    this.matDirty.clear();
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
    this.fill = this.edge = this.hatch = this.grain = this.rim = this.lay = null;
  }
}
/** Preserve painter order by copying relocated records on the GPU. Only newly packed records cross the bus. */
export function replaceBufferParts(gl: WebGL2RenderingContext, vbo: WebGLBuffer, bytes: number, previousParts: readonly ArrayBuffer[], next: readonly ArrayBuffer[]): { vbo: WebGLBuffer; bytes: number } {
  const old = new Map<ArrayBuffer, number>();
  let offset = 0;
  for (const part of previousParts) {
    old.set(part, offset);
    offset += part.byteLength;
  }
  let size = 0,
    moves = false;
  for (const part of next) {
    const from = old.get(part);
    if (from !== undefined && from !== size) moves = true;
    size += part.byteLength;
  }
  const previous = vbo,
    replace = moves || size > bytes;
  if (replace) {
    vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.COPY_READ_BUFFER, previous);
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, vbo);
    gl.bufferData(gl.COPY_WRITE_BUFFER, size, gl.DYNAMIC_DRAW);
    bytes = size;
  } else gl.bindBuffer(gl.COPY_WRITE_BUFFER, vbo);
  offset = 0;
  let copyFrom = 0,
    copyTo = 0,
    copyBytes = 0;
  const flush = () => {
    if (copyBytes) gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, copyFrom, copyTo, copyBytes);
    copyBytes = 0;
  };
  for (const part of next) {
    const from = old.get(part);
    if (from === undefined) {
      flush();
      if (part.byteLength) gl.bufferSubData(gl.COPY_WRITE_BUFFER, offset, new Uint8Array(part));
    } else if (replace) {
      if (!copyBytes || copyFrom + copyBytes !== from || copyTo + copyBytes !== offset) {
        flush();
        copyFrom = from;
        copyTo = offset;
      }
      copyBytes += part.byteLength;
    }
    offset += part.byteLength;
  }
  flush();
  if (replace) gl.deleteBuffer(previous);
  return { vbo, bytes };
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
    public strokes: CityGlStrokes,
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
  /** Reuse contiguous unchanged runs on the GPU, including when a changed gate moves a later run.
   * A relocation uses a second buffer because overlapping copies within one WebGL buffer are invalid. */
  replaceParts(next: CityGlStrokes, streetIndices?: readonly number[]): void {
    if (streetIndices && next.streetSlots && next.streetSlots === this.strokes.streetSlots) {
      const gl = this.gl;
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, this.vbo);
      for (const i of streetIndices) {
        const data = next.streets![i].data;
        if (data !== this.strokes.streets![i].data && data.byteLength) gl.bufferSubData(gl.COPY_WRITE_BUFFER, next.streetSlots[i].offset, new Uint8Array(data));
      }
      this.strokes = next;
      return;
    }
    const updated = replaceBufferParts(this.gl, this.vbo, this.bytes, this.strokes.parts!, next.parts!);
    if (updated.vbo !== this.vbo) {
      this.vbo = updated.vbo;
      this.bind(0);
    }
    this.bytes = updated.bytes;
    this.strokes = next;
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
  patchColors(first: number, outer: Uint8Array, inner: Uint8Array): void {
    patchTable(this.gl, this.outer, first, outer);
    patchTable(this.gl, this.inner, first, inner);
  }
  patchMaterials(first: number, data: Uint8Array): void {
    if (this.mats) patchTable(this.gl, this.mats, first, data);
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
  if (strokes.crossingStart !== undefined) return strokes.crossingStart;
  const u = new Uint32Array(strokes.data);
  for (let i = 0; i < strokes.count; i++) if (u[i * STROKE_STRIDE + 8] & META.crossing) return i;
  return strokes.count;
}
/** One page of a paged fill (pages.ts): its own scene part, mesh, buffers and colour tables. */
export interface FillPage<T> {
  key: number;
  /** The page's part of the scene (a plan page or a building page) its tables are computed from. */
  geometry: CellPageMesh<T>;
  pack: FillPack;
  box: [number, number, number, number];
}
/** The fills of a scene as spatial pages, each a FillPack with its own feature numbering: a frame draws the pages in
 * view one after the other in each pass; an edit replaces only the pages it changed. */
export class FillPages<T> {
  /** Triangles and outline edges of each layer over every page (what a frame checks before a pass). */
  readonly byKey: Map<number, FillPage<T>>;
  readonly counts: Record<string, { triangles: number; lines: number }> = {};
  readonly featureCount: number;
  private draws = new Map<string, CityGlDraws | undefined>();
  constructor(readonly pages: FillPage<T>[]) {
    this.byKey = new Map(pages.map(p => [p.key, p]));
    let features = 0;
    for (const p of pages) {
      features += p.pack.mesh.featureCount;
      for (const [name, l] of Object.entries(p.pack.mesh.layers)) {
        const c = (this.counts[name] ??= { triangles: 0, lines: 0 });
        c.triangles += l.triangles.count;
        c.lines += l.lines.count;
      }
    }
    this.featureCount = features;
  }
  get bytes(): number {
    return this.pages.reduce((s, p) => s + p.pack.bytes, 0);
  }
  /** Every page keeps the tables of state `key`. */
  has(key: string): boolean {
    return this.pages.every(p => p.pack.has(key));
  }
  /** Makes the kept tables of `key` current on every page; the draw list of the pages together (undefined when a page
   * lacks them). */
  table(key: string): { draws?: CityGlDraws } | undefined {
    if (!this.has(key)) return undefined;
    for (const p of this.pages) p.pack.table(key);
    let draws = this.draws.get(key);
    if (!this.draws.has(key)) {
      for (const p of this.pages) {
        const d = p.pack.table(key)?.draws;
        if (!d) continue;
        if (!draws) draws = { ...d };
        else for (const k of Object.keys(d) as (keyof CityGlDraws)[]) draws[k] = !!(draws[k] || d[k]);
      }
      this.draws.set(key, draws);
    }
    return { draws };
  }
  /** Drops the merged draw list of `key` (a page's tables of that key were made again). */
  forget(key: string): void {
    this.draws.delete(key);
  }
  dispose(): void {
    for (const p of this.pages) p.pack.dispose();
  }
}
