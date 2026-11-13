/** SVG of the vector water chain and its diagnostics, in map metres. */
import type { RenderColors } from '../render/customColors';
import { encodePng, pngDataUrl } from '../render/raster';
import type { TerrainStyle } from '../../../rust/bridge/terrainRender';
import { channelWidth, type RiverLine } from './riverVectors';
import type { VectorWater } from './vectorWater';
import { marchingSquares } from '../gen/terrain/contour';
import { lakeSample } from './lakeGeometry';
import { hydrologyWaterColour, riverBank } from '../../../rust/bridge/hydrologyRender';
import { lakeMaterialSvg } from '../render/terrainWater';
import { headwaterGeometry, isHeadwater, type HeadwaterGeometry } from '../render/riverHeadwaters';
import { plumeRgb, regimeRgb, riverState, riverSymbol, waterClimate, waterRegimeActive, type RiverState, type RiverSymbol, type WaterClimate, type WaterSeason } from '../render/waterRegime';
import { styleTraits } from '../render/terrainStyle';

export { VECTOR_OVERLAYS, VECTOR_LEGENDS } from '../render/displayDiagnostics';
import type { VectorOverlay } from '../render/displayDiagnostics';
export type { VectorOverlay } from '../render/displayDiagnostics';

const format = (v: number): string => v.toFixed(1);

function rasterImage(rgba: Uint8Array, n: number, width: number, attributes = ''): string {
  return `<image width="${width}" height="${width}" href="${pngDataUrl(encodePng(rgba, n, n, 4, 1))}" ${attributes}/>`;
}

const shores = new WeakMap<VectorWater, string>();
/**
 * Contour the same continuous shore field as the GPU. Islands are holes.
 */
export function lakeShores(water: VectorWater): string {
  const cached = shores.get(water);
  if (cached !== undefined) return cached;
  const { n, width } = water.hydro, cell = width / n, step = cell / 4;
  const shore = water.lakeField;
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

export interface WaterDisplay {
  colors?: RenderColors; style: TerrainStyle; showLakes: boolean; showOxbows: boolean; riverArea: number; riverMode: 'vector' | 'grid'; overlay: VectorOverlay;
  /** Climate zone and season of the seasonal water regime (waterRegime.ts); none keeps perennial open water. */
  season?: WaterSeason;
  /** GPU segments for a painted material compositor: the colour carries the regime (regimeRgb) instead of the ink. */
  material?: boolean;
}

/** Climate of the display when it changes anything; undefined keeps every course perennial and open.
 * The painted water of a satellite ground carries no ice: its shader freezes the water from the land's snow. */
function displayClimate(display: Pick<WaterDisplay, 'season' | 'overlay' | 'material' | 'style'>): WaterClimate | undefined {
  if (!display.season?.zone || display.overlay === 'v-styles') return;
  const landIce = display.season.landIce ?? (!!display.material && styleTraits(display.style).satelliteVariant > 0);
  const c = waterClimate({ ...display.season, landIce });
  return waterRegimeActive(c) ? c : undefined;
}
const sizeMemo = new WeakMap<VectorWater, number>();
/** Seasonal state per drawn vertex. Size from the drawn width (the headwater taper reads as a small stream). */
function riverStates(water: VectorWater, geo: HeadwaterGeometry, climate: WaterClimate, threshold: number, line?: RiverLine): RiverState[] {
  const scale = water.widthScale ?? water.rivers?.widthScale ?? 1;
  let top = sizeMemo.get(water);
  if (top === undefined) {
    top = threshold;
    for (const l of water.rivers?.rivers ?? []) top = Math.max(top, l.area[l.area.length - 1] ?? 0);
    sizeMemo.set(water, top);
  }
  const w0 = channelWidth(threshold, scale), w1 = Math.max(w0 * 1.5, channelWidth(top, scale)), span = Math.log(w1 / w0);
  const p = geo.points, n = geo.widths.length, arc = new Float64Array(n);
  for (let i = 1; i < n; i++) arc[i] = arc[i - 1] + Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1]);
  const out: RiverState[] = [];
  for (let i = 0; i < n; i++) out.push(riverState(climate, Math.max(0, Math.min(1, Math.log(Math.max(geo.widths[i], w0 * .3) / w0) / span))));
  // A course dries over a distance, not at a vertex: dryness is averaged over about 500 m of channel.
  if (climate.aridity > 0 && n > 2) {
    const dry = out.map(s => s.dry);
    for (let i = 0, a = 0, b = 0, sum = 0; i < n; i++) {
      while (b < n && arc[b] - arc[i] <= 250) sum += dry[b++];
      while (arc[i] - arc[a] > 250) sum -= dry[a++];
      out[i].dry = sum / (b - a);
    }
  }
  // Through a confluence the water is one: over its last 400 m a tributary takes the dryness of the course it
  // joins, so a silt bed never switches to running water at the junction.
  const joined = line && climate.aridity > 0 && n > 1 ? receiverDry(water, line, climate, w0, span, scale) : undefined;
  if (joined !== undefined) for (let i = n - 1; i >= 0 && arc[n - 1] - arc[i] < 400; i--) {
    const t = 1 - (arc[n - 1] - arc[i]) / 400;
    out[i].dry += (joined - out[i].dry) * t * t * (3 - 2 * t);
  }
  return out;
}
const receivers = new WeakMap<VectorWater, Map<number, RiverLine>>();
/** Dryness of the course a line joins, from the size of the receiving channel at the junction; undefined where the
 * line ends in the sea, a lake or at the map edge. */
