/** Resource-model diagnostics (rust/bridge/resources.ts payload, activity sites) as world-coordinate SVG.
 * Grids become one block-resolution PNG `<image>`; deposits, anchors and sites are vector markers. */
import type { ResourceGrid } from '../../../rust/bridge/resources';
import type { ActivitySite } from '../../../rust/bridge/settlements';
import type { ResourceOverlay } from './displayDiagnostics';

type Rgb = readonly [number, number, number];
export const ROCK_COLORS: Record<string, Rgb> = {
  granite: [222, 140, 150], limestone: [238, 224, 170], sandstone: [214, 150, 70], marl: [150, 150, 70],
  basalt: [70, 72, 82], metamorphic: [150, 110, 190], ultrabasic: [60, 150, 90], evaporite: [190, 225, 240],
};
export const DRAINAGE_COLORS: readonly Rgb[] = [[0, 0, 0], [30, 60, 130], [90, 140, 200], [190, 190, 150], [235, 215, 150]];
const SOIL_DEPTH: readonly Rgb[] = [[246, 232, 190], [196, 150, 84], [92, 56, 28]];
const MOISTURE: readonly Rgb[] = [[240, 226, 180], [110, 170, 190], [20, 60, 150]];
const POTENTIAL: readonly Rgb[] = [[255, 245, 140], [150, 200, 70], [10, 90, 50]];
const ALLUVIAL: Rgb = [200, 140, 40];
const ramp = (stops: readonly Rgb[], t: number): Rgb => {
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
  return [0, 1, 2].map(c => stops[i][c] + (stops[i + 1][c] - stops[i][c]) * f) as unknown as Rgb;
};
/** Overlay opacity of a grid layer (0-255). */
const ALPHA = 190;
/** RGBA pixels (one per block, rows top to bottom) of a grid layer; sea and lakes stay transparent. */
export function resourcePixels(grid: ResourceGrid, id: ResourceOverlay, potential = 'arable'): Uint8ClampedArray {
  const size = grid.nx * grid.ny, out = new Uint8ClampedArray(size * 4);
  const fallback: Rgb = [128, 128, 128];
  const rocks = grid.rocks.map(name => ROCK_COLORS[name] ?? fallback);
  for (let k = 0; k < size; k++) {
    const w = grid.water[k];
    if (w === 1 || w === 2) continue;
    let color: Rgb | undefined, alpha = ALPHA;
    switch (id) {
      case 'res-geology': color = rocks[grid.bedrock[k]] ?? fallback; break;
      case 'res-soil-depth': color = ramp(SOIL_DEPTH, grid.value('soil_depth', k) / 3); break;
      case 'res-moisture': color = ramp(MOISTURE, grid.value('moisture', k)); break;
      case 'res-drainage': { const d = Math.round(grid.value('drainage', k)); if (d < 1) continue; color = DRAINAGE_COLORS[Math.min(4, d)]; break; }
      case 'res-alluvial': { const v = grid.value('alluvial', k); if (v <= 0.02) continue; color = ALLUVIAL; alpha = Math.round(40 + v * 190); break; }
      case 'res-potential': { const v = grid.value(potential, k); if (v <= 0.01) continue; color = ramp(POTENTIAL, v); alpha = Math.round(60 + v * 150); break; }
      default: return out;
    }
    out.set([color[0], color[1], color[2], alpha], k * 4);
  }
  return out;
}

export const DEPOSIT_COLORS: Record<string, string> = {
  bog_iron: '#8a4b2a', local_ironstone: '#b5472f', small_pb_ag: '#6b7a8f', small_sn: '#7d6fb0', small_coal: '#222222',
  salt_spring: '#3fb6c9', gypsum_quarry: '#d9d4c5', placer_au: '#e0b400', placer_sn: '#9a7fd0',
};
export const ANCHOR_COLORS: Record<string, string> = {
  quarry: '#6e6e6e', clay_pit: '#b8703c', peat_cut: '#5b3a21', mill_seat: '#2a7fd6', wind_knoll: '#8fc0e0', fishing_landing: '#1e9aa8',
  logging: '#2e7d32', charcoal: '#333333', pasture: '#8bc34a', upland_pasture: '#b7d36a', hunting: '#a0522d', salt: '#e8f4f8',
};
/** Site category of an anchor kind (colour group of the `res-sites` layer). */
export const SITE_CATEGORIES: Record<string, { category: string; color: string }> = {
  quarry: { category: 'extraction', color: '#7a5c3a' }, clay_pit: { category: 'extraction', color: '#7a5c3a' }, peat_cut: { category: 'extraction', color: '#7a5c3a' },
  mill_seat: { category: 'energy', color: '#2a7fd6' }, wind_knoll: { category: 'energy', color: '#2a7fd6' },
  fishing_landing: { category: 'water', color: '#1e9aa8' }, salt: { category: 'water', color: '#1e9aa8' },
  logging: { category: 'forest', color: '#2e7d32' }, charcoal: { category: 'forest', color: '#2e7d32' }, hunting: { category: 'forest', color: '#2e7d32' },
  pasture: { category: 'pastoral', color: '#c28a2c' }, upland_pasture: { category: 'pastoral', color: '#c28a2c' },
  network_node: { category: 'network', color: '#d0306a' },
};
/** Outline colour of an installation ground kind in the `res-sites` layer. */
const INSTALLATION_COLORS: Record<string, string> = {
  excavation: '#5c5045', mound: '#77736d', water_structure: '#3f7fa0', enclosure: '#8a6d3b', industrial_ground: '#7a4f2a',
  landing: '#9c6b30', open_surface: '#b39b4f', engineered_path: '#8d8576', terrace: '#7f7b3f', underground_work: '#6b5f52', crossing: '#7b5b3b',
};
const OTHER_SITE = { category: 'agriculture', color: '#8a4fa0' };
export const siteCategory = (kind: string): { category: string; color: string } => SITE_CATEGORIES[kind] ?? OTHER_SITE;

