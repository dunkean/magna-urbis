/**
 * Contour lines of the map, inked on the vector overlay (above the land-use tints and the parchment backdrop that
 * would hide a ground-shader line) and on the 3D drape tiles.
 *
 * The paths come from render/cityContours.ts, computed in a worker; this object holds the look decision, the Canvas
 * strokes and the wait for paths still in the worker. Called by the cartography's semantic hook (2D), by the physical
 * ground of the 3D drape and by the captures, which await the paths of their scale first.
 */
import { RecOnlyPath2D } from '../../render/gpu/path';
import { RecordingCanvas, RecordingContext, parseColor } from '../../render/gpu/recorder';
import type { DisplayList } from '../../render/gpu/contract';
import { createContourInk, type ContourInkSource, type OverlayInk } from '../../render/live/contourInk';
import { terrainStyle } from '../../render/terrainStyle';
import type { TerrainData } from '../../../../rust/bridge/terrain';
import { effectiveTerrainSettings } from '../terrainSettings';
import { isFantasyStyle } from '../../../../rust/bridge/fantasyTerrain';
import { contourDrawOf } from '../../render/composition';
import type { Rect } from '../../render/tileindex';
import { cityContourPaths, cityFineContours, cityContoursPending, cityContourPathsPending, cityContourPathsReady } from '../../render/cityContours';
import { CANVAS_MAP_STROKES, mapStrokeWidth } from '../../render/strokes';
import { countWork } from '../../render/workCount';
import type { Contours } from './contract';
import type { MapState } from './mapState';

/** Contour width factor on the 3D drape tiles. */
const DRAPE_CONTOUR_WEIGHT = 1.8;
/** Squares per side of the map a contour set is cut into: a paint strokes the chunks under its rectangle, not the
 * whole map's lines (a stroke of a map-wide path costs the whole path on every tile and in every band). */
const CHUNKS_PER_SIDE = 16;
interface ContourChunk {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  d: string;
  path?: Path2D;
  recorded?: Path2D;
}
type ContourSet = { thin: string; index: string };
/** The chunks of each set, kept as long as its cached strings. */
const CONTOUR_CHUNKS = new WeakMap<ContourSet, Partial<Record<'thin' | 'index', ContourChunk[]>>>();
/** Contour data is absolute M/L/Z only, written with fixed decimals. A character scan: map-wide sets hold megabytes,
 * which a regular expression and split parse an order of magnitude slower. `point` gets each vertex and the offset of
 * its command, `close` each Z. */
function scanContourPath(d: string, point: (move: boolean, x: number, y: number, at: number) => void, close?: () => void): void {
  const n = d.length;
  let i = 0;
  const num = (): number => {
    let sign = 1,
      whole = 0,
      frac = 0,
      div = 1,
      c = d.charCodeAt(i);
    if (c === 45) {
      sign = -1;
      i++;
    }
    while (i < n && (c = d.charCodeAt(i)) >= 48 && c <= 57) {
      whole = whole * 10 + c - 48;
      i++;
    }
    if (d.charCodeAt(i) === 46) {
      i++;
      while (i < n && (c = d.charCodeAt(i)) >= 48 && c <= 57) {
        frac = frac * 10 + c - 48;
        div *= 10;
        i++;
      }
    }
    return sign * (whole + frac / div);
  };
  while (i < n) {
    const at = i,
      c = d.charCodeAt(i++);
    if (c === 90) close?.();
    else if (c === 77 || c === 76) {
      const x = num();
      i++;
      const y = num();
      point(c === 77, x, y, at);
    }
  }
}
/** The GPU engine cannot record a native Path2D(string), so it gets the same lines as a RecPath2D. */
function recordedContourPath(d: string): Path2D {
  const path = new RecOnlyPath2D();
  scanContourPath(
    d,
    (move, x, y) => (move ? path.moveTo(x, y) : path.lineTo(x, y)),
    () => path.closePath(),
  );
  return path;
}
/** The lines of a set cut by square, once per set: each line goes whole to the square of its centre and a chunk's box
 * is its lines' union, so the chunks that meet a rectangle hold every line that reaches it, each stroked as before. */
