/** A short, evenly sampled arc of the actual land/ocean edge near an FMG burg. */
export function fmgOceanShore(
  graph: {
    cells: { t: ArrayLike<number>; haven: ArrayLike<number>; f: ArrayLike<number>; area: ArrayLike<number>; p: [number, number][] };
    vertices: { p: [number, number][]; c: number[][] };
    features: { type: string; vertices: number[] }[];
  },
  cell: number,
  x: number,
  y: number,
): { water: 'ocean'; sea: number; shore: { distance: number; points: [number, number][] } } | undefined {
  const { cells, features, vertices } = graph;
  if (cells.t[cell] !== 1) return;
  const haven = cells.haven[cell], ocean = cells.f[haven], water = cells.p[haven], land = cells.p[cell];
  if (!land || !water || features[ocean]?.type !== 'ocean') return;
  const ring = features[cells.f[cell]]?.vertices;
  if (!ring || ring.length < 3 || !Number.isFinite(x) || !Number.isFinite(y)) return;
  const count = ring.length;
  const vertex = (i: number) => ring[(i + count) % count];
  const isOceanEdge = (i: number) => {
    const a = vertex(i), b = vertex(i + 1);
    return vertices.c[a]?.some(c => cells.f[c] === ocean && vertices.c[b]?.includes(c)) ?? false;
  };
  let edge = -1, nearest = Infinity, anchor: [number, number] = [0, 0];
  for (let i = 0; i < count; i++) {
    if (!isOceanEdge(i)) continue;
    const a = vertices.p[vertex(i)], b = vertices.p[vertex(i + 1)], dx = b[0] - a[0], dy = b[1] - a[1];
    const length2 = dx * dx + dy * dy;
    if (!length2) continue;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / length2));
    const q: [number, number] = [a[0] + t * dx, a[1] + t * dy];
    const distance = (q[0] - x) ** 2 + (q[1] - y) ** 2;
    if (distance < nearest) {
      nearest = distance;
      edge = i;
      anchor = q;
    }
  }
  if (edge < 0) return;
  const radius = 1.25 * Math.sqrt(Math.max(1, cells.area?.[cell] || 0));
  // Follow the same shore in both directions, starting at the orthogonal projection. A map border or a different
  // water body stops the sample. No edge is walked twice on a tiny island.
  const sample = (side: number) => {
    const out: [number, number][] = [];
    let previous = anchor, walked = 0;
    for (let j = 0; j <= Math.floor((count - 1) / 2) && out.length < 3; j++) {
      const i = edge + j * side;
      if (!isOceanEdge(i)) break;
      const next = vertices.p[vertex(i + (side > 0 ? 1 : 0))];
      const length = Math.hypot(next[0] - previous[0], next[1] - previous[1]);
      if (length > 0) {
        while (out.length < 3 && (out.length + 1) * radius / 3 <= walked + length) {
          const t = ((out.length + 1) * radius / 3 - walked) / length;
          out.push([previous[0] + (next[0] - previous[0]) * t, previous[1] + (next[1] - previous[1]) * t]);
        }
      }
      walked += length;
      previous = next;
    }
    if (out.length < 3 && Math.hypot(previous[0] - anchor[0], previous[1] - anchor[1]) > 1e-3) {
      const last = out.at(-1) ?? anchor;
      if (Math.hypot(previous[0] - last[0], previous[1] - last[1]) > 1e-3) out.push(previous);
    }
    return out;
  };
  const arc = [...sample(-1).reverse(), anchor, ...sample(1)];
  const first = arc[0], last = arc[arc.length - 1];
  const dx = last[0] - first[0], dy = last[1] - first[1], span = Math.hypot(dx, dy);
  if (arc.length < 3 || span < radius * 0.35) return;
  // The multi-edge tangent smooths cell corners. Use the ocean cell only to select the water side of that tangent.
  const side = dy * (water[0] - land[0]) - dx * (water[1] - land[1]) >= 0 ? 1 : -1;
  const nx = side * dy / span, ny = -side * dx / span;
  const sea = (2 - Math.atan2(ny, nx) / Math.PI) % 2;
  const distance = Math.max(0, ((anchor[0] - x) * nx + (anchor[1] - y) * ny) / radius);
  const compact = (v: number) => Math.round(v * 10000) / 10000;
  return {
    water: 'ocean',
    sea: compact(sea),
    shore: {
      distance: compact(distance),
      points: arc.map(([px, py]) => [compact((px - anchor[0]) / radius), compact((py - anchor[1]) / radius)]),
    },
  };
}
