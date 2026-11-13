/** Display controls for retained terrain and native cities; none invokes a generation stage. */
import type { World } from '../gen/types';
import type { V2Appearance, V2Settings } from './contracts';
import { RESOURCE_LEGENDS, diagnosticAvailable, isResourceDiagnostic } from '../render/displayDiagnostics';
import type { RenderTarget, ResolvedAppearance } from '../render/appearanceRecipe';
import { resolveSettingsAppearance } from './appearance';
import { resolvedValues } from '../render/appearanceRecipe';
import { bindTree, registerMessages, setText } from './i18n';
import { mountParameterForm, readSettingPath, writeSettingPath, type ParameterField, type ParameterForm } from './parameterForm';
import { mountRenderSettingsPanel, mountRenderColorControls, splitSectionLevels, type RenderSection, type SectionLevels } from '../ui/renderSettingsPanel';
import { styleTraits, terrainStyle, type TerrainStyle } from '../render/terrainStyle';
import { paletteColors, type RenderColorKey } from '../render/customColors';
import { GROUND_VARIANTS, withCompositionQuality, type CompositionRecipe } from '../render/composition';
import { compositionMessages, advancedFields, fantasyFields, forestFields, diagnosticFields, renderControlFields, RENDER_SECTION_FIELDS, RENDER_COMPOSITION_ROWS, mountCompositionSection, writeCompositionField, incompatibilityText, limitationText, LIMITATION_ROW, NOTE_STYLE } from '../ui/compositionControls';
export { PRESET_OPTIONS, RENDER_COMPOSITION_ROWS, renderControlFields, RENDER_SECTION_FIELDS } from '../ui/compositionControls';
import { worldCapabilities } from './nativeProducts';
import { markStyleCustomized } from '../ui/renderStyleCustomization';
import { applySceneClock } from './sceneClock';
import { setDisplayQualityPreference, onDisplayQualityChange, setDisplayAppearanceQuality } from '../render/displayQuality';
import { getVectorEnginePreference, onVectorEngineChange, setVectorEnginePreference } from '../render/vectorEngine';
import type { VectorEngineChoice } from '../render/gpu/displayList';

export interface RenderControlBindings { getSettings(): V2Settings; onChange(): void; getWorld?(): World | undefined; getStyleSelectors?(): readonly HTMLSelectElement[]; /** Target of the current view, for the limitations shown under the rows. */ getTarget?(): RenderTarget }
export interface RenderControls { sync(): void; dispose(): void }
export const renderControlMessages: Record<string, { en: string; fr: string }> = compositionMessages;
function copy(en: string, fr: string): string { renderControlMessages[en] = renderControlMessages[fr] = { en, fr }; return en; }
const ui = {
  title: copy('Render settings', 'Réglages du rendu'), common: copy('Map and natural cover', 'Carte et milieux naturels'),
  help: copy('Redraw the retained map. These settings do not regenerate terrain or settlements.', 'Redessine la carte conservée. Ces réglages ne régénèrent ni le relief ni les lieux.'),
  terrain: copy('Terrain and water layers', 'Couches du relief et de l’eau'), light: copy('Lighting and relief', 'Lumière et relief'),
  city: copy('Cities and buildings', 'Villes et bâtiments'), cityLayers: copy('Detailed city layers', 'Couches détaillées des villes'),
  fantasy: copy('Fantasy brushes', 'Pinceaux fantasy'),
  diagnostics: copy('Terrain and water diagnostics', 'Diagnostics du relief et de l’eau'),
  fullQuality: copy('Full quality', 'Qualité complète'),
  qualityNotice: copy('Light quality enabled to keep navigation fluid.', 'Qualité allégée activée pour garder une navigation fluide.'),
  unavailable: copy('This diagnostic needs retained data from the selected water engine.', 'Ce diagnostic nécessite les données conservées du moteur hydrologique correspondant.'),
  vectorEngine: copy('Vector engine', 'Moteur vectoriel'),
  vectorEngineHelp: copy('Draws the vector map on the graphics card; Auto falls back to the processor on slow or software graphics.', 'Dessine la carte vectorielle sur la carte graphique ; Auto revient au processeur sur un GPU lent ou logiciel.'),
  vectorAuto: copy('Auto', 'Auto'), vectorGpu: copy('GPU', 'GPU'),
  // Not plain "CPU": that key is already registered (compute choice) with a different French label.
  vectorCpu: copy('CPU (processor)', 'Processeur'),
};
/** Browser preference, not a render setting: it never enters the saved recipe. */
const vectorEngineField: ParameterField = { path: 'vectorEngine', label: ui.vectorEngine, help: ui.vectorEngineHelp, type: 'select',
  options: [{ value: 'auto', label: ui.vectorAuto }, { value: 'gpu', label: ui.vectorGpu }, { value: 'cpu', label: ui.vectorCpu }] };
