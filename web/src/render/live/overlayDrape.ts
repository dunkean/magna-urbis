/**
 * Tilted-map adaptation called through LiveLayer.drape by mapDrape.ts. Reuses complete retained overlay bands for
 * nearby tiles, otherwise records the tile in adaptive horizontal bands. Owns tile progress and content revision;
 * the top-view recorder supplies only the view it is still preparing. Drape painting runs while the view rests.
 */
import type { Rect4 } from '../view';
import type { LiveFrame } from './contract';
import type { DrapeCanvas, DrapeSource } from '../world/contract';
import type { LivePart, LiveRasterizer } from '../gpu/contract';
import { cullList } from '../gpu/listTools';
import type { OverlayRegions } from './overlayRegions';
import { boxOf, covers, type OverlayHost, type Region } from './overlayTypes';

/** Scale of a drape tile over the scale of the region shown, between which the region's lists paint the tile. The
 * tiles of the view's own tier are within 0.75 to 1.5 of the view's scale, and the region within a quarter octave. */
const REUSE_MIN = 0.6,
  REUSE_MAX = 1.7;
/** Main-thread target per drape band, and its first/minimum whole-row heights. */
const DRAPE_BAND_MS = 6,
  DRAPE_FIRST_ROWS = 48,
  DRAPE_MIN_ROWS = 8;