const num = (v: number): string => String(Math.round(v * 10) / 10);
const esc = (text: string): string => text.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
/** The block raster as an SVG `<image>` over its grid rectangle; `href` is a PNG data URL made by the caller. */
export const gridImageSvg = (grid: ResourceGrid, href: string, smooth: boolean): string =>
  `<image href="${href}" x="${num(grid.x0)}" y="${num(grid.y0)}" width="${num(grid.nx * grid.cell)}" height="${num(grid.ny * grid.cell)}" preserveAspectRatio="none" style="image-rendering:${smooth ? 'auto' : 'pixelated'}"/>`;

/** Deposit discs (size = recoverable ore) and anchor diamonds. `unit` = marker radius scale in metres. */
export function depositsSvg(grid: ResourceGrid, unit: number): string {
  let svg = `<g stroke="#ffffff" stroke-width="${num(unit / 6)}">`;
  const maxT = Math.max(1, ...grid.deposits.map(d => d.recoverable_t));
  for (const d of grid.deposits) {
    const r = unit * (0.6 + 0.9 * Math.sqrt(d.recoverable_t / maxT));
    svg += `<circle cx="${d.x}" cy="${d.y}" r="${num(r)}" fill="${DEPOSIT_COLORS[d.family] ?? '#999999'}"${d.outcrop ? '' : ' fill-opacity=".6"'}><title>${esc(d.family)}</title></circle>`;
  }
  for (const a of grid.anchors) {
    const r = unit * 0.9;
    svg += `<path d="M${a.x} ${num(a.y - r)}L${num(a.x + r)} ${a.y}L${a.x} ${num(a.y + r)}L${num(a.x - r)} ${a.y}Z" fill="${ANCHOR_COLORS[a.kind] ?? '#999999'}"><title>${esc(a.kind)} · ${esc(a.resource)}</title></path>`;
  }
  return `${svg}</g>`;
}

/** Activity sites: a marker per site (hollow = remote seasonal) and a thin line to the parent settlement; network nodes as
 * circles tied to their road point; installations as outlines coloured by ground kind. */
export function sitesSvg(sites: readonly ActivitySite[], parents: ReadonlyMap<string, { x: number; y: number }>, unit: number): string {
  let lines = `<g stroke="#3a3a3a" stroke-opacity=".55" stroke-width="${num(unit / 7)}">`, marks = `<g stroke="#ffffff" stroke-width="${num(unit / 6)}">`;
  let ground = `<g fill="none" stroke-width="${num(Math.max(1.5, unit / 8))}">`;
  for (const s of sites) {
    for (const g of s.installations ?? []) {
      if (typeof g !== 'object' || g.points.length < 2) continue;
      const d = g.points.map((p, i) => `${i ? 'L' : 'M'}${num(p.x)} ${num(p.y)}`).join('') + (g.closed ? 'Z' : '');
      ground += `<path d="${d}" stroke="${INSTALLATION_COLORS[g.kind] ?? '#777777'}"><title>${esc(g.archetype)} · ${esc(g.kind)}</title></path>`;
    }
    const parent = parents.get(s.parent), { color } = siteCategory(s.kind), seasonal = s.mode === 'remote_seasonal';
    if (s.mode === 'network_node') {
      // Network node: a circle on the road, tied to its buildings.
      lines += `<line x1="${num(s.x)}" y1="${num(s.y)}" x2="${num(s.access.x)}" y2="${num(s.access.y)}"/>`;
      marks += `<circle cx="${num(s.x)}" cy="${num(s.y)}" r="${num(unit * 1.2)}" fill="${color}"><title>${esc(s.template)} (${esc(s.resource)} · ${esc(s.parent)})</title></circle>`;
      continue;
    }
    if (parent) lines += `<line x1="${num(s.x)}" y1="${num(s.y)}" x2="${num(parent.x)}" y2="${num(parent.y)}"${seasonal ? ` stroke-dasharray="${num(unit * 1.5)} ${num(unit)}"` : ''}/>`;
    marks += `<rect x="${num(s.x - unit)}" y="${num(s.y - unit)}" width="${num(unit * 2)}" height="${num(unit * 2)}" fill="${seasonal ? '#ffffff' : color}" stroke="${seasonal ? color : '#ffffff'}"${seasonal ? ` stroke-width="${num(unit / 3)}"` : ''}><title>${esc(s.template)} (${esc(s.parent)})</title></rect>`;
  }
  return `${ground}</g>${lines}</g>${marks}</g>`;
}
