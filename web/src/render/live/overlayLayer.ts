/**
 * Live cartography overlay (contract: ./contract.ts; notes: web/out/live-compositor-2026-11-18/C-overlay.md).
 *
 * The vector map of a region around the view is recorded once per half-octave of scale, in horizontal bands
 * (render/cartography/liveHost.ts regionPlan / recordBand), and replayed in the
 * compositor's context at every frame with the view matrix. Each band list is split at the `crisp` mark:
 *  - the area prefix (land-use tints, forest washes and their clips, furrows, strips) is rasterized once per region
 *    into a texture and drawn as one quad per band: its cost no longer follows the map content. A region is shown
 *    only once every band that has a prefix has it baked: a frame never replays a prefix op by op;
 *  - the suffix (lines, water cut, roads, urban layers, symbols) is culled to its band once, its map-sized polygons
 *    cut to the band, and it is replayed op by op on top, in the same isolated group, so order and blending are
 *    those of the whole list.
 * A region shown far from its recorded scale (a zoom that outruns the next recording) is not what its lists were
 * batched for: sub-pixel lines stop being hairlines and draw one by one, and every cover quad grows to the screen.
 * Its lists are not replayed there: as soon as the view drifts from the recorded scale each band is rasterized once,
 * whole, into a small snapshot texture, and past the limit frames draw that quad until the new region is ready.
 * Whatever is baked while the view moves is bounded (pixels, two samples); a region made then is a draft, made again
 * at full quality once the view rests.
 * Recording, upload and bake happen in `work`, one step per call (more when the budget allows); `draw` only submits.
 */
import { resetLiveState, type LiveFrame, type LiveLayer, type LiveLayerStats } from './contract';
import type { Rect4, View } from '../view';
import { CRISP_MARK, type DisplayList } from '../gpu/contract';
import { createLiveRasterizer } from '../gpu/liveRasterizer';
import type { BakedPrefix, LivePart } from '../gpu/contract';
import { clipList, cullList, markIndex, splitList } from '../gpu/listTools';

