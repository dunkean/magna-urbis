import type { V2Settings } from './contracts';
import { currentComposition, PRESET_OPTIONS, renderControlValues, writeAppearanceControl } from './renderControls';
import { mixRenderStyle, type RenderMixComponent } from './renderPassMix';
import type { PresetId } from '../render/composition';
import { styleTraits } from '../render/terrainStyle';
import { readSettingPath } from './parameterForm';
import { bindTree, registerMessages, setText, translate, onLanguageChange } from './i18n';

registerMessages({
  'Shaders & layers': { en: 'Shaders & layers', fr: 'Shaders et couches' },
  'Mix existing style components without adding render passes.': { en: 'Mix existing style components without adding render passes.', fr: 'Assemblez les composants des styles existants, sans ajouter de passe de rendu.' },
  'Use a style for this component': { en: 'Use a style for this component', fr: 'Appliquer un style à ce composant' },
  'Current settings': { en: 'Current settings', fr: 'Réglages actuels' },
  'Detailed settings': { en: 'Detailed settings', fr: 'Réglages détaillés' },
  'Component settings': { en: 'Component settings', fr: 'Réglages du composant' },
  'Ground shader': { en: 'Ground shader', fr: 'Shader du sol' },
  'Relief shading': { en: 'Relief shading', fr: 'Ombrage du relief' },
  'Water': { en: 'Water', fr: 'Eau' }, 'Vegetation': { en: 'Vegetation', fr: 'Végétation' },
  'Roads': { en: 'Roads', fr: 'Routes' }, 'Buildings': { en: 'Buildings', fr: 'Bâtiments' },
  'Lighting': { en: 'Lighting', fr: 'Éclairage' }, 'Texts': { en: 'Texts', fr: 'Textes' },
  'Urban plan': { en: 'Urban plan', fr: 'Plan urbain' }, 'Contours': { en: 'Contours', fr: 'Courbes de niveau' },
  'Active': { en: 'Active', fr: 'Actif' }, 'Off': { en: 'Off', fr: 'Désactivé' },
  'Satellite material': { en: 'Satellite material', fr: 'Matériau satellite' },
  'Vector layers': { en: 'Vector layers', fr: 'Couches vectorielles' },
  'Map texture': { en: 'Map texture', fr: 'Texture cartographique' },
  'Land use': { en: 'Land use', fr: 'Occupation des sols' },
});

interface Pass {
  name: string; path: string; component?: RenderMixComponent;
  fields?: string[];
}
const passes: Pass[] = [
  { name: 'Ground shader', path: 'appearance.terrainLayers.hypsometry', component: 'ground', fields: ['appearance.composition.ground.look', 'appearance.composition.ground.variant', 'appearance.city.exaggeration', 'appearance.city.refinement'] },
  { name: 'Relief shading', path: 'appearance.composition.effects.relief' },
  { name: 'Water', path: 'appearance.composition.networks.water.visible', component: 'water', fields: ['appearance.composition.networks.water.look', 'appearance.composition.networks.water.waves'] },
  { name: 'Vegetation', path: 'appearance.composition.vegetation.look', component: 'vegetation', fields: ['appearance.composition.vegetation.look'] },
  { name: 'Roads', path: 'appearance.composition.networks.roads.visible', component: 'roads', fields: ['appearance.composition.networks.roads.look'] },
  { name: 'Urban plan', path: 'appearance.city.plan', component: 'plan', fields: ['appearance.composition.buildings.parcels', 'appearance.composition.buildings.blocks', 'appearance.composition.buildings.districts'] },
  { name: 'Buildings', path: 'appearance.composition.buildings.visible', component: 'buildings', fields: ['appearance.composition.buildings.look', 'appearance.city.colors'] },
  { name: 'Texts', path: 'appearance.composition.text.visible', component: 'text', fields: ['appearance.composition.text.look'] },
  { name: 'Lighting', path: 'appearance.composition.effects.lighting.enabled', component: 'lighting' },
  { name: 'Contours', path: 'appearance.composition.ground.contours' },
  { name: 'Land use', path: 'appearance.composition.landuse.rural', fields: ['appearance.composition.landuse.rural', 'appearance.composition.landuse.urban'] },
];

