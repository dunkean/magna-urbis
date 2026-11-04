import type { Layout, Partition, Point, Shape } from '../../../rust/bridge/urban';
import { buildCityScene } from '../render/cityCanvas';
import { buildYardEnclosures, type YardHouse } from '../render/cityLotEnclosures';

/** Bench layers over the real yard tracer (buildYardEnclosures): fences by material, gates, loose ends, parcel solidity. */
export interface BenchEnclosureStats { lots: number; runs: number; short: number; gates: number; loose: number; weakLots: number; houses: number }
export interface BenchEnclosureLayers { svg: string; stats: BenchEnclosureStats; error?: string }
type HouseSource = { parcel_id: string; footprint: readonly Shape[]; programme?: unknown; cluster?: string; farm?: boolean }[];

const COLOR = { wall: '#333', fence: '#b5651d', hedge: '#2f7d32' } as const;
const ring = (r: readonly Point[]): string => r.length ? 'M' + r.map(p => `${p.x},${p.y}`).join('L') + 'Z' : '';
const areaOf = (r: readonly Point[]): number => Math.abs(r.reduce((s, a, i) => { const b = r[(i + 1) % r.length]; return s + a.x * b.y - b.x * a.y; }, 0)) / 2;
function hullArea(points: readonly Point[]): number {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return 0;
  const cross = (o: Point, a: Point, b: Point): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list: Point[]): Point[] => { const h: Point[] = []; for (const q of list) { while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop(); h.push(q); } return h.slice(0, -1); };
  return areaOf([...half(p), ...half([...p].reverse())]);
}
function segDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}

export function benchEnclosureLayers(layouts: readonly Layout[], partitions: readonly Partition[] | undefined, buildings: HouseSource | undefined, show: { fences: boolean; lots: boolean }): BenchEnclosureLayers {
  const stats: BenchEnclosureStats = { lots: 0, runs: 0, short: 0, gates: 0, loose: 0, weakLots: 0, houses: buildings?.length ?? 0 };
  if (!partitions?.length) return { svg: '', stats };
  let svg = '', lots = '';
  for (const p of partitions.flatMap(q => q.parcels)) {
    if (p.shape.outer.length < 3) continue;
    stats.lots++;
    const solidity = areaOf(p.shape.outer) / (hullArea(p.shape.outer) || 1), weak = solidity < 0.8;
    if (weak) stats.weakLots++;
    if (show.lots) lots += `<path d="${ring(p.shape.outer)}${p.shape.holes.map(ring).join('')}" fill-rule="evenodd" fill="${weak ? '#f06ba8' : 'none'}" fill-opacity="${weak ? .4 : 0}" stroke="${weak ? '#c2185b' : '#3a6ea5'}" stroke-width=".18" stroke-dasharray=".8 .5"><title>solidité ${solidity.toFixed(2)}</title></path>`;
  }
  if (show.lots) svg += `<g data-bench-lots pointer-events="none">${lots}</g>`;
  let error: string | undefined;
  try {
    const scene = buildCityScene(layouts, partitions);
    const houses: YardHouse[] = (buildings ?? []).map(b => ({ parcel_id: b.parcel_id, footprint: b.footprint, cluster: b.cluster, farm: b.farm, programme: b.programme as YardHouse['programme'] }));
    const yards = buildYardEnclosures(scene, houses);
    stats.runs = yards.enclosures.length; stats.gates = yards.gates.length;
    // Loose end: a run end touching no other run, no house wall and no gate jamb.
    const segs = yards.enclosures.flatMap((e, k) => e.path.slice(1).map((b, i) => ({ a: e.path[i], b, k })));
    const walls = houses.flatMap(h => h.footprint.flatMap(s => s.outer.map((a, i) => ({ a, b: s.outer[(i + 1) % s.outer.length] }))));
    const tol = .35; let fences = '', ends = '';
    yards.enclosures.forEach((e, k) => {
      let len = 0; for (let i = 1; i < e.path.length; i++) len += Math.hypot(e.path[i].x - e.path[i - 1].x, e.path[i].y - e.path[i - 1].y);
      if (len < 2) stats.short++;
      fences += `<path d="M${e.path.map(p => `${p.x},${p.y}`).join('L')}" stroke="${COLOR[e.material]}" stroke-width=".42" fill="none"><title>${e.material} ${e.side} ${len.toFixed(1)} m</title></path>`;
      if (e.path.length < 2) return;
      for (const end of [e.path[0], e.path[e.path.length - 1]]) {
        if (segs.some(s => s.k !== k && segDistance(end, s.a, s.b) < tol) || walls.some(s => segDistance(end, s.a, s.b) < tol + .2) || yards.gates.some(g => segDistance(end, g.a, g.b) < tol)) continue;
        stats.loose++; ends += `<circle cx="${end.x}" cy="${end.y}" r=".9" fill="none" stroke="red" stroke-width=".3"/>`;
      }
    });
    if (show.fences) svg += `<g data-bench-fences pointer-events="none">${fences}${yards.gates.map(g => `<path d="M${g.a.x},${g.a.y}L${g.b.x},${g.b.y}" stroke="#e01b84" stroke-width=".7"/>`).join('')}${ends}</g>`;
  } catch (e) { error = e instanceof Error ? e.message : String(e); }
  return { svg, stats, error };
}

export function benchEnclosureStatsHtml(r: BenchEnclosureLayers | undefined): string {
  if (!r) return '';
  const s = r.stats, pct = (n: number, d: number): string => d ? `${(100 * n / d).toFixed(0)} %` : '–';
  if (r.error) return `<small style="color:#b00">Traceur en erreur : ${r.error.replace(/[<&]/g, '')}</small>`;
  return `<small>Lots ${s.lots} · tronçons ${s.runs} · &lt; 2 m ${pct(s.short, s.runs)} · portails ${s.gates} · bouts libres ${s.loose} · lots &lt; 0,8 ${pct(s.weakLots, s.lots)}${s.houses ? '' : ' · aucune maison : générer les maisons (3) pour obtenir des clôtures'}</small>`;
}
