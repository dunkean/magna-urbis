import type { HouseFront } from './houseFrontKit';

type P = [number, number, number];
const wood = 'city3d:wall:wood@795640';
const darkWood = 'city3d:wall:wood@574236';
const cedar = 'city3d:wall:wood@937057';
const cane = 'city3d:wall:bamboo@ac925d';
const stone = 'city3d:wall:stone@968c79';
const basalt = 'city3d:wall:stone@625e56';
const lime = 'city3d:wall:plaster@d3c6ae';
const ochre = 'city3d:wall:earth@b08864';
const red = 'city3d:detail:paint@95503d';
const indigoTile = 'city3d:cover:tile@5f6468';
const bark = 'city3d:cover:bark@806752';
const palm = 'city3d:cover:palm@9a8057';
const hide = 'city3d:cover:hide@bea17c';
const felt = 'city3d:cover:felt@cbbda3';
const snow = 'city3d:cover:snow@e2e9e8';
const snowShade = 'city3d:cover:snow@cbd8db';

// Each footprint is measured in metres. Cap the spans so a long façade still has domestic-scale joinery.
const halfSpan = (g: HouseFront, span: number) => Math.min(g.width * 0.49, span);
const high = (g: HouseFront, h: number) => Math.min(g.height * 0.97, h);

/** A thick roof pan with exposed eave, soffit and rake. Top vertices run counter-clockwise in plan. */
function pan(g: HouseFront, top: P[], thickness: number, cover: string, edge = wood, base?: number): void {
  const bottom: P[] = top.map(([x, y, z]) => [x, y, base ?? z - thickness]);
  g.face(top, cover);
  g.face([...bottom].reverse(), edge);
  for (let i = 0; i < top.length; i++) {
    const next = (i + 1) % top.length;
    g.face([top[i], bottom[i], bottom[next], top[next]], edge);
  }
}

function shed(g: HouseFront, w: number, d: number, rear: number, eave: number, cover: string, edge = wood): void {
  pan(
    g,
    [
      [-w, 0, rear],
      [w, 0, rear],
      [w, d, eave],
      [-w, d, eave],
    ],
    0.075,
    cover,
    edge,
  );
}

function gable(g: HouseFront, w: number, d: number, ridge: number, eave: number, cover: string, edge = wood): void {
  pan(
    g,
    [
      [-w, 0, eave],
      [0, 0, ridge],
      [0, d, ridge],
      [-w, d, eave],
    ],
    0.095,
    cover,
    edge,
  );
  pan(
    g,
    [
      [0, 0, ridge],
      [w, 0, eave],
      [w, d, eave],
      [0, d, ridge],
    ],
    0.095,
    cover,
    edge,
  );
}

// The short ridge closes in a triangular hip towards the street.
function hip(g: HouseFront, w: number, d: number, ridge: number, eave: number, cover: string, edge = wood): void {
  const peak: P = [0, d * 0.47, ridge];
  const back: P = [0, 0, ridge];
  const left: P = [-w, d, eave],
    right: P = [w, d, eave];
  pan(g, [[-w, 0, eave], back, peak, left], 0.085, cover, edge);
  pan(g, [back, [w, 0, eave], right, peak], 0.085, cover, edge);
  pan(g, [peak, right, left], 0.085, cover, edge);
}

/** Plank or mat partition along the side of a porch, held between a sill and top rail. */
function sideScreen(g: HouseFront, x: number, d: number, z: number, top: number, panel: string, frame = wood): void {
  const t = Math.min(0.06, Math.abs(x) * 0.045);
  g.box(x - t, x + t, 0, d, z, z + t, frame);
  g.box(x - t * 0.65, x + t * 0.65, 0, d, z + t, top - t, panel);
  g.box(x - t, x + t, 0, d, top - t, top, frame);
}

function uprights(g: HouseFront, x: number, y: number, base: number, top: number, size: number, mat: string): void {
  for (const sign of [-1, 1]) g.box(sign * x - size / 2, sign * x + size / 2, y - size / 2, y + size / 2, base, top, mat);
}

/** Small raised entries get two stringers and actual treads descending to the surrounding ground. */
function landing(g: HouseFront, w: number, d: number, surface = wood, outer = 0.98): number {
  const z = g.floor > 0 ? 0 : g.doorHeight ? 0.035 : 0.18;
  const foot = -g.floor;
  const thick = Math.min(0.12, z - foot);
  const end = Math.min(g.depth * outer, d + Math.max(0.26, (z - foot) * 0.82));
  g.box(-w, w, 0, d, z - thick, z, surface);
  if (z - foot < 0.08) return z;
  const s = Math.min(0.08, w * 0.085, d * 0.13);
  uprights(g, w - s, d - s, foot, z - thick, s * 1.75, darkWood);
  const stair = Math.min(w * 0.86, Math.max(0.48, (g.doorWidth ?? 1) / 2));
  const count = Math.min(10, Math.max(1, Math.ceil((z - foot) / 0.25) - 1));
  const rise = (z - foot) / (count + 1),
    run = (end - d) / (count + 1);
  const stringer = Math.min(s * 1.3, (z - foot) * 0.3);
  const tread = Math.min(0.075, rise * 0.6);
  // The upper ends bear against the deck. Seat each tread on the same line and trim the feet at ground level.
  const inset = tread + stringer / 2;
  const bottom = Math.min(0.9, (inset + stringer / 2) / (z - foot));
  const toe = Math.min(g.depth - stringer / 2, end - (end - d) * bottom);
  for (const side of [-1, 1]) g.beam([side * stair * 0.8, d, z - inset], [side * stair * 0.8, toe, foot + stringer / 2], stringer, darkWood);
  g.box(-stair, stair, toe - run * 0.16, Math.min(end, toe + run * 0.4), foot, foot + stringer * 0.64, darkWood);
  for (let i = 0; i < count; i++) {
    const level = z - (i + 1) * rise,
      at = d + (i + 1) * run;
    g.box(-stair, stair, at - run * 0.44, at + run * 0.44, level - tread, level, surface);
  }
  return z;
}

function chinese(g: HouseFront): void {
  const w = halfSpan(g, 2.35),
    d = Math.min(g.depth, 1.35),
    h = high(g, 2.85);
  // Shallow sweep at the eave, changing to a steeper tile pitch against the wall.
  const variant = g.seed % 3;
  if (variant) {
    const r = Math.min(0.1, w * 0.055);
    if (variant === 1) {
      hip(g, w, d, h, h * 0.8, indigoTile, darkWood);
      for (const x of [-w * 0.85, w * 0.85]) {
        g.post(x, d * 0.72, 0, 0.14, r * 1.45, stone, 6);
        g.post(x, d * 0.72, 0.14, h * 0.805, r, red, 6);
      }
    } else {
      gable(g, w, d, h, h * 0.78, indigoTile, darkWood);
      for (const x of [-w * 0.82, w * 0.82]) {
        g.box(x - r, x + r, 0, d * 0.8, h * 0.77, h * 0.8, wood);
        g.beam([x, 0.09, h * 0.52], [x, d * 0.76, h * 0.79], r * 1.6, red);
      }
    }
    return;
  }
  const corner = w * 0.7;
  for (const [l, r] of [
    [-w, -corner],
    [-corner, corner],
    [corner, w],
  ]) {
    const lift = (x: number) => (Math.abs(x) === w ? h * 0.065 : 0);
    const y = d * 0.55;
    pan(
      g,
      [
        [l, 0, h],
        [r, 0, h],
        [r, y, h * 0.85 + lift(r) * 0.25],
        [l, y, h * 0.85 + lift(l) * 0.25],
      ],
      0.075,
      indigoTile,
      darkWood,
    );
    pan(
      g,
      [
        [l, y, h * 0.85 + lift(l) * 0.25],
        [r, y, h * 0.85 + lift(r) * 0.25],
        [r, d, h * 0.81 + lift(r)],
        [l, d, h * 0.81 + lift(l)],
      ],
      0.075,
      indigoTile,
      darkWood,
    );
  }
  const support = w * 0.67;
  for (const x of [-support, support]) {
    const r = Math.min(0.1, w * 0.07);
    g.post(x, d * 0.77, 0, 0.18, r * 1.45, stone, 6);
    g.post(x, d * 0.77, 0.18, h * 0.79, r, red, 6);
    g.box(x - r * 2, x + r * 2, d * 0.67, d * 0.88, h * 0.765, h * 0.81, darkWood);
  }
  g.box(-support * 1.12, support * 1.12, d * 0.73, d * 0.82, h * 0.79, h * 0.835, wood);
}

