import type { V2Settings } from './contracts';
import type { World } from '../gen/types';
import { cultureEra } from '../gen/options';
import { installCultureBrowser } from './cultureBrowser';
import { advancedPanel } from './advancedPanel';
import { mountRenderPassControls } from './renderPassControls';
import { mountSectionIndex } from './sectionIndex';
import { editorButtonIcon } from './editorIcons';
import { recommendedCulture } from './settlementDefaults';
import { mountSettlementPopulationPanel } from './settlementPopulationPanel';
import { cultureEnvironment, plausibleCultures, randomCulture } from './environmentCultures';
import { bindTree, registerMessages, setText, translate, onLanguageChange } from './i18n';
import { currentComposition, writeAppearanceControl } from './renderControls';
import './workbenchLayout.css';

registerMessages({
  'In addition to the main settlement': { en: 'In addition to the main settlement', fr: 'En plus du lieu principal' },
  'Select on map': { en: 'Select on map', fr: 'Sélection' },
  Editor: { en: 'Editor', fr: 'Éditeur' },
  'Global density': { en: 'Global density', fr: 'Densité globale' },
  'Follow the environment': { en: 'Follow the environment', fr: 'Suivre le milieu naturel' },
  'Random culture suited to this environment': { en: 'Random culture suited to this environment', fr: 'Culture aléatoire adaptée à ce milieu' },
  'Random pre-modern culture': { en: 'Random pre-modern culture', fr: 'Culture pré-moderne aléatoire' },
  'Medieval cultures': { en: 'Medieval cultures', fr: 'Cultures médiévales' },
  'Ancient cultures': { en: 'Ancient cultures', fr: 'Cultures antiques' },
  'Fantasy cultures': { en: 'Fantasy cultures', fr: 'Cultures fantastiques' },
  'Modern cultures': { en: 'Modern cultures', fr: 'Cultures modernes' },
  'Futuristic cultures': { en: 'Futuristic cultures', fr: 'Cultures futuristes' },
  'City rendering': { en: 'City rendering', fr: 'Rendu des villes' },
  Footprints: { en: 'Footprints', fr: 'Empreintes' },
  Simple: { en: 'Simple', fr: 'Simple' },
  Complex: { en: 'Complex', fr: 'Complexe' },
  'Black and white': { en: 'Black and white', fr: 'Noir et blanc' },
  Coloured: { en: 'Coloured', fr: 'Coloré' },
  Textured: { en: 'Textured', fr: 'Texturé' },
});

onLanguageChange(() => document.querySelectorAll<HTMLOptGroupElement>('optgroup[data-culture-group]').forEach(group => (group.label = translate(group.dataset.cultureGroup!))));

export function groupCultureSelector(select: HTMLSelectElement): void {
  const selected = select.value,
    groups = new Map<string, HTMLOptGroupElement>();
  for (const option of Array.from(select.options)) {
    const id = option.value;
    const era = cultureEra(id);
    const group =
      era === 'modern'
        ? 'Modern cultures'
        : era
          ? 'Futuristic cultures'
          : /elven|dwarven|goblin|giant|merfolk|lizard|underdark|orc|halfling|drow|gnome/.test(id)
            ? 'Fantasy cultures'
            : /roman|egyptian|nubian|mesopotamian|indus|levantine|greek/.test(id)
              ? 'Ancient cultures'
              : 'Medieval cultures';
    if (!groups.has(group)) {
      const node = document.createElement('optgroup');
      node.dataset.cultureGroup = group;
      node.label = translate(group);
      groups.set(group, node);
    }
    groups.get(group)!.append(option);
  }
  select.replaceChildren(...['Medieval cultures', 'Ancient cultures', 'Fantasy cultures', 'Modern cultures', 'Futuristic cultures'].flatMap(k => groups.get(k) ?? []));
  select.value = selected;
}

