import type { LandUseLayer } from '../gen/types';

/** All coordinate lists (including one huge polygon, farms and corridors) travel as typed buffers. */
export interface PackedOccupationLanduse { tree: unknown; lengths: Uint32Array; coordinates: Float64Array }
export function packOccupationLanduse(landuse: LandUseLayer): PackedOccupationLanduse {
  const rings: { x: number; y: number }[][] = [];
  let points = 0;
  const visit = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      const p = value[0];
      if (p && typeof p.x === 'number' && typeof p.y === 'number') {
        const id = rings.length; rings.push(value); points += value.length;
        return { __occupationRing: id };
      }
      return value.map(visit);
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]));
  };
  const tree = visit(landuse), lengths = new Uint32Array(rings.length), coordinates = new Float64Array(points * 2);
  let at = 0;
  rings.forEach((ring, i) => {
    lengths[i] = ring.length;
    for (const p of ring) { coordinates[at++] = p.x; coordinates[at++] = p.y; }
  });
  return { tree, lengths, coordinates };
}
export function unpackOccupationLanduse(packed: PackedOccupationLanduse): LandUseLayer {
  let at = 0;
  const rings = Array.from(packed.lengths, length => Array.from({ length }, () => {
    const point = { x: packed.coordinates[at], y: packed.coordinates[at + 1] }; at += 2; return point;
  }));
  const visit = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(visit);
    if ('__occupationRing' in value) return rings[(value as { __occupationRing: number }).__occupationRing];
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]));
  };
  return visit(packed.tree) as LandUseLayer;
}
