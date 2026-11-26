/**
 * Tilted-map adaptation called through LiveLayer.drape by mapDrape.ts. Reuses complete retained overlay bands for
 * nearby tiles, otherwise records the tile in adaptive horizontal bands. Owns tile progress and content revision;
 * the top-view recorder supplies only the view it is still preparing. Drape painting runs while the view rests.
 */
import type { Rect4 } from '../view';
import type { LiveFrame } from './contract';
import type { DrapeCanvas, DrapeSource } from '../world/contract';
import type { BakedPrefix, DisplayList, LivePart, LiveRasterizer } from '../gpu/contract';
import { boundedList, clipList, cullList } from '../gpu/listTools';
import type { OverlayRegions } from './overlayRegions';
import { boxOf, covers, meets, type OverlayBand, type OverlayHost, type Region } from './overlayTypes';
import { RegionalRevision } from '../../ui/terrain/revision';

/** Scale of a drape tile over the scale of the region shown, between which the region's lists paint the tile. The
 * tiles of the view's own tier are within 0.75 to 1.5 of the view's scale, and the region within a quarter octave. */
const REUSE_MIN = 0.6,
  REUSE_MAX = 1.7;
/** Active time per complete band, time per slice, and first/minimum whole-row heights. */
const DRAPE_BAND_MS = 12,
  DRAPE_SLICE_MS = 3,
  DRAPE_FIRST_ROWS = 48,
  DRAPE_MIN_ROWS = 8;