export interface OverlayPlan {
  key: string;
  rect: Rect4;
  scale: number;
  dpr: number;
  bands: Rect4[];
}
/** One recorded band: `w` x `h` device pixels at the plan's scale and pixel ratio, centred on (`cx`, `cy`). */
export interface OverlayBand {
  list: DisplayList;
  rect: Rect4;
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** What the renderer that owns the map gives the layer (render/cartography/liveHost.ts). */
interface OverlayHost {
  /** True while the GPU vector engine draws the live map; otherwise the layer is never ready (its stand-in shows). */
  active(): boolean;
  /** Everything a retained region depends on besides its rectangle; undefined when it cannot be recorded. */
  key(scale: number, dpr: number, light: boolean): string | undefined;
  plan(view: View, cssW: number, cssH: number, dpr: number, key: string): OverlayPlan;
  /** Records one band with the `crisp` mark; undefined when the recorder cannot represent the map. */
  record(plan: OverlayPlan, band: Rect4, light: boolean): OverlayBand | undefined;
  /** Asks for a new frame (a region became ready). */
  invalidate(): void;
  now(): number;
  /** A new region waits until the view has rested this long, or the need is older than `maxWaitMs`. */
  readonly settleMs: number;
  readonly maxWaitMs: number;
}

/** Recorded pixels kept around a band when its lists are culled: the bake gutter and the antialiasing reach. */
const CULL_PAD = 16;
/** Pixels of one baked band (four per region). */
const BAKE_PIXELS = 4e6,
  BAKE_PIXELS_LIGHT = 1.5e6;
/** Bake attempts of a prefix, the density halved after each failure; then the layer gives way to its stand-in. */
const BAKE_TRIES = 3;
/** Pixels and samples of what is baked while the view moves (a draft region's prefixes, every snapshot). */
const MOVING_PIXELS = 1e6,
  MOVING_SAMPLES = 2;
/** View scale over recorded scale (or its inverse) from which a region is shown by its snapshots. Inside it the
 * lists are replayed: that is the stretch between two recordings of a view at rest, and a little more. */
const SNAPSHOT_RATIO = 1.5;
/** The same ratio from which the snapshots are made, ahead of their use (a view at rest stays within 2^(1/4)). */
const SNAPSHOT_AHEAD = 1.25;
/** A region under way survives the scale steps of a zoom while it stays this close (octaves) to the view's scale. */
const KEEP_OCTAVES = 1.25;

const NOTHING: DisplayList = { width: 0, height: 0, ops: [], stats: { calls: 0, ops: 0, paths: 0, sprites: 0, recordMs: 0 } };

type MutablePart = { list: DisplayList; post: [number, number, number, number, number, number]; scissor: [number, number, number, number]; baked?: BakedPrefix };
interface Band {
  rect: Rect4;
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** The area ops, until they are baked. Absent: the band has none (outside the map, or a look without tints). */
  prefix?: DisplayList;
  suffix: DisplayList;
  /** Texels per recorded pixel of the bakes of this band. */
  density: number;
  /** Next step: 0 cut the suffix polygons to the band, 1 upload the prefix, 2 upload the suffix, 3 bake the prefix, 4 done. */
  stage: 0 | 1 | 2 | 3 | 4;
  baked?: BakedPrefix;
  /** The whole band (prefix then suffix) at its recorded scale: shown in place of the replay far from that scale. */
  snapshot?: BakedPrefix;
  snapshotFailed?: boolean;
  part: MutablePart;
}
interface Region extends OverlayPlan {
  light: boolean;
  stale: boolean;
  parts: Band[];
  live: MutablePart[];
  building?: Band;
  /** Made while the view moved, with bounded bakes: shown, and made again at full quality once the view rests. */
  draft: boolean;
}

const covers = (outer: Rect4, inner: Rect4): boolean => outer.minX <= inner.minX && outer.minY <= inner.minY && outer.maxX >= inner.maxX && outer.maxY >= inner.maxY;
const meets = (a: Rect4, b: Rect4): boolean => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
const beyond = (k: number, ratio: number): boolean => k >= ratio || k <= 1 / ratio;

export function createOverlayLayer(gl: WebGL2RenderingContext, host: OverlayHost): LiveLayer | undefined {
  const made = createLiveRasterizer(gl);
  if (!made) return undefined;
  const raster = made;
  let shown: Region | undefined, pending: Region | undefined;
  /** Latched: a GL error after a replay, a failed program or bake. The layer stays on its stand-in until the context changes. */
  let failed = '';
  /** A key the recorder could not represent: not tried again until the key changes. */
  let failedKey: string | undefined;
  let lastCx = NaN,
    lastCy = NaN,
    lastScale = NaN,
    movedAt = -Infinity,
    needSince = -1;
  /** The view moves (the frame says so, or it changed less than the settle delay ago): set at each `work`. */
  let moving = false;
  const stats: LiveLayerStats = {
    drawCalls: 0,
    triangles: 0,
    ms: 0,
    clips: 0,
    ops: 0,
    // Bands of the region shown: all, with a baked prefix, without any prefix (baked + empty = bands), with a snapshot.
    bands: 0,
    baked: 0,
    empty: 0,
    snapshots: 0,
    // The last frame drew snapshots; bands whose lists it replayed although the view was past the snapshot ratio
    // (expected 0, 1 frame at most per region); the region is a draft; view scale over recorded scale of that frame.
    snapshot: 0,
    replayedFar: 0,
    draft: 0,
    ratio: 1,
    // Triangles of the last frame by what drew them (the rest of `triangles` is cover and baked quads).
    fanTriangles: 0,
    strokeTriangles: 0,
    spriteTriangles: 0,
    // Programs, textures, geometry or buffers the last frame had to create or upload itself, and since the start
    // (expected 0: `warm` and `prepare` make them in `work`).
    late: 0,
    lateTotal: 0,
    pending: 0,
    bytes: 0,
    failed: 0,
    bakeMs: 0,
    recordMs: 0,
  };
  const refresh = (): void => {
    const r = shown;
    let baked = 0,
      empty = 0,
      snapshots = 0;
    if (r)
      for (const b of r.parts) {
        if (b.baked) baked++;
        else empty++;
        if (b.snapshot) snapshots++;
      }
    stats.bands = r ? r.parts.length : 0;
    stats.baked = baked;
    stats.empty = empty;
    stats.snapshots = snapshots;
    stats.draft = r?.draft ? 1 : 0;
    stats.pending = pending ? 1 : 0;
    stats.bytes = raster.bytes();
  };

  const releaseBand = (b: Band | undefined): void => {
    if (!b) return;
    if (b.baked) raster.releaseBaked(b.baked);
    if (b.snapshot) raster.releaseBaked(b.snapshot);
    b.baked = b.snapshot = undefined;
    b.part.baked = undefined;
  };
  const release = (region: Region | undefined): void => {
    if (!region) return;
    for (const b of region.parts) releaseBand(b);
    releaseBand(region.building);
    region.parts.length = 0;
    region.live.length = 0;
    region.building = undefined;
  };
  const dropPending = (): void => {
    if (pending) {
      release(pending);
      pending = undefined;
      raster.releaseBakeScratch();
    }
  };
  const fail = (error: unknown): void => {
    const lost = raster.lost;
    release(shown);
    shown = undefined;
    dropPending();
    // A lost context is the compositor's to report (`contextLost`), not a fault of this layer.
    if (lost) return;
    failed = error instanceof Error ? error.message : String(error);
    stats.failed = 1;
    console.warn(`Live overlay: the cartography falls back to its stand-in (${failed}).`);
  };

  /** Density of a bake of `w` x `h` recorded pixels (texels per pixel): 1 unless the texture limit or `pixels` says less. */
  const densityFor = (w: number, h: number, pixels: number): number => {
    const side = raster.maxBakeSize - 8;
    return Math.min(1, side / w, side / h, Math.sqrt(pixels / (w * h)));
  };
  const boxOf = (b: { w: number; h: number }): readonly [number, number, number, number] => [-CULL_PAD, -CULL_PAD, b.w + CULL_PAD, b.h + CULL_PAD];
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
    return { rect: made.rect, cx: made.cx, cy: made.cy, w: made.w, h: made.h, prefix, suffix, stage: 0, density: densityFor(made.w, made.h, light ? BAKE_PIXELS_LIGHT : BAKE_PIXELS), part: { list: suffix, post: [1, 0, 0, 1, 0, 0], scissor: [0, 0, 0, 0] } };
  };

