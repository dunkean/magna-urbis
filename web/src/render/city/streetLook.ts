/**
 * Look of the town streets: which streets a level of detail shows, their width on screen, and the paint of each one
 * (casing or shoulder, bed, kerbs and sidewalks, wear, cobbles, winter slush, bridge rails, stair treads).
 *
 * Part of the town's look (city/look.ts). `streetLook` returns the strokes of one street by draw layer and, near and
 * close, its ground surface (roadSurface.ts rings: square junctions, curb returns, tapers); widths are world metres at
 * the frame's scale. A paint is a colour or a named pattern (`StreetPaint`): the Canvas town (cityCanvas.ts) resolves
 * a pattern with its context, the GPU town (cityGlStyle.ts) with its flat equivalent until it samples the pattern.
 */
import type { CityLayers, CityLod, CityPalette, CityStreet } from './model/contract';
import type { Point } from '../../../../rust/bridge/urban';
import type { RenderColors } from '../customColors';
import { groundRoadLook, type RoadLook } from '../composition';
import { isBoardwalk } from '../cityGround';
import { STRUCTURE_ROLES, blendTone, isBlended, softStreet, type BlendTone } from '../groundBlend';
import type { SurfaceEnd } from '../roadSurface';
import { streetToneAt } from '../groundTone';
import { STREET_MIN_PX, cobbleTone, emphasisAlpha, naturalMarks, pavedMarks, pavedRank, quayFill, roadToneAt, sidewalkTone, streetRank, type RoadRank, type RoadStyle } from '../roadStyle';
import type { RoadPavement } from '../roadPavement';
import { streetLayer } from '../buildingMaterials';
import { mapGroundSnow } from '../seasonPalette';
import { atLeast } from './levels';
import { PARCH, SLUSH } from './planLook';

/** Stroked over the street surface. A causeway is not one: it joins the surface as an ordinary raised road. */
export const CROSSINGS = new Set(['bridge', 'ford', 'pier', 'boardwalk', 'walkway']);
/** Stroked even near and close: square-ended structures. */
const SURFACE_SKIP = new Set(['mole', 'port-stairs', 'landing']);
/** Untrodden snow in the shade of a quiet lane. */
const LANE_SNOW = 'rgb(130,151,170)';

/** Ink of a street on the drawn plans: fill and casing. */
export function streetInk(role: string, rank: number, palette: CityPalette): { fill: string; casing: string } {
  if (role === 'track') {
    const ink = palette === 'ink' ? '#776348' : '#a58e65';
    return { fill: ink, casing: ink };
  }
  if (role === 'mole') return { fill: quayFill('stone'), casing: '#2b2015' }; // stone port works: dark outline, legible zoomed out
  if (palette === 'ink') return { fill: '#6b5640', casing: '#3c3024' };
  if (isBoardwalk(role)) return { fill: '#b49a6d', casing: '#514431' };
  if (palette === 'parchment') return role === 'ford' ? { fill: PARCH.ford, casing: PARCH.ink } : role === 'bridge' ? { fill: PARCH.bridge, casing: PARCH.wall } : { fill: PARCH.street, casing: PARCH.streetEdge };
  switch (role) {
    case 'bridge':
      return { fill: '#ddd3c2', casing: '#4d4740' };
    case 'causeway':
      return { fill: '#dccaa0', casing: '#76664f' };
    case 'ford':
      return { fill: '#b9d0d6', casing: '#6f8f9a' };
    case 'port-stairs':
      return { fill: '#e6d5b2', casing: '#705d45' };
    case 'market':
      return { fill: '#f5d98f', casing: '#9a7d4f' };
    case 'collective':
      return { fill: '#ccdacf', casing: '#8a9a8d' };
    case 'private':
      return { fill: '#d9cddf', casing: '#9a8ca1' };
    default:
      return { fill: rank <= 1 ? '#f6e3b8' : '#f3dfb3', casing: rank <= 1 ? '#7d6648' : '#9c8664' };
  }
}

