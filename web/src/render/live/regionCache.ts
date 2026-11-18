/**
 * The regions a live layer keeps after they leave the screen (render/live/overlayLayer.ts), so that going back to a
 * view seen a moment ago (a zoom out and back, a pan away and back) shows it again instead of recording it again.
 *
 * Least recently used first out, under a byte budget and a count: the bytes are what the caller says an entry holds
 * (its own GPU textures), the count bounds what no byte figure sees (the recorded lists in the JS heap). The entry on
 * screen is never here: the layer takes an entry out to show it and puts the one it replaces back.
 */
export interface RegionCache<R> {
  /** Keeps `entry` as the most recently used; the least recently used go beyond the budget or the count. */
  put(entry: R): void;
  /** Takes out the most recently used entry `fits` accepts. */
  take(fits: (entry: R) => boolean): R | undefined;
  /** Releases every entry `dead` accepts. */
  drop(dead: (entry: R) => boolean): void;
  /** Empties the cache; `release` false when the entries' resources are already gone (a lost context). */
  clear(release: boolean): void;
  readonly size: number;
  readonly bytes: number;
}

export function createRegionCache<R>(budget: number, count: number, bytesOf: (entry: R) => number, release: (entry: R) => void): RegionCache<R> {
  /** Oldest first, with the bytes counted when each was put (a cached entry does not change). */
  const entries: { entry: R; bytes: number }[] = [];
  let bytes = 0;
  const remove = (i: number, free: boolean): void => {
    const [e] = entries.splice(i, 1);
    bytes -= e.bytes;
    if (free) release(e.entry);
  };
  return {
    put(entry: R): void {
      const size = bytesOf(entry);
      entries.push({ entry, bytes: size });
      bytes += size;
      while (entries.length && (entries.length > count || bytes > budget)) remove(0, true);
    },
    take(fits: (entry: R) => boolean): R | undefined {
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (!fits(e.entry)) continue;
        remove(i, false);
        return e.entry;
      }
      return undefined;
    },
    drop(dead: (entry: R) => boolean): void {
      for (let i = entries.length - 1; i >= 0; i--) if (dead(entries[i].entry)) remove(i, true);
    },
    clear(free: boolean): void {
      while (entries.length) remove(entries.length - 1, free);
    },
    get size(): number {
      return entries.length;
    },
    get bytes(): number {
      return bytes;
    },
  };
}
