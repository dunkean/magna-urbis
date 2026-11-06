/**
 * Semantic layers: what the land is used for, drawn from the canonical polygons, whatever the ground looks like.
 * One painter for the 2D map and the 3D tiles: the context is already in world coordinates, so classes,
 * colours and outlines match between views. Physical cover (trees, furrows) is not drawn here.
 * Line widths and pattern spacings are in screen pixels: `mpp` converts them to world units.
 */
import type { LandUseLayer, LandKind } from '../gen/types';
import type { SemanticLook } from './composition';
import { DISTRICT_ROLES, districtRoleKey, SpatialBins, type CityScene, type CityBlock } from './cityCanvas';
import type { SemanticLegendEntry, SemanticPatternId } from './legend';

export interface SemanticBox { minX: number; minY: number; maxX: number; maxY: number }
export interface SemanticDrawOptions {
  look: SemanticLook; /** 0–1 */ opacity: number; /** World units per screen pixel of the context's current transform: outlines keep a constant screen width. */ mpp: number; viewport: SemanticBox;
}
export interface RuralSemanticOptions extends SemanticDrawOptions { classes: Readonly<Record<LandKind, boolean>>; indexed?: boolean }

export interface SemanticClass { color: string; label: string; pattern: SemanticPatternId; /** Border dash, screen pixels. */ dash: readonly number[] }
/** One stable colour, pattern and border dash per rural class (greyscale-readable); independent of the ground palette. Also the legend. */
export const RURAL_SEMANTIC: Readonly<Record<LandKind, SemanticClass>> = {
  field: { color: '#d99a1e', label: 'Arable land', pattern: 'furrows', dash: [] },
  meadow: { color: '#8fd45a', label: 'Meadow land', pattern: 'none', dash: [] },
  pasture: { color: '#7f8a1c', label: 'Grazing land', pattern: 'dots', dash: [4, 3] },
  forest: { color: '#17632f', label: 'Forest land', pattern: 'trees', dash: [] },
  orchard: { color: '#33a852', label: 'Orchard land', pattern: 'grid', dash: [1.5, 3] },
  garden: { color: '#c4d82e', label: 'Garden land', pattern: 'cross', dash: [6, 2, 1.5, 2] },
  marsh: { color: '#1b9aa6', label: 'Wetland', pattern: 'reeds', dash: [5, 2] },
  commons: { color: '#a8998a', label: 'Common land', pattern: 'dashes', dash: [8, 4] },
};
const RURAL_ORDER: readonly LandKind[] = ['commons', 'pasture', 'meadow', 'marsh', 'field', 'garden', 'orchard', 'forest'];

/** English names of the district roles for the legend (the role ids and colours come from cityCanvas). */
const URBAN_LABELS_EN: Readonly<Record<string, string>> = {
  civic: 'Civic district', market: 'Market district', religious: 'Religious district', craft: 'Craft district', port: 'Port district', elite: 'Notables district',
  commoner: 'Commoner district', poor: 'Poor district', garrison: 'Garrison district', gardens: 'Gardens district', foreign: 'Foreign quarter',
};
/** District usage classes: the existing role palette (cityCanvas DISTRICT_ROLES) plus public spaces and a fallback. */
export const URBAN_SEMANTIC: Readonly<Record<string, SemanticClass>> = {
  ...Object.fromEntries(Object.entries(DISTRICT_ROLES).map(([role, { color }]): [string, SemanticClass] => [role, { color, label: URBAN_LABELS_EN[role] ?? role, pattern: 'none', dash: [] }])),
  public: { color: '#c9d6a0', label: 'Public space', pattern: 'none', dash: [] },
  other: { color: '#8f8a84', label: 'Other / unknown', pattern: 'none', dash: [] },
};
const URBAN_ORDER = [...Object.keys(DISTRICT_ROLES), 'public', 'other'];

const overlaps = (a: SemanticBox, b: SemanticBox): boolean => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const hexParts = (hex: string): number[] => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
/** The colour darkened by `t`, for outlines that must read over its own fill. */
const shade = (hex: string, t: number): string => `rgb(${hexParts(hex).map(c => Math.round(c * (1 - t))).join(',')})`;

