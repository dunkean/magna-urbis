/**
 * Moats: one model for the 2D plans, the 3D ground and its water, and City Bench.
 *
 * - Form (how the ditch is cut) is data of the engine: the `moats` table of fortifications.json, whose id the engine sends
 *   per circuit (`enclosure.moat.form`): V-shaped dry ditch, earth-scarped moat, revetted flat-bottomed moat, double ditch...
 * - Supply is the engine's, per reach of a run (`MoatSpec.runs`): `fed` where a river, the sea or canals feed it, `pool` when a
 *   culture's wet moat has no source (rain water only), `dry` elsewhere.
 * - Fill is decided here, from supply, form, state of the town, climate zone and season of the map: a season change recolours
 *   the moat, it rebuilds no geometry. One fill per fed chain and per pool; dry reaches vary from one to the next.
 *
 * The plan parts themselves are built from the stations of the runs (moatLine.ts `moatPlan`). `moatInk` colours those parts
 * for a fill on natural grounds, `moatPlanInk` on engraved plans.
 */
import fortifications from '../../../rust/crates/core/src/urban/fortifications.json';
import type { MoatSpec, Shape } from '../../../rust/bridge/urban';
import type { ClimateZone } from '../../../rust/bridge/terrainClimate';
import { mapSeasonKey, mapSeasonState } from './seasonPalette';
import { dryDitchColour, waterBed } from './waterPalette';

export type { MoatSpec };
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
type Moated = { moat?: MoatSpec; style?: string };

/** Review hook (fill gallery of web/out/fix-v7): `globalThis.__muMoat = { fill, form, state }`, set before the town is built, forces them. */
type Forced = { fill?: MoatFill; form?: string; state?: MoatState };
const forced = (): Forced => (globalThis as { __muMoat?: Forced }).__muMoat ?? {};
/** The engine's moat record of a circuit. */
export const moatSpec = (e: Moated): MoatSpec | undefined => e.moat;

const FORMS = fortifications.moats as unknown as Record<string, MoatForm>,
  STYLE_FORMS = fortifications.styles as unknown as Record<string, { moatForm?: string }>;
/** The form of a circuit's ditch (an id of the `moats` table): the engine's, or the form of the wall style when the circuit names none. */
export const moatFormId = (e: Moated): string => forced().form ?? e.moat?.form ?? STYLE_FORMS[e.style ?? '']?.moatForm ?? 'earth';
export const moatFormOf = (id: string): MoatForm => FORMS[id] ?? FORMS.earth;
export const moatForm = (e: Moated): MoatForm => moatFormOf(moatFormId(e));
export const moatState = (e: Moated): MoatState => forced().state ?? ((e.moat?.state ?? '') as MoatState);

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
/** Run of a scarp (m) of a ditch `depth` deep and `width` wide: never past the middle. */
export const moatScarp = (form: MoatForm, depth: number, width: number): number => Math.max(0.5, Math.min(depth * form.scarp, 0.45 * width));
/** Rise of the outer bank `d` metres outside the counterscarp (m). */
export const moatBankRise = (form: MoatForm, d: number): number => (form.bankM && d > 0 && d < form.bankM[0] ? form.bankM[1] * Math.sin((Math.PI * d) / form.bankM[0]) : 0);

// ---------------------------------------------------------------- fill
export type MoatFill = 'bare' | 'grass' | 'garden' | 'marsh' | 'stagnant' | 'low' | 'full' | 'tidal' | 'ice';
export const MOAT_FILLS: readonly MoatFill[] = ['bare', 'grass', 'garden', 'marsh', 'stagnant', 'low', 'full', 'tidal', 'ice'];
export const MOAT_BUCKETS = 3;

const ARID = new Set<ClimateZone>(['desert', 'steppe', 'savanna', 'mediterranean']),
  SOAKED = new Set<ClimateZone>(['wetland', 'tropical']);
