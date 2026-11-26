/**
 * Moats: one model for the 2D plans, the 3D ground and its water, and City Bench.
 *
 * - Form (how the ditch is cut) is data of the engine: the `moats` table of fortifications.json, whose id the engine sends
 *   per circuit (`enclosure.moat.form`): V-shaped dry ditch, earth-scarped moat, revetted flat-bottomed moat, double ditch...
 * - Supply is the engine's: a piece (a reach between two dams) is `wet` where a river, the sea or canals feed it and the ground is low
 *   enough, `pool` when a culture's wet moat has no source (rain water only), `dry` elsewhere.
 * - Fill is decided here, from supply, form, state of the town, climate zone and season of the map: a season change recolours
 *   the moat, it rebuilds no geometry. Pieces fall in stable buckets (their position), so one circuit mixes states.
 *
 * `moatParts` builds, once per circuit, what makes a ditch read as dug in plan (bed, shoals, channel, plots, fringe, reeds,
 * scarps lit or shaded by the light of the wall shadows, their cast shadow, hachures for the engraved plans, the outer bank).
 * `moatInk` colours those parts for a fill on natural grounds, `moatPlanInk` on engraved plans.
 */
import fortifications from '../../../rust/crates/core/src/urban/fortifications.json';
import type { Point } from '../../../rust/bridge/housesContract';
import type { ClimateZone } from '../../../rust/bridge/terrainClimate';
import { mapSeasonKey, mapSeasonState } from './seasonPalette';
import { dryDitchColour, waterBed } from './waterPalette';

type Shape = { outer: Point[]; holes: Point[][] };
export interface MoatPiece {
  kind: string;
  height_m: number;
  shape: Shape;
}
export interface MoatForm {
  /** Cross-section: to a point, rounded earth, or a level bottom. */
  profile: 'v' | 'u' | 'flat';
  /** `rock`: the bare faces of a ditch cut in the rock of its hill. */
  revetment: 'earth' | 'masonry' | 'timber' | 'stone' | 'rock';
  /** Horizontal run of a scarp per metre of depth. */
  scarp: number;
  /** Depth from the lip to the bottom (m). */
  depthM: number;
  /** Two ditches parted by a middle ridge. */
  double?: boolean;
  /** Drain along the middle of the bottom. */
  cunette?: boolean;
  /** Outer bank of the spoil (counterscarp bank): width and height (m). */
  bankM?: [number, number];
}
export type MoatState = '' | 'thriving' | 'declining' | 'abandoned' | 'ruined';
/** What the engine sends per circuit (`Enclosure.moat` of urban/types.rs). */
export interface MoatSpec {
  form: string;
  /** Head of a wet ditch -> the natural water it stops short of. */
  sluices?: [Point, Point][];
  /** Dams between two reaches, across the ditch (inner end, outer end). */
  dams?: [Point, Point][];
  state?: string;
}
type Moated = { moat?: MoatSpec; style?: string };

/** Review hook (fill gallery of web/out/fix-v7): `globalThis.__muMoat = { fill, form, state, sluices, dams }`, set before the town is built, forces them. */
type Forced = { fill?: MoatFill; form?: string; state?: MoatState; sluices?: [Point, Point][]; dams?: [Point, Point][] };
const forced = (): Forced => (globalThis as { __muMoat?: Forced }).__muMoat ?? {};
/** The engine's moat record of a circuit. */
export const moatSpec = (e: Moated): MoatSpec | undefined => {
  const f = forced();
  return f.sluices || f.dams ? { form: moatFormId(e), ...e.moat, ...(f.sluices ? { sluices: f.sluices } : {}), ...(f.dams ? { dams: f.dams } : {}) } : e.moat;
};

const FORMS = fortifications.moats as unknown as Record<string, MoatForm>,
  STYLE_FORMS = fortifications.styles as unknown as Record<string, { moatForm?: string }>;
/** The form of a circuit's ditch (an id of the `moats` table): the engine's, or the form of the wall style when the circuit names none. */
export const moatFormId = (e: Moated): string => forced().form ?? e.moat?.form ?? STYLE_FORMS[e.style ?? '']?.moatForm ?? 'earth';
export const moatFormOf = (id: string): MoatForm => FORMS[id] ?? FORMS.earth;
export const moatForm = (e: Moated): MoatForm => moatFormOf(moatFormId(e));
export const moatState = (e: Moated): MoatState => forced().state ?? ((e.moat?.state ?? '') as MoatState);

/** Depth of a piece (m): the engine's, never shallower than its form. */
export const moatDepth = (d: { kind: string; height_m: number }, form?: MoatForm): number => Math.max(d.height_m > 0 ? d.height_m : 0, form?.depthM ?? (d.height_m > 0 ? 0 : 3));

