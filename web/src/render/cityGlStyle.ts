/** City GPU renderer — styles: the per-feature colour tables (RGBA8, straight alpha) and the list of draws for one
 * (view, level of detail, palette, layers) state. Called by cityGl.ts (styleFrame, prepareSteps).
 *
 * Two users, two sets of tables:
 *  - the live town (`state.live`, render/live/cityLayer.ts): every value comes from the town's look (city/look.ts),
 *    the rules of the Canvas town, folded into flat tables (`look…` functions below);
 *  - the plan renderer of City Bench and of the V2's exact output for the drawn plans (CityGlComposite, no `live`):
 *    its own conventions (opaque plan lines, render background, painted silhouettes), kept here because the captures
 *    of those looks are made of them. Palettes and inks are still the look's tables.
 * Not drawn by the tables: dashed reserve outlines, the thicker landmark outline of the roles view (1 px here). */
import type { Point } from '../../../rust/bridge/urban';
import type { CityBuilding, CityBuildings, CityDistrict, CityLayers, CityLod, CityPalette, CityScene, CityView } from './cityCanvas';
import { BUILDING_FAMILIES } from './cityCanvas';
import { STRUCTURE_ROLES, blendLine, blendTone, blendsGround, softStreet, type WashKind } from './groundBlend';
import { streetToneAt, washAt } from './groundTone';
import { urbanFunctionColor } from './urbanBuildingStyle';
import type { CityGlFillMesh } from './cityGlBuild';
import type { RenderColors } from './customColors';
import { MATERIALS, coverLayer, placeLayer, streetLayer } from './buildingMaterials';
import { planBuildingColors, planRoofColor, planShade } from './cityBuildingPalette';
import { mapGroundSnow } from './seasonPalette';
import { pavedTone, roadToneAt } from './roadStyle';
import type { RoadLook } from './composition';
import { layoutStreetPavements } from './roadPavement';
import { harbourPaint, harbourShown } from './harbourStyle';
import { funeraryLandFill } from './cityRoles';
import { isBoardwalk } from './cityGround';
import {
  ATLAS,
  CANAL,
  PAPER,
  PARCH,
  PARCHMENT_HATCH,
  REFUSED_PARCEL,
  RIM_DEVICE_MPP,
  SNOW_SHADE_LIGHT,
  ZONE_COLORS,
  atLeast,
  blockOps,
  buildingBody,
  buildingGroundSnow,
  castShadowFill,
  districtColor,
  flatFill,
  footprintOps,
  mix,
  outlineOf,
  parcelOps,
  parcelsShown,
  planFrame,
  quayPaint,
  rgb,
  roleFamily,
  roofFrame,
  roofPanBare,
  roofPanPaint,
  roofPansShown,
  snowMantle,
  streetBase,
  streetFrame,
  streetInk,
  streetLook,
  type PaintOp,
  type StreetPaint,
} from './city/look';

export interface CityGlStyleState {
  view: CityView;
  lod: CityLod;
  palette: CityPalette;
  layers: CityLayers;
  buildingStyle?: 'geometric' | 'cartographic' | 'silhouette';
  buildingsVisible: boolean;
  diagnostic: 'none' | 'uses' | string;
  refusedParcels?: ReadonlySet<string>;
  /** Render background: painted building silhouettes (function tints, landmarks, dark edges). */
  painted?: boolean;
  /** Blended ground and streets (groundBlend.ts). */
  blended?: boolean;
  /** Custom display colours (road, roadEdge, track, building, buildingEdge), as in drawCity. */
  colors?: RenderColors;
  /** The live town (live compositor): every table is folded from the look of the Canvas town (city/look.ts). */
  live?: CityGlLiveLook;
}
/** What the live look needs from the appearance besides the plan state: the road look and its emphasis. */
export interface CityGlLiveLook {
  roadLook: RoadLook;
  emphasis: number;
  /** Canal water (townWaterColour). */ waterColor?: string;
  /** Natural grounds without textured materials: the mean tone of the Canvas roof grain, uneven snow and wall rims. */ grain?: boolean;
  /** Plan line width setting, CSS px (the look's planLineWidthPx gives the stroke). */ lineWidth?: number;
  /** Satellite grounds: the far raster stands for the buildings above its fade band, so the frame's scale, not its
   * level of detail, decides whether they are drawn (the look's farTownBuildingsShown). */ farTown?: boolean;
}
export const DEFAULT_LAYERS: CityLayers = { reserve: false, allocated: false, centers: false, domains: true, quarters: false, blocks: true, streets: true, enclosures: true, parcels: true, gardens: true, places: true, fronts: false, axes: false, access: false };

/** Which draws a state issues. */
export interface CityGlDraws {
  footprint: boolean;
  footprintLines: boolean;
  blocks: boolean;
  blockLines: boolean;
  parcels: boolean;
  parcelLines: boolean;
  streets: boolean;
  streetCasing: boolean;
  walls: boolean;
  wallInner: boolean;
  towers: boolean;
  buildings: boolean;
  buildingLines: boolean;
  /** Paved squares (render background): the sett pass over blocks and parcels. */
  paved?: boolean;
  /** Live look: the parchment hatching pass (blocks, far footprint) and the canals. */
  hatch?: boolean;
  waterways?: boolean;
}

