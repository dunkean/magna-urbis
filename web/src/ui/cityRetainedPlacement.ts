/** CityBench edits update a REAL retained site, never fabricate terrain scores,
 * a radius, or an implicit centre. Search belongs only to its explicit action. */
import type { SettlementOutput, SettlementSpec } from '../../../rust/bridge/settlements';
import { demographicClass } from '../../../rust/bridge/settlementDemography';
export function retainCityPlacement(current: SettlementOutput | undefined, specs: readonly SettlementSpec[]) {
  const retained = current?.settlements ?? [];
  const missing = specs.filter(s => !retained.some(p => p.key === s.key)).map(s => s.key);
  if (!current || !specs.length || missing.length) return { output: undefined, changed: false, missing };
  let changed = specs.length !== retained.length;
  const settlements = specs.map(spec => {
    const actual = retained.find(s => s.key === spec.key)!;
    const center = spec.position ?? actual.center;
    const before = [actual.name, actual.population, actual.culture, actual.kind, actual.siteType, actual.sitePrefs, actual.center, actual.position];
    const after = [spec.name, spec.population, spec.culture, spec.kind, spec.siteType, spec.sitePrefs, center, spec.position];
    if (JSON.stringify(before) !== JSON.stringify(after)) changed = true;
    return { ...actual, ...spec, center: { ...center }, cls: demographicClass(spec.population) };
  });
  // Radius, score/ranking population and archetype stay retained evidence; they
  // have not been recomputed for changed metadata or coordinates.
  return { output: changed ? { ...current, settlements, requested: specs.length } : current, changed, missing };
}
