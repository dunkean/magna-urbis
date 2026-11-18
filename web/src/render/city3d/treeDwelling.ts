/**
 * Tree dwelling and stilt support meshes. Called by the City 3D scene adapter and sibling mesh builders.
 * Reads/writes: Reads tree/footprint dimensions and ground; appends faces to the supplied RoofBuilder.
 */
import type { Point, Vertex3 } from '../../../../rust/bridge/housesContract';
import { type TreeDwelling } from '../cityTrees';
import { RoofBuilder } from './roofGeometry';
import { featureBox, featureDome } from './features';
import { OPENING } from './materials';

/** All tree parts enter the existing sector/material batches, including rails. */
export function treeDetails(roof: RoofBuilder, tree: TreeDwelling, base: number, wood: string, canopy: string): Point[] {
  const { center: c, radius: r, trunkRadius: tr, height: h, lean } = tree,
    n = tree.light ? 6 : 12;
  const trunk = (t: number, k: number): Vertex3[] =>
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + t * 0.18,
        root = t === 0 ? 1 + 0.32 * Math.cos(a * 4) : 1;
      return { x: c.x + lean.x * t + Math.cos(a) * tr * k * root, y: c.y + lean.y * t + Math.sin(a) * tr * k * root, z: base + h * t };
    });
  const rings = [trunk(0, 1.5), trunk(0.12, 1.05), trunk(0.5, 0.91), trunk(1.03, 0.65)];
  const loft = (a: Vertex3[], b: Vertex3[], material: string): void => {
    for (let i = 0; i < a.length; i++) {
      const j = (i + 1) % a.length;
      roof.face([a[i], a[j], b[j], b[i]], material);
    }
  };
  for (let i = 1; i < rings.length; i++) loft(rings[i - 1], rings[i], wood);
  // Limbs from the upper trunk out to the ring lobes.
  const fork = { x: c.x + lean.x * 0.75, y: c.y + lean.y * 0.75, z: base + h * 0.75 };
  for (const crown of tree.crowns.slice(1, tree.light ? 3 : -1)) {
    const end = { x: crown.x, y: crown.y, z: base + crown.z },
      dx = end.x - fork.x,
      dy = end.y - fork.y,
      d = Math.hypot(dx, dy) || 1,
      w = tr * 0.4,
      nx = (-dy / d) * w,
      ny = (dx / d) * w;
    roof.face(
      [
        { x: fork.x + nx, y: fork.y + ny, z: fork.z },
        { x: fork.x - nx, y: fork.y - ny, z: fork.z },
        { x: end.x - nx * 0.4, y: end.y - ny * 0.4, z: end.z },
        { x: end.x + nx * 0.4, y: end.y + ny * 0.4, z: end.z },
      ],
      wood,
    );
    roof.face(
      [
        { x: fork.x, y: fork.y, z: fork.z + w },
        { x: fork.x + nx, y: fork.y + ny, z: fork.z },
        { x: end.x + nx * 0.4, y: end.y + ny * 0.4, z: end.z },
        { x: end.x, y: end.y, z: end.z + w * 0.4 },
      ],
      wood,
    );
  }
  for (const p of tree.platforms) {
    const z = base + p.height,
      pc = { x: c.x + (lean.x * p.height) / h, y: c.y + (lean.y * p.height) / h },
      count = p.shape === 'polygon' || tree.light ? 6 : 12;
    if (tree.light) {
      // a plain disc and its pod: rails and domes cannot be seen at this scale
      const disc = Array.from({ length: count }, (_, i) => {
        const a = p.angle + (i / count) * Math.PI * 2;
        return { x: pc.x + Math.cos(a) * p.radius, y: pc.y + Math.sin(a) * p.radius };
      });
      roof.face(
        disc.map(q => ({ ...q, z: z + 0.22 })),
        wood,
      );
      loft(
        disc.map(q => ({ ...q, z })),
        disc.map(q => ({ ...q, z: z + 0.22 })),
        wood,
      );
      const a = p.angle + Math.PI * 0.7,
        offset = (tr + p.radius) * 0.5,
        size = Math.max(0.65, Math.min(r * 0.43, (p.radius - tr) * 1.1));
      featureBox(roof, pc.x + Math.cos(a) * offset, pc.y + Math.sin(a) * offset, size, size * 0.85, Math.max(1.2, Math.min(2.2, r * 0.5)), a, z + 0.22, wood);
      continue;
    }
    const arc = p.shape === 'partial' ? Math.PI * 1.5 : Math.PI * 2,
      steps = p.shape === 'partial' ? count + 1 : count;
    const ring = (radius: number): Point[] =>
      Array.from({ length: steps }, (_, i) => {
        const a = p.angle + (i / count) * arc;
        return { x: pc.x + Math.cos(a) * radius, y: pc.y + Math.sin(a) * radius };
      });
    const outer = ring(p.radius),
      inner = ring(tr * 1.15),
      shape = p.shape === 'partial' ? { outer: outer.concat([...inner].reverse()), holes: [] } : { outer, holes: [[...inner].reverse()] };
    const edges = p.shape === 'partial' ? outer.length - 1 : outer.length;
    for (let i = 0; i < edges; i++) {
      const j = (i + 1) % outer.length,
        points = [outer[i], outer[j], inner[j], inner[i]];
      roof.face(
        points.map(p => ({ ...p, z: z + 0.22 })),
        wood,
      );
      roof.face(
        points.map(p => ({ ...p, z })),
        wood,
      );
    }
    loft(
      shape.outer.map(p => ({ ...p, z })),
      shape.outer.map(p => ({ ...p, z: z + 0.22 })),
      wood,
    );
    if (p.shape !== 'partial')
      loft(
        inner.map(p => ({ ...p, z })),
        inner.map(p => ({ ...p, z: z + 0.22 })),
        wood,
      );
    for (let i = 0; i < edges; i++) {
      const a = outer[i],
        b = outer[(i + 1) % outer.length],
        length = Math.hypot(b.x - a.x, b.y - a.y);
      featureBox(roof, a.x, a.y, 0.1, 0.1, 0.95, 0, z + 0.22, wood);
      featureBox(roof, (a.x + b.x) / 2, (a.y + b.y) / 2, length, 0.09, 0.1, Math.atan2(b.y - a.y, b.x - a.x), z + 1.08, wood);
    }
    const a = p.angle + arc * 0.45,
      offset = (tr + p.radius) * 0.5,
      x = pc.x + Math.cos(a) * offset,
      y = pc.y + Math.sin(a) * offset;
    const size = Math.max(0.65, Math.min(r * 0.43, (p.radius - tr) * 1.1)),
      podHeight = Math.max(1.2, Math.min(2.2, r * 0.5));
    featureBox(roof, x, y, size, size * 0.85, podHeight, a, z + 0.22, wood);
    featureDome(roof, x, y, size * 0.72, size * 0.32, z + 0.22 + podHeight, canopy);
    featureBox(roof, x + Math.cos(a) * size * 0.51, y + Math.sin(a) * size * 0.51, 0.04, size * 0.32, podHeight * 0.65, a, z + 0.23, OPENING);
  }
  return rings[0].map(({ x, y }) => ({ x, y }));
}