function receiverDry(water: VectorWater, line: RiverLine, climate: WaterClimate, w0: number, span: number, scale: number): number | undefined {
  if (line.joins === undefined || line.joins < 0) return;
  let byId = receivers.get(water);
  if (!byId) { byId = new Map(); for (const l of water.rivers?.rivers ?? []) if (l.id !== undefined) byId.set(l.id, l); receivers.set(water, byId); }
  const to = byId.get(line.joins), m = line.area.length - 1;
  if (!to || m < 0) return;
  const x = line.points[2 * m], y = line.points[2 * m + 1];
  let best = Infinity, at = 0;
  for (let k = 0; k < to.area.length; k++) { const d = (to.points[2 * k] - x) ** 2 + (to.points[2 * k + 1] - y) ** 2; if (d < best) { best = d; at = k; } }
  const width = channelWidth(to.area[at] / (to.threads?.[at] ?? 1), scale);
  return riverState(climate, Math.max(0, Math.min(1, Math.log(Math.max(width, w0 * .3) / w0) / span))).dry;
}
const mean = (a: RiverState, b: RiverState): RiverState => ({ dry: (a.dry + b.dry) / 2, ice: (a.ice + b.ice) / 2 });

export interface RegimeInk { intermittent: string; dry: string; dryDash: number[]; bed: string; ice: string; iceLine: string; shore: string; plume: string }
/** Ink of each regime symbol in a style: intermittent courses keep the water ink dashed, dry beds (wadis) a dash-dot
 * bed ink over a pale bed wash; the parchment draws both in brown, as the old surveys did. Frozen water: a pale
 * blue-grey sheet inside darker bank lines of the water ink. Dashes in screen pixels. */
export function regimeInk(style: TerrainStyle, edge: string): RegimeInk {
  if (style === 'night') return { intermittent: '#405875', dry: '#45546a', dryDash: [6, 2, 1.5, 2], bed: '#253749', ice: '#758ba0', iceLine: '#526d86', shore: '#35475a', plume: '#394552' };
  // Parchment: brown dash-dot ink over a pale sandy wash, the classic intermittent-stream symbol of the surveys.
  if (style === 'parchment') return { intermittent: '#6e5232', dry: '#6e5232', dryDash: [6, 2, 1.5, 2], bed: '#c9a874', ice: '#d9dfd8', iceLine: '#8e9d9a', shore: '#e0d2ae', plume: '#9c8458' };
  if (style === 'render3d' || style === 'render') return { intermittent: edge, dry: '#8c6f4c', dryDash: [5, 2, 1.2, 2], bed: '#cdb48a', ice: '#cbd9e2', iceLine: '#90a9ba', shore: '#cdbf9f', plume: '#8f7a52' };
  return { intermittent: edge, dry: '#86663f', dryDash: [5, 2, 1.2, 2], bed: '#e3d4b2', ice: '#d4e2eb', iceLine: '#8fb0c6', shore: '#e6dcc4', plume: '#a89870' };
}
/** Ice bank line width (m): a fraction of the channel, kept between 0.6 m and 3.5 m. */
const iceEdge = (w: number): number => Math.min(3.5, Math.max(.6, .16 * w));

