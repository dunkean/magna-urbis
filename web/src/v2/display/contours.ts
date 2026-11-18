/**
 * Contour lines of the map, inked on the vector overlay (above the land-use tints and the parchment backdrop that
 * would hide a ground-shader line) and on the 3D drape tiles.
 *
 * The paths come from render/cityContours.ts, computed in a worker; this object holds the look decision, the Canvas
 * strokes and the wait for paths still in the worker. Called by the cartography's semantic hook (2D), by the physical
 * ground of the 3D drape and by the captures, which await the paths of their scale first.
 */
import { newPath } from '../../render/gpu/path';
import { RecordingContext } from '../../render/gpu/recorder';
import { terrainStyle } from '../../render/terrainStyle';
import type { TerrainData } from '../../../../rust/bridge/terrain';
import { effectiveTerrainSettings } from '../terrainSettings';
import { isFantasyStyle } from '../../../../rust/bridge/fantasyTerrain';
import { contourDrawOf } from '../../render/composition';
import type { Rect } from '../../render/tileindex';
import { cityContourPaths, cityFineContours, cityContoursPending, cityContourPathsPending, cityContourPathsReady } from '../../render/cityContours';
import { CANVAS_MAP_STROKES, mapStrokeWidth } from '../../render/strokes';
import type { Contours } from './contract';
import type { MapState } from './mapState';

/** Contour width factor on the 3D drape tiles. */
const DRAPE_CONTOUR_WEIGHT = 1.8;
/** Parsed contour paths, kept as long as their cached strings. */
const CONTOUR_PATHS = new WeakMap<object, Partial<Record<'thin' | 'index' | 'recThin' | 'recIndex', Path2D>>>();
/** Contour data is absolute M/L/Z only. The GPU engine cannot record a native Path2D(string), so it gets the same lines as a RecPath2D. */
function recordedContourPath(d: string): Path2D {
  // A character scan (the producer writes `M x,y L x,y ... Z` with fixed decimals): map-wide sets hold megabytes, which a
  // regular expression and split parse an order of magnitude slower.
  const path = newPath(),
    n = d.length;
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
    const c = d.charCodeAt(i++);
    if (c === 90) path.closePath();
    else if (c === 77 || c === 76) {
      const x = num();
      i++;
      const y = num();
      if (c === 77) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
  }
  return path;
}
const contourPath = (set: { thin: string; index: string }, kind: 'thin' | 'index', recording = false): Path2D => {
  let parsed = CONTOUR_PATHS.get(set);
  if (!parsed) CONTOUR_PATHS.set(set, (parsed = {}));
  if (recording) return (parsed[kind === 'thin' ? 'recThin' : 'recIndex'] ??= recordedContourPath(set[kind]));
  return (parsed[kind] ??= new Path2D(set[kind]));
};

export class ContourInk implements Contours {
  revision = 0;
  private contourWaiters = new Map<TerrainData, Set<() => void>>();

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
    const landform = effectiveTerrainSettings(this.map.settings!, world.mapSize).relief;
    return landform === 'cavern' ? undefined : { landform };
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
    const recording = ctx instanceof RecordingContext;
    if (!farLight) for (const set of sets) if (set.thin) ctx.stroke(contourPath(set, 'thin', recording));
    ctx.globalAlpha = pal.contourOpacity * mode.opacity;
    ctx.lineWidth = mapStrokeWidth(CANVAS_MAP_STROKES.contourIndex, sc, (pal.contourIndexW / 1.6) * weight);
    for (const set of sets) if (set.index) ctx.stroke(contourPath(set, 'index', recording));
    ctx.restore();
    return true;
  }
}