function japanese(g: HouseFront): void {
  const w = halfSpan(g, 2.6),
    d = Math.min(g.depth, 0.9),
    h = high(g, 2.55);
  shed(g, w, d, h, h * 0.85, indigoTile, darkWood);
  // Projecting kōshi screens flank the open street passage under the straight machiya eave.
  for (const sign of [-1, 1]) {
    const l = (sign < 0 ? -0.96 : 0.44) * w,
      r = (sign < 0 ? -0.44 : 0.96) * w;
    const variant = g.seed % 3;
    if (variant === 1) {
      // Bent bamboo sweeps away from the plaster at the base of the machiya.
      const rafter = Math.min(0.045, (r - l) * 0.07);
      for (let k = 0; k < 4; k++) {
        const x = l + ((r - l) * (k + 0.5)) / 4;
        g.beam([x, d * 0.8, 0.055], [x, d * 0.64, h * 0.22], rafter, cane);
        g.beam([x, d * 0.64, h * 0.22], [x, 0.04, h * 0.4], rafter, cane);
      }
      g.box(l, r, d * 0.6, d * 0.67, h * 0.2, h * 0.23, darkWood);
      continue;
    }
    if (variant === 2) {
      // Hinged shopfront bench, on two wooden legs.
      g.box(l, r, 0, d * 0.83, h * 0.22, h * 0.25, cedar);
      for (const x of [l + (r - l) * 0.12, r - (r - l) * 0.12]) g.box(x - 0.025, x + 0.025, d * 0.69, d * 0.77, 0, h * 0.22, wood);
      g.box(l, r, 0, d * 0.12, h * 0.26, h * 0.65, wood);
      continue;
    }
    const out = d * 0.33,
      count = Math.min(6, Math.max(3, Math.floor((r - l) / 0.16)));
    g.box(l, r, 0, out, 0.1, h * 0.23, wood);
    g.box(l, r, 0, out, h * 0.75, h * 0.8, darkWood);
    for (let k = 0; k < count; k++) {
      const x = l + ((r - l) * k) / count;
      g.box(x, x + ((r - l) * 0.38) / count, out * 0.68, out, h * 0.23, h * 0.75, darkWood);
    }
    g.box(l, r, out * 0.5, out * 0.75, h * 0.48, h * 0.51, wood);
  }
}

function korean(g: HouseFront): void {
  const w = halfSpan(g, 2.6),
    d = Math.min(g.depth, 1.5),
    h = high(g, 2.65);
  const z = landing(g, w * 0.93, d * 0.68, cedar);
  const variant = g.seed % 3;
  if (variant === 1) hip(g, w, d * 0.88, h, h * 0.84, indigoTile);
  else shed(g, w, d * 0.88, h, h * 0.83, indigoTile);
  if (variant === 2) {
    sideScreen(g, w * 0.82, d * 0.62, z, h * 0.76, wood, darkWood);
    sideScreen(g, -w * 0.82, d * 0.39, z, h * 0.33, cedar);
  }
  for (const x of [-w * 0.78, w * 0.78]) {
    const r = Math.min(0.115, w * 0.08);
    g.post(x, d * 0.58, z, z + 0.16, r * 1.4, stone, 6);
    g.post(x, d * 0.58, z + 0.16, h * 0.88 - 0.07, r, wood, 6);
  }
  // Individual boards at the front of the open elevated maru, with an exposed transverse bearer.
  g.box(-w * 0.92, w * 0.92, d * 0.6, d * 0.67, Math.max(-g.floor, z - 0.18), z - 0.085, darkWood);
  for (let i = 1; i < 7; i++) {
    const x = w * 0.93 * ((2 * i) / 7 - 1);
    g.face(
      [
        [x, 0, z + 0.004],
        [x + 0.015, 0, z + 0.004],
        [x + 0.015, d * 0.66, z + 0.004],
        [x, d * 0.66, z + 0.004],
      ],
      darkWood,
    );
  }
}

function khmer(g: HouseFront): void {
  const w = halfSpan(g, 1.65),
    d = Math.min(g.depth, 2.3),
    h = high(g, 2.75);
  const z = landing(g, w * 0.9, d * 0.48);
  const doorway = Math.min(w * 0.82, (g.doorWidth ?? 0.95) / 2 + 0.04);
  const clear = Math.min(h - 0.12, (g.doorHeight ?? 1.85) + 0.04);
  // The rakes above both jambs must clear the full width of the opening, even on a narrow landing.
  const eave = Math.max(h * 0.7, h - (w * (h - clear - 0.095)) / doorway);
  const variant = g.seed % 3;
  const shedEave = Math.max(eave, Math.min(h - 0.012, clear + 0.09));
  if (variant === 0) gable(g, w, d * 0.62, h, eave, g.cover, cane);
  if (variant === 1) shed(g, w, d * 0.62, h, shedEave, g.cover, cane);
  if (variant === 2) hip(g, w, d * 0.62, h, shedEave, g.cover, cane);
  const timber = Math.min(0.14, w * 0.1);
  const support = Math.min(w - timber / 2, Math.max(w * 0.81, doorway + timber / 2));
  const supportTop = variant === 0 ? h + ((eave - h) * support) / w - 0.095 : variant === 1 ? h + ((shedEave - h) * 0.41) / 0.62 - 0.075 : h + (shedEave - h) * Math.max(support / w, (0.41 / 0.62 - 0.47) / 0.53) - 0.085;
  uprights(g, support, d * 0.41, z, supportTop, timber, wood);
  // A light woven knee wall encloses one side of the stair landing.
  const x = support * (g.seed & 1 ? 1 : -1);
  if (variant === 2) sideScreen(g, -x, d * 0.4, z, z + h * 0.55, cane);
  g.box(x - 0.035, x + 0.035, 0, d * 0.41, z + 0.06, z + h * 0.28, cane);
  g.beam([x, 0.05, z + h * 0.29], [x, d * 0.43, z + h * 0.29], 0.085, wood);
}

function himalayan(g: HouseFront): void {
  const w = halfSpan(g, 2.45),
    d = Math.min(g.depth, 1.4),
    h = high(g, 2.65);
  // The earth terrace meets a pair of low stone returns and an asymmetric outside stair.
  const left = g.seed & 1 ? -1 : 1;
  for (const sign of [-1, 1]) {
    const x = sign * w * 0.76;
    g.box(x - w * 0.18, x + w * 0.18, 0, d * 0.74, 0, h * 0.61, g.wall);
    g.box(x - w * 0.2, x + w * 0.2, 0, d * 0.79, h * 0.61, h * 0.65, stone);
  }
  for (let i = 0; i < 3; i++) {
    const x = left * w * 0.76;
    g.box(x - w * 0.19, x + w * 0.19, d * (0.74 + 0.08 * i), d * (0.82 + 0.08 * i), 0, h * (0.48 - 0.16 * i), stone);
  }
  if (g.seed % 3 === 1) {
    // An uncovered terrace holds a low parapet at the two outer edges.
    for (const side of [-1, 1]) sideScreen(g, side * w * 0.89, d * 0.73, h * 0.65, h * 0.82, stone, stone);
    return;
  }
  if (g.seed % 3 === 2) {
    // One roofed work bay adjoins the open stone terrace.
    const x = -left * w * 0.76;
    g.box(x - w * 0.23, x + w * 0.23, 0, d * 0.76, h * 0.88, h * 0.95, ochre);
    for (const k of [-1, 1]) g.post(x + k * w * 0.14, d * 0.6, h * 0.65, h * 0.88, Math.min(0.065, w * 0.04), darkWood, 5);
    return;
  }
  uprights(g, w * 0.75, d * 0.55, h * 0.65, h * 0.88, Math.min(0.2, w * 0.12), darkWood);
  g.box(-w, w, 0, d * 0.7, h * 0.88, h * 0.95, ochre);
  for (const f of [-0.81, -0.42, 0, 0.42, 0.81]) g.box((f - 0.03) * w, (f + 0.03) * w, 0, d * 0.79, h * 0.845, h * 0.9, darkWood);
}

