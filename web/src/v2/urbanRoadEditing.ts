import type { World, Polyline, Vec2, UrbanLayer } from '../gen/types';
import type { Street, Layout, Shape } from '../../../rust/bridge/urban';
import type { RoadOutput, RoadSegment } from '../../../rust/bridge/settlements';
import type { RustTownSnapshot } from './rustUrban';
import { nearestOnPolyline, roadCrossings, roadSource, samePath } from './networkEdits';
import { polylineLength } from '../gen/core/geom';
import { roadPieceGeometry } from './roadControlModel';
import { pointInRing } from '../gen/geo/poly';
import { cityRegionalNetwork } from '../render/cityBridges';

type Road = NonNullable<World['roads']>[number];
export interface UrbanRoadPart {
  street: Street;
  part: string;
  editorId?: string;
  controls?: Polyline;
  controlIndices?: number[];
  routingVariant?: number;
}
export interface UrbanStreetEdit {
  id: string;
  layout: string;
  original: Street | null;
  parts: UrbanRoadPart[];
}
export interface UrbanRoadSources {
  layout: string;
  streets: Street[];
}
export interface RoadChanges {
  old: Polyline[];
  next: Polyline[];
  adaptAccess?: boolean;
}
const cache = new WeakMap<World, World>();
const eq = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-5;
const at = (p: Vec2) => `${Math.round(p.x * 10000)},${Math.round(p.y * 10000)}`;
const hash = (value: unknown) => {
  let h = 2166136261;
  for (const c of JSON.stringify(value)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16);
};
export const urbanStreetId = (layout: string, street: Street) => `${layout}:${hash([street.path, street.role, street.rank])}`;
const width = (s: Street) => s.widths.reduce((a, b) => a + b, 0) / Math.max(1, s.widths.length) || 3;
const kind = (s: Street): Road['kind'] => (['track', 'trail', 'stairs', 'lane'].includes(s.role) || width(s) < 3 ? 'track' : s.rank <= 1 ? 'major' : 'minor');
const cls = (r: Road) => r.editorClass ?? (r.kind === 'major' ? ('main' as const) : r.kind === 'minor' ? ('local' as const) : ('track' as const));
/** A drawn road entirely inside one settlement belongs to that town's editable street layer. */
export function adoptUrbanRoad(world: World, index: number): World {
  const r = world.roads?.[index];
  if (!r || r.urban) return world;
  for (const city of cities(world))
    for (const layout of city.layouts) {
      const shapes = layout.structure?.allocated ?? layout.quarters.map(q => q.shape);
      if (!r.path.every(p => shapes.some(s => pointInRing(s.outer, p) && !s.holes.some(h => pointInRing(h, p))))) continue;
      const urban: NonNullable<Road['urban']> = { key: city.key, layout: layout.key, id: `manual:${hash(r.path)}`, part: '0', original: null, role: r.kind === 'track' ? 'lane' : 'street', rank: r.kind === 'major' ? 1 : 3, access: false };
      return { ...world, roads: world.roads!.map((road, i) => (i === index ? { ...road, urban } : road)) };
    }
  return world;
}
const classicStreet = (s: UrbanLayer['streets'][number]): Street => ({ path: s.path, widths: s.widths ?? s.path.map(() => s.width), rank: s.rank ?? 2, role: s.role });
function cities(world: World) {
  const native = (world.debug?.v2RustCities ?? {}) as Record<string, RustTownSnapshot>;
  return (world.settlements ?? []).flatMap(t => {
    const urban = t.main ? world.urban : t.urban,
      snapshot = native[t.key];
    const layouts =
      snapshot?.layouts ??
      (urban ? [{ key: t.key, culture: t.culture, center: t.center, quarters: urban.quarters.map(q => ({ shape: { outer: q.poly.outer, holes: q.poly.holes ?? [] }, phase: q.phase })), blocks: [], warnings: [], streets: urban.streets.map(classicStreet) } as Layout] : []);
    if (!layouts.length) return [];
    const saved = world.debug?.v2LegacyStreetEdits as Record<string, UrbanStreetEdit[]> | undefined;
    const sources = world.debug?.v2LegacyRoadSources as Record<string, UrbanRoadSources[]> | undefined;
    return [{ key: t.key, town: t, urban, snapshot, layouts, edits: snapshot?.streetEdits ?? saved?.[t.key] ?? [], sources: snapshot?.roadSources ?? sources?.[t.key] ?? layouts.map(l => ({ layout: l.key, streets: l.streets })) }];
  });
}
function stamp(w: World): string {
  return hash(cities(w).map(c => [c.key, c.layouts.map(l => [l.key, l.streets]), c.edits]));
}
function joined(parts: readonly UrbanRoadPart[]): Street[] {
  const out: Street[] = [];
  for (const part of parts) {
    const s = part.street,
      last = out.at(-1);
    if (last && last.role === s.role && last.rank === s.rank && Math.abs(width(last) - width(s)) < 1e-6 && eq(last.path.at(-1)!, s.path[0])) {
      last.path.push(...s.path.slice(1));
      last.widths.push(...s.widths.slice(1));
    } else out.push({ ...s, path: s.path.slice(), widths: s.widths.slice() });
  }
  return out;
}
function sameGeometry(a: readonly UrbanRoadPart[], b: readonly UrbanRoadPart[]): boolean {
  const aa = joined(a),
    bb = joined(b);
  return (
    aa.length === bb.length &&
    aa.every((s, i) => {
      const t = bb[i];
      return (
        s.role === t.role &&
        s.rank === t.rank &&
        Math.abs(width(s) - width(t)) < 1e-5 &&
        eq(s.path[0], t.path[0]) &&
        eq(s.path.at(-1)!, t.path.at(-1)!) &&
        Math.abs(polylineLength(s.path) - polylineLength(t.path)) < 1e-4 &&
        s.path.every(p => nearestOnPolyline(t.path, p).distance < 1e-4) &&
        t.path.every(p => nearestOnPolyline(s.path, p).distance < 1e-4)
      );
    })
  );
}

