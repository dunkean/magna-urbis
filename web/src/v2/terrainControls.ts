import { isCompactProcedural } from '../../../rust/bridge/terrainGenerationRecipe';
import { openMethodNote } from '../ui/methodNotes';
import type { V2Settings } from './contracts';
import { adaptedExtent } from './settings';
import { effectiveTerrainSettings, TERRAIN_EXTENT_MIN, TERRAIN_EXTENT_MAX } from './terrainSettings';
import { bindTree, registerMessages, setText } from './i18n';
import { mountParameterForm, readSettingPath, writeSettingPath, type ParameterField, type ParameterForm } from './parameterForm';
import {
  terrainCopy as copy, terrainControlMessages, terrainSourceFields, terrainBasicFields, terrainProceduralFields,
  terrainClimateFields, terrainNeuralFields, terrainModelFields, terrainErosionFields, terrainRefinementFields, terrainClassicFields,
  terrainHydrologyFields, terrainRustHydrologyFields, terrainVectorHydrologyFields, terrainForestFields,
  coastDirections, toggleCoastDirection, climateZoneBiome,
} from './terrainControlSchema';
import './terrainControls.css';
import { applyRuntimePath, normalizeRuntime } from './runtimeChoices';
import { mountTerrainSketchControls, type TerrainSketchContext } from './terrainSketchControls';
import { loadTerrainControlDefaults } from './terrainControlDefaults';

export interface TerrainControlBindings {
  getSettings(): V2Settings;
  onChange(): void;
  disabled?: () => boolean;
  context?: TerrainSketchContext;
}
export interface TerrainControls { sync(): void; dispose(): void; sketchHost: HTMLElement;
  /** The same value model as the mounted forms (defaults, climate and preset side effects), for staged forms. */
  access: { get(path: string): unknown; set(path: string, value: unknown): void } }