function newar(g: HouseFront): void {
  const w = halfSpan(g, 1.9),
    d = Math.min(g.depth, 0.9),
    h = high(g, 3.65);
  // Cantilevered timber window, widening out from a narrow, bracketed sill.
  const variant = g.seed % 3;
  if (variant) {
    shed(g, w, d, h, h * 0.9, g.cover, darkWood);
    for (const s of [-1, 1]) {
      const x = s * w * 0.76;
      g.beam([x, 0.09, h * 0.52], [x, d * 0.78, h * 0.9], Math.min(0.14, w * 0.095), darkWood);
    }
    if (variant === 1) return;
    // An open timber balcony replaces the enclosed projecting lattice bay.
    g.box(-w * 0.89, w * 0.89, 0, d * 0.82, h * 0.71, h * 0.75, wood);
    for (const f of [-0.81, -0.46, 0, 0.46, 0.81]) {
      const x = w * f;
      g.box(x - 0.03, x + 0.03, d * 0.69, d * 0.78, h * 0.75, h * 0.89, wood);
    }
    g.box(-w * 0.88, w * 0.88, d * 0.68, d * 0.8, h * 0.87, h * 0.9, darkWood);
    return;
  }
  const y = d * 0.82,
    foot = h * 0.66;
  const back = w * 0.61,
    front = w * 0.84;
  pan(
    g,
    [
      [-back, 0, foot],
      [back, 0, foot],
      [front, y, foot],
      [-front, y, foot],
    ],
    0.115,
    wood,
    darkWood,
  );
  g.box(-front, front, y * 0.85, y, foot, h * 0.88, 'city3d:detail:lattice-shadow@43372e');
  for (const frac of [-0.94, -0.5, 0, 0.5, 0.94]) {
    const x = frac * front;
    g.box(x - front * 0.035, x + front * 0.035, y * 0.9, d * 0.86, foot, h * 0.895, wood);
  }
  for (const x of [-back * 0.85, back * 0.85]) g.beam([x, 0.055, h * 0.46], [x, y * 0.92, foot - 0.045], 0.115, darkWood);
  for (let i = 0; i < 8; i++) {
    const x = (i / 4 - 1) * front,
      t = front * 0.22;
    g.face(
      [
        [x, y + 0.006, foot + 0.03],
        [x + t, y + 0.006, h * 0.866],
        [x + t + 0.026, y + 0.006, h * 0.866],
        [x + 0.026, y + 0.006, foot + 0.03],
      ],
      cedar,
    );
  }
  shed(g, w, d, h, h * 0.9, g.cover, darkWood);
}

function javanese(g: HouseFront): void {
  const w = halfSpan(g, 3),
    d = Math.min(g.depth, 1.7),
    h = high(g, 2.9);
  // The emper is open on three sides. Hip ends wrap the two flanking timber posts.
  const shoulder = w * 0.73,
    ridge = h * 0.99,
    eave = h * 0.77;
  const variant = g.seed % 3;
  if (variant === 1) gable(g, w, d, ridge, eave, g.cover);
  else if (variant === 2) shed(g, w, d, ridge, eave, g.cover);
  else {
    pan(
      g,
      [
        [-shoulder, 0, ridge],
        [shoulder, 0, ridge],
        [w, d, eave],
        [-w, d, eave],
      ],
      0.08,
      g.cover,
    );
    pan(
      g,
      [
        [shoulder, 0, ridge],
        [w, 0, eave],
        [w, d, eave],
      ],
      0.08,
      g.cover,
    );
    pan(
      g,
      [
        [-w, 0, eave],
        [-shoulder, 0, ridge],
        [-w, d, eave],
      ],
      0.08,
      g.cover,
    );
  }
  const z = landing(g, w * 0.9, d * 0.69, stone);
  const r = Math.min(0.13, w * 0.08);
  for (const x of [-w * 0.77, w * 0.77]) {
    g.box(x - r, x + r, d * 0.6 - r, d * 0.6 + r, z, z + 0.21, basalt);
    g.box(x - r * 0.63, x + r * 0.63, d * 0.6 - r * 0.63, d * 0.6 + r * 0.63, z + 0.21, h * 0.85, wood);
  }
  g.box(-w * 0.85, w * 0.85, d * 0.55, d * 0.65, h * 0.815, h * 0.85, darkWood);
}

function bagan(g: HouseFront): void {
  const w = halfSpan(g, 2.1),
    d = Math.min(g.depth, 1.65),
    h = high(g, 2.85);
  const z = landing(g, w * 0.88, d * 0.65, cedar);
  const variant = g.seed % 3;
  if (variant) {
    if (variant === 1) {
      shed(g, w, d * 0.84, h, h * 0.79, g.cover);
      sideScreen(g, w * 0.82, d * 0.62, z, h * 0.63, cane);
    } else {
      hip(g, w, d * 0.84, h, h * 0.77, g.cover);
      for (const side of [-1, 1]) sideScreen(g, side * w * 0.8, d * 0.62, z, h * 0.32, cane, darkWood);
    }
    uprights(g, w * 0.8, d * 0.57, z, variant === 1 ? h * 0.857 - 0.07 : h * 0.816 - 0.08, Math.min(w * 0.11, 0.15), darkWood);
    return;
  }
  gable(g, w, d * 0.84, h, h * 0.7, g.cover);
  uprights(g, w * 0.8, d * 0.57, z, h * 0.75, Math.min(w * 0.11, 0.15), darkWood);
  const y = d * 0.77;
  g.face(
    [
      [-w * 0.92, y, h * 0.71],
      [0, y, h * 0.96],
      [w * 0.92, y, h * 0.71],
    ],
    cane,
  );
  for (const f of [-0.52, -0.25, 0, 0.25, 0.52]) {
    const x = w * f;
    g.box(x - 0.025, x + 0.025, y, d * 0.79, h * 0.71, h * (0.96 - 0.275 * Math.abs(f)), wood);
  }
  g.box(-w * 0.91, w * 0.91, y * 0.95, y * 1.04, h * 0.68, h * 0.716, darkWood);
}

function vietnamese(g: HouseFront): void {
  const w = halfSpan(g, 3.2),
    d = Math.min(g.depth, 1.35),
    h = high(g, 2.72);
  const variant = g.seed % 3;
  if (variant === 1) hip(g, w, d, h, h * 0.79, g.cover, darkWood);
  else shed(g, w, d, h, h * 0.79, g.cover, darkWood);
  if (variant === 2) {
    for (const s of [-1, 1]) {
      const x = s * w * 0.85;
      g.beam([x, 0.09, h * 0.48], [x, d * 0.72, h * 0.83], Math.min(0.15, w * 0.1), wood);
      sideScreen(g, x, d * 0.55, 0.17, h * 0.5, wood, darkWood);
    }
  }
  const step = Math.min(0.2, h * 0.09);
  g.box(-w * 0.94, w * 0.94, 0, d * 0.95, 0, step * 0.52, 'city3d:wall:brick@ad7357');
  g.box(-w * 0.94, w * 0.94, 0, d * 0.78, step * 0.52, step, 'city3d:wall:brick@a2654b');
  const radius = Math.min(0.09, w * 0.045);
  const columns = variant === 2 ? [] : variant === 1 ? [-0.85, 0.85] : [-0.85, -0.42, 0.42, 0.85];
  for (const f of columns) {
    const x = w * f;
    g.post(x, d * 0.7, step, step + 0.12, radius * 1.4, stone, 5);
    g.post(x, d * 0.7, step + 0.12, h * 0.84, radius, darkWood, 6);
  }
  g.box(-w * 0.92, w * 0.92, d * 0.66, d * 0.75, h * 0.81, h * 0.86, wood);
}