/** Highest street rank a level of detail shows (crossings show at every level). */
export const streetMaxRank = (lod: CityLod): number => (lod === 'far' ? 1 : lod === 'mid' ? 2 : 9);
export const streetShown = (s: Pick<CityStreet, 'rank' | 'role'>, lod: CityLod): boolean => s.rank <= streetMaxRank(lod) || CROSSINGS.has(s.role);
/** Draw order key: descending rank, crossings last. */
export const streetOrder = (s: Pick<CityStreet, 'rank' | 'role'>): number => (CROSSINGS.has(s.role) ? -1 : s.rank);
/** Minimum on-screen width of a street, CSS px. */
export const streetMinPx = (role: string, rank: number, planPath = false): number => (isBoardwalk(role) ? 0.8 : role === 'mole' ? 3.4 : (planPath ? PLAN_PATH_STREET_MIN_PX : STREET_MIN_PX)[Math.min(4, Math.max(0, rank))]);
/** The plan path's own floors (planPath.ts): ranks 2 to 4 a tenth of a pixel narrower. */
const PLAN_PATH_STREET_MIN_PX: readonly number[] = [3, 2.4, 1.6, 1.1, 0.8];
/** Natural grounds: on-screen width a street narrower than the pixel thins to (it then fades with its true share). */
const NATURAL_STREET_FLOOR_PX = 1.1;
/** How streets are painted in a frame: a tone of the ground, a translucent wash, or the ink of the plan. */
export type StreetMode = 'natural' | 'soft' | 'ink';
/** Width of the casing (ink), soft edge (wash) or shoulder (natural, before its 9 % of the street width) on each side, CSS px. */
export const streetEdgePx = (mode: StreetMode, lod: CityLod): number => (mode === 'natural' ? (lod === 'mid' ? 0.9 : 1.4) : mode === 'soft' ? (lod === 'mid' ? 0.8 : 1.1) : lod === 'far' ? 0 : lod === 'mid' ? 0.7 : 0.9);
/** Casing of bridges and moles on each side: metres, at least 1.4 px. */
const deckEdge = (mpp: number): number => Math.max(1.2, 1.4 * mpp);

/** A colour, or a pattern the renderer resolves: the ground-textured road paint of a rank (roadStyle.ts roadPaint),
 * the aggregate grain (roadGrain), a textured material layer with the colour that stands for it. */
export type StreetPaint = string | { road: RoadRank; style: RoadStyle } | { grain: true } | { material: number; fallback: string };
/** Draw layers of the stroked ways, bottom to top: casings, ways under the surfaced streets, [surface casings, bodies
 * and carriageways], wear and winter marks, crossings, rails and treads. */
export type StreetLayer = 'casing' | 'under' | 'marks2' | 'over' | 'marks';
interface StreetStroke {
  layer: StreetLayer;
  paint: StreetPaint;
  /** World metres. */ width: number;
  alpha?: number;
  cap?: 'round' | 'butt';
}
export interface StreetFill {
  paint: StreetPaint;
  alpha?: number;
}
/** A street drawn as its ground surface: `w` its width, `edge` the casing beyond it on each side (when `casing`),
 * `inset`/`inner` the carriageway of a paved street inside its sidewalks, `end` how a loose end stops. */
export interface StreetSurface {
  w: number;
  edge: number;
  casing?: StreetFill;
  fill: StreetFill;
  inset?: number;
  inner?: StreetFill;
  end?: SurfaceEnd;
}
interface StreetLook {
  mode: StreetMode;
  strokes: StreetStroke[];
  surface?: StreetSurface;
  /** Parapet lines of a wide bridge: `offset` from the centreline on each side. */ rails?: { paint: string; width: number; offset: number };
  /** Treads across a stepped way, the only mark that tells it from a lane: they fade in as it comes close. */ stairs?: { paint: string; width: number; alpha: number };
}

