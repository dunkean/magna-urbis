/**
 * Look of the town plan: the palettes and the paint of the footprint, the blocks, the parcels, the quays and the walls.
 *
 * Part of the town's look (city/look.ts). Each rule returns the ordered paint operations of one element for one frame
 * state (`PlanFrame`: view, level of detail, palette, ground blend, season); widths are CSS pixels. The
 * Canvas town (cityCanvas.ts drawCitySteps) turns each operation into one batched fill or stroke; the GPU town
 * (cityGlStyle.ts) folds the same operations into its per-feature colour tables. Neither holds a colour of its own.
 */
import type { Shape } from '../../../../rust/bridge/urban';
import type { CityBlock, CityDistrict, CityLayers, CityLod, CityPalette, CityParcel, CityView } from './model/contract';
import { groundRoadLook, type RoadLook } from '../composition';
import { blendLine, blendTone, blendsGround, groundWash, isBlended, naturalGroundWash, type BlendTone, type Wash, type WashKind } from '../groundBlend';
import { washAt } from '../groundTone';
import { nightRoof } from '../cityNight';
import { URBAN_SNOW, mapGroundSnow, mapLandSnow } from '../seasonPalette';
import { funeraryLandFill } from '../cityRoles';
import { urbanFunctionColor } from '../urbanBuildingStyle';
import { harbourPaint, harbourShown, type HarbourPaint } from '../harbourStyle';
import { CITY_LOD_LIMITS, atLeast } from './levels';
import { PAINTED_YARD, paintedPlan, type PlanPath } from './planPath';

// ---------------------------------------------------------------- palettes
export const ZONE_COLORS: Record<string, string> = { core: '#dfb973', middle: '#bfa4ca', edge: '#91bdc5', faubourg: '#a0bc84', village: '#dfb973' };
export const ATLAS = ['#dfb973', '#90bdc7', '#c5a3ce', '#a0bc84', '#d29c8e', '#bdc4d5'];
export const PAPER = '#f2ead8';
/** Parchment plan, matched to the parchment map background (render/styles.ts PARCHMENT and its urban colours): ink
 * outlines, ochre hatched blocks, light lots, pale streets between dark ink casings, dark ink masses. */