  /** Set by `advance` when it can do nothing more in this call (the programs are still compiling). */
  let blocked = false;
  /** A complete region replaces the one shown, once every program a frame can use exists: `draw` creates nothing. */
  const complete = (p: Region): boolean => {
    if (!raster.warm()) {
      blocked = true;
      return false;
    }
    // Every prefix baked, every list uploaded: the textures of the region shown go.
    release(shown);
    shown = p;
    pending = undefined;
    needSince = -1;
    raster.releaseBakeScratch();
    host.invalidate();
    return true;
  };
  /** One step of the region being made. True when it ended (complete and shown, or dropped). */
  const advance = (p: Region): boolean => {
    if (p.parts.length >= p.bands.length) return complete(p);
    const b = p.building;
    if (!b) {
      const t = host.now(),
        made = host.record(p, p.bands[p.parts.length], p.light);
      stats.recordMs = Math.max(stats.recordMs, host.now() - t);
      if (!made) {
        failedKey = p.key;
        dropPending();
        return true;
      }
      p.building = bandOf(made, p.light);
      return false;
    }
    if (b.stage === 0) {
      // The sea, the land clip, a lake: fanned for what this band can show, not for the whole map at every frame.
      b.suffix = clipList(b.suffix, boxOf(b));
      b.part.list = b.suffix;
      b.stage = b.prefix ? 1 : 2;
    } else if (b.stage === 1) {
      if (b.prefix) raster.prepare(b.prefix);
      b.stage = 2;
    } else if (b.stage === 2) {
      raster.prepare(b.suffix);
      b.stage = b.prefix ? 3 : 4;
    } else if (b.stage === 3 && b.prefix) {
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
      stats.bakeMs = Math.max(stats.bakeMs, host.now() - t);
      // No region is ever shown with a prefix left to replay live: without its bake the layer gives way (stand-in).
      if (!baked) throw new Error('the area prefix of a band could not be baked');
      b.baked = baked;
      b.part.baked = baked;
      b.density = density;
      b.prefix = undefined;
      b.stage = 4;
    } else if (b.stage === 3) b.stage = 4;
    if (b.stage !== 4) return false;
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
    const cur = shown;
    // A draft serves while the view moves; at rest it is made again at full quality.
    if (cur && !cur.stale && (!cur.draft || moving) && cur.key === key && cur.dpr === frame.dpr && covers(cur.rect, frame.rect)) {
      dropPending();
      needSince = -1;
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
      pending = { ...host.plan(view, frame.cssW, frame.cssH, frame.dpr, key), light, stale: false, parts: [], live: [], draft: false };
    }
    blocked = false;
    for (let p = pending; p && pending === p;) {
      if (advance(p) || blocked || host.now() - start >= budgetMs) break;
    }
    return !!pending;
  };

