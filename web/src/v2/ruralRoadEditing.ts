import type { World, Polyline } from '../gen/types';
import { addRoad, roadSource, samePath } from './networkEdits';
import { withRoadSources } from './roadOverrides';
import type { RoadOutput } from '../../../rust/bridge/settlements';

const cached = new WeakMap<World, World>();
/** Rural lanes and farm accesses are real editable tracks, with the same junction graph as regional roads.
 * This immutable view is committed together with the first edit, never while merely opening the tool. */
export function editableRuralRoads(source: World): World {
  source = withRoadSources(source);
  const found = cached.get(source);
  if (found) return found;
  const landuse = source.landuse;
  const drives = (landuse?.farmsteads ?? []).flatMap((farm, index) => (farm.drive?.length >= 2 && farm.drive.some(p => Math.hypot(p.x - farm.drive[0].x, p.y - farm.drive[0].y) > 0.1) ? [{ path: farm.drive, index }] : []));
  const ways = (landuse?.ways ?? []).filter(path => path.length >= 2);
  if (!drives.length && !ways.length) {
    cached.set(source, source);
    return source;
  }
  let world: World = { ...source, landuse: { ...landuse!, farmsteads: landuse!.farmsteads.map(f => ({ ...f })), ways: [] } };
  const integrate = (path: Polyline, width: number) => {
    const existing = world.roads?.findIndex(r => samePath(r.path, path) || samePath(r.path, [...path].reverse())) ?? -1;
    if (existing >= 0) return existing;
    const result = addRoad(world, path, { editorSource: roadSource(path, 'rural'), cls: 'track', width, snap: Math.max(1, Math.min(6, source.terrain.height.cell * 0.05)) });
    world = result.world;
    return result.road!;
  };
  for (const drive of drives) {
    const gate = source.landuse!.farmsteads[drive.index].gate ?? drive.path.at(-1)!;
    const index = integrate(drive.path, 2);
    world = { ...world, landuse: { ...world.landuse!, farmsteads: world.landuse!.farmsteads.map((farm, i) => (i === drive.index ? { ...farm, gate: { ...gate }, drive: [] } : farm)) } };
    const output = (world.debug?.v2RustRegion as { roads?: RoadOutput } | undefined)?.roads,
      segment = output?.segments[index];
    if (output && segment) {
      const end = Math.hypot(segment.path[0].x - gate.x, segment.path[0].y - gate.y) < Math.hypot(segment.path.at(-1)!.x - gate.x, segment.path.at(-1)!.y - gate.y) ? segment.a : segment.b;
      const roads = { ...output, junctions: output.junctions.map((j, i) => (i === end ? { ...j, site: `farmstead:${drive.index}` } : j)) };
      world = { ...world, debug: { ...world.debug, v2RustRegion: { ...(world.debug!.v2RustRegion as object), roads } } };
    }
  }
  for (const path of ways) integrate(path, 2.6);
  cached.set(source, world);
  cached.set(world, world);
  return world;
}
