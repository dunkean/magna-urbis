import type { World, Vec2, Polyline, UrbanLayer } from '../gen/types';
import type { Layout, Street, Shape } from '../../../rust/bridge/urban';
import type { RustTownSnapshot } from './rustUrban';
import type { V2Settings } from './contracts';
import { nearestOnPolyline, samePath } from './networkEdits';
import { pointInRing } from '../gen/geo/poly';
import { createRoadRouter } from './roadRoute';
import type { RoadCrossing } from '../../../rust/bridge/settlements';
import { demographicClass } from '../../../rust/bridge/settlementDemography';
import { urbanRoadChangedKeys, urbanRoadSources } from './urbanRoadEditing';

const citiesOf = (w: World) => (w.debug?.v2RustCities ?? {}) as Record<string, RustTownSnapshot>;
const contains = (shapes: readonly Shape[], p: Vec2) => shapes.some(s => pointInRing(s.outer, p) && !s.holes.some(h => pointInRing(h, p)));
const groundOf = (layout: Layout): Shape[] => (layout.structure?.allocated.length ? layout.structure.allocated : layout.quarters.map(q => q.shape));
const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

/** Only built places within reach of an actually changed piece of road are offered for reconstruction. */
export function roadAffectedTowns(before: World, next: World): string[] {
  const old = before.roads ?? [],
    roads = next.roads ?? [];
  const changed = [...old.filter(a => !roads.some(b => a === b || (a.kind === b.kind && a.width === b.width && samePath(a.path, b.path)))), ...roads.filter(a => !old.some(b => a === b || (a.kind === b.kind && a.width === b.width && samePath(a.path, b.path))))];
  const urbanChanged = urbanRoadChangedKeys(before, next);
  if (!changed.length) return urbanChanged;
  const cities = citiesOf(next);
  return (next.settlements ?? [])
    .filter(t => {
      if (urbanChanged.includes(t.key)) return true;
      const urban = t.main ? next.urban : t.urban,
        layouts = cities[t.key]?.layouts;
      if (!urban && !layouts?.length) return false;
      const center = t.core ?? t.center;
      const points = layouts?.flatMap(l => groundOf(l).flatMap(s => s.outer)) ?? t.extent;
      const reach = Math.max(t.radius, ...points.map(p => distance(p, center))) + Math.max(25, Math.min(100, t.radius * 0.2));
      // A road can share an unchanged endpoint with a town while being edited kilometres away.
      const differs = (a: typeof old, b: typeof old) =>
        a.some(r => {
          for (let i = 1; i < r.path.length; i++) {
            const p = r.path[i - 1],
              q = r.path[i],
              len = distance(p, q),
              steps = Math.max(1, Math.ceil(len / 12));
            if (nearestOnPolyline([p, q], center).distance > reach) continue;
            for (let j = 0; j <= steps; j++) {
              const point = { x: p.x + ((q.x - p.x) * j) / steps, y: p.y + ((q.y - p.y) * j) / steps };
              if (distance(point, center) <= reach && !b.some(road => nearestOnPolyline(road.path, point).distance <= 8)) return true;
            }
          }
          return false;
        });
      return (
        differs(
          changed.filter(r => old.includes(r)),
          roads,
        ) ||
        differs(
          changed.filter(r => roads.includes(r)),
          old,
        )
      );
    })
    .map(t => t.key);
}
/** Farms and isolated sites rebuild directly; only hamlets and larger places ask. */
export function roadTownNeedsChoice(world: World, key: string): boolean {
  const town = world.settlements?.find(t => t.key === key);
  if (!town) return false;
  return town.detail !== 'farmstead' && town.cls !== 'farmstead' && demographicClass(town.population) !== 'farmstead';
}

