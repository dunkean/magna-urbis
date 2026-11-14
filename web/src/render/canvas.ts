import { cityCountrysideTextureVisible } from './cityEnvironment';
import { CITY_LOD_LIMITS, type CityScene } from './cityCanvas';
import { drawFarmLots, drawFarmRoofs, drawPlaceholderRoofs } from './farmRoofs';
import { yardStyle } from './yardStyle';
import { DEFAULT_TEXT, textPlacement, drawMapLabels, cityTextLabels, type TextSettings } from './textLayer';
import { cavernDisplayWorld } from './cavernDisplay';
import { drawRuralDetails } from './ruralDetails';
import { cavernWallFill, cavernRockPixels, CAVERN_RIM } from './caverns';
import { isUnderdarkBiome, biomeName } from '../gen/biomes';
import { ParchmentSymbols, SYMBOL_CELLS } from './parchmentSymbols';
/**
 * Interactive Canvas 2D renderer with level of detail (SVG stays for export).
 *
 * - The World is flattened once into a `Scene` (tile-indexed layers, see scene.ts).
 * - Per (layer, LOD band, tile) a Path2D is built lazily and cached; a frame only
 *   touches tiles intersecting the viewport, and only layers enabled by `selectLod`.
 * - The context transform is world->screen, so all widths are in meters; screen-space
 *   minimum widths are applied with `lineWidth(w, minPx, scale)`.
 * - Palettes come from styles.ts (read-only).
 * Everything DOM-ish is injectable (`CanvasRendererDeps`) so a mock 2D context can drive it in Node.
 */
import { CanvasBrushes } from './brushCanvas';
import { CanvasCanopy, canopyMarks, CANOPY_MARGIN, type VegetationStyle } from './canopy';
import { FARM_MARGIN, ForestRoom, farmClearings, forestCorridors, growRing } from './forestRoom';
import { brushTextureOn, isBrushKind, supportsPaintedBiome, type BrushImages, type BrushKind } from './brushes';
import { bridgeShapes, isKinded, type BridgeShapes } from './townbridges';
import type { World, LandKind, Vec2 } from '../gen/types';
import { Palette, MapStyle, ruralInk } from './styles';
import { forestLandPaint, FOREST_EDGE_WIDTH } from './landuseForestTone';
import { rasterizePolys } from '../gen/geo/raster';
import { bboxOf } from '../gen/geo/poly';
import { distanceField } from '../gen/core/field';
import { vectorizeRegions } from '../../../rust/bridge/landuseNative';
import { TileIndex, boxesOf } from './tileindex';
import { biomePalette } from './biomes';
import { applyRenderColors, type RenderColors } from './customColors';
import { fieldBoundaryStyle, fieldHedgeStyle } from './hedges';
import { furrowLines, furrowSpacing } from './furrows';
import { orientPos } from '../gen/geo/poly';
import { unionMany } from '../gen/geo/bool';
import { CANVAS_MAP_STROKES as MAP_STROKES, mapStrokeWidth } from './strokes';
import { NATURAL_LAND_KINDS, countryKind, FRINGE_ORDER, FRINGE_PAINT } from './countryside';
import { TERRACE_STROKES as TS, terraceDetailAlpha } from './terraces';
import { regionalBridgeSurface, regionalRoadSurface } from './roadSurfaces';
import { BLEND_ROAD_ALPHA, BLEND_ROAD_PX } from './groundBlend';
import { CANOPY_LEVELS, canopyRuns, emphasisAlpha, regionalRank, roadCanopyOpacity, roadCanopyRevision, roadWidth, strokeNaturalRoad, trackInk, type RoadStyle } from './roadStyle';
import { drawWhiteWater, whiteWaterRevision } from './whiteWater';
import { worldWaterPixels } from './terrainWater';
import { renderTerrainPixels } from './raster';
import { RasterTileCache } from './rasterTiles';
import { LiveTileFill } from './liveTileFill';
import { buildScene, type SceneMask, Scene, PolyLayer, LineLayer, TextureLayer, textureMarks, pointInRenderPoly, type Mark, LAND_ORDER, WALL_LINE_W, CAMP_FENCE_W, FENCE_STYLE } from './scene';
import { renderView } from '../gen/settlements/merge';
import { selectLod, lineWidth, Lod, BAND_MIN_EDGE, WAY_SCALE, FURROW_MIN_PX, FURROW_HOLDER_BUDGET } from './lod';
import { View, viewRect, Rect4 } from './view';
import { Label, placeLabels } from './labels';
import { buildMapLabels, placeMapLabels, MapLabel, PlacedMapLabel, estimateWidth } from './mapLabels';
import { fontString, FONT_STACKS, KindStyle } from './labelStyles';
import { cartoucheModel, legendModel, compactMapPanels, compactScaleModel, drawPanelCanvas, Panel, type MapInformation, type SemanticLegendEntry } from './legend';
import { appendUnderdarkMark, underdarkMark, underdarkTextureSpec } from './underdark';
import { frameModel, panelMargin } from './frame';
import { litDots } from './extras';
import { displayQualityFor, type ResolvedDisplayQuality } from './displayQuality';
import { RecPath2D } from './gpu/path';
import { RecordingCanvas, RecordingContext } from './gpu/recorder';
import type { DisplayList, Mat } from './gpu/displayList';
import { noteLivePart, noteLiveCount, existingGpuRasterizer, getVectorEngine, noteCpuTile, noteGpuFailure, noteGpuFallback, noteGpuTile, vectorRasterizer } from './vectorEngine';

export interface CanvasLike { width: number; height: number; getContext(id: '2d', options?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D | null }

export interface CanvasRendererDeps {
  /** Footprints of isolated houses and farms (native scenes): woods are cleared around them like around a farmstead. */
  buildingClearings?(): readonly import('../gen/types').Polygon[];
  separateText?: boolean;
  textSources?(): readonly CityScene[] | undefined;
  colors?: RenderColors;
  roadLook?: import('./composition').RoadLook;
  /** Look, emphasis and ambience of the roads, read per frame so a new emphasis repaints without a rebuild. */
  roadStyle?: () => RoadStyle;
  /** Path2D constructor (default: RecPath2D, a native Path2D that both vector engines can draw). */
  Path2D?: new () => Path2D;
  /** Offscreen canvas factory (default: OffscreenCanvas / document canvas). Return null if unavailable. */
  createCanvas?: (w: number, h: number) => CanvasLike | null;
  /** Terrain bitmap provider (default: hillshade raster). Return null to skip terrain. */
  terrain?: (world: World, pal: Palette) => CanvasImageSource | null;
  /** Keep the map background transparent when composing a separate overlay. */
  transparentBackground?: boolean;
  /** The ground under the overlay draws the cave rock itself (Underdark on material grounds, terrainGl.ts): the overlay
   * keeps clipping to the cave floor but paints no rock walls. Read per frame. */
  groundCaverns?: () => boolean;
  dpr?: number;
  now?: () => number;
  tileSize?: number;
  /** Pre-built scene (avoids rebuilding when only the style changes). */
  scene?: Scene;
  /** Disable the raster tile path for diagnostics or constrained hosts. */
  raster?: boolean;
  rasterBytes?: number;
  /** Request a live frame after a progressive raster slice. Captures never schedule work. */
  invalidate?: () => void;
  /** Decoded display-only atlases; undefined is the unchanged classic renderer. */
  brushes?: BrushImages;
  /** Irregular, shaded foliage in place of round forest/orchard symbols. */
  vegetation?: VegetationStyle;
  /** Decorative field scale, independent of the retained terrain extent. */
  furrowReferenceSize?: number;
  /** Natural layers owned by another pass (no fabricated world): they are neither built nor drawn. Absent = all. */
  mask?: SceneMask;
  /** Semantic land use of another pass, painted after the land-use layers and before water, roads and labels. `key` joins the raster tile keys, so a new look repaints the tiles; `draw` gets the world-coordinate context, the culling rect and the world units per screen pixel. */
  semantic?: { key(): string; draw(ctx: CanvasRenderingContext2D, rect: Rect4, mpp: number, quality?: ResolvedDisplayQuality): void; legend?(): readonly SemanticLegendEntry[] };
}

export interface FrameStats {
  band: number; scale: number; ms: number;
  tilesDrawn: number; bigDrawn: number; pathsBuilt: number; pathCache: number;
  buildingsCandidate: number; buildingsDrawn: boolean; textureTiles: number;
  /** Dedicated furrow records (three paths each); separate from the shared tile path cache. */
  furrowCache?: number; furrowsDrawn?: number;
  brushBytes?: number;
  rasterHits?: number; rasterBuilt?: number; rasterBytes?: number;
  rasterPending?: number;
}

export interface Overlays { text?: Readonly<TextSettings>; labels: boolean; legend: boolean; cartouche: boolean }

export interface CanvasRenderer {
  scene: Scene;
  palette: Palette;
  /** Only explicit live draws use density buckets, progressive filling and the browser quality policy. */
  draw(view: View, options?: { live: boolean }): FrameStats;
  suspendLive(): void;
  /** `moving`: a frame of a pan or zoom gesture; the labels of the last placement follow the map instead of being placed again. */
  drawText(target: CanvasRenderingContext2D, view: View, width: number, height: number, moving?: boolean): void;
  /** Physical land use alone (no grid, semantics, water or roads) on the transparent `target`, which covers the world square `box`. False: nothing there. */
  drawGround(target: CanvasLike, box: Rect4, options?: { live: boolean }): boolean;
  /** Read-only live pyramid preview. Never rasterises a missing tile or includes labels. */
  drawCachedMap(target: CanvasLike, box: Rect4): boolean;
  /** Reuse immutable scene tiles and resources after detail arrival. False requires a new renderer. */
  update(world: World, scene: Scene, style?: MapStyle | Palette): boolean;
  setLabels(labels: Label[]): void;
  /** Toggle names and site pins, the legend and the cartouche (defaults: labels per world.options.labels, legend per world.options.legend, cartouche on). */
  setOverlays(o: Partial<Overlays>): void;
  /** Labels placed in the last frame (debug / tests). */
  lastPlaced(): PlacedMapLabel[];
  /** `withRect = false` draws the static base only (the page overlays the view rectangle itself). */
  drawMinimap(target: CanvasLike, view: View, viewW: number, viewH: number, withRect?: boolean): void;
  lastStats(): FrameStats;
  /** True while live frames replay a retained GPU list (pan and zoom cost one GPU replay, no CPU repaint). */
  liveRetained(): boolean;
  /** Conservative owned storage for retaining an inactive style (native Path2D memory is estimated). */
  retainedBytes(): number;
  /** Title and legend of the actual renderer, without a view-specific scale in the external drawer. */
  getMapInfo(): MapInformation;
  dispose(): void;
}

const BUILDING_BUDGET_FULL = 120_000;
const BUILDING_BUDGET_MAX = 450_000;
/** Individually outlined buildings in view above which we fall back to merged masses. */
const BUILDING_BUDGET_INDIV = 160_000;

const hexRgb = (h: string): number[] | null => { const m = /^#([0-9a-f]{6})$/i.exec(h); if (!m) return null; const v = parseInt(m[1], 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const mixHex = (a: string, b: string, t: number): string => {
  const A = hexRgb(a), B = hexRgb(b);
  if (!A || !B) return a;
  return '#' + A.map((x, i) => Math.round(x + (B[i] - x) * t).toString(16).padStart(2, '0')).join('');
};
const lumHex = (h: string): number => { const c = hexRgb(h); return c ? (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 : 0.5; };
const CACHE_MAX = 8000;
/** Sprite layers (woods, parchment symbols) are pre-composited in tiles of this many pixels, one tile set per
 * power-of-two pixel density up to LAYER_TILE_MAX_DENSITY px/m; closer views stamp their few sprites directly. */
const LAYER_TILE_PX = 512, LAYER_TILE_GUTTER = 2, LAYER_TILE_MAX_DENSITY = 4, LAYER_TILE_BYTES = 128 * 1024 * 1024;
/** Farthest reach of a sprite from its mark (m): the largest canopy crown is 10 x 1.59 m from its centre. */
const LAYER_TILE_REACH = 16;
/** GPU engine, live view: the retained region extends this share of the view beyond each side. */
const RETAIN_MARGIN = .35;
/** GPU engine, live view: a new detail level or region is recorded this long after the view rests. */
const RETAIN_SETTLE_MS = 150, RETAIN_MAX_WAIT_MS = 1500;
/** GPU engine, live view: a region is recorded in this many horizontal bands, one per idle step. */
const RETAIN_BANDS = 4;
/** GPU engine: most woods sprites one cached batch may hold (one instanced draw; a far view of a wooded map). */
const GPU_SPRITE_BATCH_MAX = 400_000;
/** GPU engine: sprite marks in view under which a layer stamps them directly on the recording (instanced) instead of pre-compositing layer tiles. */
const GPU_SPRITE_BUDGET = 60_000;
/** Side of the coarse whole-map raster shown under the missing live tiles. */
const PREVIEW_PX = 2048;
const growRect = (r: Rect4, d: number): Rect4 => ({ minX: r.minX - d, minY: r.minY - d, maxX: r.maxX + d, maxY: r.maxY + d });
const TAU = Math.PI * 2;
const frac = (v: number): number => v - Math.floor(v);
const vhash = (i: number, j: number, salt: number): number => frac(Math.sin(i * 127.1 + j * 311.7 + salt * 74.7) * 43758.5453);
/** Smooth value noise in 0-1, two octaves: clumps of vegetation with empty gaps between them. */
function clumpNoise(x: number, y: number, scale: number, salt: number): number {
  // Four lattice hashes per octave (each was evaluated twice), no per-call octave table.
  let sum = 0;
  for (let octave = 0; octave < 2; octave++) {
    const f = octave === 0 ? 1 : 3.1, w = octave === 0 ? .65 : .35;
    const fx = x * f / scale, fy = y * f / scale, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v), s = salt + f * 13;
    const h00 = vhash(i, j, s), h10 = vhash(i + 1, j, s), h01 = vhash(i, j + 1, s), h11 = vhash(i + 1, j + 1, s);
    const top = h00 + (h10 - h00) * su, bottom = h01 + (h11 - h01) * su;
    sum += w * (top + (bottom - top) * sv);
  }
  return sum;
}
const smooth01 = (t: number): number => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
/** Share of conifers in the woods of each climate; a broad noise mixes the stands at the transitions. */
const CONIFER_SHARE: Partial<Record<string, number>> = { tundra: .88, forest: .5, steppe: .3, temperate: .14 };
interface PenMark { x: number; y: number; cell: number; size: number }
/** Symbol choice for one parchment mark: clumped by noise, sized in metres, or null in a gap. */
function penSymbol(kind: string, m: Mark): Omit<PenMark, 'x' | 'y'> | null {
  const h1 = frac(m.k * 7.31 + .17), h2 = frac(m.k * 13.7 + .41), h3 = frac(m.k * 31.3 + .73);
  const clump = clumpNoise(m.x, m.y, kind === 'marsh' ? 30 : 46, kind.length);
  const density = kind === 'pasture' ? .55 : kind === 'commons' ? .8 : .9;
  if (h1 > density * (.06 + .94 * smooth01((clump - .3) / .38))) return null;
  const tuft = (big: number): Omit<PenMark, 'x' | 'y'> => {
    const cell = SYMBOL_CELLS.tuft[Math.floor(h3 * 4)];
    return { cell, size: big * (cell === 3 ? 1.25 : cell === 1 ? .8 : 1) * (.75 + .5 * h2) };
  };
  if (kind === 'marsh') return h2 < .82 ? { cell: SYMBOL_CELLS.reed[Math.floor(h3 * 4)], size: 7 + 4 * frac(m.k * 5.3) } : tuft(6);
  if (kind === 'commons') {
    if (h2 < .38) return { cell: SYMBOL_CELLS.heath[Math.floor(h3 * 3)], size: 5.5 + 3 * frac(m.k * 5.3) };
    if (h2 < .52) return { cell: SYMBOL_CELLS.gorse, size: 5.5 + 2 * h3 };
    if (h2 < .58) return { cell: h3 < .6 ? SYMBOL_CELLS.stones : SYMBOL_CELLS.boulder, size: 4 + 2.5 * frac(m.k * 5.3) };
    return tuft(8);
  }
  if (kind === 'meadow' && h2 < .07) return { cell: SYMBOL_CELLS.heath[Math.floor(h3 * 3)], size: 5 + 2.5 * frac(m.k * 5.3) };
  if (kind === 'meadow' && h2 < .09) return { cell: SYMBOL_CELLS.gorse, size: 5 + 1.5 * h3 };
  return tuft(kind === 'pasture' ? 6.5 : 9);
}
/** Hand-drawn map symbols for the parchment sheet, in the convention of estate maps: curved grass fans, reed clumps over
 * water dashes, stippled heath. `k` (0-1) varies each mark; strokes only, so the paper shows through. */
function appendPenMark(path: Path2D, shape: 'tuft' | 'reed' | 'dot', x: number, y: number, r: number, k: number): void {
  const h1 = frac(k * 7.31 + .17), h2 = frac(k * 13.7 + .41), h3 = frac(k * 31.3 + .73);
  if (shape === 'tuft') {
    const n = 3 + Math.floor(h1 * 3), lean = (h2 - .5) * .45, size = r * (.8 + .4 * h3);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1) - .5, j = frac(k * 17.9 + i * .618);
      const a = lean + t * 1.25 + (j - .5) * .18, len = size * (1.12 - Math.abs(t) * .55) * (.85 + .3 * j);
      const bx = x + t * size * .3, tx = bx + Math.sin(a) * len, ty = y - Math.cos(a) * len;
      path.moveTo(bx, y); path.quadraticCurveTo(bx + Math.sin(a * .35) * len * .5, y - Math.cos(a * .35) * len * .62, tx, ty);
    }
    if (h3 < .4) { path.moveTo(x - size * .5, y + size * .04); path.lineTo(x + size * .45, y + size * .04); }
  } else if (shape === 'reed') {
    const n = 3 + Math.floor(h1 * 2), lean = (h2 - .5) * .3;
    for (let i = 0; i < n; i++) {
      const j = frac(k * 23.1 + i * .618), dx = (i - (n - 1) / 2) * r * .3 + (j - .5) * r * .12, hgt = r * (.85 + .55 * j);
      const tx = x + dx + lean * hgt, ty = y - hgt;
      path.moveTo(x + dx, y); path.quadraticCurveTo(x + dx + lean * hgt * .2, y - hgt * .55, tx, ty);
      if (i === 1 && h3 > .35) { path.moveTo(tx + r * .07, ty + r * .2); path.ellipse(tx, ty + r * .2, r * .07, r * .2, 0, 0, TAU); }
    }
    path.moveTo(x - r * .95, y + r * .1); path.lineTo(x - r * .15, y + r * .1);
    path.moveTo(x + r * .05, y + r * .32); path.lineTo(x + r * .75, y + r * .32);
  } else {
    // Heath stipple: two or three specks, now and then a small ring of specks (a heather cushion).
    const dots = h1 < .2 ? 6 : 2 + Math.floor(h2 * 2), spread = h1 < .2 ? r * 2.1 : r * 1.6;
    for (let i = 0; i < dots; i++) {
      const a = (h1 < .2 ? i / dots : frac(k * 11.3 + i * .618)) * TAU + h3 * TAU, d = h1 < .2 ? spread : spread * frac(k * 5.7 + i * .382);
      const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d, pr = r * (.45 + .35 * frac(k * 3.1 + i * .29));
      path.moveTo(px + pr, py); path.arc(px, py, pr, 0, TAU);
    }
  }
}

interface TexSpec { sp: number; shape: 'circle' | 'tuft' | 'reed' | 'dot'; r: number; fill?: keyof Palette; stroke: keyof Palette; alpha: number }
const TEX: Record<string, TexSpec> = {
  garden: { sp: 8, shape: 'circle', r: 1.7, fill: 'treeFill', stroke: 'treeInk', alpha: .95 },
  field: { sp: 14, shape: 'circle', r: 2.7, fill: 'treeFill', stroke: 'treeInk', alpha: .95 },
  forest: { sp: 9, shape: 'circle', r: 3.1, fill: 'treeFill', stroke: 'treeInk', alpha: 0.95 },
  orchard: { sp: 11, shape: 'circle', r: 2.3, fill: 'treeFill', stroke: 'orchardDot', alpha: 0.95 },
  meadow: { sp: 16, shape: 'tuft', r: 3, stroke: 'grass', alpha: 0.9 },
  pasture: { sp: 24, shape: 'tuft', r: 2.4, stroke: 'grass', alpha: 0.8 },
  marsh: { sp: 15, shape: 'reed', r: 3.2, stroke: 'reed', alpha: 0.9 },
  commons: { sp: 18, shape: 'dot', r: 0.7, fill: 'grass', stroke: 'grass', alpha: 0.75 },
};
const TEX_SALT: Record<string, number> = { forest: 11, orchard: 23, meadow: 37, pasture: 41, marsh: 53, commons: 67 };

type PathMap = Map<string, Path2D | null>;
type FurrowPaths = { holder: Path2D; strips: Path2D; lines: Path2D };
const FURROW_CACHE_MAX = FURROW_HOLDER_BUDGET * 2;
const TERRAIN_IMAGES = new WeakMap<World['terrain'], WeakMap<Palette, { mapSize: number; image: CanvasImageSource }>>();

function addRing(path: Path2D, ring: Vec2[]): void {
  if (ring.length < 3) return;
  path.moveTo(ring[0].x, ring[0].y);
  for (let i = 1; i < ring.length; i++) path.lineTo(ring[i].x, ring[i].y);
  path.closePath();
}

/** Bounds of a ring, kept with it (rings are immutable scene products). */
const ringBounds = new WeakMap<readonly Vec2[], Float64Array>();
function boundsOf(ring: readonly Vec2[]): Float64Array {
  let b = ringBounds.get(ring);
  if (!b) {
    b = new Float64Array([Infinity, Infinity, -Infinity, -Infinity]);
    for (const p of ring) { if (p.x < b[0]) b[0] = p.x; if (p.y < b[1]) b[1] = p.y; if (p.x > b[2]) b[2] = p.x; if (p.y > b[3]) b[3] = p.y; }
    ringBounds.set(ring, b);
  }
  return b;
}
let clipA = new Float64Array(1024), clipB = new Float64Array(1024);
/** clipRingBox (gen/geo/bool.ts) on a Vec2 ring, same planes, order and arithmetic, on scratch typed arrays:
 * the tuple copies and per-point closures of the generic version cost seconds on map-sized forest and wash rings
 * clipped again for every tile. A ring outside the rectangle is rejected from its cached bounds. */
export function clipRingRect(ring: readonly Vec2[], rect: Rect4): Vec2[] {
  const b = boundsOf(ring);
  if (b[2] < rect.minX || b[0] > rect.maxX || b[3] < rect.minY || b[1] > rect.maxY) return [];
  const need = 2 * (2 * ring.length + 8);
  if (clipA.length < need) { clipA = new Float64Array(need); clipB = new Float64Array(need); }
  let src = clipA, dst = clipB, n = ring.length;
  for (let i = 0; i < n; i++) { src[2 * i] = ring[i].x; src[2 * i + 1] = ring[i].y; }
  for (let plane = 0; plane < 4 && n; plane++) {
    const axis = plane < 2 ? 0 : 1, bound = plane === 0 ? rect.minX : plane === 1 ? rect.maxX : plane === 2 ? rect.minY : rect.maxY, low = plane === 0 || plane === 2;
    // Each edge emits at most two points.
    if (dst.length < 4 * n) dst = new Float64Array(4 * n);
    let m = 0;
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1, px = src[2 * i], py = src[2 * i + 1], qx = src[2 * j], qy = src[2 * j + 1];
      const sp = low ? src[2 * i + axis] - bound : bound - src[2 * i + axis], sq = low ? src[2 * j + axis] - bound : bound - src[2 * j + axis];
      if (sp >= 0) { dst[2 * m] = px; dst[2 * m + 1] = py; m++; }
      if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); dst[2 * m] = px + (qx - px) * t; dst[2 * m + 1] = py + (qy - py) * t; m++; }
    }
    const swap = src; src = dst; dst = swap; n = m;
  }
  clipA = src; clipB = dst;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const x = src[2 * i], y = src[2 * i + 1], last = out[out.length - 1];
    if (!last || last.x !== x || last.y !== y) out.push({ x, y });
  }
  while (out.length > 1 && out[0].x === out[out.length - 1].x && out[0].y === out[out.length - 1].y) out.pop();
  return out;
}
function polyPath(P: new () => Path2D, l: PolyLayer, ids: ArrayLike<number>, minEdge: number, rect?: Rect4): Path2D | null {
  const path = new P();
  const e2 = minEdge * minEdge;
  let any = false;
  for (let n = 0; n < ids.length; n++) {
    const i = ids[n];
    if (rect && !l.index.boxHits(i, rect)) continue;
    const rings: Vec2[][] = [l.polys[i]];
    const h = l.holes?.[i];
    if (h) for (const x of h) rings.push(x);
    for (const ring of rings) {
      // Clip before submitting to Canvas: the GPU otherwise replays map-sized
      // forest/wash paths for every tile and every multiply stamp.
      const pts = rect ? clipRingRect(ring, rect) : ring;
      if (pts.length < 3) continue;
      let lx = pts[0].x, ly = pts[0].y, kept = 1;
      path.moveTo(lx, ly);
      for (let k = 1; k < pts.length; k++) {
        const p = pts[k];
        const dx = p.x - lx, dy = p.y - ly;
        if (e2 > 0 && dx * dx + dy * dy < e2 && k < pts.length - 1) continue;
        path.lineTo(p.x, p.y); lx = p.x; ly = p.y; kept++;
      }
      path.closePath();
      if (kept >= 3) any = true;
    }
  }
  return any ? path : null;
}