// These labels also localize the shared terrain-style selector mounted by the main UI.
copy('Fantasy · Ink (B&W)', 'Fantasy · Encre N&B'); copy('Fantasy · Watercolour', 'Fantasy · Aquarelle');
copy('Render v2 · Satellite', 'Render v2 · Satellite'); copy('Elevation · DEM', 'Altitude · DEM');

/** Defaults come from the shared resolver (one table for 2D, 3D and export); a saved recipe is never expanded. */
export function renderControlValues(settings: V2Settings, world?: World): V2Appearance {
  return resolvedValues(resolveSettingsAppearance(settings, world, 'view2d')) as V2Appearance;
}
/** The recipe the panel shows: the saved one, or the one `resolveSettingsAppearance` falls back to. */
export function currentComposition(settings: V2Settings, world?: World): CompositionRecipe { return renderControlValues(settings, world).composition!; }
/** A selected preset alone is unchanged. Compare the advanced display values with those the same recipe inherits. */
export function appearanceCustomized(settings: V2Settings, world?: World): boolean {
  const a = settings.appearance; if (!a) return false;
  const current = { appearance: renderControlValues(settings, world) };
  const defaults = { appearance: renderControlValues({ ...settings, appearance: { style: a.style, composition: a.composition } }, world) };
  for (const field of advancedFields) if (readSettingPath(current, field.path) !== readSettingPath(defaults, field.path)) return true;
  const colors = paletteColors(terrainStyle(current.appearance.terrainStyle ?? a.style).palette);
  return Object.entries(a.colors ?? {}).some(([key, value]) => value.toLowerCase() !== colors[key as RenderColorKey].toLowerCase());
}
/** A manual change of the ground drops the per-city ground override, as the old style selector did. */
function resetCityGround(settings: V2Settings): void { delete settings.appearance?.city?.ground; }
function writeComposition(settings: V2Settings, key: string, value: unknown): void {
  const appearance = settings.appearance!;
  const previous = appearance.composition;
  appearance.composition = writeCompositionField(appearance.composition ?? currentComposition(settings), key, value);
  // Scene controls describe the environment independently of the chosen map style.
  if (key === 'preset' && value !== 'custom' && previous) {
    const { season, ambience, lighting, calendar } = previous.effects;
    Object.assign(appearance.composition.effects, { season, ambience, lighting: { ...lighting }, ...(calendar ? { calendar: { ...calendar } } : {}) });
  }
  // Choosing the full entry again overrides an automatic fallback and remembers that explicit choice.
  if (key === 'preset' && value !== 'custom' && previous?.quality === 'light' && appearance.composition.quality === 'full') setDisplayQualityPreference('full');
  if (key === 'preset' && value !== 'custom' || key === 'ground.look' || key === 'ground.variant') resetCityGround(settings);
  if (key === 'preset' && settings.scene) applySceneClock(settings, settings.scene);
}
/** Materialize only the nested structure being edited, keeping unrelated inherited values absent. */
export function writeAppearanceControl(settings: V2Settings, path: string, value: unknown): void {
  if (/^appearance\.composition\.effects\.(season|ambience|lighting\.(enabled|azimuth|elevation))$/.test(path)) delete settings.scene;
  settings.appearance ??= { style: settings.options.style };
  if (path.startsWith('appearance.composition.')) return writeComposition(settings, path.slice('appearance.composition.'.length), value);
  const defaults = renderControlValues(settings);
  for (const key of ['terrainLayers', 'fantasy'] as const)
    if (path.startsWith(`appearance.${key}.`) && !settings.appearance[key]) Object.assign(settings.appearance, { [key]: defaults[key] });
  writeSettingPath(settings, path, value);
}

