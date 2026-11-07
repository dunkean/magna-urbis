import type { ExecutionRuntime } from '../../web/src/ui/executionProfile';
import { nativeRequest, nativeSession } from './nativeEngine';

/**
 * Local profile: the relief engine (the WASM `TerrainEngine`) retained by the native
 * service (`/terrain/relief`, rust/crates/local/src/terrain_session.rs). The source is
 * uploaded once; coasts, sketch edits and every sampling run natively on that session.
 * Metadata read synchronously by the bridge (`min_height`, `source_resolution()`, …)
 * keeps the WASM names and comes back with each reply.
 */
export type NativeReliefBuild =
  | { kind: 'source'; seed: string; width: number; relief: string; erosion: number; motifSize: number; mountainMix: number; environment?: string }
  | { kind: 'surface'; seed: string; width: number }
  | { kind: 'zonedSurface'; seed: string; width: number; motifSize: number; zones: unknown };

/** Same fields as the WASM `TerrainOutput`; `free` is a no-op. */
export interface NativeReliefRegion {
  x: number; y: number; width: number; resolution: number; min_height: number; max_height: number;
  height: Float32Array; cave_mask: Uint8Array; normal_x: Float32Array; normal_y: Float32Array; normal_z: Float32Array;
  free(): void;
}

interface Meta {
  sourceN: number; minHeight: number | null; maxHeight: number | null; erosionSpacing: number | null; samplingParameters: (number | null)[];
  region: { x: number; y: number; width: number; resolution: number; minHeight: number | null; maxHeight: number | null } | null;
  arrays: { name: string; type: 'f32' | 'u8'; count: number }[];
}
type Header = { op: 'build' | 'edit' | 'coast' | 'read'; [key: string]: unknown };

const MISSING = '[relief_session_missing]';
/** NaN tuning (relief default) travels as null. */
const finite = (values: Float64Array) => Array.from(values, v => Number.isFinite(v) ? v : null);
const bytes = (array: ArrayBufferView): Uint8Array<ArrayBuffer> => new Uint8Array(array.buffer as ArrayBuffer, array.byteOffset, array.byteLength);

export class NativeReliefEngine {
  private readonly session = nativeSession();
  private meta!: Meta;
  /** Mutations in order, replayed once if the service evicted the session (LRU). */
  private readonly steps: { header: Header; plane?: Float32Array }[] = [];
  private released = false;

  private constructor(private readonly runtime: ExecutionRuntime, readonly tuning: Float64Array) {}

  /** `tuning`: the erosion overrides of the WASM engine's construction, also used by later edits and default coasts. */
  static async build(runtime: ExecutionRuntime, build: NativeReliefBuild, plane: Float32Array, tuning: Float64Array): Promise<NativeReliefEngine> {
    const engine = new NativeReliefEngine(runtime, tuning.slice());
    await engine.mutate({ op: 'build', ...build }, plane);
    return engine;
  }

  get min_height(): number { return this.meta.minHeight ?? NaN; }
  get max_height(): number { return this.meta.maxHeight ?? NaN; }
  source_resolution(): number { return this.meta.sourceN; }
  erosion_spacing(): number | undefined { return this.meta.erosionSpacing ?? undefined; }
  sampling_parameters(): Float64Array { return Float64Array.from(this.meta.samplingParameters, v => v ?? NaN); }

  /** `set_edited_surface`. */
  editSurface(heights: Float32Array): Promise<void> { return this.mutate({ op: 'edit' }, heights); }
  /** `set_coast`, or with a prepared surface `configure_coast` + `set_coast_surface`. */
  coast(mask: number, mode: string, coastTuning?: Float64Array, surface?: Float32Array): Promise<void> {
    return this.mutate({ op: 'coast', mask, mode, surface: !!surface, ...(coastTuning ? { tuning: finite(coastTuning) } : {}) }, surface);
  }

  async sampleRegion(x: number, y: number, extent: number, resolution: number): Promise<NativeReliefRegion> {
    const { meta, arrays } = await this.send({ op: 'read', region: { x, y, extent, resolution } });
    const r = meta.region, height = arrays.height as Float32Array | undefined;
    if (!r || !height || height.length !== r.resolution * r.resolution) throw new Error('Native relief sample incomplete.');
    return { x: r.x, y: r.y, width: r.width, resolution: r.resolution, min_height: r.minHeight ?? NaN, max_height: r.maxHeight ?? NaN,
      height, cave_mask: arrays.caveMask as Uint8Array, normal_x: arrays.normalX as Float32Array, normal_y: arrays.normalY as Float32Array,
      normal_z: arrays.normalZ as Float32Array, free() {} };
  }
  async physicalHeightField(): Promise<Float32Array> { return (await this.send({ op: 'read', physical: true })).arrays.physical as Float32Array; }
  async samplingBaseField(): Promise<Float32Array> { return (await this.send({ op: 'read', base: true })).arrays.base as Float32Array; }
  async physicalCaveField(): Promise<Uint8Array> { return (await this.send({ op: 'read', cave: true })).arrays.physicalCave as Uint8Array; }

  /** Release the native session (fire and forget: an evicted or exited session is already gone). */
  free(): void {
    if (this.released) return;
    this.released = true; this.steps.length = 0;
    void nativeRequest(this.runtime, '/release', JSON.stringify({ session: this.session })).then(r => r.arrayBuffer(), () => undefined);
  }

  private async mutate(header: Header, plane?: Float32Array): Promise<void> {
    this.meta = (await this.send(header, plane)).meta;
    this.steps.push({ header, plane });
  }

  private async send(header: Header, plane?: Float32Array): Promise<{ meta: Meta; arrays: Record<string, Float32Array | Uint8Array> }> {
    if (this.released) throw new Error('Native relief engine released.');
    try { return await this.call(header, plane); } catch (error) {
      if (header.op === 'build' || !(error instanceof Error) || !error.message.includes(MISSING)) throw error;
      for (const step of this.steps) await this.call(step.header, step.plane);
      return this.call(header, plane);
    }
  }

  private async call(header: Header, plane?: Float32Array): Promise<{ meta: Meta; arrays: Record<string, Float32Array | Uint8Array> }> {
    const encoded = new TextEncoder().encode(JSON.stringify({ session: this.session, tuning: finite(this.tuning), ...header }));
    const padded = new Uint8Array(Math.ceil(encoded.length / 4) * 4).fill(32); padded.set(encoded);
    const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, padded.length, true);
    const response = await nativeRequest(this.runtime, '/terrain/relief', new Blob([length, padded, ...(plane ? [bytes(plane)] : [])]));
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength < 4) throw new Error('Native relief reply incomplete.');
    const headerLength = new DataView(buffer).getUint32(0, true);
    if (headerLength % 4 || 4 + headerLength > buffer.byteLength) throw new Error('Native relief reply header invalid.');
    const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerLength))) as Meta;
    const arrays: Record<string, Float32Array | Uint8Array> = {};
    let offset = 4 + headerLength;
    for (const { name, type, count } of meta.arrays) {
      const size = count * (type === 'f32' ? 4 : 1);
      if (!Number.isSafeInteger(count) || count < 0 || offset + size > buffer.byteLength) throw new Error('Native relief plane incomplete.');
      arrays[name] = type === 'f32' ? new Float32Array(buffer, offset, count) : new Uint8Array(buffer, offset, count);
      offset += size;
    }
    return { meta, arrays };
  }
}
