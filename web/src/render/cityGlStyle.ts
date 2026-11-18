/** City GPU renderer — styles. Per-feature colour tables (RGBA8, straight alpha) and
 * the list of draws for one (view, level of detail, palette, layers) state. Mirrors
 * the choices of drawCity (cityCanvas.ts) so both renderers show the same plan.
 * Not ported (kept on the Canvas 2D overlay or dropped): parchment hatching, dashed
 * reserve outlines, the thicker landmark outline of the roles view (1 px here). */
import type { CityBuilding, CityBuildings, CityLayers, CityLod, CityPalette, CityScene, CityView, CityDistrict } from './cityCanvas';
import { BUILDING_FAMILIES, DISTRICT_ROLES, castShadowFill, districtRoleKey, roleFamily, tintedWall, weatheredRoof } from './cityCanvas';
import { isBoardwalk } from './cityGround';
import { STRUCTURE_ROLES, blendLine, blendTone, blendsGround, softStreet, type WashKind } from './groundBlend';
import { streetToneAt, washAt } from './groundTone';
import { urbanFunctionColor } from './urbanBuildingStyle';
import type { CityGlFillMesh } from './cityGlBuild';
import type { RenderColors } from './customColors';
import { MATERIALS, coverLayer, placeLayer, streetLayer } from './buildingMaterials';
import { planBuildingColors, planRoofColor, planShade, roofRelief } from './cityBuildingPalette';
import { mapGroundSnow } from './seasonPalette';
import { naturalMarks, pavedRank, pavedTone, quayFill, roadToneAt, streetRank, type RoadStyle } from './roadStyle';
import { groundRoadLook, type RoadLook } from './composition';
import { layoutStreetPavements } from './roadPavement';
import { planPanLight } from './roofPlaneLight';
import { harbourPaint, harbourShown } from './harbourStyle';
import { funeraryLandFill } from './cityRoles';

export interface CityGlStyleState {
  view: CityView; lod: CityLod; palette: CityPalette; layers: CityLayers;
  buildingStyle?: 'geometric' | 'cartographic' | 'silhouette';
  buildingsVisible: boolean; diagnostic: 'none' | 'uses' | string;
  refusedParcels?: ReadonlySet<string>;
  /** Render background: painted building silhouettes (function tints, landmarks, dark edges). */
  painted?: boolean;
  /** Blended ground and streets (groundBlend.ts). */
  blended?: boolean;
  /** Custom display colours (road, roadEdge, track, building, buildingEdge), as in drawCity. */
  colors?: RenderColors;
  /** Live look (live compositor, cityGl `live`): colours of the Canvas 2D path where they differ from the GL plan. */
  live?: CityGlLiveLook;
}
/** What the live look needs from the appearance besides the plan state: the road look and its emphasis. */
export interface CityGlLiveLook { roadLook: RoadLook; emphasis: number; /** Canal water (townWaterColour). */ waterColor?: string }
export const DEFAULT_LAYERS: CityLayers = { reserve: false, allocated: false, centers: false, domains: true, quarters: false, blocks: true, streets: true, enclosures: true, parcels: true, gardens: true, places: true, fronts: false, axes: false, access: false };

/** Which draws a state issues. */
export interface CityGlDraws {
  footprint: boolean; footprintLines: boolean; blocks: boolean; blockLines: boolean; parcels: boolean; parcelLines: boolean;
  streets: boolean; streetCasing: boolean; walls: boolean; wallInner: boolean; towers: boolean;
  buildings: boolean; buildingLines: boolean;
  /** Paved squares (render background): the sett pass over blocks and parcels. */
  paved?: boolean;
  /** Live look: the parchment hatching pass (blocks, far footprint) and the canals. */
  hatch?: boolean; waterways?: boolean;
}