// ---------------------------------------------------------------- colour helpers
function put(out: Uint8Array, i: number, color: string | undefined, alpha = 1): void {
  if (!color || alpha <= 0) {
    out[i * 4 + 3] = 0;
    return;
  }
  const v = rgb(color);
  out[i * 4] = (v >> 16) & 255;
  out[i * 4 + 1] = (v >> 8) & 255;
  out[i * 4 + 2] = v & 255;
  out[i * 4 + 3] = Math.round(Math.min(1, alpha) * 255);
}
/** Alpha byte 253 in a fill colour table marks a paved square: the paved pass draws its
 * setts and wear (render background, close level only). Visually opaque. */
export const PAVED_ALPHA = 253 / 255;
/** Yards and courts under painted roofs: trodden earth tinted by the district role, so
 * districts still read once the blocks are covered with roofs (near, close). */
const YARD_EARTH = '#b3a27c';
function paintedYard(d: CityDistrict | undefined, fallback: string): string {
  return mix(districtColor(d, fallback), YARD_EARTH, 0.45);
}
// ---------------------------------------------------------------- plan
export interface CityGlPlanColors {
  fill: Uint8Array;
  line: Uint8Array;
  draws: CityGlDraws;
  /** Parchment hatching: strength per feature (A byte), or none. */ hatch?: Uint8Array;
}
const BUILT = new Set(['plot', 'compound', 'residual', 'court']),
  OPEN = new Set(['place', 'market', 'common']);
