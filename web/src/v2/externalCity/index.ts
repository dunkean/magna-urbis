import { parseAzgaarBurg } from './azgaar';
import type { ExternalCityHints } from './types';
import { parseWatabouUrl } from './watabou';

export type { ExternalCityHints } from './types';
export { applyExternalCity } from './apply';

/** Hints from a watabou city / village link or an Azgaar FMG burg (CSV row with header, or burg JSON); null otherwise. */
export function parseExternalCity(text: string): ExternalCityHints | null {
  return parseWatabouUrl(text) ?? parseAzgaarBurg(text);
}