interface StreetFrameInput {
  lod: CityLod;
  palette: CityPalette;
  /** Ink streets of another palette than the blocks (the 3D plan). */ streetPalette?: CityPalette;
  /** Metres per CSS pixel. */ mpp: number;
  layers: Pick<CityLayers, 'roadSurface'>;
  night?: boolean;
  /** Stepped streets are 3D flights drawn by the host: the plan draws no treads on them. */ stairMeshes?: boolean;
  roadLook?: RoadLook;
  /** Contrast of the roads against their ground, 0.5–1.5. */ roadEmphasis?: number;
  groundBlend?: boolean;
  materialGround?: boolean;
  /** Texture images are in hand: ink streets take their material. */ textured?: boolean;
  /** The user's road, track and road edge colours. */ colors?: RenderColors;
  /** Colours and ambience of the natural road paint (the building appearance's). */ paintColors?: RenderColors;
  paintNight?: boolean;
}
interface StreetFrame extends StreetFrameInput {
  night: boolean;
  natural: boolean;
  /** Washes instead of ink where the ground gives no tone. */ soft: boolean;
  tone: BlendTone;
  emphasis: number;
  roadStyle: RoadStyle;
  pavedStyle: RoadStyle;
}
export function streetFrame(o: StreetFrameInput): StreetFrame {
  const emphasis = o.roadEmphasis ?? 1;
  // The user's own colours; the night defaults of `colors` belong to the ink look.
  const roadStyle: RoadStyle = { look: o.roadLook === 'rendered' ? 'rendered' : 'natural', emphasis, night: !!o.paintNight, colors: o.paintColors };
  return { ...o, night: !!o.night, natural: groundRoadLook(o.roadLook), soft: o.roadLook !== 'ink' && (o.groundBlend ?? isBlended()) && !o.textured, tone: o.materialGround ? 'earth' : blendTone(o.palette), emphasis, roadStyle, pavedStyle: { ...roadStyle, pavement: 'asphalt' } };
}
/** What a street's paint reads from its town. */
interface StreetContext {
  /** Surface of the street (roadPavement.ts layoutStreetPavements). */ pavement?: RoadPavement;
  /** Population of the street's town: the main streets of a centre are cobbled (rendered roads). */ population?: number;
}
const quarter = (w: number): number => Math.round(w * 4) / 4;

/** Metres per pixel from which the treads of a stepped way fade in, and at which they show in full (a tread every ten pixels). */
const TREADS_MPP = [0.55, 0.25] as const;

