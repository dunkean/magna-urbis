import { LIT_WINDOW, OPENING } from './city3d/materials';
import type { Vertex3 } from '../../../rust/bridge/housesContract';
import type { BuildingTriangle, BuildingVector, OverviewVolume } from './urbanBuildingGeometry';

const oak = 'city3d:detail:tidal-joist@77654f';
const rail = 'city3d:detail:tidal-rail@ad9572';
const ladder = 'city3d:detail:tidal-ladder@947c59';
const rope = 'city3d:detail:tidal-rope@94866b';
const boards = ['95836c', 'a59277', 'a18e76', '97836c'].map(hex => 'city3d:detail:tidal-board@' + hex);
type V = BuildingVector;

/** A timber landing cantilevered off the existing piles, with a gap in its guard
 * for the boarding ladder. The threshold supplies the position and orientation. */
export function craftedTidal(volume: OverviewVolume, emit: (face: BuildingTriangle) => void): void {
  const lift = volume.stiltHeight_m ?? 0;
  const ring = volume.footprint[0]?.outer;
  if (lift <= 0 || !ring?.length) return;
  const mesh = volume.roof_mesh,
    floor = volume.z_m;
  for (const face of mesh.faces) {
    if ((face.material !== OPENING && face.material !== LIT_WINDOW) || face.vertices.length !== 4) continue;
    const [a, b, c] = face.vertices.map(i => mesh.vertices[i]);
    if (Math.abs(a.z - floor) < 0.15 && Math.abs(a.z - b.z) < 0.02 && c.z - a.z > 0.8) landing(a, b, volume, lift, emit);
  }
}

