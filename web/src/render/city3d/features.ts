/**
 * Roof features, facade quads and mill machinery. Called by the City 3D scene adapter and sibling mesh builders.
 * Reads/writes: Reads resolved dimensions/positions; appends faces to the supplied RoofBuilder.
 */
import type { Point, Vertex3 } from '../../../../rust/bridge/housesContract';
import { type ResolvedVolume } from '../cityMassing';
import { RoofBuilder } from './roofGeometry';

/** Extend the eave outside the supporting wall without moving the roof's
 * bearing edge below the wall top. The short skirt stays in the eave plane. */
export function overhang(roof: RoofBuilder, points: Vertex3[], eave: number, c: Point, d: number, material: string): void {
  const out = (p: Vertex3): Vertex3 => {
    const dx = p.x - c.x,
      dy = p.y - c.y,
      l = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / l) * d, y: p.y + (dy / l) * d, z: eave };
  };
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    if (Math.abs(a.z - eave) < 1e-6 && Math.abs(b.z - eave) < 1e-6) roof.face([a, out(a), out(b), b], material);
  }
}

/** Facade quad on an edge: `s0..s1` metres along it from `a`, `z0..z1` up, `off` out of the wall. */
export function facadeQuad(roof: RoofBuilder, a: Point, b: Point, outward: number, s0: number, s1: number, z0: number, z1: number, off: number, material: string, batter?: { center: Point; ground: number; height: number }): void {
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1,
    ux = (b.x - a.x) / l,
    uy = (b.y - a.y) / l,
    nx = uy * outward * off,
    ny = -ux * outward * off;
  const p = (s: number, z: number): Vertex3 => {
    const k = batter ? 1 - (0.08 * (z - batter.ground)) / batter.height : 1,
      c = batter?.center ?? { x: 0, y: 0 };
    return { x: c.x + (a.x + ux * s - c.x) * k + nx, y: c.y + (a.y + uy * s - c.y) * k + ny, z };
  };
  roof.face([p(s0, z0), p(s1, z0), p(s1, z1), p(s0, z1)], material);
}

/** Box on the roof: four walls and a flat top, turned by `angle`, standing at `z`. */
export function featureBox(roof: RoofBuilder, x: number, y: number, w: number, d: number, h: number, angle: number, z: number, material: string): void {
  const ca = Math.cos(angle),
    sa = Math.sin(angle),
    at = (s: number, t: number, zz: number): Vertex3 => ({ x: x + s * ca - t * sa, y: y + s * sa + t * ca, z: zz });
  const c: [number, number][] = [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ];
  for (let i = 0; i < 4; i++) {
    const [s0, t0] = c[i],
      [s1, t1] = c[(i + 1) % 4];
    roof.face([at(s0, t0, z), at(s1, t1, z), at(s1, t1, z + h), at(s0, t0, z + h)], material);
  }
  roof.face(
    c.map(([s, t]) => at(s, t, z + h)),
    material,
  );
}

/** Wind-mill sails: four crossed blades in the vertical plane facing `angle`, hub at (x, y, z). Each blade is a
 * stout spar, a pale cloth at least a sixth of the blade long across (so the cross reads from afar whatever width
 * the massing sends) and the lattice that carries it (outer rail, cross bars) in dark timber over the cloth. */
function featureSails(roof: RoofBuilder, x: number, y: number, len: number, width: number, z: number, angle: number, turn: number): void {
  const fx = Math.cos(angle),
    fy = Math.sin(angle),
    tx = -fy,
    ty = fx,
    nx = fx * 0.06,
    ny = fy * 0.06;
  const at = (s: number, u: number, k: number): Vertex3 => ({ x: x + tx * s + nx * k, y: y + ty * s + ny * k, z: z + u });
  const both = (pts: Vertex3[], material: string): void => {
    roof.face(pts, material);
    roof.face([...pts].reverse(), material);
  };
  const DARK = 'city3d:wall:wood@393126',
    CLOTH = 'city3d:wall:plaster@e4ddca',
    cloth = Math.max(width, len * 0.16),
    spar = 0.09,
    from = len * 0.2;
  for (let k = 0; k < 4; k++) {
    const a = turn + (k * Math.PI) / 2,
      ds = Math.cos(a),
      du = Math.sin(a),
      ps = -du,
      pu = ds;
    const p = (r: number, off: number, depth: number): Vertex3 => at(ds * r + ps * off, du * r + pu * off, depth);
    both([p(0, -spar, 0), p(len, -spar, 0), p(len, spar, 0), p(0, spar, 0)], DARK);
    both([p(from, spar, 1), p(len, spar, 1), p(len, spar + cloth, 1), p(from, spar + cloth, 1)], CLOTH);
    both([p(from, spar + cloth - 0.05, 2), p(len, spar + cloth - 0.05, 2), p(len, spar + cloth + 0.05, 2), p(from, spar + cloth + 0.05, 2)], DARK);
    for (let b = 0; b <= 4; b++) {
      const r = from + ((len - from) * b) / 4;
      both([p(r - 0.04, spar, 2), p(r + 0.04, spar, 2), p(r + 0.04, spar + cloth, 2), p(r - 0.04, spar + cloth, 2)], DARK);
    }
  }
  // Hub block.
  featureBox(roof, x, y, 0.5, 0.5, 0.5, angle, z - 0.25, 'city3d:wall:wood@393126');
}

