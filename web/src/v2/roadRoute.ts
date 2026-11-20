import type { Vec2, World } from '../gen/types';
import type { V2Settings } from './contracts';
import type { SettlementEngine } from '../../../rust/bridge/settlementEngine';
import type { RoadClass, RoadConfig, RoadOutput, RoadSegment, SettlementRaster } from '../../../rust/bridge/settlements';
import type { ExecutionRuntime } from '../ui/executionProfile';
import { effectiveRegion } from './regionSettings';
import { stepSeed } from '../../../rust/bridge/generationSeed';
import { loopbackServer } from './platform';
import type { RoadGeometry } from './roadControlModel';

const START = 'v2-route-start',
  END = 'v2-route-end';
export interface RoutedRoad {
  path: Vec2[];
  segments: RoadSegment[];
  output: RoadOutput;
}

/** Extract the actual linked path through the engine's split-junction graph. */
export function selectRoutedRoad(output: RoadOutput): RoutedRoad {
  const start = output.junctions.findIndex(j => j.site === START),
    end = output.junctions.findIndex(j => j.site === END);
  if (start < 0 || end < 0 || start === end || output.unreachable.length) throw new Error('No road route could be found between these points.');
  const adjacent: { index: number; to: number }[][] = Array.from({ length: output.junctions.length }, () => []);
  output.segments.forEach((segment, index) => {
    if (segment.a >= 0 && segment.a < adjacent.length && segment.b >= 0 && segment.b < adjacent.length && segment.path.length >= 2) {
      adjacent[segment.a].push({ index, to: segment.b });
      adjacent[segment.b].push({ index, to: segment.a });
    }
  });
  const previous: ({ from: number; index: number } | undefined)[] = Array(adjacent.length),
    seen = new Set([start]),
    queue = [start];
  for (let i = 0; i < queue.length && !seen.has(end); i++)
    for (const edge of adjacent[queue[i]]) {
      if (!seen.has(edge.to)) {
        seen.add(edge.to);
        previous[edge.to] = { from: queue[i], index: edge.index };
        queue.push(edge.to);
      }
    }
  if (!seen.has(end)) throw new Error('No road route could be found between these points.');
  const steps: { from: number; index: number }[] = [];
  for (let at = end; at !== start;) {
    const p = previous[at]!;
    steps.push(p);
    at = p.from;
  }
  steps.reverse();
  const path: Vec2[] = [],
    segments: RoadSegment[] = [];
  for (const step of steps) {
    const segment = output.segments[step.index],
      points = segment.a === step.from ? segment.path : [...segment.path].reverse();
    segments.push(segment);
    for (const point of points) if (!path.length || Math.hypot(path[path.length - 1].x - point.x, path[path.length - 1].y - point.y) > 1e-6) path.push({ ...point });
  }
  if (path.length < 2 || path.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('The road engine returned an invalid route.');
  return { path, segments, output };
}

/** Testable engine boundary: only two endpoint sites and one spanning-tree connection are requested. */
export async function runRoadRoute(engine: SettlementEngine, raster: SettlementRaster, roads: RoadConfig, seed: string, culture: string, start: Vec2, end: Vec2, runtime: ExecutionRuntime, cls?: RoadClass, sendRaster = true): Promise<RoutedRoad> {
  for (const p of [start, end]) if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0 || p.x > raster.width || p.y > raster.width) throw new Error('Choose road endpoints inside the map.');
  if (Math.hypot(start.x - end.x, start.y - end.y) < 1e-6) throw new Error('Choose two different road endpoints.');
  // Mirror Rust's traffic-to-class table so an edited track keeps its slope/crossing rules.
  const ranks: Record<string, number[]> = { primitive: [3, 3, 3, 4, 4], rural: [1, 1, 2, 3, 4], developed: [0, 1, 2, 3, 4], imperial: [0, 0, 1, 2, 4] };
  const rank = cls ? ['highway', 'main', 'local', 'track', 'trail'].indexOf(cls) : -1;
  const base = rank < 0 ? -1 : ranks[roads.level].indexOf(rank),
    population = rank < 0 ? 300 : [5000, 1000, 300, 40, 8][base < 0 ? rank : base];
  const level = rank >= 0 && base < 0 ? 'developed' : roads.level;
  const epsilon = Math.max(1e-7, raster.width * 1e-10);
  const sites = [start, end].map((center, i) => ({ key: i ? END : START, center: { x: Math.min(raster.width - epsilon, center.x), y: Math.min(raster.width - epsilon, center.y) }, population, culture, radius: 0.001 }));
  const response = await engine.run({ id: 1, seed, ...(sendRaster ? { raster } : {}), sites, roads: { ...roads, level, density: 0, exits: { highway: 0, main: 0, local: 0, track: 0 }, activityAccess: false, networkNodes: false }, runtime });
  if ('error' in response) throw new Error(response.error);
  if (!response.roads) throw new Error('The road engine returned no route.');
  const result = selectRoutedRoad(response.roads);
  result.path[0] = { ...start };
  result.path[result.path.length - 1] = { ...end };
  return result;
}