export const PARCH = {
  ink: '#4e3b28',
  inkSoft: '#5a4530',
  block: '#e2cf9f',
  hatch: '#6b5236',
  lot: '#ece0bf',
  yard: '#e6d6a8',
  garden: '#d3cf98',
  place: '#d5cdb7',
  market: '#d9c9a1',
  common: '#cdd097',
  reserve: '#d8c79a',
  footprint: '#d9c393',
  street: '#ebdeba',
  streetEdge: '#5e4a34',
  bridge: '#ece0bc',
  ford: '#bccbc8',
  quay: '#dccfa8',
  mass: '#4a3826',
  landmark: '#7d5f40',
  wall: '#3b2c1c',
  wallFill: '#6b5540',
  tower: '#4e3b28',
};
/** The parchment plan under the snow of the date: its grounds whiten, its ink stays. */
/** Share of that snow each ground keeps: squares, markets and yards are trodden, gardens and unused land are not. */
const PARCH_GROUNDS = { block: 0.6, lot: 0.65, yard: 0.5, garden: 0.9, place: 0.35, market: 0.3, common: 1, reserve: 1, footprint: 0.6 } as const;
let snowedParch: { snow: number; table: typeof PARCH } | undefined;
function parchPlan(): typeof PARCH {
  const snow = mapGroundSnow();
  if (!(snow > 0)) return PARCH;
  if (snowedParch?.snow !== snow) snowedParch = { snow, table: { ...PARCH, ...Object.fromEntries(Object.entries(PARCH_GROUNDS).map(([k, kept]) => [k, mix(PARCH[k as keyof typeof PARCH_GROUNDS], '#f3f4ef', 0.72 * snow * kept)])) } };
  return snowedParch.table;
}
/** Night plan grounds, matched to render/styles.ts PALETTES.night urban colours and buildingColors (dark slate blocks under dark masses). */
const NIGHT_PLAN = { ink: '#04060e', inkSoft: '#04060e', block: '#182038', lot: '#1d2640', yard: '#141a2c', garden: '#14281f', place: '#2e2b30', market: '#3d372b', common: '#162a30', reserve: '#1a2236', footprint: '#18203a' };
export const DISTRICT_COLORS: Record<string, string> = {
  shanty: '#b69274',
  civic: '#d9a55b',
  market: '#e8c35f',
  religious: '#b79bd1',
  craft: '#cf9270',
  port: '#7eb2cc',
  elite: '#d98c8c',
  commoner: '#dccaa2',
  poor: '#b9ae98',
  garrison: '#919c89',
  gardens: '#a6c28a',
  foreign: '#9cc6b6',
};
export const FAMILY_COLORS: Record<string, string> = { worship: '#7a54a8', commerce: '#c8862a', craft: '#a2513a', civic: '#356fa3', defence: '#4a505b', dwelling: '#8b7761', garden: '#5c9a4b' };
const FAMILY_ALIASES: Record<string, string> = {
  religious: 'worship',
  religion: 'worship',
  temple: 'worship',
  market: 'commerce',
  trade: 'commerce',
  shop: 'commerce',
  inn: 'commerce',
  military: 'defence',
  defense: 'defence',
  garrison: 'defence',
  fort: 'defence',
  housing: 'dwelling',
  domestic: 'dwelling',
  residential: 'dwelling',
  house: 'dwelling',
  gardens: 'garden',
  green: 'garden',
  open: 'garden',
  open_space: 'garden',
  institution: 'civic',
  public: 'civic',
  industry: 'craft',
  workshop: 'craft',
};
const FUNCTION_FAMILY: Record<string, string> = { domestic: 'dwelling', mixed: 'commerce', workshop: 'craft', warehouse: 'commerce', collective: 'civic', open_space: 'garden', market: 'commerce', common: 'garden' };
/** District role id (`craft:tanners` → craft). */
export const districtRoleKey = (role?: string): string | undefined => role?.split(/[.:/]/)[0]?.toLowerCase() || undefined;
/** Role family of a building: `worship.parish` → worship; the function when no role is known. */
export function roleFamily(role?: string | null, fn?: string): string {
  const head = role?.split(/[.:/]/)[0]?.toLowerCase();
  if (head && FAMILY_COLORS[head]) return head;
  if (head && FAMILY_ALIASES[head]) return FAMILY_ALIASES[head];
  return FUNCTION_FAMILY[fn ?? ''] ?? 'dwelling';
}
/** '#rrggbb' mix of two '#rrggbb' colours. */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16),
    pb = parseInt(b.slice(1), 16),
    c = (s: number): number => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `#${((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, '0')}`;
}
/** Colour of a district role, paler for a poor district. */
const districtColor = (d: CityDistrict | undefined, fallback: string): string => {
  const base = DISTRICT_COLORS[districtRoleKey(d?.role) ?? ''] ?? fallback;
  return d?.wealth === undefined ? base : mix(base, PAPER, Math.max(0, 0.45 - d.wealth * 0.45));
};
const growthColor = (zone: string): string => ZONE_COLORS[zone] ?? ZONE_COLORS.core;
/** Trodden snow mixed with earth: busy streets and squares in winter. */
export const SLUSH = 'rgb(124,117,106)';
/** Ink hatching of the parchment plan: lines along x + y = const every `periodPx`, `widthPx` wide, in screen pixels
 * (the Canvas town tiles it, the GPU town computes it per fragment). */
export const PARCHMENT_HATCH = { color: PARCH.hatch, alpha: 0.42, periodPx: 7, widthPx: 0.8 } as const;

