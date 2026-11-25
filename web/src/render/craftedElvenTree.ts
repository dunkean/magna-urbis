import type { Vertex3 } from '../../../rust/bridge/housesContract';
import type { TreeDwelling, TreePlatform } from './cityTrees';
import { lightCrowns, treeCrownFaces } from './cityTrees';
import { RoofBuilder } from './city3d/roofGeometry';
import { treeDetails } from './city3d/treeDwelling';

const BARK = 'city3d:tree:trunk@725a42';
const BEAM = 'city3d:detail:cedar@926a44';
const ENDGRAIN = 'city3d:detail:cedar@72533e';
const RAIL = 'city3d:detail:willow@ba925e';
const PLASTER = 'city3d:detail:plaster@d6caaa';
const GLASS = 'city3d:detail:glass@49645e';
const ROOFS = ['city3d:detail:patina@5c877c', 'city3d:detail:bronze@968266'];
const LEAVES = ['587154', '69865b', '7d955a', '849e6a'];

/** A tapered square section. The same hewn timbers work upright, along the rail and diagonally
 * back into the tree. Radius is measured perpendicular to the member. */
function timber(roof: RoofBuilder, a: Vertex3, b: Vertex3, r: number, end: number, material: string): void {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    dz = b.z - a.z,
    length = Math.hypot(dx, dy, dz);
  if (length < 0.001) return;
  const h = Math.hypot(dx, dy),
    ux = h > 0.001 ? -dy / h : 1,
    uy = h > 0.001 ? dx / h : 0;
  const vx = (-dz * uy) / length,
    vy = (dz * ux) / length,
    vz = (dx * uy - dy * ux) / length;
  const corners = (p: Vertex3, width: number) =>
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([u, v]) => ({ x: p.x + (u * ux + v * vx) * width, y: p.y + (u * uy + v * vy) * width, z: p.z + v * vz * width }));
  const lo = corners(a, r),
    hi = corners(b, end);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    roof.face([lo[i], lo[j], hi[j], hi[i]], material);
  }
  roof.face(hi, material);
}

