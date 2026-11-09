import type { Vec2, World } from '../gen/types';
import type { V2Settings } from './contracts';
import type { SettlementEngine } from '../../../rust/bridge/settlementEngine';
import type { RoadConfig, RoadOutput, RoadSegment, SettlementRaster } from '../../../rust/bridge/settlements';
import type { ExecutionRuntime } from '../ui/executionProfile';
import { effectiveRegion } from './regionSettings';
import { stepSeed } from '../../../rust/bridge/generationSeed';
import { loopbackServer } from './platform';

const START = 'v2-route-start', END = 'v2-route-end';
export interface RoutedRoad { path: Vec2[]; segments: RoadSegment[]; output: RoadOutput }

/** Extract the actual linked path through the engine's split-junction graph. */
export function selectRoutedRoad(output: RoadOutput): RoutedRoad {
  const start = output.junctions.findIndex(j => j.site === START), end = output.junctions.findIndex(j => j.site === END);
  if (start < 0 || end < 0 || start === end || output.unreachable.length) throw new Error('No road route could be found between these points.');
  const adjacent: { index: number; to: number }[][] = Array.from({ length: output.junctions.length }, () => []);
  output.segments.forEach((segment, index) => {
    if (segment.a >= 0 && segment.a < adjacent.length && segment.b >= 0 && segment.b < adjacent.length && segment.path.length >= 2) {
      adjacent[segment.a].push({ index, to: segment.b }); adjacent[segment.b].push({ index, to: segment.a });
    }
  });
  const previous: ({ from: number; index: number } | undefined)[] = Array(adjacent.length), seen = new Set([start]), queue = [start];
  for (let i = 0; i < queue.length && !seen.has(end); i++) for (const edge of adjacent[queue[i]]) {
    if (!seen.has(edge.to)) { seen.add(edge.to); previous[edge.to] = { from: queue[i], index: edge.index }; queue.push(edge.to); }
  }
  if (!seen.has(end)) throw new Error('No road route could be found between these points.');
  const steps: { from: number; index: number }[] = [];
  for (let at = end; at !== start;) { const p = previous[at]!; steps.push(p); at = p.from; }
  steps.reverse();
  const path: Vec2[] = [], segments: RoadSegment[] = [];
  for (const step of steps) {
    const segment = output.segments[step.index], points = segment.a === step.from ? segment.path : [...segment.path].reverse();
    segments.push(segment);
    for (const point of points) if (!path.length || Math.hypot(path[path.length - 1].x - point.x, path[path.length - 1].y - point.y) > 1e-6) path.push({ ...point });
  }
  if (path.length < 2 || path.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('The road engine returned an invalid route.');
  return { path, segments, output };
}

/** Testable engine boundary: only two endpoint sites and one spanning-tree connection are requested. */
export async function runRoadRoute(engine: SettlementEngine, raster: SettlementRaster, roads: RoadConfig, seed: string,
  culture: string, start: Vec2, end: Vec2, runtime: ExecutionRuntime): Promise<RoutedRoad> {
  for (const p of [start, end]) if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0 || p.x >= raster.width || p.y >= raster.width)
    throw new Error('Choose road endpoints inside the map.');
  if (Math.hypot(start.x - end.x, start.y - end.y) < 1e-6) throw new Error('Choose two different road endpoints.');
  const sites = [start, end].map((center, i) => ({ key: i ? END : START, center: { ...center }, population: 300, culture, radius: .001 }));
  const response = await engine.run({ id: 1, seed, raster, sites, roads: { ...roads, density: 0, exits: 0, activityAccess: false, networkNodes: false }, runtime });
  if ('error' in response) throw new Error(response.error);
  if (!response.roads) throw new Error('The road engine returned no route.');
  return selectRoutedRoad(response.roads);
}

/** Route once over retained terrain with the current regional settings. No world is changed.
 * The engine starts with an empty road network: its API does not accept existing roads to share. */
export async function routeRoad(world: World, settings: V2Settings, start: Vec2, end: Vec2): Promise<RoutedRoad> {
  const { roads, resolution } = effectiveRegion(settings);
  const runtime: ExecutionRuntime = settings.runtime?.backend === 'native'
    ? { profile: 'local', server: loopbackServer(settings.runtime.localServer ?? 'http://127.0.0.1:8791') }
    : { profile: 'web', server: 'http://127.0.0.1:8791' };
  const [{ settlementRaster, defaultRoadConfig }, { resampleRegionalRaster }, { createSettlementEngine }, { effectiveTerrainSettings }] = await Promise.all([
    import('../../../rust/bridge/settlements'), import('./region'), import('../../../rust/bridge/settlementEngine'), import('./terrainSettings')]);
  const native = (world.terrain as typeof world.terrain & { v2NativeTerrain?: import('../../../rust/bridge/terrain').TerrainData }).v2NativeTerrain;
  const base = native ? settlementRaster(native, resolution) : (await import('./rustUrban')).rustSettlementRaster(world);
  const effective = effectiveTerrainSettings(settings, world.mapSize), climate = effective.climateValues!;
  const sampled = resampleRegionalRaster(base, resolution);
  const raster = { ...sampled, region: sampled.region ?? { seed: settings.options.seed, temperature: climate.temperature, precipitation: climate.precipitation, biome: effective.climateZone ?? 'temperate', x: native?.x ?? 0, y: native?.y ?? 0 } };
  const engine = await createSettlementEngine(runtime);
  try { return await runRoadRoute(engine, raster, roads ?? defaultRoadConfig(), stepSeed(settings.options.seed, 'settle-roads'), settings.options.culture, start, end, runtime); }
  finally { engine.dispose?.(); }
}
