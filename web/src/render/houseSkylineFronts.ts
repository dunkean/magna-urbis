import type { HouseFront } from './houseFrontKit';
type V = [number, number, number];
const alloy = 'city3d:wall:steel@677278',
  graphite = 'city3d:wall:steel@475054',
  glass = 'city3d:detail:glass@517174',
  bronze = 'city3d:cover:metal@9b8056',
  stone = 'city3d:wall:stone@a89a86',
  ceramic = 'city3d:wall:concrete@d2c9b6';
function passage(g: HouseFront, space: boolean) {
  const w = Math.min(g.width * 0.49, 2.1),
    d = g.depth,
    h = Math.min(3.36, g.height - 0.06),
    chamfer = Math.min(0.48, 0.22 * w);
  const profile = (y: number, r: number): V[] => [
    [-w + r, y, 0],
    [-w + r, y, h - chamfer],
    [-w + chamfer + r, y, h - r],
    [w - chamfer - r, y, h - r],
    [w - r, y, h - chamfer],
    [w - r, y, 0],
  ];
  const stations = space ? [0, d * 0.28, d * 0.73, d * 0.91, d] : [0, d * 0.69, d];
  for (let j = 1; j < stations.length; j++) {
    const a = profile(stations[j - 1], j === 2 ? 0.1 : 0),
      b = profile(stations[j], j === 1 ? 0.1 : 0);
    for (let i = 0; i < 5; i++) g.face([a[i], b[i], b[i + 1], a[i + 1]], space ? (j % 2 ? ceramic : alloy) : graphite);
  }
  const rim = profile(d, 0),
    inside = profile(d, 0.105);
  for (let i = 0; i < 5; i++) g.face([rim[i], inside[i], inside[i + 1], rim[i + 1]], space ? alloy : bronze);
  for (const side of [-1, 1]) {
    const x = side * (w - 0.09);
    g.box(x - 0.035, x + 0.035, d - 0.28, d - 0.05, h * 0.45, h * 0.78, space ? 'city3d:detail:ceramic@c8d7c8' : 'city3d:detail:signal@b88961');
  }
}
function solar(g: HouseFront) {
  const w = g.width * 0.46,
    d = g.depth,
    h = Math.min(3.05, g.height - 0.08);
  for (const side of [-1, 1]) {
    const x = side * w * 0.76;
    g.beam([x, 0, h * 0.45], [x, d * 0.7, h - 0.26], 0.13, alloy);
    for (let k = 0; k < 3; k++) {
      const x0 = side * w * (0.06 + k * 0.32),
        x1 = x0 + side * w * 0.27,
        z0 = h - 0.27 + k * 0.1,
        z1 = z0 + 0.1;
      g.face(
        [
          [x0, 0, z0],
          [x1, 0, z1],
          [x1, d * (0.9 + k * 0.035), z1 - 0.19],
          [x0, d * 0.92, z0 - 0.18],
        ],
        'city3d:detail:photovoltaic@495f68',
      );
      g.beam([x0, d * 0.92, z0 - 0.18], [x1, d * (0.9 + k * 0.035), z1 - 0.19], 0.055, alloy);
    }
  }
}
function corporate(g: HouseFront) {
  const w = g.width * 0.49,
    d = g.depth,
    h = Math.min(g.height, 4.65);
  g.face(
    [
      [-w, 0, h],
      [w, 0, h],
      [w * 0.72, d, h - 0.3],
      [-w * 0.72, d, h - 0.3],
    ],
    ceramic,
  );
  for (const side of [-1, 1]) {
    const x = side * w;
    const foot: V = [x * 0.93, d * 0.58, 0],
      head: V = [x * 0.72, d, h - 0.3];
    g.beam(foot, head, Math.min(0.32, w * 0.15), ceramic);
    for (let k = 0; k < 3; k++) {
      const z = h * (0.18 + k * 0.225);
      g.face(
        [
          [x, 0.04, z],
          [x, 0.04, z + 0.18],
          [x * 0.85, d * 0.7, z + 0.22],
          [x * 0.85, d * 0.7, z + 0.13],
        ],
        alloy,
      );
    }
  }
}
function cyber(g: HouseFront) {
  const w = g.width * 0.48,
    d = g.depth,
    h = Math.min(g.height - 0.04, 3.1);
  g.box(-w, w, 0, d, h - 0.25, h, graphite);
  g.box(-w * 0.8, w * 0.5, d - 0.027, d, h - 0.18, h - 0.14, 'city3d:detail:light@7ec2b4');
  const x = w * 0.75;
  g.box(x - 0.16, x + 0.13, 0.04, d * 0.52, 0.1, h - 0.22, alloy);
  for (let k = 0; k < 4; k++) g.box(x - 0.17, x + 0.14, d * 0.51, d * 0.55, h * 0.32 + k * 0.15, h * 0.32 + k * 0.15 + 0.055, graphite);
  g.beam([-w * 0.85, 0.025, h - 0.54], [-w * 0.85, d * 0.84, h - 0.25], 0.085, bronze);
}
function mage(g: HouseFront, mechanical: boolean) {
  const w = g.width * 0.46,
    d = g.depth,
    h = Math.min(g.height, 3.3),
    rim = mechanical ? bronze : stone,
    hood = mechanical ? alloy : 'city3d:cover:slate@655d70';
  for (const s of [-1, 1]) {
    const x = s * w * 0.83;
    g.box(x - 0.1, x + 0.1, d * 0.73, d * 0.87, 0, h * 0.57, rim);
    g.beam([x, d * 0.8, h * 0.52], [x * 0.86, d * 0.81, h * 0.79], 0.13, rim);
    g.beam([x * 0.86, d * 0.81, h * 0.79], [0, d * 0.81, h], 0.13, rim);
    g.face(
      [
        [s * w, 0, h * 0.75],
        [0, 0, h + 0.14],
        [0, d * 0.9, h + 0.02],
        [s * w, d * 0.87, h * 0.72],
      ],
      hood,
    );
  }
  if (mechanical) {
    for (const s of [-1, 1]) g.post(s * w * 0.82, d * 0.8, h * 0.52, h * 0.63, 0.16, bronze, 8);
  } else g.beam([0, 0, h + 0.16], [0, d * 0.9, h + 0.04], 0.07, bronze);
}
export const skylineFronts: Record<string, (g: HouseFront) => void> = {
  cyberpunk: cyber,
  solarpunk: solar,
  'corporate-arcology': corporate,
  'futuristic-space-colony': g => passage(g, true),
  'dystopian-brutalism': g => passage(g, false),
  'wizard-city': g => mage(g, false),
  gnomish: g => mage(g, true),
};
