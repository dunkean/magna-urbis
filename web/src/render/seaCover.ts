/** Sea cover of the 3D water layer, shared by the V2 and City Bench (CLAUDE.md: one shared choice).
 *
 * One coastline: the town engine treats a point as sea where the cubic B-spline of the physical height field is at or
 * below 0 m next to the sea (urban `Surface::wet`), and the 2D map draws its coast at the same zero level (ui/terrainGl.ts
 * land cover; refinement never moves that line). The 3D water layer used to flag each grid point whose control value is
 * <= 0 and spread that flag over the whole cell, so the 3D coast stood up to half a cell (and the control/spline
 * difference) inland of the engine's shore: shore houses, fences and quays stood half in the water.
 * Here each grid point gets a coverage ramp from its signed distance to the spline's zero line (value over gradient, in
 * cells) that crosses the threshold the tile painter keeps (waterCellsWorker.ts, alpha 102/255) on that line: the drawn
 * edge follows the engine's shoreline to a fraction of a cell. */

/** Alpha the 3D tile painter thresholds the blurred cover at (waterCellsWorker.ts `a - 102`). */
const EDGE = 102 / 255;

/** Paints `rgba` (its alpha scaled by the sea coverage) on the n × n grid points of `height`: full inside the sea, a ramp
 * across the B-spline zero line, nothing on land. Existing stronger alpha (river or lake cells) is kept. */
export function paintSeaCover(pixels: Uint8ClampedArray, height: ArrayLike<number>, rgba: ArrayLike<number>, n = Math.round(Math.sqrt(height.length))): void {
  if (n * n !== height.length) {
    for (let i = 0; i < height.length; i++) if (height[i] <= 0) pixels.set(rgba, i * 4);
    return;
  }
  const at = (x: number, y: number): number => height[Math.max(0, Math.min(n - 1, y)) * n + Math.max(0, Math.min(n - 1, x))];
  const alpha = rgba[3] ?? 255;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    // Cubic B-spline at a control point: weights 1/6, 4/6, 1/6 per axis; its derivative: -1/2, 0, 1/2 (per cell).
    const row = (j: number): [number, number, number] => [at(x - 1, j), at(x, j), at(x + 1, j)];
    const a = row(y - 1), b = row(y), c = row(y + 1);
    const smooth = (r: [number, number, number]): number => (r[0] + 4 * r[1] + r[2]) / 6;
    const value = (smooth(a) + 4 * smooth(b) + smooth(c)) / 6;
    const gx = ((a[2] - a[0]) + 4 * (b[2] - b[0]) + (c[2] - c[0])) / 12;
    const gy = ((smooth(c) - smooth(a))) / 2;
    const slope = Math.hypot(gx, gy);
    // Signed distance to the zero line in cells (positive on land); a flat point keeps its sign.
    const d = slope > 1e-6 ? value / slope : value > 0 ? Infinity : -Infinity;
    // A ramp of slope EDGE per cell: both grid points straddling the line stay unclamped, so the bilinear tile upsampling
    // crosses EDGE exactly on the line; full sea from 1.5 cells out, nothing from a cell inland.
    const cover = Math.max(0, Math.min(1, EDGE * (1 - d)));
    if (cover <= 0) continue;
    const o = y * n + x, a8 = Math.round(cover * alpha);
    if (a8 <= pixels[o * 4 + 3]) continue;
    pixels[o * 4] = rgba[0]; pixels[o * 4 + 1] = rgba[1]; pixels[o * 4 + 2] = rgba[2]; pixels[o * 4 + 3] = a8;
  }
}
