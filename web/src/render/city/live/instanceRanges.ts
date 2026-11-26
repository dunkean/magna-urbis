/** Packed instances with stable ownership. These passes are order-independent (additive light or a stencil
 * union of one ink). Removing an instance moves the last one into its slot, so a draw still has one dense range. */
export class InstanceRanges {
  readonly vao: WebGLVertexArrayObject;
  private buffer: WebGLBuffer;
  private data = new Float32Array(0);
  private groups = new Map<object | string, number[]>();
  private owners: { slots: number[]; index: number }[] = [];
  private dirty = new Set<number>();
  private allocated = 0;
  constructor(
    private gl: WebGL2RenderingContext,
    private stride: number,
  ) {
    this.vao = gl.createVertexArray()!;
    this.buffer = gl.createBuffer()!;
    this.bind();
  }
  private bind(): void {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, this.stride, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.bindVertexArray(null);
  }
  get count(): number {
    return this.owners.length;
  }
  get bytes(): number {
    return this.allocated;
  }
  replace(key: object | string, values: ArrayLike<number>): void {
    let slots = this.groups.get(key);
    if (!slots) {
      if (!values.length) return;
      this.groups.set(key, (slots = []));
    }
    const n = values.length / this.stride;
    while (slots.length > n) {
      const at = slots.pop()!,
        last = this.owners.length - 1,
        owner = this.owners.pop()!;
      if (at !== last) {
        this.data.copyWithin(at * this.stride, last * this.stride, (last + 1) * this.stride);
        owner.slots[owner.index] = at;
        this.owners[at] = owner;
        this.dirty.add(at);
      }
    }
    if (!n) {
      this.groups.delete(key);
      return;
    }
    const required = (this.count + n - slots.length) * this.stride;
    if (required > this.data.length) {
      const grown = new Float32Array(Math.max(required, Math.ceil(this.data.length * 1.5), 16 * this.stride));
      grown.set(this.data);
      this.data = grown;
    }
    for (let i = 0; i < n; i++) {
      let at = slots[i],
        changed = false;
      if (at === undefined) {
        at = this.count;
        slots.push(at);
        this.owners.push({ slots, index: i });
        changed = true;
      }
      for (let j = 0; j < this.stride; j++) {
        const v = Math.fround(values[i * this.stride + j]),
          k = at * this.stride + j;
        if (this.data[k] !== v) {
          this.data[k] = v;
          changed = true;
        }
      }
      if (changed) this.dirty.add(at);
    }
  }
  flush(): void {
    if (!this.dirty.size) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    if (this.allocated < this.data.byteLength) {
      if (this.allocated) {
        const previous = this.buffer;
        this.buffer = gl.createBuffer()!;
        this.bind();
        gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.COPY_READ_BUFFER, previous);
        gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.ARRAY_BUFFER, 0, 0, this.allocated);
        gl.deleteBuffer(previous);
      } else gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
      this.allocated = this.data.byteLength;
    }
    {
      const dirty = [...this.dirty].filter(i => i < this.count).sort((a, b) => a - b);
      for (let i = 0; i < dirty.length;) {
        let j = i + 1;
        while (j < dirty.length && dirty[j] === dirty[j - 1] + 1) j++;
        const first = dirty[i] * this.stride,
          end = (dirty[j - 1] + 1) * this.stride;
        gl.bufferSubData(gl.ARRAY_BUFFER, first * 4, this.data.subarray(first, end));
        i = j;
      }
    }
    this.dirty.clear();
  }
  dispose(): void {
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteBuffer(this.buffer);
  }
}