export interface RoutedWaypoints extends RoadGeometry {
  segments: RoadSegment[];
}
/** Explicit consecutive connections, never a spanning tree that may skip/reorder a waypoint. */
export async function runRoadWaypoints(engine: SettlementEngine, raster: SettlementRaster, roads: RoadConfig, seed: string, culture: string, points: readonly Vec2[], runtime: ExecutionRuntime, cls?: RoadClass, sendRaster = true): Promise<RoutedWaypoints> {
  if (points.length < 2 || points.length > 500) throw new Error('A road needs between 2 and 500 control points.');
  const path: Vec2[] = [],
    controlIndices = [0],
    segments: RoadSegment[] = [];
  for (let i = 1; i < points.length; i++) {
    const leg = await runRoadRoute(engine, raster, roads, seed, culture, points[i - 1], points[i], runtime, cls, sendRaster && i === 1);
    path.push(...(i === 1 ? leg.path : leg.path.slice(1)));
    segments.push(...leg.segments);
    controlIndices.push(path.length - 1);
  }
  return { path, controls: points.map(p => ({ ...p })), controlIndices, segments };
}

/** Route once over retained terrain with the current regional settings. No world is changed.
 * The engine starts with an empty road network: its API does not accept existing roads to share. */
export async function routeRoad(world: World, settings: V2Settings, start: Vec2, end: Vec2): Promise<RoutedRoad> {
  const router = createRoadRouter();
  try {
    return await router.between(world, settings, start, end);
  } finally {
    await router.dispose();
  }
}

export async function routeRoadWaypoints(world: World, settings: V2Settings, points: readonly Vec2[], cls?: RoadClass): Promise<RoutedWaypoints> {
  const router = createRoadRouter();
  try {
    return await router.route(world, settings, points, cls);
  } finally {
    await router.dispose();
  }
}

