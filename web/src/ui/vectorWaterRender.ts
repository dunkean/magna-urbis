/** SVG of the vector water chain and its diagnostics, in map metres. */
import { encodePng, pngDataUrl } from '../render/raster';
import { PALETTES } from '../render/styles';
import type { TerrainStyle } from '../../../rust/bridge/terrainRender';
import { channelWidth, type RiverLine } from './riverVectors';
import type { VectorWater } from './vectorWater';
import { marchingSquares } from '../gen/terrain/contour';
import { lakeField, lakeSample } from './lakeGeometry';
import { riverBank } from '../../../rust/bridge/hydrologyRender';

export type VectorOverlay = 'none' | 'v-accumulation' | 'v-basins' | 'v-depth' | 'v-conditioning' | 'v-lakes' | 'v-styles';
export const VECTOR_OVERLAYS: VectorOverlay[] = ['v-accumulation', 'v-basins', 'v-depth', 'v-conditioning', 'v-lakes', 'v-styles'];
export const VECTOR_LEGENDS: Record<VectorOverlay, string> = {
  none: '',
  'v-accumulation': 'Drained area (weighted by runoff), logarithmic scale.',
  'v-basins': 'One color per outlet: sea, map edge or closed lake.',
  'v-depth': 'Depression filling: water height if every depression spilled, orange → red.',
  'v-conditioning': 'Pre-hydrology conditioning: blue = lowered terrain (sills, valleys), brown = filled terrain (sediment).',
  'v-lakes': 'Water balance: blue = spilling lake, purple = closed lake (evaporation equals inflow).',
  'v-styles': 'Channel styles: blue straight, red meandering, purple confluence links, orange braided, magenta anabranching, green delta.',
};

const format = (v: number): string => v.toFixed(1);

function rasterImage(rgba: Uint8Array, n: number, width: number, attributes = ''): string {
  return `<image width="${width}" height="${width}" href="${pngDataUrl(encodePng(rgba, n, n, 4, 1))}" ${attributes}/>`;
}

const shores = new WeakMap<VectorWater, string>();
/**
 * Contour the same continuous shore field as the GPU. Islands are holes.
 */
function lakeShores(water: VectorWater): string {
  const cached = shores.get(water);
  if (cached !== undefined) return cached;
  const { n, width } = water.hydro, cell = width / n, step = cell / 4;
  const shore = lakeField(water.lake, n);
  // Only refine connected lake bounds. Merge overlapping boxes so islands
  // and neighbouring lakes are contoured once, with no even-odd cancellation.
  type Box = { x0: number; y0: number; x1: number; y1: number };
  const boxes: Box[] = [], visited = new Uint8Array(n * n), queue: number[] = [];
  for (let c = 0; c < n * n; c++) {
    if (!water.lake[c] || visited[c]) continue;
    queue.length = 0; queue.push(c); visited[c] = 1;
    const box = { x0: c % n, x1: c % n, y0: Math.floor(c / n), y1: Math.floor(c / n) };
    for (let head = 0; head < queue.length; head++) {
      const cellId = queue[head], x = cellId % n, y = Math.floor(cellId / n);
      box.x0 = Math.min(box.x0, x); box.x1 = Math.max(box.x1, x); box.y0 = Math.min(box.y0, y); box.y1 = Math.max(box.y1, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy, nb = yy * n + xx;
        if (xx < 0 || yy < 0 || xx >= n || yy >= n || visited[nb] || !water.lake[nb]) continue;
        visited[nb] = 1; queue.push(nb);
      }
    }
    box.x0 = Math.max(-1, box.x0 - 3); box.x1 = Math.min(n + 1, box.x1 + 3);
    box.y0 = Math.max(-1, box.y0 - 3); box.y1 = Math.min(n + 1, box.y1 + 3);
    for (let j = 0; j < boxes.length;) {
      const other = boxes[j];
      if (box.x0 <= other.x1 && other.x0 <= box.x1 && box.y0 <= other.y1 && other.y0 <= box.y1) {
        box.x0 = Math.min(box.x0, other.x0); box.x1 = Math.max(box.x1, other.x1);
        box.y0 = Math.min(box.y0, other.y0); box.y1 = Math.max(box.y1, other.y1);
        boxes.splice(j, 1); j = 0;
      } else j++;
    }
    boxes.push(box);
  }
  let d = '';
  for (const box of boxes) {
    const w = (box.x1 - box.x0) * 4 + 1, h = (box.y1 - box.y0) * 4 + 1, field = new Float32Array(w * h).fill(-4);
    const ox = (box.x0 + 0.5) * cell, oy = (box.y0 + 0.5) * cell;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const wx = ox + x * step, wy = oy + y * step;
      const ix = Math.floor(wx / cell), iy = Math.floor(wy / cell);
      if (ix < 0 || iy < 0 || ix >= n || iy >= n) continue;
      const value = shore.distance[iy * n + ix];
      field[y * w + x] = Math.abs(value) < 3 ? lakeSample(shore, width, wx, wy) : value;
    }
    for (const path of marchingSquares(field, w, h, 0, step, ox, oy)) {
      if (!path.closed || path.pts.length < 4) continue;
      const pts = path.pts;
      const midpoint = (a: number, b: number): string => `${format((pts[a].x + pts[b].x) / 2)},${format((pts[a].y + pts[b].y) / 2)}`;
      d += `M${midpoint(pts.length - 1, 0)}`;
      for (let i = 0; i < pts.length; i++) d += `Q${format(pts[i].x)},${format(pts[i].y)} ${midpoint(i, (i + 1) % pts.length)}`;
      d += 'Z';
    }
  }
  shores.set(water, d);
  return d;
}

