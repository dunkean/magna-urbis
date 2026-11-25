import type { HouseFront } from './houseFrontKit';

type Point = [number, number, number];
type Section = [number, number, number, number]; // x, y, height, half-width of a carved rib
const wall = (kind: string, hex: string) => 'city3d:wall:' + kind + '@' + hex;
const cover = (kind: string, hex: string) => 'city3d:cover:' + kind + '@' + hex;
const oak = wall('wood', '76563d'),
  darkOak = wall('wood', '513d32'),
  honey = wall('wood', 'ad8357');
const iron = wall('steel', '48494a'),
  bronze = cover('metal', 'a58253'),
  bone = wall('plaster', 'd8cbb0');
const shale = wall('stone', '555657'),
  ashlar = wall('ashlar', '9f9583'),
  limestone = wall('ashlar', 'c2b8a2');

/** Carving coordinates run across half the frontage, out over the threshold, and up to the eaves.
 * Width is capped independently of height so a doorway stays human-sized on a long tenement. */
function frame(g: HouseFront, maxWidth: number, maxHeight: number) {
  const w = Math.min(g.width, maxWidth) / 2,
    d = g.depth,
    h = Math.min(g.height, maxHeight);
  const scale = Math.min(w, h, d * 1.8);
  const p = ([x, y, z]: Point): Point => [x * w, y * d, z * h];
  const face = (vertices: Point[], mat: string) => g.face(vertices.map(p), mat);
  const top = (vertices: Point[], mat: string) => {
    const area = vertices.reduce((sum, [x, y], i) => {
      const b = vertices[(i + 1) % vertices.length];
      return sum + x * b[1] - y * b[0];
    }, 0);
    face(area < 0 ? [...vertices].reverse() : vertices, mat);
  };
  const beam = (a: Point, b: Point, thickness: number, mat: string) => {
    const size = scale * thickness,
      r = size / Math.sqrt(2);
    const seat = (v: Point): Point => {
      const [x, y, z] = p(v);
      return [Math.max(-w + r, Math.min(w - r, x)), Math.max(r, Math.min(d - r, y)), Math.max(r, z)];
    };
    g.beam(seat(a), seat(b), size, mat);
  };
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: string) => g.box(x0 * w, x1 * w, y0 * d, y1 * d, z0 * h, z1 * h, mat);
  const post = (x: number, y: number, z0: number, z1: number, r: number, mat: string, sides = 8) => {
    const radius = scale * r;
    g.post(Math.max(-w + radius, Math.min(w - radius, x * w)), Math.max(radius, Math.min(d - radius, y * d)), z0 * h, z1 * h, radius, mat, sides);
  };

  // A four-sided knife-edged moulding. Compute the mitres in metres so narrow house fronts
  // keep the same carved profile and the light breaks in two planes along each arris.
  const rib = (path: Section[], mat: string) => {
    const rings = path.map(([x, y, z, size], i) => {
      const a = path[Math.max(0, i - 1)],
        b = path[Math.min(path.length - 1, i + 1)];
      const dx = (b[0] - a[0]) * w,
        dz = (b[2] - a[2]) * h,
        len = Math.hypot(dx, dz) || 1;
      const r = size * scale,
        nx = (-dz * r) / len,
        nz = (dx * r) / len;
      const cx = Math.max(-w + Math.abs(nx), Math.min(w - Math.abs(nx), x * w));
      const cy = Math.max(r * 0.75, Math.min(d - r * 0.75, y * d)),
        cz = Math.max(Math.abs(nz), z * h);
      return [
        [cx + nx, cy, cz + nz],
        [cx, cy - r * 0.75, cz],
        [cx - nx, cy, cz - nz],
        [cx, cy + r * 0.75, cz],
      ] as Point[];
    });
    for (let j = 1; j < rings.length; j++)
      for (let i = 0; i < 4; i++) {
        const k = (i + 1) % 4;
        g.face([rings[j - 1][i], rings[j - 1][k], rings[j][k], rings[j][i]], mat);
      }
    g.face([...rings[0]].reverse(), mat);
    g.face(rings[rings.length - 1], mat);
  };
  // Bridge successive cross sections of a canopy. Each station goes from wall to street.
  const sheet = (back: Point[], lip: Point[], mat: string | string[]) => {
    for (let i = 1; i < back.length; i++) {
      const m = typeof mat === 'string' ? mat : mat[(i - 1) % mat.length];
      face([back[i - 1], back[i], lip[i]], m);
      face([back[i - 1], lip[i], lip[i - 1]], m);
    }
  };
  // A battered pier, hearth or fin with independently offset stages and a real cap.
  const pier = (levels: [number, number, number, number, number][], mat: string) => {
    const rings = levels.map(([x, y, z, rx, ry]): Point[] => [
      [x - rx, y - ry, z],
      [x + rx, y - ry, z],
      [x + rx, y + ry, z],
      [x - rx, y + ry, z],
    ]);
    for (let j = 1; j < rings.length; j++)
      for (let i = 0; i < 4; i++) {
        const k = (i + 1) % 4;
        face([rings[j - 1][i], rings[j - 1][k], rings[j][k], rings[j][i]], mat);
      }
    face(rings[rings.length - 1], mat);
  };
  return { face, top, beam, box, post, rib, sheet, pier, layout: g.seed % 3 };
}

type Carving = ReturnType<typeof frame>;
/** Build a roof from corresponding wall and eave stations. Gables, hipped shoulders
 * and skewed lean-tos use the same sections, including their exposed fascia. */
function foldedHood(f: Carving, stations: [number, number, number, number][], skin: string, fascia: string, thickness = 0.055) {
  const back: Point[] = stations.map(([x, ridge]) => [x, 0.02, ridge]);
  const lip: Point[] = stations.map(([x, , height, reach]) => [x, reach, height]);
  f.sheet(back, lip, skin);
  f.sheet(
    lip,
    lip.map(([x, y, z]) => [x, y, z - thickness]),
    fascia,
  );
}

/** A single lobed fan grows out of a common hinge. Two offset fans overlap with an
 * actual change in level; narrow fins and stilt shelters can use the same radial construction. */
function fanHood(f: Carving, x: number, half: number, height: number, reach: number, rise: number, skin: string, lip: string, lobes: number) {
  const hinge: Point = [x, 0.02, height + rise];
  let previous: Point = [x - half, 0.035, height];
  for (let i = 1; i <= lobes * 2; i++) {
    const a = (i * Math.PI) / (lobes * 2),
      depth = Math.sin(a) * reach * (i % 2 ? 0.88 : 1);
    const next: Point = [x - half * Math.cos(a), 0.035 + depth, height + 0.09 * Math.sin(a) - (i % 2 ? 0.025 : 0)];
    f.top([hinge, previous, next], skin);
    f.face([previous, next, [next[0], next[1], next[2] - 0.043], [previous[0], previous[1], previous[2] - 0.043]], lip);
    previous = next;
  }
}

function elven(g: HouseFront) {
  const f = frame(g, 4.7, 3.6),
    patina = cover('metal', '65897c'),
    edge = cover('metal', 'b9a275');
  // The central vein projects past the forked bracket. The two leaves curl up independently.
  for (const s of [-1, 1]) {
    f.rib(
      [
        [s * 0.81, 0.12, 0.07, 0.1],
        [s * 0.73, 0.24, 0.55, 0.065],
        [s * 0.67, 0.52, 0.82, 0.055],
        [s * 0.4, 0.72, 1.01, 0.03],
      ],
      oak,
    );
    f.rib(
      [
        [s * 0.75, 0.22, 0.48, 0.06],
        [s * 0.87, 0.36, 0.73, 0.045],
        [s * 0.94, 0.44, 0.93, 0.018],
      ],
      honey,
    );
    if (f.layout === 1) {
      // An open trellis of arched branches between two high side petals.
      f.rib(
        [
          [s * 0.87, 0.2, 0.72, 0.065],
          [s * 0.69, 0.44, 1.04, 0.045],
          [s * 0.3, 0.54, 1.26, 0.033],
          [0, 0.48, 1.33, 0.018],
        ],
        honey,
      );
      fanHood(f, s * 0.66, 0.27, 1.0, 0.66, 0.36, patina, edge, 3);
      continue;
    }
    if (f.layout === 2) {
      if (s < 0) fanHood(f, -0.3, 0.65, 1.03, 0.9, 0.31, patina, edge, 4);
      else fanHood(f, 0.41, 0.51, 0.87, 0.7, 0.28, cover('metal', '88a596'), edge, 3);
      continue;
    }
    const root: Point = [0, 0.025, 1.45],
      tip: Point = [s * 0.04, 0.96, 1.12];
    const fold: Point = [s * 0.46, 0.54, 1.12],
      wing: Point = [s * 0.94, 0.43, 0.98];
    f.top([root, [s * 0.9, 0.025, 0.88], wing, fold], patina);
    f.top([root, fold, tip], cover('metal', '88a596'));
    f.top([fold, wing, tip], patina);
    f.beam(wing, tip, 0.035, edge);
    // A second pair of slender petals lifts the shoulders of the crown clear of the broad lower leaves.
    const bud: Point = [s * 0.79, 0.075, 1.43],
      join: Point = [s * 0.78, 0.29, 1.02];
    f.top([root, bud, join], cover('metal', '759c8c'));
    f.top([root, join, fold], patina);
    f.rib(
      [
        [s * 0.82, 0.14, 0.27, 0.046],
        [s * 0.89, 0.18, 0.69, 0.049],
        [s * 0.88, 0.18, 1.05, 0.048],
        [s * 0.79, 0.077, 1.43, 0.012],
      ],
      honey,
    );
    f.rib(
      [
        [s * 0.78, 0.33, 1.02, 0.026],
        [s * 0.46, 0.55, 1.13, 0.033],
        [s * 0.04, 0.94, 1.13, 0.012],
      ],
      edge,
    );
  }
}

