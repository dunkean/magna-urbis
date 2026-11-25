import type { HouseFront } from './houseFrontKit';
type V = [number, number, number];
const steel = 'city3d:wall:steel@515a59',
  zinc = 'city3d:cover:zinc@8a9290',
  lime = 'city3d:wall:plaster@c9c2af',
  concrete = 'city3d:wall:concrete@a79e8d',
  timber = 'city3d:wall:wood@927353',
  glass = 'city3d:detail:glass@69817e',
  clay = 'city3d:cover:tile@9d6752';
const canopyHeight = (g: HouseFront) => Math.min(g.height * 0.97, 2.62 + (g.seed % 5) * 0.055);

/** A solid folded or curved canopy. Its edge and underside stay distinct at grazing angles. */
function awning(g: HouseFront, profile: V[], depth: number, mat: string, thick = 0.09) {
  const sections = profile.map(([x, y, z]): V[] => [
    [x, y, z],
    [x, depth, z],
    [x, depth, z - thick],
    [x, y, z - thick],
  ]);
  for (let i = 1; i < sections.length; i++) {
    const a = sections[i - 1],
      b = sections[i];
    for (let k = 0; k < 4; k++) {
      const j = (k + 1) % 4;
      g.face([a[k], b[k], b[j], a[j]], mat);
    }
  }
  g.face(sections[0], mat);
  g.face([...sections.at(-1)!].reverse(), mat);
}
function veranda(g: HouseFront, kind: 'bungalow' | 'australian' | 'tropical' | 'salvaged') {
  const w = g.width * 0.48,
    d = g.depth,
    h = canopyHeight(g),
    top = h - Math.min(0.42, h * 0.16);
  const roof = kind === 'bungalow' ? g.cover : kind === 'tropical' ? clay : zinc;
  g.face(
    [
      [-w, 0, h],
      [w, 0, h],
      [w, d, top],
      [-w, d, top],
    ],
    roof,
  );
  g.box(-w, w, d - 0.09, d, top - 0.105, top, timber);
  for (const sign of [-1, 1]) {
    const x = sign * (w - 0.15),
      y = d - 0.18,
      post = kind === 'bungalow' ? 0.15 : 0.09;
    g.box(x - post, x + post, y - 0.1, y + 0.1, 0.04, top - 0.1, kind === 'bungalow' ? lime : timber);
    if (kind === 'bungalow') {
      g.box(x - 0.19, x + 0.19, y - 0.15, y + 0.15, 0, Math.min(0.64, top * 0.26), g.wall);
    } else g.beam([x, y, top - 0.5], [x - sign * 0.32, y, top - 0.12], 0.072, timber);
    if (kind === 'australian' && w > 1.45) g.box(x - 0.035, x + 0.035, 0.12, y, 0.71, 0.78, timber);
  }
  if (kind === 'bungalow')
    awning(
      g,
      [
        [-w, 0, h],
        [0, 0, h + 0.56],
        [w, 0, h],
      ],
      d,
      roof,
    );
  if (kind === 'tropical') {
    for (let i = 0; i < 5; i++) {
      const z = top * 0.35 + i * 0.18;
      g.beam([w - 0.15, 0.12, z + 0.07], [w - 0.15, d - 0.18, z], 0.078, timber);
    }
  }
  if (kind === 'salvaged') {
    const x = -w + 0.22;
    g.box(x - 0.08, x + 0.08, d * 0.36, d * 0.57, 0, 0.74, concrete);
    g.beam([x, d * 0.46, 0.72], [x, d - 0.18, top - 0.06], 0.085, timber);
  }
}
function loggia(g: HouseFront, style: 'riviera' | 'concrete' | 'enclosed' | 'terrace' | 'arcade') {
  const w = g.width * 0.48,
    d = g.depth,
    h = Math.min(g.height - 0.13, 3.55),
    z = h > 3.2 ? Math.min(g.height - 0.94, 2.62) : 0;
  const top = z ? h + 0.27 : h,
    floor = z || 0.12,
    m = style === 'riviera' || style === 'arcade' ? lime : concrete;
  g.box(-w, w, 0.015, d, floor - 0.1, floor, m);
  g.box(-w, w, 0, d, top - 0.1, top + 0.045, m);
  for (const s of [-1, 1]) {
    const x = s * (w - 0.12);
    g.box(x - 0.1, x + 0.1, d - 0.25, d - 0.07, floor, top - 0.1, m);
    if (style === 'arcade') g.beam([x, d - 0.13, top - 0.48], [x - s * 0.36, d - 0.13, top - 0.1], 0.15, m);
    if (style === 'terrace') g.box(x - 0.1, x + 0.1, 0.02, d - 0.07, floor, floor + 0.54, g.wall);
  }
  if (style === 'enclosed') {
    // The glazed gallery spans the upper floor. On the street floor its two glazed sides
    // leave an aisle the full width of the real entry.
    const gap = Math.max(0.53, (g.doorWidth ?? 1.04) / 2 + 0.04);
    const bays = z
      ? [[-w, w]]
      : [
          [-w, -gap],
          [gap, w],
        ];
    for (const [left, right] of bays) {
      if (right - left < 0.22) continue;
      g.box(left, right, d - 0.13, d - 0.025, floor, floor + 0.65, m);
      g.face(
        [
          [left + 0.07, d - 0.18, floor + 0.65],
          [right - 0.07, d - 0.18, floor + 0.65],
          [right - 0.07, d - 0.18, top - 0.13],
          [left + 0.07, d - 0.18, top - 0.13],
        ],
        glass,
      );
      const lights = Math.max(1, Math.round((right - left) / 0.85));
      for (let i = 1; i < lights; i++) {
        const x = left + ((right - left) * i) / lights;
        g.box(x - 0.035, x + 0.035, d - 0.21, d - 0.12, floor + 0.65, top - 0.12, steel);
      }
    }
  } else if (z) {
    g.box(-w, w, d - 0.13, d - 0.025, floor, floor + 0.65, m);
    g.beam([-w, d - 0.08, floor + 0.87], [w, d - 0.08, floor + 0.87], 0.055, steel);
  }
}
function screen(g: HouseFront, kind: 'brise' | 'pergola' | 'shade' | 'green') {
  const w = g.width * 0.48,
    d = g.depth,
    h = canopyHeight(g),
    m = kind === 'brise' ? concrete : kind === 'shade' ? lime : timber;
  for (const x of [-w + 0.09, w - 0.09]) g.box(x - 0.075, x + 0.075, d - 0.17, d - 0.025, 0, h, m);
  g.box(-w, w, d - 0.15, d, h - 0.13, h, m);
  const count = Math.max(4, Math.floor(g.width / (kind === 'brise' ? 0.53 : 0.36)));
  for (let i = 0; i < count; i++) {
    const x = -w + 0.05 + ((i + 0.5) * (2 * w - 0.1)) / count;
    g.beam([x, 0.015, h + 0.18], [x, d - 0.07, h + 0.03], kind === 'brise' ? 0.14 : 0.095, m);
  }
  if (kind === 'shade' || kind === 'green') {
    const x = w - 0.08;
    for (let i = 0; i < 5; i++) g.beam([x, 0.07, 0.72 + i * 0.225], [x, d - 0.16, 0.83 + i * 0.225], 0.1, kind === 'green' ? timber : lime);
    if (kind === 'green') {
      g.box(x - 0.32, x + 0.055, 0.06, d - 0.2, 0, 0.39, concrete);
      g.box(x - 0.27, x + 0.01, 0.12, d - 0.23, 0.39, 0.46, 'city3d:detail:herbs@667455');
    }
  }
}
function marquee(g: HouseFront, deco: boolean) {
  const w = g.width * 0.48,
    d = g.depth,
    h = canopyHeight(g),
    m = deco ? lime : steel;
  if (deco) {
    for (let k = 0; k < 3; k++) g.box(-w + k * 0.12, w - k * 0.12, 0, d - k * 0.12, h - 0.12 + k * 0.11, h + k * 0.11, m);
    const x = w * 0.68;
    for (let k = 0; k < 3; k++) g.box(x + k * 0.09, x + k * 0.09 + 0.055, 0.02, 0.19, h + 0.1, h + 0.42 - k * 0.1, steel);
  } else {
    const arc: V[] = Array.from({ length: 9 }, (_, i) => {
      const t = i / 4 - 1;
      return [w * t, 0, h + 0.29 * (1 - t * t)];
    });
    awning(g, arc, d, glass, 0.043);
    for (let i = 0; i < arc.length; i += 2) {
      const [x, , z] = arc[i];
      g.beam([x, 0.015, z + 0.013], [x, d, z + 0.013], 0.04, steel);
    }
    for (const s of [-1, 1]) g.beam([s * w * 0.82, 0, h - 0.49], [s * w * 0.82, d * 0.82, h + 0.025], 0.052, steel);
  }
}
export const modernFronts: Record<string, (g: HouseFront) => void> = {
  'belle-epoque': g => marquee(g, false),
  'art-deco-metropolis': g => marquee(g, true),
  'mediterranean-modern': g => loggia(g, 'riviera'),
  'soviet-socialist': g => loggia(g, 'concrete'),
  'american-suburbia': g => veranda(g, 'bungalow'),
  'australian-suburban': g => veranda(g, 'australian'),
  'european-contemporary': g => {
    const w = g.width * 0.47,
      h = canopyHeight(g);
    g.box(-w, -w + 0.16, 0, g.depth, 0, h, concrete);
    g.box(-w, w, 0, g.depth, h - 0.14, h, concrete);
    for (let i = 0; i < 4; i++) {
      const x = w - i * 0.13;
      g.box(x - 0.028, x + 0.028, g.depth - 0.21, g.depth - 0.1, 0, h - 0.14, timber);
    }
  },
  'informal-urban-expansion': g => veranda(g, 'salvaged'),
  'eco-city': g => screen(g, 'green'),
  'southeast-asian-tropical': g => veranda(g, 'tropical'),
  'latin-american-grid': g => screen(g, 'brise'),
  'latin-american-hillside': g => loggia(g, 'terrace'),
  'north-african-contemporary': g => loggia(g, 'arcade'),
  'middle-eastern-contemporary': g => screen(g, 'shade'),
  'post-socialist-european': g => loggia(g, 'enclosed'),
  'sub-saharan-african-metropolis': g => {
    screen(g, 'pergola');
    const w = g.width * 0.48,
      h = canopyHeight(g);
    g.face(
      [
        [-w, 0, h + 0.28],
        [w, 0, h + 0.28],
        [w, g.depth * 0.72, h + 0.15],
        [-w, g.depth * 0.72, h + 0.15],
      ],
      zinc,
    );
  },
};

