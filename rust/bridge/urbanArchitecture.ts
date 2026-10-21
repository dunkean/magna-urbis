/** Urban architecture boundary. All geometry is metric; scene surfaces are world space.
 * Retained `resolved` is an opaque native plan for exact on-demand enrichment. */
import type { EnvelopeKind, Feature, HistoricalMode, HouseBatch, HouseConfig, HouseMaterial, RoofEdge, RoofGroup, MaterialSlots, Point, RoofFace, RoofSpec, Surface, Vertex3 } from './housesContract';

export interface ArchitectureCulture { culture: string; pack: string; mode: HistoricalMode; borrowing: string | null }
export type ArchitectureFunction = 'domestic' | 'mixed' | 'workshop' | 'warehouse' | 'collective' | 'open_space';
export type ArchitectureTypology = 'common' | 'row' | 'courtyard' | 'compound' | 'detached';
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
  accesses: ArchitectureAccess[]; party_boundaries: [Point, Point][]; neighbors: ArchitectureNeighbor[];
  culture: ArchitectureCulture; function: ArchitectureFunction; seed: string; terrain: ArchitectureTerrain;
  typology?: ArchitectureTypology;
  /** Optional exact recipe/config. count and seed are set by the placement request. */
  config?: HouseConfig;
  /** Applied occupation wish. Inspired lot fitting may extend source dimensions;
   * containment, access, roof and terrain admission remain binding. */
  occupation?: {coverage: number; depth_m: number; frontage_m: number};
  parcel_fit?: boolean;
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
  structural_features: Feature[];
  structural_foundations?: {footprint: Surface; z_min_m: number; z_max_m: number}[];
  simplification: 'recipe_volumes'; diagnostics: string[];
  /** Complete resolved recipe/parameters/layout, no interiors or mesh. Never edit or regenerate. */
  resolved: unknown;
}
export interface PlacementRefusal { id: string; parcel_id: string; code: string; message: string; attempts: number }
export interface PlacementBatch {
  schema_version: '1'; generator_version: string; materials?: HouseMaterial[]; buildings: PlacedBuilding[]; refusals: PlacementRefusal[];
  open_spaces: { id: string; parcel_id: string; surface: Surface }[];
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
}
export function parseArchitectureResult<T>(json: string): T {
  if (new TextEncoder().encode(json).byteLength > 64 * 1024 * 1024) throw new Error('Architecture response exceeds 64 MiB.');
  const result = JSON.parse(json);
  if (!result || typeof result.ok !== 'boolean') throw new Error('Invalid architecture response.');
  if (!result.ok) throw new Error(`[${result.error?.code ?? 'architecture_error'}] ${result.error?.message ?? 'Architecture failed.'}`);
  return result.data as T;
}
export type EnrichedPlacement = HouseBatch;