export function createOverlayDrape(raster: LiveRasterizer, host: OverlayHost, retained: OverlayRegions, isFailed: () => boolean) {
  /** The map drape's tiles hold the overlay of this revision: bumped by `invalidate`, and when what the host records
   * changes besides its scale (its key). */
  const drapeRevision = new RegionalRevision();
  let drapeKey: string | undefined,
    seenContent = host.contentRevision?.();
  /** The drape tile recorded in bands: the recorded row its next band starts at, and what the last band cost per row. */
  let drapeRow = 0,
    drapeMsPerRow = 0;
  let job: { top: number; rows: number; recorded: number; ms: number; record?: Generator<void, OverlayBand | undefined>; made?: OverlayBand; list?: DisplayList; prepare?: Generator<void>; bake?: Generator<void, BakedPrefix | null> } | undefined;
  const cancel = (): void => {
    job?.record?.return(undefined);
    job?.prepare?.return(undefined);
    job?.bake?.return(null);
    job = undefined;
  };
  /** The region the last `work` wanted for its frame, while it is not shown yet: the square of the frame's top view,
   * the scale and the pixel ratio it is made for. */
  const due = { wanted: false, minX: 0, minY: 0, maxX: 0, maxY: 0, scale: 1, dpr: 1 };
  const reusable = (ratio: number): boolean => ratio >= REUSE_MIN && ratio <= REUSE_MAX;
  /** The region shown, when its lists are the overlay of the tile: current, complete, holding the tile's square, and
   * recorded at about the tile's scale. */
  const regionFor = (tile: DrapeCanvas): Region | undefined => {
    const r = retained.shown;
    if (!r || r.stale || r.draft || !retained.current(r) || r.key !== host.key(r.scale, r.dpr, r.light)) return undefined;
    if (host.fixedRaster?.()) return r.parts.every(b => !!b.snapshot) ? r : undefined;
    return r.dpr === tile.dpr && r.light === tile.light && covers(r.rect, tile.rect) && reusable(tile.scale / r.scale) ? r : undefined;
  };
  /** A fixed sheet is already a complete premultiplied picture. Sample its world-space bands directly; drape tiles
   * may cross the sheet boundary, but the UV limits restrict every texture to its own band (excluding bake gutters). */
  const putFixed = (tile: DrapeCanvas, r: Region): void => {
    const scale = r.scale * r.dpr;
    for (const b of r.parts) {
      if (!meets(b.rect, tile.rect)) continue;
      const image = b.snapshot!,
        width = image.box[2] - image.box[0],
        height = image.box[3] - image.box[1],
        x = (world: number): number => ((world - b.cx) * scale + b.w / 2 - image.box[0]) / width,
        y = (world: number): number => 1 - ((world - b.cy) * scale + b.h / 2 - image.box[1]) / height;
      tile.put(image.texture, x(tile.rect.minX), y(tile.rect.minY), x(tile.rect.maxX), y(tile.rect.maxY), 1, x(b.rect.minX), y(b.rect.maxY), x(b.rect.maxX), y(b.rect.minY));
    }
    if (r.provisional) tile.provisional();
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
      const key = isFailed() || raster.lost || !host.active() ? undefined : host.key(1, 1, false),
        content = host.contentRevision?.();
      if (key !== drapeKey) {
        drapeKey = key;
        drapeRevision.bump();
      } else if (key !== undefined && content !== seenContent) {
        drapeRevision.bump(seenContent === undefined ? undefined : host.contentChanges?.(seenContent));
      }
      seenContent = content;
      return drapeRevision.value();
    },
    contentChanges: since => drapeRevision.changesSince(since),
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
      if (host.fixedRaster?.()) return !!regionFor(tile);
      // The region of the view is wanted or under way and will hold this tile: the tile waits for its lists rather
      // than being recorded as well.
      return !(due.wanted && due.dpr === tile.dpr && covers(due, tile.rect) && reusable(tile.scale / due.scale)) || !!regionFor(tile);
    },
    /** An error here is the drape's to report: it costs this tile its overlay, not the top view its live layer. */
    paint(tile: DrapeCanvas): boolean {
      if (isFailed() || raster.lost || !host.active()) return false;
      if (host.fixedRaster?.()) {
        cancel();
        const r = regionFor(tile);
        if (!r) return true;
        putFixed(tile, r);
        return false;
      }
      if (tile.step === 0) {
        cancel();
        drapeRow = 0;
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
      // Horizontal bands of whole recorded rows, from the north. Recording, clipping, uploading and painting each
      // span slices; measured active time per row sizes the next band, independently of time spent yielding.
      const started = performance.now();
      if (!job) {
        const top = drapeRow,
          left = recorded - top,
          want = Math.max(DRAPE_MIN_ROWS, Math.min(64, drapeMsPerRow > 0 ? Math.floor(DRAPE_BAND_MS / drapeMsPerRow) : DRAPE_FIRST_ROWS)),
          // A remainder too thin for a recording of its own goes with this band.
          rows = left - want < DRAPE_MIN_ROWS ? left : want,
          metres = side / recorded,
          band: Rect4 = { minX: tile.rect.minX, maxX: tile.rect.maxX, minY: tile.rect.minY + top * metres, maxY: tile.rect.minY + (top + rows) * metres };
        const plan = { key, rect: { ...tile.rect }, scale, dpr: tile.dpr, bands: [band] };
        job = {
          top,
          rows,
          recorded,
          ms: 0,
          record: host.recordSteps
            ? host.recordSteps(plan, band, tile.light, true)
            : (function* () {
                return host.record(plan, band, tile.light);
              })(),
        };
      }
      const j = job;
      try {
        if (j.record) {
          let next;
          do {
            next = j.record.next();
          } while (!next.done && performance.now() - started < DRAPE_SLICE_MS);
          if (!next.done) return true;
          j.record = undefined;
          if (!next.value) {
            cancel();
            return false;
          }
          j.made = next.value;
          if (j.made.provisional) tile.provisional();
          return true;
        }
        const made = j.made!;
        if (!j.list) {
          j.list = boundedList(clipList(cullList(made.list, boxOf(made)), boxOf(made)));
          j.prepare = raster.prepareSteps(j.list);
          return true;
        }
        if (j.prepare) {
          let next;
          do {
            next = j.prepare.next();
          } while (!next.done && performance.now() - started < DRAPE_SLICE_MS);
          if (!next.done) return true;
          j.prepare = undefined;
          j.bake = raster.bakeSteps(j.list, tile.pixels / made.w, { samples: 4 });
          return true;
        }
        let next;
        do {
          next = j.bake!.next();
        } while (!next.done && performance.now() - started < DRAPE_SLICE_MS);
        if (!next.done) return true;
        j.bake = undefined;
        const baked = next.value,
          top = j.top;
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
        drapeRow = top + j.rows;
        job = undefined;
        return drapeRow < j.recorded;
      } finally {
        j.ms += performance.now() - started;
        if (!job) drapeMsPerRow = j.ms / j.rows;
      }
    },
  };
  return {
    source: drape,
    invalidate(): void {
      cancel();
      drapeRevision.bump();
    },
    cancel,
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
