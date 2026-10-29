/** City GPU renderer — styles. Per-feature colour tables (RGBA8, straight alpha) and
 * the list of draws for one (view, level of detail, palette, layers) state. Mirrors
 * the choices of drawCity (cityCanvas.ts) so both renderers show the same plan.
 * Not ported (kept on the Canvas 2D overlay or dropped): parchment hatching, dashed
 * reserve outlines, the thicker landmark outline of the roles view (1 px here). */
import type { CityBuildings, CityLayers, CityLod, CityPalette, CityScene, CityView, CityDistrict } from './cityCanvas';
import { BUILDING_FAMILIES, DISTRICT_ROLES, districtRoleKey, roleFamily } from './cityCanvas';
import { isBoardwalk } from './cityGround';
import { STRUCTURE_ROLES, blendLine, blendTone, blendsGround, groundWash, softStreet, type WashKind } from './groundBlend';
import { urbanFunctionColor } from './urbanBuildingStyle';
import type { CityGlFillMesh } from './cityGlBuild';
import { MATERIALS, coverLayer, placeLayer, streetLayer } from './buildingMaterials';
import { planBuildingColors, planRoofColor, planShade } from './cityBuildingPalette';

export interface CityGlStyleState {
  view: CityView; lod: CityLod; palette: CityPalette; layers: CityLayers;
  buildingsVisible: boolean; diagnostic: 'none' | 'uses' | string;
  refusedParcels?: ReadonlySet<string>;
  /** Render background: painted building silhouettes (function tints, landmarks, dark edges). */
  painted?: boolean;
  /** Blended ground and streets (groundBlend.ts). */
  blended?: boolean;
}
export const DEFAULT_LAYERS: CityLayers = { reserve: false, allocated: false, centers: false, domains: true, quarters: false, blocks: true, streets: true, enclosures: true, parcels: true, gardens: true, places: true, fronts: false, axes: false, access: false };

/** Which draws a state issues. */
export interface CityGlDraws {
  footprint: boolean; footprintLines: boolean; blocks: boolean; blockLines: boolean; parcels: boolean; parcelLines: boolean;
  streets: boolean; streetCasing: boolean; walls: boolean; wallInner: boolean; towers: boolean;
  buildings: boolean; buildingLines: boolean;
  /** Paved squares (render background): the sett pass over blocks and parcels. */
  paved?: boolean;
}

const LOD_ORDER: CityLod[] = ['close', 'near', 'mid', 'far'];
const atLeast = (lod: CityLod, level: CityLod): boolean => LOD_ORDER.indexOf(lod) <= LOD_ORDER.indexOf(level);
const ZONE_COLORS: Record<string, string> = { core: '#dfb973', middle: '#bfa4ca', edge: '#91bdc5', faubourg: '#a0bc84', village: '#dfb973' };
const ATLAS = ['#dfb973', '#90bdc7', '#c5a3ce', '#a0bc84', '#d29c8e', '#bdc4d5'];
const PAPER = '#f2ead8';
const PARCH = {
  ink: '#4e3b28', inkSoft: '#5a4530', block: '#e2cf9f', lot: '#ece0bf', yard: '#e6d6a8',
  garden: '#d3cf98', place: '#ece0bf', market: '#e8d6a6', common: '#cdd097', reserve: '#d8c79a', footprint: '#d9c393',
  street: '#f4ead0', streetEdge: '#3f2f1f', bridge: '#f6edd0', ford: '#bccbc8', quay: '#e9dfc4',
  mass: '#4a3826', landmark: '#7d5f40', wall: '#3b2c1c', wallFill: '#6b5540', tower: '#4e3b28',
};

// ---------------------------------------------------------------- colour helpers
const parsed = new Map<string, number>();
/** '#rgb' / '#rrggbb' / 'rgb(r,g,b)' → 0xRRGGBB. */
export function rgb(color: string): number {
  let v = parsed.get(color);
  if (v !== undefined) return v;
  const m = /^rgba?\((\d+)\D+(\d+)\D+(\d+)/.exec(color);
  if (m) v = (+m[1] << 16) | (+m[2] << 8) | +m[3];
  else { const h = color.replace('#', ''); v = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6), 16) || 0; }
  parsed.set(color, v);
  return v;
}
function put(out: Uint8Array, i: number, color: string | undefined, alpha = 1): void {
  if (!color || alpha <= 0) { out[i * 4 + 3] = 0; return; }
  const v = rgb(color); out[i * 4] = (v >> 16) & 255; out[i * 4 + 1] = (v >> 8) & 255; out[i * 4 + 2] = v & 255; out[i * 4 + 3] = Math.round(Math.min(1, alpha) * 255);
}
function mix(a: string, b: string, t: number): string {
  const pa = rgb(a), pb = rgb(b), c = (s: number): number => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `#${((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, '0')}`;
}
const districtColor = (d: CityDistrict | undefined, fallback: string): string => {
  const base = DISTRICT_ROLES[districtRoleKey(d?.role) ?? '']?.color ?? fallback;
  return d?.wealth === undefined ? base : mix(base, PAPER, Math.max(0, 0.45 - d.wealth * 0.45));
};
/** Alpha byte 253 in a fill colour table marks a paved square: the paved pass draws its
 * setts and wear (render background, close level only). Visually opaque. */
