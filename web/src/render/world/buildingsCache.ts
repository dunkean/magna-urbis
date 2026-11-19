/** Building block/level cache owned by buildingsLayer. Builds bounded mesh parts, uploads them over work slices and evicts GPU levels without touching the last draw's resources. */
import { BUILDING_STRIDE, type BuildingPaint, type BuildingSeat } from './buildingsMesh';
import { BLOCK_CELLS, blockPart, type BuildingBlock } from './buildingsBlocks';
import { expandBuildingPart, indexBuildingPart, type BuildingPart } from './buildingsIndex';
import { countWork } from '../workCount';
/** Buildings meshed between clock checks. */
const BUILD_CHUNK = 8;
/** GPU bytes retained by building levels; levels used by the last draw cannot be evicted. */
const BUDGET_BYTES = 96 * 1024 * 1024;
const CELLS = BLOCK_CELLS * BLOCK_CELLS;
export interface BuildingLevel {
  vao: WebGLVertexArrayObject;
  buffer: WebGLBuffer;
  indexBuffer?: WebGLBuffer;
  indexBytes: 0 | 2 | 4;
  /** Vertex references in the original triangle order, including repetitions. */
  vertices: number;
  /** First vertex reference of each cell, and the end. */
  cellFirst: Int32Array;
  bytes: number;
  /** Draw tick it was last shown in. */
  used: number;
}
export interface BuildingSlot {
  block: BuildingBlock;
  levels: (BuildingLevel | undefined)[];
  /** The levels the last frame that saw the block wanted (bit per level). */
  need: number;
  /** Depth along the view axis at that draw, and its tick. */
  depth: number;
  seen: number;
}