function addNote(target: HTMLElement | null, className: string, message: string): void {
  if (!target) return;
  const note = document.createElement('small'); note.className = className; note.style.cssText = NOTE_STYLE; setText(note, message);
  target.append(note);
}
// Queried on the document: the staged chain moves the section bodies out of the panel root.
const fieldOf = (path: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-setting-path="appearance.${path}"]`)?.closest<HTMLElement>('.parameter-field') ?? null;
/** A short muted note under each control the resolver declares incompatible with the current ground. */
function showIncompatibilities(resolved: ResolvedAppearance): void {
  document.querySelectorAll('.v2-incompatible').forEach(note => note.remove());
  for (const { field, reason } of resolved.incompatibilities)
    addNote(field.startsWith('colors.') ? document.querySelector<HTMLElement>(`[data-color-key="${field.slice(7)}"]`) : fieldOf(field), 'v2-incompatible', incompatibilityText[reason] ?? reason);
}
/** What the current backend cannot honour: a note under the matching row. The choice itself is never disabled or rewritten. */
function showLimitations(resolved: ResolvedAppearance): void {
  document.querySelectorAll('.v2-limitation').forEach(note => note.remove());
  for (const { pass, reason, field } of resolved.composition.limitations) addNote(fieldOf(field ?? LIMITATION_ROW[pass]), 'v2-limitation', limitationText[reason] ?? reason);
}

export function mountRenderControls(host: HTMLElement, bindings: RenderControlBindings): RenderControls {
  const text = (element: HTMLElement, en: string, fr: string) => { const label = copy(en, fr); registerMessages(renderControlMessages); setText(element, label); };
  registerMessages(renderControlMessages);
  const panel = mountRenderSettingsPanel(host, text), { root } = panel;
  root.classList.add('v2-render-controls'); root.id = 'render-settings';
  panel.popup.classList.add('v2-render-popup');
  for (const section of Object.values(panel.sections)) section.classList.add('v2-render-section');
  const forms: ParameterForm[] = [];
  let unlistenEngine = (): void => {};
  const valueOf = (path: string) => readSettingPath({ appearance: renderControlValues(bindings.getSettings(), bindings.getWorld?.()) }, path);
  const mountIn = (parent: HTMLElement, fields: readonly ParameterField[]): void => {
    if (!fields.length) return;
    const body = document.createElement('div'); parent.append(body);
    forms.push(mountParameterForm(body, fields, { getValue: valueOf, setValue: (path, value) => { writeAppearanceControl(bindings.getSettings(), path, value); bindings.onChange(); sync(); } }));
  };
  // Keep the listed order: RENDER_COMPOSITION_ROWS and RENDER_SECTION_FIELDS are the single description of the panel layout.
  const byPath = (...paths: readonly string[]) => paths.map(path => renderControlFields.find(field => field.path === `appearance.${path}`)!);
  const levels = {} as Record<RenderSection, SectionLevels>;
  const conditionalPaths = [...fantasyFields, ...forestFields].map(field => field.path.replace('appearance.', ''));
  for (const key of ['ground', 'relief', 'vegetation', 'landuse', 'water', 'roads', 'buildings', 'ambience', 'text', 'general'] as const) {
    const level = levels[key] = splitSectionLevels(panel.bodies[key], text);
    mountCompositionSection(level, key, mountIn, text);
    mountIn(level.advanced, byPath(...RENDER_SECTION_FIELDS[key].filter(path => !conditionalPaths.includes(path))));
  }
  const conditional = (label: string, fields: ParameterField[]) => {
    const group = document.createElement('details'), summary = document.createElement('summary'); setText(summary, label); group.append(summary);
    const body = document.createElement('div'); group.append(body); levels.vegetation.advanced.append(group);
    forms.push(mountParameterForm(body, fields, { getValue: valueOf, setValue: (path, value) => { writeAppearanceControl(bindings.getSettings(), path, value); bindings.onChange(); sync(); } }));
    return group;
  };
  const fantasy = conditional(ui.fantasy, fantasyFields);
  {
    const body = document.createElement('div'); levels.general.advanced.append(body);
    const engineForm = mountParameterForm(body, [vectorEngineField], { getValue: () => getVectorEnginePreference(), setValue: (_path, value) => setVectorEnginePreference(value as VectorEngineChoice) });
    forms.push(engineForm);
    // The engine can also change by itself (a demotion) or from another control: keep the select true.
    unlistenEngine = onVectorEngineChange(() => engineForm.sync());
  }
  let qualityToast: HTMLElement | undefined;
  const unlistenQuality = onDisplayQualityChange(change => {
    if (change.reason === 'preference') { qualityToast?.remove(); qualityToast = undefined; }
    if (change.reason !== 'auto') return;
    const settings = bindings.getSettings(), recipe = currentComposition(settings, bindings.getWorld?.());
    if (recipe.preset === 'satellite' || recipe.preset === 'parchment') {
      settings.appearance ??= { style: settings.options.style };
      settings.appearance.composition = withCompositionQuality(recipe, 'light');
      setDisplayAppearanceQuality('light');
      for (const select of bindings.getStyleSelectors?.() ?? []) select.value = settings.appearance.composition.preset;
      bindings.onChange(); sync();
    }
    qualityToast?.remove();
    const toast = qualityToast = document.createElement('div'); toast.className = 'toast'; toast.setAttribute('role', 'status');
    const message = document.createElement('span'), action = document.createElement('button');
    setText(message, ui.qualityNotice); setText(action, ui.fullQuality); action.style.marginLeft = '12px';
    action.onclick = () => {
      const settings = bindings.getSettings(); settings.appearance ??= { style: settings.options.style };
      settings.appearance.composition = withCompositionQuality(currentComposition(settings, bindings.getWorld?.()), 'full');
      setDisplayQualityPreference('full'); setDisplayAppearanceQuality('full');
      for (const select of bindings.getStyleSelectors?.() ?? []) select.value = settings.appearance.composition.preset;
      qualityToast?.remove(); qualityToast = undefined; bindings.onChange(); sync();
    };
    toast.append(message, action); document.body.append(toast);
  });
  const forestLabel = copy('Satellite trees', 'Arbres satellite'); registerMessages(renderControlMessages);
  const forest = conditional(forestLabel, forestFields);
  mountIn(panel.bodies.diagnostics, diagnosticFields);
  const unavailable = document.createElement('p'); unavailable.className = 'hint v2-render-unavailable'; setText(unavailable, ui.unavailable); panel.bodies.diagnostics.append(unavailable);
  const legend = document.createElement('p'); legend.className = 'hint v2-diagnostic-legend'; panel.bodies.diagnostics.append(legend);
  const legendFr: Record<string, string> = {
    'res-geology': 'Roche : granite rose, calcaire crème, grès ocre, marne olive, basalte gris sombre, métamorphique violet, ultrabasique vert, évaporite blanc-bleu.',
    'res-soil-depth': 'Profondeur du sol, de 0 à 3 m : sable clair → brun sombre.', 'res-moisture': 'Indice d’humidité du sol, de 0 à 1 : sable → bleu profond.',
    'res-drainage': 'Classe de drainage : très mauvais (bleu sombre), mauvais, modéré, bien drainé (sable).', 'res-alluvial': 'Part d’alluvions du sol, de 0 à 1 : transparent → ocre.',
    'res-potential': 'Potentiel de la ressource, de 0 à 1 (choisie ci-dessous) : transparent → jaune → vert sombre.',
    'res-deposits': 'Petits gisements (disque = minerai récupérable) et ancres d’activité (losanges), colorés par famille ou type.',
    'res-sites': 'Sites d’activité colorés par catégorie (extraction, énergie, eau, forêt, pastoral), reliés au lieu parent par un trait fin ; nœuds du réseau (péages, bacs, auberges, postes frontières) en cercles cramoisis ; installations (fronts de carrière, haldes, biefs, pontons, enclos…) tracées par type de sol.',
  };
  const colors = mountRenderColorControls(panel, text, {
    getColors: () => bindings.getSettings().appearance?.colors,
    getStyle: () => { const a = renderControlValues(bindings.getSettings(), bindings.getWorld?.()); return a.terrainStyle ?? a.style; },
    getPalette: () => { const a = renderControlValues(bindings.getSettings(), bindings.getWorld?.()); return terrainStyle(a.terrainStyle ?? a.style).palette; },
    setColor: (key, value) => { writeAppearanceControl(bindings.getSettings(), `appearance.colors.${key}`, value); bindings.onChange(); },
  });
  // Colours are level 3: fold each group into its section's advanced body.
  for (const key of Object.keys(levels) as RenderSection[]) for (const grid of Array.from(panel.bodies[key].querySelectorAll(':scope > .render-color-grid'))) levels[key].advanced.append(grid);
  // Captured once: the staged V2 chain relocates section bodies outside this panel.
  const presetSelect = root.querySelector<HTMLSelectElement>('[data-setting-path="appearance.composition.preset"]')!;
  const variantSelect = root.querySelector<HTMLSelectElement>('[data-setting-path="appearance.composition.ground.variant"]')!;
  const variantField = variantSelect.closest<HTMLElement>('.parameter-field')!;
  presetSelect.querySelector<HTMLOptionElement>('option[value="custom"]')!.disabled = true;
  const diagnostic = root.querySelector<HTMLSelectElement>('[data-setting-path="appearance.diagnostic"]')!;
  const potentialField = root.querySelector<HTMLElement>('[data-setting-path="appearance.resourcePotential"]')!.closest<HTMLElement>('.parameter-field')!;
  bindTree(root);
  function sync(): void {
    for (const form of forms) form.sync();
    const settings = bindings.getSettings(), world = bindings.getWorld?.(), a = renderControlValues(settings, world);
    const style = a.terrainStyle ?? a.style, variants = GROUND_VARIANTS[a.composition!.ground.look];
    colors.sync();
    // The variant row lists the variants of the chosen look and disappears when there is only one.
    for (const option of Array.from(variantSelect.options)) option.hidden = option.disabled = !variants.includes(option.value as TerrainStyle);
    variantField.hidden = variants.length <= 1;
    const resolved = resolveSettingsAppearance(settings, world, bindings.getTarget?.() ?? 'view2d');
    showIncompatibilities(resolved); showLimitations(resolved);
    const customized = appearanceCustomized(settings, world);
    for (const select of [presetSelect, ...(bindings.getStyleSelectors?.() ?? [])]) markStyleCustomized(select, customized);
    const traits = styleTraits(style);
    fantasy.hidden = !traits.fantasy;
    forest.hidden = !resolved.composition.vegetation.procedural;
    const capabilities = worldCapabilities(world);
    const waterEngine = capabilities.vectorWater ? 'vector' : capabilities.hydrology ? 'rust'
      : world ? 'none' : settings.terrain?.hydrology?.engine ?? 'rust';
    for (const option of Array.from(diagnostic.options)) option.disabled = !diagnosticAvailable(option.value, waterEngine);
    unavailable.hidden = diagnosticAvailable(a.diagnostic ?? 'none', waterEngine);
    const shown = a.diagnostic ?? 'none', resource = isResourceDiagnostic(shown);
    potentialField.hidden = shown !== 'res-potential';
    legend.hidden = !resource;
    if (resource) text(legend, RESOURCE_LEGENDS[shown], legendFr[shown]);
  }
  sync(); return { sync, dispose: () => { unlistenQuality(); unlistenEngine(); qualityToast?.remove(); forms.forEach(form => form.dispose()); panel.dispose(); } };
}