function gallery(roof: RoofBuilder, tree: TreeDwelling, p: TreePlatform, base: number, level: number): void {
  const h = tree.height,
    tr = tree.trunkRadius,
    floor = base + p.height;
  const cx = tree.center.x + (tree.lean.x * p.height) / h,
    cy = tree.center.y + (tree.lean.y * p.height) / h;
  const ux = Math.cos(p.angle),
    uy = Math.sin(p.angle);
  const at = (s: number, t: number, z: number): Vertex3 => ({ x: cx + ux * s - uy * t, y: cy + uy * s + ux * t, z: floor + z });
  const reach = Math.max(p.radius * 1.26, tree.radius * 0.69),
    width = Math.max(1.32, Math.min(3.45, reach * 0.48));
  const hull = [
    [tr * 0.62, -width * 0.58],
    [reach * 0.52, -width],
    [reach * 0.83, -width * 0.94],
    [reach, -width * 0.45],
    [reach, width * 0.45],
    [reach * 0.83, width * 0.94],
    [reach * 0.52, width],
    [tr * 0.62, width * 0.58],
  ];
  roof.face(
    hull.map(([s, t]) => at(s, t, 0.07)),
    'city3d:detail:deck@b19772',
  );
  for (let i = 0; i < hull.length; i++) {
    const [s, t] = hull[i],
      [u, v] = hull[(i + 1) % hull.length];
    roof.face([at(s, t, -0.16), at(u, v, -0.16), at(u, v, 0.07), at(s, t, 0.07)], ENDGRAIN);
    if (i === hull.length - 1) continue;
    timber(roof, at(s, t, 0.07), at(s, t, 0.94), 0.055, 0.045, BEAM);
    const rail = (start: number, stop: number) => {
      const station = (k: number, z: number) => at(s + (u - s) * k, t + (v - t) * k, z);
      timber(roof, station(start, 0.89), station(stop, 0.89), 0.055, 0.055, RAIL);
      if (!tree.light) timber(roof, station(start, 0.35), station(stop, 0.35), 0.028, 0.028, RAIL);
    };
    if (level === 0 && i === 1) {
      const opening = Math.min(0.43, 0.43 / Math.hypot(u - s, v - t));
      rail(0, 0.5 - opening);
      rail(0.5 + opening, 1);
      for (const k of [0.5 - opening, 0.5 + opening]) timber(roof, at(s + (u - s) * k, t + (v - t) * k, 0.07), at(s + (u - s) * k, t + (v - t) * k, 0.93), 0.055, 0.045, BEAM);
    } else rail(0, 1);
  }
  // The deck cantilevers from the trunk on paired, forked branch brackets.
  for (const side of [-1, 1]) {
    const root = at(tr * 0.44, side * tr * 0.46, -Math.min(2.45, p.height * 0.46));
    const elbow = at(reach * 0.45, side * width * 0.62, -0.77);
    timber(roof, root, elbow, 0.22, 0.15, BARK);
    timber(roof, elbow, at(reach * 0.84, side * width * 0.67, -0.12), 0.15, 0.09, BEAM);
  }

  // Keep a verandah in front of a framed, plaster-infilled house. The two differently
  // pitched roof slopes and the lifted ridge ends remain visible against the foliage.
  const back = Math.min(tr * 0.86, reach * 0.27),
    front = reach * 0.77,
    wall = width * 0.67;
  const eave = Math.min(2.7, Math.max(1.58, width * 0.91)),
    rise = Math.min(1.85, Math.max(0.91, wall * 0.84));
  const hi = eave + rise,
    roofMat = ROOFS[level % 2];
  const outer = wall + 0.32,
    tail = back - 0.28,
    tip = front + 0.48;
  const quad = (a: Vertex3, b: Vertex3, c: Vertex3, d: Vertex3, material: string) => roof.face([a, b, c, d], material);
  for (const side of [-1, 1]) {
    const t = side * wall,
      edge = side * outer,
      mid = side * outer * 0.56;
    quad(at(back, t, 0.08), at(front, t, 0.08), at(front, t, eave), at(back, t, eave), PLASTER);
    // Inset panes, a continuous wooden sill, and visible posts along each flank.
    const length = front - back;
    for (let j = 0; j < 2; j++) {
      const lo = back + length * (j * 0.49 + 0.085),
        up = lo + length * 0.33,
        face = t + side * 0.018;
      quad(at(lo, face, eave * 0.32), at(up, face, eave * 0.32), at(up, face, eave * 0.78), at(lo, face, eave * 0.78), GLASS);
      timber(roof, at((lo + up) / 2, face, eave * 0.32), at((lo + up) / 2, face, eave * 0.78), 0.035, 0.035, BEAM);
    }
    for (const s of [back, (back + front) / 2, front]) timber(roof, at(s, t, 0.09), at(s, t, eave + 0.02), 0.075, 0.065, BEAM);
    timber(roof, at(back, t, 0.56), at(front, t, 0.56), 0.055, 0.055, BEAM);
    quad(at(tail, edge, eave), at(tip, edge, eave + 0.15), at(tip, mid, eave + rise * 0.35), at(tail, mid, eave + rise * 0.29), roofMat);
    quad(at(tail, mid, eave + rise * 0.29), at(tip, mid, eave + rise * 0.35), at(tip + 0.24, 0, hi + 0.19), at(tail - 0.12, 0, hi + 0.07), roofMat);
    timber(roof, at(tail, edge, eave), at(tip, edge, eave + 0.15), 0.055, 0.055, RAIL);
    timber(roof, at(tip, edge, eave + 0.15), at(tip, mid, eave + rise * 0.35), 0.055, 0.065, RAIL);
    timber(roof, at(tip, mid, eave + rise * 0.35), at(tip + 0.24, 0, hi + 0.19), 0.065, 0.045, RAIL);
  }
  for (const s of [back, front]) {
    quad(at(s, -wall, 0.08), at(s, wall, 0.08), at(s, wall, eave), at(s, -wall, eave), PLASTER);
    roof.face([at(s, -wall, eave), at(s, wall, eave), at(s, 0, hi)], PLASTER);
    timber(roof, at(s, -wall, eave), at(s, wall, eave), 0.08, 0.08, BEAM);
    timber(roof, at(s, 0, eave), at(s, 0, hi), 0.07, 0.055, BEAM);
  }
  // A recessed arched entry is legible even when the house is viewed as a small model.
  const gate = Math.min(0.53, wall * 0.52),
    shoulder = eave * 0.68,
    frontFace = front + 0.03;
  roof.face([at(frontFace, -gate, 0.09), at(frontFace, gate, 0.09), at(frontFace, gate, shoulder), at(frontFace, 0, eave * 0.94), at(frontFace, -gate, shoulder)], 'city3d:detail:door@654c37');
  for (const side of [-1, 1]) {
    timber(roof, at(frontFace, side * gate, 0.09), at(frontFace, side * gate, shoulder), 0.065, 0.065, BEAM);
    timber(roof, at(frontFace, side * gate, shoulder), at(frontFace, 0, eave * 0.94), 0.065, 0.065, RAIL);
  }
  // A ladder connects the first gallery to the foot of its own tree.
  if (level === 0) {
    const s = (hull[1][0] + hull[2][0]) * 0.5,
      t = (hull[1][1] + hull[2][1]) * 0.5;
    const run = Math.min(0.95, p.height * 0.2);
    for (const side of [-1, 1]) timber(roof, at(s + side * 0.27, t - run, -p.height + 0.05), at(s + side * 0.27, t, 0.12), 0.055, 0.05, BEAM);
    const rungs = Math.max(3, Math.ceil(p.height / 0.32));
    for (let j = 1; j < rungs; j++) {
      const k = j / rungs,
        stepT = t - run * (1 - k),
        z = -p.height * (1 - k) + 0.06;
      timber(roof, at(s - 0.28, stepT, z), at(s + 0.28, stepT, z), 0.035, 0.035, RAIL);
    }
  }
}

