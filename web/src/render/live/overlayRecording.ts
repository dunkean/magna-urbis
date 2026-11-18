/**
 * Overlay recording scheduler, called from overlayLayer.work. Owns motion/settle timing, pending bands, uploads,
 * prefix bakes and whole-band snapshots. A complete region is handed to overlayRegions only after every prefix is
 * baked and every replay program is warm: draw never has to replay area ops or compile a program.
 * Area tints and washes become one texture per band; crisp lines and symbols replay above it in the same isolated
 * group, preserving order and blending. Drawable coverage, rest coverage and background warming remain distinct.
 */
import type { LiveFrame } from './contract';
import { CRISP_MARK, type DisplayList, type LiveRasterizer } from '../gpu/contract';
import { clipList, cullList, markIndex, splitList } from '../gpu/listTools';
import type { OverlayDiagnostics } from './overlayDiagnostics';
import type { OverlayRegions } from './overlayRegions';
import { beyond, boxOf, covers, type Band, type OverlayBand, type OverlayHost, type Region } from './overlayTypes';

/** Pixels of one baked band (four per region). */
const BAKE_PIXELS = 4e6,
  BAKE_PIXELS_LIGHT = 1.5e6;
/** Bake attempts of a prefix, the density halved after each failure; then the layer gives way to its stand-in. */
const BAKE_TRIES = 3;
/** Pixels and samples of what is baked while the view moves (a draft region's prefixes, every snapshot). */
const MOVING_PIXELS = 1e6,
  MOVING_SAMPLES = 2;
/** View/recorded-scale ratio for making snapshots ahead of their use (a resting view stays within 2^(1/4)). */
const SNAPSHOT_AHEAD = 1.25;
/** A region under way survives the scale steps of a zoom while it stays this close (octaves) to the view's scale. */
const KEEP_OCTAVES = 1.25;

enum BandStage {
  ClipSuffix = 0,
  PreparePrefix = 1,
  PrepareSuffix = 2,
  BakePrefix = 3,
  Complete = 4,
}

