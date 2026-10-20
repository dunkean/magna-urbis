/** Retained raster sampler shared by terrain and settlement painting.
 * Bilinear samples avoid cell-shaped stands; prominence keeps valley floors wooded. */
export function paintingRelief(height: Float32Array, n: number, width: number, radius: number): (x: number, y: number) => { height: number; slope: number; tpi: number; relief: number } {
  const cell = width / n;
  const at = (x: number, y: number, field = height): number => {
    const u = Math.max(0, Math.min(n - 1, x / cell - .5)), v = Math.max(0, Math.min(n - 1, y / cell - .5));
    const ix = Math.floor(u), iy = Math.floor(v), jx = Math.min(n - 1, ix + 1), jy = Math.min(n - 1, iy + 1);
    const fx = u - ix, fy = v - iy;
    return (field[iy * n + ix] * (1 - fx) + field[iy * n + jx] * fx) * (1 - fy)
      + (field[jy * n + ix] * (1 - fx) + field[jy * n + jx] * fx) * fy;
  };
  // The regional fields are prepared once, not eight terrain reads per tree.
  const tpi = new Float32Array(n * n), relief = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const px = (x + .5) * cell, py = (y + .5) * cell, h = height[y * n + x];
    let sum = 0, lo = h, hi = h;
    for (let d = 0; d < 8; d++) {
      const a = d * Math.PI / 4, v = at(px + Math.cos(a) * radius, py + Math.sin(a) * radius);
      sum += v; lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    tpi[y * n + x] = (h - sum / 8) / radius; relief[y * n + x] = hi - lo;
  }
  return (x, y) => {
    return { height: at(x, y), slope: Math.hypot(at(x + cell, y) - at(x - cell, y), at(x, y + cell) - at(x, y - cell)) / (2 * cell), tpi: at(x, y, tpi), relief: at(x, y, relief) };
  };
}
