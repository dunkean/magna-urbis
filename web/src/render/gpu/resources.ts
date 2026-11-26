/**
 * GPU-side caches of one vector rasterizer (replay.ts): path geometry in a slab arena (fill fans, stroke instances),
 * textures of pattern and sprite sources, sprite instance buffers. Each is uploaded once and kept under a byte
 * budget, least recently used first; what the current replay uses (`epoch`, `pinned`) is never evicted under it.
 *
 * `counting`: set by the live rasterizer while a frame replays; everything created or uploaded then is counted in
 * `late` (it should have been made by `warm` or `prepare`, in the layer's `work`).
 */
import { GpuRasterError, opaqueContourPlates, SPRITE_STRIDE, type ImageSource, type Mat, type PathGeometry, type RecordedPath, type SpriteOp, type StrokeOp } from './contract';
import { fillFans, strokeSegments, type StrokeGeometry } from './tessellate';
import { tolerance } from './transforms';

const BUDGET = 256 * 1024 * 1024;
/** Textures (patterns, sprite atlases, cut masks) beyond this are dropped least recently used first, never during the render that uses them. */
const TEXTURE_BUDGET = 256 * 1024 * 1024;
const SPRITE_BUDGET = 128 * 1024 * 1024;

interface Block {
  offset: number;
  size: number;
}
interface Page {
  buffer: WebGLBuffer;
  capacity: number;
  free: Block[];
  used: number;
}
export interface Slice {
  page: Page;
  offset: number;
  bytes: number;
  floats: number;
}

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
        const block = page.free[i],
          offset = block.offset;
        block.offset += size;
        block.size -= size;
        if (!block.size) page.free.splice(i, 1);
        page.used += size;
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, page.buffer);
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, offset, data);
        return { page, offset, bytes: size, floats: data.length };
      }
      const capacity = Math.ceil(Math.max(this.nextSize, size) / 24) * 24;
      if (this.capacity + capacity > BUDGET) {
        if (evict()) continue;
        throw new GpuRasterError('Vector geometry cache is full');
      }
      const buffer = this.gl.createBuffer();
      if (!buffer) throw new GpuRasterError('Cannot allocate vector geometry buffer');
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, capacity, this.gl.STATIC_DRAW);
      this.pages.push({ buffer, capacity, free: [{ offset: 0, size: capacity }], used: 0 });
      this.capacity += capacity;
      this.nextSize = Math.min(4 * 1024 * 1024, this.nextSize * 2);
    }
  }
  release(slice: Slice | null): void {
    if (!slice) return;
    const p = slice.page;
    p.used -= slice.bytes;
    if (!p.used) {
      this.gl.deleteBuffer(p.buffer);
      this.capacity -= p.capacity;
      this.pages.splice(this.pages.indexOf(p), 1);
      return;
    }
    p.free.push({ offset: slice.offset, size: slice.bytes });
    p.free.sort((a, b) => a.offset - b.offset);
    for (let i = p.free.length - 1; i > 0; i--) {
      const a = p.free[i - 1],
        b = p.free[i];
      if (a.offset + a.size === b.offset) {
        a.size += b.size;
        p.free.splice(i, 1);
      }
    }
  }
  dispose(): void {
    for (const p of this.pages) this.gl.deleteBuffer(p.buffer);
    this.pages.length = 0;
    this.capacity = 0;
  }
}

/** Stroke instances of one path (segments, discs, joins), uploaded once and kept in the arena. */
export type StrokeSlices = [Slice | null, Slice | null, Slice | null];
export interface GeometryData {
  version: number;
  bucket: number;
  geometry: PathGeometry;
  /** Uploaded on the first fill or clip (undefined: not yet; null: nothing to fill). */
  fan?: Slice | null;
  /** Stroke instances per cap/join, uploaded once and replayed from the arena (one draw per kind for many paths). */
  strokes: Map<string, StrokeSlices>;
  bytes: number;
}
interface TextureData {
  texture: WebGLTexture;
  width: number;
  height: number;
  bytes: number;
  used: number;
}

/** Which flattening tolerance a path is uploaded at. `m`: the op's transform under the replay matrix; `recorded`:
 * the transform it was recorded with. */
export interface ToleranceRule {
  bucket(m: Mat, recorded: Mat): number;
  /** A finer geometry already uploaded serves instead of flattening the path again. */
  readonly keepsFinerGeometry: boolean;
}
/** Tile rasterizer: each replay flattens at its own scale. */
export const REPLAY_TOLERANCE: ToleranceRule = { bucket: m => tolerance(m), keepsFinerGeometry: false };
/** Live rasterizer: the tolerance of the recorded scale, whatever the replay matrix, so a zoom over a retained list
 * never flattens or uploads a path inside a frame (the list is stretched by a fraction of an octave at most); and a
 * finer geometry already uploaded serves (two regions of neighbouring scales share their paths while one replaces the
 * other: neither may flatten the other's upload away). */
