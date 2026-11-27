import type { HouseFront } from './houseFrontKit';
import type { RuralTrade } from './ruralTrades';
import type { BuildingVector as V } from './urbanBuildingGeometry';

const stone = 'city3d:detail:dressed-stone@a59883';
const iron = 'city3d:detail:ironwork@514f49';
const clay = 'city3d:detail:fired-clay@ad6850';
const dark = 'city3d:detail:recess@44392e';
const cloth = 'city3d:detail:canvas@ccc0a2';
const reed = 'city3d:detail:wicker@b49860';
const rope = 'city3d:detail:rope@92734d';

/** A slide gate feeds a short, open steel chute on one facet of the grain bin. */
export function drawSiloChute(g: HouseFront) {
  const half = Math.min(0.25, g.width * 0.35);
  const lip = half * 0.7;
  const reach = Math.min(0.65, g.depth);
  const steel = 'city3d:detail:steel@68665c';
  // The work frame starts 8 cm outside the wall. Seat the gate plate against it.
  g.box(-half - 0.03, half + 0.03, -0.1, 0, 0.78, 1.1, iron);
  g.face(
    [
      [-half, 0, 0.8],
      [half, 0, 0.8],
      [lip, reach, 0.55],
      [-lip, reach, 0.55],
    ],
    steel,
  );
  for (const side of [-1, 1]) {
    const cheek: V[] = [
      [side * half, 0, 0.8],
      [side * lip, reach, 0.55],
      [side * lip, reach, 0.64],
      [side * half, 0, 0.98],
    ];
    g.face(side < 0 ? cheek.reverse() : cheek, steel);
  }
}

/** Fit the work to the allotted bay. All positions below are fractions of its measured
 * width, depth and height. Rotated rings are built as faces so their normals follow the model. */