export interface WaterDisplay { style: TerrainStyle; showLakes: boolean; showOxbows: boolean; riverArea: number; riverMode: 'vector' | 'grid'; overlay: VectorOverlay }

/** Shared water colour and per-vertex diagnostic colours. */
function waterInk(display: Pick<WaterDisplay, 'style' | 'riverArea' | 'overlay'>): { edge: string; colourOf: (kind: number) => string } {
  const s = display.style, pal = PALETTES[(s === 'copernicus' || s === 'render' || (s === 'fantasy-ink' || s === 'fantasy-color')) ? 'parchment' : s];
  // Lakes take the rivers' colour: a river runs into its lake without a seam.
  const edge = s === 'fantasy-ink' ? '#666968' : s === 'fantasy-color' ? '#648f99' : (s === 'copernicus' || s === 'render') ? '#14527a' : pal.waterEdge;
  const styled = display.overlay === 'v-styles';
  const colourOf = (kind: number): string => !styled ? edge : ['#2a6fc9', '#c62828', '#7b1fa2', '#ef6c00', '#d81b60', '#2e7d32'][kind] ?? edge;
  return { edge, colourOf };
}

/** Lake colour of a display style. */
export const lakeColour = (display: Pick<WaterDisplay, 'style' | 'riverArea' | 'overlay'>): string => waterInk(display).edge;

const rgb = (value: string): [number, number, number] => [parseInt(value.slice(1, 3), 16) / 255, parseInt(value.slice(3, 5), 16) / 255, parseInt(value.slice(5, 7), 16) / 255];

/**
 * River segments for the GPU, in drawing order (oxbows, braids, distributaries,
 * rivers): x0, y0, x1, y1, widths at both ends in metres, then r, g, b.
 */
export function riverSegments(water: VectorWater, display: WaterDisplay): Float32Array {
  const { hydro: h } = water, n = h.n, cell = h.width / n;
  const { edge, colourOf } = waterInk(display);
  const threshold = display.riverArea * 1e6;
  const colours = new Map<string, [number, number, number]>();
  const colour = (c: string): [number, number, number] => { let v = colours.get(c); if (!v) colours.set(c, v = rgb(c)); return v; };
  const out: number[] = [];
  const push = (x0: number, y0: number, x1: number, y1: number, w0: number, w1: number, c: string): void => {
    const [r, g, b] = colour(c);
    out.push(x0, y0, x1, y1, w0, w1, r, g, b);
  };
  const line = (l: RiverLine, thinner: number): void => {
    const { points, area, kind } = l;
    const widths = riverWidths(water, l, thinner);
    for (let i = 1; i < area.length; i++) {
      push(points[2 * i - 2], points[2 * i - 1], points[2 * i], points[2 * i + 1], widths[i - 1], widths[i], colourOf(kind[i - 1]));
    }
  };
  const rivers = water.rivers;
  if (display.riverMode === 'vector' && rivers) {
    if (display.showOxbows) for (const o of rivers.oxbows) line(o, 1);
    for (const l of rivers.braids) line(l, 0);
    for (const l of rivers.distributaries) line(l, 0);
    for (const l of rivers.rivers) line(l, 0);
    if (!display.showLakes) for (const l of rivers.lakeLinks ?? []) line(l, 0);
  } else for (let c = 0; c < n * n; c++) {
    const a = h.accumulation[c], next = h.receiver[c];
    if (h.sea[c] || (display.showLakes && water.lake[c]) || a < threshold || next < 0) continue;
    const x = c % n, y = (c - x) / n, nx = next % n, ny = (next - nx) / n;
    push((x + 0.5) * cell, (y + 0.5) * cell, (nx + 0.5) * cell, (ny + 0.5) * cell, channelWidth(a, water.widthScale ?? water.rivers?.widthScale ?? 1), channelWidth(h.accumulation[next], water.widthScale ?? water.rivers?.widthScale ?? 1), edge);
  }
  return Float32Array.from(out);
}