function tibetan(g: HouseFront): void {
  const w = halfSpan(g, 1.6),
    d = Math.min(g.depth, 0.75),
    h = high(g, 2.68);
  const jamb = w * 0.64,
    size = Math.min(0.19, w * 0.14);
  // Limewashed outer returns and a deep, stepped timber head painted in bands.
  if (g.seed % 3 === 1) {
    // Corbelled flat awning leaves the two sides open.
    for (const s of [-1, 1]) {
      const x = s * w * 0.8;
      g.box(x - size, x + size, 0, d * 0.58, h * 0.61, h * 0.73, darkWood);
      g.box(x - size, x + size, 0, d * 0.85, h * 0.73, h * 0.84, wood);
    }
    g.box(-w, w, 0, d, h * 0.84, h * 0.94, stone);
    return;
  }
  if (g.seed % 3 === 2) {
    for (const s of [-1, 1]) {
      const x = s * w * 0.76;
      g.box(x - size, x + size, 0, d * 0.92, 0, h * 0.42, lime);
      g.box(x - size, x + size, 0, d * 0.59, h * 0.42, h * 0.77, lime);
    }
    g.box(-w * 0.92, w * 0.92, 0, d * 0.59, h * 0.77, h * 0.89, darkWood);
    return;
  }
  uprights(g, jamb * 1.16, d * 0.32, 0, h * 0.84, size * 1.65, lime);
  uprights(g, jamb, d * 0.55, 0, h * 0.81, size, darkWood);
  g.box(-w * 0.81, w * 0.81, 0, d * 0.72, h * 0.78, h * 0.86, darkWood);
  g.box(-w * 0.9, w * 0.9, 0, d * 0.83, h * 0.86, h * 0.915, red);
  g.box(-w, w, 0, d, h * 0.915, h * 0.975, stone);
  for (const f of [-0.66, -0.33, 0, 0.33, 0.66]) {
    const x = f * w;
    g.box(x - w * 0.046, x + w * 0.046, d * 0.65, d * 0.75, h * 0.79, h * 0.848, ochre);
  }
}

/** Folded cloth tapers to a tie at the front of the side flap. */
function tiedFlap(g: HouseFront, side: number, w: number, d: number, h: number, cloth: string): void {
  const p = (x: number, y: number, z: number): P => [side * x * w, y * d, z * h];
  const top = [p(0.62, 0.07, 0.91), p(0.96, 0.08, 0.92), p(0.9, 0.68, 0.5), p(0.79, 0.69, 0.49)];
  const lower = [p(0.79, 0.69, 0.49), p(0.9, 0.68, 0.5), p(0.98, 0.48, 0.085), p(0.75, 0.82, 0.05)];
  g.face(side > 0 ? top : top.reverse(), cloth);
  g.face(side > 0 ? lower : lower.reverse(), cloth);
  g.beam(p(0.82, 0.67, 0.49), p(0.96, 0.31, 0.46), Math.min(0.055, w * 0.055), wood);
}

function mongol(g: HouseFront): void {
  const w = halfSpan(g, 0.84),
    d = Math.min(g.depth, 0.34),
    h = high(g, 1.68);
  const painted = 'city3d:detail:paint@ad6941',
    yellow = 'city3d:detail:paint@d5ab62';
  uprights(g, w * 0.76, d * 0.55, 0, h * 0.9, w * 0.18, painted);
  g.box(-w, w, 0, d * 0.9, h * 0.88, h * 0.99, painted);
  g.box(-w * 0.85, w * 0.85, 0, d, 0, 0.07, wood);
  if (g.seed % 3 === 1) {
    // Felt folded over the head on a pole, with the thickness of its roll visible at each end.
    const r = Math.min(0.115, w * 0.12, h * 0.08),
      y = d * 0.6,
      z = h * 0.91;
    const ring = (x: number): P[] => Array.from({ length: 8 }, (_, i) => [x, y + r * Math.cos((i * Math.PI) / 4), z + r * Math.sin((i * Math.PI) / 4)]);
    const a = ring(-w * 0.91),
      b = ring(w * 0.91);
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8;
      g.face([a[i], a[j], b[j], b[i]], felt);
    }
    g.face([...a].reverse(), felt);
    g.face(b, felt);
    return;
  }
  if (g.seed % 3 === 2) {
    for (const side of [-1, 1]) tiedFlap(g, side, w, d, h, felt);
    return;
  }
  // The ger's existing door leaf sits inside this painted timber frame.
  for (const s of [-1, 1]) {
    const x = s * w * 0.76;
    for (const level of [0.22, 0.69]) {
      const z = level * h,
        r = w * 0.062,
        y = d * 0.55 + w * 0.095;
      g.face(
        [
          [x - r, y, z],
          [x, y, z + r * 1.65],
          [x + r, y, z],
          [x, y, z - r * 1.65],
        ],
        yellow,
      );
    }
  }
}

function nomad(g: HouseFront): void {
  const w = halfSpan(g, 1.1),
    d = Math.min(g.depth, 0.73),
    h = high(g, 1.75);
  // The felt door hanging is drawn to one side and tied; the thick rolled head shades the entrance.
  const variant = g.seed % 3;
  if (variant === 1) {
    // Felt shade stretched on two outside poles.
    const eave = h * 0.83;
    pan(
      g,
      [
        [-w * 0.76, 0, h],
        [w * 0.76, 0, h],
        [w * 0.93, d * 0.88, eave],
        [-w * 0.93, d * 0.88, eave],
      ],
      0.038,
      felt,
      hide,
    );
    for (const x of [-w * 0.88, w * 0.88]) g.post(x, d * 0.83, 0, eave, Math.min(0.045, w * 0.05), wood, 5);
    return;
  }
  if (variant === 2) {
    for (const side of [-1, 1]) tiedFlap(g, side, w, d, h, felt);
    g.beam([-w * 0.9, 0.04, h * 0.9], [w * 0.9, 0.04, h * 0.9], 0.065, wood);
    return;
  }
  const sign = g.seed & 1 ? -1 : 1;
  const flap: P[] = [
    [sign * w * 0.87, 0.035, h * 0.93],
    [sign * w * 0.49, d * 0.34, h * 0.9],
    [sign * w * 0.65, d * 0.49, h * 0.49],
    [sign * w * 0.73, d * 0.56, h * 0.045],
    [sign * w * 0.95, d * 0.35, h * 0.055],
  ];
  g.face(sign > 0 ? flap.reverse() : flap, felt);
  g.beam([sign * w * 0.79, 0.075, h * 0.93], [sign * w * 0.83, d * 0.45, h * 0.055], 0.07, felt);
  g.beam([-w * 0.85, d * 0.24, h * 0.9], [w * 0.85, d * 0.24, h * 0.9], Math.min(w * 0.15, 0.16), felt);
  for (const x of [-w * 0.66, w * 0.66]) {
    g.box(x - 0.024, x + 0.024, d * 0.24 - 0.09, d * 0.24 + 0.09, h * 0.9 - 0.09, h * 0.9 + 0.09, wood);
  }
  g.beam([sign * w * 0.69, d * 0.48, h * 0.48], [sign * w * 0.91, d * 0.24, h * 0.46], 0.046, darkWood);
}

function stiltTown(g: HouseFront): void {
  const w = halfSpan(g, 1.75),
    d = Math.min(g.depth, 2.2),
    h = high(g, 2.6);
  const z = landing(g, w * 0.84, d * 0.52, cane);
  // Paired bamboo rails and knee braces run along the landing, leaving its far end open to the stair.
  const radius = Math.min(0.07, w * 0.055);
  const eave = Math.min(h - 0.045, Math.max(h * 0.78, (g.doorHeight ?? 1.85) + 0.11));
  const support = Math.min(w * 0.92, Math.max(w * 0.77, (g.doorWidth ?? 0.95) / 2 + radius + 0.035));
  const variant = g.seed % 3;
  const soffit = (y: number) => (variant === 1 ? h + ((eave - h) * support) / w - 0.095 : h + ((eave - h) * y) / (d * 0.66) - 0.075);
  for (const x of [-support, support]) {
    g.post(x, d * 0.46, -g.floor, variant === 2 ? z + 0.8 : soffit(d * 0.46), radius, cane, 5);
    g.beam([x, 0.04, z + 0.73], [x, d * 0.46, z + 0.73], radius * 1.45, cane);
    g.beam([x, 0.06, z + 0.33], [x, d * 0.46, z + 0.33], radius, cane);
    if (variant === 2) sideScreen(g, x, d * 0.43, z + 0.1, z + 0.62, cane, cane);
    else g.beam([x, d * 0.46, soffit(d * 0.46) - 0.28], [x, d * 0.25, soffit(d * 0.25)], radius * 1.5, wood);
  }
  if (variant === 0) shed(g, w, d * 0.66, h, eave, palm, cane);
  if (variant === 1) gable(g, w, d * 0.66, h, eave, palm, cane);
}