interface BuildingJob {
  slot: BuildingSlot;
  level: number;
  next: number;
  parts: (BuildingPart | undefined)[];
  vertices: number;
  unique: number;
  cell: number;
  cellFirst: Int32Array;
  uploaded: number;
  vertexOffset: number;
  indexOffset: number;
  indexBytes: 0 | 2 | 4;
  buffer?: WebGLBuffer;
  indexBuffer?: WebGLBuffer;
}
export class BuildingBlockCache {
  slots: BuildingSlot[] = [];
  blocks: BuildingBlock[] = [];
  bytes = 0;
  private spilled = false;
  private overviewCursor = 0;
  /** Parts never straddle a cell. A finished mesh is uploaded part by part to bound dense levels' work slices. */
  private pending: BuildingJob | undefined;
  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly budgetBytes: () => number | undefined,
    private readonly depth: () => number = () => 1,
  ) {}
  setBlocks(blocks: BuildingBlock[]): void {
    this.overviewCursor = 0;
    this.blocks = blocks;
    this.slots = blocks.map(block => ({ block, levels: new Array<BuildingLevel | undefined>(block.levels).fill(undefined), need: 0, depth: Infinity, seen: -1 }));
  }
  clear(): void {
    for (const slot of this.slots) for (let i = 0; i < slot.levels.length; i++) this.dropLevel(slot, i);
    this.slots = [];
    this.blocks = [];
    this.spilled = false;
    this.overviewCursor = 0;
    if (this.pending?.buffer) this.gl.deleteBuffer(this.pending.buffer);
    if (this.pending?.indexBuffer) this.gl.deleteBuffer(this.pending.indexBuffer);
    this.pending = undefined;
  }
  contextLost(): void {
    for (const slot of this.slots) slot.levels.fill(undefined);
    this.bytes = 0;
    this.overviewCursor = 0;
    this.pending = undefined;
  }
  private readonly startJob = (slot: BuildingSlot, level: number): BuildingJob => ({ slot, level, next: 0, parts: [], vertices: 0, unique: 0, cell: 0, cellFirst: new Int32Array(CELLS + 1), uploaded: 0, vertexOffset: 0, indexOffset: 0, indexBytes: 0 });

  private readonly dropLevel = (slot: BuildingSlot, index: number): void => {
    const gl = this.gl;
    const level = slot.levels[index];
    if (!level) return;
    gl.deleteBuffer(level.buffer);
    if (level.indexBuffer) gl.deleteBuffer(level.indexBuffer);
    gl.deleteVertexArray(level.vao);
    this.bytes -= level.bytes;
    slot.levels[index] = undefined;
  };
  /** Copies the parts of a finished job into its buffer until `deadline`; once all are in, the level is installed.
   * True when the level is installed. */
  private readonly uploadStep = (job: BuildingJob, deadline: number, tick: number): boolean => {
    const gl = this.gl;
    const stride = BUILDING_STRIDE * 4;
    gl.bindVertexArray(null);
    if (!job.buffer) {
      // WebGL2 reserves the all-ones index for primitive restart.
      const width = job.unique <= 65535 ? 2 : 4;
      if (job.unique * stride + job.vertices * width < job.vertices * stride) {
        job.indexBytes = width;
        job.indexBuffer = gl.createBuffer()!;
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, job.indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, job.vertices * width, gl.STATIC_DRAW);
      }
      job.buffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, job.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, Math.max(4, (job.indexBytes ? job.unique : job.vertices) * stride), gl.STATIC_DRAW);
    } else {
      gl.bindBuffer(gl.ARRAY_BUFFER, job.buffer);
      if (job.indexBuffer) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, job.indexBuffer);
    }
    while (job.uploaded < job.parts.length) {
      const part = job.parts[job.uploaded]!;
      job.parts[job.uploaded++] = undefined;
      if (part.indices.length) {
        if (job.indexBytes) {
          // Dense levels can cross the 16-bit boundary in a later slice.
          let indices = part.indices;
          if (indices.BYTES_PER_ELEMENT !== job.indexBytes) indices = job.indexBytes === 2 ? new Uint16Array(indices) : new Uint32Array(indices);
          gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, job.indexOffset, indices);
          gl.bufferSubData(gl.ARRAY_BUFFER, job.vertexOffset, part.data, 0, part.unique * BUILDING_STRIDE);
          job.indexOffset += indices.byteLength;
          job.vertexOffset += part.unique * stride;
        } else {
          gl.bufferSubData(gl.ARRAY_BUFFER, job.vertexOffset, expandBuildingPart(part));
          job.vertexOffset += part.data.byteLength;
        }
      }
      if (performance.now() >= deadline) break;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    if (job.indexBuffer) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    if (job.uploaded < job.parts.length) return false;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    if (job.indexBuffer) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, job.indexBuffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, job.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 36);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    const bytes = job.vertexOffset + job.indexOffset;
    job.slot.levels[job.level] = { vao, buffer: job.buffer, indexBuffer: job.indexBuffer, indexBytes: job.indexBytes, vertices: job.vertices, cellFirst: job.cellFirst, bytes, used: tick };
    this.bytes += bytes;
    return true;
  };

  /** Over budget: the levels drawn least recently go, never one of the last frame. */
  private readonly evict = (tick: number): void => {
    // Extended depth retains more detail between views; an explicit memory limit still takes precedence.
    const budget = this.budgetBytes() ?? BUDGET_BYTES * Math.min(4, this.depth());
    if (this.bytes <= budget) return;
    // Most overflows need at most one eviction, or every candidate is still in use. Keep those cases allocation-free.
    let oldest: BuildingSlot | undefined,
      oldestIndex = -1,
      oldestTick = tick;
    for (const slot of this.slots) {
      for (let index = 0; index < slot.levels.length; index++) {
        const level = slot.levels[index];
        if (level && level.used < oldestTick) {
          oldest = slot;
          oldestIndex = index;
          oldestTick = level.used;
        }
      }
    }
    if (!oldest) return;
    this.dropLevel(oldest, oldestIndex);
    this.spilled = true;
    if (this.bytes <= budget) return;
    const candidates: { slot: BuildingSlot; index: number; used: number }[] = [];
    for (const slot of this.slots) {
      for (let index = 0; index < slot.levels.length; index++) {
        const level = slot.levels[index];
        if (level && level.used < tick) candidates.push({ slot, index, used: level.used });
      }
    }
    // Stable sort preserves slot and level order for ties.
    candidates.sort((a, b) => a.used - b.used);
    for (const { slot, index } of candidates) {
      if (this.bytes <= budget) break;
      this.dropLevel(slot, index);
    }
  };

  work(deadline: number, tick: number, paint: BuildingPaint, seat: BuildingSeat, onBuilt: () => void): boolean {
    let built = false;
    // Visibility and demand are fixed for this work slice. Once all requested levels are ready, the remaining jobs
    // are background overviews in slot order.
    let requestsComplete = false;
    for (;;) {
      if (!this.pending) {
        // The level the last frame wanted for the nearest block that lacks it; else the overview of a block that
        // has nothing yet (built in the background, before the first tilt and while the view rests).
        let next: BuildingSlot | undefined,
          level = 0;
        if (!requestsComplete) {
          for (const slot of this.slots) {
            if (slot.seen !== tick || (next && slot.depth >= next.depth)) continue;
            // The finest level it lacks among those the frame wanted.
            for (let l = 0; l < slot.block.levels; l++)
              if (slot.need & (1 << l) && !slot.levels[l]) {
                next = slot;
                level = l;
                break;
              }
          }
          requestsComplete = !next;
        }
        if (next) {
          this.pending = this.startJob(next, level);
          countWork('volumes.blockLevel');
        } else if (!this.spilled) {
          // Not once the budget has spilled: an overview built then evicts another, which is bare again, without end.
          while (this.overviewCursor < this.slots.length && this.slots[this.overviewCursor].levels.some(Boolean)) this.overviewCursor++;
          const bare = this.slots[this.overviewCursor];
          if (bare) this.pending = this.startJob(bare, bare.block.levels - 1);
        }
        if (!this.pending) break;
      }
      const job = this.pending!,
        cells = job.slot.block.cells,
        count = job.slot.block.buildings.length;
      while (job.next < count) {
        while (job.cell < CELLS && job.next >= cells[job.cell + 1]) job.cellFirst[++job.cell] = job.vertices;
        const to = Math.min(count, job.next + BUILD_CHUNK, job.cell < CELLS ? cells[job.cell + 1] : count),
          part = blockPart(job.slot.block, job.level, paint, seat!, job.next, to);
        const indexed = indexBuildingPart(part, job.unique);
        if (indexed.low < job.slot.block.low) job.slot.block.low = indexed.low;
        if (indexed.high > job.slot.block.high) job.slot.block.high = indexed.high;
        job.parts.push(indexed);
        job.unique += indexed.unique;
        job.vertices += indexed.indices.length;
        job.next = to;
        if (performance.now() >= deadline) break;
      }
      if (job.next >= count) {
        while (job.cell < CELLS) job.cellFirst[++job.cell] = job.vertices;
      }
      if (job.next >= count && performance.now() < deadline && this.uploadStep(job, deadline, tick)) {
        this.pending = undefined;
        // A frame is due only for a block the last frame saw; an overview built ahead shows nothing new.
        built ||= job.slot.seen === tick;
      }
      if (performance.now() >= deadline) {
        if (built) onBuilt();
        return true;
      }
    }
    if (built) onBuilt();
    this.evict(tick);
    return false;
  }
}
