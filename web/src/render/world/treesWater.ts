/**
 * Where the modelled trees may not stand for water: the water the ground draws, as the painted crowns see it.
 *
 * The painted crowns (rust/bridge/terrainForest.ts forestCrown) drop a crown whose centre the drawn water covers
 * (forestWaterCoverage >= 0.05). On the satellite looks that water is the river segments of the ground (the
 * `riverSegments` layout, full widths), the lakes and the sea. The planning raster's river cells are far wider than
 * the drawn channels (a cell of 12 to 20 m holds a 3 m stream), and testing them kept the modelled trees off every
 * bank while the painted crowns stood there: the river test here is the drawn capsule itself, so a modelled tree
 * stands on every painted crown along a river and on none inside the channel.
 *
 * Called by v2/display/worldVolumes.ts, once per world and set of drawn rivers (the trees layer compares the function
 * by identity and builds its blocks again for a new one).
 */

/** Floats per segment of the `riverSegments` layout: x0, y0, x1, y1, full width at each end, then colour. */
const STRIDE = 9;
/** Side of the cells of the segment index (m). */
const CELL = 64;

/** Whether the drawn rivers cover a point: inside the capsule of a segment, its half width interpolated along it. */
export function riverCover(rivers: Float32Array): (x: number, y: number) => boolean {
  const cells = new Map<number, number[]>();
  for (let i = 0; i + STRIDE <= rivers.length; i += STRIDE) {
    const r = Math.max(rivers[i + 4], rivers[i + 5]) / 2,
      i0 = Math.floor((Math.min(rivers[i], rivers[i + 2]) - r) / CELL),
      i1 = Math.floor((Math.max(rivers[i], rivers[i + 2]) + r) / CELL),
      j0 = Math.floor((Math.min(rivers[i + 1], rivers[i + 3]) - r) / CELL),
      j1 = Math.floor((Math.max(rivers[i + 1], rivers[i + 3]) + r) / CELL);
    for (let j = j0; j <= j1; j++)
      for (let k = i0; k <= i1; k++) {
        const key = j * 65536 + k,
          list = cells.get(key);
        if (list) list.push(i);
        else cells.set(key, [i]);
      }
  }
  return (x, y) => {
    const list = cells.get(Math.floor(y / CELL) * 65536 + Math.floor(x / CELL));
    if (!list) return false;
    for (const i of list) {
      const x0 = rivers[i],
        y0 = rivers[i + 1],
        dx = rivers[i + 2] - x0,
        dy = rivers[i + 3] - y0,
        length2 = dx * dx + dy * dy,
        t = length2 > 0 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / length2)) : 0,
        half = (rivers[i + 4] + (rivers[i + 5] - rivers[i + 4]) * t) / 2;
      if (Math.hypot(x - x0 - dx * t, y - y0 - dy * t) <= half) return true;
    }
    return false;
  };
}