const LOD_ORDER: CityLod[] = ['close', 'near', 'mid', 'far'];
const atLeast = (lod: CityLod, level: CityLod): boolean => LOD_ORDER.indexOf(lod) <= LOD_ORDER.indexOf(level);
const ZONE_COLORS: Record<string, string> = { core: '#dfb973', middle: '#bfa4ca', edge: '#91bdc5', faubourg: '#a0bc84', village: '#dfb973' };
const ATLAS = ['#dfb973', '#90bdc7', '#c5a3ce', '#a0bc84', '#d29c8e', '#bdc4d5'];
const PAPER = '#f2ead8';
const PARCH = {
  ink: '#4e3b28', inkSoft: '#5a4530', block: '#e2cf9f', lot: '#ece0bf', yard: '#e6d6a8',
  garden: '#d3cf98', place: '#d5cdb7', market: '#d9c9a1', common: '#cdd097', reserve: '#d8c79a', footprint: '#d9c393',
  street: '#ebdeba', streetEdge: '#5e4a34', bridge: '#ece0bc', ford: '#bccbc8', quay: '#dccfa8',
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
  if (role === 'mole') return { fill: quayFill('stone'), casing: '#2b2015' };   // stone port works: dark outline, legible zoomed out
  if (palette === 'ink') return { fill: '#6b5640', casing: '#3c3024' };
  if (isBoardwalk(role)) return { fill: '#b49a6d', casing: '#514431' };
  if (palette === 'parchment') return role === 'ford' ? { fill: PARCH.ford, casing: PARCH.ink } : role === 'bridge' ? { fill: PARCH.bridge, casing: PARCH.wall }
    : { fill: PARCH.street, casing: PARCH.streetEdge };
  switch (role) {
    case 'bridge': return { fill: '#ddd3c2', casing: '#4d4740' };
    case 'causeway': return { fill: '#dccaa0', casing: '#76664f' };
    case 'ford': return { fill: '#b9d0d6', casing: '#6f8f9a' };
    case 'port-stairs': case 'stairs': return { fill: '#e6d5b2', casing: '#705d45' };
    case 'market': return { fill: '#f5d98f', casing: '#9a7d4f' };
    case 'collective': return { fill: '#ccdacf', casing: '#8a9a8d' };
    case 'private': return { fill: '#d9cddf', casing: '#9a8ca1' };
    default: return { fill: rank <= 1 ? '#f6e3b8' : '#f3dfb3', casing: rank <= 1 ? '#7d6648' : '#9c8664' };
  }
}

// ---------------------------------------------------------------- plan
/** Hatching of the parchment plan (drawCitySteps hatchPattern): ink lines along x + y = const every 7 CSS px, 0.8 px
 * wide, at 0.42; blocks at half strength in the buildings view, the far footprint in full. */
export const PARCHMENT_HATCH = { color: '#6b5236', alpha: .42, periodPx: 7, widthPx: .8 } as const;
export interface CityGlPlanColors { fill: Uint8Array; line: Uint8Array; draws: CityGlDraws; /** Live look: hatch alpha per feature (A byte), or none. */ hatch?: Uint8Array }
const BUILT = new Set(['plot', 'compound', 'residual', 'court']), OPEN = new Set(['place', 'market', 'common']);
/** Features coloured between two pauses of the resumable colour tables. */
const COLOR_STEP = 512;
/** Runs resumable colour steps to their end. */
function finish<T>(steps: Generator<void, T>): T { for (;;) { const r = steps.next(); if (r.done) return r.value; } }

