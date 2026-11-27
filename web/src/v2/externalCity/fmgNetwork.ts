/** Export the nearby portions of the FMG river and primary roads in the shoreline sample's local units. */
export function fmgCityNetwork(
  graph: {
    cells: { r: ArrayLike<number>; area: ArrayLike<number>; p: [number, number][]; routes?: Record<number, Record<number, number>> };
    rivers?: { i: number; source?: number; cells: number[]; points?: [number, number][]; width?: number }[];
    routes?: { i: number; group: string; points: number[][]; removed?: boolean }[];
  },
  cell: number,
  x: number,
  y: number,
) {
  type Point = [number, number];
  const radius = 1.25 * Math.sqrt(Math.max(1, graph.cells.area?.[cell] || 0));
  const round = (v: number) => Math.round(v * 10000) / 10000;
  const sample = (path: readonly number[][], reach = radius) => {
    if (path.length < 2) return;
    let nearest = Infinity,
      along = 0;
    const distances = [0];
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1],
        b = path[i],
        dx = b[0] - a[0],
        dy = b[1] - a[1],
        length = Math.hypot(dx, dy);
      const start = distances[i - 1];
      distances.push(start + length);
      if (!length) continue;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (length * length)));
      const gap = Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y);
      if (gap < nearest) {
        nearest = gap;
        along = start + t * length;
      }
    }
    if (nearest > radius * 0.65) return;
    const start = Math.max(0, along - reach),
      end = Math.min(distances.at(-1)!, along + reach);
    if (end - start < radius * 0.12) return;
    // Keep the nearest point explicitly, even when it lies very close to a route endpoint at the bourg.
    const bends = distances
      .flatMap((offset, i) => {
        if (offset <= start || offset >= end || i === 0 || i === path.length - 1) return [];
        const [a, b, c] = path.slice(i - 1, i + 2);
        const ux = b[0] - a[0],
          uy = b[1] - a[1],
          vx = c[0] - b[0],
          vy = c[1] - b[1];
        const length = Math.hypot(ux, uy) * Math.hypot(vx, vy);
        const turn = length ? 1 - (ux * vx + uy * vy) / length : 0;
        return turn > 0.025 ? [{ offset, turn }] : [];
      })
      .sort((a, b) => b.turn - a.turn)
      .slice(0, 2)
      .map(b => b.offset);
    const offsets = [...new Set([start, ...Array.from({ length: 5 }, (_, i) => Math.max(start, Math.min(end, along + ((i - 2) * reach) / 3))), ...bends, end])].sort((a, b) => a - b);
    let i = 1;
    const points = offsets
      .map(offset => {
        while (i + 1 < distances.length && distances[i] < offset) i++;
        const a = path[i - 1],
          b = path[i],
          t = (offset - distances[i - 1]) / (distances[i] - distances[i - 1] || 1);
        return [round((a[0] + (b[0] - a[0]) * t - x) / radius), round((a[1] + (b[1] - a[1]) * t - y) / radius)] as Point;
      })
      .filter((point, i, all) => i === 0 || point[0] !== all[i - 1][0] || point[1] !== all[i - 1][1]);
    if (points.length >= 2) return { points, startsHere: start === 0 && along <= radius * 0.65 };
  };
  const riverId = graph.cells.r[cell];
  const river = riverId ? graph.rivers?.find(r => r.i === riverId) : undefined;
  // Classic FMG saves may have only the river's cells, and use a negative cell for a map-edge outlet.
  const riverPath = river ? sample(river.points?.length ? river.points : river.cells.map(c => graph.cells.p[c]).filter(Boolean)) : undefined;
  const adjacent = new Set(Object.values(graph.cells.routes?.[cell] ?? {}));
  const land = (graph.routes ?? [])
    .flatMap(route => {
      if (!route || route.removed || (route.group !== 'roads' && route.group !== 'trails')) return [];
      const connected = adjacent.has(route.i) || route.points.some(p => p[2] === cell);
      if (!connected) return [];
      const local = sample(route.points, radius * 1.35);
      return local ? [{ points: local.points, route }] : [];
    })
    .sort((a, b) => a.route.i - b.route.i);
  const roads = land
    .filter(r => r.route.group === 'roads')
    .slice(0, 8)
    .map(r => r.points);
  const trails = land
    .filter(r => r.route.group === 'trails')
    .slice(0, 4)
    .map(r => r.points);
  return {
    river: riverPath && river ? { points: riverPath.points, widthKm: round(Math.max(0, Math.min(20, river.width || 0))), headwater: (river.source ?? river.cells[0]) === cell || riverPath.startsHere || undefined } : undefined,
    roads: roads.length ? roads : undefined,
    trails: trails.length ? trails : undefined,
  };
}