function dwarven(g: HouseFront) {
  const f = frame(g, 6.8, 4.2),
    granite = wall('ashlar', '777e7c');
  for (const s of [-1, 1]) {
    // The recessed copper channels follow the offsets of the stone corbels.
    f.pier(
      [
        [s * 0.72, 0.42, 0, 0.23, 0.39],
        [s * 0.72, 0.35, 0.19, 0.2, 0.32],
        [s * 0.71, 0.32, 0.73, 0.14, 0.29],
        [s * 0.63, 0.36, 0.88, 0.22, 0.33],
        [s * 0.59, 0.38, 0.95, 0.25, 0.35],
      ],
      granite,
    );
    f.rib(
      [
        [s * 0.74, 0.74, 0.1, 0.045],
        [s * 0.72, 0.62, 0.7, 0.042],
        [s * 0.55, 0.74, 0.87, 0.042],
      ],
      bronze,
    );
    f.box(s * 0.68 - 0.26, s * 0.68 + 0.26, 0.02, 0.83, 0.91, 1.01, ashlar);
  }
  if (f.layout === 1) {
    foldedHood(
      f,
      [
        [-0.92, 1.02, 0.97, 0.62],
        [-0.53, 1.22, 1.17, 0.83],
        [0.53, 1.22, 1.17, 0.83],
        [0.92, 1.02, 0.97, 0.62],
      ],
      granite,
      bronze,
      0.15,
    );
    f.box(-0.33, 0.33, 0.05, 0.77, 1.2, 1.3, ashlar);
    return;
  }
  if (f.layout === 2) {
    for (const s of [-1, 1]) {
      f.pier(
        [
          [s * 0.6, 0.39, 1, 0.24, 0.35],
          [s * 0.46, 0.38, 1.09, 0.27, 0.34],
          [s * 0.29, 0.35, 1.19, 0.28, 0.31],
        ],
        granite,
      );
    }
    f.box(-0.49, 0.49, 0.03, 0.72, 1.18, 1.28, bronze);
    return;
  }
  f.box(-0.88, 0.88, 0.02, 0.74, 0.99, 1.12, granite);
  f.box(-0.57, 0.57, 0.03, 0.8, 1.1, 1.17, ashlar);
  f.pier(
    [
      [0, 0.67, 0.95, 0.085, 0.1],
      [0, 0.67, 1.13, 0.14, 0.1],
    ],
    bronze,
  );
}

function necropolis(g: HouseFront) {
  const f = frame(g, 5.6, 3.8),
    basalt = wall('ashlar', '626268'),
    cap = wall('ashlar', 'acaaa1');
  for (const s of [-1, 1]) {
    const x = s * 0.76;
    f.box(x - 0.16, x + 0.16, 0.04, 0.72, 0, 0.13, shale);
    if (f.layout !== 2)
      f.pier(
        [
          [x, 0.39, 0.13, 0.14, 0.25],
          [x, 0.38, 0.79, 0.083, 0.16],
          [x, 0.38, 0.83, 0.11, 0.19],
        ],
        basalt,
      );
    if (f.layout !== 2)
      f.pier(
        [
          [x, 0.38, 0.83, 0.11, 0.19],
          [x, 0.38, 0.99, 0.012, 0.023],
        ],
        cap,
      );
    if (f.layout === 2) {
      f.box(x - 0.13, x + 0.13, 0.13, 0.68, 0.13, 0.54, basalt);
      f.pier(
        [
          [x, 0.4, 0.54, 0.18, 0.27],
          [x, 0.4, 0.7, 0.08, 0.16],
          [x, 0.4, 0.79, 0.12, 0.2],
        ],
        cap,
      );
    }
    // A shallow, pointed archivolt rises between the tomb's paired obelisks.
    f.rib(
      [
        [s * 0.57, 0.14, 0.09, 0.065],
        [s * 0.56, 0.17, 0.68, 0.065],
        [s * 0.39, 0.27, 0.9, 0.065],
        [0, 0.41, 1.1, 0.065],
      ],
      cap,
    );
  }
  if (f.layout === 1) {
    f.box(-0.92, 0.92, 0.04, 0.64, 0.95, 1.05, basalt);
    f.box(-0.69, 0.69, 0.06, 0.56, 1.05, 1.16, cap);
    f.box(-0.42, 0.42, 0.09, 0.49, 1.16, 1.24, basalt);
    return;
  }
  f.sheet(
    [
      [-0.61, 0.01, 0.75],
      [0, 0.01, 1.19],
      [0.61, 0.01, 0.75],
    ],
    [
      [-0.61, 0.29, 0.69],
      [0, 0.56, 1.1],
      [0.61, 0.29, 0.69],
    ],
    basalt,
  );
  f.pier(
    [
      [0, 0.41, 1.07, 0.07, 0.065],
      [0, 0.41, 1.2, 0.08, 0.075],
      [0, 0.41, 1.29, 0.012, 0.012],
    ],
    cap,
  );
}

function orcish(g: HouseFront) {
  const f = frame(g, 5.9, 3.7),
    rawhide = wall('hide', '96664a'),
    smoke = wall('hide', '79523f');
  // A hide is lashed diagonally between two outward-sweeping tusks.
  for (const s of [-1, 1]) {
    f.rib(
      [
        [s * 0.81, 0.63, 0.04, 0.17],
        [s * 0.83, 0.64, 0.46, 0.13],
        [s * 0.79, 0.67, 0.76, 0.1],
        [s * 0.6, 0.72, 1.03, 0.055],
        [s * 0.45, 0.76, 1.1, 0.009],
      ],
      bone,
    );
    f.beam([s * 0.9, 0.22, 0.02], [s * 0.74, 0.6, 0.69], 0.13, darkOak);
    f.rib(
      [
        [s * 0.82, 0.64, 0.4, 0.15],
        [s * 0.825, 0.64, 0.47, 0.143],
      ],
      smoke,
    );
  }
  if (f.layout === 1) {
    foldedHood(
      f,
      [
        [-0.9, 0.9, 0.84, 0.75],
        [-0.55, 1.21, 1.17, 0.9],
        [0.26, 0.98, 1.03, 0.74],
        [0.88, 0.84, 0.77, 0.49],
      ],
      rawhide,
      smoke,
    );
    f.beam([-0.56, 0.06, 1.22], [-0.55, 0.89, 1.18], 0.092, darkOak);
    return;
  }
  if (f.layout === 2) {
    for (const s of [-1, 1]) {
      f.top(
        [
          [s * 0.09, 0.025, 1.16],
          [s * 0.94, 0.04, 0.82],
          [s * 0.72, 0.67, 0.9],
          [s * 0.4, 0.9, 0.87],
        ],
        s < 0 ? rawhide : smoke,
      );
      f.beam([s * 0.88, 0.04, 0.84], [s * 0.41, 0.89, 0.88], 0.065, bone);
    }
    return;
  }
  const crest: Point = [0.12, 0.78, 1.07];
  f.face([[-0.87, 0.02, 0.84], [0.04, 0.02, 1.12], crest, [-0.63, 0.69, 0.91]], rawhide);
  f.face([[0.04, 0.02, 1.12], [0.91, 0.02, 0.87], [0.7, 0.65, 0.92], crest], smoke);
  f.face([[-0.63, 0.69, 0.91], crest, [-0.31, 0.78, 0.83]], smoke);
  f.face([crest, [0.7, 0.65, 0.92], [0.49, 0.73, 0.78]], rawhide);
}

function drow(g: HouseFront) {
  const f = frame(g, 6.3, 4.0),
    obsidian = wall('stone', '45404c'),
    silver = cover('metal', 'aba6b4');
  const silk = cover('felt', '87798c');
  for (const s of [-1, 1]) {
    // Split, swept stone legs hold a tensile canopy with scalloped edges.
    f.rib(
      [
        [s * 0.94, 0.85, 0.01, 0.04],
        [s * 0.84, 0.72, 0.55, 0.09],
        [s * 0.64, 0.56, 1.08, 0.09],
        [s * 0.45, 0.32, 1.29, 0.052],
        [s * 0.54, 0.14, 1.57, 0.012],
      ],
      obsidian,
    );
    f.rib(
      [
        [s * 0.88, 0.1, 0.03, 0.055],
        [s * 0.78, 0.25, 0.7, 0.09],
        [s * 0.64, 0.56, 1.08, 0.065],
      ],
      obsidian,
    );
    f.rib(
      [
        [s * 0.84, 0.73, 0.55, 0.018],
        [s * 0.64, 0.59, 1.09, 0.022],
        [s * 0.45, 0.35, 1.29, 0.018],
        [s * 0.54, 0.15, 1.55, 0.006],
      ],
      silver,
    );
    const spine: Point = [s * 0.64, 0.55, 1.07],
      throat: Point = [0, 0.2, 0.92];
    f.top([[s * 0.9, 0.01, 0.91], spine, throat], silk);
    f.top([spine, [s * 0.34, 0.62, 0.9], throat], cover('felt', 'a299a8'));
    f.top([[s * 0.34, 0.62, 0.9], [0, 0.91, 0.99], throat], silk);
    if (f.layout === 1) {
      // Two open lancets meet around a light well, each aimed back at its own horn.
      const tip: Point = [s * 0.24, 0.2, 1.53];
      f.top([[s * 0.54, 0.14, 1.57], tip, spine], silk);
      f.rib(
        [
          [s * 0.64, 0.55, 1.07, 0.052],
          [s * 0.24, 0.43, 1.2, 0.037],
          [...tip, 0.013],
        ],
        silver,
      );
      continue;
    }
    if (f.layout === 2) {
      // An off-axis, braced sail hangs high on the left and folds back over the right jamb.
      const mast: Point = [-0.32, 0.18, 1.54],
        eave: Point = [s * 0.74, 0.65, s < 0 ? 1.27 : 1.09];
      f.top([mast, eave, [s * 0.4, 0.9, 1.04]], silk);
      f.beam(mast, eave, 0.036, silver);
      f.beam(spine, eave, 0.07, obsidian);
      continue;
    }
    // The needle above the parapet tensions the silk between the two horns.
    const horn: Point = [s * 0.45, 0.32, 1.29],
      needle: Point = [0, 0.1, 1.67],
      fold: Point = [s * 0.22, 0.36, 1.23];
    f.top([needle, horn, fold], cover('felt', '6c597b'));
    f.top([needle, fold, [0, 0.48, 1.34]], cover('felt', '9887a3'));
    f.rib(
      [
        [s * 0.66, 0.55, 1.06, 0.053],
        [s * 0.38, 0.46, 1.18, 0.042],
        [0, 0.48, 1.34, 0.026],
      ],
      obsidian,
    );
  }
  if (f.layout === 0)
    f.rib(
      [
        [0, 0.48, 1.34, 0.03],
        [0, 0.1, 1.67, 0.009],
      ],
      silver,
    );
}

