/** Copy for cityEmbed's standalone preview. Register with the page's i18n service so English source text also works in French. */
import { numberLocale, translate } from './i18n';
import type { V2Settings } from './contracts';

const rows = [
  ['Magna Urbis · City preview', 'Magna Urbis · Aperçu de ville'],
  ['City map: drag to pan, scroll to zoom', 'Carte de la ville : glisser pour déplacer, molette pour zoomer'],
  ['Generating city…', 'Génération de la ville…'],
  ['Randomize culture, population, geography and buildings', 'Changer la culture, la population, la géographie et les bâtiments'],
  ['🎲 Randomize city', '🎲 Tout changer'],
  ['Navigation', 'Navigation'],
  ['Zoom in', 'Zoom avant'],
  ['Zoom in (+)', 'Zoom avant (+)'],
  ['Zoom out', 'Zoom arrière'],
  ['Zoom out (−)', 'Zoom arrière (−)'],
  ['Recenter city', 'Recentrer la ville'],
  ['Recenter city (0)', 'Recentrer la ville (0)'],
  ['The city generator stopped.', 'Le générateur de ville s’est arrêté.'],
  ['City payload is too large.', 'Les données de la ville sont trop volumineuses.'],
  ['Expected an fmg-burg-v1 city payload.', 'Les données de la ville doivent être au format fmg-burg-v1.'],
  ['No city data supplied.', 'Aucune donnée de ville fournie.'],
  ['Invalid city payload.', 'Données de ville invalides.'],
  ['people', 'hab.'],
  ['Coast', 'Côte'],
  ['Inland', 'Intérieur'],
  ['River', 'Rivière'],
  ['Walls', 'Remparts'],
] as const;
export const cityEmbedMessages = Object.fromEntries(rows.map(([en, fr]) => [en, { en, fr }]));

/** Labels are translated independently; imported culture names and compass directions remain user data. */
export function cityEmbedSummary(options: V2Settings['options'], cultureBase: string | null): string {
  return [
    cultureBase ?? options.culture.replaceAll('-', ' '),
    `${options.population.toLocaleString(numberLocale())} ${translate('people')}`,
    options.coast !== 'none' ? `${translate('Coast')} ${options.coast}` : translate('Inland'),
    options.river !== 'none' ? translate('River') : '',
    options.walls !== 'none' ? translate('Walls') : '',
  ].filter(Boolean).join(' · ');
}