/** Features coloured between two pauses of the resumable colour tables. */
const COLOR_STEP = 512;
/** Runs resumable colour steps to their end. */
function finish<T>(steps: Generator<void, T>): T {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/** Colours of the plan mesh (footprint, blocks, parcels, quays, canals) and the draw list. */
export const planColors = (scene: CityScene, mesh: Pick<CityGlFillMesh, 'layers' | 'featureCount'>, s: CityGlStyleState): CityGlPlanColors => finish(planColorsSteps(scene, mesh, s));
/** `planColors` in resumable steps (live compositor: a few milliseconds per call between frames). */
export function* planColorsSteps(scene: CityScene, mesh: Pick<CityGlFillMesh, 'layers' | 'featureCount'>, s: CityGlStyleState): Generator<void, CityGlPlanColors> {
  if (s.live) return yield* lookPlanColorsSteps(scene, mesh, s, s.live);
  const { view, lod, palette, layers } = s,
    parchment = palette === 'parchment';
  // Render background: district-tinted yards under the roofs, paved squares (see PAVED_ALPHA).
  const footprint = s.buildingStyle === 'silhouette';
  const painted = !footprint && !!s.painted && !parchment && palette !== 'ink' && palette !== 'terrain';
  const blend = !!s.blended && blendsGround(view, palette),
    tone = blendTone(palette),
    softLine = blendLine(tone);
  const fill = new Uint8Array(mesh.featureCount * 4),
    line = new Uint8Array(mesh.featureCount * 4);
  const outline = palette === 'ink' ? '#3c3024' : parchment ? PARCH.inkSoft : '#655847';
  const growth = (zone: string): string => ZONE_COLORS[zone] ?? ZONE_COLORS.core;
  const draws: CityGlDraws = {
    footprint: false,
    footprintLines: false,
    blocks: false,
    blockLines: false,
    parcels: false,
    parcelLines: false,
    streets: layers.streets,
    streetCasing: layers.streets,
    walls: layers.enclosures,
    wallInner: layers.enclosures && lod !== 'far',
    towers: layers.enclosures && lod !== 'far',
    buildings: false,
    buildingLines: false,
  };
  if (layers.streets && mesh.layers.quays)
    (scene.quays ?? []).forEach((q, i) => {
      const f = mesh.layers.quays.features[0] + i;
      // Harbour platforms and furniture (harbourStyle.ts, shared with drawCity and the 3D city); small furniture on close views only.
      if (!harbourShown(q.kind, lod)) {
        put(fill, f, undefined);
        put(line, f, undefined);
        return;
      }
      const paint = harbourPaint(q.kind, q.material, parchment, parchment ? PARCH.ink : '#57534b');
      put(fill, f, paint.fill, paint.fillAlpha);
      put(line, f, paint.line, paint.lineAlpha);
    });
  if (lod === 'far') {
    if (layers.blocks && blend) {
      const f0 = mesh.layers.footprint.features[0];
      for (let i = 0; i < scene.footprint.length; i++) {
        const w = washAt('footprint', tone, scene.footprint[i]);
        put(fill, f0 + i, w.color, w.alpha);
        if ((i + 1) % COLOR_STEP === 0) yield;
      }
      draws.footprint = true;
    } else if (layers.blocks) {
      const f0 = mesh.layers.footprint.features[0];
      for (let i = 0; i < scene.footprint.length; i++) {
        put(fill, f0 + i, palette === 'terrain' ? undefined : parchment ? PARCH.footprint : '#cfb589', 0.9);
        put(line, f0 + i, parchment ? PARCH.ink : '#7b6446', 0.9);
      }
      draws.footprint = palette !== 'terrain';
      draws.footprintLines = true;
    }
    return { fill, line, draws };
  }
  // Blocks.
  const b0 = mesh.layers.blocks.features[0];
  const blockStroke = !(view === 'buildings' && lod !== 'close');
  for (let i = 0; i < scene.blocks.length; i++) {
    if ((i + 1) % COLOR_STEP === 0) yield;
    const b = scene.blocks[i],
      reserve = b.kind.startsWith('reserve');
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
      if (lod === 'close' && blockLine) {
        put(line, b0 + i, softLine.color, softLine.alpha);
        draws.blockLines = true;
      }
      draws.blocks = true;
      continue;
    }
    const paved = painted && b.kind === 'place' && lod === 'close';
    const alpha = paved ? PAVED_ALPHA : b.peripheral && view !== 'buildings' ? 0.6 : 1;
    if (paved && color) draws.paved = true;
    put(fill, b0 + i, color, alpha);
    const square = blockLine && parchment && b.kind === 'place' && !blockStroke; // V1 squares keep a thin edge at every zoom
    if (blockStroke && blockLine) put(line, b0 + i, outline, alpha);
    else if (square) put(line, b0 + i, PARCH.inkSoft, 0.7);
    draws.blocks ||= !!color;
    draws.blockLines ||= (blockStroke && blockLine) || square;
  }
  // Parcels.
  const p0 = mesh.layers.parcels.features[0],
    parcelLevel: CityLod = view === 'uses' || view === 'roles' ? 'mid' : 'near';
  if (layers.parcelOverlay !== false && atLeast(lod, parcelLevel) && view !== 'tissue')
    for (let i = 0; i < scene.parcels.length; i++) {
      if ((i + 1) % COLOR_STEP === 0) yield;
      const p = scene.parcels[i],
        use = p.use,
        built = BUILT.has(use),
        open = OPEN.has(use),
        f = p0 + i;
      // A culture without lot limits (`hideLotLines`) leaves its lots unoutlined; squares keep their edge.
      const lotLine = layers.planLines !== false && (open || !scene.enclosureProfiles?.[p.layout]?.hideLotLines);
      if (!((built && layers.parcels) || (use === 'garden' && layers.gardens) || (open && layers.places) || (use === 'reserve' && layers.domains))) continue;
      const burialFill = funeraryLandFill(p.allocation?.role);
      const openFill =
        burialFill ??
        (parchment
          ? use === 'garden'
            ? PARCH.garden
            : use === 'reserve'
              ? PARCH.reserve
              : use === 'common'
                ? PARCH.common
                : use === 'market'
                  ? PARCH.market
                  : use === 'place'
                    ? PARCH.place
                    : undefined
          : use === 'garden'
            ? '#a8bc89'
            : use === 'reserve'
              ? '#cbc2a8'
              : use === 'common'
                ? '#adc5bf'
                : use === 'market'
                  ? '#ead39a'
                  : use === 'place'
                    ? '#e6d1a5'
                    : undefined);
      if (blend && (view === 'parcels' || view === 'buildings')) {
        const kind: WashKind = use === 'garden' ? 'garden' : use === 'reserve' ? 'reserve' : use === 'common' ? 'common' : use === 'market' ? 'market' : use === 'place' ? 'place' : 'parcel';
        const w = washAt(kind, tone, p.shape),
          ground = kind === 'parcel' || kind === 'reserve';
        if (!(view === 'buildings' && ground)) put(fill, f, burialFill ?? w.color, burialFill ? 0.85 : w.alpha * (p.peripheral ? 0.7 : 1));
        if (lod === 'close' && lotLine) {
          put(line, f, softLine.color, softLine.alpha * (ground ? 0.8 : 1));
          draws.parcelLines = true;
        }
      } else if (view === 'parcels') {
        const color = palette === 'terrain' ? undefined : palette === 'ink' ? '#eee0c9' : parchment ? (openFill ?? PARCH.lot) : (openFill ?? (palette === 'atlas' ? ATLAS[p.index % ATLAS.length] : growth(p.zone)));
        const alpha = p.peripheral ? 0.65 : 1;
        put(fill, f, color, alpha);
        if (atLeast(lod, 'near') && lotLine) {
          put(line, f, outline, alpha);
          draws.parcelLines = true;
        }
      } else if (view === 'uses') {
        if (p.allocation) {
          const c = urbanFunctionColor(p.allocation.function);
          put(fill, f, c, 0.62);
          put(line, f, c);
          draws.parcelLines = true;
        } else put(fill, f, openFill);
      } else if (view === 'roles') {
        const family = p.allocation ? roleFamily(p.allocation.role, p.allocation.function) : open ? 'commerce' : use === 'garden' ? 'garden' : undefined;
        if (family && family !== 'dwelling') put(fill, f, BUILDING_FAMILIES[family].color, p.allocation?.landmark ? 0.75 : 0.45);
        if (p.allocation?.landmark) {
          put(line, f, BUILDING_FAMILIES[family ?? 'civic'].color);
          draws.parcelLines = true;
        }
      } else {
        const paved = painted && lod === 'close' && !!openFill && (use === 'place' || use === 'market');
        if (openFill) put(fill, f, openFill, parchment && lod === 'close' ? 0.9 : paved ? PAVED_ALPHA : 1);
        if (paved) draws.paved = true;
        if (lod === 'close' && lotLine) {
          put(line, f, openFill ? (parchment ? PARCH.inkSoft : '#b9a98d') : parchment ? PARCH.inkSoft : '#c4b597', !parchment ? 1 : openFill ? 0.9 : 0.45);
          draws.parcelLines = true;
        } else if (lotLine && parchment && openFill && (use === 'place' || use === 'market')) {
          put(line, f, PARCH.inkSoft, 0.7);
          draws.parcelLines = true;
        }
      }
      draws.parcels = true;
    }
  if (layers.parcelOverlay !== false && layers.planLines !== false && atLeast(lod, 'near') && s.refusedParcels?.size)
    scene.parcels.forEach((p, i) => {
      if (p.id && s.refusedParcels!.has(p.id)) {
        put(line, p0 + i, REFUSED_PARCEL.stroke);
        draws.parcelLines = true;
      }
    });
  draws.buildings = s.buildingsVisible && (s.buildingStyle === 'silhouette' || atLeast(lod, 'near')) && (view === 'buildings' || view === 'roles');
  draws.buildingLines = draws.buildings && (s.buildingStyle === 'silhouette' || atLeast(lod, 'near'));
  return { fill, line, draws };
}

