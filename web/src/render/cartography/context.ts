/**
 * The state one cartography renderer shares between its modules (render/canvas.ts assembles them): the displayed world
 * and its scene, the palette, the draw mode of the moment, and the caches every layer reads (paths per index tile,
 * patterns, bitmaps of the terrain, water, density and cave rock, forest washes, woods and symbol marks).
 *
 * Each module says in its header what it reads and writes here. The helpers are arrow properties, so a module can take them out of the object (`const { polyL, cached } = c`).
 * Written by: render/canvas.ts (`update`, `dispose`), the exact tiles (`stepwise`, `activeLight`, `activeDpr`,
 * `rasterFailed`), drawVector (`recordingNow`, `layerTilesFit`, `stats`), the live host (`markCrisp`).
 */
import { CanvasCanopy } from '../canopy';
import { CanvasBrushes } from '../brushCanvas';
import { brushColorMatrix, supportsPaintedBiome } from '../brushes';
import { cavernDisplayWorld } from '../cavernDisplay';
import { cavernRockPixels } from '../caverns';
import { isUnderdarkBiome } from '../../gen/biomes';
import { orientPos } from '../../gen/geo/poly';
import { furrowLines } from '../furrows';
import { renderView } from '../../gen/settlements/merge';
import { biomePalette } from '../biomes';
import { SeasonColorTable, seasonSource, mapLandSeasonRevision, type SeasonInk } from '../seasonPalette';
import { applyRenderColors } from '../customColors';
import { renderTerrainPixels } from '../raster';
import { worldWaterPixels } from '../terrainWater';
import { buildScene, type Scene, type PolyLayer, type LineLayer, type TextureLayer, type Mark } from '../scene';
import { FURROW_HOLDER_BUDGET } from '../lod';
import { legendModel, type Panel } from '../legend';
import { FONT_STACKS } from '../labelStyles';
import { RecOnlyPath2D, RecPath2D } from '../gpu/path';
import { RecordingContext } from '../gpu/recorder';
import type { LandTint } from '../gpu/contract';
import { noteLiveUnit } from '../live/liveStats';
import type { World } from '../../gen/types';
import type { Palette, MapStyle } from '../styles';
import type { Rect4, View } from '../view';
import type { Label } from '../labels';
import { RasterTileCache } from '../rasterTiles';
import { LAYER_TILE_BYTES } from './woods';
import { LayerTileCache } from './penTiles';
import type { ParchmentSymbols } from '../parchmentSymbols';
import type { ForestRoom } from '../forestRoom';
import { addRing, polyPath } from './geometry';
import type { CanvasLike, CanvasRendererDeps, FrameStats, LandBackdrop, Overlays } from './contract';
import type { ForestWash } from './forest';
import type { PenMark } from './symbols';

/** Paths kept per (layer, LOD band, index tile) before the oldest quarter is dropped. */
const CACHE_MAX = 8000;
const PATTERN_PIXELS_PER_METRE = 14;
type PatternTile = { source: CanvasImageSource; pattern?: CanvasPattern | null };
const FURROW_CACHE_MAX = FURROW_HOLDER_BUDGET * 2;
/** Terrain bitmaps shared by every renderer of one terrain and palette (the default hillshade only). */
const TERRAIN_IMAGES = new WeakMap<World['terrain'], WeakMap<Palette, { mapSize: number; image: CanvasImageSource }>>();

const paletteIds = new WeakMap<Palette, number>();
let paletteCount = 0;
const paletteIdOf = (pal: Palette): number => {
  let id = paletteIds.get(pal);
  if (id === undefined) paletteIds.set(pal, (id = ++paletteCount));
  return id;
};
/** A holder's outline (with its holes), its strips, and the Canvas plough lines (built on the first Canvas paint only:
 * the GPU recording fills the strips with world stripes instead). */
type FurrowPaths = { holder: Path2D; strips: Path2D; lines?: Path2D };
export type DrawMode = 'all' | 'map' | 'overlays' | 'ground';