export function createOverlayRecording(raster: LiveRasterizer, host: OverlayHost, retained: OverlayRegions, diagnostics?: OverlayDiagnostics) {
  let pending: Region | undefined;
  /** A key the recorder could not represent: not tried again until the key changes. */
  let failedKey: string | undefined;
  let lastCx = NaN,
    lastCy = NaN,
    lastScale = NaN,
    movedAt = -Infinity,
    needSince = -1;
  let moving = false;
  const dropPending = (): void => {
    if (pending) {
      retained.release(pending);
      pending = undefined;
      raster.releaseBakeScratch();
    }
  };
  /** Density of a bake of `w` x `h` recorded pixels (texels per pixel): 1 unless the texture limit or `pixels` says less. */
  const densityFor = (w: number, h: number, pixels: number): number => {
    const side = raster.maxBakeSize - 8;
    return Math.min(1, side / w, side / h, Math.sqrt(pixels / (w * h)));
  };
  const bandOf = (made: OverlayBand, light: boolean): Band => {
    const box = boxOf(made),
      at = markIndex(made.list, CRISP_MARK);
    let prefix: DisplayList | undefined, suffix: DisplayList;
    if (at > 0) {
      const [area, crisp] = splitList(made.list, at);
      prefix = cullList(area, box);
      suffix = cullList(crisp, box);
      // A band outside the map: the map clip misses it, nothing is left to bake.
      if (!prefix.ops.length) prefix = undefined;
    } else suffix = cullList(made.list, box);
    return { rect: made.rect, cx: made.cx, cy: made.cy, w: made.w, h: made.h, prefix, suffix, stage: BandStage.ClipSuffix, density: densityFor(made.w, made.h, light ? BAKE_PIXELS_LIGHT : BAKE_PIXELS), part: { list: suffix, post: [1, 0, 0, 1, 0, 0], scissor: [0, 0, 0, 0] } };
  };

  /** Program compilation stops this work slice without advancing any remaining recording stages. */
  let blocked = false;
  /** A complete region replaces the one shown, once every program a frame can use exists: `draw` creates nothing. */
  const complete = (p: Region): boolean => {
    if (!raster.warm()) {
      blocked = true;
      return false;
    }
    pending = undefined;
    raster.releaseBakeScratch();
    needSince = -1;
    retained.show(p);
    return true;
  };
  /** One step of the region being made. True when it ended (complete and shown, or dropped). */
  const advance = (p: Region): boolean => {
    if (p.parts.length >= p.bands.length) return complete(p);
    const b = p.building;
    if (!b) {
      const t = host.now(),
        made = host.record(p, p.bands[p.parts.length], p.light);
      diagnostics?.recorded(host.now() - t);
      if (!made) {
        failedKey = p.key;
        dropPending();
        return true;
      }
      p.building = bandOf(made, p.light);
      if (made.provisional) p.provisional = true;
      return false;
    }
    if (b.stage === BandStage.ClipSuffix) {
      // The sea, the land clip, a lake: fanned for what this band can show, not for the whole map at every frame.
      b.suffix = clipList(b.suffix, boxOf(b));
      b.part.list = b.suffix;
      b.stage = b.prefix ? BandStage.PreparePrefix : BandStage.PrepareSuffix;
    } else if (b.stage === BandStage.PreparePrefix) {
      if (b.prefix) raster.prepare(b.prefix);
      b.stage = BandStage.PrepareSuffix;
    } else if (b.stage === BandStage.PrepareSuffix) {
      raster.prepare(b.suffix);
      b.stage = b.prefix ? BandStage.BakePrefix : BandStage.Complete;
    } else if (b.stage === BandStage.BakePrefix && b.prefix) {
      // A bake draws: not before the programs are ready (they compile while the bands are recorded and uploaded).
      if (!raster.warm()) {
        blocked = true;
        return false;
      }
      // A bake while the view moves is bounded (pixels, samples); the region is then a draft.
      if (moving) p.draft = true;
      const t = host.now(),
        samples = moving ? MOVING_SAMPLES : 4;
      let density = moving ? Math.min(b.density, densityFor(b.w, b.h, MOVING_PIXELS)) : b.density;
      let baked = raster.bake(b.prefix, density, { samples });
      for (let i = 1; !baked && i < BAKE_TRIES; i++) {
        density /= 2;
        baked = raster.bake(b.prefix, density, { samples });
      }
      diagnostics?.baked(host.now() - t);
      // No region is ever shown with a prefix left to replay live: without its bake the layer gives way (stand-in).
      if (!baked) throw new Error('the area prefix of a band could not be baked');
      b.baked = baked;
      b.part.baked = baked;
      b.density = density;
      b.prefix = undefined;
      b.stage = BandStage.Complete;
    } else if (b.stage === BandStage.BakePrefix) b.stage = BandStage.Complete;
    if (b.stage !== BandStage.Complete) return false;
    p.parts.push(b);
    p.live.push(b.part);
    p.building = undefined;
    if (p.parts.length < p.bands.length) return false;
    return complete(p);
  };

  /** The region logic of `work`: decides whether a new region is needed, starts it when the timing rule allows and
   * advances it within the budget. True while a region is wanted or under way. */
  const regions = (frame: LiveFrame, start: number, budgetMs: number): boolean => {
    const view = frame.view,
      light = frame.quality === 'light';
    const scale = 2 ** (Math.round(2 * Math.log2(view.scale)) / 2),
      key = host.key(scale, frame.dpr, light);
    if (key === undefined || key === failedKey) {
      dropPending();
      return false;
    }
    const cur = retained.shown;
    // A draft serves while the view moves; at rest it is made again at full quality.
    const fits = (r: Region): boolean => !r.stale && (!r.draft || moving) && retained.current(r) && r.key === key && r.dpr === frame.dpr && covers(r.rect, frame.rect);
    if (cur && fits(cur)) {
      dropPending();
      needSince = -1;
      return false;
    }
    // Full regions take precedence over drafts; suffix uploads happen in work, never in draw.
    const kept = retained.take(fits);
    if (kept) {
      const t = host.now();
      for (const b of kept.parts) raster.prepare(b.suffix);
      diagnostics?.restored(host.now() - t);
      dropPending();
      needSince = -1;
      retained.show(kept);
      return false;
    }
    if (needSince < 0) needSince = start;
    // A region under way is abandoned when the view left it, the pixel ratio or the map content changed. A scale
    // step alone does not abandon it: a zoom changes the key at every half-octave, and a region that never
    // completes leaves the far one on screen for the whole gesture. It completes, shows, and the next one follows.
    const p0 = pending;
    if (p0 && (p0.dpr !== frame.dpr || !covers(p0.rect, frame.rect) || (p0.key !== key && (p0.light !== light || host.key(p0.scale, p0.dpr, p0.light) !== p0.key || Math.abs(Math.log2(p0.scale / view.scale)) > KEEP_OCTAVES)))) dropPending();
    if (!pending) {
      // Nothing starts while the view moves, unless nothing can be shown or the gesture lasts: each band is a long task.
      const nothing = !cur || cur.dpr !== frame.dpr;
      if (!nothing && start - movedAt < host.settleMs && start - needSince < host.maxWaitMs) return true;
      pending = { ...host.plan(view, frame.cssW, frame.cssH, frame.dpr, key), light, stale: false, parts: [], live: [], draft: false, provisional: false, arrivals: host.arrivals() };
      diagnostics?.regionStarted();
    }
    blocked = false;
    for (let p = pending; p && pending === p;) {
      if (advance(p) || blocked || host.now() - start >= budgetMs) break;
    }
    return !!pending;
  };

  /** Far from the recorded scale, strokes lose their hairline batching and cover quads fill the target. Baking at
   * most four small snapshots caps that frame cost. True when a bake was attempted, including failed targets. */
  const snap = (r: Region): boolean => {
    let did = false;
    for (const b of r.parts) {
      if (b.snapshot || b.snapshotFailed || !b.suffix.ops.length) continue;
      const t = host.now();
      const baked = raster.bake(b.suffix, Math.min(b.density, densityFor(b.w, b.h, MOVING_PIXELS)), { under: b.baked, samples: MOVING_SAMPLES });
      diagnostics?.baked(host.now() - t);
      // No target for it: the band goes on replaying its suffix (correct, at its cost).
      if (baked) b.snapshot = baked;
      else b.snapshotFailed = true;
      did = true;
    }
    return did;
  };

  return {
    get pending(): Region | undefined {
      return pending;
    },
    get failedKey(): string | undefined {
      return failedKey;
    },
    get moving(): boolean {
      return moving;
    },
    track(frame: LiveFrame, start: number): void {
      const view = frame.view;
      if (view.cx !== lastCx || view.cy !== lastCy || view.scale !== lastScale) {
        // The first view seen is not a movement (the first region would be made as a draft, then again).
        if (!Number.isNaN(lastScale)) movedAt = start;
        lastCx = view.cx;
        lastCy = view.cy;
        lastScale = view.scale;
      }
      moving = frame.moving || start - movedAt < host.settleMs;
    },
    work: regions,
    snapshots(frame: LiveFrame): void {
      const r = retained.shown;
      if (r && r.dpr === frame.dpr && beyond(frame.view.scale / r.scale, SNAPSHOT_AHEAD) && snap(r) && !pending) raster.releaseBakeScratch();
    },
    dropPending,
    clearFailedKey(): void {
      failedKey = undefined;
    },
    resetNeed(): void {
      needSince = -1;
    },
    forgetPending(): void {
      if (pending) {
        pending.parts.length = 0;
        pending.live.length = 0;
        pending.building = undefined;
      }
      pending = undefined;
    },
    dispose(): void {
      retained.release(pending);
      pending = undefined;
    },
  };
}
