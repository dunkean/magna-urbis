import type { Point, Street } from './urban';

/** Same tapered quadrilaterals and interior discs as the native street ribbon. */
export function streetSurfacePath(street: Street): string {
  const pieces: string[] = [];
  const half = (i: number): number => (street.widths[i] ?? street.widths[0] ?? 4) * 0.5;
  const polygon = (points: Point[]): string => points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ') + 'Z';
  for (let i = 1; i < street.path.length; i++) {
    const a = street.path[i - 1], b = street.path[i], length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1e-7) continue;
    const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
    const wa = half(i - 1), wb = half(i);
    pieces.push(polygon([{ x: a.x + nx * wa, y: a.y + ny * wa }, { x: a.x - nx * wa, y: a.y - ny * wa },
      { x: b.x - nx * wb, y: b.y - ny * wb }, { x: b.x + nx * wb, y: b.y + ny * wb }]));
  }
  for (let i = 1; i + 1 < street.path.length; i++) {
    const p = street.path[i], w = half(i);
    pieces.push(polygon(Array.from({ length: 12 }, (_, j) => ({ x: p.x + w * Math.cos(j * Math.PI / 6), y: p.y + w * Math.sin(j * Math.PI / 6) }))));
  }
  return pieces.join(' ');
}