/** Colours of the plan mesh (footprint, blocks, parcels, quays, canals) and the draw list. */
export const planColors = (scene: CityScene, mesh: Pick<CityGlFillMesh, 'layers' | 'featureCount'>, s: CityGlStyleState): CityGlPlanColors => finish(planColorsSteps(scene, mesh, s));
/** `planColors` in resumable steps (live compositor: a few milliseconds per call between frames). */
export function* planColorsSteps(scene: CityScene, mesh: Pick<CityGlFillMesh, 'layers' | 'featureCount'>, s: CityGlStyleState): Generator<void, CityGlPlanColors> {
  const { view, lod, palette, layers } = s, parchment = palette === 'parchment';
  // Render background: district-tinted yards under the roofs, paved squares (see PAVED_ALPHA).
  const footprint = s.buildingStyle === 'silhouette';
  const painted = !footprint && !!s.painted && !parchment && palette !== 'ink' && palette !== 'terrain';
  const blend = !!s.blended && blendsGround(view, palette), tone = blendTone(palette), softLine = blendLine(tone);
  const fill = new Uint8Array(mesh.featureCount * 4), line = new Uint8Array(mesh.featureCount * 4);
  // Live look: the parchment hatching (drawCitySteps: parchment, by day, not blended).
  const hatch = s.live && parchment && !blend ? new Uint8Array(mesh.featureCount * 4) : undefined;
  const outline = palette === 'ink' ? '#3c3024' : parchment ? PARCH.inkSoft : '#655847';
  const growth = (zone: string): string => ZONE_COLORS[zone] ?? ZONE_COLORS.core;
  const draws: CityGlDraws = { footprint: false, footprintLines: false, blocks: false, blockLines: false, parcels: false, parcelLines: false,
    streets: layers.streets, streetCasing: layers.streets, walls: layers.enclosures, wallInner: layers.enclosures && lod !== 'far', towers: layers.enclosures && lod !== 'far',
    buildings: false, buildingLines: false };
  if (layers.streets && mesh.layers.quays) (scene.quays ?? []).forEach((q, i) => {
    const f = mesh.layers.quays.features[0] + i;
    // Harbour platforms and furniture (harbourStyle.ts, shared with drawCity and the 3D city); small furniture on close views only.
    if (!harbourShown(q.kind, lod)) { put(fill, f, undefined); put(line, f, undefined); return; }
    const paint = harbourPaint(q.kind, q.material, parchment, parchment ? PARCH.ink : '#57534b');
    put(fill, f, paint.fill, paint.fillAlpha); put(line, f, paint.line, paint.lineAlpha);
  });
  // Live look: the canals over the town ground (drawCityWaterways), with their bridges and lock gates.
  if (s.live && layers.waterways !== false && (layers.streets || layers.waterways) && mesh.layers.waterways) {
    const w = mesh.layers.waterways, b = mesh.layers.waterwayBridges;
    for (let f = w.features[0]; f < w.features[1]; f++) put(fill, f, s.live.waterColor ?? '#8aaeb8');
    if (b) for (let f = b.features[0]; f < b.features[1]; f++) { put(fill, f, '#e6d9bb'); put(line, f, '#6d6554'); }
    draws.waterways = w.features[1] > w.features[0] || !!b && b.features[1] > b.features[0];
  }
  if (lod === 'far') {
    if (layers.blocks && blend) {
      const f0 = mesh.layers.footprint.features[0];
      for (let i = 0; i < scene.footprint.length; i++) { const w = washAt('footprint', tone, scene.footprint[i]); put(fill, f0 + i, w.color, w.alpha); if ((i + 1) % COLOR_STEP === 0) yield; }
      draws.footprint = true;
    } else if (layers.blocks) {
      const f0 = mesh.layers.footprint.features[0];
      for (let i = 0; i < scene.footprint.length; i++) {
        put(fill, f0 + i, palette === 'terrain' ? undefined : parchment ? PARCH.footprint : '#cfb589', 0.9); put(line, f0 + i, parchment ? PARCH.ink : '#7b6446', 0.9);
        if (hatch) put(hatch, f0 + i, PARCHMENT_HATCH.color);
      }
      draws.footprint = palette !== 'terrain'; draws.footprintLines = true; draws.hatch = !!hatch && scene.footprint.length > 0;
    }
    return { fill, line, draws, hatch };
  }
  // Blocks.
  const b0 = mesh.layers.blocks.features[0];
  const blockStroke = !(view === 'buildings' && lod !== 'close');
  for (let i = 0; i < scene.blocks.length; i++) {
    if ((i + 1) % COLOR_STEP === 0) yield;
    const b = scene.blocks[i], reserve = b.kind.startsWith('reserve');
    if (reserve ? !layers.domains : !layers.blocks) continue;
    // A culture without lot limits (`hideLotLines`: catalogue `render.plotLines: false`, e.g. a myconid colony) outlines no block either; squares keep their edge.
    const blockLine = layers.planLines !== false && (b.kind === 'place' || b.kind === 'common' || !scene.enclosureProfiles?.[b.layout]?.hideLotLines);
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
      const w = washAt(reserve ? 'reserve' : b.kind === 'common' ? 'common' : b.kind === 'place' ? 'place' : 'block', tone, b.shape);
      put(fill, b0 + i, w.color, w.alpha * (b.peripheral && view !== 'buildings' ? 0.7 : 1));
      if (lod === 'close' && blockLine) { put(line, b0 + i, softLine.color, softLine.alpha); draws.blockLines = true; }
      draws.blocks = true;
      continue;
    }
    const paved = painted && b.kind === 'place' && lod === 'close';
    const alpha = paved ? PAVED_ALPHA : b.peripheral && view !== 'buildings' ? 0.6 : 1;
    if (paved && color) draws.paved = true;
    put(fill, b0 + i, color, alpha);
    const square = blockLine && parchment && b.kind === 'place' && !blockStroke;   // V1 squares keep a thin edge at every zoom
    if (blockStroke && blockLine) put(line, b0 + i, outline, alpha); else if (square) put(line, b0 + i, PARCH.inkSoft, 0.7);
    draws.blocks ||= !!color; draws.blockLines ||= blockStroke && blockLine || square;
    // Built blocks hatched in ink, as on the engraved plans (drawCitySteps: half strength in the buildings view).
    if (hatch && !reserve && b.kind !== 'common' && b.kind !== 'place' && view !== 'roles') { put(hatch, b0 + i, PARCHMENT_HATCH.color, view === 'buildings' ? .5 : 1); draws.hatch = true; }
  }
  // Parcels.
  const p0 = mesh.layers.parcels.features[0], parcelLevel: CityLod = view === 'uses' || view === 'roles' ? 'mid' : 'near';
  if (layers.parcelOverlay !== false && atLeast(lod, parcelLevel) && view !== 'tissue') for (let i = 0; i < scene.parcels.length; i++) {
    if ((i + 1) % COLOR_STEP === 0) yield;
    const p = scene.parcels[i], use = p.use, built = BUILT.has(use), open = OPEN.has(use), f = p0 + i;
    // A culture without lot limits (`hideLotLines`) leaves its lots unoutlined; squares keep their edge.
    const lotLine = layers.planLines !== false && (open || !scene.enclosureProfiles?.[p.layout]?.hideLotLines);
    if (!(built && layers.parcels || use === 'garden' && layers.gardens || open && layers.places || use === 'reserve' && layers.domains)) continue;
    const burialFill = funeraryLandFill(p.allocation?.role);
    const openFill = burialFill ?? (parchment ? (use === 'garden' ? PARCH.garden : use === 'reserve' ? PARCH.reserve : use === 'common' ? PARCH.common : use === 'market' ? PARCH.market : use === 'place' ? PARCH.place : undefined)
      : use === 'garden' ? '#a8bc89' : use === 'reserve' ? '#cbc2a8' : use === 'common' ? '#adc5bf' : use === 'market' ? '#ead39a' : use === 'place' ? '#e6d1a5' : undefined);
    if (blend && (view === 'parcels' || view === 'buildings')) {
      const kind: WashKind = use === 'garden' ? 'garden' : use === 'reserve' ? 'reserve' : use === 'common' ? 'common' : use === 'market' ? 'market' : use === 'place' ? 'place' : 'parcel';
      const w = washAt(kind, tone, p.shape), ground = kind === 'parcel' || kind === 'reserve';
      if (!(view === 'buildings' && ground)) put(fill, f, burialFill ?? w.color, burialFill ? 0.85 : w.alpha * (p.peripheral ? 0.7 : 1));
      if (lod === 'close' && lotLine) { put(line, f, softLine.color, softLine.alpha * (ground ? 0.8 : 1)); draws.parcelLines = true; }
    } else if (view === 'parcels') {
      const color = palette === 'terrain' ? undefined : palette === 'ink' ? '#eee0c9' : parchment ? openFill ?? PARCH.lot : openFill ?? (palette === 'atlas' ? ATLAS[p.index % ATLAS.length] : growth(p.zone));
      const alpha = p.peripheral ? 0.65 : 1;
      put(fill, f, color, alpha); if (atLeast(lod, 'near') && lotLine) { put(line, f, outline, alpha); draws.parcelLines = true; }
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
      if (lod === 'close' && lotLine) { put(line, f, openFill ? (parchment ? PARCH.inkSoft : '#b9a98d') : parchment ? PARCH.inkSoft : '#c4b597', !parchment ? 1 : openFill ? 0.9 : 0.45); draws.parcelLines = true; }
      else if (lotLine && parchment && openFill && (use === 'place' || use === 'market')) { put(line, f, PARCH.inkSoft, 0.7); draws.parcelLines = true; }
    }
    draws.parcels = true;
  }
  if (layers.parcelOverlay !== false && layers.planLines !== false && atLeast(lod, 'near') && s.refusedParcels?.size) scene.parcels.forEach((p, i) => { if (p.id && s.refusedParcels!.has(p.id)) { put(line, p0 + i, urbanFunctionColor('refusal')); draws.parcelLines = true; } });
  draws.buildings = s.buildingsVisible && (s.buildingStyle === 'silhouette' || atLeast(lod, 'near')) && (view === 'buildings' || view === 'roles');
  draws.buildingLines = draws.buildings && (s.buildingStyle === 'silhouette' || atLeast(lod, 'near'));
  return { fill, line, draws, hatch };
}

