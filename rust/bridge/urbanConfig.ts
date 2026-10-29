export interface ProgrammeContext {
  role: 'auto' | ProgrammeIsolatedRole | 'agricultural' | 'crossroads' | 'artisan' | 'riverine' | 'port' | 'capital';
  /** Missing/null retains the exact legacy role behaviour. An explicit empty
   * object means no specialization; non-isolated legacy role is then ignored. */
  functions?: ProgrammeFunctionWeights | null;
  resources: string[]; period: string; mode: 'strict' | 'inspired' | 'fantasy';
  /** Explicit navigable access, never derived from visible water. */
  navigableAccess: boolean; lore: string[];
  /** Settlement condition (Rust `services.json` states); absent = `thriving`. */
  state?: ProgrammeState;
  /** Share of empty buildings, 0..1; absent or null = the state's default. */
  decay?: number | null;
}
/** A single structure without a town: one intent on one unsubdivided domain. */
export type ProgrammeIsolatedRole = 'isolated-farm' | 'roadside-temple' | 'isolated-shrine' | 'isolated-mill' | 'isolated-inn' | 'isolated-tower';
export type ProgrammeState = 'thriving' | 'declining' | 'abandoned' | 'ruined';
export const PROGRAMME_FUNCTIONS = ['agricultural', 'commerce', 'artisan', 'riverine', 'port', 'capital'] as const;
export type ProgrammeFunction = typeof PROGRAMME_FUNCTIONS[number];
export type ProgrammeFunctionWeights = Partial<Record<ProgrammeFunction, number>>;
/** Reject unsupported keys/weights explicitly, never clamp or drop an intent. */
export function normalizeProgrammeFunctions(value: unknown): ProgrammeFunctionWeights {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Fonctions urbaines invalides : objet de poids requis.');
  const result: ProgrammeFunctionWeights = {};
  for (const key of Object.keys(value)) {
    if (!(PROGRAMME_FUNCTIONS as readonly string[]).includes(key)) throw new Error(`Fonction urbaine inconnue : ${key}.`);
    const weight = (value as Record<string, unknown>)[key];
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 1) throw new Error(`Poids de ${key} invalide : nombre fini entre 0 et 1 requis.`);
    result[key as ProgrammeFunction] = weight;
  }
  return result;
}
export const defaultProgrammeContext = (): ProgrammeContext => ({ role: 'auto', resources: [], period: '', mode: 'inspired', navigableAccess: false, lore: [] });
/** Pure configuration boundary; the legacy web editor must not load Rust/WASM. */
export interface ParcelConfig { preset: string; culture?: string; recipe: string; zone: string; density: number; params: Record<string, unknown>; operator: 'culture' | 'strips' | 'oriented' | 'compact' | 'inherited' | 'courtyard' | 'frontage' | 'compound' | 'wholeBlock' | 'garden';
  streetAlignedHomes?: boolean;
  denserSmallholdings?: boolean;
  /** User edits; the layout stage reads `quarters`, the parcel stage `parcels`. */
  overrides?: UrbanEdits;
  /** Parcel operator per growth zone (`core`, `middle`, `edge`, `faubourg`, `village`); absent = `operator`. */
  zoneOperators?: Record<string, ParcelConfig['operator']> }
/** Another culture and/or street tissue for one growth zone (Rust `PhaseOverride`); absent = the settlement's own. */
export interface PhaseOverride { culture?: string; recipe?: string; tissue?: string }
/** User edits of single quarters (keyed by quarter index, Rust `UrbanOverrides`)
 * and single lots (keyed by parcel id, Rust `ParcelOverrides`). */
export interface UrbanEdits {
  quarters?: Record<string, QuarterOverride>;
  parcels?: Record<string, ParcelOverride>;
}
/** A user-drawn polygon in world metres (outer ring, optional holes); rounded to 0.1 m by the UI. */
export interface EditShape { outer: { x: number; y: number }[]; holes?: { x: number; y: number }[][] }
export interface QuarterOverride {
  culture?: string; tissue?: string; density?: number; role?: string; wealth?: number;
  /** New outline of the quarter. The engine clips it, so the applied shape can be smaller. */
  shape?: EditShape;
  /** The quarter's blocks and lots are removed. The land returns to open ground; main streets stay. */
  deleted?: boolean;
  /** Redraw of the quarter's interior: 1, 2, 3… (absent = the original draw). */
  salt?: number;
}
export interface ParcelOverride {
  role?: string; function?: string; households?: number;
  /** New outline of the lot, clipped to its block. Neighbours give up or take back the difference. */
  shape?: EditShape;
  /** 'merge': the lot is absorbed by its best neighbour (default of « Supprimer »).
   *  'garden': the lot stays, as unbuilt open ground. */
  deleted?: 'merge' | 'garden';
  /** Redraw of the lot's role among admissible demands, plus its building seed. */
  salt?: number;
}
export interface FootprintConfig {
  mechanism: 'auto' | 'legacy' | 'planned' | 'accessibility' | 'ribbon' | 'fusion';
  family: 'auto' | 'circle' | 'rectangle' | 'polygon' | 'compact' | 'elongated' | 'linear' | 'fan' | 'fingers' | 'dendritic' | 'lobed' | 'archipelago' | 'composite';
  budget: 'population' | 'radius'; grossDensity: number; aspect: number; orientation: number; nuclei: number; irregularity: number; anisotropy: number; separation: number; epochs: number;
  cohesion: number; satellites: number; branchDepth: number; gapSize: number;
}
/** `auto` or one of Rust urban::fortification::STYLES; the native resolver
 * retains the cultural style when an explicit style does not fit the kind. */
