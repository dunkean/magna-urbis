import { encodePng, pngDataUrl } from '../../web/src/render/raster';
import { PALETTES } from '../../web/src/render/styles';
import { lakeMaterialSvg, RENDER_WATER_SHORE } from '../../web/src/render/terrainWater';
import type { HydrologyData, HydrologyOverlay } from './hydrology';
import type { TerrainStyle } from './terrainRender';

export const HYDROLOGY_LEGENDS: Record<HydrologyOverlay, string> = {
  none: 'Vector water: lakes and banks at their physical width.',
  basins: 'One color per watershed draining to the same outlet; transparent sea.',
  accumulation: 'Drained area: blue → turquoise → yellow → red, logarithmic scale in m².',
  flow: 'Downstream arrows; drainage is sampled to keep the map readable.',
  depressions: 'Depressions: difference between spill elevation and terrain, light blue → dark blue.',
  lakes: 'Retained lakes: depth below water level, light blue → dark blue.',
  channels: 'Graph: orange = main channel, blue = tributaries; downstream arrows, points = sources and connections.',
  'raw-basins': 'Raw drainage: watersheds before convergent routing across flat surfaces.',
  'raw-accumulation': 'Raw drainage: contributing area before convergent routing.',
  'raw-flow': 'Raw drainage: directions before convergent routing.',
  'raw-depressions': 'Depressions before treatment: difference between the raw spill elevation and initial physical height.',
  flats: 'One color per flat component; physical slopes remain transparent.',
  'flat-rank': 'Land rank before lake aggregation: blue near outlets, red at high ranks; no elevation added.',
};
const format = (v: number): string => v.toFixed(2);
const diagnosticImages = new WeakMap<HydrologyData, Map<HydrologyOverlay, string>>();

function ring(points: Float32Array, start: number, end: number): string {
  if (end - start < 3) return '';
  // Midpoint quadratics make grid-derived shores smooth without adding vertices.
  const midpoint = (i: number, j: number): string => `${format((points[i * 2] + points[j * 2]) / 2)},${format((points[i * 2 + 1] + points[j * 2 + 1]) / 2)}`;
  let d = `M${midpoint(end - 1, start)}`;
  for (let i = start; i < end; i++) d += `Q${format(points[i * 2])},${format(points[i * 2 + 1])} ${midpoint(i, i + 1 < end ? i + 1 : start)}`;
  return d + 'Z';
}

export function riverBank(points: Float32Array, start: number, end: number): string {
  if (end - start < 2) return '';
  const left: number[][] = [], right: number[][] = [];
  for (let i = start; i < end; i++) {
    const prev = Math.max(start, i - 1), next = Math.min(end - 1, i + 1);
    const ax = points[i * 4] - points[prev * 4], ay = points[i * 4 + 1] - points[prev * 4 + 1];
    const bx = points[next * 4] - points[i * 4], by = points[next * 4 + 1] - points[i * 4 + 1];
    const al = Math.hypot(ax, ay), bl = Math.hypot(bx, by), radius = points[i * 4 + 2] / 2;
    const x = points[i * 4], y = points[i * 4 + 1];
    const nx = bl ? -by / bl : al ? -ay / al : 0, ny = bl ? bx / bl : al ? ax / al : 0;
    const px = al ? -ay / al : nx, py = al ? ax / al : ny;
    const denominator = 1 + px * nx + py * ny;
    // Intersect the incident offsets to keep the physical width through bends.
    // A two-radius miter limit bevels sharp reversals instead of forming spikes.
    if (denominator >= 0.5) {
      const ox = (px + nx) * radius / denominator, oy = (py + ny) * radius / denominator;
      left.push([x + ox, y + oy]); right.push([x - ox, y - oy]);
    } else {
      left.push([x + px * radius, y + py * radius], [x + nx * radius, y + ny * radius]);
      right.push([x - px * radius, y - py * radius], [x - nx * radius, y - ny * radius]);
    }
  }
  return [...left, ...right.reverse()].map((p, i) => `${i ? 'L' : 'M'}${format(p[0])},${format(p[1])}`).join('') + 'Z';
}

