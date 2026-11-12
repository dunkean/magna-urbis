import type { NameEntry, NameSource, NamingPolicy, NamingSettings } from './types';

export function namingPolicy(naming: NamingSettings | undefined, city?: string, feature?: string, quarter?: string): NamingPolicy {
  return { profile:naming?.profile, source:naming?.source, ...(city ? naming?.local?.[city] : naming?.region),
    ...(quarter ? naming?.features?.[quarter] : {}), ...(feature ? naming?.features?.[feature] : {}) };
}
export function namePolicyKey(naming: NamingSettings | undefined, entry: NameEntry, city?: string,source:NameSource='auto'): string {
  const natural = ['river','lake','sea','hill','forest','farm'].includes(entry.kind) && !entry.id.startsWith('settlement:');
  const scope = natural ? 'region' : `city:${city ?? 'main'}`;
  return JSON.stringify([entry.parts?.profile,source, namingPolicy(naming,natural ? undefined : city ?? 'main',entry.id),
    naming?.variations?.all ?? 0, naming?.variations?.[scope] ?? 0, naming?.variations?.[`feature:${entry.id}`] ?? 0,naming?.variations?.[`feature:${entry.parentKey}`] ?? 0]);
}
/** Regeneration is scoped and explicit; the name bank keeps all unrelated names. */
export function varyNames(naming: NamingSettings, scope: string): void {
  naming.variations ??= {};
  naming.variations[scope] = (naming.variations[scope] ?? 0) + 1;
}