/** Screen-pixel line/dot patterns, anchored on world coordinates so tiles and frames agree. */
interface Hatch { angle: number; spacing: number; dash: readonly number[]; width: number; stagger?: boolean }
const HATCHES: Readonly<Record<Exclude<SemanticPatternId, 'none'>, readonly Hatch[]>> = {
  furrows: [{ angle: .35, spacing: 6, dash: [], width: 1 }],
  dots: [{ angle: 0, spacing: 8, dash: [0, 8], width: 2, stagger: true }],
  trees: [{ angle: 0, spacing: 9, dash: [0, 9], width: 3.6, stagger: true }],
  grid: [{ angle: 0, spacing: 11, dash: [0, 11], width: 3 }],
  cross: [{ angle: Math.PI / 4, spacing: 6, dash: [], width: .8 }, { angle: -Math.PI / 4, spacing: 6, dash: [], width: .8 }],
  reeds: [{ angle: 0, spacing: 6, dash: [5, 4], width: 1.2, stagger: true }],
  dashes: [{ angle: -Math.PI / 4, spacing: 9, dash: [8, 6], width: 1 }],
};
const MAX_HATCH_LINES = 500;

function hatch(ctx: CanvasRenderingContext2D, box: SemanticBox, spec: Hatch, mpp: number): void {
  const cos = Math.cos(spec.angle), sin = Math.sin(spec.angle), spacing = spec.spacing * mpp;
  // The box in the rotated frame (u along the lines, v across them).
  const us: number[] = [], vs: number[] = [];
  for (const [x, y] of [[box.minX, box.minY], [box.maxX, box.minY], [box.maxX, box.maxY], [box.minX, box.maxY]]) { us.push(x * cos + y * sin); vs.push(-x * sin + y * cos); }
  const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
  if ((v1 - v0) / spacing > MAX_HATCH_LINES) return;
  const dash = spec.dash.map(d => d * mpp), period = dash.length ? dash.reduce((s, d) => s + d, 0) : 0;
  ctx.save();
  ctx.rotate(spec.angle);
  ctx.lineWidth = spec.width * mpp; ctx.lineCap = dash.length && dash[0] === 0 ? 'round' : 'butt'; ctx.setLineDash(dash);
  ctx.beginPath();
  for (let k = Math.ceil(v0 / spacing); k * spacing <= v1; k++) {
    const v = k * spacing, start = period ? Math.floor(u0 / period) * period + (spec.stagger && (k & 1) ? period / 2 : 0) : u0;
    ctx.moveTo(start, v); ctx.lineTo(u1, v);
  }
  ctx.stroke();
  ctx.restore();
}

interface LookStyle { fill: number; stroke: number; strokeWidth: number; pattern: number; strokeShade: number }
/** Alpha and widths of a look: opacity scales the whole layer, Off draws nothing. */
function lookStyle(look: SemanticLook, opacity: number): LookStyle | undefined {
  const o = clamp01(opacity);
  switch (look) {
    case 'subtle': return { fill: o * .35, stroke: clamp01(o * 1.1), strokeWidth: 1, pattern: 0, strokeShade: 0 };
    case 'categorical': return { fill: o, stroke: clamp01(.5 + o), strokeWidth: 1.4, pattern: clamp01(o * 1.4 + .15), strokeShade: .35 };
    case 'outlines': return { fill: 0, stroke: clamp01(.4 + o * 1.2), strokeWidth: 1.7, pattern: clamp01(o * 1.2 + .1), strokeShade: .15 };
    default: return undefined;
  }
}

