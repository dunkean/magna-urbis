/**
 * CPU image of a WebGPU program's storage block (binding 0), laid out by the WGSL generator (WGSL_PARAMS): written by
 * name as glUniform* would be, then copied into a per-draw slot of the frame's parameter buffer. Unknown names are
 * ignored, as absent GL uniforms are. Field lookups are resolved once per name (no string work per write).
 */
import type { ParamWriter } from '../lookParams';

type ParamsLayout = { size: number; fields: Record<string, { offset: number; type: string; count: number }> };
const COMPONENTS: Record<string, number> = { float: 1, int: 1, uint: 1, bool: 1, vec2: 2, ivec2: 2, uvec2: 2, vec3: 3, ivec3: 3, uvec3: 3, vec4: 4, ivec4: 4, uvec4: 4 };
const ARRAY_STRIDE: Record<string, number> = { float: 4, int: 4, uint: 4, bool: 4, vec2: 8, ivec2: 8, uvec2: 8, vec3: 16, ivec3: 16, uvec3: 16, vec4: 16, ivec4: 16, uvec4: 16 };

/** A field of the block: its first word, words per element, components, element count and number kind. */
interface Field {
  word: number;
  stride: number;
  components: number;
  elements: number;
  kind: 'u32' | 'i32' | 'f32';
}

export class Params implements ParamWriter {
  readonly bytes: Uint8Array;
  private readonly views: Record<Field['kind'], Float32Array | Int32Array | Uint32Array>;
  /** Fields by uniform name, also under the GL array name (`uName[0]`); null for names outside the block. */
  private readonly fields = new Map<string, Field | null>();
  private readonly one = [0];
  constructor(private readonly layout: ParamsLayout) {
    const buffer = new ArrayBuffer(layout.size);
    this.bytes = new Uint8Array(buffer);
    this.views = { f32: new Float32Array(buffer), i32: new Int32Array(buffer), u32: new Uint32Array(buffer) };
  }
  private field(name: string): Field | null {
    let field = this.fields.get(name);
    if (field !== undefined) return field;
    const entry = this.layout.fields[name.replace(/\[0\]$/, '')];
    field = entry ? { word: entry.offset / 4, stride: ARRAY_STRIDE[entry.type] / 4, components: COMPONENTS[entry.type], elements: Math.max(1, entry.count), kind: /^(u|uvec)/.test(entry.type) ? 'u32' : /^(int|ivec|bool)/.test(entry.type) ? 'i32' : 'f32' } : null;
    this.fields.set(name, field);
    return field;
  }
  /** Scalar or vector components, as uniform{1,2,3,4}{f,i,ui}. */
  set(name: string, ...values: number[]): void {
    this.write(name, values);
  }
  /** A whole array (or vector) from a flat list, as uniform*v. */
  setArray(name: string, values: ArrayLike<number>): void {
    this.write(name, values);
  }
  private write(name: string, values: ArrayLike<number>): void {
    const field = this.field(name);
    if (!field) return;
    const view = this.views[field.kind],
      unsigned = field.kind === 'u32',
      count = Math.min(values.length, field.elements * field.components);
    for (let k = 0; k < count; k++) {
      const element = Math.floor(k / field.components),
        component = k % field.components;
      view[field.word + element * field.stride + component] = unsigned ? values[k] >>> 0 : values[k];
    }
  }
  private scalar(name: string, value: number): void {
    this.one[0] = value;
    this.write(name, this.one);
  }
  private vector(name: string, x: number, y: number, z?: number, w?: number): void {
    const field = this.field(name);
    if (!field) return;
    const view = this.views[field.kind],
      unsigned = field.kind === 'u32',
      n = Math.min(z === undefined ? 2 : w === undefined ? 3 : 4, field.elements * field.components);
    for (let k = 0; k < n; k++) {
      const value = k === 0 ? x : k === 1 ? y : k === 2 ? z! : w!,
        element = Math.floor(k / field.components);
      view[field.word + element * field.stride + (k % field.components)] = unsigned ? value >>> 0 : value;
    }
  }
  int(name: string, value: number): void {
    this.scalar(name, value);
  }
  uint(name: string, value: number): void {
    this.scalar(name, value);
  }
  float(name: string, value: number): void {
    this.scalar(name, value);
  }
  vec2(name: string, x: number, y: number): void {
    this.vector(name, x, y);
  }
  vec3(name: string, x: number, y: number, z: number): void {
    this.vector(name, x, y, z);
  }
  vec4(name: string, x: number, y: number, z: number, w: number): void {
    this.vector(name, x, y, z, w);
  }
  floats(name: string, _size: 1 | 2 | 3 | 4, values: Float32Array | readonly number[]): void {
    this.write(name, values);
  }
}