interface RegimeGroup { symbol: RiverSymbol; colour: string; banks: string; inner: string; axes: string }
const groupMemo = new WeakMap<VectorWater, Map<string, RegimeGroup[]>>();
/** River runs of one symbol and colour: bank outline (with joins and caps), the inset ice sheet and the axis. A genuine
 * headwater keeps its taper in every state (no cap at the source). Memoized per network and display. */
function regimeGroups(water: VectorWater, display: WaterDisplay): RegimeGroup[] {
  const key = JSON.stringify([display.style, display.colors, display.showLakes, display.showOxbows, display.riverArea, display.overlay, display.season]);
  let memo = groupMemo.get(water); if (!memo) groupMemo.set(water, memo = new Map());
  const found = memo.get(key); if (found) return found;
  const network = water.rivers!, { colourOf } = waterInk(display);
  const groups = new Map<string, RegimeGroup>();
  const climate = displayClimate(display), threshold = display.riverArea * 1e6;
  const lines: [RiverLine, number][] = [
    ...(display.showOxbows ? network.oxbows.map(l => [l, 1] as [RiverLine, number]) : []),
    ...network.braids.map(l => [l, 0] as [RiverLine, number]),
    ...network.distributaries.map(l => [l, 0] as [RiverLine, number]),
    ...network.rivers.map(l => [l, 0] as [RiverLine, number]),
    ...(!display.showLakes ? (network.lakeLinks ?? []).map(l => [l, 0] as [RiverLine, number]) : []),
  ];
  const cap = (x: number, y: number, r: number): string => r <= 0 ? '' : `M${format(x + r)},${format(y)}a${format(r)},${format(r)} 0 1 0 ${format(-2 * r)},0a${format(r)},${format(r)} 0 1 0 ${format(2 * r)},0Z`;
  for (const [line, thinner] of lines) {
    const geo = riverGeometry(water, line, thinner, display.riverArea), widths = geo.widths, packed = new Float32Array(widths.length * 4);
    for (let k = 0; k < widths.length; k++) packed.set([geo.points[2 * k], geo.points[2 * k + 1], widths[k], geo.level[k]], k * 4);
    const states = climate ? riverStates(water, geo, climate, threshold, line) : undefined;
    const symbolAt = (k: number): RiverSymbol => states ? riverSymbol(mean(states[k], states[k + 1])) : 'water';
    let inset: Float32Array | undefined;
    let start = 0;
    while (start + 1 < widths.length) {
      const colour = colourOf(geo.kind[start]), symbol = symbolAt(start);
      let end = start + 1;
      while (end + 1 < widths.length && colourOf(geo.kind[end]) === colour && symbolAt(end) === symbol) end++;
      const id = `${symbol}${colour}`, group = groups.get(id) ?? { symbol, colour, banks: '', inner: '', axes: '' };
      group.banks += riverBank(packed, start, end + 1);
      // Round terminal caps and incident bank joins, like the GPU capsules. A headwater source has none:
      // its bank closes on a point and the hairline axis below is the pen's first touch.
      const caps = start === 0 && geo.reach > 0 ? [end] : [start, end];
      for (const k of caps) group.banks += cap(packed[k * 4], packed[k * 4 + 1], widths[k] / 2);
      if (symbol === 'ice') {
        if (!inset) { inset = packed.slice(); for (let k = 0; k < widths.length; k++) inset[k * 4 + 2] = Math.max(0, widths[k] - 2 * iceEdge(widths[k])); }
        group.inner += riverBank(inset, start, end + 1);
        for (const k of caps) group.inner += cap(inset[k * 4], inset[k * 4 + 1], inset[k * 4 + 2] / 2);
      }
      group.axes += `M${geo.points.slice(2 * start, 2 * end + 2).map((v, k) => (k % 2 ? ',' : k ? 'L' : '') + format(v)).join('')}`;
      groups.set(id, group); start = end;
    }
  }
  const out = [...groups.values()];
  memo.set(key, out);
  return out;
}

