/** Retained, bounded-cost Canvas 2D basemap. Data in, paths and pixels out; no page or GPU dependencies. */
import { PALETTES } from './styles';
import { viewRect, type View, type Rect4 } from './view';
import type { CompositionRecipe } from './composition';
import type { ExportLayers } from './exportLayers';
import type { LandKind } from '../gen/types';
import { marchingSquares } from '../gen/terrain/contour';

export interface MinimalPoint { x: number; y: number }
export interface MinimalFeature {
  layer: string;
  points: readonly MinimalPoint[];
  holes?: readonly (readonly MinimalPoint[])[];
  closed?: boolean;
}
export interface MinimalPlace extends MinimalPoint { name: string; population: number }
export interface MinimalHeight { data: ArrayLike<number>; n: number; width: number; maxHeight: number }
/** Preserve islands in the retained flat water-ring list, independent of authored winding. */
export function* minimalWaterPolygons(rings: readonly (readonly MinimalPoint[])[]): Generator<MinimalFeature> {
  const ordered = rings.filter(ring => ring.length >= 3).map(points => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, area = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const p = points[i]; minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      area += points[j].x * p.y - p.x * points[j].y;
    }
    return { points, minX, minY, maxX, maxY, area: Math.abs(area), depth: 0, holes: [] as (readonly MinimalPoint[])[] };
  }).sort((a, b) => b.area - a.area);
  const contains = (ring: readonly MinimalPoint[], p: MinimalPoint): boolean => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  };
  for (let i = 0; i < ordered.length; i++) {
    const ring = ordered[i], p = ring.points[0];
    for (let j = i - 1; j >= 0; j--) {
      const parent = ordered[j];
      if (p.x < parent.minX || p.x > parent.maxX || p.y < parent.minY || p.y > parent.maxY || !contains(parent.points, p)) continue;
      ring.depth = parent.depth + 1;
      if (ring.depth % 2) parent.holes.push(ring.points);
      break;
    }
  }
  for (const ring of ordered) if (ring.depth % 2 === 0) yield { layer: 'water', points: ring.points, holes: ring.holes, closed: true };
}

interface Batch extends Rect4 { path: Path2D }
export interface MinimalGeometry { size: number; cells: Map<string, Batch>[]; buildMs: number; features: number }
export interface MinimalLabel extends MinimalPlace { width: number }
export interface MinimalTextLayout { labels: MinimalLabel[] }
export const MINIMAL_GRID = 8;
const BUILDING_SIZES = [2, 4, 8, 16, 32, 64, 128, 256];
const palette = PALETTES.minimal;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const fade = (v: number): number => clamp(v, 0, 1);
const overlaps = (a: Rect4, b: Rect4): boolean => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

/** Yield after each feature. The owner budgets these steps, including iteration of its input products. */
export function* buildMinimalGeometry(size: number, features: Iterable<MinimalFeature>, result: MinimalGeometry,
  Path: new () => Path2D = Path2D): Generator<void> {
  let activeMs = 0;
  for (const feature of features) {
    const started = performance.now(), points = feature.points;
    if (points.length < 2) { yield; continue; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    const x = clamp(Math.floor((minX + maxX) / 2 / size * MINIMAL_GRID), 0, MINIMAL_GRID - 1);
    const y = clamp(Math.floor((minY + maxY) / 2 / size * MINIMAL_GRID), 0, MINIMAL_GRID - 1);
    let layer = feature.layer;
    if (layer === 'building') {
      const diameter = Math.max(.1, Math.min(maxX - minX, maxY - minY));
      layer += clamp(Math.floor(Math.log2(diameter / 2)), 0, BUILDING_SIZES.length - 1);
    }
    const cell = result.cells[y * MINIMAL_GRID + x];
    let batch = cell.get(layer);
    if (!batch) cell.set(layer, batch = { path: new Path(), minX, minY, maxX, maxY });
    batch.minX = Math.min(batch.minX, minX); batch.minY = Math.min(batch.minY, minY);
    batch.maxX = Math.max(batch.maxX, maxX); batch.maxY = Math.max(batch.maxY, maxY);
    // Normalize winding so overlapping polygons fill normally and courtyards remain empty.
    const ring = (pts: readonly MinimalPoint[], hole: boolean): void => {
      if (!pts.length) return;
      let area = 0;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) area += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
      const reverse = feature.closed && (area < 0) !== hole;
      const first = reverse ? pts.length - 1 : 0;
      batch!.path.moveTo(pts[first].x, pts[first].y);
      for (let k = 1; k < pts.length; k++) { const p = pts[reverse ? pts.length - 1 - k : k]; batch!.path.lineTo(p.x, p.y); }
      if (feature.closed) batch!.path.closePath();
    };
    ring(points, false); for (const hole of feature.holes ?? []) ring(hole, true);
    result.features++;
    activeMs += performance.now() - started; result.buildMs = activeMs;
    yield;
  }
}
export function emptyMinimalGeometry(size: number): MinimalGeometry {
  return { size, cells: Array.from({ length: MINIMAL_GRID ** 2 }, () => new Map()), buildMs: 0, features: 0 };
}