// ---------------------------------------------------------------- paint operations
/** One fill or stroke of an element, in draw order. A fill and a stroke in one operation share its `alpha`. */
export interface PaintOp {
  fill?: string;
  stroke?: string;
  /** Stroke width, CSS px. */ widthPx?: number;
  alpha?: number;
  cap?: 'round' | 'butt';
  /** The fill is the parchment hatching (PARCHMENT_HATCH) instead of a colour. */ hatch?: true;
  /** A square or a market: textured materials replace the fill colour with the paving material. */ plaza?: boolean;
  /** The stroke is the wide, faint feather of a wash's edge, not an outline. */ feather?: true;
  /** Paved square of the render background (planPath): the paved pass draws setts over the fill. */ paved?: boolean;
}

/** The trodden snow of a square: as much as the town ground under its middle holds (mapLandSnow), never more. */
function pushSlush(ops: PaintOp[], outer: readonly { x: number; y: number }[]): void {
  if (!outer.length) return;
  let x = 0,
    y = 0;
  for (const q of outer) {
    x += q.x;
    y += q.y;
  }
  const snow = mapLandSnow(x / outer.length, y / outer.length, URBAN_SNOW);
  if (snow > 0) ops.push({ fill: SLUSH, alpha: 0.3 * snow });
}

// ---------------------------------------------------------------- frame state
interface PlanFrameInput {
  view: CityView;
  lod: CityLod;
  palette: CityPalette;
  layers: CityLayers;
  /** Plan line width setting (CSS px). */ width: number;
  night?: boolean;
  /** Blended ground and streets; default: the shared setting (groundBlend.ts). */ groundBlend?: boolean;
  /** Unlit physical albedo tile (3D ground): earth washes, no lines. */ materialGround?: boolean;
  roadLook?: RoadLook;
  /** Texture images are in hand: squares and markets take the paving material. */ textured?: boolean;
  /** The frame is the GPU plan renderer's (planPath.ts lists what it reads differently). */ planPath?: PlanPath;
}
/** What every plan rule of a frame reads. */
interface PlanFrame extends PlanFrameInput {
  parchment: boolean;
  night: boolean;
  /** Parchment or night: the plan takes the table colours `C`. */ tabled: boolean;
  C: typeof NIGHT_PLAN;
  material: boolean;
  /** The plan lies on a natural ground (terrain palette, natural or rendered roads, material ground). */ naturalGround: boolean;
  /** Translucent washes instead of opaque fills and outlines. */ blend: boolean;
  tone: BlendTone;
  softLine: Wash;
  outline: string;
  /** Plan line width, CSS px. */ lineWidthPx: number;
  /** Natural ground by day: squares and markets are trodden where the land under them is snowed (pushSlush). */ slush: boolean;
  wash(kind: WashKind, shape: Shape): Wash;
}
/** Plan line width for the width setting (CSS px). */
export const planLineWidthPx = (width: number): number => Math.max(0.2, width);
export function planFrame(o: PlanFrameInput): PlanFrame {
  const parchment = o.palette === 'parchment',
    night = !!o.night,
    material = !!o.materialGround;
  const naturalGround = material || o.palette === 'terrain' || groundRoadLook(o.roadLook);
  const blend = material || ((o.groundBlend ?? isBlended()) && (naturalGround ? o.view !== 'uses' && o.view !== 'roles' : blendsGround(o.view, o.palette)));
  const tone: BlendTone = material ? 'earth' : blendTone(o.palette);
  return {
    ...o,
    parchment,
    night,
    tabled: parchment || night,
    C: night ? NIGHT_PLAN : parchment ? parchPlan() : PARCH,
    material,
    naturalGround,
    blend,
    tone,
    softLine: blendLine(tone),
    outline: night ? NIGHT_PLAN.ink : o.palette === 'ink' ? '#3c3024' : parchment ? PARCH.inkSoft : '#655847',
    lineWidthPx: planLineWidthPx(o.width),
    // Squares and markets of a snowed town are trodden like its main streets (natural grounds only).
    slush: naturalGround && !night && !o.planPath,
    wash(kind, shape) {
      if (material) {
        const w = groundWash(kind, 'earth');
        return { color: w.color, alpha: Math.min(0.8, w.alpha * 1.8) };
      }
      const raw = washAt(kind, tone, shape),
        w = naturalGround && !o.planPath ? naturalGroundWash(raw, kind) : raw;
      return night ? { ...w, color: nightRoof(w.color, parchment) } : w;
    },
  };
}