/** The live town on natural grounds: per pan, R = grain family (1 + COVER_GRAINS index, 0 none), G = grain gain (grainGain,
 * 0 where the Canvas town lays no grain), B = uneven snow strength of a snow patch, A = flags (1: shaded snow,
 * 2: masonry wall rim); and the rim colour of those rims (drawn as the wall top below .55 device m/px). */
export interface CityGlRoofGrain {
  grain: Uint8Array;
  rim: Uint8Array;
}
/** Colours of the building mesh (feature = item index, then one per roof pan, then one cast shadow per item). */
export const buildingColors = (buildings: CityBuildings | undefined, s: CityGlStyleState, scene?: CityScene): { fill: Uint8Array; line: Uint8Array; roofGrain?: CityGlRoofGrain } => finish(buildingColorsSteps(buildings, s, scene));
/** `buildingColors` in resumable steps. */
export function* buildingColorsSteps(buildings: CityBuildings | undefined, s: CityGlStyleState, _scene?: CityScene): Generator<void, { fill: Uint8Array; line: Uint8Array; roofGrain?: CityGlRoofGrain }> {
  if (s.live) return yield* lookBuildingColorsSteps(buildings, s);
  const items = buildings?.items ?? [],
    roofs = buildings?.roofs,
    count = items.length + (roofs ? roofs.shapes.length + items.length : 0);
  const fill = new Uint8Array(Math.max(1, count) * 4),
    line = new Uint8Array(Math.max(1, count) * 4),
    colors: string[] = [];
  const parchment = s.palette === 'parchment',
    edge = s.buildingStyle === 'silhouette' && parchment ? '#f1e5c6' : '#2e261d';
  const diagnostic = s.view === 'roles' || s.diagnostic === 'uses';
  const footprint = s.buildingStyle === 'silhouette';
  const painted = !footprint && !!s.painted && !parchment && s.palette !== 'ink' && !diagnostic;
  for (let i = 0; i < items.length; i++) {
    if ((i + 1) % COLOR_STEP === 0) yield;
    const b = items[i],
      tint = planBuildingColors(b, footprint ? 'terrain' : s.palette);
    const color = s.view === 'roles' ? (BUILDING_FAMILIES[b.family]?.color ?? '#5a4b3c') : s.diagnostic === 'uses' ? urbanFunctionColor(b.fn) : (s.colors?.building ?? (footprint ? tint.roof : roofs ? tint.wall : tint.roof));
    // Party walls: every roof keeps a dark edge, so adjoining houses of a row stay distinct.
    put(fill, i, color);
    put(line, i, !footprint && b.stilts ? '#514431' : s.colors?.buildingEdge ? s.colors.buildingEdge : painted ? (b.landmark ? '#e2d3a6' : '#1f1811') : edge, painted && !b.landmark ? 0.8 : 1);
    colors.push(color);
  }
  // Roof pans use the exact shared culture/material/tone, softened for ink maps.
  if (roofs) {
    for (let k = 0; k < roofs.shapes.length; k++) {
      if ((k + 1) % COLOR_STEP === 0) yield;
      const cover = roofs.cover[k],
        f = items.length + k;
      const color = diagnostic ? planShade(colors[roofs.owner[k]], roofs.light[k] * 0.5) : s.colors?.building ? planRoofColor(items[roofs.owner[k]], roofs, k, s.palette, s.colors.building) : planRoofColor(items[roofs.owner[k]], roofs, k, s.palette);
      put(fill, f, color);
      put(line, f, '#30271f', roofs.snow?.[k] ? 0 : Math.max(0.6, COVER_EDGE[cover] ?? 0.55));
    }
    // Every relief roof casts a short, height-derived ground shadow.
    for (let i = 0; i < items.length; i++) put(fill, items.length + roofs.shapes.length + i, '#000000', 1);
  }
  return { fill, line };
}

// ---------------------------------------------------------------- the live town: tables folded from the look
// Every value below is asked of the town's look (city/look.ts), the rules the Canvas town paints with, and written as
// the flat equivalent a colour table can hold. What a table cannot hold is listed by the look's townRestGaps.
function putRgba(out: Uint8Array, i: number, c: { r: number; g: number; b: number; alpha: number }): void {
  out[i * 4] = Math.round(c.r);
  out[i * 4 + 1] = Math.round(c.g);
  out[i * 4 + 2] = Math.round(c.b);
  out[i * 4 + 3] = Math.round(Math.min(1, c.alpha) * 255);
}
/** The paint operations of one element as its table entries: the fills as one source-over colour, the outline (the
 * feather of a wash is not one), the hatch strength. Returns what was written. */
