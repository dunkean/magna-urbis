import type { World, LandUseLayer, Polyline } from '../gen/types';
import { polygonCentroid, polygonContains } from '../gen/core/geom';
import type { Palette } from './styles';
import { pathD } from './util';

export interface RuralRenderOptions { visiblePaddocks?: boolean; concreteFieldBoundaries?: boolean }
export type RuralRenderLayer = LandUseLayer & { ruralDetails?: RuralRenderOptions };
interface Mark { line: Polyline; kind: 'fence' | 'stock' | 'stable' | 'hedge' | 'drain' | 'track'; closed?: boolean }
const cache = new WeakMap<LandUseLayer, { key: string; marks: Mark[] }>();
const edgeKey = (a: { x: number; y: number }, b: { x: number; y: number }): string => {
  const p = `${a.x.toFixed(1)},${a.y.toFixed(1)}`, q = `${b.x.toFixed(1)},${b.y.toFixed(1)}`;
  return p < q ? `${p}/${q}` : `${q}/${p}`;
};

/** Marks follow existing holdings and buildings; no new usable land or stable is invented by rendering. */
export function ruralDetails(lu: LandUseLayer): Mark[] {
  const opts = (lu as RuralRenderLayer).ruralDetails;
  if (!opts?.visiblePaddocks && !opts?.concreteFieldBoundaries) return [];
  const key = `${!!opts.visiblePaddocks}:${!!opts.concreteFieldBoundaries}`, saved = cache.get(lu);
  if (saved?.key === key) return saved.marks;
  const marks: Mark[] = [];
  if (opts.concreteFieldBoundaries) {
    const seen = new Set<string>();
    for (const area of lu.areas) {
      if (area.kind !== 'field') continue;
      const kind = (area as { enclosed?: boolean }).enclosed ? 'hedge' : 'drain';
      for (const ring of [area.poly, ...(area.holes ?? [])]) for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length], key = edgeKey(a, b);
        if (seen.has(key)) continue; seen.add(key);
        marks.push({ line: [a, b], kind });
        if (kind === 'drain') {
          const l = Math.hypot(b.x - a.x, b.y - a.y) || 1, dx = -(b.y - a.y) / l * .9, dy = (b.x - a.x) / l * .9;
          marks.push({ line: [{ x: a.x + dx, y: a.y + dy }, { x: b.x + dx, y: b.y + dy }], kind });
        }
      }
    }
    for (const way of lu.ways ?? []) marks.push({ line: way, kind: 'track' });
  }
  if (opts.visiblePaddocks) for (const farm of lu.farmsteads) {
    if (farm.cultivation === 'fungal') continue;
    for (const p of farm.plots ?? []) if (p.kind === 'paddock' || p.kind === 'pen') {
      const ring = p.poly, center = polygonCentroid(ring);
      // Gate on the side nearest the farmyard, with fence posts at physical intervals.
      let gate = 0, score = Infinity;
      const yard = farm.entry ?? polygonCentroid(farm.yard);
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length], d = Math.hypot((a.x + b.x) / 2 - yard.x, (a.y + b.y) / 2 - yard.y);
        if (d < score) { gate = i; score = d; }
      }
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length], l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const at = (t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        if (i === gate && l > 3) marks.push({ line: [a, at(.5 - 1.2 / l)], kind: 'fence' }, { line: [at(.5 + 1.2 / l), b], kind: 'fence' });
        else marks.push({ line: [a, b], kind: 'fence' });
        for (let t = 0; t < l; t += 4) {
          if (i === gate && Math.abs(t - l / 2) < 1.4) continue;
          const q = at(t / l), nx = -(b.y - a.y) / l * .6, ny = (b.x - a.x) / l * .6;
          marks.push({ line: [{ x: q.x - nx, y: q.y - ny }, { x: q.x + nx, y: q.y + ny }], kind: 'fence' });
        }
      }
      // Short body/back marks read as livestock, rather than plough furrows.
      for (const k of [-1, 1]) {
        const q = { x: center.x + (ring[0].x - center.x) * .24 * k, y: center.y + (ring[0].y - center.y) * .24 * k };
        const line = [{ x: q.x - .9, y: q.y }, { x: q.x + .9, y: q.y }, { x: q.x + 1.2, y: q.y - .6 }];
        if (line.every(q => polygonContains(ring, q) && !(farm.plots ?? []).some(p => p.kind === 'pond' && polygonContains(p.poly, q)))) marks.push({ kind: 'stock', line });
      }
    }
    for (const part of farm.parts ?? []) if (['stable', 'byre'].includes(part.use)) {
      marks.push({ line: part.poly, kind: 'stable', closed: true });
      if (part.poly.length === 4) for (const t of [.25, .5, .75]) {
        const [a, b, c, d] = part.poly;
        marks.push({ kind: 'stable', line: [{ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, { x: d.x + (c.x - d.x) * t, y: d.y + (c.y - d.y) * t }] });
      }
    }
  }
  cache.set(lu, { key, marks }); return marks;
}

const styles = (pal: Palette) => ({ fence: [pal.farmInk, .6], stock: [pal.farmInk, .85], stable: [pal.farmInk, .9], hedge: [pal.hedge, 1.6], drain: [pal.furrow, .85], track: [pal.trackFill, 2.2] } as const);
export function ruralDetailsSvg(lu: LandUseLayer, pal: Palette): string {
  const marks = ruralDetails(lu); if (!marks.length) return '';
  const style = styles(pal);
  return '<g class="rural-details" fill="none" stroke-linejoin="round">' + marks.map(m => `<path d="${pathD(m.line, !!m.closed)}" stroke="${style[m.kind][0]}" stroke-width="${style[m.kind][1]}"${m.kind === 'hedge' ? ' stroke-dasharray="2.4 1"' : ''}/>`).join('') + '</g>';
}
export function drawRuralDetails(ctx: CanvasRenderingContext2D, world: Pick<World, 'landuse'>, pal: Palette): void {
  if (!world.landuse) return;
  const marks = ruralDetails(world.landuse); if (!marks.length) return;
  const style = styles(pal); ctx.save(); ctx.globalAlpha = .9; ctx.lineJoin = 'round';
  for (const m of marks) {
    ctx.beginPath(); m.line.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); if (m.closed) ctx.closePath();
    ctx.strokeStyle = style[m.kind][0]; ctx.lineWidth = style[m.kind][1]; ctx.setLineDash(m.kind === 'hedge' ? [2.4, 1] : []); ctx.stroke();
  }
  ctx.restore();
}
