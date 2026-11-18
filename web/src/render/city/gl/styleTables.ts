/**
 * Style tables of the GPU town: the per-feature colour tables (RGBA8, straight alpha) and the list of draws for one
 * (view, level of detail, palette, layers) state. Called by renderer.ts (styleFrame, prepareSteps).
 *
 * Every value is asked of the town's look (render/city/look.ts) and written as the flat equivalent a colour table
 * can hold: the fills of an element as one source-over colour, its outline, its hatch strength; a street as the bed
 * and casing of its paint, patterns as their flat tone; a pan as its colour, with the per-pan data the shader needs
 * for what depends on the frame's scale. Two users, one fold: the live town (`state.live`) and the plan path (the
 * renderer on its own canvas), whose standing differences are rules of the look (planPath.ts). What a table cannot
 * hold is listed by the look's townRestGaps (dashes, feathers, marks, surface ends).
 */
import type { Point } from '../../../../../rust/bridge/urban';
import type { CityBuildings, CityLayers, CityLod, CityPalette, CityScene, CityView } from '../model/contract';
import type { CityGlFillMesh } from '../../cityGlBuild';
import type { RenderColors } from '../../customColors';
import { MATERIALS, coverLayer, placeLayer, streetLayer } from '../../buildingMaterials';
import { mapGroundSnow } from '../../seasonPalette';
import { pavedTone, roadToneAt } from '../../roadStyle';
import type { RoadLook } from '../../composition';
import { layoutStreetPavements } from '../../roadPavement';
import { isBoardwalk } from '../../cityGround';
import { atLeast } from '../levels';
import { CANAL, PARCHMENT_HATCH, REFUSED_PARCEL, blockOps, flatFill, footprintOps, outlineOf, parcelOps, parcelsShown, planFrame, quayPaint, rgb, type PaintOp } from '../planLook';
import { RIM_DEVICE_MPP, SNOW_SHADE_LIGHT, buildingBody, buildingGroundSnow, roofFrame, roofPanBare, roofPanPaint, roofPansShown, snowMantle } from '../buildingLook';
import { streetBase, streetFrame, streetLook, type StreetPaint } from '../streetLook';
import { PAVED_ALPHA, planPathPan, type PlanPath } from '../planPath';

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
  /** The live town (the compositor's layer). Absent: the plan path (the look's planPath.ts). */
  live?: CityGlLiveLook;
}
/** What the live town reads from the appearance besides the plan state. */
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
  /** The parchment hatching pass (blocks, far footprint) and the canals (live town). */
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
/** The plan path of a state (absent for the live town): the look reads it at each rule it differs on. */
const planPathOf = (s: CityGlStyleState): PlanPath | undefined => (s.live ? undefined : { painted: s.buildingStyle !== 'silhouette' && !!s.painted });
// ---------------------------------------------------------------- plan
export interface CityGlPlanColors {
  fill: Uint8Array;
  line: Uint8Array;
  draws: CityGlDraws;
  /** Parchment hatching: strength per feature (A byte), or none. */ hatch?: Uint8Array;
}
/** Features coloured between two pauses of the resumable colour tables. */
const COLOR_STEP = 512;
/** Runs resumable colour steps to their end. */
function finish<T>(steps: Generator<void, T>): T {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}
function putRgba(out: Uint8Array, i: number, c: { r: number; g: number; b: number; alpha: number }): void {
  out[i * 4] = Math.round(c.r);
  out[i * 4 + 1] = Math.round(c.g);
  out[i * 4 + 2] = Math.round(c.b);
  out[i * 4 + 3] = Math.round(Math.min(1, c.alpha) * 255);
}
/** The paint operations of one element as its table entries: the fills as one source-over colour, the outline (the
 * feather of a wash is not one), the hatch strength. Returns what was written. */
