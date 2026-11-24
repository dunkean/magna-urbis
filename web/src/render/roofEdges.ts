import type { BuildingTriangle } from './urbanBuildingGeometry';

/** Plan area (m²) from which a horizontal face of a wall material is inked: the rim of a parapet, the top of a stair head. */
const RIM_AREA = 0.1;
/** A parapet stands over the outline of its flat roof: its rim, a level face of the wall's material, takes the edges the
 * roof's own pan would show. Sloped and vertical wall faces, openings and small ledges take none. */
function isRim({ normal, points }: BuildingTriangle): boolean {
  if (normal[2] < 0.999 * Math.hypot(...normal)) return false;
  const [a, b, c] = points;
  return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2 >= RIM_AREA;
}

/** Bit i is the side opposite vertex i. Skip known diagonals and shared coplanar sides.
 * Key both endpoints in three dimensions so overlapping roofs at different heights stay distinct. */
export function roofEdgeMasks(triangles: readonly BuildingTriangle[]): Uint8Array {
  const masks = new Uint8Array(triangles.length);
  const edges = new Map<string, { face: number; bit: number }>();
  for (let face = 0; face < triangles.length; face++) {
    const { surface, normal, points, material, materials, hiddenEdge } = triangles[face],
      id = material ?? materials.cladding;
    if (surface !== 'roof' || normal[2] <= 0.001 || /^city3d:(tree|road|water)/.test(id) || (id.startsWith('city3d:wall') && !isRim(triangles[face]))) continue;
    const keys = points.map(p => p.map(v => Math.round(v * 1000)).join(','));
    const length = Math.hypot(...normal);
    masks[face] = 7;
    for (let i = 0; i < 3; i++) {
      const start = (i + 1) % 3,
        bit = 1 << i;
      if (start === hiddenEdge) {
        masks[face] &= ~bit;
        continue;
      }
      const a = keys[start],
        b = keys[(i + 2) % 3];
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const first = edges.get(key);
      if (!first) {
        edges.set(key, { face, bit });
        continue;
      }
      const n = triangles[first.face].normal;
      if (normal === n || normal[0] * n[0] + normal[1] * n[1] + normal[2] * n[2] >= 0.99999 * length * Math.hypot(...n)) {
        masks[first.face] &= ~first.bit;
        masks[face] &= ~bit;
      }
    }
  }
  return masks;
}
