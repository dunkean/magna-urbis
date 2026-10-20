/** Pure configuration boundary; the legacy web editor must not load Rust/WASM. */
export interface ParcelConfig { preset: string; culture?: string; recipe: string; zone: string; density: number; params: Record<string, unknown>; operator: 'culture' | 'strips' | 'oriented' | 'frontage' | 'compound' | 'wholeBlock' | 'garden' }
export interface FootprintConfig {
  mechanism: 'auto' | 'legacy' | 'planned' | 'accessibility' | 'ribbon' | 'fusion';
  family: 'auto' | 'circle' | 'rectangle' | 'polygon' | 'compact' | 'elongated' | 'linear' | 'fan' | 'fingers' | 'dendritic' | 'lobed' | 'archipelago' | 'composite';
  budget: 'population' | 'radius'; grossDensity: number; aspect: number; orientation: number; nuclei: number; irregularity: number; anisotropy: number; separation: number; epochs: number;
  cohesion: number; satellites: number; branchDepth: number; gapSize: number;
}
export interface LayoutConfig extends Omit<ParcelConfig, 'operator'> {
  axisAlignment: 'regional' | 'culture'; mixCulture: string; mixMode: 'phases' | 'sectors'; mixShare: number; mixAngle: number; exitTreatment: 'legacy' | 'adaptive' | 'closed'; peripheralRoad: 'auto' | 'none' | 'partial' | 'full'; siteAdaptation: number;
  composition: 'settlement' | 'district'; settlementForm: 'auto' | 'nucleated' | 'ribbon'; suburbs: 'auto' | 'none' | 'few' | 'many'; phases: number;
  count: number; rings: number; radius: number; radiusScale: number; placement: 'center' | 'rectangle' | 'skew' | 'notched'; monument: string;
  fortification: 'culture' | 'none' | 'wall' | 'palisade'; maxStreetGrade: number; maxLaneGrade: number; maxStairGrade: number; allowStairs: boolean;
  footprint: FootprintConfig; tissue: 'culture' | 'grid' | 'organic' | 'radial' | 'terraces' | 'dendritic' | 'clusters'; accessMode: 'adaptive' | 'cultural' | 'none'; accessDepth: number; accessBudget: number;
}
export const defaultFootprintConfig = (): FootprintConfig => ({ mechanism: 'auto', family: 'auto', budget: 'population', grossDensity: 0, aspect: 1.4, orientation: 0, nuclei: 3, irregularity: 0.2, anisotropy: 0.65, separation: 1.3, epochs: 3, cohesion: 0.85, satellites: 0.15, branchDepth: 0.2, gapSize: 60 });
export const defaultLayoutConfig = (): LayoutConfig => ({ axisAlignment: 'regional', mixCulture: '', mixMode: 'phases', mixShare: 0.5, mixAngle: 0, exitTreatment: 'adaptive', peripheralRoad: 'auto', siteAdaptation: 1, composition: 'settlement', settlementForm: 'auto', suburbs: 'auto', phases: 0, preset: 'culture', culture: 'site', recipe: 'auto', zone: 'auto', density: 1, count: 4, rings: 1, radius: 0, radiusScale: 1, placement: 'center', params: {}, monument: 'none', fortification: 'culture', maxStreetGrade: 0.12, maxLaneGrade: 0.18, maxStairGrade: 0.65, allowStairs: true, footprint: defaultFootprintConfig(), tissue: 'culture', accessMode: 'adaptive', accessDepth: 0, accessBudget: 4 });
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
  return config;
}

export function normalizeParcelConfig(saved?: Partial<ParcelConfig>): ParcelConfig {
  return { ...contractFields(defaultParcelConfig(), saved), params: { ...saved?.params } };
}