function putPaintOps(tables: { fill: Uint8Array; line: Uint8Array; hatch?: Uint8Array }, feature: number, ops: readonly PaintOp[]): { filled: boolean; lined: boolean; hatched: boolean; paved: boolean } {
  const flat = flatFill(ops),
    edge = outlineOf(ops),
    hatch = tables.hatch ? ops.find(op => op.hatch) : undefined;
  const paved = !!flat && ops.some(op => op.paved && op.fill);
  if (flat) putRgba(tables.fill, feature, paved ? { ...flat, alpha: PAVED_ALPHA } : flat);
  if (edge) put(tables.line, feature, edge.stroke, edge.alpha ?? 1);
  if (hatch) put(tables.hatch!, feature, PARCHMENT_HATCH.color, hatch.alpha ?? 1);
  return { filled: !!flat, lined: !!edge, hatched: !!hatch, paved };
}
/** Colours of the plan mesh (footprint, blocks, parcels, quays, canals) and the draw list. */
export const planColors = (scene: CityScene, mesh: Pick<CityGlFillMesh, 'layers' | 'featureCount'>, s: CityGlStyleState): CityGlPlanColors => finish(planColorsSteps(scene, mesh, s));
/** `planColors` in resumable steps (the live town layer: a few milliseconds per call between frames). */
export function* planColorsSteps(scene: CityScene, mesh: Pick<CityGlFillMesh, 'layers' | 'featureCount'>, s: CityGlStyleState): Generator<void, CityGlPlanColors> {
  const { view, lod, layers, live } = s,
    footprint = s.buildingStyle === 'silhouette';
  const plan = planFrame({ view, lod, palette: s.palette, layers, width: live?.lineWidth ?? 0.6, groundBlend: !!s.blended, roadLook: live?.roadLook, planPath: planPathOf(s) });
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
    // On satellite grounds the frame's scale decides (frame.ts, farTownBuildingsShown): the tables allow them. Flat
    // footprints show in every view, except on the plan path (planPath.ts).
    buildings: s.buildingsVisible && (footprint || !!live?.farTown || atLeast(lod, 'near')) && ((footprint && !!live) || view === 'buildings' || view === 'roles'),
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
  // The canals over the town ground, with their bridges and lock gates (the plan path leaves them to its Canvas overlay).
  if (live && layers.waterways !== false && (layers.streets || layers.waterways) && mesh.layers.waterways) {
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
    draws.paved ||= r.paved;
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
      draws.paved ||= r.paved;
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
// ---------------------------------------------------------------- buildings
/** The live town on natural grounds: per pan, R = grain family (1 + COVER_GRAINS index, 0 none), G = grain gain (grainGain,
 * 0 where the Canvas town lays no grain), B = uneven snow strength of a snow patch, A = flags (1: shaded snow,
 * 2: masonry wall rim); and the rim colour of those rims (drawn as the wall top below .55 device m/px). */
export interface CityGlRoofGrain {
  grain: Uint8Array;
  rim: Uint8Array;
}
/** Colours of the building mesh (feature = item index, then one per roof pan, then one cast shadow per item). */
export const buildingColors = (buildings: CityBuildings | undefined, s: CityGlStyleState): { fill: Uint8Array; line: Uint8Array; roofGrain?: CityGlRoofGrain } => finish(buildingColorsSteps(buildings, s));
/** `buildingColors` in resumable steps: bodies, roof pans and cast shadows as the look paints them. On a natural ground
 * (and `live.grain`) also the per-pan data the shader needs for what depends on the frame's scale: the grain family
 * and gain, the snow mantle of a patch, the wall-rim colour (CityGlRoofGrain). */
export function* buildingColorsSteps(buildings: CityBuildings | undefined, s: CityGlStyleState): Generator<void, { fill: Uint8Array; line: Uint8Array; roofGrain?: CityGlRoofGrain }> {
  const items = buildings?.items ?? [],
    roofs = buildings?.roofs,
    count = Math.max(1, items.length + (roofs ? roofs.shapes.length + items.length : 0));
  const fill = new Uint8Array(count * 4),
    line = new Uint8Array(count * 4),
    footprint = s.buildingStyle === 'silhouette';
  const planPath = planPathOf(s),
    body = { view: s.view, palette: s.palette, footprint, diagnostic: s.diagnostic, colors: s.colors, planPath },
    bodies: string[] = [];
  for (let i = 0; i < items.length; i++) {
    if ((i + 1) % COLOR_STEP === 0) yield;
    const paint = buildingBody(body, items[i], !!roofs);
    put(fill, i, paint.fill);
    put(line, i, paint.stroke, paint.strokeAlpha);
    bodies.push(paint.fill);
  }
  // Pans and shadows show in the buildings view only (the look's roofPansShown); their features stay hidden otherwise.
  if (!roofs || !roofPansShown({ view: s.view, footprint, diagnostic: s.diagnostic, planPath })) return { fill, line };
  if (planPath) {
    // The plan path's own pan rule (the look's planPathPan).
    for (let k = 0; k < roofs.shapes.length; k++) {
      if ((k + 1) % COLOR_STEP === 0) yield;
      const pan = planPathPan(body, items[roofs.owner[k]], roofs, k, bodies[roofs.owner[k]]);
      put(fill, items.length + k, pan.color);
      put(line, items.length + k, pan.edge, pan.edgeAlpha);
    }
    for (let i = 0; i < items.length; i++) put(fill, items.length + roofs.shapes.length + i, '#000000', 1);
    return { fill, line };
  }
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
// ---------------------------------------------------------------- streets
/** A street paint as one colour: a colour as it is; the ground-textured road paint as the road tone of the ground at
 * `at` (the paved tone for an asphalt street); a material as the colour that stands for it; no grain. */
function flatStreetPaint(paint: StreetPaint, at: Point): string | undefined {
  if (typeof paint === 'string') return paint;
  if ('grain' in paint) return undefined;
  if ('material' in paint) return paint.fallback;
  const tone = roadToneAt(at.x, at.y, paint.road, paint.style);
  if (paint.style.pavement !== 'asphalt' || paint.style.colors?.road) return tone;
  const v = rgb(tone),
    paved = pavedTone([(v >> 16) & 255, (v >> 8) & 255, v & 255], paint.road, paint.style.emphasis, false);
  return `rgb(${Math.round(paved[0])},${Math.round(paved[1])},${Math.round(paved[2])})`;
}
/** Street colours: outer = casing, inner = fill (feature = street index): the bed and the casing (shoulder, soft edge
 * or ink casing) of the look's street paint at one pixel per metre, without its marks. */
export const streetColors = (scene: CityScene, palette: CityPalette, blended = false, custom?: RenderColors, live?: CityGlLiveLook): { outer: Uint8Array; inner: Uint8Array } => finish(streetColorsSteps(scene, palette, blended, custom, live));
/** `streetColors` in resumable steps. */
export function* streetColorsSteps(scene: CityScene, palette: CityPalette, blended = false, custom?: RenderColors, live?: CityGlLiveLook): Generator<void, { outer: Uint8Array; inner: Uint8Array }> {
  const n = Math.max(1, scene.streets.length),
    outer = new Uint8Array(n * 4),
    inner = new Uint8Array(n * 4);
  const frame = streetFrame({ lod: 'near', palette, mpp: 1, layers: { roadSurface: false }, roadLook: live?.roadLook, roadEmphasis: live?.emphasis ?? 1, groundBlend: blended, colors: custom, paintColors: custom });
  for (let i = 0; i < scene.streets.length; i++) {
    if ((i + 1) % COLOR_STEP === 0) yield;
    const s = scene.streets[i],
      layout = scene.layouts[s.layout],
      path = s.street.path,
      mid = path[path.length >> 1] ?? { x: 0, y: 0 };
    const base = streetBase(streetLook(frame, s, { pavement: layoutStreetPavements(layout)?.[s.index], population: layout?.programme?.population }));
    put(outer, i, base.casing && flatStreetPaint(base.casing.paint, mid), base.casing?.alpha ?? 1);
    put(inner, i, base.fill && flatStreetPaint(base.fill.paint, mid), base.fill?.alpha ?? 1);
  }
  return { outer, inner };
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