export const emptyStats = (): FrameStats => ({ band: 0, scale: 0, ms: 0, tilesDrawn: 0, bigDrawn: 0, pathsBuilt: 0, pathCache: 0, buildingsCandidate: 0, buildingsDrawn: false, textureTiles: 0 });

function defaultCreateCanvas(w: number, h: number): CanvasLike | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h) as unknown as CanvasLike;
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return null;
}

export class CartographyContext {
  basePalette: Palette;
  pal: Palette;
  private inks: SeasonColorTable;
  readonly ink = (name: SeasonInk) => this.inks.ink(name);
  /** Identity of the palette used to validate finished pixels. */
  paletteId: number;
  /** Stable for a seasonal change. Explicit changes to custom colours or symbol settings start a new look. */
  lookId: number;
  private lastPalette = -1;
  private lastLandSeason = -1;
  private paintVersion = 0;
  readonly paintRevision = (): number => {
    const season = this.deps.terrain ? mapLandSeasonRevision() : 0;
    if (this.lastPalette !== this.paletteId || (this.backdrop && this.lastLandSeason !== season)) {
      this.lastPalette = this.paletteId;
      this.paintVersion++;
    }
    this.lastLandSeason = season;
    return this.paintVersion;
  };
  /** Side of the map square (m). */
  readonly S: number;
  /** Same unit as svg.ts, used for a few decorative widths. */
  readonly u: number;
  readonly furrowSize: number;
  readonly now: () => number;
  readonly P: new () => Path2D;
  /** Polygon paths built for a GPU recording only (their cache keys never meet the Canvas ones): no native path. */
  readonly recordedP: new () => Path2D;
  readonly makeCanvas: (w: number, h: number) => CanvasLike | null;
  canopy: CanvasCanopy | undefined;
  brushes: CanvasBrushes | undefined;
  get family(): string {
    return FONT_STACKS[this.pal.name] ?? this.pal.fontFamily;
  }
  readonly overlays: Overlays;

  sourceWorld: World;
  world: World;
  scene: Scene;
  stats: FrameStats = emptyStats();
  /** Paths built since the renderer started (FrameStats.pathsBuilt is a difference of it). */
  built = 0;
  /** The draw in progress: a stepwise one (one step of a paint spread over frames: small sprite tiles, the quality
   * policy), its quality tier, its pixel ratio when it is not the renderer's (a band recorded for the compositor, the
   * furniture of another canvas). */
  stepwise = false;
  activeLight = false;
  activeDpr: number | undefined;
  /** True while drawVector records for the GPU engine (set at each drawVector entry). */
  recordingNow = false;
  /** Drape paths are clipped outside the recorded band and its paint reach before construction. */
  recordingClip: Rect4 | undefined;
  /** Set while a band is recorded for the live overlay layer: drawVector then marks where its soft area prefix ends
   * (CRISP_MARK). Every other recording (tiles, captures, drape) is left as it was. */
  markCrisp = false;
  /** False when the sprite-layer tiles of the whole view would not fit the cache together (they would evict each other). */
  layerTilesFit = true;
  /** The raster tile path failed once: every later frame draws the vector map directly. */
  rasterFailed = false;
  disposed = false;