export const RECORDED_TOLERANCE: ToleranceRule = { bucket: (_m, recorded) => tolerance(recorded), keepsFinerGeometry: true };

export class GpuResources {
  private arena: Arena;
  private cache = new Map<RecordedPath, GeometryData>();
  /** Entries a replay is about to draw: a later upload must not evict them. */
  readonly pinned = new Set<GeometryData>();
  private textures = new Map<ImageSource | ImageData, TextureData>();
  private textureBytes = 0;
  /** Sprite buffers per immutable instance array (LRU, never evicted during the render that uses them). */
  private spriteBuffers = new Map<Float32Array, { buffer: WebGLBuffer; bytes: number; used: number }>();
  private spriteCapacity = 0;
  /** Render counter: textures and sprite buffers used by the current render are never evicted. */
  epoch = 0;
  counting = false;
  late = 0;

  constructor(
    private gl: WebGL2RenderingContext,
    private rule: ToleranceRule,
  ) {
    this.arena = new Arena(gl);
  }

  /** Something a frame had to create or upload itself (counted while `counting`). */
  noteLate(): void {
    if (this.counting) this.late++;
  }
  bytes(): number {
    return this.arena.capacity + this.spriteCapacity + this.textureBytes;
  }

  geometry(path: RecordedPath, m: Mat, recorded: Mat = m): GeometryData {
    if (!path.readable) throw new GpuRasterError('Unreadable vector path');
    let bucket = this.rule.bucket(m, recorded);
    let entry = this.cache.get(path);
    if (entry && entry.version === path.version && entry.bucket !== bucket) {
      if (this.rule.keepsFinerGeometry && entry.bucket < bucket) bucket = entry.bucket;
      // A straight path returns the same geometry at every tolerance: keep its uploads across zoom levels.
      else if (path.geometry(bucket) === entry.geometry) entry.bucket = bucket;
    }
    if (entry && (entry.version !== path.version || entry.bucket !== bucket)) {
      this.release(entry);
      this.cache.delete(path);
      entry = undefined;
    }
    if (!entry) entry = { version: path.version, bucket, geometry: path.geometry(bucket), strokes: new Map(), bytes: 0 };
    this.cache.delete(path);
    this.cache.set(path, entry);
    return entry;
  }
  /** The fill fan, uploaded on first use (strokes never need it). */
  fanOf(entry: GeometryData): Slice | null {
    if (entry.fan === undefined) {
      this.noteLate();
      this.pinned.add(entry);
      try {
        entry.fan = this.arena.upload(fillFans(entry.geometry), this.evict);
        entry.bytes += entry.fan?.bytes ?? 0;
      } finally {
        this.pinned.delete(entry);
      }
    }
    return entry.fan ?? null;
  }
  /** Instances depend neither on the width (a uniform) nor on the miter limit (recomputed in the shader): uploaded once
   * per path, cap and join, then replayed from the arena at every frame (map-wide contours never stream again). */
  strokeSlices(entry: GeometryData, op: StrokeOp, key = `${op.cap}/${op.join}`): StrokeSlices {
    let slices = entry.strokes.get(key);
    if (!slices) {
      this.noteLate();
      const mesh: StrokeGeometry = strokeSegments(entry.geometry, { width: 1, cap: op.cap, join: op.join, miterLimit: op.miterLimit });
      const made: (Slice | null)[] = [];
      this.pinned.add(entry);
      try {
        for (const data of [mesh.segments, mesh.discs, mesh.joins]) made.push(this.arena.upload(data, this.evict));
      } catch (error) {
        for (const slice of made) this.arena.release(slice);
        throw error;
      } finally {
        this.pinned.delete(entry);
      }
      slices = made as StrokeSlices;
      entry.strokes.set(key, slices);
      for (const slice of slices) entry.bytes += slice?.bytes ?? 0;
    }
    return slices;
  }

