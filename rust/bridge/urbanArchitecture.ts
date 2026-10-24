/** Urban architecture boundary. All geometry is metric; scene surfaces are world space.
 * Retained `resolved` is an opaque native plan for exact on-demand enrichment. */
import type { EnvelopeKind, Feature, HistoricalMode, HouseBatch, HouseConfig, HouseMaterial, RoofEdge, RoofGroup, MaterialSlots, Point, RoofFace, RoofSpec, Surface, Vertex3 } from './housesContract';

export const ARCHITECTURE_PLAN_GENERATOR = 'architectural-plans-2';
/** Version pairs are explicit native contracts, never a migration/relabel rule.
 * Historical scenes remain displayable; new edits must use one known pair. */
export const ARCHITECTURE_PLAN_HOUSE_GENERATORS: Readonly<Record<string, string>> = {
  'architectural-plans-1': 'houses-2',
  [ARCHITECTURE_PLAN_GENERATOR]: 'houses-3',
};

export interface ArchitectureCulture { culture: string; pack: string; mode: HistoricalMode; borrowing: string | null }
export type ArchitectureFunction = 'domestic' | 'mixed' | 'workshop' | 'warehouse' | 'collective' | 'open_space';
export type ArchitectureTypology = 'common' | 'row' | 'courtyard' | 'compound' | 'detached';
export type ProgrammeComposition = 'row' | 'detached' | 'courtyard' | 'farm' | 'compound' | 'hall' | 'religious' | 'civic' | 'defence' | 'inn';
/** Urban preferences. Explicit house controls, source bounds and site rights win. */
export interface ArchitectureProgramme {
  role?: string | null; label?: string | null; landmark?: boolean | null;
  district_role?: string | null; wealth?: number | null; households?: number | null; state?: string | null;
  composition?: ProgrammeComposition | null;
  /** Inclusive preferred range for the main inhabited body, not its towers. */
  floors?: [number, number] | null;
  /** Projected body footprint target, excluding courts and roof overhangs; not useful floor area. */
  built_area_m2?: number | null;
  /** Frozen allocation-model useful allowance, never a geometry control. */
  housing_floor_need?: HousingFloorNeed | null;
  /** Actual Core deficit declaration; retained for the three-source outcome join. */
  deficit?: { cause: 'pente' | 'forme' | 'source_absente'; households: number; message: string };
  source_coverage?: { version: 'functional-source-coverage-1'; status: string; role: string; function: string;
    functional_footing_tested: boolean; residential_fallback_is_functional_source: boolean };
  frontage_continuity?: number | null; party_walls?: boolean | null;
}
export interface HousingFloorModel {
  family: string; profile_provenance: string; calibration: string;
  floor_m2_per_household: number; wealth: number; wealth_factor: number;
  effective_floor_m2_per_household: number; persons_per_household: number;
}
export interface HousingFloorNeed {
  version: 'indicative-housing-floor-1'; unit: 'useful_floor_m2'; scope: 'housing_in_body_levels';
  requested_m2: number; allocated_households: number;
  basis: 'allocation_households_times_wealth_scaled_floor_allowance'; model: HousingFloorModel;
}
export interface HousingFloorOutcome {
  version: 'plan-housing-floor-outcome-1'; scope: 'housing_in_body_levels'; need_model: HousingFloorNeed;
  requested_useful_m2: number; gross_floor_m2: number | null;
  measurement: 'retained_level_footprint_union_per_exact_elevation';
  inventory_status: 'retained_plan_levels' | 'unknown'; inventory_limitation?: string | null;
  necessary_area_status: 'insufficient_gross' | 'not_disproved_by_gross' | 'unknown';
  useful_shortfall_lower_bound_m2: number | null; actual_useful_m2: null; functional_certification: 'unknown';
}
export interface ArchitectureAccess { id: string; segment: [Point, Point]; kind: 'public' | 'collective' | 'private'; width_m: number }
export interface ArchitectureNeighbor { id: string; footprint: Surface; height_m: number }
export interface ArchitectureTerrain {
  /** Physical ground plane, never the visible water surface. dz/dx and dz/dy are dimensionless. */
  origin: Point; ground_z_m: number; gradient: [number, number]; water_z_m: number | null;
  max_foundation_step_m: number;
  /** Physical raster; origin is first sample centre, row-major x-fast. Overrides plane. */
  grid?: { origin: Point; step_m: number; width: number; height: number; elevations_m: number[] };
}
export interface PlacementRequest {
  id: string; parcel_id: string; cadastral: Surface; buildable: Surface; reserves: Surface;
  /** Optional distinct rights envelope; absent means no roof may leave cadastral land. */
  roof_domain?: Surface;
  /** Native oriented admission rectangle; advisory, checked like any other candidate. */
  placement_hint?: Surface | null;
  /** Explicit canonical minimum poses. A matching native source identity and
   * real site checks are required; requested size/floors and model pins win. */
  native_minimum_candidates?: NativeMinimumCandidate[];
  accesses: ArchitectureAccess[]; party_boundaries: [Point, Point][]; neighbors: ArchitectureNeighbor[];
  culture: ArchitectureCulture; function: ArchitectureFunction; seed: string; terrain: ArchitectureTerrain;
  typology?: ArchitectureTypology;
  /** Optional exact recipe/config. count and seed are set by the placement request. */
  config?: HouseConfig;
  /** Applied occupation wish. Inspired lot fitting may extend source dimensions;
   * containment, access, roof and terrain admission remain binding. */
  occupation?: {coverage: number; depth_m: number; frontage_m: number};
  parcel_fit?: boolean;
  programme?: ArchitectureProgramme | null;
}
export interface NativeMinimumCandidate {
  identity: {
    version: 'native-admission-witness-1'; catalogue_version: string;
    generator_version: string; style_index_version: string; source_sha256: string;
    style_id: string; recipe_id: string; variant_id: string; seed: string;
  };
  transform: {origin: Point; orientation_deg: number};
  access_id: string;
  /** Explicit contact on the declared access segment; no pose search in Houses. */
  contact: Point;
}
export interface PlacementBatchSettings { culture?: string; parcel_fit?: boolean; floors?: number; typology?: ArchitectureTypology; house_config?: HouseConfig }
export interface PlacementBatchRequest { schema_version: '1'; requests: PlacementRequest[]; settings?: PlacementBatchSettings }
export interface ArchitectureVolume {
  id: string; footprint: Surface;
  levels: { index: number; footprint: Surface; z_m: number; height_m: number; materials?: MaterialSlots | null }[];
  z_m: number; wall_height_m: number; roof_height_m: number; roof_system: string; roof_pitch_deg: number;
  overhang_m: number; roof_spec: RoofSpec; materials: MaterialSlots; role: string;
  envelope: EnvelopeKind;
  roof_mesh: { vertices: Vertex3[]; faces: (Pick<RoofFace, 'vertices' | 'normal' | 'material' | 'kind'> & Partial<Omit<RoofFace, 'vertices' | 'normal' | 'material' | 'kind'>>)[]; edges?: RoofEdge[]; groups?: RoofGroup[] };
  foundation: { footprint: Surface; z_min_m: number; z_max_m: number };
}
export interface PlacedBuilding {
  id: string; parcel_id: string; function: ArchitectureFunction; culture: ArchitectureCulture;
  recipe_id: string; variant_id: string; transform: { origin: Point; orientation_deg: number }; ground_z_m: number;
  footprint: Surface; roof_footprint: Surface; courtyards: Surface; circulation: Surface; entrance: Point; access_id: string;
  volumes: ArchitectureVolume[]; useful_area_m2: number; domestic_units: number;
  /** Additive PLAN accounting, populated from final retained geometry. Missing
   * on old saved plans means unreported; never infer housed counts from wishes. */
  programme_outcome?: PlanProgrammeOutcome | null;
  structural_features: Feature[];
  structural_foundations?: {footprint: Surface; z_min_m: number; z_max_m: number}[];
  simplification: 'recipe_volumes' | 'architectural_plan'; diagnostics: string[];
  /** Plan-level display proxies. Presence does not certify native roof/access construction. */
  cartographic?: {height_m: number; ridges: [Point, Point][]; roof_system?: string; validation: 'plan_only' | 'native_site'};
  /** Complete resolved recipe/parameters/layout, no interiors or mesh. Never edit or regenerate. */
  resolved: unknown;
}
/** Proposed metadata only. Area attainment is NOT whole-programme, historical,
 * functional, native-entry, roof or household-capacity certification. */
