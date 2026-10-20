export const HOUSE_SCHEMA = '2';
export const HOUSE_GENERATOR = 'houses-2';
export const HOUSE_MAX_JSON_BYTES = 64 * 1024 * 1024;
export type HouseRole = 'dwelling' | 'residential_ensemble' | 'communal_dwelling' | 'mixed_residential' | 'domestic_annex' | 'spatial_component' | 'non_domestic' | 'landscape';
export type HistoricalMode = 'historical_strict' | 'historical_inspired' | 'fantasy_mix';
export interface HouseOverrides {
  variant?: string | null;
  footprint: string | null; roof: string | null; frame: string | null; infill: string | null;
  coating: string | null; cladding: string | null; floors: number | null; bodies: number | null;
  courtyard_ratio: number | null; overhang_m: number | null; roof_pitch_deg: number | null; site_slope_deg: number | null;
}
export interface HouseConfig {
  schema_version: string; seed: string; pack: string; recipe: string | null; mode: HistoricalMode;
  era: string; allow_late: boolean; count: number; size: number; variation: number; wealth: number;
  orientation_deg: number; overrides: HouseOverrides; workshop?: WorkshopRequest;
}
export interface WorkshopRequest { preset_id: string; footprint: string | null; roof: string | null; width_m: number | null; depth_m: number | null; roof_frame: string | null; base: string | null; support: Support | null }
export interface Point { x: number; y: number }
export interface Polygon { outer: Point[]; holes: Point[][] }
export type Surface = Polygon[];
export interface Vertex3 extends Point { z: number }
export interface MaterialSlots { frame: string; infill: string; coating: string; cladding: string; base: string; roof_frame: string }
export type IntermediateCover = 'none' | 'terrace' | 'shed' | 'skirt';
export interface RoofSlab { surface: Surface; z_m: number; walkable: boolean; access_node: string | null }
export interface Level { index: number; z_m: number; height_m: number; footprint: Surface; floor: Surface; intermediate_cover: IntermediateCover; roof_slab: RoofSlab | null; materials: MaterialSlots }
export interface UnitLevel { index: number; z_min: number; z_max: number }
export type RoomUsage = 'living' | 'kitchen' | 'storage' | 'workshop' | 'shop' | 'byre' | 'barn' | 'communal' | 'guest' | 'service' | 'ritual' | 'hall' | 'gallery' | 'office';
export interface Room { id: string; body_id: string; level: number; z_m: number; floor: Surface; usage: RoomUsage; access_node: string; household_id: string | null }
export interface CorbelSpec { profile: 'dome' | 'barrel'; courses: number; rise_m: number; cap_span_m: number; cap_thickness_m: number; min_bearing_m: number; material: string }
export interface VaultSpec { open_ends: ('start' | 'end')[]; bearing_ratio: number }
export interface RoofShellSpec { profile: 'round' | 'ogival'; rib_width_m: number; rib_depth_m: number; rib_spacing_m: number; material: string }
export interface RoofSpec { axis: 'longitudinal' | 'transverse'; tiers: number; tier_inset_ratio: number; tier_rise_m: number; drum_height_m: number; gambrel_break_ratio: number; gambrel_lower_pitch_deg: number; saddle_rise_ratio: number; step_count: number; shell_sections: number; parapet_height_m: number; drainage_side: number; dome_rise_ratio: number; oculus_ratio: number; curve_lift_ratio: number; tent_crown_ratio: number; shell_cross_rise_ratio: number; shell_long_rise_ratio: number; round_segments: number; curve_sections: number; corbel?: CorbelSpec | null; vault?: VaultSpec | null; drainage?: 'inward' | null; shell?: RoofShellSpec | null; triangulation?: 'boundary' | null; horns?: HornRoofSpec | null }
export interface HornRoofSpec { layout: 'serial_tiers'; count: 'four'; central_span_ratio: number; rise_ratio: number; outer_rise_scale: number; confidence: 'stylized' }
export interface RoofArm { source_component?: number | null; origin: Point; axis: [number, number]; length_m: number; width_m: number; domain: Surface }
export type EnvelopeKind = 'walled' | 'open' | 'shell' | 'rockcut' | 'membrane';
export type VerticalAccess = 'none' | 'internal_stair' | 'exterior_stair' | 'ladder' | 'roof_hatch' | 'intramural_stair';
export type Layout = 'single' | 'strip' | 'courtyard' | 'peristyle' | 'atrium' | 'iwan_court' | 'siheyuan' | 'kancha' | 'hut_compound' | 'kraal' | 'multiyard' | 'pueblo' | 'great_house' | 'ring' | 'cliff' | 'excavated' | 'platform' | 'parallel' | 'bridge' | 'additive' | 'broch' | 'shinden' | 'high_hall';
export type EnclosureFamily = 'none' | 'earth_wall' | 'stone_wall' | 'timber_palisade' | 'thorn_fence';
export type Placement = 'main' | 'north' | 'south' | 'east' | 'west' | 'peripheral' | 'adjacent' | 'central' | 'courtyard' | 'rear' | 'facing_main' | 'along_front';
export interface Support { kind: 'ground' | 'posts' | 'piers' | 'raft' | 'rock'; material: string | null; height_m: [number, number] }
export interface LevelMaterial { from_level: number; to_level: number; materials: MaterialSlots }
export interface VerticalRoute { kind: VerticalAccess; from_level: number; to_level: number; placement: Placement; min_width_m: number }
export interface EnclosureSpec { family: EnclosureFamily; placement: Placement; gate_width_m: number }
export interface ShellSpec { outer_wall_m: number; gallery_m: number; inner_wall_m: number; inner_diameter_m: number }
export interface GalleryCover { enabled: boolean; rf: string; spec: RoofSpec; height_m: number; width_m: number; pitch_deg: number; max_span_m: number; support_spacing_m: number; facade_mode?: 'residential' | 'wall_bearing' }
export interface DetailSpec { confidence: string; floor_material: string; floor_thickness_m: number; flue_material: string; flue_width_m: number; flue_depth_m: number; rope_material: string | null; rope_diameter_m: number; rope_anchor_extension_ratio: number; diagonal_lean_ratio: number; window_sill_m: number; window_height_m: number; window_width_m: number; narrow_window_width_m: number }
export interface CourtSpec { rank: number; ratio: number; aspect: number }
export interface ThresholdSpec { width_m: number; wall_m: number; height_m: number; material: string }
export interface IwanSpec { count: number; min_open_ratio: number; bearing_ratio: number }
export interface PorticoSpec { span_m: number; post_m: number }
export interface HallSpec { height_m: number; depth_m: number }
export interface CourtProgram { courts: CourtSpec[]; topology: 'axial' | 'grid'; threshold: ThresholdSpec; iwans: IwanSpec | null; compartments: number; portico: PorticoSpec | null; north_hall: HallSpec | null; body_footprint: string | null; confidence: string }
export type PortalShape = 'rect' | 'trapezoid';
export interface PortalSpec { id: string; shape: PortalShape; width_m: number; top_width_m: number; head_m: number; sill_m: number; min_clear_height_m: number }
export interface PortalProfile { entries: PortalSpec[]; count: [number, number]; placement: 'axial' | 'court' | 'distributed' | 'differentiated'; confidence: string }
export interface WallProfile { role: 'exterior' | 'enclosure' | 'shell' | 'base'; min_thickness_m: number; min_height_m: number; material: string | null; from_level: number; to_level: number }
export interface LightwellSpec { count: number; width_m: number; depth_m: number; border_m: number; material: string }
export interface BankSpec { width_m: number; height_m: number; base_depth_m: number; gate_width_m: number; material: string }
export interface InnerTentSpec { width_ratio: number; depth_ratio: number; wall_height_m: number; roof_rise_m: number; membrane_material: string; frame_material: string; door_width_m: number; door_height_m: number; membrane_thickness_m: number; post_width_m: number; post_spacing_m: number }
export interface MooringSpec { count: number; material: string; diameter_m: number; anchor_offset_m: number; anchor_depth_m: number; anchor_material: string; anchor_width_m: number; anchor_height_m: number }
export interface IslandSpec { height_m: number; margin_m: number; pile_spacing_m: number; canal_width_m: number; garden_ratio: number; material: string; pile_material: string; water_depth_m: number; pile_depth_m: number }
export interface RetainingSpec { thickness_m: number; material: string; terrain_slope_deg: number; terrace_rise_m: number; base_depth_m: number }
export interface HighHallSpec { core_level_height_m: number; wing_order: Placement[]; passage_width_m: number; joint_overhang_m: number; terrace_core_door: 'forbid' | 'declared'; confidence: string }
export interface LatticeSpec { bay_width_m: number; rows: number; batten_width_m: number; batten_depth_m: number; material: string; max_pieces: number }
export interface LogJointSpec { courses: number; course_spacing_m: number; diameter_m: number; extension_m: number; material: string }
export interface StructuralSpec { confidence: string; walls: WallProfile[]; lightwell: LightwellSpec | null; bank: BankSpec | null; inner_tent: InnerTentSpec | null; mooring: MooringSpec | null; island: IslandSpec | null; retaining: RetainingSpec | null; high_hall?: HighHallSpec | null; lattice?: LatticeSpec | null; log_joints?: LogJointSpec | null }
export interface Component { id: string; role: HouseRole; count: [number, number]; footprint_family: string; roof_system: string; roof_spec: RoofSpec; roof_pitch_deg: [number, number]; overhang_m: [number, number]; materials: MaterialSlots; structure_system: string; envelope: EnvelopeKind; placement: Placement; width_ratio: [number, number]; depth_ratio: [number, number]; floors: [number, number]; level_height_m: number; rooms_per_body: [number, number]; vertical_access: VerticalAccess; vertical_routes: VerticalRoute[]; support: Support; level_materials: LevelMaterial[]; wall_thickness_m: [number, number]; courtyard_ratio: [number, number] }
export interface StructuralCell { id: string; footprint: Surface; floors: number; household_id: string | null }
export interface Body { id: string; footprint: Surface; voids?: Surface[]; levels: Level[]; roof_system: string; roof_pitch_deg: number; overhang_m: number; details: string[]; role: HouseRole; envelope: EnvelopeKind; vertical_access: VerticalAccess; vertical_routes?: VerticalRoute[]; wall_thickness_m: number; component_id: string | null; roof_spec: RoofSpec; roof_arms: RoofArm[]; cells: StructuralCell[] }
export type FeatureKind = 'terrace' | 'party_wall' | 'rock_shelter' | 'gallery' | 'arctic_tunnel' | 'post' | 'pier' | 'raft' | 'water' | 'site_slope' | 'rock_face' | 'neighbor' | 'street' | 'enclosure' | 'stair' | 'ladder' | 'landing' | 'hatch' | 'portal_lintel' | 'hearth' | 'well' | 'drain' | 'flue' | 'scupper' | 'parapet' | 'balcony' | 'arcade' | 'frame' | 'bay' | 'storage_bin' | 'impluvium' | 'windcatcher' | 'window' | 'decorative_wall' | 'platform' | 'deck' | 'mooring' | 'anchor' | 'wall_footing' | 'floor_slab' | 'excavation' | 'retaining' | 'roof_drum' | 'stepped_gable' | 'roof_riser' | 'roof_pavilion' | 'roof_drain' | 'roof_skirt' | 'roof_gable' | 'roof_tympanum' | 'tent_crown' | 'roof_arc' | 'decorative_panel' | 'fence' | 'ritual_court' | 'livestock_pen' | 'drying_rack' | 'beam' | 'inner_membrane' | 'courtyard' | 'threshold' | 'garden';
export interface RoofAttachment { owner_body_id: string | null; level: number; domain: Surface; rf: string; spec: RoofSpec; arms: RoofArm[]; support_z_m: number; pitch_deg: number; overhang_m: number; material: string; frame_material: string; supports: string[]; max_span_m: number; nested?: boolean }
export interface Feature { id: string; kind: FeatureKind; surface: Surface; z_m: number; height_m: number; material: string; vertices3d: Vertex3[]; roof?: RoofAttachment | null }
export type WallKind = 'exterior' | 'interior' | 'enclosure' | 'party' | 'shell' | 'retaining' | 'rock';
export interface WallSolid { vertices: Vertex3[]; faces: number[][] }
export interface Wall { id: string; kind: WallKind; body_id: string | null; level: number; z_m: number; height_m: number; footprint: Surface; centerline: Point[]; material: string; party: boolean; opening_ids: string[]; solid?: WallSolid | null; plan_section?: Surface | null; shell_reference?: boolean }
export type AccessKind = 'exterior' | 'courtyard' | 'circulation' | 'room' | 'stair_landing' | 'terrace' | 'gallery' | 'platform' | 'tunnel';
export type PortalKind = 'door' | 'gate' | 'passage' | 'stair' | 'ladder' | 'hatch' | 'tunnel' | 'bridge';
export interface AccessNode { id: string; kind: AccessKind; floor: Surface; z_m: number; household_id?: string | null }
export interface Portal { id: string; kind: PortalKind; from: string; to: string; opening: [Point, Point]; wall_id: string | null; opening_surface: Surface; passage: Surface; width_m: number; from_z_m: number; to_z_m: number; head_z_m?: number; feature_ids: string[]; shape?: PortalShape; top_width_m?: number | null; sill_z_m?: number | null; profile_id?: string | null }
export interface AccessGraph { root: string; nodes: AccessNode[]; portals: Portal[] }
export type RoofFaceKind = 'pan' | 'slab' | 'gable' | 'tympanum' | 'step_wall' | 'drum' | 'parapet' | 'skirt' | 'stepped_gable' | 'corbel_soffit' | 'corbel_riser' | 'shell_outer' | 'shell_inner' | 'shell_rib' | 'shell_rib_end' | 'shell_jamb' | 'shell_lintel';
export type RoofEdgeKind = 'eave' | 'ridge' | 'hip' | 'valley' | 'crease' | 'junction' | 'step' | 'verge' | 'oculus';
export interface RoofFace { body_id: string; feature_id?: string | null; level: number; kind: RoofFaceKind; rf: string; roof_group: string; component_id: string | null; vertices: number[]; material: string; normal: [number, number, number] }
export interface RoofEdge { kind: RoofEdgeKind; vertices: [number, number]; faces: [number | null, number | null] }
export interface RoofGroup { id: string; rf: string; body_id: string; feature_id?: string | null; room_id?: string | null; level: number; domain: Surface }
export interface RoofMesh { vertices: Vertex3[]; faces: RoofFace[]; edges: RoofEdge[]; groups: RoofGroup[] }
export interface Partition { occupied: Surface; courtyards: Surface; circulation: Surface; service: Surface; residual: Surface }
export interface LevelPartition { level: number; z_m: number; domain: Surface; partition: Partition }
export interface HouseUnit { id: string; recipe_id: string; variant_id: string; label: string; role: HouseRole; transform: {origin: Point; orientation_deg: number}; lot: Surface; partition: Partition; level_partitions: LevelPartition[]; levels: UnitLevel[]; bodies: Body[]; rooms: Room[]; features: Feature[]; walls: Wall[]; site_context: Feature[]; access: AccessGraph; roofs: RoofMesh; diagnostics: string[] }
export interface HouseBatch { schema_version: string; catalogue_version: string; generator_version: string; settings: HouseConfig; units: HouseUnit[]; diagnostics: string[] }
export type MaterialPattern = 'tile' | 'thatch' | 'wood' | 'stone' | 'earth' | 'fabric' | 'snow' | 'plain';
export interface HouseMaterial { id: string; label: string; roles: string[]; pattern: MaterialPattern; origin: string; source_ref: string | null }
export interface Pack { id: string; label: string; source_line: number; eras: string[]; confidence: string; sources: string[] }
export interface Parameters {
  variant_id: string; layout: Layout; footprint_family: string; roof_system: string; roof_spec: RoofSpec; gallery_cover: GalleryCover; detail_spec?: DetailSpec | null; court_program?: CourtProgram | null; portal_profile?: PortalProfile | null; site_gate_profile?: PortalProfile | null; structural_spec?: StructuralSpec | null; structure_system: string; materials: MaterialSlots;
  width_m: [number, number]; depth_m: [number, number]; floors: [number, number]; level_height_m: number; bodies: [number, number]; cells: [number, number]; rooms_per_body: [number, number];
  elevation_family: string; details: string[]; notes: string[]; components: Component[]; enclosure_family: EnclosureFamily; enclosures: EnclosureSpec[]; level_materials: LevelMaterial[];
  support: Support; envelope: EnvelopeKind; vertical_access: VerticalAccess; vertical_routes: VerticalRoute[]; shell: ShellSpec | null;
  roof_pitch_deg: [number, number]; overhang_m: [number, number]; wall_thickness_m: [number, number]; courtyard_ratio: [number, number];
  allowed_roofs: string[]; allowed_footprints: string[];
}
export interface Recipe { id: string; pack_id: string; label: string; priority: string; role: HouseRole; profile: string; parameters: Parameters; variants: {id: string; label: string; parameters: Parameters; confidence: string}[]; component_kind: string | null; temporal: {eras: string[]; tradition_long: boolean; late_only: boolean; from_year: number | null; to_year: number | null}; confidence: string; roof_confidence: string; sources: {path: string; line: number}[]; source_description: string[]; settlement_pattern: string; settlement_archetype: string; subtradition: string; context_note: string; chronology_note: string; chronology_confidence: string; compound_pattern: string; surface_language: string; weight: number }
export interface WorkshopPreset { id: string; label: string; description: string; confidence: 'stylized'; parameters: Parameters }
export interface CoverageEntry { id: string; role: HouseRole; reason: string; profile: string | null; status: string }
export interface SourceEntry { id: string; label: string; priority: string; pack_id: string | null; section: string; columns: string[]; source_line: number; source_text: string }
export interface SourceDigest { path: string; sha256: string }
export interface HouseCatalogue { schema_version: string; catalogue_version: string; sources: SourceDigest[]; packs: Pack[]; materials: HouseMaterial[]; recipes: Recipe[]; workshop_presets: WorkshopPreset[]; coverage: CoverageEntry[]; geometry_traits: {id: string; operator: string; status: string}[]; functional_mappings: {label: string; source_line: number; kind: string; recipe_ids: string[]; traits: string[]; usage: string; status: string}[] }
export interface CatalogueBundle { catalogue: HouseCatalogue; inventory: {schema_version: string; sources: SourceDigest[]; entries: SourceEntry[]; functional_forms: {label: string; description: string; section: string; source_line: number}[]} }
export interface HouseError { code: string; field: string | null; message: string; budget?: unknown }
export interface ResourceEstimate { bodies: number; rooms: number; faces: number }
export interface Preflight { schema_version: string; settings: HouseConfig; admissible_recipes: string[]; rejected_recipes: {id: string; reason: string}[]; estimate: ResourceEstimate; budgets: ResourceEstimate }
export type Envelope<T> = {ok: true; data: T} | {ok: false; error: HouseError};
export type HouseRequest = {ticket: number; kind: 'catalogue'; module?: WebAssembly.Module} | {ticket: number; kind: 'preflight' | 'generate'; config: HouseConfig; module?: WebAssembly.Module};
export type HouseResponse = {ticket: number; kind: HouseRequest['kind']; json: string; elapsed_ms: number} | {ticket: number; kind: HouseRequest['kind']; error: HouseError; fatal: boolean};

