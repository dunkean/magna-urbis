export type TerrainRayVector = [number, number, number];

/** The same triangles and optional quadrant clipping as a displayed terrain patch. */
export interface TerrainPickGrid {
  x: number; y: number; width: number; cells: number;
  height: (x: number, y: number) => number;
  clip: { x: number; y: number; width: number };
}

export function gridHeight(grid: TerrainPickGrid, x: number, y: number): number | null {
  const clip = grid.clip;
  if (x < clip.x || y < clip.y || x > clip.x + clip.width || y > clip.y + clip.width) return null;
  const gx = (x - grid.x) / grid.width * grid.cells, gy = (y - grid.y) / grid.width * grid.cells;
  const ix = Math.max(0, Math.min(grid.cells - 1, Math.floor(gx))), iy = Math.max(0, Math.min(grid.cells - 1, Math.floor(gy)));
  const tx = gx - ix, ty = gy - iy;
  const b = grid.height(ix + 1, iy), c = grid.height(ix, iy + 1);
  return tx + ty <= 1 ? grid.height(ix, iy) * (1 - tx - ty) + b * tx + c * ty
    : b * (1 - ty) + c * (1 - tx) + grid.height(ix + 1, iy + 1) * (tx + ty - 1);
}

/** First hit on the actual mesh, visiting only cells crossed by the ray. No sky/edge clamping. */
export function raycastGrid(grid: TerrainPickGrid, origin: TerrainRayVector, direction: TerrainRayVector): number | null {
  let enter = 0, leave = Infinity;
  for (const [axis, low] of [[0, grid.clip.x], [2, grid.clip.y]] as const) {
    const high = low + grid.clip.width, delta = direction[axis];
    if (Math.abs(delta) < 1e-12) { if (origin[axis] < low || origin[axis] > high) return null; }
    else {
      const a = (low - origin[axis]) / delta, b = (high - origin[axis]) / delta;
      enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
    }
  }
  if (enter > leave) return null;
  const step = grid.width / grid.cells, epsilon = 1e-7;
  const cell = (axis: 0 | 2, low: number): number => {
    const p = (origin[axis] + direction[axis] * enter - low) / step;
    return Math.max(0, Math.min(grid.cells - 1, Math.floor(p + Math.sign(direction[axis]) * epsilon)));
  };
  let ix = cell(0, grid.x), iy = cell(2, grid.y);
  const crossing = (axis: 0 | 2, low: number, i: number): number => Math.abs(direction[axis]) < 1e-12 ? Infinity
    : (low + (i + (direction[axis] > 0 ? 1 : 0)) * step - origin[axis]) / direction[axis];
  for (let visited = 0; visited <= grid.cells * 2; visited++) {
    const nextX = crossing(0, grid.x, ix), nextY = crossing(2, grid.y, iy), exit = Math.min(leave, nextX, nextY);
    const a = grid.height(ix, iy), b = grid.height(ix + 1, iy), c = grid.height(ix, iy + 1), d = grid.height(ix + 1, iy + 1);
    let nearest = Infinity;
    for (const upper of [false, true]) {
      const sx = (upper ? d - c : b - a) / step, sy = (upper ? d - b : c - a) / step;
      const base = upper ? b + c - d : a;
      const denominator = direction[1] - sx * direction[0] - sy * direction[2];
      if (Math.abs(denominator) < 1e-12) continue;
      const t = (base + sx * (origin[0] - grid.x - ix * step) + sy * (origin[2] - grid.y - iy * step) - origin[1]) / denominator;
      if (t < enter - epsilon || t > exit + epsilon) continue;
      const tx = (origin[0] + direction[0] * t - grid.x) / step - ix;
      const ty = (origin[2] + direction[2] * t - grid.y) / step - iy;
      if (upper ? tx + ty >= 1 - epsilon : tx + ty <= 1 + epsilon) nearest = Math.min(nearest, t);
    }
    if (Number.isFinite(nearest)) return nearest;
    if (exit >= leave) return null;
    if (nextX <= nextY) ix += Math.sign(direction[0]);
    if (nextY <= nextX) iy += Math.sign(direction[2]);
    if (ix < 0 || iy < 0 || ix >= grid.cells || iy >= grid.cells) return null;
    enter = exit;
  }
  return null;
}