/** Hydraulic geometry, shared by both renderers; tidal mouths widen gradually. */
export function riverWidths(water: VectorWater, line: RiverLine, thinner = 0): number[] {
  const widths = line.area.map((a, i) => channelWidth(a / (line.threads?.[i] ?? 1), water.widthScale ?? water.rivers?.widthScale ?? 1) * (thinner ? 0.65 : 1));
  const p = line.points, m = widths.length - 1, h = water.hydro, cell = h.width / h.n;
  const x = Math.floor(p[2 * m] / cell), y = Math.floor(p[2 * m + 1] / cell);
  if (((x >= 0 && y >= 0 && x < h.n && y < h.n && h.sea[y * h.n + x]) || h.sea[line.outlet ?? -1]) && line.kind[0] !== 5) {
    // Exponential flare towards the sea, scaled by the river's size (a brook
    // barely widens), with a length and profile of its own.
    const size = Math.min(1, Math.log(Math.max(1, widths[m] / 4)) / Math.log(15));
    const factor = 1 + 0.8 * size * size * (3 - 2 * size);
    let hash = Math.imul(Math.round(p[2 * m]) ^ Math.imul(Math.round(p[2 * m + 1]), 668265263), 374761393);
    hash = (hash ^ (hash >>> 13)) >>> 0;
    const reach = widths[m] * (10 + 18 * (hash & 255) / 255), profile = 1.3 + 1.2 * ((hash >>> 8) & 255) / 255;
    let arc = 0;
    for (let i = m; i >= 0 && arc < reach; i--) {
      widths[i] *= factor ** ((1 - arc / reach) ** profile);
      if (i) arc += Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1]);
    }
  }
  return widths;
}

export function vectorWaterSvg(water: VectorWater, display: WaterDisplay): string {
  const { edge, colourOf } = waterInk(display);
  let svg = `<g class="water">${display.showLakes ? `<path d="${lakeShores(water)}" fill="${edge}" fill-rule="evenodd" stroke="none"/>` : ''}`;
  const network = water.rivers;
  if (display.riverMode === 'vector' && network) {
    const groups = new Map<string, { banks: string; axes: string }>();
    const lines: [RiverLine, number][] = [
      ...(display.showOxbows ? network.oxbows.map(l => [l, 1] as [RiverLine, number]) : []),
      ...network.braids.map(l => [l, 0] as [RiverLine, number]),
      ...network.distributaries.map(l => [l, 0] as [RiverLine, number]),
      ...network.rivers.map(l => [l, 0] as [RiverLine, number]),
      ...(!display.showLakes ? (network.lakeLinks ?? []).map(l => [l, 0] as [RiverLine, number]) : []),
    ];
    for (const [line, thinner] of lines) {
      const widths = riverWidths(water, line, thinner), packed = new Float32Array(widths.length * 4);
      for (let k = 0; k < widths.length; k++) packed.set([line.points[2 * k], line.points[2 * k + 1], widths[k], line.level[k]], k * 4);
      let start = 0;
      while (start + 1 < widths.length) {
        const colour = colourOf(line.kind[start]);
        let end = start + 1;
        while (end + 1 < widths.length && colourOf(line.kind[end]) === colour) end++;
        const group = groups.get(colour) ?? { banks: '', axes: '' };
        group.banks += riverBank(packed, start, end + 1);
        // Round terminal caps and incident bank joins, like the GPU capsules.
        for (const k of [start, end]) {
          const x = packed[k * 4], y = packed[k * 4 + 1], r = widths[k] / 2;
          group.banks += `M${format(x + r)},${format(y)}a${format(r)},${format(r)} 0 1 0 ${format(-2 * r)},0a${format(r)},${format(r)} 0 1 0 ${format(2 * r)},0Z`;
        }
        group.axes += `M${line.points.slice(2 * start, 2 * end + 2).map((v, k) => (k % 2 ? ',' : k ? 'L' : '') + format(v)).join('')}`;
        groups.set(colour, group); start = end;
      }
    }
    for (const [colour, group] of groups) {
      svg += `<path d="${group.axes}" fill="none" stroke="${colour}" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
      svg += `<path d="${group.banks}" fill="${colour}" stroke="none"/>`;
    }
  } else {
    const segments = riverSegments(water, display), groups = new Map<string, string>();
    for (let i = 0; i < segments.length; i += 9) {
      // Grid diagnostics use a few width bins rather than one DOM path per cell.
      const width = Math.pow(1.05, Math.round(Math.log(Math.max(0.01, (segments[i + 4] + segments[i + 5]) / 2)) / Math.log(1.05))).toFixed(2);
      const d = `M${format(segments[i])},${format(segments[i + 1])}L${format(segments[i + 2])},${format(segments[i + 3])}`;
      groups.set(width, (groups.get(width) ?? '') + d);
    }
    for (const [width, d] of groups) {
      svg += `<path d="${d}" fill="none" stroke="${edge}" stroke-width="0.8" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
      svg += `<path d="${d}" fill="none" stroke="${edge}" stroke-width="${width}" stroke-linecap="round"/>`;
    }
  }
  return svg + '</g>';
}