function aztec(g: HouseFront): void {
  const w = halfSpan(g, 2.45),
    d = Math.min(g.depth, 1.45),
    h = high(g, 2.35);
  const step = Math.min(0.15, h * 0.07);
  // Low house platform and a plastered bench turning back along one side of the patio.
  g.box(-w, w, 0, d * 0.68, 0, step, basalt);
  g.box(-w * 0.96, w * 0.96, 0, d * 0.64, step, step * 1.35, lime);
  g.box(-w * 0.44, w * 0.44, d * 0.68, d, 0, step * 0.62, stone);
  if (g.seed % 3 === 1) {
    // Low plastered cheeks return into the patio and leave a gap opposite the entrance.
    for (const side of [-1, 1]) {
      const x = side * w * 0.81;
      g.box(x - w * 0.07, x + w * 0.07, 0, d * 0.6, step * 1.35, h * 0.39, ochre);
      g.box(x - w * 0.19, x + w * 0.07, d * 0.51, d * 0.62, step * 1.35, h * 0.39, ochre);
      g.box(x - w * 0.08, x + w * 0.08, 0, d * 0.63, h * 0.39, h * 0.42, lime);
    }
    return;
  }
  if (g.seed % 3 === 2) {
    shed(g, w, d * 0.71, h, h * 0.82, palm, cane);
    uprights(g, w * 0.78, d * 0.56, step * 1.35, h * 0.845, Math.min(0.13, w * 0.09), wood);
    return;
  }
  const seatX = (g.seed & 1 ? -1 : 1) * 0.73 * w;
  g.box(seatX - w * 0.18, seatX + w * 0.18, 0, d * 0.62, step * 1.35, h * 0.27, ochre);
  g.box(seatX - w * 0.2, seatX + w * 0.2, 0, d * 0.65, h * 0.27, h * 0.3, lime);
  const jamb = Math.min(w * 0.46, 0.84),
    width = Math.min(w * 0.15, 0.24);
  uprights(g, jamb, d * 0.16, step * 1.35, h * 0.89, width, ochre);
  g.box(-jamb - width, jamb + width, 0, d * 0.29, h * 0.87, h * 0.96, darkWood);
}

/** Constant-depth polygon, drawn with its profile facing the street. */
function masonry(g: HouseFront, profile: [number, number][], y0: number, y1: number, mat: string): void {
  const back: P[] = profile.map(([x, z]) => [x, y0, z]);
  const front: P[] = profile.map(([x, z]) => [x, y1, z]);
  g.face([...front].reverse(), mat);
  g.face(back, mat);
  for (let i = 0; i < profile.length; i++) {
    const j = (i + 1) % profile.length;
    g.face([back[j], back[i], front[i], front[j]], mat);
  }
}

function inca(g: HouseFront): void {
  const w = halfSpan(g, 1.65),
    d = Math.min(g.depth, 0.62),
    h = high(g, 2.5);
  // Each jamb converges toward the lintel. The horizontal joints break at different heights.
  const inner = Math.min(0.73, w * 0.58),
    outer = w * 0.93;
  const variant = g.seed % 3;
  if (variant === 1) {
    // A second, shallower trapezoid behind the doorway makes its reveal visible from the street.
    for (const side of [-1, 1]) {
      const a = side * w * 0.71,
        b = side * w * 0.99;
      const profile: [number, number][] = [
        [a, 0],
        [b, 0],
        [b * 0.9, h * 0.94],
        [a * 0.88, h * 0.94],
      ];
      masonry(g, side < 0 ? profile.reverse() : profile, 0, d * 0.33, stone);
    }
    g.box(-w * 0.91, w * 0.91, 0, d * 0.33, h * 0.94, h, stone);
  }
  if (variant === 2) {
    // Two battered wing walls step down towards the outer approach.
    for (const side of [-1, 1]) {
      const x = side * w * 0.8;
      g.box(x - w * 0.11, x + w * 0.11, d * 0.39, d * 0.94, 0, h * 0.29, g.wall);
      g.box(x - w * 0.1, x + w * 0.1, d * 0.39, d * 0.7, h * 0.29, h * 0.49, stone);
    }
  }
  const shades = [g.wall, stone, 'city3d:wall:stone@a39986'];
  for (const side of [-1, 1]) {
    const levels = side > 0 ? [0, 0.26, 0.56, 0.85] : [0, 0.32, 0.61, 0.85];
    const point = (x: number, t: number): [number, number] => [side * x * (1 - 0.2 * t), t * h];
    for (let i = 0; i < 3; i++) {
      const a = levels[i],
        b = levels[i + 1] - 0.005;
      const shape = [point(inner, a), point(outer, a), point(outer, b), point(inner, b)];
      masonry(g, side < 0 ? shape.reverse() : shape, 0, d * (variant === 2 ? 0.45 : 0.92 - 0.045 * i), shades[(i + (side + 1) / 2) % 3]);
    }
  }
  masonry(
    g,
    [
      [-w * 0.85, h * 0.85],
      [w * 0.85, h * 0.85],
      [w * 0.81, h * 0.98],
      [-w * 0.81, h],
    ],
    0,
    d,
    g.wall,
  );
  g.box(-inner * 1.12, inner * 1.12, 0, d, 0, 0.07, stone);
}

function maya(g: HouseFront): void {
  const w = halfSpan(g, 2.3),
    d = Math.min(g.depth, 1.3),
    h = high(g, 2.6);
  // The rounded ends of the raised house apron and continuous palm skirt echo an apsidal plan.
  const plan: [number, number][] = [
    [-w, 0],
    [w, 0],
    [w * 0.94, d * 0.47],
    [w * 0.73, d * 0.8],
    [-w * 0.73, d * 0.8],
    [-w * 0.94, d * 0.47],
  ];
  pan(
    g,
    plan.map(([x, y]) => [x, y, 0.17]),
    0.17,
    lime,
    stone,
  );
  const variant = g.seed % 3;
  if (variant) {
    if (variant === 1) {
      gable(g, w, d * 0.83, h, h * 0.72, palm, cane);
      uprights(g, w * 0.84, d * 0.63, 0.17, h * 0.765 - 0.09, 0.11, wood);
    } else {
      // One roofed end of the apron leaves an open work area beside the doorway.
      const x = w * 0.75;
      pan(
        g,
        [
          [w * 0.4, 0, h * 0.95],
          [w, 0, h * 0.95],
          [w * 0.92, d * 0.63, h * 0.66],
          [w * 0.43, d * 0.82, h * 0.66],
        ],
        0.12,
        palm,
        cane,
      );
      g.post(x, d * 0.67, 0.17, h * 0.67, Math.min(0.08, w * 0.07), wood, 5);
      sideScreen(g, w * 0.87, d * 0.5, 0.17, h * 0.52, cane);
    }
    g.box(-w * 0.33, w * 0.33, d * 0.8, d, 0, 0.085, stone);
    return;
  }
  const front: P[] = plan.slice(2).map(([x, y]) => [x, y * 1.22, h * 0.72]);
  const rear: P[] = front.map(([x]) => [x * 0.86, 0, h]);
  for (let i = 0; i < front.length - 1; i++) pan(g, [rear[i + 1], rear[i], front[i], front[i + 1]], 0.13, palm, cane);
  for (const x of [-w * 0.73, w * 0.73]) g.post(x, d * 0.72, 0.17, h * 0.76, Math.min(0.085, w * 0.06), wood, 5);
  g.box(-w * 0.33, w * 0.33, d * 0.8, d, 0, 0.085, stone);
}

