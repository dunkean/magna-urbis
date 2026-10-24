/** Native plan cartography only. This DTO cannot be sent to native realization.
 * Outline/ridge children are immutable source geometry, never a parent plan. */
import type { HouseMaterial, MaterialSlots, Surface } from '../../../rust/bridge/housesContract';
import type { ArchitectureCulture, PlacementBatch, PlacedBuilding, PlacementRefusal } from '../../../rust/bridge/urbanArchitecture';
import type { BuildingLodScene, CompactBuildingVisual } from '../render/urbanBuildingLod';
import { retainedProgrammeOutcome, type RetainedProgrammeOutcome } from '../render/programmeOutcome';

export interface NativeBuildingProjection extends CompactBuildingVisual {
  readonly projection: 'native-building-visual-1';
  readonly nativeRealization: false;
  readonly parcel_id: string; readonly recipe_id: string; readonly variant_id: string;
  readonly culture: ArchitectureCulture;
  readonly useful_area_m2: number; readonly domestic_units: number;
  /** Optional native scalar report; it never certifies household capacity. */
  readonly programme_outcome?: RetainedProgrammeOutcome;
  readonly height_m: number; readonly ground_z_m: number;
  /** Exact child surfaces used by the existing forest exclusion contract. */
  readonly occupation_surfaces: readonly Surface[];
  /** Existing terrain-display constraints, never inferred bearing parts. */
  readonly ground_constraints: readonly { readonly footprint: Surface; readonly height_m: number }[];
  readonly volumes?: never; readonly resolved?: never; readonly plan_archives?: never; readonly structural_features?: never;
}
/** Preserve legacy terrain/forest inputs using only child surfaces/scalars. */
export function buildingOccupationSurfaces(building: PlacedBuilding | NativeBuildingProjection): readonly Surface[] {
  return 'projection' in building ? building.occupation_surfaces
    : [building.footprint, building.circulation, ...(building.structural_features ?? []).map(f => f.surface)];
}
export function buildingGroundConstraints(building: PlacedBuilding | NativeBuildingProjection): readonly { readonly footprint: Surface; readonly height_m: number }[] {
  return 'projection' in building ? building.ground_constraints
    : [{ footprint: building.footprint, height_m: building.ground_z_m },
      ...(building.structural_foundations ?? []).map(f => ({ footprint: f.footprint, height_m: f.z_max_m }))];
}
export interface NativeProjectionMetrics {
  /** Metrics describe only the provided records, never an inferred city capacity. */
  scope: 'provided-records'; buildings: number; refusals: number; openSpaces: number; errors: number;
  usefulAreaM2: number; domesticUnits: number;
}
/** Detached display metadata: never a native refusal/parent object. */
export type NativeBuildingProjectionRefusal = Readonly<Pick<PlacementRefusal, 'id' | 'parcel_id' | 'code' | 'message'>>;
export interface NativeBuildingProjectionScene extends BuildingLodScene<NativeBuildingProjection> {
  projection: 'native-building-visual-scene-1'; metrics: NativeProjectionMetrics;
  refusals?: readonly NativeBuildingProjectionRefusal[];
}
const slots = (value: MaterialSlots): MaterialSlots => Object.freeze({ frame: value.frame, infill: value.infill,
  coating: value.coating, cladding: value.cladding, base: value.base, roof_frame: value.roof_frame });