/** The same tapered banks as the 2D ink, rasterized by each 3D tile at its own density. */
export function vectorRiverPath(water: VectorWater, display: WaterDisplay): Path2D {
  const path = new Path2D();
  if (water.rivers) for (const group of regimeGroups(water, { ...display, season: undefined })) path.addPath(new Path2D(group.banks));
  return path;
}

/** River mouths with a sediment plume: mouth point, seaward unit direction, mouth width (m) and strength 0-1. */
function plumeMouths(water: VectorWater, display: WaterDisplay, climate: WaterClimate | undefined): { x: number; y: number; dx: number; dy: number; w: number; strength: number }[] {
  if (!climate || climate.sediment < .05 || !water.rivers) return [];
  const h = water.hydro, cell = h.width / h.n, threshold = display.riverArea * 1e6, out = [];
  const scale = water.widthScale ?? water.rivers.widthScale ?? 1;
  let top = threshold; for (const l of water.rivers.rivers) top = Math.max(top, l.area[l.area.length - 1] ?? 0);
  for (const l of [...water.rivers.rivers, ...water.rivers.distributaries]) {
    const p = l.points, m = l.area.length - 1;
    if (m < 2) continue;
    const ix = Math.floor(p[2 * m] / cell), iy = Math.floor(p[2 * m + 1] / cell);
    const atSea = (ix >= 0 && iy >= 0 && ix < h.n && iy < h.n && h.sea[iy * h.n + ix]) || h.sea[l.outlet ?? -1];
    if (!atSea) continue;
    // Size of the course on the map's own scale: brooks carry no visible plume.
    const q = Math.log(Math.max(1, l.area[m] / threshold)) / Math.log(Math.max(2, top / threshold));
    const strength = climate.sediment * Math.min(1, Math.max(0, (q - .35) / .45));
    if (strength < .05) continue;
    let k = m; while (k > 0 && Math.hypot(p[2 * m] - p[2 * k], p[2 * m + 1] - p[2 * k + 1]) < 120) k--;
    const dx = p[2 * m] - p[2 * k], dy = p[2 * m + 1] - p[2 * k + 1], len = Math.hypot(dx, dy) || 1;
    out.push({ x: p[2 * m], y: p[2 * m + 1], dx: dx / len, dy: dy / len, w: channelWidth(l.area[m], scale), strength });
  }
  return out;
}
/** Plume fan of one mouth as capsules (centre x, y and width per step), spreading and fading seaward. */
function plumeSteps(mouth: { x: number; y: number; dx: number; dy: number; w: number }): { x: number; y: number; w: number; t: number }[] {
  const length = Math.min(1800, Math.max(200, mouth.w * 28)), steps = 7, out = [];
  let hash = Math.imul(Math.round(mouth.x) ^ Math.imul(Math.round(mouth.y), 668265263), 374761393); hash = (hash ^ (hash >>> 13)) >>> 0;
  const bend = ((hash & 255) / 255 - .5) * .7;
  for (let i = 0; i <= steps; i++) {
    // The fan starts one and a half channel widths offshore: its first capsule must not lie over the end of
    // the river, where its silt code would replace the river's own water.
    const t = i / steps, along = 1.5 * mouth.w + length * t, side = bend * length * t * t;
    out.push({ x: mouth.x + mouth.dx * along - mouth.dy * side, y: mouth.y + mouth.dy * along + mouth.dx * side, w: mouth.w * (1.2 + 3.5 * t) + along * .35, t });
  }
  return out;
}
/** Lake draw-down ring width (m): the shore the dry season exposes. */
const shoreRing = (climate: WaterClimate | undefined): number => climate ? 80 * climate.drop : 0;

/** Shared water colour and per-vertex diagnostic colours. */
function waterInk(display: Pick<WaterDisplay, 'style' | 'riverArea' | 'overlay' | 'colors'>): { edge: string; colourOf: (kind: number) => string } {
  const s = display.style;
  // Lakes take the rivers' colour: a river runs into its lake without a seam.
  const edge = hydrologyWaterColour(s, display.colors);
  const styled = display.overlay === 'v-styles';
  const colourOf = (kind: number): string => !styled ? edge : ['#2a6fc9', '#c62828', '#7b1fa2', '#ef6c00', '#d81b60', '#2e7d32'][kind] ?? edge;
  return { edge, colourOf };
}