export interface PlanProgrammeOutcome {
  version: 'plan-programme-outcome-1';
  housing_floor?: HousingFloorOutcome | null;
  body_footprint: {
    /** Projected body footprint; excludes courts, eaves and summed floor area. */
    requested_m2: number | null;
    /** Final authoritative union already retained as building.footprint. */
    actual_m2: number;
    tolerance_fraction: number;
    attainment: 'not_requested' | 'within_tolerance' | 'deficit' | 'excess';
    /** Exact differences, even inside tolerance; null without a target. */
    deficit_m2: number | null;
    excess_m2: number | null;
  };
  households: {
    requested: number | null;
    housed: null;
    capacity_status: 'unknown';
  };
}
/** Transported declaration, not a physical impossibility or capacity certificate. */
export interface ArchitecturalDeficit {
  version: 'architectural-deficit-1'; request_id: string; demand_id: string;
  original_function: string; role: string; cause: 'pente' | 'forme' | 'source_absente'; households: number; message: string;
}
export interface ArchitectureOpenSpace { id: string; parcel_id: string; surface: Surface; deficit?: ArchitecturalDeficit }
export interface PlacementRefusal { id: string; parcel_id: string; code: string; message: string; attempts: number }
export interface PlacementBatch {
  schema_version: '1'; generator_version: string; materials?: HouseMaterial[]; buildings: PlacedBuilding[]; refusals: PlacementRefusal[];
  open_spaces: ArchitectureOpenSpace[];
  /** Lossless compressed retained plans, stored once per bounded transport chunk. */
  plan_archives?: Record<string, string>;
}
export interface AdmissibilityProfile {
  recipe_id: string; pack: string; layout: string; role: string; width_m: [number, number]; depth_m: [number, number];
  floors: [number, number]; max_slope_deg: number; requires_access: boolean; party_walls: boolean;
  eras: string[];
  /** Native minimum complete default-bundle envelope, without the solver's 0.3m side clearance. */
  minimum_domain_m: [number, number]; minimum_access_width_m: number;
  minimum_status: 'supported' | 'refused'; minimum_refusal: string | null;
  provenance: string; confidence: string;
  slope_basis: string; party_wall_basis: string;
}
export interface ArchitectureWasm {
  architecture_capabilities_json?(): string;
  architecture_profiles_json(): string;
  place_buildings_json(input: string): string;
  enrich_placement_json(input: string): string;
  plan_buildings_json?(input: string): string;
  realize_plan_json?(input: string): string;
  architecture_style_index_json?(): string;
  native_assembly_capability_json?(): string;
  begin_parent_session_json?(input: string): string;
  plan_parent_session_json?(input: string): string;
  ack_parent_session_json?(input: string): string;
  abort_parent_session_json?(input: string): string;
  release_parent_session_json?(input: string): string;
  plan_parent_batch_json?(input: string): string;
  unpack_parent_json?(input: string): string;
  unpack_parent_batch_json?(input: string): string;
  realize_parent_json?(input: string): string;
  assemble_pair_json?(input: string): string;
  unpack_assembly_json?(input: string): string;
  realize_assembly_json?(input: string): string;
}
export function parseArchitectureResult<T>(json: string): T {
  if (new TextEncoder().encode(json).byteLength > 64 * 1024 * 1024) throw new Error('Architecture response exceeds 64 MiB.');
  const result = JSON.parse(json);
  if (!result || typeof result.ok !== 'boolean') throw new Error('Invalid architecture response.');
  if (!result.ok) throw new Error(`[${result.error?.code ?? 'architecture_error'}] ${result.error?.message ?? 'Architecture failed.'}`);
  return result.data as T;
}
export type EnrichedPlacement = HouseBatch;