function duergar(g: HouseFront) {
  const f = frame(g, 6.3, 3.9),
    soot = wall('ashlar', '494445'),
    brass = cover('metal', 'aa7851');
  // Exhaust shafts climb one side; a shuttered intake forms the counterweight.
  const shafts =
    f.layout === 1
      ? [[-0.74, 1.49]]
      : f.layout === 2
        ? [
            [-0.75, 1.42],
            [0.74, 1.56],
          ]
        : [
            [-0.78, 1.65],
            [-0.56, 1.37],
          ];
  for (const [x, h] of shafts) {
    f.post(x, 0.41, 0, h - 0.075, 0.13, iron, 6);
    for (const z of [0.24, h - 0.075]) f.post(x, 0.41, z, z + 0.045, 0.156, brass, 6);
    // The flared lip and dark bore read from above and let the house vent through a real chimney mouth.
    const well: Point[] = [];
    for (let i = 0; i < 6; i++) {
      const at = (j: number, r: number, z: number): Point => [x + Math.cos((j * Math.PI) / 3) * r, 0.41 + Math.sin((j * Math.PI) / 3) * r * 1.3, z];
      const a = at(i, 0.103, h),
        b = at(i + 1, 0.103, h + 0.015 * Math.sin(((i + 1) * Math.PI) / 3));
      a[2] += 0.015 * Math.sin((i * Math.PI) / 3);
      const c = at(i, 0.075, a[2]),
        e = at(i + 1, 0.075, b[2]);
      f.face([at(i, 0.086, h - 0.054), at(i + 1, 0.086, h - 0.054), b, a], iron);
      f.face([a, b, e, c], brass);
      f.face([c, e, at(i + 1, 0.065, h - 0.024), at(i, 0.065, h - 0.024)], wall('steel', '292729'));
      well.push(at(i, 0.065, h - 0.024));
    }
    f.face(well, wall('steel', '292729'));
  }
  if (f.layout === 2) {
    f.box(-0.84, 0.84, 0.06, 0.64, 1.02, 1.12, iron);
    for (const s of [-1, 1]) f.beam([s * 0.75, 0.48, 0.76], [s * 0.38, 0.82, 1.08], 0.13, brass);
    foldedHood(
      f,
      [
        [-0.81, 1.19, 1.05, 0.61],
        [-0.31, 1.28, 1.24, 0.83],
        [0.31, 1.28, 1.24, 0.83],
        [0.81, 1.19, 1.05, 0.61],
      ],
      soot,
      brass,
      0.09,
    );
    return;
  }
  f.pier(
    [
      [0.71, 0.4, 0, 0.23, 0.36],
      [0.71, 0.4, 0.75, 0.19, 0.35],
      [0.65, 0.35, 0.95, 0.25, 0.3],
    ],
    soot,
  );
  for (const z of [0.21, 0.32, 0.43, 0.54, 0.65]) f.box(0.55, 0.86, 0.71, 0.8, z, z + 0.036, iron);
  if (f.layout === 1) {
    for (const [lo, hi, z] of [
      [-0.92, -0.38, 1.18],
      [-0.39, 0.29, 1.08],
      [0.28, 0.92, 0.99],
    ]) {
      f.box(lo, hi, 0.02, 0.76, z, z + 0.09, iron);
      f.box(lo, hi, 0.62, 0.81, z + 0.075, z + 0.13, brass);
    }
    return;
  }
  f.box(-0.91, 0.93, 0.015, 0.67, 0.94, 1.04, iron);
  f.face(
    [
      [-0.52, 0.67, 1.04],
      [0.53, 0.67, 1.04],
      [0.44, 0.89, 0.97],
      [-0.45, 0.89, 0.97],
    ],
    brass,
  );
}

function myconid(g: HouseFront) {
  const f = frame(g, 4.4, 3.2);
  const cork = cover('fungal', '87755f'),
    edge = cover('fungal', 'aa9577');
  const gills = [cover('fungal', 'b1a48e'), cover('fungal', 'c3b49d'), cover('fungal', '938574')];
  const lean = ((g.seed % 5) - 2) * 0.024;
  // The original stem has no opening mesh. A dark interior sits against the stem;
  // the hollow vestibule projects in front of it with a real threshold and splayed reveals.
  const arch: [number, number][] = [
    [-0.43, 0.006],
    [-0.48, 0.36],
    [-0.42, 0.59],
    [-0.25, 0.74],
    [0.03, 0.79],
    [0.28, 0.7],
    [0.45, 0.49],
    [0.42, 0.006],
  ];
  const front: Point[] = arch.map(([x, z]) => [x, 0.43 + 0.095 * z, z]);
  const back: Point[] = arch.map(([x, z]) => [x * 0.9, 0.035, z * 0.94]);
  f.face(back, 'city3d:detail:fungal-interior@332c25');
  const sill = wall('stone', '857d6e'),
    shadow = 'city3d:detail:suberized-bark@655849';
  for (let i = 0; i + 1 < front.length; i++) {
    f.face([back[i], back[i + 1], front[i + 1], front[i]], i < 3 ? shadow : i > 4 ? gills[2] : gills[0]);
    const outside = (j: number): Point => [front[j][0] * 1.34, front[j][1] - 0.11, front[j][2] * 1.09];
    f.face([front[i], front[i + 1], outside(i + 1), outside(i)], i % 3 === 0 ? gills[1] : gills[0]);
  }
  f.face([back[0], front[0], front[front.length - 1], back[back.length - 1]], sill);
  // One open folding bark leaf sits against the inner jamb, leaving most of the dark passage visible.
  f.face(
    [
      [-0.39, 0.06, 0.025],
      [-0.26, 0.24, 0.025],
      [-0.26, 0.24, 0.57],
      [-0.39, 0.06, 0.6],
    ],
    'city3d:detail:fungal-door@765f47',
  );
  // Pleats climb from separate mycelial roots. They divide at the wall head,
  // becoming the fan ribs on the underside of a single off-centre bracket.
  for (const s of [-1, 1])
    for (let i = 0; i < 2; i++) {
      const u = i * 0.15,
        up = s < 0 ? 0.06 : 0;
      const fold: Section[] = [
        [s * (0.49 + u), 0.12 + i * 0.07, 0.015, 0.026 + i * 0.014],
        [s * (0.6 + u), 0.22 + i * 0.05, 0.35 + up, 0.045],
        [s * (0.56 + u), 0.33 + i * 0.07, 0.68 + up, 0.043],
        [s * (0.31 + u) + lean, 0.46 + i * 0.09, 0.84 + up + i * 0.025, 0.035],
        [lean + s * 0.07, 0.63 + i * 0.095, 0.97 + i * 0.015, 0.016],
      ];
      if (i === 0) fold.splice(1, 1);
      f.rib(fold, gills[(i + (s < 0 ? 1 : 0)) % 3]);
    }
  if (f.layout !== 0) {
    // A colony can grow overlapping brackets across the lintel, or a descending cluster off one jamb.
    if (f.layout === 1) {
      fanHood(f, -0.32, 0.63, 0.94, 0.88, 0.18, cork, gills[0], 4);
      fanHood(f, 0.42, 0.5, 0.82, 0.67, 0.14, edge, gills[2], 3);
    } else {
      fanHood(f, 0.18, 0.75, 0.98, 0.88, 0.19, cork, gills[1], 4);
      fanHood(f, -0.64, 0.31, 0.76, 0.57, 0.12, edge, gills[0], 3);
      fanHood(f, -0.71, 0.24, 0.57, 0.43, 0.1, cork, gills[2], 2);
    }
    return;
  }
  const root: Point = [lean, 0.02, 1.02],
    ridge: Point = [lean + 0.13, 0.47, 1.08];
  const rim: Point[] = [
    [-0.91, 0.03, 0.84],
    [-0.85, 0.42, 0.9],
    [-0.54, 0.73, 0.94],
    [lean, 0.95, 0.97],
    [0.56, 0.79, 0.94],
    [0.85, 0.51, 0.85],
    [0.82, 0.04, 0.78],
  ];
  for (let i = 1; i < rim.length; i++) {
    f.face([ridge, rim[i], rim[i - 1]], i === 1 || i === 5 ? edge : cork);
    const low = ([x, y, z]: Point): Point => [x * 0.99, y, z - 0.031];
    f.face([rim[i - 1], rim[i], low(rim[i]), low(rim[i - 1])], edge);
    f.face([root, low(rim[i - 1]), low(rim[i])], gills[i % 3]);
  }
  f.face([root, ridge, rim[0]], cork);
  f.face([root, rim[rim.length - 1], ridge], cork);
}