function iroquoian(g: HouseFront): void {
  const w = halfSpan(g, 1.78),
    d = Math.min(g.depth, 1.7),
    h = high(g, 2.15);
  // The outer storage vestibule has a shallow bark roof and a windbreak at one side.
  shed(g, w, d, h, h * 0.94, bark, wood);
  const r = Math.min(0.085, w * 0.07);
  for (const x of [-w * 0.83, w * 0.83]) {
    g.post(x, d * 0.87, 0, h * 0.94 - 0.06, r, wood, 5);
    g.beam([x, 0.05, h - 0.11], [x, d * 0.93, h * 0.94 - 0.09], r * 1.7, cedar);
  }
  const variant = g.seed % 3;
  if (variant === 1) {
    for (const side of [-1, 1]) sideScreen(g, w * 0.82 * side, d * 0.87, 0, h * 0.92, bark, cedar);
    return;
  }
  if (variant === 2) {
    // Bark panels stop at a sheltered storage rack with three rails.
    const x = -w * 0.81;
    for (const z of [0.16, 0.42, 0.69]) g.box(x - w * 0.12, x + w * 0.12, 0, d * 0.7, h * z, h * (z + 0.04), cedar);
    sideScreen(g, x - w * 0.11, d * 0.72, 0, h * 0.75, bark);
    return;
  }
  const x = w * (g.seed & 1 ? 0.82 : -0.82);
  for (let i = 0; i < 3; i++) g.box(x - r * 0.3, x + r * 0.3, d * 0.29 * i, d * (0.29 * i + 0.28), 0.03, h * 0.86, bark);
  for (const z of [0.25, 0.7]) g.beam([x * 1.035, 0.04, h * z], [x * 1.035, d * 0.9, h * z], r * 0.8, cedar);
}

function pueblo(g: HouseFront): void {
  const w = halfSpan(g, 2.35),
    d = Math.min(g.depth, 1.55),
    h = high(g, 2.6);
  const side = g.seed & 1 ? -1 : 1,
    x = side * w * 0.7,
    rw = Math.min(w * 0.21, 0.45);
  // A smaller stepped volume supports an accessible flat work terrace and its pole ladder.
  if (g.seed % 3 === 1) {
    // An open ramada of poles and brush.
    shed(g, w, d * 0.9, h * 0.83, h * 0.8, cane, wood);
    uprights(g, w * 0.83, d * 0.75, 0, h * 0.8, Math.min(0.14, w * 0.1), wood);
    for (const k of [-0.8, -0.4, 0, 0.4, 0.8]) g.box((k - 0.03) * w, (k + 0.03) * w, 0, d * 0.96, h * 0.77, h * 0.81, wood);
    return;
  }
  if (g.seed % 3 === 2) {
    // A terraced work ledge with a staircase cut into its outer end.
    for (let i = 0; i < 4; i++) {
      g.box(x - rw, x + rw, 0, d * (0.95 - 0.19 * i), h * 0.12 * i, h * 0.12 * (i + 1), g.wall);
    }
    g.box(-x - rw, -x + rw, 0, d * 0.66, 0, h * 0.23, ochre);
    return;
  }
  const level = h * 0.66;
  g.box(x - rw, x + rw, 0, d * 0.47, 0, level, g.wall);
  g.box(x - rw * 1.06, x + rw * 1.06, 0, d * 0.49, level, level + 0.045, ochre);
  const rail = rw * 0.65;
  const at = (offset: number, t: number): P => [x + offset, d * (0.96 - t * 0.49), t * (level + 0.045)];
  for (const offset of [-rail, rail]) g.beam(at(offset, 0.055), at(offset, 1.25), Math.min(0.075, rw * 0.2), cedar);
  for (let i = 1; i < 6; i++) g.beam(at(-rail, i / 6), at(rail, i / 6), Math.min(0.055, rw * 0.15), darkWood);
  for (const f of [-0.8, -0.4, 0, 0.4, 0.8]) {
    const axis = f * w;
    g.beam([axis, 0.025, h * 0.91], [axis, d * 0.24, h * 0.91], 0.115, wood);
  }
}

function plains(g: HouseFront): void {
  const w = halfSpan(g, 1.22),
    d = Math.min(g.depth, 0.88),
    h = high(g, 1.72);
  if (g.seed % 3 === 1) {
    // Hide flap opened upward and held out on sticks.
    pan(
      g,
      [
        [-w * 0.46, 0, h * 0.88],
        [w * 0.46, 0, h * 0.88],
        [w * 0.73, d * 0.8, h * 0.66],
        [-w * 0.73, d * 0.8, h * 0.66],
      ],
      0.025,
      hide,
      hide,
    );
    for (const side of [-1, 1]) g.beam([side * w * 0.85, d * 0.83, 0.035], [side * w * 0.68, d * 0.76, h * 0.67], 0.045, wood);
    return;
  }
  if (g.seed % 3 === 2) {
    for (const side of [-1, 1]) {
      tiedFlap(g, side, w, d, h, hide);
      g.beam([side * w * 0.87, d * 0.55, 0.035], [side * w * 0.2, 0.035, h * 0.96], 0.045, wood);
    }
    return;
  }
  // The hide edges lean back towards the laced apex. The folded door flap hangs to one side.
  for (const sign of [-1, 1]) {
    const run: P[] = [
      [sign * w * 0.91, d * 0.5, 0.025],
      [sign * w * 0.65, d * 0.72, 0.025],
      [sign * w * 0.48, d * 0.42, h * 0.5],
      [sign * w * 0.12, d * 0.18, h * 0.77],
      [sign * w * 0.21, 0.04, h * 0.99],
    ];
    g.face(sign > 0 ? run : run.reverse(), hide);
    g.beam([sign * w * 0.66, d * 0.7, 0.06], [sign * w * 0.48, d * 0.42, h * 0.5], 0.035, wood);
    g.beam([sign * w * 0.48, d * 0.42, h * 0.5], [sign * w * 0.1, d * 0.18, h * 0.78], 0.035, wood);
  }
  const x = (g.seed & 1 ? -1 : 1) * w;
  g.face(
    [
      [x * 0.21, 0.055, h * 0.95],
      [x * 0.56, d * 0.49, h * 0.55],
      [x * 0.75, d * 0.64, h * 0.24],
      [x * 0.84, d * 0.37, h * 0.44],
    ],
    'city3d:cover:hide@a18460',
  );
  for (let i = 0; i < 3; i++) {
    const z = h * (0.8 + i * 0.065),
      y = d * (0.18 - 0.03 * i);
    g.beam([-w * 0.15, y, z], [w * 0.15, y, z + 0.015], 0.04, darkWood);
  }
}

function mississippian(g: HouseFront): void {
  const w = halfSpan(g, 1.8),
    d = Math.min(g.depth, 1.12),
    h = high(g, 2.38);
  // A rectangular, earth-plastered wall bay exposes a short panel of basket-like cane and its uprights.
  const variant = g.seed % 3;
  if (variant) {
    if (variant === 1) {
      gable(g, w, d, h, h * 0.73, g.cover, cane);
      uprights(g, w * 0.82, d * 0.8, 0, h * 0.778 - 0.09, 0.13, wood);
    } else {
      hip(g, w, d, h, h * 0.76, g.cover, cane);
      for (const s of [-1, 1]) {
        const x = s * w * 0.8;
        sideScreen(g, x, d * 0.75, 0, h * 0.49, ochre, cane);
        g.post(x, d * 0.75, h * 0.49, h * 0.79, Math.min(0.075, w * 0.07), wood, 5);
      }
    }
    return;
  }
  const x = (g.seed & 1 ? 1 : -1) * w * 0.76,
    half = w * 0.18;
  g.box(x - half, x + half, 0, d * 0.52, 0, h * 0.42, ochre);
  for (const f of [-0.85, 0, 0.85]) g.post(x + f * half, d * 0.43, h * 0.42, h * 0.79, Math.min(0.05, half * 0.14), wood, 5);
  for (let i = 0; i < 5; i++) {
    const z = (0.43 + i * 0.071) * h,
      y = d * (0.43 + (i % 2 ? -0.05 : 0.05));
    g.box(x - half, x + half, y - 0.026, y + 0.026, z, z + h * 0.042, cane);
  }
  const other = -Math.sign(x) * w * 0.74;
  g.post(other, d * 0.43, 0, h * 0.805, Math.min(0.09, w * 0.08), wood, 6);
  shed(g, w, d, h, h * 0.68, g.cover, cane);
}