/** Depth of the cut `d` metres inside a bank, in a ditch `depth` deep whose scarp runs `run` m and whose middle lies `half` m from the banks. */
export function moatCut(form: MoatForm, depth: number, run: number, half: number, d: number): number {
  if (form.double) {
    // Two V ditches: full depth at a quarter of the width, a ridge at 45 % of the depth in the middle.
    const x = Math.min(1, d / Math.max(0.5, half));
    return depth * (x < 0.5 ? x / 0.5 : 1 - 0.55 * ((x - 0.5) / 0.5));
  }
  if (form.profile === 'v') return depth * Math.min(1, d / Math.max(0.5, half));
  const s = Math.min(1, d / run),
    // The cunette: a drain 0.6 m deeper along the middle of a broad flat bottom.
    drain = form.cunette && d > half - 1.5 ? 0.6 : 0;
  // A revetted face is a straight batter; an earth scarp slumps at the lip and at the foot.
  return depth * (form.profile === 'flat' ? s : s * s * (3 - 2 * s)) + drain;
}
/** How far inside a bank the cut still deepens (m): the reach of `moatCut`. */
export const moatCutReach = (form: MoatForm, run: number, half: number): number => (form.double || form.profile === 'v' || form.cunette ? Math.max(run, half) : run);
/** Run of a scarp (m) of a ditch `depth` deep and `width` wide: never past the middle. */
export const moatScarp = (form: MoatForm, depth: number, width: number): number => Math.max(0.5, Math.min(depth * form.scarp, 0.45 * width));
/** Rise of the outer bank `d` metres outside the counterscarp (m). */
export const moatBankRise = (form: MoatForm, d: number): number => (form.bankM && d > 0 && d < form.bankM[0] ? form.bankM[1] * Math.sin((Math.PI * d) / form.bankM[0]) : 0);

// ---------------------------------------------------------------- fill
export type MoatFill = 'bare' | 'grass' | 'garden' | 'marsh' | 'stagnant' | 'low' | 'full' | 'tidal' | 'ice';
export const MOAT_FILLS: readonly MoatFill[] = ['bare', 'grass', 'garden', 'marsh', 'stagnant', 'low', 'full', 'tidal', 'ice'];
export const MOAT_BUCKETS = 3;
const hash = (x: number, y: number, k = 0): number => {
  const s = Math.sin(x * 12.9898 + y * 78.233 + k * 37.719) * 43758.5453;
  return s - Math.floor(s);
};
/** Stable bucket of a piece: its first vertex, to the metre. */
export const moatBucket = (outer: readonly Point[]): number => (outer.length ? Math.min(MOAT_BUCKETS - 1, Math.floor(hash(Math.round(outer[0].x), Math.round(outer[0].y)) * MOAT_BUCKETS)) : 0);

const ARID = new Set<ClimateZone>(['desert', 'steppe', 'savanna', 'mediterranean']),
  SOAKED = new Set<ClimateZone>(['wetland', 'tropical']);
type SeasonState = ReturnType<typeof mapSeasonState>;
/** The state of a piece of ditch in the map's climate and season (a map without climate: brim-full or grassed).
 * `kind`: the engine's supply, `wet`, `dry`, `pool` (no source: what rain and ground water leave) or `tidal` (a reach the sea fills and empties). */