function replayStreets(key: string, generated: Street[], edits: readonly UrbanStreetEdit[]): Street[] {
  const relevant = new Map(edits.filter(e => e.layout === key).map(e => [e.id, e]));
  if (!relevant.size) return generated;
  const streets: Street[] = [];
  for (const street of generated) {
    const id = urbanStreetId(key, street),
      edit = relevant.get(id);
    if (edit) {
      streets.push(...edit.parts.map(p => p.street));
      relevant.delete(id);
    } else streets.push(street);
  }
  for (const edit of relevant.values()) streets.push(...edit.parts.map(p => p.street));
  return streets;
}

/** Classic towns have the same saved edits, with their native-style street source in debug. */
export function replayClassicTownStreets(world: World, key: string, urban: UrbanLayer, edits: UrbanStreetEdit[]): UrbanLayer {
  const generated = urban.streets.map(classicStreet);
  const original = new Map(generated.map((s, i) => [s, urban.streets[i]]));
  const streets = replayStreets(key, generated, edits);
  world.debug = { ...world.debug, v2LegacyStreetEdits: { ...(world.debug?.v2LegacyStreetEdits as object), [key]: edits }, v2LegacyRoadSources: { ...(world.debug?.v2LegacyRoadSources as object), [key]: [{ layout: key, streets: generated }] } };
  return { ...urban, streets: streets.map(s => original.get(s) ?? { path: s.path, widths: s.widths, width: width(s), rank: s.rank, role: s.role as UrbanLayer['streets'][number]['role'], kind: s.rank <= 1 ? 'main' : 'street', phase: 0 }) };
}

/** Replay manual road decisions after generation; native request payloads still contain plain Street objects. */
export function replayUrbanRoadEdits(layouts: Layout[], edits: readonly UrbanStreetEdit[]): Layout[] {
  // Native sessions reuse layouts by identity through parcels, programme and binary
  // site visuals. An empty replay must not turn that retained chain into uploads.
  if (!edits.length) return layouts;
  return layouts.map(layout => {
    const streets = replayStreets(layout.key, layout.streets, edits);
    return streets === layout.streets ? layout : { ...layout, streets, ...(layout.claim ? { claim: { ...layout.claim, streets } } : {}) };
  });
}

