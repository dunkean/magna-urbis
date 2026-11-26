/** Current instance ranges, queried by the draped ground at draw time.
 * A cell is unique within its 96 m root block, including along tile edges. */
import { treeIdImage, type TreeIdImage } from '../../../../rust/bridge/treeOwnership';
interface Block {
  ids: Uint32Array;
  count: number;
  frame: number;
}

export class TreeSelection {
  private frame = 0;
  private readonly blocks = new Map<number, Block>();
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
    this.cached = undefined;
  }

  end(): void {
    for (const [key, block] of this.blocks) {
      if (block.frame === this.frame) continue;
      this.blocks.delete(key);
      this.cached = undefined;
    }
  }

  image(): TreeIdImage {
    if (this.cached) return this.cached;
    let total = 0;
    for (const block of this.blocks.values()) total += block.count;
    return (this.cached = treeIdImage(total, insert => {
      for (const [key, block] of this.blocks)
        for (let i = 0; i < block.count; i++) {
          const hash = Math.imul(block.ids[i] ^ Math.imul(key, 0x9e3779b9), 0x85ebca6b);
          insert((hash ^ (hash >>> 16)) >>> 0, key);
        }
    }));
  }
}