function halfling(g: HouseFront) {
  const f = frame(g, 3.9, 2.5),
    brick = [wall('brick', 'a37b60'), wall('brick', 'b48d6d'), wall('brick', '8d705b')];
  // Each brick has its own intrados and a deep return into the earthen bank.
  // The horseshoe springs below mid-height to suggest a round burrow opening.
  const at = (angle: number, radius: number, y: number): Point => [Math.cos(angle) * radius * 0.7, y, 0.41 + Math.sin(angle) * radius * 0.56];
  const start = -0.56,
    sweep = Math.PI + 1.12;
  for (let i = 0; i < 11; i++) {
    const a = start + (sweep * i) / 11,
      b = start + (sweep * (i + 1)) / 11;
    const y = 0.5 + (i === 5 ? 0.07 : 0.01 * (i % 2)),
      outer = i === 5 ? 1.26 : 1.2;
    f.face([at(a, 1, y), at(b, 1, y), at(b, outer, y), at(a, outer, y)], brick[(i + g.seed) % 3]);
    f.face([at(a, 1, 0.012), at(b, 1, 0.012), at(b, 1, y), at(a, 1, y)], darkOak);
    f.face([at(a, outer, y), at(b, outer, y), at(b, outer, 0.012), at(a, outer, 0.012)], brick[(i + 2) % 3]);
  }
  for (const s of [-1, 1]) {
    f.pier(
      [
        [s * 0.7, 0.3, 0, 0.18, 0.29],
        [s * 0.65, 0.27, 0.17, 0.13, 0.25],
      ],
      brick[1],
    );
    f.box(s * 0.8 - 0.15, s * 0.8 + 0.15, 0.03, 0.77, 0.13, 0.19, limestone);
  }
  if (f.layout === 1) {
    // A turf-covered entry bank with cut shoulders above the horseshoe.
    foldedHood(
      f,
      [
        [-0.95, 0.75, 0.68, 0.36],
        [-0.59, 1.02, 0.96, 0.6],
        [-0.19, 1.2, 1.13, 0.71],
        [0.38, 1.18, 1.09, 0.69],
        [0.96, 0.76, 0.68, 0.37],
      ],
      cover('turf', '7d845e'),
      wall('earth', '7c6751'),
      0.1,
    );
  } else if (f.layout === 2) {
    for (const x of [-0.81, 0.81]) f.post(x, 0.69, 0.19, 0.89, 0.057, oak, 6);
    foldedHood(
      f,
      [
        [-0.92, 0.97, 0.88, 0.76],
        [0, 1.31, 1.2, 0.9],
        [0.92, 0.97, 0.88, 0.76],
      ],
      cover('shingle', '8a7556'),
      honey,
    );
  }
}

function lizardfolk(g: HouseFront) {
  const f = frame(g, 5.8, 3.5),
    reed = cover('reed', '92865b'),
    cane = wall('bamboo', '8b855d');
  // A broad rain hood of overlapping reed mats fans from one high, lashed spar.
  const back: Point[] = [
    [-0.94, 0.02, 0.85],
    [-0.57, 0.02, 0.96],
    [-0.09, 0.02, 1.13],
    [0.39, 0.02, 1.0],
    [0.9, 0.02, 0.86],
  ];
  const lip: Point[] = [
    [-0.91, 0.54, 0.73],
    [-0.61, 0.83, 0.84],
    [0.07, 0.96, 0.95],
    [0.58, 0.79, 0.82],
    [0.92, 0.5, 0.72],
  ];
  if (f.layout === 1) {
    // Offset ridges of separate thatch mats break the rain across the face.
    for (const [x0, x1, z] of [
      [-0.92, -0.29, 1.15],
      [-0.32, 0.34, 1.06],
      [0.31, 0.92, 0.97],
    ])
      foldedHood(
        f,
        [
          [x0, z, 0.86, 0.72],
          [x1, z + 0.04, 0.91, 0.85],
        ],
        reed,
        cane,
        0.07,
      );
  } else if (f.layout === 2) {
    fanHood(f, -0.31, 0.64, 0.84, 0.83, 0.39, reed, cane, 4);
    fanHood(f, 0.51, 0.43, 0.77, 0.68, 0.29, reed, cane, 3);
  } else {
    f.sheet(back, lip, [reed, cover('palm', 'aaa070'), reed, cover('palm', '8b835a')]);
    for (let i = 0; i < lip.length; i++) {
      f.beam(back[i], lip[i], i === 2 ? 0.075 : 0.045, cane);
      if (i > 0) f.beam(lip[i - 1], lip[i], 0.055, cane);
    }
  }
  for (const s of [-1, 1]) {
    f.beam([s * 0.77, 0.68, 0.015], [s * 0.86, 0.57, 0.89], 0.11, cane);
    f.beam([s * 0.8, 0.64, 0.47], [s * 0.57, 0.82, 0.83], 0.07, darkOak);
    for (const z of [0.44, 0.66]) {
      const x = s * (0.77 + 0.09 * z),
        y = 0.68 - z * 0.12;
      f.box(x - 0.055, x + 0.055, y - 0.06, y + 0.06, z, z + 0.026, honey);
    }
  }
}

function merfolk(g: HouseFront) {
  const f = frame(g, 4.9, 3.2),
    nacre = wall('coral', 'c8c5ae'),
    blue = cover('slate', '789a98');
  // A scalloped shell springs from a joint over the door. The radial folds
  // alternate in height as well as tone, leaving the tidal landing clear.
  const hinge: Point = [0.02, 0.015, 1.09],
    rim: Point[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i * Math.PI) / 12;
    rim.push([-0.94 * Math.cos(a), 0.04 + Math.sin(a) * (i % 2 ? 0.8 : 0.94), 0.83 + 0.15 * Math.sin(a) + (i % 2 ? -0.035 : 0.025)]);
  }
  if (f.layout === 1) {
    for (const x of [-0.43, 0.43]) fanHood(f, x, 0.5, 0.89, 0.81, 0.34, blue, nacre, 4);
  } else if (f.layout === 2) {
    fanHood(f, -0.34, 0.6, 1.04, 0.71, 0.27, blue, nacre, 4);
    fanHood(f, 0.3, 0.63, 0.86, 0.91, 0.16, cover('slate', '91b0ab'), nacre, 5);
    f.rib(
      [
        [-0.72, 0.3, 0.72, 0.06],
        [-0.63, 0.42, 1.1, 0.05],
        [-0.41, 0.43, 1.22, 0.016],
      ],
      nacre,
    );
  } else
    for (let i = 1; i < rim.length; i++) {
      f.face([hinge, rim[i], rim[i - 1]], i % 2 ? blue : cover('slate', '91b0ab'));
      const low = (v: Point): Point => [v[0] * 0.99, v[1], v[2] - 0.035];
      f.face([rim[i - 1], rim[i], low(rim[i]), low(rim[i - 1])], nacre);
    }
  for (const s of [-1, 1]) {
    f.rib(
      [
        [s * 0.72, 0.14, 0.22, 0.095],
        [s * 0.81, 0.21, 0.58, 0.072],
        [s * 0.74, 0.42, 0.84, 0.06],
        [s * 0.48, 0.77, 0.96, 0.027],
      ],
      nacre,
    );
    f.rib(
      [
        [s * 0.8, 0.22, 0.56, 0.055],
        [s * 0.9, 0.17, 0.71, 0.045],
        [s * 0.93, 0.12, 0.85, 0.026],
      ],
      nacre,
    );
  }
}