function maori(g: HouseFront): void {
  const w = g.width / 2,
    d = Math.min(g.depth, 2.25),
    h = g.height - 0.05;
  // The selected gable supplies both heights. The new thatch slips just under the existing overhang.
  const eave = Math.min(h - 0.12, g.eave ?? h * 0.57);
  gable(g, w, d, h, eave, g.cover, cedar);
  const thickness = Math.min(0.19, w * 0.085);
  for (const sign of [-1, 1]) {
    const x = sign * (w - thickness * 0.6);
    // The porch can have full returns, one open side, or two open bays with low plank screens.
    // Keep the whole assembly in the original side-wall strip so an off-centre native door stays clear.
    const variant = g.seed % 3;
    const length = variant === 0 || (variant === 1 && sign < 0) ? 0.88 : variant === 1 ? 0.18 : 0.3;
    g.box(x - thickness / 2, x + thickness / 2, 0, d * length, 0, eave, g.wall);
    if (variant === 2) {
      g.box(x - thickness / 2, x + thickness / 2, d * length, d * 0.83, 0, eave * 0.32, cedar);
      g.box(x - thickness / 2, x + thickness / 2, d * length, d * 0.84, eave * 0.32, eave * 0.36, wood);
    }
    if (length < 0.88) g.box(x - thickness / 2, x + thickness / 2, d * length, d * 0.88, eave * 0.91, eave * 0.99, darkWood);
    g.box(x - thickness * 0.59, x + thickness * 0.59, d * 0.81, d * 0.91, 0, eave, cedar);
    const trim = Math.min(w * 0.09, h * 0.065, 0.18);
    g.beam([0, d * 0.9, h - trim * 0.7], [sign * (w - trim), d * 0.9, eave - trim * 0.55], trim, wood);
  }
  const ridge = Math.min(w * 0.1, 0.18);
  g.beam([0, 0.04, h - ridge * 0.65], [0, d * 0.98, h - ridge * 0.65], ridge, darkWood);
  if (g.hasGableDoor) return;
  const halfDoor = Math.min(w * 0.34, 0.46),
    head = Math.min(1.65, eave * 0.86);
  g.box(-halfDoor, halfDoor, 0.01, 0.04, 0.025, head, 'city3d:detail:door@4e3d31');
  const jamb = Math.min(w * 0.05, 0.1);
  uprights(g, halfDoor + jamb / 2, 0.085, 0, head + jamb, jamb, wood);
  g.box(-halfDoor - jamb * 1.6, halfDoor + jamb * 1.6, 0, 0.14, head, head + jamb, cedar);
}

function northwest(g: HouseFront): void {
  const w = halfSpan(g, 2.55),
    d = Math.min(g.depth, 0.92),
    h = high(g, 2.6);
  const variant = g.seed % 3;
  if (variant) {
    if (variant === 1) {
      // A framed plank vestibule turns the boarding through ninety degrees.
      shed(g, w, d, h, h * 0.8, 'city3d:cover:shingle@89735d', cedar);
      for (const side of [-1, 1]) {
        const x = side * w * 0.84;
        for (let i = 0; i < 4; i++) g.box(x - w * 0.035, x + w * 0.035, 0, d * 0.82, h * 0.19 * i, h * 0.19 * (i + 1) - 0.012, cedar);
        g.post(x, d * 0.82, 0, h * 0.83, Math.min(0.12, w * 0.07), darkWood, 6);
      }
    } else {
      gable(g, w, d, h, h * 0.74, 'city3d:cover:shingle@89735d', cedar);
      uprights(g, w * 0.83, d * 0.78, 0, h * 0.785 - 0.085, Math.min(0.2, w * 0.14), darkWood);
      g.beam([-w * 0.91, d * 0.77, h * 0.73], [w * 0.91, d * 0.77, h * 0.73], Math.min(0.14, w * 0.12), cedar);
    }
    return;
  }
  // Heavy cedar uprights retain overlapping split planks and carry the low plank eave.
  for (const side of [-1, 1]) {
    const a = side < 0 ? -w * 0.94 : w * 0.49,
      b = side < 0 ? -w * 0.49 : w * 0.94;
    for (let i = 0; i < 4; i++) {
      const z = h * (0.03 + i * 0.17),
        depth = d * (i % 2 ? 0.33 : 0.37);
      g.box(a, b, 0, depth, z, z + h * 0.166, (i + g.seed) % 3 ? cedar : wood);
    }
    const x = side * w * 0.86;
    g.post(x, d * 0.45, 0, h * 0.85, Math.min(0.145, w * 0.085), darkWood, 6);
  }
  g.beam([-w * 0.96, d * 0.44, h * 0.82], [w * 0.96, d * 0.44, h * 0.82], Math.min(w * 0.14, 0.23), cedar);
  shed(g, w, d, h, h * 0.715, 'city3d:cover:shingle@89735d', cedar);
}

function inuit(g: HouseFront): void {
  const w = halfSpan(g, 1.13),
    d = Math.min(g.depth, 1.65),
    h = high(g, 1.45);
  // Each vault block spans between two elliptical rings. The tunnel contracts towards the street.
  const variant = g.seed % 3;
  if (variant === 2) {
    // Stepped corbel courses shorten the span until snow slabs can bridge it.
    for (const side of [-1, 1]) {
      for (let j = 0; j < 3; j++) {
        const outer = side * w * (1 - 0.12 * j),
          inner = side * w * (0.73 - 0.14 * j);
        g.box(Math.min(inner, outer), Math.max(inner, outer), 0, d * (0.93 - 0.035 * j), h * 0.25 * j, h * 0.25 * (j + 1), snow);
      }
    }
    g.box(-w * 0.61, w * 0.61, 0, d * 0.85, h * 0.75, h * 0.89, snow);
    return;
  }
  const at = (angle: number, y: number, inside: boolean): P => {
    const taper = 1 - (0.11 * y) / d;
    // The outer half of the second tunnel turns away from the prevailing wind.
    const turn = variant === 1 ? Math.max(0, (2 * y) / d - 1) * 0.32 : 0;
    return [w * (turn - Math.cos(angle) * (taper - turn) * (inside ? 0.7 : 1)), y, Math.sin(angle) * h * taper * (inside ? 0.77 : 1)];
  };
  for (let course = 0; course < 2; course++) {
    const rear = course * d * 0.5,
      front = (course + 1) * d * 0.5;
    // Stagger the radial joints between rings.
    const segments = course === 0 ? 6 : 7;
    for (let j = 0; j < segments; j++) {
      const start = (Math.PI * j) / segments,
        end = (Math.PI * (j + 1)) / segments;
      const mat = (j + course + g.seed) % 4 ? snow : 'city3d:cover:snow@d7e1e3';
      g.face([at(start, rear, false), at(end, rear, false), at(end, front, false), at(start, front, false)], mat);
      g.face([at(start, front, true), at(end, front, true), at(end, rear, true), at(start, rear, true)], snowShade);
      if (course === 1) g.face([at(start, front, false), at(end, front, false), at(end, front, true), at(start, front, true)], mat);
    }
  }
}

