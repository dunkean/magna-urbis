// CPU port of forestBeachCoverage (terrainRenderV2.ts GLSL), baked once per terrain into a
// world-space grid. Mirrors level(0) of web/src/ui/terrainGl.ts and surfaceRootBeach/surfaceFbm/
// surfaceNoise/surfaceHash of terrainMaterial.ts. Keep in sync; see web/scripts/forest_beach_parity.mjs.

export interface ForestBeachLayer { x: number; y: number; width: number; n: number; data: Float32Array }
export interface ForestBeachGrid { x: number; y: number; width: number; n: number; data: Uint8Array }

const sstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Uniform cubic B-spline weights and derivative weights (terrainGl.ts bw/bd), written into w/d.
const wx = new Float64Array(4), wy = new Float64Array(4), dx = new Float64Array(4), dy = new Float64Array(4);
function weights(t: number, w: Float64Array, d: Float64Array): void {
  const t2 = t * t, t3 = t2 * t, u = 1 - t;
  w[0] = u * u * u / 6; w[1] = (3 * t3 - 6 * t2 + 4) / 6; w[2] = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6; w[3] = t3 / 6;
  d[0] = -.5 * u * u; d[1] = 1.5 * t2 - 2 * t; d[2] = -1.5 * t2 + t + .5; d[3] = .5 * t2;
}

/** Height, dh/dx, dh/dy of the base layer at world (level(0, world)). */
let sh = 0, sgx = 0, sgy = 0;
function surface(layer: ForestBeachLayer, cell: number, wxm: number, wym: number): void {
  const n = layer.n, data = layer.data;
  const gx0 = (wxm - layer.x) / cell - .5, gy0 = (wym - layer.y) / cell - .5;
  const fx = Math.floor(gx0), fy = Math.floor(gy0);
  weights(gx0 - fx, wx, dx); weights(gy0 - fy, wy, dy);
  const bx = fx - 1, by = fy - 1, last = n - 1;
  let h = 0, gx = 0, gy = 0;
  for (let j = 0; j < 4; j++) {
    let row = by + j; row = row < 0 ? 0 : row > last ? last : row;
    const o = row * n;
    let r = 0, rd = 0;
    for (let i = 0; i < 4; i++) {
      let col = bx + i; col = col < 0 ? 0 : col > last ? last : col;
      const v = data[o + col];
      r += v * wx[i]; rd += v * dx[i];
    }
    h += r * wy[j]; gx += rd * wy[j]; gy += r * dy[j];
  }
  sh = h; sgx = gx / cell; sgy = gy / cell;
}

