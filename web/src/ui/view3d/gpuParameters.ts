/**
 * Uniform-storage packing and frame upload pools used by GPU terrain and building recording.
 * Reads/writes: Each Params owns its typed views; each Pool owns staging chunks and GPU buffers. Callers control begin/alloc/flush/destroy order.
 */
type ParamsLayout = { size: number; fields: Record<string, { offset: number; type: string; count: number }> };

const COMPONENTS: Record<string, number> = { float: 1, int: 1, uint: 1, bool: 1, vec2: 2, ivec2: 2, uvec2: 2, vec3: 3, ivec3: 3, uvec3: 3, vec4: 4, ivec4: 4, uvec4: 4, mat4: 16 };

const ARRAY_STRIDE: Record<string, number> = { float: 4, int: 4, uint: 4, bool: 4, vec2: 8, ivec2: 8, uvec2: 8, vec3: 16, ivec3: 16, uvec3: 16, vec4: 16, ivec4: 16, uvec4: 16, mat4: 64 };

/** CPU image of a program's storage block; unknown names are ignored, as absent GL uniforms are. */
export class Params {
  readonly bytes: Uint8Array<ArrayBuffer>;
  private f32: Float32Array;
  private i32: Int32Array;
  private u32: Uint32Array;
  constructor(private layout: ParamsLayout) {
    const buffer = new ArrayBuffer(layout.size);
    this.bytes = new Uint8Array(buffer);
    this.f32 = new Float32Array(buffer);
    this.i32 = new Int32Array(buffer);
    this.u32 = new Uint32Array(buffer);
  }
  set(name: string, ...values: number[]): void {
    this.write(name, values);
  }
  setArray(name: string, values: ArrayLike<number>): void {
    this.write(name, values);
  }
  private write(name: string, values: ArrayLike<number>): void {
    const field = this.layout.fields[name];
    if (!field) return;
    const components = COMPONENTS[field.type],
      stride = ARRAY_STRIDE[field.type] / 4,
      elements = Math.max(1, field.count);
    const view = /^(u|uvec)/.test(field.type) ? this.u32 : /^(int|ivec|bool)/.test(field.type) ? this.i32 : this.f32;
    for (let k = 0; k < values.length && k < elements * components; k++) {
      const element = Math.floor(k / components),
        component = k % components;
      view[field.offset / 4 + element * stride + component] = view === this.u32 ? values[k] >>> 0 : values[k];
    }
  }
}

/** Per-frame upload pool: draws copy their data into chunked staging, written once before the submit. */
export class Pool {
  private chunks: { buffer: GPUBuffer; staging: Uint8Array<ArrayBuffer>; used: number }[] = [];
  private at = 0;
  constructor(
    private device: GPUDevice,
    private usage: GPUBufferUsageFlags,
    private chunkSize: number,
    private align: number,
    private label: string,
  ) {}
  begin(): void {
    for (const chunk of this.chunks) chunk.used = 0;
    this.at = 0;
  }
  alloc(data: ArrayBufferView): { buffer: GPUBuffer; offset: number } {
    const size = data.byteLength,
      bytes = new Uint8Array(data.buffer, data.byteOffset, size);
    for (;;) {
      let chunk = this.chunks[this.at];
      if (!chunk) {
        const capacity = Math.max(this.chunkSize, Math.ceil(size / 4) * 4);
        chunk = { buffer: this.device.createBuffer({ label: this.label, size: capacity, usage: this.usage | GPUBufferUsage.COPY_DST }), staging: new Uint8Array(capacity), used: 0 };
        this.chunks.push(chunk);
      }
      const offset = Math.ceil(chunk.used / this.align) * this.align;
      if (offset + size <= chunk.staging.length) {
        chunk.staging.set(bytes, offset);
        chunk.used = offset + size;
        return { buffer: chunk.buffer, offset };
      }
      this.at++;
    }
  }
  flush(): void {
    for (let i = 0; i <= this.at && i < this.chunks.length; i++) {
      const chunk = this.chunks[i];
      if (chunk.used) this.device.queue.writeBuffer(chunk.buffer, 0, chunk.staging, 0, Math.ceil(chunk.used / 4) * 4);
    }
  }
  destroy(): void {
    for (const chunk of this.chunks) chunk.buffer.destroy();
    this.chunks = [];
  }
}