export function mountWorkbenchLayout(api: { getSettings(): V2Settings; getWorld(): World | undefined; changed(): void; appearance(): void; syncForms(): void }) {
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
  const settlements = $('#family-settlements'),
    cities = $('#family-cities'),
    editor = $('#family-map');
  const general = settlements.querySelector<HTMLElement>('.family-general')!;
  settlements.querySelectorAll<HTMLElement>('[data-field-path^="placement.counts."],[data-control="main:population"]').forEach(node => node.remove());
  const culture = $<HTMLSelectElement>('[data-option="culture"]');
  groupCultureSelector(culture);
  const allCultureOptions = Array.from(culture.options);
  let cultureChoices = '';
  const cultureHost = culture.closest<HTMLElement>('[data-control]')!;
  cultureHost.classList.add('culture-picker');
  const automatic = document.createElement('label');
  automatic.className = 'checkline';
  const auto = document.createElement('input');
  auto.type = 'checkbox';
  auto.id = 'culture-environment';
  const autoText = document.createElement('span');
  setText(autoText, 'Follow the environment');
  automatic.append(auto, autoText);
  const cultureActions = document.createElement('div');
  cultureActions.className = 'culture-actions';
  const dice = document.createElement('button');
  dice.type = 'button';
  dice.id = 'culture-random';
  const diceIcon = document.createElement('i');
  diceIcon.className = 'art art-dice';
  diceIcon.setAttribute('aria-hidden', 'true');
  dice.append(diceIcon);
  cultureActions.append(automatic, dice);
  cultureHost.append(cultureActions);
  general.prepend(cultureHost);
  const demographics = mountSettlementPopulationPanel(general, api);
  // Keep the roads stage's composite request control visible in the Settlements sidebar.
  const exitsPanel = settlements.querySelector<HTMLElement>('#row-settle-roads .regional-exits');
  if (exitsPanel) general.append(exitsPanel);
  const state = new WeakMap<V2Settings, { cultureEnvironment: string; autoCulture: boolean }>();
  // The existing option binding writes the chosen culture before this listener runs.
  culture.addEventListener('change', () => {
    const s = api.getSettings();
    s.region ??= {};
    s.region.demography ??= {};
    s.region.demography.followCulture = false;
    state.get(s)!.autoCulture = false;
    sync();
    api.changed();
  });
  const followEnvironment = (enabled: boolean) => {
    const s = api.getSettings();
    s.region ??= {};
    s.region.demography ??= {};
    s.region.demography.followCulture = enabled;
    state.get(s)!.autoCulture = enabled;
    sync(true);
    api.changed();
    api.syncForms();
  };
  auto.onchange = () => followEnvironment(auto.checked);
  installCultureBrowser(document.body, { source: culture, get: () => auto.checked, set: followEnvironment });
  function rollCulture(avoidCurrent = false): void {
    const s = api.getSettings(),
      previous = state.get(s)!;
    s.options.culture = randomCulture(s, previous.autoCulture, Math.random, avoidCurrent ? s.options.culture : undefined);
    sync();
    api.syncForms();
    api.changed();
  }
  dice.onclick = () => rollCulture(true);

  for (const family of [settlements, cities]) {
    const advanced = advancedPanel(family, 'Advanced');
    const primary = family.querySelector<HTMLElement>('.family-general')!;
    for (const row of Array.from(family.querySelectorAll<HTMLElement>('.stage-row'))) {
      const body = row.querySelector<HTMLElement>(':scope > .stage-body');
      if (!body) continue;
      // Only the main generation fields stay in the sidebar; all stage actions live in Advanced.
      for (const main of Array.from(body.querySelectorAll<HTMLElement>('.urban-primary'))) {
        if (main.children.length) {
          const group = document.createElement('section');
          group.className = 'generation-primary-group';
          const title = document.createElement('h4');
          title.textContent = row.querySelector('.stage-title')?.textContent ?? '';
          group.append(title, main);
          primary.append(group);
        }
      }
      for (const nested of Array.from(body.querySelectorAll<HTMLElement>('.workbench-advanced'))) {
        const parent = nested.parentElement!;
        parent.querySelector(':scope > .advanced-open')?.remove();
        parent.append(...Array.from(nested.querySelector('.advanced-grid')!.children));
        nested.remove();
      }
      body.hidden = false;
      advanced.grid.append(row);
      const toggle = row.querySelector<HTMLButtonElement>('.stage-title');
      if (toggle) {
        toggle.setAttribute('aria-expanded', 'true');
        toggle.onclick = () => {
          body.hidden = false;
        };
      }
    }
    family.querySelector('.chain-spine')?.remove();
    family.querySelector('.family-head')?.remove();
    // One page: stage cards flow down columns in chain order, all open; the header index jumps to a stage.
    advanced.grid.classList.add('stage-columns');
    const header = advanced.panel.querySelector<HTMLElement>(':scope > header')!;
    const index = mountSectionIndex(
      advanced.panel,
      () => Array.from(advanced.grid.querySelectorAll<HTMLElement>(':scope > .stage-row')).map(section => ({ section, heading: section.querySelector<HTMLElement>('.stage-name')! })),
      () => header.offsetHeight,
    );
    header.append(index.nav);
    advanced.panel.addEventListener('toggle', index.sync);
  }
  // Selection belongs to the list on the right, not to a second scope panel on the left.
  cities.querySelector('.family-city-scope')?.remove();
  cities.querySelector('.family-place')?.remove();
  // Editing tools and contextual inspectors share the left column.
  const moveTools = document.createElement('div');
  moveTools.className = 'settlement-position-tools';
  general.append(moveTools);
  for (const id of ['move-towns', 'town-positions-apply', 'town-positions-cancel']) moveTools.append($('#' + id));
  const countLegacy = $('#town-count').closest<HTMLElement>('[data-control]');
  countLegacy?.remove();
  const selection = $('.inspector-mode');
  for (const node of Array.from(selection.childNodes)) if (node.nodeType === Node.TEXT_NODE) node.textContent = '';
  const places = $('#places-panel');
  $('.map-area').append(places);
  places.querySelector('header')!.after(selection);
  editor.querySelector('.family-head')!.after($('#header-menu'), $('#editor-dock'));
  const namesIntro = document.createElement('p');
  namesIntro.className = 'hint editor-names-intro';
  registerMessages({ 'Browse all names to rename them or choose which ones appear on the map.': { en: 'Browse all names to rename them or choose which ones appear on the map.', fr: 'Parcourez tous les toponymes pour les renommer et choisir ceux à afficher sur la carte.' } });
  setText(namesIntro, 'Browse all names to rename them or choose which ones appear on the map.');
  $('#header-menu').after(namesIntro);
  editorButtonIcon($<HTMLButtonElement>('#edit-navigate'), 'display-2d');
  editorButtonIcon($<HTMLButtonElement>('#labels-open'), 'display-labels');
  editorButtonIcon($<HTMLButtonElement>('#edit-done'), 'display-2d', '✓');
  editorButtonIcon($<HTMLButtonElement>('#preview-close'), 'display-2d', '↶');
  const cityInspector = document.createElement('div');
  cityInspector.id = 'city-inspector';
  cities.prepend(cityInspector);
  cityInspector.append($('#inspector'));

  editor.querySelector('.family-run')?.remove();
  const mapAdvanced = advancedPanel($('.view-strip'), 'Advanced');
  mapAdvanced.button.id = 'map-advanced-open';
  const viewAdvanced = document.createElement('div');
  viewAdvanced.id = 'view3d-advanced-controls';
  mapAdvanced.grid.append(viewAdvanced);
  for (const row of Array.from(editor.querySelectorAll<HTMLElement>('.stage-row'))) {
    const quick = row.querySelector<HTMLElement>('.stage-quick');
    if (quick) {
      for (const field of Array.from(quick.querySelectorAll<HTMLElement>('.parameter-field'))) {
        const path = field.querySelector<HTMLElement>('[data-setting-path]')?.dataset.settingPath;
        if (!['appearance.composition.ground.contours', 'appearance.composition.networks.water.visible', 'appearance.composition.networks.roads.visible', 'appearance.composition.text.visible'].includes(path ?? '')) row.querySelector('.stage-body')!.prepend(field);
      }
      const views = quick.querySelector<HTMLElement>('.icon-segments');
      if (views) views.remove();
      if (quick.children.length) $('.view-strip').insertBefore(quick, mapAdvanced.button);
    }
    mapAdvanced.grid.append(row);
  }
  const plan = $<HTMLElement>('[data-setting-path="appearance.city.plan"]').closest<HTMLElement>('.parameter-field')!;
  const sharedPlan = document.createElement('div');
  sharedPlan.className = 'stage-quick';
  sharedPlan.append(plan);
  $('.view-strip').insertBefore(sharedPlan, mapAdvanced.button);
  const buildings = $<HTMLElement>('[data-setting-path="appearance.composition.buildings.visible"]').closest<HTMLElement>('.parameter-field')!,
    roofs = $<HTMLSelectElement>('#roof-display').closest<HTMLElement>('.parameter-field')!;
  const sharedBuildings = document.createElement('div');
  sharedBuildings.className = 'stage-quick';
  sharedBuildings.append(buildings, roofs);
  $('.view-strip').insertBefore(sharedBuildings, mapAdvanced.button);
  const texture = $<HTMLElement>('[data-setting-path="appearance.textured"]').closest<HTMLElement>('.parameter-field')!;
  mapAdvanced.grid.prepend(texture);
  const display = document.createElement('div');
  display.className = 'city-display-options';
  const specs = [
    ['Footprints', 'footprints'],
    ['Simple', 'simple-volumes'],
    ['Complex', 'detailed-volumes'],
    ['Black and white', 'ink'],
    ['Coloured', 'color'],
    ['Textured', 'texture'],
  ];
  specs.forEach(([label, value], i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.dataset.cityDisplay = value;
    const image = document.createElement('i');
    image.className = 'city-display-icon';
    image.style.backgroundPosition = `${i * 20}% center`;
    button.append(image);
    button.onclick = () => {
      const s = api.getSettings();
      if (i < 3) writeAppearanceControl(s, 'appearance.composition.buildings.look', value);
      else {
        writeAppearanceControl(s, 'appearance.textured', value === 'texture');
        writeAppearanceControl(s, 'appearance.city.palette', value === 'ink' ? 'ink' : 'atlas');
      }
      api.appearance();
      sync();
    };
    display.append(button);
  });
  const cityRendering = document.createElement('section');
  cityRendering.className = 'advanced-card city-rendering-settings';
  const cityRenderingTitle = document.createElement('h3');
  setText(cityRenderingTitle, 'City rendering');
  cityRendering.append(cityRenderingTitle, display);
  mapAdvanced.grid.prepend(cityRendering);
  const editorTab = $('#family-tab-map .chain-family-label');
  setText(editorTab, 'Editor');
  setText($('#family-map h3'), 'Editor');
  const strip = $('.view-strip'),
    toolbar = document.createElement('div');
  toolbar.className = 'toolbar-row';
  toolbar.append($('.style-control'), $('#scene-controls'));
  for (const child of Array.from(strip.children)) if (child !== mapAdvanced.panel) toolbar.append(child);
  // The optional 3D capture action stays available without widening the single settings row.
  const capture = toolbar.querySelector<HTMLElement>('#capture3d');
  if (capture) {
    const header = mapAdvanced.panel.querySelector(':scope > header')!;
    header.insertBefore(capture, header.lastElementChild);
  }
  strip.prepend(toolbar);
  const passes = mountRenderPassControls(mapAdvanced.panel, { getSettings: api.getSettings, onChange: api.appearance });
  bindTree(document.body);
  function sync(force = false): void {
    const s = api.getSettings();
    let previous = state.get(s);
    if (!previous) {
      previous = { cultureEnvironment: JSON.stringify(cultureEnvironment(s)), autoCulture: s.region?.demography?.followCulture ?? true };
      state.set(s, previous);
    }
    previous.autoCulture = s.region?.demography?.followCulture ?? previous.autoCulture;
    const cultureEnvironmentKey = JSON.stringify(cultureEnvironment(s));
    // A loaded code, recipe or project keeps its culture (a new settings object starts from its own environment).
    // "Follow the environment" re-picks only after an environment change (or ticking it) that rules the current culture out.
    if (previous.autoCulture && (cultureEnvironmentKey !== previous.cultureEnvironment || force) && !plausibleCultures(s).includes(s.options.culture)) {
      s.options.culture = recommendedCulture(s);
      api.syncForms();
    }
    previous.cultureEnvironment = cultureEnvironmentKey;
    const plausible = plausibleCultures(s);
    // A stored culture outside the environment's list stays selectable (and shown) until the environment changes.
    const allowed = previous.autoCulture ? allCultureOptions.map(option => option.value).filter(id => plausible.includes(id) || id === s.options.culture) : allCultureOptions.map(option => option.value);
    const choicesKey = allowed.join('|');
    if (choicesKey !== cultureChoices) {
      culture.replaceChildren(...allCultureOptions.filter(option => allowed.includes(option.value)));
      groupCultureSelector(culture);
      bindTree(culture);
      cultureChoices = choicesKey;
    }
    culture.value = s.options.culture;
    const diceLabel = previous.autoCulture ? 'Random culture suited to this environment' : 'Random pre-modern culture';
    for (const attr of ['title', 'aria-label']) {
      dice.setAttribute(`data-i18n-${attr}`, diceLabel);
      dice.setAttribute(attr, translate(diceLabel));
    }
    passes.sync();
    auto.checked = previous.autoCulture;
    demographics.sync();
    display
      .querySelectorAll<HTMLButtonElement>('button')
      .forEach((button, i) =>
        button.setAttribute(
          'aria-pressed',
          String(i < 3 ? currentComposition(s).buildings.look === button.dataset.cityDisplay : i === 5 ? !!s.appearance?.textured : !s.appearance?.textured && (i === 3 ? s.appearance?.city?.palette === 'ink' : s.appearance?.city?.palette !== 'ink')),
        ),
      );
  }
  // A run never redraws the culture: the same recipe gives the same map (the dice draws a new one on request).
  sync();
  return {
    sync,
    prepareGeneration: () => {
      sync();
    },
  };
}
