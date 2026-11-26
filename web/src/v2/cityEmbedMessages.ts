/** Copy for cityEmbed's standalone preview. Keep the iframe's copy independent of the studio catalogue. */
import type { ExternalCityHints } from './externalCity/types';

// Ship just the selected FMG locale. Shared editor terminology comes from Azgaar's
// MIT-licensed dictionaries (public/licenses/azgaar-embed-locales.txt).
const locales = import.meta.glob<Record<string, string>>('./embedLocales/*.json', { import: 'default' });
const supported = ['en', 'fr', ...Object.keys(locales).map(path => path.split('/').pop()!.replace('.json', ''))];
const loaded = new Map<string, Record<string, string>>();

export function embedLocale(...preferences: string[]): string {
  for (const preference of preferences) {
    const tag = preference.toLowerCase().replaceAll('_', '-');
    const match = supported.find(code => code.toLowerCase() === tag);
    if (match) return match;
    if (/^zh-(hant|hk|mo|tw)\b/.test(tag)) return 'zh-TW';
    const base = tag.split('-')[0];
    if (supported.includes(base)) return base;
  }
  return 'en';
}

export async function loadEmbedLocale(language: string) {
  const load = locales['./embedLocales/' + language + '.json'];
  if (load && !loaded.has(language)) loaded.set(language, await load());
}

const rows = [
  ['Magna Urbis · City preview', 'Magna Urbis · Aperçu de ville'],
  ['Improve map', 'Améliorer la vue'],
  ['Detailed map style', 'Style de la carte détaillée'],
  ['Satellite · Fast', 'Satellite · Rapide'],
  ['Painted satellite', 'Satellite peint'],
  ['detailing…', 'en cours…'],
  ['retry detail', 'réessayer'],
  ['Generate a detailed map', 'Générer une carte détaillée'],
  ['Generating the detailed map', 'Génération de la carte détaillée'],
  ['Detailed map unavailable. Try again.', 'Carte détaillée indisponible. Réessayer.'],
  ['Detailed map shown', 'Carte détaillée affichée'],
  ['City map: drag to pan, scroll to zoom', 'Carte de la ville : glisser pour déplacer, molette pour zoomer'],
  ['Preparing terrain…', 'Préparation du terrain…'],
  ['Laying out roads…', 'Tracé des routes…'],
  ['Laying out city blocks…', 'Tracé des îlots…'],
  ['Dividing plots…', 'Découpage des parcelles…'],
  ['Placing buildings…', 'Placement des bâtiments…'],
  ['Drawing the map…', 'Dessin de la carte…'],
  ['Rendering fast satellite…', 'Rendu satellite rapide…'],
  ['Rendering painted satellite…', 'Rendu satellite peint…'],
  ['Architectural houses', 'Maisons détaillées'],
  ['Generate architectural houses', 'Générer les maisons détaillées'],
  ['Map views', 'Niveaux de vue'],
  ['City plan', 'Plan de ville'],
  ['Saving…', 'Enregistrement…'],
  ['Generating architectural houses…', 'Construction des maisons détaillées…'],
  ['Save view', 'Mémoriser la vue'],
  ['View saved', 'Vue mémorisée'],
  ['Storage unavailable', 'Stockage indisponible'],
  ['Enlarge', 'Agrandir'],
  ['Actual size', 'Taille Azgaar'],
  ['City blocks', 'Plan des îlots'],
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

export function cityEmbedText(text: string, language: string): string {
  return (language === 'fr' ? french.get(text) : loaded.get(language)?.[text]) ?? text;
}

export function localizeCityEmbed(root: HTMLElement, language: string): void {
  if (language === 'en') return;
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('[data-embed-text], [aria-label], [title]'))) {
    if (element.hasAttribute('data-embed-text')) element.textContent = cityEmbedText(element.textContent!.trim(), language);
    for (const attribute of ['aria-label', 'title']) {
      const value = element.getAttribute(attribute);
      if (value) element.setAttribute(attribute, cityEmbedText(value, language));
    }
  }
}

/** Labels are translated independently; imported culture names and compass directions remain user data. */
export function cityEmbedSummary(hints: ExternalCityHints, cultureBase: string | null, language = 'en'): string {
  const translate = (text: string) => cityEmbedText(text, language);
  const population = (hints.population ?? 2500).toLocaleString(language);
  const populationText = loaded.get(language)?.['{{- population}} people'];
  return [
    cultureBase ?? hints.culture?.replaceAll('-', ' '),
    populationText ? populationText.replace('{{- population}}', population) : `${population} ${translate('people')}`,
    (hints.coast ?? 'none') !== 'none' ? `${translate('Coast')} ${hints.coast}` : translate('Inland'),
    hints.river && hints.river !== 'none' ? translate('River') : '',
    hints.walls ? translate('Walls') : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