export function moatFill(kind: string, bucket: number, form: MoatForm, state: SeasonState = mapSeasonState(), town: MoatState = ''): MoatFill {
  const force = forced().fill;
  if (force) return force;
  const { zone, season, paint } = state,
    wet = kind !== 'dry';
  if (!zone) return kind === 'pool' ? 'low' : wet ? 'full' : 'grass';
  const summer = Math.abs(season - 0.5) < 0.13,
    frozen = (paint?.snow ?? 0) > 0.35,
    pick = (...of: MoatFill[]): MoatFill => of[bucket % of.length];
  if (kind === 'pool') {
    // Between a dry ditch and a full moat: a pool in the wet season or a wet climate, mud or grass when it dries out.
    if (zone === 'desert') return 'bare';
    if (frozen) return pick('ice', 'marsh', 'ice');
    if (town === 'ruined' || town === 'abandoned') return pick('marsh', 'grass', 'marsh');
    if (SOAKED.has(zone)) return pick('stagnant', 'full', 'marsh');
    if (ARID.has(zone)) return summer ? pick('bare', 'grass', 'low') : pick('low', 'marsh', 'low');
    return summer ? pick('marsh', 'low', 'grass') : pick('stagnant', 'low', 'marsh');
  }
  if (wet) {
    if (frozen) return 'ice';
    if (kind === 'tidal') return 'tidal';
    // Nobody scours the moat of a town in decline: it silts, then grows over.
    if (town === 'ruined') return pick('marsh', 'stagnant', 'marsh');
    if (town === 'abandoned') return pick('stagnant', 'marsh', 'stagnant');
    const fill = ARID.has(zone) ? (summer ? pick('low', 'low', 'stagnant') : pick('full', 'low', 'full')) : SOAKED.has(zone) ? pick('full', 'full', 'stagnant') : summer ? pick('full', 'stagnant', 'low') : pick('full', 'full', 'low');
    if (town === 'declining' && fill === 'full') return 'stagnant';
    // A stone-faced moat is fed and kept: it does not draw down.
    return fill === 'low' && form.revetment === 'stone' ? 'full' : fill;
  }
  if (zone === 'desert') return 'bare';
  // A military V ditch is kept clear; the broad ditch of a town at peace is gardened; a ruined one is partly filled in and tilled.
  const garden: MoatFill = town === 'ruined' ? 'garden' : form.profile === 'v' || frozen || town === 'abandoned' ? 'grass' : 'garden';
  if (SOAKED.has(zone) || town === 'abandoned') return pick('marsh', 'marsh', 'grass');
  if (ARID.has(zone)) return pick('grass', 'bare', garden);
  return summer || frozen ? pick('grass', 'grass', garden) : pick('grass', 'marsh', garden);
}
/** Drop from the rim to the water (m) in a ditch `depth` deep; undefined: no water sheet. */
export function moatFreeboard(fill: MoatFill, depth: number): number | undefined {
  if (fill === 'full') return Math.min(1.5, Math.max(0.8, 0.25 * depth));
  if (fill === 'ice') return Math.min(1.4, 0.3 * depth);
  if (fill === 'stagnant') return Math.min(2.2, 0.45 * depth);
  if (fill === 'low' || fill === 'tidal') return depth - Math.max(0.35, 0.12 * depth);
  if (fill === 'marsh') return depth - 0.25;
  return undefined;
}