export const FORTIFICATION_STYLES = ['auto', 'palisade', 'gord', 'hedge', 'curtain', 'flanked', 'concentric', 'rammed-earth', 'wengcheng', 'bastioned'] as const;
export type FortificationStyle = typeof FORTIFICATION_STYLES[number];
export interface LayoutConfig extends Omit<ParcelConfig, 'operator' | 'zoneOperators' | 'streetAlignedHomes' | 'denserSmallholdings'> {
  phaseOverrides?: Record<string, PhaseOverride>;
  programme: ProgrammeContext;
  axisAlignment: 'regional' | 'culture'; mixCulture: string; mixMode: 'phases' | 'sectors'; mixShare: number; mixAngle: number; exitTreatment: 'legacy' | 'adaptive' | 'closed'; peripheralRoad: 'auto' | 'none' | 'partial' | 'full'; siteAdaptation: number;
  composition: 'settlement' | 'district'; settlementForm: 'auto' | 'nucleated' | 'ribbon' | SettlementKind; suburbs: 'auto' | 'none' | 'few' | 'many'; phases: number;
  count: number; rings: number; radius: number; radiusScale: number; placement: 'center' | 'rectangle' | 'skew' | 'notched'; monument: string;
  fortification: 'culture' | 'none' | 'wall' | 'palisade'; fortificationStyle: FortificationStyle;
  wallStiffness: number | null; wallTerrain: number | null; wallRelief: number | null; wallTowerSpacing: number | null; ditchWetness: number | null;
  riverControlMode: '' | 'none' | 'bank-walls' | 'bank-walls-chain'; portEnclosure: '' | 'auto' | 'inside' | 'separate' | 'outside'; plannedWall: '' | 'rect' | 'follow'; heightsCastle: '' | 'none' | 'force';
  oldEnclosureCitadel: boolean; medievalWalls: boolean; riverControl: boolean; dryDitches: boolean; gateVillages: boolean;
  /** 0: inherited ribbons; 1: organic gate markets and branching lanes. */
  gateVillage: number;
  maxStreetGrade: number; maxLaneGrade: number; maxStairGrade: number; allowStairs: boolean;
  powerHighGround: boolean; mergeParallelStreets: boolean; regularGridOutline: boolean;
  shelteredHarbour: boolean;
  portDetachment: number;
  portShelter: number;
  /** Site archetype from settlement placement (`harbor`, `bridge`, `hilltop`…); absent = unknown. */
  siteArchetype?: string;
  siteArchetypes?: Record<string, string>;
  footprint: FootprintConfig; tissue: 'culture' | 'grid' | 'organic' | 'radial' | 'terraces' | 'dendritic' | 'clusters'; accessMode: 'adaptive' | 'cultural' | 'none'; accessDepth: number; accessBudget: number;
}
/** Native plan grammars (Rust `urban::kinds::Kind`), distinct from demographic classes. */
export type SettlementKind = 'single' | 'ruin' | 'farmstead' | 'camp' | 'hamlet' | 'street-village' | 'nucleated-village' | 'market-town' | 'walled-town' | 'city' | 'metropolis';
export const defaultFootprintConfig = (): FootprintConfig => ({ mechanism: 'auto', family: 'auto', budget: 'population', grossDensity: 0, aspect: 1.4, orientation: 0, nuclei: 3, irregularity: 0.2, anisotropy: 0.65, separation: 1.3, epochs: 3, cohesion: 0.85, satellites: 0.15, branchDepth: 0.2, gapSize: 60 });
export const defaultLayoutConfig = (): LayoutConfig => ({ programme: defaultProgrammeContext(), axisAlignment: 'regional', mixCulture: '', mixMode: 'phases', mixShare: 0.5, mixAngle: 0, exitTreatment: 'adaptive', peripheralRoad: 'auto', siteAdaptation: 1, composition: 'settlement', settlementForm: 'auto', suburbs: 'auto', phases: 0, preset: 'culture', culture: 'site', recipe: 'auto', zone: 'auto', density: 1, count: 4, rings: 1, radius: 0, radiusScale: 1, placement: 'center', params: {}, monument: 'none', fortification: 'culture', fortificationStyle: 'auto', wallStiffness: null, wallTerrain: null, wallRelief: null, wallTowerSpacing: null, ditchWetness: null, riverControlMode: '', portEnclosure: '', plannedWall: '', heightsCastle: '', oldEnclosureCitadel: false, medievalWalls: false, riverControl: false, dryDitches: false, gateVillages: false, gateVillage: 0, maxStreetGrade: 0.12, maxLaneGrade: 0.18, maxStairGrade: 0.65, allowStairs: true, shelteredHarbour: false, portDetachment: 1, portShelter: 0, powerHighGround: false, mergeParallelStreets: false, regularGridOutline: false, footprint: defaultFootprintConfig(), tissue: 'culture', accessMode: 'adaptive', accessDepth: 0, accessBudget: 4 });
export const defaultParcelConfig = (): ParcelConfig => ({ preset: 'culture', culture: 'site', recipe: 'auto', zone: 'auto', density: 1, params: {}, operator: 'culture' });