function landing(a: Vertex3, b: Vertex3, volume: OverviewVolume, lift: number, emit: (face: BuildingTriangle) => void): void {
  const mesh = volume.roof_mesh,
    floor = volume.z_m,
    ring = volume.footprint[0].outer;
  const width = Math.hypot(b.x - a.x, b.y - a.y);
  if (width < 0.35) return;
  const tx = (b.x - a.x) / width,
    ty = (b.y - a.y) / width;
  const winding = Math.sign(
    ring.reduce((sum, p, i) => {
      const q = ring[(i + 1) % ring.length];
      return sum + p.x * q.y - q.x * p.y;
    }, 0),
  );
  const nx = winding * ty,
    ny = -winding * tx;
  const cx = (a.x + b.x) * 0.5,
    cy = (a.y + b.y) * 0.5;
  // Relative heights are measured from the top of the planks: they meet the
  // sill and clear the original stilt deck immediately outside the wall.
  const at = (s: number, d: number, h: number): V => [cx + s * tx + d * nx, cy + s * ty + d * ny, a.z - 0.006 + h];
  const quad = (p: V, q: V, r: V, s: V, material: string): void => {
    const x = q[0] - p[0],
      y = q[1] - p[1],
      z = q[2] - p[2];
    const vx = s[0] - p[0],
      vy = s[1] - p[1],
      vz = s[2] - p[2];
    const normal: V = [y * vz - z * vy, z * vx - x * vz, x * vy - y * vx];
    const len = Math.hypot(...normal);
    if (len < 1e-8) return;
    for (let i = 0; i < 3; i++) normal[i] /= len;
    emit({ points: [p, q, r], normal, material, materials: volume.materials, surface: 'roof' });
    emit({ points: [p, r, s], normal, material, materials: volume.materials, surface: 'roof' });
  };
  // An oriented timber with a rectangular section. The same true thickness
  // works for the horizontal deck joists, raking knees and inclined ladder.
  const beam = (p: V, q: V, w: number, h: number, material: string): void => {
    const x = q[0] - p[0],
      y = q[1] - p[1],
      z = q[2] - p[2];
    const plan = Math.hypot(x, y),
      len = Math.hypot(plan, z);
    if (len < 0.005) return;
    const ux = plan > 1e-6 ? -y / plan : tx,
      uy = plan > 1e-6 ? x / plan : ty;
    const vx = (-z * uy) / len,
      vy = (z * ux) / len,
      vz = (x * uy - y * ux) / len;
    const corner = (v: V, i: number): V => {
      const u = (i === 1 || i === 2 ? 0.5 : -0.5) * w,
        k = (i >= 2 ? 0.5 : -0.5) * h;
      return [v[0] + ux * u + vx * k, v[1] + uy * u + vy * k, v[2] + vz * k];
    };
    const start = [0, 1, 2, 3].map(i => corner(p, i)),
      end = [0, 1, 2, 3].map(i => corner(q, i));
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      quad(start[i], start[j], end[j], end[i], material);
    }
    quad(start[3], start[2], start[1], start[0], material);
    quad(end[0], end[1], end[2], end[3], material);
  };

  // Position the outer corners over the deck even when the door is near a jamb
  // at the end of its facade. The remaining door width is always clear.
  const half = Math.max(1.26, Math.min(1.75, width * 0.65 + 0.88));
  let left = -half,
    right = half;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i],
      q = ring[(i + 1) % ring.length];
    const length = (q.x - p.x) * tx + (q.y - p.y) * ty;
    const station = (cx - p.x) * tx + (cy - p.y) * ty;
    const distance = (cx - p.x) * nx + (cy - p.y) * ny;
    if (station < 0 || station > length || Math.abs(distance) > 0.12 || Math.abs((q.x - p.x) * nx + (q.y - p.y) * ny) > 0.05) continue;
    const span = Math.min(2 * half, length + 0.2);
    left = Math.max(-station - 0.1, Math.min(-span / 2, length - station + 0.1 - span));
    right = left + span;
    break;
  }
  const depth = Math.max(1.55, Math.min(1.95, width + 0.75)),
    rear = -0.045;
  const piles: V[] = [];
  for (const f of mesh.faces) {
    if (f.material !== volume.materials.roof_frame || f.vertices.length !== 4 || f.normal[2] < 0.99) continue;
    const [p, q, r] = f.vertices.map(i => mesh.vertices[i]);
    // The existing grid piles end at the floor, its larger perimeter piles
    // finish 45 cm above it. Read their centres directly, including rotated sites.
    const diagonal = Math.hypot(r.x - p.x, r.y - p.y);
    if (p.z < floor - 0.02 || p.z > floor + 0.5 || Math.abs(p.z - q.z) > 0.01 || diagonal < 0.2 || diagonal > 0.55) continue;
    piles.push([(p.x + r.x) / 2, (p.y + r.y) / 2, floor]);
  }
  const attached: V[] = [];
  for (const s of [left + 0.08, right - 0.08]) {
    const nose = at(s, depth - 0.12, -0.15);
    let nearest: V | undefined,
      distance = Infinity;
    for (const pile of piles) {
      const d = Math.hypot(pile[0] - nose[0], pile[1] - nose[1]);
      if (d < distance) {
        nearest = pile;
        distance = d;
      }
    }
    if (nearest) {
      attached.push(nearest);
      beam([nearest[0], nearest[1], floor - Math.min(1.65, 0.69 * lift)], nose, 0.14, 0.17, oak);
    }
    beam(at(s, rear - 0.28, -0.13), nose, 0.15, 0.19, oak);
    beam(at(s, depth - 0.12, -0.18), at(s, depth - 0.12, 0.95), 0.12, 0.12, rail);
    beam(at(s, rear + 0.13, -0.1), at(s, rear + 0.13, 0.89), 0.09, 0.09, rail);
    beam(at(s, rear + 0.1, 0.83), at(s, depth - 0.08, 0.9), 0.08, 0.09, rail);
    // A hemp guard sags between its two ties.
    const sag = at(s, depth / 2, 0.39);
    beam(at(s, rear + 0.13, 0.51), sag, 0.032, 0.032, rope);
    beam(sag, at(s, depth - 0.12, 0.55), 0.032, 0.032, rope);
  }
  if (attached.length === 2 && attached[0] !== attached[1]) {
    const [p, q] = attached,
      span = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (span < 4.5) beam([p[0], p[1], floor - 0.22], [q[0], q[1], floor - Math.min(0.79 * lift, 1.8)], 0.14, 0.13, oak);
  }
  beam(at(left, depth - 0.05, -0.1), at(right, depth - 0.05, -0.1), 0.12, 0.16, oak);
  const count = Math.ceil((depth - rear) / 0.19),
    pitch = (depth - rear) / count;
  for (let i = 0; i < count; i++) {
    const inside = rear + i * pitch,
      outside = inside + pitch - 0.011;
    const plank = [at(left, inside, 0), at(right, inside, 0), at(right, outside, 0), at(left, outside, 0)] as [V, V, V, V];
    if (winding > 0) plank.reverse();
    quad(...plank, boards[i % boards.length]);
    if (i === count - 1) beam(at(left, outside - 0.015, -0.028), at(right, outside - 0.015, -0.028), 0.03, 0.056, boards[i % boards.length]);
  }
  // The ladder sides continue into two handholds. Leave its 68 cm passage
  // open in the seaward guard so a climber can step directly onto the planks.
  const lane = right - 0.65,
    railHalf = 0.37,
    drop = Math.max(0.1, lift - 0.055);
  const toe = depth + Math.min(0.85, 0.21 * drop);
  const ladderDepth = (h: number) => depth + (toe - depth) * Math.max(0, -h / drop);
  for (const s of [lane - railHalf, lane + railHalf]) {
    beam(at(s, toe, -drop), at(s, depth, 0), 0.095, 0.095, ladder);
    beam(at(s, depth, 0), at(s, depth, 0.79), 0.095, 0.095, ladder);
  }
  beam(at(left + 0.08, depth - 0.12, 0.89), at(lane - railHalf, depth, 0.76), 0.078, 0.085, rail);
  const steps = Math.min(40, Math.max(1, Math.round(drop / 0.29)));
  for (let i = 0; i < steps; i++) {
    const h = (-drop * (i + 0.55)) / steps,
      d = ladderDepth(h);
    beam(at(lane - railHalf, d, h), at(lane + railHalf, d, h), 0.095, 0.063, ladder);
  }
}