type SeasonState = ReturnType<typeof mapSeasonState>;
/** The state of a reach of ditch in the map's climate and season (a map without climate: brim-full or grassed).
 * `kind`: the supply, `wet`, `dry`, `pool` (no source: what rain and ground water leave) or `tidal` (a reach the sea fills and empties). */
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
/** A fill whose water covers the whole bed (the far plans draw it as water). */
export const moatSheetFull = (fill: MoatFill): boolean => fill === 'full' || fill === 'stagnant' || fill === 'ice';
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
/** Colour of the water of a reach (2D bed or channel, 3D sheet). `engraved`: on a plan in ink the water keeps the plan's wash. */
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

/** The plan parts of a moat (moatLine.ts `moatPlan`): `wash` the far bed in one tint; `bed`, `channel`, the scarps (`bank`,
 * `lit`, `shade`) and the outer bank ridge (`ridgeShade`, `ridgeLit`) of the standard views; the near-view detail (`fringe`,
 * `reed`, `patch` for marsh pools, and closest `lily`, `plotA`, `plotB`, `hatchFine`; `hatch` for the engraved plans);
 * `causeway`, the filled crossing over the ditch. */
export type MoatPart = 'wash' | 'bed' | 'plotA' | 'plotB' | 'channel' | 'patch' | 'fringe' | 'lily' | 'reed' | 'bank' | 'shade' | 'lit' | 'ridgeShade' | 'ridgeLit' | 'hatch' | 'hatchFine' | 'causeway';
/** Draw order. */
export const MOAT_PARTS: readonly MoatPart[] = ['wash', 'bed', 'plotA', 'plotB', 'channel', 'patch', 'fringe', 'lily', 'reed', 'bank', 'shade', 'lit', 'ridgeShade', 'ridgeLit', 'hatch', 'hatchFine', 'causeway'];
/** Parts whose look does not depend on the fill of their reach. */
export const MOAT_FIXED_PARTS: ReadonlySet<MoatPart> = new Set<MoatPart>(['bank', 'shade', 'lit', 'ridgeShade', 'ridgeLit', 'hatch', 'hatchFine', 'causeway']);
/** One plan part: `kind` and `bucket` are the reach's (`moatFill` inputs, moatLine.ts `reachSupply`). */
export interface MoatPartShape {
  part: MoatPart;
  kind: string;
  bucket: number;
  shape: Shape;
}
export interface MoatInk {
  fill?: string;
  alpha: number;
}
const NONE: MoatInk = { alpha: 0 };
const solid = (c: string, alpha = 1): MoatInk => ({ fill: c, alpha });
/** The inks of one season: a frame asks for the same few again and again. */
const inks = new Map<string, MoatInk>();
let inkSeason = '';
/** Colour of a part of a moat reach on a natural ground (satellite family, 3D plan texture). `water`: the town's water. */
export function moatInk(part: MoatPart, kind: string, bucket: number, form: MoatForm, water: string, town: MoatState = ''): MoatInk {
  const season = `${mapSeasonKey()}|${forced().fill ?? ''}`;
  if (season !== inkSeason) {
    inks.clear();
    inkSeason = season;
  }
  const key = `${part}|${kind}|${bucket}|${form.profile}|${form.revetment}|${form.double ? 1 : 0}|${form.bankM ? 1 : 0}|${water}|${town}`;
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
    case 'wash':
      return solid(moatSheetFull(fill) ? sheet : ground);
    case 'causeway':
      return solid(mix(ground, '#7a6844', 0.25));
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
    case 'hatchFine':
      return NONE;
    case 'channel':
      // The ridge between the two ditches of a double ditch catches the light.
      if (form.double && (fill === 'grass' || fill === 'bare')) return solid(snowy(mix(ground, '#fff4d2', 0.3)));
      return fill === 'low' || fill === 'tidal' || fill === 'marsh' ? solid(sheet) : NONE;
    case 'patch':
      // The open pools of a marsh.
      return fill === 'marsh' ? solid(sheet) : NONE;
    case 'plotA':
      return fill === 'garden' ? solid(snowy('#4f7a2e')) : NONE;
    case 'plotB':
      return fill === 'garden' ? solid(snowy('#7d5f3c')) : NONE;
    case 'reed':
      return fill === 'bare' || fill === 'ice' || fill === 'garden' ? NONE : fill === 'grass' ? solid(snowy(mix(ground, '#2f4a1e', 0.5))) : solid(fill === 'tidal' ? mix(mud, '#3e3b2c', 0.5) : reed);
    case 'lily':
      return fill === 'full' ? solid('#7f9a58') : fill === 'stagnant' ? solid('#b4c466') : NONE;
    case 'fringe':
      return fringe(fill, sheet, mud, earth, ground, snowy);
    case 'bed':
      return bed(fill, bucket, sheet, mud, earth, ground, snowy);
  }
}
/** The bed of a fill: water, mud, reed bed, kitchen plots, bare earth or grass. */
function bed(fill: MoatFill, bucket: number, sheet: string, mud: string, earth: string, ground: string, snowy: (c: string) => string): MoatInk {
  switch (fill) {
    case 'full':
    case 'stagnant':
    case 'ice':
      return solid(sheet);
    case 'low':
      return solid(mud);
    case 'tidal':
      return solid(mix(mud, '#4d5350', 0.5));
    case 'marsh':
      return solid(snowy(mix(ground, '#3d4630', 0.6)));
    case 'garden':
      return solid(snowy(mix(ground, '#7a6844', 0.3)));
    case 'bare':
      return solid(snowy(mix(earth, '#1c1812', 0.18)));
    default:
      // Grass: grazed short in one reach, left wild in the next.
      return solid(snowy(bucket === 1 ? mix(ground, '#2c3c1c', 0.3) : mix(ground, '#7f9a4a', 0.22)));
  }
}
/** The fringe at the foot of the banks: a weed rim, an algae rim, dried mud, snow drifted against the banks on ice... */
function fringe(fill: MoatFill, sheet: string, mud: string, earth: string, ground: string, snowy: (c: string) => string): MoatInk {
  switch (fill) {
    case 'full':
      return solid(mix(sheet, '#64743f', 0.5));
    case 'stagnant':
      return solid(mix(sheet, '#6a7a3c', 0.7));
    case 'low':
      return solid(mix(mud, '#c2ab80', 0.7));
    case 'tidal':
      return solid(mix(mud, '#35342a', 0.45));
    case 'ice':
      return solid('#f1f4f4');
    case 'marsh':
      return solid(snowy(mix(ground, '#566a30', 0.5)));
    case 'bare':
      return solid(snowy(mix(earth, '#d9c9a4', 0.25)));
    case 'grass':
      return solid(snowy(mix(ground, '#2c3c1c', 0.15)));
    default:
      return NONE;
  }
}
/** Colour of a part on an engraved plan (parchment, ink): the wash of the bed and the shaded scarp in ink at a low alpha; closer,
 * hachures down both scarps and reed signs in a marsh. `wash`: the plan's water; `paper`: its dry ditch tint; `edge`: its ink. */
export function moatPlanInk(part: MoatPart, kind: string, bucket: number, form: MoatForm, wash: string, paper: string, edge: string, town: MoatState = ''): MoatInk {
  const fill = moatFill(kind, bucket, form, mapSeasonState(), town);
  switch (part) {
    case 'wash':
    case 'bed':
      return moatSheetFull(fill) ? solid(fill === 'ice' ? mix(wash, '#ffffff', 0.5) : wash) : solid(fill === 'low' || fill === 'tidal' || fill === 'marsh' ? mix(paper, wash, 0.3) : paper, 0.9);
    case 'shade':
      return solid(edge, 0.3);
    // Light strokes: they shade the scarps, never bar the ditch.
    case 'hatch':
      return solid(edge, 0.45);
    case 'hatchFine':
      return solid(edge, 0.35);
    case 'reed':
      return fill === 'marsh' ? solid(mix(edge, '#5a7a2c', 0.6), 0.9) : NONE;
    case 'causeway':
      return solid(paper, 0.9);
    default:
      return NONE;
  }
}