  readonly cache = new Map<string, Path2D | null>();
  readonly furrowCache = new Map<number, FurrowPaths>();
  readonly patterns = new Map<string, PatternTile | null>();
  readonly patternInks = new WeakMap<CanvasImageSource, { ink: SeasonInk; css: string; bytes: number; rebind: () => CanvasImageSource | undefined }>();
  /** Land = the map minus the sea and lakes (landClip); undefined: not built yet. */
  landPath: Path2D | null | undefined;
  terrainImg: CanvasImageSource | null | undefined;
  private backdrop?: LandBackdrop;
  get hasLandBackdrop(): boolean {
    return !!this.backdrop;
  }
  readonly landUniforms = (): LandTint | undefined => this.backdrop?.uniforms();
  waterImg: CanvasImageSource | null | undefined;
  cavernRockImg: CanvasImageSource | null | undefined;
  densityImg: CanvasImageSource | null | undefined;
  litCache: Float32Array | undefined;
  forestRoom: ForestRoom | undefined;
  readonly forestWashes = new Map<string, ForestWash>();
  readonly treeMarks = new Map<TextureLayer, Map<number, Mark[]>>();
  /** GPU recording: canopy sprite data per index tile and atlas resolution (woods.ts recordTreeSprites). */
  readonly treeSprites = new Map<TextureLayer, Map<string, { data: Float32Array; marks: Mark[] }>>();
  readonly penMarks = new Map<string, PenMark[]>();
  readonly penBlocks = new RasterTileCache<{ instances: Float32Array; clip: Path2D } | null>(24 * 1024 * 1024);
  penMask?: ParchmentSymbols;
  penCoverage?: ParchmentSymbols;
  readonly penSheets = new Map<string, ParchmentSymbols>();
  /** Lone trees stepping out of the woods, per open land layer and index tile. */
  readonly strayMarks = new Map<TextureLayer, Map<number, Mark[]>>();
  /** Pre-composited sprite layers (woods.ts drawLayerTiles); null marks a tile with nothing to draw. */
  readonly layerTiles = new LayerTileCache(LAYER_TILE_BYTES, pigment => [this.ink(pigment), this.ink('sheetWash')]);
  layerTilesFailed = false;
  /** Layer tile canvases drawn into a GPU recording: a recorded list may replay them after their eviction. */
  readonly recordedTiles = new WeakSet<object>();
  /** Per-call scratch canvases of a recorded 3D drape tile, released once the tile is rasterised. */
  readonly drapeTemps: CanvasLike[] = [];
  canopyScratch: CanvasLike | undefined;
  /** Labels given by the host (setLabels), drawn with the furniture. */
  labels: Label[] = [];
  /** Draws the names on a frame that has its furniture (the names module of the renderer). */
  drawNames: (ctx: CanvasRenderingContext2D, view: View, cssW: number, cssH: number) => void = () => {};
  private readonly brushIds = new WeakMap<TextureLayer, number>();
  private brushId = 0;
  private legendPanel: Panel | null = null;
  private legendKey = '';
  infoPanel: Panel | null = null;

  constructor(
    readonly canvas: CanvasLike,
    world0: World,
    readonly style: MapStyle | Palette,
    readonly deps: CanvasRendererDeps,
  ) {
    this.sourceWorld = world0;
    const world = (this.world = cavernDisplayWorld(deps.scene?.renderedWorld ? { ...deps.scene.renderedWorld, options: world0.options, names: world0.names } : renderView(cavernDisplayWorld(world0))));
    this.basePalette = deps.palette?.() ?? biomePalette(style, world.options.biome);
    this.lookId = ++paletteCount;
    const pal = (this.pal = applyRenderColors(this.basePalette, deps.colors));
    this.paletteId = paletteIdOf(pal);
    this.inks = new SeasonColorTable(pal);
    this.scene = deps.scene ?? buildScene(world0, deps.tileSize, { mask: deps.mask });
    this.S = world.mapSize;
    this.u = this.S / 1600;
    this.furrowSize = deps.furrowReferenceSize ?? this.S;
    this.now = deps.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.P = deps.Path2D ?? RecPath2D;
    this.recordedP = this.P === RecPath2D ? RecOnlyPath2D : this.P;
    this.makeCanvas = deps.createCanvas ?? defaultCreateCanvas;
    this.tintStamps();
    this.overlays = { labels: world.options.labels !== false, legend: !!world.options.legend, cartouche: true };
  }

