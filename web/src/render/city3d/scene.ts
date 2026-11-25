/**
 * Scene classification and native/projection display assembly. Called by the City 3D scene adapter and sibling mesh builders.
 * Silhouettes and compact plans receive display volumes; complete native geometry passes through unchanged to the shared sector/culling/picking pass.
 * Reads/writes: Reads source scenes and optional details; returns display batches and kind counts, preserving native records and projection identity.
 */
import type { PlacementBatch, PlacedBuilding } from '../../../../rust/bridge/urbanArchitecture';
import { isBuildingProjection, type Building3dScene, type Building3dVisual } from '../urbanBuildingGeometry';
import type { NativeBuildingProjection, NativeBuildingProjectionScene } from '../../ui/urbanBuildingProjection';
import type { ParentMember3dVisual, Parent3dScene } from '../../ui/urbanParent3d';
import { City3dHeight } from './types';
import { silhouetteBuilding, silhouetteSeats } from './silhouette';
import { compactBuilding } from './compact';
import { CITY3D_MATERIALS } from './materials';
import { planEave, seatPlan, wholeSeat, type PieceSeat, type SeatGround } from './terrainSeat';

export type City3dKind = 'silhouette' | 'compact' | 'detailed';

export interface City3dDisplayScene extends Building3dScene {
  buildings: Building3dVisual[];
  kinds: Record<City3dKind, number>;
}

export const city3dDisplayKind = (building: Building3dVisual): City3dKind => (isBuildingProjection(building) ? 'compact' : city3dKind(building));

/** A shared exterior belongs to this exact indexed accepted-plan projection. */
export function projectionDetailMatches(base: NativeBuildingProjection | ParentMember3dVisual, detail: PlacedBuilding): boolean {
  if (base.projection === 'native-parent-member-3d-1') return false;
  return (
    detail.id === base.id &&
    detail.parcel_id === base.parcel_id &&
    detail.function === base.function &&
    detail.recipe_id === base.recipe_id &&
    detail.variant_id === base.variant_id &&
    detail.ground_z_m === base.ground_z_m &&
    detail.footprint === base.footprint &&
    detail.roof_footprint === base.roof_footprint
  );
}

/** Cold accepted plans stay typed projections. Geometry/picking display their
 * exact contours and recorded height; no guessed roof/native record is made. */
export function city3dProjectionScene(scene: NativeBuildingProjectionScene | Parent3dScene, options: { details?: ReadonlyMap<string, PlacedBuilding> } = {}): City3dDisplayScene {
  const kinds: Record<City3dKind, number> = { silhouette: 0, compact: 0, detailed: 0 };
  const buildings = scene.buildings.map(base => {
    const detail = options.details?.get(base.id);
    if (detail && projectionDetailMatches(base, detail)) {
      kinds.detailed++;
      return detail;
    }
    kinds.compact++;
    return base;
  });
  return { buildings, materials: scene.materials, kinds, occupationBuildings: scene.buildings };
}

export const city3dKind = (building: PlacedBuilding): City3dKind => (building.recipe_id === 'silhouette' || !building.volumes.length ? 'silhouette' : building.volumes.some(v => v.roof_mesh?.faces.length) ? 'detailed' : 'compact');

/** Above this many tree dwellings in a town, each one uses its light mesh. */
const LIGHT_TREES_FROM = 400;

const hasTreeDwelling = (b: PlacedBuilding): boolean => {
  const massing = (b as PlacedBuilding & { programme?: { massing?: { volumes?: { form?: string }[] }[] } }).programme?.massing;
  return Array.isArray(massing) && massing.some(m => m?.volumes?.some(v => v.form === 'tree'));
};

/** An activity building drawn from its massing (activitySites.ts `massingScene`), not a native plan. */
const activityMassing = (b: PlacedBuilding): boolean => b.recipe_id.startsWith('activity:') && Array.isArray((b as PlacedBuilding & { programme?: { massing?: unknown } }).programme?.massing);

/** What city3dScene seats buildings on: the ground as drawn (`heightAt`), the natural ground their floors are cut into
 * (`ground`, the drawn one by default) and the water under them, the realized native exteriors that replace buildings by id,
 * and whether the massing's built terraces are drawn (true by default). */
export interface City3dSceneOptions {
  heightAt?: City3dHeight;
  ground?: SeatGround;
  waterAt?: City3dHeight;
  details?: ReadonlyMap<string, PlacedBuilding>;
  terraces?: boolean;
}

/** A building drawn from its silhouette: the activity sites (mills, farms, chapels: activitySites.ts) carry the city massing. */
const drawnKind = (source: PlacedBuilding): City3dKind => (activityMassing(source) ? 'silhouette' : city3dKind(source));

/** Seats of the footprint pieces of a building on the natural ground, as city3dScene seats it: what the ground is shaped to
 * (ui/urbanGroundShape.ts). */
export function buildingSeats(source: PlacedBuilding, ground: SeatGround, waterAt?: City3dHeight): PieceSeat[] {
  if (drawnKind(source) === 'silhouette') return silhouetteSeats(source, ground, waterAt);
  const seat = wholeSeat(source, planEave(source), ground);
  return source.footprint.map(() => seat);
}

/** Display batch for the 3D pass. `details` replaces buildings by their realized
 * native exterior (same id). Ids, parcels and functions are those of the scene. */
export function city3dScene(scene: PlacementBatch, options: City3dSceneOptions = {}): PlacementBatch & { kinds: Record<City3dKind, number> } {
  const kinds: Record<City3dKind, number> = { silhouette: 0, compact: 0, detailed: 0 };
  // Thousands of full tree meshes exceed the page's 4 GB and kill it (elven 10k).
  const lightTrees = scene.buildings.filter(hasTreeDwelling).length > LIGHT_TREES_FROM;
  const { heightAt, waterAt, ground } = options;
  const buildings = scene.buildings.map(source => {
    const detail = options.details?.get(source.id);
    if (detail) {
      kinds.detailed++;
      return seatPlan(detail, heightAt, ground);
    }
    // Native plans are seated on the terrain like the town volumes (seatPlan).
    const kind = drawnKind(source);
    kinds[kind]++;
    if (kind === 'silhouette') return silhouetteBuilding(source, heightAt, waterAt, lightTrees, options.terraces ?? true, ground);
    const seated = seatPlan(source, heightAt, ground);
    return kind === 'compact' ? compactBuilding(seated) : seated;
  });
  return { ...scene, materials: [...(scene.materials ?? []), ...CITY3D_MATERIALS], buildings, kinds };
}