const ui = {
  width: copy('Map width', 'Largeur de la carte'),
  extentHelp: copy('Square map. Set its width here; settlements are configured later.', 'Carte carrée. Fixez sa largeur ici ; les peuplements se règlent ensuite.'),
  unit: copy('Map distance unit', 'Unité de distance de la carte'),
  coasts: copy('Sea directions', 'Directions de la mer'),
  coastHelp: copy('Combine directions freely. All eight surround the map with sea.', 'Combinez les directions. Les huit entourent la carte de mer.'),
  none: copy('Inland', 'Intérieur des terres'), island: copy('Island', 'Île'), archipelago: copy('Archipelago', 'Archipel'),
  peninsula: copy('Peninsula', 'Presqu’île'),
  all: copy('All', 'Toutes'), allCoasts: copy('All coasts', 'Toutes les côtes'),
  quick: copy('Create the terrain', 'Créer le terrain'), coastline: copy('Coasts', 'Côtes'),
  vector: copy('Vector', 'Vectoriel'), rust: copy('Rust', 'Rust'),
  basics: copy('Relief and climate', 'Relief et climat'), procedural: copy('Procedural terrain', 'Relief procédural'),
  climate: copy('Detailed climate', 'Climat détaillé'), neural: copy('Neural generation', 'Génération neuronale'),
  models: copy('Models and local services', 'Modèles et services locaux'), erosion: copy('Detailed erosion', 'Érosion détaillée'),
  refinement: copy('Fractal refinement', 'Raffinement fractal'), hydrology: copy('Hydrology', 'Hydrologie'),
  rustWater: copy('Rust hydrology parameters', 'Paramètres hydrologiques Rust'), vectorWater: copy('Vector hydrology parameters', 'Paramètres hydrologiques vectoriels'),
  forest: copy('Forest and clearings', 'Forêts et clairières'),
  erosionHelp: copy('Empty fields use the selected relief’s defaults. Every override is saved with the recipe.', 'Les champs vides utilisent les valeurs du relief choisi. Chaque modification est conservée dans la recette.'),
  reset: copy('Restore relief defaults', 'Restaurer les valeurs du relief'),
  resetDetail: copy('Restore fractal defaults', 'Restaurer les valeurs fractales'),
  zero: copy('Zero histogram', 'Histogramme à zéro'), hero: copy('Upstream histogram example', 'Exemple d’histogramme du projet source'),
  neuralNote: copy('Neural supports plain, hills, valley, mountains, mixed, plateau and high mountains. Other families require procedural generation.', 'Le neuronal accepte plaine, collines, vallée, montagnes, mixte, plateau et hautes montagnes. Les autres familles demandent le procédural.'),
  browserModels: copy('The browser uses coarse4 / nf4_b75 / decoder64. The Rust neural service uses models loaded at startup. These model choices apply to Python / PyTorch.', 'Le navigateur utilise coarse4 / nf4_b75 / decoder64. Le service Rust neuronal utilise les modèles chargés au démarrage. Ces choix de modèles concernent Python / PyTorch.'),
  sourceHelp: copy('Imported heightmaps and painted regions', 'Heightmaps importées et régions peintes'),
  import: copy('Import a heightmap', 'Importer une heightmap'), paint: copy('Paint terrain regions', 'Peindre les régions du relief'),
  classicNote: copy('The classic CPU engine supports 600 m–40 km and its original terrain parameters. Rust settings are retained while inactive. Choose Rust for detailed terrain controls.', 'Le moteur CPU classique accepte 600 m–40 km et ses paramètres de relief d’origine. Les réglages Rust sont conservés en attente. Choisissez Rust pour les paramètres détaillés.'),
  classic: copy('Classic CPU terrain settings', 'Réglages du relief CPU classique'),
  compute: copy('Compute and engines', 'Calcul et moteurs'),
  biome: copy('Biome', 'Biome'),
  importedNote: copy('An imported heightmap supplies the elevations. Saved neural-model settings apply again when automatic terrain or painted zones are selected below. Erode mode exposes the erosion controls.', 'Une heightmap importée fournit les altitudes. Les réglages neuronaux conservés seront réactivés en choisissant le relief automatique ou les zones peintes ci-dessous. Le mode Éroder donne accès aux réglages d’érosion.'),
};
for (const [en, fr] of [['Inherited default', 'Valeur héritée'], ['Enabled', 'Activé'], ['Disabled', 'Désactivé']] as const) copy(en, fr);
const seaNames: Record<typeof coastDirections[number], [string, string]> = {
  N: ['North coast', 'Côte nord'], NE: ['Northeast coast', 'Côte nord-est'], E: ['East coast', 'Côte est'], SE: ['Southeast coast', 'Côte sud-est'],
  S: ['South coast', 'Côte sud'], SW: ['Southwest coast', 'Côte sud-ouest'], W: ['West coast', 'Côte ouest'], NW: ['Northwest coast', 'Côte nord-ouest'],
};
for (const pair of Object.values(seaNames)) copy(...pair);