// ---------------------------------------------------------------- footprint (far)
/** Far level: the urban footprint as one tint (a wash when blended), hatched on parchment. Empty when blocks are off. */
export function footprintOps(f: PlanFrame, shape: Shape): PaintOp[] {
  if (!f.layers.blocks) return [];
  if (f.blend) {
    const w = f.wash('footprint', shape);
    return [
      { stroke: w.color, widthPx: 2.2, alpha: w.alpha * 0.35, feather: true },
      { fill: w.color, alpha: w.alpha },
    ];
  }
  const ops: PaintOp[] = [{ fill: f.palette === 'terrain' ? undefined : f.tabled ? f.C.footprint : '#cfb589', stroke: f.tabled ? f.C.ink : '#7b6446', widthPx: 1, alpha: 0.9 }];
  if (f.parchment && !f.night) ops.push({ hatch: true });
  return ops;
}

// ---------------------------------------------------------------- blocks
const isPlaza = (kind: string): boolean => kind === 'place' || kind === 'market';
/** Blocks: palette, district role, or the ground under buildings. Undefined: the block's layer is off. `hideLotLines`:
 * the block's culture outlines no lot (catalogue `render.plotLines: false`); squares and commons keep their edge. */
export function blockOps(f: PlanFrame, b: CityBlock, hideLotLines: boolean | undefined): PaintOp[] | undefined {
  const { view, lod, palette, layers, parchment, night, C } = f,
    reserve = b.kind.startsWith('reserve');
  if (reserve ? !layers.domains : !layers.blocks) return undefined;
  const blockLine = layers.planLines !== false && (b.kind === 'place' || b.kind === 'common' || !hideLotLines),
    painted = paintedPlan(f.planPath, palette);
  let fill: string | undefined;
  if (palette === 'terrain' && view !== 'roles' && (!f.blend || f.planPath)) fill = undefined;
  else if (reserve) fill = f.tabled ? C.reserve : '#cbc2a8';
  else if (b.kind === 'common') fill = f.tabled ? C.common : '#adc5bf';
  else if (b.kind === 'place') fill = f.tabled ? C.place : '#e8d6ae';
  else if (view === 'roles') fill = districtColor(b.district, growthColor(b.zone));
  else if (view === 'buildings') fill = f.tabled ? C.yard : lod === 'mid' ? mix(districtColor(b.district, growthColor(b.zone)), PAPER, 0.35) : painted ? mix(districtColor(b.district, growthColor(b.zone)), PAINTED_YARD.earth, PAINTED_YARD.share) : '#ece2cb';
  else if (night) fill = C.block;
  else if (palette === 'ink') fill = '#e3d1b5';
  else if (parchment) fill = C.block;
  else fill = palette === 'atlas' ? ATLAS[b.quarter % ATLAS.length] : growthColor(b.zone);
  const stroke = (view === 'buildings' && lod !== 'close') || !blockLine ? undefined : f.outline;
  if (f.blend && fill) {
    // Blended: one translucent wash (a wider low-alpha stroke of the same colour feathers the edge), faint lot lines only up close.
    const w = f.wash(reserve ? 'reserve' : b.kind === 'common' ? 'common' : b.kind === 'place' ? 'place' : 'block', b.shape),
      a = w.alpha * (b.peripheral && view !== 'buildings' ? 0.7 : 1),
      ops: PaintOp[] = [];
    if (!f.textured || !isPlaza(b.kind)) ops.push({ stroke: w.color, widthPx: 2.2, alpha: a * 0.4, cap: 'round', feather: true });
    ops.push({ fill: w.color, plaza: isPlaza(b.kind), alpha: a });
    if (f.slush && b.kind === 'place') pushSlush(ops, b.shape.outer);
    if (lod === 'close' && !f.material && blockLine) ops.push({ stroke: f.softLine.color, widthPx: 0.5, alpha: f.softLine.alpha });
    return ops;
  }
  const ops: PaintOp[] = [
    {
      fill,
      plaza: isPlaza(b.kind),
      paved: painted && b.kind === 'place' && lod === 'close',
      stroke: stroke ?? (blockLine && parchment && b.kind === 'place' ? PARCH.inkSoft : undefined),
      widthPx: f.lineWidthPx,
      alpha: b.peripheral && view !== 'buildings' ? 0.6 : 1,
    },
  ];
  // Parchment: built blocks hatched in ink, as on the engraved plans.
  if (parchment && !night && !f.blend && !reserve && b.kind !== 'common' && b.kind !== 'place' && view !== 'roles') ops.push({ hatch: true, alpha: view === 'buildings' ? 0.5 : 1 });
  return ops;
}