function contourChunks(set: ContourSet, kind: 'thin' | 'index', size: number): ContourChunk[] {
  let held = CONTOUR_CHUNKS.get(set);
  if (!held) CONTOUR_CHUNKS.set(set, (held = {}));
  const known = held[kind];
  if (known) return known;
  countWork('contour.chunkSplit');
  const d = set[kind],
    cell = size / CHUNKS_PER_SIDE,
    squares = new Map<number, { minX: number; minY: number; maxX: number; maxY: number; parts: string[] }>();
  let start = -1,
    minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const square = (v: number): number => Math.max(0, Math.min(CHUNKS_PER_SIDE - 1, Math.floor(v / cell)));
  const flush = (end: number): void => {
    if (start < 0 || !(maxX >= minX)) return;
    const key = square((minY + maxY) / 2) * CHUNKS_PER_SIDE + square((minX + maxX) / 2);
    let sq = squares.get(key);
    if (!sq) squares.set(key, (sq = { minX, minY, maxX, maxY, parts: [] }));
    sq.minX = Math.min(sq.minX, minX);
    sq.minY = Math.min(sq.minY, minY);
    sq.maxX = Math.max(sq.maxX, maxX);
    sq.maxY = Math.max(sq.maxY, maxY);
    sq.parts.push(d.slice(start, end));
  };
  scanContourPath(d, (move, x, y, at) => {
    if (move) {
      flush(at);
      start = at;
      minX = minY = Infinity;
      maxX = maxY = -Infinity;
    }
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  });
  flush(d.length);
  return (held[kind] = [...squares.values()].map(({ parts, ...box }) => ({ ...box, d: parts.join('') })));
}
const chunkPath = (chunk: ContourChunk, recording: boolean): Path2D => {
  if (recording) return (chunk.recorded ??= recordedContourPath(chunk.d));
  return (chunk.path ??= new Path2D(chunk.d));
};

const WORLD_LISTS = new WeakMap<ContourSet, DisplayList>();
/** One recording per terrain set. These paths never pass through the band's segment clipper. */
function worldContourList(set: ContourSet, size: number): DisplayList {
  let list = WORLD_LISTS.get(set);
  if (list) return list;
  const canvas = new RecordingCanvas(size, size),
    ctx = canvas.getContext('2d')!;
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.lineWidth = 1;
  if (set.thin) ctx.stroke(recordedContourPath(set.thin));
  ctx.lineWidth = 2;
  if (set.index) ctx.stroke(recordedContourPath(set.index));
  list = canvas.finish();
  WORLD_LISTS.set(set, list);
  countWork('contour.retain');
  return list;
}

export class ContourInk implements Contours {
  revision = 0;
  private contourWaiters = new Map<TerrainData, Set<() => void>>();
  private liveInks = new Map<WebGL2RenderingContext, OverlayInk>();
  private landform?: { revision: number; settings: MapState['settings']; size: number; look: { landform: string } | undefined };
  private liveAppearance?: Pick<MapState, 'townContent' | 'native' | 'settings' | 'resolved' | 'exportLayers' | 'world'> & { contours: number; source?: ContourInkSource };