function diagnosticImage(data: HydrologyData, overlay: HydrologyOverlay): string {
  const cached = diagnosticImages.get(data)?.get(overlay);
  if (cached) return cached;
  const n = data.resolution, pixels = new Uint8Array(n * n * 4);
  const raw = overlay.startsWith('raw-'), mode = raw ? overlay.slice(4) : overlay;
  const basins = raw ? data.rawBasins : data.basins, accumulation = raw ? data.rawAccumulation : data.accumulation;
  const filled = raw ? data.rawFilled : data.filled, physical = raw ? data.rawDrainageHeight : data.drainageHeight;
  let max = 0;
  if (mode === 'accumulation') for (const value of accumulation) max = Math.max(max, value);
  if (mode === 'flat-rank') for (let i = 0; i < n * n; i++) if (data.flatLabels[i]) max = Math.max(max, data.flatRank[i]);
  if (mode === 'depressions' || overlay === 'lakes') for (let i = 0; i < n * n; i++) {
    max = Math.max(max, overlay === 'lakes' ? data.lakeDepth[i] : filled[i] - physical[i]);
  }
  const cellArea = (data.width / n) ** 2;
  for (let i = 0; i < n * n; i++) {
    if (!basins[i] || ((mode === 'flats' || mode === 'flat-rank') && !data.flatLabels[i])) continue;
    let r = 0, g = 0, b = 0, alpha = 150;
    if (mode === 'basins' || mode === 'flats') {
      let hash = Math.imul(mode === 'flats' ? data.flatLabels[i] : basins[i], 0x45d9f3b);
      hash = Math.imul(hash ^ hash >>> 16, 0x45d9f3b) >>> 0;
      r = 65 + (hash & 127); g = 65 + (hash >>> 8 & 127); b = 65 + (hash >>> 16 & 127);
    } else if (mode === 'accumulation' || mode === 'flat-rank') {
      const value = mode === 'flat-rank' ? data.flatRank[i] : accumulation[i] / cellArea;
      const largest = mode === 'flat-rank' ? max : max / cellArea;
      const t = Math.min(1, Math.log1p(value) / Math.max(1e-9, Math.log1p(largest)));
      r = Math.round(255 * Math.max(0, Math.min(1, (t - 0.45) * 2.5)));
      g = Math.round(220 * Math.sin(t * Math.PI)); b = Math.round(240 * (1 - t)); alpha = 170;
    } else {
      const depth = overlay === 'lakes' ? data.lakeLabels[i] ? data.lakeDepth[i] : 0 : Math.max(0, filled[i] - physical[i]);
      if (depth < 0.02) continue;
      const t = Math.log1p(depth) / Math.log1p(Math.max(0.02, max));
      r = Math.round(100 * (1 - t)); g = Math.round(190 - 130 * t); b = Math.round(235 - 80 * t); alpha = 200;
    }
    pixels.set([r, g, b, alpha], i * 4);
  }
  const svg = `<image width="${data.width}" height="${data.width}" href="${pngDataUrl(encodePng(pixels, n, n, 4, 1))}" opacity="0.85"/>`;
  let images = diagnosticImages.get(data);
  if (!images) { images = new Map(); diagnosticImages.set(data, images); }
  images.set(overlay, svg);
  return svg;
}

/** Water colour of a display style, shared by lakes and rivers. */
export function hydrologyWaterColour(style: TerrainStyle): string {
  if (style === 'render') return RENDER_WATER_SHORE;
  if (style === 'fantasy-ink') return '#666968';
  if (style === 'fantasy-color') return '#648f99';
  return style === 'copernicus' ? '#14527a' : PALETTES[style].waterEdge;
}

