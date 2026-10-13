import { marchingSquares } from '../../web/src/gen/terrain/contour';
import { vectorWaterSvg } from '../../web/src/ui/vectorWaterRender';
import { renderHydrology } from './hydrologyRender';
import type { TerrainData } from './terrain';
import type { SettlementRaster } from './settlements';
import type { Point } from './urban';

export interface VectorGeography { land: Point[][]; water: Point[][][] }
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Flatten the midpoint quadratics used by Terrain Bench to a sub-metre tolerance. */
export function landRings(height: Float32Array, n: number, width: number): Point[][] {
  const size = n + 4, cell = width / n, field = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const h = height[Math.max(0, Math.min(n - 1, y - 2)) * n + Math.max(0, Math.min(n - 1, x - 2))];
    field[y * size + x] = x === 0 || y === 0 || x === size - 1 || y === size - 1 ? -Math.max(1, Math.abs(h)) : h;
  }
  return marchingSquares(field, size, size, 0, cell, -1.5 * cell, -1.5 * cell).filter(p => p.closed && p.pts.length >= 3).map(path => {
    const points = path.pts, ring: Point[] = [];
    for (let i = 0; i < points.length; i++) {
      const control = points[i], start = midpoint(points[(i + points.length - 1) % points.length], control), end = midpoint(control, points[(i + 1) % points.length]);
      const steps = Math.max(1, Math.ceil(Math.sqrt(Math.hypot(start.x - 2 * control.x + end.x, start.y - 2 * control.y + end.y) / 0.2)));
      for (let j = 0; j < steps; j++) {
        const t = j / steps, u = 1 - t;
        ring.push({ x: u * u * start.x + 2 * u * t * control.x + t * t * end.x, y: u * u * start.y + 2 * u * t * control.y + t * t * end.y });
      }
    }
    return ring;
  });
}

/** Physical filled paths only; no diagnostics, centerlines, labels or SVG execution. */
export function waterRings(svg: string): Point[][][] {
  const groups: Point[][][] = [];
  for (const match of svg.matchAll(/<path\b([^>]+)>/g)) {
    const attrs = match[1], data = /\bd="([^"]+)"/.exec(attrs)?.[1];
    if (!data || /\bfill="none"/.test(attrs)) continue;
    const tokens = data.match(/[MLQZmlqz]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? [];
    const rings: Point[][] = []; let ring: Point[] = [], last: Point = { x: 0, y: 0 }, command = '', i = 0;
    while (i < tokens.length) {
      if (/^[a-z]$/i.test(tokens[i])) command = tokens[i++];
      if (command === 'Z' || command === 'z') { if (ring.length >= 3) rings.push(ring); ring = []; command = ''; continue; }
      if (!['M', 'L', 'Q'].includes(command)) break;
      const count = command === 'Q' ? 4 : 2;
      if (i + count > tokens.length || tokens.slice(i, i + count).some(v => !Number.isFinite(Number(v)))) break;
      const values = tokens.slice(i, i + count).map(Number); i += count;
      if (command === 'Q') {
        const control = { x: values[0], y: values[1] }, end = { x: values[2], y: values[3] };
        const steps = Math.max(1, Math.ceil(Math.sqrt(Math.hypot(last.x - 2 * control.x + end.x, last.y - 2 * control.y + end.y) / 0.2)));
        for (let j = 1; j <= steps; j++) { const t = j / steps, u = 1 - t; ring.push({ x: u * u * last.x + 2 * u * t * control.x + t * t * end.x, y: u * u * last.y + 2 * u * t * control.y + t * t * end.y }); }
        last = end;
      } else { last = { x: values[0], y: values[1] }; ring.push(last); if (command === 'M') command = 'L'; }
    }
    if (rings.length) groups.push(rings);
  }
  return groups;
}
export const landPath = (rings: Point[][]): string => rings.map(r => r.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ') + 'Z').join(' ');

export function terrainGeography(t: TerrainData): VectorGeography {
  const height = t.field?.data ?? t.height, n = t.field?.n ?? t.resolution;
  const water = t.water ? vectorWaterSvg(t.water, { style: 'atlas', showLakes: true, showOxbows: true, riverArea: 1, riverMode: 'vector', overlay: 'none' }) : t.hydrology ? renderHydrology(t.hydrology, 'none', true, 'atlas') : '';
  return { land: landRings(height, n, t.width), water: waterRings(water) };
}
/** Older decors retain their measured heights; their saved vector water is authoritative. */
export function decorGeography(r: SettlementRaster, svg: string): VectorGeography {
  const water = waterRings(svg);
  if (!water.length && r.water.some(v => v >= 2)) {
    const field = Float32Array.from(r.water, v => v >= 2 ? 1 : -1);
    water.push(landRings(field, r.n, r.width));
  }
  return { land: landRings(r.height, r.n, r.width), water };
}
