/** Exact applied urban snapshots. Geometry is translated; architectural plans in
 * `resolved` remain opaque local data and are never rewritten by the UI. */
import type { Point, Shape } from '../../../rust/bridge/urban';
import type { PlacementBatch, PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import type { WorkshopState } from './testbenchUrban';
import type { UrbanBuildingState } from './urbanBuildingsPanel';

/** Only an explicitly applied population edits the identified city's metadata.
 * A multi-city snapshot without a target never broadcasts one population. */
export function applyWorkshopPopulation<T extends { key: string; population: number }>(sites: T[], state: Pick<WorkshopState, 'siteKey' | 'population' | 'layouts'>): T[] {
  const key = state.siteKey ?? (state.layouts?.length === 1 ? state.layouts[0].key : undefined);
  const population = state.population;
  if (!key || population === undefined || !Number.isInteger(population) || population < 1 || population > 5_000_000) return sites;
  return sites.map(site => site.key === key ? { ...site, population } : site);
}
export function buildingSettings(state?: UrbanBuildingState): Omit<UrbanBuildingState, 'scene'> | undefined {
  if (!state) return undefined;
  const { scene, ...settings } = state;
  return { ...settings, generated: settings.generated ?? !!scene };
}
export function workshopSettings(state: WorkshopState): Omit<WorkshopState, 'layouts' | 'partitions'> {
  const { layouts: _layouts, partitions: _partitions, ...settings } = state;
  return { ...settings, buildingState: buildingSettings(settings.buildingState) };
}
/** Applied native geometry is immutable. Detach editable settings, retain the
 * exact geometry objects for serialization and the single iframe message copy. */
export function appliedWorkshopSnapshot(state: WorkshopState): WorkshopState {
  const settings = structuredClone(workshopSettings(state));
  return { ...settings, layouts: state.layouts?.slice(), partitions: state.partitions?.slice(),
    buildingState: settings.buildingState && { ...settings.buildingState, scene: state.buildingState?.scene } };
}
const point = <T extends Point>(p: T, dx: number, dy: number): T => ({ ...p, x: p.x + dx, y: p.y + dy });
const shape = (s: Shape, dx: number, dy: number): Shape => ({ ...s,
  outer: s.outer.map(p => point(p, dx, dy)), holes: s.holes.map(h => h.map(p => point(p, dx, dy))) });
const surface = (s: Shape[], dx: number, dy: number): Shape[] => s.map(p => shape(p, dx, dy));

export function translateBuilding(building: PlacedBuilding, dx: number, dy: number): PlacedBuilding {
  return { ...building,
    transform: { ...building.transform, origin: point(building.transform.origin, dx, dy) },
    footprint: surface(building.footprint, dx, dy), roof_footprint: surface(building.roof_footprint, dx, dy), courtyards: surface(building.courtyards, dx, dy),
    circulation: surface(building.circulation, dx, dy), entrance: point(building.entrance, dx, dy),
    structural_foundations: building.structural_foundations?.map(foundation => ({ ...foundation, footprint: surface(foundation.footprint, dx, dy) })),
    structural_features: building.structural_features.map(feature => ({ ...feature,
      surface: surface(feature.surface, dx, dy), vertices3d: feature.vertices3d.map(p => point(p, dx, dy)),
      roof: feature.roof && { ...feature.roof, domain: surface(feature.roof.domain, dx, dy),
        arms: feature.roof.arms.map(arm => ({ ...arm, origin: point(arm.origin, dx, dy), domain: surface(arm.domain, dx, dy) })) },
    })),
    volumes: building.volumes.map(volume => ({ ...volume, foundation: { ...volume.foundation, footprint: surface(volume.foundation.footprint, dx, dy) }, footprint: surface(volume.footprint, dx, dy),
      levels: volume.levels.map(level => ({ ...level, footprint: surface(level.footprint, dx, dy) })),
      roof_mesh: { ...volume.roof_mesh, vertices: volume.roof_mesh.vertices.map(p => point(p, dx, dy)),
        groups: volume.roof_mesh.groups?.map(group => ({ ...group, domain: surface(group.domain, dx, dy) })) },
    })),
  };
}
export function translateBuildingScene(scene: PlacementBatch, dx: number, dy: number): PlacementBatch {
  return { ...scene, buildings: scene.buildings.map(building => translateBuilding(building, dx, dy)),
    open_spaces: scene.open_spaces.map(space => ({ ...space, surface: surface(space.surface, dx, dy) })) };
}
/** Layout and cadastral contracts contain points plus axis vectors. All coordinates
 * in programmes/reservations/contacts/envelopes obey the same local metric frame. */
function translateLand<T>(value: T, dx: number, dy: number): T {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(child => translateLand(child, dx, dy)) as T;
  const obj = value as Record<string, unknown>;
  if (typeof obj.x === 'number' && typeof obj.y === 'number') return point(obj as unknown as Point, dx, dy) as T;
  return Object.fromEntries(Object.entries(obj).map(([key, child]) => [key, key === 'axis' ? child : translateLand(child, dx, dy)])) as T;
}
export function translateWorkshopState(state: WorkshopState, dx: number, dy: number): WorkshopState {
  const built = state.buildingState;
  return { ...state, layouts: translateLand(state.layouts, dx, dy), partitions: translateLand(state.partitions, dx, dy),
    buildingState: built && { ...built, camera: built.camera && point(built.camera, dx, dy),
      scene: built.scene && translateBuildingScene(built.scene, dx, dy) } };
}
function parcelIds(state: WorkshopState, key: string): Set<string> {
  return new Set(state.partitions?.filter(p => p.key === key).flatMap(p => p.parcels.flatMap(p => p.id ? [p.id] : [])) ?? []);
}
function subset(scene: PlacementBatch, ids: Set<string>, included: boolean): PlacementBatch {
  return { ...scene, buildings: scene.buildings.filter(b => ids.has(b.parcel_id) === included),
    refusals: scene.refusals.filter(r => ids.has(r.parcel_id) === included),
    open_spaces: scene.open_spaces.filter(s => ids.has(s.parcel_id) === included) };
}
export function cityWorkshopState(state: WorkshopState, key: string): WorkshopState {
  const ids = parcelIds(state, key), settings = state.citySettings?.[key], built = state.buildingState;
  if (built?.scene && (built.scene.buildings.length || built.scene.refusals.length || built.scene.open_spaces.length) && ids.size === 0) throw new Error('La scène bâtie exige les identifiants des parcelles appliquées pour transférer cette ville.');
  return { ...state, ...(settings && { layoutConfig: settings.layoutConfig, parcelConfig: settings.parcelConfig, quarterSeed: settings.quarterSeed, parcelSeed: settings.parcelSeed }), siteKey: key, population: state.siteKey === key ? state.population : state.layouts?.find(l => l.key === key)?.programme?.population, layouts: state.layouts?.filter(l => l.key === key), partitions: state.partitions?.filter(p => p.key === key),
    buildingState: built && { ...built, ...settings?.building, scene: built.scene && subset(built.scene, ids, true) } };
}
/** Replace one city's applied result; unrelated cities retain exact accepted buildings. */
export function mergeCityWorkshop(previous: WorkshopState | undefined, incoming: WorkshopState, key: string, dx: number, dy: number): WorkshopState {
  if (!incoming.layouts?.length || incoming.layouts.some(layout => layout.key !== key)) {
    throw new Error('Le plan renvoyé doit provenir de la ville sélectionnée. Rechargez son plan depuis la carte.');
  }
  const moved = dx === 0 && dy === 0 ? incoming : translateWorkshopState(incoming, dx, dy), oldScene = previous?.buildingState?.scene;
  const ids = new Set([...(previous ? parcelIds(previous, key) : []), ...parcelIds(moved, key)]);
  const retained = oldScene && subset(oldScene, ids, false), next = moved.buildingState?.scene;
  const materials = new Map([...(retained?.materials ?? []), ...(next?.materials ?? [])].map(material => [material.id, material]));
  const combined = next || retained ? { ...(next ?? retained!), ...(materials.size ? { materials: [...materials.values()] } : {}),
    buildings: [...retained?.buildings ?? [], ...next?.buildings ?? []],
    refusals: [...retained?.refusals ?? [], ...next?.refusals ?? []],
    open_spaces: [...retained?.open_spaces ?? [], ...next?.open_spaces ?? []] } : undefined;
  const built = moved.buildingState ?? previous?.buildingState;
  const retainedPartitions = previous?.partitions?.filter(p => p.key !== key) ?? [];
  return { ...moved,
    citySettings: { ...previous?.citySettings, ...moved.citySettings },
    layouts: [...previous?.layouts?.filter(l => l.key !== key) ?? [], ...moved.layouts ?? []],
    partitions: moved.partitions ? [...retainedPartitions, ...moved.partitions] : retainedPartitions.length ? retainedPartitions : undefined,
    buildingState: built && { ...built, scene: combined },
  };
}

/** Split a multi-city native reply by exact parcel ownership before replacement. */
export function mergeWorkshopCities(previous: WorkshopState, incoming: WorkshopState): WorkshopState {
  let merged = previous;
  for (const layout of incoming.layouts ?? []) merged = mergeCityWorkshop(merged, cityWorkshopState(incoming, layout.key), layout.key, 0, 0);
  return merged;
}