/** Fill, pattern and border of one batch of same-class shapes (even-odd: holes stay open). */
function paintBatch(ctx: CanvasRenderingContext2D, path: Path2D, area: SemanticBox, cls: SemanticClass, style: LookStyle, look: SemanticLook, mpp: number, pattern: boolean): void {
  ctx.save();
  try {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (style.fill > 0) { ctx.globalAlpha = style.fill; ctx.fillStyle = cls.color; ctx.fill(path, 'evenodd'); }
    if (pattern && look !== 'subtle' && cls.pattern !== 'none' && style.pattern > 0) {
      ctx.save();
      ctx.clip(path, 'evenodd');
      ctx.globalAlpha = style.pattern; ctx.strokeStyle = style.strokeShade ? shade(cls.color, style.strokeShade) : cls.color;
      for (const spec of HATCHES[cls.pattern]) hatch(ctx, area, spec, mpp);
      ctx.restore();
    }
    ctx.globalAlpha = style.stroke; ctx.strokeStyle = style.strokeShade ? shade(cls.color, style.strokeShade) : cls.color;
    ctx.lineWidth = style.strokeWidth * mpp; ctx.setLineDash(cls.dash.map(d => d * mpp));
    ctx.stroke(path);
  } finally { ctx.restore(); }
}

// ---------------------------------------------------------------- rural
interface RuralGeometry { boxes: SemanticBox[]; paths: (Path2D | undefined)[]; bins?: SpatialBins }
/** Boxes once per land-use product, Path2D lazily per area: a frame never rebuilds geometry. */
const RURAL_GEOMETRY = new WeakMap<LandUseLayer, RuralGeometry>();
function ruralGeometry(landuse: LandUseLayer): RuralGeometry {
  let geometry = RURAL_GEOMETRY.get(landuse);
  if (!geometry) {
    const boxes = landuse.areas.map(area => {
      const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (const p of area.poly) { if (p.x < box.minX) box.minX = p.x; if (p.x > box.maxX) box.maxX = p.x; if (p.y < box.minY) box.minY = p.y; if (p.y > box.maxY) box.maxY = p.y; }
      return box;
    });
    RURAL_GEOMETRY.set(landuse, geometry = { boxes, paths: new Array(landuse.areas.length) });
  }
  return geometry;
}
function ringsPath(rings: readonly (readonly { x: number; y: number }[])[]): Path2D {
  const path = new Path2D();
  for (const ring of rings) {
    if (ring.length < 3) continue;
    path.moveTo(ring[0].x, ring[0].y);
    for (let i = 1; i < ring.length; i++) path.lineTo(ring[i].x, ring[i].y);
    path.closePath();
  }
  return path;
}

export function drawRuralSemantic(ctx: CanvasRenderingContext2D, landuse: LandUseLayer | undefined, options: RuralSemanticOptions): boolean {
  const style = lookStyle(options.look, options.opacity);
  if (!landuse || !style || !(options.mpp > 0)) return false;
  const geometry = ruralGeometry(landuse), { boxes, paths } = geometry, { viewport, mpp, classes } = options, tiny = mpp * 1.2;
  const visible = new Map<LandKind, number[]>();
  const candidates = options.indexed ? (geometry.bins ??= new SpatialBins(boxes, 128)).query(viewport) : landuse.areas.keys();
  for (const i of candidates) {
    const area = landuse.areas[i];
    if (classes[area.kind] === false || !RURAL_SEMANTIC[area.kind]) continue;
    const box = boxes[i];
    if (!overlaps(box, viewport) || (box.maxX - box.minX < tiny && box.maxY - box.minY < tiny)) continue;
    const list = visible.get(area.kind); if (list) list.push(i); else visible.set(area.kind, [i]);
  }
  for (const kind of RURAL_ORDER) {
    const ids = visible.get(kind); if (!ids) continue;
    const path = new Path2D(), area = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const i of ids) {
      path.addPath(paths[i] ??= ringsPath([landuse.areas[i].poly, ...(landuse.areas[i].holes ?? [])]));
      const box = boxes[i];
      area.minX = Math.min(area.minX, box.minX); area.minY = Math.min(area.minY, box.minY); area.maxX = Math.max(area.maxX, box.maxX); area.maxY = Math.max(area.maxY, box.maxY);
    }
    // Hatching is clipped to the shapes, so only the part of their box in view needs lines.
    const inView = { minX: Math.max(area.minX, viewport.minX), minY: Math.max(area.minY, viewport.minY), maxX: Math.min(area.maxX, viewport.maxX), maxY: Math.min(area.maxY, viewport.maxY) };
    paintBatch(ctx, path, inView, RURAL_SEMANTIC[kind], style, options.look, mpp, true);
  }
  return visible.size > 0;
}

