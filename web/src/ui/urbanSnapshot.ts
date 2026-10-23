/** Exact applied urban snapshots. Geometry is translated; architectural plans in
 * `resolved` remain opaque local data and are never rewritten by the UI. */
import type { Point, Shape } from '../../../rust/bridge/urban';
import type { PlacementBatch, PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import { isArchivedPlan, registerPlanArchives } from '../../../rust/bridge/compactPlanArchive';
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
export function buildingSettings(state?: UrbanBuildingState): Omit<UrbanBuildingState, 'scene' | 'cold'> | undefined {
  if (!state) return undefined;
  const { scene, cold, ...settings } = state;
  return { ...settings, generated: settings.generated ?? !!(scene || cold) };
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
    buildingState: settings.buildingState && { ...settings.buildingState, scene: state.buildingState?.scene, cold: state.buildingState?.cold } };
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
    ...(building.cartographic && { cartographic: { ...building.cartographic, ridges: building.cartographic.ridges.map(([a,b]) => [point(a,dx,dy),point(b,dx,dy)] as [Point,Point]) } }),
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
      cold: built.cold && { ...built.cold, offset: { x: (built.cold.offset?.x ?? 0) + dx, y: (built.cold.offset?.y ?? 0) + dy } },
      scene: built.scene && translateBuildingScene(built.scene, dx, dy) } };
}
function parcelIds(state: WorkshopState, key: string): Set<string> {
  return new Set(state.partitions?.filter(p => p.key === key).flatMap(p => p.parcels.flatMap(p => p.id ? [p.id] : [])) ?? []);
}
function subset(scene: PlacementBatch, ids: Set<string>, included: boolean): PlacementBatch {
  const result = { ...scene, buildings: scene.buildings.filter(b => ids.has(b.parcel_id) === included),
    refusals: scene.refusals.filter(r => ids.has(r.parcel_id) === included),
    open_spaces: scene.open_spaces.filter(s => ids.has(s.parcel_id) === included) };
  if (scene.plan_archives) {
    const used = new Set(result.buildings.map(b => b.resolved).filter(isArchivedPlan).map(ref => ref.archive_id));
    result.plan_archives = Object.fromEntries(Object.entries(scene.plan_archives).filter(([id]) => used.has(id)));
    registerPlanArchives(result);
  }
  return result;
}
function hasSceneContent(scene: PlacementBatch | undefined): boolean {
  return !!scene && !!(scene.buildings.length || scene.refusals.length || scene.open_spaces.length);
}
export function cityWorkshopState(state: WorkshopState, key: string): WorkshopState {
  const ids = parcelIds(state, key), settings = state.citySettings?.[key], built = state.buildingState;
  if (built?.cold && (built.cold.cityKey ?? (state.layouts?.length === 1 ? state.layouts[0].key : undefined)) !== key)
    throw new Error('Le stockage des maisons doit appartenir à la ville sélectionnée.');
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
  const previousCold = previous?.buildingState?.cold, incomingCold = moved.buildingState?.cold;
  if (previousCold && (previousCold.cityKey ?? (previous?.layouts?.length === 1 ? previous.layouts[0].key : undefined)) !== key)
    throw new Error('La fusion de plusieurs stockages de maisons distincts doit être conservée avant remplacement.');
  if (incomingCold) {
    if ((incomingCold.cityKey ?? key) !== key || oldScene?.buildings.some(b => !ids.has(b.parcel_id))
      || oldScene?.refusals.some(b => !ids.has(b.parcel_id)) || oldScene?.open_spaces.some(b => !ids.has(b.parcel_id)))
      throw new Error('La fusion de maisons en mémoire et de stockages distincts nécessite une migration complète.');
    return { ...moved, citySettings: { ...previous?.citySettings, ...moved.citySettings },
      layouts: [...previous?.layouts?.filter(l => l.key !== key) ?? [], ...moved.layouts ?? []],
      partitions: [...previous?.partitions?.filter(p => p.key !== key) ?? [], ...moved.partitions ?? []],
      buildingState: { ...moved.buildingState!, scene: undefined, cold: { ...incomingCold, cityKey: key } } };
  }
  const retained = oldScene && subset(oldScene, ids, false), next = moved.buildingState?.scene;
  const retainedContent = hasSceneContent(retained), nextContent = hasSceneContent(next);
  if (retainedContent && nextContent && (retained!.schema_version !== next!.schema_version || retained!.generator_version !== next!.generator_version)) {
    throw new Error('Les scènes bâties utilisent des versions incompatibles. Régénérez ensemble les villes conservées avant de les fusionner.');
  }
  // An empty reply may remove one city, but cannot relabel the accepted plans
  // of another city or replace their material/archive metadata with a new version.
  const retainedData = retainedContent || !nextContent ? retained : undefined;
  const nextData = nextContent || !retainedContent ? next : undefined;
  const materials = new Map([...(retainedData?.materials ?? []), ...(nextData?.materials ?? [])].map(material => [material.id, material]));
  const combined = next || retained ? { ...(nextData ?? retainedData!), ...(materials.size ? { materials: [...materials.values()] } : {}),
    ...((nextData?.plan_archives || retainedData?.plan_archives) && {plan_archives: {...retainedData?.plan_archives,...nextData?.plan_archives}}),
    buildings: [...retained?.buildings ?? [], ...next?.buildings ?? []],
    refusals: [...retained?.refusals ?? [], ...next?.refusals ?? []],
    open_spaces: [...retained?.open_spaces ?? [], ...next?.open_spaces ?? []] } : undefined;
  if (combined?.plan_archives) registerPlanArchives(combined);
  const built = moved.buildingState ?? previous?.buildingState;
  const retainedPartitions = previous?.partitions?.filter(p => p.key !== key) ?? [];
  return { ...moved,
    citySettings: { ...previous?.citySettings, ...moved.citySettings },
    layouts: [...previous?.layouts?.filter(l => l.key !== key) ?? [], ...moved.layouts ?? []],
    partitions: moved.partitions ? [...retainedPartitions, ...moved.partitions] : retainedPartitions.length ? retainedPartitions : undefined,
    buildingState: built && { ...built, cold: undefined, scene: combined },
  };
}

/** Split a multi-city native reply by exact parcel ownership before replacement. */
export function mergeWorkshopCities(previous: WorkshopState, incoming: WorkshopState): WorkshopState {
  let merged = previous;
  if (incoming.layouts?.length && previous.buildingState?.scene) {
    // Remove all replaced cities before the first merge, so a full multi-city
    // replacement can adopt a new version atomically. Unrelated cities still
    // participate in the compatibility guard; native archives stay opaque.
    const ids = new Set(incoming.layouts.flatMap(layout => [...parcelIds(previous, layout.key), ...parcelIds(incoming, layout.key)]));
    merged = { ...previous, buildingState: { ...previous.buildingState, scene: subset(previous.buildingState.scene, ids, false) } };
  }
  for (const layout of incoming.layouts ?? []) merged = mergeCityWorkshop(merged, cityWorkshopState(incoming, layout.key), layout.key, 0, 0);
  return merged;
}