/** The paint of one street for a frame. */
export function streetLook(f: StreetFrame, s: CityStreet, town: StreetContext = {}): StreetLook {
  const look = streetPaint(f, s, town),
    alpha = Math.min(1, (TREADS_MPP[0] - f.mpp) / (TREADS_MPP[0] - TREADS_MPP[1]));
  if (alpha > 0 && f.lod === 'close' && ((s.role === 'stairs' && !f.stairMeshes) || s.role === 'port-stairs')) look.stairs = { paint: '#705d45', width: 0.6 * f.mpp, alpha };
  return look;
}
function streetPaint(f: StreetFrame, s: CityStreet, town: StreetContext): StreetLook {
  const { lod, mpp, night } = f,
    px = (n: number): number => n * mpp,
    strokes: StreetStroke[] = [];
  const add = (layer: StreetLayer, paint: StreetPaint, width: number, alpha?: number, cap?: 'round' | 'butt'): void => {
    strokes.push({ layer, paint, width, alpha, cap });
  };
  // Near and close: streets are their ground surface — square ends at junctions, curb returns, tapers — filled once
  // per style, so nothing shows twice. Decks, quays and fords keep their stroked art.
  const surfaceOk = (): boolean => f.layers.roadSurface !== false && atLeast(lod, 'near') && !CROSSINGS.has(s.role) && !SURFACE_SKIP.has(s.role);
  // Stroked ways under the surfaced streets, crossings over them.
  const body: StreetLayer = CROSSINGS.has(s.role) ? 'over' : 'under';
  const ink = streetInk(s.role, s.rank, f.streetPalette ?? f.palette);
  if (night) {
    ink.fill = f.palette === 'parchment' ? '#647b95' : '#242e3b';
    ink.casing = '#172538';
  }
  const custom = s.role === 'track' ? f.colors?.track : f.colors?.road;
  ink.fill = custom ?? ink.fill;
  ink.casing = f.colors?.roadEdge ?? ink.casing;
  let w = Math.max(s.width, px(streetMinPx(s.role, s.rank))),
    w2 = quarter(w);
  const structure = STRUCTURE_ROLES.has(s.role);
  if (f.natural && !structure) {
    // Natural grounds: a street narrower than the pixel is not inflated to a plan stroke. It thins to about one
    // pixel and fades with its true share of that pixel, so a town seen from afar is its ground and its roofs,
    // not a street diagram laid over the land.
    const floor = px(NATURAL_STREET_FLOOR_PX),
      thin = Math.max(0.35, Math.min(1, s.width / floor));
    if (s.width < w) {
      w = Math.max(s.width, floor);
      w2 = quarter(w);
    }
    const rank = streetRank(s.role, s.rank);
    if (pavedRank(rank, town.pavement)) {
      // Paved town street (roadPavement.ts): an asphalt carriageway, pale kerb and sidewalk strips inside the street
      // space of the wider streets, a centre line on the main ones; lanes and alleys are plain. Squares keep their paving.
      const paintRoad: StreetPaint = { road: rank, style: f.pavedStyle },
        snow = f.pavedStyle.night ? 0 : mapGroundSnow();
      const walk = s.rank <= 2 && w >= 9 ? Math.min(3, Math.max(1.4, w * 0.16)) : 0,
        road = quarter(w - 2 * walk);
      const paved = pavedMarks(rank, road, 1 / mpp, f.pavedStyle, s.rank <= 1 && road >= 7, false);
      paved.bed *= thin;
      const bed: StreetFill = { paint: paintRoad, alpha: paved.bed };
      if (snow && road / mpp >= 4) {
        // Same winter as the earth streets: slush over a busy carriageway, a beaten line on a quiet one.
        const busy = s.rank <= 1 ? 1 : s.rank === 2 ? 0.62 : 0.24;
        add('marks2', busy > 0.5 ? SLUSH : LANE_SNOW, road * (0.5 + 0.32 * busy), (0.2 + 0.32 * busy) * snow, 'butt');
        add('marks2', paintRoad, road * (0.16 + 0.18 * busy), paved.bed * (0.55 + 0.45 * busy), 'butt');
      }
      for (const k of paved.strokes) add('marks2', k.paint ?? paintRoad, k.width, k.alpha, k.cap as 'round' | 'butt');
      if (paved.grain) add('marks2', { grain: true }, road, paved.grain, 'butt');
      const sidewalk = walk ? sidewalkTone(f.pavedStyle) : undefined;
      if (surfaceOk()) return { mode: 'natural', strokes, surface: { w, edge: 0, fill: sidewalk ? { paint: sidewalk, alpha: paved.bed } : bed, inset: walk, inner: sidewalk ? bed : undefined, end: 'square' } };
      if (sidewalk) add('casing', sidewalk, w2, paved.bed, 'butt');
      add(body, paintRoad, sidewalk ? road : w2, paved.bed, 'butt');
      return { mode: 'natural', strokes };
    }
    // Same paint as the regional roads: a tone of the local ground, a soft shoulder instead of a casing, wear up close.
    const marks = naturalMarks(rank, w, 1 / mpp, f.roadStyle),
      bedAlpha = marks.bed.alpha * thin,
      edge = Math.max(px(streetEdgePx('natural', lod)), w * 0.09),
      shoulder = marks.shadow && { ...marks.shadow, alpha: marks.shadow.alpha * 0.8 };
    const paintRoad: StreetPaint = { road: rank, style: f.roadStyle };
    const snow = f.roadStyle.night ? 0 : mapGroundSnow();
    // Rendered surface: the main streets of a town centre are cobbled (weathered setts), lanes stay packed earth.
    if (f.roadStyle.look === 'rendered' && s.role !== 'track' && s.rank <= 1 && (town.population ?? 0) >= 2000) add('marks2', cobbleTone(f.roadStyle), w2 * 0.92, bedAlpha * 0.78, 'butt');
    if (snow && rank !== 'path' && w2 / mpp >= 4) {
      // Main streets are trodden to a grey-brown slush over most of their width; back lanes and tracks keep
      // their snow, with a cool shade and one narrow beaten line.
      const busy = s.role === 'track' ? 0.3 : s.rank <= 1 ? 1 : s.rank === 2 ? 0.62 : 0.24;
      add('marks2', busy > 0.5 ? SLUSH : LANE_SNOW, w2 * (0.5 + 0.32 * busy), (0.2 + 0.32 * busy) * snow, 'butt');
      add('marks2', paintRoad, w2 * (0.16 + 0.18 * busy), bedAlpha * (0.55 + 0.45 * busy), 'butt');
    }
    if (marks.wear) add('marks2', marks.wear.color, w2 * marks.wear.share, marks.wear.alpha, 'butt');
    if (marks.grain) add('marks2', { grain: true }, w2, marks.grain, 'butt');
    // A loose earth end narrows into the ground; a lane stops flat.
    if (surfaceOk()) return { mode: 'natural', strokes, surface: { w, edge, casing: shoulder && lod !== 'far' ? { paint: shoulder.color, alpha: shoulder.alpha } : undefined, fill: { paint: paintRoad, alpha: bedAlpha }, end: s.role === 'lane' ? 'butt' : 'taper' } };
    if (shoulder && lod !== 'far') add('casing', shoulder.color, w2 + 2 * edge, shoulder.alpha, 'butt');
    add(body, paintRoad, w2, bedAlpha, 'butt');
    return { mode: 'natural', strokes };
  }
  const toned = f.roadLook === 'ink' || night ? undefined : streetToneAt(s.street.path, s.role, s.rank); // map-tinted street (groundTone.ts)
  if (toned || (!night && f.soft && !structure)) {
    // Blended: earth wash at rank-decaying opacity and a faint soft edge instead of the dark casing.
    const soft = toned ?? softStreet(s.role, s.rank, f.tone);
    soft.fill = custom ?? soft.fill;
    soft.edge = f.colors?.roadEdge ?? soft.edge;
    const edge = px(streetEdgePx('soft', lod));
    if (toned && s.role !== 'track') add('casing', toned.ground, w + 7 * edge, 0.45, 'butt');
    if (surfaceOk()) return { mode: 'soft', strokes, surface: { w, edge, casing: lod !== 'far' ? { paint: soft.edge, alpha: soft.edgeAlpha } : undefined, fill: { paint: soft.fill, alpha: soft.alpha } } };
    // The land use leaves a corridor along every street (the darker decor shows there): an apron of the ground tone hides it.
    if (toned && s.role !== 'track') add('casing', toned.ground, w2 + 7 * edge, 0.45, 'butt');
    if (lod !== 'far') add('casing', soft.edge, w2 + 2 * edge, soft.edgeAlpha, 'butt');
    add(body, soft.fill, w2, soft.alpha, 'butt');
    return { mode: 'soft', strokes };
  }
  const deck = s.role === 'bridge' || s.role === 'mole',
    edge = deck ? deckEdge(mpp) : px(streetEdgePx('ink', lod)),
    cap = 'butt' as const;
  const bodyPaint: StreetPaint = !custom && f.roadLook !== 'ink' && f.textured ? { material: streetLayer(s.role, s.rank), fallback: ink.fill } : ink.fill;
  const inkEdge = edge * Math.max(1, f.emphasis),
    inkAlpha = Math.min(1, emphasisAlpha(f.emphasis));
  if (surfaceOk()) return { mode: 'ink', strokes, surface: { w, edge: inkEdge, casing: edge > 0 ? { paint: ink.casing, alpha: inkAlpha } : undefined, fill: { paint: bodyPaint, alpha: inkAlpha } } };
  if (edge > 0) add('casing', ink.casing, w2 + 2 * inkEdge, inkAlpha, cap);
  add(body, bodyPaint, w2, inkAlpha, cap);
  const look: StreetLook = { mode: 'ink', strokes };
  if (s.role === 'bridge' && w2 > px(3.5)) look.rails = { paint: ink.casing, width: Math.max(0.25, px(0.55)), offset: w2 / 2 - Math.max(0.4, px(0.8)) };
  return look;
}
/** The stroke of a street's body (its bed or ink fill) and of its casing (shoulder, soft edge or ink casing; not the
 * ground apron), whether the street is a surface or a stroked way: what a renderer without the marks draws. */