/** Shared lake material for live rendering and retained terrain exports. */
export function hydrologyLakeMaterial(data: HydrologyData): string {
  let lakes = '';
  for (let i = 0; i < data.lakeOffsets.length - 1; i++) lakes += ring(data.lakePoints, data.lakeOffsets[i], data.lakeOffsets[i + 1]);
  return lakes ? lakeMaterialSvg(data.waterField, data.resolution, data.width, lakes, 'hydrology-lake-material') : '';
}

/** River capsules for the GPU renderer: x0, y0, x1, y1, widths (m) at both ends, r, g, b. */
export function hydrologySegments(data: HydrologyData, colour: string): Float32Array {
  const r = parseInt(colour.slice(1, 3), 16) / 255, g = parseInt(colour.slice(3, 5), 16) / 255, b = parseInt(colour.slice(5, 7), 16) / 255;
  const p = data.riverPoints, out: number[] = [];
  for (let i = 0; i < data.riverCount; i++) {
    for (let k = data.riverOffsets[i]; k + 1 < data.riverOffsets[i + 1]; k++) {
      out.push(p[k * 4], p[k * 4 + 1], p[k * 4 + 4], p[k * 4 + 5], p[k * 4 + 2], p[k * 4 + 6], r, g, b);
    }
  }
  return Float32Array.from(out);
}

/** Display-only adapter: diagnostic rasters and full physical vector water are
 * retained in world coordinates, independently of camera-region terrain tiles. */