  /** Binds the texture of `source` on unit 0 with these sampling parameters, uploading it (with mipmaps) on first use.
   * Null for a source without pixels (an emptied canvas): its draw is skipped instead of failing the whole replay. */
  texture(source: ImageSource | ImageData, smoothing: boolean, repeatX = false, repeatY = false, unit = 0): TextureData | null {
    const gl = this.gl;
    let t = this.textures.get(source);
    gl.activeTexture(gl.TEXTURE0 + unit);
    if (!t) {
      const dimensions = source as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number; displayWidth?: number; displayHeight?: number };
      const width = dimensions.naturalWidth ?? dimensions.videoWidth ?? dimensions.displayWidth ?? dimensions.width ?? 0;
      const height = dimensions.naturalHeight ?? dimensions.videoHeight ?? dimensions.displayHeight ?? dimensions.height ?? 0;
      if (!(width > 0 && height > 0)) return null;
      const texture = gl.createTexture();
      if (!texture) throw new GpuRasterError('Cannot allocate vector texture');
      this.noteLate();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      // RG8 samples as (r, g, 0, 1), exactly the producer's pixels even for ordinary drawImage and patterns.
      const coverage = opaqueContourPlates.has(source);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, coverage ? gl.RG8 : gl.RGBA, coverage ? gl.RG : gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
      } catch (error) {
        gl.deleteTexture(texture);
        throw error;
      }
      // Patterns and sprites are often drawn far smaller than their texels (hatches at 14 px per metre, crown atlases):
      // mipmaps keep them from shimmering, like the Canvas high-quality drawImage.
      gl.generateMipmap(gl.TEXTURE_2D);
      t = { texture, width, height, bytes: Math.ceil((width * height * (coverage ? 2 : 4) * 4) / 3), used: this.epoch };
      this.textures.set(source, t);
      this.textureBytes += t.bytes;
      this.evictTextures();
      gl.bindTexture(gl.TEXTURE_2D, texture);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, t.texture);
      this.textures.delete(source);
      this.textures.set(source, t);
      t.used = this.epoch;
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, smoothing ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, smoothing ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeatX ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, repeatY ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    return t;
  }
  /** A source canvas changed after it was first drawn: drop its texture. */
  invalidateImage(source: ImageSource): void {
    const t = this.textures.get(source);
    if (t) {
      this.gl.deleteTexture(t.texture);
      this.textures.delete(source);
      this.textureBytes -= t.bytes;
    }
  }

  /** The instance buffer of a sprite op for a draw: made on first use (a retained list replays it at every frame). */
  spriteBuffer(op: SpriteOp): WebGLBuffer {
    let held = this.spriteBuffers.get(op.instances);
    if (!held) {
      this.noteLate();
      held = this.makeSpriteBuffer(op);
    } else {
      this.spriteBuffers.delete(op.instances);
      this.spriteBuffers.set(op.instances, held);
      held.used = this.epoch;
    }
    return held.buffer;
  }
  /** The instance buffer of a sprite op, made ahead of its first draw. */
  uploadSprites(op: SpriteOp): void {
    if (!op.count || this.spriteBuffers.has(op.instances)) return;
    this.makeSpriteBuffer(op);
  }
  private makeSpriteBuffer(op: SpriteOp): { buffer: WebGLBuffer; bytes: number; used: number } {
    const gl = this.gl,
      buffer = gl.createBuffer();
    if (!buffer) throw new GpuRasterError('Cannot allocate sprite buffer');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, op.instances.subarray(0, op.count * SPRITE_STRIDE), gl.STATIC_DRAW);
    const held = { buffer, bytes: op.count * SPRITE_STRIDE * 4, used: this.epoch };
    this.spriteBuffers.set(op.instances, held);
    this.spriteCapacity += held.bytes;
    this.evictSprites();
    return held;
  }

  private evictSprites(): void {
    for (const [op, held] of this.spriteBuffers) {
      if (this.spriteCapacity <= SPRITE_BUDGET) return;
      if (held.used === this.epoch) continue;
      this.gl.deleteBuffer(held.buffer);
      this.spriteBuffers.delete(op);
      this.spriteCapacity -= held.bytes;
    }
  }
  private evictTextures(): void {
    for (const [source, t] of this.textures) {
      if (this.textureBytes <= TEXTURE_BUDGET) return;
      if (t.used === this.epoch) continue;
      this.gl.deleteTexture(t.texture);
      this.textures.delete(source);
      this.textureBytes -= t.bytes;
    }
  }
  private release(entry: GeometryData): void {
    this.arena.release(entry.fan ?? null);
    for (const slices of entry.strokes.values()) for (const slice of slices) this.arena.release(slice);
  }
  private evict = (): boolean => {
    for (const [path, entry] of this.cache) {
      if (this.pinned.has(entry)) continue;
      this.release(entry);
      this.cache.delete(path);
      return true;
    }
    return false;
  };

  dispose(): void {
    this.arena.dispose();
    this.cache.clear();
    this.pinned.clear();
    for (const t of this.textures.values()) this.gl.deleteTexture(t.texture);
    this.textures.clear();
    this.textureBytes = 0;
    for (const held of this.spriteBuffers.values()) this.gl.deleteBuffer(held.buffer);
    this.spriteBuffers.clear();
    this.spriteCapacity = 0;
  }
  /** The context was lost: every handle died with it; forget them without a GL call. */
  drop(): void {
    this.arena = new Arena(this.gl);
    this.cache.clear();
    this.pinned.clear();
    this.textures.clear();
    this.textureBytes = 0;
    this.spriteBuffers.clear();
    this.spriteCapacity = 0;
  }
}