/** Colours of the building mesh (feature = item index). */
export const buildingColors = (buildings: CityBuildings | undefined, s: CityGlStyleState, scene?: CityScene): { fill: Uint8Array; line: Uint8Array } => finish(buildingColorsSteps(buildings, s, scene));
/** `buildingColors` in resumable steps. */
export function* buildingColorsSteps(buildings: CityBuildings | undefined, s: CityGlStyleState, _scene?: CityScene): Generator<void, { fill: Uint8Array; line: Uint8Array }> {
  const items = buildings?.items ?? [], roofs = buildings?.roofs, count = items.length + (roofs ? roofs.shapes.length + items.length : 0);
  const fill = new Uint8Array(Math.max(1, count) * 4), line = new Uint8Array(Math.max(1, count) * 4), colors: string[] = [];
  const parchment = s.palette === 'parchment', edge = s.buildingStyle === 'silhouette' && parchment ? '#f1e5c6' : '#2e261d';
  const diagnostic = s.view === 'roles' || s.diagnostic === 'uses';
  const footprint = s.buildingStyle === 'silhouette';
  const painted = !footprint && !!s.painted && !parchment && s.palette !== 'ink' && !diagnostic;
  for (let i = 0; i < items.length; i++) {
    if ((i + 1) % COLOR_STEP === 0) yield;
    const b = items[i], tint = planBuildingColors(b, footprint ? 'terrain' : s.palette);
    const color = s.view === 'roles' ? BUILDING_FAMILIES[b.family]?.color ?? '#5a4b3c' : s.diagnostic === 'uses' ? urbanFunctionColor(b.fn)
      : s.colors?.building ?? (footprint ? tint.roof : roofs ? s.live ? tintedWall(tint.wall, b.material?.tint, s.palette, b.material?.wall) : tint.wall : tint.roof);
    // Party walls: every roof keeps a dark edge, so adjoining houses of a row stay distinct.
    put(fill, i, color); put(line, i, !footprint && b.stilts ? '#514431' : s.colors?.buildingEdge ? s.colors.buildingEdge : painted ? b.landmark ? '#e2d3a6' : '#1f1811' : edge, painted && !b.landmark ? 0.8 : 1);
    colors.push(color);
  }
  // Live look: the pans as drawPlanRoofsSteps (cityCanvas.ts) colours them.
  if (roofs && s.live && !diagnostic) yield* liveRoofColors(items, roofs, s, fill, line);
  // Roof pans use the exact shared culture/material/tone, softened for ink maps.
  else if (roofs) {
    for (let k = 0; k < roofs.shapes.length; k++) {
      if ((k + 1) % COLOR_STEP === 0) yield;
      const cover = roofs.cover[k], f = items.length + k;
      const color = diagnostic ? planShade(colors[roofs.owner[k]], roofs.light[k] * 0.5) : s.colors?.building
        ? planRoofColor(items[roofs.owner[k]], roofs, k, s.palette, s.colors.building)
        : planRoofColor(items[roofs.owner[k]], roofs, k, s.palette);
      put(fill, f, color); put(line, f, '#30271f', roofs.snow?.[k] ? 0 : Math.max(.6, COVER_EDGE[cover] ?? .55));
    }
    // Every relief roof casts a short, height-derived ground shadow.
    for (let i = 0; i < items.length; i++) put(fill, items.length + roofs.shapes.length + i, '#000000', 1);
  }
  return { fill, line };
}