export const PAVED_ALPHA = 253 / 255;
/** Yards and courts under painted roofs: trodden earth tinted by the district role, so
 * districts still read once the blocks are covered with roofs (near, close). */
const YARD_EARTH = '#b3a27c';
function paintedYard(d: CityDistrict | undefined, fallback: string): string { return mix(districtColor(d, fallback), YARD_EARTH, 0.45); }
export function streetPaint(role: string, rank: number, palette: CityPalette): { fill: string; casing: string } {
  if (role === 'track') { const ink = palette === 'ink' ? '#776348' : '#a58e65'; return { fill: ink, casing: ink }; }
  if (palette === 'ink') return { fill: '#6b5640', casing: '#3c3024' };
  if (isBoardwalk(role)) return { fill: '#b49a6d', casing: '#514431' };
  if (palette === 'parchment') return role === 'ford' ? { fill: PARCH.ford, casing: PARCH.ink } : role === 'bridge' ? { fill: PARCH.bridge, casing: PARCH.wall }
    : role === 'quay' ? { fill: PARCH.quay, casing: PARCH.ink } : { fill: PARCH.street, casing: PARCH.streetEdge };
  switch (role) {
    case 'bridge': return { fill: '#ddd3c2', casing: '#4d4740' };
    case 'causeway': return { fill: '#dccaa0', casing: '#76664f' };
    case 'ford': return { fill: '#b9d0d6', casing: '#6f8f9a' };
    case 'quay': return { fill: '#ddd4c2', casing: '#57534b' };
    case 'port-stairs': case 'stairs': return { fill: '#e6d5b2', casing: '#705d45' };
    case 'market': return { fill: '#f5d98f', casing: '#9a7d4f' };
    case 'collective': return { fill: '#ccdacf', casing: '#8a9a8d' };
    case 'private': return { fill: '#d9cddf', casing: '#9a8ca1' };
    default: return { fill: rank <= 1 ? '#f6e3b8' : '#f3dfb3', casing: rank <= 1 ? '#7d6648' : '#9c8664' };
  }
}

// ---------------------------------------------------------------- plan
export interface CityGlPlanColors { fill: Uint8Array; line: Uint8Array; draws: CityGlDraws }
const BUILT = new Set(['plot', 'compound', 'residual', 'court']), OPEN = new Set(['place', 'market', 'common']);