/** Retain the new automatic accesses without baking manual replacements into their source. */
export function urbanRoadSources(layouts: readonly Layout[], edits: readonly UrbanStreetEdit[]): UrbanRoadSources[] {
  return layouts.map(l => {
    const relevant = edits.filter(e => e.layout === l.key),
      used = new Set<string>(),
      streets: Street[] = [];
    for (const s of l.streets) {
      const edit = relevant.find(e => e.parts.some(p => samePath(p.street.path, s.path) && p.street.role === s.role));
      if (!edit) streets.push(s);
      else if (!used.has(edit.id)) {
        used.add(edit.id);
        if (edit.original) streets.push(edit.original);
      }
    }
    for (const edit of relevant) if (!used.has(edit.id) && edit.original) streets.push(edit.original);
    return { layout: l.key, streets };
  });
}

/** Spatially split the planar network at crossings/T junctions, keeping every city's ownership. */
function connectedGraph(world: World): World {
  const source = world.roads ?? [],
    old = (world.debug?.v2RustRegion as { roads?: RoadOutput } | undefined)?.roads;
  // The regional source and the city's visible stroke sometimes describe the same edge.
  // Comparing their individual raster samples must not turn every bend into a new road.
  const duplicatePairs = new Map<string, boolean>();
  const follows = (a: Polyline, b: Polyline) => a.every((p, i) => nearestOnPolyline(b, p).distance < 1e-5 && (!i || nearestOnPolyline(b, { x: (p.x + a[i - 1].x) / 2, y: (p.y + a[i - 1].y) / 2 }).distance < 1e-5));
  const sharesStroke = (a: number, b: number) => {
    if (!!source[a].urban === !!source[b].urban) return false;
    const key = `${a}/${b}`;
    let value = duplicatePairs.get(key);
    if (value === undefined) {
      value = follows(source[a].path, source[b].path) || follows(source[b].path, source[a].path);
      duplicatePairs.set(key, value);
    }
    return value;
  };
  const segments: { road: number; index: number; a: Vec2; b: Vec2; cuts: number[] }[] = [];
  const bins = new Map<string, number[]>(),
    wide: number[] = [];
  const cells = (a: Vec2, b: Vec2): string[] | undefined => {
    const x0 = Math.floor(Math.min(a.x, b.x) / 64),
      x1 = Math.floor(Math.max(a.x, b.x) / 64),
      y0 = Math.floor(Math.min(a.y, b.y) / 64),
      y1 = Math.floor(Math.max(a.y, b.y) / 64);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4096) return;
    const keys: string[] = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) keys.push(`${x},${y}`);
    return keys;
  };
  source.forEach((r, road) => {
    for (let index = 1; index < r.path.length; index++) {
      const a = r.path[index - 1],
        b = r.path[index],
        keys = cells(a, b),
        s = { road, index, a, b, cuts: [] as number[] };
      const candidates = new Set(keys ? [...wide, ...keys.flatMap(k => bins.get(k) ?? [])] : segments.map((_, i) => i));
      for (const j of candidates) {
        const t = segments[j];
        if (t.road === road && Math.abs(t.index - index) <= 1) continue;
        if (t.road !== road && sharesStroke(t.road, road)) {
          for (const p of [source[t.road].path[0], source[t.road].path.at(-1)!]) {
            const hit = nearestOnPolyline([a, b], p);
            if (hit.distance < 1e-5) s.cuts.push(hit.t);
          }
          for (const p of [source[road].path[0], source[road].path.at(-1)!]) {
            const hit = nearestOnPolyline([t.a, t.b], p);
            if (hit.distance < 1e-5) t.cuts.push(hit.t);
          }
          continue;
        }
        const ux = b.x - a.x,
          uy = b.y - a.y,
          vx = t.b.x - t.a.x,
          vy = t.b.y - t.a.y,
          den = ux * vy - uy * vx;
        if (Math.abs(den) > 1e-9) {
          const k = ((t.a.x - a.x) * vy - (t.a.y - a.y) * vx) / den,
            l = ((t.a.x - a.x) * uy - (t.a.y - a.y) * ux) / den;
          if (k >= -1e-8 && k <= 1 + 1e-8 && l >= -1e-8 && l <= 1 + 1e-8) {
            s.cuts.push(Math.max(0, Math.min(1, k)));
            t.cuts.push(Math.max(0, Math.min(1, l)));
          }
        } else {
          for (const p of [source[t.road].path[0], source[t.road].path.at(-1)!]) {
            const hit = nearestOnPolyline([a, b], p);
            if (hit.distance < 1e-5) s.cuts.push(hit.t);
          }
          for (const p of [source[road].path[0], source[road].path.at(-1)!]) {
            const hit = nearestOnPolyline([t.a, t.b], p);
            if (hit.distance < 1e-5) t.cuts.push(hit.t);
          }
        }
      }
      const id = segments.length;
      segments.push(s);
      if (keys)
        for (const k of keys) {
          const list = bins.get(k) ?? [];
          list.push(id);
          bins.set(k, list);
        }
      else wide.push(id);
    }
  });
  const byRoad = new Map<number, typeof segments>();
  for (const s of segments) {
    const list = byRoad.get(s.road) ?? [];
    list.push(s);
    byRoad.set(s.road, list);
  }
  const roads: Road[] = [],
    native: RoadSegment[] = [],
    junctions: RoadOutput['junctions'] = [],
    nodes = new Map<string, number>(),
    sites = new Map((old?.junctions ?? []).filter(j => j.site).map(j => [at(j.point), j.site]));
  const node = (p: Vec2) => {
    const id = nodes.get(at(p));
    if (id !== undefined) return id;
    const next = junctions.length;
    nodes.set(at(p), next);
    junctions.push({ point: { ...p }, site: sites.get(at(p)) ?? null, degree: 0 });
    return next;
  };
  for (const [i, r] of source.entries()) {
    const pieces: Polyline[] = [];
    let path: Polyline = [];
    const push = (p: Vec2) => {
      if (!path.length || !eq(path.at(-1)!, p)) path.push({ ...p });
    };
    for (const s of byRoad.get(i) ?? []) {
      push(s.a);
      const cuts = [...new Set(s.cuts.map(t => Math.round(t * 1e9) / 1e9))].sort((a, b) => a - b);
      for (const t of cuts) {
        push({ x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t });
        if (path.length > 1) {
          pieces.push(path);
          path = [path.at(-1)!];
        }
      }
      push(s.b);
    }
    if (path.length > 1) pieces.push(path);
    for (const [pieceIndex, points] of pieces.entries()) {
      const same = pieces.length === 1 && samePath(points, r.path),
        owned = r.urban && { ...r.urban, ...(pieces.length > 1 ? { part: `${r.urban.part}:${String(pieceIndex).padStart(5, '0')}` } : {}) };
      const road: Road = {
        ...r,
        ...(!r.urban && !r.editorSource ? { editorSource: roadSource(r.path) } : {}),
        path: same ? r.path : points,
        ...(pieces.length > 1 && r.editorId ? { editorId: `${r.editorId}:${pieceIndex}` } : {}),
        ...(owned ? { urban: owned } : {}),
        ...(r.controls && !same ? roadPieceGeometry(points, r.controls) : {}),
      };
      delete road.editorPickPaths;
      roads.push(road);
      const a = node(points[0]),
        b = node(points.at(-1)!);
      junctions[a].degree++;
      junctions[b].degree++;
      const previous = old?.segments[i],
        crossings = same && previous ? previous.crossings : roadCrossings(world.terrain, points, cls(road));
      native.push({
        ...previous,
        a,
        b,
        path: road.path,
        class: previous?.class ?? cls(road),
        surface: previous?.surface ?? 'dirt',
        profile: previous?.profile ?? 'medieval',
        width: road.width,
        crossings,
        length: polylineLength(points),
        grade: previous?.grade ?? 0,
        importance: previous?.importance ?? 0,
      });
    }
  }
  const output: RoadOutput = { ...old, segments: native, junctions, exits: old?.exits ?? [], warnings: old?.warnings ?? [], unreachable: old?.unreachable ?? [], routes: old?.routes ?? 0, lengthByClass: {}, lengthBySurface: {}, ms: old?.ms ?? 0 };
  native.forEach(s => {
    output.lengthByClass[s.class] = (output.lengthByClass[s.class] ?? 0) + s.length;
    output.lengthBySurface[s.surface] = (output.lengthBySurface[s.surface] ?? 0) + s.length;
  });
  return { ...world, roads, debug: { ...world.debug, v2RustRegion: { ...((world.debug?.v2RustRegion as object) ?? {}), roads: output } }, stats: { ...world.stats, 'v2.regionalRoads': roads.filter(r => !r.urban).length } };
}