  createLiveInk(gl: WebGL2RenderingContext): OverlayInk | undefined {
    if (contourDrawOf(this.map.resolved?.composition.recipe).detail !== 'fixed') return undefined;
    let ink = this.liveInks.get(gl);
    if (!ink) {
      ink = createContourInk(gl, () => this.liveSource());
      if (ink) this.liveInks.set(gl, ink);
    }
    return ink;
  }
  private liveSource(): ContourInkSource | null | undefined {
    const previous = this.liveAppearance;
    if (
      previous &&
      previous.townContent === this.map.townContent &&
      previous.contours === this.revision &&
      previous.native === this.map.native &&
      previous.resolved === this.map.resolved &&
      previous.settings === this.map.settings &&
      previous.exportLayers === this.map.exportLayers &&
      previous.world === this.map.world
    )
      return previous.source;
    const appearance = { townContent: this.map.townContent, contours: this.revision, native: this.map.native, resolved: this.map.resolved, settings: this.map.settings, exportLayers: this.map.exportLayers, world: this.map.world };
    const look = this.contourLook();
    if (!look) {
      this.liveAppearance = appearance;
      return undefined;
    }
    const r = this.map.resolved!,
      terrain = this.map.native!,
      mode = contourDrawOf(r.composition.recipe);
    const paths = cityContourPaths(terrain, look.landform, 0, r.composition.recipe.ground.variant === 'topographic', undefined, 'fixed', mode.sparse);
    if (cityContourPathsPending(terrain, look.landform, 0, r.composition.recipe.ground.variant === 'topographic', 'fixed', mode.sparse)) {
      this.afterContours(this.contoursReady);
      return null;
    }
    const pal = terrainStyle(r.ground.style, r.palette.colors).palette;
    const color = parseColor(pal.contour);
    if (!color) throw new Error('Contour ink cannot represent the palette colour');
    const source: ContourInkSource = { terrain, list: worldContourList(paths, terrain.width), color, opacity: pal.contourOpacity * mode.opacity, thinWeight: pal.contourThinW ?? 1, indexWeight: pal.contourIndexW / 1.6 };
    this.liveAppearance = { ...appearance, source };
    return source;
  }
  dispose(): void {
    for (const ink of this.liveInks.values()) ink.dispose();
    this.liveInks.clear();
  }

  constructor(
    private readonly map: MapState,
    /** New paths arrived: whoever retains the contours of the overlay (its live lists) is told. */
    private readonly onChanged: () => void,
  ) {}

