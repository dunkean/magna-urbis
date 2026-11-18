/**
 * Ground sampling and terrain seating for display volumes. Called by the City 3D scene adapter and sibling mesh builders.
 * Reads/writes: Reads supplied terrain samplers and footprints; returns sampled bounds/seats/height functions without shared state.
 */
import type { Surface } from '../../../../rust/bridge/housesContract';
import { City3dHeight } from './types';
import { inRing } from './roofGeometry';

/** Steepest footprint ground (rise over run) still read as a hillside: a level floor stands
 * on its high side over a footing. Steeper is a cliff (Rust `activities::ground_fits`). */
export const CITY3D_CLIFF_SLOPE = 1;

/** Retaining plinth under a floor built against a cliff face, m. */
export const CITY3D_RETAINING_PLINTH_M = 3;

/** Terrain under a footprint: lowest and highest sample and steepest sample-to-sample slope.
 * Corners first; a large or uneven footprint adds an interior grid (inside its rings, at most
 * 9 × 9) so a cliff between corners is not missed. */
export function footprintTerrain(footprint: Surface, heightAt: City3dHeight): { low: number; high: number; slope: number } | undefined {
  let low = Infinity,
    high = -Infinity,
    slope = 0,
    x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const shape of footprint) {
    const ring = shape.outer,
      hs = ring.map(p => heightAt(p.x, p.y));
    ring.forEach((p, i) => {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
      const h = hs[i];
      if (!Number.isFinite(h)) return;
      low = Math.min(low, h);
      high = Math.max(high, h);
      const n = ring[(i + 1) % ring.length],
        hn = hs[(i + 1) % ring.length],
        run = Math.hypot(n.x - p.x, n.y - p.y);
      if (Number.isFinite(hn) && run > 0.5) slope = Math.max(slope, Math.abs(hn - h) / run);
    });
  }
  if (!Number.isFinite(low)) return undefined;
  if (high - low > 0.5 || Math.max(x1 - x0, y1 - y0) > 12) {
    const nx = Math.min(8, Math.max(1, Math.ceil((x1 - x0) / 2))),
      ny = Math.min(8, Math.max(1, Math.ceil((y1 - y0) / 2)));
    const dx = (x1 - x0) / nx,
      dy = (y1 - y0) / ny,
      grid: number[] = [];
    for (let j = 0; j <= ny; j++)
      for (let i = 0; i <= nx; i++) {
        const p = { x: x0 + dx * i, y: y0 + dy * j };
        const h = footprint.some(shape => inRing(shape.outer, p)) ? heightAt(p.x, p.y) : NaN;
        grid.push(h);
        if (!Number.isFinite(h)) continue;
        low = Math.min(low, h);
        high = Math.max(high, h);
        const left = i > 0 ? grid[grid.length - 2] : NaN,
          up = j > 0 ? grid[grid.length - 2 - nx] : NaN;
        if (Number.isFinite(left) && dx > 1e-6) slope = Math.max(slope, Math.abs(h - left) / dx);
        if (Number.isFinite(up) && dy > 1e-6) slope = Math.max(slope, Math.abs(h - up) / dy);
      }
  }
  return { low, high, slope };
}

/** Floor level of a level building on that terrain: its high side on a hillside (the footing
 * fills down to the low side, terraces keep their heights), a retaining plinth above the low
 * side against a cliff (the uphill part stands into the face, never hung from the top). */
export const terrainSeat = (t: { low: number; high: number; slope: number }): number => (t.slope > CITY3D_CLIFF_SLOPE ? Math.min(t.high, t.low + CITY3D_RETAINING_PLINTH_M) : t.high);

/** Cubic B-spline of cell-centred samples, as Terrain3d samples its surface; water clamps to 0. */
export function rasterHeight(data: Float32Array, n: number, width: number): City3dHeight {
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  const weights = (t: number): number[] => [(1 - t) ** 3 / 6, (3 * t ** 3 - 6 * t * t + 4) / 6, (-3 * t ** 3 + 3 * t * t + 3 * t + 1) / 6, t ** 3 / 6];
  return (x, y) => {
    const gx = clamp(x / width, 0, 1) * n - 0.5,
      gy = clamp(y / width, 0, 1) * n - 0.5,
      bx = Math.floor(gx),
      by = Math.floor(gy);
    const wx = weights(gx - bx),
      wy = weights(gy - by);
    let h = 0;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) h += data[clamp(by + j - 1, 0, n - 1) * n + clamp(bx + i - 1, 0, n - 1)] * wx[i] * wy[j];
    return Math.max(0, h);
  };
}