// ---------------------------------------------------------------- colours
type Rgb = readonly number[];
const rgb = (hex: string): Rgb => {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const toHex = (c: Rgb): string =>
  '#' +
  c
    .map(v =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
const mix = (a: string, b: string, t: number): string => {
  const x = rgb(a),
    y = rgb(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
};
const REVETMENT: Record<MoatForm['revetment'], string | undefined> = { earth: undefined, masonry: '#8f8778', timber: '#6f5b45', stone: '#a39a88', rock: '#8a8270' };
/** Still water of a ditch: the map's water turned brown-green and dull, never the blue of a river or the sea. */
const still = (water: string): string => mix(water, '#4f5a44', 0.68);
/** Colour of the water of a piece (2D bed or channel, 3D sheet). `engraved`: on a plan in ink the water keeps the plan's wash. */
export function moatWaterColour(fill: MoatFill, water: string, engraved = false): string {
  if (engraved) return fill === 'ice' ? mix(water, '#ffffff', 0.5) : water;
  const w = still(water);
  switch (fill) {
    case 'ice':
      return mix(w, '#cfdde1', 0.78);
    case 'stagnant':
      return mix(w, '#5f6034', 0.7);
    case 'low':
    case 'tidal':
      return mix(w, '#5c5540', 0.45);
    case 'marsh':
      return mix(w, '#2c3328', 0.5);
    default:
      return mix(w, '#474b3a', 0.4);
  }
}

export type MoatPart = 'bed' | 'shoal' | 'plotA' | 'plotB' | 'channel' | 'track' | 'dash' | 'fringe' | 'patch' | 'lily' | 'reed' | 'shadow' | 'bank' | 'shade' | 'lit' | 'hatch' | 'ridgeShade' | 'ridgeLit';
/** Draw order. */
export const MOAT_PARTS: readonly MoatPart[] = ['bed', 'shoal', 'plotA', 'plotB', 'channel', 'track', 'dash', 'fringe', 'patch', 'lily', 'reed', 'shadow', 'bank', 'shade', 'lit', 'hatch', 'ridgeShade', 'ridgeLit'];
/** How the water of a fill lies in the 3D ditch: over the `whole` piece, or only in the `water` parts (the channel of low
 * water, the pools of a marsh); the `afloat` parts lie on it (duckweed, lilies, reeds, snow on ice). */
export function moatSheet(fill: MoatFill): { whole: boolean; water: readonly MoatPart[]; afloat: readonly MoatPart[] } {
  switch (fill) {
    case 'full':
      return { whole: true, water: [], afloat: ['lily', 'reed'] };
    case 'ice':
      return { whole: true, water: [], afloat: ['channel', 'patch', 'fringe'] };
    case 'stagnant':
      return { whole: true, water: [], afloat: ['patch', 'fringe', 'lily', 'reed'] };
    case 'low':
    case 'tidal':
      return { whole: false, water: ['channel'], afloat: [] };
    case 'marsh':
      return { whole: false, water: ['patch', 'channel'], afloat: [] };
    default:
      return { whole: false, water: [], afloat: [] };
  }
}
/** Parts whose look does not depend on the fill of their piece. */
export const MOAT_FIXED_PARTS: ReadonlySet<MoatPart> = new Set<MoatPart>(['bank', 'shade', 'lit', 'hatch', 'ridgeShade', 'ridgeLit']);
export interface MoatInk {
  fill?: string;
  alpha: number;
}
const NONE: MoatInk = { alpha: 0 };
const solid = (c: string, alpha = 1): MoatInk => ({ fill: c, alpha });
/** The inks of one season: a frame asks for the same few again and again. */
const inks = new Map<string, MoatInk>();
let inkSeason = '';
/** Colour of a part of a moat piece on a natural ground (satellite family, 3D plan texture). `water`: the town's water. */
export function moatInk(part: MoatPart, kind: string, bucket: number, form: MoatForm, water: string, town: MoatState = ''): MoatInk {
  const season = `${mapSeasonKey()}|${forced().fill ?? ''}`;
  if (season !== inkSeason) {
    inks.clear();
    inkSeason = season;
  }
  const key = `${part}|${kind}|${bucket}|${form.profile}|${form.revetment}|${water}|${town}`;
  let k = inks.get(key);
  if (!k) inks.set(key, (k = paint(part, kind, bucket, form, water, town)));
  return k;
}
function paint(part: MoatPart, kind: string, bucket: number, form: MoatForm, water: string, town: MoatState): MoatInk {
  const state = mapSeasonState(),
    fill = moatFill(kind, bucket, form, state, town),
    snow = 0.8 * (state.paint?.snow ?? 0),
    ground = dryDitchColour(),
    snowy = (c: string): string => mix(c, '#e6ebeb', snow),
    earth = toHex(waterBed(state.zone).map(v => 255 * 0.78 * v)),
    mud = mix(earth, '#7d6548', 0.6),
    reed = snowy(mix('#7d7c42', ground, 0.25)),
    sheet = moatWaterColour(fill, water);
  switch (part) {
    case 'bank':
    case 'lit':
    case 'shade': {
      const face = REVETMENT[form.revetment] ? snowy(mix(REVETMENT[form.revetment]!, ground, 0.12)) : mix(ground, '#2a2a1c', 0.12);
      return solid(part === 'lit' ? mix(face, '#fff6dc', 0.3) : part === 'shade' ? mix(face, '#10161a', 0.55) : face);
    }
    case 'ridgeLit':
      return form.bankM ? solid('#fff4d2', 0.24) : NONE;
    case 'ridgeShade':
      return form.bankM ? solid('#14160f', 0.26) : NONE;
    case 'hatch':
    case 'dash':
      return NONE;
    case 'track':
      // The cunette of a dry ditch carries its trickle.
      if (form.cunette && (fill === 'grass' || fill === 'bare' || fill === 'garden')) return solid(mix(sheet, '#3a4a48', 0.3));
      break;
    case 'channel':
      // The ridge between the two ditches of a double ditch catches the light.
      if (form.double && (fill === 'grass' || fill === 'bare')) return solid(snowy(mix(ground, '#fff4d2', 0.3)));
      break;
    case 'shadow':
      // The lip throws a longer shadow the lower the fill stands.
      return solid('#0c1114', fill === 'full' || fill === 'ice' ? 0.1 : fill === 'stagnant' ? 0.15 : 0.22);
    case 'reed':
      return fill === 'bare' || fill === 'ice' || fill === 'garden' ? NONE : fill === 'grass' ? solid(snowy(mix(ground, '#2f4a1e', 0.5))) : solid(fill === 'tidal' ? mix(mud, '#3e3b2c', 0.5) : reed);
    case 'lily':
      return fill === 'full' ? solid('#7f9a58') : fill === 'stagnant' ? solid('#b4c466') : NONE;
  }
  switch (fill) {
    case 'full':
      return part === 'bed' ? solid(sheet) : part === 'fringe' ? solid(mix(sheet, '#64743f', 0.5)) : NONE;
    case 'stagnant':
      // Duckweed in sheets off the banks, an algae rim, olive-brown water between.
      return part === 'bed' ? solid(sheet) : part === 'patch' ? solid(mix(sheet, '#8c9a4c', 0.75)) : part === 'fringe' ? solid(mix(sheet, '#6a7a3c', 0.7)) : NONE;
    case 'low':
      // Cracked mud banks, paler where they have dried, and a sinuous channel.
      return part === 'bed' ? solid(mud) : part === 'shoal' ? solid(mix(mud, '#c2ab80', 0.55)) : part === 'channel' ? solid(sheet) : part === 'patch' ? solid(mix(mud, '#cdb88d', 0.7)) : part === 'fringe' ? solid(mix(mud, '#c2ab80', 0.7)) : NONE;
    case 'tidal':
      return part === 'bed' ? solid(mix(mud, '#4d5350', 0.5)) : part === 'shoal' ? solid(mix(mud, '#8f8a74', 0.35)) : part === 'channel' ? solid(sheet) : part === 'patch' ? solid(mix(sheet, '#8a9a98', 0.3)) : part === 'fringe' ? solid(mix(mud, '#35342a', 0.45)) : NONE;
    case 'ice':
      // Snow drifted against the banks and in patches; grey ice between, darker along the middle where it is thin.
      return part === 'bed' ? solid(sheet) : part === 'fringe' ? solid('#f1f4f4') : part === 'patch' ? solid('#e9eef0') : part === 'channel' ? solid(mix(sheet, '#8fa5ad', 0.55)) : NONE;
    case 'marsh':
      // Reed beds along the banks, open pools between.
      return part === 'bed' ? solid(snowy(mix(ground, '#3d4630', 0.6))) : part === 'shoal' ? solid(snowy(mix(reed, '#5d6a34', 0.4))) : part === 'patch' || part === 'channel' ? solid(sheet) : part === 'fringe' ? solid(snowy(mix(ground, '#566a30', 0.5))) : NONE;
    case 'garden':
      // Kitchen plots across the bed, a path along it, fruit trees.
      return part === 'bed' ? solid(snowy(mix(ground, '#7a6844', 0.3))) : part === 'plotA' ? solid(snowy('#4f7a2e')) : part === 'plotB' ? solid(snowy('#7d5f3c')) : part === 'track' ? solid(snowy('#bfae84')) : part === 'patch' ? solid(snowy('#3c6628')) : NONE;
    case 'bare':
      return part === 'bed' ? solid(snowy(mix(earth, '#1c1812', 0.18))) : part === 'patch' ? solid(snowy(mix(earth, '#8d8778', 0.6))) : part === 'track' ? solid(snowy(mix(earth, '#1c1812', 0.35))) : part === 'fringe' ? solid(snowy(mix(earth, '#d9c9a4', 0.25))) : NONE;
    default:
      // Grass: grazed short in one reach (a sheep track along it), left wild with scrub in the next.
      return part === 'bed'
        ? solid(snowy(bucket === 1 ? mix(ground, '#2c3c1c', 0.3) : mix(ground, '#7f9a4a', 0.22)))
        : part === 'track'
          ? bucket === 1
            ? NONE
            : solid(snowy(mix(ground, '#c2b188', 0.6)))
          : part === 'patch'
            ? solid(snowy(mix(ground, '#2f4a1e', bucket === 1 ? 0.7 : 0.4)))
            : part === 'fringe'
              ? solid(snowy(mix(ground, '#2c3c1c', 0.15)))
              : NONE;
  }
}
/** Colour of a part on an engraved plan (parchment, ink): the wash of the bed, hachured scarps with the shaded side darker,
 * reed signs in a marsh, the channel of low water, a dashed line along a dry bed. `wash`: the plan's water; `paper`: its dry
 * ditch tint; `edge`: its ink. */
export function moatPlanInk(part: MoatPart, kind: string, bucket: number, form: MoatForm, wash: string, paper: string, edge: string, town: MoatState = ''): MoatInk {
  const fill = moatFill(kind, bucket, form, mapSeasonState(), town),
    watery = fill === 'full' || fill === 'stagnant' || fill === 'ice';
  switch (part) {
    case 'bed':
      return watery ? solid(fill === 'ice' ? mix(wash, '#ffffff', 0.5) : wash) : solid(fill === 'low' || fill === 'tidal' || fill === 'marsh' ? mix(paper, wash, 0.3) : paper, 0.9);
    case 'channel':
      return fill === 'low' || fill === 'tidal' ? solid(wash) : NONE;
    case 'patch':
      return fill === 'marsh' ? solid(wash) : NONE;
    case 'hatch':
      return solid(edge, 0.7);
    case 'shade':
      return solid(edge, 0.3);
    case 'shadow':
      return solid(edge, 0.12);
    case 'reed':
      return fill === 'marsh' || fill === 'stagnant' ? solid(mix(edge, '#5a7a2c', 0.6), 0.9) : NONE;
    case 'dash':
      return watery || fill === 'low' || fill === 'tidal' ? NONE : solid(edge, 0.55);
    case 'plotA':
      return fill === 'garden' ? solid(mix(edge, '#5a7a2c', 0.6), 0.3) : NONE;
    case 'ridgeShade':
      return form.bankM ? solid(edge, 0.16) : NONE;
    default:
      return NONE;
  }
}

// ---------------------------------------------------------------- plan geometry
export interface MoatPartShape {
  part: MoatPart;
  /** Index of the piece in the list given to `moatParts`. */
  piece: number;
  /** Supply of the piece: `wet`, `dry` or `tidal`. */
  kind: string;
  bucket: number;
  shape: Shape;
}
/** Light of the plan shadows: they fall to the south-east (cityWalls shadowShift). */
const LIGHT = { x: 0.78, y: 0.62 };
const STEP = 7;
const edgeKey = (a: Point, b: Point): string => [`${Math.round(a.x * 20)},${Math.round(a.y * 20)}`, `${Math.round(b.x * 20)},${Math.round(b.y * 20)}`].sort().join('|');
/** Edges that two pieces share (tiles of one moat): no bank stands there. */
export function moatSharedEdges(pieces: readonly MoatPiece[]): Set<string> {
  const seen = new Set<string>(),
    shared = new Set<string>();
  for (const d of pieces)
    for (const ring of [d.shape?.outer ?? [], ...(d.shape?.holes ?? [])])
      for (let i = 0; i < ring.length; i++) {
        const k = edgeKey(ring[i], ring[(i + 1) % ring.length]);
        if (seen.has(k)) shared.add(k);
        else seen.add(k);
      }
  return shared;
}
export const moatBankEdge = (shared: ReadonlySet<string>, a: Point, b: Point): boolean => !shared.has(edgeKey(a, b));

const signedArea = (r: readonly Point[]): number => r.reduce((s, p, i) => s + p.x * r[(i + 1) % r.length].y - r[(i + 1) % r.length].x * p.y, 0) / 2;
/** Inward of a piece along ring `ri` (0: its outer ring): +1 when it lies left of the edges, -1 right. */
export const moatInward = (ring: readonly Point[], ri: number): number => (signedArea(ring) > 0 ? 1 : -1) * (ri ? -1 : 1);
const blob = (c: Point, r: number, k: number, stretch = 1): Point[] =>
  Array.from({ length: 7 }, (_, i) => ({ x: c.x + Math.cos((i * Math.PI * 2) / 7) * r * stretch * (0.7 + 0.6 * hash(c.x, c.y, k + i)), y: c.y + Math.sin((i * Math.PI * 2) / 7) * r * (0.7 + 0.6 * hash(c.y, c.x, k + i)) }));
const toPath = (p: Point, path: readonly Point[]): number => {
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i],
      dx = path[i + 1].x - a.x,
      dy = path[i + 1].y - a.y,
      l = dx * dx + dy * dy,
      t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
    best = Math.min(best, (a.x + t * dx - p.x) ** 2 + (a.y + t * dy - p.y) ** 2);
  }
  return Math.sqrt(best);
};
/** Which edges of a piece are its counterscarp (the bank away from the curtain `path`): per ring, per edge. Without a
 * path every edge counts. */
export function moatOuterEdges(d: MoatPiece, path?: readonly Point[]): boolean[][] {
  const rings = [d.shape.outer, ...(d.shape.holes ?? [])];
  if (!path || path.length < 2) return rings.map(r => r.map(() => true));
  const far = rings.map(r => r.map((a, i) => toPath({ x: (a.x + r[(i + 1) % r.length].x) / 2, y: (a.y + r[(i + 1) % r.length].y) / 2 }, path))),
    all = far.flat(),
    mid = (Math.min(...all) + Math.max(...all)) / 2;
  return far.map(r => r.map(v => v > mid));
}

/** Breadth of a piece (m): the distance from its counterscarp to its scarp (`counterscarp`: moatOuterEdges with the
 * curtain). The towers that jut into a ditch and its ragged outer edge lengthen its outline, so area over half the
 * perimeter reads a 12 m ditch as 7 m: that formula only serves a piece whose two banks are not told apart. */
export function moatWidth(d: MoatPiece, counterscarp?: readonly (readonly boolean[])[]): number {
  const rings = [d.shape.outer, ...(d.shape.holes ?? [])],
    scarp: number[] = [],
    samples: Point[] = [];
  let perimeter = 0;
  rings.forEach((r, ri) =>
    r.forEach((a, i) => {
      const b = r[(i + 1) % r.length];
      perimeter += Math.hypot(b.x - a.x, b.y - a.y);
      if (!counterscarp?.[ri]?.[i]) scarp.push(a.x, a.y, b.x, b.y);
      else samples.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }),
  );
  if (samples.length >= 2 && scarp.length >= 8) {
    // At most 64 soundings across the ditch.
    const every = Math.ceil(samples.length / 64),
      across = samples
        .filter((_, i) => i % every === 0)
        .map(p => {
          let best = Infinity;
          for (let k = 0; k < scarp.length; k += 4) {
            const dx = scarp[k + 2] - scarp[k],
              dy = scarp[k + 3] - scarp[k + 1],
              l = dx * dx + dy * dy,
              t = l ? Math.max(0, Math.min(1, ((p.x - scarp[k]) * dx + (p.y - scarp[k + 1]) * dy) / l)) : 0;
            best = Math.min(best, (scarp[k] + t * dx - p.x) ** 2 + (scarp[k + 1] + t * dy - p.y) ** 2);
          }
          return Math.sqrt(best);
        })
        .sort((a, b) => a - b);
    // Towers and the ends of the piece only ever shorten a sounding: the upper quartile is the breadth of the open ditch.
    return across[Math.min(across.length - 1, Math.floor(0.75 * across.length))];
  }
  const area = Math.abs(signedArea(rings[0])) - rings.slice(1).reduce((s, h) => s + Math.abs(signedArea(h)), 0);
  return (2 * area) / Math.max(1, perimeter);
}

/** The plan parts of a circuit's ditch pieces, in draw order. `path`: the curtain, which tells the counterscarp from the scarp. */
export function moatParts(pieces: readonly MoatPiece[], form: MoatForm, path?: readonly Point[]): MoatPartShape[] {
  const shared = moatSharedEdges(pieces),
    out = new Map<MoatPart, MoatPartShape[]>(MOAT_PARTS.map(p => [p, []]));
  for (const [piece, d] of pieces.entries()) {
    const outer = d.shape?.outer;
    if (!outer || outer.length < 3) continue;
    const holes = (d.shape.holes ?? []).filter(h => h.length >= 3),
      kind = d.kind,
      bucket = moatBucket(outer),
      add = (part: MoatPart, ring: Point[]): void => void out.get(part)!.push({ part, piece, kind, bucket, shape: { outer: ring, holes: [] } });
    out.get('bed')!.push({ part: 'bed', piece, kind, bucket, shape: d.shape });
    const counterscarp = moatOuterEdges({ ...d, shape: { outer, holes } }, path),
      width = moatWidth({ ...d, shape: { outer, holes } }, path ? counterscarp : undefined),
      half = width / 2,
      depth = moatDepth(d, form),
      scarp = moatScarp(form, depth, width),
      verge = Math.max(0.6, Math.min(2.5, 0.12 * width)),
      free = Math.max(0, half - scarp - verge),
      wave = Math.max(40, 6 * width),
      phase = 2.1 * bucket + 6.28 * hash(outer[0].x, outer[0].y);
    let plot = 0;
    [outer, ...holes].forEach((ring, ri) => {
      const turn = moatInward(ring, ri),
        n = ring.length;
      let s = 0,
        last: { n: Point; fringe: number; shoal: number; scarp: number; shadow: number; centre?: number } | undefined;
      for (let i = 0; i < n; i++) {
        const a = ring[i],
          b = ring[(i + 1) % n],
          l = Math.hypot(b.x - a.x, b.y - a.y),
          s0 = s;
        s += l;
        if (l < 1e-6 || !moatBankEdge(shared, a, b)) {
          last = undefined;
          continue;
        }
        const nx = (-(b.y - a.y) / l) * turn,
          ny = ((b.x - a.x) / l) * turn,
          far = counterscarp[ri][i],
          facing = nx * LIGHT.x + ny * LIGHT.y,
          side: MoatPart = facing > 0.25 ? 'shade' : facing < -0.25 ? 'lit' : 'bank',
          k = Math.max(1, Math.ceil(l / STEP)),
          at = (j: number, w: number): Point => ({ x: a.x + ((b.x - a.x) * j) / k + nx * w, y: a.y + ((b.y - a.y) * j) / k + ny * w }),
          bend = (j: number): number => Math.sin(((s0 + (l * j) / k) * 2 * Math.PI) / wave + phase),
          ragged = (j: number): number => scarp + verge * (0.35 + 1.1 * hash(a.x + ((b.x - a.x) * j) / k, a.y + ((b.y - a.y) * j) / k)),
          // Shoals lie on alternate banks, so the free water winds between them.
          shoal = (j: number): number => scarp + verge + free * Math.max(0, 0.1 + 0.8 * (0.5 + 0.5 * (far ? 1 : -1) * bend(j))),
          centre = (j: number): number => half + 0.35 * free * bend(j),
          // The shaded scarp throws its shadow on the bed.
          shadow = Math.min(scarp + 0.6 * depth, 0.4 * width),
          strip = (part: MoatPart, w0: (j: number) => number, w1: (j: number) => number, from = 0, to = k): void => {
            for (let j = from; j < to; j++) add(part, [at(j, w0(j)), at(j + 1, w0(j + 1)), at(j + 1, w1(j + 1)), at(j, w1(j))]);
          },
          corner = (part: MoatPart, before: number, now: number): void => add(part, [a, { x: a.x + last!.n.x * before, y: a.y + last!.n.y * before }, at(0, now)]);
        // The corner between two bank edges: one wedge closes the gap their bands leave on a reflex turn.
        if (last) {
          corner('fringe', last.fringe, ragged(0));
          corner('shoal', last.shoal, shoal(0));
          corner(side, last.scarp, scarp);
          if (side === 'shade') corner('shadow', last.shadow || scarp, shadow);
        }
        strip('fringe', () => 0, ragged);
        if (free > 1) strip('shoal', () => scarp, shoal);
        if (side === 'shade') add('shadow', [a, b, at(k, shadow), at(0, shadow)]);
        add(side, [a, b, at(k, scarp), at(0, scarp)]);
        // Hachures down both scarps, longer on the shaded one.
        const stroke = Math.min(0.45 * width, (side === 'shade' ? 1.5 : 1) * Math.max(1.4, scarp + 0.2 * depth)),
          thick = (0.3 * k) / l;
        for (let j = 0; j < k; j++) for (const f of [0.25, 0.75]) add('hatch', [at(j + f - thick, 0.1), at(j + f + thick, 0.1), at(j + f + thick, stroke), at(j + f - thick, stroke)]);
        if (far) {
          // Along the middle, from the counterscarp only: the channel of low water, the path or drain of a dry bed, its dashes.
          if (free > 1) {
            const reach = Math.max(0.8, 0.11 * width);
            if (last?.centre !== undefined)
              for (const [part, hw] of [
                ['channel', reach],
                ['track', 0.7],
              ] as const)
                add(part, [{ x: a.x + last.n.x * (last.centre - hw), y: a.y + last.n.y * (last.centre - hw) }, at(0, centre(0) - hw), at(0, centre(0) + hw), { x: a.x + last.n.x * (last.centre + hw), y: a.y + last.n.y * (last.centre + hw) }]);
            strip(
              'channel',
              j => centre(j) - reach * (0.8 + 0.4 * hash(a.x + j, a.y, i)),
              j => centre(j) + reach * (0.8 + 0.4 * hash(a.y + j, a.x, i)),
            );
            strip(
              'track',
              j => centre(j) - 0.7,
              j => centre(j) + 0.7,
            );
            for (let j = 0; j < k; j += 2)
              strip(
                'dash',
                q => centre(q) - 0.6,
                q => centre(q) + 0.6,
                j,
                j + 1,
              );
          }
          // The outer bank: its inner slope faces the ditch, its outer slope the country.
          if (form.bankM && side !== 'bank') {
            const w = form.bankM[0];
            add(side === 'shade' ? 'ridgeShade' : 'ridgeLit', [a, b, at(k, -w / 2), at(0, -w / 2)]);
            add(side === 'shade' ? 'ridgeLit' : 'ridgeShade', [at(0, -w / 2), at(k, -w / 2), at(k, -w), at(0, -w)]);
          }
        }
        // Plots from each bank to the path along the middle: two beds in three, a balk between them.
        const p0 = scarp + 0.4,
          p1 = half - 0.9;
        if (p1 - p0 > 0.8 && l / k > 2.5) for (let j = 0; j < k; j++, plot++) if (plot % 3 < 2) add(plot % 3 ? 'plotB' : 'plotA', [at(j + 0.08, p0), at(j + 0.92, p0), at(j + 0.92, p1), at(j + 0.08, p1)]);
        for (let j = 0; j < k; j++) {
          const h = hash(a.x + j, a.y - j, i),
            // A blob `off` m inside this edge stays inside the piece when it is as far from the ends of the edge.
            clear = (off: number): boolean => Math.min(j + 0.5, k - j - 0.5) * (l / k) >= off;
          // Reed clumps on the verge, lilies off it, patches further in where the bed has room.
          if (h < 0.42 && clear(scarp + 2 * verge)) add('reed', blob(at(j + 0.2 + h, scarp + verge * (0.3 + h)), 0.7 + 2 * h, i + j, 1.6));
          if (free > 1.5 && h > 0.3 && h < 0.62 && clear(scarp + verge + free)) for (const q of [0, 1]) add('lily', blob(at(j + 0.3 + 0.4 * q, scarp + verge + 0.6 + hash(a.x + q, a.y + j, i) * (free - 0.6)), 0.5 + 0.5 * h, i + j + q));
          if (free > 1.2 && h > 0.62) {
            const r = Math.min(free * 0.8, 0.9 + (h - 0.62) * 0.3 * width),
              off = scarp + verge + r + hash(a.y + j, a.x, i) * Math.max(0, free - r);
            if (clear(off + r)) add('patch', blob(at(j + 0.5, off), r, i + j, 1.4));
          }
        }
        last = { n: { x: nx, y: ny }, fringe: ragged(k), shoal: free > 1 ? shoal(k) : scarp, scarp, shadow: side === 'shade' ? shadow : 0, centre: far && free > 1 ? centre(k) : undefined };
      }
    });
  }
  return MOAT_PARTS.flatMap(part => out.get(part)!);
}