/** Contour lines of the land, traced once on a bounded grid (at most 512 x 512, as the relief bitmap): one fixed set
 * for every zoom, no level of detail. About fourteen levels at a round interval; every fifth is an index line
 * (`contourIndex`). `height.width` is the side of the map the grid covers. Yields the lines of one level at a time. */
export function* minimalContours(height: MinimalHeight): Generator<MinimalFeature> {
  const n = height.n, m = Math.max(2, Math.min(512, n)), cell = height.width / m, field = new Float32Array(m * m);
  // Mean of four taps per cell: a large raster is not read through single pixels.
  const tap = (k: number, q: number): number => Math.min(n - 1, Math.floor((k + q) * n / m));
  let top = 0;
  for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
    const x0 = tap(x, .25), x1 = tap(x, .75), y0 = tap(y, .25) * n, y1 = tap(y, .75) * n;
    const h = (height.data[y0 + x0] + height.data[y0 + x1] + height.data[y1 + x0] + height.data[y1 + x1]) / 4;
    field[y * m + x] = h; if (h > top) top = h;
  }
  if (!(top > 0)) return;
  const raw = top / 14, unit = 10 ** Math.floor(Math.log10(raw)), interval = Math.max(1, [1, 2, 5, 10].find(step => step * unit >= raw)! * unit);
  for (let k = 1; k * interval < top; k++)
    for (const line of marchingSquares(field, m, m, k * interval, cell, cell / 2, cell / 2))
      if (line.pts.length >= 4) yield { layer: k % 5 ? 'contour' : 'contourIndex', points: line.pts, closed: line.closed };
}

/** CPU-only relief. One bounded bitmap, generated row by row and composited with ordinary source-over. */
export function* bakeMinimalRelief(height: MinimalHeight, canvas: HTMLCanvasElement): Generator<void> {
  const n = Math.max(2, Math.min(512, height.n)); canvas.width = canvas.height = n;
  const ctx = canvas.getContext('2d')!, image = ctx.createImageData(n, n), cell = height.width / height.n;
  const sample = (x: number, y: number): number => height.data[clamp(y, 0, height.n - 1) * height.n + clamp(x, 0, height.n - 1)];
  for (let y = 0; y < n; y++) {
    const sy = Math.min(height.n - 1, Math.floor((y + .5) * height.n / n));
    for (let x = 0; x < n; x++) {
      const sx = Math.min(height.n - 1, Math.floor((x + .5) * height.n / n)), h = sample(sx, sy);
      if (h < 0) continue;
      const dx = (sample(sx + 2, sy) - sample(sx - 2, sy)) / (4 * cell);
      const dy = (sample(sx, sy + 2) - sample(sx, sy - 2)) / (4 * cell);
      const light = clamp((.7 - .5 * dx - .5 * dy) / Math.sqrt(1 + dx * dx + dy * dy), .1, 1);
      const tint = clamp(h / Math.max(1, height.maxHeight), 0, 1), i = (y * n + x) * 4;
      image.data[i] = 181 + light * 65 + tint * 6;
      image.data[i + 1] = 188 + light * 57 + tint * 2;
      image.data[i + 2] = 171 + light * 66 - tint * 5;
      image.data[i + 3] = 110;
    }
    yield;
  }
  ctx.putImageData(image, 0, 0);
}

