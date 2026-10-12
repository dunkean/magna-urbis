/** SVG of the vector water chain and its diagnostics, in map metres. */
import { encodePng, pngDataUrl } from '../render/raster';
import { PALETTES } from '../render/styles';
import type { TerrainStyle } from '../../../rust/bridge/terrainRender';
import type { RiverLine } from './riverVectors';
import type { VectorWater } from './vectorWater';
import { marchingSquares } from '../gen/terrain/contour';

export type VectorOverlay = 'none' | 'v-accumulation' | 'v-basins' | 'v-depth' | 'v-conditioning' | 'v-lakes' | 'v-styles';
export const VECTOR_OVERLAYS: VectorOverlay[] = ['v-accumulation', 'v-basins', 'v-depth', 'v-conditioning', 'v-lakes', 'v-styles'];
export const VECTOR_LEGENDS: Record<VectorOverlay, string> = {
  none: '',
  'v-accumulation': 'Surface drainée (pondérée par le ruissellement), échelle logarithmique.',
  'v-basins': 'Une couleur par exutoire : mer, bord de carte ou lac fermé.',
  'v-depth': 'Remplissage des cuvettes : hauteur d’eau si toutes débordaient, orange → rouge.',
  'v-conditioning': 'Conditionnement pré-hydrique : bleu = terrain abaissé (seuils, vallées), brun = comblé (sédiments).',
  'v-lakes': 'Bilan hydrique : bleu = lac qui déborde, violet = lac fermé (évaporation = apports).',
  'v-styles': 'Styles de chenal : bleu rectiligne, rouge méandres, violet raccords de confluence, orange tresses, magenta anastomoses, vert delta.',
};

const format = (v: number): string => v.toFixed(1);

function rasterImage(rgba: Uint8Array, n: number, width: number, attributes = ''): string {
  return `<image width="${width}" height="${width}" href="${pngDataUrl(encodePng(rgba, n, n, 4, 1))}" ${attributes}/>`;
}

const shores = new WeakMap<VectorWater, string>();
/**
 * Lake shores as smooth closed paths: marching squares around the drawn lake
 * cells, then two Chaikin passes. Islands are holes (even-odd fill).
 */
function lakeShores(water: VectorWater): string {
  const cached = shores.get(water);
  if (cached !== undefined) return cached;
  const { n, width } = water.hydro, cell = width / n, w = n + 2, field = new Float32Array(w * w).fill(-1);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (water.lake[y * n + x]) field[(y + 1) * w + x + 1] = 1;
  let d = '';
  for (const path of marchingSquares(field, w, w, 0, cell, -0.5 * cell, -0.5 * cell)) {
    if (!path.closed || path.pts.length < 4) continue;
    let pts = path.pts;
    for (let pass = 0; pass < 2; pass++) {
      const next: { x: number; y: number }[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        next.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y }, { x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y });
      }
      pts = next;
    }
    d += `M${pts.map(p => `${format(p.x)},${format(p.y)}`).join('L')}Z`;
  }
  shores.set(water, d);
  return d;
}

export interface WaterDisplay { style: TerrainStyle; showLakes: boolean; showOxbows: boolean; riverArea: number; riverMode: 'vector' | 'grid'; overlay: VectorOverlay }

/** Stroke colour of the water, its width classes and the per-vertex style colours. */
function waterInk(display: Pick<WaterDisplay, 'style' | 'riverArea' | 'overlay'>): { edge: string; widthClass: (area: number) => number; colourOf: (kind: number) => string } {
  const s = display.style, pal = PALETTES[s === 'copernicus' ? 'parchment' : s];
  // Lakes take the rivers' colour: a river runs into its lake without a seam.
  const edge = s === 'copernicus' ? '#14527a' : pal.waterEdge;
  // Stroke width grows with the logarithm of upstream area, in screen pixels.
  const threshold = display.riverArea * 1e6;
  const widthClass = (area: number): number => Math.max(0, Math.min(9, Math.floor(Math.log2(Math.max(1, area / threshold)))));
  const styled = display.overlay === 'v-styles';
  const colourOf = (kind: number): string => !styled ? edge : ['#2a6fc9', '#c62828', '#7b1fa2', '#ef6c00', '#d81b60', '#2e7d32'][kind] ?? edge;
  return { edge, widthClass, colourOf };
}

/** Lake colour of a display style. */
export const lakeColour = (display: Pick<WaterDisplay, 'style' | 'riverArea' | 'overlay'>): string => waterInk(display).edge;

const rgb = (value: string): [number, number, number] => [parseInt(value.slice(1, 3), 16) / 255, parseInt(value.slice(3, 5), 16) / 255, parseInt(value.slice(5, 7), 16) / 255];

/**
 * River segments for the GPU, in drawing order (oxbows, braids, distributaries,
 * rivers): x0, y0, x1, y1 in metres, width in CSS pixels, then r, g, b.
 */