/** Colours of the plan mesh (footprint, blocks, parcels) and the draw list. */
export function planColors(scene: CityScene, mesh: Pick<CityGlFillMesh, 'layers' | 'featureCount'>, s: CityGlStyleState): CityGlPlanColors {
  const { view, lod, palette, layers } = s, parchment = palette === 'parchment';
  // Render background: district-tinted yards under the roofs, paved squares (see PAVED_ALPHA).
  const painted = !!s.painted && !parchment && palette !== 'ink' && palette !== 'terrain';
  const blend = !!s.blended && blendsGround(view, palette), tone = blendTone(palette), softLine = blendLine(tone);
  const fill = new Uint8Array(mesh.featureCount * 4), line = new Uint8Array(mesh.featureCount * 4);
  const outline = palette === 'ink' ? '#3c3024' : parchment ? PARCH.inkSoft : '#655847';
  const growth = (zone: string): string => ZONE_COLORS[zone] ?? ZONE_COLORS.core;
  const draws: CityGlDraws = { footprint: false, footprintLines: false, blocks: false, blockLines: false, parcels: false, parcelLines: false,
    streets: layers.streets, streetCasing: layers.streets, walls: layers.enclosures, wallInner: layers.enclosures && lod !== 'far', towers: layers.enclosures && lod !== 'far',
    buildings: false, buildingLines: false };
  if (layers.streets && mesh.layers.quays) (scene.quays ?? []).forEach((q, i) => {
    const f = mesh.layers.quays.features[0] + i;
    put(fill, f, q.material === 'timber' ? '#b49a6d' : '#c8c0a7');
    put(line, f, parchment ? PARCH.ink : '#57534b');
  });
  if (lod === 'far') {
    if (layers.blocks && blend) {
      const f0 = mesh.layers.footprint.features[0], w = groundWash('footprint', tone);
      for (let i = 0; i < scene.footprint.length; i++) put(fill, f0 + i, w.color, w.alpha);
      draws.footprint = true;
    } else if (layers.blocks) {
      const f0 = mesh.layers.footprint.features[0];
      for (let i = 0; i < scene.footprint.length; i++) { put(fill, f0 + i, palette === 'terrain' ? undefined : parchment ? PARCH.footprint : '#cfb589', 0.9); put(line, f0 + i, parchment ? PARCH.ink : '#7b6446', 0.9); }
      draws.footprint = palette !== 'terrain'; draws.footprintLines = true;
    }
    return { fill, line, draws };
  }
  // Blocks.
  const b0 = mesh.layers.blocks.features[0];
  const blockStroke = !(view === 'buildings' && lod !== 'close');
  scene.blocks.forEach((b, i) => {
    const reserve = b.kind.startsWith('reserve');
    if (reserve ? !layers.domains : !layers.blocks) return;
    let color: string | undefined;
    if (palette === 'terrain' && view !== 'roles') color = undefined;
    else if (reserve) color = parchment ? PARCH.reserve : '#cbc2a8';
    else if (b.kind === 'common') color = parchment ? PARCH.common : '#adc5bf';
    else if (b.kind === 'place') color = parchment ? PARCH.place : '#e8d6ae';
    else if (view === 'roles') color = districtColor(b.district, growth(b.zone));
    else if (view === 'buildings') color = parchment ? PARCH.yard : lod === 'mid' ? mix(districtColor(b.district, growth(b.zone)), PAPER, 0.35) : painted ? paintedYard(b.district, growth(b.zone)) : '#ece2cb';
    else if (palette === 'ink') color = '#e3d1b5';
    else if (parchment) color = PARCH.block;
    else color = palette === 'atlas' ? ATLAS[b.quarter % ATLAS.length] : growth(b.zone);
    if (blend && color) {
      const w = groundWash(reserve ? 'reserve' : b.kind === 'common' ? 'common' : b.kind === 'place' ? 'place' : 'block', tone);
      put(fill, b0 + i, w.color, w.alpha * (b.peripheral && view !== 'buildings' ? 0.7 : 1));
      if (lod === 'close') { put(line, b0 + i, softLine.color, softLine.alpha); draws.blockLines = true; }
      draws.blocks = true;
      return;
    }
    const paved = painted && b.kind === 'place' && lod === 'close';
    const alpha = paved ? PAVED_ALPHA : b.peripheral && view !== 'buildings' ? 0.6 : 1;
    if (paved && color) draws.paved = true;
    put(fill, b0 + i, color, alpha);
    if (blockStroke) put(line, b0 + i, outline, alpha);
    draws.blocks ||= !!color; draws.blockLines ||= blockStroke;
  });
  // Parcels.
  const p0 = mesh.layers.parcels.features[0], parcelLevel: CityLod = view === 'uses' || view === 'roles' ? 'mid' : 'near';
  if (atLeast(lod, parcelLevel) && view !== 'tissue') scene.parcels.forEach((p, i) => {
    const use = p.use, built = BUILT.has(use), open = OPEN.has(use), f = p0 + i;
    if (!(built && layers.parcels || use === 'garden' && layers.gardens || open && layers.places || use === 'reserve' && layers.domains)) return;
    const openFill = parchment ? (use === 'garden' ? PARCH.garden : use === 'reserve' ? PARCH.reserve : use === 'common' ? PARCH.common : use === 'market' ? PARCH.market : use === 'place' ? PARCH.place : undefined)
      : use === 'garden' ? '#a8bc89' : use === 'reserve' ? '#cbc2a8' : use === 'common' ? '#adc5bf' : use === 'market' ? '#ead39a' : use === 'place' ? '#e6d1a5' : undefined;
    if (blend && (view === 'parcels' || view === 'buildings')) {
      const kind: WashKind = use === 'garden' ? 'garden' : use === 'reserve' ? 'reserve' : use === 'common' ? 'common' : use === 'market' ? 'market' : use === 'place' ? 'place' : 'parcel';
      const w = groundWash(kind, tone), ground = kind === 'parcel' || kind === 'reserve';
      if (!(view === 'buildings' && ground)) put(fill, f, w.color, w.alpha * (p.peripheral ? 0.7 : 1));
      if (lod === 'close') { put(line, f, softLine.color, softLine.alpha * (ground ? 0.8 : 1)); draws.parcelLines = true; }
    } else if (view === 'parcels') {
      const color = palette === 'terrain' ? undefined : palette === 'ink' ? '#eee0c9' : parchment ? openFill ?? PARCH.lot : openFill ?? (palette === 'atlas' ? ATLAS[p.index % ATLAS.length] : growth(p.zone));
      const alpha = p.peripheral ? 0.65 : 1;
      put(fill, f, color, alpha); if (atLeast(lod, 'near')) { put(line, f, outline, alpha); draws.parcelLines = true; }
    } else if (view === 'uses') {
      if (p.allocation) { const c = urbanFunctionColor(p.allocation.function); put(fill, f, c, 0.62); put(line, f, c); draws.parcelLines = true; }
      else put(fill, f, openFill);
    } else if (view === 'roles') {
      const family = p.allocation ? roleFamily(p.allocation.role, p.allocation.function) : open ? 'commerce' : use === 'garden' ? 'garden' : undefined;
      if (family && family !== 'dwelling') put(fill, f, BUILDING_FAMILIES[family].color, p.allocation?.landmark ? 0.75 : 0.45);
      if (p.allocation?.landmark) { put(line, f, BUILDING_FAMILIES[family ?? 'civic'].color); draws.parcelLines = true; }
    } else {
      const paved = painted && lod === 'close' && !!openFill && (use === 'place' || use === 'market');
      if (openFill) put(fill, f, openFill, parchment && lod === 'close' ? 0.9 : paved ? PAVED_ALPHA : 1);
      if (paved) draws.paved = true;
      if (lod === 'close') { put(line, f, openFill ? (parchment ? PARCH.inkSoft : '#b9a98d') : parchment ? PARCH.inkSoft : '#c4b597', !parchment ? 1 : openFill ? 0.9 : 0.45); draws.parcelLines = true; }
    }
    draws.parcels = true;
  });
  if (atLeast(lod, 'near') && s.refusedParcels?.size) scene.parcels.forEach((p, i) => { if (p.id && s.refusedParcels!.has(p.id)) { put(line, p0 + i, urbanFunctionColor('refusal')); draws.parcelLines = true; } });
  draws.buildings = s.buildingsVisible && atLeast(lod, 'near') && (view === 'buildings' || view === 'roles');
  draws.buildingLines = draws.buildings && (lod === 'close' || (!!s.painted && lod === 'near'));
  return { fill, line, draws };
}

