import type { Vertex3 } from '../../../rust/bridge/housesContract';
import type { RoofMesh } from './city3d/types';
import type { BuildingVector } from './urbanBuildingGeometry';

type V = BuildingVector;
export interface HouseFront {
  width: number;
  depth: number;
  height: number;
  eave?: number;
  doorWidth?: number;
  doorHeight?: number;
  hasGableDoor?: boolean;
  windows?: readonly { x: number; bottom: number; top: number; width: number }[];
  floor: number;
  seed: number;
  wall: string;
  cover: string;
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, material: string): void;
  face(points: V[], material: string): void;
  beam(a: V, b: V, width: number, material: string): void;
  post(x: number, y: number, z0: number, z1: number, radius: number, material: string, sides?: number): void;
}
export type FrontDimensions = Pick<HouseFront, 'width' | 'depth' | 'height' | 'eave' | 'doorWidth' | 'doorHeight' | 'hasGableDoor' | 'windows' | 'floor' | 'seed' | 'wall' | 'cover'>;
export type FrontDesign = (g: HouseFront) => void;
export interface FrontFrame {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
}

/** Local x runs across the threshold; y points out from the building. Preserve downward normals in soffits and reveals. */
export function buildHouseFront(frame: FrontFrame, dimensions: FrontDimensions, draw: FrontDesign): RoofMesh {
  const mesh: RoofMesh = { vertices: [], faces: [], edges: [], groups: [] };
  const point = ([s, d, h]: V): Vertex3 => ({ x: frame.x + frame.ny * s + frame.nx * d, y: frame.y - frame.nx * s + frame.ny * d, z: frame.z + h });
  function face(local: V[], material: string): void {
    if (local.length < 3) return;
    const ps = local.map(point);
    let nx = 0,
      ny = 0,
      nz = 0;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i],
        b = ps[(i + 1) % ps.length];
      nx += (a.y - b.y) * (a.z + b.z);
      ny += (a.z - b.z) * (a.x + b.x);
      nz += (a.x - b.x) * (a.y + b.y);
    }
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-8) return;
    const start = mesh.vertices.length;
    mesh.vertices.push(...ps);
    mesh.faces.push({ vertices: ps.map((_, i) => start + i), normal: [nx / length, ny / length, nz / length], material, kind: 'pan' });
  }
  function prism(lo: V[], hi: V[], material: string) {
    face([...lo].reverse(), material);
    face(hi, material);
    for (let i = 0; i < lo.length; i++) {
      const j = (i + 1) % lo.length;
      face([lo[i], lo[j], hi[j], hi[i]], material);
    }
  }
  function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: string) {
    if (x1 <= x0 || y1 <= y0 || z1 <= z0) return;
    const rect = (z: number): V[] => [
      [x0, y0, z],
      [x1, y0, z],
      [x1, y1, z],
      [x0, y1, z],
    ];
    prism(rect(z0), rect(z1), m);
  }
  function post(x: number, y: number, z0: number, z1: number, r: number, m: string, sides = 8) {
    if (z1 <= z0 || r <= 0) return;
    const ring = (z: number): V[] => Array.from({ length: sides }, (_, i) => [x + r * Math.cos((2 * Math.PI * i) / sides), y + r * Math.sin((2 * Math.PI * i) / sides), z]);
    prism(ring(z0), ring(z1), m);
  }
  function beam(a: V, b: V, width: number, m: string) {
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      dz = b[2] - a[2],
      len = Math.hypot(dx, dy, dz),
      flat = Math.hypot(dx, dy);
    if (len < 0.001 || width <= 0) return;
    const ux = flat ? -dy / flat : 1,
      uy = flat ? dx / flat : 0,
      r = width / 2;
    const rect = (p: V): V[] =>
      [
        [-r, -r],
        [r, -r],
        [r, r],
        [-r, r],
      ].map(([u, v]) => [p[0] + ux * u - ((dz * uy) / len) * v, p[1] + uy * u + ((dz * ux) / len) * v, p[2] + (flat / len) * v]);
    prism(rect(a), rect(b), m);
  }
  draw({ ...dimensions, face, box, post, beam });
  return mesh;
}
