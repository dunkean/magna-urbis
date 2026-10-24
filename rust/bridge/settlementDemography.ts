/** One shared source for demographic classes. These are neither native plan
 * grammars nor the historical size/cultural recipe bands. Shortcuts only fill population. */
import catalogue from '../crates/core/src/settlements/demographic_classes.json';
export type DemographicClass = keyof typeof catalogue.classes;
export const DEMOGRAPHIC_CLASSES = (Object.keys(catalogue.classes) as DemographicClass[])
  .map(id => ({ id, ...catalogue.classes[id] })).sort((a, b) => a.minimum - b.minimum);
export const DEMOGRAPHIC_CLASS_FLOORS: [DemographicClass, number][] = [...DEMOGRAPHIC_CLASSES]
  .reverse().map(c => [c.id, c.minimum]);
/** Preserve the old classification semantics, including farmstead fallback. */
export function demographicClass(population: number): DemographicClass {
  return DEMOGRAPHIC_CLASS_FLOORS.find(([, minimum]) => population >= minimum)?.[0] ?? 'farmstead';
}
export function demographicLabel(population: number): string { return catalogue.classes[demographicClass(population)].labelFr; }