/** Split at exact polygon edges: original interior streets keep their vertices and widths. */
function splitStreet(street: Street, shapes: readonly Shape[]): { street: Street; inside: boolean }[] {
  const result: { street: Street; inside: boolean }[] = [];
  for (let i = 1; i < street.path.length; i++) {
    const a = street.path[i - 1],
      b = street.path[i],
      dx = b.x - a.x,
      dy = b.y - a.y,
      cuts = [0, 1];
    for (const s of shapes)
      for (const ring of [s.outer, ...s.holes])
        for (let j = 0; j < ring.length; j++) {
          const p = ring[j],
            q = ring[(j + 1) % ring.length],
            ex = q.x - p.x,
            ey = q.y - p.y,
            den = dx * ey - dy * ex;
          if (Math.abs(den) < 1e-10) continue;
          const t = ((p.x - a.x) * ey - (p.y - a.y) * ex) / den,
            u = ((p.x - a.x) * dy - (p.y - a.y) * dx) / den;
          if (t > 1e-8 && t < 1 - 1e-8 && u >= 0 && u <= 1) cuts.push(t);
        }
    cuts.sort((x, y) => x - y);
    const point = (t: number) => ({ x: a.x + dx * t, y: a.y + dy * t }),
      wa = street.widths[i - 1] ?? 4,
      wb = street.widths[i] ?? wa;
    for (let j = 1; j < cuts.length; j++) {
      const lo = cuts[j - 1],
        hi = cuts[j];
      if (hi - lo < 1e-8) continue;
      const inside = contains(shapes, point((lo + hi) / 2)),
        last = result.at(-1),
        start = point(lo),
        end = point(hi);
      if (last && last.inside === inside && distance(last.street.path.at(-1)!, start) < 1e-5) {
        last.street.path.push(end);
        last.street.widths.push(wa + (wb - wa) * hi);
      } else result.push({ inside, street: { ...street, path: [start, end], widths: [wa + (wb - wa) * lo, wa + (wb - wa) * hi] } });
    }
  }
  return result;
}
const isAccess = (s: Street) => s.role === 'approach' || s.role === 'regional';
type AccessRoute = (world: World, settings: V2Settings, points: Polyline) => Promise<Polyline | { path: Polyline; crossings: RoadCrossing[] }>;