function giant(g: HouseFront) {
  const f = frame(g, 10.8, 7.4),
    granite = wall('stone', '89867d'),
    lichen = wall('stone', 'a4a18c');
  for (const s of [-1, 1]) {
    const dz = s < 0 ? 0.04 : 0;
    f.pier(
      [
        [s * 0.7, 0.41, 0, 0.26, 0.4],
        [s * 0.68, 0.41, 0.18, 0.22, 0.38],
        [s * 0.77, 0.36, 0.75 + dz, 0.16, 0.31],
        [s * 0.73, 0.37, 0.9 + dz, 0.19, 0.32],
      ],
      granite,
    );
    // Low carved grooves mark each standing stone. The rough shoulder above
    // the inscription forms a slanting corbel under the lintel.
    f.pier(
      [
        [s * 0.74, 0.37, 0.71, 0.17, 0.28],
        [s * 0.7, 0.41, 0.8, 0.24, 0.35],
        [s * 0.63, 0.4, 0.91, 0.28, 0.34],
      ],
      lichen,
    );
    f.rib(
      [
        [s * 0.77, 0.76, 0.29, 0.027],
        [s * 0.77, 0.72, 0.59, 0.026],
      ],
      shale,
    );
    f.rib(
      [
        [s * 0.77, 0.73, 0.47, 0.025],
        [s * 0.67, 0.71, 0.56, 0.023],
      ],
      shale,
    );
  }
  f.pier(
    [
      [0.02, 0.4, 0.89, 0.89, 0.33],
      [-0.01, 0.4, 1.0, 0.98, 0.39],
      [0.035, 0.39, 1.12, 0.86, 0.33],
    ],
    lichen,
  );
  // An off-centre cairn of cleft boulders breaks up the skyline. Five-sided
  // weathered fragments have irregular rims and a separate sloping cap.
  const boulder = (x: number, y: number, z: number, rx: number, ry: number, rise: number, mat: string) => {
    const lower: Point[] = [],
      shoulder: Point[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3 + 0.37;
      lower.push([x + Math.cos(a) * rx * 0.8, y + Math.sin(a) * ry * 0.79, z]);
      shoulder.push([x + Math.cos(a) * rx * (i === 4 ? 0.82 : 1), y + Math.sin(a) * ry, z + rise * (i % 2 ? 0.62 : 0.74)]);
    }
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6;
      f.face([lower[i], lower[j], shoulder[j], shoulder[i]], mat);
      f.face([shoulder[i], shoulder[j], [x - rx * 0.21, y + ry * 0.22, z + rise]], mat);
    }
  };
  if (f.layout === 1) {
    // The little opening under the second lintel is a light hole over the doorway.
    boulder(-0.54, 0.37, 1.1, 0.22, 0.25, 0.31, granite);
    boulder(0.51, 0.37, 1.1, 0.25, 0.25, 0.31, granite);
    boulder(0, 0.37, 1.34, 0.8, 0.3, 0.18, lichen);
    return;
  }
  if (f.layout === 2) {
    boulder(-0.5, 0.38, 1.09, 0.31, 0.28, 0.52, granite);
    boulder(0.42, 0.39, 1.09, 0.42, 0.3, 0.18, lichen);
    boulder(0.57, 0.37, 1.22, 0.19, 0.24, 0.19, granite);
    f.pier(
      [
        [0.75, 0.58, 0, 0.19, 0.38],
        [0.75, 0.58, 0.24, 0.16, 0.35],
      ],
      lichen,
    );
    return;
  }
  boulder(-0.37, 0.42, 1.1, 0.47, 0.3, 0.2, granite);
  boulder(0.42, 0.33, 1.11, 0.35, 0.25, 0.17, wall('stone', '888576'));
  boulder(-0.22, 0.41, 1.23, 0.37, 0.22, 0.21, lichen);
}

function goblin(g: HouseFront) {
  const f = frame(g, 4.1, 2.8),
    rusty = cover('metal', '9a634b'),
    scrap = cover('zinc', '79847b');
  const back: Point[] = [
    [-0.93, 0.01, 0.95],
    [-0.46, 0.01, 1.05],
    [0.18, 0.01, 0.96],
    [0.91, 0.01, 0.86],
  ];
  const lip: Point[] = [
    [-0.78, 0.83, 0.83],
    [-0.48, 0.89, 0.93],
    [0.32, 0.7, 0.88],
    [0.94, 0.53, 0.72],
  ];
  if (f.layout === 1) {
    // Salvaged corrugate, overlapped at right angles above a crude side stall.
    foldedHood(
      f,
      [
        [-0.94, 1.1, 1.02, 0.83],
        [-0.31, 1.22, 1.09, 0.89],
        [0.22, 0.96, 0.9, 0.71],
      ],
      scrap,
      iron,
    );
    foldedHood(
      f,
      [
        [0.12, 0.89, 0.98, 0.64],
        [0.91, 1.06, 0.8, 0.62],
      ],
      rusty,
      honey,
    );
    f.box(-0.92, -0.52, 0.08, 0.75, 0.36, 0.41, honey);
  } else if (f.layout === 2) {
    for (const [lo, hi, z] of [
      [-0.93, -0.2, 0.86],
      [-0.22, 0.38, 0.94],
      [0.36, 0.94, 0.83],
    ])
      foldedHood(
        f,
        [
          [lo, z + 0.16, z, 0.6],
          [hi, z + 0.3, z + 0.15, 0.83],
        ],
        lo < 0 ? rusty : scrap,
        darkOak,
      );
  } else f.sheet(back, lip, [scrap, rusty, cover('shingle', '9b895e')]);
  f.beam([-0.69, 0.81, 0.01], [-0.81, 0.82, 0.99], 0.11, darkOak);
  f.beam([-0.73, 0.82, 0.55], [-0.45, 0.86, 0.91], 0.09, honey);
  f.beam([0.78, 0.64, 0.01], [0.9, 0.54, 0.85], 0.082, honey);
  // Reused barrel staves bind a crooked smoke flue against the house.
  f.post(0.65, 0.28, 0, 0.55, 0.16, rusty);
  f.post(0.65, 0.28, 0.17, 0.22, 0.18, iron);
  f.beam([0.65, 0.28, 0.5], [0.79, 0.22, 0.74], 0.22, iron);
  f.post(0.79, 0.22, 0.73, 1.2, 0.095, rusty);
  f.post(0.79, 0.22, 1.16, 1.22, 0.127, iron);
}

function dieselpunk(g: HouseFront) {
  const f = frame(g, 6.2, 4.0),
    steel = wall('steel', '687474'),
    cream = cover('metal', 'b8ac88');
  // A fluted radiator case and a soot-black exhaust stack flank the machine-hall door.
  f.pier(
    [
      [-0.72, 0.36, 0.02, 0.22, 0.32],
      [-0.72, 0.4, 0.2, 0.22, 0.37],
      [-0.72, 0.4, 0.77, 0.22, 0.37],
      [-0.73, 0.32, 0.89, 0.19, 0.29],
    ],
    steel,
  );
  f.box(-0.88, -0.55, 0.73, 0.78, 0.23, 0.74, iron);
  for (let i = 0; i < 5; i++) f.box(-0.88, -0.55, 0.77, 0.84, 0.26 + i * 0.095, 0.29 + i * 0.095, cream);
  f.post(0.73, 0.4, 0, 1.24, 0.135, iron, 8);
  for (const z of [0.16, 0.72, 1.17]) f.post(0.73, 0.4, z, z + 0.06, 0.17, steel, 8);
  if (f.layout === 1) {
    // A stepped machine casing projects in three sections.
    for (const [span, z, reach] of [
      [0.93, 0.91, 0.58],
      [0.73, 1.0, 0.77],
      [0.47, 1.09, 0.89],
    ]) {
      f.box(-span, span, 0.02, reach, z, z + 0.09, steel);
      f.box(-span, span, reach - 0.04, reach, z + 0.06, z + 0.09, cream);
    }
    return;
  }
  if (f.layout === 2) {
    foldedHood(
      f,
      [
        [-0.95, 1.19, 1.03, 0.53],
        [-0.66, 1.2, 1.1, 0.81],
        [0.64, 1.05, 0.94, 0.82],
        [0.91, 0.99, 0.89, 0.48],
      ],
      steel,
      cream,
      0.1,
    );
    for (const x of [-0.47, -0.22, 0.03]) f.beam([x, 0.04, 1.21], [x, 0.8, 1.07], 0.081, cream);
    return;
  }
  const lip: Point[] = [
    [-0.96, 0.42, 0.99],
    [-0.54, 0.81, 0.99],
    [0.55, 0.81, 0.99],
    [0.94, 0.42, 0.99],
  ];
  f.sheet(
    [
      [-0.96, 0.01, 1.04],
      [-0.54, 0.01, 1.04],
      [0.55, 0.01, 1.04],
      [0.94, 0.01, 1.04],
    ],
    lip,
    steel,
  );
  f.sheet(
    lip,
    lip.map(([x, y, z]) => [x, y, z - 0.065]),
    cream,
  );
}

function atompunk(g: HouseFront) {
  const f = frame(g, 6.5, 3.8),
    aqua = cover('metal', '80aca8'),
    enamel = wall('plaster', 'd3c6a5');
  // An upswept saucer canopy cantilevers from an off-centre tapered mast.
  const center: Point = [0.02, 0.26, 1.07],
    rim: Point[] = [];
  for (let i = 0; i <= 10; i++) {
    const a = (i * Math.PI) / 10;
    rim.push([-0.95 * Math.cos(a), 0.02 + 0.92 * Math.sin(a), 0.92 + 0.13 * Math.cos(a) ** 2]);
  }
  if (f.layout === 1) {
    // A split, upswept butterfly canopy around the cantilever pin.
    foldedHood(
      f,
      [
        [-0.96, 1.14, 1.28, 0.63],
        [-0.4, 1.02, 1.01, 0.86],
        [0.1, 0.97, 0.92, 0.93],
        [0.95, 1.17, 1.18, 0.58],
      ],
      aqua,
      enamel,
      0.07,
    );
    f.beam([0.6, 0.34, 0.89], [-0.32, 0.8, 1.01], 0.08, enamel);
  } else if (f.layout === 2) {
    fanHood(f, -0.3, 0.64, 1.08, 0.82, 0.08, aqua, enamel, 5);
    fanHood(f, 0.44, 0.51, 0.9, 0.75, 0.07, enamel, aqua, 4);
  } else
    for (let i = 1; i < rim.length; i++) {
      const below = ([x, y, z]: Point): Point => [x * 0.98, y * 0.98, z - 0.045];
      f.face([center, rim[i], rim[i - 1]], aqua);
      f.face([rim[i - 1], rim[i], below(rim[i]), below(rim[i - 1])], enamel);
      f.face([[0.02, 0.16, 0.93], below(rim[i - 1]), below(rim[i])], enamel);
    }
  f.pier(
    [
      [0.72, 0.39, 0, 0.065, 0.09],
      [0.67, 0.39, 0.67, 0.12, 0.14],
      [0.54, 0.32, 1.12, 0.14, 0.11],
      [0.63, 0.28, 1.37, 0.018, 0.025],
    ],
    enamel,
  );
  for (const z of [0.36, 0.48, 0.6]) f.box(-0.88, -0.57, 0.04, 0.25, z, z + 0.029, aqua);
}

