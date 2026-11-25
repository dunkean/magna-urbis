import type { Vertex3 } from '../../../rust/bridge/housesContract';
import type { BuildingVector, OverviewVolume } from './urbanBuildingGeometry';
import { inRing } from './city3d/roofGeometry';

type Quad = (a: BuildingVector, b: BuildingVector, c: BuildingVector, d: BuildingVector, material: string) => void;
type Local = (u: number, v: number, z: number) => BuildingVector;
const metal = 'city3d:detail:flashing@656769',
  soot = 'city3d:detail:flue@3d3932';

function box(p: Local, w: number, d: number, z0: number, z1: number, material: string, quad: Quad): void {
  const foot = [p(-w, -d, z0), p(w, -d, z0), p(w, d, z0), p(-w, d, z0)];
  const top = [p(-w, -d, z1), p(w, -d, z1), p(w, d, z1), p(-w, d, z1)];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(foot[i], foot[j], top[j], top[i], material);
  }
  quad(top[0], top[1], top[2], top[3], material);
}

/** Sit a flue or ventilation unit on a measured pan, including the uphill side of the flashing. */
export function craftedRoofFitting(volume: OverviewVolume, culture: string, quad: Quad): void {
  const plant = /^(cyberpunk|corporate-arcology|futuristic-space-colony|global-high-rise|dystopian-brutalism|modernist-functionalist|dieselpunk)$/.test(culture) && volume.displayRoofForm === 'flat';
  const flue = /^(european-organic|bastide|hanseatic|flemish-cloth-town|industrial-victorian|italian-comune|garden-city|halfling)$/.test(culture) && !!volume.overview_roof_faces;
  if ((!flue && !plant) || volume.wall_height_m < 2.6 || volume.role === 'minor') return;
  let seed = 0;
  for (const c of volume.id) seed = (Math.imul(31, seed) + c.charCodeAt(0)) | 0;
  seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b) >>> 0;
  if (seed % 100 > (plant ? 69 : 63)) return;
  const mesh = volume.roof_mesh,
    [start, end] = volume.overview_roof_faces ?? [0, mesh.faces.length];
  let area = 0,
    points: Vertex3[] | undefined,
    normal: BuildingVector | undefined;
  for (let i = start; i < end; i++) {
    const f = mesh.faces[i];
    if (f.material !== volume.materials.cladding || f.normal[2] < (plant ? 0.99 : 0.28) || (!plant && f.normal[2] > 0.986)) continue;
    const pts = f.vertices.map(k => mesh.vertices[k]);
    const a =
      Math.abs(
        pts.reduce((s, p, j) => {
          const q = pts[(j + 1) % pts.length];
          return s + p.x * q.y - p.y * q.x;
        }, 0),
      ) * 0.5;
    if (a > area) {
      area = a;
      points = pts;
      normal = f.normal;
    }
  }
  if (!points || !normal || area < (plant ? 12 : 6)) return;
  const pan = points,
    n = normal,
    first = pan[0],
    next = pan[1];
  const edge = Math.hypot(next.x - first.x, next.y - first.y);
  if (edge < 0.01) return;
  const ux = (next.x - first.x) / edge,
    uy = (next.y - first.y) / edge;
  const centre = pan.reduce((sum, p) => ({ x: sum.x + p.x / pan.length, y: sum.y + p.y / pan.length }), { x: 0, y: 0 });
  const towards = pan[(seed >>> 8) % pan.length];
  const x = centre.x * 0.72 + towards.x * 0.28,
    y = centre.y * 0.72 + towards.y * 0.28;
  const h = (xx: number, yy: number) => first.z - ((xx - first.x) * n[0] + (yy - first.y) * n[1]) / n[2];
  const base = h(x, y);
  const p: Local = (u, v, z) => [x + ux * u - uy * v, y + uy * u + ux * v, base + z];
  const w = plant ? 0.84 : 0.37,
    d = plant ? 0.56 : 0.29;
  const corners = [p(-w, -d, 0), p(w, -d, 0), p(w, d, 0), p(-w, d, 0)];
  if (!corners.every(([xx, yy]) => inRing(pan, { x: xx, y: yy }))) return;
  // Avoid the roof furniture already present in the generated massing.
  if (mesh.vertices.some(q => q.z > h(q.x, q.y) + 0.12 && Math.abs(q.x - x) < w + 0.4 && Math.abs(q.y - y) < d + 0.4)) return;
  if (plant) {
    box(p, w + 0.055, d + 0.055, -0.015, 0.13, metal, quad);
    box(p, w, d, 0.13, 0.74, 'city3d:detail:plant@889592', quad);
    box(p, w + 0.045, d + 0.045, 0.74, 0.8, 'city3d:detail:plant-cap@9da59d', quad);
    for (const side of [-1, 1])
      for (let k = 0; k < 4; k++) {
        const z = 0.23 + k * 0.105;
        quad(p(-w * 0.88, side * (d + 0.01), z), p(w * 0.88, side * (d + 0.01), z), p(w * 0.88, side * (d + 0.045), z + 0.043), p(-w * 0.88, side * (d + 0.045), z + 0.043), metal);
      }
  } else {
    const [a, b, c, d0] = corners.map(([xx, yy]): BuildingVector => [xx, yy, h(xx, yy) + 0.018]);
    quad(a, b, c, d0, metal);
    const high = Math.max(...corners.map(([xx, yy]) => h(xx, yy) - base)) + 0.71 + (seed % 4) * 0.12;
    const body = seed & 1 ? 'city3d:detail:chimney@926a53' : 'city3d:detail:chimney@a78c72';
    box(p, w - 0.082, d - 0.075, Math.min(...corners.map(([xx, yy]) => h(xx, yy) - base)) - 0.02, high, body, quad);
    box(p, w - 0.036, d - 0.028, high, high + 0.13, 'city3d:detail:chimney-cap@967b64', quad);
    quad(p(-w * 0.51, -d * 0.44, high + 0.135), p(w * 0.51, -d * 0.44, high + 0.135), p(w * 0.51, d * 0.44, high + 0.135), p(-w * 0.51, d * 0.44, high + 0.135), soot);
  }
}