/** Settings-only UI: no frame listener, no generated geometry, no new graphics pass. */
export function mountRenderPassControls(panel: HTMLElement, api: { getSettings(): V2Settings; onChange(): void }) {
  const grid = panel.querySelector<HTMLElement>(':scope > .advanced-grid')!;
  const introduction = document.createElement('div'); introduction.className = 'render-pass-introduction';
  const title = document.createElement('h3'); setText(title, 'Shaders & layers');
  const context = document.createElement('output'); context.className = 'render-context';
  const hint = document.createElement('p'); hint.className = 'hint'; setText(hint, 'Mix existing style components without adding render passes.');
  introduction.append(title, context, hint); panel.querySelector('header')!.after(introduction);
  const cards: { pass: Pass; card: HTMLElement; status: HTMLElement; source?: HTMLSelectElement }[] = [];
  const homes: { field: HTMLElement; slot: HTMLElement; placeholder: HTMLElement }[] = [];
  const field = (path: string) => document.querySelector<HTMLElement>(`[data-setting-path="${path}"]`)?.closest<HTMLElement>('.parameter-field');
  const vegetation = new WeakMap<V2Settings, string>();
  const landuse = new WeakMap<V2Settings, { rural: string; urban: string }>();

  for (const pass of passes) {
    const card = document.createElement('section'); card.className = 'advanced-card render-pass-card'; card.dataset.renderPass = pass.component ?? pass.path;
    const head = document.createElement('header'), heading = document.createElement('h3'), status = document.createElement('span');
    heading.id = `render-pass-title-${cards.length}`;
    setText(heading, pass.name); status.className = 'render-pass-status'; head.append(heading, status); card.append(head);
    const toggle = document.createElement('div'); toggle.className = 'render-pass-toggle'; card.append(toggle);
    const shared = !['Vegetation', 'Land use'].includes(pass.name) && field(pass.path);
    if (shared) {
      if (shared.closest('.toolbar-row') && pass.component !== 'roads') {
        const placeholder = document.createElement('span'); placeholder.className = 'render-pass-placeholder'; placeholder.setAttribute('aria-hidden', 'true');
        homes.push({ field: shared, slot: toggle, placeholder });
      } else toggle.append(shared);
    } else {
      const label = document.createElement('label'), checkbox = document.createElement('input'); checkbox.type = 'checkbox';
      checkbox.setAttribute('aria-labelledby', heading.id); checkbox.dataset.passSwitch = pass.path;
      const caption = document.createElement('span'); setText(caption, pass.name); label.append(checkbox, caption); toggle.append(label);
      checkbox.onchange = () => {
        const settings = api.getSettings();
        if (pass.name === 'Vegetation') {
          const look = currentComposition(settings).vegetation.look;
          if (!checkbox.checked && look !== 'none') vegetation.set(settings, look);
          writeAppearanceControl(settings, pass.path, checkbox.checked ? vegetation.get(settings) ?? 'procedural-canopy' : 'none');
        } else if (pass.name === 'Land use') {
          const current = currentComposition(settings).landuse;
          if (!checkbox.checked) landuse.set(settings, { rural: current.rural, urban: current.urban });
          const restored = landuse.get(settings) ?? { rural: 'subtle', urban: 'subtle' };
          for (const scope of ['rural', 'urban'] as const) writeAppearanceControl(settings, `appearance.composition.landuse.${scope}`, checkbox.checked ? restored[scope] : 'off');
        } else writeAppearanceControl(settings, pass.path, checkbox.checked);
        api.onChange(); sync();
      };
    }
    let source: HTMLSelectElement | undefined;
    if (pass.component) {
      const label = document.createElement('label'); label.className = 'render-pass-source';
      const caption = document.createElement('span'); setText(caption, 'Use a style for this component'); source = document.createElement('select');
      const initial = new Option(translate('Current settings'), ''); source.append(initial);
      for (const preset of PRESET_OPTIONS.filter(p => p.value !== 'custom')) source.append(new Option(translate(preset.label), preset.value));
      label.append(caption, source); card.append(label);
      source.onchange = () => {
        if (!source!.value) return;
        mixRenderStyle(api.getSettings(), pass.component!, source!.value as PresetId);
        api.onChange(); source!.value = ''; sync();
      };
    }
    const options = document.createElement('details'); options.className = 'render-pass-options';
    const optionsTitle = document.createElement('summary'); setText(optionsTitle, 'Component settings'); options.append(optionsTitle);
    for (const path of pass.fields ?? []) { const input = field(path); if (input && input !== shared) options.append(input); }
    if (pass.component === 'ground') options.append(document.getElementById('view3d-advanced-controls')!);
    if (pass.component === 'buildings') {
      const icons = grid.querySelector('.city-rendering-settings'); if (icons) {icons.querySelector('h3')?.remove();icons.classList.remove('advanced-card');options.append(icons);}
      const textures = field('appearance.textured'); if (textures) options.append(textures);
    }
    if (options.children.length > 1) card.append(options);
    cards.push({ pass, card, status, source }); grid.append(card);
  }
  const details = document.createElement('details'); details.className = 'render-fine-settings';
  // These legacy switches are overridden by the composition's Vegetation and Building look controls.
  for (const path of ['appearance.forest.enabled', 'appearance.city.painted']) field(path)?.remove();
  const summary = document.createElement('summary'); setText(summary, 'Detailed settings'); details.append(summary);
  const fineGrid = document.createElement('div'); fineGrid.className = 'advanced-grid'; details.append(fineGrid); panel.append(details);
  const fine: { stage: string; wrapper: HTMLElement }[] = [];
  for (const row of Array.from(grid.querySelectorAll<HTMLElement>(':scope > .stage-row'))) {
    const wrapper = document.createElement('details'); wrapper.className = 'advanced-card render-fine-group';
    const heading = document.createElement('summary'); heading.textContent = row.querySelector('.stage-title')?.textContent ?? '';
    row.querySelector('.stage-head')?.remove(); wrapper.append(heading, row); fineGrid.append(wrapper);
    fine.push({ stage: row.dataset.stage ?? '', wrapper });
  }
  function relocate(open: boolean) {
    for (const home of homes) {
      if (open && !home.placeholder.isConnected) {
        const bounds = home.field.getBoundingClientRect(); home.placeholder.style.width = `${bounds.width}px`;
        home.field.before(home.placeholder); home.slot.append(home.field);
      } else if (!open && home.placeholder.isConnected) home.placeholder.replaceWith(home.field);
    }
  }
  panel.addEventListener('toggle', () => { relocate(panel.matches(':popover-open')); sync(); });
  new MutationObserver(() => sync()).observe(document.getElementById('view3d')!, { attributes: true, attributeFilter: ['aria-pressed'] });
  onLanguageChange(sync);
  function sync() {
    if(!panel.matches(':popover-open'))return;
    const appearance=renderControlValues(api.getSettings()),recipe=appearance.composition!;
    const mode = document.getElementById('view3d')?.getAttribute('aria-pressed') === 'true' ? '3D' : '2D';
    const preset = PRESET_OPTIONS.find(p => p.value === recipe.preset);
    const traits = styleTraits(recipe.ground.variant);
    context.textContent = `${preset ? translate(preset.label) : recipe.ground.look} · ${mode} · ${translate(traits.family === 'material' ? 'Satellite material' : mode === '3D' ? 'Map texture' : 'Vector layers')}`;
    panel.dataset.renderStyle = recipe.ground.look; panel.dataset.renderTarget = mode;
    for (const { pass, card, status } of cards) {
      const current = readSettingPath({appearance},pass.path), on = pass.name === 'Vegetation' ? current !== 'none' : pass.name === 'Land use' ? recipe.landuse.rural !== 'off' || recipe.landuse.urban !== 'off' : current !== false;
      card.dataset.enabled = String(on); setText(status, on ? 'Active' : 'Off');
      const checkbox = card.querySelector<HTMLInputElement>('[data-pass-switch]'); if (checkbox) checkbox.checked = on;
    }
    const waves = field('appearance.composition.networks.water.waves');
    if (waves) waves.hidden = !traits.satelliteVariant;
    for (const path of ['appearance.city.exaggeration', 'appearance.city.refinement', 'appearance.city.colors']) {
      const control = field(path); if (control) control.hidden = mode !== '3D';
    }
    for (const { stage, wrapper } of fine) wrapper.hidden =
      stage === 'display-vegetation' && recipe.vegetation.look === 'none' ||
      stage === 'display-water' && !recipe.networks.water.visible || stage === 'display-roads' && !recipe.networks.roads.visible ||
      stage === 'display-buildings' && !recipe.buildings.visible || stage === 'display-text' && !recipe.text.visible ||
      stage === 'display-landuse' && recipe.landuse.rural === 'off' && recipe.landuse.urban === 'off';
  }
  bindTree(panel); sync(); return { sync };
}