function ruins(g: HouseFront) {
  const f = frame(g, 6.4, 4.1),
    cement = wall('concrete', '979483'),
    broken = wall('concrete', '777565'),
    rebar = wall('steel', '735244');
  f.pier(
    [
      [-0.77, 0.33, 0, 0.19, 0.28],
      [-0.77, 0.33, 0.71, 0.16, 0.26],
      [-0.73, 0.29, 0.87, 0.13, 0.21],
    ],
    cement,
  );
  f.pier(
    [
      [0.75, 0.28, 0, 0.19, 0.25],
      [0.75, 0.28, 0.33, 0.17, 0.24],
      [0.8, 0.24, 0.48, 0.09, 0.16],
    ],
    broken,
  );
  for (const [x, z] of [
    [0.65, 0.65],
    [0.76, 0.78],
    [0.87, 0.62],
  ])
    f.beam([x, 0.3, 0.35], [x + 0.04, 0.33, z], 0.033, rebar);
  // The missing bay exposes aggregate at a jagged break and bent reinforcement below.
  if (f.layout === 1) {
    // The owner has spanned the missing corner with salvaged steel and a sheet-metal patch.
    f.beam([0.78, 0.38, 0.4], [0.75, 0.65, 0.89], 0.13, oak);
    f.beam([-0.85, 0.48, 0.92], [0.8, 0.65, 0.89], 0.13, rebar);
    foldedHood(
      f,
      [
        [-0.94, 1.07, 0.97, 0.71],
        [-0.24, 1.03, 0.94, 0.67],
      ],
      cement,
      broken,
      0.11,
    );
    foldedHood(
      f,
      [
        [-0.28, 1.09, 0.92, 0.75],
        [0.9, 0.99, 0.88, 0.59],
      ],
      cover('zinc', '847d6d'),
      rebar,
    );
    return;
  }
  if (f.layout === 2) {
    // Only short side slabs and the bare steel joists still bridge the door.
    for (const [lo, hi] of [
      [-0.96, -0.5],
      [0.62, 0.92],
    ])
      f.box(lo, hi, 0.02, 0.68, 0.89, 1.03, cement);
    for (const y of [0.18, 0.56]) f.beam([-0.82, y, 0.96], [0.81, y, 0.9], 0.12, rebar);
    for (const x of [-0.48, -0.2, 0.21]) f.beam([x, 0.08, 0.96], [x + 0.08, 0.64, 0.91], 0.05, rebar);
    return;
  }
  const slab: Point[] = [
    [-0.97, 0.015, 1.02],
    [0.19, 0.015, 0.95],
    [0.14, 0.23, 0.95],
    [0.31, 0.38, 0.93],
    [0.07, 0.52, 0.94],
    [0.13, 0.77, 0.93],
    [-0.94, 0.8, 0.99],
  ];
  const corner = slab[0],
    low = ([x, y, z]: Point): Point => [x, y, z - 0.12];
  for (let i = 1; i < slab.length - 1; i++) f.face([corner, slab[i], slab[i + 1]], cement);
  for (let i = 0; i < slab.length; i++) {
    const a = slab[i],
      b = slab[(i + 1) % slab.length];
    f.face([a, low(a), low(b), b], broken);
  }
  f.beam([0.07, 0.57, 0.89], [0.35, 0.59, 0.84], 0.032, rebar);
  f.beam([0.35, 0.59, 0.84], [0.48, 0.65, 0.7], 0.032, rebar);
  f.beam([0.06, 0.73, 0.89], [0.39, 0.77, 0.85], 0.037, rebar);
  f.beam([-0.61, 0.64, 0.02], [-0.39, 0.69, 0.88], 0.09, honey);
}

function biopunk(g: HouseFront) {
  const f = frame(g, 5.8, 3.8),
    chitin = wall('plaster', '8e9780'),
    cartilage = wall('plaster', 'c0b394');
  const skin = cover('felt', '956e69'),
    vein = cover('felt', '78645d');
  // A carapace in three overlapping valves, hung between two weight-bearing tendons.
  for (const s of [-1, 1]) {
    f.rib(
      [
        [s * 0.77, 0.41, 0.015, 0.16],
        [s * 0.68, 0.48, 0.28, 0.105],
        [s * 0.79, 0.47, 0.66, 0.14],
        [s * 0.63, 0.46, 0.88, 0.1],
        [s * 0.33, 0.52, 1.05, 0.055],
      ],
      chitin,
    );
    for (let i = 0; i < 3; i++) {
      const z = 0.36 + i * 0.16,
        x = 0.7 + Math.sin(i * 1.2) * 0.065;
      f.rib(
        [
          [s * (x + 0.12), 0.45, z - 0.045, 0.033],
          [s * x, 0.6, z, 0.047],
          [s * (x - 0.1), 0.47, z + 0.055, 0.022],
        ],
        cartilage,
      );
    }
    f.top(
      [
        [s * 0.89, 0.02, 0.85],
        [s * 0.63, 0.48, 0.89],
        [s * 0.2, 0.65, 1.03],
        [s * 0.12, 0.02, 1.08],
      ],
      skin,
    );
    f.top(
      [
        [s * 0.63, 0.48, 0.89],
        [s * 0.39, 0.75, 0.86],
        [s * 0.2, 0.65, 1.03],
      ],
      vein,
    );
  }
  if (f.layout === 1) {
    // Two lateral valves part along a dorsal channel.
    for (const s of [-1, 1]) {
      fanHood(f, s * 0.42, 0.47, 0.94, 0.86, 0.3, skin, cartilage, 3);
      f.rib(
        [
          [s * 0.72, 0.4, 0.86, 0.05],
          [s * 0.41, 0.42, 1.21, 0.07],
          [s * 0.18, 0.18, 1.35, 0.018],
        ],
        chitin,
      );
    }
    return;
  }
  if (f.layout === 2) {
    // A descending row of protective scales extends from the dominant shoulder.
    for (const [x, half, z] of [
      [-0.44, 0.49, 1.12],
      [0.04, 0.46, 1.0],
      [0.47, 0.43, 0.9],
    ])
      fanHood(f, x, half, z, 0.77, 0.18, chitin, vein, 2);
    return;
  }
  f.sheet(
    [
      [-0.28, 0.015, 1.04],
      [0, 0.015, 1.18],
      [0.28, 0.015, 1.04],
    ],
    [
      [-0.27, 0.71, 0.97],
      [0, 0.95, 1.03],
      [0.27, 0.71, 0.97],
    ],
    chitin,
  );
}

function barbarian(g: HouseFront) {
  const f = frame(g, 5.3, 3.6);
  // Two heavy forked trunks, a pegged lintel and a ridged split-log rain roof.
  for (const s of [-1, 1]) {
    f.pier(
      [
        [s * 0.73, 0.58, 0, 0.22, 0.31],
        [s * 0.73, 0.58, 0.16, 0.15, 0.25],
      ],
      wall('stone', '888077'),
    );
    f.rib(
      [
        [s * 0.72, 0.56, 0.14, 0.15],
        [s * 0.74, 0.6, 0.58, 0.12],
        [s * 0.84, 0.63, 0.98, 0.078],
      ],
      oak,
    );
    f.rib(
      [
        [s * 0.74, 0.6, 0.55, 0.083],
        [s * 0.57, 0.62, 0.79, 0.057],
        [s * 0.46, 0.64, 0.88, 0.045],
      ],
      honey,
    );
  }
  f.beam([-0.92, 0.63, 0.86], [0.92, 0.63, 0.86], 0.17, darkOak);
  if (f.layout === 1) {
    // Three broad bark sheets fall from an off-centre ridge to a low woodshed.
    foldedHood(
      f,
      [
        [-0.94, 0.92, 0.86, 0.76],
        [-0.44, 1.27, 1.22, 0.87],
        [0.26, 1.07, 0.98, 0.79],
        [0.93, 0.89, 0.76, 0.6],
      ],
      cover('bark', '947756'),
      honey,
      0.09,
    );
    f.box(0.64, 0.93, 0.04, 0.62, 0.24, 0.31, oak);
    return;
  }
  if (f.layout === 2) {
    // The split trunks bear an open drying rack along the frontal beam.
    for (const x of [-0.88, -0.54, -0.21, 0.12, 0.46, 0.82]) f.beam([x, 0.05, 1.1], [x, 0.88, 0.88], 0.14, honey);
    f.beam([-0.9, 0.3, 1.04], [0.9, 0.3, 1.04], 0.08, darkOak);
    foldedHood(
      f,
      [
        [-0.92, 1.12, 1.05, 0.36],
        [0.91, 1.12, 1.05, 0.36],
      ],
      cover('bark', '83694e'),
      oak,
    );
    return;
  }
  const back: Point[] = [],
    lip: Point[] = [];
  for (let i = 0; i <= 8; i++) {
    const x = (i - 4) * 0.235,
      crown = 1.14 - 0.24 * Math.abs(x);
    back.push([x, 0.015, crown + 0.03]);
    lip.push([x, 0.86 + (i % 2) * 0.045, crown - 0.045]);
  }
  f.sheet(back, lip, [cover('bark', '83694e'), cover('bark', '9d7f5b'), cover('bark', '8c7257')]);
  for (const i of [0, 2, 4, 6, 8]) f.beam(back[i], lip[i], 0.08, honey);
}