export function putPaintOps(tables: { fill: Uint8Array; line: Uint8Array; hatch?: Uint8Array }, feature: number, ops: readonly PaintOp[]): { filled: boolean; lined: boolean; hatched: boolean } {
  const flat = flatFill(ops),
    edge = outlineOf(ops),
    hatch = tables.hatch ? ops.find(op => op.hatch) : undefined;
  if (flat) putRgba(tables.fill, feature, flat);
  if (edge) put(tables.line, feature, edge.stroke, edge.alpha ?? 1);
  if (hatch) put(tables.hatch!, feature, PARCHMENT_HATCH.color, hatch.alpha ?? 1);
  return { filled: !!flat, lined: !!edge, hatched: !!hatch };
}
/** Plan tables of the live town: footprint, blocks, parcels, quays and canals as the look paints them. */
function* lookPlanColorsSteps(scene: CityScene, mesh: Pick<CityGlFillMesh, 'layers' | 'featureCount'>, s: CityGlStyleState, live: CityGlLiveLook): Generator<void, CityGlPlanColors> {
  const { view, lod, layers } = s,
    footprint = s.buildingStyle === 'silhouette';
  const plan = planFrame({ view, lod, palette: s.palette, layers, width: live.lineWidth ?? 0.6, groundBlend: !!s.blended, roadLook: live.roadLook });
  const tables = { fill: new Uint8Array(mesh.featureCount * 4), line: new Uint8Array(mesh.featureCount * 4), hatch: plan.parchment && !plan.blend ? new Uint8Array(mesh.featureCount * 4) : undefined };
  const draws: CityGlDraws = {
    footprint: false,
    footprintLines: false,
    blocks: false,
    blockLines: false,
    parcels: false,
    parcelLines: false,
    streets: layers.streets,
    streetCasing: layers.streets,
    walls: layers.enclosures,
    wallInner: layers.enclosures && lod !== 'far',
    towers: layers.enclosures && lod !== 'far',
    // On satellite grounds the frame's scale decides (cityGl draw, farTownBuildingsShown): the tables allow them.
    buildings: s.buildingsVisible && (footprint || !!live.farTown || atLeast(lod, 'near')) && (footprint || view === 'buildings' || view === 'roles'),
    buildingLines: false,
  };
  draws.buildingLines = draws.buildings;
  const done = (): CityGlPlanColors => ({ fill: tables.fill, line: tables.line, draws, hatch: tables.hatch });
  if (layers.streets && mesh.layers.quays)
    (scene.quays ?? []).forEach((q, i) => {
      const f = mesh.layers.quays.features[0] + i,
        paint = quayPaint(plan, q.kind, q.material);
      put(tables.fill, f, paint?.fill, paint?.fillAlpha ?? 0);
      put(tables.line, f, paint?.line, paint?.lineAlpha ?? 0);
    });
  // The canals over the town ground, with their bridges and lock gates.
  if (layers.waterways !== false && (layers.streets || layers.waterways) && mesh.layers.waterways) {
    const w = mesh.layers.waterways,
      b = mesh.layers.waterwayBridges;
    for (let f = w.features[0]; f < w.features[1]; f++) put(tables.fill, f, live.waterColor ?? CANAL.water);
    if (b)
      for (let f = b.features[0]; f < b.features[1]; f++) {
        put(tables.fill, f, CANAL.bridge);
        put(tables.line, f, CANAL.bridgeEdge);
      }
    draws.waterways = w.features[1] > w.features[0] || (!!b && b.features[1] > b.features[0]);
  }
  if (lod === 'far') {
    const f0 = mesh.layers.footprint.features[0];
    for (let i = 0; i < scene.footprint.length; i++) {
      if ((i + 1) % COLOR_STEP === 0) yield;
      const r = putPaintOps(tables, f0 + i, footprintOps(plan, scene.footprint[i]));
      draws.footprint ||= r.filled;
      draws.footprintLines ||= r.lined;
      draws.hatch ||= r.hatched;
    }
    return done();
  }
  const b0 = mesh.layers.blocks.features[0];
  for (let i = 0; i < scene.blocks.length; i++) {
    if ((i + 1) % COLOR_STEP === 0) yield;
    const b = scene.blocks[i],
      ops = blockOps(plan, b, scene.enclosureProfiles?.[b.layout]?.hideLotLines);
    if (!ops) continue;
    const r = putPaintOps(tables, b0 + i, ops);
    draws.blocks ||= r.filled;
    draws.blockLines ||= r.lined;
    draws.hatch ||= r.hatched;
  }
  const p0 = mesh.layers.parcels.features[0];
  if (parcelsShown(plan))
    for (let i = 0; i < scene.parcels.length; i++) {
      if ((i + 1) % COLOR_STEP === 0) yield;
      const p = scene.parcels[i],
        ops = parcelOps(plan, p, scene.enclosureProfiles?.[p.layout]?.hideLotLines);
      if (!ops) continue;
      const r = putPaintOps(tables, p0 + i, ops);
      draws.parcels ||= r.filled;
      draws.parcelLines ||= r.lined;
    }
  if (layers.parcelOverlay !== false && layers.planLines !== false && atLeast(lod, 'near') && s.refusedParcels?.size)
    scene.parcels.forEach((p, i) => {
      if (p.id && s.refusedParcels!.has(p.id)) {
        put(tables.line, p0 + i, REFUSED_PARCEL.stroke);
        draws.parcelLines = true;
      }
    });
  return done();
}
/** Building tables of the live town: bodies, roof pans and cast shadows as the look paints them. On a natural ground
 * (and `live.grain`) also the per-pan data the shader needs for what depends on the frame's scale: the grain family
 * and gain, the snow mantle of a patch, the wall-rim colour (CityGlRoofGrain). */
