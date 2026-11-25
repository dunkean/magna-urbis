import type { HouseFront } from './houseFrontKit';

type Vec = [number, number, number];
type Side = -1 | 1;
type Cover = 'shed' | 'gable' | 'hip' | 'flat' | 'rafters' | 'vault';
type Support = 'stone' | 'column' | 'fork' | 'battered' | 'corbel';
const tint = (body: string, tone: string) => `city3d:wall:${body}@${tone}`;
const lime = tint('plaster', 'e1d3b7'),
  istrian = tint('ashlar', 'dfd8c6'),
  marble = tint('ashlar', 'c9bdab');
const brick = tint('brick', 'a76a50'),
  adobe = tint('earth', 'b17e5b'),
  pinkEarth = tint('earth', 'ad765c');
const rough = tint('stone', '9c9080'),
  basalt = tint('stone', '7c766a'),
  coral = tint('coral', 'c5b59a');
const cedar = tint('wood', '895e40'),
  dark = tint('wood', '644633'),
  reed = tint('wattle', 'be9d69');
const clayRoof = 'city3d:cover:tile@a56449',
  greenTile = 'city3d:cover:tile@668776';

/** Each side runs from the measured door edge (0) to the end of the usable wall (1).
 * Occupied window rectangles include those just outside the porch. A roof that meets one
 * gives way to it; the independent side pieces can still be built. */
