import type { Point, Vertex3 } from '../../../rust/bridge/housesContract';
import type { OverviewVolume } from './urbanBuildingGeometry';

/** Both ends of a ridge reaching a wall can take the wharepuni porch. The massing renderer
 * also emits gables as steep roof pans, so use their measured ridge rather than a face label. */
export function maoriGables(v: OverviewVolume, ring: readonly Point[]): [Point, Point, Vertex3][] {
  const range = v.overview_roof_faces;
  if (v.displayRoofForm !== 'gable' || !range) return [];
  const mesh = v.roof_mesh;
  const points = mesh.faces
    .slice(range[0], range[1])
    .filter(face => face.material === v.materials.cladding)
    .flatMap(face => face.vertices.map(index => mesh.vertices[index]));
  const top = points.reduce((z, p) => Math.max(z, p.z), -Infinity);
  if (top - v.z_m - v.wall_height_m < 0.38) return [];
  const ridge = points.filter(p => top - p.z < 0.035);
  let ends: [Vertex3, Vertex3] | undefined;
  let length = 0;
  for (let i = 0; i < ridge.length; i++) {
    for (let j = i + 1; j < ridge.length; j++) {
      const distance = Math.hypot(ridge[j].x - ridge[i].x, ridge[j].y - ridge[i].y);
      if (distance > length) {
        length = distance;
        ends = [ridge[i], ridge[j]];
      }
    }
  }
  if (!ends || length < 0.9) return [];
  const axisX = (ends[1].x - ends[0].x) / length,
    axisY = (ends[1].y - ends[0].y) / length;
  const found: [Point, Point, Vertex3][] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length],
      dx = b.x - a.x,
      dy = b.y - a.y,
      span = Math.hypot(dx, dy);
    if (span < 1.45 || Math.abs(dx * axisX + dy * axisY) / span > 0.16) continue;
    const mx = (a.x + b.x) / 2,
      my = (a.y + b.y) / 2;
    const apex = ends.find(p => Math.abs((p.x - mx) * dy - (p.y - my) * dx) / span < 0.45 && Math.abs((p.x - mx) * dx + (p.y - my) * dy) / span < Math.min(0.6, span * 0.1));
    if (apex) found.push([a, b, apex]);
  }
  return found;
}
