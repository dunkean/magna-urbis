/**
 * Owns the shown overlay region, off-screen retention and their baked textures. Called by overlayLayer.ts and its
 * recording scheduler so returning to a view restores its lists instead of recording again. The shown region is
 * outside the LRU; pending regions use the same release operation. Geometry remains in the rasterizer's own arena.
 */
import type { LiveRasterizer } from '../gpu/contract';
import type { OverlayDiagnostics } from './overlayDiagnostics';
import { covers, type Band, type OverlayHost, type Region } from './overlayTypes';
import { createRegionCache } from './regionCache';

/** Off-screen prefix/snapshot textures (mipmaps included) have a byte budget; the count bounds JS display lists.
 * At most four 4M-texel prefixes and four 1M-texel snapshots per region: about 100 MiB with mipmaps. Geometry lives
 * in the rasterizer's separate 256 MiB arena; restored suffixes must prepare again if that arena evicted them. */
const CACHE_BYTES = 128 * 2 ** 20,
  CACHE_REGIONS = 8;

export type OverlayRegions = ReturnType<typeof createOverlayRegions>;

export function createOverlayRegions(raster: LiveRasterizer, host: OverlayHost, diagnostics?: OverlayDiagnostics) {
  let shown: Region | undefined;
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
  const regionBytes = (r: Region): number => r.parts.reduce((sum, b) => sum + (b.baked?.bytes ?? 0) + (b.snapshot?.bytes ?? 0), 0);
  const cache = createRegionCache<Region>(CACHE_BYTES, CACHE_REGIONS, regionBytes, release);
  /** `a` makes `b` useless: the same key over at least its rectangle, and no worse (a draft never replaces a full region). */
  const supersedes = (a: Region, b: Region): boolean => a.key === b.key && covers(a.rect, b.rect) && (b.draft || !a.draft);
  /** The products made per view that `r` drew without have not arrived since it began (or it lacked none). */
  const current = (r: Region): boolean => !r.provisional || r.arrivals === host.arrivals();
  /** Shows `next` (complete) in place of the region shown, which goes to the cache unless stale or held by `next`. */
  const show = (next: Region): void => {
    const old = shown;
    shown = next;
    cache.drop(r => supersedes(next, r));
    if (old && old !== next) {
      if (old.stale || supersedes(next, old)) release(old);
      else cache.put(old);
    }
    host.invalidate();
  };
  return {
    get shown(): Region | undefined {
      return shown;
    },
    get size(): number {
      return cache.size;
    },
    get bytes(): number {
      return cache.bytes;
    },
    current,
    show,
    release,
    find: (fits: (region: Region) => boolean): Region | undefined => cache.find(fits),
    take(fits: (region: Region) => boolean): Region | undefined {
      cache.drop(r => {
        if (r.key !== host.key(r.scale, r.dpr, r.light)) diagnostics?.cacheExpired();
        else if (!current(r)) diagnostics?.cacheOvertaken();
        else return false;
        return true;
      });
      return cache.take(r => fits(r) && !r.draft) ?? cache.take(fits);
    },
    markStale(): void {
      if (shown) shown.stale = true;
    },
    releaseShown(): void {
      release(shown);
      shown = undefined;
    },
    forgetShown(): void {
      if (shown) {
        shown.parts.length = 0;
        shown.live.length = 0;
      }
      shown = undefined;
    },
    clear(release: boolean, invalidated = false): void {
      if (invalidated && cache.size) diagnostics?.cacheCleared();
      cache.clear(release);
    },
  };
}
