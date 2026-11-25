import type { Point } from '../../../rust/bridge/housesContract';
import type { BuildingVector, OverviewVolume } from './urbanBuildingGeometry';

type Quad = (a: BuildingVector, b: BuildingVector, c: BuildingVector, d: BuildingVector, material: string) => void;
type LocalPoint = (s: number, z: number, depth?: number) => BuildingVector;
const stone = 'city3d:detail:limestone@a29a96',
  bronze = 'city3d:detail:bronze@857052',
  lead = 'city3d:detail:lead@504958';
const timber = 'city3d:detail:timber@715340',
  clay = 'city3d:detail:frieze@91563e',
  lime = 'city3d:detail:coping@bfb095';

/** A moulding with a projecting front, undercut and sloping weather face. */
function moulding(p: LocalPoint, w: number, z: number, h: number, depth: number, mat: string, quad: Quad): void {
  quad(p(0, z), p(w, z), p(w, z + h * 0.25, depth), p(0, z + h * 0.25, depth), mat);
  quad(p(0, z + h * 0.25, depth), p(w, z + h * 0.25, depth), p(w, z + h * 0.8, depth), p(0, z + h * 0.8, depth), mat);
  quad(p(0, z + h * 0.8, depth), p(w, z + h * 0.8, depth), p(w, z + h), p(0, z + h), mat);
}

/** Glazed lancet in a projecting pointed stone surround. All sections follow their own tower facet. */
function lancet(p: LocalPoint, s: number, z: number, w: number, h: number, quad: Quad): void {
  const a = w * 0.5,
    shoulder = h * 0.69,
    tip = h * 0.97,
    trim = Math.min(0.12, w * 0.15);
  const pane = 'city3d:detail:glass@405563';
  quad(p(s - a, z, 0.024), p(s + a, z, 0.024), p(s + a, z + shoulder, 0.024), p(s - a, z + shoulder, 0.024), pane);
  quad(p(s - a, z + shoulder, 0.024), p(s, z + shoulder, 0.024), p(s, z + tip, 0.024), p(s - a, z + shoulder + 0.015, 0.024), pane);
  quad(p(s, z + shoulder, 0.024), p(s + a, z + shoulder, 0.024), p(s + a, z + shoulder + 0.015, 0.024), p(s, z + tip, 0.024), pane);
  for (const side of [-1, 1]) {
    const x = s + side * a,
      outer = x + side * trim;
    quad(p(x, z, 0.055), p(outer, z, 0.12), p(outer, z + shoulder, 0.12), p(x, z + shoulder, 0.055), stone);
    quad(p(x, z + shoulder, 0.055), p(outer, z + shoulder, 0.12), p(s, z + tip + trim * 1.7, 0.12), p(s, z + tip, 0.055), stone);
  }
  quad(p(s - 0.025, z, 0.055), p(s + 0.025, z, 0.055), p(s + 0.025, z + shoulder, 0.055), p(s - 0.025, z + shoulder, 0.055), bronze);
}

export function craftedCrown(volume: OverviewVolume, culture: string, emitQuad: Quad): void {
  const tower = culture === 'wizard-city' && volume.displayRoofForm === 'cone' && volume.wall_height_m > 8;
  const tibetan = culture.includes('tibetan') && volume.displayRoofForm === 'flat' && volume.envelope === 'open';
  if (!tower && !tibetan) return;
  const ring = volume.footprint[0]?.outer;
  if (!ring?.length || (tower && ring.length < 8)) return;
  const center = ring.reduce((sum, p) => ({ x: sum.x + p.x / ring.length, y: sum.y + p.y / ring.length }), { x: 0, y: 0 });
  const eave = volume.z_m + volume.wall_height_m;
  const outer = (vertex: Point): Point => (tibetan ? { x: center.x + (vertex.x - center.x) * 0.92, y: center.y + (vertex.y - center.y) * 0.92 } : vertex);
  for (let i = 0; i < ring.length; i++) {
    const a = outer(ring[i]),
      b = outer(ring[(i + 1) % ring.length]),
      w = Math.hypot(b.x - a.x, b.y - a.y);
    if (w < 0.45) continue;
    const ux = (b.x - a.x) / w,
      uy = (b.y - a.y) / w,
      sign = (a.x - center.x) * uy - (a.y - center.y) * ux >= 0 ? 1 : -1;
    const p: LocalPoint = (s, z, depth = 0) => [a.x + s * ux + sign * uy * depth, a.y + s * uy - sign * ux * depth, z];
    const quad: Quad = sign > 0 ? emitQuad : (a, b, c, d, m) => emitQuad(b, a, d, c, m);
    if (tibetan) {
      moulding(p, w, eave - 0.2, 0.23, 0.21, timber, quad);
      moulding(p, w, eave + 0.03, 0.18, 0.16, clay, quad);
      moulding(p, w, eave + 0.21, 0.08, 0.19, lime, quad);
      const joists = Math.floor(w / 1.25);
      for (let j = 0; j < joists; j++) {
        const s = ((j + 0.5) * w) / joists,
          z = eave - 0.29;
        quad(p(s - 0.095, z, 0.2), p(s + 0.095, z, 0.2), p(s + 0.095, z + 0.115, 0.2), p(s - 0.095, z + 0.115, 0.2), timber);
        quad(p(s - 0.095, z), p(s - 0.095, z, 0.2), p(s - 0.095, z + 0.115, 0.2), p(s - 0.095, z + 0.115), timber);
        quad(p(s + 0.095, z, 0.2), p(s + 0.095, z), p(s + 0.095, z + 0.115), p(s + 0.095, z + 0.115, 0.2), timber);
      }
    } else {
      const gallery = eave - Math.min(4.6, volume.wall_height_m * 0.2);
      moulding(p, w, gallery - 0.24, 0.37, 0.26, stone, quad);
      moulding(p, w, eave - 0.46, 0.35, 0.19, lead, quad);
      if (i % 2 === 0) lancet(p, w / 2, gallery + 0.14, Math.min(w * 0.54, 0.92), eave - gallery - 0.83, quad);
      // A rising series of narrow openings follows the stair around the shaft.
      if (i % 3 === 0) lancet(p, w / 2, volume.z_m + volume.wall_height_m * (0.16 + (0.44 * i) / ring.length), Math.min(0.53, w * 0.38), 1.75, quad);
    }
  }
}