export function editableUrbanRoads(source: World): World {
  const found = cache.get(source);
  if (found) return found;
  const owners = cities(source);
  if (!owners.length) {
    cache.set(source, source);
    return source;
  }
  const key = stamp(source);
  if (source.debug?.v2UrbanRoadStamp === key) {
    cache.set(source, source);
    return source;
  }
  const native = (source.debug?.v2RustRegion as { roads?: RoadOutput } | undefined)?.roads;
  const roads = (source.roads ?? []).filter(r => !r.urban),
    kept = native?.segments.filter((_, i) => !source.roads?.[i]?.urban);
  for (const city of owners)
    for (const layout of city.layouts) {
      for (const [index, street] of layout.streets.entries()) {
        if (street.path.length < 2 || polylineLength(street.path) < 0.01) continue;
        const saved = city.edits.flatMap(e => e.parts.map(p => ({ edit: e, part: p }))).find(p => samePath(p.part.street.path, street.path) && p.part.street.role === street.role);
        const id = saved?.edit.id ?? urbanStreetId(layout.key, street),
          original = saved ? saved.edit.original : street;
        const ground = layout.structure?.allocated ?? layout.quarters.map(q => q.shape),
          mid = street.path[Math.floor(street.path.length / 2)];
        const access = ['regional', 'approach'].includes(street.role) || !ground.some(s => pointInRing(s.outer, mid) && !s.holes.some(h => pointInRing(h, mid)));
        roads.push({
          path: street.path,
          width: width(street),
          kind: kind(street),
          editorId: saved?.part.editorId ?? `urban:${city.key}:${id}:${saved?.part.part ?? String(index).padStart(5, '0')}`,
          urban: { key: city.key, layout: layout.key, id, part: saved?.part.part ?? String(index).padStart(5, '0'), original, role: street.role, rank: street.rank, access },
          ...(saved?.part.controls ? { controls: saved.part.controls, controlIndices: saved.part.controlIndices } : {}),
          ...(saved?.part.routingVariant ? { routingVariant: saved.part.routingVariant } : {}),
        });
      }
    }
  let world = connectedGraph({ ...source, roads, debug: { ...source.debug, ...(native ? { v2RustRegion: { ...(source.debug!.v2RustRegion as object), roads: { ...native, segments: kept! } } } : {}) } });
  const visible =
    cityRegionalNetwork(
      world.roads!.filter(r => !r.urban).map((r, i) => ({ ...r, pickIndex: i })),
      world.bridges,
      owners.flatMap(c => c.layouts),
    ).roads ?? [];
  const paths = new Map<number, Polyline[]>();
  for (const road of visible) {
    const list = paths.get(road.pickIndex) ?? [];
    list.push(road.path);
    paths.set(road.pickIndex, list);
  }
  let real = 0;
  world = { ...world, roads: world.roads!.map(r => (r.urban ? r : { ...r, editorPickPaths: paths.get(real++) ?? [] })), debug: { ...world.debug, v2UrbanRoadStamp: key } };
  cache.set(source, world);
  cache.set(world, world);
  return world;
}

