import type { TerrainZones } from '../../../rust/bridge/terrainZones';

export const SYMBOLIC_RESOLUTION = 128;
export const ZONE_COLORS = [
  [38, 137, 222],
  [183, 215, 147],
  [131, 147, 67],
  [151, 105, 68],
  [229, 231, 223],
] as const;

/** Execution-only partition: unpainted shares are plain; recipes keep the raw painting. */
export function filledSymbolicZones(zones: TerrainZones): TerrainZones {
  const weights = [...zones.weights];
  for (let i = 0; i < weights.length; i += 5) {
    const total = weights[i] + weights[i + 1] + weights[i + 2] + weights[i + 3] + weights[i + 4];
    weights[i + 1] += 255 - total;
  }
  return { ...zones, weights };
}

/** Cell-centred bilinear sampling shared by the editor and the coast field. */
export function sampleZone(zones: TerrainZones, u: number, v: number, channel: number): number {
  const n = zones.resolution,
    x = Math.max(0, Math.min(n - 1, u * n - 0.5)),
    y = Math.max(0, Math.min(n - 1, v * n - 0.5));
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    x1 = Math.min(n - 1, x0 + 1),
    y1 = Math.min(n - 1, y0 + 1),
    tx = x - x0,
    ty = y - y0;
  const at = (a: number, b: number) => zones.weights[(b * n + a) * 5 + channel];
  return (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) + (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty;
}

export function resampleZones(zones?: TerrainZones): Uint8Array {
  const n = SYMBOLIC_RESOLUTION,
    weights = new Uint8Array(n * n * 5);
  if (zones?.resolution === n) return Uint8Array.from(zones.weights);
  if (zones) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) for (let k = 0; k < 5; k++) weights[(y * n + x) * 5 + k] = Math.floor(sampleZone(zones, (x + 0.5) / n, (y + 0.5) / n, k));
  return weights;
}

/** Blend toward a single instruction (or automatic), preserving sum <= 255. */
export function paintZones(weights: Uint8Array, u: number, v: number, radius: number, softness: number, strength: number, channel: number): void {
  const n = SYMBOLIC_RESOLUTION;
  for (let y = Math.max(0, Math.floor((v - radius) * n)); y < Math.min(n, Math.ceil((v + radius) * n)); y++)
    for (let x = Math.max(0, Math.floor((u - radius) * n)); x < Math.min(n, Math.ceil((u + radius) * n)); x++) {
      const d = Math.hypot((x + 0.5) / n - u, (y + 0.5) / n - v) / radius;
      if (d >= 1) continue;
      const edge = Math.max(0, Math.min(1, (1 - d) / Math.max(0.001, softness))),
        a = Math.max(0, Math.min(1, strength)) * edge * edge * (3 - 2 * edge);
      const offset = (y * n + x) * 5;
      for (let k = 0; k < 5; k++) weights[offset + k] = Math.floor(weights[offset + k] * (1 - a) + (k === channel ? 255 * a : 0));
    }
}
