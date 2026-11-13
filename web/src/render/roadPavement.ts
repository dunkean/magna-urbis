/** The road surface of a place, shared by every road painter (roadStyle.ts, canvas.ts, tileNetworks.ts, cityCanvas.ts):
 * trodden earth and gravel, or asphalt. It is display only: paths, widths and ranks are never touched.
 *
 * The rule, from data:
 * - a culture is paved by its `era` when the engine sends one, else by the table below;
 * - a town street follows the culture of the `streets` facet of its quarter in the town's style sheet (quarter, then
 *   growth zone, then whole place; the heaviest culture of the mix), else the town's culture;
 * - a regional road follows, point by point, the nearest settlement: it changes surface half-way between a paved
 *   town and an unpaved one. Tracks and paths stay earth everywhere.
 * With no paved culture on the map every function answers 'earth' without any work, so nothing changes. */
import { cultureEra } from '../gen/options';
import type { Layout, Point } from '../../../rust/bridge/urban';
import type { StyleMix, StyleSheet } from '../../../rust/bridge/urbanConfig';

export type RoadPavement = 'earth' | 'asphalt';

/** Surface by era of a culture: the place's own `era` where it carries one, else the culture's (gen/options cultureEra). */
const ERA_PAVEMENT: Readonly<Record<string, RoadPavement>> = { modern: 'asphalt', contemporary: 'asphalt', futuristic: 'asphalt' };
/** Surface by culture id, until every culture carries an era. The only place to list a paved culture. */
const CULTURE_PAVEMENT: Readonly<Record<string, RoadPavement>> = { 'american-grid': 'asphalt' };

/** Surface of the roads a culture builds. */
export const culturePavement = (culture: string | undefined, era?: string): RoadPavement =>
  ERA_PAVEMENT[era ?? cultureEra(culture) ?? ''] || (culture && CULTURE_PAVEMENT[culture]) || 'earth';

/** A settlement as the regional roads see it. */
export interface PavementSite { x: number; y: number; pavement: RoadPavement }
/** The settlements of a map, or undefined when none of them is paved. `key` identifies the set. */
export interface PavementSites { key: string; sites: readonly PavementSite[] }
type Place = { center: { x: number; y: number }; culture?: string; era?: string };
export function pavementSites(places: readonly Place[]): PavementSites | undefined {
  const sites = places.map(p => ({ x: p.center.x, y: p.center.y, pavement: culturePavement(p.culture, p.era) }));
  if (!sites.some(s => s.pavement !== 'earth')) return undefined;
  return { key: sites.map(s => `${Math.round(s.x)},${Math.round(s.y)},${s.pavement}`).join(';'), sites };
}
const layoutSites = new WeakMap<readonly Layout[], PavementSites | null>();
/** The sites of the generated towns (3D view, benches). */
export function layoutPavementSites(layouts: readonly Layout[] | undefined): PavementSites | undefined {
  if (!layouts?.length) return undefined;
  let sites = layoutSites.get(layouts);
  if (sites === undefined) layoutSites.set(layouts, sites = pavementSites(layouts as readonly (Layout & { era?: string })[]) ?? null);
  return sites ?? undefined;
}
/** Surface of a regional road at one point: that of the nearest settlement. */
export function pavementAt(sites: PavementSites | undefined, x: number, y: number): RoadPavement {
  if (!sites) return 'earth';
  let best = Infinity, out: RoadPavement = 'earth';
  for (const s of sites.sites) { const d = (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y); if (d < best) { best = d; out = s.pavement; } }
  return out;
}
/** A path cut where its surface changes. One piece, the path itself, when the map has no paved settlement. */
export function splitByPavement<P extends { x: number; y: number }>(path: readonly P[], sites: PavementSites | undefined): { path: readonly P[]; pavement: RoadPavement }[] {
  if (!sites || path.length < 2) return [{ path, pavement: 'earth' }];
  const out: { path: P[]; pavement: RoadPavement }[] = [];
  let pavement = pavementAt(sites, path[0].x, path[0].y), piece: P[] = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const b = path[i], next = pavementAt(sites, b.x, b.y);
    if (next !== pavement) {
      // The change lies on this segment: a few bisections place it.
      let lo = 0, hi = 1; const a = path[i - 1];
      for (let k = 0; k < 7; k++) { const t = (lo + hi) / 2; if (pavementAt(sites, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t) === pavement) lo = t; else hi = t; }
      const cut = { ...a, x: a.x + (b.x - a.x) * hi, y: a.y + (b.y - a.y) * hi };
      piece.push(cut); out.push({ path: piece, pavement });
      piece = [cut]; pavement = next;
    }
    piece.push(b);
  }
  out.push({ path: piece, pavement });
  return out;
}

const heaviest = (mix: StyleMix | undefined): string | undefined => {
  let best: string | undefined, weight = 0;
  for (const s of mix?.styles ?? []) if (s.culture && s.weight > weight) { best = s.culture; weight = s.weight; }
  return best;
};
const inRing = (ring: readonly Point[], x: number, y: number): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a.y > y !== b.y > y && x < a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y)) inside = !inside;
  }
  return inside;
};
const streetPavements = new WeakMap<Layout, readonly RoadPavement[] | null>();
/** Surface of each street of a town, by street index; undefined when the town paves nothing. Computed once per layout. */
export function layoutStreetPavements(layout: Layout | undefined): readonly RoadPavement[] | undefined {
  if (!layout) return undefined;
  let out = streetPavements.get(layout);
  if (out !== undefined) return out ?? undefined;
  const era = (layout as { era?: string }).era, own = culturePavement(layout.culture, era);
  const facet = (layout.config as { styleSheet?: StyleSheet } | undefined)?.styleSheet?.streets;
  const ofMix = (mix: StyleMix | undefined): RoadPavement | undefined => { const c = heaviest(mix); return c ? culturePavement(c) : undefined; };
  const city = ofMix(facet?.city) ?? own;
  const quarters = layout.quarters.map((q, i) => ofMix(facet?.quarters?.[String(i)]) ?? ofMix(q.zone ? facet?.zones?.[q.zone] : undefined) ?? city);
  if (city === 'earth' && quarters.every(p => p === 'earth')) out = null;
  else if (quarters.every(p => p === city)) out = layout.streets.map(() => city);
  else out = layout.streets.map(s => {
    // A street belongs to the quarter that holds its middle.
    const a = s.path[(s.path.length - 1) >> 1], b = s.path[s.path.length >> 1]; if (!a || !b) return city;
    const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2, q = layout.quarters.findIndex(k => inRing(k.shape.outer, x, y));
    return q < 0 ? city : quarters[q];
  });
  streetPavements.set(layout, out);
  return out ?? undefined;
}