  private canopyKey = '';
  private brushSource?: CanvasRendererDeps['brushes'];
  private brushTint = '';
  /** Only the pigments used by the canopy or brush atlas invalidate its pixels. */
  private tintStamps(): void {
    const { deps, world, pal } = this;
    const canopy = deps.vegetation === 'canopy' && !isUnderdarkBiome(world.options.biome);
    const key = canopy ? JSON.stringify([pal.name, pal.treeFill, pal.treeInk, pal.ink, pal.paper, pal.season]) : '';
    if (this.canopyKey !== key) {
      this.canopyKey = key;
      this.canopy?.dispose();
      this.canopy = canopy ? new CanvasCanopy(world.seed, pal, this.makeCanvas) : undefined;
    }
    const source = supportsPaintedBiome(world.options.biome) ? deps.brushes : undefined;
    const tint = source ? JSON.stringify(brushColorMatrix(pal)) : '';
    if (this.brushSource === source && this.brushTint === tint) return;
    this.brushSource = source;
    this.brushTint = tint;
    this.brushes?.dispose();
    this.brushes = undefined;
    if (source) {
      try {
        this.brushes = new CanvasBrushes(world, pal, source, this.makeCanvas);
      } catch {
        /* Vector symbols when allocations/tinting are unavailable. */
      }
    }
  }
  /** Takes the palette of the moment (CanvasRendererDeps.palette) at the start of a paint or of a key, and returns its
   * id. Another season only drops what holds colours; the scene, the paths, the marks and the washes are kept. */
  readonly syncPalette = (changedLook = false): number => {
    const next = this.deps.palette?.();
    if (next && (next !== this.basePalette || changedLook)) {
      const densityInk = this.densityImg && this.ink('densityInk').css;
      const sameSource = seasonSource(next) === seasonSource(this.basePalette);
      if (!sameSource || changedLook) {
        this.lookId = ++paletteCount;
        this.treeSprites.clear();
      }
      this.basePalette = next;
      this.pal = applyRenderColors(next, this.deps.colors);
      this.paletteId = paletteIdOf(this.pal);
      // Old live suffixes can still draw above their old baked prefixes while the replacement is prepared.
      // Keep those slots pinned to this date. Retained land recordings own their mutable table.
      this.inks = new SeasonColorTable(this.pal);
      this.tintStamps();
      if (sameSource && !changedLook) this.layerTiles.changePalette();
      else this.layerTiles.clear();
      this.penSheets.clear();
      this.patterns.clear();
      if (changedLook || !sameSource || !this.backdrop) this.terrainImg = undefined;
      this.waterImg = undefined;
      if (changedLook || !sameSource) this.cavernRockImg = undefined;
      if ((densityInk && this.ink('densityInk').css !== densityInk) || (this.densityImg === null && (changedLook || !sameSource))) this.densityImg = undefined;
      this.dropPanels();
    }
    return this.paletteId;
  };