function* lookBuildingColorsSteps(buildings: CityBuildings | undefined, s: CityGlStyleState): Generator<void, { fill: Uint8Array; line: Uint8Array; roofGrain?: CityGlRoofGrain }> {
  const items = buildings?.items ?? [],
    roofs = buildings?.roofs,
    count = Math.max(1, items.length + (roofs ? roofs.shapes.length + items.length : 0));
  const fill = new Uint8Array(count * 4),
    line = new Uint8Array(count * 4),
    footprint = s.buildingStyle === 'silhouette';
  const body = { view: s.view, palette: s.palette, footprint, diagnostic: s.diagnostic, colors: s.colors };
  for (let i = 0; i < items.length; i++) {
    if ((i + 1) % COLOR_STEP === 0) yield;
    const paint = buildingBody(body, items[i], !!roofs);
    put(fill, i, paint.fill);
    put(line, i, paint.stroke);
  }
  // Pans and shadows show in the buildings view only (the look's roofPansShown); their features stay hidden otherwise.
  if (!roofs || !roofPansShown({ view: s.view, footprint, diagnostic: s.diagnostic })) return { fill, line };
  // The pan as a roof, and as the wall top where a rim shows (the frame's device scale decides, in the shader).
  const state = { palette: s.palette, diagnostic: s.diagnostic, colors: s.colors, dpr: 1 },
    f = roofFrame({ ...state, mpp: 2 * RIM_DEVICE_MPP }),
    rimmed = roofFrame({ ...state, mpp: RIM_DEVICE_MPP });
  const out = f.natural && s.live?.grain ? { grain: new Uint8Array(count * 4), rim: new Uint8Array(count * 4) } : undefined;
  for (let k = 0; k < roofs.shapes.length; k++) {
    if ((k + 1) % COLOR_STEP === 0) yield;
    const item = items[roofs.owner[k]],
      feature = items.length + k;
    if (!item) continue;
    const ground = buildingGroundSnow(item);
    // Without snow on the ground a snow patch repeats the pan under it.
    if (roofs.patch?.[k] && !ground) continue;
    const pan = roofPanPaint(f, item, roofs, k, ground);
    put(fill, feature, pan.color);
    put(line, feature, f.edge.color, roofs.snow?.[k] ? 0 : f.edge.alpha);
    if (!out) continue;
    const o = feature * 4,
      snowed = !!(roofs.snow?.[k] && ground);
    if (!snowed && roofPanBare(roofs, k, ground) && roofs.grain?.[k]) {
      out.grain[o] = roofs.grain[k];
      out.grain[o + 1] = Math.round(Math.max(0, Math.min(1, pan.gain)) * 255);
    }
    if (snowed && roofs.patch?.[k]) {
      out.grain[o + 2] = Math.max(1, Math.round(snowMantle(roofs.snow![k], ground) * 255));
      if (roofs.light[k] < SNOW_SHADE_LIGHT) out.grain[o + 3] |= 1;
    }
    const rim = rimmed.rims ? roofPanPaint(rimmed, item, roofs, k, ground) : undefined;
    if (rim?.wallRim) {
      out.grain[o + 3] |= 2;
      put(out.rim, feature, rim.color);
    }
  }
  for (let i = 0; i < items.length; i++) put(fill, items.length + roofs.shapes.length + i, '#000000', 1);
  return { fill, line, roofGrain: out };
}
const shadowTints = new Map<string, [number, number, number, number]>();
/** The look's cast shadow fill by day as a straight RGBA tint (snow of the first building's ground, as the Canvas town
 * shadow pass reads it). */
