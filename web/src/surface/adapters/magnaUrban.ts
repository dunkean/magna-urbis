import type { Decor } from '../../ui/decor';
import type { Building3dScene } from '../../render/urbanBuildingGeometry';
import type { Surface } from '../../../../rust/bridge/housesContract';
import { exportMagnaBuildings } from './magna';
import { fingerprint } from '../compiler';
import { packUrbanColumns, type UrbanColumns, type UrbanPacket } from '../urbanColumns';
import type { SurfaceRoad } from './occupation';

export function magnaRoads(decor?: Pick<Decor, 'meta'>, override?: readonly SurfaceRoad[]): SurfaceRoad[] {
  if (override) return override.map((road, sourceIndex) => ({ ...structuredClone(road), sourceIndex: road.sourceIndex ?? sourceIndex }));
  return (decor?.meta.roads?.segments ?? []).map((road, sourceIndex) => ({ sourceIndex, points: road.path.map(p => [p.x, p.y] as [number, number]),
    widthM: road.width, surface: road.surface, class: road.class, profile: road.profile, a: road.a, b: road.b }));
}

/** Single producer for offline export, worker source, synchronous live and direct
 * compile inputs. Roads and every source geometry share the same physical frame. */
export function magnaUrbanPacket(decor: Pick<Decor, 'meta'> | undefined, scene?: Building3dScene, dx = 0, dz = 0,
  roadsOverride?: readonly SurfaceRoad[], encoding: 'json' | 'binary' = 'json'): UrbanPacket | UrbanColumns {
  if (![dx, dz].every(Number.isFinite)) throw new Error('Urban frame translation must be finite.');
  const buildings = scene ?? decor?.meta.pipeline?.urban?.buildingState?.scene ?? { buildings: [] };
  if (!scene && decor?.meta.pipeline?.urban?.buildingState?.cold) throw new Error('Cold native buildings require their retained source scene.');
  const packet = exportMagnaBuildings(buildings);
  const move = (surface: Surface | undefined) => { for (const shape of surface ?? []) for (const ring of [shape.outer, ...shape.holes]) for (const p of ring) { p.x += dx; p.y += dz; } };
  for (const building of packet.buildings) {
    move(building.footprint); move(building.roofFootprint);
    for (const t of building.triangles) for (const p of t.points) { p[0] += dx; p[2] += dz; }
    for (const volume of building.nativeLevels ?? []) for (const level of volume.levels) {
      const physical = level as typeof level & { floor?: Surface; roof_slab?: { surface: Surface } | null };
      move(physical.footprint); move(physical.floor); if (physical.roof_slab) move(physical.roof_slab.surface);
    }
  }
  for (const building of packet.occupationBuildings) {
    for (const s of building.surfaces) move(s);
    for (const c of building.groundConstraints) move(c.footprint);
    for (const volume of building.nativeLevels ?? []) for (const level of volume.levels) {
      const physical = level as typeof level & { floor?: Surface; roof_slab?: { surface: Surface } | null };
      move(physical.footprint); move(physical.floor); if (physical.roof_slab) move(physical.roof_slab.surface);
    }
  }
  const urban: UrbanPacket = { ...packet, roadsCoordinateSystem: 'metric-xz', footprintsCoordinateSystem: 'metric-xz-as-xy',
    sourceToWorldTranslation: { x: dx, z: dz },
    presentation: { sourceSystem: 'magna-urbis', mapStyle: decor ? new URLSearchParams(decor.meta.query).get('style') : null,
      urbanStyle: decor?.meta.pipeline?.urban?.style ?? null, buildingAppearance: structuredClone(decor?.meta.pipeline?.urban?.buildingState?.appearance ?? null),
      materialCatalogSchema: 'magna-native-house-materials-1', materialIdSemantics: 'opaque-native-house-ids',
      sourceReferences: { decorId: decor?.meta.id ?? null, queryReference: 'source.meta.query', queryFingerprint: fingerprint(decor?.meta.query ?? '') } },
    roads: magnaRoads(decor, roadsOverride).map(road => ({ ...road, points: road.points.map(([x, z]) => [x + dx, z + dz]) })) };
  return encoding === 'binary' ? packUrbanColumns(urban) : urban;
}

/** Shared across JSON and binary representations; versions hash typed bytes. */
export function magnaUrbanIdentity(urban: UrbanPacket | UrbanColumns): string {
  return fingerprint(urban.format === 'magna-urban-columns' ? urban : packUrbanColumns(urban));
}