// ---------------------------------------------------------------- live look (Canvas 2D colours on the GPU)
// The colour rules of the Canvas town (cityCanvas.ts weatheredRoof, tintedWall, castShadowFill), shared so that the live
// layer matches it while the view moves (the exact Canvas frame replaces it at rest).
/** Roof pans as drawPlanRoofsSteps colours them by day: on a natural ground (terrain palette) the capped pan light, the
 * cover and its weathering; elsewhere the shared plan colour. Snow patches show only with snow on the ground. Pan edges
 * take the Canvas ink at about the coverage of its sub-pixel stroke. No grain, no rims, no uneven snow. */
function* liveRoofColors(items: readonly CityBuilding[], roofs: NonNullable<CityBuildings['roofs']>, s: CityGlStyleState, fill: Uint8Array, line: Uint8Array): Generator<void, void> {
  const custom = s.diagnostic === 'none' ? s.colors?.building : undefined, parchment = s.palette === 'parchment';
  const natural = s.palette === 'terrain' && !custom && s.diagnostic === 'none';
  const edge = parchment ? '#2c2117' : '#1f1811', edgeAlpha = (parchment ? .65 : natural ? .45 : .65) * .6;
  for (let k = 0; k < roofs.shapes.length; k++) {
    if ((k + 1) % COLOR_STEP === 0) yield;
    const item = items[roofs.owner[k]], f = items.length + k;
    if (!item) { put(fill, f, undefined); put(line, f, undefined); continue; }
    const ground = mapGroundSnow(item.snowAltitude ?? item.building.ground_z_m);
    if (roofs.patch?.[k] && !ground) { put(fill, f, undefined); put(line, f, undefined); continue; }
    const snowed = !!(roofs.snow?.[k] && ground), cover = roofs.cover[k], light = roofs.light[k];
    const base = natural && !roofs.flat?.[k] && !snowed
      ? planShade(planBuildingColors(item, s.palette, cover, roofs.wall?.[k], roofs.tone[k]).roof, planPanLight(light, cover))
      : planRoofColor(item, roofs, k, s.palette, custom);
    put(fill, f, natural && !roofs.snow?.[k] ? weatheredRoof(base, light, item.age ?? .5, cover) : base);
    put(line, f, edge, roofs.snow?.[k] ? 0 : edgeAlpha);
  }
  for (let i = 0; i < items.length; i++) put(fill, items.length + roofs.shapes.length + i, '#000000', 1);
}
const shadowTints = new Map<string, [number, number, number, number]>();
/** cityCanvas castShadowFill by day as a straight RGBA tint (snow of the first building's ground, as the Canvas town
 * shadow pass reads it). */
