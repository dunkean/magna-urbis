import type { ArchitectureVolume } from '../../../rust/bridge/urbanArchitecture';
import type { BuildingTriangle, BuildingVector } from './urbanBuildingGeometry';

const BRAID = 'city3d:detail:cord@80664b';
const LAP = 'city3d:detail:felt-edge@c5b89e';
const HEM = 'city3d:detail:felt-edge@b7aa90';
const WOOD = 'city3d:detail:timber@99643f';
const EDGE = 'city3d:detail:timber@bf8956';
const INSIDE = 'city3d:detail:interior@594a39';
const TURN = 2 * Math.PI;

/** The near-view ger keeps its wall, footprint and seat. Its conical cover ends at an open
 * timber smoke ring. Raised seams and tension ropes belong to this whole tent's construction. */
export function craftedYurt(volume: ArchitectureVolume, culture: string, emit: (face: BuildingTriangle) => void): boolean {
  if (!['mongol-ordu', 'nomad-camp'].includes(culture) || !/felt/i.test(volume.materials.cladding) || volume.footprint.length !== 1) return false;
  const footprint = volume.footprint[0];
  if (footprint.holes.length || footprint.outer.length < 8 || volume.roof_height_m < 0.15 || volume.wall_height_m < 0.5) return false;
  let ring = footprint.outer;
  const n = ring.length,
    cx = ring.reduce((sum, p) => sum + p.x, 0) / n,
    cy = ring.reduce((sum, p) => sum + p.y, 0) / n;
  const radii = ring.map(p => Math.hypot(p.x - cx, p.y - cy));
  const radius = radii.reduce((a, b) => a + b) / n;
  if (Math.min(...radii) < 0.72 * Math.max(...radii) || radius < 1.2) return false;
  const winding = ring.reduce((a, p, i) => a + (p.x - cx) * (ring[(i + 1) % n].y - cy) - (p.y - cy) * (ring[(i + 1) % n].x - cx), 0);
  if (winding < 0) ring = [...ring].reverse();
  const materials = volume.materials;
  const triangle = (a: BuildingVector, b: BuildingVector, c: BuildingVector, material: string): void => {
    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      uz = b[2] - a[2];
    const vx = c[0] - a[0],
      vy = c[1] - a[1],
      vz = c[2] - a[2];
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    if (length > 1e-8) emit({ points: [a, b, c], material, materials, surface: 'roof', normal: [nx / length, ny / length, nz / length] });
  };
  const quad = (a: BuildingVector, b: BuildingVector, c: BuildingVector, d: BuildingVector, material: string): void => {
    triangle(a, b, c, material);
    triangle(a, c, d, material);
  };
  const point = (station: number, r: number, z: number): BuildingVector => {
    const index = Math.floor(station),
      t = station - index;
    const a = ring[((index % n) + n) % n],
      b = ring[(((index + 1) % n) + n) % n];
    return [cx + (a.x - cx + t * (b.x - a.x)) * r, cy + (a.y - cy + t * (b.y - a.y)) * r, z];
  };

  const eave = volume.z_m + volume.wall_height_m;
  const lip = 1 + Math.min(0.14, Math.max(0.06, volume.overhang_m)) / radius;
  const crown = Math.min(0.23, 0.7 / radius),
    crownZ = eave + volume.roof_height_m * 0.95;
  const coverPoint = (s: number, r: number, lift = 0): BuildingVector => {
    const towardEave = (r - crown) / (lip - crown);
    // Wool sags slightly between rafters at the unsupported lower edge.
    const wave = Math.sin(Math.PI * s);
    const z = crownZ + (eave - crownZ) * towardEave - 0.023 * wave * wave * towardEave * towardEave;
    return point(s, r, z + lift);
  };
  // Locate the framed entrance on a footprint facet, respecting the source door orientation.
  let door = 0,
    longest = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i],
      b = ring[(i + 1) % n],
      length = Math.hypot(a.x - b.x, a.y - b.y);
    if (length > longest) {
      longest = length;
      door = i;
    }
  }
  const doorAxis = door + 0.5;
  for (let i = 0; i < n * 2; i++) {
    const a = i * 0.5,
      b = a + 0.5;
    quad(coverPoint(a, lip), coverPoint(b, lip), coverPoint(b, crown), coverPoint(a, crown), materials.cladding);
    quad(coverPoint(a, lip, -0.045), coverPoint(b, lip, -0.045), coverPoint(b, lip), coverPoint(a, lip), HEM);
    // The hem undulates, but a rigid hoop needs only one span per footprint edge.
    if (i % 2) continue;
    const next = a + 1;
    const inner = crown * 0.86;
    quad(point(a, crown, crownZ), point(next, crown, crownZ), point(next, crown, crownZ + 0.085), point(a, crown, crownZ + 0.085), WOOD);
    quad(point(a, crown, crownZ + 0.085), point(next, crown, crownZ + 0.085), point(next, inner, crownZ + 0.085), point(a, inner, crownZ + 0.085), EDGE);
    quad(point(next, inner, crownZ - 0.16), point(a, inner, crownZ - 0.16), point(a, inner, crownZ + 0.085), point(next, inner, crownZ + 0.085), INSIDE);
    for (const height of [0.48, 0.86]) {
      const z = volume.z_m + height * volume.wall_height_m,
        r = 1 + 0.013 / radius;
      quad(point(a, r, z - 0.021), point(next, r, z - 0.021), point(next, r, z + 0.021), point(a, r, z + 0.021), BRAID);
    }
  }
  // Four felt laps reach from the crown to the hem. Two finer pulls run down from the smoke flap.
  const radialStrip = (s: number, upper: number, lower: number, width: number, material: string): void => {
    const angular = (width * n) / (2 * TURN * radius);
    quad(coverPoint(s - angular / lower, lower, 0.023), coverPoint(s + angular / lower, lower, 0.023), coverPoint(s + angular / upper, upper, 0.023), coverPoint(s - angular / upper, upper, 0.023), material);
  };
  for (let i = 0; i < 4; i++) radialStrip(doorAxis + n * (0.09 + i / 4), crown, lip, 0.042, LAP);

  // The smoke flap lies folded back on the slope, leaving the ring exposed. Its two bound
  // corners point down toward the ties at the eaves.
  const flap = doorAxis + n * 0.5;
  const fa = flap - n * 0.076,
    fb = flap + n * 0.076;
  for (let i = 0; i < 4; i++) {
    const a = fa + ((fb - fa) * i) / 4,
      b = fa + ((fb - fa) * (i + 1)) / 4;
    quad(coverPoint(a, crown + 0.18, 0.036), coverPoint(b, crown + 0.18, 0.036), coverPoint(b, crown * 1.04, 0.036), coverPoint(a, crown * 1.04, 0.036), 'city3d:detail:felt@dbd0b8');
    quad(coverPoint(a, crown + 0.18, 0.049), coverPoint(b, crown + 0.18, 0.049), coverPoint(b, crown + 0.162, 0.061), coverPoint(a, crown + 0.162, 0.061), LAP);
  }
  for (const s of [fa, fb]) radialStrip(s, crown + 0.18, lip, 0.029, BRAID);

  // Two bowed timber crosspieces leave four clear openings for smoke and daylight.
  const frame = point(doorAxis, 1, 0);
  const direction = Math.atan2(frame[1] - cy, frame[0] - cx);
  const innerRadius = crown * radius * 0.88,
    width = Math.min(0.055, innerRadius * 0.11);
  for (const angle of [direction, direction + Math.PI / 2]) {
    const ux = Math.cos(angle),
      uy = Math.sin(angle);
    const arch = (t: number, side: number, lift: number): BuildingVector => [cx + ux * innerRadius * t - uy * side, cy + uy * innerRadius * t + ux * side, crownZ + 0.087 + (1 - t * t) * innerRadius * 0.24 + lift];
    for (let i = 0; i < 6; i++) {
      const a = -1 + i / 3,
        b = a + 1 / 3;
      quad(arch(a, -width, 0), arch(b, -width, 0), arch(b, width, 0), arch(a, width, 0), EDGE);
      quad(arch(a, -width, -0.06), arch(b, -width, -0.06), arch(b, -width, 0), arch(a, -width, 0), WOOD);
      quad(arch(b, width, -0.06), arch(a, width, -0.06), arch(a, width, 0), arch(b, width, 0), WOOD);
    }
  }

  const a = ring[door],
    b = ring[(door + 1) % n],
    ux = (b.x - a.x) / longest,
    uy = (b.y - a.y) / longest;
  const half = Math.min(0.52, longest * 0.45),
    h = Math.min(1.52, volume.wall_height_m - 0.06);
  const atDoor = (s: number, z: number, projection: number): BuildingVector => [(a.x + b.x) * 0.5 + ux * s + uy * projection, (a.y + b.y) * 0.5 + uy * s - ux * projection, volume.z_m + z];
  const panel = (left: number, right: number, low: number, high: number, out: number, material: string): void => quad(atDoor(left, low, out), atDoor(right, low, out), atDoor(right, high, out), atDoor(left, high, out), material);
  panel(-half, half, 0.012, h, 0.049, 'city3d:detail:door@855235');
  for (const side of [-1, 1]) {
    const x = side * (half - 0.04);
    panel(x - 0.04, x + 0.04, 0.02, h, 0.09, EDGE);
  }
  panel(-half, half, h - 0.105, h, 0.095, EDGE);
  panel(-half, half, 0.012, 0.085, 0.095, WOOD);
  for (const z of [0.22, 0.74]) panel(-half + 0.14, half - 0.14, h * z, h * z + 0.055, 0.065, WOOD);
  panel(half * 0.53, half * 0.53 + 0.045, h * 0.44, h * 0.5, 0.08, INSIDE);
  return true;
}
