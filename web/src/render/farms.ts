/** Farmstead drawing helpers shared by the SVG and Canvas renderers (lots, plots, ridges of the raised massing). */
import type { Farmstead, FarmBuilding, Polygon, Polyline, Vec2 } from '../gen/types';
import { readMassing } from './cityMassing';

/** Ridge lines of the farm buildings, those of the volumes both views raise (farmRoofs.ts farmPlacedBuildings): the
 * engine's massing when it sends one (no line on a volume whose roof is explicit pans, a tree or a small decorative
 * volume), else the ridge of the roof kind the derived piece takes. */
export function farmRidges(f: Farmstead): Polyline[] {
  const out: Polyline[] = [];
  for (const b of f.parts ?? []) {
    const sent = Array.isArray(b.massing) ? readMassing({ massing: b.massing }, [{ outer: b.poly, holes: [] }]) : undefined;
    if (!sent) {
      const r = ridge(b);
      if (r) out.push(r);
      continue;
    }
    for (const m of sent)
      for (const v of (m.volumes?.length ? m.volumes : [m]) as { minor?: boolean; pans?: unknown; form?: string; ridges?: readonly number[][] }[])
        if (!v.minor && !v.pans && v.form !== 'tree')
          for (const r of v.ridges ?? [])
            if (r.length === 4 && r.every(Number.isFinite))
              out.push([
                { x: r[0], y: r[1] },
                { x: r[2], y: r[3] },
              ]);
  }
  return out;
}

/** Ridge line of one farm building from its roof kind, or null: full length for a gable or barrel, shortened for a hip
 * (pagoda included), none for flat, terraced, pyramidal, conical, domed or round roofs (farmRoofs.ts farmPiece). */
export const farmBuildingRidge = (b: FarmBuilding): Polyline | null => ridge(b);
function ridge(b: FarmBuilding): Polyline | null {
  const hip = b.roof === 'hip' || b.roof === 'tiled-hip' || b.roof === 'pagoda';
  if ((!hip && b.roof !== 'gable' && b.roof !== 'barrel') || b.poly.length !== 4) return null;
  const [p0, p1, p2, p3] = b.poly;
  const l01 = Math.hypot(p1.x - p0.x, p1.y - p0.y),
    l12 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  // midpoints of the two short sides
  const m = (a: Vec2, c: Vec2): Vec2 => ({ x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 });
  let a: Vec2, c: Vec2, short: number;
  if (l01 >= l12) {
    a = m(p1, p2);
    c = m(p3, p0);
    short = l12;
  } else {
    a = m(p0, p1);
    c = m(p2, p3);
    short = l01;
  }
  if (hip) {
    const L = Math.hypot(c.x - a.x, c.y - a.y),
      k = Math.min(0.45, (0.5 * short) / (L || 1));
    if (k >= 0.45) return null;
    return [
      { x: a.x + (c.x - a.x) * k, y: a.y + (c.y - a.y) * k },
      { x: c.x + (a.x - c.x) * k, y: c.y + (a.y - c.y) * k },
    ];
  }
  return [a, c];
}

/** Small round tree crowns as polygons (Canvas batches). */
export function treePolys(pts: Vec2[], r = 2.2): Polygon[] {
  return pts.map(p => {
    const out: Polygon = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 2 * Math.PI;
      out.push({ x: p.x + r * Math.cos(a), y: p.y + r * Math.sin(a) });
    }
    return out;
  });
}

/** Plots of a given kind of all farms. */
export function farmPlots(fs: Farmstead[], kind: string): Polygon[] {
  const out: Polygon[] = [];
  for (const f of fs) for (const p of f.plots ?? []) if (p.kind === kind) out.push(p.poly);
  return out;
}
