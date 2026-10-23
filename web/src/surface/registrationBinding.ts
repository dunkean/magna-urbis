import type { Bounds, TerrainGrid } from './model';

export interface RegistrationField { width: number; n: number; data: Float32Array }
export interface SurfaceRegistrationBinding {
  expectedSourceId: string; providerId: string; registrationId: string; sourceVersion: string;
  fieldFingerprint: string; width: number; n: number;
  interpolation: 'cell-centred-cubic-bspline-controls';
  canonicalFieldFingerprint: string; canonicalWidth: number; canonicalN: number;
  canonicalDerivation: 'identity' | 'bilinear-control-grid-at-centres';
}
export interface RefinementParentComparison {
  samples: number; parentCorrelation: number | null; transposedParentCorrelation: number | null;
  maxAbsDeltaM: number; rmsDeltaM: number; meanDeltaM: number;
  controlSmoothingMaxAbsM: number; refinementResidualMaxAbsM: number;
}
export function validateRegistrationField(field: RegistrationField): void {
  if (!Number.isInteger(field.n) || field.n < 2 || field.n > 4096 || !Number.isFinite(field.width) || field.width <= 0
    || !(field.data instanceof Float32Array) || field.data.length !== field.n ** 2 || field.data.some(v => !Number.isFinite(v))) throw new Error('Invalid finite registration field');
}

/** Four independent byte-hash lanes. Includes exact Float32 view bytes and physical shape, never decimal JSON arrays. */
export function registrationFieldFingerprint(field: RegistrationField): string {
  validateRegistrationField(field);
  const lanes = [2166136261, 2246822519, 3266489917, 668265263];
  const feed = (byte: number) => {
    lanes[0] = Math.imul(lanes[0] ^ byte, 16777619);
    lanes[1] = Math.imul(lanes[1] ^ byte, 2246822519);
    lanes[2] = Math.imul(lanes[2] ^ byte, 3266489917);
    lanes[3] = Math.imul(lanes[3] ^ byte, 668265263);
  };
  const shape = new ArrayBuffer(12), view = new DataView(shape); view.setFloat64(0, field.width, true); view.setUint32(8, field.n, true);
  for (const byte of new Uint8Array(shape)) feed(byte);
  for (const byte of new Uint8Array(field.data.buffer, field.data.byteOffset, field.data.byteLength)) feed(byte);
  return 'rf1-' + lanes.map(v => (v >>> 0).toString(16).padStart(8, '0')).join('');
}

export function sampleRegistrationBilinear(field: RegistrationField, x: number, z: number): number {
  const gx = Math.max(0, Math.min(field.n - 1, x / field.width * field.n - .5)), gz = Math.max(0, Math.min(field.n - 1, z / field.width * field.n - .5));
  const ix = Math.floor(gx), iz = Math.floor(gz), dx = gx - ix, dz = gz - iz;
  const right = Math.min(field.n - 1, ix + 1), bottom = Math.min(field.n - 1, iz + 1);
  return (field.data[iz * field.n + ix] * (1 - dx) + field.data[iz * field.n + right] * dx) * (1 - dz)
    + (field.data[bottom * field.n + ix] * (1 - dx) + field.data[bottom * field.n + right] * dx) * dz;
}
export function sampleRegistrationBSpline(field: RegistrationField, x: number, z: number): number {
  const axis = (coordinate: number) => {
    const g = coordinate * field.n / field.width - .5, start = Math.floor(g), t = g - start;
    const weights = [(1 - t) ** 3 / 6, (3 * t ** 3 - 6 * t * t + 4) / 6, (-3 * t ** 3 + 3 * t * t + 3 * t + 1) / 6, t ** 3 / 6];
    return weights.map((weight, k) => ({ index: Math.max(0, Math.min(field.n - 1, start + k - 1)), weight }));
  };
  let result = 0;
  for (const row of axis(z)) { let line = 0; for (const col of axis(x)) line += field.data[row.index * field.n + col.index] * col.weight; result += line * row.weight; }
  return result;
}