/** Keep houses, plots and internal streets; reroute only the external approaches to the edited network. */
export async function rebuildTownRoadAccesses(source: World, settings: V2Settings, keys: readonly string[], route?: AccessRoute): Promise<World> {
  const router = route ? undefined : createRoadRouter();
  const run: AccessRoute =
    route ??
    (async (w, s, points) => {
      const result = await router!.route(w, s, points, 'local');
      return { path: result.path, crossings: result.segments.flatMap(s => s.crossings) };
    });
  const cities = { ...citiesOf(source) },
    updated = new Map<string, UrbanLayer>(),
    warnings: string[] = [];
  const townBridges = { ...(source.debug?.v2TownBridges ?? {}) } as Record<string, NonNullable<World['bridges']>>;
  try {
    for (const key of keys) {
      const town = source.settlements?.find(t => t.key === key);
      if (!town) continue;
      const snapshot = cities[key],
        urban = town.main ? source.urban : town.urban;
      const layouts =
        snapshot?.layouts ??
        (urban
          ? [
              {
                key,
                culture: town.culture,
                center: town.center,
                quarters: urban.quarters.map(q => ({ shape: { outer: q.poly.outer, holes: q.poly.holes ?? [] }, phase: q.phase })),
                blocks: [],
                warnings: [],
                streets: urban.streets.map(s => ({ path: s.path, widths: s.widths ?? s.path.map(() => s.width), rank: s.rank ?? 1, role: s.role })),
              } as Layout,
            ]
          : []);
      if (!layouts.length) continue;
      const shapes = layouts.flatMap(groundOf),
        allShapes = Object.values(cities).flatMap(c => c.layouts.flatMap(groundOf));
      const region = (source.roads ?? [])
        .filter(r => !r.urban)
        .flatMap(r =>
          splitStreet({ path: r.path, widths: r.path.map(() => r.width), rank: 1, role: 'regional' }, shapes)
            .filter(p => !p.inside)
            .map(p => p.street),
        );
      const terrain = { ...source.terrain, water: source.terrain.water.slice() };
      // Keep the settled core out of the access search; openings at retained street ends are released below.
      delete (terrain as typeof terrain & { v2NativeTerrain?: unknown }).v2NativeTerrain;
      delete (terrain as typeof terrain & { v2DecorRaster?: unknown }).v2DecorRaster;
      const grid = terrain.height,
        cell = grid.cell;
      for (const shape of allShapes.length ? allShapes : shapes) {
        const xs = shape.outer.map(p => p.x),
          ys = shape.outer.map(p => p.y);
        for (let y = Math.max(0, Math.floor(Math.min(...ys) / cell)); y < Math.min(grid.h, Math.ceil(Math.max(...ys) / cell)); y++)
          for (let x = Math.max(0, Math.floor(Math.min(...xs) / cell)); x < Math.min(grid.w, Math.ceil(Math.max(...xs) / cell)); x++) if (contains([shape], { x: (x + 0.5) * cell, y: (y + 0.5) * cell })) terrain.water[y * grid.w + x] = 1;
      }
      const routedWorld = { ...source, terrain },
        gates: Vec2[] = [];
      const tasks: { layout: number; anchor: Vec2; far: Vec2; width: number; oldPath?: Polyline }[] = [],
        retained: Street[][] = [];
      for (const [index, layout] of layouts.entries()) {
        retained[index] = [];
        for (const street of layout.streets) {
          if (snapshot?.streetEdits?.some(e => e.parts.some(p => samePath(p.street.path, street.path)))) {
            retained[index].push(street);
            continue;
          }
          const parts = splitStreet(street, shapes);
          if (!isAccess(street) && !(['street', 'radial', 'lane', 'track'].includes(street.role) && street.rank <= 1 && parts.some(p => p.inside) && parts.some(p => !p.inside))) {
            retained[index].push(street);
            continue;
          }
          for (const part of parts) {
            if (part.inside) {
              retained[index].push(part.street);
              continue;
            }
            const path = part.street.path,
              near = distance(path[0], town.center) <= distance(path.at(-1)!, town.center) ? path[0] : path.at(-1)!,
              far = near === path[0] ? path.at(-1)! : path[0];
            const attached = layout.streets.some(s => !isAccess(s) && nearestOnPolyline(s.path, near).distance < 2) || shapes.some(s => nearestOnPolyline([...s.outer, s.outer[0]], near).distance < 2);
            if (attached && distance(near, far) > 2) tasks.push({ layout: index, anchor: near, far, width: part.street.widths[0] ?? 4, oldPath: part.street.path });
            else retained[index].push(part.street);
          }
        }
      }
      // A new road can reach a town that previously had no explicit approach.
      if (!tasks.length && region.length)
        for (const [index, layout] of layouts.entries()) {
          const ends = layout.streets.filter(s => s.rank <= 1 && !['bridge', 'ford', 'causeway', 'boundary', 'ring'].includes(s.role)).flatMap(s => [s.path[0], s.path.at(-1)!]);
          const choices = ends.flatMap(anchor => region.map(r => ({ anchor, far: nearestOnPolyline(r.path, anchor).point, d: nearestOnPolyline(r.path, anchor).distance })));
          choices.sort((a, b) => a.d - b.d);
          const choice = choices.find(c => c.d > 2 && c.d < Math.max(100, town.radius * 3));
          if (choice) tasks.push({ layout: index, ...choice, width: 4 });
        }
      for (const task of tasks) if (!gates.some(p => distance(p, task.anchor) < 2)) gates.push(task.anchor);
      const retiredCrossing = (path: Polyline) => tasks.some(t => t.oldPath && path.every(p => nearestOnPolyline(t.oldPath!, p).distance <= Math.max(2, t.width)));
      for (let i = 0; i < retained.length; i++) retained[i] = retained[i].filter(s => !(['bridge', 'ford', 'causeway'].includes(s.role) && retiredCrossing(s.path)));
      if (townBridges[key]) townBridges[key] = townBridges[key].filter(b => !retiredCrossing([b.a, b.b]));
      for (const gate of gates)
        for (let y = Math.max(0, Math.floor(gate.y / cell) - 1); y <= Math.min(grid.h - 1, Math.floor(gate.y / cell) + 1); y++)
          for (let x = Math.max(0, Math.floor(gate.x / cell) - 1); x <= Math.min(grid.w - 1, Math.floor(gate.x / cell) + 1); x++) terrain.water[y * grid.w + x] = source.terrain.water[y * grid.w + x];
      const routingSettings = { ...settings, region: { ...settings.region, resolution: Math.max(64, Math.min(1024, grid.w)) } };
      for (const task of tasks) {
        const candidates = region.map(r => nearestOnPolyline(r.path, task.far)).sort((a, b) => a.distance - b.distance);
        const target = candidates[0]?.point;
        if (!target || distance(task.anchor, target) < 1) continue;
        try {
          const result = await run(routedWorld, routingSettings, [task.anchor, target]),
            path = Array.isArray(result) ? result : result.path;
          // Never silently send a new access through the retained town after raster rounding.
          if (splitStreet({ path, widths: path.map(() => task.width), role: 'approach', rank: 1 }, shapes).some(p => p.inside && p.street.path.some(q => distance(q, task.anchor) > cell * 2))) throw new Error('Access crosses retained town');
          retained[task.layout].push({ path, widths: path.map(() => task.width), role: 'approach', rank: 1 });
          for (const crossing of Array.isArray(result) ? [] : result.crossings)
            if (crossing.path.length >= 2) {
              retained[task.layout].push({ path: crossing.path, widths: crossing.path.map(() => task.width), role: crossing.kind, rank: 1 });
              if (crossing.kind === 'bridge') townBridges[key] = [...(townBridges[key] ?? []), { a: crossing.path[0], b: crossing.path.at(-1)!, width: task.width }];
            }
        } catch {
          warnings.push(key);
        }
      }
      const nextLayouts = layouts.map((l, i) => ({ ...l, streets: retained[i] }));
      if (snapshot)
        cities[key] = {
          ...snapshot,
          layouts: nextLayouts,
          roadSources: urbanRoadSources(nextLayouts, snapshot.streetEdits ?? []),
          pendingRoadChanges: {
            old: [...(snapshot.pendingRoadChanges?.old ?? []), ...tasks.flatMap(t => (t.oldPath ? [t.oldPath] : []))],
            next: [...(snapshot.pendingRoadChanges?.next ?? []), ...nextLayouts.flatMap(l => l.streets.filter(s => s.role === 'approach').map(s => s.path))],
          },
        };
      if (urban) {
        const kept = new Map(urban.streets.map(s => [s.path, s]));
        updated.set(key, {
          ...urban,
          streets: nextLayouts.flatMap(l => l.streets.map(s => kept.get(s.path) ?? { path: s.path, widths: s.widths, width: Math.max(1, ...s.widths), rank: s.rank, kind: s.rank < 2 ? ('main' as const) : ('street' as const), role: 'street' as const, phase: 0 })),
        });
      }
    }
    const base = source.debug?.v2BaseBridges as World['bridges'] | undefined;
    return {
      ...source,
      debug: { ...source.debug, v2RustCities: cities, v2TownBridges: townBridges },
      ...(base ? { bridges: [...base, ...Object.values(townBridges).flat()] } : {}),
      settlements: source.settlements?.map(t => (updated.has(t.key) ? { ...t, urban: updated.get(t.key) } : t)),
      ...(source.settlements?.some(t => t.main && updated.has(t.key)) ? { urban: updated.get(source.settlements.find(t => t.main)!.key) } : {}),
      stats: { ...source.stats, 'v2.roadAccessUnreachable': [...new Set(warnings)].join(',') },
    };
  } finally {
    await router?.dispose();
  }
}