/** Water wheel: two rims, eight spokes a side, float boards across the width and the axle through the hub, in dark wet
 * timber, turning in the vertical plane across the axle (`angle`), axle centre at (x, y, z). An overshot wheel gets its
 * launder: a trough on two trestles that reaches the top of the wheel. About 140 triangles. */
function featureWheel(roof: RoofBuilder, x: number, y: number, radius: number, width: number, z: number, angle: number, turn: number, variant: string | undefined, ground: number): void {
  const ax = Math.cos(angle),
    ay = Math.sin(angle),
    tx = -ay,
    ty = ax,
    WOOD = 'city3d:wall:wood@3a2f24',
    r = Math.max(0.6, radius),
    w = Math.max(0.3, width),
    n = 12;
  const at = (off: number, s: number, u: number): Vertex3 => ({ x: x + ax * off + tx * s, y: y + ay * off + ty * s, z: z + u });
  for (let k = 0; k < n; k++) {
    const a0 = turn + (k * 2 * Math.PI) / n,
      a1 = a0 + (2 * Math.PI) / n,
      c0 = Math.cos(a0),
      s0 = Math.sin(a0),
      c1 = Math.cos(a1),
      s1 = Math.sin(a1);
    for (const side of [-w / 2, w / 2]) roof.face([at(side, c0 * r, s0 * r), at(side, c1 * r, s1 * r), at(side, c1 * (r - 0.16), s1 * (r - 0.16)), at(side, c0 * (r - 0.16), s0 * (r - 0.16))], WOOD);
    // Float board: across the wheel, from inside the rim to just past it.
    roof.face([at(-w / 2, c0 * (r - 0.38), s0 * (r - 0.38)), at(w / 2, c0 * (r - 0.38), s0 * (r - 0.38)), at(w / 2, c0 * (r + 0.04), s0 * (r + 0.04)), at(-w / 2, c0 * (r + 0.04), s0 * (r + 0.04))], WOOD);
  }
  for (let k = 0; k < 8; k++) {
    const a = turn + (k * Math.PI) / 4,
      c = Math.cos(a),
      s = Math.sin(a),
      px = -s * 0.05,
      pu = c * 0.05;
    for (const side of [-w / 2, w / 2]) roof.face([at(side, c * 0.12 - px, s * 0.12 - pu), at(side, c * (r - 0.16) - px, s * (r - 0.16) - pu), at(side, c * (r - 0.16) + px, s * (r - 0.16) + pu), at(side, c * 0.12 + px, s * 0.12 + pu)], WOOD);
  }
  const hub: [number, number][] = [
    [-0.14, -0.14],
    [0.14, -0.14],
    [0.14, 0.14],
    [-0.14, 0.14],
  ];
  for (let k = 0; k < 4; k++) {
    const [s0, u0] = hub[k],
      [s1, u1] = hub[(k + 1) % 4];
    roof.face([at(-w / 2 - 0.3, s0, u0), at(w / 2 + 0.3, s0, u0), at(w / 2 + 0.3, s1, u1), at(-w / 2 - 0.3, s1, u1)], WOOD);
  }
  if (variant === 'overshot') {
    // The side the water comes from is not in the contract: the launder takes the side the paddle phase points to.
    const side = Math.cos(turn) >= 0 ? 1 : -1,
      u0 = r + 0.12,
      half = w * 0.35,
      near = side * r * 0.1,
      far = side * r * 2.6;
    roof.face([at(-half, near, u0), at(half, near, u0), at(half, far, u0), at(-half, far, u0)], WOOD);
    for (const off of [-half, half]) roof.face([at(off, near, u0), at(off, far, u0), at(off, far, u0 + 0.28), at(off, near, u0 + 0.28)], WOOD);
    for (const s of [side * r * 1.4, far - side * 0.2]) {
      const p = at(0, s, 0);
      featureBox(roof, p.x, p.y, 0.18, w * 0.7, Math.max(0.2, z + u0 - ground), angle + Math.PI / 2, ground, WOOD);
    }
  }
}

/** Works that stand on or beside a volume whatever its roof and that tell what the building is from afar: mill sails,
 * a water wheel. Drawn last, so their faces are one range of the roof mesh (kept by the overview level of detail). */
export function standingFeatures(roof: RoofBuilder, v: ResolvedVolume, ground: number): void {
  for (const f of v.detail?.features ?? []) {
    if (f.kind === 'sails') featureSails(roof, f.x, f.y, f.w, f.d, ground + v.eave_m + f.h, f.angle, f.turn ?? 0);
    else if (f.kind === 'wheel') featureWheel(roof, f.x, f.y, f.w, f.d, ground + f.h, f.angle, f.turn ?? 0, f.variant, ground);
  }
}

export function featureDome(roof: RoofBuilder, x: number, y: number, r: number, h: number, z: number, material: string): void {
  const n = 8,
    rings = [0, 0.45, 0.8, 1].map(t => ({ k: Math.cos((t * Math.PI) / 2), z: z + h * Math.sin((t * Math.PI) / 2) }));
  const at = (i: number, k: number, zz: number): Vertex3 => ({ x: x + Math.cos((i / n) * Math.PI * 2) * r * k, y: y + Math.sin((i / n) * Math.PI * 2) * r * k, z: zz });
  for (let s = 0; s + 1 < rings.length; s++) for (let i = 0; i < n; i++) roof.face([at(i, rings[s].k, rings[s].z), at(i + 1, rings[s].k, rings[s].z), at(i + 1, rings[s + 1].k, rings[s + 1].z), at(i, rings[s + 1].k, rings[s + 1].z)], material);
}