/** Colours of the building mesh (feature = item index). */
export function buildingColors(buildings: CityBuildings | undefined, s: CityGlStyleState, _scene?: CityScene): { fill: Uint8Array; line: Uint8Array } {
  const items = buildings?.items ?? [], roofs = buildings?.roofs, count = items.length + (roofs ? roofs.shapes.length + items.length : 0);
  const fill = new Uint8Array(Math.max(1, count) * 4), line = new Uint8Array(Math.max(1, count) * 4), colors: string[] = [];
  const parchment = s.palette === 'parchment', edge = parchment ? '#f1e5c6' : '#2e261d';
  const diagnostic = s.view === 'roles' || s.diagnostic === 'uses';
  const painted = !!s.painted && !parchment && s.palette !== 'ink' && !diagnostic;
  items.forEach((b, i) => {
    const tint = planBuildingColors(b, s.palette);
    const color = s.view === 'roles' ? BUILDING_FAMILIES[b.family]?.color ?? '#5a4b3c' : s.diagnostic === 'uses' ? urbanFunctionColor(b.fn)
      : roofs ? tint.wall : tint.roof;
    // Party walls: every roof keeps a dark edge, so adjoining houses of a row stay distinct.
    put(fill, i, color); put(line, i, b.stilts ? '#514431' : painted ? b.landmark ? '#e2d3a6' : '#1f1811' : edge, painted && !b.landmark ? 0.8 : 1);
    colors.push(color);
  });
  // Roof pans use the exact shared culture/material/tone, softened for ink maps.
  if (roofs) {
    for (let k = 0; k < roofs.shapes.length; k++) {
      const cover = roofs.cover[k], f = items.length + k;
      const color = diagnostic ? planShade(colors[roofs.owner[k]], roofs.light[k] * 0.5) : planRoofColor(items[roofs.owner[k]], roofs, k, s.palette);
      put(fill, f, color); put(line, f, planShade(color, -0.38), COVER_EDGE[cover] ?? 0.55);
    }
    // Shadow features are drawn with a tint; they only need to be shown.
    for (let i = 0; i < items.length; i++) put(fill, items.length + roofs.shapes.length + i, '#000000');
  }
  return { fill, line };
}
/** Painted roof of a building: the role family decides the material (tile, slate, lead,
 * stone), the district or lot wealth its warmth; monuments are a shade darker. Same
 * hues as PAINTED_BUILDINGS for houses, so plans and compact silhouettes agree. */
