import type { V2Settings } from './contracts';
import type { World } from '../gen/types';
import { CULTURE_LABELS, cultureEra } from '../gen/options';
import { advancedPanel } from './advancedPanel';
import { recommendedCounts, recommendedCulture, settlementEnvironment } from './settlementDefaults';
import { bindTree, registerMessages, setText, translate, onLanguageChange } from './i18n';
import { currentComposition, writeAppearanceControl } from './renderControls';
import './workbenchLayout.css';

registerMessages({
  'In addition to the main settlement': { en: 'In addition to the main settlement', fr: 'En plus du lieu principal' },
  'Select on map': { en: 'Select on map', fr: 'Sélection' },
  'Editor': { en: 'Editor', fr: 'Éditeur' }, 'Global density': { en: 'Global density', fr: 'Densité globale' },
  'Follow the environment': { en: 'Follow the environment', fr: 'Suivre le milieu naturel' },
  'Medieval cultures': { en: 'Medieval cultures', fr: 'Cultures médiévales' },
  'Ancient cultures': { en: 'Ancient cultures', fr: 'Cultures antiques' },
  'Fantasy cultures': { en: 'Fantasy cultures', fr: 'Cultures fantastiques' },
  'Modern cultures': { en: 'Modern cultures', fr: 'Cultures modernes' },
  'Futuristic cultures': { en: 'Futuristic cultures', fr: 'Cultures futuristes' },
  'Footprints': { en: 'Footprints', fr: 'Empreintes' }, 'Simple': { en: 'Simple', fr: 'Simple' },
  'Complex': { en: 'Complex', fr: 'Complexe' }, 'Black and white': { en: 'Black and white', fr: 'Noir et blanc' },
  'Coloured': { en: 'Coloured', fr: 'Coloré' }, 'Textured': { en: 'Textured', fr: 'Texturé' },
});

onLanguageChange(()=>document.querySelectorAll<HTMLOptGroupElement>('optgroup[data-culture-group]').forEach(group=>group.label=translate(group.dataset.cultureGroup!)));

export function groupCultureSelector(select: HTMLSelectElement): void {
  const selected = select.value, groups = new Map<string, HTMLOptGroupElement>();
  for (const option of Array.from(select.options)) {
    const id = option.value;
    const era = cultureEra(id);
    const group = era === 'modern' ? 'Modern cultures' : era ? 'Futuristic cultures'
      : /elven|dwarven|goblin|giant|merfolk|lizard|underdark|orc|halfling|drow|gnome/.test(id) ? 'Fantasy cultures'
      : /roman|egyptian|nubian|mesopotamian|indus|levantine|greek/.test(id) ? 'Ancient cultures' : 'Medieval cultures';
    if (!groups.has(group)) { const node = document.createElement('optgroup'); node.dataset.cultureGroup=group;node.label = translate(group); groups.set(group, node); }
    groups.get(group)!.append(option);
  }
  select.replaceChildren(...['Medieval cultures', 'Ancient cultures', 'Fantasy cultures', 'Modern cultures', 'Futuristic cultures'].flatMap(k => groups.get(k) ?? []));
  select.value = selected;
}

