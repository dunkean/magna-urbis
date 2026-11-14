/** Three-state road control of the top bar: roads as plan (the style's own vector look), not shown, or rendered (the
 * painted road surface of the satellite family, roadStyle.ts `look: 'rendered'`). The value lives in the composition
 * recipe (`networks.roads.visible` and `networks.roads.surface`), so it is saved with the project and City Bench and
 * the sheets follow it. A vector style has no painted surface: there `rendered` is disabled and draws the plan look. */
import type { V2Settings } from './contracts';
import { currentComposition, writeAppearanceControl } from './renderControls';
import { ROAD_DISPLAYS, roadDisplayOf, roadRenderAvailable, type RoadDisplay } from '../render/composition';
import { bindTree, registerMessages, setText, translate, onLanguageChange } from './i18n';

registerMessages({
  'Roads': { en: 'Roads', fr: 'Routes' },
  // Own keys: a bare 'Plan' is already the French source of 'Layout'.
  'Roads as plan': { en: 'Plan', fr: 'Plan' },
  'No roads': { en: 'None', fr: 'Aucune' },
  'Rendered roads': { en: 'Rendered', fr: 'Rendu' },
  'Roads: plan, hidden or rendered surface': { en: 'Roads: plan, hidden or rendered surface', fr: 'Routes : plan, masquées ou surface rendue' },
  'The rendered surface needs a satellite ground; this style draws its plan roads.': {
    en: 'The rendered surface needs a satellite ground; this style draws its plan roads.',
    fr: 'La surface rendue demande un fond satellite ; ce style dessine ses routes en plan.' },
});

const LABELS: Readonly<Record<RoadDisplay, string>> = { plan: 'Roads as plan', none: 'No roads', rendered: 'Rendered roads' };

/** Writes one state into the recipe. */
export function writeRoadDisplay(settings: V2Settings, value: RoadDisplay): void {
  writeAppearanceControl(settings, 'appearance.composition.networks.roads.visible', value !== 'none');
  if (value !== 'none') writeAppearanceControl(settings, 'appearance.composition.networks.roads.surface', value);
}

/** Mounts the control right after `anchor` (the urban plan field of the top bar), or inside `fallback`. */
export function mountRoadDisplayControl(anchor: Element | null, fallback: HTMLElement, api: { getSettings(): V2Settings; onChange(): void }): { sync(): void } {
  const field = document.createElement('div');
  field.className = 'parameter-field road-display-field';
  field.dataset.control = 'widget:road-display';
  const caption = document.createElement('label'); caption.className = 'parameter-caption'; caption.htmlFor = 'road-display'; setText(caption, 'Roads');
  const select = document.createElement('select'); select.id = 'road-display'; select.dataset.l10nKeep = '';
  for (const value of ROAD_DISPLAYS) { const option = document.createElement('option'); option.value = value; select.append(option); }
  field.append(caption, select);
  if (anchor) anchor.after(field); else fallback.append(field);
  select.onchange = () => { writeRoadDisplay(api.getSettings(), select.value as RoadDisplay); sync(); api.onChange(); };
  function sync(): void {
    const composition = currentComposition(api.getSettings()), available = roadRenderAvailable(composition);
    for (const option of Array.from(select.options)) {
      option.textContent = translate(LABELS[option.value as RoadDisplay]);
      option.disabled = option.value === 'rendered' && !available;
    }
    const value = roadDisplayOf(composition);
    select.value = value === 'rendered' && !available ? 'plan' : value;
    select.title = translate(available ? 'Roads: plan, hidden or rendered surface' : 'The rendered surface needs a satellite ground; this style draws its plan roads.');
  }
  bindTree(field); onLanguageChange(sync); sync();
  return { sync };
}