type PreparedRoadTerrain = { identity: object | string; key: string; raster: SettlementRaster; engine: SettlementEngine; sent: boolean };
export interface RoadRouter {
  route(world: World, settings: V2Settings, points: readonly Vec2[], cls?: RoadClass, terrainToken?: string, variant?: number): Promise<RoutedWaypoints>;
  between(world: World, settings: V2Settings, start: Vec2, end: Vec2, terrainToken?: string): Promise<RoutedRoad>;
  dispose(): Promise<void>;
}
/** One retained engine per editor worker, whose scheduler serializes calls. The token survives cloning. */
export function createRoadRouter(): RoadRouter {
  let held: PreparedRoadTerrain | undefined,
    disposed = false;
  async function prepare(world: World, settings: V2Settings, terrainToken?: string) {
    if (disposed) throw new DOMException('Cancelled', 'AbortError');
    const { roads, resolution: requestedResolution } = effectiveRegion(settings);
    const terrainNative = (world.terrain as World['terrain'] & { v2NativeTerrain?: import('../../../rust/bridge/terrain').TerrainData }).v2NativeTerrain;
    // Editing a short leg must not erase the relief by reusing a coarse placement grid.
    const resolution = Math.max(requestedResolution, Math.min(1024, terrainNative?.physical?.n ?? world.terrain.height?.w ?? requestedResolution));
    const runtime: ExecutionRuntime = settings.runtime?.backend === 'native' ? { profile: 'local', server: loopbackServer(settings.runtime.localServer ?? 'http://127.0.0.1:8791') } : { profile: 'web', server: 'http://127.0.0.1:8791' };
    const [{ settlementRaster, defaultRoadConfig }, { resampleRegionalRaster }, { createSettlementEngine }, { effectiveTerrainSettings }] = await Promise.all([
      import('../../../rust/bridge/settlements'),
      import('./region'),
      import('../../../rust/bridge/settlementEngine'),
      import('./terrainSettings'),
    ]);
    const effective = effectiveTerrainSettings(settings, world.mapSize),
      climate = effective.climateValues!;
    const identity = terrainToken ?? world.terrain;
    const key = JSON.stringify([runtime, world.mapSize, resolution, settings.options.seed, climate.temperature, climate.precipitation, effective.climateZone, world.stats['v2.waterEditRevision'] ?? 0]);
    if (!held || held.identity !== identity || held.key !== key) {
      const old = held;
      held = undefined;
      await old?.engine.dispose?.();
      const native = (world.terrain as typeof world.terrain & { v2NativeTerrain?: import('../../../rust/bridge/terrain').TerrainData }).v2NativeTerrain;
      const base = native ? settlementRaster(native, resolution) : (await import('./rustUrban')).rustSettlementRaster(world);
      const sampled = resampleRegionalRaster(base, resolution);
      const raster = { ...sampled, region: sampled.region ?? { seed: settings.options.seed, temperature: climate.temperature, precipitation: climate.precipitation, biome: effective.climateZone ?? 'temperate', x: native?.x ?? 0, y: native?.y ?? 0 } };
      const engine = await createSettlementEngine(runtime);
      if (disposed) {
        await engine.dispose?.();
        throw new DOMException('Cancelled', 'AbortError');
      }
      held = { identity, key, raster, engine, sent: false };
    }
    return { state: held, roads: roads ?? defaultRoadConfig(), seed: stepSeed(settings.options.seed, 'settle-roads'), runtime };
  }
  async function run<T>(world: World, settings: V2Settings, terrainToken: string | undefined, execute: (s: PreparedRoadTerrain, roads: RoadConfig, seed: string, runtime: ExecutionRuntime) => Promise<T>): Promise<T> {
    const { state, roads, seed, runtime } = await prepare(world, settings, terrainToken);
    try {
      const result = await execute(state, roads, seed, runtime);
      state.sent = true;
      return result;
    } catch (error) {
      state.sent = false;
      throw error;
    }
  }
  return {
    route: (world, settings, points, cls, token, variant = 0) =>
      run(world, settings, token, async (s, roads, seed, runtime) => {
        // Explore different feasible cost trade-offs, never relax the class or maximum grade.
        // Noise alone has almost no influence on steep ground (Rust deliberately attenuates it there).
        const varied = variant ? { ...roads, gradeWeight: Math.min(10, roads.gradeWeight * [0.7, 1.4, 0.9, 1.8, 0.5, 1.15][(variant - 1) % 6]) } : roads;
        const result = await runRoadWaypoints(s.engine, s.raster, varied, variant ? `${seed}/road-variant/${variant}` : seed, settings.options.culture, points, runtime, cls, !s.sent);
        return { ...result, ...(variant ? { routingVariant: variant } : {}) };
      }),
    between: (world, settings, start, end, token) => run(world, settings, token, (s, roads, seed, runtime) => runRoadRoute(s.engine, s.raster, roads, seed, settings.options.culture, start, end, runtime, undefined, !s.sent)),
    async dispose() {
      disposed = true;
      const old = held;
      held = undefined;
      await old?.engine.dispose?.();
    },
  };
}