export function mountWorkbenchLayout(api: {
  getSettings(): V2Settings; getWorld(): World | undefined;
  changed(): void; appearance(): void; syncForms(): void;
}) {
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
  const settlements = $('#family-settlements'), cities = $('#family-cities'), editor = $('#family-map');
  const general = settlements.querySelector<HTMLElement>('.family-general')!;
  const counts = Array.from(settlements.querySelectorAll<HTMLElement>('[data-field-path^="placement.counts."]'));
  const countsHost = document.createElement('div'); countsHost.className = 'settlement-counts'; countsHost.append(...counts); general.append(countsHost);
  const culture = $<HTMLSelectElement>('[data-option="culture"]'); groupCultureSelector(culture);
  const cultureHost = culture.closest<HTMLElement>('[data-control]')!; cultureHost.classList.add('culture-picker');
  const automatic = document.createElement('label'); automatic.className = 'checkline';
  const auto = document.createElement('input'); auto.type = 'checkbox'; auto.id = 'culture-environment';
  const autoText = document.createElement('span'); setText(autoText, 'Follow the environment'); automatic.append(auto, autoText); cultureHost.append(automatic);
  const densityHost = document.createElement('label'); densityHost.className = 'density-control';
  const caption = document.createElement('span'); setText(caption, 'Global density');
  const density = document.createElement('input'); density.id = 'settlement-density'; density.type = 'range'; density.min = '0'; density.max = '3'; density.step = '.05'; density.value = '1';
  const output = document.createElement('output'); output.htmlFor = density.id; densityHost.append(caption, output, density);const note=document.createElement('p');note.className='hint';setText(note,'In addition to the main settlement');countsHost.before(densityHost,note);
  const state = new WeakMap<V2Settings, { environment: string; autoCulture: boolean; counts: string; density: number; baseCounts?: Record<string,number>; autoCounts: boolean }>();
  density.oninput = () => {
    const s = api.getSettings(), previous = state.get(s)!;
    const values = previous.baseCounts ? Object.fromEntries(Object.entries(previous.baseCounts).map(([key,n])=>[key,Math.min(1000,Math.round(n*Number(density.value)))])) : recommendedCounts(s, Number(density.value));
    s.region ??= {}; s.region.placement = { ...s.region.placement, mode: 'counts', counts: values };
    previous.density = Number(density.value); previous.counts = JSON.stringify(values);
    api.changed(); api.syncForms(); sync();
  };
  culture.addEventListener('change', () => { auto.checked = false; state.get(api.getSettings())!.autoCulture = false; });
  auto.onchange = () => { state.get(api.getSettings())!.autoCulture = auto.checked; sync(true); api.changed(); api.syncForms(); };

  for (const family of [settlements, cities]) {
    const advanced = advancedPanel(family, 'Advanced');
    const primary = family.querySelector<HTMLElement>('.family-general')!;
    for (const row of Array.from(family.querySelectorAll<HTMLElement>('.stage-row'))) {
      const body = row.querySelector<HTMLElement>(':scope > .stage-body');
      if (!body) continue;
      // Only the main generation fields stay in the sidebar; all stage actions live in Advanced.
      for (const main of Array.from(body.querySelectorAll<HTMLElement>('.urban-primary'))) {
        if (main.children.length) {
          const group = document.createElement('section'); group.className = 'generation-primary-group';
          const title = document.createElement('h4');
          title.textContent = row.querySelector('.stage-title')?.textContent ?? '';
          group.append(title, main); primary.append(group);
        }
      }
      for (const nested of Array.from(body.querySelectorAll<HTMLElement>('.workbench-advanced'))) {
        const parent = nested.parentElement!;
        parent.querySelector(':scope > .advanced-open')?.remove();
        parent.append(...Array.from(nested.querySelector('.advanced-grid')!.children)); nested.remove();
      }
      body.hidden = false; advanced.grid.append(row);
      const toggle = row.querySelector<HTMLButtonElement>('.stage-title');
      if (toggle) { toggle.setAttribute('aria-expanded', 'true'); toggle.onclick = () => { body.hidden = false; }; }
    }
    family.querySelector('.chain-spine')?.remove();
    family.querySelector('.family-head')?.remove();
  }
  // Selection belongs to the list on the right, not to a second scope panel on the left.
  cities.querySelector('.family-city-scope')?.remove();
  cities.querySelector('.family-place')?.remove();
  // Editing tools and contextual inspectors share the left column.
  const moveTools=document.createElement('div');moveTools.className='settlement-position-tools';general.append(moveTools);for(const id of ['move-towns','town-positions-apply','town-positions-cancel'])moveTools.append($('#'+id));
  const countLegacy = $('#town-count').closest<HTMLElement>('[data-control]');
  if (countLegacy) settlements.querySelector('.advanced-grid')!.prepend(countLegacy);
  const selection = $('.inspector-mode');
  for(const node of Array.from(selection.childNodes))if(node.nodeType===Node.TEXT_NODE)node.textContent='';
  const places = $('#places-panel'); $('.map-area').append(places);
  places.querySelector('header')!.after(selection);
  editor.querySelector('.family-head')!.after($('#header-menu'), $('#editor-dock'));
  const cityInspector = document.createElement('div'); cityInspector.id = 'city-inspector'; cities.prepend(cityInspector); cityInspector.append($('#inspector'));

  const mapAdvanced = advancedPanel($('.view-strip'), 'Advanced'); mapAdvanced.button.id = 'map-advanced-open';
  for (const row of Array.from(editor.querySelectorAll<HTMLElement>('.stage-row'))) {
    const quick = row.querySelector<HTMLElement>('.stage-quick');
    if (quick) {
      for(const field of Array.from(quick.querySelectorAll<HTMLElement>('.parameter-field'))) {
        const path=field.querySelector<HTMLElement>('[data-setting-path]')?.dataset.settingPath;
        if(!['appearance.composition.ground.contours','appearance.composition.networks.water.visible','appearance.composition.networks.roads.visible','appearance.composition.text.visible'].includes(path??''))row.querySelector('.stage-body')!.prepend(field);
      }
      const views=quick.querySelector<HTMLElement>('.icon-segments');if(views)views.remove();
      if (quick.children.length) $('.view-strip').insertBefore(quick, mapAdvanced.button);
    }
    mapAdvanced.grid.append(row);
  }
  const display = document.createElement('div'); display.className = 'city-display-options';
  const specs = [
    ['Footprints', 'footprints'], ['Simple', 'simple-volumes'], ['Complex', 'detailed-volumes'],
    ['Black and white', 'ink'], ['Coloured', 'color'], ['Textured', 'texture'],
  ];
  specs.forEach(([label, value], i) => {
    const button = document.createElement('button'); button.type = 'button'; button.title = label; button.setAttribute('aria-label', label); button.dataset.cityDisplay = value;
    const image = document.createElement('i'); image.className = 'city-display-icon'; image.style.backgroundPosition = `${i * 20}% center`; button.append(image);
    button.onclick = () => {
      const s = api.getSettings();
      if (i < 3) writeAppearanceControl(s, 'appearance.composition.buildings.look', value);
      else { writeAppearanceControl(s, 'appearance.textured', value === 'texture'); writeAppearanceControl(s, 'appearance.city.palette', value === 'ink' ? 'ink' : 'atlas'); }
      api.appearance(); sync();
    }; display.append(button);
  }); $('.view-strip').insertBefore(display, mapAdvanced.button);
  const editorTab = $('#family-tab-map .chain-family-label'); setText(editorTab, 'Editor'); setText($('#family-map h3'), 'Editor');
  const strip = $('.view-strip'), toolbar = document.createElement('div');
  toolbar.className = 'toolbar-row';
  toolbar.append($('.style-control'), $('#scene-controls'));
  for (const child of Array.from(strip.children)) if (child !== mapAdvanced.panel) toolbar.append(child);
  // The optional 3D capture action stays available without widening the single settings row.
  mapAdvanced.grid.prepend($('#capture3d'));
  strip.prepend(toolbar);
  bindTree(document.body);
  function sync(force = false): void {
    const s = api.getSettings(); let previous = state.get(s);
    if (!previous) {
      const fresh = !api.getWorld() && !s.region?.placement?.counts && !s.region?.placement?.list?.length;
      previous = { environment: '', autoCulture: fresh && s.options.culture === 'european-organic', counts: JSON.stringify(s.region?.placement?.counts??{}), density: 1, baseCounts:s.region?.placement?.counts?{...s.region.placement.counts}:undefined, autoCounts:!s.region?.placement?.counts };  state.set(s, previous);
    }
    const stored=s.region?.placement?.counts;
    if(stored&&JSON.stringify(stored)!==previous.counts){previous.autoCounts=false;previous.baseCounts=Object.fromEntries(Object.entries(stored).map(([key,n])=>[key,n/Math.max(.05,previous.density)]));previous.counts=JSON.stringify(stored);}
    const environment = settlementEnvironment(s);
    if (environment !== previous.environment || force) {
      if (previous.autoCounts && s.region?.placement?.mode !== 'list') {
        s.region ??= {}; s.region.placement = { ...s.region.placement, mode: 'counts', counts: recommendedCounts(s, previous.density) };
        previous.counts = JSON.stringify(s.region.placement.counts);
      }
      if (previous.autoCulture) {
        const suggested = recommendedCulture(s);
        if (suggested && CULTURE_LABELS.some(([id]) => id === suggested)) { s.options.culture = suggested; culture.value = suggested; }
      }
      previous.environment = environment; api.syncForms();
    }
    auto.checked = previous.autoCulture; density.value = String(previous.density); output.value = `${Math.round(previous.density * 100)}%`;
    display.querySelectorAll<HTMLButtonElement>('button').forEach((button, i) => button.setAttribute('aria-pressed', String(i < 3
      ? currentComposition(s).buildings.look === button.dataset.cityDisplay
      : i === 5 ? !!s.appearance?.textured : !s.appearance?.textured && (i === 3 ? s.appearance?.city?.palette === 'ink' : s.appearance?.city?.palette !== 'ink'))));
  }
  sync(); return { sync };
}