export function drawRuralEquipment(g: HouseFront, trade: RuralTrade, family?: string) {
  const xScale = g.width / 2,
    yScale = g.depth,
    zScale = g.height;
  const p = (x: number, y: number, z: number): V => [x * xScale, y * yScale, z * zScale];
  const box = (x: number, u: number, y: number, v: number, z: number, w: number, m: string) => g.box(x * xScale, u * xScale, y * yScale, v * yScale, z * zScale, w * zScale, m);
  const line = (a: V, b: V, width: number, m: string) => g.beam(p(...a), p(...b), width * Math.min(xScale, yScale, zScale), m);
  const post = (x: number, y: number, low: number, high: number, radius: number, m: string, sides = 8) => g.post(x * xScale, y * yScale, low * zScale, high * zScale, radius * Math.min(xScale, yScale), m, sides);
  const steel = /industrial|modernist|contemporary|futuristic/.test(family ?? '');
  const eastern = /chinese|japanese|indian/.test(family ?? '');
  const timber = steel ? iron : eastern ? 'city3d:detail:joinery@84563f' : 'city3d:detail:sawn-timber@826843';
  function rack(upper: number, middle = false) {
    for (const x of [-0.84, 0.84]) {
      for (const y of [0.16, 0.84]) post(x, y, 0, upper, 0.068, timber, 4);
      line([x, 0.16, upper * 0.5], [x, 0.81, upper], 0.065, timber);
      if (eastern) box(x - 0.13, x + 0.13, 0.07, 0.93, upper - 0.1, upper - 0.045, timber);
    }
    box(-0.98, 0.98, 0.045, 0.945, upper, upper + 0.055, timber);
    if (middle) box(-0.93, 0.93, 0.08, 0.92, upper * 0.48, upper * 0.48 + 0.05, timber);
  }
  // Open, turned forms: the lip and dark inside remain visible from above.
  function vessel(x: number, y: number, base: number, r: number, h: number, material: string) {
    const radius = r * Math.min(xScale, yScale),
      n = 10;
    const outline = [
      [0.5, 0],
      [0.95, 0.28],
      [1, 0.62],
      [0.63, 0.84],
      [0.74, 0.93],
      [0.74, 1],
      [0.52, 1],
      [0.5, 0.84],
    ];
    const rings = outline.map(([rr, zz]) => Array.from({ length: n }, (_, i): V => [x * xScale + Math.cos((i * 2 * Math.PI) / n) * radius * rr, y * yScale + Math.sin((i * 2 * Math.PI) / n) * radius * rr, (base + zz * h) * zScale]));
    for (let j = 1; j < rings.length; j++)
      for (let i = 0; i < n; i++) {
        const k = (i + 1) % n;
        g.face([rings[j - 1][i], rings[j - 1][k], rings[j][k], rings[j][i]], material);
      }
    g.face(rings[rings.length - 1], dark);
  }
  function wheel(x: number, y: number, z: number, r: number, m: string) {
    const radius = r * Math.min(xScale, zScale),
      hub = p(x, y, z);
    const at = (i: number, f: number): V => [hub[0] + radius * f * Math.cos((i * Math.PI) / 6), hub[1], hub[2] + radius * f * Math.sin((i * Math.PI) / 6)];
    for (let i = 0; i < 12; i++) {
      g.beam(at(i, 1), at(i + 1, 1), radius * 0.16, m);
      if (!(i % 2)) g.beam(hub, at(i, 0.97), radius * 0.085, m);
    }
  }
  function blocks(m: string) {
    for (let row = 0; row < 3; row++)
      for (let i = 0; i < 3 - row; i++) {
        const x = (i - (2 - row) / 2) * 0.63;
        box(x - 0.3, x + 0.3, 0.1 + row * 0.05, 0.91 - row * 0.05, row * 0.16, row * 0.16 + 0.15, m);
      }
  }
  function firebox() {
    box(-0.74, 0.74, 0.17, 0.81, 0, 0.48, clay);
    box(-0.34, 0.34, 0.81, 0.824, 0, 0.31, dark);
    box(-0.46, 0.46, 0.8, 0.89, 0.31, 0.38, stone);
    post(0, 0.48, 0.48, 0.68, 0.42, clay);
    post(0, 0.48, 0.68, 0.99, 0.21, clay);
    post(0, 0.48, 0.95, 1, 0.26, stone);
  }
  switch (trade) {
    case 'mill':
      for (const [x, y] of [
        [-0.4, 0.48],
        [0.46, 0.57],
      ]) {
        const radius = 0.4 * Math.min(xScale, yScale),
          cx = x * xScale,
          cy = y * yScale;
        const at = (i: number, r: number, z: number): V => [cx + Math.cos((i * Math.PI) / 8) * radius * r, cy + Math.sin((i * Math.PI) / 8) * radius * r, z * zScale];
        for (let i = 0; i < 16; i++) {
          g.face([at(i, 1, 0), at(i + 1, 1, 0), at(i + 1, 1, 0.22), at(i, 1, 0.22)], stone);
          g.face([at(i, 1, 0.22), at(i + 1, 1, 0.22), at(i + 1, 0.16, 0.22), at(i, 0.16, 0.22)], stone);
          g.face([at(i, 0.16, 0.22), at(i + 1, 0.16, 0.22), at(i + 1, 0.16, 0), at(i, 0.16, 0)], dark);
          if (!(i % 2)) g.beam(at(i, 0.32, 0.221), at(i + 1, 0.91, 0.221), radius * 0.028, dark);
        }
      }
      break;
    case 'pottery':
      rack(0.43);
      for (const x of [-0.7, -0.29, 0.1]) vessel(x, 0.47, 0.49, 0.16, 0.27, clay);
      post(0.65, 0.55, 0.49, 0.61, 0.085, timber);
      post(0.65, 0.55, 0.61, 0.65, 0.29, stone, 12);
      vessel(0.65, 0.55, 0.65, 0.155, 0.19, clay);
      break;
    case 'hoist':
      for (const x of [-0.8, 0.8]) for (const y of [0.12, 0.89]) line([x, y, 0], [x * 0.4, 0.5, 0.92], 0.105, timber);
      line([-0.8, 0.12, 0.06], [0.56, 0.69, 0.68], 0.072, timber);
      line([-0.42, 0.5, 0.89], [0.42, 0.5, 0.89], 0.14, iron);
      wheel(0, 0.5, 0.84, 0.27, iron);
      line([0.19, 0.5, 0.84], [0.19, 0.5, 0.22], 0.035, rope);
      box(-0.12, 0.46, 0.28, 0.73, 0.085, 0.25, iron);
      break;
    case 'adit':
      for (const x of [-0.78, 0.78]) {
        line([x, 0.83, 0], [x * 0.84, 0.69, 0.78], 0.16, timber);
        line([x, 0.18, 0], [x * 0.84, 0.18, 0.78], 0.14, timber);
      }
      for (const y of [0.18, 0.72]) line([-0.76, y, 0.81], [0.76, y, 0.81], 0.19, timber);
      for (const x of [-0.41, 0.41]) line([x, 0.02, 0.055], [x, 0.97, 0.055], 0.065, iron);
      for (const y of [0.18, 0.44, 0.7, 0.9]) box(-0.56, 0.56, y - 0.034, y + 0.034, 0, 0.045, timber);
      break;
    case 'crane':
      box(-0.81, 0.23, 0.22, 0.78, 0, 0.14, stone);
      line([-0.39, 0.5, 0.11], [-0.39, 0.5, 0.98], 0.16, timber);
      line([-0.64, 0.5, 0.52], [0.86, 0.5, 0.85], 0.14, timber);
      line([-0.39, 0.5, 0.96], [0.86, 0.5, 0.85], 0.05, rope);
      line([-0.39, 0.5, 0.3], [0.48, 0.5, 0.77], 0.095, timber);
      wheel(-0.43, 0.67, 0.38, 0.3, timber);
      line([0.81, 0.5, 0.83], [0.81, 0.5, 0.24], 0.035, rope);
      box(0.62, 0.98, 0.32, 0.69, 0.1, 0.24, stone);
      break;
    case 'stone':
      blocks(stone);
      break;
    case 'ore':
      rack(0.36);
      for (let i = 0; i < 6; i++) post(((i % 3) - 1) * 0.49, 0.3 + Math.floor(i / 3) * 0.39, 0.42, 0.48 + (i % 3) * 0.045, 0.18, i % 2 ? stone : iron, 5);
      break;
    case 'kiln':
      firebox();
      break;
    case 'forge':
      post(-0.4, 0.5, 0, 0.34, 0.34, timber, 7);
      box(-0.71, -0.1, 0.32, 0.68, 0.34, 0.44, iron);
      box(-0.83, 0.06, 0.29, 0.72, 0.44, 0.53, iron);
      box(0.26, 0.89, 0.17, 0.83, 0, 0.41, stone);
      box(0.31, 0.84, 0.23, 0.79, 0.41, 0.45, dark);
      post(0.58, 0.36, 0.44, 0.91, 0.17, clay);
      break;
    case 'press':
      for (const x of [-0.78, 0.78]) post(x, 0.52, 0, 0.86, 0.105, timber, 4);
      box(-0.95, 0.95, 0.38, 0.65, 0.83, 0.94, timber);
      post(0, 0.52, 0.35, 0.87, 0.1, iron);
      line([-0.53, 0.52, 0.68], [0.53, 0.52, 0.68], 0.065, timber);
      post(0, 0.52, 0.29, 0.36, 0.44, timber);
      post(0, 0.52, 0, 0.18, 0.51, stone);
      break;
    case 'grain':
    case 'store':
      rack(0.22);
      if (trade === 'grain')
        for (const x of [-0.6, 0, 0.6]) {
          vessel(x, 0.49, 0.278, 0.27, 0.42, reed);
          post(x, 0.49, 0.674, 0.7, 0.13, rope);
        }
      else
        for (const x of [-0.49, 0.49]) {
          box(x - 0.39, x + 0.39, 0.15, 0.85, 0.28, 0.65, timber);
          for (const k of [-0.23, 0.23]) box(x + k - 0.024, x + k + 0.024, 0.14, 0.86, 0.28, 0.66, iron);
        }
      break;
    case 'trough':
    case 'water':
      box(-0.91, 0.91, 0.14, 0.87, 0.12, 0.2, stone);
      for (const y of [0.15, 0.8]) box(-0.92, 0.92, y - 0.05, y + 0.05, 0.19, 0.43, stone);
      for (const x of [-0.86, 0.86]) box(x - 0.055, x + 0.055, 0.15, 0.81, 0.19, 0.43, stone);
      if (trade === 'water') {
        post(-0.65, 0.42, 0.2, 0.79, 0.125, stone);
        line([-0.65, 0.42, 0.7], [-0.22, 0.42, 0.7], 0.1, iron);
      } else for (const x of [-0.62, 0.62]) box(x - 0.1, x + 0.1, 0.2, 0.8, 0, 0.12, timber);
      break;
    case 'birds':
      post(0, 0.51, 0, 0.48, 0.13, timber);
      box(-0.72, 0.72, 0.21, 0.78, 0.45, 0.87, timber);
      for (const x of [-0.41, 0, 0.41]) {
        box(x - 0.1, x + 0.1, 0.78, 0.791, 0.54, 0.7, dark);
        box(x - 0.16, x + 0.16, 0.76, 0.96, 0.5, 0.535, timber);
      }
      box(-0.83, 0.83, 0.12, 0.88, 0.87, 0.94, g.cover);
      break;
    case 'vessels':
    case 'resin':
      for (const [x, r, h] of [
        [-0.49, 0.4, 0.52],
        [0.42, 0.32, 0.42],
      ])
        vessel(x, 0.5, 0.015, r, h, trade === 'resin' ? clay : timber);
      break;
    case 'timber':
      for (let row = 0; row < 3; row++) for (let i = 0; i < 3 - row; i++) line([-0.9, 0.19 + i * 0.27 + row * 0.135, 0.09 + row * 0.15], [0.9, 0.19 + i * 0.27 + row * 0.135, 0.09 + row * 0.15], 0.2, timber);
      break;
    case 'apiary':
      for (const x of [-0.47, 0.47]) for (let i = 0; i < 5; i++) post(x, 0.49, i * 0.09, (i + 1) * 0.09, 0.36 - i * 0.05, reed, 12);
      break;
    case 'net':
    case 'loom':
    case 'hides':
    case 'drying':
    case 'smoke':
    case 'fungi':
      for (const x of [-0.88, 0.88]) post(x, 0.5, 0, 0.87, 0.065, timber, 4);
      line([-0.94, 0.5, 0.82], [0.94, 0.5, 0.82], 0.086, timber);
      if (trade === 'fungi' || trade === 'drying') {
        for (const z of [0.28, 0.54]) {
          box(-0.93, 0.93, 0.2, 0.8, z, z + 0.045, timber);
          for (const x of [-0.63, -0.2, 0.23, 0.66]) post(x, 0.49, z + 0.045, z + 0.12, 0.12, trade === 'fungi' ? clay : reed, 6);
        }
      } else if (trade === 'net' || trade === 'loom') {
        for (let i = 0; i < 9; i++) {
          const x = -0.72 + i * 0.18;
          line([x, 0.5, 0.8], [x * 0.86, 0.58, 0.19], 0.021, trade === 'net' ? rope : cloth);
        }
        for (const z of [0.23, 0.38, 0.53, 0.68]) line([-0.7, 0.55, z], [0.7, 0.55, z], 0.027, trade === 'net' ? rope : cloth);
        line([-0.8, 0.58, 0.18], [0.8, 0.58, 0.18], 0.055, timber);
      } else
        for (const x of [-0.5, 0.0, 0.5]) {
          const w = trade === 'hides' ? 0.2 : 0.09;
          g.face([p(x - w, 0.5, 0.78), p(x + w, 0.5, 0.78), p(x + w * 0.73, 0.58, 0.36), p(x, 0.58, 0.25), p(x - w * 0.75, 0.55, 0.39)].reverse(), trade === 'hides' ? reed : clay);
        }
      break;
    case 'boat': {
      const keel: V[] = [p(-0.96, 0.5, 0.51), p(-0.64, 0.5, 0.21), p(0.64, 0.5, 0.21), p(0.96, 0.5, 0.51)];
      for (const side of [0.14, 0.86]) {
        const rim: V[] = [keel[0], p(-0.62, side, 0.49), p(0.62, side, 0.49), keel[3]];
        for (let i = 0; i < 3; i++) g.face([keel[i], keel[i + 1], rim[i + 1], rim[i]], timber);
      }
      for (const x of [-0.51, 0.51]) box(x - 0.075, x + 0.075, 0.18, 0.82, 0.42, 0.48, timber);
      break;
    }
    case 'wheels':
      rack(0.36);
      wheel(-0.38, 0.87, 0.47, 0.41, timber);
      wheel(0.45, 0.82, 0.39, 0.34, timber);
      break;
    case 'bench':
    case 'market':
    case 'lodging':
      rack(trade === 'lodging' ? 0.24 : 0.44);
      if (trade === 'market') {
        for (const x of [-0.82, 0.82]) post(x, 0.22, 0.48, 0.9, 0.055, timber);
        box(-0.99, 0.99, 0.08, 0.99, 0.89, 0.95, cloth);
        vessel(0.09, 0.55, 0.5, 0.25, 0.19, clay);
      }
      if (trade === 'bench') {
        box(-0.66, -0.27, 0.2, 0.76, 0.5, 0.64, stone);
        line([0.0, 0.24, 0.52], [0.68, 0.72, 0.52], 0.07, timber);
      }
      break;
    case 'guard':
      for (const x of [-0.69, 0.69]) post(x, 0.49, 0, 0.51, 0.1, timber);
      box(-0.82, 0.82, 0.36, 0.63, 0.45, 0.57, timber);
      post(0.59, 0.49, 0.57, 0.88, 0.05, iron);
      vessel(0.59, 0.49, 0.87, 0.19, 0.13, iron);
      break;
    case 'shrine':
    case 'memorial':
      for (const x of [-0.58, 0.58]) {
        const base = trade === 'shrine' ? g.wall : stone;
        box(x - 0.25, x + 0.25, 0.23, 0.76, 0, 0.11, base);
        post(x, 0.5, 0.11, 0.47, 0.145, base, eastern ? 4 : 8);
        if (trade === 'shrine') vessel(x, 0.5, 0.47, 0.23, 0.15, clay);
        else {
          box(x - 0.21, x + 0.21, 0.3, 0.7, 0.47, 0.57, stone);
          post(x, 0.5, 0.57, 0.63, 0.14, stone, 4);
        }
      }
      break;
  }
}