export function riverSegments(water: VectorWater, display: Omit<WaterDisplay, 'showLakes'>): Float32Array {
  const { hydro: h } = water, n = h.n, cell = h.width / n;
  const { edge, widthClass, colourOf } = waterInk(display);
  const threshold = display.riverArea * 1e6;
  const colours = new Map<string, [number, number, number]>();
  const colour = (c: string): [number, number, number] => { let v = colours.get(c); if (!v) colours.set(c, v = rgb(c)); return v; };
  const out: number[] = [];
  const push = (x0: number, y0: number, x1: number, y1: number, k: number, c: string): void => {
    const [r, g, b] = colour(c);
    out.push(x0, y0, x1, y1, 0.7 + 0.45 * k, r, g, b);
  };
  const line = (l: RiverLine, thinner: number): void => {
    const { points, area, kind } = l, threads = l.threads;
    for (let i = 1; i < area.length; i++) {
      push(points[2 * i - 2], points[2 * i - 1], points[2 * i], points[2 * i + 1], Math.max(0, widthClass(area[i - 1] / (threads?.[i - 1] ?? 1)) - thinner), colourOf(kind[i - 1]));
    }
  };
  const rivers = water.rivers;
  if (display.riverMode === 'vector' && rivers) {
    if (display.showOxbows) for (const o of rivers.oxbows) line(o, 1);
    for (const l of rivers.braids) line(l, 0);
    for (const l of rivers.distributaries) line(l, 0);
    for (const l of rivers.rivers) line(l, 0);
  } else for (let c = 0; c < n * n; c++) {
    const a = h.accumulation[c], next = h.receiver[c];
    if (h.sea[c] || water.lake[c] || a < threshold || next < 0) continue;
    const x = c % n, y = (c - x) / n, nx = next % n, ny = (next - nx) / n;
    push((x + 0.5) * cell, (y + 0.5) * cell, (nx + 0.5) * cell, (ny + 0.5) * cell, widthClass(a), edge);
  }
  return Float32Array.from(out);
}

export function vectorWaterSvg(water: VectorWater, display: WaterDisplay): string {
  const { hydro: h } = water, n = h.n, width = h.width, cell = width / n;
  const s = display.style, pal = PALETTES[s === 'copernicus' ? 'parchment' : s];
  // Lakes take the rivers' colour: a river runs into its lake without a seam.
  const edge = s === 'copernicus' ? '#14527a' : pal.waterEdge;
  // Stroke width grows with the logarithm of upstream area, in screen pixels.
  const threshold = display.riverArea * 1e6;
  const widthClass = (area: number): number => Math.max(0, Math.min(9, Math.floor(Math.log2(Math.max(1, area / threshold)))));
  const styled = display.overlay === 'v-styles';
  const colourOf = (kind: number): string => !styled ? edge : ['#2a6fc9', '#c62828', '#7b1fa2', '#ef6c00', '#d81b60', '#2e7d32'][kind] ?? edge;
  // path data per (class, colour)
  const groups = new Map<string, string>();
  const add = (k: number, colour: string, d: string): void => { const key = `${k}|${colour}`; groups.set(key, (groups.get(key) ?? '') + d); };
  const line = (l: RiverLine, thinner: number): void => {
    const { points, area, kind } = l, threads = l.threads;
    const classOf = (i: number): number => Math.max(0, widthClass(area[i] / (threads?.[i] ?? 1)) - thinner);
    let k = classOf(0), c = colourOf(kind[0]), d = `M${format(points[0])},${format(points[1])}`;
    for (let i = 1; i < area.length; i++) {
      d += `L${format(points[2 * i])},${format(points[2 * i + 1])}`;
      const next = classOf(i), colour = colourOf(kind[i]);
      if (next !== k || colour !== c || i === area.length - 1) {
        add(k, c, d);
        k = next; c = colour; d = `M${format(points[2 * i])},${format(points[2 * i + 1])}`;
      }
    }
  };
  const rivers = water.rivers;
  if (display.riverMode === 'vector' && rivers) {
    // Oxbows and paleochannels one class thinner than their river.
    if (display.showOxbows) for (const o of rivers.oxbows) line(o, 1);
    for (const l of rivers.braids) line(l, 0);
    for (const l of rivers.distributaries) line(l, 0);
    for (const l of rivers.rivers) line(l, 0);
  } else for (let c = 0; c < n * n; c++) {
    const a = h.accumulation[c], next = h.receiver[c];
    if (h.sea[c] || water.lake[c] || a < threshold || next < 0) continue;
    const x = c % n, y = (c - x) / n, nx = next % n, ny = (next - nx) / n;
    add(widthClass(a), edge, `M${format((x + 0.5) * cell)},${format((y + 0.5) * cell)}L${format((nx + 0.5) * cell)},${format((ny + 0.5) * cell)}`);
  }
  let svg = `<g class="water">${display.showLakes ? `<path d="${lakeShores(water)}" fill="${edge}" fill-rule="evenodd" stroke="none"/>` : ''}`;
  for (const [key, d] of groups) {
    const [k, colour] = key.split('|');
    svg += `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${(0.7 + 0.45 * Number(k)).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
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
