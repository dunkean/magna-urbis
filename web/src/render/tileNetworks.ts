import type { Point, Street } from '../../../rust/bridge/urban';
import type { CityScene, CityBuildings, CityLayers, CityLod } from './cityCanvas';
import { ROAD_RANKS, emphasisAlpha, regionalStreetRank, roadWidth, strokeNaturalRoad, type RoadInk, type RoadRank, type RoadStyle } from './roadStyle';
import { splitByPavement, type PavementSites, type RoadPavement } from './roadPavement';

const roadBounds = new WeakMap<Street, { minX: number; minY: number; maxX: number; maxY: number; pad: number }>();
export function tileRoadVisible(road: Street, box: { minX: number; minY: number; maxX: number; maxY: number }, mpp: number): boolean {
  let bounds = roadBounds.get(road);
  if (!bounds) {
    bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, pad: road.widths.reduce((n, w) => Math.max(n, w), 1) };
    for (const p of road.path) { bounds.minX = Math.min(bounds.minX, p.x); bounds.minY = Math.min(bounds.minY, p.y); bounds.maxX = Math.max(bounds.maxX, p.x); bounds.maxY = Math.max(bounds.maxY, p.y); }
    roadBounds.set(road, bounds);
  }
  const pad = bounds.pad + 4 * mpp;
  if (bounds.maxX < box.minX - pad || bounds.minX > box.maxX + pad || bounds.maxY < box.minY - pad || bounds.minY > box.maxY + pad) return false;
  // Segment/box clipping includes roads whose vertices both lie outside the tile.
  return road.path.some((b, i) => {
    if (!i) return false;
    const a = road.path[i - 1], dx = b.x - a.x, dy = b.y - a.y; let lo = 0, hi = 1;
    for (const [p, q] of [[-dx, a.x - box.minX + pad], [dx, box.maxX + pad - a.x], [-dy, a.y - box.minY + pad], [dy, box.maxY + pad - a.y]]) {
      if (!p) { if (q < 0) return false; continue; }
      const t = q / p; if (p < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t); if (lo > hi) return false;
    }
    return true;
  });
}
/** A regional road cut where its surface changes (roadPavement.ts), kept per road so that its pieces stay the same objects. */
const pavedPieces = new WeakMap<Street, { key: string; pieces: { road: Street; pavement: RoadPavement }[] }>();
function roadPieces(road: Street, sites: PavementSites): { road: Street; pavement: RoadPavement }[] {
  let entry = pavedPieces.get(road);
  if (entry?.key !== sites.key) {
    // Crossings keep their own art, tracks stay earth.
    const cut = road.role === 'regional' && road.rank <= 2 ? splitByPavement(road.path, sites) : [{ path: road.path, pavement: 'earth' as RoadPavement }];
    const pieces = cut.map(p => ({ pavement: p.pavement, road: cut.length === 1 ? road : { ...road, path: p.path as Street['path'], widths: p.path.map(() => road.widths[0] ?? 3) } }));
    pavedPieces.set(road, entry = { key: sites.key, pieces });
  }
  return entry.pieces;
}
/** Regional roads in one material tile (world transform set), with the 2D ranks and paints: `roadStyle.ts`.
 * `sites`: the settlements whose roads are paved, when the map has any. */