/** Keep the Rust contract strict while discarding fields leaked by older UI versions. */
function contractFields<T extends object>(defaults: T, saved?: Partial<T>): T {
  const result = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof T)[]) if (saved?.[key] !== undefined) result[key] = saved[key]!;
  return result;
}

/** Complete nested inputs without replacing the behaviour of saved pre-refactor links. */
export function normalizeLayoutConfig(saved?: Partial<Omit<LayoutConfig, 'footprint'>> & { footprint?: Partial<FootprintConfig> }, legacy = false): LayoutConfig {
  const defaults = defaultLayoutConfig();
  const config = contractFields(defaults, saved as Partial<LayoutConfig>);
  config.gateVillage = typeof saved?.gateVillage === 'number' && Number.isFinite(saved.gateVillage)
    ? Math.max(0, Math.min(1, saved.gateVillage)) : saved?.gateVillages === true ? 1 : 0;
  if (saved?.portShelter === undefined && saved?.shelteredHarbour) config.portShelter = 1;
  if (saved?.medievalWalls) {
    config.wallStiffness ??= 1; config.wallTerrain ??= 1; config.wallTowerSpacing ??= 30;
  }
  if (saved?.riverControl && !config.riverControlMode) config.riverControlMode = 'bank-walls-chain';
  // dryDitches keeps the old local-supply draw until wetness is explicitly chosen.
  config.programme = contractFields(defaultProgrammeContext(), saved?.programme);
  // Optional fields reach Rust only when set, so older links keep their payload.
  // Preserve explicit null/0 and imported values for native validation; only
  // absent/undefined fields remain omitted. Never coerce optional inputs.
  if (saved?.programme?.state !== undefined) config.programme.state = saved.programme.state;
  if (saved?.programme?.decay !== undefined) config.programme.decay = saved.programme.decay;
  if (saved?.programme?.functions !== undefined) config.programme.functions = saved.programme.functions === null ? null : normalizeProgrammeFunctions(saved.programme.functions);
  if (saved?.siteArchetype) config.siteArchetype = saved.siteArchetype;
  if (saved?.siteArchetypes) config.siteArchetypes = { ...saved.siteArchetypes };
  config.footprint = contractFields(defaults.footprint, saved?.footprint);
  // Missing controls in an existing scene retain the former geometry.
  if (saved) {
    config.footprint.cohesion = saved.footprint?.cohesion ?? 1;
    config.footprint.satellites = saved.footprint?.satellites ?? 0;
    config.footprint.branchDepth = saved.footprint?.branchDepth ?? 0;
  }
  // Old planned links follow the selected form without imposing a geometric outline on organic towns.
  if (config.footprint.mechanism === 'planned') config.footprint.mechanism = 'auto';
  config.params = { ...saved?.params };
  if (legacy && saved && !saved.footprint) {
    config.footprint = { ...defaults.footprint, mechanism: 'legacy', budget: 'radius' };
    config.accessMode = 'cultural';
  }
  if (legacy && saved && config.footprint.mechanism === 'legacy' && saved.axisAlignment === undefined) config.axisAlignment = 'culture';
  if (legacy && saved && config.footprint.mechanism === 'legacy' && saved.exitTreatment === undefined) config.exitTreatment = 'legacy';
  if (legacy && saved && config.footprint.mechanism === 'legacy' && saved.siteAdaptation === undefined) config.siteAdaptation = 0;
  if (legacy && saved && !saved.composition) config.composition = 'district';
  // Edits are not part of the defaults: carried through only when present.
  if (saved?.overrides) config.overrides = saved.overrides;
  if (saved?.phaseOverrides && Object.keys(saved.phaseOverrides).length) config.phaseOverrides = saved.phaseOverrides;
  return config;
}

export function normalizeParcelConfig(saved?: Partial<ParcelConfig>): ParcelConfig {
  const config: ParcelConfig = { ...contractFields(defaultParcelConfig(), saved), params: { ...saved?.params } };
  if (saved?.streetAlignedHomes === true) config.streetAlignedHomes = true;
  if (saved?.denserSmallholdings === true) config.denserSmallholdings = true;
  if (saved?.overrides) config.overrides = saved.overrides;
  if (saved?.zoneOperators && Object.keys(saved.zoneOperators).length) config.zoneOperators = saved.zoneOperators;
  return config;
}