export function paintedRoof(family: string, fn: string, landmark: boolean, wealth?: number): string {
  // Stores keep their grey lead or board roofs whatever trade they serve (port, market).
  const base = fn === 'warehouse' && (family === 'commerce' || family === 'dwelling') ? PAINTED_BUILDINGS.warehouse
    : PAINTED_FAMILY_ROOFS[family] ?? (fn in PAINTED_BUILDINGS ? PAINTED_BUILDINGS[fn] : PAINTED_BUILDINGS.domestic);
  const w = wealth === undefined ? 0.5 : Math.max(0, Math.min(1, wealth));
  // Poor: duller, browner (thatch, old tile); rich: warmer, redder tile.
  const tinted = family === 'dwelling' || family === 'commerce' || family === 'craft' ? (w < 0.5 ? mix(base, '#7d6a52', (0.5 - w) * 0.9) : mix(base, '#a05438', (w - 0.5) * 0.5)) : base;
  return landmark ? mix(tinted, '#1d1a22', 0.18) : tinted;
}
/** Roof covers of the city massing (urban/massing.rs). */
export const ROOF_COVERS: Record<string, string> = {
  tile: '#9a5a42', slate: '#5d6470', thatch: '#9b8a5c', reed: '#a89a62', bamboo: '#9fa86a', palm: '#7f9150', shingle: '#7a5a3e', turf: '#6f8049', bark: '#6e5238',
  hide: '#b49a78', felt: '#c8bda3', earth: '#b69a72', plaster: '#c9bba0', stone: '#8a8478', snow: '#e4e8ea', metal: '#6f8d88', lead: '#7b8088',
};
/** Wall colours of the massing (seen on elevations; 2D plans only show roofs). */
export const WALL_COLORS: Record<string, string> = {
  timber: '#8a6a47', brick: '#a4573e', stone: '#9a968a', earth: '#b79c76', wood: '#9c7a52', plaster: '#d7c9a8', bamboo: '#b4b070', wattle: '#a98f69', hide: '#b9a07f', coral: '#d9c6b4',
};
/** Opacity of a pan's edge line: crisp courses (tile, shingle, slate, bamboo) read as stripes, soft ones (thatch, turf) as fuzz. */
const COVER_EDGE: Record<string, number> = { tile: 0.72, shingle: 0.72, slate: 0.68, bamboo: 0.72, metal: 0.65, thatch: 0.35, reed: 0.35, palm: 0.4, turf: 0.3, bark: 0.45, hide: 0.4, felt: 0.4, snow: 0.3 };
/** Roof hues by role family (render background). */
export const PAINTED_FAMILY_ROOFS: Record<string, string> = {
  dwelling: '#8a5c45', commerce: '#9a6c3e', craft: '#74483a', civic: '#4d5d78', worship: '#5b4b72', defence: '#57595c', garden: '#7f8461',
};
/** Painted silhouettes (Render background): warm roofs for houses, greyer stores, slate landmarks.
 * Same tints as the compact plans' painted silhouettes (urbanBuildingLod.ts). */