/** Apply edits to the city source actually rendered, never to an extra regional stroke. */
export function syncUrbanRoadEdits(next: World, before: World): World {
  const owners = cities(before);
  if (!owners.length) return next;
  const snapshots = { ...(next.debug?.v2RustCities ?? {}) } as Record<string, RustTownSnapshot>,
    legacyEdits = { ...(next.debug?.v2LegacyStreetEdits ?? {}) } as Record<string, UrbanStreetEdit[]>,
    legacySources = { ...(next.debug?.v2LegacyRoadSources ?? {}) } as Record<string, UrbanRoadSources[]>;
  const projected = new Map<string, UrbanLayer>(),
    groups = new Map<string, Road[]>();
  for (const r of next.roads ?? [])
    if (r.urban) {
      const k = `${r.urban.key}/${r.urban.id}`,
        list = groups.get(k) ?? [];
      list.push(r);
      groups.set(k, list);
    }
  for (const city of owners) {
    const ids = new Map<string, { layout: string; original: Street | null }>();
    for (const source of city.sources) for (const s of source.streets) ids.set(urbanStreetId(source.layout, s), { layout: source.layout, original: s });
    for (const edit of city.edits) ids.set(edit.id, { layout: edit.layout, original: edit.original });
    for (const r of next.roads ?? []) if (r.urban?.key === city.key) ids.set(r.urban.id, { layout: r.urban.layout, original: r.urban.original });
    const edits: UrbanStreetEdit[] = [],
      changes: RoadChanges = { old: [], next: [] };
    let changed = false;
    for (const [id, origin] of ids) {
      const oldEdit = city.edits.find(e => e.id === id),
        oldParts = oldEdit?.parts ?? (origin.original ? [{ street: origin.original, part: '0' }] : []);
      const parts: UrbanRoadPart[] = (groups.get(`${city.key}/${id}`) ?? [])
        .sort((a, b) => a.urban!.part.localeCompare(b.urban!.part))
        .map(r => ({
          street: { path: r.path, widths: r.path.map(() => r.width), role: r.urban!.role, rank: r.urban!.rank },
          part: r.urban!.part,
          editorId: r.editorId,
          ...(r.controls ? { controls: r.controls, controlIndices: r.controlIndices } : {}),
          ...(r.routingVariant ? { routingVariant: r.routingVariant } : {}),
        }));
      const metadata = (parts: UrbanRoadPart[]) => parts.filter(p => p.controls || p.routingVariant).map(p => [p.controls, p.routingVariant]);
      const geometryChanged = !sameGeometry(oldParts, parts),
        metadataChanged = JSON.stringify(metadata(oldParts)) !== JSON.stringify(metadata(parts));
      if (!geometryChanged && !metadataChanged) {
        if (oldEdit) edits.push(oldEdit);
        continue;
      }
      changed = true;
      edits.push({ id, layout: origin.layout, original: origin.original, parts });
      if (geometryChanged) {
        changes.old.push(...oldParts.map(p => p.street.path));
        changes.next.push(...parts.map(p => p.street.path));
      }
    }
    if (!changed) continue;
    const layouts = replayUrbanRoadEdits(
      city.layouts.map(l => ({ ...l, streets: city.sources.find(s => s.layout === l.key)?.streets ?? l.streets })),
      edits,
    );
    if (city.snapshot)
      snapshots[city.key] = { ...city.snapshot, layouts, roadSources: city.sources, streetEdits: edits, pendingRoadChanges: { old: [...(city.snapshot.pendingRoadChanges?.old ?? []), ...changes.old], next: [...(city.snapshot.pendingRoadChanges?.next ?? []), ...changes.next] } };
    else {
      legacyEdits[city.key] = edits;
      legacySources[city.key] = city.sources;
    }
    if (city.urban) projected.set(city.key, { ...city.urban, streets: layouts.flatMap(l => l.streets.map(s => ({ path: s.path, widths: s.widths, width: width(s), rank: s.rank, kind: s.rank <= 1 ? ('main' as const) : ('street' as const), role: 'street' as const, phase: 0 }))) });
  }
  // A city street can also own the hidden regional stroke beneath it. Keep that source in sync,
  // otherwise deleting the city's copy makes the retired regional road reappear.
  const owned = new Map<string, Road[]>();
  for (const r of before.roads ?? [])
    if (r.urban) {
      const k = [at(r.path[0]), at(r.path.at(-1)!)].sort().join('/'),
        list = owned.get(k) ?? [];
      list.push(r);
      owned.set(k, list);
    }
  const oldRoads = before.roads ?? [],
    native = (next.debug?.v2RustRegion as { roads?: RoadOutput } | undefined)?.roads;
  const roads: Road[] = [],
    segments: RoadSegment[] = [];
  for (const [index, r] of (next.roads ?? []).entries()) {
    const original = !r.urban && oldRoads.find(o => !o.urban && (o === r || samePath(o.path, r.path)));
    const key = original && [at(original.path[0]), at(original.path.at(-1)!)].sort().join('/');
    const shadow = key && owned.get(key)?.find(o => original.path.every(p => nearestOnPolyline(o.path, p).distance < 1e-4) && o.path.every(p => nearestOnPolyline(original.path, p).distance < 1e-4));
    const replacement = shadow && (next.roads ?? []).filter(p => p.urban?.key === shadow.urban!.key && p.urban.id === shadow.urban!.id && (p.urban.part === shadow.urban!.part || p.urban.part.startsWith(shadow.urban!.part + ':')));
    const values = replacement ? replacement.map(p => ({ ...r, path: p.path, controls: p.controls, controlIndices: p.controlIndices, width: p.width, kind: p.kind })) : [r];
    for (const road of values) {
      roads.push(road);
      if (native) segments.push({ ...native.segments[index], path: road.path, width: road.width, length: polylineLength(road.path) });
    }
  }
  const world: World = {
    ...next,
    roads,
    debug: { ...next.debug, ...(native ? { v2RustRegion: { ...(next.debug!.v2RustRegion as object), roads: { ...native, segments } } } : {}), v2RustCities: snapshots, v2LegacyStreetEdits: legacyEdits, v2LegacyRoadSources: legacySources },
    settlements: next.settlements?.map(t => (projected.has(t.key) ? { ...t, urban: projected.get(t.key) } : t)),
  };
  const main = next.settlements?.find(t => t.main);
  if (main && projected.has(main.key)) world.urban = projected.get(main.key);
  delete world.debug!.v2UrbanRoadStamp;
  return editableUrbanRoads(world);
}

