/** Crown IDs submitted by the world tree layer in its actual, budgeted instance ranges.
 * The auxiliary terrain pass reads this table while baking a tile. The block key
 * distinguishes the same 32-bit hash in distant parts of a large world. */
import { treeIdImage, type TreeIdImage, TREE_VOLUME_BLOCK } from '../../../../rust/bridge/treeOwnership';
interface Block {
  ids: Uint32Array;
  count: number;
  frame: number;
}

export class TreeSelection {
  revision = 0;
  private frame = 0;
  private readonly blocks = new Map<number, Block>();
  private readonly changed = Array.from({ length: 17 }, () => new Map<number, number>());
  private cached?: TreeIdImage;

  begin(): void {
    this.frame++;
  }

  select(key: number, ids: Uint32Array, count: number): void {
    if (!count) return;
    const held = this.blocks.get(key);
    if (held && held.ids === ids && held.count === count) {
      held.frame = this.frame;
      return;
    }
    this.blocks.set(key, { ids, count, frame: this.frame });
    this.mark(key);
    this.cached = undefined;
  }

  end(): void {
    for (const [key, block] of this.blocks) {
      if (block.frame === this.frame) continue;
      this.blocks.delete(key);
      this.mark(key);
      this.cached = undefined;
    }
  }

  private mark(key: number): void {
    const version = ++this.revision;
    let x = key % 65536,
      y = Math.floor(key / 65536);
    for (const level of this.changed) {
      level.set(y * 65536 + x, version);
      x >>= 1;
      y >>= 1;
    }
  }

  /** Bounds include the reach of crowns rooted across a tile edge. */
  stamp(x: number, y: number, size: number, margin: number): number {
    let stamp = 0;
    // At most four lookups, even when a coarse tile spans thousands of tree blocks.
    const level = Math.min(16, Math.max(0, Math.ceil(Math.log2((size + 2 * margin) / TREE_VOLUME_BLOCK))));
    const span = TREE_VOLUME_BLOCK * 2 ** level,
      changes = this.changed[level];
    for (let by = Math.max(0, Math.floor((y - margin) / span)); by <= Math.floor((y + size + margin) / span); by++)
      for (let bx = Math.max(0, Math.floor((x - margin) / span)); bx <= Math.floor((x + size + margin) / span); bx++) stamp = Math.max(stamp, changes.get(by * 65536 + bx) ?? 0);
    return stamp;
  }

  image(): TreeIdImage {
    if (this.cached) return this.cached;
    let total = 0;
    for (const block of this.blocks.values()) total += block.count;
    return (this.cached = treeIdImage(total, insert => {
      for (const [key, block] of this.blocks) for (let i = 0; i < block.count; i++) insert(block.ids[i], key);
    }));
  }
}