export const PAINTED_BUILDINGS: Record<string, string> = {
  domestic: '#8a5c45', mixed: '#93664a', workshop: '#7c6652', warehouse: '#6e6a63', collective: '#6b5a63', open_space: '#7f8461', landmark: '#4f4459',
};
/** Ground shadow of painted silhouettes: straight RGBA and world offset (metres, south-east). */
export const PAINTED_SHADOW: [number, number, number, number] = [22 / 255, 18 / 255, 10 / 255, 0.3];
/** Street colours: outer = casing, inner = fill (feature = street index). */
export function streetColors(scene: CityScene, palette: CityPalette, blended = false): { outer: Uint8Array; inner: Uint8Array } {
  const n = Math.max(1, scene.streets.length), outer = new Uint8Array(n * 4), inner = new Uint8Array(n * 4), tone = blendTone(palette);
  scene.streets.forEach((s, i) => {
    if (blended && !STRUCTURE_ROLES.has(s.role)) { const p = softStreet(s.role, s.rank, tone); put(outer, i, p.edge, p.edgeAlpha); put(inner, i, p.fill, p.alpha); return; }
    const p = streetPaint(s.role, s.rank, palette); put(outer, i, p.casing); put(inner, i, p.fill);
  });
  return { outer, inner };
}
/** Wall colours: outer stroke and the light inner line of stone walls (feature = wall index). */
export function wallColors(scene: CityScene, palette: CityPalette): { outer: Uint8Array; inner: Uint8Array; tower: [string, string] } {
  const n = Math.max(1, scene.walls.length), outer = new Uint8Array(n * 4), inner = new Uint8Array(n * 4), parchment = palette === 'parchment';
  scene.walls.forEach((w, i) => {
    const palisade = w.kind === 'palisade';
    put(outer, i, palisade ? '#72533a' : parchment ? PARCH.wall : '#4b443b');
    put(inner, i, palisade ? undefined : parchment ? PARCH.wallFill : '#b6a793');
  });
  return { outer, inner, tower: [parchment ? PARCH.tower : '#5a5248', parchment ? PARCH.wall : '#2f2a24'] };
}
export const rgba01 = (color: string, alpha = 1): [number, number, number, number] => { const v = rgb(color); return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, alpha]; };

// ---------------------------------------------------------------- textured materials
// Per-feature material tables (RGBA8, same layout as the colour tables): R = layer + 1 (0: none, keep the flat colour),
// G = roof downslope angle (0..255 → 0..2π) or street direction; B = brightness × 128, A = roof tint flag.
const matPut = (out: Uint8Array, i: number, layer: number, g: number, bright: number, roof = false): void => {
  out[i * 4] = layer < 0 ? 0 : layer + 1; out[i * 4 + 1] = g; out[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(bright * 128))); out[i * 4 + 3] = roof ? 255 : 0;
};
/** Roof pans keep their flat tint; the shader recentres texture detail around its mean. */
export function roofMaterialTable(buildings: CityBuildings | undefined, s: CityGlStyleState): Uint8Array {
  const items = buildings?.items ?? [], roofs = buildings?.roofs, n = items.length + (roofs ? roofs.shapes.length + items.length : 0), out = new Uint8Array(Math.max(1, n) * 4);
  if (!roofs || s.view === 'roles' || s.diagnostic === 'uses' || (s.palette === 'parchment' || s.palette === 'ink')) return out;
  for (let k = 0; k < roofs.shapes.length; k++) {
    const layer = coverLayer(roofs.cover[k]);
    if (layer < 0) continue;
    matPut(out, items.length + k, layer, Math.round(((roofs.dir[k] ?? 0) / (2 * Math.PI) + 1) % 1 * 255), 1, true);
  }
  return out;
}
/** Plan fills drawn textured: plazas (place / market blocks and parcels). */
export function planMaterialTable(scene: CityScene, mesh: Pick<CityGlFillMesh, 'layers' | 'featureCount'>): Uint8Array {
  const out = new Uint8Array(mesh.featureCount * 4), layer = placeLayer();
  const b0 = mesh.layers.blocks.features[0], p0 = mesh.layers.parcels.features[0];
  scene.blocks.forEach((b, i) => { if (b.kind === 'place') matPut(out, b0 + i, layer, 0, 1); });
  scene.parcels.forEach((p, i) => { if (p.use === 'place' || p.use === 'market') matPut(out, p0 + i, layer, 0, 1); });
  return out;
}
/** Street surfaces by role and rank; planks (timber decks) run along the street. */
export function streetMaterialTable(scene: CityScene): Uint8Array {
  const out = new Uint8Array(Math.max(1, scene.streets.length) * 4);
  // Narrow bridges are timber decks (planks along the span); wider ones are stone paving.
  scene.streets.forEach((st, i) => { const planks = isBoardwalk(st.role) || st.role === 'bridge' && st.width < 4, layer = planks ? MATERIALS.road.bridge_timber : streetLayer(st.role, st.rank); matPut(out, i, layer, planks ? 1 : 0, 1); });
  return out;
}