export function urbanRoadChangedKeys(before: World, next: World): string[] {
  const a = new Map(cities(before).map(c => [c.key, c])),
    out: string[] = [];
  for (const city of cities(next)) {
    const old = a.get(city.key);
    if (!old) continue;
    const ids = new Set([...old.edits, ...city.edits].map(e => e.id));
    if (
      [...ids].some(id => {
        const x = old.edits.find(e => e.id === id),
          y = city.edits.find(e => e.id === id),
          original = x?.original ?? y?.original;
        return !sameGeometry(x?.parts ?? (original ? [{ street: original, part: '0' }] : []), y?.parts ?? (original ? [{ street: original, part: '0' }] : []));
      })
    )
      out.push(city.key);
  }
  return out;
}

/** Final batch difference; intermediate drags must never expand the reconstruction scope. */
export function roadEditChanges(before: World, next: World): RoadChanges {
  const changes = (a: World, b: World): Polyline[] => {
    const other = b.roads ?? [],
      out: Polyline[] = [];
    for (const road of a.roads ?? []) {
      const peers = other.filter(r => (road.urban ? r.urban?.key === road.urban.key && r.urban.id === road.urban.id : !r.urban));
      if (peers.some(r => r.width === road.width && samePath(road.path, r.path))) continue;
      let run: Polyline = [];
      const flush = () => {
        if (run.length > 1) out.push(run);
        run = [];
      };
      for (let i = 1; i < road.path.length; i++) {
        const a = road.path[i - 1],
          b = road.path[i],
          steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 5));
        for (let j = 0; j < steps; j++) {
          const p = { x: a.x + ((b.x - a.x) * j) / steps, y: a.y + ((b.y - a.y) * j) / steps },
            q = { x: a.x + ((b.x - a.x) * (j + 1)) / steps, y: a.y + ((b.y - a.y) * (j + 1)) / steps },
            mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
          if (!peers.some(r => Math.abs(r.width - road.width) < 0.01 && nearestOnPolyline(r.path, mid).distance < 0.5)) {
            if (!run.length) run.push(p);
            run.push(q);
          } else flush();
        }
      }
      flush();
    }
    return out;
  };
  return { old: changes(before, next), next: changes(next, before) };
}

export function withRoadEditChanges(before: World, next: World, keys: readonly string[]): World {
  const changes = roadEditChanges(before, next),
    snapshots = { ...(next.debug?.v2RustCities ?? {}) } as Record<string, RustTownSnapshot>,
    internal = urbanRoadChangedKeys(before, next);
  for (const key of keys) if (snapshots[key]) snapshots[key] = { ...snapshots[key], pendingRoadChanges: { ...changes, adaptAccess: !internal.includes(key) } };
  return { ...next, debug: { ...next.debug, v2RustCities: snapshots } };
}