/** A frame visits a fixed number of layer/cell batches, never the source buildings or road segments. */
export function paintMinimalMap(ctx: CanvasRenderingContext2D, geometry: MinimalGeometry, options: {
  view: View; width: number; height: number; dpr: number; recipe: CompositionRecipe;
  places: readonly MinimalPlace[]; textLayout: MinimalTextLayout; layoutText?: boolean;
  relief?: HTMLCanvasElement; layers?: Partial<ExportLayers>;
  /** Retained contour lines (`minimalContours`), drawn when the recipe asks for them. */
  contours?: MinimalGeometry;
}): number {
  const started = performance.now(), { view, width, height, recipe, dpr } = options, layers = options.layers ?? {};
  const scale = view.scale, viewport = viewRect(view, width, height, 32 / scale);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (layers.background !== false) { ctx.fillStyle = palette.paper; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height); }
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, (width / 2 - view.cx * scale) * dpr, (height / 2 - view.cy * scale) * dpr);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.globalAlpha = 1;
  if (options.relief && recipe.effects.relief && layers.terrain !== false) ctx.drawImage(options.relief, 0, 0, geometry.size, geometry.size);
  const batches = (layer: string, draw: (path: Path2D) => void, source = geometry): void => {
    for (const cell of source.cells) { const b = cell.get(layer); if (b && overlaps(b, viewport)) draw(b.path); }
  };
  const fill = (layer: string, color: string, alpha = 1): void => {
    if (alpha <= 0) return; ctx.fillStyle = color; ctx.globalAlpha = alpha; batches(layer, path => ctx.fill(path)); ctx.globalAlpha = 1;
  };
  const stroke = (layer: string, color: string, px: number, min: number, max: number, alpha = 1): void => {
    if (alpha <= 0) return; ctx.strokeStyle = color; ctx.lineWidth = clamp(px / scale, min, max); ctx.globalAlpha = alpha;
    batches(layer, path => ctx.stroke(path)); ctx.globalAlpha = 1;
  };
  if (recipe.landuse.rural !== 'off' && layers.landuse !== false) for (const kind of Object.keys(palette.land) as LandKind[]) {
    if (recipe.landuse.classes?.[kind] !== false) fill(kind, palette.land[kind], recipe.landuse.opacity);
  }
  // Under the water and everything built; a constant hairline on screen, the index lines a little heavier.
  if (options.contours && recipe.ground.contours && layers.terrain !== false) {
    ctx.strokeStyle = palette.inkSoft;
    for (const [layer, px, alpha] of [['contour', .7, .5], ['contourIndex', 1.1, .7]] as const) {
      ctx.lineWidth = px / scale; ctx.globalAlpha = alpha; batches(layer, path => ctx.stroke(path), options.contours);
    }
    ctx.globalAlpha = 1;
  }
  if (recipe.networks.water.visible && layers.water !== false) {
    fill('water', palette.seaFill); stroke('water', palette.waterEdge, 1, .1, 60);
    fill('river', palette.riverFill);
  }
  if (recipe.buildings.visible && layers.city !== false) fill('block', palette.urban.yard);
  const localAlpha = fade((scale * 8 - 1) / .8);
  if (recipe.networks.roads.visible) {
    if (layers.roads !== false) {
      stroke('major', palette.roadEdge, 3.8, 3, 28); stroke('minor', palette.roadEdge, 2.4, 2, 18, localAlpha);
      stroke('major', palette.roadFill, 2.5, 2, 22); stroke('minor', palette.roadFill, 1.5, 1, 12, localAlpha);
      stroke('path', palette.trackFill, .8, .4, 5, localAlpha);
    }
    if (layers.streets !== false) {
      stroke('streetMajor', palette.roadFill, 2.3, 3, 14); stroke('streetMinor', palette.roadFill, 1.2, 1, 8, localAlpha);
    }
  }
  if (recipe.buildings.visible && layers.city !== false) {
    BUILDING_SIZES.forEach((size, i) => {
      const alpha = fade((size * scale - 1) / .8);
      fill(`building${i}`, palette.urban.mass, alpha);
      stroke(`building${i}`, palette.urban.massEdge, .55, .08, .4, fade((size * scale - 5) / 2));
    });
    fill('landmark', palette.urban.landmark);
    stroke('wall', palette.urban.wall, 1.5, 1, 7);
  }
  if (recipe.networks.roads.visible && layers.streets !== false) { fill('bridge', palette.roadFill); stroke('bridge', palette.roadEdge, .6, .1, 1); }
  if (recipe.text.visible && recipe.text.groups.places && layers.labels !== false) {
    const fontSize = 12 * recipe.text.size;
    ctx.font = `${fontSize / scale}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (options.layoutText !== false) {
      const boxes: Rect4[] = []; options.textLayout.labels = [];
      for (const place of options.places) {
        const x = (place.x - view.cx) * scale + width / 2, y = (place.y - view.cy) * scale + height / 2 - 12;
        if (x < -50 || y < -15 || x > width + 50 || y > height + 15) continue;
        const w = ctx.measureText(place.name).width * scale + 10;
        const box = { minX: x - w / 2, maxX: x + w / 2, minY: y - fontSize, maxY: y + fontSize };
        if (boxes.some(other => overlaps(box, other))) continue;
        boxes.push(box); options.textLayout.labels.push({ ...place, width: w });
      }
    }
    ctx.fillStyle = palette.lab.town; ctx.strokeStyle = palette.paper; ctx.lineWidth = 2.5 / scale;
    for (const place of options.textLayout.labels) { ctx.strokeText(place.name, place.x, place.y - 12 / scale); ctx.fillText(place.name, place.x, place.y - 12 / scale); }
  }
  return performance.now() - started;
}
