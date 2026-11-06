import { mountRenderSettingsPanel, mountRenderColorControls, splitSectionLevels, type RenderSection, type SectionLevels } from './renderSettingsPanel';
import { compositionMessages, mountCompositionSection, renderControlFields, RENDER_SECTION_FIELDS, writeCompositionField, LIMITATION_ROW, NOTE_STYLE } from './compositionControls';
import { mountParameterForm, readSettingPath, type ParameterForm, type ParameterField } from './parameterForm';
import { getBenchComposition, setBenchComposition, resolveBenchAppearance, setBenchAppearanceField } from './benchComposition';
import { GROUND_VARIANTS } from '../render/composition';
import { resolveAppearance, resolvedValues } from '../render/appearanceRecipe';
import { registerMessages, setLanguage } from '../v2/i18n';
import { getBenchRenderColors, setBenchRenderColors } from './benchRenderColors';
import { urbanText } from './urbanPanelLocale';
import { terrainStyle } from '../render/terrainStyle';
import { paletteColors, type RenderColorKey } from '../render/customColors';
import { markStyleCustomized } from './renderStyleCustomization';

/** Reuse the original inputs: stage owners retain state, listeners and conditional visibility. */
export function installBenchRenderSettings(): void {
  const nav = document.querySelector<HTMLElement>('body > nav');
  if (!nav || document.querySelector('#bench-render-settings')) return;
  const localized: { element: HTMLElement; en: string; fr: string }[] = [];
  const text = (element: HTMLElement, en: string, fr: string) => { localized.push({ element, en, fr }); element.textContent = urbanText([fr, en, en, en, en]); };
  const panel = mountRenderSettingsPanel(nav, text); panel.root.id = 'bench-render-settings';
  registerMessages(compositionMessages);
  const locale = () => setLanguage(urbanText(['fr', 'en', 'en', 'en', 'en']) === 'fr' ? 'fr' : 'en'); locale();
  const forms: ParameterForm[] = [], levels = {} as Record<RenderSection, SectionLevels>;
  const mountIn = (parent: HTMLElement, fields: readonly ParameterField[]) => {
    if (!fields.length) return;
    const body = document.createElement('div'); parent.append(body);
    forms.push(mountParameterForm(body, fields, {
      getValue: path => readSettingPath({ appearance: resolvedValues(resolveBenchAppearance({}, 'view2d')) }, path),
      setValue: (path, value) => {
        if (path.startsWith('appearance.composition.')) setBenchComposition(writeCompositionField(getBenchComposition(), path.slice('appearance.composition.'.length), value));
        else setBenchAppearanceField(path, value);
      },
    }));
  };
  for (const key of Object.keys(panel.bodies) as RenderSection[]) {
    const level = levels[key] = splitSectionLevels(panel.bodies[key], text);
    mountCompositionSection(level, key, mountIn, text);
    mountIn(key === 'diagnostics' ? level.rows : level.advanced, RENDER_SECTION_FIELDS[key].map(path => renderControlFields.find(field => field.path === `appearance.${path}`)!));
  }
  const driven = (selector: string, value: string | boolean | number) => {
    for (const field of Array.from(document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(selector))) {
      const node = field.closest<HTMLElement>('label') ?? field; node.hidden = true;
      if (typeof value === 'boolean' && field instanceof HTMLInputElement) { if (field.checked === value) continue; field.checked = value; }
      else { if (field.value === String(value)) continue; if (field instanceof HTMLSelectElement && !Array.from(field.options).some(option => option.value === String(value))) field.add(new Option(String(value), String(value))); field.value = String(value); }
      field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };
  let driving = false;
  const syncComposition = () => {
    if (driving) return; driving = true;
    try {
      const r = resolveBenchAppearance({}, 'view2d'), notes = resolveBenchAppearance(), c = r.composition, a = resolvedValues(r);
      driven('#style, #backgroundStyle', c.variant); driven('#showContours', r.ground.contours); driven('#showRelief', r.ground.layers.relief);
      driven('#showWater', c.networks.water.visible); driven('#roadShow', c.networks.roads.visible); driven('#roadPreset', c.networks.roads.look === 'natural' ? 'render' : 'ink');
      driven('[data-building-visible]', c.buildings.visible); driven('[data-building-style]', r.city.buildingStyle); driven('[data-building-diagnostic]', r.city.diagnostic);
      driven('#roadBlend', c.networks.roads.look === 'natural' ? 'blended' : 'classic'); driven('[data-render="groundBlend"]', r.city.groundBlend);
      driven('#showLanduse', true); driven('#showPlan', r.city.plan); driven('#showLegend', r.cartography.legend); driven('#showFrame', r.ground.layers.frame);
      driven('#landuseStyle', r.palette.mapStyle); driven('#landuseVegetation', r.vegetation.symbols); driven('#landusePainted', c.vegetation.painted);
      driven('#showHypsometry', r.ground.layers.hypsometry); driven('#showShading', r.ground.lighting.enabled);
      driven('#lightAzimuth', r.ground.lighting.azimuth); driven('#lightElevation', r.ground.lighting.elevation); driven('#lightStrength', r.ground.lighting.strength); driven('#lightExaggeration', r.ground.lighting.exaggeration);
      driven('#showLakes', r.ground.lakes); driven('#showOxbows', r.ground.oxbows); driven('#forestEnabled', r.vegetation.forestSettings.enabled);
      driven('#forestDensity', r.vegetation.forestSettings.density * 100); driven('#forestClearings', r.vegetation.forestSettings.clearings * 100);
      driven('#renderV2Season', r.ground.season); driven('#hydroOverlay', r.diagnostic.startsWith('res-') ? 'none' : r.diagnostic);
      if (r.traits.satelliteVariant) driven('#renderV2Diagnostic', c.variant);
      for (const key of ['density', 'size', 'spacing'] as const) driven(`#brush_${key}`, r.vegetation.fantasy[key]);
      driven('#brush_landuse', r.vegetation.fantasy.followLanduse === true);
      driven('#refinement3d', r.city.refinement); driven('#exaggeration3d', r.city.exaggeration); driven('[data-forest-tone]', r.cartography.landuseForestTone);
      for (const field of renderControlFields.filter(field => !field.path.startsWith('appearance.composition.'))) {
        const path = field.path.replace('appearance.', ''), key = path.startsWith('city.layers.') ? path.slice('city.layers.'.length) : path.startsWith('city.') ? path.slice('city.'.length) : path;
        const value = readSettingPath(a, path); if (value !== undefined && ['string', 'number', 'boolean'].includes(typeof value)) driven(`[data-render="${key}"]`, value as string | number | boolean);
      }
      forms.forEach(form => form.sync());
      const preset = panel.root.querySelector<HTMLSelectElement>('[data-setting-path="appearance.composition.preset"]')!;
      preset.querySelector<HTMLOptionElement>('option[value="custom"]')!.disabled = true;
      const variant = panel.root.querySelector<HTMLSelectElement>('[data-setting-path="appearance.composition.ground.variant"]')!, variants = GROUND_VARIANTS[getBenchComposition().ground.look];
      for (const option of Array.from(variant.options)) option.hidden = option.disabled = !variants.includes(option.value as typeof c.variant);
      variant.closest<HTMLElement>('.parameter-field')!.hidden = variants.length <= 1;
      panel.root.querySelectorAll('.v2-limitation, .v2-incompatible').forEach(note => note.remove());
      for (const { pass, field, reason } of notes.composition.limitations) {
        const row = panel.root.querySelector(`[data-setting-path="appearance.${field ?? LIMITATION_ROW[pass]}"]`)?.closest('.parameter-field'); if (!row) continue;
        const note = document.createElement('small'); note.className = 'v2-limitation'; note.style.cssText = NOTE_STYLE;
        note.textContent = urbanText([compositionMessages[reason]?.fr ?? reason, reason, reason, reason, reason]); row.append(note);
      }
      for (const { field, reason } of notes.incompatibilities) {
        const path = ({ terrainStyle: 'composition.ground.look', painted: 'composition.vegetation.look', legend: 'composition.annotations.legend' } as Record<string, string>)[field] ?? field;
        const row = field.startsWith('colors.') ? panel.root.querySelector(`[data-color-key="${field.slice(7)}"]`) : panel.root.querySelector(`[data-setting-path="appearance.${path}"]`)?.closest('.parameter-field'); if (!row) continue;
        const note = document.createElement('small'); note.className = 'v2-incompatible'; note.style.cssText = NOTE_STYLE;
        note.textContent = urbanText([compositionMessages[reason]?.fr ?? reason, reason, reason, reason, reason]); row.append(note);
      }
    } finally { driving = false; }
  };
  const move = (section: RenderSection, selector: string) => {
    for (const field of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      const node = field.matches('input,select,button') ? field.closest<HTMLElement>('label') ?? field : field;
      if (!levels[section].advanced.contains(node)) levels[section].advanced.append(node);
    }
  };
  const colors = mountRenderColorControls(panel, text, {
    getColors: getBenchRenderColors,
    getStyle: () => resolveBenchAppearance().styleId,
    getPalette: () => terrainStyle(resolveBenchAppearance().styleId).palette,
    setColor: (key, value) => { const next = { ...getBenchRenderColors() }; if (value === undefined) delete next[key]; else next[key] = value; setBenchRenderColors(next); },
    isAvailable: key => {
      if (['forest', 'meadow', 'field'].includes(key)) return !!document.querySelector('#landuseStyle');
      return true;
    },
  });
  const syncStyle = () => {
    const style = document.querySelector<HTMLSelectElement>('#style'), background = document.querySelector<HTMLSelectElement>('#backgroundStyle');
    const defaults = paletteColors(terrainStyle(resolveBenchAppearance().styleId).palette);
    const customColors = Object.entries(getBenchRenderColors()).some(([key, value]) => value.toLowerCase() !== defaults[key as RenderColorKey].toLowerCase());
    const current = resolvedValues(resolveBenchAppearance({}, 'view2d')), inherited = resolvedValues(resolveAppearance({ style: 'parchment', composition: getBenchComposition() }, { mapStyle: 'parchment' }, { nativeCities: true }, 'view2d'));
    const customized = customColors || renderControlFields.filter(field => !field.path.startsWith('appearance.composition.')).some(field => readSettingPath(current, field.path.slice('appearance.'.length)) !== readSettingPath(inherited, field.path.slice('appearance.'.length)));
    for (const select of [style, background, panel.root.querySelector<HTMLSelectElement>('[data-setting-path="appearance.composition.preset"]')]) if (select) markStyleCustomized(select, customized);
  };
  const collect = () => {
    move('general', '#showFrame, #showLegend, #backgroundOpacity');
    move('relief', '#showRelief, #showContours, #showShading, #lightAzimuth, #lightElevation, #lightStrength, #lightExaggeration, #resetLighting, #refinement3dControl, #perspectiveControls');
    move('ground', '#style, #showHypsometry, #showBackground, #backgroundStyle');
    move('vegetation', '#renderV2Controls, #forestControls3d, #lightingControls fieldset');
    move('water', '#showWater, #showLakes, #showOxbows');
    move('roads', '#roadRendering, #roadShow');
    move('landuse', '#showLanduse');
    move('buildings', '#showPlan');
    move('diagnostics', '#hydroOverlay');
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('[data-render-settings-category]'))) {
      const category = element.dataset.renderSettingsCategory as RenderSection;
      if (levels[category] && !levels[category].advanced.contains(element)) levels[category].advanced.append(element);
    }
    for (const key of Object.keys(levels) as RenderSection[]) for (const grid of Array.from(panel.bodies[key].querySelectorAll(':scope > .render-color-grid'))) levels[key].advanced.append(grid);
    const old = document.querySelector<HTMLElement>('#lightingControls'); if (old) old.hidden = true;
    const cityBlend = document.querySelector<HTMLElement>('[data-render="groundBlend"]')?.closest<HTMLElement>('label');
    if (cityBlend) cityBlend.hidden = !!document.querySelector('#roadBlend');
    colors.sync();
    syncComposition();
    syncStyle();
    for (const [category, section] of Object.entries(panel.sections) as [RenderSection, HTMLDetailsElement][]) {
      section.hidden = !panel.bodies[category].children.length;
    }
  };
  // Stage modules finish binding before their controls are moved into the shared panel.
  let queued = false;
  const schedule = () => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; collect(); }); };
  const stages = document.querySelector('.stages');
  if (stages) new MutationObserver(schedule).observe(stages, { subtree: true, childList: true });
  nav.addEventListener('change', () => { colors.sync(); syncStyle(); });
  nav.addEventListener('input', syncStyle);
  nav.addEventListener('click', () => queueMicrotask(syncStyle));
  window.addEventListener('bench-render-colors-change', syncStyle);
  window.addEventListener('bench-composition-change', syncComposition);
  window.addEventListener('bench-render-capabilities-change', syncComposition);
  window.addEventListener('bench-space-change', schedule);
  window.addEventListener('magna-locale-change', () => { locale(); for (const { element, en, fr } of localized) element.textContent = urbanText([fr, en, en, en, en]); syncComposition(); queueMicrotask(syncStyle); });
  schedule();
}
