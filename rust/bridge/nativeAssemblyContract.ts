/** Native two-member API. Separate from Single PlacementBatch/PlacedBuilding.
 * Archive payload is opaque lossless native data; never decode it in JS. */
import type { ArchitectureAccess, ArchitectureCulture, ArchitectureFunction, ArchitectureProgramme,
  ArchitectureVolume, PlanProgrammeOutcome, PlacedBuilding, PlacementRequest } from './urbanArchitecture';
import type { Feature, HouseBatch, Point, Surface } from './housesContract';
export const NATIVE_ASSEMBLY_CAPABILITY = 'native-assembly-pair-1';
export const NATIVE_ASSEMBLY_RUNTIME_CAPABILITY = 'houses.native-assembly-pair-1';
/** Scoped correctly-rounded input reader, not an archive or certification. */
export const NATIVE_ASSEMBLY_TRANSPORT_CAPABILITY = 'houses.native-assembly-std-json-v1';
export interface AssemblePairRequest { site: PlacementRequest; occupied_parts: Surface[]; occupied_roof_parts: Surface[]; incumbent: PlacedBuilding }
export interface NativeMemberPlan {
  id: string; parcel_id: string; function: ArchitectureFunction; culture: ArchitectureCulture;
  recipe_id: string; variant_id: string; transform: { origin: Point; orientation_deg: number }; ground_z_m: number;
  footprint: Surface; roof_footprint: Surface; courtyards: Surface; entrance: Point;
  volumes: ArchitectureVolume[]; structural_features: Feature[];
  cartographic: { height_m: number; ridges: [Point, Point][]; roof_system: string; validation: string };
  diagnostics: string[]; resolved: unknown;
}
export interface NativeAssemblyMember { key: string; plan: NativeMemberPlan }
export type AssemblyBranchTarget = { kind: 'public_access'; access_id: string }
  | { kind: 'member_branch_cap'; branch_id: string; segment: [Point, Point] };
export interface AssemblyBranch { id: string; member_key: string; path: Surface; native_passage: Surface;
  contact: Point; target: AssemblyBranchTarget; entry_ground_z_m: number }
export interface AssemblyCirculation { public_access: ArchitectureAccess; branches: [AssemblyBranch, AssemblyBranch]; construction_status: string }
export interface AssemblyProgrammeOutcome {
  body_footprint: PlanProgrammeOutcome['body_footprint']; gross_floor_m2: number | null; inventory_limitation: string | null;
  planes: { elevation_m: number; footprint: Surface; area_m2: number }[];
  requested_useful_m2: number | null; useful_shortfall_lower_bound_m2: number | null;
  necessary_area_status: 'insufficient_gross' | 'not_disproved_by_gross' | 'unknown';
  housed_households: null; actual_useful_m2: null; functional_certification: string;
}
export interface RetainedNativeAssembly { capability: typeof NATIVE_ASSEMBLY_CAPABILITY; id: string; parcel_id: string;
  programme: ArchitectureProgramme; members: [NativeAssemblyMember, NativeAssemblyMember];
  circulation: AssemblyCirculation; shared_context: Feature[]; outcome: AssemblyProgrammeOutcome }
export interface NativeAssemblyArchive { format: 'native-assembly-archive-1'; sha256: string; payload: unknown }
export interface AssemblyAttemptReport {
  reason: string; errors: string[]; source_resolutions: number; occupied_parts: number; occupied_roof_parts: number;
  occupation_union_ms: number | null; necessary_checks: number; necessary_terrain_checks: number;
  new_body_rebuilds: number; new_native_preparations: number; new_admissions: number;
  incumbent_preparations: number; incumbent_admissions: number; incumbent_connector_evaluations: number; new_connector_evaluations: number;
  necessary: { dimension_slot: number; axis_pose: number; dimensions: [number, number]; transform: { origin: Point; orientation_deg: number }; failure: string | null }[];
  selected_dimensions: [number, number] | null;
}
export type AssemblyDecision = { outcome: 'retained'; building: PlacedBuilding; report: AssemblyAttemptReport }
  | { outcome: 'assembled'; assembly: RetainedNativeAssembly; archive: NativeAssemblyArchive; report: AssemblyAttemptReport };
export interface RealizedNativeAssembly { capability: typeof NATIVE_ASSEMBLY_CAPABILITY; id: string; parcel_id: string;
  programme: ArchitectureProgramme; outcome: AssemblyProgrammeOutcome;
  members: { key: string; member_id: string; ground_z_m: number; architecture: HouseBatch }[];
  circulation: AssemblyCirculation; shared_context: Feature[] }
export interface NativeAssemblyApi {
  require(): Promise<void>;
  assemble(request: AssemblePairRequest): Promise<AssemblyDecision>;
  unpack(archive: NativeAssemblyArchive): Promise<RetainedNativeAssembly>;
  realize(archive: NativeAssemblyArchive): Promise<RealizedNativeAssembly>;
}
