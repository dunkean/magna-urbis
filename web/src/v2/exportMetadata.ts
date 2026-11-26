import { featureNameKey } from '../gen/names/identity';
import type { Vec2, World } from '../gen/types';
import type { PlacementBatch } from '../../../rust/bridge/urbanArchitecture';
import type { ExportRect } from '../ui/exportCropGeometry';
import type { ExportLayers } from '../render/exportLayers';
import { activityScene, activitySitesOf } from './activitySites';
import { nativeCityRecords, nativeCitiesOf } from './nativeProducts';

type Shape = { outer: readonly Vec2[]; holes?: readonly (readonly Vec2[])[] };
interface Feature {
  id: string;
  kind: string;
  type: string;
  name: string | null;
  settlement?: string;
  position?: Vec2;
  path?: readonly Vec2[];
  footprint?: readonly Shape[];
  sourceId?: string | number;
}

export interface MapMetadata {
  schema: 'magna-urbis-map-1';
  name: string | null;
  coordinates: 'world-metres-east-south';
  area: ExportRect;
  features: Feature[];
}

const pointKey = (p: Vec2): string => `${p.x},${p.y}`;
const namedKey = (kind: string, source: object, path: readonly Vec2[]): string => featureNameKey({ ...source }, kind, path.map(pointKey).join(';'));