const roles = ['dwelling', 'residential_ensemble', 'communal_dwelling', 'mixed_residential', 'domestic_annex', 'spatial_component', 'non_domestic', 'landscape'];
const featureKinds = ['terrace', 'party_wall', 'rock_shelter', 'gallery', 'arctic_tunnel', 'post', 'pier', 'raft', 'water', 'site_slope', 'rock_face', 'neighbor', 'street', 'enclosure', 'stair', 'ladder', 'landing', 'hatch', 'portal_lintel', 'hearth', 'well', 'drain', 'flue', 'scupper', 'parapet', 'balcony', 'arcade', 'frame', 'bay', 'storage_bin', 'impluvium', 'windcatcher', 'window', 'decorative_wall', 'platform', 'deck', 'mooring', 'anchor', 'wall_footing', 'floor_slab', 'excavation', 'retaining', 'roof_drum', 'stepped_gable', 'roof_riser', 'roof_pavilion', 'roof_drain', 'roof_skirt', 'roof_gable', 'roof_tympanum', 'tent_crown', 'roof_arc', 'decorative_panel', 'fence', 'ritual_court', 'livestock_pen', 'drying_rack', 'beam', 'inner_membrane', 'courtyard', 'threshold', 'garden'];
function fail(path: string): never { throw new Error(`Contrat maisons invalide : ${path}.`); }
function object(value: unknown, path: string): Record<string, any> { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path); return value as Record<string, any>; }
function array(value: unknown, path: string): any[] { if (!Array.isArray(value)) fail(path); return value; }
function number(value: unknown, path: string): number { if (typeof value !== 'number' || !Number.isFinite(value)) fail(path); return value; }
function integer(value: unknown, path: string): number { const n = number(value, path); if (!Number.isInteger(n) || n < 0) fail(path); return n; }
function string(value: unknown, path: string): string { if (typeof value !== 'string') fail(path); return value; }
function nullableString(value: unknown, path: string): void { if (value !== null) string(value, path); }
function strings(value: unknown, path: string): void { array(value, path).forEach((entry, index) => string(entry, `${path}[${index}]`)); }
function enumValue(value: unknown, accepted: string[], path: string): void { if (!accepted.includes(string(value, path))) fail(path); }
function point(value: unknown, path: string, three = false): void { const p = object(value, path); number(p.x, `${path}.x`); number(p.y, `${path}.y`); if (three) number(p.z, `${path}.z`); }
function surface(value: unknown, path: string): void {
  array(value, path).forEach((entry, index) => {
    const p = object(entry, `${path}[${index}]`);
    for (const [ringIndex, ring] of [p.outer, ...array(p.holes, `${path}.holes`)].entries()) {
      if (array(ring, `${path}.ring`).length < 3) fail(`${path}.ring[${ringIndex}]`);
      ring.forEach((entry: unknown, index: number) => point(entry, `${path}.ring[${ringIndex}][${index}]`));
    }
  });
}
function partition(value: unknown, path: string): void { const p = object(value, path); for (const key of ['occupied', 'courtyards', 'circulation', 'service', 'residual']) surface(p[key], `${path}.${key}`); }
function materials(value: unknown, path: string): void { const slots = object(value, path); for (const key of ['frame', 'infill', 'coating', 'cladding', 'base', 'roof_frame']) string(slots[key], `${path}.${key}`); }
function roofSpec(value: unknown, path: string): void {
  const spec = object(value, path);
  enumValue(spec.axis, ['longitudinal', 'transverse'], `${path}.axis`);
  for (const key of ['tiers', 'tier_inset_ratio', 'tier_rise_m', 'drum_height_m', 'gambrel_break_ratio', 'gambrel_lower_pitch_deg', 'saddle_rise_ratio', 'step_count', 'shell_sections', 'parapet_height_m', 'drainage_side', 'dome_rise_ratio', 'oculus_ratio', 'curve_lift_ratio', 'tent_crown_ratio', 'shell_cross_rise_ratio', 'shell_long_rise_ratio', 'round_segments', 'curve_sections']) number(spec[key], `${path}.${key}`);
  if (spec.corbel !== undefined && spec.corbel !== null) {
    const corbel = object(spec.corbel, `${path}.corbel`);
    enumValue(corbel.profile, ['dome', 'barrel'], `${path}.corbel.profile`);
    const courses = integer(corbel.courses, `${path}.corbel.courses`);
    if (courses < 4 || courses > (corbel.profile === 'barrel' ? 24 : 64)) fail(`${path}.corbel.courses`);
    for (const key of ['rise_m', 'cap_span_m', 'cap_thickness_m', 'min_bearing_m']) if (number(corbel[key], `${path}.corbel.${key}`) <= 0) fail(`${path}.corbel.${key}`);
    if (corbel.rise_m / courses < 0.08) fail(`${path}.corbel.course_height`);
    string(corbel.material, `${path}.corbel.material`);
  }
  if (spec.vault !== undefined && spec.vault !== null) {
    const vault = object(spec.vault, `${path}.vault`);
    array(vault.open_ends, `${path}.vault.open_ends`).forEach(end => enumValue(end, ['start', 'end'], `${path}.vault.open_ends`));
    number(vault.bearing_ratio, `${path}.vault.bearing_ratio`);
  }
  if (spec.drainage !== undefined && spec.drainage !== null) enumValue(spec.drainage, ['inward'], `${path}.drainage`);
  if (spec.triangulation !== undefined && spec.triangulation !== null) enumValue(spec.triangulation, ['boundary'], `${path}.triangulation`);
  if (spec.shell !== undefined && spec.shell !== null) {
    const shell = object(spec.shell, `${path}.shell`);
    enumValue(shell.profile, ['round', 'ogival'], `${path}.shell.profile`);
    for (const key of ['rib_width_m', 'rib_depth_m', 'rib_spacing_m']) number(shell[key], `${path}.shell.${key}`);
    string(shell.material, `${path}.shell.material`);
  }
  if (spec.horns !== undefined && spec.horns !== null) {
    const horns = object(spec.horns, `${path}.horns`);
    const fields = ['layout', 'count', 'central_span_ratio', 'rise_ratio', 'outer_rise_scale', 'confidence'];
    if (Object.keys(horns).some(key => !fields.includes(key))) fail(`${path}.horns.fields`);
    enumValue(horns.layout, ['serial_tiers'], `${path}.horns.layout`);
    enumValue(horns.count, ['four'], `${path}.horns.count`);
    enumValue(horns.confidence, ['stylized'], `${path}.horns.confidence`);
    for (const [key, min, max] of [['central_span_ratio', .4, .6], ['rise_ratio', .15, .4], ['outer_rise_scale', 1.05, 1.25]] as const) {
      const value = number(horns[key], `${path}.horns.${key}`); if (value < min || value > max) fail(`${path}.horns.${key}`);
    }
    const n = integer(spec.curve_sections, `${path}.curve_sections`); if (n < 4 || n > 32 || n % 2) fail(`${path}.horns.curve_sections`);
  }
}
function finiteTree(value: unknown, path: string): void {
  if (typeof value === 'number') number(value, path);
  else if (Array.isArray(value)) value.forEach((item, index) => finiteTree(item, `${path}[${index}]`));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => finiteTree(item, `${path}.${key}`));
}
export function validateHouseConfig(value: unknown): asserts value is HouseConfig {
  const config = object(value, 'settings');
  if (config.schema_version !== HOUSE_SCHEMA) fail('settings.schema_version');
  for (const key of ['seed', 'pack', 'era']) string(config[key], `settings.${key}`);
  nullableString(config.recipe, 'settings.recipe');
  enumValue(config.mode, ['historical_strict', 'historical_inspired', 'fantasy_mix'], 'settings.mode');
  if (typeof config.allow_late !== 'boolean') fail('settings.allow_late');
  integer(config.count, 'settings.count');
  for (const key of ['size', 'variation', 'wealth', 'orientation_deg']) number(config[key], `settings.${key}`);
  const overrides = object(config.overrides, 'settings.overrides');
  if (overrides.variant !== undefined) nullableString(overrides.variant, 'settings.overrides.variant');
  for (const key of ['footprint', 'roof', 'frame', 'infill', 'coating', 'cladding']) nullableString(overrides[key], `settings.overrides.${key}`);
  for (const key of ['floors', 'bodies', 'courtyard_ratio', 'overhang_m', 'roof_pitch_deg', 'site_slope_deg']) if (overrides[key] !== null) number(overrides[key], `settings.overrides.${key}`);
  if (config.workshop !== undefined) {
    const workshop = object(config.workshop, 'settings.workshop');
    string(workshop.preset_id, 'settings.workshop.preset_id');
    for (const key of ['footprint', 'roof', 'roof_frame', 'base']) nullableString(workshop[key], `settings.workshop.${key}`);
    for (const key of ['width_m', 'depth_m']) if (workshop[key] !== null) number(workshop[key], `settings.workshop.${key}`);
    if (workshop.support !== null) {
      const support = object(workshop.support, 'settings.workshop.support');
      enumValue(support.kind, ['ground', 'posts', 'piers', 'raft', 'rock'], 'settings.workshop.support.kind');
      nullableString(support.material, 'settings.workshop.support.material');
      if (!Array.isArray(support.height_m) || support.height_m.length !== 2) fail('settings.workshop.support.height_m');
      support.height_m.forEach((height: unknown) => number(height, 'settings.workshop.support.height_m'));
    }
  }
}
export function validateHouseBatch(value: unknown): asserts value is HouseBatch {
  const batch = object(value, 'batch');
  if (batch.schema_version !== HOUSE_SCHEMA) fail('schema_version');
  string(batch.catalogue_version, 'catalogue_version'); string(batch.generator_version, 'generator_version');
  validateHouseConfig(batch.settings); strings(batch.diagnostics, 'diagnostics');
  finiteTree(batch, 'batch');
  const units = array(batch.units, 'units');
  if (units.length !== batch.settings.count) fail('units.count');
  units.forEach((raw, unitIndex) => {
    const u = object(raw, `units[${unitIndex}]`), path = `units[${unitIndex}]`;
    for (const key of ['id', 'recipe_id', 'variant_id', 'label']) string(u[key], `${path}.${key}`);
    enumValue(u.role, roles, `${path}.role`); strings(u.diagnostics, `${path}.diagnostics`);
    const transform = object(u.transform, `${path}.transform`); point(transform.origin, `${path}.origin`); number(transform.orientation_deg, `${path}.orientation_deg`);
    surface(u.lot, `${path}.lot`); partition(u.partition, `${path}.partition`);
    const unitLevels = array(u.levels, `${path}.levels`);
    unitLevels.forEach(level => { integer(level.index, `${path}.level.index`); number(level.z_min, `${path}.level.z_min`); number(level.z_max, `${path}.level.z_max`); if (level.z_max < level.z_min) fail(`${path}.level.range`); });
    array(u.level_partitions, `${path}.level_partitions`).forEach(p => { integer(p.level, `${path}.partition.level`); number(p.z_m, `${path}.partition.z_m`); surface(p.domain, `${path}.partition.domain`); partition(p.partition, `${path}.partition.partition`); });
    const bodies = array(u.bodies, `${path}.bodies`), bodyIds = new Set(bodies.map(body => string(body.id, `${path}.body.id`)));
    bodies.forEach(body => {
      surface(body.footprint, `${path}.body.footprint`); enumValue(body.role, roles, `${path}.body.role`);
      for (const key of ['roof_system', 'envelope', 'vertical_access']) string(body[key], `${path}.body.${key}`);
      enumValue(body.envelope, ['walled', 'open', 'shell', 'rockcut', 'membrane'], `${path}.body.envelope`);
      enumValue(body.vertical_access, ['none', 'internal_stair', 'exterior_stair', 'ladder', 'roof_hatch', 'intramural_stair'], `${path}.body.vertical_access`);
      if (body.vertical_routes !== undefined) array(body.vertical_routes, `${path}.body.vertical_routes`).forEach(route => {
        enumValue(route.kind, ['none', 'internal_stair', 'exterior_stair', 'ladder', 'roof_hatch', 'intramural_stair'], `${path}.route.kind`);
        integer(route.from_level, `${path}.route.from_level`); integer(route.to_level, `${path}.route.to_level`); number(route.min_width_m, `${path}.route.min_width_m`);
        enumValue(route.placement, ['main', 'north', 'south', 'east', 'west', 'peripheral', 'adjacent', 'central', 'courtyard', 'rear', 'facing_main', 'along_front'], `${path}.route.placement`);
      });
      for (const key of ['roof_pitch_deg', 'overhang_m', 'wall_thickness_m']) number(body[key], `${path}.body.${key}`);
      nullableString(body.component_id, `${path}.body.component_id`); strings(body.details, `${path}.body.details`);
      array(body.cells, `${path}.body.cells`).forEach(cell => { string(cell.id, `${path}.cell.id`); surface(cell.footprint, `${path}.cell.footprint`); integer(cell.floors, `${path}.cell.floors`); nullableString(cell.household_id, `${path}.cell.household_id`); });
      if (body.voids !== undefined) array(body.voids, `${path}.body.voids`).forEach(voidSurface => surface(voidSurface, `${path}.body.voids`));
      roofSpec(body.roof_spec, `${path}.body.roof_spec`);
      array(body.roof_arms, `${path}.body.roof_arms`).forEach(arm => { if (arm.source_component !== undefined && arm.source_component !== null) fail(`${path}.body.arm.source_component`); point(arm.origin, `${path}.arm.origin`); surface(arm.domain, `${path}.arm.domain`); number(arm.length_m, `${path}.arm.length`); number(arm.width_m, `${path}.arm.width`); if (array(arm.axis, `${path}.arm.axis`).length !== 2) fail(`${path}.arm.axis`); arm.axis.forEach((n: unknown) => number(n, `${path}.arm.axis`)); });
      array(body.levels, `${path}.body.levels`).forEach(level => { integer(level.index, `${path}.level.index`); number(level.z_m, `${path}.level.z`); number(level.height_m, `${path}.level.height`); surface(level.footprint, `${path}.level.footprint`); surface(level.floor, `${path}.level.floor`); enumValue(level.intermediate_cover, ['none', 'terrace', 'shed', 'skirt'], `${path}.level.intermediate_cover`); if (level.roof_slab !== null) { const slab = object(level.roof_slab, `${path}.level.roof_slab`); surface(slab.surface, `${path}.slab.surface`); number(slab.z_m, `${path}.slab.z`); if (typeof slab.walkable !== 'boolean') fail(`${path}.slab.walkable`); nullableString(slab.access_node, `${path}.slab.access_node`); } materials(level.materials, `${path}.level.materials`); });
    });
    const features = [...array(u.features, `${path}.features`), ...array(u.site_context, `${path}.site_context`)];
    const featureIds = new Set(features.map(feature => string(feature.id, `${path}.feature.id`)));
    const supportIds = new Set([...array(u.features, `${path}.features`).filter(feature => ['post', 'beam', 'pier'].includes(feature.kind)), ...array(u.walls, `${path}.walls`)].map(support => string(support.id, `${path}.support.id`)));
    features.forEach(f => { for (const key of ['id', 'material']) string(f[key], `${path}.feature.${key}`); enumValue(f.kind, featureKinds, `${path}.feature.kind`); surface(f.surface, `${path}.feature.surface`); number(f.z_m, `${path}.feature.z`); number(f.height_m, `${path}.feature.height`); array(f.vertices3d, `${path}.feature.vertices3d`).forEach(v => point(v, `${path}.feature.vertex`, true)); });
    features.forEach(feature => {
      if (feature.roof === undefined || feature.roof === null) return;
      const attachment = object(feature.roof, `${path}.feature.roof`);
      nullableString(attachment.owner_body_id, `${path}.attachment.owner_body_id`);
      if (attachment.owner_body_id !== null && !bodyIds.has(attachment.owner_body_id)) fail(`${path}.attachment.body_reference`);
      if (attachment.nested !== undefined && typeof attachment.nested !== 'boolean') fail(`${path}.attachment.nested`);
      if (attachment.nested === true && (feature.kind !== 'inner_membrane' || attachment.owner_body_id === null)) fail(`${path}.attachment.nested_owner`);
      integer(attachment.level, `${path}.attachment.level`); surface(attachment.domain, `${path}.attachment.domain`);
      for (const key of ['rf', 'material', 'frame_material']) string(attachment[key], `${path}.attachment.${key}`);
      for (const key of ['support_z_m', 'pitch_deg', 'overhang_m', 'max_span_m']) number(attachment[key], `${path}.attachment.${key}`);
      roofSpec(attachment.spec, `${path}.attachment.spec`);
      const arms = array(attachment.arms, `${path}.attachment.arms`);
      if (arms.some(arm => arm.source_component !== undefined && arm.source_component !== null)) {
        const count = array(attachment.domain, `${path}.attachment.domain`).length;
        const indices = arms.map(arm => integer(arm.source_component, `${path}.attachment.arm.source_component`));
        if (indices.some(index => index >= count) || new Set(indices).size !== count) fail(`${path}.attachment.arm.source_component`);
        if (count > 1 && attachment.spec.triangulation === 'boundary') fail(`${path}.attachment.component_boundary`);
      }
      arms.forEach(arm => { point(arm.origin, `${path}.attachment.arm.origin`); surface(arm.domain, `${path}.attachment.arm.domain`); number(arm.length_m, `${path}.attachment.arm.length`); number(arm.width_m, `${path}.attachment.arm.width`); if (array(arm.axis, `${path}.attachment.arm.axis`).length !== 2) fail(`${path}.attachment.arm.axis`); arm.axis.forEach((v: unknown) => number(v, `${path}.attachment.arm.axis`)); });
      strings(attachment.supports, `${path}.attachment.supports`); attachment.supports.forEach((id: string) => { if (!supportIds.has(id)) fail(`${path}.attachment.support_reference`); });
    });
    const walls = array(u.walls, `${path}.walls`), wallIds = new Set(walls.map(wall => string(wall.id, `${path}.wall.id`)));
    walls.forEach(wall => { enumValue(wall.kind, ['exterior', 'interior', 'enclosure', 'party', 'shell', 'retaining', 'rock'], `${path}.wall.kind`); nullableString(wall.body_id, `${path}.wall.body_id`); integer(wall.level, `${path}.wall.level`); number(wall.z_m, `${path}.wall.z`); number(wall.height_m, `${path}.wall.height`); surface(wall.footprint, `${path}.wall.footprint`); array(wall.centerline, `${path}.wall.centerline`).forEach(p => point(p, `${path}.wall.point`)); string(wall.material, `${path}.wall.material`); if (typeof wall.party !== 'boolean') fail(`${path}.wall.party`); strings(wall.opening_ids, `${path}.wall.opening_ids`); });
    walls.forEach(wall => {
      if (wall.plan_section !== undefined && wall.plan_section !== null) surface(wall.plan_section, `${path}.wall.plan_section`);
      if (wall.shell_reference !== undefined && typeof wall.shell_reference !== 'boolean') fail(`${path}.wall.shell_reference`);
      if (wall.solid === undefined || wall.solid === null) return;
      const solid = object(wall.solid, `${path}.wall.solid`), vertices = array(solid.vertices, `${path}.solid.vertices`);
      vertices.forEach(vertex => point(vertex, `${path}.solid.vertex`, true));
      array(solid.faces, `${path}.solid.faces`).forEach(face => {
        const indices = array(face, `${path}.solid.face`); if (indices.length < 3) fail(`${path}.solid.face`);
        indices.forEach(index => { integer(index, `${path}.solid.index`); if (index >= vertices.length) fail(`${path}.solid.index`); });
      });
    });
    const access = object(u.access, `${path}.access`), nodes = array(access.nodes, `${path}.access.nodes`), nodeIds = new Set(nodes.map(node => string(node.id, `${path}.node.id`)));
    if (!nodeIds.has(string(access.root, `${path}.access.root`))) fail(`${path}.access.root_reference`);
    nodes.forEach(node => { enumValue(node.kind, ['exterior', 'courtyard', 'circulation', 'room', 'stair_landing', 'terrace', 'gallery', 'platform', 'tunnel'], `${path}.node.kind`); surface(node.floor, `${path}.node.floor`); number(node.z_m, `${path}.node.z`); if (node.household_id !== undefined) nullableString(node.household_id, `${path}.node.household_id`); });
    array(access.portals, `${path}.access.portals`).forEach(portal => {
      string(portal.id, `${path}.portal.id`); enumValue(portal.kind, ['door', 'gate', 'passage', 'stair', 'ladder', 'hatch', 'tunnel', 'bridge'], `${path}.portal.kind`);
      if (portal.shape !== undefined) enumValue(portal.shape, ['rect', 'trapezoid'], `${path}.portal.shape`);
      for (const key of ['top_width_m', 'sill_z_m']) if (portal[key] !== undefined && portal[key] !== null) number(portal[key], `${path}.portal.${key}`);
      if (portal.profile_id !== undefined) nullableString(portal.profile_id, `${path}.portal.profile_id`);
      if (!nodeIds.has(portal.from) || !nodeIds.has(portal.to)) fail(`${path}.portal.node_reference`);
      nullableString(portal.wall_id, `${path}.portal.wall_id`); if (portal.wall_id !== null && !wallIds.has(portal.wall_id)) fail(`${path}.portal.wall_reference`);
      if (array(portal.opening, `${path}.portal.opening`).length !== 2) fail(`${path}.portal.opening`); portal.opening.forEach((p: unknown) => point(p, `${path}.portal.point`));
      surface(portal.opening_surface, `${path}.portal.opening_surface`); surface(portal.passage, `${path}.portal.passage`);
      for (const key of ['width_m', 'from_z_m', 'to_z_m']) number(portal[key], `${path}.portal.${key}`);
      if (portal.head_z_m !== undefined) number(portal.head_z_m, `${path}.portal.head_z_m`);
      strings(portal.feature_ids, `${path}.portal.feature_ids`);
    });
    array(u.rooms, `${path}.rooms`).forEach(room => { string(room.id, `${path}.room.id`); if (!bodyIds.has(room.body_id) || !nodeIds.has(room.access_node)) fail(`${path}.room.reference`); integer(room.level, `${path}.room.level`); number(room.z_m, `${path}.room.z`); surface(room.floor, `${path}.room.floor`); enumValue(room.usage, ['living', 'kitchen', 'storage', 'workshop', 'shop', 'byre', 'barn', 'communal', 'guest', 'service', 'ritual', 'hall', 'gallery', 'office'], `${path}.room.usage`); nullableString(room.household_id, `${path}.room.household_id`); });
    const roofs = object(u.roofs, `${path}.roofs`), vertices = array(roofs.vertices, `${path}.roofs.vertices`), faces = array(roofs.faces, `${path}.roofs.faces`);
    vertices.forEach(v => point(v, `${path}.roof.vertex`, true));
    const groups = array(roofs.groups, `${path}.roofs.groups`), groupIds = new Set(groups.map(group => string(group.id, `${path}.roof.group.id`)));
    const roofOwner = (value: Record<string, any>, label: string) => {
      string(value.body_id, `${path}.${label}.body_id`);
      if (value.feature_id === undefined || value.feature_id === null) { if (!bodyIds.has(value.body_id)) fail(`${path}.${label}.body_reference`); }
      else if (!featureIds.has(string(value.feature_id, `${path}.${label}.feature_id`)) || (value.body_id && !bodyIds.has(value.body_id))) fail(`${path}.${label}.feature_reference`);
    };
    const roomIds = new Set(u.rooms.map((room: Record<string, any>) => room.id));
    groups.forEach(group => { string(group.rf, `${path}.group.rf`); roofOwner(group, 'group'); integer(group.level, `${path}.group.level`); surface(group.domain, `${path}.group.domain`); if (group.room_id !== undefined && group.room_id !== null && !roomIds.has(string(group.room_id, `${path}.group.room_id`))) fail(`${path}.group.room_reference`); });
    faces.forEach(face => {
      roofOwner(face, 'face'); if (!groupIds.has(face.roof_group)) fail(`${path}.face.reference`);
      integer(face.level, `${path}.face.level`); enumValue(face.kind, ['pan', 'slab', 'gable', 'tympanum', 'step_wall', 'drum', 'parapet', 'skirt', 'stepped_gable', 'corbel_soffit', 'corbel_riser', 'shell_outer', 'shell_inner', 'shell_rib', 'shell_rib_end', 'shell_jamb', 'shell_lintel'], `${path}.face.kind`); string(face.rf, `${path}.face.rf`); string(face.material, `${path}.face.material`); nullableString(face.component_id, `${path}.face.component_id`);
      if (array(face.vertices, `${path}.face.vertices`).length < 3) fail(`${path}.face.vertices`);
      face.vertices.forEach((index: unknown) => { if (integer(index, `${path}.face.index`) >= vertices.length) fail(`${path}.face.index`); });
      if (array(face.normal, `${path}.face.normal`).length !== 3) fail(`${path}.face.normal`); face.normal.forEach((n: unknown) => number(n, `${path}.face.normal`));
    });
    array(roofs.edges, `${path}.roof.edges`).forEach(edge => {
      enumValue(edge.kind, ['eave', 'ridge', 'hip', 'valley', 'crease', 'junction', 'step', 'verge', 'oculus'], `${path}.edge.kind`);
      if (array(edge.vertices, `${path}.edge.vertices`).length !== 2 || array(edge.faces, `${path}.edge.faces`).length !== 2) fail(`${path}.edge.pair`);
      edge.vertices.forEach((index: unknown) => { if (integer(index, `${path}.edge.index`) >= vertices.length) fail(`${path}.edge.index`); });
      edge.faces.forEach((index: unknown) => { if (index !== null && integer(index, `${path}.edge.face`) >= faces.length) fail(`${path}.edge.face`); });
    });
  });
}
export function parseHouseBatch(json: string): HouseBatch {
  if (new TextEncoder().encode(json).byteLength > HOUSE_MAX_JSON_BYTES) throw new Error('Réponse maisons trop volumineuse.');
  const parsed = JSON.parse(json);
  if (parsed && typeof parsed.ok === 'boolean') {
    if (!parsed.ok) throw new Error(`[${parsed.error?.code ?? 'engine_error'}] ${parsed.error?.message ?? 'Erreur moteur maisons.'}`);
    validateHouseBatch(parsed.data);
    return parsed.data;
  }
  validateHouseBatch(parsed);
  return parsed;
}