export function drawTileRoads(ctx: CanvasRenderingContext2D, roads: readonly Street[], box: { minX: number; minY: number; maxX: number; maxY: number }, mpp: number, style: RoadStyle = { look: 'ink', emphasis: 1, night: false }, ink?: RoadInk, sites?: PavementSites): void {
  const scale = 1 / mpp, groups = new Map<string, { rank: RoadRank; width: number; roads: Street[]; paved: boolean }>();
  const add = (road: Street, paved: boolean): void => {
    if (!tileRoadVisible(road, box, mpp)) return;
    const rank = regionalStreetRank(road.rank), mean = road.widths.reduce((sum, w) => sum + w, 0) / Math.max(1, road.widths.length);
    const width = Math.round(roadWidth(rank, mean, scale) * 4) / 4, key = paved ? `${rank}|${width}|paved` : `${rank}|${width}`;
    let group = groups.get(key); if (!group) groups.set(key, group = { rank, width, roads: [], paved });
    group.roads.push(road);
  };
  for (const road of roads) {
    if (!sites) add(road, false);
    else for (const piece of roadPieces(road, sites)) add(piece.road, piece.pavement === 'asphalt');
  }
  const ordered = [...groups.values()].sort((a, b) => ROAD_RANKS.indexOf(b.rank) - ROAD_RANKS.indexOf(a.rank));
  const trace = (target: Pick<Path2D, 'moveTo' | 'lineTo'>, roads: readonly Street[]): void => { for (const road of roads) road.path.forEach((p, i) => i ? target.lineTo(p.x, p.y) : target.moveTo(p.x, p.y)); };
  if (style.look === 'natural') { for (const g of ordered) { const path = new Path2D(); trace(path, g.roads); strokeNaturalRoad(ctx, path, g.rank, g.width, scale, g.paved ? { ...style, pavement: 'asphalt' } : style); } return; }
  const paint = ink ?? { fill: style.colors?.road ?? '#dccba5', edge: style.colors?.roadEdge ?? '#8b7c63', track: style.colors?.track ?? '#b39a72', trackAlpha: 1 }, e = emphasisAlpha(style.emphasis);
  ctx.lineJoin = ctx.lineCap = 'round';
  for (const pass of ['casing', 'fill'] as const) for (const g of ordered) {
    const track = g.rank === 'track';
    if (pass === 'casing' && track) continue;
    ctx.setLineDash(track ? [7 * mpp, 4 * mpp] : []); ctx.lineCap = track ? 'butt' : 'round';
    ctx.globalAlpha = Math.min(1, (track ? paint.trackAlpha : 1) * e);
    ctx.strokeStyle = pass === 'casing' ? paint.edge : track ? paint.track : paint.fill;
    ctx.lineWidth = (track ? Math.min(g.width, 2.2 * mpp) : g.width) + (pass === 'casing' ? 2 * Math.max(.5, .9 * mpp) * (g.rank === 'major' ? 1 : .6) * Math.max(1, style.emphasis) * (g.paved && !track ? 1.5 : 1) : 0);
    ctx.beginPath(); trace(ctx, g.roads); ctx.stroke();
  }
  // Drawn maps keep their inks: a paved trunk road carries a centre line once wide enough to hold it.
  for (const g of ordered) if (g.paved && g.rank === 'major' && g.width * scale >= 4.5) {
    ctx.setLineDash([]); ctx.lineCap = 'round'; ctx.globalAlpha = Math.min(1, .7 * e); ctx.strokeStyle = paint.edge; ctx.lineWidth = .8 * mpp;
    ctx.beginPath(); trace(ctx, g.roads); ctx.stroke();
  }
  ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.lineCap = 'round';
}

const ringBounds = new WeakMap<readonly Point[], { minX: number; minY: number; maxX: number; maxY: number }>();
/** Skip empty/off plan tiles before allocating a crisp overlay; semantics keep their cheaper resolution. */
export function cityTileHasInk(scene: CityScene, box: { minX: number; minY: number; maxX: number; maxY: number }, layers: CityLayers, lod: CityLod, buildings?: CityBuildings): boolean {
  const overlaps = (ring: readonly Point[], pad = 0): boolean => {
    let bounds = ringBounds.get(ring);
    if (!bounds) { bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }; for (const p of ring) { bounds.minX = Math.min(bounds.minX, p.x); bounds.minY = Math.min(bounds.minY, p.y); bounds.maxX = Math.max(bounds.maxX, p.x); bounds.maxY = Math.max(bounds.maxY, p.y); } ringBounds.set(ring, bounds); }
    return bounds.maxX + pad >= box.minX && bounds.minX - pad <= box.maxX && bounds.maxY + pad >= box.minY && bounds.minY - pad <= box.maxY;
  };
  if (buildings?.bins.query(box).length) return true;
  if (layers.blocks && lod === 'far' && scene.footprint.some(s => overlaps(s.outer))) return true;
  if ((layers.blocks || layers.domains) && scene.bins.blocks.query(box).length) return true;
  if ((layers.parcels || layers.gardens || layers.places || layers.domains || layers.fronts || layers.axes || layers.access) && scene.bins.parcels.query(box).length) return true;
  if (layers.streets && scene.bins.streets.query(box).some(i => scene.streets[i].rank <= (lod === 'far' ? 1 : lod === 'mid' ? 2 : 9) || ['bridge', 'ford', 'causeway', 'boardwalk', 'quay', 'mole'].includes(scene.streets[i].role))) return true;
  if (layers.streets && scene.quays?.some(q => overlaps(q.shape.outer))) return true;
  if (layers.enclosures && scene.walls.some(w => w.pieces.some(p => overlaps(p, 32)))) return true;
  if (layers.lotEnclosures !== false && lod !== 'far' && scene.lotYards?.some(y => overlaps(y.shape.outer))) return true;
  for (const layout of scene.layouts) {
    if (layers.reserve && layout.structure?.reserve.some(s => overlaps(s.outer))) return true;
    if (layers.allocated && layout.structure?.allocated.some(s => overlaps(s.outer))) return true;
    if (layers.quarters && layout.quarters.some(q => overlaps(q.shape.outer))) return true;
    if (layers.waterways !== false && (layers.streets || layers.waterways) && layout.structure?.waterways?.some(w => overlaps(w.shape.outer))) return true;
  }
  return false;
}