  pending(): number {
    return cityContoursPending(this.map.native) + this.contourWaiters.size;
  }
  private contoursReady = (): void => {
    if (this.map.disposed) return;
    this.revision++;
    this.onChanged();
    this.map.invalidate();
  };
  private afterContours(ready: () => void): void {
    const terrain = this.map.native!;
    let callbacks = this.contourWaiters.get(terrain);
    if (callbacks) {
      callbacks.add(ready);
      return;
    }
    callbacks = new Set([ready]);
    this.contourWaiters.set(terrain, callbacks);
    const poll = (): void => {
      if (this.map.disposed) {
        this.contourWaiters.delete(terrain);
        return;
      }
      if (cityContoursPending(terrain)) {
        setTimeout(poll, 32);
        return;
      }
      this.contourWaiters.delete(terrain);
      for (const callback of callbacks!) callback();
    };
    setTimeout(poll, 32);
  }
  async contoursAt(scale: number, box: Rect): Promise<void> {
    const look = this.contourLook(),
      terrain = this.map.native;
    if (!look || !terrain) return;
    const topographic = this.map.resolved!.composition.recipe.ground.variant === 'topographic',
      mode = contourDrawOf(this.map.resolved!.composition.recipe);
    if (!topographic && mode.detail === 'zoom') cityFineContours(terrain, look.landform, scale, box);
    await cityContourPathsReady(terrain, look.landform, scale, topographic, mode.detail, mode.sparse);
    while (cityContoursPending(terrain)) await new Promise(resolve => setTimeout(resolve, 16));
  }
  pendingAt(mpp: number): boolean {
    const look = this.contourLook();
    if (!look) return false;
    const topographic = this.map.resolved!.composition.recipe.ground.variant === 'topographic',
      mode = contourDrawOf(this.map.resolved!.composition.recipe);
    // Other sets (fine blocks, ordinary zoom levels) are traced synchronously when painted: never missing.
    if (!topographic && mode.detail !== 'fixed') return false;
    // The fixed set has no scale (its key ignores it); scale 0 also keeps out the fine blocks warming for the view.
    return cityContourPathsPending(this.map.native!, look.landform, mode.detail === 'fixed' ? 0 : 1 / mpp, topographic, mode.detail, mode.sparse);
  }
  /** Contours are drawn on the vector overlay, above the land-use tints and the parchment backdrop that would hide a ground-shader line. */
  contourLook(): { landform: string } | undefined {
    const r = this.map.resolved,
      t = this.map.native,
      world = this.map.world;
    if (!r || !t || !world || !r.ground.contours || this.map.exportLayers.terrain === false || (!this.map.layers().relief && r.composition.variant !== 'topographic') || t.caveMask.length || isFantasyStyle(r.ground.style)) return undefined;
    // The appearance revision also changes when settings are edited in place. Deriving the entire terrain recipe
    // just to read its relief in every region-key/readiness query otherwise allocates on every navigation frame.
    if (!this.landform || this.landform.revision !== this.map.townContent || this.landform.settings !== this.map.settings || this.landform.size !== world.mapSize) {
      const landform = effectiveTerrainSettings(this.map.settings!, world.mapSize).relief;
      this.landform = { revision: this.map.townContent, settings: this.map.settings, size: world.mapSize, look: landform === 'cavern' ? undefined : { landform } };
    }
    return this.landform.look;
  }
  /** Same screen weight at every zoom; close views split the interval (cityFineContours) instead of losing the lines on flat ground. */
  /** Contours on one 3D drape tile (world square `box` on `target`); heavier than on the flat map, as the tile is seen minified and at a slant. */
  drapeContours(target: HTMLCanvasElement, box: { minX: number; minY: number; maxX: number; maxY: number }, light = false, defer?: () => () => void): boolean {
    if (!this.contourLook()) return false;
    const ctx = target.getContext('2d');
    if (!ctx) return false;
    const k = target.width / (box.maxX - box.minX);
    ctx.save();
    ctx.setTransform(k, 0, 0, k, -box.minX * k, -box.minY * k);
    ctx.globalCompositeOperation = 'source-over';
    const drawn = this.paintContours(ctx, box, 1 / k, DRAPE_CONTOUR_WEIGHT, light, defer);
    ctx.restore();
    return drawn;
  }
  /** `defer` (3D drape squares): contours still in the worker repaint only the squares that drew without them, not the 2D map. */
  paintContours(ctx: CanvasRenderingContext2D, viewport: { minX: number; minY: number; maxX: number; maxY: number }, mpp: number, weight = 1, light = false, defer?: () => () => void): boolean {
    const look = this.contourLook();
    if (!look) return false;
    const pal = terrainStyle(this.map.resolved!.ground.style, this.map.resolved!.palette.colors).palette,
      sc = 1 / mpp;
    const farLight = light && sc < 1;
    const topographic = this.map.resolved!.composition.recipe.ground.variant === 'topographic',
      mode = contourDrawOf(this.map.resolved!.composition.recipe);
    // Fixed (V1): the same whole-map set at every zoom, so no zoom repaints its lines; only the stroke weight follows the scale.
    const fine = farLight || topographic || mode.detail === 'fixed' ? undefined : cityFineContours(this.map.native!, look.landform, sc, viewport);
    let sets = fine?.blocks;
    if (!sets) {
      sets = [cityContourPaths(this.map.native!, look.landform, sc, topographic, undefined, mode.detail, mode.sparse)].filter(paths => paths.step);
    }
    if (cityContoursPending(this.map.native)) this.afterContours(defer?.() ?? this.contoursReady);
    if (!sets.length) return false;
    ctx.save();
    ctx.strokeStyle = pal.contour;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.globalAlpha = pal.contourOpacity * 0.7 * mode.opacity;
    ctx.lineWidth = mapStrokeWidth(CANVAS_MAP_STROKES.contour, sc, (pal.contourThinW ?? 1) * weight);
    const recording = ctx instanceof RecordingContext,
      size = this.map.native!.width,
      indexWidth = mapStrokeWidth(CANVAS_MAP_STROKES.contourIndex, sc, (pal.contourIndexW / 1.6) * weight),
      reach = Math.max(ctx.lineWidth, indexWidth);
    countWork(recording ? 'contour.record' : 'contour.canvas');
    let strokes = 0;
    const stroke = (kind: 'thin' | 'index'): void => {
      for (const set of sets)
        if (set[kind])
          for (const chunk of contourChunks(set, kind, size))
            if (chunk.maxX + reach >= viewport.minX && chunk.minX - reach <= viewport.maxX && chunk.maxY + reach >= viewport.minY && chunk.minY - reach <= viewport.maxY) {
              ctx.stroke(chunkPath(chunk, recording));
              strokes++;
            }
    };
    if (!farLight) stroke('thin');
    ctx.globalAlpha = pal.contourOpacity * mode.opacity;
    ctx.lineWidth = indexWidth;
    stroke('index');
    countWork('contour.chunksStroked', strokes);
    ctx.restore();
    return true;
  }
}
