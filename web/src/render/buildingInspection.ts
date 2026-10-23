/** Read-only inspection of retained building data. No rendering, archive decode,
 * native request or architectural inference belongs in this helper. */
import type { BuildingStyleEntry, BuildingStyleIndex } from '../../../rust/bridge/buildingStyles';
import type { MaterialSlots, Point, Surface } from '../../../rust/bridge/housesContract';
import type { ArchitectureCulture, ArchitectureFunction, PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';

export type BuildingValidation = 'preview' | 'plan_only' | 'native';
/** Optional city metadata; planned households are separate from native capacity. */
export interface BuildingInspectionProgramme {
  role?: string;
  district_role?: string;
  wealth?: number;
  landmark?: boolean;
  households?: number;
}
export interface BuildingInspection {
  id: string;
  parcelId: string;
  recipeId: string;
  variantId: string;
  /** Authored labels exist only when the supplied index has this exact bundle. */
  label: string | null;
  variantLabel: string | null;
  culture: ArchitectureCulture;
  function: ArchitectureFunction;
  programme: BuildingInspectionProgramme | null;
  validation: BuildingValidation;
  geometry: {
    /** Net plan areas: outer rings minus holes. Roof area is projected, not sloped. */
    footprintAreaM2: number;
    roofAreaM2: number;
    /** Full footprint boundary, including inner rings. */
    perimeterM: number;
    /** Explicit semantic courts only; a footprint hole need not be a courtyard. */
    courtyardAreaM2: number;
    /** Retained volume count; no fabricated bodies for a city preview. */
    bodies: number;
    /** Largest retained level count of one body, or null when levels are absent. */
    floors: number | null;
    /** Above ground; a cartographic plan's value remains a plan-only proxy. */
    heightM: number | null;
    /** Extents along the building's local X/Y axes, not the world bounding box. */
    widthM: number | null;
    depthM: number | null;
  };
  /** Actual retained slots/features; never filled from the catalogue defaults. */
  materials: { ids: string[]; bySlot: Record<keyof MaterialSlots, string[]> };
  roofSystems: string[];
  capacity: { status: 'native' | 'unknown'; domesticUnits: number | null; usefulAreaM2: number | null };
  /** Exact supplied entry, including profile, facets, chronology, confidence and
   * source references. Null means no supplied match; no network lookup occurs. */
  style: Readonly<BuildingStyleEntry> | null;
  diagnostics: string[];
}

function ringArea(points: Point[]): number {
  if (points.length < 3) return 0;
  // Translate before multiplying: retain precision on large world coordinates.
  const origin = points[0]; let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length];
    twice += (p.x - origin.x) * (q.y - origin.y) - (p.y - origin.y) * (q.x - origin.x);
  }
  return Math.abs(twice) / 2;
}
function surfaceArea(surface: Surface): number {
  return surface.reduce((sum, polygon) => sum + ringArea(polygon.outer) - polygon.holes.reduce((holes, ring) => holes + ringArea(ring), 0), 0);
}
function perimeter(surface: Surface): number {
  let length = 0;
  for (const polygon of surface) for (const ring of [polygon.outer, ...polygon.holes]) for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length]; length += Math.hypot(q.x - p.x, q.y - p.y);
  }
  return length;
}
function localExtents(building: PlacedBuilding): { widthM: number | null; depthM: number | null } {
  const angle = building.transform.orientation_deg * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const polygon of building.footprint) for (const p of polygon.outer) {
    const dx = p.x - building.transform.origin.x, dy = p.y - building.transform.origin.y;
    const x = dx * c + dy * s, y = -dx * s + dy * c;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { widthM: Number.isFinite(minX) ? maxX - minX : null, depthM: Number.isFinite(minY) ? maxY - minY : null };
}
const nonnegative = (value: number | undefined): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

/** Describes the current retained result; it does not certify interiors, access
 * or programme. Native diagnostics and a later native inspection remain final. */
export function describeUrbanBuilding(building: PlacedBuilding, styles?: BuildingStyleIndex): BuildingInspection {
  const extra = building as PlacedBuilding & { programme?: BuildingInspectionProgramme | null; validation?: BuildingValidation };
  const preview = extra.validation === 'preview' || building.recipe_id === 'silhouette'
    || building.diagnostics.some(note => note === 'silhouette' || note.startsWith('silhouette:'));
  // A less detailed explicit marker wins; a native flag never certifies a plan.
  const validation: BuildingValidation = preview ? 'preview'
    : extra.validation === 'plan_only' || building.simplification === 'architectural_plan' || building.cartographic?.validation === 'plan_only' ? 'plan_only' : 'native';
  const style = styles?.entries.find(entry => entry.recipe_id === building.recipe_id && entry.variant_id === building.variant_id) ?? null;
  const slots: (keyof MaterialSlots)[] = ['frame', 'infill', 'coating', 'cladding', 'base', 'roof_frame'];
  const bySlot = Object.fromEntries(slots.map(slot => [slot, new Set<string>()])) as Record<keyof MaterialSlots, Set<string>>;
  const ids = new Set<string>(), roofs = new Set<string>();
  const add = (id: string | undefined): void => { if (id) ids.add(id); };
  const addSlots = (materials: MaterialSlots | null | undefined): void => {
    if (materials) for (const slot of slots) if (materials[slot]) { bySlot[slot].add(materials[slot]); add(materials[slot]); }
  };
  let floors: number | null = null, heightM = nonnegative(building.cartographic?.height_m);
  let volumeHeight: number | null = null;
  for (const volume of building.volumes) {
    addSlots(volume.materials);
    for (const level of volume.levels) addSlots(level.materials);
    if (volume.levels.length) floors = Math.max(floors ?? 0, new Set(volume.levels.map(level => level.index)).size);
    const height = nonnegative(volume.z_m + volume.wall_height_m + volume.roof_height_m - building.ground_z_m);
    if (height !== null) volumeHeight = Math.max(volumeHeight ?? 0, height);
    if (volume.roof_system) roofs.add(volume.roof_system);
  }
  heightM ??= volumeHeight;
  if (building.cartographic?.roof_system) roofs.add(building.cartographic.roof_system);
  for (const feature of building.structural_features) { add(feature.material); add(feature.roof?.material); add(feature.roof?.frame_material); }
  const domesticUnits = validation === 'native' ? nonnegative(building.domestic_units) : null;
  const usefulAreaM2 = validation === 'native' ? nonnegative(building.useful_area_m2) : null;
  return {
    id: building.id, parcelId: building.parcel_id, recipeId: building.recipe_id, variantId: building.variant_id,
    label: style?.label ?? null, variantLabel: style?.variant_label ?? null, culture: { ...building.culture },
    function: building.function, programme: extra.programme ? { ...extra.programme } : null, validation,
    geometry: { footprintAreaM2: surfaceArea(building.footprint), roofAreaM2: surfaceArea(building.roof_footprint),
      perimeterM: perimeter(building.footprint), courtyardAreaM2: surfaceArea(building.courtyards),
      bodies: building.volumes.length, floors, heightM, ...localExtents(building) },
    materials: { ids: [...ids].sort(), bySlot: Object.fromEntries(slots.map(slot => [slot, [...bySlot[slot]].sort()])) as Record<keyof MaterialSlots, string[]> },
    roofSystems: [...roofs].sort(), capacity: { status: domesticUnits !== null && usefulAreaM2 !== null ? 'native' : 'unknown', domesticUnits, usefulAreaM2 },
    style, diagnostics: [...building.diagnostics],
  };
}

/** Short alias for callers that already use inspection terminology. */
export const inspectBuilding = describeUrbanBuilding;
