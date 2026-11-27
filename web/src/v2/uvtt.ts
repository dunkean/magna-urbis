import type { Point } from '../../../rust/bridge/urban';
import type { World } from '../gen/types';
import { enclosureSightLines } from '../render/cityWalls';
import { viewRect, worldToScreen, type Rect4 } from '../render/view';
import { exportPixelSize, type ExportRect } from '../ui/exportCropGeometry';
import { activityScene } from './activitySites';
import type { ExportFrame } from './display/exactFrame';
import { nativeCitiesOf } from './nativeProducts';

interface Portal {
  position: Point;
  bounds: [Point, Point];
  rotation: number;
  closed: boolean;
  freestanding: boolean;
}

export interface UvttFrame extends ExportFrame {
  pixelsPerGrid: number;
  metresPerGrid: number;
}

export const UVTT_TOKEN_CELL_METRES = 1.5;
// MapTool clamps imported square grids outside this range.
export const UVTT_MIN_GRID_PIXELS = 9;
export const UVTT_MAX_GRID_PIXELS = 350;

export function orthographicExportFrame(rect: ExportRect, longestEdge: number): ExportFrame {
  const { width, height } = exportPixelSize(rect, longestEdge);
  const scale = longestEdge / Math.max(rect.width, rect.height);
  return { view: { cx: rect.x + rect.width / 2, cy: rect.y + rect.height / 2, scale }, width, height };
}

/** One orthographic scale for the picture, the grid and every obstruction. */
export function uvttFrame(rect: ExportRect, longestEdge: number, requestedMetres?: number): UvttFrame {
  const frame = orthographicExportFrame(rect, longestEdge);
  const { scale } = frame.view;
  const target = 100 / scale;
  const decade = 10 ** Math.floor(Math.log10(target));
  const metres = requestedMetres ?? [1, 1.5, 2, 2.5, 3, 5, 7.5, 10].map(n => n * decade).reduce((a, b) => (Math.abs(a - target) <= Math.abs(b - target) ? a : b));
  const pixelsPerGrid = Math.round(metres * scale);
  return { ...frame, pixelsPerGrid, metresPerGrid: pixelsPerGrid / scale };
}

const samePoint = (a: Point, b: Point): boolean => Math.abs(a.x - b.x) < 1e-7 && Math.abs(a.y - b.y) < 1e-7;
const inFrame = (p: Point, r: Rect4): boolean => p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;

/** Clip a line against the export rectangle while preserving its original direction. */
function clipSegment(a: Point, b: Point, r: Rect4): [Point, Point] | undefined {
  let start = 0;
  let end = 1;
  const dx = b.x - a.x,
    dy = b.y - a.y;
  for (const [origin, delta, min, max] of [
    [a.x, dx, r.minX, r.maxX],
    [a.y, dy, r.minY, r.maxY],
  ] as const) {
    if (delta === 0) {
      if (origin < min || origin > max) return;
      continue;
    }
    const near = (min - origin) / delta,
      far = (max - origin) / delta;
    start = Math.max(start, Math.min(near, far));
    end = Math.min(end, Math.max(near, far));
    if (start >= end) return;
  }
  const at = (t: number): Point => ({ x: a.x + dx * t, y: a.y + dy * t });
  const first = at(start),
    last = at(end);
  if (!samePoint(first, last)) return [first, last];
}

function pathsInFrame(points: readonly Point[], closed: boolean, frame: Rect4): Point[][] {
  if (points.length < 2) return [];
  const result: Point[][] = [];
  let current: Point[] | undefined;
  const edges = closed ? points.length : points.length - 1;
  for (let i = 0; i < edges; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    if (samePoint(a, b)) continue;
    const segment = clipSegment(a, b, frame);
    if (!segment) {
      current = undefined;
      continue;
    }
    if (current && inFrame(a, frame) && samePoint(current.at(-1)!, segment[0])) current.push(segment[1]);
    else result.push((current = segment));
  }
  return result;
}

export function uvttDocument(world: World, frame: UvttFrame, image: string, buildingObstacles: boolean, cityVisible = true) {
  const { view, width, height, pixelsPerGrid } = frame;
  const bounds = viewRect(view, width, height);
  const toGrid = (p: Point): Point => {
    const [x, y] = worldToScreen(view, width, height, p.x, p.y);
    return { x: Math.max(0, Math.min(width, x)) / pixelsPerGrid, y: Math.max(0, Math.min(height, y)) / pixelsPerGrid };
  };
  const line_of_sight: Point[][] = [],
    portals: Portal[] = [];
  const addPath = (points: readonly Point[], closed: boolean): void => {
    for (const path of pathsInFrame(points, closed, bounds)) line_of_sight.push(path.map(toGrid));
  };
  const native = cityVisible ? nativeCitiesOf(world) : [];
  const nativeKeys = new Set<string>();
  for (const town of native) {
    for (const layout of town.layouts) {
      nativeKeys.add(layout.key);
      for (const enclosure of layout.enclosures ?? []) {
        const { pieces, gates } = enclosureSightLines(enclosure);
        for (const piece of pieces) if (!piece.water) addPath(piece.points, piece.closed);
        for (const [a, b] of gates) {
          if (!inFrame(a, bounds) || !inFrame(b, bounds)) continue;
          portals.push({ position: toGrid({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }), bounds: [toGrid(a), toGrid(b)], rotation: Math.atan2(b.y - a.y, b.x - a.x), closed: true, freestanding: false });
        }
      }
    }
  }
  // Imported and TypeScript towns can have drawn walls without a native Layout.
  const legacy = new Set((cityVisible ? (world.settlements ?? []) : []).filter(place => !nativeKeys.has(place.key)).flatMap(place => (place.urban ? [place.urban] : [])));
  if (cityVisible && !nativeKeys.has('main') && world.urban) legacy.add(world.urban);
  for (const town of legacy) {
    for (const wall of town.walls ?? []) {
      if (wall.pieces) for (const piece of wall.pieces) addPath(piece, false);
      else addPath(wall.path, wall.closed);
    }
  }
  if (cityVisible && buildingObstacles) {
    for (const buildings of [...native.map(town => town.scene?.buildings ?? []), activityScene(world)?.buildings ?? []]) {
      for (const building of buildings)
        for (const { outer, holes } of building.footprint) {
          addPath(outer, true);
          for (const hole of holes) addPath(hole, true);
        }
    }
    for (const town of legacy)
      for (const building of town.buildings) {
        addPath(building.poly, true);
        for (const court of building.courtyards ?? []) addPath(court, true);
      }
  }
  return {
    format: 0.3,
    resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: width / pixelsPerGrid, y: height / pixelsPerGrid }, pixels_per_grid: pixelsPerGrid },
    line_of_sight,
    objects_line_of_sight: [],
    portals,
    environment: { baked_lighting: true, ambient_light: '#ffffff' },
    lights: [],
    image,
  };
}

export function uvttImageData(png: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1]);
    reader.readAsDataURL(png);
  });
}