export function liveShadowTint(palette: CityPalette, first: CityBuilding | undefined): [number, number, number, number] {
  const css = castShadowFill(palette, false, first?.snowAltitude);
  let tint = shadowTints.get(css);
  if (!tint) {
    const m = /rgba?\((\d+)\D+(\d+)\D+(\d+)(?:\D+([\d.]+))?/.exec(css);
    tint = m ? [+m[1] / 255, +m[2] / 255, +m[3] / 255, m[4] === undefined ? 1 : +m[4]] : [0, 0, 0, 0.3];
    shadowTints.set(css, tint);
  }
  return tint;
}
/** A street paint as one colour: a colour as it is; the ground-textured road paint as the road tone of the ground at
 * `at` (the paved tone for an asphalt street); a material as the colour that stands for it; no grain. */
export function flatStreetPaint(paint: StreetPaint, at: Point): string | undefined {
  if (typeof paint === 'string') return paint;
  if ('grain' in paint) return undefined;
  if ('material' in paint) return paint.fallback;
  const tone = roadToneAt(at.x, at.y, paint.road, paint.style);
  if (paint.style.pavement !== 'asphalt' || paint.style.colors?.road) return tone;
  const v = rgb(tone),
    paved = pavedTone([(v >> 16) & 255, (v >> 8) & 255, v & 255], paint.road, paint.style.emphasis, false);
  return `rgb(${Math.round(paved[0])},${Math.round(paved[1])},${Math.round(paved[2])})`;
}
/** Street table entries of the live town: the bed and the casing (shoulder, soft edge or ink casing) of the look's
 * street paint at one pixel per metre, without its marks. */
function lookStreetColor(scene: CityScene, s: CityScene['streets'][number], i: number, frame: ReturnType<typeof streetFrame>, outer: Uint8Array, inner: Uint8Array): void {
  const layout = scene.layouts[s.layout],
    path = s.street.path,
    mid = path[path.length >> 1] ?? { x: 0, y: 0 };
  const base = streetBase(streetLook(frame, s, { pavement: layoutStreetPavements(layout)?.[s.index], population: layout?.programme?.population }));
  put(outer, i, base.casing && flatStreetPaint(base.casing.paint, mid), base.casing?.alpha ?? 1);
  put(inner, i, base.fill && flatStreetPaint(base.fill.paint, mid), base.fill?.alpha ?? 1);
}
/** Painted roof of a building: the role family decides the material (tile, slate, lead,
 * stone), the district or lot wealth its warmth; monuments are a shade darker. Same
 * hues as PAINTED_BUILDINGS for houses, so plans and compact silhouettes agree. */
export function paintedRoof(family: string, fn: string, landmark: boolean, wealth?: number): string {
  // Stores keep their grey lead or board roofs whatever trade they serve (port, market).
  const base = fn === 'warehouse' && (family === 'commerce' || family === 'dwelling') ? PAINTED_BUILDINGS.warehouse : (PAINTED_FAMILY_ROOFS[family] ?? (fn in PAINTED_BUILDINGS ? PAINTED_BUILDINGS[fn] : PAINTED_BUILDINGS.domestic));
  const w = wealth === undefined ? 0.5 : Math.max(0, Math.min(1, wealth));
  // Poor: duller, browner (thatch, old tile); rich: warmer, redder tile.
  const tinted = family === 'dwelling' || family === 'commerce' || family === 'craft' ? (w < 0.5 ? mix(base, '#7d6a52', (0.5 - w) * 0.9) : mix(base, '#a05438', (w - 0.5) * 0.5)) : base;
  return landmark ? mix(tinted, '#1d1a22', 0.18) : tinted;
}
/** Roof covers of the city massing (urban/massing.rs). */
export const ROOF_COVERS: Record<string, string> = {
  tile: '#9a5a42',
  slate: '#5d6470',
  thatch: '#9b8a5c',
  reed: '#a89a62',
  bamboo: '#9fa86a',
  palm: '#7f9150',
  shingle: '#7a5a3e',
  turf: '#6f8049',
  bark: '#6e5238',
  hide: '#b49a78',
  felt: '#c8bda3',
  earth: '#b69a72',
  plaster: '#c9bba0',
  stone: '#8a8478',
  snow: '#e4e8ea',
  metal: '#6f8d88',
  lead: '#7b8088',
};
/** Wall colours of the massing (seen on elevations; 2D plans only show roofs). */
export const WALL_COLORS: Record<string, string> = { timber: '#8a6a47', brick: '#a4573e', stone: '#9a968a', earth: '#b79c76', wood: '#9c7a52', plaster: '#d7c9a8', bamboo: '#b4b070', wattle: '#a98f69', hide: '#b9a07f', coral: '#d9c6b4' };
/** Opacity of a pan's edge line: crisp courses (tile, shingle, slate, bamboo) read as stripes, soft ones (thatch, turf) as fuzz. */
const COVER_EDGE: Record<string, number> = { tile: 0.72, shingle: 0.72, slate: 0.68, bamboo: 0.72, metal: 0.65, thatch: 0.35, reed: 0.35, palm: 0.4, turf: 0.3, bark: 0.45, hide: 0.4, felt: 0.4, snow: 0.3 };
/** Roof hues by role family (render background). */
export const PAINTED_FAMILY_ROOFS: Record<string, string> = { dwelling: '#8a5c45', commerce: '#9a6c3e', craft: '#74483a', civic: '#4d5d78', worship: '#5b4b72', defence: '#57595c', garden: '#7f8461' };
/** Painted silhouettes (Render background): warm roofs for houses, greyer stores, slate landmarks.
 * Same tints as the compact plans' painted silhouettes (urbanBuildingLod.ts). */
export const PAINTED_BUILDINGS: Record<string, string> = { domestic: '#8a5c45', mixed: '#93664a', workshop: '#7c6652', warehouse: '#6e6a63', collective: '#6b5a63', open_space: '#7f8461', landmark: '#4f4459' };
/** Ground shadow of painted silhouettes: straight RGBA and world offset (metres, south-east). */
export const PAINTED_SHADOW: [number, number, number, number] = [0, 0, 0, 0.3];
/** Parchment ground shadow of flat-roofed buildings: a light sepia wash (straight RGBA). */
export const PARCHMENT_SHADOW: [number, number, number, number] = [0, 0, 0, 0.2];
/** Street colours: outer = casing, inner = fill (feature = street index). */
export const streetColors = (scene: CityScene, palette: CityPalette, blended = false, custom?: RenderColors, live?: CityGlLiveLook): { outer: Uint8Array; inner: Uint8Array } => finish(streetColorsSteps(scene, palette, blended, custom, live));
/** `streetColors` in resumable steps. */
export function* streetColorsSteps(scene: CityScene, palette: CityPalette, blended = false, custom?: RenderColors, live?: CityGlLiveLook): Generator<void, { outer: Uint8Array; inner: Uint8Array }> {
  const n = Math.max(1, scene.streets.length),
    outer = new Uint8Array(n * 4),
    inner = new Uint8Array(n * 4),
    tone = blendTone(palette);
  // The live town: the base of the look's street paint (bed and casing), its patterns as their flat tone.
  const frame = live && streetFrame({ lod: 'near', palette, mpp: 1, layers: { roadSurface: false }, roadLook: live.roadLook, roadEmphasis: live.emphasis, groundBlend: blended, colors: custom, paintColors: custom });
  for (let i = 0; i < scene.streets.length; i++) {
    if ((i + 1) % COLOR_STEP === 0) yield;
    if (frame) lookStreetColor(scene, scene.streets[i], i, frame, outer, inner);
    else streetColor(scene.streets[i], i);
  }
  return { outer, inner };
  function streetColor(s: CityScene['streets'][number], i: number): void {
    const fillOf = (base: string): string => (s.role === 'track' ? custom?.track : custom?.road) ?? base,
      edgeOf = (base: string): string => custom?.roadEdge ?? base;
    const tinted = streetToneAt(s.street.path, s.role, s.rank);
    if (tinted) {
      const p = tinted;
      put(outer, i, edgeOf(p.edge), p.edgeAlpha);
      put(inner, i, fillOf(p.fill), p.alpha);
      return;
    }
    if (blended && !STRUCTURE_ROLES.has(s.role)) {
      const p = softStreet(s.role, s.rank, tone);
      put(outer, i, edgeOf(p.edge), p.edgeAlpha);
      put(inner, i, fillOf(p.fill), p.alpha);
      return;
    }
    const p = streetInk(s.role, s.rank, palette);
    put(outer, i, edgeOf(p.casing));
    put(inner, i, fillOf(p.fill));
  }
}
/** Wall colours: outer stroke and the light inner line of stone walls (feature = wall index). */
export function wallColors(scene: CityScene, palette: CityPalette): { outer: Uint8Array; inner: Uint8Array; tower: [string, string] } {
  const n = Math.max(1, scene.walls.length),
    outer = new Uint8Array(n * 4),
    inner = new Uint8Array(n * 4),
    parchment = palette === 'parchment';
  scene.walls.forEach((w, i) => {
    const palisade = w.kind === 'palisade';
    put(outer, i, palisade ? '#72533a' : parchment ? PARCH.wall : '#4b443b');
    put(inner, i, palisade ? undefined : parchment ? PARCH.wallFill : '#b6a793');
  });
  return { outer, inner, tower: [parchment ? PARCH.tower : '#5a5248', parchment ? PARCH.wall : '#2f2a24'] };
}
export const rgba01 = (color: string, alpha = 1): [number, number, number, number] => {
  const v = rgb(color);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, alpha];
};