export function renderHydrology(data: HydrologyData, overlay: HydrologyOverlay, showWater: boolean, style: TerrainStyle = 'parchment'): string {
  const waterFill = hydrologyWaterColour(style);
  let svg = '';
  if (['basins', 'accumulation', 'depressions', 'lakes', 'raw-basins', 'raw-accumulation', 'raw-depressions', 'flats', 'flat-rank'].includes(overlay)) svg += diagnosticImage(data, overlay);
  if (showWater) {
    let lakes = '';
    for (let i = 0; i < data.lakeOffsets.length - 1; i++) lakes += ring(data.lakePoints, data.lakeOffsets[i], data.lakeOffsets[i + 1]);
    svg += `<defs><clipPath id="hydrology-map-clip"><rect width="${data.width}" height="${data.width}"/></clipPath></defs><g class="hydrology-water" clip-path="url(#hydrology-map-clip)" fill="${waterFill}"><path class="water-lakes" d="${lakes}" fill-rule="evenodd" stroke="${waterFill}" stroke-width="0.35" vector-effect="non-scaling-stroke"/>`;
    const junctionWidths = new Float32Array(data.nodePoints.length / 2);
    for (let i = 0; i < data.riverCount; i++) svg += `<path d="${riverBank(data.riverPoints, data.riverOffsets[i], data.riverOffsets[i + 1])}" stroke="none"/>`;
    for (let i = 0; i < data.riverCount; i++) {
      const start = data.riverOffsets[i], end = data.riverOffsets[i + 1] - 1;
      if (end <= start) continue;
      const from = data.riverMeta[i * 6 + 1], to = data.riverMeta[i * 6 + 2];
      junctionWidths[from] = Math.max(junctionWidths[from], data.riverPoints[start * 4 + 2]);
      junctionWidths[to] = Math.max(junctionWidths[to], data.riverPoints[end * 4 + 2]);
    }
    // Join the incident bank polygons at actual confluences. Mouths keep their
    // cross-section termination and are never expanded into terminal discs.
    for (let i = 0; i < junctionWidths.length; i++) if (data.nodeMeta[i * 3 + 2] === 1 && junctionWidths[i]) {
      svg += `<circle cx="${format(data.nodePoints[i * 2])}" cy="${format(data.nodePoints[i * 2 + 1])}" r="${format(junctionWidths[i] / 2)}"/>`;
    }
    if (style === 'render' && lakes) svg += hydrologyLakeMaterial(data);
    svg += '</g>';
  }
  if (overlay === 'flow' || overlay === 'raw-flow') {
    const n = data.resolution, cell = data.width / n, step = Math.max(4, Math.round(n / 40));
    const receivers = overlay === 'raw-flow' ? data.rawReceivers : data.receivers;
    let arrows = '';
    for (let y = step / 2 | 0; y < n; y += step) for (let x = step / 2 | 0; x < n; x += step) {
      const i = y * n + x, receiver = receivers[i];
      if (receiver >= n * n) continue;
      const dx = receiver % n - x, dy = Math.floor(receiver / n) - y, length = Math.hypot(dx, dy);
      if (!length) continue;
      const ux = dx / length, uy = dy / length, size = step * cell * 0.35;
      const ax = (x + 0.5) * cell, ay = (y + 0.5) * cell, bx = ax + ux * size, by = ay + uy * size;
      arrows += `M${format(ax)},${format(ay)}L${format(bx)},${format(by)}m${format((-ux - uy * 0.55) * size * 0.3)},${format((-uy + ux * 0.55) * size * 0.3)}L${format(bx)},${format(by)}l${format((-ux + uy * 0.55) * size * 0.3)},${format((-uy - ux * 0.55) * size * 0.3)}`;
    }
    svg += `<path d="${arrows}" fill="none" stroke="#a03431" stroke-width="1" vector-effect="non-scaling-stroke" opacity="0.8"/>`;
  }
  if (overlay === 'channels') {
    for (let i = 0; i < data.riverCount; i++) {
      let d = '';
      for (let j = data.riverOffsets[i]; j < data.riverOffsets[i + 1]; j++) d += `${j === data.riverOffsets[i] ? 'M' : 'L'}${format(data.riverPoints[j * 4])},${format(data.riverPoints[j * 4 + 1])}`;
      svg += `<path d="${d}" fill="none" stroke="${data.riverMeta[i * 6 + 4] & 1 ? '#e78424' : '#155ea6'}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
      // Direction belongs to the retained vector graph. Sampling the raster
      // arrows beside a relocated meander can misleadingly point across its bank.
      const start = data.riverOffsets[i], end = data.riverOffsets[i + 1];
      let length = 0;
      for (let j = start + 1; j < end; j++) length += Math.hypot(data.riverPoints[j * 4] - data.riverPoints[(j - 1) * 4], data.riverPoints[j * 4 + 1] - data.riverPoints[(j - 1) * 4 + 1]);
      const spacing = Math.max(data.width / 70, length / 12);
      let nextArrow = Math.min(length / 2, spacing / 2), along = 0, arrows = '';
      for (let j = start + 1; j < end; j++) {
        const ax = data.riverPoints[(j - 1) * 4], ay = data.riverPoints[(j - 1) * 4 + 1];
        const dx = data.riverPoints[j * 4] - ax, dy = data.riverPoints[j * 4 + 1] - ay, step = Math.hypot(dx, dy);
        while (step > 0 && nextArrow <= along + step && nextArrow < length) {
          const t = (nextArrow - along) / step, x = ax + dx * t, y = ay + dy * t;
          const size = Math.min(data.width / 350, length / 5), ux = dx / step, uy = dy / step;
          arrows += `M${format(x - ux * size - uy * size * 0.5)},${format(y - uy * size + ux * size * 0.5)}L${format(x)},${format(y)}L${format(x - ux * size + uy * size * 0.5)},${format(y - uy * size - ux * size * 0.5)}`;
          nextArrow += spacing;
        }
        along += step;
      }
      svg += `<path d="${arrows}" fill="none" stroke="#173c58" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
    }
    const radius = data.width / 500;
    for (let i = 0; i < data.nodePoints.length / 2; i++) svg += `<circle cx="${format(data.nodePoints[i * 2])}" cy="${format(data.nodePoints[i * 2 + 1])}" r="${radius}" fill="#fff" stroke="#25566c" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
  }
  return svg;
}