function celticRoundhouse(g: HouseFront) {
  const f = frame(g, 4.6, 3.0),
    straw = cover('thatch', 'a18d61'),
    strawEnd = cover('thatch', '806e4c');
  for (const s of [-1, 1]) {
    f.post(s * 0.68, 0.72, 0.01, 0.87, 0.095, oak, 7);
    f.beam([s * 0.68, 0.72, 0.59], [s * 0.42, 0.72, 0.94], 0.09, honey);
    // Short woven cheek walls turn in under the eaves, with an open approach.
    const x = s * 0.69;
    f.box(x - 0.045, x + 0.045, 0.02, 0.72, 0.03, 0.42, wall('wattle', 'ae956e'));
    f.beam([x, 0.04, 0.43], [x, 0.72, 0.43], 0.07, oak);
  }
  if (f.layout === 1) {
    foldedHood(
      f,
      [
        [-0.94, 0.92, 0.79, 0.63],
        [-0.49, 1.19, 1.06, 0.82],
        [0.49, 1.19, 1.06, 0.82],
        [0.94, 0.92, 0.79, 0.63],
      ],
      straw,
      strawEnd,
      0.09,
    );
    f.beam([-0.48, 0.15, 1.19], [0.48, 0.15, 1.19], 0.09, honey);
    return;
  }
  if (f.layout === 2) {
    // A low shed over a work niche adjoins a higher, separately thatched entry.
    fanHood(f, 0.16, 0.74, 0.91, 0.89, 0.37, straw, strawEnd, 4);
    foldedHood(
      f,
      [
        [-0.95, 0.81, 0.67, 0.7],
        [-0.51, 0.96, 0.83, 0.72],
      ],
      straw,
      strawEnd,
      0.12,
    );
    f.box(-0.89, -0.57, 0.07, 0.62, 0.35, 0.4, honey);
    return;
  }
  const apex: Point = [0, 0.1, 1.22],
    rim: Point[] = [];
  for (let i = 0; i <= 8; i++) {
    const a = (Math.PI * i) / 8;
    rim.push([-0.95 * Math.cos(a), 0.025 + 0.92 * Math.sin(a), 0.82 + 0.015 * (i % 2)]);
  }
  for (let i = 1; i < rim.length; i++) {
    const low = ([x, y, z]: Point): Point => [x * 0.98, y * 0.98, z - 0.084];
    f.top([apex, rim[i - 1], rim[i]], i % 3 === 0 ? cover('reed', 'b19d6c') : straw);
    f.face([rim[i - 1], rim[i], low(rim[i]), low(rim[i - 1])], strawEnd);
  }
}

function norse(g: HouseFront) {
  const f = frame(g, 5.5, 3.4),
    sod = cover('turf', '78805e'),
    soil = wall('earth', '776951');
  const back: Point[] = [
    [-0.89, 0.02, 0.71],
    [0, 0.02, 1.17],
    [0.89, 0.02, 0.71],
  ];
  const lip: Point[] = [
    [-0.95, 0.76, 0.67],
    [0, 0.87, 1.11],
    [0.95, 0.76, 0.67],
  ];
  if (f.layout === 1) {
    // A clipped gable shelters the wall end. The short ridge ends before the turf hip.
    const nose: Point = [0, 0.46, 1.18],
      toe: Point = [0, 0.92, 0.87];
    for (const s of [-1, 1]) {
      f.top([[s * 0.94, 0.02, 0.75], [0, 0.02, 1.21], nose, [s * 0.94, 0.7, 0.73]], sod);
      f.top([[s * 0.94, 0.7, 0.73], nose, toe], sod);
      f.beam([s * 0.94, 0.7, 0.71], toe, 0.12, honey);
    }
  } else if (f.layout === 2) {
    foldedHood(
      f,
      [
        [-0.95, 0.86, 0.72, 0.76],
        [-0.39, 1.17, 1.03, 0.76],
        [0.22, 1.17, 1.03, 0.76],
        [0.94, 0.86, 0.72, 0.76],
      ],
      sod,
      soil,
      0.09,
    );
    f.beam([-0.38, 0.74, 1.02], [0.22, 0.74, 1.02], 0.14, honey);
  } else {
    f.sheet(back, lip, sod);
    f.sheet(
      lip,
      lip.map(([x, y, z]) => [x, y, z - 0.07]),
      soil,
    );
  }
  for (const s of [-1, 1]) {
    f.pier(
      [
        [s * 0.76, 0.37, 0, 0.18, 0.35],
        [s * 0.75, 0.37, 0.23, 0.17, 0.35],
        [s * 0.73, 0.35, 0.63, 0.11, 0.32],
      ],
      wall('stone', '8b8a76'),
    );
    // Carved verge boards cross at the apex and terminate in recurved animal necks.
    if (f.layout === 0)
      f.rib(
        [
          [s * 0.94, 0.78, 0.64, 0.083],
          [s * 0.43, 0.85, 0.9, 0.075],
          [-s * 0.09, 0.88, 1.14, 0.063],
          [-s * 0.21, 0.86, 1.21, 0.041],
          [-s * 0.19, 0.84, 1.3, 0.046],
          [-s * 0.27, 0.845, 1.28, 0.014],
        ],
        honey,
      );
    else if (f.layout === 2)
      f.rib(
        [
          [s * 0.89, 0.76, 0.74, 0.06],
          [s * 0.59, 0.77, 0.9, 0.06],
          [s * 0.36, 0.76, 1.02, 0.055],
          [s * 0.41, 0.73, 1.15, 0.042],
          [s * 0.48, 0.73, 1.13, 0.017],
        ],
        honey,
      );
    f.beam([s * 0.57, 0.7, 0.13], [s * 0.57, 0.7, 0.84], 0.14, darkOak);
  }
}

function ringfort(g: HouseFront) {
  const f = frame(g, 6.4, 3.7),
    tar = cover('shingle', '67665a'),
    trim = wall('wood', '927054');
  // A longhouse side entrance has a broad lean-to, curved exterior braces and
  // tarred vertical boards in the triangular cheek under each end of the slope.
  const lip: Point[] = [
    [-0.95, 0.82, 0.77],
    [0, 0.91, 0.77],
    [0.95, 0.82, 0.77],
  ];
  if (f.layout === 1) {
    foldedHood(
      f,
      [
        [-0.94, 0.9, 0.77, 0.79],
        [-0.49, 1.1, 1.0, 0.8],
        [0, 1.19, 1.14, 0.86],
        [0.51, 1.1, 1.0, 0.8],
        [0.94, 0.9, 0.77, 0.79],
      ],
      tar,
      trim,
      0.07,
    );
    for (const s of [-1, 1]) f.beam([s * 0.83, 0.76, 0.78], [0, 0.84, 1.12], 0.08, honey);
  } else if (f.layout === 2) {
    // The low end shelters a side bench. A taller rectangular porch overlaps its roof.
    foldedHood(
      f,
      [
        [-0.94, 0.86, 0.72, 0.66],
        [-0.43, 0.96, 0.82, 0.74],
      ],
      tar,
      trim,
    );
    foldedHood(
      f,
      [
        [-0.53, 1.19, 0.96, 0.85],
        [0.91, 1.19, 0.96, 0.85],
      ],
      tar,
      trim,
      0.085,
    );
    f.box(-0.92, -0.63, 0.06, 0.62, 0.27, 0.33, honey);
  } else
    f.sheet(
      [
        [-0.95, 0.02, 1.1],
        [0, 0.02, 1.1],
        [0.95, 0.02, 1.1],
      ],
      lip,
      tar,
    );
  for (const s of [-1, 1]) {
    const x = s * 0.83;
    const cheek: Point[] = [
      [x, 0.03, 0.75],
      [x, 0.03, 1.06],
      [x, 0.79, 0.77],
    ];
    f.face(s > 0 ? cheek.reverse() : cheek, darkOak);
    f.rib(
      [
        [s * 0.95, 0.74, 0.03, 0.1],
        [s * 0.89, 0.73, 0.32, 0.09],
        [s * 0.8, 0.72, 0.75, 0.085],
        [s * 0.73, 0.58, 0.87, 0.067],
      ],
      trim,
    );
    f.beam([s * 0.62, 0.17, 0.005], [s * 0.62, 0.17, 1.04], 0.14, oak);
    f.beam([s * 0.82, 0.72, 0.47], [s * 0.57, 0.75, 0.75], 0.095, honey);
  }
  f.beam([-0.94, 0.81, 0.75], [0.94, 0.81, 0.75], 0.14, trim);
  f.box(-0.71, 0.71, 0.05, 0.27, 0.91, 0.99, honey);
}

