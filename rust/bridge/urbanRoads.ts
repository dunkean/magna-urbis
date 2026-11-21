// Regional roads as urban streets: a light module (no WASM or engine imports), so the V2 can import it statically.
import type { Point, RoadOutput } from './settlements';
import type { LayoutRoad } from './urban';

/** Segment identity in the source network snapshot, before filtering or splitting. */
export function regionalSegmentId(index: number): string {
  return `segment:${index}`;
}

/** Cumulative distance from the first vertex of a source segment. */
export function roadStations(points: readonly Point[]): number[] {
  if (!points.length) return [];
  const stations = [0];
  for (let i = 1; i < points.length; i++) stations.push(stations[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  return stations;
}

/** Preserve crossing spans and source stations when the regional network becomes urban frontage. */
export function regionalStreets(roads?: RoadOutput | null, include?: (index: number) => boolean): LayoutRoad[] {
  return (
    roads?.segments.flatMap((segment, index) => {
      if (include && !include(index)) return [];
      const points = segment.path;
      if (points.length < 2) return [];
      const rank = segment.class === 'highway' ? 0 : segment.class === 'main' ? 1 : 2;
      const station = roadStations(points);
      const project = (p: Point): number => {
        let best = Infinity,
          at = 0;
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1],
            b = points[i],
            dx = b.x - a.x,
            dy = b.y - a.y;
          const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
          const d = Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
          if (d < best) {
            best = d;
            at = station[i - 1] + t * (station[i] - station[i - 1]);
          }
        }
        return at;
      };
      const crossings = segment.crossings
        .filter(c => c.path.length > 1)
        .map(c => {
          const a = project(c.path[0]),
            b = project(c.path[c.path.length - 1]);
          return { from: Math.min(a, b), to: Math.max(a, b), role: c.kind };
        });
      const total = station[station.length - 1];
      const cuts = [...new Set([0, total, ...crossings.flatMap(c => [c.from, c.to])])].sort((a, b) => a - b);
      const pointAt = (d: number): Point => {
        let i = 1;
        while (i < station.length - 1 && station[i] < d) i++;
        const t = (d - station[i - 1]) / (station[i] - station[i - 1] || 1),
          a = points[i - 1],
          b = points[i];
        return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
      };
      const id = regionalSegmentId(index);
      return cuts.slice(1).flatMap((to, i): LayoutRoad[] => {
        const from = cuts[i];
        if (to - from < 0.001) return [];
        const mid = (from + to) / 2,
          role = crossings.find(c => mid >= c.from && mid <= c.to)?.role ?? 'regional';
        const interior = points.flatMap((p, j) => (station[j] > from && station[j] < to ? [{ point: p, station: station[j] }] : []));
        const path = [pointAt(from), ...interior.map(v => v.point), pointAt(to)];
        return [{ path, widths: path.map(() => segment.width), rank, role, regionalSource: { id, stations: [from, ...interior.map(v => v.station), to] } }];
      });
    }) ?? []
  );
}