/** Reuse the actual dwelling's trunk, branches, crown family and occupied platform sites.
 * Thin and lift the lower foliage over the galleries; ordinary map trees use their own mesh. */
export function craftedElvenTree(tree: TreeDwelling, base: number): ReturnType<RoofBuilder['mesh']> {
  const roof = new RoofBuilder();
  const crowns = tree.crowns.map(c => ({ ...c, x: c.x + (c.x - tree.center.x - tree.lean.x) * 0.09, y: c.y + (c.y - tree.center.y - tree.lean.y) * 0.09, rx: c.rx * 0.77, ry: c.ry * 0.77, height: c.height * 0.64, z: c.z + c.height * 0.24, skirt: Math.min(c.skirt, 0.31) }));
  const pruned = { ...tree, crowns, platforms: [] };
  treeDetails(roof, pruned, base, BARK, 'city3d:tree:crown@718854');
  for (const c of tree.light ? lightCrowns(pruned) : crowns) {
    const shade = Math.min(LEAVES.length - 1, Math.floor(c.tone * LEAVES.length));
    for (const face of treeCrownFaces(pruned, c)) {
      const upper = face.reduce((z, p) => z + p.z / face.length, 0) > c.z + c.height * 0.6;
      const tone = LEAVES[Math.min(LEAVES.length - 1, shade + (upper ? 1 : 0))];
      roof.face(
        face.map(p => ({ ...p, z: p.z + base })),
        'city3d:tree:crown@' + tone,
      );
    }
  }
  tree.platforms.forEach((p, i) => gallery(roof, tree, p, base, i));
  return roof.mesh();
}
