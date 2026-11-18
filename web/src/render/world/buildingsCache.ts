/** Building block/level cache owned by buildingsLayer. Builds bounded mesh parts, uploads them over work slices and evicts GPU levels without touching the last draw's resources. */
import { BUILDING_STRIDE, type BuildingPaint, type BuildingSeat } from './buildingsMesh';
import { BLOCK_CELLS, blockPart, type BuildingBlock } from './buildingsBlocks';
/** Buildings meshed between clock checks. */
const BUILD_CHUNK = 8;
/** GPU bytes retained by building levels; levels used by the last draw cannot be evicted. */
const BUDGET_BYTES = 96 * 1024 * 1024;
const CELLS = BLOCK_CELLS * BLOCK_CELLS;
export interface BuildingLevel {
  vao: WebGLVertexArrayObject;
  buffer: WebGLBuffer;
  vertices: number;
  /** First vertex of each cell, and the end. */
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
  parts: Float32Array[];
  vertices: number;
  cell: number;
  cellFirst: Int32Array;
  uploaded: number;
  buffer?: WebGLBuffer;
}
export class BuildingBlockCache {
  slots: BuildingSlot[] = [];
  blocks: BuildingBlock[] = [];
  bytes = 0;
  private spilled = false;
  /** Parts never straddle a cell. A finished mesh is uploaded part by part to bound dense levels' work slices. */
  private pending: BuildingJob | undefined;
  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly budgetBytes: () => number | undefined,
  ) {}
  setBlocks(blocks: BuildingBlock[]): void {
    this.blocks = blocks;
    this.slots = blocks.map(block => ({ block, levels: new Array<BuildingLevel | undefined>(block.levels).fill(undefined), need: 0, depth: Infinity, seen: -1 }));
  }
  clear(): void {
    for (const slot of this.slots) for (let i = 0; i < slot.levels.length; i++) this.dropLevel(slot, i);
    this.slots = [];
    this.blocks = [];
    this.spilled = false;
    if (this.pending?.buffer) this.gl.deleteBuffer(this.pending.buffer);
    this.pending = undefined;
  }
  contextLost(): void {
    for (const slot of this.slots) slot.levels.fill(undefined);
    this.bytes = 0;
    this.pending = undefined;
  }
  private readonly startJob = (slot: BuildingSlot, level: number): BuildingJob => ({ slot, level, next: 0, parts: [], vertices: 0, cell: 0, cellFirst: new Int32Array(CELLS + 1), uploaded: 0 });

  private readonly dropLevel = (slot: BuildingSlot, index: number): void => {
    const gl = this.gl;
    const level = slot.levels[index];
    if (!level) return;
    gl.deleteBuffer(level.buffer);
    gl.deleteVertexArray(level.vao);
    this.bytes -= level.bytes;
    slot.levels[index] = undefined;
  };
  /** Copies the parts of a finished job into its buffer until `deadline`; once all are in, the level is installed.
   * True when the level is installed. */
  private readonly uploadStep = (job: BuildingJob, deadline: number, tick: number): boolean => {
    const gl = this.gl;
    const stride = BUILDING_STRIDE * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, job.buffer ?? null);
    if (!job.buffer) {
      job.buffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, job.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, Math.max(4, job.vertices * stride), gl.STATIC_DRAW);
    }
    let offset = 0;
    for (let i = 0; i < job.uploaded; i++) offset += job.parts[i].byteLength;
    while (job.uploaded < job.parts.length) {
      const part = job.parts[job.uploaded++];
      if (part.length) gl.bufferSubData(gl.ARRAY_BUFFER, offset, part);
      offset += part.byteLength;
      if (performance.now() >= deadline) break;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    if (job.uploaded < job.parts.length) return false;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
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
    job.slot.levels[job.level] = { vao, buffer: job.buffer, vertices: job.vertices, cellFirst: job.cellFirst, bytes: job.vertices * stride, used: tick };
    this.bytes += job.vertices * stride;
    return true;
  };
  /** The exact height range of what a part draws, for the view volume test. */
  private readonly reach = (block: BuildingBlock, part: Float32Array): void => {
    for (let i = 0; i < part.length; i += BUILDING_STRIDE) {
      const z = part[i + 9] + part[i + 1];
      if (z < block.low) block.low = z;
      if (z > block.high) block.high = z;
    }
  };

  /** Over budget: the levels drawn least recently go, never one of the last frame. */
  private readonly evict = (tick: number): void => {
    const budget = this.budgetBytes() ?? BUDGET_BYTES;
    while (this.bytes > budget) {
      let oldest: BuildingSlot | undefined,
        oldestIndex = -1,
        used = tick;
      for (const slot of this.slots)
        for (let i = 0; i < slot.levels.length; i++) {
          const level = slot.levels[i];
          if (level && level.used < used) {
            used = level.used;
            oldest = slot;
            oldestIndex = i;
          }
        }
      if (!oldest) return;
      this.dropLevel(oldest, oldestIndex);
      this.spilled = true;
    }
  };

  work(deadline: number, tick: number, paint: BuildingPaint, seat: BuildingSeat, onBuilt: () => void): boolean {
    let built = false;
    for (;;) {
      if (!this.pending) {
        // The level the last frame wanted for the nearest block that lacks it; else the overview of a block that
        // has nothing yet (built in the background, before the first tilt and while the view rests).
        let next: BuildingSlot | undefined,
          level = 0;
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
        if (next) this.pending = this.startJob(next, level);
        else if (!this.spilled) {
          // Not once the budget has spilled: an overview built then evicts another, which is bare again, without end.
          const bare = this.slots.find(slot => !slot.levels.some(Boolean));
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
        this.reach(job.slot.block, part);
        job.parts.push(part);
        job.vertices += part.length / BUILDING_STRIDE;
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
