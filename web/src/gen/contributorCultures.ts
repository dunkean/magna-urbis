import manifest from '../../../contributions/urban-cultures.json';

export const contributorCultures: readonly { id: string; label: string; base: string; recipes?: Readonly<Record<string, string>> }[] = manifest;

const bases = new Map(contributorCultures.map(entry => [entry.id, entry.base]));
export const contributorCultureBase = (id: string): string => bases.get(id) ?? id;
export const contributorCultureLabels: ReadonlyMap<string, string> = new Map(contributorCultures.map(entry => [entry.id, entry.label]));