/** Posts and a floor under a body raised on stilts: thin prisms on a 2.2 m grid inside the ring, a plank floor above them. */
export function stiltPosts(roof: RoofBuilder, ring: readonly Point[], ground: number, h: number, floor: string, post: string): void {
  const xs = ring.map(p => p.x),
    ys = ring.map(p => p.y),
    inside = (x: number, y: number): boolean => {
      let c = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if (ring[i].y > y !== ring[j].y > y && x < ((ring[j].x - ring[i].x) * (y - ring[i].y)) / (ring[j].y - ring[i].y) + ring[i].x) c = !c;
      return c;
    };
  const x0 = Math.min(...xs),
    x1 = Math.max(...xs),
    y0 = Math.min(...ys),
    y1 = Math.max(...ys),
    nx = Math.max(1, Math.round((x1 - x0) / 2.2)),
    ny = Math.max(1, Math.round((y1 - y0) / 2.2));
  for (let i = 0; i <= nx; i++)
    for (let j = 0; j <= ny; j++) {
      const x = x0 + ((x1 - x0) * i) / nx,
        y = y0 + ((y1 - y0) * j) / ny;
      if (inside(x, y) && (inside(x + 0.3, y) || inside(x - 0.3, y) || inside(x, y + 0.3))) featureBox(roof, x, y, 0.22, 0.22, h, 0, ground, post);
    }
  const top = ring.map(p => ({ x: p.x, y: p.y, z: ground + h }));
  roof.face(top, floor);
  roof.face([...top].reverse(), floor);
}
