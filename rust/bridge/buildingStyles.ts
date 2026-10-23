/** Wire contract for the native cached architectural style index.
 * A style ID selects one coherent recipe/variant bundle. Facets contain exact
 * atlas declarations, never translated labels or guessed architectural usages.
 */
import type {
  ArchitectureTypology, HistoricalMode, HouseCatalogue, HouseRole, Layout, Placement, Recipe, SourceDigest,
} from './housesContract';

export const BUILDING_STYLE_SCHEMA = 'building-styles-1';
export type BuildingMorphology = 'single' | 'linear' | 'courtyard' | 'compound' | 'terraced' | 'ring' | 'specialized';
export interface BuildingStyleCapabilities {
  native_plan: boolean;
  constrained_composition: boolean;
  /** No arbitrary polygon-decomposition operator is advertised in this version. */
  imposed_polygon: boolean;
  /** Bounded orthogonal fitting; body count, dimensions and access still apply. */
  imposed_orthogonal_footprint: boolean;
}

export interface BuildingComponentConstraint {
  id: string;
  role: HouseRole;
  placement: Placement;
  count: [number, number];
  /** Exactly count[0] === 0; component names never imply optionality. */
  optional: boolean;
  footprint_family: string;
  roof_system: string;
  width_ratio: [number, number];
  depth_ratio: [number, number];
  floors: [number, number];
}

export interface BuildingStyleConstraints {
  /** Source dimensions, not guarantees for arbitrary buildable envelopes. */
  nominal_width_m: [number, number];
  nominal_depth_m: [number, number];
  floors: [number, number];
  bodies: [number, number];
  cells: [number, number];
  courtyard_ratio: [number, number];
  wall_thickness_m: [number, number];
  roof_pitch_deg: [number, number];
  overhang_m: [number, number];
  allowed_footprints: string[];
  allowed_roofs: string[];
  components: BuildingComponentConstraint[];
}

export interface BuildingStyleEntry {
  /** `${recipe_id}::${variant_id}`, stable across sorting and LOD. */
  id: string;
  recipe_id: string;
  variant_id: string;
  label: string;
  variant_label: string;
  pack_id: string;
  tradition_id?: string;
  inspired_only: boolean;
  role: HouseRole;
  /** Exact atlas profile, used as the explicit typology facet. */
  profile: string;
  component_kind: string | null;
  layout: Layout;
  typology: ArchitectureTypology;
  morphology: BuildingMorphology;
  footprint_family: string;
  roof_system: string;
  footprint_families: string[];
  roof_systems: string[];
  /** Principal/component/level material slots, including supports. */
  materials: string[];
  temporal: Recipe['temporal'];
  confidence: { recipe: string; variant: string; roof: string; chronology: string; pack: string };
  sources: Recipe['sources'];
  settlement_pattern: string;
  settlement_archetype: string;
  subtradition: string;
  compound_pattern: string;
  surface_language: string;
  weight: number;
  /** A planned functional association is not an implemented generator. */
  functional_mappings: HouseCatalogue['functional_mappings'];
  capabilities: BuildingStyleCapabilities;
  constraints: BuildingStyleConstraints;
}

export type BuildingStyleFacet = 'pack' | 'tradition' | 'recipe' | 'variant' | 'role' | 'profile'
  | 'layout' | 'typology' | 'morphology' | 'footprint' | 'roof' | 'material' | 'era'
  | 'source' | 'confidence' | 'settlement_archetype' | 'compound_pattern' | 'subtradition';

export interface BuildingStyleIndex {
  schema_version: typeof BUILDING_STYLE_SCHEMA;
  catalogue_version: string;
  generator_version: string;
  sources: SourceDigest[];
  entries: BuildingStyleEntry[];
  /** Sorted entry positions, not stable IDs. Never persist these positions. */
  facets: Partial<Record<BuildingStyleFacet, Record<string, number[]>>>;
}

/** Omitted fields use native defaults: automatic residential selection, all
 * variants, historical_inspired, era any, and late profiles excluded. */
export interface BuildingStyleQuery {
  pack_id?: string | null;
  tradition_id?: string | null;
  recipe_id?: string | null;
  variant_id?: string | null;
  role?: HouseRole | null;
  profile?: string | null;
  layout?: Layout | null;
  /** Uses native placement's Layout mapping. `common` applies no restriction. */
  typology?: ArchitectureTypology | null;
  morphology?: BuildingMorphology | null;
  footprint?: string | null;
  roof?: string | null;
  material?: string | null;
  confidence?: string | null;
  source?: string | null;
  settlement_archetype?: string | null;
  era?: string;
  year?: number | null;
  mode?: HistoricalMode;
  allow_late?: boolean;
  automatic?: boolean;
  include_variants?: boolean;
  constrained_composition?: boolean | null;
}