/** Open growing bays: keep a harvesting aisle between shaded racks, with flushes at different heights. */
export function mushroomGrower(g: HouseFront): void {
  const w = g.width * 0.47,
    d = g.depth,
    h = canopyHeight(g),
    oak = 'city3d:wall:wood@635347',
    soil = 'city3d:detail:compost@463a32';
  const roof = 'city3d:cover:bark@706e5b';
  const form = (g.seed >>> 9) % 3;
  // A single lean-to, a ventilated ridge, or staggered side shelters over the growing beds.
  const edge = h - 0.26;
  if (form === 0) {
    g.face(
      [
        [-w, 0, h],
        [w, 0, h],
        [w, d, edge],
        [-w, d, edge],
      ],
      roof,
    );
  } else if (form === 1) {
    for (const sign of [-1, 1]) {
      g.face(
        [
          [sign * w, 0, edge],
          [sign * 0.07, 0, h + 0.12],
          [sign * 0.07, d, h + 0.12],
          [sign * w, d, edge],
        ],
        roof,
      );
    }
    g.box(-0.105, 0.105, 0.02, d - 0.02, h + 0.16, h + 0.21, oak);
  } else {
    for (const sign of [-1, 1]) {
      const inner = sign * Math.min(w * 0.38, 0.54);
      const reach = sign > 0 ? d : d * 0.79;
      g.face(
        [
          [sign * w, 0, h],
          [inner, 0, h + 0.08],
          [inner, reach, edge + 0.08],
          [sign * w, reach, edge],
        ],
        roof,
      );
    }
  }
  for (const s of [-1, 1]) {
    const x = s * (w - 0.14),
      reach = form === 2 && s < 0 ? d * 0.79 : d;
    g.box(x - 0.065, x + 0.065, reach - 0.18, reach - 0.05, 0.02, h - 0.26, oak);
    const inner = Math.max((g.doorWidth ?? 0.96) / 2 + 0.04, w - 0.83);
    if (inner >= w - 0.08) continue;
    const lo = s === 1 ? inner : -w + 0.035,
      hi = s === 1 ? w - 0.035 : -inner;
    for (let k = 0; k < 2; k++) {
      const z = 0.35 + k * 0.64;
      g.box(lo, hi, 0.13, d - 0.16, z, z + 0.09, oak);
      g.box(lo + 0.03, hi - 0.03, 0.18, d - 0.2, z + 0.09, z + 0.145, soil);
      for (let j = 0; j < 3; j++) {
        const cx = (lo + hi) / 2,
          cy = 0.23 + ((d - 0.51) * (j + 0.5)) / 3,
          r = Math.min((hi - lo) * 0.31, (d - 0.42) * 0.125);
        for (let l = 0; l < 2; l++) {
          const rr = r * (1 - 0.27 * l),
            x0 = cx + (l - 0.45) * r * 0.58,
            y0 = cy + (l - 0.5) * r * 0.47,
            top = z + 0.21 + 0.045 * l;
          const rim: V[] = Array.from({ length: 7 }, (_, i) => [x0 + Math.cos((i * 2 * Math.PI) / 7) * rr, y0 + Math.sin((i * 2 * Math.PI) / 7) * rr * 0.78, top - 0.04]);
          for (let i = 0; i < 7; i++) g.face([rim[i], rim[(i + 1) % 7], [x0 - rr * 0.26, y0, top]], (j + g.seed) % 2 ? 'city3d:detail:oyster@b2a593' : 'city3d:detail:oyster@9f9079');
        }
      }
    }
  }
}