function oppidum(g: HouseFront) {
  const f = frame(g, 6.4, 3.6),
    lime = wall('plaster', 'c1ae8a'),
    lath = cover('shingle', '9b8059');
  // A square-framed street porch has a limewashed gable and a little stall
  // counter on the sheltered side of the door.
  for (const s of [-1, 1]) {
    f.pier(
      [
        [s * 0.75, 0.76, 0.01, 0.16, 0.2],
        [s * 0.75, 0.76, 0.13, 0.13, 0.17],
      ],
      wall('stone', '8b8878'),
    );
    f.beam([s * 0.75, 0.76, 0.13], [s * 0.75, 0.76, 0.82], 0.13, darkOak);
    f.beam([s * 0.75, 0.76, 0.55], [s * 0.49, 0.76, 0.81], 0.1, oak);
  }
  f.box(0.57, 0.94, 0.06, 0.7, 0.37, 0.43, honey);
  if (f.layout === 1) {
    // Merchant's pentice, with shuttered shelving behind the existing counter.
    foldedHood(
      f,
      [
        [-0.95, 1.09, 0.83, 0.83],
        [0.95, 1.09, 0.83, 0.83],
      ],
      lath,
      oak,
      0.08,
    );
    f.box(0.62, 0.92, 0.06, 0.22, 0.45, 0.65, lime);
    for (const x of [-0.76, -0.29, 0.31, 0.76]) f.beam([x, 0.06, 1.09], [x, 0.85, 0.83], 0.055, honey);
    return;
  }
  if (f.layout === 2) {
    foldedHood(
      f,
      [
        [-0.94, 0.86, 0.82, 0.75],
        [-0.31, 1.27, 1.17, 0.87],
        [0.33, 0.9, 0.81, 0.76],
      ],
      lath,
      oak,
      0.07,
    );
    foldedHood(
      f,
      [
        [0.27, 0.93, 0.82, 0.84],
        [0.94, 0.93, 0.82, 0.84],
      ],
      lath,
      oak,
      0.07,
    );
    f.face(
      [
        [-0.88, 0.72, 0.84],
        [-0.31, 0.84, 1.14],
        [0.25, 0.74, 0.84],
      ],
      lime,
    );
    f.beam([-0.31, 0.84, 0.84], [-0.31, 0.84, 1.14], 0.08, darkOak);
    return;
  }
  f.sheet(
    [
      [-0.94, 0.01, 0.83],
      [0, 0.01, 1.18],
      [0.94, 0.01, 0.83],
    ],
    [
      [-0.95, 0.88, 0.83],
      [0, 0.88, 1.18],
      [0.95, 0.88, 0.83],
    ],
    lath,
  );
  f.face(
    [
      [-0.9, 0.84, 0.82],
      [0, 0.84, 1.15],
      [0.9, 0.84, 0.82],
    ],
    lime,
  );
  f.beam([-0.94, 0.86, 0.815], [0.94, 0.86, 0.815], 0.12, oak);
  for (const x of [-0.44, 0, 0.44]) f.beam([x, 0.86, 0.84], [x, 0.86, 1.15 - Math.abs(x) * 0.34], 0.08, darkOak);
}

function kremlin(g: HouseFront) {
  const f = frame(g, 5.4, 3.6),
    madder = wall('wood', '995c48'),
    milk = wall('wood', 'd4c4a4'),
    tile = cover('shingle', '697a71');
  // A timber kryltso: a tented porch, turned posts with projecting collars and
  // a sawn fascia whose pointed drops alternate with spaces for the daylight.
  for (const s of [-1, 1]) {
    const x = s * 0.72;
    f.pier(
      [
        [x, 0.61, 0, 0.09, 0.13],
        [x, 0.61, 0.19, 0.095, 0.13],
        [x, 0.61, 0.25, 0.062, 0.09],
        [x, 0.61, 0.6, 0.062, 0.09],
        [x, 0.61, 0.67, 0.095, 0.14],
        [x, 0.61, 0.79, 0.08, 0.12],
      ],
      madder,
    );
    f.box(x - 0.095, x + 0.095, 0.47, 0.75, 0.62, 0.65, milk);
    f.beam([x, 0.61, 0.59], [s * 0.43, 0.62, 0.8], 0.088, milk);
  }
  if (f.layout === 1) {
    // A stepped barrel gable with little pendent verge boards.
    const stations: [number, number, number, number][] = [
      [-0.94, 0.83, 0.82, 0.79],
      [-0.57, 0.96, 0.96, 0.84],
      [-0.31, 1.21, 1.22, 0.85],
      [0, 1.34, 1.36, 0.91],
      [0.31, 1.21, 1.22, 0.85],
      [0.57, 0.96, 0.96, 0.84],
      [0.94, 0.83, 0.82, 0.79],
    ];
    foldedHood(f, stations, tile, milk, 0.08);
    for (const [x, , z, reach] of stations.slice(1, -1))
      f.face(
        [
          [x - 0.053, reach, z - 0.05],
          [x + 0.053, reach, z - 0.05],
          [x, reach, z - 0.18],
        ],
        milk,
      );
    return;
  }
  if (f.layout === 2) {
    // Central gabled canopy and two lower, independent shingle eaves.
    foldedHood(
      f,
      [
        [-0.6, 0.93, 0.88, 0.83],
        [0, 1.36, 1.29, 0.88],
        [0.6, 0.93, 0.88, 0.83],
      ],
      tile,
      milk,
      0.08,
    );
    for (const s of [-1, 1]) {
      foldedHood(
        f,
        [
          [s * 0.93, 0.91, 0.78, 0.73],
          [s * 0.49, 1.01, 0.88, 0.75],
        ].sort((a, b) => a[0] - b[0]) as [number, number, number, number][],
        tile,
        milk,
        0.07,
      );
      f.beam([s * 0.54, 0.8, 0.89], [0, 0.86, 1.28], 0.065, madder);
    }
    return;
  }
  const apex: Point = [0, 0.36, 1.29];
  const rim: Point[] = [
    [-0.94, 0.02, 0.83],
    [0.94, 0.02, 0.83],
    [0.94, 0.77, 0.83],
    [0, 0.93, 0.94],
    [-0.94, 0.77, 0.83],
  ];
  for (let i = 0; i < rim.length; i++) {
    const a = rim[i],
      b = rim[(i + 1) % rim.length];
    f.top([apex, a, b], tile);
    f.beam(a, b, 0.068, milk);
    if (i === 2 || i === 3)
      for (let j = 1; j <= 3; j++) {
        const x = a[0] + ((b[0] - a[0]) * j) / 4,
          y = a[1] + ((b[1] - a[1]) * j) / 4,
          z = a[2] + ((b[2] - a[2]) * j) / 4;
        f.face(
          [
            [x - 0.075, y, z],
            [x + 0.075, y, z],
            [x, y, z - (j === 2 ? 0.105 : 0.07)],
          ],
          milk,
        );
      }
  }
  f.rib(
    [
      [0, 0.36, 1.24, 0.05],
      [0, 0.36, 1.32, 0.065],
      [0, 0.36, 1.39, 0.012],
    ],
    madder,
  );
}

function gord(g: HouseFront) {
  const f = frame(g, 5.7, 3.6),
    pine = wall('wood', '947355'),
    end = wall('wood', 'b1936c');
  // A low crib of alternate notched logs supports the covered entry. The stagger
  // and exposed end-grain show the construction in silhouette at either cheek.
  for (const s of [-1, 1]) {
    const x = s * 0.71;
    for (let i = 0; i < 4; i++) {
      const z = 0.04 + i * 0.085,
        nose = 0.76 + (i % 2) * 0.075;
      f.box(x - 0.088, x + 0.088, 0.015, nose, z, z + 0.081, i % 2 ? oak : pine);
      f.face(
        [
          [x - 0.086, nose + 0.002, z],
          [x - 0.086, nose + 0.002, z + 0.081],
          [x + 0.086, nose + 0.002, z + 0.081],
          [x + 0.086, nose + 0.002, z],
        ],
        end,
      );
    }
    f.post(x, 0.65, 0.365, 0.84, 0.1, pine, 6);
    f.beam([x, 0.65, 0.52], [x, 0.31, 0.84], 0.09, oak);
  }
  if (f.layout === 1) {
    const reed = cover('thatch', 'a3916b');
    // Mown thatch drops from a short high ridge to wide weather cheeks.
    foldedHood(
      f,
      [
        [-0.94, 0.89, 0.8, 0.73],
        [-0.47, 1.19, 1.11, 0.82],
        [0.34, 1.19, 1.11, 0.82],
        [0.94, 0.89, 0.8, 0.73],
      ],
      reed,
      pine,
      0.09,
    );
    for (const x of [-0.47, 0.34]) f.beam([x, 0.035, 1.19], [x, 0.85, 1.11], 0.09, end);
    return;
  }
  if (f.layout === 2) {
    // A slanting shingle roof extends over a little woodpile, leaving the log crib visible.
    foldedHood(
      f,
      [
        [-0.94, 1.15, 0.98, 0.84],
        [0.35, 1.07, 0.89, 0.84],
        [0.94, 0.89, 0.74, 0.74],
      ],
      cover('shingle', '927454'),
      pine,
      0.08,
    );
    for (const z of [0.13, 0.24, 0.35]) f.beam([0.6, 0.47, z], [0.9, 0.48, z], 0.13, end);
    return;
  }
  const back: Point[] = [
    [-0.9, 0.015, 0.82],
    [0, 0.015, 1.15],
    [0.9, 0.015, 0.82],
  ];
  const lip: Point[] = [
    [-0.94, 0.88, 0.8],
    [0, 0.88, 1.13],
    [0.94, 0.88, 0.8],
  ];
  f.sheet(back, lip, cover('thatch', 'a3916b'));
  f.sheet(
    lip,
    lip.map(([x, y, z]) => [x, y, z - 0.072]),
    pine,
  );
  f.beam([-0.83, 0.67, 0.79], [0.83, 0.67, 0.79], 0.13, oak);
  f.beam([0, 0.033, 1.15], [0, 0.94, 1.13], 0.11, darkOak);
}

export const legendFronts: Record<string, (g: HouseFront) => void> = {
  elven,
  dwarven,
  necropolis,
  orcish,
  'drow-enclave': drow,
  'duergar-hold': duergar,
  'myconid-colony': myconid,
  halfling,
  'lizardfolk-swamp': lizardfolk,
  'merfolk-tidal': merfolk,
  'giant-hold': giant,
  'goblin-warren': goblin,
  dieselpunk,
  'atompunk-retrofuturist': atompunk,
  'post-apocalyptic-ruins': ruins,
  'biopunk-organic-city': biopunk,
  barbarian,
  'barbarian-celtic': celticRoundhouse,
  'barbarian-norse': norse,
  'norse-ringfort': ringfort,
  'celtic-oppidum': oppidum,
  'russian-kremlin': kremlin,
  'slavic-gord': gord,
};
