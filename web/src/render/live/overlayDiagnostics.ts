/**
 * Optional observation sink called by the overlay layer, recording scheduler and region store. Owns the probe global
 * and all overlay counters copied into __muLive.layers.overlay by the compositor; no rendering decision reads them.
 * The layer installs it to preserve the committed navigation probes. Recording and retention also work without a sink.
 */
import type { LiveFrame, LiveLayerStats } from './contract';
import type { BakedPrefix, LiveRasterizer } from '../gpu/contract';
import { meets, type Band, type Region } from './overlayTypes';

export type OverlayDiagnostics = ReturnType<typeof createOverlayDiagnostics>;

export function createOverlayDiagnostics() {
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
    // Last draw: snapshots used, visible far suffixes replayed without a snapshot, draft flag and scale ratio.
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
    // Since the start: regions begun, bands recorded, regions shown again from the cache; the last of those took
    // restoreMs to prepare its lists again; the cache emptied by `invalidate`, cached regions dropped for a key that no
    // longer matches (map content) or overtaken by an arrival (provisional); and the cache now.
    regions: 0,
    recorded: 0,
    cacheHits: 0,
    restoreMs: 0,
    cacheCleared: 0,
    cacheExpired: 0,
    cacheOvertaken: 0,
    cached: 0,
    cacheBytes: 0,
  };
  const refresh = (r: Region | undefined, pending: Region | undefined, raster: LiveRasterizer, cached: number, cacheBytes: number, inkBytes = 0): void => {
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
    stats.bytes = raster.bytes() + inkBytes;
    stats.cached = cached;
    stats.cacheBytes = cacheBytes;
  };

  let snapshots = 0,
    replayedFar = 0;
  return {
    stats: (): LiveLayerStats => stats,
    refresh,
    restGap(why: string): void {
      (globalThis as { __muLiveOverlayWhy?: string }).__muLiveOverlayWhy = why;
    },
    failed(value: boolean): void {
      stats.failed = value ? 1 : 0;
    },
    regionStarted(): void {
      stats.regions++;
    },
    recorded(ms: number): void {
      stats.recordMs = Math.max(stats.recordMs, ms);
      stats.recorded++;
    },
    baked(ms: number): void {
      stats.bakeMs = Math.max(stats.bakeMs, ms);
    },
    restored(ms: number): void {
      stats.restoreMs = ms;
      stats.cacheHits++;
    },
    cacheCleared(): void {
      stats.cacheCleared++;
    },
    cacheExpired(): void {
      stats.cacheExpired++;
    },
    cacheOvertaken(): void {
      stats.cacheOvertaken++;
    },
    beginDraw(): void {
      snapshots = replayedFar = 0;
    },
    bandDrawn(b: Band, snapshot: BakedPrefix | undefined, far: boolean, frame: LiveFrame): void {
      if (snapshot) snapshots++;
      else if (far && b.suffix.ops.length && meets(b.rect, frame.rect)) replayedFar++;
    },
    drawn(raster: LiveRasterizer, kx: number, extra: Partial<LiveLayerStats> = {}): void {
      const s = raster.lastStats(),
        tally = raster.liveTally();
      stats.drawCalls = s.drawCalls + (extra.drawCalls ?? 0);
      stats.triangles = s.triangles + (extra.triangles ?? 0);
      stats.ms = s.ms + (extra.ms ?? 0);
      stats.clips = s.clips + (extra.clips ?? 0);
      stats.ops = s.ops + (extra.ops ?? 0);
      stats.fanTriangles = tally.fan + (extra.fanTriangles ?? 0);
      stats.strokeTriangles = tally.stroke + (extra.strokeTriangles ?? 0);
      stats.spriteTriangles = tally.sprite + (extra.spriteTriangles ?? 0);
      stats.late = tally.late + (extra.late ?? 0);
      stats.lateTotal += stats.late;
      stats.snapshot = snapshots ? 1 : 0;
      stats.replayedFar = replayedFar;
      stats.ratio = kx;
    },
  };
}