export function streetBase(look: StreetLook): { fill?: StreetFill; casing?: StreetFill } {
  if (look.surface) return { fill: look.surface.inner ?? look.surface.fill, casing: look.surface.inner ? look.surface.fill : look.surface.casing };
  let fill: StreetFill | undefined, casing: StreetFill | undefined;
  for (const k of look.strokes) {
    if (k.layer === 'under' || k.layer === 'over') fill = k;
    else if (k.layer === 'casing') casing = k;
  }
  return { fill, casing };
}
/** The material (satellite) ground shows its unlit albedo tile about 1.45 times brighter than the building pass shows the
 * same colour on a level face: a street of albedo rgb(149,142,107) reads rgb(218,205,146) next to a tread of rgb(149,142,107)
 * (town-italian, 2026-11-20, web/out/stairs-3d-2026-11-20). A mesh that must read as that street takes the shown colour. */
const MATERIAL_GROUND_SHOWN = 1.45;
const materialGroundShown = (css: string): string => {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(css);
  return m ? `rgb(${[m[1], m[2], m[3]].map(v => Math.min(255, Math.round(Number(v) * MATERIAL_GROUND_SHOWN))).join(',')})` : css;
};
/** Options of a ground pass that decide the colour of a stepped street (see `stairStreetColor`). */
export type StairPaintOptions = Pick<StreetFrameInput, 'palette' | 'roadLook' | 'roadEmphasis' | 'streetPalette' | 'colors' | 'groundBlend' | 'materialGround' | 'night'> & { appearance?: { colors?: RenderColors; ambience?: string } };
/** Bed colour of a stepped street in a ground drawn with `stairMeshes`, read once per flight for the treads and ramps of
 * its 3D steps (city3dStairs.ts): the branches and sources of `streetLook` for that street (natural road tone at
 * the flight's middle, map-tinted street, blended wash, or the plan's street paint), each pattern given as its base colour. */
export function stairStreetColor(street: { path: readonly Point[]; role: string; rank: number }, o: StairPaintOptions): string {
  const palette = o.palette,
    night = !!o.night,
    custom = o.colors?.road;
  if (custom) return custom;
  if (groundRoadLook(o.roadLook)) {
    const mid = street.path[street.path.length >> 1];
    const style: RoadStyle = { look: o.roadLook === 'rendered' ? 'rendered' : 'natural', emphasis: o.roadEmphasis ?? 1, night: o.appearance?.ambience === 'night', colors: o.appearance?.colors };
    const tone = roadToneAt(mid.x, mid.y, streetRank(street.role, street.rank), style);
    return o.materialGround ? materialGroundShown(tone) : tone;
  }
  const toned = o.roadLook === 'ink' || night ? undefined : streetToneAt(street.path, street.role, street.rank);
  if (toned) return toned.fill;
  if (!night && o.roadLook !== 'ink' && (o.groundBlend ?? isBlended())) return softStreet(street.role, street.rank, o.materialGround ? 'earth' : blendTone(palette)).fill;
  return night ? (palette === 'parchment' ? '#647b95' : '#242e3b') : streetInk(street.role, street.rank, o.streetPalette ?? palette).fill;
}
