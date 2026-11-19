/**
 * Live overlay entry, called by render/cartography/liveHost.ts and driven by the compositor's LiveLayer contract.
 * Coordinates recording, retained regions and tilted drape adaptation; owns top-view projection and coverage decisions.
 * Drawable means an intersecting region at this pixel ratio. Rest-exact additionally requires full, current coverage
 * at this scale bucket. work also reports program/host warming, separately from those two presentation predicates.
 */
import { resetLiveState, type LiveFrame, type LiveLayer } from './contract';
import type { DisplayList, LivePart } from '../gpu/contract';
import { createLiveRasterizer } from '../gpu/liveRasterizer';
import { createOverlayDiagnostics } from './overlayDiagnostics';
import { createOverlayDrape } from './overlayDrape';
import { createOverlayRecording } from './overlayRecording';
import { createOverlayRegions } from './overlayRegions';
import { beyond, covers, meets, type Band, type MutablePart, type OverlayHost, type Region } from './overlayTypes';

export type { OverlayBand, OverlayPlan } from './overlayTypes';

/** View scale over recorded scale (or its inverse) from which a region is shown by its snapshots. Inside it the
 * lists are replayed at rest. During motion, an already prepared snapshot also bounds near-scale replay cost. */
const SNAPSHOT_RATIO = 1.5;
/** Main-thread time of one idle host warming slice. */
const WARM_SLICE_MS = 8;
const NOTHING: DisplayList = { width: 0, height: 0, ops: [], stats: { calls: 0, ops: 0, paths: 0, sprites: 0, recordMs: 0 } };