  /** The pixel ratio of the draw in progress. */
  readonly dpr = (): number => this.activeDpr ?? this.deps.dpr ?? (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1;
  readonly polyL = (n: string): PolyLayer | undefined => this.scene.poly.get(n);
  readonly linesOf = (pred: (l: LineLayer) => boolean): LineLayer[] => this.scene.lines.filter(pred);
  /** A stable id per texture layer (keys of the layer tiles and the brush clips); kept across local scene updates. */
  readonly brushIdOf = (tl: TextureLayer): number => {
    let id = this.brushIds.get(tl);
    if (id === undefined) {
      id = ++this.brushId;
      this.brushIds.set(tl, id);
    }
    return id;
  };
  /** A local scene update replaces the texture layers: they keep the ids (and the layer tiles) of the ones they replace. */
  readonly carryBrushIds = (next: Scene): void => {
    for (const tl of next.textures) {
      const old = this.scene.textures.find(o => o.kind === tl.kind),
        id = old && this.brushIds.get(old);
      if (id !== undefined) this.brushIds.set(tl, id);
    }
  };

  /**
   * Land = the map minus the sea and lakes (evenodd): roads, tracks and street strokes are clipped to it, so a stroke
   * widened to its minimum on-screen width never spills over the water (bridges are drawn afterwards, unclipped).
   */
  readonly landClip = (): Path2D | null => {
    if (this.landPath !== undefined) return this.landPath;
    const ls = ['sea', 'lakes'].map(n => this.scene.poly.get(n)).filter((l): l is PolyLayer => !!l);
    if (!ls.length) return (this.landPath = null);
    const S = this.S,
      p = new this.P();
    const m = 50;
    p.moveTo(-m, -m);
    p.lineTo(S + m, -m);
    p.lineTo(S + m, S + m);
    p.lineTo(-m, S + m);
    p.closePath();
    for (const l of ls)
      for (let i = 0; i < l.polys.length; i++) {
        for (const r of [l.polys[i], ...(l.holes?.[i] ?? [])]) {
          if (r.length < 3) continue;
          p.moveTo(r[0].x, r[0].y);
          for (let k = 1; k < r.length; k++) p.lineTo(r[k].x, r[k].y);
          p.closePath();
        }
      }
    return (this.landPath = p);
  };

  readonly cached = (key: string, make: () => Path2D | null): Path2D | null => {
    const cache = this.cache;
    let p = cache.get(key);
    if (p === undefined) {
      p = make();
      this.built++;
      cache.set(key, p);
      if (cache.size > CACHE_MAX) {
        let drop = CACHE_MAX >> 2;
        for (const k of cache.keys()) {
          cache.delete(k);
          if (--drop <= 0) break;
        }
      }
    }
    cache.delete(key);
    cache.set(key, p);
    return p;
  };

  /** Diagnostics: a drawVector section recorded for the GPU that held the main thread too long goes to the journal (`record:*`). */
  readonly timedRec = <T>(name: string, f: () => T): T => {
    if (!this.recordingNow) return f();
    const t = this.now();
    try {
      return f();
    } finally {
      noteLiveUnit('record:' + name, t);
    }
  };

  /** A clip contains only candidate tiles in this view, and remains exact (no LOD decimation). */
  readonly visibleClip = (l: PolyLayer, rect: Rect4): Path2D | null => {
    const tiles = l.index.tilesInRect(rect),
      big = l.index.bigInRect(rect);
    const stamp = tiles.map(t => `${t}:${l.tileKeys?.[t] ?? ''}`).join(';') + '|' + big.map(i => `${i}:${l.bigKeys?.[Array.prototype.indexOf.call(l.index.big, i)] ?? ''}`).join(';');
    const recording = this.recordingNow;
    const clipTo = recording ? this.recordingClip : rect;
    return this.cached(`${l.name}|clip|${recording ? 'gpu|' : ''}${clipTo ? `${clipTo.minX},${clipTo.minY},${clipTo.maxX},${clipTo.maxY}` : ''}|${stamp}`, () => {
      const ids: number[] = [];
      for (const t of tiles) for (const i of l.index.itemsOf(t)) ids.push(i);
      ids.push(...big);
      return polyPath(recording ? this.recordedP : this.P, l, ids, 0, clipTo);
    });
  };

  /** How far beyond its geometry a layer may paint (widest line, shadow offset, a screen margin). */
  readonly paintMargin = (scale: number, input: Scene = this.scene): number => {
    const pal = this.pal;
    let width = 10 * this.u;
    for (const l of input.lines) width = Math.max(width, l.width * (l.role === 'wall' ? pal.urban.wallScale : 1));
    const sh = pal.urban.shadow;
    return width + (sh ? Math.max(Math.abs(sh.dx), Math.abs(sh.dy)) : 2) + 32 / scale;
  };

  /** One bounded LRU record per holder, so plough textures never evict paths used by other map layers. */
  readonly furrowPaths = (i: number, withLines = false): FurrowPaths => {
    const furrowCache = this.furrowCache;
    let paths = furrowCache.get(i);
    if (paths) {
      furrowCache.delete(i);
      furrowCache.set(i, paths);
    } else {
      const a = this.scene.furrows!.areas[i],
        holder = new this.P(),
        strips = new this.P();
      addRing(holder, orientPos(a.poly));
      for (const hole of a.holes ?? []) addRing(holder, orientPos(hole).slice().reverse());
      for (const strip of a.strips) addRing(strips, orientPos(strip));
      paths = { holder, strips };
      this.built += 2;
      furrowCache.set(i, paths);
      if (furrowCache.size > FURROW_CACHE_MAX) {
        const oldest = furrowCache.keys().next().value;
        if (oldest !== undefined) furrowCache.delete(oldest);
      }
    }
    if (withLines && !paths.lines) {
      const a = this.scene.furrows!.areas[i],
        lines = (paths.lines = new this.P());
      for (const line of furrowLines(a.poly, this.furrowSize, a.angle)) {
        lines.moveTo(line[0].x, line[0].y);
        lines.lineTo(line[1].x, line[1].y);
      }
      this.built++;
    }
    return paths;
  };

  /** The outlines of the cave floor, rock or fungal rooms, exact (no decimation). */
  readonly exactCavernPath = (which: 'floor' | 'solid' | 'fungalRooms'): Path2D | null => {
    const caverns = this.world.terrain.caverns;
    if (!caverns) return null;
    return this.cached(`cavern-${which}-exact`, () => {
      const p = new this.P();
      for (const f of caverns[which] ?? []) {
        addRing(p, orientPos(f.outer));
        for (const h of f.holes) addRing(p, orientPos(h).slice().reverse());
      }
      return p;
    });
  };

  /** The legend with the semantic classes currently shown; rebuilt only when they change. */
  readonly legendNow = (): Panel => {
    const extra = this.deps.semantic?.legend?.() ?? [],
      key = extra.map(e => `${e.label}|${e.color}|${e.look}`).join(';');
    if (!this.legendPanel || key !== this.legendKey) {
      this.legendPanel = legendModel(this.world, this.pal, extra);
      this.legendKey = key;
    }
    return this.legendPanel;
  };
  /** Forgets the legend and cartouche models (a new world). */
  readonly dropPanels = (): void => {
    this.legendPanel = this.infoPanel = null;
  };

  // ---- offscreen bitmaps -------------------------------------------------------------
  private toBitmap(rgba: Uint8ClampedArray, w: number, h: number): CanvasImageSource | null {
    const c = this.makeCanvas(w, h);
    const cx = c?.getContext('2d');
    if (!c || !cx || typeof ImageData === 'undefined') return null;
    cx.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer), w, h), 0, 0);
    return c as unknown as CanvasImageSource;
  }
  readonly getCavernRock = (): CanvasImageSource | null => {
    if (this.cavernRockImg !== undefined) return this.cavernRockImg;
    this.cavernRockImg = null;
    if (typeof ImageData === 'undefined') return null;
    const r = cavernRockPixels(this.world.seed, this.S, this.pal);
    return (this.cavernRockImg = this.toBitmap(r.rgba, r.width, r.width));
  };
  readonly getWater = (): CanvasImageSource | null => {
    if (this.waterImg !== undefined) return this.waterImg;
    const material = worldWaterPixels(this.world, this.pal),
      rgba = new Uint8ClampedArray(material.n * material.n * 4);
    for (let i = 0; i < material.n * material.n; i++) {
      rgba.set(material.rgb.subarray(i * 3, i * 3 + 3), i * 4);
      rgba[i * 4 + 3] = 255;
    }
    return (this.waterImg = this.toBitmap(rgba, material.n, material.n));
  };
  readonly getTerrain = (): CanvasImageSource | null => {
    if (this.terrainImg !== undefined) return this.terrainImg;
    const { deps, world, pal } = this;
    this.backdrop = undefined;
    try {
      if (deps.terrain) {
        const terrain = deps.terrain(world, pal);
        this.backdrop = terrain && 'summer' in terrain ? terrain : undefined;
        this.terrainImg = terrain && 'summer' in terrain ? terrain.summer : terrain;
      } else {
        const shared = !deps.createCanvas && TERRAIN_IMAGES.get(world.terrain)?.get(pal);
        if (shared && shared.mapSize === world.mapSize) return (this.terrainImg = shared.image);
        const r = renderTerrainPixels(world, pal);
        if (r.rgb) {
          const rgba = new Uint8ClampedArray(r.w * r.h * 4);
          for (let i = 0, j = 0; i < r.w * r.h; i++, j += 4) {
            rgba[j] = r.rgb[i * 3];
            rgba[j + 1] = r.rgb[i * 3 + 1];
            rgba[j + 2] = r.rgb[i * 3 + 2];
            rgba[j + 3] = 255;
          }
          const image = (this.terrainImg = this.toBitmap(rgba, r.w, r.h));
          if (image && !deps.createCanvas) {
            const palettes = TERRAIN_IMAGES.get(world.terrain) ?? new WeakMap<Palette, { mapSize: number; image: CanvasImageSource }>();
            palettes.set(pal, { mapSize: world.mapSize, image });
            TERRAIN_IMAGES.set(world.terrain, palettes);
          }
        } else this.terrainImg = null;
      }
    } catch {
      this.terrainImg = null;
    }
    return this.terrainImg;
  };
  readonly drawTerrain = (ctx: CanvasRenderingContext2D, tex: CanvasImageSource, ...rect: [number, number, number, number] | [number, number, number, number, number, number, number, number]): void => {
    const backdrop = this.backdrop;
    if (backdrop && ctx instanceof RecordingContext) {
      const source: [number, number, number, number, number, number, number, number] = rect.length === 4 ? [0, 0, backdrop.summer.width, backdrop.summer.height, ...rect] : rect;
      ctx.drawLandImage(tex, backdrop.uniforms(), ...source);
    } else {
      const image = backdrop ? backdrop.canvas() : tex;
      if (rect.length === 4) ctx.drawImage(image, ...rect);
      else ctx.drawImage(image, ...rect);
    }
  };
  /** Tiling pattern (tile of `tw` x `th` meters drawn at 14 px/m, rotated `rot` degrees); null where canvases/DOMMatrix are unavailable (Node). */
  readonly getPattern = (ctx: CanvasRenderingContext2D, key: string, tw: number, th: number, rot: number, draw: (c: CanvasRenderingContext2D, k: number) => void, ink?: SeasonInk): CanvasPattern | null => {
    // A pattern made by a native context never goes to the recorder, nor the reverse: one cache per engine.
    key = (ctx instanceof RecordingContext ? 'rec|' : 'cpu|') + key;
    const tile = this.patternTile(key, tw, th, draw, ink);
    if (!tile) return null;
    if (tile.pattern !== undefined) return tile.pattern;
    try {
      const pattern = ctx.createPattern(tile.source, 'repeat');
      pattern?.setTransform(new DOMMatrix().rotate(rot).scale(1 / PATTERN_PIXELS_PER_METRE));
      return (tile.pattern = pattern);
    } catch {
      return (tile.pattern = null);
    }
  };

  /** A named single-ink tile uses the same Canvas painter on replay, including its original coverage and alpha. */
  private patternTile(key: string, tw: number, th: number, draw: (c: CanvasRenderingContext2D, k: number) => void, ink?: SeasonInk) {
    const held = this.patterns.get(key);
    if (held !== undefined) return held;
    let tile: PatternTile | null = null;
    try {
      const k = PATTERN_PIXELS_PER_METRE;
      const c = this.makeCanvas(Math.ceil(tw * k), Math.ceil(th * k));
      const cx = c?.getContext('2d');
      if (c && cx && typeof DOMMatrix !== 'undefined') {
        cx.lineCap = 'round';
        const css = ink && this.ink(ink).css;
        if (css) cx.strokeStyle = cx.fillStyle = css;
        draw(cx, k);
        tile = { source: c as unknown as CanvasImageSource };
        if (ink && css) this.patternInks.set(tile.source, { ink, css, bytes: 4 * c.width * c.height, rebind: (): CanvasImageSource | undefined => this.patternTile(key, tw, th, draw, ink)?.source });
      }
    } catch {
      tile = null;
    }
    this.patterns.set(key, tile);
    return tile;
  }
  readonly getDensity = (): CanvasImageSource | null => {
    if (this.densityImg !== undefined) return this.densityImg;
    this.densityImg = null;
    const d = this.scene.density;
    if (!d) return null;
    const v = parseInt(this.ink('densityInk').css.slice(1), 16);
    const rgba = new Uint8ClampedArray(d.w * d.h * 4);
    for (let i = 0; i < d.cov.length; i++) {
      const c = d.cov[i];
      rgba[i * 4] = (v >> 16) & 255;
      rgba[i * 4 + 1] = (v >> 8) & 255;
      rgba[i * 4 + 2] = v & 255;
      rgba[i * 4 + 3] = Math.round(255 * Math.min(0.5, Math.sqrt(c) * 0.62));
    }
    this.densityImg = this.toBitmap(rgba, d.w, d.h);
    return this.densityImg;
  };
}