function porch(g: HouseFront) {
  const edge = Math.min(g.width * 0.5 - 0.003, 2.75);
  const door = Math.min(edge, (g.doorWidth ?? Math.min(1.04, g.width * 0.56)) * 0.5);
  const head = Math.min(g.height, g.doorHeight ?? Math.min(2.08, g.height * 0.8));
  const wing = Math.max(0, edge - door),
    depth = Math.min(g.depth, 1.63);
  const room = Math.max(0, g.height - head);
  const side: Side = g.seed & 8 ? -1 : 1;
  const across = (s: Side, t: number) => s * (door + t * wing);
  const clear = (l: number, r: number, z0: number, z1: number) =>
    r > l && z1 > z0 && z0 >= 0 && z1 <= g.height + 0.0001 && !(l < door - 0.001 && r > -door + 0.001 && z0 < head - 0.001) && !(g.windows ?? []).some(a => l < a.x + a.width * 0.5 - 0.001 && r > a.x - a.width * 0.5 + 0.001 && z0 < a.top - 0.001 && z1 > a.bottom + 0.001);
  const box = (l: number, r: number, y0: number, y1: number, z0: number, z1: number, m: string) => {
    if (clear(l, r, z0, z1)) g.box(l, r, y0 * depth, y1 * depth, z0, z1, m);
  };
  const block = (s: Side, inner: number, outer: number, y0: number, y1: number, z0: number, z1: number, m: string) => {
    const a = across(s, inner),
      b = across(s, outer);
    box(Math.min(a, b), Math.max(a, b), y0, y1, z0, z1, m);
  };
  const maxZ = (z: number) => Math.min(z, g.height);
  const step = (s: Side, levels: number, length: number, mat: string, cap = mat) => {
    const tread = Math.min(0.18, head / 8);
    for (let i = 0; i < levels; i++) {
      const height = (levels - i) * tread;
      const back = (length * i) / levels,
        front = (length * (i + 1)) / levels;
      block(s, 0.09, 0.99, back, front, 0, height - 0.025, mat);
      block(s, 0.09, 0.99, back, front, height - 0.025, height, cap);
    }
  };
  const bench = (s: Side, length: number, body: string, top: string) => {
    const h = Math.min(0.415, head * 0.22);
    block(s, 0.08, 0.98, 0.04, length, 0, h - 0.065, body);
    block(s, 0.055, 1, 0, Math.min(0.99, length + 0.035), h - 0.065, h, top);
  };
  // Longitudinal screen or court return, with an optional inward turning nose at its free end.
  const wall = (s: Side, length: number, height: number, m: string, coping: string, turn = false) => {
    const z = Math.min(height, head * 0.83);
    block(s, 0.66, 0.95, 0, length, 0, z, m);
    block(s, 0.635, 0.98, 0, length, z, z + 0.045, coping);
    if (turn) {
      block(s, 0.22, 0.66, Math.max(0, length - 0.17), length, 0, z * 0.72, m);
      block(s, 0.2, 0.66, Math.max(0, length - 0.19), length, z * 0.72, z * 0.72 + 0.045, coping);
    }
  };
  const supports = (kind: Support, span: number, reach: number, m: string) => {
    const z = Math.min(g.height, head + room * 0.075);
    const half = Math.min(0.145, wing * 0.5 * span);
    for (const s of [-1, 1] as const) {
      const x = across(s, span) - s * half,
        y = reach * depth;
      const base = Math.min(0.14, head * 0.08);
      if (half < 0.014) continue;
      if (kind === 'corbel') {
        for (let k = 0; k < 3; k++) box(x - half, x + half, 0, (reach * (k + 1)) / 3, z - 0.34 + k * 0.105, z - 0.225 + k * 0.105, m);
      } else if (kind === 'column' || kind === 'fork') {
        const radius = Math.min(half * 0.78, y, depth - y);
        if (radius < 0.012 || !clear(x - half, x + half, 0, z)) continue;
        box(x - half, x + half, Math.max(0, reach - half / depth), Math.min(1, reach + half / depth), 0, base, m);
        g.post(x, y, base, z - 0.115, radius, m, kind === 'column' ? 8 : 5);
        box(x - half, x + half, Math.max(0, reach - half / depth), Math.min(1, reach + half / depth), z - 0.115, z, m);
        if (kind === 'fork' && half > 0.055) {
          const t = half * 0.48;
          g.beam([x - t * 0.5, y, z - 0.38], [x - half + t * 0.6, y, z - 0.09], t, m);
          g.beam([x + t * 0.5, y, z - 0.38], [x + half - t * 0.6, y, z - 0.09], t, m);
        }
      } else if (kind === 'stone') {
        box(x - half, x + half, Math.max(0, reach - 0.15), Math.min(1, reach + 0.08), 0, z, m);
      } else {
        for (let k = 0; k < 3; k++) {
          const fraction = 1 - k * 0.17;
          box(x - half * fraction, x + half * fraction, 0, reach * (1 - k * 0.13), (z * k) / 3, (z * (k + 1)) / 3, m);
        }
      }
    }
  };
  const canopy = (form: Cover, span: number, reach: number, mat: string, trim: string) => {
    const radius = door + wing * span,
      y = reach * depth,
      z = head + room * 0.075;
    const rise = Math.min(room * 0.76, radius * 0.44),
      lip = Math.min(0.095, room * 0.11);
    if (rise < 0.045 || !clear(-radius, radius, z, z + rise + lip)) return;
    const face = (points: Vec[], m = mat) => g.face(points, m);
    if (form === 'vault') {
      const outer = radius,
        inner = Math.max(door, outer - Math.min(0.15, wing * span * 0.8)),
        top = z + rise;
      const arc = (i: number, r: number, y: number, high: boolean): Vec => {
        const a = Math.PI * (1 - i / 8);
        return [Math.cos(a) * r, y, z + Math.sin(a) * (top - z + (high ? lip : 0))];
      };
      for (let i = 0; i < 8; i++) {
        face([arc(i, outer, y, true), arc(i + 1, outer, y, true), arc(i + 1, inner, y, false), arc(i, inner, y, false)], i % 2 ? mat : trim);
        face([arc(i, outer, 0, true), arc(i + 1, outer, 0, true), arc(i + 1, outer, y, true), arc(i, outer, y, true)]);
        face([arc(i, inner, y, false), arc(i + 1, inner, y, false), arc(i + 1, inner, 0, false), arc(i, inner, 0, false)], trim);
      }
    } else if (form === 'rafters') {
      const n = Math.max(3, Math.min(8, Math.floor((2 * radius) / 0.45)));
      const timberWidth = Math.min(0.095, (radius / n) * 0.55);
      box(-radius, radius, reach - 0.1, reach, z, z + lip, trim);
      for (let i = 0; i < n; i++) {
        const x = -radius + timberWidth + ((2 * radius - 2 * timberWidth) * i) / (n - 1);
        box(x - timberWidth, x + timberWidth, 0, Math.min(0.99, reach + 0.05), z + lip, z + lip * 2, mat);
      }
    } else if (form === 'flat') {
      box(-radius, radius, 0, reach, z, z + lip, trim);
      box(-radius, radius, 0, reach * 0.98, z + lip, z + lip * 2, mat);
    } else {
      const rear: Vec[] = [
        [-radius, 0, z + lip],
        [radius, 0, z + lip],
      ];
      const front: Vec[] = [
        [-radius, y, z + lip],
        [radius, y, z + lip],
      ];
      if (form === 'shed') {
        face([[-radius, 0, z + rise + lip], [radius, 0, z + rise + lip], front[1], front[0]]);
        for (const s of [-1, 1] as const)
          face(
            [
              [s * radius, 0, z],
              [s * radius, 0, z + rise + lip],
              [s * radius, y, z + lip],
            ],
            trim,
          );
      } else {
        const ridge: Vec = [0, form === 'hip' ? y * 0.37 : y, z + rise + lip],
          heel: Vec = [0, 0, z + rise + lip];
        face([rear[0], heel, ridge, front[0]]);
        face([heel, rear[1], front[1], ridge]);
        face([front[0], ridge, front[1]], form === 'hip' ? mat : trim);
      }
      // The soffit and eave have thickness above the measured head.
      face(
        [
          [-radius, y, z],
          [radius, y, z],
          [radius, 0, z],
          [-radius, 0, z],
        ],
        trim,
      );
      box(-radius, radius, Math.max(0, reach - 0.065), reach, z, z + lip, trim);
    }
  };
  const lintel = (m: string, casing: string) => {
    const t = Math.min(0.13, wing * 0.29),
      hi = maxZ(head + Math.min(0.17, room * 0.54));
    if (t < 0.012 || hi <= head) return;
    for (const s of [-1, 1] as const) {
      const a = s * door,
        b = s * (door + t);
      box(Math.min(a, b), Math.max(a, b), 0, 0.16, 0, head, casing);
    }
    box(-door - t, door + t, 0, 0.21, head, hi, m);
  };
  return { side, opposite: -side as Side, bench, step, wall, supports, canopy, lintel };
}
type Porch = ReturnType<typeof porch>;
type Alternate = (p: Porch, g: HouseFront) => void;