function hash(cx: number, cy: number, cz: number, salt: number): number {
  let h = (Math.imul(cx, 0x9e3779b9) ^ Math.imul(cy, 0x85ebca6b) ^ Math.imul(cz, 0xc2b2ae35) ^ salt) >>> 0;
  h = Math.imul((h ^ (h >>> 16)) >>> 0, 0x7feb352d) >>> 0;
  h = Math.imul((h ^ (h >>> 15)) >>> 0, 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function corner(cx: number, cy: number, cz: number, fx: number, fy: number, fz: number, ox: number, oy: number, oz: number, salt: number): number {
  const h = hash(cx + ox, cy + oy, cz + oz, salt);
  return ((h & 1023) / 511.5 - 1) * (fx - ox) + (((h >>> 10) & 1023) / 511.5 - 1) * (fy - oy) + (((h >>> 20) & 1023) / 511.5 - 1) * (fz - oz);
}

function noise(px: number, py: number, pz: number, salt: number): number {
  const flx = Math.floor(px), fly = Math.floor(py), flz = Math.floor(pz);
  const fx = px - flx, fy = py - fly, fz = pz - flz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10), uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a0 = corner(flx, fly, flz, fx, fy, fz, 0, 0, 0, salt), a1 = corner(flx, fly, flz, fx, fy, fz, 1, 0, 0, salt);
  const a2 = corner(flx, fly, flz, fx, fy, fz, 0, 1, 0, salt), a3 = corner(flx, fly, flz, fx, fy, fz, 1, 1, 0, salt);
  const b0 = corner(flx, fly, flz, fx, fy, fz, 0, 0, 1, salt), b1 = corner(flx, fly, flz, fx, fy, fz, 1, 0, 1, salt);
  const b2 = corner(flx, fly, flz, fx, fy, fz, 0, 1, 1, salt), b3 = corner(flx, fly, flz, fx, fy, fz, 1, 1, 1, salt);
  const x0 = a0 + (a1 - a0) * ux, x1 = a2 + (a3 - a2) * ux, x2 = b0 + (b1 - b0) * ux, x3 = b2 + (b3 - b2) * ux;
  const y0 = x0 + (x1 - x0) * uy, y1 = x2 + (x3 - x2) * uy;
  return (y0 + (y1 - y0) * uz) * 5.25;
}

// surfaceFbm at z=0; returns value * sqrt(retained variance fraction) (the only form the beach uses).
function fbm(x: number, y: number, scale: number, octaves: number, footprint: number, salt: number): number {
  let value = 0, kept = 0, total = 0, s = scale, a = 1;
  for (let i = 0; i < octaves; i++) {
    total += a * a;
    if (footprint < s * .25) {
      const fade = 1 - sstep(s * .125, s * .25, footprint);
      value += a * fade * noise(x / s, y / s, 0, (salt + Math.imul(i, 0x9e37)) >>> 0);
      kept += a * fade * a * fade;
    }
    a *= .5; s *= .5;
  }
  if (kept > 0) value /= Math.sqrt(kept);
  return value * Math.sqrt(kept / total);
}

const FP = 30;
const DIRS = Array.from({ length: 12 }, (_, i) => [Math.cos(i * .523598776), Math.sin(i * .523598776)] as const);

/** forestBeachCoverage(world) in 0..1. */
export function forestBeachCoverageAt(layer: ForestBeachLayer, seed: number, wxm: number, wym: number): number {
  const cell = layer.width / layer.n;
  surface(layer, cell, wxm, wym);
  const h = sh, gx = sgx, gy = sgy, slope = Math.hypot(gx, gy);
  if (h < 0 || h >= 12 || slope >= .5) return 0;
  const r = Math.max(300, 2 * cell);
  let shore = Math.max(h, 0) / Math.max(slope, .0001), openness = 0;
  for (let i = 0; i < 12; i++) {
    const d = DIRS[i];
    surface(layer, cell, wxm + d[0] * r, wym + d[1] * r);
    if (sh < 0) { shore = Math.min(shore, r); openness += 1 / 12; }
    surface(layer, cell, wxm + d[0] * r * .5, wym + d[1] * r * .5);
    if (sh < 0) shore = Math.min(shore, r * .5);
  }
  if (openness <= .15) return 0;
  // surfaceRootBeach
  const s = seed >>> 0;
  const reach = fbm(wxm, wym, 20000, 3, FP, s + 7), grove = fbm(wxm, wym, 4800, 4, FP, s + 3), fine = fbm(wxm, wym, 240, 4, FP, s + 5);
  // surfaceBeachWidth multiplies by sqrt(variance) already folded into the fbm values above
  const width = 140 * sstep(-.15, .75, .65 * reach + .5 * grove) * sstep(.15, .4, openness) * (1 + .35 * fine);
  return Math.min(1, Math.max(0, (Math.min(width, 20 * FP) - shore + FP) / FP)) * (1 - sstep(4, 12, h)) * (1 - sstep(.2, .5, slope));
}

/** Bakes forestBeachCoverage on a resolution x resolution grid of texel centres (row j = increasing world y). */
export function forestBeachGrid(layer: ForestBeachLayer, seed: number, resolution: number): ForestBeachGrid {
  const data = new Uint8Array(resolution * resolution), c = layer.width / resolution;
  for (let j = 0; j < resolution; j++) {
    const wy0 = layer.y + (j + .5) * c;
    for (let i = 0; i < resolution; i++) data[j * resolution + i] = Math.round(forestBeachCoverageAt(layer, seed, layer.x + (i + .5) * c, wy0) * 255);
  }
  return { x: layer.x, y: layer.y, width: layer.width, n: resolution, data };
}
