/** Join retained river banks to the displayed coast before bank smoothing or cropping.
 * Hydrology can stop at the zero of a coarser height grid than the display terrain.
 * Only downstream caps with confirmed sea immediately ahead may be continued. */
export function coastalRiverMouths(svg: string, raster: { width: number; n: number; water: Uint8Array }, sourceCell = raster.width / raster.n): string {
  // Nested crops already carry their parent's repaired banks, in its coordinates.
  if (/<svg\b/.test(svg)) return svg;
  const cell = raster.width / raster.n;
  const sea = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < raster.width && y < raster.width
    && raster.water[Math.floor(y / cell) * raster.n + Math.floor(x / cell)] === 1;
  return svg.replace(/<path\b([^>]*?)\bd="([^"]*)"([^>]*)>/g, (element, before: string, data: string, after: string) => {
    if (/water-lakes|data-coastal-mouths|fill="none"/.test(before + after) || !/^[MLZ\d\s.,eE+-]+$/.test(data)) return element;
    let changed = false;
    const repaired = data.replace(/M[^M]+/g, ring => {
      if (!/Z\s*$/.test(ring)) return ring;
      const values = ring.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)?.map(Number) ?? [];
      const points = Array.from({ length: values.length / 2 }, (_, i) => ({ x: values[2 * i], y: values[2 * i + 1] }));
      const m = points.length / 2;
      if (m < 3 || !Number.isInteger(m)) return ring;
      const a = points[m - 1], b = points[m], prev = points[m - 2], next = points[m + 1];
      const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
      let dx = x - (prev.x + next.x) / 2, dy = y - (prev.y + next.y) / 2;
      const length = Math.hypot(dx, dy), width = Math.hypot(a.x - b.x, a.y - b.y);
      if (length < .01 || width < .01) return ring;
      dx /= length; dy /= length;
      // The two banks must actually end in a cross-section of the downstream axis.
      if (Math.abs((a.x - b.x) * dx + (a.y - b.y) * dy) > width * .35) return ring;
      const step = Math.max(.5, cell / 2), limit = 2 * Math.max(cell, sourceCell);
      let shore = 0;
      while (shore <= limit && !sea(x + dx * shore, y + dy * shore)) shore += step;
      if (shore > limit) return ring;
      // Overlap by at least the bank smoothing radius; a cap on the zero contour
      // can otherwise retract onto land again. Do not cross a second land strip.
      const overlap = Math.max(18, sourceCell, 2 * cell);
      let reach = shore;
      while (reach < shore + overlap && sea(x + dx * (reach + step), y + dy * (reach + step))) reach += step;
      if (reach < shore + Math.min(overlap, 12)) return ring;
      points.splice(m, 0, { x: a.x + dx * reach, y: a.y + dy * reach }, { x: b.x + dx * reach, y: b.y + dy * reach });
      changed = true;
      return points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('') + 'Z';
    });
    return changed ? `<path ${before}data-coastal-mouths="1" d="${repaired}"${after}>` : element;
  });
}
