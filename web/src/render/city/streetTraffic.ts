import type { Point } from '../../../../rust/bridge/urban';
import { STRUCTURE_ROLES } from '../groundBlend';
import { pavedRank, streetRank } from '../roadStyle';
import type { RoadPavement } from '../roadPavement';

/** Physical material of a travelled town street; reused by the exact plan and the live mesh. */
export function streetTraffic(s: { role: string; rank: number; width: number }, pavement?: RoadPavement, population = 0): 'stone' | 'cart' | 'foot' | undefined {
  if (STRUCTURE_ROLES.has(s.role) || ['stairs', 'mole', 'landing', 'square', 'plaza'].includes(s.role) || pavedRank(streetRank(s.role, s.rank), pavement)) return undefined;
  if (s.rank <= 1 && s.role !== 'track' && population >= 2000) return 'stone';
  return s.width >= 2.65 ? 'cart' : 'foot';
}

export const WHEEL_OFFSET = 0.72;
/** Both wheel depressions follow one wandering axle. Leave the turning ground at the ends unwritten. */
export function wheelPaths(points: readonly Point[]): Path2D {
  const path = new Path2D();
  const sections: { x: number; y: number; nx: number; ny: number; shift: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      dx = b.x - a.x,
      dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.01) continue;
    const start = i === 1 ? Math.min(1.6, length * 0.2) : 0;
    const end = i === points.length - 1 ? length - Math.min(1.6, length * 0.2) : length;
    const steps = Math.max(1, Math.ceil((end - start) / 3));
    for (let j = 0; j <= steps; j++) {
      const t = (start + ((end - start) * j) / steps) / length;
      const x = a.x + t * dx,
        y = a.y + t * dy;
      sections.push({ x, y, nx: -dy / length, ny: dx / length, shift: 0.19 * Math.sin(x * 0.13 + y * 0.17) + 0.12 * Math.sin(x * 0.29 - y * 0.09) });
    }
  }
  for (const side of [-1, 1]) {
    sections.forEach(({ x, y, nx, ny, shift }, i) => {
      const offset = side * WHEEL_OFFSET + shift;
      if (i) path.lineTo(x + nx * offset, y + ny * offset);
      else path.moveTo(x + nx * offset, y + ny * offset);
    });
  }
  return path;
}
