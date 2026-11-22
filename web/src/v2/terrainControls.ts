import { isCompactProcedural } from '../../../rust/bridge/terrainGenerationRecipe';
import { openMethodNote } from '../ui/methodNotes';
import type { V2Settings } from './contracts';
import { adaptedExtent } from './settings';
import { heightmapPixels, setHeightmapDefinition } from './heightmapModel';
import { canUseTracedCoast, effectiveTerrainSettings, terrainReliefAvailable } from './terrainSettings';
import { displayClimateOverride } from './displayBiome';
import { climateZoneOf } from '../../../rust/bridge/terrainClimate';
import { isUnderdarkBiome } from '../gen/biomes';
import type { World } from '../gen/types';
import { coastTraceMode } from './coastTrace';
import { bindTree, onLanguageChange, registerMessages, setText, setDynamicText, translate, numberLocale } from './i18n';
import { mountParameterForm, readSettingPath, writeSettingPath, type ParameterField, type ParameterForm } from './parameterForm';
import {
  terrainCopy as copy,
  terrainControlMessages,
  terrainSourceFields,
  terrainBasicFields,
  terrainProceduralFields,
  terrainClimateFields,
  terrainNeuralFields,
  terrainModelFields,
  terrainErosionFields,
  terrainRefinementFields,
  terrainClassicFields,
  terrainHydrologyFields,
  terrainRustHydrologyFields,
  terrainVectorHydrologyFields,
  terrainForestFields,
  coastDirections,
  toggleCoastDirection,
  climateZoneBiome,
  terrainCoastFields,
} from './terrainControlSchema';
import './terrainControls.css';
import { applyRuntimePath, normalizeRuntime } from './runtimeChoices';
import { runtimeOptions } from './platform';
import { mountTerrainSketchControls, type TerrainSketchContext, type ReliefEditorKind } from './terrainSketchControls';
import { UNDERDARK_CULTURES } from './underdarkCultures';
import { loadTerrainControlDefaults } from './terrainControlDefaults';
import { physicalPlan, physicalPlanSummary, sourceDefinition, terrainCapability } from '../../../rust/bridge/terrainDefinition';
import { isTerrainExpertControl } from './terrainControlAccess';
import { getDistanceUnit, onUnitsChange, unitFactor, formatDistance, convertUnits, displayUnit, unitInputNumber, type PhysicalUnit } from './units';

export interface TerrainControlBindings {
  getSettings(): V2Settings;
  onChange(): void;
  /** A display-only change (the display biome): repaint the kept map. */
  onAppearance?(): void;
  disabled?: () => boolean;
  context?: TerrainSketchContext;
}
export interface TerrainControls {
  sync(): void;
  dispose(): void;
  openEditor(kind?: ReliefEditorKind): void;
  sketchHost: HTMLElement;
  /** The same value model as the mounted forms (defaults, climate and preset side effects), for staged forms. */
  access: { get(path: string): unknown; set(path: string, value: unknown): void };
}

const ui = {
  width: copy('Map width', 'Largeur de la carte'),
  imageResolution: copy('Image resolution: {resolution} {unit} per pixel', 'Résolution de l’image : {resolution} {unit} par pixel'),
  imagePixels: copy('The image has {pixels} × {pixels} pixels: its size and its resolution go together.', 'L’image a {pixels} × {pixels} pixels : sa taille et sa résolution sont liées.'),
  extentHelp: copy('Square map. Choose its physical width and generation spacing. Changing spacing can change drainage for the same seed.', 'Carte carrée. Choisissez sa largeur physique et son pas de génération. Changer le pas peut modifier le drainage pour une même graine.'),
  unit: copy('Map distance unit', 'Unité de distance de la carte'),
  coasts: copy('Sea directions', 'Directions de la mer'),
  coastHelp: copy('Combine directions freely. All eight surround the map with sea.', 'Combinez les directions. Les huit entourent la carte de mer.'),
  traceCoast: copy('Trace coastline…', 'Tracer le littoral…'),
  editTrace: copy('Edit traced coastline', 'Modifier le littoral tracé'),
  clearTrace: copy('Remove traced coastline', 'Supprimer le littoral tracé'),
  traceHint: copy('The traced coastline combines with the selected sea directions.', 'Le littoral tracé se combine aux directions de mer sélectionnées.'),
  traceUnused: copy('The traced coastline is not used with this source.', 'Le littoral tracé n’est pas utilisé avec cette source.'),
  traced: copy('Traced', 'Tracé'),
  none: copy('Inland', 'Intérieur des terres'),
  island: copy('Island', 'Île'),
  archipelago: copy('Archipelago', 'Archipel'),
  peninsula: copy('Peninsula', 'Presqu’île'),
  quick: copy('Create the terrain', 'Créer le terrain'),
  coastline: copy('Coasts', 'Côtes'),
  vector: copy('Vector', 'Vectoriel'),
  rust: copy('Rust', 'Rust'),
  basics: copy('Relief and climate', 'Relief et climat'),
  procedural: copy('Procedural terrain', 'Relief procédural'),
  climate: copy('Detailed climate', 'Climat détaillé'),
  neural: copy('Neural generation', 'Génération neuronale'),
  models: copy('Models and local services', 'Modèles et services locaux'),
  erosion: copy('Detailed erosion', 'Érosion détaillée'),
  expertErosion: copy('Expert settings', 'Paramètres experts'),
  refinement: copy('Fractal refinement', 'Raffinement fractal'),
  hydrology: copy('Hydrology', 'Hydrologie'),
  rustWater: copy('Rust hydrology parameters', 'Paramètres hydrologiques Rust'),
  vectorWater: copy('Vector hydrology parameters', 'Paramètres hydrologiques vectoriels'),
  forest: copy('Forest and clearings', 'Forêts et clairières'),
  erosionHelp: copy('Empty fields use the selected relief’s defaults. Every override is saved with the recipe.', 'Les champs vides utilisent les valeurs du relief choisi. Chaque modification est conservée dans la recette.'),
  reset: copy('Restore relief defaults', 'Restaurer les valeurs du relief'),
  resetDetail: copy('Restore fractal defaults', 'Restaurer les valeurs fractales'),
  zero: copy('Zero histogram', 'Histogramme à zéro'),
  hero: copy('Upstream histogram example', 'Exemple d’histogramme du projet source'),
  neuralNote: copy(
    'Neural supports plain, hills, valley, mountains, mixed, plateau and high mountains. Other families require procedural generation.',
    'Le neuronal accepte plaine, collines, vallée, montagnes, mixte, plateau et hautes montagnes. Les autres familles demandent le procédural.',
  ),
  browserModels: copy(
    'The browser uses coarse4 / nf4_b75 / decoder64. The Rust neural service uses models loaded at startup. These model choices apply to Python / PyTorch.',
    'Le navigateur utilise coarse4 / nf4_b75 / decoder64. Le service Rust neuronal utilise les modèles chargés au démarrage. Ces choix de modèles concernent Python / PyTorch.',
  ),
  sourceHelp: copy('Imported heightmaps and painted regions', 'Heightmaps importées et régions peintes'),
  import: copy('Import a heightmap', 'Importer une heightmap'),
  paint: copy('Paint terrain regions', 'Peindre les régions du relief'),
  classicNote: copy(
    'The classic CPU engine supports 600 m–40 km and its original terrain parameters. Rust settings are retained while inactive. Choose Rust for detailed terrain controls.',
    'Le moteur CPU classique accepte 600 m–40 km et ses paramètres de relief d’origine. Les réglages Rust sont conservés en attente. Choisissez Rust pour les paramètres détaillés.',
  ),
  classic: copy('Classic CPU terrain settings', 'Réglages du relief CPU classique'),
  compute: copy('Compute and engines', 'Calcul et moteurs'),
  biome: copy('Biome', 'Biome'),
  importedNote: copy(
    'An imported heightmap supplies the elevations. Saved neural-model settings apply again when automatic terrain or painted zones are selected below. Erode mode exposes the erosion controls.',
    'Une heightmap importée fournit les altitudes. Les réglages neuronaux conservés seront réactivés en choisissant le relief automatique ou les zones peintes ci-dessous. Le mode Éroder donne accès aux réglages d’érosion.',
  ),
};
for (const [en, fr] of [
  ['Inherited default', 'Valeur héritée'],
  ['Enabled', 'Activé'],
  ['Disabled', 'Désactivé'],
] as const)
  copy(en, fr);