// ---------------------------------------------------------------- urban
/** Usage class of a block: its district role, public spaces, else unknown. Reserve blocks are rural land, not city usage. */
export function urbanClassOf(block: CityBlock): string | undefined {
  if (block.kind.startsWith('reserve')) return undefined;
  const role = districtRoleKey(block.district?.role);
  if (role && URBAN_SEMANTIC[role]) return role;
  return block.kind === 'place' || block.kind === 'common' ? 'public' : 'other';
}
const BLOCK_PATHS = new WeakMap<CityBlock, Path2D>();
const blockPath = (block: CityBlock): Path2D => {
  let path = BLOCK_PATHS.get(block);
  if (!path) BLOCK_PATHS.set(block, path = ringsPath((block.ground ?? [block.shape]).flatMap(shape => [shape.outer, ...(shape.holes ?? [])])));
  return path;
};

export function drawUrbanSemantic(ctx: CanvasRenderingContext2D, scenes: readonly CityScene[], options: SemanticDrawOptions): boolean {
  const style = lookStyle(options.look, options.opacity);
  if (!style || !(options.mpp > 0)) return false;
  const { viewport, mpp } = options;
  let painted = false;
  for (const scene of scenes) {
    const paths = new Map<string, Path2D>();
    for (const i of scene.bins.blocks.query(viewport)) {
      const block = scene.blocks[i], cls = urbanClassOf(block);
      if (!cls) continue;
      let path = paths.get(cls); if (!path) paths.set(cls, path = new Path2D());
      path.addPath(blockPath(block));
    }
    for (const cls of URBAN_ORDER) {
      const path = paths.get(cls); if (!path) continue;
      // The unknown fallback stays discreet so it never reads as a district of its own.
      const quiet = cls === 'other' ? { ...style, fill: style.fill * .6, stroke: style.stroke * .6 } : style;
      paintBatch(ctx, path, viewport, URBAN_SEMANTIC[cls], quiet, options.look, mpp, false);
      painted = true;
    }
  }
  return painted;
}

// ---------------------------------------------------------------- legend
const legendLook = (look: SemanticLook): SemanticLegendEntry['look'] | undefined => look === 'off' ? undefined : look;
const RURAL_PRESENT = new WeakMap<LandUseLayer, Set<LandKind>>();
/** Legend entries of the rural classes that are visible and exist in the products. */
export function ruralSemanticLegend(landuse: LandUseLayer | undefined, classes: Readonly<Record<LandKind, boolean>>, look: SemanticLook): SemanticLegendEntry[] {
  const mode = legendLook(look);
  if (!landuse || !mode) return [];
  let present = RURAL_PRESENT.get(landuse); if (!present) RURAL_PRESENT.set(landuse, present = new Set(landuse.areas.map(a => a.kind)));
  return RURAL_ORDER.filter(kind => present!.has(kind) && classes[kind] !== false).map(kind => ({ label: RURAL_SEMANTIC[kind].label, color: RURAL_SEMANTIC[kind].color, pattern: RURAL_SEMANTIC[kind].pattern, dash: RURAL_SEMANTIC[kind].dash, look: mode }));
}
const URBAN_PRESENT = new WeakMap<CityScene, Set<string>>();
/** Legend entries of the district usage classes present in the city scenes. */
export function urbanSemanticLegend(scenes: readonly CityScene[], look: SemanticLook): SemanticLegendEntry[] {
  const mode = legendLook(look);
  if (!mode) return [];
  const present = new Set<string>();
  for (const scene of scenes) {
    let set = URBAN_PRESENT.get(scene);
    if (!set) { set = new Set(); for (const block of scene.blocks) { const cls = urbanClassOf(block); if (cls) set.add(cls); } URBAN_PRESENT.set(scene, set); }
    for (const cls of set) present.add(cls);
  }
  return URBAN_ORDER.filter(cls => present.has(cls)).map(cls => ({ label: URBAN_SEMANTIC[cls].label, color: URBAN_SEMANTIC[cls].color, pattern: 'none' as const, dash: [], look: mode }));
}