const medina: Alternate[] = [
  p => {
    p.lintel(cedar, lime);
    p.wall(p.side, 0.87, 1.41, lime, greenTile, true);
    p.bench(p.opposite, 0.32, lime, marble);
  },
  p => {
    p.supports('corbel', 0.74, 0.66, cedar);
    p.canopy('hip', 0.84, 0.82, greenTile, cedar);
    p.bench(p.side, 0.5, lime, marble);
  },
];
const roman: Alternate[] = [
  p => {
    p.supports('column', 0.69, 0.69, marble);
    p.canopy('gable', 0.84, 0.86, clayRoof, lime);
  },
  p => {
    p.supports('stone', 0.56, 0.46, brick);
    p.canopy('vault', 0.63, 0.56, brick, marble);
    p.step(p.side, 2, 0.75, basalt, marble);
  },
];
const byzantine: Alternate[] = [
  p => {
    p.lintel(marble, rough);
    p.supports('corbel', 0.64, 0.68, marble);
    p.canopy('gable', 0.78, 0.8, clayRoof, brick);
    p.step(p.side, 2, 0.67, rough);
  },
  p => {
    p.supports('stone', 0.45, 0.61, rough);
    p.canopy('vault', 0.5, 0.76, brick, marble);
    p.bench(p.opposite, 0.47, rough, marble);
  },
];
const venetian: Alternate[] = [
  p => {
    p.lintel(istrian, istrian);
    p.supports('corbel', 0.74, 0.67, istrian);
    p.canopy('flat', 0.82, 0.79, istrian, marble);
    p.step(p.side, 3, 0.9, istrian);
  },
  p => {
    p.supports('column', 0.66, 0.74, istrian);
    p.canopy('hip', 0.81, 0.9, clayRoof, cedar);
    p.step(p.opposite, 2, 0.77, istrian);
  },
];
const persian: Alternate[] = [
  p => {
    p.lintel(brick, lime);
    p.wall(p.side, 0.88, 1.52, adobe, brick, true);
    p.bench(p.opposite, 0.6, brick, marble);
  },
  p => {
    p.supports('column', 0.78, 0.69, cedar);
    p.canopy('rafters', 0.88, 0.82, cedar, dark);
    p.bench(p.side, 0.55, adobe, marble);
  },
];
const ottoman: Alternate[] = [
  p => {
    p.supports('fork', 0.69, 0.65, dark);
    p.canopy('hip', 0.88, 0.87, clayRoof, cedar);
    p.step(p.opposite, 2, 0.62, rough);
  },
  p => {
    p.lintel(cedar, dark);
    p.supports('corbel', 0.61, 0.63, dark);
    p.canopy('shed', 0.77, 0.78, clayRoof, cedar);
    p.bench(p.side, 0.61, rough, cedar);
  },
];
const sahel: Alternate[] = [
  p => {
    p.lintel(dark, adobe);
    p.wall(p.side, 0.94, 1.17, adobe, adobe, true);
    p.bench(p.opposite, 0.58, adobe, adobe);
  },
  p => {
    p.supports('battered', 0.66, 0.72, adobe);
    p.canopy('rafters', 0.74, 0.85, dark, cedar);
    p.step(p.side, 2, 0.68, adobe);
  },
];
const kraal: Alternate[] = [
  p => {
    p.wall(p.side, 0.96, 1.46, reed, cedar, true);
    p.wall(p.opposite, 0.48, 0.74, reed, cedar);
  },
  (p, g) => {
    p.supports('fork', 0.73, 0.69, dark);
    p.canopy('gable', 0.85, 0.88, g.cover, reed);
  },
];
const swahili: Alternate[] = [
  p => {
    p.lintel(cedar, dark);
    p.wall(p.side, 0.87, 0.68, coral, lime);
    p.bench(p.side, 0.82, coral, lime);
    p.step(p.opposite, 3, 0.86, coral, marble);
  },
  p => {
    p.lintel(dark, cedar);
    p.supports('column', 0.76, 0.71, dark);
    p.canopy('rafters', 0.87, 0.88, cedar, dark);
    p.bench(p.side, 0.5, coral, lime);
  },
];
const egyptian: Alternate[] = [
  p => {
    p.lintel(lime, adobe);
    p.wall(p.side, 0.95, 1.48, adobe, lime, true);
    p.step(p.opposite, 2, 0.58, adobe);
  },
  p => {
    p.supports('fork', 0.76, 0.65, cedar);
    p.canopy('shed', 0.87, 0.83, reed, cedar);
    p.bench(p.side, 0.45, adobe, lime);
  },
];
const nubian: Alternate[] = [
  p => {
    p.supports('battered', 0.69, 0.79, adobe);
    p.canopy('flat', 0.75, 0.83, adobe, cedar);
  },
  p => {
    p.wall(p.side, 0.93, 1.37, adobe, lime, true);
    p.lintel(lime, adobe);
    p.step(p.opposite, 3, 0.82, rough);
  },
];
const mesopotamian: Alternate[] = [
  p => {
    p.supports('battered', 0.58, 0.66, adobe);
    p.canopy('flat', 0.68, 0.72, adobe, brick);
    p.step(p.side, 2, 0.65, brick);
  },
  p => {
    p.lintel(cedar, brick);
    p.wall(p.side, 0.93, 1.7, brick, adobe, true);
    p.wall(p.opposite, 0.45, 0.72, adobe, brick);
  },
];
const levantine: Alternate[] = [
  p => {
    p.wall(p.side, 0.92, 1.14, rough, marble);
    p.step(p.side, 4, 0.94, rough, marble);
    p.bench(p.opposite, 0.44, rough, cedar);
  },
  p => {
    p.supports('stone', 0.71, 0.68, rough);
    p.canopy('rafters', 0.8, 0.83, cedar, dark);
    p.lintel(cedar, rough);
  },
];
const oasis: Alternate[] = [
  p => {
    p.supports('column', 0.8, 0.74, cedar);
    p.canopy('rafters', 0.9, 0.87, cedar, dark);
    p.bench(p.side, 0.57, adobe, marble);
  },
  p => {
    p.lintel(brick, adobe);
    p.wall(p.side, 0.95, 1.57, adobe, brick, true);
    p.step(p.opposite, 3, 0.74, brick);
  },
];
const ksar: Alternate[] = [
  p => {
    p.supports('battered', 0.69, 0.72, pinkEarth);
    p.canopy('vault', 0.72, 0.81, pinkEarth, brick);
  },
  p => {
    p.wall(p.side, 0.95, 1.76, pinkEarth, brick, true);
    p.step(p.opposite, 3, 0.84, rough, pinkEarth);
    p.lintel(cedar, pinkEarth);
  },
];
const yoruba: Alternate[] = [
  (p, g) => {
    p.supports('fork', 0.73, 0.73, cedar);
    p.canopy('gable', 0.88, 0.92, g.cover, dark);
    p.bench(p.side, 0.5, pinkEarth, cedar);
  },
  p => {
    p.wall(p.side, 0.91, 1.36, pinkEarth, cedar);
    p.bench(p.side, 0.78, pinkEarth, dark);
    p.canopy('rafters', 0.7, 0.62, cedar, dark);
  },
];
const andalus: Alternate[] = [
  p => {
    p.supports('corbel', 0.63, 0.56, cedar);
    p.canopy('hip', 0.78, 0.76, greenTile, cedar);
    p.bench(p.side, 0.48, lime, greenTile);
  },
  p => {
    p.supports('column', 0.63, 0.72, marble);
    p.canopy('flat', 0.76, 0.8, lime, cedar);
    p.lintel(cedar, marble);
  },
];
const comune: Alternate[] = [
  p => {
    p.supports('corbel', 0.73, 0.73, dark);
    p.canopy('shed', 0.9, 0.88, clayRoof, dark);
    p.bench(p.side, 0.5, brick, marble);
  },
  p => {
    p.supports('column', 0.65, 0.71, marble);
    p.canopy('gable', 0.8, 0.89, clayRoof, brick);
    p.step(p.opposite, 2, 0.67, marble);
  },
];
const caucasian: Alternate[] = [
  p => {
    p.lintel(rough, basalt);
    p.wall(p.side, 0.91, 1.22, basalt, rough, true);
    p.step(p.opposite, 4, 0.95, basalt);
  },
  p => {
    p.supports('fork', 0.77, 0.69, dark);
    p.canopy('gable', 0.9, 0.84, 'city3d:cover:slate@787a72', cedar);
    p.bench(p.side, 0.4, basalt, cedar);
  },
];
const ethiopian: Alternate[] = [
  (p, g) => {
    p.supports('fork', 0.71, 0.73, cedar);
    p.canopy('hip', 0.87, 0.93, g.cover, reed);
    p.step(p.side, 2, 0.57, basalt);
  },
  p => {
    p.wall(p.side, 0.89, 0.83, basalt, rough, true);
    p.bench(p.opposite, 0.67, adobe, rough);
    p.lintel(cedar, basalt);
  },
];
const zimbabwe: Alternate[] = [
  p => {
    p.wall(p.side, 0.98, 1.4, rough, basalt, true);
    p.wall(p.opposite, 0.5, 0.72, rough, basalt);
  },
  p => {
    p.step(p.side, 4, 0.94, rough, basalt);
    p.bench(p.opposite, 0.83, adobe, rough);
    p.wall(p.opposite, 0.78, 0.98, rough, basalt);
  },
];
const hausa: Alternate[] = [
  p => {
    p.supports('battered', 0.67, 0.73, pinkEarth);
    p.canopy('flat', 0.76, 0.84, pinkEarth, cedar);
    p.bench(p.side, 0.56, pinkEarth, lime);
  },
  p => {
    p.lintel(cedar, pinkEarth);
    p.wall(p.side, 0.98, 1.73, pinkEarth, lime, true);
    p.step(p.opposite, 2, 0.69, pinkEarth);
  },
];
const hadhrami: Alternate[] = [
  p => {
    p.lintel(dark, lime);
    p.supports('corbel', 0.6, 0.5, cedar);
    p.canopy('flat', 0.74, 0.68, adobe, lime);
    p.step(p.side, 2, 0.56, rough);
  },
  p => {
    p.supports('stone', 0.46, 0.44, adobe);
    p.canopy('vault', 0.52, 0.59, lime, adobe);
    p.bench(p.opposite, 0.47, rough, lime);
  },
];
const indus: Alternate[] = [
  p => {
    p.wall(p.side, 0.94, 0.67, brick, rough, true);
    p.step(p.opposite, 3, 0.88, brick, brick);
    p.lintel(cedar, brick);
  },
  p => {
    p.supports('stone', 0.63, 0.66, brick);
    p.canopy('rafters', 0.78, 0.78, cedar, dark);
    p.bench(p.side, 0.66, brick, rough);
  },
];

const arrangements: Record<string, Alternate[]> = {
  medina,
  'roman-core': roman,
  'byzantine-greek': byzantine,
  'venetian-lagoon': venetian,
  persian,
  ottoman,
  sahel,
  kraal,
  'swahili-stone-town': swahili,
  'egyptian-planned': egyptian,
  'nubian-fortified': nubian,
  mesopotamian,
  'levantine-tell': levantine,
  'oasis-caravan': oasis,
  'ksar-oasis': ksar,
  yoruba,
  'al-andalus': andalus,
  'italian-comune': comune,
  'caucasian-highland': caucasian,
  'ethiopian-highland': ethiopian,
  'great-zimbabwe': zimbabwe,
  'hausa-kano': hausa,
  'hadhrami-tower': hadhrami,
  'indus-planned': indus,
};

export function historicPorchFamily(id: string, original: (g: HouseFront) => void): (g: HouseFront) => void {
  return g => {
    const choice = g.seed % 3;
    if (choice === 0) return original(g);
    arrangements[id][choice - 1](porch(g), g);
  };
}