/** Raster diagnostics over the hydrology grid; `delta` is the conditioning's height change on its own grid. */
export function vectorOverlaySvg(water: VectorWater, overlay: VectorOverlay, delta?: { values: Float32Array; n: number }): string {
  const pixels = vectorOverlayPixels(water, overlay, delta);
  return pixels ? rasterImage(pixels.rgba, pixels.n, water.hydro.width, 'style="image-rendering:pixelated"') : '';
}

/** RGBA cells of a diagnostic over the whole map (`n²`, row-major from the north-west), or none. */
export function vectorOverlayPixels(water: VectorWater, overlay: VectorOverlay, delta?: { values: Float32Array; n: number }): { rgba: Uint8Array; n: number } | undefined {
  const h = water.hydro, n = h.n, rgba = new Uint8Array(n * n * 4);
  if (overlay === 'v-accumulation') {
    let top = 0;
    for (const v of h.accumulation) top = Math.max(top, v);
    const max = Math.log10(top / h.cellArea);
    for (let c = 0; c < n * n; c++) {
      if (h.sea[c] || h.accumulation[c] <= 0) continue;
      const t = Math.max(0, Math.log10(h.accumulation[c] / h.cellArea) / Math.max(1, max));
      rgba.set([20, 60 + 120 * t, 160 + 95 * t, Math.round(255 * Math.min(1, t * 1.3))], c * 4);
    }
  } else if (overlay === 'v-basins') {
    for (let c = 0; c < n * n; c++) {
      if (h.sea[c]) continue;
      const id = Math.imul(h.basin[c] + 1, 2654435761) >>> 0;
      rgba.set([id & 255, (id >>> 8) & 255, (id >>> 16) & 255, 120], c * 4);
    }
  } else if (overlay === 'v-depth') {
    for (let c = 0; c < n * n; c++) {
      const depth = h.filled[c] - h.height[c];
      if (h.sea[c] || depth <= 0) continue;
      const t = Math.min(1, Math.sqrt(depth / 50));
      rgba.set([200, 40 + 80 * (1 - t), 30, Math.round(90 + 165 * t)], c * 4);
    }
  } else if (overlay === 'v-lakes' && water.lakeKind) {
    for (let c = 0; c < n * n; c++) {
      const kind = water.lakeKind[c];
      if (!kind) continue;
      const depth = (water.lakeLevel?.[c] ?? 0) - h.height[c], t = Math.min(1, Math.sqrt(Math.max(0, depth) / 30));
      rgba.set(kind === 2 ? [140, 40, 170, Math.round(120 + 135 * t)] : [30, 100, 210, Math.round(120 + 135 * t)], c * 4);
    }
  } else if (overlay === 'v-conditioning' && delta) {
    const m = delta.n, out = new Uint8Array(m * m * 4);
    for (let c = 0; c < m * m; c++) {
      const v = delta.values[c];
      if (Math.abs(v) < 0.5) continue;
      const t = Math.min(1, Math.sqrt(Math.abs(v) / 40));
      out.set(v < 0 ? [20, 70, 200, Math.round(80 + 175 * t)] : [150, 95, 30, Math.round(80 + 175 * t)], c * 4);
    }
    return { rgba: out, n: m };
  } else return;
  return { rgba, n };
}