export function createOverlayDrape(raster: LiveRasterizer, host: OverlayHost, retained: OverlayRegions, isFailed: () => boolean) {
  /** The map drape's tiles hold the overlay of this revision: bumped by `invalidate`, and when what the host records
   * changes besides its scale (its key). */
  let drapeRevision = 0,
    drapeKey: string | undefined;
  /** The drape tile recorded in bands: the recorded row its next band starts at, and what the last band cost per row. */
  let drapeRow = 0,
    drapeMsPerRow = 0;
  /** The region the last `work` wanted for its frame, while it is not shown yet: the square of the frame's top view,
   * the scale and the pixel ratio it is made for. */
  const due = { wanted: false, minX: 0, minY: 0, maxX: 0, maxY: 0, scale: 1, dpr: 1 };
  const reusable = (ratio: number): boolean => ratio >= REUSE_MIN && ratio <= REUSE_MAX;
  /** The region shown, when its lists are the overlay of the tile: current, complete, holding the tile's square, and
   * recorded at about the tile's scale. */
  const regionFor = (tile: DrapeCanvas): Region | undefined => {
    const r = retained.shown;
    return r && !r.stale && !r.draft && retained.current(r) && r.dpr === tile.dpr && r.light === tile.light && covers(r.rect, tile.rect) && reusable(tile.scale / r.scale) && r.key === host.key(r.scale, r.dpr, r.light) ? r : undefined;
  };
  /** Replays the lists of `r` into the tile, as `draw` replays them into a frame; false when the tile has no group. */
  const replayInto = (tile: DrapeCanvas, r: Region): boolean => {
    const target = tile.group();
    if (!target) return false;
    // Map metres -> pixels of the tile, and recorded pixels of the region -> pixels of the tile.
    const s = tile.pixels / (tile.rect.maxX - tile.rect.minX),
      tx = -tile.rect.minX * s,
      ty = -tile.rect.minY * s,
      k = s / (r.scale * r.dpr);
    for (const b of r.parts) {
      const part = b.part,
        post = part.post,
        scissor = part.scissor;
      post[0] = post[3] = k;
      post[4] = b.cx * s + tx - (k * b.w) / 2;
      post[5] = b.cy * s + ty - (k * b.h) / 2;
      scissor[0] = b.rect.minX * s + tx;
      scissor[1] = b.rect.minY * s + ty;
      scissor[2] = b.rect.maxX * s + tx;
      scissor[3] = b.rect.maxY * s + ty;
      part.baked = b.baked;
      part.list = b.suffix;
    }
    raster.replayLive(r.live as readonly LivePart[], target, tile.pixels, tile.pixels);
    tile.putGroup(1);
    return true;
  };
  const drape: DrapeSource = {
    revision(): number {
      // Content only: a product made per scale (contour paths) repaints the tiles painted without it (`arrivals`).
      const key = isFailed() || raster.lost || !host.active() ? undefined : host.key(1, 1, false);
      if (key !== drapeKey) {
        drapeKey = key;
        drapeRevision++;
      }
      return drapeRevision;
    },
    arrivals: () => host.arrivals(),
    // Nothing to paint (the vector engine is off, the layer failed) is ready; else the programs must be linked.
    ready(tile: DrapeCanvas): boolean {
      if (isFailed() || raster.lost || !host.active()) return true;
      try {
        if (!raster.warm()) return false;
      } catch {
        // A program that cannot be linked is the layer's to report (its `work` meets the same error): the drape goes on.
        return true;
      }
      // The region of the view is wanted or under way and will hold this tile: the tile waits for its lists rather
      // than being recorded as well.
      return !(due.wanted && due.dpr === tile.dpr && covers(due, tile.rect) && reusable(tile.scale / due.scale)) || !!regionFor(tile);
    },
    /** An error here is the drape's to report: it costs this tile its overlay, not the top view its live layer. */
    paint(tile: DrapeCanvas): boolean {
      if (isFailed() || raster.lost || !host.active()) return false;
      if (tile.step === 0) {
        const r = regionFor(tile);
        if (r && replayInto(tile, r)) {
          if (r.provisional) tile.provisional();
          return false;
        }
      }
      const side = tile.rect.maxX - tile.rect.minX,
        // Recorded pixels of the tile's side: a whole number, so the edges of the tile are texel edges of the bake.
        // The recorder rounds its size up: a scale a hair under keeps that number.
        recorded = Math.max(1, Math.round(side * tile.scale * tile.dpr)),
        scale = (recorded - 1e-6) / (side * tile.dpr),
        key = host.key(scale, tile.dpr, tile.light);
      if (key === undefined) return false;
      // Horizontal bands of whole recorded rows, one per call, from the north. A band's height is what the last one
      // cost per row allows within DRAPE_BAND_MS: the cost follows the content under the band, which the recorder
      // cannot tell beforehand (a town's farm roofs cost tens of milliseconds over a tile of open country).
      const started = performance.now();
      if (tile.step === 0) drapeRow = 0;
      const top = drapeRow,
        left = recorded - top,
        want = Math.max(DRAPE_MIN_ROWS, drapeMsPerRow > 0 ? Math.floor(DRAPE_BAND_MS / drapeMsPerRow) : DRAPE_FIRST_ROWS),
        // A remainder too thin for a recording of its own goes with this band.
        rows = left - want < DRAPE_MIN_ROWS ? left : want,
        metres = side / recorded,
        band: Rect4 = { minX: tile.rect.minX, maxX: tile.rect.maxX, minY: tile.rect.minY + top * metres, maxY: tile.rect.minY + (top + rows) * metres },
        made = host.record({ key, rect: tile.rect, scale, dpr: tile.dpr, bands: [band] }, band, tile.light);
      if (!made) return false;
      if (made.provisional) tile.provisional();
      const list = cullList(made.list, boxOf(made));
      raster.prepare(list);
      const baked = raster.bake(list, tile.pixels / made.w, { samples: 4 });
      if (baked) {
        // The bake holds the recorded band and a gutter, drawn with y up: its north is at the top of the texture.
        // The tile's north edge is `top` rows above the band's, its south edge the rows after it below; only the band
        // itself is laid, not its gutter, which the next band paints.
        const w = baked.box[2] - baked.box[0],
          h = baked.box[3] - baked.box[1],
          u0 = -baked.box[0] / w,
          u1 = (made.w - baked.box[0]) / w,
          v0 = 1 - (made.h - baked.box[1]) / h,
          v1 = 1 + baked.box[1] / h;
        tile.put(baked.texture, u0, 1 - (-top - baked.box[1]) / h, u1, 1 - (recorded - top - baked.box[1]) / h, 1, u0, v0, u1, v1);
        raster.releaseBaked(baked);
      }
      drapeMsPerRow = (performance.now() - started) / rows;
      drapeRow = top + rows;
      return drapeRow < recorded;
    },
  };
  return {
    source: drape,
    invalidate(): void {
      drapeRevision++;
    },
    wanted(frame: LiveFrame, wanted: boolean): void {
      due.wanted = wanted;
      due.minX = frame.rect.minX;
      due.minY = frame.rect.minY;
      due.maxX = frame.rect.maxX;
      due.maxY = frame.rect.maxY;
      due.scale = 2 ** (Math.round(2 * Math.log2(frame.view.scale)) / 2);
      due.dpr = frame.dpr;
    },
  };
}