const seaNames: Record<(typeof coastDirections)[number], [string, string]> = {
  N: ['North coast', 'Côte nord'],
  NE: ['Northeast coast', 'Côte nord-est'],
  E: ['East coast', 'Côte est'],
  SE: ['Southeast coast', 'Côte sud-est'],
  S: ['South coast', 'Côte sud'],
  SW: ['Southwest coast', 'Côte sud-ouest'],
  W: ['West coast', 'Côte ouest'],
  NW: ['Northwest coast', 'Côte nord-ouest'],
};
for (const pair of Object.values(seaNames)) copy(...pair);

/** The biome the relief was generated for (the recipe): Underdark stays a biome; the stored climate remains a surface zone. */
export function terrainGenerationClimateChoice(settings: V2Settings): string {
  if (settings.options.biome === 'underdark') return 'underdark';
  if (settings.terrain?.climateValues) return 'custom';
  return effectiveTerrainSettings(settings, adaptedExtent(settings)).climateZone!;
}
/** UI choice: the display biome when one repaints the kept relief, else the generation biome. */
export function terrainClimateChoice(settings: V2Settings): string {
  return displayClimateOverride(settings) ?? terrainGenerationClimateChoice(settings);
}
/** With a surface map on screen, a surface zone only repaints it (`appearance.biome`); the relief is kept. Returns false
 * when the choice must change the generation biome instead (no map yet, Underdark, custom climate). */
export function chooseDisplayBiome(settings: V2Settings, world: World | undefined, value: string): boolean {
  const zone = climateZoneOf(value);
  if (!world || !zone || value !== zone || isUnderdarkBiome(world.options.biome) || isUnderdarkBiome(String(settings.options.biome))) return false;
  settings.appearance ??= { style: settings.options.style };
  if (zone === terrainGenerationClimateChoice(settings)) delete settings.appearance.biome;
  else settings.appearance.biome = zone;
  return true;
}
/** The display biome becomes the generation biome (the next relief run uses it). Returns whether the recipe changed. */
export function applyDisplayBiome(settings: V2Settings): boolean {
  const zone = displayClimateOverride(settings);
  if (!zone) return false;
  setTerrainClimateChoice(settings, zone);
  return true;
}
export function setTerrainClimateChoice(settings: V2Settings, value: string): void {
  const effective = effectiveTerrainSettings(settings, adaptedExtent(settings));
  // A generation biome is painted as itself.
  if (settings.appearance) delete settings.appearance.biome;
  settings.terrain ??= {};
  if (value === 'underdark') {
    // Keep even an inferred climate when its biome becomes Underdark.
    settings.terrain.climate ??= effective.climateZone;
    settings.options.biome = 'underdark';
  } else {
    if (value === 'custom') settings.terrain.climateValues = { ...effective.climateValues! };
    else {
      writeSettingPath(settings, 'terrain.climate', value);
      delete settings.terrain.climateValues;
    }
    settings.options.biome = (climateZoneBiome[value === 'custom' ? effective.climateZone! : value] ?? 'temperate') as typeof settings.options.biome;
  }
  // Keep an explicitly chosen culture if it fits the selected environment.
  const fits = UNDERDARK_CULTURES.includes(String(settings.options.culture));
  if (value === 'underdark' && !fits) settings.options.culture = UNDERDARK_CULTURES[0];
  else if (value !== 'underdark' && fits) settings.options.culture = 'european-organic';
}