// ---------------------------------------------------------------- parcels
const BUILT = new Set(['plot', 'compound', 'residual', 'court']),
  OPEN = new Set(['place', 'market', 'common']);
/** Level from which the parcels of a view are drawn: cadastral detail from near; uses and roles from mid. */
export const parcelsShown = (f: Pick<PlanFrame, 'view' | 'lod' | 'layers'>): boolean => f.layers.parcelOverlay !== false && atLeast(f.lod, f.view === 'uses' || f.view === 'roles' ? 'mid' : 'near') && f.view !== 'tissue';
/** Parcels of the frame's view. Undefined: the parcel's layer is off (not counted as drawn). */
export function parcelOps(f: PlanFrame, p: CityParcel, hideLotLines: boolean | undefined): PaintOp[] | undefined {
  const { view, lod, palette, layers, parchment, night, C } = f,
    use = p.use;
  const built = BUILT.has(use),
    open = OPEN.has(use);
  // A culture without lot limits (`hideLotLines`) leaves its lots unoutlined; squares keep their edge.
  const lotLine = layers.planLines !== false && (open || !hideLotLines);
  if (!((built && layers.parcels) || (use === 'garden' && layers.gardens) || (open && layers.places) || (use === 'reserve' && layers.domains))) return undefined;
  const burialFill = funeraryLandFill(p.allocation?.role);
  const openFill =
    burialFill ??
    (f.tabled
      ? use === 'garden'
        ? C.garden
        : use === 'reserve'
          ? C.reserve
          : use === 'common'
            ? C.common
            : use === 'market'
              ? C.market
              : use === 'place'
                ? C.place
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
  const ops: PaintOp[] = [];
  if (f.blend && (view === 'parcels' || view === 'buildings')) {
    const kind: WashKind = use === 'garden' ? 'garden' : use === 'reserve' ? 'reserve' : use === 'common' ? 'common' : use === 'market' ? 'market' : use === 'place' ? 'place' : 'parcel';
    const w = f.wash(kind, p.shape),
      a = w.alpha * (p.peripheral ? 0.7 : 1),
      ground = kind === 'parcel' || kind === 'reserve';
    // Plain lots add no wash over the block's (the buildings stand on it); gardens, commons and squares stack theirs.
    if (!(view === 'buildings' && ground)) ops.push({ fill: burialFill ?? w.color, plaza: !burialFill && isPlaza(use), alpha: burialFill ? 0.85 : a });
    if (f.slush && isPlaza(use)) pushSlush(ops, p.shape.outer);
    if (lod === 'close' && !f.material && lotLine) ops.push({ stroke: f.softLine.color, widthPx: 0.5, alpha: f.softLine.alpha * (ground ? 0.8 : 1) });
  } else if (view === 'parcels') {
    const fill = palette === 'terrain' ? undefined : night ? (openFill ?? C.lot) : palette === 'ink' ? '#eee0c9' : parchment ? (openFill ?? C.lot) : (openFill ?? (palette === 'atlas' ? ATLAS[p.index % ATLAS.length] : growthColor(p.zone)));
    ops.push({ fill, plaza: isPlaza(use), stroke: atLeast(lod, 'near') && lotLine ? f.outline : undefined, widthPx: f.lineWidthPx, alpha: p.peripheral ? 0.65 : 1 });
  } else if (view === 'uses') {
    if (p.allocation) {
      const c = urbanFunctionColor(p.allocation.function);
      ops.push({ fill: c, alpha: 0.62 }, { stroke: c, widthPx: 0.55 });
    } else if (openFill) ops.push({ fill: openFill });
  } else if (view === 'roles') {
    const family = p.allocation ? roleFamily(p.allocation.role, p.allocation.function) : open ? 'commerce' : use === 'garden' ? 'garden' : undefined;
    if (family && family !== 'dwelling') ops.push({ fill: FAMILY_COLORS[family], alpha: p.allocation?.landmark ? 0.75 : 0.45 });
    if (p.allocation?.landmark) ops.push({ stroke: FAMILY_COLORS[family ?? 'civic'], widthPx: 1.6 });
  } else {
    // Buildings view: paved places and gardens, faint lot lines when close.
    if (openFill)
      ops.push({
        fill: openFill,
        plaza: isPlaza(use),
        paved: paintedPlan(f.planPath, palette) && lod === 'close' && isPlaza(use),
        stroke: lod === 'close' && lotLine ? (parchment ? PARCH.inkSoft : '#b9a98d') : lotLine && parchment && isPlaza(use) ? PARCH.inkSoft : undefined,
        widthPx: 0.6,
        alpha: parchment && lod === 'close' ? 0.9 : 1,
      });
    else if (lod === 'close' && lotLine) ops.push({ stroke: parchment ? PARCH.inkSoft : '#c4b597', widthPx: 0.6, alpha: parchment ? 0.45 : 1 });
  }
  return ops;
}
/** Outline of a parcel whose building was refused (access diagnostic), from near. */
export const REFUSED_PARCEL: PaintOp = { stroke: urbanFunctionColor('refusal'), widthPx: 1.4 };
/** Outline of the selected parcel or building. */
export const SELECTION: PaintOp = { stroke: '#197ea4', widthPx: 2 };

// ---------------------------------------------------------------- quays
/** Harbour platforms and furniture (harbourStyle.ts, shared with the 3D city); small furniture on close views only.
 * Undefined: not shown at this level. */
export const quayPaint = (f: Pick<PlanFrame, 'lod' | 'parchment'>, kind: string, material: string): HarbourPaint | undefined => (harbourShown(kind, f.lod) ? harbourPaint(kind, material, f.parchment, f.parchment ? PARCH.ink : '#57534b') : undefined);

// ---------------------------------------------------------------- town walls
interface WallLook {
  /** Stroke width in metres at `mpp` (a wall keeps a minimum on screen). */ thick: number;
  outer: string;
  /** The lighter core line of a stone wall (none far, none on a palisade). */ inner?: { color: string; share: number };
  /** Gate and wall towers (none far, none on a palisade). */ tower?: { radius: number; fill: string; stroke: string; strokePx: number };
}
/** Minimum on-screen width of a wall stroke, CSS px. */
export const wallMinPx = (lod: CityLod): number => (lod === 'far' ? 1.6 : 2.4);
/** Share of the wall width taken by the lighter core line. */
export const WALL_CORE = 0.45;
/** A town wall as a thick line broken at its gates, with its towers. */
export function wallLook(kind: string, palette: CityPalette, lod: CityLod, mpp: number): WallLook {
  const palisade = kind === 'palisade',
    parchment = palette === 'parchment',
    thick = Math.max(palisade ? 2 : 3.5, wallMinPx(lod) * mpp);
  return {
    thick,
    outer: palisade ? '#72533a' : parchment ? PARCH.wall : '#4b443b',
    inner: !palisade && lod !== 'far' ? { color: parchment ? PARCH.wallFill : '#b6a793', share: WALL_CORE } : undefined,
    tower: !palisade && lod !== 'far' ? { radius: Math.max(thick * 0.95, 2.2 * mpp), fill: parchment ? PARCH.tower : '#5a5248', stroke: parchment ? PARCH.wall : '#2f2a24', strokePx: 0.6 } : undefined,
  };
}

// ---------------------------------------------------------------- flat equivalents (GPU colour tables)
const parsed = new Map<string, number>();
/** '#rgb' / '#rrggbb' / 'rgb(r,g,b)' → 0xRRGGBB. */
export function rgb(color: string): number {
  let v = parsed.get(color);
  if (v !== undefined) return v;
  const m = /^rgba?\((\d+)\D+(\d+)\D+(\d+)/.exec(color);
  if (m) v = (+m[1] << 16) | (+m[2] << 8) | +m[3];
  else {
    const h = color.replace('#', '');
    v =
      parseInt(
        h.length === 3
          ? h
              .split('')
              .map(c => c + c)
              .join('')
          : h.slice(0, 6),
        16,
      ) || 0;
  }
  parsed.set(color, v);
  return v;
}
/** Straight RGBA (0–255 channels, 0–1 alpha) of the colour fills of `ops` laid over each other, as one source-over
 * fill: what a flat colour table holds for the element. Undefined when nothing is filled. */
export function flatFill(ops: readonly PaintOp[]): { r: number; g: number; b: number; alpha: number } | undefined {
  let r = 0,
    g = 0,
    b = 0,
    A = 0;
  for (const op of ops) {
    if (!op.fill || op.hatch) continue;
    const a = Math.max(0, Math.min(1, op.alpha ?? 1)),
      v = rgb(op.fill),
      out = a + A * (1 - a);
    if (!(out > 0)) continue;
    r = (((v >> 16) & 255) * a + r * A * (1 - a)) / out;
    g = (((v >> 8) & 255) * a + g * A * (1 - a)) / out;
    b = ((v & 255) * a + b * A * (1 - a)) / out;
    A = out;
  }
  return A > 0 ? { r, g, b, alpha: A } : undefined;
}
/** The outline of `ops`: its last stroke that is a line of the plan (the wide feather of a wash is not one). */
export const outlineOf = (ops: readonly PaintOp[]): PaintOp | undefined => {
  for (let i = ops.length - 1; i >= 0; i--) if (ops[i].stroke && ops[i].widthPx && !ops[i].feather) return ops[i];
  return undefined;
};

// ---------------------------------------------------------------- canals
/** Canal water (when the map gives no water colour), bridges and lock gates over the town ground: read by the Canvas
 * canals (cityWaterways.ts), the GPU town and the 3D city (city3dQuays.ts). */
export const CANAL = { water: '#8aaeb8', bridge: '#e6d9bb', bridgeEdge: '#6d6554' } as const;
/** Outline width of canal bridges, CSS px: 0.6 px, at least 0.4 m. */
export const canalBridgeEdgePx = (mpp: number): number => Math.max(0.4 / mpp, 0.6);

// ---------------------------------------------------------------- lot enclosures
/** Lot enclosures (fences, hedges, walls on parcel limits) show from the mid level; across it they thin to this share
 * of their minimum width and fade to 0.35 by its far end; none far. */
export const ENCLOSURE_MID_WIDTH = 0.7;
export function enclosureFade(lod: CityLod, mpp: number): number {
  if (lod !== 'mid') return lod === 'far' ? 0 : 1;
  return 1 - 0.65 * Math.max(0, Math.min(1, Math.log(mpp / CITY_LOD_LIMITS[1]) / Math.log(CITY_LOD_LIMITS[2] / CITY_LOD_LIMITS[1])));
}
/** Gate jambs: cart gates near (rank 0), doors too when close (rank 1), none further out (-1). */
export const enclosureJambRank = (lod: CityLod): number => (lod === 'close' ? 1 : lod === 'near' ? 0 : -1);