export function createOverlayLayer(gl: WebGL2RenderingContext, host: OverlayHost): LiveLayer | undefined {
  const raster = createLiveRasterizer(gl);
  if (!raster) return undefined;
  /** Latched until context loss: a replay, program or bake failure leaves the layer on its stand-in. */
  let failed = '';
  const diagnostics = createOverlayDiagnostics();
  const retained = createOverlayRegions(raster, host, diagnostics);
  const recording = createOverlayRecording(raster, host, retained, diagnostics);
  const drape = createOverlayDrape(raster, host, retained, () => !!failed);
  const refresh = (): void => diagnostics.refresh(retained.shown, recording.pending, raster, retained.size, retained.bytes, host.ink?.stats().bytes ?? 0);
  const fail = (error: unknown): void => {
    const lost = raster.lost;
    retained.releaseShown();
    recording.dropPending();
    retained.clear(true);
    // A lost context is the compositor's to report (`contextLost`), not a fault of this layer.
    if (lost) return;
    failed = error instanceof Error ? error.message : String(error);
    diagnostics.failed(true);
    console.warn(`Live overlay: the cartography falls back to its stand-in (${failed}).`);
  };

  /** Why the region shown is not the overlay at rest of `frame`; '' when it is. */
  const restGap = (frame: LiveFrame): string => {
    if (host.ink && !host.ink.ready()) return 'ink pending';
    if (failed) return `failed: ${failed}`;
    if (!host.active()) return 'inactive (vector engine or raster failed)';
    if (raster.lost) return 'context lost';
    // Recorded for this frame's half-octave scale bucket (its key holds it): the lists are replayed, never a snapshot.
    const key = host.key(2 ** (Math.round(2 * Math.log2(frame.view.scale)) / 2), frame.dpr, frame.quality === 'light'),
      r = retained.shown;
    if (key === undefined || key === recording.failedKey) return 'not recordable';
    if (!r) return 'no region';
    if (r.stale || r.draft) return r.stale ? 'stale' : 'draft';
    if (!retained.current(r)) return 'provisional';
    if (!host.fixedRaster?.() && (r.dpr !== frame.dpr || !covers(r.rect, frame.rect))) return 'not covered';
    if (r.key !== key) return 'other scale';
    if (host.fixedRaster?.()) return r.parts.every(b => !!b.snapshot) ? '' : 'snapshot pending';
    return beyond(frame.worldToPixel[0] / (r.scale * r.dpr), SNAPSHOT_RATIO) ? 'far' : '';
  };

  /** Parts of a frame that draws the kept region `u` where the region shown `r` does not reach, then `r` over it: each
   * band of `u` is cut by scissor to its rows above and below `r`'s rectangle and its spans beside it, so that no pixel
   * is drawn by both (their tints would add up). `u` is drawn by its snapshots far from its scale, as `r` is. Its lists
   * were prepared when it was shown; what the arena dropped since is uploaded in this frame. */
  const underPool: MutablePart[] = [];
  const underLive: MutablePart[] = [];
  const beneath = (u: Region, r: Region, frame: LiveFrame): readonly MutablePart[] => {
    const [sx, sy, tx, ty] = frame.worldToPixel,
      kx = sx / (u.scale * u.dpr),
      ky = sy / (u.scale * u.dpr),
      far = beyond(kx, SNAPSHOT_RATIO),
      hole = r.rect;
    underLive.length = 0;
    const piece = (b: Band, minX: number, minY: number, maxX: number, maxY: number): void => {
      if (!(maxX > minX && maxY > minY) || !(minX < frame.rect.maxX && maxX > frame.rect.minX && minY < frame.rect.maxY && maxY > frame.rect.minY)) return;
      const p = (underPool[underLive.length] ??= { list: NOTHING, post: [1, 0, 0, 1, 0, 0], scissor: [0, 0, 0, 0] }),
        snapshot = host.fixedRaster?.() || far || frame.moving ? b.snapshot : undefined;
      p.prefix = b.baked;
      p.suffix = b.suffix;
      p.baked = snapshot ?? (host.ink ? undefined : b.baked);
      p.list = snapshot ? NOTHING : b.suffix;
      p.post[0] = kx;
      p.post[3] = ky;
      p.post[4] = b.cx * sx + tx - (kx * b.w) / 2;
      p.post[5] = b.cy * sy + ty - (ky * b.h) / 2;
      p.scissor[0] = minX * sx + tx;
      p.scissor[1] = minY * sy + ty;
      p.scissor[2] = maxX * sx + tx;
      p.scissor[3] = maxY * sy + ty;
      underLive.push(p);
    };
    for (const b of u.parts) {
      const a = b.rect,
        y0 = Math.max(a.minY, hole.minY),
        y1 = Math.min(a.maxY, hole.maxY);
      piece(b, a.minX, a.minY, a.maxX, Math.min(a.maxY, hole.minY));
      piece(b, a.minX, Math.max(a.minY, hole.maxY), a.maxX, a.maxY);
      piece(b, a.minX, y0, Math.min(a.maxX, hole.minX), y1);
      piece(b, Math.max(a.minX, hole.maxX), y0, a.maxX, y1);
    }
    for (const p of r.live) underLive.push(p as MutablePart);
    return underLive;
  };

  const prefixPool: MutablePart[] = [],
    prefixLive: MutablePart[] = [];
  const extra = { drawCalls: 0, triangles: 0, ms: 0, late: 0, clips: 0, ops: 0, fanTriangles: 0, strokeTriangles: 0, spriteTriangles: 0 };

  return {
    name: 'overlay',
    isolated: true,
    drape: drape.source,
    ready(frame: LiveFrame): boolean {
      const r = retained.shown;
      // A region keeps showing at any scale while its replacement is made, as long as it was recorded for this pixel
      // ratio; one that no longer meets the view has nothing to show.
      return !!r && !failed && (host.fixedRaster?.() || r.dpr === frame.dpr) && meets(r.rect, frame.rect) && host.active() && !raster.lost && (!host.ink || host.ink.ready()) && (!host.fixedRaster?.() || r.parts.every(b => !!b.snapshot));
    },
    restExact(frame: LiveFrame): boolean {
      const why = restGap(frame);
      diagnostics.restGap(why);
      return !why;
    },
    draw(frame: LiveFrame): void {
      const r = retained.shown;
      if (!r) return;
      const sx = frame.worldToPixel[0],
        sy = frame.worldToPixel[1],
        tx = frame.worldToPixel[2],
        ty = frame.worldToPixel[3];
      // Recorded device pixels of each band -> device pixels of this frame; each band only paints its own rows.
      const kx = sx / (r.scale * r.dpr),
        ky = sy / (r.scale * r.dpr),
        far = beyond(kx, SNAPSHOT_RATIO);
      diagnostics.beginDraw();
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
        // Reuse prepared snapshots during motion too; missing or failed bakes still replay the exact suffix.
        const snapshot = host.fixedRaster?.() || far || frame.moving ? b.snapshot : undefined;
        part.prefix = b.baked;
        part.suffix = b.suffix;
        if (snapshot) {
          part.baked = snapshot;
          part.list = NOTHING;
        } else {
          part.baked = host.ink ? undefined : b.baked;
          part.list = b.suffix;
        }
        diagnostics.bandDrawn(b, snapshot, far, frame);
      }
      // A region that only meets the view (a pan past its margin, a zoom out past its side): a kept region fills the
      // rest of the view under it, rather than the bare ground, until the region of this view is made.
      const under = covers(r.rect, frame.rect) ? undefined : retained.find(c => !c.stale && c.dpr === frame.dpr && retained.current(c) && meets(c.rect, frame.rect));
      try {
        const parts = under ? beneath(under, r, frame) : r.live;
        const snapshots = !!host.ink && parts.every(part => part.list === NOTHING && !!part.baked);
        extra.drawCalls = extra.triangles = extra.ms = extra.late = 0;
        extra.clips = extra.ops = extra.fanTriangles = extra.strokeTriangles = extra.spriteTriangles = 0;
        if (host.ink && !snapshots) {
          // A full snapshot already contains the ink. If any part lacks one, replay all suffixes around one world
          // ink pass, so a partial snapshot cannot cover the ink or blend it twice at a retained-region seam.
          for (const part of parts) {
            part.baked = undefined;
            part.list = part.suffix!;
          }
          diagnostics.beginDraw();
          for (const b of r.parts) diagnostics.bandDrawn(b, undefined, far, frame);
          prefixLive.length = 0;
          for (const part of parts) {
            if (!part.prefix) continue;
            const prefix = (prefixPool[prefixLive.length] ??= { list: NOTHING, post: part.post, scissor: part.scissor });
            prefix.baked = part.prefix;
            prefix.post = part.post;
            prefix.scissor = part.scissor;
            prefixLive.push(prefix);
          }
          raster.replayLive(prefixLive, frame.target, frame.width, frame.height);
          const prefixStats = raster.lastStats();
          extra.drawCalls = prefixStats.drawCalls;
          extra.triangles = prefixStats.triangles;
          extra.ms = prefixStats.ms;
          extra.late = raster.liveTally().late;
          extra.clips = prefixStats.clips;
          extra.ops = prefixStats.ops;
          extra.fanTriangles = raster.liveTally().fan;
          extra.strokeTriangles = raster.liveTally().stroke;
          extra.spriteTriangles = raster.liveTally().sprite;
          host.ink.draw(frame);
          const inkStats = host.ink.stats();
          extra.drawCalls += inkStats.drawCalls;
          extra.triangles += inkStats.triangles;
          extra.ms += inkStats.ms;
          extra.late += inkStats.late ?? 0;
          extra.clips += inkStats.clips ?? 0;
          extra.ops += inkStats.ops ?? 0;
          extra.fanTriangles += inkStats.fanTriangles ?? 0;
          extra.strokeTriangles += inkStats.strokeTriangles ?? 0;
          extra.spriteTriangles += inkStats.spriteTriangles ?? 0;
        }
        raster.replayLive(parts, frame.target, frame.width, frame.height);
        diagnostics.drawn(raster, kx, extra);
      } catch (error) {
        fail(error);
      } finally {
        resetLiveState(gl, frame.target, frame.width, frame.height);
      }
    },
    work(budgetMs: number, frame: LiveFrame | undefined): boolean {
      if (!frame || failed || raster.lost || !host.active()) return false;
      const start = host.now();
      recording.track(frame, start);
      // The tilted picture uses only world-space drape tiles. A top-view recording or snapshot here can take an
      // entire map-sized band while orbiting, and can also overwrite the rasterizer's suspended drape bake.
      if (frame.camera.tilted) {
        recording.dropPending();
        drape.wanted(frame, false);
        return !raster.warm();
      }
      drape.cancel();
      let more = false;
      try {
        const inkWork = host.ink?.work(budgetMs, frame) ?? false;
        // The programs start compiling at the first call and are polled at each one; nothing is shown before.
        const warm = raster.warm(),
          wanted = recording.work(frame, start, budgetMs);
        drape.wanted(frame, wanted);
        more = wanted || !warm || inkWork;
        // Idle and at rest: a slice of what the next recordings would make in one block, at most WARM_SLICE_MS.
        if (!more && !recording.moving) more = !host.warm(Math.min(start + budgetMs, host.now() + WARM_SLICE_MS));
        recording.snapshots(frame);
        if (host.fixedRaster?.() && retained.shown?.parts.some(b => !b.snapshot && !b.snapshotFailed)) more = true;
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
      retained.markStale();
      recording.dropPending();
      retained.clear(true, true);
      recording.clearFailedKey();
      drape.invalidate();
    },
    lookChanged(): void {
      // A different look cannot show the previous look's region; absence also bypasses the settle wait.
      retained.releaseShown();
      recording.dropPending();
      retained.clear(true);
      recording.clearFailedKey();
      recording.resetNeed();
      drape.invalidate();
      refresh();
    },
    contextLost(): void {
      drape.cancel();
      // Dead handles must be forgotten without deleting resources from the lost context.
      raster.dropContext();
      host.ink?.contextLost();
      retained.forgetShown();
      recording.forgetPending();
      retained.clear(false);
      failed = '';
      diagnostics.failed(false);
      recording.resetNeed();
      refresh();
    },
    stats: diagnostics.stats,
    dispose(): void {
      drape.cancel();
      retained.releaseShown();
      recording.dispose();
      retained.clear(true);
      raster.dispose();
    },
  };
}