function linePath(P: new () => Path2D, l: LineLayer, ids: ArrayLike<number>, minEdge: number): Path2D | null {
  const path = new P();
  const e2 = minEdge * minEdge;
  let any = false;
  for (let n = 0; n < ids.length; n++) {
    const pts = l.lines[ids[n]];
    if (pts.length < 2) continue;
    let lx = pts[0].x, ly = pts[0].y;
    path.moveTo(lx, ly);
    for (let k = 1; k < pts.length; k++) {
      const p = pts[k];
      const dx = p.x - lx, dy = p.y - ly;
      if (e2 > 0 && dx * dx + dy * dy < e2 && k < pts.length - 1) continue;
      path.lineTo(p.x, p.y); lx = p.x; ly = p.y;
    }
    any = true;
  }
  return any ? path : null;
}

/** The runs of one canopy level (roadStyle.ts canopyRuns) of some lines, simplified as linePath does. */
function runPath(P: new () => Path2D, lines: readonly { level: number; pts: { x: number; y: number }[] }[][], level: number, minEdge: number): Path2D | null {
  const path = new P(), e2 = minEdge * minEdge;
  let any = false;
  for (const runs of lines) for (const run of runs) {
    const pts = run.pts;
    if (run.level !== level || pts.length < 2) continue;
    let lx = pts[0].x, ly = pts[0].y;
    path.moveTo(lx, ly);
    for (let k = 1; k < pts.length; k++) {
      const p = pts[k], dx = p.x - lx, dy = p.y - ly;
      if (e2 > 0 && dx * dx + dy * dy < e2 && k < pts.length - 1) continue;
      path.lineTo(p.x, p.y); lx = p.x; ly = p.y;
    }
    any = true;
  }
  return any ? path : null;
}

function defaultCreateCanvas(w: number, h: number): CanvasLike | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h) as unknown as CanvasLike;
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return null;
}

const indicator = (field: Float32Array, test: (value: number, index: number) => boolean): Float32Array => { const out = new Float32Array(field.length); for (let i = 0; i < out.length; i++) if (test(field[i], i)) out[i] = 1; return out; };
type ForestWash = { levels: PolyLayer[]; fringe: PolyLayer[]; depth: Float32Array; reach: Float32Array; n: number };
const sharedForestWashes = new Map<string, ForestWash>();
const hashBuffer = new Float64Array(1), hashWords = new Uint32Array(hashBuffer.buffer);
/** FNV-1a over the exact coordinates of a layer: equal geometry, equal key. */
function layerHash(layer: PolyLayer): string {
  let h = 0x811c9dc5, count = 0;
  const ring = (r: { x: number; y: number }[]): void => {
    h = Math.imul(h ^ r.length, 0x01000193);
    for (let i = 0; i < r.length; i++) {
      hashBuffer[0] = r[i].x; h = Math.imul(Math.imul(h ^ hashWords[0], 0x01000193) ^ hashWords[1], 0x01000193);
      hashBuffer[0] = r[i].y; h = Math.imul(Math.imul(h ^ hashWords[0], 0x01000193) ^ hashWords[1], 0x01000193);
    }
    count += r.length;
  };
  for (let i = 0; i < layer.polys.length; i++) { ring(layer.polys[i]); for (const hole of layer.holes?.[i] ?? []) ring(hole); h = Math.imul(h ^ 0x7fffffff, 0x01000193); }
  return `${layer.polys.length}:${count}:${(h >>> 0).toString(36)}`;
}