export function projectNativeBuilding(building: PlacedBuilding): NativeBuildingProjection {
  if (building.simplification !== 'architectural_plan') throw new Error('Native visual projection requires a retained architectural plan.');
  const height = building.cartographic?.height_m ?? building.volumes.reduce((n, v) =>
    Math.max(n, v.z_m + v.wall_height_m + v.roof_height_m - building.ground_z_m), 0);
  if (![height, building.ground_z_m, building.useful_area_m2, building.domestic_units].every(Number.isFinite)) throw new Error('Invalid native projection metrics.');
  const c = building.culture, cartography = building.cartographic, material = building.volumes[0]?.materials;
  const programmeOutcome = retainedProgrammeOutcome(building.programme_outcome);
  return Object.freeze({ projection: 'native-building-visual-1', nativeRealization: false,
    id: building.id, parcel_id: building.parcel_id, recipe_id: building.recipe_id, variant_id: building.variant_id,
    culture: Object.freeze({ culture: c.culture, pack: c.pack, mode: c.mode, borrowing: c.borrowing }), function: building.function,
    footprint: building.footprint, roof_footprint: building.roof_footprint,
    entrance: Object.freeze({ x: building.entrance.x, y: building.entrance.y }), ground_z_m: building.ground_z_m, height_m: height,
    useful_area_m2: building.useful_area_m2, domestic_units: building.domestic_units,
    ...(programmeOutcome ? { programme_outcome: programmeOutcome } : {}),
    occupation_surfaces: Object.freeze([...buildingOccupationSurfaces(building)]),
    ground_constraints: Object.freeze(buildingGroundConstraints(building).map(c => Object.freeze({ footprint: c.footprint, height_m: c.height_m }))),
    ...(material ? { materials: slots(material) } : {}),
    ...(cartography ? { cartographic: Object.freeze({ height_m: cartography.height_m, ridges: cartography.ridges,
      ...(cartography.roof_system !== undefined ? { roof_system: cartography.roof_system } : {}) }) } : {}),
  });
}

/** No meshes, levels, archives or full records are captured in the result. */
export function projectNativeBuildingRecords(buildings: readonly PlacedBuilding[], catalogue: readonly HouseMaterial[] = []): NativeBuildingProjectionScene {
  const projected = buildings.map(projectNativeBuilding), used = new Set(projected.flatMap(b => Object.values(b.materials ?? {})));
  const materialIndex = new Map<string, HouseMaterial>();
  for (const material of catalogue) {
    if (!used.has(material.id)) continue;
    const copy: HouseMaterial = { id: material.id, label: material.label, roles: [...material.roles], pattern: material.pattern,
      origin: material.origin, source_ref: material.source_ref };
    const previous = materialIndex.get(copy.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(copy)) throw new Error(`Conflicting native projection material: ${copy.id}`);
    if (!previous) { Object.freeze(copy.roles); materialIndex.set(copy.id, Object.freeze(copy)); }
  }
  const materials = [...materialIndex.values()]; Object.freeze(materials);
  return Object.freeze({ projection: 'native-building-visual-scene-1', buildings: Object.freeze(projected), materials, refusals: Object.freeze([]),
    metrics: Object.freeze({ scope: 'provided-records', buildings: buildings.length, refusals: 0, openSpaces: 0, errors: 0,
      usefulAreaM2: projected.reduce((n, b) => n + b.useful_area_m2, 0), domesticUnits: projected.reduce((n, b) => n + b.domestic_units, 0) }) });
}
/** Use after durable stage.append, before dropping the <=64-record input delta.
 * A consumer may append this DTO to UrbanBuildingLodRenderer<NativeBuildingProjection>.
 * It must never append the original delta just to recover cartography. */
export function projectNativeBuildingChunk(delta: PlacementBatch): NativeBuildingProjectionScene {
  const scene = projectNativeBuildingRecords(delta.buildings, delta.materials);
  const refusals = delta.refusals.map(refusal => {
    const { id, parcel_id, code, message } = refusal;
    if (![id, parcel_id, code, message].every(value => typeof value === 'string')) throw new Error('Invalid native refusal display metadata.');
    return Object.freeze({ id, parcel_id, code, message });
  });
  return Object.freeze({ ...scene, refusals: Object.freeze(refusals), metrics: Object.freeze({ ...scene.metrics, refusals: refusals.length,
    openSpaces: delta.open_spaces.length, errors: refusals.filter(r => /error|erreur|invalid/i.test(r.code)).length }) });
}
