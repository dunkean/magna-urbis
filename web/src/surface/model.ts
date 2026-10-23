/** Renderer-independent physical surface contract. X/Z horizontal, Y altitude, all in metres. */
export const SURFACE_SCHEMA_VERSION = 1 as const;
export const SURFACE_COMPILER_VERSION = 'surface-1.0.0';
export interface Bounds { minX: number; minZ: number; maxX: number; maxZ: number }
export interface SourceIdentity {
  id: string; version: string; sourceLOD: number; nativeSpacingM: number;
  provenance?: string;
}
/** Row-major samples: index = z * width + x; bounds include the last sample. */
export interface TerrainGrid {
  width: number; height: number; originX: number; originZ: number; spacingM: number;
  heights: Float32Array; source: SourceIdentity;
}
export type Lithology = 'granite' | 'limestone' | 'sandstone' | 'mudstone' | 'basalt';
export interface RockUnit {
  id: number; name: string; lithology: Lithology;
  /** Mineral phase only, sum exactly one (within numerical tolerance). */
  sand: number; silt: number; clay: number;
  hardness: number; weatherability: number; colorLinear: [number, number, number];
  strikeRadians: number;
}
export interface GeologyInput {
  version: string; provenance: string; units: RockUnit[];
  /** Explicit ids at canonical terrain grid samples. */
  bedrock: Uint16Array;
}
export const enum WaterClass { Dry = 0, River = 1, Lake = 2, Ocean = 3 }
export const enum Landform { Flat = 0, Ridge = 1, Shoulder = 2, Slope = 3, Hollow = 4, Footslope = 5, Valley = 6 }
export const enum DepositOrigin { Residual = 0, Colluvial = 1, Alluvial = 2, Aeolian = 3, Coastal = 4 }
export const enum Occupation { Natural = 0, Meadow = 1, Crop = 2, Pasture = 3, Orchard = 4, Road = 5, Built = 6, Yard = 7 }
export interface UpstreamInflow {
  cell: number; contributingAreaM2: number;
  /** Weighted proportions of the explicit geology unit ids. */
  provenance: Array<{ unitId: number; fraction: number }>;
}
export interface HydrologyInput {
  version: string; provenance: string;
  /** Authoritative directed source routing; -1 is outlet/closed sink. Must be acyclic. */
  downstream?: Int32Array;
  contributingAreaM2?: Float32Array;
  waterClass?: Uint8Array;
  /** NaN at dry cells is supported. No level is fabricated for a supplied dry river. */
  waterLevelM?: Float32Array;
  inflows?: UpstreamInflow[];
  /** A bounded tile is not a complete upstream basin. */
  boundary?: 'complete-basin' | 'external-inflows' | 'truncated';
}
export interface ClimateInput {
  version: string; meanAnnualTempC: number; annualPrecipMm: number;
  seasonalAmplitudeC?: number; referenceElevationM?: number;
  lapseRateCPerKm?: number; windRadians?: number;
  /** Already corrected imported climate must set this true to avoid a second lapse correction. */
  elevationCorrected?: boolean;
}
export interface OccupationInput { version: string; classes: Uint8Array; orientationRadians?: Float32Array }
export interface ProcessInput {
  /** Declared available sand, coastline distance and inherited special terrain; never inferred from climate alone. */
  aeolianSupply?: Float32Array; coastDistanceM?: Float32Array;
  karst?: Uint8Array; volcanic?: Uint8Array; geothermal?: Uint8Array; periglacial?: Uint8Array;
}
export interface SurfaceState { version: string; dayOfYear: number; surfaceWetness?: number; snowWaterEquivalentM?: number }
export interface SurfaceCompileInput {
  seed: number; terrain: TerrainGrid; geology?: GeologyInput; hydrology?: HydrologyInput;
  climate?: ClimateInput; occupation?: OccupationInput; processes?: ProcessInput; state?: SurfaceState;
}
export interface CompileOptions { signal?: AbortSignal; topographicRadiiM?: number[] }
export type SurfaceFamily = 'mineral-plains' | 'bedrock' | 'aeolian' | 'arid-erosion' | 'gravity' |
  'karst' | 'volcanic' | 'alluvial' | 'inland-water' | 'wetland' | 'sedimentary-coast' |
  'rocky-coast' | 'marine' | 'vegetation' | 'snow-ice';
