// Regional roads a growth town ended (design 4.6): the stretches the regional network, the display and the road editor
// leave to the town's own streets. A light module (no WASM or engine imports), shared by the V2 and City Bench.
import type { Point } from './settlements';
import type { Layout, LayoutRoad, Street } from './urban';
import { regionalSegmentId, roadStations } from './urbanRoads';

/** A regional road as a page holds it: entry `i` of a source list is the source segment `regionalSegmentId(i)`. */
export interface RegionalSource {
  path: Point[];
  width?: number;
}

/** Distance (m) within which every returned entry lies on its source road. Growth seats road ends within 1 m, so a town
 * generated from another snapshot of the network (other segment indices) fails it and keeps the plain ownership clip. */
const ENTRY_REACH = 2;
const DEFAULT_WIDTH = 4;

interface SourceRoad {
  path: Point[];
  stations: number[];
  width: number;
}
type SourceLookup = (id: string) => SourceRoad | undefined;

function listLookup(sources: readonly RegionalSource[]): SourceLookup {
  const index = new Map<string, number>(sources.map((_, i) => [regionalSegmentId(i), i]));
  return id => {
    const i = index.get(id);
    const source = i === undefined ? undefined : sources[i];
    return source && source.path.length > 1 ? { path: source.path, stations: roadStations(source.path), width: source.width ?? DEFAULT_WIDTH } : undefined;
  };
}

/** Source roads rebuilt from the station-tagged pieces a town was generated from (`regionalStreets`). */
function streetLookup(streets: readonly Street[]): SourceLookup {
  const runs = new Map<string, { station: number; point: Point; width: number }[]>();
  for (const street of streets as readonly LayoutRoad[]) {
    const source = street.regionalSource;
    if (!source || source.stations.length !== street.path.length) continue;
    const run = runs.get(source.id) ?? [];
    street.path.forEach((point, i) => run.push({ station: source.stations[i], point, width: street.widths[i] ?? street.widths[0] ?? DEFAULT_WIDTH }));
    runs.set(source.id, run);
  }
  return id => {
    const run = runs.get(id);
    if (!run) return undefined;
    const sorted = [...run].sort((a, b) => a.station - b.station);
    const joined = sorted.filter((v, i) => i === 0 || v.station - sorted[i - 1].station > 1e-6);
    return joined.length > 1 ? { path: joined.map(v => v.point), stations: joined.map(v => v.station), width: Math.max(...joined.map(v => v.width)) } : undefined;
  };
}

function distanceToPath(p: Point, path: readonly Point[]): number {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      dx = path[i].x - a.x,
      dy = path[i].y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return best;
}

/** The part of a source road between two stations, with interpolated ends. */
function slice(source: SourceRoad, from: number, to: number): Point[] {
  const { path, stations } = source;
  const at = (d: number): Point => {
    let i = 1;
    while (i < stations.length - 1 && stations[i] < d) i++;
    const a = path[i - 1],
      b = path[i],
      t = (d - stations[i - 1]) / (stations[i] - stations[i - 1] || 1);
    return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  };
  return [at(from), ...path.filter((_, i) => stations[i] > from && stations[i] < to), at(to)];
}

/** The stretches of regional roads that growth towns ended, as world polylines along their source roads, with the
 * source road's width. Traffic is assumed to cross the town on its streets there, so no regional stroke or routable
 * regional edge runs between the entries. `sources`: the page's source list (index = segment id); without it the
 * source roads are rebuilt from the `regionalSource` stations of `streets`. A layout without `regionalRoadResult`
 * (classic) and a result without entries or with an entry off its source road contribute nothing. */
export function endedRegionalStretches(layouts: readonly Layout[], sources?: readonly RegionalSource[], streets: readonly Street[] = []): Street[] {
  const results = layouts.flatMap(layout => layout.regionalRoadResult ?? []).filter(result => result.ended.length);
  if (!results.length) return [];
  const lookup = sources ? listLookup(sources) : streetLookup(streets);
  const stretches: Street[] = [];
  for (const result of results) {
    const source = lookup(result.id);
    if (!source || !result.entries.length || !result.entries.every(p => distanceToPath(p, source.path) <= ENTRY_REACH)) continue;
    const first = source.stations[0],
      last = source.stations[source.stations.length - 1];
    for (const [start, end] of result.ended) {
      const from = Math.max(first, start),
        to = Math.min(last, end);
      if (to - from < 1e-6) continue;
      const path = slice(source, from, to);
      stretches.push({ path, widths: path.map(() => source.width), rank: 0, role: 'regional' });
    }
  }
  return stretches;
}
