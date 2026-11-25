import type { HouseFront } from './houseFrontKit';
type V = [number, number, number];
const alloy = 'city3d:wall:steel@677278',
  graphite = 'city3d:wall:steel@475054',
  glass = 'city3d:detail:glass@517174',
  bronze = 'city3d:cover:metal@9b8056',
  stone = 'city3d:wall:stone@a89a86',
  ceramic = 'city3d:wall:concrete@d2c9b6';
/** Successive sections across the face define both the outline in plan and the ridge.
 * Normals on roof panels point up; their eave faces point toward the street. */
function canopy(g: HouseFront, sections: [number, number, number, number][], mat: string, lip: string, thickness: number) {
  for (let i = 1; i < sections.length; i++) {
    const [x0, back0, front0, y0] = sections[i - 1],
      [x1, back1, front1, y1] = sections[i];
    const a: V = [x0, y0, front0],
      b: V = [x1, y1, front1];
    g.face([[x0, 0, back0], [x1, 0, back1], b], mat);
    g.face([[x0, 0, back0], b, a], mat);
    g.face([b, a, [x0, y0, front0 - thickness], [x1, y1, front1 - thickness]], lip);
  }
}
/** Keep angled beam corners inside the side, depth and floor limits even on shallow entries. */
function fittedBeam(g: HouseFront, a: V, b: V, thickness: number, material: string) {
  const size = Math.min(thickness, g.depth * 0.4, g.width * 0.2);
  const inset = size / Math.sqrt(2),
    half = g.width / 2;
  const seat = ([x, y, z]: V): V => [Math.max(-half + inset, Math.min(half - inset, x)), Math.max(inset, Math.min(g.depth - inset, y)), Math.max(inset, z)];
  g.beam(seat(a), seat(b), size, material);
}
function passage(g: HouseFront, space: boolean) {
  const w = Math.min(g.width * 0.49, 2.1),
    d = g.depth,
    h = Math.min(3.36, g.height - 0.06),
    chamfer = Math.min(0.48, 0.22 * w);
  const layout = g.seed % 3;
  if (layout !== 0) {
    const cladding = space ? ceramic : graphite,
      trim = space ? alloy : bronze;
    for (const side of [-1, 1]) {
      const x = side * w * 0.85;
      const jambWidth = Math.min(0.22, w * 0.13);
      g.box(x - jambWidth, x + jambWidth, 0.02, d * 0.44, 0, h * 0.85, cladding);
      if (space) {
        // Independent gasketed airlock hoops vs a docking collar with two pylons.
        if (layout === 1) {
          for (const reach of [0.26, 0.79]) {
            fittedBeam(g, [x, d * reach, 0.06], [x, d * reach, h * 0.75], jambWidth, alloy);
            fittedBeam(g, [x, d * reach, h * 0.75], [side * w * 0.58, d * reach, h * 0.98], jambWidth, ceramic);
            fittedBeam(g, [side * w * 0.58, d * reach, h * 0.98], [0, d * reach, h * 0.98], jambWidth, alloy);
          }
        } else {
          fittedBeam(g, [side * w * 0.9, d * 0.39, h * 0.37], [side * w * 0.75, d * 0.73, h * 0.94], jambWidth, alloy);
          g.box(x - jambWidth, x + jambWidth, 0.04, d * 0.33, h * 0.84, h * 1.15, alloy);
        }
      } else {
        // Projecting concrete fins bear on broad side cheeks.
        const count = layout === 1 ? 3 : 2;
        for (let i = 0; i < count; i++) {
          const reach = d * (0.27 + i * 0.23);
          fittedBeam(g, [x, reach, h * 0.39], [side * w * 0.65, reach, h * 0.88], jambWidth * 1.25, graphite);
        }
      }
    }
    if (space && layout === 1)
      canopy(
        g,
        [
          [-w * 0.91, h * 0.85, h * 0.81, d * 0.33],
          [-w * 0.58, h, h, d * 0.79],
          [w * 0.58, h, h, d * 0.79],
          [w * 0.91, h * 0.85, h * 0.81, d * 0.33],
        ],
        ceramic,
        alloy,
        0.07,
      );
    else if (space)
      canopy(
        g,
        [
          [-w * 0.84, h * 0.96, h * 0.92, d * 0.49],
          [-w * 0.63, h * 1.06, h * 1.02, d * 0.79],
          [0, h * 1.06, h * 0.95, d * 0.94],
          [w * 0.63, h * 1.06, h * 1.02, d * 0.79],
          [w * 0.84, h * 0.96, h * 0.92, d * 0.49],
        ],
        ceramic,
        alloy,
        0.1,
      );
    else if (layout === 1) {
      for (const [span, reach, z] of [
        [0.99, 0.46, 0.92],
        [0.84, 0.69, 1],
        [0.61, 0.89, 1.08],
      ])
        g.box(-w * span, w * span, 0.02, d * reach, h * z - 0.17, h * z, graphite);
    } else {
      canopy(
        g,
        [
          [-w, 0.99 * h, 0.94 * h, 0.59 * d],
          [-0.4 * w, 1.13 * h, 1.08 * h, 0.87 * d],
          [0.57 * w, 0.95 * h, 0.89 * h, 0.83 * d],
          [w, 0.9 * h, 0.83 * h, 0.53 * d],
        ],
        cladding,
        trim,
        0.16,
      );
      g.box(-w * 0.9, -w * 0.6, 0.04, d * 0.74, h * 0.25, h * 0.34, graphite);
    }
    return;
  }
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
  const layout = g.seed % 3,
    cell = 'city3d:detail:photovoltaic@495f68';
  if (layout === 1) {
    // Petals rotate around a wall-mounted collector and leave radial slots for daylight.
    const root: V = [0, d * 0.04, h * 1.05];
    for (let i = 0; i < 7; i++) {
      const at = (angle: number): V => [-w * Math.cos(angle), d * (0.09 + 0.83 * Math.sin(angle)), h * (0.87 + 0.08 * Math.sin(angle))];
      const a = at(((i + 0.055) * Math.PI) / 7),
        b = at(((i + 0.945) * Math.PI) / 7);
      g.face([root, b, a], cell);
      fittedBeam(g, a, b, 0.065, alloy);
    }
    for (const s of [-1, 1]) fittedBeam(g, [s * w * 0.65, d * 0.05, h * 0.46], [s * w * 0.64, d * 0.68, h * 0.9], 0.11, alloy);
    return;
  }
  if (layout === 2) {
    // A serrated bank of tilted collectors has a broad north-light slot between panels.
    for (let i = 0; i < 3; i++) {
      const start = w * (-0.96 + i * 0.66);
      canopy(
        g,
        [
          [start, h * 0.95, h * 0.88, d * 0.78],
          [start + w * 0.58, h * 1.09, h * 1.03, d * 0.88],
        ],
        cell,
        alloy,
        0.055,
      );
    }
    for (const y of [0.25, 0.67]) fittedBeam(g, [-w * 0.89, d * y, h * 0.89], [w * 0.88, d * y, h * 0.89], 0.09, alloy);
    return;
  }
  for (const side of [-1, 1]) {
    const x = side * w * 0.76;
    fittedBeam(g, [x, 0, h * 0.45], [x, d * 0.7, h - 0.26], 0.13, alloy);
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
      fittedBeam(g, [x0, d * 0.92, z0 - 0.18], [x1, d * (0.9 + k * 0.035), z1 - 0.19], 0.055, alloy);
    }
  }
}
function corporate(g: HouseFront) {
  const w = g.width * 0.49,
    d = g.depth,
    h = Math.min(g.height, 4.65);
  const layout = g.seed % 3;
  if (layout === 1) {
    // Two glazed blades overlap a stone porte-cochère.
    canopy(
      g,
      [
        [-w, h * 0.99, h * 0.94, d * 0.7],
        [-w * 0.26, h * 1.06, h * 0.99, d * 0.86],
        [w * 0.45, h * 1.06, h * 0.99, d * 0.86],
      ],
      glass,
      alloy,
      0.095,
    );
    canopy(
      g,
      [
        [-w * 0.2, h * 0.93, h * 0.88, d * 0.73],
        [w, h * 0.93, h * 0.88, d * 0.73],
      ],
      ceramic,
      alloy,
      0.14,
    );
  } else if (layout === 2) {
    // Nested horizontal cantilevers with an open shadow joint between the levels.
    for (const [left, right, z, reach] of [
      [-1, 0.96, 0.89, 0.63],
      [-0.76, 0.8, 0.97, 0.83],
      [-0.48, 0.63, 1.05, 0.95],
    ]) {
      g.box(w * left, w * right, 0.01, d * reach, h * z - 0.11, h * z, ceramic);
      g.box(w * left, w * right, d * reach * 0.97, d * reach, h * z - 0.045, h * z, alloy);
    }
  } else
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
      head: V = layout === 1 ? [x * 0.72, d * 0.7, h * (side < 0 ? 0.95 : 0.88)] : layout === 2 ? [x * 0.72, d * 0.61, h * 0.89] : [x * 0.72, d, h - 0.3];
    fittedBeam(g, foot, head, Math.min(0.32, w * 0.15), ceramic);
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
  const layout = g.seed % 3,
    signal = 'city3d:detail:light@7ec2b4';
  if (layout === 1) {
    // The sign box turns a corner, with three cantilevered service louvres over the door.
    g.box(-w, -w * 0.68, 0.02, d * 0.75, h * 0.86, h * 1.13, graphite);
    g.box(-w * 0.9, -w * 0.76, d * 0.75, d * 0.79, h * 0.9, h * 1.08, signal);
    for (const [z, reach] of [
      [0.89, 0.88],
      [0.96, 0.7],
      [1.03, 0.52],
    ])
      g.box(-w * 0.78, w * 0.94, 0.01, d * reach, h * z - 0.07, h * z, alloy);
  } else if (layout === 2) {
    canopy(
      g,
      [
        [-w, h, h * 0.94, d * 0.48],
        [-w * 0.57, h * 1.06, h * 0.98, d * 0.89],
        [w * 0.17, h * 0.96, h * 0.9, d * 0.95],
      ],
      graphite,
      signal,
      0.052,
    );
    canopy(
      g,
      [
        [w * 0.1, h * 0.92, h * 0.86, d * 0.83],
        [w, h * 1.09, h * 1.01, d * 0.61],
      ],
      alloy,
      graphite,
      0.13,
    );
    fittedBeam(g, [w * 0.77, d * 0.08, h * 0.7], [w * 0.62, d * 0.59, h * 0.93], 0.1, bronze);
  } else {
    g.box(-w, w, 0, d, h - 0.25, h, graphite);
    g.box(-w * 0.8, w * 0.5, d - 0.027, d, h - 0.18, h - 0.14, signal);
  }
  const x = w * 0.75;
  g.box(x - 0.16, x + 0.13, 0.04, d * 0.52, 0.1, h - 0.22, alloy);
  for (let k = 0; k < 4; k++) g.box(x - 0.17, x + 0.14, d * 0.51, d * 0.55, h * 0.32 + k * 0.15, h * 0.32 + k * 0.15 + 0.055, graphite);
  fittedBeam(g, [-w * 0.85, 0.025, h - 0.54], [-w * 0.85, d * 0.84, h - 0.25], 0.085, bronze);
}
function mage(g: HouseFront, mechanical: boolean) {
  const w = g.width * 0.46,
    d = g.depth,
    h = Math.min(g.height, 3.3),
    rim = mechanical ? bronze : stone,
    hood = mechanical ? alloy : 'city3d:cover:slate@655d70';
  const layout = g.seed % 3;
  if (layout !== 0) {
    for (const s of [-1, 1]) {
      const x = s * w * 0.8;
      g.post(x, d * 0.58, 0, h * 0.65, Math.min(w * 0.1, 0.17), rim, mechanical ? 6 : 8);
      fittedBeam(g, [x, d * 0.58, h * 0.57], [s * w * 0.52, d * 0.72, h * 0.89], 0.13, rim);
      if (mechanical) {
        g.post(x, d * 0.58, h * 0.51, h * 0.59, Math.min(w * 0.13, 0.21), bronze, 8);
        fittedBeam(g, [x, d * 0.55, h * 0.73], [s * w * 0.88, d * 0.27, h * 0.89], 0.1, alloy);
      } else {
        fittedBeam(g, [x, d * 0.57, h * 0.59], [s * w * 0.9, d * 0.27, h * 0.88], 0.1, stone);
      }
    }
    if (mechanical && layout === 1) {
      // A compact factory monitor over the workshop admits high light through the middle.
      canopy(
        g,
        [
          [-w, h * 0.92, h * 0.79, d * 0.68],
          [-w * 0.44, h * 0.99, h * 0.91, d * 0.83],
          [w * 0.44, h * 0.99, h * 0.91, d * 0.83],
          [w, h * 0.92, h * 0.79, d * 0.68],
        ],
        alloy,
        bronze,
        0.1,
      );
      g.box(-w * 0.41, w * 0.41, 0.04, d * 0.51, h * 0.98, h * 1.075, glass);
      g.box(-w * 0.49, w * 0.49, 0.02, d * 0.55, h * 1.075, h * 1.12, bronze);
    } else if (mechanical) {
      for (const [lo, hi, z] of [
        [-0.97, -0.31, 0.91],
        [-0.34, 0.34, 1.02],
        [0.31, 0.97, 0.94],
      ])
        canopy(
          g,
          [
            [w * lo, h * (z + 0.04), h * z, d * 0.79],
            [w * hi, h * (z + 0.18), h * (z + 0.12), d * 0.87],
          ],
          alloy,
          bronze,
          0.08,
        );
    } else if (layout === 1) {
      // A carved Gothic canopy with an open traceried gable under a single slender ridge.
      canopy(
        g,
        [
          [-w, h * 0.86, h * 0.79, d * 0.62],
          [-w * 0.44, h * 1.1, h * 0.97, d * 0.76],
          [0, h * 1.28, h * 1.2, d * 0.88],
          [w * 0.44, h * 1.1, h * 0.97, d * 0.76],
          [w, h * 0.86, h * 0.79, d * 0.62],
        ],
        hood,
        stone,
        0.075,
      );
      for (const s of [-1, 1]) {
        fittedBeam(g, [s * w * 0.52, d * 0.72, h * 0.86], [s * w * 0.2, d * 0.79, h * 0.98], 0.075, bronze);
        fittedBeam(g, [s * w * 0.2, d * 0.79, h * 0.98], [0, d * 0.84, h * 1.14], 0.075, bronze);
      }
    } else {
      // A lantern lights the landing through clerestory slots in its octagonal drum.
      canopy(
        g,
        [
          [-w, h * 0.91, h * 0.8, d * 0.61],
          [-w * 0.51, h * 1.03, h * 0.95, d * 0.8],
          [w * 0.51, h * 1.03, h * 0.95, d * 0.8],
          [w, h * 0.91, h * 0.8, d * 0.61],
        ],
        hood,
        stone,
        0.09,
      );
      const radius = Math.min(w * 0.28, d * 0.27);
      g.post(0, d * 0.42, h * 0.99, h * 1.06, radius, stone, 8);
      for (const s of [-1, 1]) g.post(s * radius * 0.72, d * 0.42, h * 1.04, h * 1.19, radius * 0.13, bronze, 6);
      for (let i = 0; i < 8; i++) {
        const at = (k: number): V => [Math.cos((Math.PI * k) / 4) * radius * 1.16, d * 0.42 + Math.sin((Math.PI * k) / 4) * radius * 1.16, h * 1.17];
        g.face([at(i), at(i + 1), [0, d * 0.42, h * 1.29]], hood);
      }
    }
    return;
  }
  for (const s of [-1, 1]) {
    const x = s * w * 0.83;
    g.box(x - 0.1, x + 0.1, d * 0.73, d * 0.87, 0, h * 0.57, rim);
    fittedBeam(g, [x, d * 0.8, h * 0.52], [x * 0.86, d * 0.81, h * 0.79], 0.13, rim);
    fittedBeam(g, [x * 0.86, d * 0.81, h * 0.79], [0, d * 0.81, h], 0.13, rim);
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
    for (const s of [-1, 1]) g.post(s * w * 0.82, d * 0.8, h * 0.52, h * 0.63, Math.min(0.16, d * 0.19, w * 0.15), bronze, 8);
  } else fittedBeam(g, [0, 0, h + 0.16], [0, d * 0.9, h + 0.04], 0.07, bronze);
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