function siberian(g: HouseFront): void {
  const w = halfSpan(g, 1.14),
    d = Math.min(g.depth, 0.82),
    h = high(g, 1.95);
  const skin = 'city3d:cover:hide@98806a',
    fold = 'city3d:cover:hide@ad9377';
  const variant = g.seed % 3;
  if (variant === 1) {
    // A windward hide hangs on an inclined support beside the entry.
    const a: P = [-w * 0.55, 0.035, h * 0.97],
      b: P = [-w * 0.94, d * 0.8, h * 0.56],
      c: P = [-w * 0.78, d * 0.9, 0.025];
    g.face([a, b, c, [-w * 0.8, 0.035, 0.025]], skin);
    g.face([a, [-w * 0.65, 0.035, h * 0.76], b], fold);
    g.beam([-w * 0.91, d * 0.82, 0.035], b, 0.055, cedar);
    g.beam(a, [-w * 0.8, 0.04, 0.035], 0.06, wood);
    return;
  }
  if (variant === 2) {
    // A lifted hide with a peaked ridge and pegged corners.
    const ridge = h * 0.97;
    for (const s of [-1, 1]) {
      const top: P[] = [
        [0, 0.03, ridge],
        [s * w * 0.6, 0.03, h * 0.69],
        [s * w * 0.93, d * 0.81, h * 0.55],
        [0, d * 0.48, h * 0.81],
      ];
      pan(g, s > 0 ? top : top.reverse(), 0.025, skin, fold);
      g.beam([s * w * 0.92, d * 0.84, 0.035], [s * w * 0.91, d * 0.8, h * 0.56], 0.045, cedar);
    }
    return;
  }
  // The chum has overlapping skins. Lifting the outer cover reveals a pitched opening between the poles.
  const side = g.seed & 1 ? -1 : 1;
  const p = (x: number, y: number, z: number): P => [side * w * x, d * y, h * z];
  const skinPanel = (points: P[], material: string) => g.face(side > 0 ? points : points.reverse(), material);
  skinPanel([p(-0.98, 0.46, 0.02), p(-0.66, 0.79, 0.025), p(-0.44, 0.43, 0.54), p(0.01, 0.14, 0.94), p(-0.24, 0.025, 0.95)], skin);
  skinPanel([p(-0.98, 0.46, 0.02), p(-0.24, 0.025, 0.95), p(-0.9, 0.035, 0.1)], fold);
  skinPanel([p(0.02, 0.12, 0.93), p(0.49, 0.86, 0.56), p(0.9, 0.75, 0.45), p(0.62, 0.18, 0.68)], fold);
  skinPanel([p(0.9, 0.75, 0.45), p(0.88, 0.38, 0.075), p(0.62, 0.18, 0.68)], skin);
  g.beam(p(-0.71, 0.74, 0.035), p(0.09, 0.11, 0.98), 0.06, darkWood);
  g.beam(p(0.77, 0.51, 0.035), p(-0.07, 0.11, 0.98), 0.065, wood);
  g.beam(p(0.9, 0.75, 0.025), p(0.9, 0.75, 0.46), 0.045, cedar);
}

function guarani(g: HouseFront): void {
  const w = halfSpan(g, 2.45),
    d = Math.min(g.depth, 1.55),
    h = high(g, 2.65);
  const variant = g.seed % 3;
  if (variant) {
    if (variant === 1) gable(g, w, d, h, h * 0.7, palm, cane);
    else {
      shed(g, w, d, h, h * 0.72, palm, cane);
      // A palm wing wraps the weather side, opposite the open work side.
      sideScreen(g, -w * 0.81, d * 0.76, 0, h * 0.69, palm, cane);
    }
    for (const side of [-1, 1]) {
      const x = side * w * 0.81,
        y = d * 0.79,
        r = Math.min(0.09, w * 0.07);
      const bearer = variant === 1 ? h * 0.755 - 0.092 : h * 0.78 - 0.07;
      g.post(x, y, 0, bearer - h * 0.1, r, wood, 5);
      for (const fork of [-1, 1]) g.beam([x, y, bearer - h * 0.12], [x + w * 0.065 * fork, y, bearer], r * 1.1, wood);
    }
    return;
  }
  // A low hipped palm roof folds around the opening in the long side of the house.
  const a: P = [-w * 0.49, 0, h],
    b: P = [w * 0.49, 0, h];
  const l: P = [-w, d * 0.51, h * 0.41],
    r: P = [w, d * 0.51, h * 0.41];
  const c: P = [-w * 0.66, d, h * 0.69],
    e: P = [w * 0.66, d, h * 0.69];
  pan(g, [a, b, e, c], 0.13, palm, cane);
  pan(g, [b, r, e], 0.13, palm, cane);
  pan(g, [a, c, l], 0.13, palm, cane);
  for (const sign of [-1, 1]) {
    const x = sign * w * 0.65,
      y = d * 0.87;
    const radius = Math.min(w * 0.07, 0.095);
    g.post(x, y, 0, h * 0.59, radius, wood, 5);
    for (const fork of [-1, 1]) g.beam([x, y, h * 0.56], [x + fork * radius * 1.9, y, h * 0.69], radius * 1.18, wood);
  }
  g.beam([-w * 0.74, d * 0.87, h * 0.69], [w * 0.74, d * 0.87, h * 0.69], 0.125, cedar);
}

function budjBim(g: HouseFront): void {
  const w = halfSpan(g, 1.75),
    d = Math.min(g.depth, 0.95),
    h = high(g, 1.35);
  // Dry-laid basalt courses turn back to the circular hut wall. Stagger the joints in adjacent courses.
  const rocks = [basalt, 'city3d:wall:stone@706a5e', 'city3d:wall:stone@575754', 'city3d:wall:stone@80796a'];
  const variant = g.seed % 3;
  for (const side of [-1, 1]) {
    const position = (t: number, offset: number, z: number): P => {
      if (variant === 1) {
        // A straight screen on the weather side makes a right-angled return towards the doorway.
        const turn = Math.max(0, (t - 0.64) / 0.36);
        const x = 0.84 + 0.12 * offset - 0.24 * turn;
        return [side * w * x, d * (0.075 + Math.min(t, 0.64) * 1.12 + turn * 0.085), z];
      }
      if (variant === 2) {
        // A long, flared passage between the outer stone jambs.
        const x = 0.52 + 0.31 * t + 0.105 * offset;
        return [side * w * x, d * (0.055 + 0.86 * t), z];
      }
      const angle = 0.07 + t * 1.05;
      return [side * w * (0.46 + (0.43 + offset * 0.12) * Math.cos(angle)), d * (0.05 + (0.71 + offset * 0.17) * Math.sin(angle)), z];
    };
    const courses = variant === 1 && side === 1 ? 1 : variant === 2 ? 4 : 3;
    for (let level = 0; level < courses; level++) {
      const ends = level === 1 ? [0, 0.26, 0.7, 1] : [0, 0.48, 1];
      for (let i = 0; i < ends.length - 1; i++) {
        const a = ends[i] + 0.008,
          b = ends[i + 1] - 0.008;
        const base = h * 0.19 * level;
        const crown = base + h * (0.193 + 0.012 * ((i + level + g.seed) % 3));
        const top = [position(a, -0.91, crown), position(a + 0.018, 0.96, crown - 0.025), position(b - 0.018, 0.94, crown), position(b, -0.91, crown - 0.02)];
        const tint = rocks[(g.seed + i + level * 3 + (side + 1)) % rocks.length];
        // With side=+1 the inner,outer,outer,inner winding follows the arc counter-clockwise.
        pan(g, side > 0 ? top : top.reverse(), crown - base, tint, tint, base);
      }
    }
  }
}

export const vernacularFronts: Record<string, (g: HouseFront) => void> = {
  chinese,
  'japanese-jokamachi': japanese,
  korean,
  khmer,
  'himalayan-terraces': himalayan,
  newar,
  'javanese-courts': javanese,
  bagan,
  'vietnamese-citadel': vietnamese,
  'tibetan-monastery': tibetan,
  'mongol-ordu': mongol,
  'nomad-camp': nomad,
  'stilt-town': stiltTown,
  aztec,
  inca,
  maya,
  'native-iroquoian': iroquoian,
  'native-pueblo': pueblo,
  'native-plains': plains,
  mississippian,
  'maori-pa': maori,
  'pnw-plank-village': northwest,
  'inuit-camp': inuit,
  'siberian-camp': siberian,
  'guarani-village': guarani,
  'budj-bim': budjBim,
};