// ---------------------------------------------------------------- textured materials
// Per-feature material tables (RGBA8, same layout as the colour tables): R = layer + 1 (0: none, keep the flat colour),
// G = roof downslope angle (0..255 → 0..2π) or street direction; B = brightness × 128, A = roof tint flag.
const matPut = (out: Uint8Array, i: number, layer: number, g: number, bright: number, roof = false): void => {
  out[i * 4] = layer < 0 ? 0 : layer + 1;
  out[i * 4 + 1] = g;
  out[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(bright * 128)));
  out[i * 4 + 3] = roof ? 255 : 0;
};
/** Roof pans keep their flat tint; the shader recentres texture detail around its mean. */
export function roofMaterialTable(buildings: CityBuildings | undefined, s: CityGlStyleState): Uint8Array {
  const items = buildings?.items ?? [],
    roofs = buildings?.roofs,
    n = items.length + (roofs ? roofs.shapes.length + items.length : 0),
    out = new Uint8Array(Math.max(1, n) * 4);
  if (!roofs || s.view === 'roles' || s.diagnostic === 'uses' || s.palette === 'parchment' || s.palette === 'ink') return out;
  for (let k = 0; k < roofs.shapes.length; k++) {
    const b = items[roofs.owner[k]],
      snow = roofs.snow?.[k] && mapGroundSnow(b.snowAltitude ?? b.building.ground_z_m);
    const layer = snow ? -1 : coverLayer(roofs.cover[k]);
    if (layer < 0) continue;
    matPut(out, items.length + k, layer, Math.round((((roofs.dir[k] ?? 0) / (2 * Math.PI) + 1) % 1) * 255), 1, true);
  }
  return out;
}
/** Plan fills drawn textured: plazas (place / market blocks and parcels). */
export function planMaterialTable(scene: CityScene, mesh: Pick<CityGlFillMesh, 'layers' | 'featureCount'>): Uint8Array {
  const out = new Uint8Array(mesh.featureCount * 4),
    layer = placeLayer();
  const b0 = mesh.layers.blocks.features[0],
    p0 = mesh.layers.parcels.features[0];
  scene.blocks.forEach((b, i) => {
    if (b.kind === 'place') matPut(out, b0 + i, layer, 0, 1);
  });
  scene.parcels.forEach((p, i) => {
    if (p.use === 'place' || p.use === 'market') matPut(out, p0 + i, layer, 0, 1);
  });
  return out;
}
/** Street surfaces by role and rank; planks (timber decks) run along the street. */
export function streetMaterialTable(scene: CityScene): Uint8Array {
  const out = new Uint8Array(Math.max(1, scene.streets.length) * 4);
  // Narrow bridges are timber decks (planks along the span); wider ones are stone paving.
  scene.streets.forEach((st, i) => {
    const planks = isBoardwalk(st.role) || (st.role === 'bridge' && st.width < 4),
      layer = planks ? MATERIALS.road.bridge_timber : streetLayer(st.role, st.rank);
    matPut(out, i, layer, planks ? 1 : 0, 1);
  });
  return out;
}
