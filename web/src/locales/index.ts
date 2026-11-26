/** Community locales stored as plain JSON so translators can edit them without touching TypeScript.
 * Each file holds three sections keyed by the English (or id) source:
 *  - `ui`: interface strings (same keys as the `localeMessages` catalogues);
 *  - `roles`: city role tables (`bld` building roles by English name, then districts, families, specialities,
 *    streets, functions, texts and state suffixes by id);
 *  - `names`: toponym generics (`terms`, `worship`, `tower`) and name meanings (`rows`, `roleRows`).
 * Missing keys fall back to English. Render and naming code may import this module (it has no V2 dependency). */
import de from './de.json';
import it from './it.json';
import pl from './pl.json';
import ko from './ko.json';

export type CommunityLocale = 'de' | 'it' | 'pl' | 'ko';
export interface CommunityCatalogue {
  ui: Record<string, string>;
  roles: Record<string, Record<string, string>>;
  names: Record<string, Record<string, string>>;
}
export const COMMUNITY_LOCALES: readonly CommunityLocale[] = ['de', 'it', 'pl', 'ko'];
export const communityCatalogues: Record<CommunityLocale, CommunityCatalogue> = { de, it, pl, ko };
export const isCommunityLocale = (code: string): code is CommunityLocale => (COMMUNITY_LOCALES as readonly string[]).includes(code);
/** Translation of `key` in `section/table`, or undefined when the locale or the entry is missing. */
export function communityText(locale: string, section: 'roles' | 'names', table: string, key: string): string | undefined {
  return isCommunityLocale(locale) ? communityCatalogues[locale][section][table]?.[key] : undefined;
}
