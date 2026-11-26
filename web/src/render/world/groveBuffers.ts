import { GROVE_STRIDE, GROVE_TEMPLATE_STRIDE, groveTemplate, type GroveBlock, type GroveInstances, type GroveTemplate } from '../city3d/groveInstances';

interface GroveBatch {
  buffer: WebGLBuffer;
  vao: WebGLVertexArrayObject;
  indices: number;
  count: number;
}

export interface GroveDrawBlock {
  block: GroveBlock;
  trunks: GroveBatch;
  lobes?: GroveBatch;
}

/** One pair of template meshes and one set of instance buffers for the currently held town. */
export class GroveBuffers {
  readonly blocks: GroveDrawBlock[] = [];
  bytes = 0;
  private source?: GroveInstances;
  private readonly templates = new Map<GroveTemplate, { vertices: WebGLBuffer; indices: WebGLBuffer }>();
  private templateBytes = 0;

  constructor(private readonly gl: WebGL2RenderingContext) {}

  set(source: GroveInstances | undefined): void {
    if (source === this.source) return;
    this.releaseBlocks(false);
    this.source = source;
  }

  matches(source: GroveInstances): boolean {
    return this.source === source;
  }

  get pending(): boolean {
    return this.blocks.length < (this.source?.blocks.length ?? 0);
  }

  /** Upload a block at a time from a work slice. VAOs share the immutable vertex templates. */
  step(deadline: number): void {
    const src = this.source;
    if (!src || !this.pending) return;
    const gl = this.gl,
      trunk = groveTemplate(true, src.light),
      lobe = groveTemplate(false, src.light);
    gl.bindVertexArray(null);
    const buffer = (data: Float32Array | Uint16Array, target: GLenum = gl.ARRAY_BUFFER): WebGLBuffer => {
      const handle = gl.createBuffer()!;
      gl.bindBuffer(target, handle);
      gl.bufferData(target, data, gl.STATIC_DRAW);
      this.bytes += data.byteLength;
      return handle;
    };
    for (const geometry of [trunk, lobe])
      if (!this.templates.has(geometry)) {
        this.templates.set(geometry, { vertices: buffer(geometry.vertices), indices: buffer(geometry.indices, gl.ELEMENT_ARRAY_BUFFER) });
        this.templateBytes += geometry.vertices.byteLength + geometry.indices.byteLength;
      }
    const trunkMesh = this.templates.get(trunk)!,
      lobeMesh = this.templates.get(lobe)!;
    const batch = (template: { vertices: WebGLBuffer; indices: WebGLBuffer }, geometry: GroveTemplate, transforms: Float32Array): GroveBatch => {
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, template.vertices);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, template.indices);
      for (let i = 0; i < 4; i++) {
        gl.enableVertexAttribArray(i);
        gl.vertexAttribPointer(i, 4, gl.FLOAT, false, GROVE_TEMPLATE_STRIDE * 4, i * 16);
      }
      const instances = buffer(transforms);
      for (let i = 0; i < 3; i++) {
        const location = 5 + i;
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, 4, gl.FLOAT, false, GROVE_STRIDE * 4, i * 16);
        gl.vertexAttribDivisor(location, 1);
      }
      return { buffer: instances, vao, indices: geometry.indices.length, count: transforms.length / GROVE_STRIDE };
    };
    do {
      const block = src.blocks[this.blocks.length];
      this.blocks.push({ block, trunks: batch(trunkMesh, trunk, block.trunks), lobes: block.lobes.length ? batch(lobeMesh, lobe, block.lobes) : undefined });
    } while (this.pending && performance.now() < deadline);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  }

  draw(entry: GroveDrawBlock): number {
    const gl = this.gl;
    gl.bindVertexArray(entry.trunks.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, entry.trunks.indices, gl.UNSIGNED_SHORT, 0, entry.trunks.count);
    let triangles = (entry.trunks.indices * entry.trunks.count) / 3;
    const lobes = entry.lobes;
    if (lobes) {
      gl.bindVertexArray(lobes.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, lobes.indices, gl.UNSIGNED_SHORT, 0, lobes.count);
      triangles += (lobes.indices * lobes.count) / 3;
    }
    return triangles;
  }

  private releaseBlocks(lost: boolean): void {
    if (!lost) {
      const gl = this.gl;
      for (const { trunks, lobes } of this.blocks) {
        gl.deleteVertexArray(trunks.vao);
        gl.deleteBuffer(trunks.buffer);
        if (lobes) {
          gl.deleteVertexArray(lobes.vao);
          gl.deleteBuffer(lobes.buffer);
        }
      }
    }
    this.blocks.length = 0;
    this.bytes = this.templateBytes;
    this.source = undefined;
  }

  drop(lost = false): void {
    this.releaseBlocks(lost);
    if (!lost)
      for (const { vertices, indices } of this.templates.values()) {
        this.gl.deleteBuffer(vertices);
        this.gl.deleteBuffer(indices);
      }
    this.templates.clear();
    this.templateBytes = this.bytes = 0;
  }
}