export function mapMetadata(world: World, area: ExportRect, layers: Partial<ExportLayers>): MapMetadata {
  const features: Feature[] = [];
  const known = new Set<string>();
  const names = new Map<string, string>();
  for (const entry of world.names?.entries ?? []) {
    if (!entry.text) continue;
    if (entry.entityKey) names.set(entry.entityKey, entry.text);
    names.set(entry.id, entry.text);
  }
  const add = (record: Omit<Feature, 'name'> & { name?: string | null }): void => {
    const rings = record.footprint?.map(s => s.outer) ?? [];
    const paths = [...rings, record.path ?? [], record.position ? [record.position] : []];
    const inArea = paths.some(path => path.length > 0 && !path.every(p => p.x < area.x) && !path.every(p => p.y < area.y) && !path.every(p => p.x > area.x + area.width) && !path.every(p => p.y > area.y + area.height));
    if (!inArea || known.has(record.id)) return;
    known.add(record.id);
    features.push({ ...record, name: names.get(record.id) ?? record.name ?? null });
  };
  const allNative = nativeCityRecords(world) ?? {};
  const displayedNative = new Map(nativeCitiesOf(world).flatMap(city => city.layouts.map(layout => [layout.key, city] as const)));
  if (layers.city !== false) {
    for (const place of world.settlements ?? []) add({ id: `settlement:${place.key}`, kind: 'settlement', type: place.cls, name: place.name, position: place.core ?? place.center, ...(place.extent?.length ? { footprint: [{ outer: place.extent }] } : {}) });
    const addBuildings = (city: string | undefined, buildings: PlacementBatch['buildings']): void => {
      for (const building of buildings) {
        const programme = building as typeof building & { programme?: { role?: string; label?: string; landmark?: boolean } };
        const id = city === undefined ? `activity:building:${encodeURIComponent(building.id)}` : `urban:${encodeURIComponent(city)}:building:${encodeURIComponent(building.id)}`;
        add({ id, kind: 'building', type: programme.programme?.role || building.function || building.variant_id || 'building', name: programme.programme?.landmark ? programme.programme.label : undefined, settlement: city, sourceId: building.id, footprint: building.footprint });
      }
    };
    for (const [key, retained] of Object.entries(allNative)) {
      const city = retained.layouts.map(layout => displayedNative.get(layout.key)).find(current => current !== undefined);
      if (!city) continue;
      addBuildings(key, city.scene?.buildings ?? []);
      for (const layout of city.layouts) {
        const scope = `urban:${encodeURIComponent(key)}`;
        for (const [index, quarter] of layout.quarters.entries()) add({ id: `${scope}:quarter:${encodeURIComponent(layout.key)}:${index}`, kind: 'quarter', type: quarter.zone ?? 'quarter', settlement: key, footprint: [quarter.shape] });
        for (const [index, wall] of (layout.enclosures ?? []).entries()) {
          const id = `${scope}:wall:${wall.edit_key || index}`;
          add({ id, kind: 'wall', type: wall.style ?? wall.kind, settlement: key, path: wall.path });
          wall.gates.forEach((position, gate) => add({ id: `${id}:gate:${gate}`, kind: 'gate', type: 'gate', settlement: key, position }));
        }
        for (const [index, quay] of (layout.structure?.quays ?? []).entries()) add({ id: `${scope}:harbour:${index}`, kind: 'harbour', type: quay.kind, settlement: key, footprint: [quay.shape] });
        for (const [index, waterways] of (layout.structure?.waterways ?? []).entries()) add({ id: `${scope}:waterway:${index}`, kind: 'waterway', type: waterways.kind ?? 'canal', settlement: key, footprint: [waterways.shape] });
      }
      for (const partition of city.partitions ?? [])
        for (const [index, parcel] of partition.parcels.entries())
          add({ id: `urban:${encodeURIComponent(key)}:parcel:${encodeURIComponent(partition.key)}:${encodeURIComponent(parcel.id ?? String(index))}`, kind: 'parcel', type: parcel.use, settlement: key, footprint: [parcel.shape] });
    }
    const activities = activityScene(world);
    if (activities) addBuildings(undefined, activities.buildings);
    activitySitesOf(world).forEach((site, i) => add({ id: `activity:${site.id ?? i}`, kind: 'activity', type: site.kind, settlement: site.parent, position: { x: site.x, y: site.y }, footprint: site.buildings.map(b => ({ outer: b.ring })) }));
    for (const [i, farm] of (world.landuse?.farmsteads ?? []).entries()) {
      const id = namedKey('farm', farm, [farm.pos]);
      add({ id, kind: 'farm', type: farm.type ?? 'farmstead', position: farm.pos, footprint: (farm.lot ? [farm.lot] : farm.buildings).map(outer => ({ outer })) });
      const parts = farm.parts?.length ? farm.parts : farm.buildings.map(poly => ({ poly, use: 'house' }));
      for (const [j, part] of parts.entries()) add({ id: `${id}:building:${j}`, kind: 'building', type: part.use, sourceId: `farm:${i}:${j}`, footprint: [{ outer: part.poly }] });
    }
  }
  // Older projects and imported plans can have urban geometry without a native placement batch.
  const towns = new Map((world.settlements ?? []).map(place => [place.key, place.urban]));
  if (world.urban && ![...towns.values()].includes(world.urban)) towns.set('main', world.urban);
  for (const [key, town] of towns) {
    if (!town) continue;
    const native = !!allNative[key] || (key === 'main' && !!(world.settlements ?? []).find(place => place.main && allNative[place.key]));
    const scope = key === 'main' ? 'classic' : `classic:${encodeURIComponent(key)}`;
    if (layers.city !== false && !native) {
      for (const [i, building] of town.buildings.entries()) add({ id: `${scope}:building:${i}`, kind: 'building', type: building.kind, settlement: key, footprint: [{ outer: building.poly, holes: building.courtyards }] });
      for (const [i, quarter] of town.quarters.entries()) add({ id: `${scope}:quarter:${i}`, kind: 'quarter', type: 'quarter', settlement: key, footprint: [quarter.poly] });
    }
    if (layers.streets !== false) for (const street of town.streets) add({ id: namedKey('street', street, street.path), kind: 'street', type: street.kind, settlement: key, path: street.path });
  }
  if (layers.roads !== false)
    for (const road of world.roads ?? []) {
      if (road.urban) continue;
      add({ id: namedKey('road', road, road.path), kind: 'road', type: road.editorClass ?? road.kind, path: road.path });
    }
  if (layers.roads !== false || layers.streets !== false) for (const [i, bridge] of (world.bridges ?? []).entries()) add({ id: `bridge:${i}`, kind: 'bridge', type: 'bridge', path: [bridge.a, bridge.b] });
  if (layers.water !== false) {
    for (const river of world.terrain.rivers) add({ id: namedKey('river', river, river.path), kind: 'river', type: river.cls ?? 'river', sourceId: river.id, name: river.name, path: river.path });
    for (const ring of world.terrain.lakes) add({ id: namedKey('lake', ring, ring), kind: 'lake', type: 'lake', footprint: [{ outer: ring }] });
    for (const [i, ring] of world.terrain.coastline.entries()) add({ id: `sea:${i}`, kind: 'sea', type: 'sea', footprint: [{ outer: ring }] });
  }
  if (layers.landuse !== false)
    for (const [i, patch] of (world.landuse?.areas ?? []).entries()) {
      const id = patch.kind === 'forest' ? namedKey('forest', patch, patch.poly) : `landuse:${i}`;
      add({ id, kind: patch.kind, type: patch.cultivation ?? patch.kind, footprint: [{ outer: patch.poly, holes: patch.holes }] });
    }
  const allowed = (kind: string): boolean =>
    ['river', 'lake', 'sea'].includes(kind) ? layers.water !== false : kind === 'road' ? layers.roads !== false : kind === 'street' ? layers.streets !== false : ['forest', 'hill'].includes(kind) ? layers.terrain !== false : layers.city !== false;
  // Named landmarks and natural features without a separate recorded shape still have a map anchor.
  for (const entry of world.names?.entries ?? []) if (allowed(entry.kind)) add({ id: entry.entityKey ?? entry.id, kind: entry.kind, type: entry.parts?.role ?? entry.kind, name: entry.text || null, position: entry.anchor, path: entry.path, settlement: entry.cityKey });
  return { schema: 'magna-urbis-map-1', name: world.names?.town ?? null, coordinates: 'world-metres-east-south', area, features };
}
