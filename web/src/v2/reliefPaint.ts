/** Metre-valued paint operations. Only the preview is quantized to eight bits. */
export type HeightBrush = 'raise' | 'lower' | 'level' | 'smooth' | 'restore';
export interface PaintBrush { radius: number; softness: number; strength: number; target: number }
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
function visit(n: number, u: number, v: number, brush: PaintBrush, paint: (i: number, x: number, y: number, alpha: number) => void): void {
  const radius = Math.max(.75 / n, brush.radius), soft = Math.max(.01, brush.softness);
  for (let y = Math.max(0, Math.ceil((v - radius) * n - .5)); y <= Math.min(n - 1, Math.floor((v + radius) * n - .5)); y++) {
    for (let x = Math.max(0, Math.ceil((u - radius) * n - .5)); x <= Math.min(n - 1, Math.floor((u + radius) * n - .5)); x++) {
      const distance = Math.hypot((x + .5) / n - u, (y + .5) / n - v) / radius;
      if (distance >= 1) continue;
      const t = clamp((1 - distance) / soft, 0, 1);
      paint(y * n + x, x, y, t * t * (3 - 2 * t));
    }
  }
}
export function paintHeight(values: Float32Array, original: Float32Array, n: number, u: number, v: number, brush: PaintBrush, tool: HeightBrush): void {
  // Smoothing reads a frozen local neighbourhood, so traversal order cannot bias the slope.
  const x0 = Math.max(0, Math.floor((u - brush.radius) * n) - 1), y0 = Math.max(0, Math.floor((v - brush.radius) * n) - 1);
  const x1 = Math.min(n - 1, Math.ceil((u + brush.radius) * n) + 1), y1 = Math.min(n - 1, Math.ceil((v + brush.radius) * n) + 1);
  const width = Math.max(0, x1 - x0 + 1), snapshot = tool === 'smooth' ? new Float32Array(width * Math.max(0, y1 - y0 + 1)) : undefined;
  if (snapshot) for (let y = y0; y <= y1; y++) snapshot.set(values.subarray(y * n + x0, y * n + x1 + 1), (y - y0) * width);
  visit(n, u, v, brush, (i, x, y, alpha) => {
    let next = values[i];
    if (tool === 'raise' || tool === 'lower') next += (tool === 'raise' ? 1 : -1) * brush.strength * alpha;
    else {
      let target = tool === 'restore' ? original[i] : brush.target;
      if (snapshot) {
        target = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) target += snapshot[(clamp(y + dy, y0, y1) - y0) * width + clamp(x + dx, x0, x1) - x0] / 9;
      }
      next += (target - next) * alpha * (tool === 'smooth' ? .5 : 1);
    }
    values[i] = clamp(next, -12000, 12000);
  });
}
export function paintZone(weights: Uint8Array, n: number, u: number, v: number, brush: PaintBrush, zone: number): void {
  visit(n, u, v, brush, (i, _x, _y, alpha) => {
    let total = 0;
    for (let k = 0; k < 5; k++) { const at = i * 5 + k; weights[at] = Math.floor(weights[at] * (1 - alpha)); total += weights[at]; }
    if (zone >= 0 && zone < 5) weights[i * 5 + zone] += Math.min(255 - total, Math.round(255 * alpha));
  });
}
/** Square crop and vertical transforms preserve cell-centred sampling. */
export function transformHeight(values: Float32Array, n: number, scale: number, datum: number, crop: number): Float32Array {
  const out = new Float32Array(values.length), fraction = clamp(crop / 100, .25, 1), offset = (1 - fraction) / 2;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const sx = clamp((offset + (x + .5) / n * fraction) * n - .5, 0, n - 1), sy = clamp((offset + (y + .5) / n * fraction) * n - .5, 0, n - 1);
    const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
    const a = values[iy * n + ix] * (1 - fx) + values[iy * n + Math.min(n - 1, ix + 1)] * fx;
    const b = values[Math.min(n - 1, iy + 1) * n + ix] * (1 - fx) + values[Math.min(n - 1, iy + 1) * n + Math.min(n - 1, ix + 1)] * fx;
    out[y * n + x] = clamp(((1 - fy) * a + fy * b - datum) * scale, -12000, 12000);
  }
  return out;
}
export function grayscaleHeight(values: ArrayLike<number>, n: number, min: number, max: number, size: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(size * size * 4), range = Math.max(1, max - min);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const h = values[Math.min(n - 1, Math.floor((y + .5) * n / size)) * n + Math.min(n - 1, Math.floor((x + .5) * n / size))];
    const at = (y * size + x) * 4, gray = Math.round(clamp((h - min) / range, 0, 1) * 255);
    pixels[at] = pixels[at + 1] = pixels[at + 2] = gray; pixels[at + 3] = 255;
  }
  return pixels;
}
