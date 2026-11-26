/** Copy for cityEmbed's standalone preview. Keep the iframe's copy independent of the studio catalogue. */
import { LANGUAGES, type Language } from './languages';
import type { ExternalCityHints } from './externalCity/types';

const rows = [
  ['Magna Urbis · City preview', 'Magna Urbis · Aperçu de ville'],
  ['Improve map', 'Améliorer la vue'],
  ['Detailed view', 'Vue détaillée'],
  ['detailing…', 'en cours…'],
  ['retry detail', 'réessayer'],
  ['Generate a detailed map', 'Générer une carte détaillée'],
  ['Generating the detailed map', 'Génération de la carte détaillée'],
  ['Detailed map unavailable. Try again.', 'Carte détaillée indisponible. Réessayer.'],
  ['Detailed map shown', 'Carte détaillée affichée'],
  ['City map: drag to pan, scroll to zoom', 'Carte de la ville : glisser pour déplacer, molette pour zoomer'],
  ['Generating city…', 'Génération de la ville…'],
  ['City preview', 'Aperçu de la ville'],
  ['Open in Magna Urbis ↗', 'Ouvrir dans Magna Urbis ↗'],
  ['The city map could not be drawn.', 'Impossible de dessiner la carte de la ville.'],
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
  ['Population', 'Population'],
  ['Apply', 'Appliquer'],
  ['people', 'hab.'],
  ['Coast', 'Côte'],
  ['Inland', 'Intérieur'],
  ['River', 'Rivière'],
  ['Walls', 'Remparts'],
] as const;
const french = new Map<string, string>(rows);

export function cityEmbedText(text: string, language: Language): string {
  return language === 'fr' ? french.get(text) ?? text : text;
}

export function localizeCityEmbed(root: HTMLElement, language: Language): void {
  if (language !== 'fr') return;
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('[data-embed-text], [aria-label], [title]'))) {
    if (element.hasAttribute('data-embed-text')) element.textContent = cityEmbedText(element.textContent!.trim(), language);
    for (const attribute of ['aria-label', 'title']) {
      const value = element.getAttribute(attribute);
      if (value) element.setAttribute(attribute, cityEmbedText(value, language));
    }
  }
}

/** Labels are translated independently; imported culture names and compass directions remain user data. */
export function cityEmbedSummary(hints: ExternalCityHints, cultureBase: string | null, language: Language = 'en'): string {
  const translate = (text: string) => cityEmbedText(text, language);
  const numberLocale = LANGUAGES.find(item => item.code === language)!.locale;
  return [
    cultureBase ?? hints.culture?.replaceAll('-', ' '),
    `${(hints.population ?? 2500).toLocaleString(numberLocale)} ${translate('people')}`,
    (hints.coast ?? 'none') !== 'none' ? `${translate('Coast')} ${hints.coast}` : translate('Inland'),
    hints.river && hints.river !== 'none' ? translate('River') : '',
    hints.walls ? translate('Walls') : '',
  ].filter(Boolean).join(' · ');
}