/** Lake colour of a display style. */
export const lakeColour = (display: Pick<WaterDisplay, 'style' | 'riverArea' | 'overlay' | 'colors'>): string => waterInk(display).edge;

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
  const climate = displayClimate(display), ink = climate && !display.material ? regimeInk(display.style, edge) : undefined;
  const line = (l: RiverLine, thinner: number): void => {
    const geo = riverGeometry(water, l, thinner, display.riverArea), { points, widths, kind } = geo;
    const states = climate || display.material ? riverStates(water, geo, climate ?? { aridity: 0, rain: 1, ice: 0, sediment: 0, drop: 0 }, threshold, l) : undefined;
    for (let i = 1; i < widths.length; i++) {
      const x0 = points[2 * i - 2], y0 = points[2 * i - 1], x1 = points[2 * i], y1 = points[2 * i + 1];
      if (!states) { push(x0, y0, x1, y1, widths[i - 1], widths[i], colourOf(kind[i - 1])); continue; }
      if (display.material) {
        // The regime is per vertex: a long segment is cut into pieces of interpolated colour, so a course dries or
        // freezes gradually along its channel instead of switching state at each vertex.
        const c0 = regimeRgb(states[i - 1]), c1 = regimeRgb(states[i]);
        const steps = Math.max(1, Math.min(12, Math.ceil(Math.max(Math.abs(c1[0] - c0[0]), Math.abs(c1[1] - c0[1])) / .04)));
        for (let k = 0; k < steps; k++) {
          const t0 = k / steps, t1 = (k + 1) / steps, t = (t0 + t1) / 2, at = (a: number, b: number, u: number): number => a + (b - a) * u;
          out.push(at(x0, x1, t0), at(y0, y1, t0), at(x0, x1, t1), at(y0, y1, t1), at(widths[i - 1], widths[i], t0), at(widths[i - 1], widths[i], t1), at(c0[0], c1[0], t), at(c0[1], c1[1], t), at(c0[2], c1[2], t));
        }
        continue;
      }
      const state = mean(states[i - 1], states[i]);
      // Ink styles: the vector layer draws intermittent and dry courses as symbols over the land.
      const symbol = riverSymbol(state);
      if (symbol === 'water' || symbol === 'ice') push(x0, y0, x1, y1, widths[i - 1], widths[i], symbol === 'ice' ? ink!.ice : colourOf(kind[i - 1]));
    }
  };
  const rivers = water.rivers;
  if ((display.riverMode === 'vector' || water.editedNetwork) && rivers) {
    // Sediment plumes first: the river capsules (MAX blend) keep their own regime where they overlap.
    if (display.material) for (const mouth of plumeMouths(water, display, climate)) {
      const steps = plumeSteps(mouth);
      for (let i = 1; i < steps.length; i++) {
        const [r, g, b] = plumeRgb(mouth.strength * (1 - steps[i - 1].t));
        out.push(steps[i - 1].x, steps[i - 1].y, steps[i].x, steps[i].y, steps[i - 1].w, steps[i].w, r, g, b);
      }
    }
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

const headwaterMemo = new WeakMap<VectorWater, Map<number, Set<RiverLine>>>();
/** Main rivers that are genuine headwaters at this display threshold (m²); cached per network. */
function headwaterSet(water: VectorWater, threshold: number): Set<RiverLine> {
  let byThreshold = headwaterMemo.get(water); if (!byThreshold) headwaterMemo.set(water, byThreshold = new Map());
  let set = byThreshold.get(threshold);
  if (!set) {
    set = new Set();
    const net = water.rivers;
    if (net) { const ctx = { rivers: net.rivers, lakeLinks: net.lakeLinks, hydro: water.hydro, lake: water.lake }; for (const l of net.rivers) if (isHeadwater(l, ctx, threshold)) set.add(l); }
    byThreshold.set(threshold, set);
  }
  return set;
}
/** River line geometry as drawn: a genuine headwater emerges from zero width instead of starting as a full-width disc (every style). */
export function riverGeometry(water: VectorWater, line: RiverLine, thinner: number, riverAreaKm2: number): HeadwaterGeometry {
  const widths = riverWidths(water, line, thinner);
  return headwaterSet(water, riverAreaKm2 * 1e6).has(line) ? headwaterGeometry(line, widths) : { points: line.points, widths, level: line.level, kind: line.kind, reach: 0 };
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

export function vectorWaterSvg(water: VectorWater, display: WaterDisplay, material = true): string {
  const { edge } = waterInk(display), climate = displayClimate(display), ink = regimeInk(display.style, edge);
  // Frozen lakes: a pale sheet inside a bank line of the water ink. Dry season: a pale exposed shore inside the lake.
  const lakeFrozen = !!climate && climate.ice >= .5, ring = lakeFrozen ? 0 : shoreRing(climate), lakes = display.showLakes ? lakeShores(water) : '';
  const lakeFill = lakeFrozen ? ink.ice : edge;
  const lakeStroke = lakeFrozen ? ` stroke="${edge}" stroke-width="1.1" stroke-opacity="0.9" vector-effect="non-scaling-stroke"` : ' stroke="none"';
  let svg = `<g class="water">`;
  // Sediment plumes: soft fans of muted silt over the sea, under the rivers.
  for (const mouth of plumeMouths(water, display, climate)) {
    const steps = plumeSteps(mouth);
    for (let i = 1; i < steps.length; i++) {
      const a = steps[i - 1], b = steps[i], na = [-mouth.dy * a.w / 2, mouth.dx * a.w / 2], nb = [-mouth.dy * b.w / 2, mouth.dx * b.w / 2];
      svg += `<path d="M${format(a.x + na[0])},${format(a.y + na[1])}L${format(b.x + nb[0])},${format(b.y + nb[1])}L${format(b.x - nb[0])},${format(b.y - nb[1])}L${format(a.x - na[0])},${format(a.y - na[1])}Z" fill="${ink.plume}" fill-opacity="${(.22 * mouth.strength * (1 - a.t)).toFixed(3)}" stroke="none"/>`;
    }
  }
  if (lakes) {
    svg += `<path class="water-lakes" d="${lakes}" fill="${lakeFill}" fill-rule="evenodd"${lakeStroke}/>`;
  }
  if ((display.riverMode === 'vector' || water.editedNetwork) && water.rivers) {
    for (const { colour, symbol, axes, banks, inner } of regimeGroups(water, display)) {
      if (symbol === 'water') {
        svg += `<path d="${axes}" fill="none" stroke="${colour}" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
        svg += `<path d="${banks}" fill="${colour}" stroke="none"/>`;
      } else if (symbol === 'ice') {
        // Frozen: the course keeps its water-ink banks as two darker bank lines; inside, a pale blue-grey sheet with
        // faint streaks along the flow. Hairline streams show as a blue-grey line, never a white band.
        svg += `<path d="${axes}" fill="none" stroke="${ink.iceLine}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
        svg += `<path d="${banks}" fill="${colour}" stroke="none"/>`;
        svg += `<path d="${inner}" fill="${ink.ice}" stroke="none"/>`;
        svg += `<path d="${axes}" fill="none" stroke="${ink.iceLine}" stroke-width="0.6" stroke-opacity="0.45" stroke-dasharray="14 9" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
      } else {
        // Dry and intermittent beds retain the full river outline as a plain silt band.
        svg += `<path d="${banks}" fill="${ink.bed}" stroke="${ink.dry}" stroke-width="0.6" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
      }
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
  if (material && display.showLakes && !lakeFrozen) svg += vectorLakeMaterial(water, display.style, display.colors);
  // The exposed shore lies over the lake material and the river mouths, inside the lake only.
  if (lakes && ring > 1) svg += `<clipPath id="water-regime-lakes"><path d="${lakes}" clip-rule="evenodd"/></clipPath><path d="${lakes}" fill="none" stroke="${ink.shore}" stroke-width="${format(2 * ring)}" stroke-linejoin="round" clip-path="url(#water-regime-lakes)"/>`;
  return svg + '</g>';
}

/**
 * The seasonal regime on a 3D ground tile, `ctx` transformed to map metres, `mpp` metres per tile pixel.
 * - `erase`: removes dry and frozen water (and frozen lakes, with `lakes`) from a water cover mask, then redraws the
 *   running courses in `fill` so a dry tributary never notches its trunk;
 * - `ground`: dry beds, ice and exposed lake shores as ground albedo (material grounds);
 * - `ink`: the map symbols of the style (map grounds).
 * Returns false when the regime changes nothing.
 */
export function paintWaterRegime(ctx: CanvasRenderingContext2D, water: VectorWater, display: WaterDisplay, mode: 'erase' | 'ground' | 'ice' | 'ink', mpp: number, lakes?: Path2D, fill = '#4a86b3'): boolean {
  const climate = displayClimate(display);
  if (!climate || display.riverMode !== 'vector' || !water.rivers) return false;
  const groups = regimeGroups(water, display), { edge } = waterInk(display), ink = regimeInk(display.style, edge);
  const paths = groups.map(g => ({ ...g, banksPath: new Path2D(g.banks), axesPath: new Path2D(g.axes), innerPath: g.inner ? new Path2D(g.inner) : undefined }));
  const lakeFrozen = climate.ice >= .5, ring = lakeFrozen ? 0 : shoreRing(climate);
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (mode === 'erase') {
    const cell = water.hydro.width / water.hydro.n;
    ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = ctx.strokeStyle = '#000'; ctx.lineWidth = 2.5 * cell;
    for (const g of paths) if (g.symbol !== 'water') { ctx.fill(g.banksPath); ctx.stroke(g.axesPath); }
    if (lakeFrozen && lakes) ctx.fill(lakes, 'evenodd');
    if (ring > 1 && lakes) { ctx.save(); ctx.clip(lakes, 'evenodd'); ctx.lineWidth = 2 * ring; ctx.stroke(lakes); ctx.restore(); }
    ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = ctx.strokeStyle = fill;
    for (const g of paths) if (g.symbol === 'water') ctx.fill(g.banksPath);
    // A material water cover (3D) keeps a shrunken low-water thread in the intermittent courses, as the 2D compositor
    // keeps its pools: a running trunk narrows into its bed instead of stopping short. Ink styles draw their symbol.
    if (display.style === 'render3d') for (const g of paths) if (g.symbol === 'intermittent') {
      ctx.save(); ctx.clip(g.banksPath); ctx.lineWidth = 1.4 * cell; ctx.stroke(g.axesPath); ctx.restore();
    }
    ctx.restore(); return true;
  }
  // Material grounds: `ground` paints the dry beds and exposed shores as albedo, `ice` the ice as a decal over the
  // finished (snowed) ground, so a frozen course never vanishes under the snow cover.
  const px = (v: number): number => v * mpp, material = mode !== 'ink', iceOn = mode !== 'ground', dryOn = mode !== 'ice';
  if (lakes && lakeFrozen && iceOn) { ctx.fillStyle = material ? '#a9bac6' : ink.ice; ctx.fill(lakes, 'evenodd'); ctx.strokeStyle = material ? '#55697a' : edge; ctx.lineWidth = px(1.6); ctx.stroke(lakes); }
  if (lakes && ring > 1 && dryOn) { ctx.save(); ctx.clip(lakes, 'evenodd'); ctx.strokeStyle = material ? '#b9ab8e' : ink.shore; ctx.lineWidth = 2 * ring; ctx.stroke(lakes); ctx.restore(); }
  for (const g of paths) {
    if (g.symbol === 'water' || (g.symbol === 'ice' ? !iceOn : !dryOn)) continue;
    if (g.symbol === 'ice') {
      ctx.strokeStyle = material ? '#7f97a8' : ink.iceLine; ctx.lineWidth = px(1.2); ctx.stroke(g.axesPath);
      ctx.fillStyle = material ? '#55697a' : g.colour; ctx.fill(g.banksPath);
      if (g.innerPath) { ctx.fillStyle = material ? '#a9bac6' : ink.ice; ctx.fill(g.innerPath); }
      continue;
    }
    ctx.fillStyle = ink.bed; ctx.fill(g.banksPath);
    ctx.save(); ctx.clip(g.banksPath); ctx.strokeStyle = ink.dry;
    ctx.lineWidth = px(1.2); ctx.stroke(g.banksPath); ctx.restore();
  }
  ctx.restore();
  return true;
}

/** Shared lake material for live rendering and retained terrain exports. */
export function vectorLakeMaterial(water: VectorWater, style: TerrainStyle = 'render', colors?: RenderColors): string {
  const path = lakeShores(water);
  return path ? lakeMaterialSvg(water.lakeField.values, water.hydro.n, water.hydro.width, path, 'vector-lake-material', style, water.hydro.width, colors) : '';
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
