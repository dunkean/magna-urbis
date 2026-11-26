/**
 * The colours of the tilted view's buildings in one look: a float texture of LOOK_TABLE_WIDTH slots per row, read once
 * per vertex by WORLD_BUILDING_VS. The meshes carry colour slots (buildingsMesh.ts BuildingColorSlots), never a colour,
 * so another style, season or ambience fills another table on the CPU (slotLooks, a few microseconds a slot) and keeps
 * every mesh. A table grows with the slots of the levels built since, uploaded by rows: no upload per frame.
 */
import { slotLooks, type BuildingColorSlots, type BuildingPaint } from './buildingsMesh';

/** Slots per row of the texture (WORLD_BUILDING_VS reads slot & 1023, slot >> 10). */
export const LOOK_TABLE_WIDTH = 1024;
/** Slots filled between two looks at the clock. */
const FILL_CHUNK = 512;

export class BuildingLookTable {
  /** Four floats a slot (slotLooks), whole rows. */
  data = new Float32Array(0);
  /** Slots filled, and those on the GPU. */
  filled = 0;
  private uploaded = 0;
  private rows = 0;
  private readonly reused = new Set<number>();
  private readonly dirtyRows = new Set<number>();
  texture?: WebGLTexture;

  constructor(
    /** The look (buildingsLayer.ts appearance key). */
    readonly key: string,
    /** Its paint, for the slots still to fill: a new look object with the same key paints the same. */
    public paint: BuildingPaint,
  ) {}

  invalidate(index: number): void {
    if (index < this.filled) this.reused.add(index);
  }

  /** Fills the slots added since, until `deadline` (performance.now()); true once every slot has its paint. */
  fill(slots: BuildingColorSlots, deadline: number): boolean {
    const count = slots.length;
    if (this.data.length < count * 4) {
      const rows = Math.max(1, 2 ** Math.ceil(Math.log2(Math.ceil(count / LOOK_TABLE_WIDTH)))),
        grown = new Float32Array(rows * LOOK_TABLE_WIDTH * 4);
      grown.set(this.data.subarray(0, this.filled * 4));
      this.data = grown;
    }
    let repainted = 0;
    for (const index of this.reused) {
      slotLooks(slots, index, index + 1, this.paint, this.data);
      this.reused.delete(index);
      this.dirtyRows.add(Math.floor(index / LOOK_TABLE_WIDTH));
      if (++repainted % FILL_CHUNK === 0 && performance.now() >= deadline) return false;
    }
    while (this.filled < count) {
      const to = Math.min(count, this.filled + FILL_CHUNK);
      slotLooks(slots, this.filled, to, this.paint, this.data);
      this.filled = to;
      if (to < count && performance.now() >= deadline) return false;
    }
    return true;
  }

  /** Uploads the rows filled since: the whole table when it grew. */
  upload(gl: WebGL2RenderingContext): void {
    const rows = this.data.length / 4 / LOOK_TABLE_WIDTH;
    if (!rows || (this.texture && this.rows === rows && this.uploaded === this.filled && !this.dirtyRows.size)) return;
    gl.activeTexture(gl.TEXTURE2);
    if (!this.texture || this.rows !== rows) {
      if (!this.texture) {
        this.texture = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      } else gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, LOOK_TABLE_WIDTH, rows, 0, gl.RGBA, gl.FLOAT, this.data);
      this.rows = rows;
    } else {
      const first = Math.floor(this.uploaded / LOOK_TABLE_WIDTH),
        last = Math.ceil(this.filled / LOOK_TABLE_WIDTH);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      if (this.uploaded < this.filled) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, first, LOOK_TABLE_WIDTH, last - first, gl.RGBA, gl.FLOAT, this.data, first * LOOK_TABLE_WIDTH * 4);
      for (const row of this.dirtyRows) if (this.uploaded === this.filled || row < first || row >= last) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, row, LOOK_TABLE_WIDTH, 1, gl.RGBA, gl.FLOAT, this.data, row * LOOK_TABLE_WIDTH * 4);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    this.uploaded = this.filled;
    this.dirtyRows.clear();
  }

  get bytes(): number {
    return this.rows * LOOK_TABLE_WIDTH * 16;
  }

  /** The context is gone: the next upload makes the texture again. */
  lost(): void {
    this.texture = undefined;
    this.rows = this.uploaded = 0;
  }

  dispose(gl: WebGL2RenderingContext): void {
    if (this.texture) gl.deleteTexture(this.texture);
    this.lost();
  }
}
