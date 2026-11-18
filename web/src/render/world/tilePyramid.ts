/**
 * The table of the tiles of the map drape (mapDrape.ts): which tiles are baked and in which layer of the texture
 * array, which are stale, which the last tilted frame wants, and which layer the next bake takes. No GL: the drape
 * bakes what `next` names into the layer `spare` gives, then says `baked`.
 *
 * The tiling is the ground's (render/live/groundLayer.ts): tier k has 2^k x 2^k tiles over the map. A tile that is
 * not baked is shown by the matching part of its nearest baked ancestor, and the coarse tiers are never evicted, so
 * once tier 0 is baked no square of the map is without a tile. A stale tile (baked for a previous content) keeps
 * showing until it is baked again. A bake may last several work slices: it never goes into the layer a tile is shown
 * from, so one layer of the table is always kept free for it (`capacity` layers hold `capacity - 1` tiles).
 */
import type { DrapeTile } from './contract';

/** Tiles a tilted frame may ask for: one per square it draws at most. */
const MAX_WANTED = 1024;

interface Tile {
  tier: number;
  ix: number;
  iy: number;
  slot: number;
  generation: number;
  /** `stamp` of the last frame that showed it. */
  used: number;
}

/** Numeric key of a tile (tier <= 20, indices < 2^21): no string, no allocation. */
const tileKey = (tier: number, ix: number, iy: number): number => (tier * 2097152 + ix) * 2097152 + iy;

export class TilePyramid {
  /** Bumped whenever `resolve` could answer differently: a tile baked, evicted or made stale. */
  revision = 0;
  /** The tile `next` found. */
  tier = 0;
  ix = 0;
  iy = 0;
  private readonly tiles = new Map<number, Tile>();
  private readonly free: number[] = [];
  private generation = 0;
  /** Frame counter: the tiles the last frame showed (`used === stamp`) are never evicted. */
  private stamp = 0;
  private readonly wantedTier = new Uint8Array(MAX_WANTED);
  private readonly wantedX = new Int32Array(MAX_WANTED);
  private readonly wantedY = new Int32Array(MAX_WANTED);
  private readonly wantedPriority = new Float32Array(MAX_WANTED);
  private wantedCount = 0;
  private capacity = 0;

  /** `coarseTiers`: tiers 0..coarseTiers-1 are baked whatever the view and never evicted. */
  constructor(private readonly coarseTiers: number) {}

  /** Forgets every tile (and a bake under way); the table then has `capacity` layers. */
  reset(capacity: number): void {
    this.capacity = capacity;
    this.tiles.clear();
    this.free.length = 0;
    for (let slot = capacity - 1; slot >= 0; slot--) this.free.push(slot);
    this.wantedCount = 0;
    this.revision++;
  }
  get size(): number {
    return this.tiles.size;
  }
  /** Every tile baked so far shows a previous content. */
  stale(): void {
    this.generation++;
    this.revision++;
  }
  /** The tile is missing or stale. */
  needs(tier: number, ix: number, iy: number): boolean {
    return this.tiles.get(tileKey(tier, ix, iy))?.generation !== this.generation;
  }

  /** A frame is about to name the tiles it shows (DrapeTiles.begin). */
  begin(): void {
    this.stamp++;
    this.wantedCount = 0;
  }
  /** DrapeTiles.resolve, for a table of one page. */
  resolve(tier: number, ix: number, iy: number, priority: number, out: DrapeTile): boolean {
    if (this.wantedCount < MAX_WANTED && this.needs(tier, ix, iy)) {
      const i = this.wantedCount++;
      this.wantedTier[i] = tier;
      this.wantedX[i] = ix;
      this.wantedY[i] = iy;
      this.wantedPriority[i] = priority;
    }
    for (let a = tier; a >= 0; a--) {
      const shift = tier - a,
        ax = ix >> shift,
        ay = iy >> shift,
        tile = this.tiles.get(tileKey(a, ax, ay));
      if (!tile) continue;
      tile.used = this.stamp;
      const span = 1 / 2 ** shift;
      out.page = 0;
      out.layer = tile.slot;
      out.u0 = (ix - (ax << shift)) * span;
      out.v0 = (iy - (ay << shift)) * span;
      out.span = span;
      return true;
    }
    return false;
  }

  /** The next tile to bake, into `tier`, `ix`, `iy`: tier 0 (one tile: no hole after it), what the last frame wanted,
   * lowest priority value first (the nearest square), then the other coarse tiers up to `finest`. False: nothing. */
  next(finest: number): boolean {
    if (this.needs(0, 0, 0)) return this.found(0, 0, 0);
    let nearest = -1;
    for (let i = 0; i < this.wantedCount; i++) if ((nearest < 0 || this.wantedPriority[i] < this.wantedPriority[nearest]) && this.needs(this.wantedTier[i], this.wantedX[i], this.wantedY[i])) nearest = i;
    if (nearest >= 0) return this.found(this.wantedTier[nearest], this.wantedX[nearest], this.wantedY[nearest]);
    for (let tier = 1; tier < this.coarseTiers && tier <= finest; tier++) {
      const n = 2 ** tier;
      for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) if (this.needs(tier, ix, iy)) return this.found(tier, ix, iy);
    }
    return false;
  }
  private found(tier: number, ix: number, iy: number): boolean {
    this.tier = tier;
    this.ix = ix;
    this.iy = iy;
    return true;
  }
  /** Tiles the last frame wanted and coarse tiles still to bake (a count for the stats). */
  pending(finest: number): number {
    let count = 0;
    for (let tier = 0; tier < this.coarseTiers && tier <= finest; tier++) {
      const n = 2 ** tier;
      for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) if (this.needs(tier, ix, iy)) count++;
    }
    for (let i = 0; i < this.wantedCount; i++) if (this.wantedTier[i] >= this.coarseTiers && this.needs(this.wantedTier[i], this.wantedX[i], this.wantedY[i])) count++;
    return count;
  }

  /** A layer to bake the tile into, which no tile is shown from: a free one, or, when the table is full and the tile
   * is a new one, that of the least recently shown tile that is neither coarse nor shown by the last frame, which is
   * evicted. -1: none. The caller then says `baked` or `discard`. */
  spare(tier: number, ix: number, iy: number): number {
    if (this.tiles.has(tileKey(tier, ix, iy)) || this.tiles.size < this.capacity - 1) return this.free.pop() ?? -1;
    let victim: Tile | undefined,
      victimKey = 0;
    for (const [key, tile] of this.tiles) {
      if (tile.tier < this.coarseTiers || tile.used >= this.stamp) continue;
      if (!victim || tile.used < victim.used) {
        victim = tile;
        victimKey = key;
      }
    }
    if (!victim) return -1;
    this.tiles.delete(victimKey);
    this.revision++;
    return victim.slot;
  }
  /** The tile was baked into `slot` (from `spare`) with the current content: it is shown from there, and the layer
   * it was shown from is free. */
  baked(tier: number, ix: number, iy: number, slot: number): void {
    const key = tileKey(tier, ix, iy),
      existing = this.tiles.get(key);
    if (existing) {
      this.free.push(existing.slot);
      existing.slot = slot;
      existing.generation = this.generation;
    } else this.tiles.set(key, { tier, ix, iy, slot, generation: this.generation, used: this.stamp });
    this.revision++;
  }
  /** The bake into `slot` (from `spare`) was given up: the layer is free again. */
  discard(slot: number): void {
    this.free.push(slot);
  }
}