/** A canonical capture may be a documented centre-sampled reduction, never an unrelated or transposed field. */
export function assertCanonicalRegistrationField(registered: RegistrationField, canonical: RegistrationField): { fingerprint: string; derivation: SurfaceRegistrationBinding['canonicalDerivation'] } {
  validateRegistrationField(canonical);
  if (canonical.width !== registered.width) throw new Error('Canonical capture width differs from the registered retained source');
  const fingerprint = registrationFieldFingerprint(canonical);
  if (canonical.n === registered.n) {
    if (fingerprint !== registrationFieldFingerprint(registered)) throw new Error('Canonical capture does not match the exact registered field');
    return { fingerprint, derivation: 'identity' };
  }
  const expected = new Float32Array(canonical.n ** 2), cell = canonical.width / canonical.n;
  for (let z = 0; z < canonical.n; z++) for (let x = 0; x < canonical.n; x++) expected[z * canonical.n + x] = sampleRegistrationBilinear(registered, (x + .5) * cell, (z + .5) * cell);
  if (fingerprint !== registrationFieldFingerprint({ ...canonical, data: expected })) throw new Error('Canonical capture is not the documented centre-sampled registered field');
  return { fingerprint, derivation: 'bilinear-control-grid-at-centres' };
}

/** Cell footprints must match the requested region; half-cell shifts/transposition cannot hide behind a one-cell tolerance. */
export function assertRefinementTerrainRegion(terrain: TerrainGrid, bounds: Bounds): void {
  if (!Number.isInteger(terrain.width) || !Number.isInteger(terrain.height) || terrain.width < 2 || terrain.height < 2 || terrain.heights.length !== terrain.width * terrain.height
    || !Number.isFinite(terrain.spacingM) || terrain.spacingM <= 0 || ![terrain.originX, terrain.originZ].every(Number.isFinite)) throw new Error('Invalid refinement terrain grid');
  const half = terrain.spacingM / 2, actual = { minX: terrain.originX - half, minZ: terrain.originZ - half,
    maxX: terrain.originX + (terrain.width - .5) * terrain.spacingM, maxZ: terrain.originZ + (terrain.height - .5) * terrain.spacingM };
  const tolerance = Math.max(1, Math.abs(bounds.maxX - bounds.minX), Math.abs(bounds.maxZ - bounds.minZ)) * 1e-8;
  for (const key of ['minX', 'minZ', 'maxX', 'maxZ'] as const) if (!Number.isFinite(bounds[key]) || Math.abs(actual[key] - bounds[key]) > tolerance) throw new Error('Refinement terrain cell footprint differs from requested region');
}

/** Quantifies the intentionally smoothed control-grid parent separately from decoder/procedural residuals. */
export function compareRefinementParent(field: RegistrationField, terrain: TerrainGrid): RefinementParentComparison {
  let count = 0, sy = 0, sp = 0, st = 0, sy2 = 0, sp2 = 0, st2 = 0, syp = 0, syt = 0, max = 0, square = 0, delta = 0, smoothing = 0, residual = 0;
  // Diagnostics are bounded independently of a 1024² delivery. All sampled coordinates are exact source centres.
  const stride = Math.max(1, Math.ceil(Math.sqrt(terrain.heights.length / 4096)));
  for (let z = 0; z < terrain.height; z += stride) for (let x = 0; x < terrain.width; x += stride) {
    const px = terrain.originX + x * terrain.spacingM, pz = terrain.originZ + z * terrain.spacingM;
    const value = terrain.heights[z * terrain.width + x], parent = sampleRegistrationBilinear(field, px, pz), transposed = sampleRegistrationBilinear(field, pz, px), cubic = sampleRegistrationBSpline(field, px, pz), d = value - parent;
    count++; sy += value; sp += parent; st += transposed; sy2 += value * value; sp2 += parent * parent; st2 += transposed * transposed; syp += value * parent; syt += value * transposed;
    max = Math.max(max, Math.abs(d)); square += d * d; delta += d; smoothing = Math.max(smoothing, Math.abs(cubic - parent)); residual = Math.max(residual, Math.abs(value - cubic));
  }
  const correlation = (sx: number, sx2: number, sxy: number) => {
    const denominator = Math.sqrt(Math.max(0, count * sy2 - sy * sy) * Math.max(0, count * sx2 - sx * sx));
    return denominator > 1e-10 ? Math.max(-1, Math.min(1, (count * sxy - sx * sy) / denominator)) : null;
  };
  return { samples: count, parentCorrelation: correlation(sp, sp2, syp), transposedParentCorrelation: correlation(st, st2, syt),
    maxAbsDeltaM: max, rmsDeltaM: Math.sqrt(square / count), meanDeltaM: delta / count, controlSmoothingMaxAbsM: smoothing, refinementResidualMaxAbsM: residual };
}