/** Structured access to the real Terrainbench recipe; hidden groups retain their settings. */
export function mountTerrainControls(root: HTMLElement, bindings: TerrainControlBindings): TerrainControls {
  const initial = bindings.getSettings();
  normalizeRuntime(initial);
  registerMessages(terrainControlMessages);
  root.classList.add('terrain-controls');
  root.replaceChildren();
  const forms: ParameterForm[] = [],
    cleanup: (() => void)[] = [];
  let defaultValues: Awaited<ReturnType<typeof loadTerrainControlDefaults>> | undefined,
    disposed = false;
  let sketchControls: ReturnType<typeof mountTerrainSketchControls> | undefined;
  const change = () => {
    bindings.onChange();
    sync();
  };
  const get = (path: string): unknown => {
    const settings = bindings.getSettings();
    if (path === 'terrain.sampleSpacing' && heightmapPixels(settings)) return adaptedExtent(settings) / heightmapPixels(settings)!;
    if (path === 'terrain.coastMask') return settings.terrain?.coastMask ?? { none: 0, N: 1, E: 4, S: 16, W: 64, random: 255 }[settings.options.coast];
    if (path === 'terrain.islandMode') return settings.terrain?.islandMode ?? 'island';
    if (path === 'terrain.procedural.preset') return settings.terrain?.procedural?.preset ?? 'classic';
    if (path === 'terrain.procedural.enabled.phasor') return settings.terrain?.procedural?.enabled?.phasor ?? isCompactProcedural({ source: settings.runtime?.source, procedural: settings.terrain?.procedural });
    if (path === 'terrain.procedural.biome') return settings.terrain?.procedural?.biome ?? true;
    if (path === 'terrain.procedural.coastAfter') return settings.terrain?.procedural?.coastAfter ?? 'initialize';
    if (path === 'terrain.phasor.quality') return settings.terrain?.phasor?.quality ?? 'balanced';
    if (path === 'terrain.phasor.intensity') return settings.terrain?.phasor?.intensity ?? 1;
    if (path === 'terrain.climate') return terrainClimateChoice(settings);
    if (path.startsWith('terrain.')) {
      const effective = effectiveTerrainSettings(settings, adaptedExtent(settings));
      return readSettingPath(effective, path.slice(8)) ?? defaultValues?.(effective)[path];
    }
    if (path === 'runtime.source') return settings.runtime?.source ?? (settings.generation === 'neural' ? 'neural-wasm' : 'procedural');
    if (path === 'runtime.compute') return settings.runtime?.compute ?? 'auto';
    if (path === 'runtime.backend') return settings.runtime?.backend ?? 'rust';
    return readSettingPath(settings, path);
  };
  const set = (path: string, value: unknown) => {
    const settings = bindings.getSettings();
    if (path === 'terrain.coastMask' && Number(value) !== 0 && settings.terrain?.procedural?.enabled) {
      settings.terrain.procedural.enabled.coasts = true;
      settings.terrain.procedural.enabled.coastCut = true;
    }
    if (path.startsWith('runtime.') && !settings.runtime) settings.runtime = { backend: 'rust', compute: 'auto', source: 'procedural' };
    if (path === 'terrain.sampleSpacing' && typeof value === 'number' && setHeightmapDefinition(settings, value)) {
      // Size and image definition edit the same footprint.
    } else if (path === 'terrain.climate') {
      if (chooseDisplayBiome(settings, bindings.context?.getWorld(), String(value))) {
        bindings.onChange();
        bindings.onAppearance?.();
        sync();
        return;
      }
      setTerrainClimateChoice(settings, String(value));
    } else {
      if (path.startsWith('terrain.climateValues.') && !settings.terrain?.climateValues) {
        settings.terrain ??= {};
        settings.terrain.climateValues = { ...effectiveTerrainSettings(settings, adaptedExtent(settings)).climateValues! };
      }
      if (path.startsWith('terrain.neuralTuning.histogram.') && !settings.terrain?.neuralTuning?.histogram) {
        settings.terrain ??= {};
        settings.terrain.neuralTuning ??= {};
        settings.terrain.neuralTuning.histogram = [0, 0, 0, 0, 0];
      }
      writeSettingPath(settings, path, value);
    }
    if (path === 'terrain.procedural.preset') settings.terrain!.procedural!.biome ??= true;
    applyRuntimePath(settings, path, value);
    if (path === 'terrain.baseModel' && value === 'residual8k' && settings.terrain) delete settings.terrain.sampleSpacing;
    normalizeRuntime(settings);
    change();
  };
  const form = (host: HTMLElement, fields: readonly ParameterField[]) => {
    const mounted = mountParameterForm(host, fields, { getValue: get, setValue: set, disabled: bindings.disabled });
    forms.push(mounted);
    return mounted;
  };
  // Groups are only shown inside the advanced relief view: a titled block, never a second disclosure level.
  const group = (title: string, fields: readonly ParameterField[], host: HTMLElement = root): HTMLElement => {
    const block = document.createElement('section');
    block.className = 'terrain-control-group';
    const heading = document.createElement('h4');
    heading.className = 'terrain-group-title';
    setText(heading, title);
    block.append(heading);
    const body = document.createElement('div');
    body.className = 'terrain-group-body';
    block.append(body);
    host.append(block);
    form(
      body,
      fields.filter(field => !isTerrainExpertControl(field.path)),
    );
    const expert = fields.filter(field => isTerrainExpertControl(field.path));
    if (expert.length) {
      const fine = document.createElement('div');
      fine.className = 'terrain-super-advanced';
      const label = document.createElement('h5');
      label.className = 'terrain-fine-title';
      setText(label, ui.expertErosion);
      fine.append(label);
      body.append(fine);
      form(fine, expert);
    }
    return block;
  };
  const button = (host: HTMLElement, label: string, action: () => void, id?: string): HTMLButtonElement => {
    const result = document.createElement('button');
    result.type = 'button';
    if (id) result.id = id;
    setText(result, label);
    result.addEventListener('click', action);
    cleanup.push(() => result.removeEventListener('click', action));
    host.append(result);
    return result;
  };
  const coastArt = (control: HTMLElement, kind: 'cardinal' | 'diagonal' | 'island' | 'inland' | 'archipelago' | 'peninsula', angle = 0, preset = false): void => {
    const label = control.getAttribute('data-i18n') ?? control.textContent ?? '';
    control.removeAttribute('data-i18n');
    control.classList.add(preset ? 'coast-preset' : 'coast-choice');
    const art = document.createElement('span');
    art.className = `coast-art coast-art-${kind}`;
    art.setAttribute('aria-hidden', 'true');
    art.style.setProperty('--coast-angle', `${angle}deg`);
    const caption = document.createElement('span');
    caption.className = 'coast-caption';
    setText(caption, label);
    control.replaceChildren(art, caption);
  };
  const quick = document.createElement('section');
  quick.className = 'terrain-quick';
  quick.setAttribute('aria-label', ui.quick);
  root.append(quick);
  const sourceField = terrainSourceFields.find(field => field.path === 'runtime.source')!;
  const source = document.createElement('div');
  source.className = 'terrain-entry-fields';
  const sourceHint = document.createElement('p');
  sourceHint.className = 'hint';
  setText(sourceHint, sourceField.help!);
  source.append(sourceHint);
  const classicNote = document.createElement('p');
  classicNote.className = 'hint';
  setText(classicNote, ui.classicNote);
  source.append(classicNote);
  const importedNote = document.createElement('p');
  importedNote.className = 'hint';
  setText(importedNote, ui.importedNote);
  source.append(importedNote);
  const inputActions = document.createElement('div');
  inputActions.className = 'terrain-presets';
  source.append(inputActions);
  button(
    inputActions,
    ui.import,
    () => {
      sketchHost.querySelector<HTMLInputElement>('[data-id="heightmap-file"]')?.click();
    },
    'terrain-import-heightmap',
  );
  button(
    inputActions,
    ui.paint,
    () => {
      sketchHost.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      sketchHost.querySelector<HTMLButtonElement>('[data-id="edit"]')?.click();
    },
    'terrain-paint-regions',
  );
  const extent = document.createElement('fieldset');
  extent.className = 'terrain-extent';
  const extentLegend = document.createElement('legend');
  setText(extentLegend, ui.width);
  extent.append(extentLegend);
  const sizeHelp = document.createElement('details');
  sizeHelp.id = 'terrain-size-help';
  sizeHelp.className = 'terrain-size-help';
  registerMessages({ 'About world size': { en: 'About world size', fr: 'À propos de la taille du monde' } });
  const sizeHelpToggle = document.createElement('summary');
  sizeHelpToggle.textContent = '?';
  sizeHelpToggle.setAttribute('aria-label', 'About world size');
  sizeHelp.append(sizeHelpToggle);
  extent.append(sizeHelp);
  const extentRow = document.createElement('div');
  extentRow.className = 'terrain-width-row';
  const width = document.createElement('input');
  width.type = 'number';
  width.id = 'terrain-width';
  width.dataset.settingPath = 'extent';
  width.setAttribute('aria-label', ui.width);
  width.step = '0.1';
  const unit = document.createElement('select');
  unit.id = 'terrain-width-unit';
  unit.setAttribute('aria-label', ui.unit);
  for (const value of ['km', 'm', 'ft', 'yd', 'mi']) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    option.dataset.l10nKeep = '';
    unit.append(option);
  }
  unit.value = getDistanceUnit() === 'm' ? 'km' : getDistanceUnit();
  extentRow.append(width, unit);
  extent.append(extentRow);
  const widthSlider = document.createElement('input');
  widthSlider.type = 'range';
  widthSlider.id = 'terrain-width-slider';
  widthSlider.className = 'parameter-slider';
  widthSlider.dataset.sliderPath = 'extent';
  widthSlider.setAttribute('aria-label', ui.width);
  extent.append(widthSlider);
  const extentHint = document.createElement('p');
  extentHint.id = 'terrain-width-help';
  extentHint.className = 'hint';
  setText(extentHint, ui.extentHelp);
  width.setAttribute('aria-describedby', extentHint.id);
  sizeHelp.append(extentHint);
  const definitionHint = document.createElement('p');
  definitionHint.id = 'terrain-definition-help';
  definitionHint.className = 'hint';
  definitionHint.setAttribute('role', 'status');
  sizeHelp.append(definitionHint);
  const presetRow = document.createElement('div');
  presetRow.className = 'terrain-presets';
  for (const metres of [2400, 10000, 40000, 100000, 200000]) {
    const preset = button(presetRow, formatDistance(metres, getDistanceUnit()), () => {
      bindings.getSettings().extent = metres;
      change();
    });
    preset.dataset.extent = String(metres);
    preset.dataset.l10nKeep = '';
  }
  extent.append(presetRow);
  quick.append(extent);
  const quickFields = document.createElement('div');
  quickFields.className = 'terrain-quick-fields';
  quick.append(quickFields);
  form(
    quickFields,
    [
      sourceField,
      terrainBasicFields.find(field => field.path === 'options.biome')!,
      terrainBasicFields.find(field => field.path === 'terrain.relief')!,
      terrainClassicFields.find(field => field.path === 'options.relief')!,
      terrainProceduralFields.find(field => field.path === 'terrain.motifSize')!,
    ].map(field => ({ ...field, help: field.path === 'terrain.motifSize' ? field.help : undefined })),
  );
  const scale = quickFields.querySelector<HTMLInputElement>('#terrain-scale')!;
  scale.setAttribute('title', terrainProceduralFields.find(field => field.path === 'terrain.motifSize')!.help!);
  const onWidth = () => {
    const metres = Number(width.value) * unitFactor(unit.value as PhysicalUnit);
    const settings = bindings.getSettings();
    const capability = terrainCapability({ ...effectiveTerrainSettings(settings, metres), backend: settings.runtime?.backend });
    const min = capability.minWidth,
      max = capability.maxWidth;
    if (!width.value.trim() || !Number.isFinite(metres) || metres < min || metres > max) {
      width.setAttribute('aria-invalid', 'true');
      return;
    }
    width.removeAttribute('aria-invalid');
    bindings.getSettings().extent = metres;
    change();
  };
  const onUnit = () => {
    width.value = String(adaptedExtent(bindings.getSettings()) / unitFactor(unit.value as PhysicalUnit));
    sync();
  };
  const onWidthSlide = () => {
    bindings.getSettings().extent = Number(widthSlider.value);
    width.value = String(Number(widthSlider.value) / unitFactor(unit.value as PhysicalUnit));
    change();
  };
  width.addEventListener('input', onWidth);
  unit.addEventListener('change', onUnit);
  widthSlider.addEventListener('input', onWidthSlide);
  cleanup.push(
    () => width.removeEventListener('input', onWidth),
    () => unit.removeEventListener('change', onUnit),
    () => widthSlider.removeEventListener('input', onWidthSlide),
  );
  const coasts = document.createElement('fieldset');
  coasts.className = 'terrain-coasts';
  const coastLegend = document.createElement('legend');
  setText(coastLegend, ui.coasts);
  coasts.append(coastLegend);
  const compass = document.createElement('div');
  compass.className = 'terrain-coast-compass';
  compass.setAttribute('role', 'group');
  compass.setAttribute('aria-label', ui.coasts);
  const compassButtons = new Map<string, HTMLButtonElement>();
  for (const direction of ['NW', 'N', 'NE', 'W', 'center', 'E', 'SW', 'S', 'SE'] as const) {
    // The centre is the island: sea on all eight sides (archipelago and peninsula are in the list beside it).
    if (direction === 'center') {
      const center = button(
        compass,
        ui.island,
        () => {
          const s = bindings.getSettings(),
            island = Number(get('terrain.coastMask')) === 255 && (get('terrain.islandMode') ?? 'island') === 'island';
          if (!island) writeSettingPath(s, 'terrain.islandMode', 'island');
          set('terrain.coastMask', island ? 0 : 255);
        },
        'terrain-coast-all',
      );
      center.style.gridArea = '2 / 2';
      center.setAttribute('aria-label', ui.island);
      center.setAttribute('title', ui.island);
      coastArt(center, 'island');
      compassButtons.set('all', center);
      continue;
    }
    const coast = button(compass, direction, () => set('terrain.coastMask', toggleCoastDirection(Number(get('terrain.coastMask')), direction)), `terrain-coast-${direction}`);
    const position = ['NW', 'N', 'NE', 'W', 'center', 'E', 'SW', 'S', 'SE'].indexOf(direction);
    coast.style.gridArea = `${Math.floor(position / 3) + 1} / ${(position % 3) + 1}`;
    coast.dataset.coast = direction;
    coast.dataset.settingPath = 'terrain.coastMask';
    coast.setAttribute('aria-label', seaNames[direction][0]);
    coast.setAttribute('title', seaNames[direction][0]);
    compassButtons.set(direction, coast);
    const cardinal = ['N', 'E', 'S', 'W'].indexOf(direction),
      diagonal = ['NE', 'SE', 'SW', 'NW'].indexOf(direction);
    coastArt(coast, cardinal >= 0 ? 'cardinal' : 'diagonal', (cardinal >= 0 ? cardinal : diagonal) * 90);
  }
  coasts.append(compass);
  const coastHint = document.createElement('p');
  coastHint.className = 'hint';
  setText(coastHint, ui.coastHelp);
  coasts.append(coastHint);
  const coastPresets = document.createElement('div');
  coastPresets.className = 'terrain-presets coast-presets';
  const coastChoices = new Map<string, HTMLInputElement>();
  for (const [value, label, art] of [
    ['none', ui.none, 'inland'],
    ['archipelago', ui.archipelago, 'archipelago'],
    ['peninsula', ui.peninsula, 'peninsula'],
  ] as const) {
    const choice = document.createElement('label');
    setText(choice, label);
    coastArt(choice, art, 0, true);
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'terrain-coast-layout';
    input.value = value;
    input.id = `terrain-coast-${value}`;
    choice.prepend(input);
    coastPresets.append(choice);
    coastChoices.set(value, input);
    const onChoice = () => {
      if (!input.checked) return;
      if (value !== 'none') writeSettingPath(bindings.getSettings(), 'terrain.islandMode', value);
      set('terrain.coastMask', value === 'none' ? 0 : 255);
    };
    input.addEventListener('change', onChoice);
    cleanup.push(() => input.removeEventListener('change', onChoice));
  }
  coasts.append(coastPresets);
  coasts.id = 'terrain-coast-panel';
  const traceActions = document.createElement('div');
  traceActions.className = 'terrain-coast-trace-actions heightmap-actions';
  const traceButton = button(traceActions, ui.traceCoast, () => sketchControls?.open('coast'), 'terrain-coast-trace');
  const traceClear = button(
    traceActions,
    ui.clearTrace,
    () => {
      const s = bindings.getSettings();
      if (s.terrain) delete s.terrain.coastTrace;
      change();
    },
    'terrain-coast-trace-clear',
  );
  const traceHint = document.createElement('p');
  traceHint.className = 'hint terrain-coast-trace-hint';
  setText(traceHint, ui.traceHint);
  coasts.append(traceActions, traceHint);
  const profileControls = document.createElement('div');
  profileControls.className = 'coast-profile-controls';
  coasts.insertBefore(profileControls, traceActions);
  const coastProfileForm = document.createElement('div');
  profileControls.append(coastProfileForm);
  form(
    coastProfileForm,
    terrainCoastFields.map(field => ({ ...field, helpDisplay: 'tooltip' })),
  );
  const quickOptions = document.createElement('div');
  quickOptions.className = 'terrain-quick-options';
  root.append(quickOptions);
  const option = (label: string, id: string, panel: HTMLElement, artClass: string) => {
    const control = button(
      quickOptions,
      label,
      () => {
        panel.hidden = control.getAttribute('aria-expanded') === 'true';
        control.setAttribute('aria-expanded', String(!panel.hidden));
      },
      id,
    );
    control.className = 'terrain-option';
    control.removeAttribute('data-i18n');
    control.setAttribute('aria-expanded', 'false');
    control.setAttribute('aria-controls', panel.id);
    const art = document.createElement('span');
    art.className = `terrain-option-art ${artClass}`;
    art.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.className = 'terrain-option-text';
    const caption = document.createElement('span');
    setText(caption, label);
    const badge = document.createElement('span');
    badge.className = 'terrain-option-badge';
    text.append(caption, badge);
    control.replaceChildren(art, text);
    panel.hidden = true;
    panel.setAttribute('aria-labelledby', id);
    return { control, badge };
  };
  const coastOption = option(ui.coastline, 'terrain-coast-toggle', coasts, 'coast-art coast-art-island');
  root.append(coasts);
  const waterPanel = document.createElement('div');
  waterPanel.id = 'terrain-hydrology-panel';
  waterPanel.className = 'terrain-option-panel';
  const waterOption = option(ui.hydrology, 'terrain-hydrology-toggle', waterPanel, 'art-hydrology');
  root.append(waterPanel);
  group(ui.hydrology, terrainHydrologyFields, waterPanel);
  const riverLengthInputs = Array.from(waterPanel.querySelectorAll<HTMLInputElement>('[data-setting-path="terrain.hydrology.minRiverLength"], [data-slider-path="terrain.hydrology.minRiverLength"]'));
  const rustWater = group(ui.rustWater, terrainRustHydrologyFields, waterPanel);
  const vectorWater = group(ui.vectorWater, terrainVectorHydrologyFields, waterPanel);
  group(
    ui.compute,
    terrainSourceFields.filter(field => field.path !== 'runtime.source' && (runtimeOptions().profile === 'local' || field.path !== 'runtime.backend')),
  );
  const basics = group(
    ui.basics,
    terrainBasicFields.filter(field => !['options.biome', 'terrain.relief'].includes(field.path)),
  );
  const classic = group(
    ui.classic,
    terrainClassicFields.filter(field => field.path !== 'options.relief'),
  );
  classic.querySelector('.terrain-group-body')!.prepend(classicNote);
  const inputGroup = group(ui.sourceHelp, []);
  inputGroup.querySelector('.terrain-group-body')!.append(source);
  const neuralNote = document.createElement('p');
  neuralNote.className = 'hint terrain-neural-note';
  setText(neuralNote, ui.neuralNote);
  root.append(neuralNote);
  const procedural = group(
    ui.procedural,
    terrainProceduralFields.filter(field => !['terrain.motifSize', 'terrain.sampleSpacing'].includes(field.path)),
  );
  const spacingField = { ...terrainProceduralFields.find(field => field.path === 'terrain.sampleSpacing')! };
  const spacingDefaults = { min: spacingField.min, max: spacingField.max };
  form(extent, [spacingField]);
  const imageDefinition = document.createElement('small');
  imageDefinition.className = 'parameter-help';
  const spacingRow = extent.querySelector<HTMLElement>('[data-field-path="terrain.sampleSpacing"]')!;
  spacingRow.append(imageDefinition);
  const imageDefinitionText = (): string => {
    const settings = bindings.getSettings(),
      pixels = heightmapPixels(settings) ?? 1;
    const resolution = convertUnits(adaptedExtent(settings) / pixels, 'm', displayUnit('m', getDistanceUnit())).toLocaleString(numberLocale(), { maximumFractionDigits: 2 });
    return translate(ui.imageResolution).replace('{resolution}', resolution).replace('{unit}', displayUnit('m', getDistanceUnit())) + '. ' + translate(ui.imagePixels).replaceAll('{pixels}', pixels.toLocaleString(numberLocale()));
  };
  const spacingHelp = extent.querySelector<HTMLElement>('.parameter-help');
  if (spacingHelp) sizeHelp.append(spacingHelp);
  const compactHelp = button(procedural, '? · Phasor', () => openMethodNote('compact-terrain-phasor'), 'terrain-phasor-method');
  const climate = group(ui.climate, terrainClimateFields);
  const neural = group(ui.neural, terrainNeuralFields);
  const histActions = document.createElement('div');
  histActions.className = 'terrain-presets';
  neural.append(histActions);
  button(histActions, ui.zero, () => set('terrain.neuralTuning.histogram', [0, 0, 0, 0, 0]));
  button(histActions, ui.hero, () => set('terrain.neuralTuning.histogram', [0, 0, 0, 1, 1.5]));
  const models = group(
    ui.models,
    terrainModelFields.filter(field => runtimeOptions().profile === 'local' || !['runtime.localServer', 'runtime.neuralServer'].includes(field.path)),
  );
  const modelNote = document.createElement('p');
  modelNote.className = 'hint';
  setText(modelNote, ui.browserModels);
  models.append(modelNote);
  const erosion = group(ui.erosion, terrainErosionFields);
  const erosionHint = document.createElement('p');
  erosionHint.className = 'hint';
  setText(erosionHint, ui.erosionHelp);
  erosion.append(erosionHint);
  button(erosion, ui.reset, () => set('terrain.erosionTuning', {}), 'terrain-erosion-reset');
  const refinement = group(ui.refinement, terrainRefinementFields);
  button(
    refinement,
    ui.resetDetail,
    () => {
      writeSettingPath(bindings.getSettings(), 'terrain.detailNoise', undefined);
      change();
    },
    'terrain-detail-reset',
  );
  const forest = group(ui.forest, terrainForestFields);
  const sketchHost = document.createElement('div');
  sketchHost.id = 'terrain-sketch-host';
  sketchHost.setAttribute('aria-label', ui.sourceHelp);
  root.append(sketchHost);
  sketchControls = mountTerrainSketchControls(sketchHost, { ...bindings, onChange: change });
  bindTree(root);
  function sync(): void {
    const nativePixels = heightmapPixels(bindings.getSettings());
    const currentCapability = terrainCapability({ ...effectiveTerrainSettings(bindings.getSettings(), adaptedExtent(bindings.getSettings())), backend: bindings.getSettings().runtime?.backend });
    spacingField.min = nativePixels ? currentCapability.minWidth / nativePixels : spacingDefaults.min;
    spacingField.max = nativePixels ? currentCapability.maxWidth / nativePixels : spacingDefaults.max;
    for (const mounted of forms) mounted.sync();
    // The shared physical-unit editor resets steps to `any`; retain this knob's 10 m increment.
    for (const input of riverLengthInputs) input.step = String(convertUnits(10, 'm', displayUnit('m', getDistanceUnit())));
    sketchControls?.sync();
    const settings = bindings.getSettings();
    // Historical recipes may still recommend an extent. Freeze it when opened in the editor.
    if (settings.extent === 'auto') settings.extent = adaptedExtent(settings);
    const metres = adaptedExtent(settings),
      factor = unitFactor(unit.value as PhysicalUnit);
    const isClassicEngine = settings.runtime?.backend === 'typescript';
    coastProfileForm.hidden = isClassicEngine;
    const effective = effectiveTerrainSettings(settings, metres);
    const capability = terrainCapability({ ...effective, backend: settings.runtime?.backend });
    const min = capability.minWidth,
      max = capability.maxWidth;
    width.min = String(min / factor);
    width.max = String(max / factor);
    width.step = 'any';
    widthSlider.min = String(min);
    widthSlider.max = String(max);
    widthSlider.step = '100';
    widthSlider.disabled = bindings.disabled?.() ?? false;
    if (document.activeElement !== widthSlider) widthSlider.value = String(metres);
    if (document.activeElement !== width) width.value = String(unitInputNumber(metres / factor));
    width.disabled = unit.disabled = bindings.disabled?.() ?? false;
    if (metres < min || metres > max) width.setAttribute('aria-invalid', 'true');
    else width.removeAttribute('aria-invalid');
    for (const preset of Array.from(presetRow.querySelectorAll<HTMLButtonElement>('button'))) preset.disabled = Number(preset.dataset.extent) < min || Number(preset.dataset.extent) > max || (bindings.disabled?.() ?? false);
    const spacingControl = root.querySelector<HTMLInputElement>('[data-setting-path="terrain.sampleSpacing"]');
    if (spacingControl) {
      spacingControl.min = String(convertUnits(nativePixels ? min / nativePixels : capability.minSpacing, 'm', displayUnit('m', getDistanceUnit())));
      spacingControl.max = String(convertUnits(nativePixels ? max / nativePixels : Math.min(1000, metres / 16), 'm', displayUnit('m', getDistanceUnit())));
      spacingControl.step = 'any';
      spacingControl.disabled = (!nativePixels && (isClassicEngine || capability.kind === 'finite-neural')) || (bindings.disabled?.() ?? false);
    }
    imageDefinition.hidden = !nativePixels;
    sizeHelp.hidden = !!nativePixels;
    spacingHelp?.toggleAttribute('hidden', !!nativePixels);
    const spacingSlider = spacingRow.querySelector<HTMLInputElement>('[data-slider-path="terrain.sampleSpacing"]');
    if (spacingSlider) {
      spacingSlider.hidden = !!nativePixels;
      spacingSlider.disabled = !!nativePixels || !!spacingControl?.disabled;
    }
    if (nativePixels) setDynamicText(imageDefinition, imageDefinitionText);
    try {
      const french = document.documentElement.lang.startsWith('fr');
      if (nativePixels) {
        definitionHint.textContent = '';
        spacingControl?.removeAttribute('aria-invalid');
      } else if (isClassicEngine) definitionHint.textContent = french ? 'Source TypeScript classique · définition propre au moteur.' : 'Classic TypeScript source · engine-defined spacing.';
      else {
        const definition = sourceDefinition(effective);
        const runtime = settings.runtime;
        const plan = physicalPlan({
          definition,
          motifSize: effective.motifSize,
          surfaceN: effective.procedural?.surfaceN,
          compact: isCompactProcedural(effective),
          hydrology: effective.hydrology?.enabled ? effective.hydrology : undefined,
          compute: runtime?.compute === 'cpu' ? 'wasm' : effective.compute,
          generationCompute: effective.generationCompute ?? (runtime?.backend === 'native' ? 'native' : runtime?.compute === 'gpu' ? 'gpu-erosion' : undefined),
        });
        definitionHint.textContent = `${physicalPlanSummary(plan, french)} · ${Math.ceil(definition.sourceBytes / 1048576)} ${french ? 'Mio d’altitudes' : 'MiB heights'} · ≈ ${Math.ceil(definition.estimatedWorkingBytes / 1048576)} ${french ? 'Mio de rasters de travail (hors modèles)' : 'MiB working rasters (excluding models)'}`;
        if (definition.nativeSpacing) definitionHint.textContent += ` · ${french ? 'source native' : 'native source'} ${definition.nativeSpacing.toFixed(2)} m`;
        if (definition.kind === 'neural')
          definitionHint.textContent += french ? ' · conditionnement régional à 7,68 km ; le modèle calcule toujours à 30 m, même pour une sortie moins dense' : ' · regional conditioning at 7.68 km; the model always computes at 30 m, including for coarser output';
      }
      spacingControl?.removeAttribute('aria-invalid');
    } catch (error) {
      setText(definitionHint, error instanceof Error ? error.message : String(error));
      spacingControl?.setAttribute('aria-invalid', 'true');
    }
    const hasTrace = !!settings.terrain?.coastTrace;
    const importedSurface = !!(settings.terrain?.sketch?.processing || settings.options.importedHeight);
    const isNeural = !['procedural', 'procedural-phasor'].includes(String(get('runtime.source'))) && !importedSurface,
      isClassic = get('runtime.backend') === 'typescript';
    const traceActive = canUseTracedCoast(settings) && !!settings.terrain?.coastTrace && !!coastTraceMode(settings.terrain.coastTrace);
    const symbolic = !!settings.terrain?.zones || coasts.dataset.reliefSource === 'symbolic';
    const compassMask = settings.terrain?.coastMask ?? { none: 0, N: 1, E: 4, S: 16, W: 64, random: 255 }[settings.options.coast];
    const compassMode = settings.terrain?.islandMode ?? 'island';
    coastPresets.hidden = importedSurface || symbolic;
    compassButtons.get('all')!.hidden = importedSurface || symbolic;
    for (const [direction, coast] of compassButtons) {
      coast.setAttribute('aria-pressed', String(direction === 'all' ? compassMask === 255 && compassMode === 'island' : !!(compassMask & (1 << coastDirections.indexOf(direction as (typeof coastDirections)[number])))));
      coast.disabled = bindings.disabled?.() ?? false;
    }
    for (const [value, input] of coastChoices) {
      input.checked = value === 'none' ? compassMask === 0 : compassMask === 255 && compassMode === value;
      input.disabled = bindings.disabled?.() ?? false;
    }
    traceActions.hidden = importedSurface || isClassic || !!settings.decor;
    traceClear.hidden = !hasTrace;
    traceHint.hidden = !hasTrace;
    setText(traceHint, traceActive ? ui.traceHint : ui.traceUnused);
    traceButton.disabled = traceClear.disabled = bindings.disabled?.() ?? false;
    setText(traceButton, hasTrace ? ui.editTrace : ui.traceCoast);
    importedNote.hidden = !importedSurface || isClassic;
    classicNote.hidden = !isClassic;
    classic.hidden = !isClassic;
    for (const section of [basics, climate, refinement, forest, inputGroup]) section.hidden = isClassic;
    coastOption.control.hidden = isClassic;
    coasts.hidden = (isClassic && !hasTrace) || (!coasts.closest('.stage-chain') && coastOption.control.getAttribute('aria-expanded') !== 'true');
    waterOption.control.hidden = isClassic;
    waterPanel.hidden = isClassic || waterOption.control.getAttribute('aria-expanded') !== 'true';
    quickOptions.hidden = isClassic;
    const mask = Number(get('terrain.coastMask'));
    setText(coastOption.badge, traceActive ? ui.traced : mask === 0 ? ui.none : mask === 255 ? (get('terrain.islandMode') === 'archipelago' ? ui.archipelago : ui.island) : `${coastDirections.filter((_, index) => mask & (1 << index)).length} / 8`);
    const compact = !isNeural && get('terrain.procedural.preset') === 'compact';
    const generationCompute = root.querySelector<HTMLSelectElement>('[data-setting-path="terrain.generationCompute"]');
    if (generationCompute) for (const option of Array.from(generationCompute.options)) option.disabled = compact && !!option.value && !['cpu', 'gpu-erosion', 'native'].includes(option.value);
    procedural.hidden = isNeural || isClassic || settings.terrain?.sketch?.processing === 'surface' || (!!settings.options.importedHeight && settings.terrain?.sketch?.processing !== 'erosion');
    compactHelp.hidden = procedural.hidden;
    erosion.hidden = procedural.hidden;
    root.querySelector<HTMLElement>('[data-field-path="terrain.phasor.quality"]')!.hidden = !compact;
    root.querySelector<HTMLElement>('[data-field-path="terrain.phasor.intensity"]')!.hidden = !get('terrain.procedural.enabled.phasor');
    neural.hidden = !isNeural || isClassic;
    neuralNote.hidden = !isNeural || isClassic;
    const pythonModels = get('runtime.source') === 'neural-python';
    modelNote.hidden = pythonModels;
    for (const name of ['coarseModel', 'baseModel', 'decoderModel']) {
      const control = root.querySelector<HTMLSelectElement>(`[data-setting-path="terrain.${name}"]`);
      if (control) control.disabled = !pythonModels || (bindings.disabled?.() ?? false);
    }
    const waterEngine = get('terrain.hydrology.engine');
    setText(waterOption.badge, waterEngine === 'vector' ? ui.vector : ui.rust);
    rustWater.hidden = isClassic || waterEngine === 'vector';
    vectorWater.hidden = isClassic || waterEngine !== 'vector';
    const computePreference = root.querySelector<HTMLSelectElement>('#terrain-compute')!;
    computePreference.disabled = isClassic || (bindings.disabled?.() ?? false);
    const mode = get('terrain.neuralTuning.reliefMode');
    root.querySelector<HTMLElement>('[data-field-path="terrain.neuralTuning.reliefScale"]')!.hidden = mode !== 'scale';
    root.querySelector<HTMLElement>('[data-field-path="terrain.neuralTuning.reliefFixed"]')!.hidden = mode !== 'fixed';
    const relief = get('terrain.relief');
    root.querySelector<HTMLElement>('[data-field-path="terrain.mountainMix"]')!.hidden = symbolic || (relief !== 'mixed' && !(get('terrain.environment') === 'mixed' && ['plateau', 'volcano', 'caldera'].includes(String(relief))));
    root.querySelector<HTMLElement>('[data-field-path="terrain.environment"]')!.hidden = symbolic || !['plateau', 'volcano', 'caldera'].includes(String(relief));
    const reliefSelect = root.querySelector<HTMLSelectElement>('[data-setting-path="terrain.relief"]')!;
    reliefSelect.closest<HTMLElement>('[data-field-path]')!.hidden = symbolic || settings.terrain?.sketch?.processing === 'surface' || isClassic;
    root.querySelector<HTMLElement>('[data-field-path="options.relief"]')!.hidden = symbolic || !isClassic;
    scale.closest<HTMLElement>('[data-field-path]')!.hidden = isNeural || importedSurface || isClassic;
    root.querySelector<HTMLElement>('[data-field-path="terrain.islandMode"]')!.hidden = importedSurface || symbolic || isClassic;
    root.querySelector<HTMLElement>('[data-field-path="terrain.climate"]')!.hidden = isClassic;
    root.querySelector<HTMLElement>('[data-field-path="options.biome"]')!.hidden = !isClassic;
    const method = isNeural ? 'neural' : compact ? 'compact' : 'procedural';
    for (const option of Array.from(reliefSelect.options)) option.disabled = !terrainReliefAvailable(option.value, method);
  }
  void loadTerrainControlDefaults()
    .then(reader => {
      if (disposed) return;
      defaultValues = reader;
      sync();
      root.dispatchEvent(new Event('terrain-defaults-ready'));
    })
    .catch(error => {
      console.error('Terrain control defaults unavailable', error);
    });
  cleanup.push(
    onLanguageChange(sync),
    onUnitsChange(() => {
      unit.value = getDistanceUnit() === 'm' ? 'km' : getDistanceUnit();
      width.value = String(adaptedExtent(bindings.getSettings()) / unitFactor(unit.value as PhysicalUnit));
      presetRow.querySelectorAll<HTMLButtonElement>('[data-extent]').forEach(button => (button.textContent = formatDistance(Number(button.dataset.extent), getDistanceUnit())));
      sync();
    }),
  );
  sync();
  return {
    sync,
    openEditor: kind => sketchControls?.open(kind),
    sketchHost,
    access: { get, set },
    dispose: () => {
      disposed = true;
      cleanup.forEach(fn => fn());
      forms.forEach(form => form.dispose());
      sketchControls?.dispose();
      root.replaceChildren();
    },
  };
}
