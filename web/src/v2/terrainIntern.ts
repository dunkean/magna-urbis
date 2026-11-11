/**
 * Terrain identity across generations. Every engine result crosses a worker boundary, so a town build returns a
 * new `world.terrain` object even when the relief and the water are reused from memory. The display caches its
 * terrain-only products (GPU height/water textures, forest field, vector water raster, contours, parchment
 * backdrop) by object identity: keeping the previous terrain object when the content is the same keeps them all.
 */
import type { World } from '../gen/types';

type View = ArrayBufferView & { length?: number };
const BUDGET = 64e6;

function sameBytes(a: View, b: View): boolean {
  if (a.constructor !== b.constructor || a.byteLength !== b.byteLength) return false;
  const aligned = a.byteOffset % 4 === 0 && b.byteOffset % 4 === 0 && a.byteLength % 4 === 0;
  const x = aligned ? new Uint32Array(a.buffer, a.byteOffset, a.byteLength / 4) : new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const y = aligned ? new Uint32Array(b.buffer, b.byteOffset, b.byteLength / 4) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

/** Deep content equality; keys present only on `previous` are ignored (caches attached after display). */
function same(previous: unknown, next: unknown, budget: { left: number }, seen: WeakMap<object, unknown>): boolean {
  if (previous === next) return true;
  if (typeof previous !== typeof next || previous === null || next === null || typeof next !== 'object') return Number.isNaN(previous) && Number.isNaN(next);
  if (--budget.left < 0) return false;
  const a = previous as object, b = next as object;
  if (seen.get(b) === a) return true;
  seen.set(b, a);
  if (ArrayBuffer.isView(b)) { budget.left -= b.byteLength / 16; return ArrayBuffer.isView(a) && sameBytes(a as View, b as View); }
  if (b instanceof ArrayBuffer) return a instanceof ArrayBuffer && sameBytes(new Uint8Array(a), new Uint8Array(b));
  if (Array.isArray(b)) {
    if (!Array.isArray(a) || a.length !== b.length) return false;
    for (let i = 0; i < b.length; i++) if (!same(a[i], b[i], budget, seen)) return false;
    return true;
  }
  if (b instanceof Map || b instanceof Set || a instanceof Map || a instanceof Set) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  for (const key of Object.keys(b)) {
    const value = (b as Record<string, unknown>)[key];
    if (typeof value === 'function') return false;
    if (!same((a as Record<string, unknown>)[key], value, budget, seen)) return false;
  }
  return true;
}

/** `next` with `previous.terrain` when both carry the same terrain content (else `next` unchanged). */
export function internTerrain(previous: World | null | undefined, next: World): World {
  if (!previous?.terrain || !next.terrain || previous.terrain === next.terrain) return next;
  const key = (w: World): string => JSON.stringify([w.stats?.['v2.terrainKey'] ?? null, w.stats?.['v2.waterEditRevision'] ?? 0, w.mapSize, w.seed, w.stats?.decor ?? null]);
  if (previous.stats?.['v2.terrainKey'] === undefined || key(previous) !== key(next)) return next;
  const started = performance.now();
  const equal = same(previous.terrain, next.terrain, { left: BUDGET }, new WeakMap());
  performance.measure('v2:terrain-intern', { start: started });
  return equal ? { ...next, terrain: previous.terrain } : next;
}