export function createCanvasRenderer(canvas: CanvasLike, world0: World, style: MapStyle | Palette, deps: CanvasRendererDeps = {}): CanvasRenderer {
  let sourceWorld = world0;
  let world = cavernDisplayWorld(deps.scene?.renderedWorld ? { ...deps.scene.renderedWorld, options: world0.options, names: world0.names } : renderView(cavernDisplayWorld(world0)));
  const basePalette = biomePalette(style, world.options.biome), pal = applyRenderColors(basePalette, deps.colors);
  let scene = deps.scene ?? buildScene(world0, deps.tileSize, { mask: deps.mask });
  const S = world.mapSize;
  const furrowSize = deps.furrowReferenceSize ?? S;
  const now = deps.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const P: new () => Path2D = deps.Path2D ?? RecPath2D;
  const makeCanvas = deps.createCanvas ?? defaultCreateCanvas;
  const canopy = deps.vegetation === 'canopy' && !isUnderdarkBiome(world.options.biome) ? new CanvasCanopy(world.seed, pal, makeCanvas) : undefined;
  let brushes: CanvasBrushes | undefined;
  if (deps.brushes && supportsPaintedBiome(world.options.biome)) { try { brushes = new CanvasBrushes(world, pal, deps.brushes, makeCanvas); } catch { /* Keep classic when allocations/tinting are unavailable. */ } }
  const brushIds = new WeakMap<TextureLayer, number>();
  let brushId = 0;
  const u = S / 1600; // same unit as svg.ts, used for a few decorative widths

  const cache: PathMap = new Map();
  const furrowCache = new Map<number, FurrowPaths>();
  const treeMarks = new Map<TextureLayer, Map<number, Mark[]>>();
  const penMarks = new Map<string, PenMark[]>(), penSheets = new Map<string, ParchmentSymbols>();
  const forestWashes = new Map<string, ForestWash>();
  let built = 0;
  let labels: Label[] = [];
  const overlays: Overlays = { labels: world.options.labels !== false, legend: !!world.options.legend, cartouche: true };
  let text = DEFAULT_TEXT;
  let mapLabels: MapLabel[] = buildMapLabels(world, pal.name, pal, text);
  const family = FONT_STACKS[pal.name] ?? pal.fontFamily;
  const widthCache = new Map<string, number>();
  let placedLast: PlacedMapLabel[] = [];
  let legendPanel: Panel | null = null;
  let legendKey = '';
  /** The legend with the semantic classes currently shown; rebuilt only when they change. */
  const legendNow = (): Panel => {
    const extra = deps.semantic?.legend?.() ?? [], key = extra.map(e => `${e.label}|${e.color}|${e.look}`).join(';');
    if (!legendPanel || key !== legendKey) { legendPanel = legendModel(world, pal, extra); legendKey = key; }
    return legendPanel;
  };
  let infoPanel: Panel | null = null;
  let terrainImg: CanvasImageSource | null | undefined;
  let waterImg: CanvasImageSource | null | undefined;
  let cavernRockImg: CanvasImageSource | null | undefined;
  let densityImg: CanvasImageSource | null | undefined;
  const patterns = new Map<string, CanvasPattern | null>();
  let litCache: Float32Array | undefined;
  let forestRoom: ForestRoom | undefined;
  let stats: FrameStats = { band: 0, scale: 0, ms: 0, tilesDrawn: 0, bigDrawn: 0, pathsBuilt: 0, pathCache: 0, buildingsCandidate: 0, buildingsDrawn: false, textureTiles: 0 };
  const rasterCache = new RasterTileCache<CanvasImageSource>(deps.rasterBytes);
  const mapPyramid = new Map<string, { x: number; y: number; span: number; pixels: number; gutter: number; density: number; semantic: string; light: boolean }>();
  let activeLight = false, activeLive = false, activeDpr: number | undefined;
  const rasterFill = new LiveTileFill(now);
  const previewFill = new LiveTileFill(now);
  let lastRaster: { canvas: CanvasLike; view: View; dpr: number } | undefined;
  const suspendLive = (): void => { rasterFill.suspend(); previewFill.suspend(); };
  const dropLastRaster = (): void => { if (lastRaster) { lastRaster.canvas.width = 0; lastRaster.canvas.height = 0; } lastRaster = undefined; };
  /** The whole map rasterised once at a coarse density: a live view shows it under its missing tiles, never blank tiles. */
  let preview: { key: string; canvas: CanvasLike } | undefined;
  const dropPreview = (): void => { previewFill.suspend(); if (preview) { preview.canvas.width = 0; preview.canvas.height = 0; } preview = undefined; };
  let rasterFailed = false;
  /** Pre-composited sprite layers (drawLayerTiles); null marks a tile with nothing to draw. */
  const layerTiles = new RasterTileCache<CanvasImageSource | null>(LAYER_TILE_BYTES);
  let layerTilesFailed = false;
  /** False when the sprite-layer tiles of the whole view would not fit the cache together (they would evict each other). */
  let layerTilesFit = true;
  /** Lone trees stepping out of the woods, per open land layer and index tile. */
  const strayMarks = new Map<TextureLayer, Map<number, Mark[]>>();

  const polyL = (n: string): PolyLayer | undefined => scene.poly.get(n);
  const linesOf = (pred: (l: LineLayer) => boolean): LineLayer[] => scene.lines.filter(pred);

  /**
   * Land = the map minus the sea and lakes (evenodd): roads, tracks and street strokes are clipped to it, so a stroke
   * widened to its minimum on-screen width never spills over the water (bridges are drawn afterwards, unclipped).
   */
  let landPath: Path2D | null | undefined;
  function landClip(): Path2D | null {
    if (landPath !== undefined) return landPath;
    const ls = ['sea', 'lakes'].map((n) => scene.poly.get(n)).filter((l): l is PolyLayer => !!l);
    if (!ls.length) return (landPath = null);
    const p = new P();
    const m = 50;
    p.moveTo(-m, -m); p.lineTo(S + m, -m); p.lineTo(S + m, S + m); p.lineTo(-m, S + m); p.closePath();
    for (const l of ls) for (let i = 0; i < l.polys.length; i++) {
      for (const r of [l.polys[i], ...(l.holes?.[i] ?? [])]) {
        if (r.length < 3) continue;
        p.moveTo(r[0].x, r[0].y);
        for (let k = 1; k < r.length; k++) p.lineTo(r[k].x, r[k].y);
        p.closePath();
      }
    }
    return (landPath = p);
  }

  function cached(key: string, make: () => Path2D | null): Path2D | null {
    let p = cache.get(key);
    if (p === undefined) {
      p = make(); built++;
      cache.set(key, p);
      if (cache.size > CACHE_MAX) {
        let drop = CACHE_MAX >> 2;
        for (const k of cache.keys()) { cache.delete(k); if (--drop <= 0) break; }
      }
    }
    cache.delete(key); cache.set(key, p);
    return p;
  }

  /** A clip contains only candidate tiles in this view, and remains exact (no LOD decimation). */
  /** Layer tile canvases drawn into a GPU recording (see the layer tile release). */
  const recordedTiles = new WeakSet<object>();
  /** True while drawVector records for the GPU engine (set at each drawVector entry). */
  let recordingNow = false;
  /** Diagnostics: slowest recording of a drawVector section (vectorEngineStats().liveParts, keys 'rec:*'). */
  const timedRec = <T,>(name: string, f: () => T): T => { if (!recordingNow) return f(); const t = now(); try { return f(); } finally { noteLivePart('rec:' + name, t); } };
  function visibleClip(l: PolyLayer, rect: Rect4): Path2D | null {
    const tiles = l.index.tilesInRect(rect), big = l.index.bigInRect(rect);
    const stamp = tiles.map((t) => `${t}:${l.tileKeys?.[t] ?? ''}`).join(';') + '|' + big.map((i) =>
      `${i}:${l.bigKeys?.[Array.prototype.indexOf.call(l.index.big, i)] ?? ''}`).join(';');
    const recording = recordingNow;
    return cached(`${l.name}|clip|${recording ? 'gpu' : `${rect.minX},${rect.minY},${rect.maxX},${rect.maxY}`}|${stamp}`, () => {
      const ids: number[] = [];
      for (const t of tiles) for (const i of l.index.itemsOf(t)) ids.push(i);
      ids.push(...big);
      return polyPath(P, l, ids, 0, recording ? undefined : rect);
    });
  }

  /** Quarter masks preserve explicit park/garden holes; their union remains exact across retained parts. */
  function forestClip(rect: Rect4): Path2D | null {
    const l = polyL('u-forest-clearings');
    const orchard = scene.textures.find(t => t.kind === 'orchard');
    if (!l && !orchard) return null;
    const view = { minX: rect.minX - 20, minY: rect.minY - 20, maxX: rect.maxX + 20, maxY: rect.maxY + 20 };
    const tiles = l?.index.tilesInRect(view) ?? [], big = l?.index.bigInRect(view) ?? [];
    const orchards = orchard?.index.query(view) ?? [];
    const stamp = tiles.map((t) => `${t}:${l!.tileKeys?.[t] ?? ''}`).join(';') + '|' + big.map((i) =>
      `${i}:${l!.bigKeys?.[Array.prototype.indexOf.call(l!.index.big, i)] ?? ''}`).join(';');
    return cached(`u-forest-clearings|clip|${stamp}|orchards:${orchards.join(',')}`, () => {
      const ids = new Set<number>(big);
      for (const t of tiles) for (const i of l!.index.itemsOf(t)) ids.add(i);
      const excluded = unionMany([...ids].map((i) => ({ outer: l!.polys[i], holes: l!.holes?.[i] ?? [] })).concat(orchards.map(i => ({ outer: orchard!.areas[i].poly, holes: orchard!.areas[i].holes ?? [] }))), 24, true);
      const p = new P();
      addRing(p, [{ x: 0, y: 0 }, { x: S, y: 0 }, { x: S, y: S }, { x: 0, y: S }]);
      for (const shape of excluded) {
        addRing(p, orientPos(shape.outer).slice().reverse());
        for (const h of shape.holes) addRing(p, orientPos(h));
      }
      return p;
    });
  }

  /** Fade inside the retained woodland boundary; no cover polygon is displaced. */
  function forestWash(name: string): ForestWash | undefined {
    const steps = forestWashSteps(name);
    let step = steps.next();
    while (!step.done) step = steps.next();
    return step.value;
  }
  function* forestWashSteps(name: string): Generator<boolean, ForestWash | undefined> {
    const retained = forestWashes.get(name);
    if (retained) return retained;
    const layer = polyL(name);
    if (!layer) return undefined;
    // The wash is a pure function of the layer geometry: share it across renderers and scene rebuilds (every progress frame builds a new scene).
    const shareKey = `${name}|${S}|${scene.tileSize}|${layerHash(layer)}`;
    const shared = sharedForestWashes.get(shareKey);
    if (shared) { forestWashes.set(name, shared); return shared; }
    const n = Math.min(1024, Math.max(128, Math.ceil(S / 6))), cell = S / n;
    const mask = new Uint8Array(n * n);
    for (let i = 0; i < layer.polys.length; i++) {
      rasterizePolys([layer.polys[i], ...(layer.holes?.[i] ?? [])], n, n, cell, mask);
      if ((i & 31) === 31) yield false;
    }
    yield false;
    const reach = distanceField(mask, n, n, cell).dist;
    yield false;
    // Tracks and streams cut narrow gaps: the wood carries on across them, only its true edges fade.
    const depth = distanceField(Uint8Array.from(mask, (v, j) => v || reach[j] < 20 ? 0 : 1), n, n, cell).dist;
    const layerOf = (suffix: string, ind: Float32Array): PolyLayer => {
      const regions = vectorizeRegions(ind, n, n, cell, 0, { x0: 0, y0: 0, x1: n - 1, y1: n - 1 });
      const polys = regions.map(r => r.outer), holes = regions.map(r => r.holes);
      return { name: `${name}-${suffix}`, polys, holes, index: new TileIndex(S, scene.tileSize, boxesOf(polys), 'center') };
    };
    yield false;
    const levels: PolyLayer[] = [], fringe: PolyLayer[] = [];
    for (const [i, fraction] of [.125, .3125, .5625, .875].entries()) {
      levels.push(layerOf(`edge-${i}`, indicator(depth, (d, j) => mask[j] !== 0 && d >= FOREST_EDGE_WIDTH * fraction)));
      yield false;
    }
    // Shade of the woods on the rough ground around them, in steps like the V1 halo.
    for (const [i, distance] of [14, 30, 48, 68, 90, 114, 140].entries()) {
      fringe.push(layerOf(`fringe-${i}`, indicator(reach, d => d < distance)));
      yield false;
    }
    const result = { levels, fringe, depth, reach, n };
    forestWashes.set(name, result);
    sharedForestWashes.set(shareKey, result); if (sharedForestWashes.size > 3) sharedForestWashes.delete(sharedForestWashes.keys().next().value!);
    return result;
  }

  function forestWeight(x: number, y: number): number {
    const wash = forestWash('lu-forest');
    if (!wash) return 0;
    const xx = Math.min(wash.n - 1, Math.max(0, Math.floor(x / S * wash.n)));
    const yy = Math.min(wash.n - 1, Math.max(0, Math.floor(y / S * wash.n)));
    const t = Math.min(1, wash.depth[yy * wash.n + xx] / (FOREST_EDGE_WIDTH * 1.4));
    return .3 + .7 * t * t * (3 - 2 * t);
  }
  /** Lone trees stepping out of the wood: frequent near the edge, gone within 120 m. */
  function forestStray(x: number, y: number): number {
    const wash = forestWash('lu-forest');
    if (!wash) return 0;
    const xx = Math.min(wash.n - 1, Math.max(0, Math.floor(x / S * wash.n)));
    const yy = Math.min(wash.n - 1, Math.max(0, Math.floor(y / S * wash.n)));
    const t = 1 - Math.min(1, wash.reach[yy * wash.n + xx] / 120);
    return .34 * t * t;
  }

  function paintMargin(scale: number, input: Scene = scene): number {
    let width = 10 * u;
    for (const l of input.lines) width = Math.max(width, l.width * (l.role === 'wall' ? pal.urban.wallScale : 1));
    const sh = pal.urban.shadow;
    return width + (sh ? Math.max(Math.abs(sh.dx), Math.abs(sh.dy)) : 2) + 32 / scale;
  }

  // One measure function for the renderer's life (its identity keys the layout memo); it measures on the context of the current draw.
  let measureCtx: CanvasRenderingContext2D | undefined;
  const measureLabel = (text: string, size: number, st: KindStyle): number => {
    const key = `${st.family ?? family}|${st.italic ? 'i' : ''}${st.bold ? 'b' : ''}|${Math.round(size * 10)}|${text}`;
    let w = widthCache.get(key);
    if (w === undefined) {
      measureCtx!.font = fontString(st, Math.round(size * 10) / 10, st.family ?? family);
      w = measureCtx!.measureText(text).width;
      if (widthCache.size > 20000) widthCache.clear();
      widthCache.set(key, w);
    }
    return w;
  };
  let placementLast: { labels: MapLabel[]; cx: number; cy: number; scale: number; w: number; h: number; maxLabels: number; pad: number; reserved: boolean; placed: PlacedMapLabel[] } | undefined;
  let textSourcesOf: readonly CityScene[] | undefined, textLabelsOf: MapLabel[] | undefined, combinedLabels: MapLabel[] = mapLabels;
  /** The last placement moved with the map to `view`: point and area labels by their anchor (a name stays by its
   * symbol), path labels glyph by glyph along their line. Nothing is placed again, so nothing jumps during a gesture. */
  function movedPlacement(last: NonNullable<typeof placementLast>, view: View, cssW: number, cssH: number): PlacedMapLabel[] {
    const k = view.scale / last.scale, ox = (last.cx - view.cx) * view.scale + cssW / 2, oy = (last.cy - view.cy) * view.scale + cssH / 2;
    const mx = (x: number): number => (x - cssW / 2) * k + ox, my = (y: number): number => (y - cssH / 2) * k + oy;
    return last.placed.map(pl => {
      const symbol = pl.symbol && { ...pl.symbol, x: mx(pl.symbol.x), y: my(pl.symbol.y) };
      if (pl.path || pl.glyphs.some(g => g.a !== 0)) {
        return { ...pl, cx: mx(pl.cx), cy: my(pl.cy), symbol, path: pl.path?.map(([x, y]) => [mx(x), my(y)] as [number, number]),
          glyphs: pl.glyphs.map(g => ({ ...g, x: mx(g.x), y: my(g.y) })) };
      }
      const ax = pl.symbol ? pl.symbol.x : (pl.label.x - last.cx) * last.scale + cssW / 2, ay = pl.symbol ? pl.symbol.y : (pl.label.y - last.cy) * last.scale + cssH / 2;
      const dx = mx(ax) - ax, dy = my(ay) - ay;
      return { ...pl, cx: pl.cx + dx, cy: pl.cy + dy, symbol, glyphs: pl.glyphs.map(g => ({ ...g, x: g.x + dx, y: g.y + dy })) };
    });
  }
  function drawText(ctx: CanvasRenderingContext2D, view: View, cssW: number, cssH: number, moving = false): void {
    const sources = deps.textSources?.();
    if (sources !== textSourcesOf || textLabelsOf !== mapLabels) {
      textSourcesOf = sources; textLabelsOf = mapLabels;
      const replaced = (world.names?.entries ?? []).flatMap(e => e.replacedAnchor ? [e.replacedAnchor] : []);
      combinedLabels = sources?.length ? [...mapLabels, ...sources.flatMap(scene => cityTextLabels(scene, text, pal, world)).filter(label => !replaced.some(p => Math.abs(p.x-label.x)<.01 && Math.abs(p.y-label.y)<.01))] : mapLabels;
    }
    placedLast = [];
    if (overlays.labels && combinedLabels.length) {
      measureCtx = ctx;
      const reserved = compactMapPanels(cssW, cssH) && overlays.cartouche ? [{ x0: 12, y0: cssH - 40, x1: 132, y1: cssH - 12 }] : undefined;
      // Same labels, view and options as the last frame (tile arrivals, style repaints): the placement is the same.
      const placement = textPlacement(text), last = placementLast;
      if (last && last.labels === combinedLabels && last.cx === view.cx && last.cy === view.cy && last.scale === view.scale && last.w === cssW && last.h === cssH
        && last.maxLabels === placement.maxLabels && last.pad === placement.pad && !last.reserved === !reserved) placedLast = last.placed;
      else if (moving && last && last.labels === combinedLabels && last.w === cssW && last.h === cssH) placedLast = movedPlacement(last, view, cssW, cssH);
      else {
        // Layouts are memoised per (measure, label style, text, size): a pan at a constant zoom lays nothing out again.
        const previous = last?.labels === combinedLabels ? new Set(last.placed.map(pl => pl.label)) : undefined;
        placedLast = placeMapLabels(combinedLabels, view, cssW, cssH, measureLabel, { ...placement, reserved, previous });
        placementLast = { labels: combinedLabels, cx: view.cx, cy: view.cy, scale: view.scale, w: cssW, h: cssH, maxLabels: placement.maxLabels, pad: placement.pad, reserved: !!reserved, placed: placedLast };
      }
      drawMapLabels(ctx, placedLast, pal, family);
    }
  }

  function update(nextSource: World, nextScene: Scene, nextStyle: MapStyle | Palette = style): boolean {
    if ((brushes || canopy) && nextSource.seed !== sourceWorld.seed) return false;
    if (nextSource.mapSize !== S || biomePalette(nextStyle, nextSource.options.biome) !== basePalette) return false;
    // Prepare potentially fallible metadata before committing the replacement.
    const nextWorld = cavernDisplayWorld(nextScene.renderedWorld ? { ...nextScene.renderedWorld, options: nextSource.options } : renderView(cavernDisplayWorld(nextSource)));
    const nextLabels = buildMapLabels(nextWorld, pal.name, pal, text);
    const terrainChanged = nextSource.terrain !== sourceWorld.terrain;
    // Dirty-region update (a town build or edit on the same terrain): tiles outside the changed areas stay cached,
    // and the last frame stands in for the repainted tiles until they are ready.
    const local = !!nextScene.dirty && nextScene !== scene && !terrainChanged && world.options.landuse === nextSource.options.landuse && world.options.contours === nextSource.options.contours;
    suspendLive(); if (!local) dropLastRaster(); dropPreview();
    if (!local) mapPyramid.clear();
    if (nextSource.seed !== sourceWorld.seed) cavernRockImg = undefined;
    if (terrainChanged || nextScene.poly.get('sea') !== scene.poly.get('sea') || nextScene.poly.get('lakes') !== scene.poly.get('lakes')) landPath = undefined;
    if (terrainChanged) { terrainImg = waterImg = undefined; cache.clear(); rasterCache.clear(); }
    if (nextScene.density?.cov !== scene.density?.cov) densityImg = undefined;
    if (nextScene.furrows !== scene.furrows) furrowCache.clear();
    if (nextScene !== scene) { treeMarks.clear(); treeSprites.clear(); penMarks.clear(); forestWashes.clear(); strayMarks.clear(); }
    // Woods depend on the scene, the forest wash and the roads/farms that clear them (forestRoom below): rebuild them all,
    // or, on a local update, those near the changed areas (the dirty rects already include the reach of the derived products).
    if (local) {
      for (const tl of nextScene.textures) { const old = scene.textures.find(o => o.kind === tl.kind), id = old && brushIds.get(old); if (id !== undefined) brushIds.set(tl, id); }
      layerTiles.invalidate(nextScene.dirty, LAYER_TILE_REACH + LAYER_TILE_GUTTER);
    } else if (nextScene !== scene || terrainChanged || nextSource.roads !== sourceWorld.roads || nextSource.landuse !== sourceWorld.landuse) layerTiles.clear();
    // Path caches are keyed by index tile: only the incremental builder's tile keys tell a rebuilt tile from a retained one.
    if (nextScene !== scene && (!nextScene.dirty || ![...nextScene.poly.values()].some(l => l.tileKeys))) cache.clear();
    if (world.options.landuse !== nextSource.options.landuse || world.options.contours !== nextSource.options.contours) rasterCache.clear();
    // Entries can predate several scene updates; expand by the new absolute paint radius, not a last-update delta.
    else if (nextScene !== scene) rasterCache.invalidate(nextScene.dirty, paintMargin(1, nextScene));
    if (local) for (const key of [...mapPyramid.keys()]) if (!rasterCache.has(key)) mapPyramid.delete(key);
    scene = nextScene; sourceWorld = nextSource; world = nextWorld; mapLabels = nextLabels;
    overlays.labels = world.options.labels !== false; overlays.legend = !!world.options.legend;
    legendPanel = infoPanel = null; litCache = undefined; forestRoom = undefined;
    // The retained GPU list keeps showing until its replacement is recorded (no blank frame after a town build).
    if (retained) retained.stale = true;
    retainedPending = undefined;
    return true;
  }

  /** One bounded LRU record per holder, so plough textures never evict paths used by other map layers. */
  function furrowPaths(i: number): FurrowPaths {
    let paths = furrowCache.get(i);
    if (paths) { furrowCache.delete(i); furrowCache.set(i, paths); return paths; }
    const a = scene.furrows!.areas[i], holder = new P(), strips = new P(), lines = new P();
    addRing(holder, orientPos(a.poly));
    for (const hole of a.holes ?? []) addRing(holder, orientPos(hole).slice().reverse());
    for (const strip of a.strips) addRing(strips, orientPos(strip));
    for (const line of furrowLines(a.poly, furrowSize, a.angle)) { lines.moveTo(line[0].x, line[0].y); lines.lineTo(line[1].x, line[1].y); }
    paths = { holder, strips, lines }; built += 3;
    furrowCache.set(i, paths);
    if (furrowCache.size > FURROW_CACHE_MAX) {
      const oldest = furrowCache.keys().next().value;
      if (oldest !== undefined) furrowCache.delete(oldest);
    }
    return paths;
  }

  // ---- offscreen bitmaps -------------------------------------------------------------
  function toBitmap(rgba: Uint8ClampedArray, w: number, h: number): CanvasImageSource | null {
    const c = makeCanvas(w, h);
    const cx = c?.getContext('2d');
    if (!c || !cx || typeof ImageData === 'undefined') return null;
    cx.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer), w, h), 0, 0);
    return c as unknown as CanvasImageSource;
  }
  function getCavernRock(): CanvasImageSource | null {
    if (cavernRockImg !== undefined) return cavernRockImg;
    cavernRockImg = null;
    if (typeof ImageData === 'undefined') return null;
    const r = cavernRockPixels(world.seed, S, pal);
    return (cavernRockImg = toBitmap(r.rgba, r.width, r.width));
  }
  function getWater(): CanvasImageSource | null {
    if (waterImg !== undefined) return waterImg;
    const material = worldWaterPixels(world, pal), rgba = new Uint8ClampedArray(material.n * material.n * 4);
    for (let i = 0; i < material.n * material.n; i++) {
      rgba.set(material.rgb.subarray(i * 3, i * 3 + 3), i * 4); rgba[i * 4 + 3] = 255;
    }
    return (waterImg = toBitmap(rgba, material.n, material.n));
  }
  function getTerrain(): CanvasImageSource | null {
    if (terrainImg !== undefined) return terrainImg;
    try {
      if (deps.terrain) terrainImg = deps.terrain(world, pal);
      else {
        const shared = !deps.createCanvas && TERRAIN_IMAGES.get(world.terrain)?.get(pal);
        if (shared && shared.mapSize === world.mapSize) return (terrainImg = shared.image);
        const r = renderTerrainPixels(world, pal);
        if (r.rgb) {
          const rgba = new Uint8ClampedArray(r.w * r.h * 4);
          for (let i = 0, j = 0; i < r.w * r.h; i++, j += 4) { rgba[j] = r.rgb[i * 3]; rgba[j + 1] = r.rgb[i * 3 + 1]; rgba[j + 2] = r.rgb[i * 3 + 2]; rgba[j + 3] = 255; }
          terrainImg = toBitmap(rgba, r.w, r.h);
          if (terrainImg && !deps.createCanvas) {
            const palettes = TERRAIN_IMAGES.get(world.terrain) ?? new WeakMap<Palette, { mapSize: number; image: CanvasImageSource }>();
            palettes.set(pal, { mapSize: world.mapSize, image: terrainImg }); TERRAIN_IMAGES.set(world.terrain, palettes);
          }
        } else terrainImg = null;
      }
    } catch { terrainImg = null; }
    return terrainImg;
  }
  /** Tiling pattern (tile of `tw` x `th` meters drawn at 14 px/m, rotated `rot` degrees); null where canvases/DOMMatrix are unavailable (Node). */
  function getPattern(ctx: CanvasRenderingContext2D, key: string, tw: number, th: number, rot: number, draw: (c: CanvasRenderingContext2D, k: number) => void): CanvasPattern | null {
    // A pattern made by a native context never goes to the recorder, nor the reverse: one cache per engine.
    key = (ctx instanceof RecordingContext ? 'rec|' : 'cpu|') + key;
    let p = patterns.get(key);
    if (p !== undefined) return p;
    p = null;
    try {
      const k = 14;
      const c = makeCanvas(Math.ceil(tw * k), Math.ceil(th * k));
      const cx = c?.getContext('2d');
      if (c && cx && typeof DOMMatrix !== 'undefined') {
        cx.lineCap = 'round';
        draw(cx, k);
        p = ctx.createPattern(c as unknown as CanvasImageSource, 'repeat');
        p?.setTransform(new DOMMatrix().rotate(rot).scale(1 / k));
      }
    } catch { p = null; }
    patterns.set(key, p ?? null);
    return p ?? null;
  }
  function getDensity(): CanvasImageSource | null {
    if (densityImg !== undefined) return densityImg;
    densityImg = null;
    const d = scene.density;
    if (!d) return null;
    const m = /^#([0-9a-f]{6})$/i.exec(pal.ink);
    const v = m ? parseInt(m[1], 16) : 0x3d2f20;
    const rgba = new Uint8ClampedArray(d.w * d.h * 4);
    for (let i = 0; i < d.cov.length; i++) {
      const c = d.cov[i];
      rgba[i * 4] = (v >> 16) & 255; rgba[i * 4 + 1] = (v >> 8) & 255; rgba[i * 4 + 2] = v & 255;
      rgba[i * 4 + 3] = Math.round(255 * Math.min(0.5, Math.sqrt(c) * 0.62));
    }
    densityImg = toBitmap(rgba, d.w, d.h);
    return densityImg;
  }

  // ---- frame ---------------------------------------------------------------------------
  function rasterBudget(rect: Rect4, scale: number): string {
    const count = (l?: PolyLayer): number => l ? l.index.tilesInRect(rect).reduce((n, t) => n + l.index.itemsOf(t).length, l.index.bigInRect(rect).length) : 0;
    const masses = count(polyL('u-masses')), buildings = count(polyL('u-bldg'));
    let furrows = 0;
    if (scene.furrows) for (const i of scene.furrows.index.query(rect)) {
      const b = i * 4, boxes = scene.furrows.index.boxes;
      if (Math.min(boxes[b + 2] - boxes[b], boxes[b + 3] - boxes[b + 1]) * scale >= FURROW_MIN_PX) furrows++;
      if (furrows > FURROW_HOLDER_BUDGET) break;
    }
    return `${masses <= BUILDING_BUDGET_FULL},${masses <= BUILDING_BUDGET_MAX},${buildings <= BUILDING_BUDGET_INDIV},${furrows <= FURROW_HOLDER_BUDGET}|` +
      scene.textures.map((tl) => `${tl.kind}:${tl.index.tilesInRect(rect).length <= 500}`).join(',');
  }

  /** Capture callers omit options: exact scale, synchronous completion, full detail. */
  function draw(view: View, options?: { live: boolean }): FrameStats {
    activeLive = !!options?.live; activeLight = displayQualityFor(activeLive) === 'light';
    if (!activeLive) suspendLive();
    try { return drawFrame(view); }
    finally { activeLight = activeLive = false; activeDpr = undefined; }
  }

  /** Half-octave live tiles stretch by at most sqrt(2); exports retain their exact raster density. */
  /**
   * GPU engine, live view: the vector map of a region around the view is recorded once per half-octave of scale and
   * replayed by the GPU on every frame with the view matrix. No tiles: pan and zoom inside the region never re-record
   * nor repaint anything on the CPU; leaving it, or reaching a new detail level, records once after the frame while the
   * previous list keeps showing.
   */
  /** One horizontal band of a retained region: its own list, recorded around its centre at the region's scale. */
  type RetainedPart = { list: DisplayList; rect: Rect4; cx: number; cy: number; w: number; h: number };
  type RetainedPlan = { key: string; rect: Rect4; scale: number; dpr: number; bands: Rect4[] };
  let retained: (RetainedPlan & { parts: RetainedPart[]; stale: boolean; firstMs?: number }) | undefined;
  let retainedJob: ReturnType<typeof setTimeout> | undefined, retainedWanted: { view: View; cssW: number; cssH: number; dpr: number; key: string; light: boolean } | undefined;
  /** A region being recorded band by band, one band per idle step; it replaces `retained` once complete. */
  let retainedPending: (RetainedPlan & { parts: RetainedPart[]; light: boolean; ms: number }) | undefined;
  let retainedFailed = '', disposed = false, retainedSince = 0;
  function retainedPlan(view: View, cssW: number, cssH: number, dpr: number, key: string): RetainedPlan {
    const scale = 2 ** (Math.round(2 * Math.log2(view.scale)) / 2), hw = cssW / view.scale * (.5 + RETAIN_MARGIN), hh = cssH / view.scale * (.5 + RETAIN_MARGIN);
    // Region edges on a lattice (a power of two near half the view): panning back and forth meets the same regions,
    // whose region-keyed products (forest clearings union) stay cached.
    const step = 2 ** Math.round(Math.log2(Math.max(hw, hh) / 2));
    const rect: Rect4 = { minX: Math.floor((view.cx - hw) / step) * step, minY: Math.floor((view.cy - hh) / step) * step, maxX: Math.ceil((view.cx + hw) / step) * step, maxY: Math.ceil((view.cy + hh) / step) * step };
    const bands: Rect4[] = [];
    for (let i = 0; i < RETAIN_BANDS; i++) bands.push({ minX: rect.minX, maxX: rect.maxX, minY: rect.minY + (rect.maxY - rect.minY) * i / RETAIN_BANDS, maxY: rect.minY + (rect.maxY - rect.minY) * (i + 1) / RETAIN_BANDS });
    return { key, rect, scale, dpr, bands };
  }
  /** Records one band; undefined (and the key marked failed) when the recorder cannot represent it. */
  function recordBand(plan: RetainedPlan, band: Rect4): RetainedPart | undefined {
    const cx = (band.minX + band.maxX) / 2, cy = (band.minY + band.maxY) / 2;
    const w = Math.max(1, Math.ceil((band.maxX - band.minX) * plan.scale * plan.dpr)), h = Math.max(1, Math.ceil((band.maxY - band.minY) * plan.scale * plan.dpr));
    const rec = new RecordingCanvas(w, h);
    let list: DisplayList | undefined;
    try { drawVector({ cx, cy, scale: plan.scale }, rec as unknown as CanvasLike, 'map', band); list = rec.finish(); }
    catch (error) { noteGpuFallback(`record: ${error instanceof Error ? error.message : String(error)}`); }
    finally { releaseDrapeTemps(); }
    if (!list || list.unsupported) { if (list?.unsupported) noteGpuFallback(list.unsupported); retainedFailed = plan.key; return undefined; }
    return { list, rect: band, cx, cy, w, h };
  }
  /** Whole region at once: the first display, which has nothing else to show. */
  function recordRetained(view: View, cssW: number, cssH: number, dpr: number, key: string): boolean {
    const t0 = now(), plan = retainedPlan(view, cssW, cssH, dpr, key), parts: RetainedPart[] = [];
    for (const band of plan.bands) { const part = recordBand(plan, band); if (!part) return false; parts.push(part); }
    retained = { ...plan, parts, stale: false, firstMs: now() - t0 };
    return true;
  }
  /** One idle step of the progressive recording: a band, then its GPU upload; the next step is scheduled until done. */
  function recordStep(): void {
    retainedJob = undefined;
    const want = retainedWanted; if (!want || disposed) return;
    if (!retainedPending || retainedPending.key !== want.key || retainedPending.dpr !== want.dpr || retainedPending.light !== want.light
      || !covers(retainedPending.rect, viewRect(want.view, want.cssW, want.cssH)))
      retainedPending = { ...retainedPlan(want.view, want.cssW, want.cssH, want.dpr, want.key), parts: [], light: want.light, ms: 0 };
    const pending = retainedPending, live = activeLive, light = activeLight, t = now();
    activeLive = true; activeLight = pending.light;
    let part: RetainedPart | undefined;
    try { part = recordBand(pending, pending.bands[pending.parts.length]); } finally { activeLive = live; activeLight = light; }
    if (!part) { retainedPending = undefined; deps.invalidate!(); return; }
    // Upload now, in this step, rather than in the first frame that replays the new region.
    try { vectorRasterizer()?.prepare(part.list); } catch (error) { noteGpuFailure(error); }
    pending.parts.push(part); pending.ms += now() - t;
    noteLivePart('record-step', t);
    if (pending.parts.length < pending.bands.length) { retainedJob = setTimeout(recordStep, 0); return; }
    retained = { ...pending, stale: false, firstMs: pending.ms }; retainedPending = undefined;
    deps.invalidate!();
  }
  const covers = (outer: Rect4, inner: Rect4): boolean => outer.minX <= inner.minX && outer.minY <= inner.minY && outer.maxX >= inner.maxX && outer.maxY >= inner.maxY;
  function drawRetained(view: View): FrameStats | undefined {
    const gpu = vectorRasterizer(), ctx = canvas.getContext('2d');
    if (!gpu || !ctx || !deps.invalidate) return undefined;
    const start = now(), dpr = deps.dpr ?? (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1;
    const cssW = canvas.width / dpr, cssH = canvas.height / dpr, rect = viewRect(view, cssW, cssH);
    const scale = 2 ** (Math.round(2 * Math.log2(view.scale)) / 2);
    const key = `${scale}|${dpr}|${activeLight}|${deps.semantic?.key() ?? ''}|${deps.roadStyle?.().emphasis ?? 1}|${roadCanopyRevision()}|${whiteWaterRevision()}`;
    if (retainedFailed === key) return undefined;
    const r0 = retained;
    if (!r0 || r0.stale || r0.key !== key || !covers(r0.rect, rect)) {
      // Only a moving view postpones the recording: redraws of a still view (readiness loops, progressive layers) must
      // not, or the recording would never start. A long gesture still records after RETAIN_MAX_WAIT_MS.
      const before = retainedWanted, moved = !before || before.key !== key || before.view.cx !== view.cx || before.view.cy !== view.cy || before.view.scale !== view.scale;
      retainedWanted = { view: { ...view }, cssW, cssH, dpr, key, light: activeLight };
      if (retainedJob === undefined && !retainedPending) retainedSince = now();
      // Nothing to show yet (or another pixel ratio): record now. Otherwise once the view rests (debounced), band by
      // band over idle steps: a gesture keeps replaying the previous list at the new scale, and no step blocks long.
      if (!r0 || r0.dpr !== dpr) { const t = now(); if (!recordRetained(view, cssW, cssH, dpr, key)) return undefined; noteLivePart('record-sync', t); }
      else if (moved && now() - retainedSince < RETAIN_MAX_WAIT_MS || retainedJob === undefined && !retainedPending) {
        clearTimeout(retainedJob); retainedJob = setTimeout(recordStep, RETAIN_SETTLE_MS);
      }
    }
    const r = retained!, k = view.scale / r.scale, W = canvas.width, H = canvas.height;
    // Recorded device pixels of each band -> this frame's device pixels; each band only paints its own rows.
    const toX = (x: number): number => dpr * view.scale * (x - view.cx) + W / 2, toY = (y: number): number => dpr * view.scale * (y - view.cy) + H / 2;
    const parts = r.parts.map(p => ({ list: p.list, post: [k, 0, 0, k, -k * p.w / 2 + toX(p.cx), -k * p.h / 2 + toY(p.cy)] as Mat,
      scissor: [toX(p.rect.minX), toY(p.rect.minY), toX(p.rect.maxX), toY(p.rect.maxY)] as const }));
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, W, H);
    const t1 = now();
    try {
      gpu.rasterizeParts(parts, ctx, 0, 0, [W, H]); noteLivePart('replay', t1);
      const rs = gpu.lastStats(); noteLiveCount('n:draws', rs.drawCalls); noteLiveCount('n:clips', rs.clips ?? 0); noteLiveCount('n:ops', rs.ops ?? 0); noteLiveCount('n:ktri', Math.round(rs.triangles / 1000));
    }
    catch (error) { noteGpuFailure(error); retained = undefined; return undefined; }
    if (r.firstMs !== undefined) { noteGpuTile(r.firstMs, now() - t1); r.firstMs = undefined; }
    const overlay = drawVector(view, canvas, 'overlays');
    stats = { ...overlay, ms: now() - start, band: selectLod(view.scale).band, scale: view.scale, pathsBuilt: 0, pathCache: cache.size,
      rasterHits: 1, rasterBuilt: 0, rasterPending: retainedJob !== undefined || retainedPending ? 1 : 0, rasterBytes: gpu.bytes() };
    return stats;
  }

  function drawFrame(view: View): FrameStats {
    if (deps.raster === false || rasterFailed) return drawVector(view);
    if (activeLive && getVectorEngine() === 'gpu') { const shown = drawRetained(view); if (shown) return shown; }
    const start = now(), dpr = deps.dpr ?? (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return stats;
    const cssW = canvas.width / dpr, cssH = canvas.height / dpr, rect = viewRect(view, cssW, cssH);
    const live = activeLive && !!deps.invalidate && typeof requestAnimationFrame === 'function';
    const scale = live ? 2 ** (Math.floor(2 * Math.log2(view.scale)) / 2) : view.scale;
    const k = scale * dpr, outputK = view.scale * dpr, ratio = view.scale / scale;
    // Small live CPU tiles bound each indivisible raster operation; captures
    // retain their exact density and larger tiles. Polygon paths are clipped below.
    // Raster cost no longer bounds GPU tiles: live ones are larger, so a view needs fewer.
    const engine = getVectorEngine();
    const tilePx = live ? (engine === 'gpu' ? 512 : 256) : 512, gutter = live ? (engine === 'gpu' ? 16 : 8) : 32, tileSize = tilePx / k;
    const x0 = Math.floor(rect.minX / tileSize), y0 = Math.floor(rect.minY / tileSize);
    const x1 = Math.floor(rect.maxX / tileSize), y1 = Math.floor(rect.maxY / tileSize);
    const budget = rasterBudget(rect, scale);
    layerTilesFit = activeLight && scale < 1 || layerTilesFitView(rect, k);
    const requests: { key: string; x: number; y: number }[] = [];
    const semanticKey = `${deps.semantic?.key() ?? ''}|${deps.roadStyle?.().emphasis ?? 1}|${roadCanopyRevision()}|${whiteWaterRevision()}`;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) requests.push({ key: `${scale}|${dpr}|${live ? 'live' : 'exact'}|${engine}|${activeLight}|${budget}|${semanticKey}|${x},${y}`, x, y });
    if (requests.length * (tilePx + 2 * gutter) ** 2 * 4 > rasterCache.maxBytes) return drawVector(view);
    const buildTile = (request: typeof requests[number]): CanvasImageSource => {
      const side = tilePx + 2 * gutter, bytes = side * side * 4;
      const tileView = { cx: (request.x + 0.5) * tileSize, cy: (request.y + 0.5) * tileSize, scale };
      let resource: CanvasImageSource | undefined, release = (): void => {};
      if (getVectorEngine() === 'gpu') {
        // GPU engine: record the same drawVector calls, replay them on WebGL2. Unsupported lists and errors fall back to the CPU below.
        try {
          const t0 = now(), rec = new RecordingCanvas(side, side);
          // A recording failure (a Canvas call the recorder lacks) costs this tile only; a raster failure demotes the engine.
          let st: FrameStats | undefined, list: DisplayList | undefined;
          try { st = drawVector(tileView, rec as unknown as CanvasLike, 'map', rect); list = rec.finish(); }
          catch (error) { noteGpuFallback(`record: ${error instanceof Error ? error.message : String(error)}`); }
          const t1 = now(), gpu = list ? vectorRasterizer() : null;
          if (list?.unsupported) noteGpuFallback(list.unsupported);
          else if (list && st && gpu) {
            try {
              const bitmap = gpu.rasterize(list);
              noteGpuTile(t1 - t0, now() - t1);
              pathsBuilt += st.pathsBuilt; mapStats = st;
              resource = bitmap; release = () => bitmap.close();
            } catch (error) { noteGpuFailure(error); }
          }
        } finally { releaseDrapeTemps(); }
      }
      if (!resource) {
        const t0 = now(), target = makeCanvas(side, side);
        // Keep vector replay local to a small CPU surface. Only the finished tile
        // is uploaded; multiply display lists cannot accumulate in Chrome's GPU queue.
        if (!target?.getContext('2d', { willReadFrequently: true })) throw new Error('Overlay tile allocation failed');
        const st = drawVector(tileView, target, 'map', rect); pathsBuilt += st.pathsBuilt; mapStats = st;
        // The finished CPU tile becomes an ImageBitmap here: its deferred raster runs inside this progressive step
        // (one tile), not in the first drawImage of the frame that composes every tile, and later blits of a bitmap
        // are cheaper than re-blitting the software canvas.
        const bitmap = typeof (target as { transferToImageBitmap?: () => ImageBitmap }).transferToImageBitmap === 'function'
          ? (target as unknown as OffscreenCanvas).transferToImageBitmap() : undefined;
        resource = (bitmap ?? target) as unknown as CanvasImageSource;
        release = () => { if (bitmap) bitmap.close(); else { target.width = 0; target.height = 0; } };
        noteCpuTile(now() - t0);
      }
      const margin = paintMargin(scale) + gutter / k;
      rasterCache.put(request.key, { value: resource, bytes,
        bounds: { minX: request.x * tileSize - margin, minY: request.y * tileSize - margin,
          maxX: (request.x + 1) * tileSize + margin, maxY: (request.y + 1) * tileSize + margin },
        release });
      if (live) {
        mapPyramid.set(request.key, { x: request.x * tileSize, y: request.y * tileSize, span: tileSize,
          pixels: tilePx, gutter, density: k, semantic: semanticKey, light: activeLight });
        // Metadata owns no images; prune descriptors when their LRU images have gone away.
        if (mapPyramid.size > 2048) for (const key of mapPyramid.keys()) if (!rasterCache.get(key)) mapPyramid.delete(key);
      }
      rasterBuilt++; return resource;
    };
    const tiles: { image: CanvasImageSource; x: number; y: number }[] = [];
    let rasterBuilt = 0, rasterHits = 0, pathsBuilt = 0, missing = 0;
    let mapStats: FrameStats | undefined;
    try {
      for (const request of requests) {
        let image = rasterCache.get(request.key);
        if (image) rasterHits++;
        else if (live) { missing++; continue; }
        else image = buildTile(request);
        tiles.push({ image, x: request.x, y: request.y });
      }
      if (live && missing) {
        const jobKey = requests.map(r => r.key).join(';') + `|${rect.minX},${rect.minY},${rect.maxX},${rect.maxY}`;
        const light = activeLight, fit = layerTilesFit;
        rasterFill.start(jobKey, function* () {
          // The first forest tile must not build eleven whole-map wash layers in
          // one frame. Captures drain the same generator synchronously.
          if (!isUnderdarkBiome(world.options.biome) && !(light && pal.name === 'parchment' && scale < 1)) {
            for (const name of ['lu-forest', 'u-cover-forest']) yield* forestWashSteps(name);
          }
          const cx = view.cx / tileSize - .5, cy = view.cy / tileSize - .5;
          const queue = requests.filter(r => !rasterCache.get(r.key)).sort((a, b) => (a.x - cx) ** 2 + (a.y - cy) ** 2 - (b.x - cx) ** 2 - (b.y - cy) ** 2);
          // The coarse map stands in meanwhile: the view sharpens at once when its tiles are ready (a long job shows its
          // progress once a second), instead of a repaint per tile that shows the tiles filling one by one.
          let shown = now();
          for (let i = 0; i < queue.length; i++) {
            const request = queue[i];
            activeLive = true; activeLight = light; activeDpr = dpr; layerTilesFit = fit;
            try {
              if (!rasterCache.get(request.key)) buildTile(request);
            }
            finally { activeLive = activeLight = false; activeDpr = undefined; }
            const present = i === queue.length - 1 || now() - shown > 1000;
            if (present) shown = now();
            yield present;
          }
        }, deps.invalidate!, () => { rasterFailed = true; });
      } else suspendLive();
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      const coarse = live && missing ? mapPreview(semanticKey) : undefined;
      if (coarse) { ctx.save(); ctx.setTransform(outputK, 0, 0, outputK, -rect.minX * outputK, -rect.minY * outputK); ctx.drawImage(coarse, 0, 0, S, S); ctx.restore(); }
      if (live && missing && lastRaster) {
        const old = lastRaster, factor = view.scale / old.view.scale * dpr / old.dpr;
        const x = canvas.width / 2 + (old.view.cx - view.cx) * outputK - old.canvas.width * factor / 2;
        const y = canvas.height / 2 + (old.view.cy - view.cy) * outputK - old.canvas.height * factor / 2;
        // Replaces the coarse map where it reaches (translucent tints never double).
        if (coarse) ctx.clearRect(x, y, old.canvas.width * factor, old.canvas.height * factor);
        ctx.drawImage(old.canvas as unknown as CanvasImageSource, x, y, old.canvas.width * factor, old.canvas.height * factor);
      }
      for (const tile of tiles) {
        const x = (tile.x * tileSize - rect.minX) * outputK, y = (tile.y * tileSize - rect.minY) * outputK;
        // Gutters supply filtering samples, but each output pixel belongs to one
        // tile only. Overpainting them darkens transparent land-use overlays.
        // Integer device-pixel partitions also avoid fractional clipping seams.
        const left = Math.round(x), top = Math.round(y);
        const width = Math.round(x + tilePx * ratio) - left, height = Math.round(y + tilePx * ratio) - top;
        ctx.save(); ctx.beginPath(); ctx.rect(left, top, width, height); ctx.clip();
        ctx.clearRect(left, top, width, height);
        ctx.drawImage(tile.image, x - gutter * ratio, y - gutter * ratio, (tilePx + 2 * gutter) * ratio, (tilePx + 2 * gutter) * ratio); ctx.restore();
      }
      if (live) {
        if (!lastRaster || lastRaster.canvas.width !== canvas.width || lastRaster.canvas.height !== canvas.height) {
          dropLastRaster(); const target = makeCanvas(canvas.width, canvas.height);
          if (target) lastRaster = { canvas: target, view: { ...view }, dpr };
        }
        const retained = lastRaster?.canvas.getContext('2d');
        if (retained && lastRaster) { retained.clearRect(0, 0, canvas.width, canvas.height); retained.drawImage(canvas as unknown as CanvasImageSource, 0, 0); lastRaster.view = { ...view }; lastRaster.dpr = dpr; }
      }
      const overlay = drawVector(view, canvas, 'overlays');
      stats = { ...(mapStats ?? overlay), ms: now() - start, band: selectLod(view.scale).band, scale: view.scale,
        pathsBuilt, pathCache: cache.size, rasterHits, rasterBuilt, rasterPending: missing, rasterBytes: rasterCache.bytes };
      return stats;
    } catch {
      rasterFailed = true; rasterCache.clear(); return drawVector(view);
    }
  }

  /** A CPU preview with a fixed geometry budget, refined cooperatively. Never run
   * the full renderer (wash/stamp passes) over the whole map just to hide a missing tile. */
  function mapPreview(semantic: string): CanvasImageSource | undefined {
    const key = `${semantic}|${activeLight}`;
    if (preview?.key === key) return preview.canvas as unknown as CanvasImageSource;
    dropPreview();
    const px = PREVIEW_PX, target = makeCanvas(px, px);
    const ctx = target?.getContext('2d', { willReadFrequently: true });
    if (!target || !ctx) return undefined;
    ctx.setTransform(px / S, 0, 0, px / S, 0, 0);
    if (!deps.transparentBackground) { ctx.fillStyle = pal.paper; ctx.fillRect(0, 0, S, S); }
    preview = { key, canvas: target };
    previewFill.start(key, function* () {
      const tex = getTerrain(); if (tex) ctx.drawImage(tex, 0, 0, S, S);
      yield true;
      let remaining = 32768, shapes = 4096;
      const names = [...LAND_ORDER.map(kind => 'lu-' + kind), 'sea', 'lakes', 'rivers', 'u-masses'];
      for (const name of names) {
        const layer = polyL(name); if (!layer) continue;
        const kind = name.slice(3) as keyof Palette['land'];
        if (name.startsWith('lu-') && !(deps.mask?.landuse ?? world.options.landuse)) continue;
        ctx.fillStyle = name === 'sea' ? pal.seaFill : name === 'lakes' ? pal.lakeFill : name === 'rivers' ? pal.riverFill : name === 'u-masses' ? pal.urban.mass : pal.land[kind];
        ctx.globalAlpha = name.startsWith('lu-') ? pal.landOpacity : 1;
        ctx.globalCompositeOperation = name.startsWith('lu-') && pal.landBlend === 'multiply' ? 'multiply' : 'source-over';
        for (let i = 0; i < layer.polys.length && remaining > 0 && shapes > 0; i++) {
          const b = i * 4, box = layer.index.boxes;
          if ((box[b + 2] - box[b]) * (box[b + 3] - box[b + 1]) < (S / px) ** 2) continue;
          const path = new P(); let vertices = 0;
          for (const ring of [layer.polys[i], ...(layer.holes?.[i] ?? [])]) {
            if (remaining < 3) break;
            const stride = Math.max(1, Math.ceil(ring.length / Math.min(256, remaining)));
            const points: Vec2[] = []; let last: Vec2 | undefined;
            for (let j = 0; j < ring.length && remaining > 0; j += stride) {
              const p = ring[j];
              if (last && (p.x - last.x) ** 2 + (p.y - last.y) ** 2 < (S / px) ** 2) continue;
              points.push(p); last = p; remaining--; vertices++;
            }
            addRing(path, points);
          }
          if (vertices >= 3) { ctx.fill(path, 'evenodd'); shapes--; }
          // At most one small polygon per cooperative step; no stamp passes.
          yield true;
        }
      }
    }, deps.invalidate ?? (() => {}), () => {});
    return target as unknown as CanvasImageSource;
  }

  function exactCavernPath(which: 'floor' | 'solid' | 'fungalRooms'): Path2D | null {
    if (!world.terrain.caverns) return null;
    return cached(`cavern-${which}-exact`, () => {
      const p = new P();
      for (const f of world.terrain.caverns![which] ?? []) {
        addRing(p, orientPos(f.outer));
        for (const h of f.holes) addRing(p, orientPos(h).slice().reverse());
      }
      return p;
    });
  }

  function drawCachedMap(target: CanvasLike, box: Rect4): boolean {
    const ctx = target.getContext('2d'); if (!ctx) return false;
    const semantic = `${deps.semantic?.key() ?? ''}|${deps.roadStyle?.().emphasis ?? 1}|${roadCanopyRevision()}|${whiteWaterRevision()}`;
    const light = displayQualityFor(true) === 'light', density = target.width / (box.maxX - box.minX);
    // Coarse first; a finer cached quadrant replaces it without doubling translucent ink.
    const tiles = [...mapPyramid].filter(([, t]) => t.semantic === semantic && t.light === light && t.density <= density * 2
      && t.x < box.maxX && t.y < box.maxY && t.x + t.span > box.minX && t.y + t.span > box.minY)
      .sort((a, b) => a[1].density - b[1].density);
    let drawn = false;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    if (preview?.key === `${semantic}|${light}`) {
      ctx.drawImage(preview.canvas as unknown as CanvasImageSource,
        -box.minX * density, -box.minY * density, S * density, S * density);
      drawn = true;
    }
    for (const [key, tile] of tiles) {
      const image = rasterCache.get(key); if (!image) { mapPyramid.delete(key); continue; }
      const x = (tile.x - box.minX) * density, y = (tile.y - box.minY) * density, size = tile.span * density;
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, size, size); ctx.clip(); ctx.clearRect(x, y, size, size);
      ctx.drawImage(image, tile.gutter, tile.gutter, tile.pixels, tile.pixels, x, y, size, size);
      ctx.restore(); drawn = true;
    }
    ctx.restore(); return drawn;
  }

  function drawGround(target: CanvasLike, box: Rect4, options?: { live: boolean }): boolean {
    const previousLive = activeLive, previousLight = activeLight;
    activeLive = !!options?.live; activeLight = displayQualityFor(activeLive) === 'light';
    try { return paintGround(target, box); }
    finally { activeLive = previousLive; activeLight = previousLight; }
  }
  function paintGround(target: CanvasLike, box: Rect4): boolean {
    const dpr = deps.dpr ?? (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1;
    const view = { cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2, scale: target.width / (box.maxX - box.minX) / dpr };
    const drawn = (fs: FrameStats): boolean => fs.tilesDrawn + fs.bigDrawn + fs.textureTiles > 0;
    if (getVectorEngine() === 'gpu') {
      const t0 = now();
      try {
        const rec = new RecordingCanvas(target.width, target.height);
        let fs: FrameStats | undefined, list: DisplayList | undefined;
        try { fs = drawVector(view, rec as unknown as CanvasLike, 'ground'); list = rec.finish(); }
        catch (error) { noteGpuFallback(`record: ${error instanceof Error ? error.message : String(error)}`); }
        const t1 = now(), gpu = list ? vectorRasterizer() : null, tx = target.getContext('2d');
        if (list?.unsupported) noteGpuFallback(list.unsupported);
        else if (list && fs && gpu && tx) {
          let bitmap: ImageBitmap | undefined;
          try { bitmap = gpu.rasterize(list); } catch (error) { noteGpuFailure(error); }
          if (bitmap) {
            try {
              tx.setTransform(1, 0, 0, 1, 0, 0); tx.globalAlpha = 1; tx.globalCompositeOperation = 'source-over';
              tx.clearRect(0, 0, target.width, target.height); tx.drawImage(bitmap, 0, 0);
            } finally { bitmap.close(); }
            noteGpuTile(t1 - t0, now() - t1);
            return drawn(fs);
          }
        }
      } finally { releaseDrapeTemps(); }
    }
    const t0 = now(), fs = drawVector(view, target, 'ground');
    noteCpuTile(now() - t0);
    return drawn(fs);
  }

  function drawVector(view: View, target: CanvasLike = canvas, mode: 'all' | 'map' | 'overlays' | 'ground' = 'all', fullRect?: Rect4): FrameStats {
    const t0 = now();
    const ctx = target.getContext('2d');
    if (!ctx) return stats;
    const built0 = built;
    const dpr = activeDpr ?? deps.dpr ?? (globalThis as unknown as { devicePixelRatio?: number }).devicePixelRatio ?? 1;
    const cssW = target.width / dpr, cssH = target.height / dpr;
    const trueScale = view.scale, sc = trueScale;
    const lod: Lod = selectLod(sc);
    const band = lod.band;
    const rect: Rect4 = viewRect(view, cssW, cssH, fullRect ? paintMargin(view.scale) : 0);
    const budgetRect = fullRect ?? rect;
    if (!fullRect && mode !== 'overlays') layerTilesFit = layerTilesFitView(rect, trueScale * dpr);
    const fs: FrameStats = { band, scale: sc, ms: 0, tilesDrawn: 0, bigDrawn: 0, pathsBuilt: 0, pathCache: 0, buildingsCandidate: 0, buildingsDrawn: false, textureTiles: 0 };
    const minEdge = BAND_MIN_EDGE[band];

    if (mode !== 'overlays') {
    // background (device pixels)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    if (deps.transparentBackground || mode === 'ground') ctx.clearRect(0, 0, target.width, target.height);
    else {
      ctx.fillStyle = pal.paper;
      ctx.fillRect(0, 0, target.width, target.height);
    }
    // world -> device
    ctx.setTransform(dpr * trueScale, 0, 0, dpr * trueScale, dpr * (cssW / 2 - view.cx * trueScale), dpr * (cssH / 2 - view.cy * trueScale));
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.setLineDash([]);
    // everything below is clipped to the map rectangle (sea polygons etc. run past it)
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, S, S); ctx.clip();

    const px = (n: number): number => n / sc;
    const lw = (w: number, minPx: number): number => lineWidth(w, minPx, sc);

    // helpers ---------------------------------------------------------------------------
    // Include the stamp/shadow reach and put artificial clipping edges safely
    // outside the canvas, so stroked polygons retain their original borders.
    const pathRect = growRect(rect, Math.max(16, paintMargin(sc)));
    // GPU recording: no clipping to the frame (the GPU discards what falls outside), so the paths of an index tile are
    // built once per band and reused by every retained region and tile; the Canvas engine keeps its clipped paths.
    recordingNow = ctx instanceof RecordingContext;
    const clipTo = recordingNow ? undefined : pathRect;
    const rectKey = recordingNow ? 'gpu' : `${pathRect.minX},${pathRect.minY},${pathRect.maxX},${pathRect.maxY}`;
    const framePaths = new Map<PolyLayer, Path2D[]>();
    const polyPaths = (l: PolyLayer): Path2D[] => {
      const retained = framePaths.get(l); if (retained) return retained;
      const out: Path2D[] = [];
      for (const t of l.index.tilesInRect(pathRect)) {
        const p = cached(`${l.name}|${band}|${rectKey}|t${t}|${l.tileKeys?.[t] ?? ""}`, () => polyPath(P, l, l.index.itemsOf(t), minEdge, clipTo));
        if (p) { out.push(p); fs.tilesDrawn++; }
      }
      const big = l.index.bigInRect(pathRect);
      // Vectorized wash regions are disjoint. Batch them after clipping rather
      // than enqueueing thousands of identical multiply operations per stamp.
      if (l.name.includes('-edge-') || l.name.includes('-fringe-')) {
        const stamp = l.bigKeys?.join(';') ?? '';
        const p = cached(`${l.name}|${band}|${rectKey}|big|${recordingNow ? big.join(',') + '|' : ''}${stamp}`, () => polyPath(P, l, big, minEdge, clipTo));
        if (p) { out.push(p); fs.bigDrawn += big.length; }
      } else for (const i of big) {
        const p = cached(`${l.name}|${band}|${rectKey}|b${i}|${l.bigKeys?.[Array.prototype.indexOf.call(l.index.big, i)] ?? ""}`, () => polyPath(P, l, [i], minEdge, clipTo));
        if (p) { out.push(p); fs.bigDrawn++; }
      }
      framePaths.set(l, out); return out;
    };
    const linePaths = (l: LineLayer): Path2D[] => {
      const out: Path2D[] = [];
      for (const t of l.index.tilesInRect(rect)) {
        const p = cached(`${l.name}|${band}|t${t}|${l.tileKeys?.[t] ?? ""}`, () => linePath(P, l, l.index.itemsOf(t), minEdge));
        if (p) { out.push(p); fs.tilesDrawn++; }
      }
      for (const i of l.index.bigInRect(rect)) {
        const p = cached(`${l.name}|${band}|b${i}|${l.bigKeys?.[Array.prototype.indexOf.call(l.index.big, i)] ?? ""}`, () => linePath(P, l, [i], minEdge));
        if (p) { out.push(p); fs.bigDrawn++; }
      }
      return out;
    };
    const fillPolys = (name: string, color: string, alpha = 1, rule: CanvasFillRule = 'evenodd'): PolyLayer | undefined => {
      const l = polyL(name);
      if (!l) return undefined;
      ctx.fillStyle = color; ctx.globalAlpha = alpha;
      for (const p of polyPaths(l)) ctx.fill(p, rule);
      ctx.globalAlpha = 1;
      return l;
    };
    const strokePolys = (name: string, color: string, width: number, alpha = 1, dash: number[] = []): void => {
      const l = polyL(name);
      if (!l) return;
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.globalAlpha = alpha; ctx.setLineDash(dash);
      for (const p of polyPaths(l)) ctx.stroke(p);
      ctx.globalAlpha = 1; ctx.setLineDash([]);
    };
    const strokeLines = (ls: LineLayer[], color: string, widthOf: (l: LineLayer) => number, alpha = 1, dash: number[] = [], cap: CanvasLineCap = 'round'): void => {
      ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.setLineDash(dash); ctx.lineCap = cap;
      for (const l of ls) {
        ctx.lineWidth = widthOf(l);
        for (const p of linePaths(l)) ctx.stroke(p);
      }
      ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.lineCap = 'round';
    };
    const edge = Math.max(0.5, 0.9 / sc);
    /** Casing + fill for a group of road-like layers (all casings first so junctions merge). */
    const roadGroup = (ls: LineLayer[], fillMinPx: (l: LineLayer) => number, edgeK: (l: LineLayer) => number = () => 1): void => {
      if (!ls.length) return;
      strokeLines(ls, pal.roadEdge, (l) => lw(l.width, fillMinPx(l)) + 2 * edge * edgeK(l));
      strokeLines(ls, pal.roadFill, (l) => lw(l.width, fillMinPx(l)));
    };

    const roadStyle: RoadStyle = deps.roadStyle?.() ?? { look: deps.roadLook ?? 'ink', emphasis: 1, night: false, colors: deps.colors };
    const natural = roadStyle.look === 'natural', inkAlpha = emphasisAlpha(roadStyle.emphasis);
    /** All the visible pieces of some layers as one path: a translucent stroke never doubles at chunk ends. */
    const merged = (ls: LineLayer[]): Path2D => { const out = new P(); for (const l of ls) for (const p of linePaths(l)) out.addPath(p); return out; };
    /** The same pieces split by the canopy over them (roadStyle.ts canopyRuns), one path per level, cached per tile and
     * canopy revision: an earth way reads as a fainter continuous trace under closed woods. */
    const canopyMerged = (ls: LineLayer[]): (Path2D | undefined)[] => {
      const revision = roadCanopyRevision(), out: (Path2D | undefined)[] = [];
      if (!revision) { out[0] = merged(ls); return out; }
      const runsOf = new Map<string, ReturnType<typeof canopyRuns>[]>();
      const add = (l: LineLayer, key: string, ids: ArrayLike<number>): void => {
        for (let k = 0; k < CANOPY_LEVELS; k++) {
          const p = cached(`${key}|c${revision}|${k}`, () => {
            let runs = runsOf.get(key); if (!runs) runsOf.set(key, runs = Array.from(ids, i => canopyRuns(l.lines[i])));
            return runPath(P, runs, k, minEdge);
          });
          if (p) (out[k] ??= new P()).addPath(p);
        }
      };
      for (const l of ls) {
        for (const t of l.index.tilesInRect(rect)) add(l, `${l.name}|${band}|t${t}|${l.tileKeys?.[t] ?? ''}`, l.index.itemsOf(t));
        for (const i of l.index.bigInRect(rect)) add(l, `${l.name}|${band}|b${i}|${l.bigKeys?.[Array.prototype.indexOf.call(l.index.big, i)] ?? ''}`, [i]);
      }
      return out;
    };
    const strokeEarthRoads = (ls: LineLayer[], rank: Parameters<typeof strokeNaturalRoad>[2], width: number): void =>
      canopyMerged(ls).forEach((p, k) => { if (p) strokeNaturalRoad(ctx, p, rank, width, sc, roadStyle, k / (CANOPY_LEVELS - 1)); });
    const drawRegionalRoads = (roads: LineLayer[], tracks: LineLayer[]): void => {
      if (natural) {
        // Each retained width has its own layer, as on the 3D road surface.
        for (const l of tracks) {
          const rank = l.width < 2 ? 'path' : 'track';
          strokeEarthRoads([l], rank, roadWidth(rank, l.width, sc));
        }
        // Earth and gravel first, then the paved lengths of the same rank (roadPavement.ts).
        for (const kind of ['minor', 'major'] as const) for (const pavement of ['earth', 'asphalt'] as const) {
          const ls = roads.filter((l) => l.kind === kind && (l.pavement ?? 'earth') === pavement);
          if (!ls.length) continue;
          for (const l of ls) {
            if (pavement === 'earth') strokeEarthRoads([l], regionalRank(kind), roadWidth(regionalRank(kind), l.width, sc));
            else strokeNaturalRoad(ctx, merged([l]), regionalRank(kind), roadWidth(regionalRank(kind), l.width, sc), sc, { ...roadStyle, pavement });
          }
        }
        return;
      }
      // Drawn maps keep their inks: a paved trunk road is a firmer cased road with a centre line, once wide enough to hold it.
      const pavedCentre = (width: (l: LineLayer) => number): void => {
        const ls = roads.filter((l) => l.pavement === 'asphalt' && l.kind === 'major' && width(l) * sc >= 4.5);
        if (ls.length) strokeLines(ls, pal.roadEdge, () => px(.8), Math.min(1, .7 * inkAlpha));
      };
      if (roadStyle.look === 'wash') {
        // Pale translucent bands with a faint edge, as the bench draws them (terrainRoads.ts).
        for (const kind of ['minor', 'major'] as const) {
          const ls = roads.filter((l) => l.kind === kind), rank = kind === 'major' ? 'highway' : 'local', width = (l: LineLayer): number => Math.max(px(BLEND_ROAD_PX[rank]), l.width);
          strokeLines(ls, pal.roadEdge, (l) => width(l) + px(1.6), BLEND_ROAD_ALPHA[rank] * .22 * inkAlpha);
          strokeLines(ls, pal.roadFill, width, Math.min(1, BLEND_ROAD_ALPHA[rank] * inkAlpha));
          if (kind === 'major') pavedCentre(width);
        }
        strokeCoveredTracks(tracks);
        return;
      }
      const surface = (l: LineLayer) => regionalRoadSurface(l.kind === 'major' ? 'major' : 'minor', sc, l.width);
      strokeLines(roads, pal.roadEdge, (l) => { const r = surface(l); return r.fill + (r.casing - r.fill) * Math.max(1, roadStyle.emphasis) * (l.pavement === 'asphalt' ? 1.5 : 1); }, Math.min(1, inkAlpha));
      strokeLines(roads, pal.roadFill, (l) => surface(l).fill);
      pavedCentre((l) => surface(l).fill);
      strokeCoveredTracks(tracks);
    };
    const strokeCoveredTracks = (tracks: LineLayer[]): void => {
      canopyMerged(tracks).forEach((path, level) => {
        if (!path) return;
        ctx.strokeStyle = trackInk(ruralInk(pal), pal.roadFill); ctx.lineWidth = Math.min(lw(1.3, .85), px(2.2));
        ctx.globalAlpha = Math.min(1, pal.rural.track * inkAlpha) * roadCanopyOpacity('track', level / (CANOPY_LEVELS - 1));
        ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
        ctx.setLineDash([px(lod.band >= 2 ? 7 : 5), px(lod.band >= 2 ? 4 : 3)]); ctx.stroke(path);
      });
      ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.lineCap = 'round';
    };

    // 1. terrain
    const tex = getTerrain();
    const drawVisibleTerrain = (): void => {
      if (!tex) return;
      const x = Math.max(0, rect.minX), y = Math.max(0, rect.minY);
      const w = Math.min(S, rect.maxX) - x, h = Math.min(S, rect.maxY) - y;
      if (w <= 0 || h <= 0) return;
      const tw = Number((tex as { width?: unknown }).width), th = Number((tex as { height?: unknown }).height);
      if (Number.isFinite(tw) && Number.isFinite(th) && tw > 0 && th > 0) {
        ctx.drawImage(tex, x * tw / S, y * th / S, w * tw / S, h * th / S, x, y, w, h);
      } else ctx.drawImage(tex, 0, 0, S, S);
    };
    if (tex) {
      ctx.imageSmoothingEnabled = true;
      (ctx as { imageSmoothingQuality?: string }).imageSmoothingQuality = 'high';
      ctx.drawImage(tex, 0, 0, S, S);
    }

    const cavernFloor = world.terrain.caverns && polyL('cavern-floor');
    if (cavernFloor) {
      const floorClip = exactCavernPath('floor');
      ctx.save(); if (floorClip) ctx.clip(floorClip, 'nonzero');
    }

    const brushFill = (name: string, kind: BrushKind, scale: number): void => {
      const l = polyL(name); if (!l?.polys.length) return;
      const pattern = brushes?.pattern(ctx, kind, scale, dpr);
      if (!pattern) return;
      ctx.fillStyle = pattern; for (const p of polyPaths(l)) ctx.fill(p, 'evenodd');
    };
    const brushTrees = (name: string, orchard = false): void => {
      const l = polyL(name); if (!l || !brushes) return;
      for (const i of l.index.query(rect)) {
        const p = l.polys[i]; if (!p.length) continue;
        const x0 = Math.min(...p.map(v => v.x)), x1 = Math.max(...p.map(v => v.x));
        const y0 = Math.min(...p.map(v => v.y)), y1 = Math.max(...p.map(v => v.y));
        brushes.tree(ctx, (x0 + x1) / 2, (y0 + y1) / 2, Math.min(x1 - x0, y1 - y0) / 2, orchard);
      }
    };
    // 2. land use (tints multiply over the hillshade so relief reads through them); contours under it
    const luOn = deps.mask?.landuse !== undefined ? deps.mask.landuse !== false : world.options.landuse;
    const luAlpha = pal.landOpacity;
    // Forest class: tone chosen by the shared « forest land use » setting (landuseForestTone.ts).
    const landFill = (kind: keyof Palette['land']): string => kind === 'forest' ? forestLandPaint(pal).color : pal.land[kind];
    const landAlpha = (kind: keyof Palette['land']): number => kind === 'forest' ? forestLandPaint(pal).alpha : luAlpha;
    const fillLand = (name: string, kind: keyof Palette['land']): void => {
      if (activeLight && pal.name === 'parchment' && sc < 1) {
        fillPolys(name, landFill(kind), landAlpha(kind));
        if (kind === 'forest') {
          const gap = Math.max(6, 4 / sc);
          const hatch = getPattern(ctx, `light-forest:${gap}`, gap, gap, 35, (c, k) => {
            c.strokeStyle = pal.treeInk; c.globalAlpha = .3; c.lineWidth = .65 / sc * k;
            c.beginPath(); c.moveTo(0, gap * k / 2); c.lineTo(gap * k, gap * k / 2); c.stroke();
          });
          const layer = polyL(name);
          if (hatch && layer) { ctx.fillStyle = hatch; for (const p of polyPaths(layer)) ctx.fill(p, 'evenodd'); }
        }
        return;
      }
      if (kind === 'forest' && !isUnderdarkBiome(world.options.biome)) {
        const wash = forestWash(name);
        if (wash) {
          const clip = visibleClip(polyL(name)!, rect); if (!clip) return;
          ctx.save(); ctx.clip(clip, 'nonzero');
          fillPolys(name, landFill(kind), landAlpha(kind) * .18);
          const gains = [.2, .24, .32, .46];
          for (let i = 0; i < wash.levels.length; i++) {
            ctx.globalAlpha = landAlpha(kind) * gains[i]; ctx.fillStyle = landFill(kind);
            for (const path of polyPaths(wash.levels[i])) ctx.fill(path, 'evenodd');
          }
          ctx.restore(); ctx.globalAlpha = 1;
        }
      } else {
        fillPolys(name, landFill(kind), landAlpha(kind));
        const engraved = pal.name === 'parchment' && (kind === 'meadow' || kind === 'pasture' || kind === 'marsh');
        const layer = polyL(name), wash = layer && (kind === 'commons' || engraved) && !isUnderdarkBiome(world.options.biome) ? forestWash('lu-forest') : undefined;
        if (wash) {
          const clip = visibleClip(layer!, rect); if (!clip) return;
          ctx.save(); ctx.clip(clip, 'nonzero');
          ctx.fillStyle = landFill('forest');
          // Parchment: one narrow engraved rim instead of the stepped halo (the steps read as contour rings).
          if (pal.name !== 'parchment') for (const level of wash.fringe) { ctx.globalAlpha = landAlpha('forest') * .06; for (const path of polyPaths(level)) ctx.fill(path, 'evenodd'); }
          else {
            // The 14 m band stamped at small offsets: a smooth gradient, dark on the shadow side (south-east), faintly lit north-west.
            const stamp = (dx: number, dy: number, color: string, alpha: number, op: GlobalCompositeOperation): void => {
              ctx.save(); ctx.globalCompositeOperation = op; ctx.translate(dx, dy); ctx.fillStyle = color; ctx.globalAlpha = alpha;
              for (const path of polyPaths(wash.fringe[0])) ctx.fill(path, 'evenodd');
              ctx.restore();
            };
            if (wash.fringe[0]) {
              for (let k = 1; k <= 3; k++) stamp(-3.5 * k, -4 * k, pal.paper, .05, 'source-over');
              for (let k = 0; k <= 6; k++) stamp(1.8 * k, 2.1 * k, pal.treeInk, .042, 'multiply');
            }
          }
          ctx.restore(); ctx.globalAlpha = 1;
        }
      }
    };
    const multiply = (on: boolean): void => { ctx.globalCompositeOperation = on && pal.landBlend === 'multiply' ? 'multiply' : 'source-over'; };
    if (mode !== 'ground' && pal.grid && sc * pal.grid.step > 7) {
      const g = pal.grid;
      ctx.strokeStyle = g.color; ctx.globalAlpha = g.opacity; ctx.lineWidth = 0.8 / sc; // graticule: a screen-size line
      ctx.beginPath();
      for (let v = Math.max(g.step, Math.ceil(rect.minX / g.step) * g.step); v < Math.min(S, rect.maxX); v += g.step) { ctx.moveTo(v, Math.max(0, rect.minY)); ctx.lineTo(v, Math.min(S, rect.maxY)); }
      for (let v = Math.max(g.step, Math.ceil(rect.minY / g.step) * g.step); v < Math.min(S, rect.maxY); v += g.step) { ctx.moveTo(Math.max(0, rect.minX), v); ctx.lineTo(Math.min(S, rect.maxX), v); }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    if (world.options.contours) {
      for (const l of linesOf((x) => x.role === 'contour')) {
        const idx = l.kind === 'index';
        strokeLines([l], pal.contour, () => mapStrokeWidth(idx ? MAP_STROKES.contourIndex : MAP_STROKES.contour, sc, idx ? pal.contourIndexW / 1.6 : pal.contourThinW ?? 1), idx ? pal.contourOpacity : pal.contourOpacity * 0.7);
      }
    }
    for (const kind of LAND_ORDER) {
      if (!luOn) break;
      const name = 'lu-' + kind;
      if (!polyL(name)) continue;
      if (kind === 'forest') { ctx.save(); const clip = timedRec('forestClip', () => forestClip(rect)); if (clip) ctx.clip(clip, 'nonzero'); }
      multiply(true);
      timedRec('land-' + kind, () => fillLand(name, kind));
      multiply(false);
      // Actual parallel plough lines, anchored like the SVG pattern. Suppress subpixel moire at far zoom.
      if (kind === 'field' && !isUnderdarkBiome(world.options.biome) && lod.strips && pal.furrowAlpha > 0 && scene.furrows && furrowSpacing(furrowSize) * sc >= 1.5) {
        const fade = Math.min(1, (furrowSpacing(furrowSize) * sc - 1.5) / 1.5);
        const visible: number[] = [], boxes = scene.furrows.index.boxes;
        // TileIndex.query returns sorted unique ids. Cull by precomputed projected bbox before allocating paths.
        for (const i of scene.furrows.index.query(budgetRect)) {
          const b = i * 4;
          if (Math.min(boxes[b + 2] - boxes[b], boxes[b + 3] - boxes[b + 1]) * sc < FURROW_MIN_PX) continue;
          visible.push(i);
          if (visible.length > FURROW_HOLDER_BUDGET) break;
        }
        // Skip the entire plough texture over budget rather than rendering an arbitrary subset of fields.
        if (visible.length <= FURROW_HOLDER_BUDGET) for (const i of visible) {
          if (!scene.furrows.index.boxHits(i, rect)) continue;
          const { holder, strips, lines } = furrowPaths(i);
          ctx.save(); ctx.clip(holder); ctx.clip(strips);
          ctx.strokeStyle = pal.furrow; ctx.lineWidth = mapStrokeWidth(MAP_STROKES.furrow, sc);
          ctx.globalAlpha = pal.furrowAlpha * fade; ctx.lineCap = 'butt'; ctx.stroke(lines); ctx.restore();
          fs.furrowsDrawn = (fs.furrowsDrawn ?? 0) + 1;
        }
      }
      if (kind === 'field' && lod.strips && !isUnderdarkBiome(world.options.biome)) {
        // SVG tints the ploughed strips after their furrow texture; retain that compositing order.
        multiply(true);
        const mk = [0.5, 0.75, 0.3, 0.9];
        for (let k = 0; k < 4; k++) if (pal.stripAlpha[k & 1] > 0) fillPolys('stripT' + k, k & 1 ? pal.stripB : pal.stripA, Math.min(1, pal.stripAlpha[k & 1] * mk[k]));
        multiply(false);
      }
      if (kind === 'field' && !isUnderdarkBiome(world.options.biome) && lod.strips && lod.band >= 2) {
        for (let k = 0; k < 4; k++) strokePolys('stripT' + k, pal.furrow, mapStrokeWidth(MAP_STROKES.strip, sc), pal.furrowAlpha * 0.85);
      }
      if (kind === 'field' && !isUnderdarkBiome(world.options.biome) && lod.strips) strokePolys('furlong-edges', pal.furrow, mapStrokeWidth(MAP_STROKES.furlong, sc), pal.furlongAlpha ?? 0.55);
      if (brushes && lod.textures && (kind === 'field' || (kind === 'garden' && brushTextureOn(kind, pal, world.options.biome)))) brushFill(name, kind, sc);
      if ((kind === 'orchard' || kind === 'garden') && lod.strips) strokePolys(name, pal.hedge, lw(0.8, 0.8), 0.7);
      if (kind === 'forest') ctx.restore();
    }
    // On a transparent sheet the backdrop's alpha is the land: the tints stay off the water below.
    if (luOn && deps.transparentBackground && terrainImg) { ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(terrainImg as CanvasImageSource, 0, 0, S, S); ctx.globalCompositeOperation = 'source-over'; }
    const fu = Math.max(1, u);
    // field network: ways, headlands, hedgerows (+ trees near). Ways and headlands are subtle earth-toned hairlines
    // (never paper-white bands across the fields), and the ways only show from mid-close zoom on.
    if (luOn && lod.strips) {
      const rk = ruralInk(pal);
      strokeLines(linesOf((l) => l.name === 'headlands'), pal.furrow, () => mapStrokeWidth(MAP_STROKES.headland, sc), pal.rural.headland, [], 'butt');
      if (sc >= WAY_SCALE) {
        const ways = linesOf((l) => l.name === 'field-ways');
        if (natural) { if (ways.length) strokeEarthRoads(ways, 'path', roadWidth('path', ways[0].width * .7, sc)); }
        else strokeLines(ways, trackInk(rk, pal.roadFill), () => lw(1.4, 0.8), Math.min(1, pal.rural.way * inkAlpha), lod.band >= 2 ? [px(6), px(4)] : [], 'butt');
      }
      if (pal.hedgeOn) {
        const hedge = fieldHedgeStyle(pal, u);
        strokeLines(linesOf((l) => l.name === 'hedges'), hedge.color, () => lw(hedge.width, 0.35), hedge.alpha * Math.min(1, sc / 0.3));
        for (const [name, material] of [['hedge-walls', 'wall'], ['hedge-fences', 'fence']] as const) {
          const k = fieldBoundaryStyle(pal, u, material);
          strokeLines(linesOf((l) => l.name === name), k.color, () => lw(k.width, 0.35), k.alpha * Math.min(1, sc / 0.3), k.dash.map(px), 'butt');
        }
        if (lod.band >= 2 && polyL('hedge-trees')) {
          if (brushes) brushTrees('hedge-trees'); else {
          fillPolys('hedge-trees', pal.treeFill, 0.75);
          strokePolys('hedge-trees', pal.treeInk, lw(0.3 * fu, 0.35), 0.5);
          }
        }
      }
    }
    // textures (procedural marks, visible tiles only, cached per tile)
    if (mode === 'ground' && canopy && pal.name === 'parchment' && !(activeLight && sc < 1)) {
      // 3D drape tiles come at many scales side by side: a scale-dependent choice of marks shows each tile as a rectangle.
      // Woods are drawn from world-space tree positions at every scale.
      if (luOn) for (const tl of scene.textures) {
        if (tl.kind === 'forest') fs.textureTiles += drawDrapeCanopy(ctx, tl, rect, trueScale * dpr);
        // Orchards and open-land symbols follow the 2D map's own scale rule: the moving 3D preview reuses the 2D raster
        // tiles, so a refined drape tile must keep every symbol its preview showed (never a uniform fill over them).
        else if (cityCountrysideTextureVisible(tl.kind, sc) && (pal.tex[tl.kind] || (brushes && isBrushKind(tl.kind) && brushTextureOn(tl.kind, pal, world.options.biome)))) fs.textureTiles += drawTexture(ctx, tl, rect, band, lw, budgetRect);
      }
    } else if (luOn) {
      for (const tl of scene.textures) if (cityCountrysideTextureVisible(tl.kind, sc) && (pal.tex[tl.kind] || (brushes && isBrushKind(tl.kind) && brushTextureOn(tl.kind, pal, world.options.biome)))) fs.textureTiles += timedRec('tex-' + tl.kind, () => drawTexture(ctx, tl, rect, band, lw, budgetRect));
    }

    if (mode === 'ground') {
      if (cavernFloor) ctx.restore();
      ctx.restore(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      return fs;
    }

    // Semantic land use: above every physical land-use layer, below water, roads and labels.
    timedRec('semantic', () => deps.semantic?.draw(ctx, rect, 1 / sc, activeLight ? 'light' : 'full'));

    // 3. rivers + water
    const rivers = polyL('rivers');
    if (rivers) {
      const paths = polyPaths(rivers);
      ctx.fillStyle = pal.riverEdge; ctx.strokeStyle = pal.riverEdge; ctx.lineWidth = lw(1.7 * u, 1.2);
      for (const p of paths) { ctx.fill(p, 'nonzero'); ctx.stroke(p); }
      ctx.fillStyle = pal.riverFill;
      for (const p of paths) ctx.fill(p, 'nonzero');
      if (sc < 0.08) strokeLines(linesOf((l) => l.name === 'river-centre'), pal.riverEdge, () => px(1.3));
    }
    fillPolys('sea', pal.seaFill, 1, 'evenodd');
    fillPolys('lakes', pal.lakeFill, 1, 'nonzero');
    const waterImage = getWater();
    if (waterImage) for (const name of ['sea', 'lakes'] as const) {
      const layer = polyL(name); if (!layer) continue;
      for (const path of polyPaths(layer)) {
        ctx.save(); ctx.clip(path, name === 'sea' ? 'evenodd' : 'nonzero'); ctx.drawImage(waterImage, 0, 0, S, S); ctx.restore();
      }
    }
    const wl = pal.waterLines;
    if (wl && sc >= 0.11) {
      const gap = wl.gap;
      const wpat = getPattern(ctx, 'waterlines', gap, gap, 0, (c, k) => {
        c.globalAlpha = wl.opacity; c.strokeStyle = wl.color; c.lineWidth = Math.max(0.9, wl.width * k * 0.7);
        c.beginPath(); c.moveTo(0, gap * k / 2); c.lineTo(gap * k, gap * k / 2); c.stroke();
      });
      if (wpat) {
        ctx.fillStyle = wpat;
        for (const name of ['sea', 'lakes'] as const) { const l = polyL(name); if (l) for (const p of polyPaths(l)) ctx.fill(p, name === 'sea' ? 'evenodd' : 'nonzero'); }
      }
    }
    strokePolys('sea', pal.waterEdge, lw(1.5 * u, 1.2));
    strokePolys('lakes', pal.waterEdge, lw(1.3 * u, 1.1));
    // White water of steep rivers over a satellite ground (whiteWater.ts): above the water, under the roads and bridges.
    if (!roadStyle.night) timedRec('white-water', () => drawWhiteWater(ctx, P, pathRect, sc));

    // 4. regional roads + farmsteads
    if (lod.farmsteads && polyL('farm-yards')) {
      const drives = linesOf((l) => l.role === 'drive');
      if (natural) { if (drives.length) strokeNaturalRoad(ctx, merged(drives), 'track', roadWidth('track', drives[0].width, sc), sc, roadStyle); }
      else strokeLines(drives, pal.trackFill, (l) => Math.min(lw(l.width * .7, 1), px(2.4)), 0.55 * Math.min(1, inkAlpha), [], 'butt');
      // On a natural ground the lot belongs to the photograph (farmRoofs.ts drawFarmLots): beaten earth that fades
      // at its edge, a muted garden with its bed rows, grass under the orchard, a dark pond in a wet bank; no plan
      // tint, no lot outline; all of it under the snow with the land around. Other grounds keep the plan symbols.
      if (natural) timedRec('farm-lots', () => drawFarmLots(ctx, world, { part: 'ground', viewport: pathRect, mpp: px(1), night: roadStyle.night, Path: P }));
      else {
        fillPolys('farm-gardens', pal.land.garden);
        strokePolys('farm-gardens', pal.hedge, lw(0.4, 0.3), 0.8);
        fillPolys('farm-orchards', pal.land.orchard);
        fillPolys('farm-paddocks', pal.land.pasture);
      }
      fillPolys('farm-fungal-gardens', pal.land.garden);
      strokePolys('farm-fungal-gardens', pal.hedge, lw(0.4, 0.3), 0.8);
      if (brushes && lod.textures) { brushFill('farm-gardens', 'garden', sc); brushFill('farm-orchards', 'orchard', sc); }
      if (polyL('farm-fungal-gardens')?.polys.length && lod.textures) {
        const pat = getPattern(ctx, 'fungal-farm', 8, 8, 0, (c, k) => drawPanelCanvas(c, { w: 0, h: 0, prims: underdarkMark('garden', 4 * k, 4 * k, 1.7 * k, pal, k) }, 0, 0, family));
        const l = polyL('farm-fungal-gardens');
        if (pat && l) { ctx.fillStyle = pat; for (const p of polyPaths(l)) ctx.fill(p, 'evenodd'); }
      }
      strokePolys('farm-platforms', pal.farmInk, lw(0.5, 0.4), 0.7, [px(3), px(2)]);
      // On a natural ground the walls take the yard-wall colour of the towns (no ink) and the buildings are city
      // buildings; yard, pens and ponds were painted with the lot above.
      if (!natural) {
        fillPolys('farm-yards', pal.farmYard, 0.9);
        fillPolys('farm-pens', pal.farmYard);
        strokePolys('farm-pens', pal.farmInk, lw(0.3, 0.3));
        fillPolys('farm-ponds', pal.water.stops[0][1]);
        strokePolys('farm-ponds', pal.waterEdge, lw(0.5, 0.4));
      }
      if (natural) { const wall = yardStyle('wall', '', 'terrain'); strokeLines(linesOf((l) => l.name === 'farm-walls'), wall.color, () => lw(wall.width, wall.minPx), wall.alpha, [], 'butt'); }
      else strokeLines(linesOf((l) => l.name === 'farm-walls'), pal.farmInk, () => lw(0.9, 0.7), 1, [], 'butt');
      if (natural) { if (lod.band >= 2) timedRec('farm-trees', () => drawFarmLots(ctx, world, { part: 'trees', viewport: pathRect, mpp: px(1), night: roadStyle.night, Path: P })); }
      else if (lod.band >= 2 && polyL('farm-trees')) {
        if (brushes) brushTrees('farm-trees', true); else {
        fillPolys('farm-trees', pal.treeFill);
        strokePolys('farm-trees', pal.treeInk, lw(0.3, 0.3), 0.8);
        }
      }
      if (natural && px(1) <= CITY_LOD_LIMITS[1]) {
        // The roof and wall painter of the towns, at the scales where a town shows its buildings (cast shadow, pan
        // light, grain by cover and culture, weathering, snow); paths of the class this renderer records.
        timedRec('farm-roofs', () => drawFarmRoofs(ctx, world, { viewport: pathRect, mpp: px(1), dpr, palette: 'terrain', night: roadStyle.night, Path: P }));
      } else {
        fillPolys('farm-buildings', pal.farmRoof);
        // Further out a natural ground keeps the plain roof tint without ink, like the few pixels of a town roof.
        if (!natural) {
          strokePolys('farm-buildings', pal.farmInk, lw(0.5, 0.6));
          if (lod.band >= 2) strokeLines(linesOf((l) => l.name === 'farm-ridges'), pal.farmInk, () => lw(0.35, 0.4), 0.8, [], 'butt');
        }
      }
    }
    if (luOn && lod.strips) timedRec('rural', () => drawRuralDetails(ctx, world, pal));
    // roads, tracks and the street strokes below never spill over the sea or the lakes (bridges come later)
    const land = landClip();
    ctx.save();
    if (land) ctx.clip(land, 'evenodd');
    // hierarchy: cased major roads; thinner cased minor roads; tracks as thin dashed earth lines from mid zoom only
    const roads = linesOf((l) => l.role === 'road' && l.kind !== 'track' && (lod.minorRoads || l.kind === 'major'));
    const tracks = linesOf((l) => l.role === 'road' && l.kind === 'track' && lod.band >= 1);
    drawRegionalRoads(roads, tracks);
    ctx.restore();

    // 5. urban
    const U = pal.urban;
    const uStreets = linesOf((l) => l.role === 'street');
    // (village and hamlet streets, layers 'vstreet-*', never get the far-zoom arterial strokes)
    const isVillage = (l: LineLayer): boolean => l.name.startsWith('vstreet-');
    const isEarth = (l: LineLayer): boolean => /e(?:c)?$/.test(l.kind);
    const mainsOf = (maxRank: number): LineLayer[] => uStreets.filter((l) => Number(l.kind.slice(1, 2)) <= maxRank && !l.kind.endsWith('c'));
    if (lod.densityAlpha > 0) {
      const dimg = getDensity();
      if (dimg) {
        ctx.globalAlpha = 0.9 * lod.densityAlpha;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(dimg, 0, 0, S, S);
        ctx.globalAlpha = 1;
      }
    }
    if (!lod.blocks) {
      // far: arterial and primary streets only, as thin cased lines
      ctx.save();
      if (land) ctx.clip(land, 'evenodd');
      roadGroup(mainsOf(1).filter((l) => !isVillage(l)), (l) => (l.kind.startsWith('r0') ? 1.8 : 1.2));
      ctx.restore();
    } else {
      // street space = the quarters; blocks, places and masses are laid on top
      const stilts = !!world.urban?.renderHints?.stilts;
      // open ground (camps, barbarian villages): no street space or block fill (same rules as render/urban.ts)
      const open = !!world.urban?.renderHints?.openGround && !stilts;
      const earth = mixHex(pal.trackFill, U.street, 0.52);
      const near = lod.band >= 2;
      if (open) {
        const tuft = near ? getPattern(ctx, 'tuft', 11, 9, 0, (c, k) => {
          if (isUnderdarkBiome(world.options.biome)) {
            drawPanelCanvas(c, { w: 0, h: 0, prims: [...underdarkMark('meadow', 2.5 * k, 3.5 * k, 1.4 * k, pal, k), ...underdarkMark('meadow', 8 * k, 7 * k, 1.4 * k, pal, k)] }, 0, 0, family);
            return;
          }
          c.globalAlpha = 0.75; c.strokeStyle = pal.grass; c.lineWidth = 0.35 * k; c.beginPath();
          for (const [x, y] of [[2.5, 4.5], [8, 8.4]]) { c.moveTo(x * k, y * k); c.lineTo((x - 0.8) * k, (y - 1.9) * k); c.moveTo(x * k, y * k); c.lineTo((x + 0.8) * k, (y - 1.9) * k); }
          c.stroke();
        }) : null;
        const fungal = near && isUnderdarkBiome(world.options.biome) ? getPattern(ctx, 'fungal-open', 6, 6, 0, (c, k) => drawPanelCanvas(c, { w: 0, h: 0, prims: [...underdarkMark('garden', 2 * k, 2 * k, 1.1 * k, pal, k), ...underdarkMark('garden', 4.5 * k, 4.5 * k, 1.1 * k, pal, k)] }, 0, 0, family)) : null;
        const tint = (name: string, color: string, alpha: number, pat: CanvasPattern | null): void => {
          const l = polyL(name);
          if (!l) return;
          if (pal.landBlend === 'multiply') ctx.globalCompositeOperation = 'multiply';
          fillPolys(name, color, alpha);
          ctx.globalCompositeOperation = 'source-over';
          if (pat) { ctx.fillStyle = pat; for (const p of polyPaths(l)) ctx.fill(p, 'evenodd'); }
        };
        // the settlement's ground (the footprint and a margin round it, off the water), opaque where it hides roads
        if (polyL('u-ground-solid')) fillPolys('u-ground-solid', mixHex(pal.paper, pal.land.meadow, 0.35), 1, 'nonzero');
        tint('u-ground', pal.land.meadow, pal.landOpacity * 0.8, tuft);
        tint('u-open-grass', pal.land.pasture, pal.landOpacity * 0.85, tuft);
        tint('u-open-green', pal.land.meadow, pal.landOpacity, tuft);
        tint('u-open-garden', pal.land.garden, pal.landOpacity, fungal);
        tint('u-open-field', pal.land.field, pal.landOpacity, fungal);
        if (!isUnderdarkBiome(world.options.biome) && polyL('u-open-field')) strokePolys('u-open-field', pal.furrow, lw(0.4, 0.4), 0.4);
        tint('u-open-commons', pal.land.pasture, pal.landOpacity * 0.8, null);
        // churned mud (a war camp), puddles
        if (polyL('u-mud')) {
          const dk = mixHex(pal.trackFill, '#000000', 0.25);
          fillPolys('u-mud', mixHex(pal.trackFill, pal.farmYard, 0.62), 0.75);
          const mudPat = near ? getPattern(ctx, 'mud', 9, 7, 17, (c, k) => {
            c.globalAlpha = 0.55; c.strokeStyle = dk; c.lineWidth = 0.35 * k; c.lineCap = 'round'; c.beginPath();
            for (const [x0, y0, x1, y1] of [[1, 1.5, 2.6, 1.9], [5.5, 4.8, 6.7, 4.3], [2.4, 5.6, 3.3, 6.2], [7.2, 1.2, 7.7, 2.2]]) { c.moveTo(x0 * k, y0 * k); c.lineTo(x1 * k, y1 * k); }
            c.stroke(); c.fillStyle = dk; c.beginPath(); c.arc(4.2 * k, 2.4 * k, 0.32 * k, 0, TAU); c.arc(7.8 * k, 5.9 * k, 0.25 * k, 0, TAU); c.fill();
          }) : null;
          if (mudPat) { const l = polyL('u-mud')!; ctx.fillStyle = mudPat; for (const p of polyPaths(l)) ctx.fill(p, 'evenodd'); }
        }
        if (polyL('u-puddle')) { fillPolys('u-puddle', pal.riverFill, 0.7); strokePolys('u-puddle', mixHex(pal.trackFill, '#000000', 0.2), lw(0.3, 0.3), 0.6); }
        fillPolys('u-yard-earth', mixHex(pal.farmYard, pal.trackFill, 0.12), 0.85);
        // paths: trampled earth (wide causeways keep the street colour)
        strokeLines(uStreets.filter((l) => !(l.width >= 6.5 && Number(l.kind.slice(1, 2)) <= 1)), earth, (l) => Math.max(1.2, l.width * 0.92, 0.8 / sc), 0.8);
        strokeLines(uStreets.filter((l) => l.width >= 6.5 && Number(l.kind.slice(1, 2)) <= 1), U.street, (l) => Math.max(1.2, l.width * 0.92, 0.8 / sc));
      } else if (stilts) {
        // a stilt town has no ground: boardwalks as planks over the water and the marsh
        strokeLines(uStreets, pal.bridgeInk, (l) => Math.max(1.6, l.width + 0.2, 1.4 / sc), 1, [], 'butt');
        strokeLines(uStreets, pal.bridgeDeck, (l) => Math.max(1, l.width - 0.7, 0.9 / sc), 1, [], 'butt');
      } else {
        fillPolys('u-streets', U.street, 1, 'nonzero');
      }
      const paved = (name: string, base: string, pat: CanvasPattern | null, patAlpha = 1): void => {
        fillPolys(name, base);
        if (near && pat) {
          const l = polyL(name);
          if (l) { ctx.fillStyle = pat; ctx.globalAlpha = patAlpha; for (const p of polyPaths(l)) ctx.fill(p, 'evenodd'); ctx.globalAlpha = 1; }
        }
      };
      const pave = near ? getPattern(ctx, 'pave', 3, 3, 0, (c, k) => { c.globalAlpha = 0.55; c.fillStyle = U.placeInk; c.beginPath(); c.arc(1.5 * k, 1.5 * k, 0.28 * k, 0, TAU); c.fill(); }) : null;
      const gardenPat = near && brushes ? brushes.pattern(ctx, 'garden', sc, dpr) : near ? getPattern(ctx, 'garden', 6, 6, isUnderdarkBiome(world.options.biome) ? 0 : 28, (c, k) => {
        if (isUnderdarkBiome(world.options.biome)) {
          drawPanelCanvas(c, { w: 0, h: 0, prims: [...underdarkMark('garden', 2 * k, 2 * k, 1.1 * k, pal, k), ...underdarkMark('garden', 4.5 * k, 4.5 * k, 1.1 * k, pal, k)] }, 0, 0, family);
          return;
        }
        c.globalAlpha = 0.7; c.strokeStyle = U.gardenInk; c.lineWidth = 0.35 * k;
        c.beginPath(); c.moveTo(0.6 * k, 1.5 * k); c.lineTo(3.4 * k, 1.5 * k); c.moveTo(3.2 * k, 4.5 * k); c.lineTo(5.6 * k, 4.5 * k); c.stroke();
      }) : null;
      const gravePat = near ? getPattern(ctx, 'grave', 5, 4, 0, (c, k) => {
        c.globalAlpha = 0.8; c.strokeStyle = U.gardenInk; c.lineWidth = 0.25 * k;
        c.beginPath(); c.moveTo(1.2 * k, 1.2 * k); c.lineTo(1.2 * k, 2.8 * k); c.moveTo(0.6 * k, 1.8 * k); c.lineTo(1.8 * k, 1.8 * k);
        c.moveTo(3.7 * k, 3.1 * k); c.lineTo(3.7 * k, 3.9 * k); c.moveTo(3.3 * k, 3.4 * k); c.lineTo(4.1 * k, 3.4 * k); c.stroke();
      }) : null;
      paved('u-places', U.place, pave);
      if (!open) {
        paved('u-greens', U.garden, gardenPat, 0.6);
        paved('u-yards', U.garden, gravePat);
        if (!stilts) fillPolys('u-blocks', U.yard);
        paved('u-meadows', U.garden, gardenPat, 0.45);
      }
      paved('u-plazas', U.place, pave);
      {
        const kind = countryKind(world.options.biome);
        const ruralPattern = near && luOn && pal.tex[kind] ? getPattern(ctx, 'country-ground', 26, 20, 0, (c, k) => {
          if (isUnderdarkBiome(world.options.biome)) {
            drawPanelCanvas(c, { w: 0, h: 0, prims: [...underdarkMark('commons', 5 * k, 8 * k, 2.5 * k, pal, k), ...underdarkMark('commons', 18 * k, 17 * k, 2 * k, pal, k)] }, 0, 0, family);
            return;
          }
          c.globalAlpha = 0.6; c.strokeStyle = pal.grass; c.lineWidth = 0.4 * k; c.lineCap = 'round'; c.beginPath();
          for (const [x, y] of [[5, 8], [18, 17]]) { c.moveTo(x * k, y * k); c.lineTo((x - 1.2) * k, (y - 2.4) * k); c.moveTo(x * k, y * k); c.lineTo((x + 1.2) * k, (y - 2.4) * k); }
          c.stroke(); c.globalAlpha = 0.5; c.fillStyle = pal.grass; c.beginPath(); c.arc(15 * k, 5 * k, 0.55 * k, 0, TAU); c.fill();
        }) : null;
        FRINGE_ORDER.forEach((i) => {
          const alpha = FRINGE_PAINT[i];
          const l = polyL('u-country-fringe-' + i);
          if (!l) return;
          const ids = l.index.query(rect);
          if (!ids.length) return;
          const p = cached(l.name + '|clip', () => polyPath(P, l, l.polys.map((_, id) => id), 0));
          if (p) {
            ctx.save(); ctx.clip(p, 'evenodd'); ctx.globalAlpha = alpha;
            if (tex) drawVisibleTerrain();
            else { ctx.fillStyle = pal.paper; ctx.fill(p, 'evenodd'); }
            if (luOn) {
              multiply(true); ctx.globalAlpha = alpha * pal.landOpacity; ctx.fillStyle = pal.land[kind]; ctx.fill(p, 'evenodd'); multiply(false);
              if (ruralPattern) { ctx.fillStyle = ruralPattern; ctx.globalAlpha = alpha; ctx.fill(p, 'evenodd'); }
            }
            ctx.globalAlpha = 1;
            ctx.restore();
          }
        });
        ctx.globalAlpha = 1;
        const fringe = polyL('u-country-fringe');
        if (fringe && fringe.index.query(rect).length) {
          const clip = cached(fringe.name + '|clip', () => polyPath(P, fringe, fringe.polys.map((_, id) => id), 0));
          if (clip) {
            ctx.save(); ctx.clip(clip, 'evenodd');
            strokeLines(linesOf((x) => x.role === 'fringe-street'), U.street, (x) => x.width);
            ctx.restore();
          }
        }
      }

      const natural = polyL('u-landscape-ground') ?? polyL('u-natural-ground');
      if (natural && natural.index.query(rect).length) {
        const clip = visibleClip(natural, rect);
        if (clip) {
          ctx.save(); ctx.clip(clip, 'nonzero'); ctx.globalAlpha = 1;
          if (tex) drawVisibleTerrain();
          else { ctx.fillStyle = pal.paper; ctx.fill(clip, 'nonzero'); }
          if (world.options.contours) for (const l of linesOf((x) => x.role === 'contour')) {
            const index = l.kind === 'index';
            strokeLines([l], pal.contour, () => mapStrokeWidth(index ? MAP_STROKES.contourIndex : MAP_STROKES.contour, sc, index ? pal.contourIndexW / 1.6 : pal.contourThinW ?? 1), index ? pal.contourOpacity : pal.contourOpacity * 0.7);
          }
          if (luOn) {
            for (const kind of NATURAL_LAND_KINDS) {
              const name = 'lu-' + kind;
              if (kind === 'forest') { ctx.save(); const clip = timedRec('forestClip', () => forestClip(rect)); if (clip) ctx.clip(clip, 'nonzero'); }
              multiply(true); fillLand(name, kind); multiply(false);
              multiply(true); fillLand('u-cover-' + kind, kind); multiply(false);
              if (kind === 'forest') ctx.restore();
            }
            for (const tl of scene.textures) {
              if (cityCountrysideTextureVisible(tl.kind, sc) && (NATURAL_LAND_KINDS as readonly string[]).includes(tl.kind) && (pal.tex[tl.kind] || (brushes && isBrushKind(tl.kind) && brushTextureOn(tl.kind, pal, world.options.biome)))) fs.textureTiles += drawTexture(ctx, tl, rect, band, lw, budgetRect);
            }
          }
          // Keep the original cased/dashed regional-road rendering within the restored ground.
          if (land) ctx.clip(land, 'evenodd');
          drawRegionalRoads(roads, tracks);
          // Restore native paths only where this opaque replay covered their earlier earth/causeway strokes.
          if (open && !scene.earthStreets && natural.name === 'u-landscape-ground') {
            strokeLines(uStreets.filter((l) => !(l.width >= 6.5 && Number(l.kind.slice(1, 2)) <= 1)), earth, (l) => Math.max(1.2, l.width * 0.92, 0.8 / sc), 0.8);
            strokeLines(uStreets.filter((l) => l.width >= 6.5 && Number(l.kind.slice(1, 2)) <= 1), U.street, (l) => Math.max(1.2, l.width * 0.92, 0.8 / sc));
          }
          if (scene.earthStreets && natural.name === 'u-landscape-ground') strokeLines(uStreets.filter(isEarth), mixHex(pal.farmYard, pal.trackFill, 0.12),
            (l) => Math.max(1.2, l.width * 0.92, 0.8 / sc), 0.8);
          ctx.restore();
        }
      }

      const cornPat = near ? getPattern(ctx, 'corn', 2.6, 2.6, 12, (c, k) => { c.globalAlpha = 0.75; c.fillStyle = U.gardenInk; c.beginPath(); c.arc(1.3 * k, 1.3 * k, 0.6 * k, 0, TAU); c.fill(); }) : null;
      if (polyL('u-terraces')) { const tt = mixHex(pal.land.meadow, pal.land.garden, 0.4); fillPolys('u-terraces', tt); strokePolys('u-terraces', tt, lw(1.5, 0.5)); }
      paved('u-cornfields', mixHex(pal.land.field, U.gardenInk, 0.14), cornPat);
      if (polyL('u-cornfields') && lod.band >= 1) strokePolys('u-cornfields', U.gardenInk, lw(0.45, 0.4), 0.55);
      if (polyL('u-chinampa-canals')) fillPolys('u-chinampa-canals', pal.riverFill);
      paved('u-chinampas', U.garden, gardenPat);
      // urban water (moats, tanks, mill races) and the moat line outside a planned town's wall
      strokeLines(linesOf((l) => l.role === 'uline' && (l.kind === 'moat' || l.kind === 'canal')), pal.riverFill, (l) => lw(l.width, 1));
      if (polyL('u-water')) { fillPolys('u-water', pal.riverFill, 1, 'nonzero'); strokePolys('u-water', pal.riverEdge, lw(0.5, 0.4)); }
      // compound grounds, mosque courts (sahn), cloister garths, ditch parcels, cemeteries, castle bases
      fillPolys('u-grounds', U.place);
      if (polyL('u-sahn')) { paved('u-sahn', U.place, pave); strokePolys('u-sahn', U.plotLine, lw(0.2, 0.3)); }
      if (polyL('u-garth')) { fillPolys('u-garth', U.garden); strokePolys('u-garth', U.plotLine, lw(0.25, 0.3)); }
      if (polyL('u-ditch')) { paved('u-ditch', U.garden, gardenPat); strokePolys('u-ditch', U.plotLine, lw(0.3, 0.3)); }
      paved('u-cemetery', U.garden, gravePat);
      if (polyL('u-bases')) { fillPolys('u-bases', U.wallFill); strokePolys('u-bases', U.wall, lw(0.4, 0.5)); }
      if (!open) paved('u-backland', U.garden, world.urban?.renderHints?.graves ? gravePat : gardenPat);
      // building masses (courtyards are holes -> evenodd), with a soft drop shadow when zoomed in
      const masses = polyL('u-masses');
      if (lod.buildings && masses) {
        let cand = 0;
        for (const t of masses.index.tilesInRect(budgetRect)) cand += masses.index.tileStart[t + 1] - masses.index.tileStart[t];
        cand += masses.index.bigInRect(budgetRect).length;
        fs.buildingsCandidate = cand;
        if (cand <= BUILDING_BUDGET_MAX) {
          fs.buildingsDrawn = true;
          const paths = polyPaths(masses);
          const sh = U.shadow;
          if (sh && lod.band >= 2 && cand <= BUILDING_BUDGET_FULL) {
            // styled cast shadow: solid sepia fringe, hatched once the fringe is wide enough on screen
            ctx.save(); ctx.translate(sh.dx, sh.dy);
            ctx.fillStyle = sh.color; ctx.globalAlpha = sh.hatch && sc >= 1.1 ? sh.alpha * 0.4 : sh.alpha;
            for (const p of paths) ctx.fill(p, 'evenodd');
            if (sh.hatch && sc >= 1.1) {
              const hp = getPattern(ctx, 'shadowhatch', 2.6, 2.6, 45, (c, k) => { c.strokeStyle = sh.color; c.globalAlpha = sh.alpha; c.lineWidth = 0.9 * k; c.beginPath(); c.moveTo(0, 1.3 * k); c.lineTo(2.6 * k, 1.3 * k); c.stroke(); });
              if (hp) { ctx.fillStyle = hp; ctx.globalAlpha = 1; for (const p of paths) ctx.fill(p, 'evenodd'); }
            }
            ctx.restore(); ctx.globalAlpha = 1;
          } else if (lod.shadows && cand <= BUILDING_BUDGET_FULL) {
            ctx.save(); ctx.translate(1.4, 1.7);
            ctx.fillStyle = 'rgba(0,0,0,0.2)';
            for (const p of paths) ctx.fill(p, 'evenodd');
            ctx.restore();
          }
          const bl = polyL('u-bldg');
          let indiv = 0;
          if (lod.individual && bl) {
            for (const t of bl.index.tilesInRect(budgetRect)) indiv += bl.index.tileStart[t + 1] - bl.index.tileStart[t];
            indiv += bl.index.bigInRect(budgetRect).length;
          }
          if (lod.individual && bl && indiv <= BUILDING_BUDGET_INDIV) {
            // one building at a time (as in the SVG): roof fill, then a thin outline so party walls show as lines
            const lm = lumHex(U.mass);
            const roof = lm < 0.3 ? mixHex(U.mass, U.yard, 0.42) : U.mass;
            const ink = lm < 0.3 ? mixHex(U.mass, '#000000', 0.25) : lumHex(U.massEdge) < lm ? U.massEdge : mixHex(U.mass, '#000000', 0.6);
            const bp = polyPaths(bl);
            ctx.fillStyle = roof;
            // (the masses first: a megacity quarter not detailed yet has its stand-in masses and no buildings)
            for (const p of paths) ctx.fill(p, 'evenodd');
            for (const p of bp) ctx.fill(p, 'evenodd');
            ctx.strokeStyle = ink; ctx.lineWidth = lw(Math.max(0.28, U.massEdgeW * 0.9), 0.45); ctx.lineJoin = 'miter';
            for (const p of bp) ctx.stroke(p);
            ctx.lineJoin = 'round';
          } else {
            ctx.fillStyle = U.mass;
            for (const p of paths) ctx.fill(p, 'evenodd');
            if (cand <= BUILDING_BUDGET_FULL) {
              ctx.strokeStyle = U.massEdge; ctx.lineWidth = lw(U.massEdgeW, 0.3);
              for (const p of paths) ctx.stroke(p);
            }
          }
          if (U.lit && lod.band >= 2) drawLit(ctx, rect, sc, U.lit.color, U.lit.density);
        }
      }
      // A place whose plan is still to come: on a natural ground its stand-in houses are houses of its culture under
      // the roof painter of the towns, along earth lanes (farmRoofs.ts), over the plain stand-in marks; other
      // grounds keep those marks.
      if (natural && px(1) <= CITY_LOD_LIMITS[1]) timedRec('place-roofs', () => drawPlaceholderRoofs(ctx, world, { viewport: pathRect, mpp: px(1), dpr, palette: 'terrain', night: roadStyle.night, Path: P,
        lane: path => strokeNaturalRoad(ctx, path, 'lane', roadWidth('lane', 3, sc), sc, roadStyle) }));
      // landmark buildings: the landmark tone, outlined
      const lmHatch = lod.fine ? getPattern(ctx, 'lmhatch', 1.6, 1.6, 45, (c, k) => { c.globalAlpha = 0.55; c.strokeStyle = U.landmarkEdge; c.lineWidth = 0.35 * k; c.beginPath(); c.moveTo(0, 0.8 * k); c.lineTo(1.6 * k, 0.8 * k); c.stroke(); }) : null;
      const hatched = (name: string): void => {
        const l = polyL(name);
        if (!l || !lmHatch) return;
        ctx.fillStyle = lmHatch; ctx.globalAlpha = 1;
        for (const p of polyPaths(l)) ctx.fill(p, 'evenodd');
      };
      if (polyL('u-lmb')) { fillPolys('u-lmb', U.landmark); hatched('u-lmb'); strokePolys('u-lmb', U.landmarkEdge, lw(0.7, near ? 0.5 : 1.4)); }
      // courtyard houses: the patio as a paved court with a crisp inner edge
      if (polyL('u-patios') && lod.individual) {
        fillPolys('u-patios', U.place);
        if (near && pave) { const l = polyL('u-patios')!; ctx.fillStyle = pave; for (const p of polyPaths(l)) ctx.fill(p, 'evenodd'); }
        strokePolys('u-patios', U.massEdge, lw(0.45, 0.6));
      }
      // plan lines (same rules per kind as render/urban.ts): enclosure walls, fences, terraces, hedges, footpaths,
      // canal footbridges, bazaar roofs, qanats, stair treads. Unlisted kinds fall back to the wall-like stroke.
      {
        const treeInk = pal.treeInk ?? '#4a6a3a';
        const fine = lod.fine;
        const terraceDetail = terraceDetailAlpha(sc);
        strokeLines(linesOf((x) => x.role === 'uline' && x.kind === 'andene-riser'), U.wallFill, () => TS.face.width, TS.face.alpha, [], 'butt');
        for (const l of linesOf((x) => x.role === 'uline')) {
          const k = l.kind, w = l.width;
          const one = (color: string, width: number, alpha = 1, dash: number[] = [], cap: CanvasLineCap = 'round'): void => strokeLines([l], color, () => width, alpha, dash, cap);
          if (k === 'moat' || k === 'canal') continue;
          else if (k === 'hedge') one(treeInk, lw(2.6, 0.8), 0.8, fine ? [3, 1.5] : [], 'butt');
          else if (k === 'track') {
            const rural = !open && !stilts;
            one(rural ? ruralInk(pal) : open ? earth : U.street, lw(rural ? 1.6 : open ? 2.6 : 3, rural ? 0.9 : 0.6), rural ? pal.rural.track : open ? 0.75 : 1, rural ? [6, 3.5] : [], rural ? 'butt' : 'round');
          }
          else if (k === 'weir') one(U.wall, lw(1.4, 0.5), 1, fine ? [1.2, 0.6] : [], 'butt');
          else if (k === 'parterre') { if (fine) one(U.plotLine, lw(0.5, 0.4)); }
          else if (k === 'footpath') { if (fine) one(open ? earth : U.street, lw(1.4, 0.6)); }
          else if (k === 'roof-line') { if (near) one(U.massEdge, lw(0.2, 0.3), 0.7, [], 'butt'); }
          else if (k === 'garden-hedge') one(treeInk, lw(1.2, 0.5), 0.7, fine ? [1.6, 0.7] : [], 'butt');
          else if (k === 'bund') { if (fine) one(U.plotLine, lw(0.4, 0.3), 0.35, [], 'butt'); }
          else if (k === 'turf-wall') { one(mixHex(pal.grass, U.wall, 0.35), lw(2.2, 0.8), 0.42); if (fine) one(U.wall, lw(0.16, 0.3), 0.45); }
          else if (k === 'albarrada') one(U.wall, lw(0.85, 0.4), 0.4, fine ? [0.9, 0.45] : []);
          else if (k === 'ghat-steps') { if (fine) one(U.plotLine, lw(0.3, 0.4)); }
          else if (k === 'terrace') one(U.wall, lw(TS.wall.width, TS.wall.minPx), TS.wall.alpha);
          else if (k === 'andene') one(U.wall, lw(TS.andene.width, TS.andene.minPx), TS.andene.alpha);
          else if (k === 'andene-riser') continue;
          else if (k === 'andene-hachure' || k === 'terrace-tread') { if (terraceDetail > 0) one(U.wall, lw(TS.hatch.width, TS.hatch.minPx), TS.hatch.alpha * terraceDetail, [], 'butt'); }
          else if (k === 'terrace-stair') one(U.wall, lw(TS.stair.width, TS.stair.minPx), TS.stair.alpha);
          else if (k === 'thorn-fence') one(treeInk, lw(2.2, 0.8), 0.85, near ? [1.3, 0.9] : []);
          else if (k === 'rampart') { one(U.garden, lw(7, 1.4), 0.9); one(U.wall, lw(0.6, 0.4)); }
          else if (k === 'ditch') one(U.wall, lw(4, 0.9), 0.35);
          else if (k === 'footbridge') {
            // the deck between its parapets
            const dw = w || 2.5;
            one(pal.bridgeInk, Math.max(dw + 0.9, 2.2 / sc), 1, [], 'butt');
            one(pal.bridgeDeck, Math.max(dw, 1.4 / sc), 1, [], 'butt');
          }
          else if (k === 'bazaar-roof') {
            // the vaulted bazaar street: a roof over the street's own width
            const rw = Math.max(2, (w || 5) - 0.6);
            one(U.landmarkEdge, Math.max(rw + 0.8, 2.2 / sc), 1, [], 'butt');
            one(U.landmark, Math.max(rw, 1.4 / sc), 1, [], 'butt');
          }
          else if (k === 'qanat') one(U.wall, lw(1, 0.6), 0.7, [4, 3], 'butt');
          else if (k === 'qanat-shaft') { ctx.fillStyle = U.garden; for (const p of linePaths(l)) ctx.fill(p, 'evenodd'); one(U.wall, lw(0.7, 0.5)); }
          else if (k === 'hachure') { if (terraceDetail > 0) one(U.wall, lw(TS.hatch.width, TS.hatch.minPx), TS.hatch.alpha * terraceDetail, [], 'butt'); }
          else if (CAMP_FENCE_W[k] !== undefined) {
            // a rail with its posts (stakes close together for a palisade); zoomed out, a thin line
            const st = FENCE_STYLE[k] ?? FENCE_STYLE['yard-fence'];
            const far = !fine && k !== 'palisade' && k !== 'kraal-fence';
            if (far) { if (lod.band >= 1) one(U.wall, lw(st[0], 0.3), 0.6); }
            else {
              one(U.wall, lw(st[0], 0.35), 0.8);
              if (near) one(U.wall, st[1], 0.9, [st[2], st[3]], 'butt');
              else if (k === 'palisade' || k === 'kraal-fence') one(U.wall, lw(st[1], 0.5), 0.75);
            }
          }
          else one(U.wall, lw(WALL_LINE_W[k] ?? 1, 0.8), 1, [], 'square');
        }
        // tree canopies (elven towns)
        const trees = polyL('u-trees');
        if (trees && lod.individual) {
          if (brushes) brushTrees('u-trees'); else {
          ctx.globalAlpha = 0.78; ctx.fillStyle = pal.treeFill ?? '#7f9a5a';
          for (const p of polyPaths(trees)) ctx.fill(p, 'evenodd');
          ctx.globalAlpha = 1;
          strokePolys('u-trees', treeInk, lw(0.35, 0.4));
          }
        }
      }
      // churches: distinct outlined mass with a cross
      if (polyL('u-church')) {
        fillPolys('u-church', U.landmark);
        hatched('u-church');
        // (zoomed out, a small church keeps a legible outline: at least ~1.6 px)
        strokePolys('u-church', U.landmarkEdge, lw(0.8, near ? 0.6 : 1.6));
        if (lod.band >= 2) strokeLines(linesOf((l) => l.role === 'cross'), U.landmarkEdge, (l) => lw(l.width, 0.6));
      }
      // plot hairlines: a dark pass (reads on yards) and a light pass (reads on roofs)
      if (lod.parcels) {
        const plots = linesOf((l) => l.role === 'plot');
        strokeLines(plots, U.plotLine, () => lw(U.plotW, 0.4), U.plotAlpha * 0.7, [], 'butt');
        if (U.plotLightAlpha > 0) strokeLines(plots, U.massEdge, () => lw(U.plotW, 0.4), U.plotLightAlpha * 0.7, [], 'butt');
      }
      // hierarchy: arterial / primary streets keep a legible minimum width in street colour
      const minPx = (l: LineLayer): number => (isVillage(l) ? (lod.band >= 2 ? 1.2 : 0.8) : l.kind.startsWith('r0') ? 2.6 : l.kind.startsWith('r1') ? 1.8 : 1.0);
      const thin = mainsOf(lod.band === 1 ? 2 : 1).filter((l) => l.width * sc < minPx(l));
      ctx.save();
      if (land && !stilts) ctx.clip(land, 'evenodd');
      if (thin.length && !stilts && !open) {
        const space = polyL('u-stroke-space');
        const clip = space && visibleClip(space, rect);
        if (clip) ctx.clip(clip, 'nonzero');
        else thin.length = 0;
      }
      strokeLines(thin.filter((l) => !isEarth(l)), open ? earth : U.street, (l) => minPx(l) / sc, open ? 0.8 : 1);
      strokeLines(thin.filter(isEarth), mixHex(pal.farmYard, pal.trackFill, 0.12), (l) => minPx(l) / sc, 0.8);
      ctx.restore();
      if (polyL('landmarks') && near) strokePolys('landmarks', U.landmark, lw(0.6, 0.6), 0.5, [px(5), px(3)]);
      // zoomed out: the landmark sites (wells, crosses, markets, compounds' named buildings) as a solid outline of at
      // least ~1.8 px, so the small ones stay visible on the full map
      else if (polyL('landmarks')) strokePolys('landmarks', U.landmarkEdge, lw(0.6, 1.8), 0.9);
    }
    // walls: casing + fill (stretches between gate openings), towers and gate towers
    const walls = linesOf((l) => l.role === 'wall');
    const ws = U.wallScale;
    for (const l of walls) strokeLines([l], U.wall, () => Math.max(l.width * ws + 1.4, 3 / sc), 1, [], 'butt');
    for (const l of walls) strokeLines([l], U.wallFill, () => Math.max(0.6, l.width * ws - 1, 1.5 / sc), 1, [], 'butt');
    if (walls.length && lod.towers) {
      for (const name of ['towers', 'gate-towers']) {
        fillPolys(name, U.wallFill);
        strokePolys(name, U.wall, lw(0.9, 0.8));
      }
    }

    // 6. bridges
    if (world.bridges?.length) drawBridges(ctx, world, pal, rect, sc);
    // site marker (placeholder until an urban layer exists)
    if (!world.urban && world.site) drawSiteMarker(ctx, world, pal, sc, false);
    if (cavernFloor) {
      if (luOn && world.options.biome === 'underdark-caverns' && world.terrain.caverns?.fungalRooms?.length) {
        const rooms = exactCavernPath('fungalRooms');
        if (rooms) {
          ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = pal.landOpacity;
          ctx.fillStyle = pal.land.garden; ctx.fill(rooms, 'nonzero'); ctx.globalAlpha = 1;
          const pattern = getPattern(ctx, 'cavern-fungi', 8, 8, 0, (c, k) => drawPanelCanvas(c, { w: 0, h: 0, prims: underdarkMark('garden', 4 * k, 4 * k, 1.7 * k, pal, k) }, 0, 0, family));
          if (pattern) { ctx.fillStyle = pattern; ctx.fill(rooms, 'nonzero'); }
        }
      }
      ctx.restore();
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      const groundRock = deps.groundCaverns?.() ?? false;
      // The GPU ground paints the rock: erase whatever the overlay drew inside it (streams and tracks under the vault).
      if (groundRock) { const rock = exactCavernPath('solid'); if (rock) { ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = '#000'; ctx.fill(rock, 'nonzero'); ctx.globalCompositeOperation = 'source-over'; } }
      const solid = groundRock ? null : exactCavernPath('solid'), floor = exactCavernPath('floor');
      if (solid) { ctx.fillStyle = cavernWallFill(pal); ctx.fill(solid, 'nonzero'); }
      if (solid) {
        ctx.save(); ctx.clip(solid, 'nonzero');
        const rock = getCavernRock(); if (rock) ctx.drawImage(rock, 0, 0, S, S);
        if (floor) for (const rim of CAVERN_RIM) {
          ctx.globalAlpha = rim.alpha; ctx.strokeStyle = rim.color; ctx.lineWidth = rim.width; ctx.stroke(floor);
        }
        ctx.restore(); ctx.globalAlpha = 1;
      }
    }

    ctx.restore();
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    if (mode !== 'map') {
    // 7. map frame (screen space, around the map rectangle)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.setLineDash([]);
    {
      const side = S * sc, fx = cssW / 2 - view.cx * sc, fy = cssH / 2 - view.cy * sc;
      if (pal.frameKind !== 'none' && fx < cssW && fy < cssH && fx + side > 0 && fy + side > 0) {
        drawPanelCanvas(ctx, { w: side, h: side, prims: frameModel(side, side, pal, false) }, fx, fy, family);
      }
    }

    // 8. labels, cartouche, legend (screen space)
    if (overlays.labels && labels.length) {
      const measure = (text: string, size: number): number => {
        ctx.font = `${size}px ${pal.fontFamily}`;
        return ctx.measureText(text).width;
      };
      const placed = placeLabels(labels, view, cssW, cssH, measure);
      ctx.textBaseline = 'top'; ctx.lineJoin = 'round';
      for (const pl of placed) {
        const size = pl.label.size ?? 12;
        ctx.font = `${size}px ${pal.fontFamily}`;
        ctx.lineWidth = 3; ctx.strokeStyle = pal.lab.halo; ctx.globalAlpha = 0.85;
        ctx.strokeText(pl.label.text, pl.x, pl.y);
        ctx.globalAlpha = 1; ctx.fillStyle = pl.label.color ?? pal.ink;
        ctx.fillText(pl.label.text, pl.x, pl.y);
      }
    }
    if (!deps.separateText) drawText(ctx, view, cssW, cssH);
    // panels sit inside the map frame when the map corner is under them, else at the viewport corner
    const pm = panelMargin(pal) * 0.75;
    const mx0 = cssW / 2 - view.cx * sc, my0 = cssH / 2 - view.cy * sc, mapBottom = my0 + S * sc;
    const compact = compactMapPanels(cssW, cssH);
    if (compact && overlays.cartouche) drawPanelCanvas(ctx, compactScaleModel(pal, sc, world.options.distanceUnit), 12, cssH - 40, family);
    const cart = overlays.cartouche && !compact ? cartoucheModel(world, pal, sc) : null;
    if (cart) {
      const inside = mx0 < 12 + cart.w && my0 < 12 + cart.h;
      drawPanelCanvas(ctx, cart, inside ? Math.max(12, mx0 + pm) : 12, inside ? Math.max(12, my0 + pm) : 12, family);
    }
    if (overlays.legend && !compact) {
      const panel = legendNow();
      const home = Math.max(12, cssH - panel.h - 34);
      const inside = mx0 < 12 + panel.w && mapBottom > home && mapBottom < cssH + panel.h + 60;
      drawPanelCanvas(ctx, panel, inside ? Math.max(12, mx0 + pm) : 12, inside ? Math.max(12, Math.min(home, mapBottom - pm - panel.h)) : home, family);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    fs.pathsBuilt = built - built0;
    fs.pathCache = cache.size;
    fs.furrowCache = furrowCache.size; fs.furrowsDrawn ??= 0;
    if (brushes) fs.brushBytes = brushes.cachedBytes;
    fs.ms = now() - t0;
    stats = fs;
    return fs;
  }

  /** Deterministic lit windows of the visible buildings (night style). */
  function drawLit(ctx: CanvasRenderingContext2D, rect: Rect4, sc: number, color: string, density: number): void {
    litCache ??= litDots(world, density);
    const d = litCache;
    const path = new P();
    let n = 0;
    for (let i = 0; i < d.length; i += 2) {
      const x = d[i], y = d[i + 1];
      if (x < rect.minX || x > rect.maxX || y < rect.minY || y > rect.maxY) continue;
      path.moveTo(x, y); path.lineTo(x, y); n++;
      if (n > 60000) break;
    }
    if (!n) return;
    ctx.lineCap = 'round'; ctx.strokeStyle = color;
    const w = Math.max(1.3, 2 / sc);
    ctx.globalAlpha = 0.16; ctx.lineWidth = w * 3.2; ctx.stroke(path);
    ctx.globalAlpha = 1; ctx.lineWidth = w; ctx.stroke(path);
  }

  /** Woods leave room for roads, rivers and farmsteads; crowns rooted at the edge overhang them a little. */
  const roomOf = (): ForestRoom => forestRoom ??= new ForestRoom(forestCorridors(world), [...farmClearings(world.landuse), ...(world.landuse?.areas ?? []).filter(a => a.kind === 'orchard'), ...(deps.buildingClearings?.() ?? []).map(r => growRing(r, FARM_MARGIN))]);

  /** Tree centres of a wood or orchard layer within `area`, in draw order (cached per index tile). */
  function treeMarksIn(tl: TextureLayer, area: Rect4): Mark[] {
    const marks: Mark[] = [];
    for (const tile of tl.index.tilesInRect(area)) {
      for (const m of tileTreeMarks(tl, tile)) if (m.x >= area.minX && m.x <= area.maxX && m.y >= area.minY && m.y <= area.maxY) marks.push(m);
    }
    return marks.sort((a, b) => a.y - b.y || a.x - b.x);
  }
  /** Tree marks of one index tile (all of them, cached for the whole map). */
  function tileTreeMarks(tl: TextureLayer, tile: number): Mark[] {
    let entries = treeMarks.get(tl); if (!entries) { entries = new Map(); treeMarks.set(tl, entries); }
    const exclusion = tl.kind === 'forest' ? polyL('u-forest-clearings') : undefined;
    const room = tl.kind === 'forest' ? roomOf() : undefined;
    {
      let points = entries.get(tile);
      if (!points) {
        points = canopyMarks(tl, tile, world.seed).filter(m => (tl.kind !== 'forest' || m.k < (canopy ? .5 + .5 * forestWeight(m.x, m.y) : forestWeight(m.x, m.y)))
          && (!room || room.keeps(m.x, m.y, (m.k * 37.17) % 1, (canopy ? 6.1 : brushes ? 4.75 : 0) * m.r))
          // Parchment woods grow in clumps: small glades let the dark shaded floor show between them.
          && (tl.kind !== 'forest' || !canopy || pal.name !== 'parchment' || clumpNoise(m.x, m.y, 26, 5) > .27) && (!exclusion || !exclusion.index.query({ minX: m.x, minY: m.y, maxX: m.x, maxY: m.y }).some(i =>
          pointInRenderPoly(exclusion.polys[i], m.x, m.y) && !(exclusion.holes?.[i] ?? []).some(h => pointInRenderPoly(h, m.x, m.y)))));
        // Marks are small and zoom-independent: keep a whole map of them, or every zoom step recomputes them.
        if (entries.size >= 8192) entries.delete(entries.keys().next().value!);
        entries.set(tile, points);
      }
      return points;
    }
  }
  /** GPU recording: canopy sprite data per index tile and atlas resolution, so a new region or zoom level re-records
   * its woods by gathering cached instances instead of stamping every tree again. */
  const treeSprites = new Map<TextureLayer, Map<string, { image: CanvasImageSource; data: Float32Array; marks: Mark[] } | null>>();
  /** False when the canopy draws vector glyphs at this scale (no atlas): the caller paints the trees itself. */
  function recordTreeSprites(ctx: RecordingContext, tl: TextureLayer, area: Rect4, pxPerMetre: number): boolean {
    if (!canopy || brushes) return false;
    const kind = tl.kind === 'orchard' ? 'orchard' : 'forest', resolution = canopy.resolutionFor(pxPerMetre, 1);
    let cache = treeSprites.get(tl); if (!cache) { cache = new Map(); treeSprites.set(tl, cache); }
    const parts: { image: CanvasImageSource; data: Float32Array; marks: Mark[] }[] = [];
    for (const tile of tl.index.tilesInRect(area)) {
      const key = `${tile}|${resolution}`;
      let entry = cache.get(key);
      if (entry === undefined) {
        const marks = tileTreeMarks(tl, tile);
        const made = canopy.spriteData(marks, kind, pxPerMetre, 1, tl.kind === 'forest' ? coniferOf : undefined);
        entry = made ? { ...made, marks } : null;
        if (cache.size >= 16384) cache.delete(cache.keys().next().value!);
        cache.set(key, entry);
      }
      if (entry === null) return false;
      if (entry.marks.length) parts.push(entry);
    }
    if (!parts.length) return true;
    const image = parts[0].image;
    if (parts.some(p => p.image !== image)) return false;
    // Gather the marks inside the area, painted from back to front like the Canvas canopy (sorted by y, then x).
    let n = 0;
    for (const p of parts) n += p.marks.length;
    const data = new Float32Array(n * 8), xs = new Float64Array(n), ys = new Float64Array(n);
    let count = 0;
    for (const p of parts) for (let i = 0; i < p.marks.length; i++) {
      const m = p.marks[i];
      if (m.x < area.minX || m.x > area.maxX || m.y < area.minY || m.y > area.maxY) continue;
      data.set(p.data.subarray(i * 8, i * 8 + 8), count * 8); xs[count] = m.x; ys[count] = m.y; count++;
    }
    if (count > GPU_SPRITE_BATCH_MAX) return false;
    const order = new Uint32Array(count);
    for (let i = 0; i < count; i++) order[i] = i;
    order.sort((a, b) => ys[a] - ys[b] || xs[a] - xs[b]);
    ctx.globalAlpha = 1;
    ctx.drawImageBatch(image, data, order);
    return true;
  }

  /** Whole trees at their marks: painted brushes, or the canopy sprites (engraved on parchment). */
  function paintTrees(ctx: CanvasRenderingContext2D, tl: TextureLayer, marks: Mark[], pxPerMetre: number): void {
    if (brushes) for (const m of marks) {
      ctx.globalAlpha = .88 + .12 * m.k;
      brushes.tree(ctx, m.x, m.y, (tl.kind === 'orchard' ? 3.5 : 4.75) * m.r, tl.kind === 'orchard');
    }
    else canopy!.draw(ctx, marks, tl.kind === 'orchard' ? 'orchard' : 'forest', pxPerMetre, 1, tl.kind === 'forest' ? coniferOf : undefined);
    ctx.globalAlpha = 1;
  }

  /** Whether every non-empty sprite-layer tile of a view fits the tile cache at once (`pxPerMetre`: device pixels). */
  function layerTilesFitView(rect: Rect4, pxPerMetre: number): boolean {
    if (!(pxPerMetre > 0)) return false;
    const density = 2 ** Math.ceil(Math.log2(pxPerMetre));
    if (density > LAYER_TILE_MAX_DENSITY) return true;
    const span = LAYER_TILE_PX / density, side = LAYER_TILE_PX + 2 * LAYER_TILE_GUTTER, limit = layerTiles.maxBytes * .75;
    const x0 = Math.floor(rect.minX / span), x1 = Math.floor(rect.maxX / span), y0 = Math.floor(rect.minY / span), y1 = Math.floor(rect.maxY / span);
    let bytes = 0;
    for (const tl of scene.textures) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!tl.index.query(growRect({ minX: x * span, minY: y * span, maxX: (x + 1) * span, maxY: (y + 1) * span }, LAYER_TILE_REACH + LAYER_TILE_GUTTER)).length) continue;
      if ((bytes += side * side * 4) > limit) return false;
    }
    return true;
  }

  /**
   * Sprite layers (woods, parchment symbols) pre-composited per (layer, power-of-two pixel density, 512 px tile).
   * A tile holds every mark whose sprite reaches it, in the global draw order, so neighbouring tiles join exactly and
   * the result is the one of stamping the marks one by one. A frame then draws a few bitmaps instead of thousands of
   * sprites, and zooming within a density octave or panning back redraws nothing. False: draw directly.
   */
  function drawLayerTiles(ctx: CanvasRenderingContext2D, tl: TextureLayer, part: string, rect: Rect4,
    paint: (target: CanvasRenderingContext2D, area: Rect4, pxPerMetre: number) => void): boolean {
    if (layerTilesFailed || !layerTilesFit) return false;
    const t = ctx.getTransform();
    if (t.b || t.c || !(t.a > 0) || Math.abs(t.d - t.a) > t.a * 1e-6) return false;
    const density = 2 ** Math.ceil(Math.log2(t.a));
    if (density > LAYER_TILE_MAX_DENSITY) return false;
    // A cold sprite tile must not expand one small progressive map tile into a 512 px raster job.
    const tilePx = activeLive ? 256 : LAYER_TILE_PX;
    const span = tilePx / density, g = LAYER_TILE_GUTTER, side = tilePx + 2 * g;
    const x0 = Math.floor(rect.minX / span), x1 = Math.floor(rect.maxX / span), y0 = Math.floor(rect.minY / span), y1 = Math.floor(rect.maxY / span);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) * side * side * 4 > layerTiles.maxBytes * .75) return false;
    let id = brushIds.get(tl); if (id === undefined) { id = ++brushId; brushIds.set(tl, id); }
    // Resolve every tile before painting the target, so an allocation refusal still leaves the direct path.
    const tiles: { image: CanvasImageSource; x: number; y: number }[] = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const key = `${id}|${part}|${density}|${tilePx}|${x},${y}`;
      let image = layerTiles.get(key);
      if (image === undefined) {
        const area = { minX: x * span - g / density, minY: y * span - g / density, maxX: (x + 1) * span + g / density, maxY: (y + 1) * span + g / density };
        const bounds = growRect(area, LAYER_TILE_REACH);
        if (!tl.index.query(bounds).length) {
          image = null; layerTiles.put(key, { value: null, bytes: 0, bounds, release: () => {} });
        } else {
          const target = makeCanvas(side, side), tx = target?.getContext('2d');
          if (!target || !tx) { layerTilesFailed = true; layerTiles.clear(); return false; }
          tx.setTransform(density, 0, 0, density, -area.minX * density, -area.minY * density);
          paint(tx, area, density);
          // The canvas is the tile (no transferToImageBitmap: it would wait for the GPU raster on the main thread).
          const value = target as unknown as CanvasImageSource;
          image = value;
          // The GPU engine may hold a texture of this canvas: drop it with the tile.
          // A retained GPU list may still replay this canvas after its eviction: such a canvas is only dropped (the
          // garbage collector frees it with the list), never emptied, or the replay would draw from a blank source.
          layerTiles.put(key, { value, bytes: side * side * 4, bounds, release: () => { existingGpuRasterizer()?.invalidateImage(value); if (!recordedTiles.has(value)) { target.width = 0; target.height = 0; } } });
        }
      }
      if (image) tiles.push({ image, x, y });
    }
    // Each device pixel belongs to one tile (integer partition); the gutters only feed the filtering at the seams.
    const k = t.a / density;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
    for (const tile of tiles) {
      const sx = t.a * tile.x * span + t.e, sy = t.d * tile.y * span + t.f;
      const left = Math.round(sx), top = Math.round(sy), right = Math.round(sx + t.a * span), bottom = Math.round(sy + t.d * span);
      ctx.save(); ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
      if (ctx instanceof RecordingContext) recordedTiles.add(tile.image);
      ctx.drawImage(tile.image, sx - g * k, sy - g * k, side * k, side * k); ctx.restore();
    }
    ctx.restore();
    return true;
  }

  function drawTexture(ctx: CanvasRenderingContext2D, tl: TextureLayer, rect: Rect4, band: number, lw: (w: number, m: number) => number, budgetRect: Rect4 = rect): number {
    // The polygon wash above carries light parchment woods; keep individual trees only at close zoom.
    const scale = ctx.getTransform().a / (activeDpr ?? deps.dpr ?? 1);
    if (activeLight && pal.name === 'parchment' && scale < 1 && ['forest', 'commons', 'pasture', 'meadow', 'marsh'].includes(tl.kind)) return 0;
    if ((canopy || brushes) && (tl.kind === 'forest' || tl.kind === 'orchard')) {
      // Select centres inside the cover, then draw whole trees, including overhanging crowns.
      const expanded = growRect(rect, CANOPY_MARGIN), count = tl.index.tilesInRect(expanded).length;
      ctx.save();
      if (tl.kind === 'forest') { const clip = forestClip(rect); if (clip) ctx.clip(clip, 'nonzero'); }
      // GPU engine: the woods become one instanced sprite batch from cached per-tile data; failing that, few enough
      // marks are stamped directly, and more go through the layer tiles below.
      const batched = ctx instanceof RecordingContext && recordTreeSprites(ctx, tl, expanded, ctx.getTransform().a);
      const direct = !batched && ctx instanceof RecordingContext ? treeMarksIn(tl, expanded) : undefined;
      if (batched) { /* recorded as one sprite batch */ }
      else if (direct && direct.length <= GPU_SPRITE_BUDGET) paintTrees(ctx, tl, direct, ctx.getTransform().a);
      // Thousands of sprites per view: stamp them once per density and tile, then reuse the bitmaps while panning and zooming.
      else if (!drawLayerTiles(ctx, tl, 'trees', rect, (target, area, pxPerMetre) => paintTrees(target, tl, treeMarksIn(tl, growRect(area, LAYER_TILE_REACH)), pxPerMetre)))
        paintTrees(ctx, tl, direct ?? treeMarksIn(tl, expanded), ctx.getTransform().a);
      ctx.restore();
      return count;
    }
    if (tl.kind !== 'forest') return drawTextureMarks(ctx, tl, rect, band, lw, budgetRect);
    ctx.save(); const clip = forestClip(rect); if (clip) ctx.clip(clip, 'nonzero');
    try { return drawTextureMarks(ctx, tl, rect, band, lw, budgetRect); }
    finally { ctx.restore(); }
  }

  /** 3D drape woods: crowns at world-space hashed centres with the world-space clump noise, so neighbouring tiles join
   * and nothing repeats. No polygon test per tree: the tile is drawn once, then masked by the wood. Coarse tiles thin the
   * grid by a power of two and enlarge the crowns alike, which keeps the tone and the glades at any scale. */
  let canopyScratch: CanvasLike | undefined;
  /** Per-call scratch canvases of a recorded 3D drape tile, released once the tile is rasterised. */
  const drapeTemps: CanvasLike[] = [];
  function releaseDrapeTemps(): void {
    const gpu = existingGpuRasterizer();
    for (const c of drapeTemps.splice(0)) { gpu?.invalidateImage(c as unknown as CanvasImageSource); c.width = 0; c.height = 0; }
  }
  function drawDrapeCanopy(ctx: CanvasRenderingContext2D, tl: TextureLayer, rect: Rect4, pxPerMetre: number): number {
    const ids = tl.index.query(rect); if (!ids.length || !canopy) return 0;
    const target = ctx.canvas as unknown as CanvasLike, w = target.width, h = target.height;
    let scratch = canopyScratch;
    if (ctx instanceof RecordingContext) {
      // A recorded drawImage keeps its source until the tile is rasterised: a scratch of its own per call, released after.
      scratch = makeCanvas(w, h) ?? undefined; if (scratch) drapeTemps.push(scratch);
    } else {
      if (!scratch || scratch.width !== w || scratch.height !== h) canopyScratch = scratch = makeCanvas(w, h) ?? undefined;
    }
    const sx = scratch?.getContext('2d'); if (!scratch || !sx) return 0;
    const f = 2 ** Math.max(0, Math.ceil(Math.log2(.5 / Math.max(1e-6, pxPerMetre)))), sp = 6 * f;
    const boxes = ids.map(i => bboxOf(tl.areas[i].poly)).map(b => ({ minX: Math.max(rect.minX, b.x0) - 14 * f, minY: Math.max(rect.minY, b.y0) - 14 * f, maxX: Math.min(rect.maxX, b.x1) + 14 * f, maxY: Math.min(rect.maxY, b.y1) + 14 * f }));
    const marks: Mark[] = [], i0 = Math.floor((rect.minX - 14 * f) / sp), i1 = Math.ceil((rect.maxX + 14 * f) / sp), j0 = Math.floor((rect.minY - 14 * f) / sp), j1 = Math.ceil((rect.maxY + 14 * f) / sp);
    // The same room as the 2D woods: farmsteads, roads and rivers stay clear of trunks.
    const room = roomOf();
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const hh = (salt: number): number => vhash(i, j, salt + f), x = (i + .1 + .8 * hh(1)) * sp, y = (j + .1 + .8 * hh(2)) * sp;
      if (!boxes.some(b => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY)) continue;
      if (clumpNoise(x, y, 26 * f, 5) <= .27 || !room.keeps(x, y, hh(5))) continue;
      const size01 = hh(3);
      marks.push({ x, y, r: (size01 > .94 ? 1.35 + (size01 - .94) * 4 : .72 + .55 * size01 * size01) * f, k: hh(4) });
    }
    marks.sort((a, b) => a.y - b.y || a.x - b.x);
    sx.setTransform(1, 0, 0, 1, 0, 0); sx.clearRect(0, 0, w, h); sx.setTransform(ctx.getTransform());
    canopy.draw(sx, marks, 'forest', ctx.getTransform().a, 1, coniferOf);
    // Seen whole from a distance the crowns are let down toward the dark olive of the 2D woods.
    sx.setTransform(1, 0, 0, 1, 0, 0); sx.globalCompositeOperation = 'source-atop'; sx.globalAlpha = .28; sx.fillStyle = pal.treeInk; sx.fillRect(0, 0, w, h);
    sx.globalCompositeOperation = 'source-over'; sx.globalAlpha = 1;
    // Masked by the wood (and its clearings), partly transparent: the shaded wash and the map's hill shading read through.
    let id = brushIds.get(tl); if (id === undefined) { id = ++brushId; brushIds.set(tl, id); }
    const wood = new P();
    for (const i of ids) {
      const path = cached(`brush-clip:${id}:${i}`, () => {
        const a = tl.areas[i], p = new P(); addRing(p, orientPos(a.poly));
        for (const hole of a.holes ?? []) addRing(p, orientPos(hole).slice().reverse()); return p;
      });
      if (path) wood.addPath(path);
    }
    ctx.save(); const clip = forestClip(rect); if (clip) ctx.clip(clip, 'nonzero'); ctx.clip(wood, 'nonzero');
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = .8; ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(scratch as unknown as CanvasImageSource, 0, 0); ctx.restore();
    return ids.length;
  }
  /** Conifer or broadleaf for a forest crown, from the climate and a broad mixing noise. */
  function coniferOf(m: Mark): boolean {
    const share = CONIFER_SHARE[biomeName(world.options.biome)] ?? 0;
    return share > 0 && frac(m.k * 53.3) < Math.max(0, Math.min(1, share + (clumpNoise(m.x, m.y, 420, 9) - .5) * 1.3));
  }
  /** Parchment symbol sheet tinted for one land kind, in the palette of the moment. */
  function penSheet(kind: string): ParchmentSymbols {
    const ink = mixHex(pal.inkSoft, kind === 'marsh' ? pal.reed : pal.grass, .3), wash = mixHex(pal.treeFill, pal.inkSoft, .3), key = `${ink}|${wash}`;
    let sheet = penSheets.get(key);
    if (!sheet) { sheet = new ParchmentSymbols(ink, wash, .6, makeCanvas); penSheets.set(key, sheet); }
    return sheet;
  }
  /** `area`: only the marks inside it (a layer tile and the reach of its sprites); all marks of `tiles` otherwise. */
  function drawPenSymbols(ctx: CanvasRenderingContext2D, tl: TextureLayer, tiles: number[], area?: Rect4): void {
    const sheet = penSheet(tl.kind), list = penMarkList(tl, tiles, area);
    list.sort((a, b) => a.y - b.y);
    ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.globalAlpha = .8;
    for (const m of list) sheet.draw(ctx, m.cell, m.x, m.y, m.size);
    ctx.restore();
  }
  /** Pen symbol marks of `tiles` (inside `area` when given), unsorted. */
  function penMarkList(tl: TextureLayer, tiles: number[], area?: Rect4): PenMark[] {
    const sp = tl.kind === 'pasture' ? 9 : 7.5, list: PenMark[] = [];
    for (const t of tiles) {
      const key = `${tl.kind}|${tl.areas.length}|${t}`;
      let marks = penMarks.get(key);
      if (!marks) {
        marks = [];
        for (const m of textureMarks(tl, t, sp, (TEX_SALT[tl.kind] ?? 1) + 101, world.seed)) {
          const s = penSymbol(tl.kind, m);
          if (s && (tl.kind !== 'forest' || roomOf().keeps(m.x, m.y, m.k, s.size * .4))) marks.push({ x: m.x, y: m.y, ...s });
        }
        if (penMarks.size >= 4096) penMarks.delete(penMarks.keys().next().value!);
        penMarks.set(key, marks);
      }
      for (const m of marks) if (!area || (m.x >= area.minX && m.x <= area.maxX && m.y >= area.minY && m.y <= area.maxY)) list.push(m);
    }
    return list;
  }

  /** Canopy lone trees of an open land layer (cached per index tile); `area` keeps only the marks inside it. */
  function drawStrays(ctx: CanvasRenderingContext2D, tl: TextureLayer, tiles: number[], pxPerMetre: number, area?: Rect4): void {
    const lone = strayMarkList(tl, tiles, area);
    if (!lone.length) return;
    lone.sort((a, b) => a.y - b.y || a.x - b.x);
    canopy!.draw(ctx, lone, 'forest', pxPerMetre, 1);
    ctx.globalAlpha = 1;
  }
  /** Lone-tree marks of `tiles` (inside `area` when given), unsorted. */
  function strayMarkList(tl: TextureLayer, tiles: number[], area?: Rect4): Mark[] {
    let entries = strayMarks.get(tl); if (!entries) { entries = new Map(); strayMarks.set(tl, entries); }
    const lone: Mark[] = [];
    for (const t of tiles) {
      let marks = entries.get(t);
      if (!marks) {
        marks = [];
        for (const m of textureMarks(tl, t, TEX.forest.sp, TEX_SALT.forest, world.seed)) if (m.k < forestStray(m.x, m.y) * .5) marks.push({ x: m.x, y: m.y, r: .55 + .22 * frac(m.k * 9.7), k: frac(m.k * 37.3) });
        if (entries.size >= 512) entries.delete(entries.keys().next().value!);
        entries.set(t, marks);
      }
      for (const m of marks) if (!area || (m.x >= area.minX && m.x <= area.maxX && m.y >= area.minY && m.y <= area.maxY)) lone.push(m);
    }
    return lone;
  }

  function drawTextureMarks(ctx: CanvasRenderingContext2D, tl: TextureLayer, rect: Rect4, band: number, lw: (w: number, m: number) => number, budgetRect: Rect4): number {
    if (brushes && isBrushKind(tl.kind) && tl.index.tilesInRect(budgetRect).length <= 500) {
      const k = tl.kind, sc = ctx.getTransform().a / (deps.dpr ?? 1);
      const pattern = brushes.pattern(ctx, k, sc, deps.dpr ?? 1);
      if (pattern) {
        let id = brushIds.get(tl); if (id === undefined) { id = ++brushId; brushIds.set(tl, id); }
        ctx.fillStyle = pattern;
        for (const i of tl.index.query(rect)) {
          const path = cached(`brush-clip:${id}:${i}`, () => {
            const a = tl.areas[i], p = new P(); addRing(p, orientPos(a.poly));
            for (const h of a.holes ?? []) addRing(p, orientPos(h).slice().reverse()); return p;
          });
          if (path) ctx.fill(path, 'nonzero');
        }
        return tl.index.tilesInRect(rect).length;
      }
    }
    const underground = isUnderdarkBiome(world.options.biome);
    const base = TEX[tl.kind];
    if (!base) return 0;
    const crown = !underground && pal.treeShape === 'crown' && (tl.kind === 'forest' || tl.kind === 'orchard');
    const metric = underdarkTextureSpec(tl.kind);
    const spec: TexSpec = underground ? { ...base, sp: metric.spacing, r: metric.radius, fill: ['forest', 'orchard', 'marsh', 'garden', 'field'].includes(tl.kind) ? 'treeFill' : undefined, stroke: ['forest', 'orchard', 'marsh', 'garden', 'field'].includes(tl.kind) ? 'treeInk' : 'grass' } : pal.treeShape === 'dot' && (tl.kind === 'forest' || tl.kind === 'orchard') ? { ...base, r: base.r * 0.5 } : base;
    const tiles = tl.index.tilesInRect(rect);
    if (tl.index.tilesInRect(budgetRect).length > 500) return 0;
    if (underground) {
      // New subterranean marks keep their entire silhouette out of water and reserved holes.
      let id = brushIds.get(tl); if (id === undefined) { id = ++brushId; brushIds.set(tl, id); }
      const clip = cached(`underdark-clip:${id}`, () => {
        const path = new P();
        for (const a of tl.areas) { addRing(path, orientPos(a.poly)); for (const h of a.holes ?? []) addRing(path, orientPos(h).slice().reverse()); }
        return path;
      });
      ctx.save(); if (clip) ctx.clip(clip, 'nonzero');
    }
    // Parchment draws its small symbols with the pen of the trees: thin sepia-tinted strokes that sit in the paper.
    const pen = !underground && pal.name === 'parchment';
    // Hand-drawn sheet symbols (parchmentSymbols.ts) replace the vector marks of the open land kinds.
    const sprites = pen && spec.shape !== 'circle';
    // Lone trees at the edge of the woods, drawn as canopy sprites over the open land.
    const strayKind = !underground && (tl.kind === 'commons' || tl.kind === 'pasture' || tl.kind === 'meadow');
    const spriteStrays = strayKind && !!canopy;
    if (sprites) {
      // Thousands of small stamps per view: pre-composited per density and tile like the woods (drawLayerTiles).
      // GPU engine: few enough marks are stamped directly (instanced sprites); more go through the layer tiles.
      const direct = ctx instanceof RecordingContext && penMarkList(tl, tiles).length + (spriteStrays ? strayMarkList(tl, tiles).length : 0) <= GPU_SPRITE_BUDGET;
      const painted = !direct && drawLayerTiles(ctx, tl, 'pen', rect, (target, area, pxPerMetre) => {
        const reach = growRect(area, LAYER_TILE_REACH), owners = tl.index.tilesInRect(reach);
        drawPenSymbols(target, tl, owners, reach);
        if (spriteStrays) drawStrays(target, tl, owners, pxPerMetre, reach);
      });
      if (!painted) {
        drawPenSymbols(ctx, tl, tiles);
        if (spriteStrays) drawStrays(ctx, tl, tiles, ctx.getTransform().a);
      }
    }
    const fillP: Path2D[] = [], strokeP: Path2D[] = [];
    for (const t of sprites ? [] : tiles) {
      const key = `tex-${tl.kind}|${band}|${pen ? 'pen' : 'mark'}|t${t}`;
      const p = cached(key, () => {
        const marks = textureMarks(tl, t, spec.sp, TEX_SALT[tl.kind] ?? 1, world.seed);
        if (!marks.length) return null;
        const path = new P();
        for (const m of marks) {
          if (tl.kind === 'forest' && (m.k >= forestWeight(m.x, m.y) || !roomOf().keeps(m.x, m.y, m.k, spec.r * m.r))) continue;
          const r = spec.r * m.r;
          if (underground) appendUnderdarkMark(path, tl.kind, m.x, m.y, r, pal);
          else if (pen && spec.shape !== 'circle') appendPenMark(path, spec.shape, m.x, m.y, r, m.k);
          else if (spec.shape === 'circle') {
            path.moveTo(m.x + r, m.y); path.arc(m.x, m.y, r, 0, TAU);
            if (crown) {
              // drawn crown: shadow arc on the lower right and a short trunk
              path.moveTo(m.x + r * 0.55, m.y - r * 0.5); path.arc(m.x, m.y, r * 0.78, -0.75, 2.2);
              path.moveTo(m.x, m.y + r); path.lineTo(m.x, m.y + r * 1.5);
            }
          }
          else if (spec.shape === 'dot') { path.moveTo(m.x + r, m.y); path.arc(m.x, m.y, r, 0, TAU); }
          else if (spec.shape === 'tuft') {
            path.moveTo(m.x, m.y); path.lineTo(m.x - r * 0.45, m.y - r);
            path.moveTo(m.x, m.y); path.lineTo(m.x, m.y - r * 1.1);
            path.moveTo(m.x, m.y); path.lineTo(m.x + r * 0.45, m.y - r);
          } else {
            path.moveTo(m.x - r * 0.8, m.y); path.lineTo(m.x + r * 0.8, m.y);
            path.moveTo(m.x, m.y); path.lineTo(m.x, m.y - r);
          }
        }
        return path;
      });
      if (p) { strokeP.push(p); if (spec.fill) fillP.push(p); }
    }
    const penInk = (c: string): string => pen ? mixHex(c, pal.inkSoft, .32) : c, penAlpha = pen && spec.shape !== 'circle' ? (spec.shape === 'dot' ? .78 : .62) : 1;
    if (spec.fill) {
      ctx.globalAlpha = spec.alpha * penAlpha; ctx.fillStyle = penInk(pal[spec.fill] as string);
      for (const p of fillP) ctx.fill(p, 'nonzero');
    }
    ctx.globalAlpha = spec.alpha * penAlpha; ctx.strokeStyle = penInk(pal[spec.stroke] as string);
    ctx.lineWidth = pen && spec.shape !== 'circle' ? lw(spec.shape === 'dot' ? .3 : .42, .5) : lw(spec.shape === 'circle' ? 0.5 : 0.55, 0.6);
    if (pen) { ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; }
    for (const p of strokeP) ctx.stroke(p);
    if (pen) ctx.restore();
    if (strayKind) {
      const tree = TEX.forest, strays: Path2D[] = [];
      if (canopy) {
        if (!sprites) drawStrays(ctx, tl, tiles, ctx.getTransform().a);
      } else for (const t of tiles) {
        const p = cached(`stray-${tl.kind}|t${t}`, () => {
          const marks = textureMarks(tl, t, tree.sp, TEX_SALT.forest, world.seed);
          if (!marks.length) return null;
          const path = new P();
          for (const m of marks) if (m.k < forestStray(m.x, m.y)) { const r = tree.r * m.r; path.moveTo(m.x + r, m.y); path.arc(m.x, m.y, r, 0, TAU); }
          return path;
        });
        if (p) strays.push(p);
      }
      ctx.globalAlpha = tree.alpha; ctx.fillStyle = pal[tree.fill!] as string;
      for (const p of strays) ctx.fill(p, 'nonzero');  // empty when the canopy drew them
      ctx.strokeStyle = pal[tree.stroke] as string; ctx.lineWidth = lw(.5, .6);
      for (const p of strays) ctx.stroke(p);
    }
    ctx.globalAlpha = 1;
    if (underground) ctx.restore();
    return tiles.length;
  }

  function drawMinimap(target: CanvasLike, view: View, viewW: number, viewH: number, withRect = true): void {
    const ctx = target.getContext('2d');
    if (!ctx) return;
    const k = target.width / S;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = pal.paper;
    ctx.fillRect(0, 0, target.width, target.height);
    const tex = getTerrain();
    if (tex) ctx.drawImage(tex, 0, 0, target.width, target.width);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const waterImage = getWater();
    const water = (name: string, fill: string, rule: CanvasFillRule = 'nonzero'): void => {
      const l = polyL(name);
      if (!l) return;
      ctx.fillStyle = fill;
      const paint = (path: Path2D): void => {
        if (waterImage && name !== 'rivers') { ctx.save(); ctx.clip(path, rule); ctx.drawImage(waterImage, 0, 0, S, S); ctx.restore(); }
        else ctx.fill(path, rule);
      };
      for (const t of l.index.tilesInRect({ minX: 0, minY: 0, maxX: S, maxY: S })) {
        const p = cached(`${l.name}|0|t${t}`, () => polyPath(P, l, l.index.itemsOf(t), BAND_MIN_EDGE[0]));
        if (p) paint(p);
      }
      for (const i of l.index.big) {
        const p = cached(`${l.name}|0|b${i}`, () => polyPath(P, l, [i], BAND_MIN_EDGE[0]));
        if (p) paint(p);
      }
    };
    water('sea', pal.seaFill, 'evenodd'); water('lakes', pal.lakeFill); water('rivers', pal.riverFill);
    const d = getDensity();
    if (d) ctx.drawImage(d, 0, 0, S, S);
    if ((deps.mask?.landuse !== undefined ? deps.mask.landuse !== false : world.options.landuse) && world.options.biome === 'underdark-caverns' && world.terrain.caverns?.fungalRooms?.length) {
      const rooms = exactCavernPath('fungalRooms');
      if (rooms) { ctx.globalAlpha = pal.landOpacity; ctx.fillStyle = pal.land.garden; ctx.fill(rooms, 'nonzero'); ctx.globalAlpha = 1; }
    }
    if (world.terrain.caverns) {
      const solid = exactCavernPath('solid');
      ctx.fillStyle = cavernWallFill(pal); if (solid) ctx.fill(solid, 'nonzero');
      if (solid) {
        ctx.save(); ctx.clip(solid, 'nonzero');
        const rock = getCavernRock(); if (rock) ctx.drawImage(rock, 0, 0, S, S);
        ctx.restore();
      }
    }
    if (withRect) {
      const r = viewRect(view, viewW, viewH, 0);
      ctx.strokeStyle = pal.marker; ctx.lineWidth = 1.5 / k;
      ctx.strokeRect(r.minX, r.minY, r.maxX - r.minX, r.maxY - r.minY);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  return {
    get scene() { return scene; }, palette: pal,
    draw, drawText, drawGround, drawCachedMap, update, suspendLive,
    setLabels(l: Label[]) { labels = l; },
    setOverlays(o: Partial<Overlays>) { if (o.text && JSON.stringify(o.text) !== JSON.stringify(text)) { text = o.text; mapLabels = buildMapLabels(world, pal.name, pal, text); widthCache.clear(); } Object.assign(overlays, o); },
    lastPlaced: () => placedLast,
    drawMinimap,
    lastStats: () => stats,
    liveRetained: () => !!retained && getVectorEngine() === 'gpu',
    retainedBytes: () => rasterCache.bytes + layerTiles.bytes + (brushes?.cachedBytes ?? 0)
      + (canopy ? 48 * 1024 * 1024 : 0) + cache.size * 1024 + furrowCache.size * 2048
      + (lastRaster ? lastRaster.canvas.width * lastRaster.canvas.height * 4 : 0)
      + (preview ? preview.canvas.width * preview.canvas.height * 4 : 0)
      + scene.textures.reduce((n, layer) => n + layer.areas.reduce((s, a) => s + a.poly.length * 16, 0), 0),
    getMapInfo: () => ({ cartouche: infoPanel ??= cartoucheModel(world, pal, 1, false), legend: legendNow(), fontFamily: family }),
    dispose() { disposed = true; clearTimeout(retainedJob); retainedJob = undefined; retained = retainedPending = undefined; suspendLive(); dropLastRaster(); dropPreview(); canopy?.dispose(); brushes?.dispose(); treeMarks.clear(); treeSprites.clear(); strayMarks.clear(); layerTiles.clear(); forestWashes.clear(); patterns.clear(); cache.clear(); furrowCache.clear(); rasterCache.clear(); mapPyramid.clear(); terrainImg = waterImg = densityImg = cavernRockImg = undefined; },
  };
}

void estimateWidth;

function drawTownBridge(ctx: CanvasRenderingContext2D, sh: BridgeShapes, pal: Palette, sc: number): void {
  const poly = (pts: Vec2[]): void => { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); };
  ctx.lineCap = 'butt';
  if (sh.deck) { poly(sh.deck); ctx.closePath(); ctx.fillStyle = pal.bridgeDeck; ctx.globalAlpha = sh.deckAlpha; ctx.fill(); ctx.globalAlpha = 1; }
  if (sh.seams && sc > 2) {
    poly(sh.seams.pts); ctx.strokeStyle = pal.bridgeInk; ctx.globalAlpha = 0.45; ctx.lineWidth = sh.seams.w; ctx.setLineDash(sh.seams.dash); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = pal.bridgeInk;
  for (const l of sh.lines) { poly(l.pts); ctx.lineWidth = Math.max(l.w, 0.8 / sc); ctx.stroke(); }
  if (sh.stones.length) {
    ctx.fillStyle = pal.bridgeDeck; ctx.lineWidth = Math.max(0.15, 0.6 / sc);
    for (const st of sh.stones) { ctx.beginPath(); ctx.arc(st.c.x, st.c.y, Math.max(st.r, 0.8 / sc), 0, TAU); ctx.fill(); ctx.stroke(); }
  }
  ctx.lineCap = 'round';
}

function drawBridges(ctx: CanvasRenderingContext2D, world: World, pal: Palette, rect: Rect4, sc: number): void {
  for (const b of world.bridges ?? []) {
    if (Math.max(b.a.x, b.b.x) < rect.minX || Math.min(b.a.x, b.b.x) > rect.maxX || Math.max(b.a.y, b.b.y) < rect.minY || Math.min(b.a.y, b.b.y) > rect.maxY) continue;
    // small town bridges (footbridges, arches, fords) at true size, by kind
    if (isKinded(b)) { drawTownBridge(ctx, bridgeShapes(b), pal, sc); continue; }
    const dx = b.b.x - b.a.x, dy = b.b.y - b.a.y, l = Math.hypot(dx, dy) || 1;
    const bridge = regionalBridgeSurface(b.width, sc);
    const tx = dx / l, ty = dy / l, nx = -ty, ny = tx, pad = bridge.pad;
    const h = bridge.deck / 2;
    const ax = b.a.x - tx * pad, ay = b.a.y - ty * pad, bx = b.b.x + tx * pad, by = b.b.y + ty * pad;
    ctx.beginPath();
    ctx.moveTo(ax + nx * h, ay + ny * h); ctx.lineTo(bx + nx * h, by + ny * h);
    ctx.lineTo(bx - nx * h, by - ny * h); ctx.lineTo(ax - nx * h, ay - ny * h); ctx.closePath();
    ctx.fillStyle = pal.bridgeDeck; ctx.fill();
    ctx.strokeStyle = pal.bridgeInk; ctx.lineCap = 'butt'; ctx.lineWidth = bridge.rail;
    ctx.beginPath();
    ctx.moveTo(ax + nx * h, ay + ny * h); ctx.lineTo(bx + nx * h, by + ny * h);
    ctx.moveTo(ax - nx * h, ay - ny * h); ctx.lineTo(bx - nx * h, by - ny * h);
    ctx.stroke(); ctx.lineCap = 'round';
  }
}

/** The site marker is a screen-size symbol: constant pixels at any zoom (never metres that grow with the map). */
function drawSiteMarker(ctx: CanvasRenderingContext2D, world: World, pal: Palette, sc: number, labels: boolean): void {
  const c = world.site!.center, px = (v: number): number => v / sc;
  ctx.setLineDash([px(7), px(4.5)]);
  ctx.strokeStyle = pal.ink; ctx.globalAlpha = 0.7; ctx.lineWidth = px(1.2);
  for (const poly of world.landuse?.reserve ?? []) {
    if (poly.length < 3) continue;
    ctx.beginPath(); ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.closePath(); ctx.stroke();
  }
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  if (!labels) return;
  const r = px(7);
  ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, TAU);
  ctx.strokeStyle = pal.ink; ctx.lineWidth = px(1.3); ctx.stroke();
  ctx.beginPath(); ctx.arc(c.x, c.y, r * 0.38, 0, TAU); ctx.fillStyle = pal.ink; ctx.fill();
}

export type { LandKind };