  /** Bakes the snapshots `r` lacks, all in this call: four small targets at most, each one replay of a band's
   * suffix over its baked prefix. The frames that follow then never replay a list far from its scale. True when
   * one was attempted. */
  const snap = (r: Region): boolean => {
    let did = false;
    for (const b of r.parts) {
      if (b.snapshot || b.snapshotFailed || !b.suffix.ops.length) continue;
      const t = host.now();
      const baked = raster.bake(b.suffix, Math.min(b.density, densityFor(b.w, b.h, MOVING_PIXELS)), { under: b.baked, samples: MOVING_SAMPLES });
      stats.bakeMs = Math.max(stats.bakeMs, host.now() - t);
      // No target for it: the band goes on replaying its suffix (correct, at its cost).
      if (baked) b.snapshot = baked;
      else b.snapshotFailed = true;
      did = true;
    }
    return did;
  };

  return {
    name: 'overlay',
    isolated: true,
    ready(frame: LiveFrame): boolean {
      const r = shown;
      // A region keeps showing at any scale while its replacement is made, as long as it was recorded for this pixel
      // ratio; one that no longer meets the view has nothing to show.
      return !!r && !failed && r.dpr === frame.dpr && meets(r.rect, frame.rect) && host.active() && !raster.lost;
    },
    restExact(frame: LiveFrame): boolean {
      const r = shown;
      if (!r || failed || r.stale || r.draft || r.dpr !== frame.dpr || !covers(r.rect, frame.rect) || !host.active() || raster.lost) return false;
      // Recorded for this frame's half-octave scale bucket (its key holds it): the lists are replayed, never a snapshot.
      const scale = 2 ** (Math.round(2 * Math.log2(frame.view.scale)) / 2);
      return r.key === host.key(scale, frame.dpr, frame.quality === 'light') && !beyond(frame.worldToPixel[0] / (r.scale * r.dpr), SNAPSHOT_RATIO);
    },
    draw(frame: LiveFrame): void {
      const r = shown;
      if (!r) return;
      const sx = frame.worldToPixel[0],
        sy = frame.worldToPixel[1],
        tx = frame.worldToPixel[2],
        ty = frame.worldToPixel[3];
      // Recorded device pixels of each band -> device pixels of this frame; each band only paints its own rows.
      const kx = sx / (r.scale * r.dpr),
        ky = sy / (r.scale * r.dpr),
        far = beyond(kx, SNAPSHOT_RATIO);
      let snapshots = 0,
        replayedFar = 0;
      for (let i = 0; i < r.parts.length; i++) {
        const b = r.parts[i],
          part = b.part,
          post = part.post,
          scissor = part.scissor;
        post[0] = kx;
        post[3] = ky;
        post[4] = b.cx * sx + tx - (kx * b.w) / 2;
        post[5] = b.cy * sy + ty - (ky * b.h) / 2;
        scissor[0] = b.rect.minX * sx + tx;
        scissor[1] = b.rect.minY * sy + ty;
        scissor[2] = b.rect.maxX * sx + tx;
        scissor[3] = b.rect.maxY * sy + ty;
        // Far from the recorded scale a band is its snapshot, one quad. `work` makes the snapshots before the view
        // gets there; a jump past both ratios within one frame replays the lists for that frame only.
        const snapshot = far ? b.snapshot : undefined;
        if (snapshot) {
          part.baked = snapshot;
          part.list = NOTHING;
          snapshots++;
        } else {
          part.baked = b.baked;
          part.list = b.suffix;
          if (far && b.suffix.ops.length && meets(b.rect, frame.rect)) replayedFar++;
        }
      }
      try {
        raster.replayLive(r.live as readonly LivePart[], frame.target, frame.width, frame.height);
        const s = raster.lastStats(),
          tally = raster.liveTally();
        stats.drawCalls = s.drawCalls;
        stats.triangles = s.triangles;
        stats.ms = s.ms;
        stats.clips = s.clips;
        stats.ops = s.ops;
        stats.fanTriangles = tally.fan;
        stats.strokeTriangles = tally.stroke;
        stats.spriteTriangles = tally.sprite;
        stats.late = tally.late;
        stats.lateTotal += tally.late;
        stats.snapshot = snapshots ? 1 : 0;
        stats.replayedFar = replayedFar;
        stats.ratio = kx;
      } catch (error) {
        fail(error);
      } finally {
        resetLiveState(gl, frame.target, frame.width, frame.height);
      }
    },
    work(budgetMs: number, frame: LiveFrame | undefined): boolean {
      if (!frame || failed || raster.lost || !host.active()) return false;
      const start = host.now(),
        view = frame.view;
      if (view.cx !== lastCx || view.cy !== lastCy || view.scale !== lastScale) {
        // The first view seen is not a movement (the first region would be made as a draft, then again).
        if (!Number.isNaN(lastScale)) movedAt = start;
        lastCx = view.cx;
        lastCy = view.cy;
        lastScale = view.scale;
      }
      moving = frame.moving || start - movedAt < host.settleMs;
      let more = false;
      try {
        // The programs start compiling at the first call and are polled at each one; nothing is shown before.
        const warm = raster.warm();
        more = regions(frame, start, budgetMs) || !warm;
        // Then, for the region shown now (the one this call may just have completed): its snapshots, as soon as the
        // view drifts from its scale and before it is far, so that no frame replays its lists there.
        const r = shown;
        if (r && r.dpr === frame.dpr && beyond(view.scale / r.scale, SNAPSHOT_AHEAD) && snap(r) && !pending) raster.releaseBakeScratch();
      } catch (error) {
        fail(error);
        more = false;
      } finally {
        resetLiveState(gl, frame.target, frame.width, frame.height);
      }
      refresh();
      return more;
    },
    invalidate(): void {
      if (shown) shown.stale = true;
      dropPending();
      failedKey = undefined;
    },
    contextLost(): void {
      // Every handle is dead: forget them without deleting anything; the next `work` records and uploads again.
      raster.dropContext();
      if (shown) {
        shown.parts.length = 0;
        shown.live.length = 0;
      }
      if (pending) {
        pending.parts.length = 0;
        pending.live.length = 0;
        pending.building = undefined;
      }
      shown = pending = undefined;
      failed = '';
      stats.failed = 0;
      needSince = -1;
      refresh();
    },
    stats: (): LiveLayerStats => stats,
    dispose(): void {
      release(shown);
      release(pending);
      shown = pending = undefined;
      raster.dispose();
    },
  };
}