/** Structured access to the real Terrainbench recipe; hidden groups retain their settings. */
export function mountTerrainControls(root: HTMLElement, bindings: TerrainControlBindings): TerrainControls {
  const initial = bindings.getSettings();
  normalizeRuntime(initial);
  registerMessages(terrainControlMessages);
  root.classList.add('terrain-controls'); root.replaceChildren();
  const forms: ParameterForm[] = [], cleanup: (() => void)[] = [];
  let defaultValues: Awaited<ReturnType<typeof loadTerrainControlDefaults>> | undefined, disposed = false;
  let sketchControls: ReturnType<typeof mountTerrainSketchControls> | undefined;
  const change = () => { bindings.onChange(); sync(); };
  const get = (path: string): unknown => {
    const settings = bindings.getSettings();
    if (path==='terrain.procedural.preset')return settings.terrain?.procedural?.preset??'classic';
    if (path==='terrain.procedural.enabled.phasor')return settings.terrain?.procedural?.enabled?.phasor??isCompactProcedural({source:settings.runtime?.source,procedural:settings.terrain?.procedural});
    if (path==='terrain.procedural.biome')return settings.terrain?.procedural?.biome??true;
    if (path==='terrain.phasor.quality')return settings.terrain?.phasor?.quality??'balanced';
    if (path==='terrain.phasor.intensity')return settings.terrain?.phasor?.intensity??1;
    if (path.startsWith('terrain.')) {
      if (path === 'terrain.climate' && settings.terrain?.climateValues) return 'custom';
      const effective = effectiveTerrainSettings(settings, adaptedExtent(settings));
      if (path === 'terrain.climate') return effective.climateZone;
      return readSettingPath(effective, path.slice(8)) ?? defaultValues?.(effective)[path];
    }
    if (path === 'runtime.source') return settings.runtime?.source ?? (settings.generation === 'neural' ? 'neural-wasm' : 'procedural');
    if (path === 'runtime.compute') return settings.runtime?.compute ?? 'auto';
    if (path === 'runtime.backend') return settings.runtime?.backend ?? 'rust';
    return readSettingPath(settings, path);
  };
  const set = (path: string, value: unknown) => {
    const settings = bindings.getSettings();
    if (path === 'terrain.coastMask' && Number(value) !== 0 && settings.terrain?.procedural?.enabled?.coasts === false) settings.terrain.procedural.enabled.coasts = true;
    if (path.startsWith('runtime.') && !settings.runtime) settings.runtime = { backend: 'rust', compute: 'auto', source: 'procedural' };
    if (path === 'terrain.climate') {
      if (value === 'custom') {
        settings.terrain ??= {};
        settings.terrain.climateValues = { ...effectiveTerrainSettings(settings, adaptedExtent(settings)).climateValues! };
      } else {
        writeSettingPath(settings, path, value); delete settings.terrain!.climateValues;
        const biome = climateZoneBiome[String(value)];
        if (biome && settings.options.biome !== 'underdark' && settings.options.biome !== 'underdark-caverns') settings.options.biome = biome as typeof settings.options.biome;
      }
    } else {
      if (path.startsWith('terrain.climateValues.') && !settings.terrain?.climateValues) {
        settings.terrain ??= {}; settings.terrain.climateValues = { ...effectiveTerrainSettings(settings, adaptedExtent(settings)).climateValues! };
      }
      if (path.startsWith('terrain.neuralTuning.histogram.') && !settings.terrain?.neuralTuning?.histogram) {
        settings.terrain ??= {}; settings.terrain.neuralTuning ??= {}; settings.terrain.neuralTuning.histogram = [0, 0, 0, 0, 0];
      }
      writeSettingPath(settings, path, value);
    }
    if(path==='terrain.procedural.preset')settings.terrain!.procedural!.biome??=true;
    applyRuntimePath(settings,path,value);
    normalizeRuntime(settings);
    change();
  };
  const form = (host: HTMLElement, fields: readonly ParameterField[]) => { const mounted = mountParameterForm(host, fields, { getValue: get, setValue: set, disabled: bindings.disabled }); forms.push(mounted); return mounted; };
  const group = (title: string, fields: readonly ParameterField[], open = false, host: HTMLElement = root): HTMLDetailsElement => {
    const details = document.createElement('details'); details.className = 'terrain-control-group'; details.open = open;
    const summary = document.createElement('summary'); setText(summary, title); details.append(summary);
    const body = document.createElement('div'); body.className = 'terrain-group-body'; details.append(body); host.append(details); form(body, fields); return details;
  };
  const button = (host: HTMLElement, label: string, action: () => void, id?: string): HTMLButtonElement => {
    const result = document.createElement('button'); result.type = 'button'; if (id) result.id = id; setText(result, label);
    result.addEventListener('click', action); cleanup.push(() => result.removeEventListener('click', action)); host.append(result); return result;
  };
  const coastArt=(control:HTMLElement,kind:'cardinal'|'diagonal'|'island'|'inland'|'archipelago'|'peninsula',angle=0,preset=false):void=>{
    const label=control.getAttribute('data-i18n')??control.textContent??'';
    control.removeAttribute('data-i18n');control.classList.add(preset?'coast-preset':'coast-choice');
    const art=document.createElement('span');art.className=`coast-art coast-art-${kind}`;art.setAttribute('aria-hidden','true');art.style.setProperty('--coast-angle',`${angle}deg`);
    const caption=document.createElement('span');caption.className='coast-caption';setText(caption,label);control.replaceChildren(art,caption);
  };
  const quick = document.createElement('section'); quick.className = 'terrain-quick'; quick.setAttribute('aria-label', ui.quick); root.append(quick);
  const sourceField = terrainSourceFields.find(field => field.path === 'runtime.source')!;
  const source = document.createElement('div'); source.className = 'terrain-entry-fields';
  const sourceHint = document.createElement('p'); sourceHint.className = 'hint'; setText(sourceHint, sourceField.help!); source.append(sourceHint);
  const classicNote = document.createElement('p'); classicNote.className = 'hint'; setText(classicNote, ui.classicNote); source.append(classicNote);
  const importedNote = document.createElement('p'); importedNote.className = 'hint'; setText(importedNote, ui.importedNote); source.append(importedNote);
  const inputActions = document.createElement('div'); inputActions.className = 'terrain-presets'; source.append(inputActions);
  button(inputActions, ui.import, () => { sketchHost.querySelector<HTMLInputElement>('[data-id="file"]')?.click(); }, 'terrain-import-heightmap');
  button(inputActions, ui.paint, () => { sketchHost.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); sketchHost.querySelector<HTMLButtonElement>('[data-id="edit"]')?.click(); }, 'terrain-paint-regions');
  const extent = document.createElement('fieldset'); extent.className = 'terrain-extent';
  const extentLegend = document.createElement('legend'); setText(extentLegend, ui.width); extent.append(extentLegend);
  const extentRow = document.createElement('div'); extentRow.className = 'terrain-width-row';
  const width = document.createElement('input'); width.type = 'number'; width.id = 'terrain-width'; width.dataset.settingPath = 'extent'; width.setAttribute('aria-label', ui.width); width.step = '0.1';
  const unit = document.createElement('select'); unit.id = 'terrain-width-unit'; unit.setAttribute('aria-label', ui.unit);
  for (const value of ['km', 'm']) { const option = document.createElement('option'); option.value = value; option.textContent = value; option.dataset.l10nKeep = ''; unit.append(option); }
  extentRow.append(width, unit); extent.append(extentRow);
  const widthSlider = document.createElement('input'); widthSlider.type = 'range'; widthSlider.id = 'terrain-width-slider'; widthSlider.className = 'parameter-slider';
  widthSlider.dataset.sliderPath = 'extent'; widthSlider.setAttribute('aria-label', ui.width); extent.append(widthSlider);
  const extentHint = document.createElement('p'); extentHint.id = 'terrain-width-help'; extentHint.className = 'hint'; setText(extentHint, ui.extentHelp); width.setAttribute('aria-describedby', extentHint.id); extent.append(extentHint);
  const presetRow = document.createElement('div'); presetRow.className = 'terrain-presets';
  for (const metres of [2400, 10000, 40000, 100000]) { const preset = button(presetRow, `${metres / 1000} km`, () => { bindings.getSettings().extent = metres; change(); }); preset.dataset.extent = String(metres); preset.dataset.l10nKeep = ''; }
  extent.append(presetRow); quick.append(extent);
  const quickFields = document.createElement('div'); quickFields.className = 'terrain-quick-fields'; quick.append(quickFields);
  form(quickFields, [sourceField, terrainBasicFields.find(field => field.path === 'options.biome')!, terrainBasicFields.find(field => field.path === 'terrain.relief')!, terrainClassicFields.find(field => field.path === 'options.relief')!, terrainProceduralFields.find(field => field.path === 'terrain.motifSize')!].map(field => ({ ...field, help: undefined })));
  const scale = quickFields.querySelector<HTMLInputElement>('#terrain-scale')!;
  scale.setAttribute('title', terrainProceduralFields.find(field => field.path === 'terrain.motifSize')!.help!);
  const onWidth = () => {
    const metres = Number(width.value) * (unit.value === 'km' ? 1000 : 1);
    const classic = bindings.getSettings().runtime?.backend === 'typescript', min = classic ? 600 : TERRAIN_EXTENT_MIN, max = classic ? 40000 : TERRAIN_EXTENT_MAX;
    if (!width.value.trim() || !Number.isFinite(metres) || metres < min || metres > max) { width.setAttribute('aria-invalid', 'true'); return; }
    width.removeAttribute('aria-invalid'); bindings.getSettings().extent = metres; change();
  };
  const onUnit = () => { width.value = String(adaptedExtent(bindings.getSettings()) / (unit.value === 'km' ? 1000 : 1)); sync(); };
  const onWidthSlide = () => { bindings.getSettings().extent = Number(widthSlider.value); width.value = String(Number(widthSlider.value) / (unit.value === 'km' ? 1000 : 1)); change(); };
  width.addEventListener('input', onWidth); unit.addEventListener('change', onUnit);
  widthSlider.addEventListener('input', onWidthSlide);
  cleanup.push(() => width.removeEventListener('input', onWidth), () => unit.removeEventListener('change', onUnit), () => widthSlider.removeEventListener('input', onWidthSlide));
  const coasts = document.createElement('fieldset'); coasts.className = 'terrain-coasts';
  const coastLegend = document.createElement('legend'); setText(coastLegend, ui.coasts); coasts.append(coastLegend);
  const compass = document.createElement('div'); compass.className = 'terrain-coast-compass'; compass.setAttribute('role', 'group'); compass.setAttribute('aria-label', ui.coasts);
  const compassButtons = new Map<string, HTMLButtonElement>();
  for (const direction of ['NW', 'N', 'NE', 'W', 'center', 'E', 'SW', 'S', 'SE'] as const) {
    if (direction === 'center') { const center = button(compass, ui.all, () => { set('terrain.coastMask', Number(get('terrain.coastMask')) === 255 ? 0 : 255); }, 'terrain-coast-all'); center.setAttribute('aria-label', ui.allCoasts);center.setAttribute('title',ui.allCoasts);coastArt(center,'island'); compassButtons.set('all', center); continue; }
    const coast = button(compass, direction, () => set('terrain.coastMask', toggleCoastDirection(Number(get('terrain.coastMask')), direction)), `terrain-coast-${direction}`);
    coast.dataset.coast = direction; coast.dataset.settingPath = 'terrain.coastMask';
    coast.setAttribute('aria-label', seaNames[direction][0]); coast.setAttribute('title', seaNames[direction][0]); compassButtons.set(direction, coast);
    const cardinal=['N','E','S','W'].indexOf(direction),diagonal=['NE','SE','SW','NW'].indexOf(direction);
    coastArt(coast,cardinal>=0?'cardinal':'diagonal',(cardinal>=0?cardinal:diagonal)*90);
  }
  coasts.append(compass);
  const coastHint = document.createElement('p'); coastHint.className = 'hint'; setText(coastHint, ui.coastHelp); coasts.append(coastHint);
  const coastPresets = document.createElement('div'); coastPresets.className = 'terrain-presets coast-presets';
  const coastChoices = new Map<string, HTMLInputElement>();
  for (const [value, label, art] of [['none', ui.none, 'inland'], ['island', ui.island, 'island'], ['archipelago', ui.archipelago, 'archipelago'], ['peninsula', ui.peninsula, 'peninsula']] as const) {
    const choice = document.createElement('label'); setText(choice, label); coastArt(choice, art, 0, true);
    const input = document.createElement('input'); input.type = 'radio'; input.name = 'terrain-coast-layout'; input.value = value; input.id = `terrain-coast-${value}`;
    choice.prepend(input); coastPresets.append(choice); coastChoices.set(value, input);
    const onChoice = () => {
      if (!input.checked) return;
      if (value !== 'none') writeSettingPath(bindings.getSettings(), 'terrain.islandMode', value);
      set('terrain.coastMask', value === 'none' ? 0 : 255);
    };
    input.addEventListener('change', onChoice); cleanup.push(() => input.removeEventListener('change', onChoice));
  }
  coasts.append(coastPresets); coasts.id = 'terrain-coast-panel';
  const quickOptions = document.createElement('div'); quickOptions.className = 'terrain-quick-options'; root.append(quickOptions);
  const option = (label: string, id: string, panel: HTMLElement, artClass: string) => {
    const control = button(quickOptions, label, () => { panel.hidden = control.getAttribute('aria-expanded') === 'true'; control.setAttribute('aria-expanded', String(!panel.hidden)); }, id);
    control.className = 'terrain-option'; control.removeAttribute('data-i18n');
    control.setAttribute('aria-expanded', 'false'); control.setAttribute('aria-controls', panel.id);
    const art = document.createElement('span'); art.className = `terrain-option-art ${artClass}`; art.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span'); text.className = 'terrain-option-text';
    const caption = document.createElement('span'); setText(caption, label);
    const badge = document.createElement('span'); badge.className = 'terrain-option-badge'; text.append(caption, badge);
    control.replaceChildren(art, text); panel.hidden = true; panel.setAttribute('aria-labelledby', id);
    return { control, badge };
  };
  const coastOption = option(ui.coastline, 'terrain-coast-toggle', coasts, 'coast-art coast-art-island'); root.append(coasts);
  const waterPanel = document.createElement('div'); waterPanel.id = 'terrain-hydrology-panel'; waterPanel.className = 'terrain-option-panel';
  const waterOption = option(ui.hydrology, 'terrain-hydrology-toggle', waterPanel, 'art-hydrology'); root.append(waterPanel);
  group(ui.hydrology, terrainHydrologyFields, true, waterPanel);
  const rustWater = group(ui.rustWater, terrainRustHydrologyFields, true, waterPanel);
  const vectorWater = group(ui.vectorWater, terrainVectorHydrologyFields, true, waterPanel);
  group(ui.compute, terrainSourceFields.filter(field => field.path !== 'runtime.source'));
  const basics = group(ui.basics, terrainBasicFields.filter(field => !['options.biome', 'terrain.relief'].includes(field.path)));
  const classic = group(ui.classic, terrainClassicFields.filter(field => field.path !== 'options.relief'));
  classic.querySelector('.terrain-group-body')!.prepend(classicNote);
  const inputGroup = group(ui.sourceHelp, []); inputGroup.querySelector('.terrain-group-body')!.append(source);
  const neuralNote = document.createElement('p'); neuralNote.className = 'hint terrain-neural-note'; setText(neuralNote, ui.neuralNote); root.append(neuralNote);
  const procedural = group(ui.procedural, terrainProceduralFields.filter(field => field.path !== 'terrain.motifSize'));
  const compactHelp = button(procedural, '? · Phasor', () => openMethodNote('compact-terrain-phasor'), 'terrain-phasor-method');
  const climate = group(ui.climate, terrainClimateFields);
  const neural = group(ui.neural, terrainNeuralFields);
  const histActions = document.createElement('div'); histActions.className = 'terrain-presets'; neural.append(histActions);
  button(histActions, ui.zero, () => set('terrain.neuralTuning.histogram', [0, 0, 0, 0, 0]));
  button(histActions, ui.hero, () => set('terrain.neuralTuning.histogram', [0, 0, 0, 1, 1.5]));
  const models = group(ui.models, terrainModelFields);
  const modelNote = document.createElement('p'); modelNote.className = 'hint'; setText(modelNote, ui.browserModels); models.append(modelNote);
  const erosion = group(ui.erosion, terrainErosionFields);
  const erosionHint = document.createElement('p'); erosionHint.className = 'hint'; setText(erosionHint, ui.erosionHelp); erosion.append(erosionHint);
  button(erosion, ui.reset, () => set('terrain.erosionTuning', {}), 'terrain-erosion-reset');
  const refinement = group(ui.refinement, terrainRefinementFields);
  button(refinement, ui.resetDetail, () => { writeSettingPath(bindings.getSettings(), 'terrain.detailNoise', undefined); change(); }, 'terrain-detail-reset');
  const forest = group(ui.forest, terrainForestFields);
  const sketchHost = document.createElement('div'); sketchHost.id = 'terrain-sketch-host'; sketchHost.setAttribute('aria-label', ui.sourceHelp); root.append(sketchHost);
  sketchControls = mountTerrainSketchControls(sketchHost, { ...bindings, onChange: change });
  bindTree(root);
  function sync(): void {
    for (const mounted of forms) mounted.sync();
    sketchControls?.sync();
    const settings = bindings.getSettings();
    // Historical recipes may still recommend an extent. Freeze it when opened in the editor.
    if (settings.extent === 'auto') settings.extent = adaptedExtent(settings);
    const metres = adaptedExtent(settings), factor = unit.value === 'km' ? 1000 : 1;
    const isClassicEngine = settings.runtime?.backend === 'typescript', min = isClassicEngine ? 600 : TERRAIN_EXTENT_MIN, max = isClassicEngine ? 40000 : TERRAIN_EXTENT_MAX;
    width.min = String(min / factor); width.max = String(max / factor); width.step = unit.value === 'km' ? '.1' : '100';
    widthSlider.min = String(min); widthSlider.max = String(max); widthSlider.step = '100'; widthSlider.disabled = bindings.disabled?.() ?? false;
    if (document.activeElement !== widthSlider) widthSlider.value = String(metres);
    if (document.activeElement !== width) width.value = String(metres / factor);
    width.disabled = unit.disabled = bindings.disabled?.() ?? false;
    if (metres < min || metres > max) width.setAttribute('aria-invalid', 'true'); else width.removeAttribute('aria-invalid');
    for (const preset of Array.from(presetRow.querySelectorAll<HTMLButtonElement>('button'))) preset.disabled = Number(preset.dataset.extent) > max || (bindings.disabled?.() ?? false);
    for (const [direction, coast] of compassButtons) { const mask = Number(get('terrain.coastMask')); coast.setAttribute('aria-pressed', String(direction === 'all' ? mask === 255 : !!(mask & 1 << coastDirections.indexOf(direction as typeof coastDirections[number])))); coast.disabled = bindings.disabled?.() ?? false; }
    for (const [value, input] of coastChoices) {
      const mask = Number(get('terrain.coastMask'));
      input.checked = value === 'none' ? mask === 0 : mask === 255 && get('terrain.islandMode') === value;
      input.disabled = bindings.disabled?.() ?? false;
    }
    const importedSurface = !!settings.terrain?.sketch?.processing;
    const isNeural = !['procedural', 'procedural-phasor'].includes(String(get('runtime.source'))) && !importedSurface, isClassic = get('runtime.backend') === 'typescript';
    importedNote.hidden = !importedSurface || isClassic;
    classicNote.hidden = !isClassic; classic.hidden = !isClassic;
    for (const section of [basics, climate, refinement, forest, inputGroup, sketchHost]) section.hidden = isClassic;
    coastOption.control.hidden = isClassic || importedSurface;
    coasts.hidden = coastOption.control.hidden || coastOption.control.getAttribute('aria-expanded') !== 'true';
    waterOption.control.hidden = isClassic;
    waterPanel.hidden = isClassic || waterOption.control.getAttribute('aria-expanded') !== 'true';
    quickOptions.hidden = isClassic;
    const mask = Number(get('terrain.coastMask'));
    setText(coastOption.badge, mask === 0 ? ui.none : mask === 255 ? get('terrain.islandMode') === 'archipelago' ? ui.archipelago : ui.island : `${coastDirections.filter((_, index) => mask & 1 << index).length} / 8`);
    const compact = !isNeural && get('terrain.procedural.preset') === 'compact';
    const generationCompute = root.querySelector<HTMLSelectElement>('[data-setting-path="terrain.generationCompute"]');
    if (generationCompute) for (const option of Array.from(generationCompute.options)) option.disabled = compact && !!option.value && !['cpu','gpu-erosion','native'].includes(option.value);
    procedural.hidden = isNeural || isClassic || settings.terrain?.sketch?.processing === 'surface';
    compactHelp.hidden = procedural.hidden;
    erosion.hidden = procedural.hidden;
    root.querySelector<HTMLElement>('[data-field-path="terrain.phasor.quality"]')!.hidden = !compact;
    root.querySelector<HTMLElement>('[data-field-path="terrain.phasor.intensity"]')!.hidden = !get('terrain.procedural.enabled.phasor');
    neural.hidden = !isNeural || isClassic; neuralNote.hidden = !isNeural || isClassic;
    const pythonModels = get('runtime.source') === 'neural-python'; modelNote.hidden = pythonModels;
    for (const name of ['coarseModel', 'baseModel', 'decoderModel']) { const control = root.querySelector<HTMLSelectElement>(`[data-setting-path="terrain.${name}"]`); if (control) control.disabled = !pythonModels || (bindings.disabled?.() ?? false); }
    const waterEngine = get('terrain.hydrology.engine'); setText(waterOption.badge, waterEngine === 'vector' ? ui.vector : ui.rust);
    rustWater.hidden = isClassic || waterEngine === 'vector'; vectorWater.hidden = isClassic || waterEngine !== 'vector';
    const computePreference = root.querySelector<HTMLSelectElement>('#terrain-compute')!; computePreference.disabled = isClassic || (bindings.disabled?.() ?? false);
    const mode = get('terrain.neuralTuning.reliefMode');
    root.querySelector<HTMLElement>('[data-field-path="terrain.neuralTuning.reliefScale"]')!.hidden = mode !== 'scale';
    root.querySelector<HTMLElement>('[data-field-path="terrain.neuralTuning.reliefFixed"]')!.hidden = mode !== 'fixed';
    root.querySelector<HTMLElement>('[data-field-path="terrain.neuralSlopes"]')!.hidden = get('terrain.neuralFit') !== 'scale';
    const relief = get('terrain.relief');
    root.querySelector<HTMLElement>('[data-field-path="terrain.mountainMix"]')!.hidden = relief !== 'mixed' && !(get('terrain.environment') === 'mixed' && ['plateau', 'volcano', 'caldera'].includes(String(relief)));
    root.querySelector<HTMLElement>('[data-field-path="terrain.environment"]')!.hidden = !['plateau', 'volcano', 'caldera'].includes(String(relief));
    const reliefSelect = root.querySelector<HTMLSelectElement>('[data-setting-path="terrain.relief"]')!;
    reliefSelect.closest<HTMLElement>('[data-field-path]')!.hidden = settings.terrain?.sketch?.processing === 'surface' || isClassic;
    root.querySelector<HTMLElement>('[data-field-path="options.relief"]')!.hidden = !isClassic;
    scale.closest<HTMLElement>('[data-field-path]')!.hidden = isNeural || importedSurface || isClassic;
    root.querySelector<HTMLElement>('[data-field-path="terrain.islandMode"]')!.hidden = importedSurface || isClassic;
    root.querySelector<HTMLElement>('[data-field-path="terrain.climate"]')!.hidden = isClassic;
    root.querySelector<HTMLElement>('[data-field-path="options.biome"]')!.hidden = !isClassic && settings.options.biome !== 'underdark' && settings.options.biome !== 'underdark-caverns';
    for (const option of Array.from(reliefSelect.options)) option.disabled = isNeural && !['flat', 'hills', 'valley', 'mountains', 'mixed', 'plateau', 'high-mountains'].includes(option.value) || compact && !['flat','hills','valley','canyon','mountains','mixed','high-mountains'].includes(option.value);
  }
  void loadTerrainControlDefaults().then(reader => { if (disposed) return; defaultValues = reader; sync(); root.dispatchEvent(new Event('terrain-defaults-ready')); }).catch(error => { console.error('Terrain control defaults unavailable', error); });
  sync();
  return { sync, sketchHost, access: { get, set }, dispose: () => { disposed = true; cleanup.forEach(fn => fn()); forms.forEach(form => form.dispose()); sketchControls?.dispose(); root.replaceChildren(); } };
}
