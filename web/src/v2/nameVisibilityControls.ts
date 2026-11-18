import type { V2Settings } from './contracts';
import { currentComposition, writeAppearanceControl } from './renderControls';
import { NAME_LEVELS, TEXT_AMOUNTS, nameLevelValue, type NameLevel, type TextGroup } from '../render/textLayer';
import { registerMessages, setText, translate, onLanguageChange } from './i18n';

const titles: Record<NameLevel, [string, string]> = {
  places: ['Cities and localities', 'Villes et lieux-dits'],
  rivers: ['River names', 'Fleuves et rivières'],
  water: ['Seas and lakes', 'Mers et lacs'],
  nature: ['Forests and mountains', 'Forêts et montagnes'],
  streets: ['Street names', 'Noms des rues'],
  landmarks: ['Main buildings and monuments', 'Bâtiments principaux et monuments'],
  districts: ['District names', 'Noms des quartiers'],
  buildings: ['House names', 'Noms des maisons'],
  pins: ['Personal pins', 'Repères personnels'],
};
const copies = {
  'Names shown on the map': 'Noms affichés sur la carte',
  'Label detail': 'Détail des noms',
  Essential: 'Essentiel',
  Normal: 'Normale',
  Detailed: 'Détaillé',
  All: 'Tous',
  'Choose individual names…': 'Choisir les noms individuellement…',
  'House names appear when selected. Enable a category or choose individual names to show more.': 'Les noms de maisons apparaissent à la sélection. Activez une catégorie ou choisissez les noms individuellement pour en voir davantage.',
};
registerMessages(Object.fromEntries([...Object.entries(copies), ...Object.values(titles)].map(([en, fr]) => [en, { en, fr }])));

/** Prominent display controls; the recipe remains the shared 2D/3D/export source. */
export function mountNameVisibilityControls(panel: HTMLElement, api: { getSettings(): V2Settings; onChange(): void }) {
  const card = document.createElement('section');
  card.className = 'name-visibility-controls';
  card.id = 'name-visibility-controls';
  const title = document.createElement('h3');
  setText(title, 'Names shown on the map');
  card.append(title);
  const row = document.createElement('label'),
    caption = document.createElement('span'),
    detail = document.createElement('input'),
    value = document.createElement('output');
  setText(caption, 'Label detail');
  detail.type = 'range';
  detail.min = '0';
  detail.max = '3';
  detail.step = '1';
  detail.id = 'name-detail';
  detail.setAttribute('aria-label', translate('Label detail'));
  row.className = 'name-detail-control';
  row.append(caption, detail, value);
  card.append(row);
  const choices = document.createElement('div');
  choices.className = 'name-category-choices';
  card.append(choices);
  const remembered: Partial<Record<NameLevel, number>> = {},
    inputs = new Map<NameLevel, HTMLInputElement>();
  const groups: Record<NameLevel, TextGroup[]> = { places: ['places', 'countryside'], rivers: ['water'], water: ['water'], nature: ['nature'], districts: ['city'], streets: ['city', 'countryside'], landmarks: ['landmarks'], buildings: ['landmarks'], pins: ['pins'] };
  for (const key of NAME_LEVELS) {
    const label = document.createElement('label'),
      input = document.createElement('input'),
      text = document.createElement('span');
    input.type = 'checkbox';
    input.dataset.nameCategory = key;
    setText(text, titles[key][0]);
    label.append(input, text);
    choices.append(label);
    inputs.set(key, input);
    input.onchange = () => {
      const settings = api.getSettings(),
        current = nameLevelValue(currentComposition(settings).text, key);
      if (current > 0) remembered[key] = current;
      writeAppearanceControl(settings, `appearance.composition.text.levels.${key}`, input.checked ? (remembered[key] ?? 60) : 0);
      if (input.checked) for (const group of groups[key]) writeAppearanceControl(settings, `appearance.composition.text.groups.${group}`, true);
      api.onChange();
      sync();
    };
  }
  const hint = document.createElement('p');
  hint.className = 'hint';
  setText(hint, 'House names appear when selected. Enable a category or choose individual names to show more.');
  card.append(hint);
  const individual = document.createElement('button');
  individual.type = 'button';
  individual.className = 'quiet small';
  setText(individual, 'Choose individual names…');
  individual.onclick = () => {
    panel.hidePopover();
    document.querySelector<HTMLButtonElement>('#labels-open')?.click();
  };
  card.append(individual);
  panel.querySelector(':scope > header')!.after(card);
  detail.oninput = () => {
    writeAppearanceControl(api.getSettings(), 'appearance.composition.text.amount', TEXT_AMOUNTS[Number(detail.value)]);
    api.onChange();
    sync();
  };
  function sync(): void {
    const text = currentComposition(api.getSettings()).text,
      index = TEXT_AMOUNTS.indexOf(text.amount ?? 'normal');
    detail.value = String(index);
    setText(value, ['Essential', 'Normal', 'Detailed', 'All'][index]);
    for (const [key, input] of inputs) input.checked = nameLevelValue(text, key) > 0 && groups[key].some(group => text.groups[group]);
  }
  onLanguageChange(sync);
  sync();
  return { sync };
}