export function liveShadowTint(palette: CityPalette, first: CityBuilding | undefined): [number, number, number, number] {
  const css = castShadowFill(palette, false, first?.snowAltitude);
  let tint = shadowTints.get(css);
  if (!tint) {
    const m = /rgba?\((\d+)\D+(\d+)\D+(\d+)(?:\D+([\d.]+))?/.exec(css);
    tint = m ? [+m[1] / 255, +m[2] / 255, +m[3] / 255, m[4] === undefined ? 1 : +m[4]] : [0, 0, 0, .3];
    shadowTints.set(css, tint);
  }
  return tint;
}
/** Base colour of a street on a natural ground (live look): the road tone of the ground at the street's middle, the
 * paved tone for asphalt town streets, the shoulder of naturalMarks as casing; at 1 px per metre, without marks. */
function liveNaturalStreet(scene: CityScene, s: CityScene['streets'][number], live: CityGlLiveLook, custom: RenderColors | undefined): { fill: string; alpha: number; edge?: string; edgeAlpha: number } {
  const rank = streetRank(s.role, s.rank), path = s.street.path, mid = path[path.length >> 1] ?? { x: 0, y: 0 };
  const style: RoadStyle = { look: live.roadLook === 'rendered' ? 'rendered' : 'natural', emphasis: live.emphasis, night: false, colors: custom };
  const tone = roadToneAt(mid.x, mid.y, rank, style);
  if (pavedRank(rank, layoutStreetPavements(scene.layouts[s.layout])?.[s.index])) {
    const v = rgb(tone), paved = pavedTone([(v >> 16) & 255, (v >> 8) & 255, v & 255], rank, live.emphasis, false);
    return { fill: custom?.road ?? `rgb(${Math.round(paved[0])},${Math.round(paved[1])},${Math.round(paved[2])})`, alpha: Math.max(.5, Math.min(1, .96 * (.5 + .5 * live.emphasis))), edgeAlpha: 0 };
  }
  const marks = naturalMarks(rank, s.width, 1, style), shoulder = marks.shadow;
  return { fill: tone, alpha: marks.bed.alpha, edge: shoulder?.color, edgeAlpha: shoulder ? shoulder.alpha * .8 : 0 };
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
export const PAINTED_SHADOW: [number, number, number, number] = [0, 0, 0, 0.3];
/** Parchment ground shadow of flat-roofed buildings: a light sepia wash (straight RGBA). */
export const PARCHMENT_SHADOW: [number, number, number, number] = [0, 0, 0, 0.2];
/** Street colours: outer = casing, inner = fill (feature = street index). */
export const streetColors = (scene: CityScene, palette: CityPalette, blended = false, custom?: RenderColors, live?: CityGlLiveLook): { outer: Uint8Array; inner: Uint8Array } =>
  finish(streetColorsSteps(scene, palette, blended, custom, live));
/** `streetColors` in resumable steps. */
export function* streetColorsSteps(scene: CityScene, palette: CityPalette, blended = false, custom?: RenderColors, live?: CityGlLiveLook): Generator<void, { outer: Uint8Array; inner: Uint8Array }> {
  const n = Math.max(1, scene.streets.length), outer = new Uint8Array(n * 4), inner = new Uint8Array(n * 4), tone = blendTone(palette);
  const natural = !!live && groundRoadLook(live.roadLook);
  for (let i = 0; i < scene.streets.length; i++) {
    if ((i + 1) % COLOR_STEP === 0) yield;
    streetColor(scene.streets[i], i);
  }
  return { outer, inner };
  function streetColor(s: CityScene['streets'][number], i: number): void {
    const fillOf = (base: string): string => (s.role === 'track' ? custom?.track : custom?.road) ?? base, edgeOf = (base: string): string => custom?.roadEdge ?? base;
    // Live look on a natural ground: the flat base of the Canvas road paint (drawCitySteps `natural`), structures excepted.
    if (natural && !STRUCTURE_ROLES.has(s.role)) { const p = liveNaturalStreet(scene, s, live!, custom); put(outer, i, p.edge, p.edgeAlpha); put(inner, i, p.fill, p.alpha); return; }
    const tinted = streetToneAt(s.street.path, s.role, s.rank);
    if (tinted) { const p = tinted; put(outer, i, edgeOf(p.edge), p.edgeAlpha); put(inner, i, fillOf(p.fill), p.alpha); return; }
    if (blended && !STRUCTURE_ROLES.has(s.role)) { const p = softStreet(s.role, s.rank, tone); put(outer, i, edgeOf(p.edge), p.edgeAlpha); put(inner, i, fillOf(p.fill), p.alpha); return; }
    const p = streetPaint(s.role, s.rank, palette); put(outer, i, edgeOf(p.casing)); put(inner, i, fillOf(p.fill));
  }
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
    const b = items[roofs.owner[k]], snow = roofs.snow?.[k] && mapGroundSnow(b.snowAltitude ?? b.building.ground_z_m);
    const layer = snow ? -1 : coverLayer(roofs.cover[k]);
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