export interface MaterialRecipe {
  id: string; version: string; family: SurfaceFamily;
  compatibleSubstrates: Lithology[]; compatibleProcesses: DepositOrigin[];
  colorLinear: [number, number, number]; roughness: number;
  physicalExtentMetres: number; heightAmplitudeMetres: number;
  synthesisMode: 'patches' | 'fractures' | 'ridges' | 'deposits' | 'canopy' | 'water' | 'cracks';
  provenance: string; normalConvention: 'opengl';
  maps?: { baseColor: string; normal: string; roughness: string; height?: string; ao?: string };
  wetResponse: number; snowRetention: number;
}
export interface SurfaceFields {
  slope: Float32Array; aspect: Float32Array; curvature: Float32Array;
  topographicPosition: Float32Array[]; landform: Uint8Array; bedrock: Uint16Array;
  downstream: Int32Array; contributingAreaM2: Float32Array; basin: Int32Array;
  waterClass: Uint8Array; waterLevelM: Float32Array; distanceToWaterM: Float32Array;
  handM: Float32Array; twi: Float32Array; closedBasin: Uint8Array;
  depositOrigin: Uint8Array; depositDepthM: Float32Array; sourceRock: Uint16Array;
  /** Per-unit transported source fractions, in world.geology.units order. */
  provenance: Float32Array[];
  sand: Float32Array; silt: Float32Array; clay: Float32Array; organic: Float32Array;
  stoniness: Float32Array; soilDepthM: Float32Array; moisture: Float32Array;
  temperatureC: Float32Array; precipitationMm: Float32Array;
  treeCover: Float32Array; grassCover: Float32Array; shrubCover: Float32Array; litter: Float32Array;
  occupation: Uint8Array; orientation: Float32Array; material: Uint16Array;
  snow: Float32Array; wetness: Float32Array;
}
export interface SurfaceVersions {
  terrain: string; hydrology: string; geology: string; environment: string;
  occupation: string; population: string; materialLibrary: string; surfaceState: string;
}
export interface SurfaceWorld {
  schemaVersion: typeof SURFACE_SCHEMA_VERSION; compilerVersion: string; id: string; seed: number;
  units: 'metres'; crs: 'local-xz'; bounds: Bounds; versions: SurfaceVersions;
  terrain: TerrainGrid; geology: GeologyInput; climate: ClimateInput; state: SurfaceState;
  fields: SurfaceFields; materials: MaterialRecipe[]; topographicRadiiM: number[];
  diagnostics: { warnings: string[]; assumptions: string[]; hydrologyBoundary: string; estimatedBytes: number };
}
export interface SurfaceSample {
  x: number; z: number; heightM: number; slope: number; aspect: number; curvature: number;
  landform: Landform; bedrock: RockUnit; sourceRock: RockUnit; depositOrigin: DepositOrigin;
  depositDepthM: number; sand: number; silt: number; clay: number; organic: number;
  stoniness: number; soilDepthM: number; moisture: number; contributingAreaM2: number;
  handM: number; distanceToWaterM: number; waterClass: WaterClass; waterLevelM: number;
  temperatureC: number; precipitationMm: number; treeCover: number; grassCover: number;
  shrubCover: number; litter: number; occupation: Occupation; orientation: number;
  snow: number; wetness: number; material: MaterialRecipe;
  provenance: Array<{ unitId: number; fraction: number }>;
}
export interface SurfaceCandidate {
  stableId: string; family: 'tree' | 'shrub' | 'grass' | 'boulder' | 'debris';
  x: number; y: number; z: number; size: number; orientation: number; variant: number;
  /** Use this rank for nested representation thinning; never regenerate at another LOD. */
  rank: number;
}

export function terrainBounds(t: TerrainGrid): Bounds {
  return { minX: t.originX, minZ: t.originZ, maxX: t.originX + (t.width - 1) * t.spacingM, maxZ: t.originZ + (t.height - 1) * t.spacingM };
}
export function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Surface request aborted', 'AbortError');
}
/** Portable FNV-1a hash over explicit bytes/text; not a security primitive. */
export function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
export function clamp(value: number, min = 0, max = 1): number { return Math.max(min, Math.min(max, value)); }
