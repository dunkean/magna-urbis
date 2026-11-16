import { setHTML, insertHTML, setText, setUserText, setDynamicText, bindTree, translate, getLanguage, setLanguage, onLanguageChange, initializeLanguage, numberLocale, nameHTML, numberHTML, registerMessages, LANGUAGES, type Language } from './i18n';
import { getDistanceUnit, setDistanceUnit, onUnitsChange, formatDistance, unitFactor, type DistanceUnit } from './units';
import { mapPresentation, settlementDisplayName, featureDisplayName } from './mapPresentation';
import './ui.css';
import './editing.css';
import './workbench.css';
import { mountWorkbenchLayout, groupCultureSelector } from './workbenchLayout';
import { organizeInspector } from './advancedPanel';
import { runRemainingGeneration } from './fullGeneration';
import { activitySitesOf } from './activitySites';
import { demographicClass, DEMOGRAPHIC_CLASSES } from '../../../rust/bridge/settlementDemography';
import { mountSceneControls } from './sceneControls';
import { mountRoadDisplayControl } from './roadDisplayControl';
import { applySceneClock, DEFAULT_SCENE } from './sceneClock';
import { mountEditingTools } from './editingTools';
import logo from '../ui/assets/logo-magna-urbis.png';
import { CULTURE_LABELS, SITE_ARCHETYPES, type Options } from '../gen/options';
import { STYLE_LIST, type MapStyle } from '../render/styles';
import { mountRenderControls, currentComposition, writeAppearanceControl, PRESET_OPTIONS } from './renderControls';
import { showBrowserAdvice } from '../ui/browserAdvice';
import { ruralSemanticLegend } from '../render/semanticLayer';
import { resolveSettingsAppearance, resolvedDisplayOptions } from './appearance';
import { applyAppearancePatch } from '../render/appearanceRecipe';
import { nativeCityRecords } from './nativeProducts';
import { cityReachedPopulation, populationText, populationShortfallText } from '../render/cityPopulation';
import type { World, UrbanBuilding } from '../gen/types';
import { screenToWorld } from '../render/view';
import { EXPORT_LAYER_NAMES, type ExportLayers } from '../render/exportLayers';
import { chooseExportArea, chooseExportCrop } from '../ui/exportCrop';
import { canvasPng, cropCanvasPng } from '../ui/canvasExport';
import { supportsSvgExport } from './exportOptions';
import { exportPng } from '../ui/pngExport';
import { readHeightmap } from '../ui/heightmap';
import { StudioClient, type Action } from './client';
import { defaultSettings, adaptedExtent } from './settings';
import { validateSettings } from './project';
import type { V2Settings, V2Progress, V2TownStage } from './contracts';
import { type QuarterOverride, type BlockOverride, type ParcelOverride } from '../../../rust/bridge/urbanConfig';
import { houseControlDefaults, urbanField } from './urbanControlSchema';
import { mountParameterForm } from './parameterForm';
import { compatibleBuildingTypes, polygonArea } from './urbanEditOptions';
import { blockEditId } from '../../../rust/bridge/urbanBlockEdits';
import { pointInRing } from '../gen/geo/poly';
import { runtimeOptions, loopbackServer } from './platform';
import { applyBuildingEdits, buildingAt, nearestSettlement, townUrban, buildingSignature, validateBuildingPatch, type BuildingEdit } from './edits';
import ExportWorker from './export.worker?worker';
import ProjectWorker from './project.worker?worker';
import { isBinaryProject, MAX_BINARY_PROJECT_BYTES } from './projectBinary';
import { projectFileMessages } from './projectFileMessages';
import { resultTransferBuffers } from './transfer';
import ComposeWorker from './compose.worker?worker';
import type { RustTownSnapshot } from './rustUrban';
import { mountTerrainControls } from './terrainControls';
import { batchUrbanSync, mountUrbanControls, writeUrbanControl, type UrbanControls, type UrbanControlParts } from './urbanControls';
import { mountStageChain, type StageChain } from './stageChain';
import { stagesForAction, stageById, type StageDef, type StageFamily } from './stageRegistry';
import { mountHeightmapSource } from './heightmapLibrary';
import { mountSettingsPanel, refreshBackends, backendStatus } from './settingsPanel';
import { backendAlternative, backendFailure, fallbackRuntime, runtimeNeedsProbe, F as RUNTIME_FALLBACK } from './runtimeChoices';
import { mountNeuralModelManager } from './neuralModelManager';
import { mountDesktopNeural } from './desktopNeural';
import { mountDesktopModules } from './desktopModules';
import { mountDesktopReleaseLink, mountDesktopUpdates } from './desktopUpdates';
import { mountV2Illustration } from './illustration';
import { iconUrl, type IconId } from './stageIcons';
import { mountRegionControls } from './regionControls';
import { effectiveRegion } from './regionSettings';
import { cityStageValidityKeys } from './stageValidity';
import { SmallPlaceQueue, boundedSmallPlaceRun } from './smallPlaces';
import { mountMapControls } from './mapControls';
import { mountNameOriginControls } from './nameOriginControls';
import { mountMapLabelEditor } from './mapLabelEditor';
import { applyLabelEdits } from './mapLabels';
import { mountNetworkEditor } from './networkEditor';
import { mountTownMoveEditor } from './townMoveEditor';
import { translateLand } from '../ui/urbanSnapshot';
import { mountSubdivisionActions, mountDeletedSubdivisions } from './localUrbanEditor';
import { createSelectionOverlay } from './selectionOverlay';
import { mountMeasureTool } from './measureTool';
import { resetSubdivisionChildren, rerollSubdivisionBuildings } from './subdivisionEdits';
import { siteQuarter, siteBlock } from '../../../rust/bridge/urbanHouseEdits';
import { renameMap } from './mapNaming';
import type { V2Urban3d } from './urban3d';
import { migrateUrbanSeeds, rerollUrbanSeeds, rerollSettlement } from './urbanSeeds';
import { resetRegionalChildren, resetUrbanChildren, regionalParentKey } from './generationEdits';
import type { UrbanSeedStage } from './contracts';
import { rerollSeed } from '../../../rust/bridge/generationSeed';
import { mountCityCodeSharing } from './cityCodeSharing';
import { mountV2TestHook } from './testHook';
import { armAutosave, takeAutosave, scheduleAutosave, mountNewButton } from './autosave';
showBrowserAdvice();

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));
for(const cls of DEMOGRAPHIC_CLASSES)registerMessages({[cls.id]:{en:cls.label,fr:cls.labelFr}});
registerMessages({'Modifier villes, quartiers et bâtiments':{en:'Edit towns, districts & buildings',fr:'Modifier villes, quartiers et bâtiments'}});
registerMessages({
  'Changes pending. Regenerate to apply them to this area and its descendants.': { en: 'Changes pending. Regenerate to apply them to this area and its descendants.', fr: 'Modifications en attente. Régénérer les applique à cette zone et à ses descendants.' },
  'Regenerate keeps the seed. The dice creates a new random layout and descendants.': { en: 'Regenerate keeps the seed. The dice creates a new random layout and descendants.', fr: 'Régénérer conserve la graine. Le dé crée un nouveau plan aléatoire et ses descendants.' },
  'Block': { en: 'Block', fr: 'Îlot' },
  'Regenerate area': { en: 'Regenerate area', fr: 'Régénérer la zone' },
  'Regenerate building': { en: 'Regenerate building', fr: 'Régénérer le bâtiment' },
  'Use parent settings': { en: 'Use parent settings', fr: 'Réglages du parent' },
  'Remove local overrides and regenerate using the parent settings.': { en: 'Remove local overrides and regenerate using the parent settings.', fr: 'Retirer les réglages locaux et régénérer avec ceux du parent.' },
  'Regenerate this area and its descendants. Display settings stay unchanged.': { en: 'Regenerate this area and its descendants. Display settings stay unchanged.', fr: 'Régénère cette zone et ses descendants. Le mode de rendu est conservé.' },
  'Local editing requires the Rust engine.': { en: 'Local editing requires the Rust engine.', fr: 'L’édition locale nécessite le moteur Rust.' },
  'House': { en: 'House', fr: 'Maison' },
  'Always show this name': { en: 'Always show this name', fr: 'Toujours afficher ce nom' },
  'Back to city': { en: 'Back to city', fr: 'Retour à la ville' },
  'Reroll house': { en: 'Reroll house', fr: 'Nouvelle variation' },
  'Apply selection': { en: 'Apply selection', fr: 'Appliquer à la sélection' },
  'Choose a style, roof or storeys, then apply.': { en: 'Choose a style, roof or storeys, then apply.', fr: 'Choisissez un style, un toit ou des étages, puis appliquez.' },
  'Update the Rust engine to edit the roof or storeys while retaining the existing footprint.': { en: 'Update the Rust engine to edit the roof or storeys while retaining the existing footprint.', fr: 'Actualisez le moteur Rust pour modifier le toit ou les étages en conservant l’emprise.' },
  'This model does not fit the parcel. The previous building is retained.': { en: 'This model does not fit the parcel. The previous building is retained.', fr: 'Ce modèle ne tient pas dans la parcelle. Le bâtiment précédent est conservé.' },
  'Replace descendant overrides': { en: 'Replace descendant overrides', fr: 'Remplacer les réglages des descendants' },
  'Local choices take priority unless replaced. Only affected stages are rebuilt.': { en: 'Local choices take priority unless replaced. Only affected stages are rebuilt.', fr: 'Les choix locaux restent prioritaires, sauf remplacement. Seules les étapes concernées sont recalculées.' },
  'House edit refused. The previous buildings have been retained.': { en: 'House edit refused. The previous buildings have been retained.', fr: 'Modification refusée. Les bâtiments précédents sont conservés.' },
});
registerMessages({'Cartographic maps':{en:'Cartographic maps',fr:'Cartes graphiques'},'Terrain materials':{en:'Terrain materials',fr:'Matériaux du terrain'},'Painted fantasy maps':{en:'Painted fantasy maps',fr:'Cartes fantasy peintes'},'Diagnostics':{en:'Diagnostics',fr:'Diagnostics'},'Fantasy · Encre N&B':{en:'Fantasy · Black & white ink',fr:'Fantasy · Encre N&B'},'Fantasy · Aquarelle':{en:'Fantasy · Watercolour',fr:'Fantasy · Aquarelle'},'Elevation · DEM':{en:'Elevation · DEM',fr:'Altitude · DEM'},'SVG · map / embedded render':{en:'SVG · map / embedded render',fr:'SVG · carte / rendu intégré'}});
registerMessages({'Render3D · Multiscale':{en:'Render3D · Multiscale',fr:'Render3D · Multi-échelle'},'Render v2 - Satellite':{en:'Render v2 - Satellite',fr:'Render v2 - Satellite'},'Render v2 - Substrate':{en:'Render v2 - Substrate',fr:'Render v2 - Substrat'},'Render v2 - Moisture':{en:'Render v2 - Moisture',fr:'Render v2 - Humidité'},'Render v2 - Vegetation':{en:'Render v2 - Vegetation',fr:'Render v2 - Végétation'},'Render v2 - Snow / ice':{en:'Render v2 - Snow / ice',fr:'Render v2 - Neige / glace'}});
registerMessages({'Réglages':{en:'Settings',fr:'Réglages'},'Réglages, moteurs et activité':{en:'Settings, engines and activity',fr:'Réglages, moteurs et activité'},'Toute la chaîne':{en:'Whole chain',fr:'Toute la chaîne'},'Générer toute la chaîne : relief, peuplements et villes':{en:'Generate the whole chain: relief, settlements and cities',fr:'Générer toute la chaîne : relief, peuplements et villes'},'Implanter et construire':{en:'Place and build',fr:'Implanter et construire'},'Recette JSON':{en:'Recipe JSON',fr:'Recette JSON'},'Les lieux':{en:'Places',fr:'Les lieux'},'Replier la liste':{en:'Collapse the list',fr:'Replier la liste'},'Créer le relief':{en:'Create the relief',fr:'Créer le relief'},'Redraw the map':{en:'Redraw the map',fr:'Redessiner la carte'},'Implanter et relier':{en:'Place and connect',fr:'Implanter et relier'},'Construire tous les lieux':{en:'Build every place',fr:'Construire tous les lieux'},'Courbes':{en:'Contours',fr:'Courbes'},'Milieux':{en:'Land cover',fr:'Milieux'},'Noms':{en:'Names',fr:'Noms'},'Adresses des modèles et services':{en:'Model and service addresses',fr:'Adresses des modèles et services'},'Chaîne de génération':{en:'Generation chain',fr:'Chaîne de génération'},'Réglages & moteurs':{en:'Settings & engines',fr:'Réglages & moteurs'}});
const icon = (id: IconId, size = 22): string => `<img class="v2-icon" src="${iconUrl(id) ?? ''}" alt="" width="${size}" height="${size}" aria-hidden="true">`;
registerMessages({'Full generation':{en:'Full generation',fr:'Génération complète'}});
type Item = string | readonly [string, string];
function options(items: readonly Item[]): string { return items.map(item => { const [value,label] = typeof item === 'string' ? [item,item] : item; return `<option value="${esc(value)}">${esc(label)}</option>`; }).join(''); }
function field(label: string, key: string, items?: readonly Item[], attrs = ''): string { const id=`option-${key.replace(/\./g,'-')}`;return `<label class="label" for="${id}">${label}</label>${items ? `<select id="${id}" data-option="${key}">${options(items)}</select>` : `<input id="${id}" data-option="${key}" ${attrs || 'type="number"'}>`}`; }
const tri: Item[] = [['auto','Automatic'],['yes','Yes'],['no','No']];
const BIOME_LABELS: readonly Item[] = [['temperate','Temperate countryside'],['forest','Temperate forest'],['desert','Desert & oases'],['steppe','Steppe'],['tropical','Tropical forest'],['tundra','Tundra'],['underdark','Underdark']];
const layerNames: Record<keyof ExportLayers,string> = { background:'Map background', terrain:'Relief & contours', water:'Hydrography', landuse:'Vegetation & farmland', city:'Buildings & grounds', streets:'Streets & urban bridges', roads:'Regional roads', labels:'Place names', decor:'Frame & legend' };
let settings: V2Settings = defaultSettings();
applySceneClock(settings, DEFAULT_SCENE);
let world: World | undefined;
let pristine: World | undefined;
/** Inspection can replace the display without discarding the completed project. */
let previewBase: { world?: World; pristine?: World } | undefined;
registerMessages({
  'Stage output': { en: 'Stage output', fr: 'Sortie de l’étape' },
  'Elevations from this stage. Later stages remain to be run.': { en: 'Elevations from this stage. Later stages remain to be run.', fr: 'Altitudes de cette étape. Les étapes suivantes restent à exécuter.' },
});
let mods: unknown[] = [];
/** Background build of small places (assigned with the generation helpers below). */
let smallPlaces: SmallPlaceQueue | undefined;
/** City recipe key of the map produced by the last run that built towns; undefined = no background pass on this map. */
let smallPlaceRecipe: string | undefined;
let lastGesture = 0;
let selectedTown = 'main';
let cityScope: 'all' | 'selection' = 'all';
const selectedCities = new Set<string>();
registerMessages({
  'Build targeted cities': { en: 'Build targeted cities', fr: 'Construire les villes ciblées' },
  'Select all': { en: 'Select all', fr: 'Tout sélectionner' },
  'Clear selection': { en: 'Clear selection', fr: 'Vider la sélection' },
  '{count} selected': { en: '{count} selected', fr: '{count} sélectionnées' },
  'Select {name} for generation': { en: 'Select {name} for generation', fr: 'Sélectionner {name} pour la génération' },
  'Select at least one city in the list on the right.': { en: 'Select at least one city in the list on the right.', fr: 'Sélectionnez au moins une ville dans la liste à droite.' },
  'Placed · no urban plan': { en: 'Placed · no urban plan', fr: 'Implantée · sans plan urbain' },
  'Stage: roads & quarters': { en: 'Stage: roads & quarters', fr: 'Étape : routes et quartiers' },
  'Stage: parcels': { en: 'Stage: parcels', fr: 'Étape : parcelles' },
  'Stage: programme': { en: 'Stage: programme', fr: 'Étape : programme' },
  'Stage: houses': { en: 'Stage: houses', fr: 'Étape : maisons' },
});
function cityTargets(): string[] | undefined { return cityScope === 'all' ? undefined : [...selectedCities]; }
function syncCitySelection(): void {
  const valid = new Set(world?.settlements?.map(place => place.key) ?? []);
  for (const key of selectedCities) if (!valid.has(key)) selectedCities.delete(key);
  if(cityScope==='selection'&&!selectedCities.size)cityScope='all';
  document.querySelectorAll<HTMLInputElement>('[data-city-select]').forEach(input => { input.checked = cityScope==='selection' && selectedCities.has(input.dataset.citySelect!); input.disabled = busy; });
  $<HTMLButtonElement>('#towns-only').disabled = busy || !valid.size || cityScope === 'selection' && !selectedCities.size;
  $('#cities-select-all').setAttribute('aria-pressed',String(cityScope==='all'));
  setDynamicText($('#cities-selected-count'), () => translate('{count} selected').replace('{count}', String(cityScope==='all'?valid.size:selectedCities.size)));
  urbanControls.sync();
  chain.sync();
}
registerMessages({
  '{count} inh.': { en: '{count} inh.', fr: '{count} hab.' },
  '{count} inh. (target {target})': { en: '{count} inh. (target {target})', fr: '{count} hab. (cible {target})' },
  'Capacity shortfall: {households} households (≈ {people} inh.) not housed.': { en: 'Capacity shortfall: {households} households (≈ {people} inh.) not housed.', fr: 'Capacité insuffisante : {households} ménages (≈ {people} hab.) non logés.' },
});
/** Population reached by a built town (undefined before its houses exist: the target stays displayed). */
function reachedPopulation(key: string, target: number) {
  const native = nativeCityRecords(world ?? undefined)?.[key];
  return native?.stage === 'buildings' ? cityReachedPopulation(target, (native.programmePartitions ?? []).map(p => p.programme), native.scene) : undefined;
}
const popFormat = () => ({ t: translate, locale: numberLocale() });
function populationMarkup(key: string, target: number): string {
  const reached = reachedPopulation(key, target);
  return reached ? esc(populationText(target, reached,popFormat())) : `${numberHTML(target)} hab.`;
}
function cityStageLabel(key: string): string {
  if (!world || !townUrban(world, key)) return 'Placed · no urban plan';
  const stage = world.stats[`v2.urbanStage:${key}`];
  return stage === 'layout' ? 'Stage: roads & quarters' : stage === 'parcels' ? 'Stage: parcels' : stage === 'programme' ? 'Stage: programme' : 'Stage: houses';
}
function runCities(stage?: V2TownStage, output?: string): void {
  const keys = cityTargets();
  if (keys && !keys.length) { toast(translate('Select at least one city in the list on the right.')); return; }
  void generate('towns', undefined, stage, undefined, keys, output);
}
function rerollCityStep(stage: UrbanSeedStage, keys: string[], output?: string): void {
  if (busy) return;
  if (!keys.length) return;
  rerollUrbanSeeds(settings, keys, stage);
  touchRecipe(); urbanControls.sync(); inspectorForms.forEach(form => form.sync());
  $<HTMLInputElement>('#seed').value = settings.options.seed;
  const order: V2TownStage[] = ['layout', 'parcels', 'programme', 'buildings'];
  const minimum: V2TownStage = stage === 'composition' || stage === 'streets' ? 'layout' : stage === 'parcels' ? 'parcels' : stage === 'programme' ? 'programme' : 'buildings';
  const target = order[Math.max(order.indexOf(minimum), ...keys.map(key => order.indexOf((world?.stats[`v2.urbanStage:${key}`] ?? 'buildings') as V2TownStage)))];
  if (keys.length === 1) void generate('town', keys[0], target, undefined, undefined, output);
  else void generate('towns', undefined, target, undefined, keys, output);
}
/** `family`: run the whole family (cached upstream stages are kept) instead of previewing this stage. */
function rerollStage(stage: StageDef, family = false): void {
  if (busy) return;
  const variation = typeof stage.variation === 'function' ? stage.variation(chain.context()) : stage.variation;
  if (!variation) return;
  if (stage.family === 'cities') { rerollCityStep(variation as UrbanSeedStage, cityTargets() ?? world?.settlements?.map(place => place.key) ?? [], stage.id); return; }
  migrateUrbanSeeds(settings);
  if(variation==='settle-sites')resetRegionEdits();
  settings.options.seed = rerollSeed(settings.options.seed, variation==='settle-sites' ? [variation,'city/*/default'] : [variation]);
  $<HTMLInputElement>('#seed').value = settings.options.seed; touchRecipe();
  if (family) runFamily(stage.family); else runStage(stage);
}
let selectedBuilding: { settlement: string; index: number; building: UrbanBuilding } | null = null;
let selectedSubdivision: { key: string; kind: 'quarter' | 'block' | 'parcel'; id: string; point: { x: number; y: number } } | undefined;
let busy = false, cancelled = false, currentTab = 'terrain', toastTimer: ReturnType<typeof setTimeout>;
let elapsedTimer: ReturnType<typeof setInterval> | undefined;
const logs: {time:Date;message:string}[] = [];
let projectRevision = 0;
const bootRuntime = runtimeOptions();
const localEdition = bootRuntime.profile === 'local';
let connectLocal = localEdition;
// The installed launcher already owns a ready native service; avoid loading WASM for the same CPU work.
if(localEdition){settings.generation='procedural';settings.runtime={...settings.runtime!,backend:'native',source:'procedural',localServer:bootRuntime.localServer,pythonServer:bootRuntime.pythonServer};}

registerMessages(projectFileMessages);
setHTML($('#app'), `
<header class="app-header">
  <img class="brand-icon" src="${logo}" alt=""><div class="brand"><h1>MAGNA URBIS</h1><p>The region workshop</p></div><span class="version">V2 · ALPHA</span>
  <nav class="project-links">
    <a href="./scientific/index.html" target="_blank" rel="noopener">How it works? ↗</a>
    <a href="https://v1.magna-urbis.org/" target="_blank" rel="noopener">V1 ↗</a>
    <a href="https://github.com/dunkean/magna-urbis" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
    <a href="https://github.com/dunkean/magna-urbis/discussions" target="_blank" rel="noopener noreferrer">Discussions ↗</a>
    <a href="https://github.com/dunkean/magna-urbis/releases" target="_blank" rel="noopener noreferrer">Releases ↗</a>
    <a href="https://ko-fi.com/dunkean" target="_blank" rel="noopener">Ko-fi ↗</a>
    <span id="build-info"></span>
  </nav><div class="project-actions"><button id="import-open">Open</button><button id="save-map">Save map</button><button id="export-open">Export ↗</button></div>
  <div class="header-tools"><span class="edition">${localEdition ? 'Desktop / local edition' : 'Web edition'}</span><label class="language-control header-language"><select id="language-select" aria-label="Interface language">${LANGUAGES.map(item=>`<option value="${item.code}" data-l10n-keep>${item.name}</option>`).join('')}</select></label><button id="hardware-open" title="Settings, engines and activity">${icon('settings-gear',20)} <span class="status-dot" id="hardware-led"></span> <span id="hardware-caption">Settings</span></button></div>
</header>
<section class="workbench-bar" aria-label="Scene and editing tools">
  <div class="view-strip"><div class="style-control"><label class="strip-label" for="map-style">Appearance</label><select id="map-style" aria-label="Map style">${STYLE_LIST.map(s=>`<option value="${s.id}">${s.label}</option>`).join('')}</select></div><div id="scene-controls" class="scene-controls"></div></div>
  <nav class="header-menu" id="header-menu" aria-label="Map tools"><span class="strip-label">Edit map</span><button id="edit-navigate" type="button" aria-pressed="true">Navigate</button><label class="inspector-mode"><input id="inspect-mode" type="checkbox"><span>Select on map</span></label><div id="network-tool-slot"></div><button id="rivers-open" type="button" aria-pressed="false">Rivers</button><button id="labels-open" type="button" aria-pressed="false">Names & labels</button><span class="tool-spacer"></span><output id="active-tool" aria-live="polite">Navigate</output><button id="edit-done" type="button" hidden>Finish editing</button></nav>
</section>
<button class="mobile-toggle" id="mobile-toggle" aria-expanded="false" aria-controls="sidebar">☰ Workshop</button>
<main class="workspace">
  <aside class="sidebar mobile-closed" id="sidebar" aria-label="Generation chain">
    <div id="terrain-controls"></div>
    <div class="sidebar-footer"><div class="footer-actions"><button class="primary generate" id="generate-region"><i class="art art-terrain" aria-hidden="true"></i><span id="generate-label">Create the relief</span></button><button id="run-chain" type="button" title="Generate the whole chain: relief, settlements and cities">${icon('family-settlements',24)}<span>Full generation</span></button></div><div class="footer-note"><span class="status-dot"></span><span id="footer-status" class="grow">Terrain and water, in one click</span><button id="expert-open" class="quiet small">JSON recipe</button></div></div>
  </aside>
  <div id="stage-staging" hidden>
    <div class="stage-field" data-control="widget:seed"><label class="label" for="seed">Region seed</label><div class="row seed-row"><input id="seed" data-option="seed" type="text" maxlength="200" aria-label="Region seed"><button id="random-seed" title="New seed" aria-label="New seed"><i class="art art-dice"></i></button></div><p class="hint" id="extent-hint"></p></div>
    <div class="stage-field" data-control="main:town-count"><label class="label" for="town-count">Requested settlements</label><input id="town-count" type="number" min="1" max="32" value="4"></div>
    <div class="stage-field" data-control="main:population">${field('Population principale','population',undefined,'type="number" min="10" max="5000000" step="100"')}</div>
    <div class="stage-field" data-control="main:culture">${field('Culture commune','culture',CULTURE_LABELS)}</div>
    <div id="region-controls"></div>
    <div id="urban-settings-panel"><div id="urban-controls"></div></div>
    <div class="stage-field" data-control="main:sprawl">${field('Sprawl · 0.5 compact / 2 dispersed','sprawl',undefined,'type="number" min="0.5" max="2" step="0.1"')}</div>
    <div class="stage-field" data-control="main:walls">${field('Fortifications','walls',[['auto','Automatic'],['none','Open town'],['single','Single enclosure'],['double','Double enclosure']])}</div>
    ${[['moat','Moat'],['castle','Castle'],['cathedral','Cathedral'],['palace','Palace'],['monasteries','Monasteries'],['port','Port'],['arena','Arena'],['activities','Crafts & activities']].map(([k,l])=>`<div class="stage-field" data-control="main:${k}">${field(l,k,tri)}</div>`).join('')}
    <div class="stage-field" data-control="main:suburbs">${field('Suburbs','suburbs',[['auto','Automatic'],['none','None'],['some','Some'],['many','Many']])}</div>
    <details class="section" id="settings-endpoints-box"><summary>Model and service addresses</summary><div id="settings-endpoints" class="parameter-form"></div></details>
    <button id="terrain-only"></button><button id="region-only"></button><button id="heightmap-import-quick"></button>
  </div>
  <section class="map-area" aria-label="Interactive map">
    <aside id="editor-dock" class="editor-dock glass" hidden aria-labelledby="editor-title"><header><div><span class="eyebrow">Edit map</span><h2 id="editor-title">Edit map</h2></div><button id="editor-close" type="button" aria-label="Close">×</button></header><div id="editor-content"><div id="edit-buildings"><p class="hint">Select a town, district or building on the map to edit its properties.</p></div><div id="edit-roads" hidden></div><div id="edit-rivers" hidden></div><div id="edit-labels" hidden></div></div></aside>
    <div class="canvas-wrap" id="map"><canvas id="map-canvas" aria-label="Generated map: drag to pan, scroll to zoom"></canvas></div>
    <div class="empty-map" id="empty-map"><div class="serif">Terra incognita</div></div>
    <div class="map-compass" aria-hidden="true"><small>N</small><b>✧</b></div>
    <div class="glass map-tools"><button id="zoom-in" aria-label="Zoom in">+</button><button id="zoom-out" aria-label="Zoom out">−</button><button id="fit-map" aria-label="Fit map" title="Fit map">⛶</button></div>
    <aside class="glass places-panel" id="places-panel" hidden aria-labelledby="places-title"><header><h2 class="serif" id="places-title">Places</h2><span class="count-badge" id="towns-count">0</span><button id="towns-only">Build targeted cities</button><button id="places-collapse" class="quiet small" aria-expanded="true" aria-controls="settlement-list" title="Collapse the list">–</button></header><div class="places-selection"><button id="cities-select-all" class="small">Select all</button><button id="cities-select-none" class="small" hidden>Clear selection</button><output id="cities-selected-count" aria-live="polite"></output></div><div class="settlement-list" id="settlement-list"><p class="hint">Create settlement sites to select a place.</p></div><aside id="inspector" class="inspector" hidden aria-label="Settlement inspector"></aside></aside>
    <div class="map-hint" id="map-hint">Drag to explore · Scroll to zoom</div>
    <div class="glass progress-card" id="progress-card" hidden role="status" aria-live="polite"><div class="row"><i class="spinner"></i><strong class="grow small" id="progress-label">Preparing the region…</strong><button id="cancel-job" class="quiet small">Cancel</button></div><progress id="progress" max="100" value="0"></progress><div class="row spread"><p id="progress-detail">CPU · generation worker</p><p id="progress-time">0 s</p></div></div>
    <div class="map-bottom"><div class="glass mini-card"><canvas id="minimap" aria-label="Overview"></canvas><div class="map-scale"><span id="scale-label">—</span><div class="scale-line"></div><p id="map-metrics">No map</p><div id="cursor-readout"></div></div></div></div><div class="legend-strip"></div>
  </section>
</main>
<dialog id="import-dialog"><div class="dialog-head"><div><span class="eyebrow">Return to a region</span><h2>Open & compose</h2></div><button data-close="import-dialog" aria-label="Close">×</button></div><p class="hint">A project contains the map, settings and edits. A recipe recreates a region with the same engine version.</p><div class="file-card"><h3>Magna Urbis V2 project or recipe</h3><p class="hint">Binary .muproj, complete JSON, or seeds + settings. Projects retain the elevation grids.</p><input id="project-file" type="file" accept=".muproj,.json,application/octet-stream,application/json" aria-label="Import a V2 project or recipe"></div><div class="file-card"><h3>Heightmap → territory</h3><p class="hint">Grayscale PNG, JPEG or WebP, cropped to a square. Set the elevation and sea level before creating the terrain. The import replaces the current terrain.</p><input id="heightmap-file" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Import a heightmap"><button id="clear-heightmap" class="quiet small">Remove imported terrain</button><p class="hint" id="import-height-info">No heightmap imported.</p></div><div class="dialog-actions"><button data-close="import-dialog">Close</button></div></dialog>
<dialog id="export-dialog"><div class="dialog-head"><div><span class="eyebrow">Take your region with you</span><h2>Export your way</h2></div><button data-close="export-dialog" aria-label="Close">×</button></div><p class="hint">A complete map, a crop, or just the elements you need for your game.</p><div class="control-grid"><div><label class="label" for="export-format">Format</label><select id="export-format"><option value="binary">Save map · .muproj</option><option value="png">Image PNG</option><option value="svg">SVG vector map</option><option value="project">Export complete project (JSON)</option><option value="recipe">Seeds + settings + edits</option><option value="seed">Seed only · JSON</option><option value="heightmap">Heightmap · 8-bit PNG</option></select></div></div><div id="export-map-options"><h3>Elements to include</h3><div class="export-layers">${EXPORT_LAYER_NAMES.map(k=>`<label class="checkline"><input type="checkbox" data-layer="${k}" checked>${layerNames[k]}</label>`).join('')}</div><div class="control-grid"><div><label class="label" for="export-resolution">Longest edge</label><select id="export-resolution"><option value="1600">1,600 px · quick</option><option value="3000" selected>3,000 px · standard</option><option value="4096">4,096 px · detailed</option></select></div><label class="checkline"><input id="export-crop" type="checkbox" checked>Choose the export area</label></div></div><p class="hint" id="export-note" style="margin-top:15px">Visual exports use the current map without rerunning generation.</p><div class="dialog-actions"><button data-close="export-dialog">Cancel</button><button class="primary" id="export-go">Export</button></div></dialog>
<dialog id="expert-dialog"><div class="dialog-head"><div><span class="eyebrow">The region recipe</span><h2>Expert settings</h2></div><button data-close="expert-dialog" aria-label="Close">×</button></div><p class="hint">Global settings, local overrides by stable key, growth plans and site preferences. Imported terrain data is retained separately.</p><label class="label" for="expert-json">JSON recipe</label><textarea id="expert-json" spellcheck="false"></textarea><p class="warning" id="expert-error" role="alert"></p><div class="dialog-actions"><button data-close="expert-dialog">Cancel</button><button class="primary" id="expert-apply">Apply recipe</button></div></dialog>
<dialog id="hardware-dialog"><div class="dialog-head"><div><span class="eyebrow">The workshop at work</span><h2>Settings & engines</h2></div><button data-close="hardware-dialog" aria-label="Close">×</button></div><p class="hint">Choose the engine for each process. Available hardware and the last execution are shown separately.</p><details class="section preferences-section"><summary>Preferences & documentation</summary><div id="workbench-preferences" class="workbench-preferences"></div><a class="science-link" href="./scientific/index.html" target="_blank" rel="noopener">Scientific atlas ↗</a></details><div id="hardware-details"></div><details class="section"><summary>Generation log</summary><pre class="job-log" id="job-log">The workshop is ready.</pre></details><div class="dialog-actions"><button id="hardware-refresh">Refresh connections</button><button data-close="hardware-dialog">Close</button></div></dialog>
<div class="toast" id="toast" role="status" hidden></div>`);

const canvas = $<HTMLCanvasElement>('#map-canvas');
const client = new StudioClient(canvas, $('#map'), $<HTMLCanvasElement>('#minimap'), updateProgress, e => void reportGenerationFailure(e.message), () => {
  const view = client.viewer.getView();
  setText($('#scale-label'), formatDistance(80 / view.scale, getDistanceUnit(), numberLocale()));
});
mountMeasureTool({ map: $('#map'), canvas, slot: $('.view-strip'), readout: $('#cursor-readout'), getView: () => client.viewer.getView(), getHeight: () => world?.terrain.height, getMapSize: () => world?.mapSize });
const selectionOutline = createSelectionOverlay($('#map'), () => client.viewer.getView());
window.addEventListener('v2-edit-mode', event => {
  if (['navigate', '3d', 'family'].includes((event as CustomEvent<string>).detail)) selectionOutline.set();
});
let city3d:V2Urban3d|undefined;
let renderTimer:ReturnType<typeof setTimeout>|undefined,renderRevision=0;
const sceneControls=mountSceneControls($('#scene-controls'),{getSettings:()=>settings,onChange:()=>{projectRevision++;clearTimeout(renderTimer);renderTimer=setTimeout(()=>void refreshAppearance(),120);}});
insertHTML($('.style-control'),'beforeend','<span id="render-status" class="hint" role="status" aria-live="polite" hidden></span><div id="render-controls" hidden></div>');
const renderControls=mountRenderControls($('#render-controls'),{getSettings:()=>settings,getWorld:()=>world,getStyleSelectors:()=>[$<HTMLSelectElement>('#map-style')],getTarget:()=>document.querySelector('#view3d')?.getAttribute('aria-pressed')==='true'?'view3d':'view2d',onChange:()=>{projectRevision++;clearTimeout(renderTimer);renderTimer=setTimeout(()=>void refreshAppearance(),120);}});
async function refreshAppearance():Promise<void>{
  workbenchLayout?.sync();sceneControls.sync();roadDisplay?.sync();
  city3d?.syncControls();
  const revision=++renderRevision,appearanceStart=performance.now();
  renderControls.sync();
  const status=$('#render-status');delete status.dataset.error;status.hidden=false;
  setText(status,'HD loading…');
  try{
    await client.setAppearance(settings);
    if(revision!==renderRevision)return;
    syncDisplayWidgets();
    if(city3d?.active){
      await client.prepare3dBackground();
      if(revision!==renderRevision||!city3d.active)return;
      city3d.refresh();await city3d.prepare();
      if(revision!==renderRevision)return;
      await client.waitFor3d(city3d);
    }else{
      await client.displaySettled();
    }
    if(revision===renderRevision)renderControls.sync();
  }
  catch(error){if(revision===renderRevision)reportAppearanceError(error);}
  finally{if(revision===renderRevision){if(status.dataset.error!=='true')status.hidden=true;performance.measure('v2:appearance',{start:appearanceStart});}}
}
/** A new world (relief, settlements, edits) shown while the 3D view is open: the ground capture, the surface and the tiles must follow it (the 2D map redraws itself). */
async function refresh3dWorld():Promise<void>{
  if(!city3d?.active)return;
  const revision=++renderRevision,status=$('#render-status');delete status.dataset.error;status.hidden=false;
  setText(status,'HD loading…');
  try{
    await client.prepare3dBackground();   // the bench ground of the new world is captured on demand, never while the 3D view is active
    if(!city3d?.active||revision!==renderRevision)return;
    city3d.refresh();await city3d.prepare();
    await client.waitFor3d(city3d);
  }catch(error){if(revision===renderRevision)reportAppearanceError(error);}
  finally{if(revision===renderRevision&&status.dataset.error!=='true')status.hidden=true;}
}
function reportAppearanceError(error:unknown):void{
  const message=error instanceof Error?error.message:String(error);
  if(error instanceof Error&&error.name==='MaterialRasterUnavailableError'){
    const status=$('#render-status');status.dataset.error='true';status.hidden=false;
    setText(status,'Render unavailable: WebGL2 could not start. Choose a cartographic style.');
  }
  toast(message,true);
}
// The top-bar selector is the preset select of the render panel; 'custom' is shown but cannot be picked.
setHTML($('#map-style'),PRESET_OPTIONS.map(o=>`<option value="${o.value}"${o.value==='custom'?' disabled':''}>${esc(o.label)}</option>`).join(''));
/** The preset and export availability follow the current composition. */
function syncDisplayWidgets():void{
  sceneControls.sync();
  const recipe=currentComposition(settings,world??undefined);
  $<HTMLSelectElement>('#map-style').value=recipe.preset;
  syncExportOptions();
}
function writeRecipe(path:string,value:unknown):void{writeAppearanceControl(settings,`appearance.composition.${path}`,value);projectRevision++;void refreshAppearance();}
insertHTML($('.style-control'),'beforeend','<button id="view3d" type="button" aria-pressed="false">3D</button><button id="capture3d" type="button" hidden>PNG 3D ↗</button>');
insertHTML($('#header-menu'),'beforeend','<button id="preview-close" type="button" class="quiet small" hidden></button>');
setDynamicText($('#preview-close'), () => 'Close preview');
$('#preview-close').onclick = async () => {
  if (!previewBase?.world || busy) return;
  world = previewBase.world; pristine = previewBase.pristine; previewBase = undefined;
  await client.show(world, true); updateWorld(); void refresh3dWorld();
};
/** Token of the 3D opening in flight (0 = none): the button stays enabled while the 3D view loads, and a click on "2D" abandons the opening. */
let open3dToken=0,open3dSeq=0;
$('#view3d').onclick=async()=>{
  window.dispatchEvent(new CustomEvent('v2-edit-mode',{detail:'3d'}));
  if(!world){toast('Create the terrain first.');return;}
  if(open3dToken||city3d?.active){
    const opening=open3dToken!==0;open3dToken=0;   // a pending opening sees its token vanish and stops without showing the 3D view
    const mapView=city3d?.active?city3d.toMapView():undefined;
    if(city3d?.active)city3d.hide();
    client.set3dActive(false);if(mapView)client.viewer.setView(mapView);setText($('#view3d'),'3D');$('#view3d').setAttribute('aria-pressed','false');$('#capture3d').hidden=true;editingTools.sync();
    if(opening){if(!busy)$('#progress-card').hidden=true;$<HTMLButtonElement>('#cancel-job').hidden=false;if($('#render-status').dataset.error!=='true')$('#render-status').hidden=true;}
    return;
  }
  const myToken=open3dToken=++open3dSeq,stale3d=()=>open3dToken!==myToken;
  setText($('#view3d'),'2D');   // back to 2D is possible at any time, also while the 3D view loads
  // The progress card stays until the 3D view has drawn a complete first frame (tiles ready, no pending job):
  // the view needs seconds after it is shown, and a vanished card looked like a freeze.
  const card3d=$('#progress-card'),cancel3d=$<HTMLButtonElement>('#cancel-job');
  const step3d=(detail:string)=>{if(busy||stale3d())return;card3d.hidden=false;cancel3d.hidden=true;setText($('#progress-label'),'Opening the 3D view…');setText($('#progress-detail'),detail);setText($('#progress-time'),'');$<HTMLProgressElement>('#progress').removeAttribute('value');};
  const open3dStart=performance.now(),request3d=client.begin3dRequest();
  client.set3dActive(true);
  try{
    step3d('Map ground');
    await client.prepare3dBackground();
    if(stale3d())return;
    step3d('3D engine and shaders');
    if(!city3d){toast('Loading the 3D view…');city3d=await(await import('./urban3d')).mountV2Urban3d({host:$('.map-area'),toolbarHost:$('.toolbar-row'),advancedControls:$('#view3d-advanced-controls'),getWorld:()=>world,getSettings:()=>settings,getBackground:()=>client.backgroundUrl(),getBackgroundImage:()=>client.groundBackground(),getPhysicalGround:()=>client.physicalGround(),onAppearancePatch:patch=>{settings.appearance=applyAppearancePatch(settings.appearance,settings.options.style,patch);projectRevision++;void refreshAppearance();},getTextured:()=>settings.appearance?.textured??false,setTextured:value=>{settings.appearance={style:settings.options.style,...settings.appearance,textured:value};projectRevision++;void refreshAppearance();},getSelected:()=>selectedBuilding?(selectedBuilding.building as UrbanBuilding&{nativeId?:string}).nativeId:undefined,onSelect:id=>{
      for(const settlement of world?.settlements??[]){const urban=townUrban(world!,settlement.key),index=urban?.buildings.findIndex(b=>(b as UrbanBuilding&{nativeId?:string}).nativeId===id)??-1;if(urban&&index>=0){showBuilding({settlement:settlement.key,index,building:urban.buildings[index]});break;}}
    }});}
    if(stale3d())return;
    await city3d.prepare();
    if(stale3d())return;   // back to 2D while loading: the 3D view is never shown
    city3d.show();city3d.fromMapView(client.viewer.getView());performance.measure('v2:3d:shown',{start:open3dStart});setText($('#view3d'),'2D');$('#view3d').setAttribute('aria-pressed','true');$('#capture3d').hidden=false;editingTools.sync();
    step3d('Terrain, buildings and trees');
    const view3d=city3d,status3d=$('#render-status');status3d.hidden=false;
    setText(status3d,'HD loading…');
    const coverageTimer=setInterval(()=>{if(request3d.has('first-covered-frame')&&!busy)card3d.hidden=true;},40);
    try{await client.waitFor3d(view3d,request3d);}finally{clearInterval(coverageTimer);status3d.hidden=true;}
    performance.measure('v2:3d:tiles',{start:open3dStart});
  }catch(error){if(stale3d())return;if(!city3d?.active){client.set3dActive(false);setText($('#view3d'),'3D');}toast(String(error),true);}
  finally{if(!stale3d()){open3dToken=0;if(!busy)card3d.hidden=true;cancel3d.hidden=false;}}
};
$('#capture3d').onclick=async()=>{try{if(city3d?.active)download(await city3d.capture(),`magna-urbis-${settings.options.seed}.3d.png`);}catch(error){toast(String(error),true);}};
const terrainControls=mountTerrainControls($('#terrain-controls'),{getSettings:()=>settings,onChange:()=>{touchRecipe();regionControls?.sync();syncUrbanBackend();},disabled:()=>busy,context:{getWorld:()=>world,onApply:()=>void generate('terrain')}});
// City Bench forms are mounted per stage once the chain exists (below).
let urbanControls:UrbanControls={sync(){},dispose(){}};
let pendingRegionPosition:string|undefined;
const regionControls=mountRegionControls($('#region-controls'),{getSettings:()=>settings,onChange:touchRecipe,getWorld:()=>world,disabled:()=>busy,onReroute:()=>void generate('roads'),onPickPosition:key=>{window.dispatchEvent(new CustomEvent('v2-edit-mode',{detail:'placement'}));pendingRegionPosition=key;toast(translate('Choose a position on the map'));}});
window.addEventListener('v2-edit-mode',event=>{if((event as CustomEvent<string>).detail!=='placement')pendingRegionPosition=undefined;});
let inspectorForms:UrbanControls[]=[];
/* The staged chain takes over the sidebar: the forms above are moved into their stage rows. */
const backendBindings={localServer:()=>settings.runtime?.localServer??bootRuntime.localServer??'http://127.0.0.1:8791',pythonServer:()=>settings.runtime?.pythonServer??bootRuntime.pythonServer??'http://127.0.0.1:8793',log,getSettings:()=>settings,getWorld:()=>world,busy:()=>busy,onRuntimeChange:()=>{touchRecipe();terrainControls.sync();regionControls?.sync();syncUrbanBackend();scheduleChainSync();}};
const settingsPanel=mountSettingsPanel($('#hardware-details'),backendBindings);
const desktopModulesHost=document.createElement('div');$('#hardware-details').after(desktopModulesHost);
mountDesktopModules(desktopModulesHost,()=>void inspectHardware());
mountDesktopUpdates($('.header-tools'),desktopModulesHost);
mountDesktopReleaseLink($('.project-links'));
mountV2Illustration({host:$('.header-tools'),getWorld:()=>world,getSettings:()=>settings,get3d:()=>city3d,getViewport:()=>({element:$('#map'),view:client.viewer.getView()}),beforeCapture2d:()=>client.prepareViewportCapture(),navigation:{getView:()=>client.viewer.getView(),setView:view=>client.viewer.setView(view),ready:()=>client.viewer.waitForFrame()}});
let chainSyncFrame=0;
function scheduleChainSync():void{if(chainSyncFrame)return;chainSyncFrame=requestAnimationFrame(()=>{chainSyncFrame=0;chain.sync();});}
const fullGenerationHelp:Record<StageFamily,{en:string;fr:string}>={
  region:{en:'Generate relief, settlements and cities',fr:'Générer le relief, les peuplements et les villes'},
  settlements:{en:'Generate settlements and cities, keeping the current relief',fr:'Générer les peuplements et les villes, en conservant le relief actuel'},
  cities:{en:'Build targeted cities, keeping the relief and settlements',fr:'Construire les villes ciblées, en conservant le relief et les implantations'},
  map:{en:'Redraw the current map without generation',fr:'Redessiner la carte actuelle sans régénération'},
};
for(const copy of Object.values(fullGenerationHelp))registerMessages({[copy.en]:copy});
function syncFullGenerationButton(family:StageFamily):void{
  const button=$<HTMLButtonElement>('#run-chain'),label=translate(fullGenerationHelp[family].en);
  button.title=label;button.setAttribute('aria-label',label);button.hidden=family==='map';
}
async function runFullGeneration():Promise<void>{
  if(busy)return;
  await runRemainingGeneration(chain.family(),{
    generate:(action,keys)=>generate(action,undefined,undefined,undefined,keys),
    targets:cityTargets,redraw:refreshAppearance,
  });
}
const familyActions:Record<StageFamily,[string,()=>void]>={
  region:['Create the relief',()=>void generate('terrain')],
  settlements:['Place & connect',()=>void generate('region')],
  cities:['Build targeted cities',()=>runCities()],
  map:['Redraw the map',()=>void refreshAppearance()],
};
function runFamily(family:StageFamily):void{familyActions[family][1]();}
function runStage(stage:StageDef):void{
  if(stage.id==='map-export'){dialog('#export-dialog');return;}
  if(stage.id==='map-naming'){void redrawNames();return;}
  const run=stage.run;
  if(run.action==='display'){void refreshAppearance();return;}
  if(run.action==='mask'){terrainControls.openEditor('draw');return;}
  if(run.action==='town'){
    const backend=settings.urban?.backend??settings.runtime?.backend??'typescript';
    runCities(backend==='typescript'?undefined:run.townStage, stage.id);return;
  }
  void generate(run.action, undefined, undefined, run.action === 'terrain' ? stage.id : undefined);
}
function openExecutionSettings():void {
  dialog('#hardware-dialog');void inspectHardware();requestAnimationFrame(()=>document.getElementById('settings-execution')?.scrollIntoView({block:'start'}));
}
const chain:StageChain=mountStageChain({
  root:$('#terrain-controls'),staging:$('#stage-staging'),terrain:terrainControls,regionRoot:$('#region-controls'),renderRoot:$('#render-controls'),
  getSettings:()=>settings,getWorld:()=>world,
  getPlace:()=>{const place=world?.settlements?.find(s=>s.key===selectedTown);return place?{key:place.key,name:place.name??(place.main?translate('Main settlement'):place.key)}:undefined;},
  busy:()=>busy,
  cityScope:()=>{const keys=(world?.settlements??[]).filter(place=>cityScope==='all'||selectedCities.has(place.key)).map(place=>place.key).sort();return{mode:cityScope,count:keys.length,total:world?.settlements?.length??0,key:JSON.stringify([cityScope,keys])};},
  onCityScope:mode=>{cityScope=mode;syncCitySelection();},
  onChange:()=>{touchRecipe();regionControls.sync();syncUrbanBackend();},
  onRegionChange:()=>{touchRecipe();regionControls.sync();},
  onAppearance:()=>{projectRevision++;clearTimeout(renderTimer);renderTimer=setTimeout(()=>void refreshAppearance(),120);},
  run:runStage,reroll:rerollStage,runFamily,openPlace:()=>{if(world&&selectedTown){$('#places-panel').hidden=false;showInspector(selectedTown);}},
  openExecution:openExecutionSettings,
  onNeuralSelected:()=>void inspectNeuralSelection(),
  availability:()=>{const s=backendStatus();return{checked:s.checked,webgpu:s.webgpu,native:s.native.available,python:s.python.available};},
  heightmap:{
    source:host=>mountHeightmapSource(host,{getSettings:()=>settings,onLoaded:()=>{touchRecipe();terrainControls.sync();chain.sync();toast('Heightmap loaded. Create the relief to use it.');},
      importFile:()=>$<HTMLButtonElement>('#terrain-import-heightmap').click(),importImage:()=>$<HTMLInputElement>('#heightmap-file').click(),onError:error=>toast(String(error),true)}),
  },
  onFamily:family=>{syncFullGenerationButton(family);window.dispatchEvent(new CustomEvent('v2-edit-mode',{detail:family==='map'&&world&&!busy?'labels':'family'}));setText($('#generate-label'),familyActions[family][0]);syncPlacesPanel(family);},
});
const mapControls=mountMapControls(chain.body('map-naming'),chain.body('map-export'),{
  getSettings:()=>settings,getWorld:()=>world,busy:()=>busy,
  onNames:()=>{void redrawNames();},onExport:()=>dialog('#export-dialog'),
});
const nameOrigins:ReturnType<typeof mountNameOriginControls>[]=[];
function syncNameOrigins():void{nameOrigins.forEach(form=>form.sync());}
let labelBaseline:World|undefined;
const labelEditor=mountMapLabelEditor($('#edit-labels'),{
  getWorld:()=>previewBase?undefined:world,getSettings:()=>settings,onChange:redrawEditedLabels,onNames:()=>{void redrawNames();},
  map:$('#map'),getView:()=>client.viewer.getView(),
  focus:point=>{const view=client.viewer.getView();client.viewer.setView({...view,cx:point.x,cy:point.y});},
});
labelEditor.sync();
function redrawEditedLabels():void{
  // Recompose from the frozen generated names before applying the current edits.
  // Clearing a moved label or a free-text replacement therefore restores its original name and placement.
  void redrawNames();
}
registerMessages({'Names & labels':{en:'Names & labels',fr:'Noms et étiquettes'},'Edit name and visibility':{en:'Edit name and visibility',fr:'Modifier le nom et sa visibilité'}});
const riverEditorHost=document.createElement('div');riverEditorHost.id='river-editor';$('#edit-rivers').append(riverEditorHost);
const networkHost={map:$('#map'),getWorld:()=>previewBase?undefined:world,setWorld:applyDirectMapEdit,getView:()=>client.viewer.getView(),getSettings:()=>settings,busy:()=>busy,toast};
const riverEditor=mountNetworkEditor({...networkHost,panel:riverEditorHost,tools:['rivers']});
const roadEditor=mountNetworkEditor({...networkHost,panel:$('#edit-roads'),tools:['roads','draw'],getSettings:()=>settings});
$('#network-tool-slot').append($('.v2-network-shortcuts'));
const townMover=mountTownMoveEditor({map:$('#map'),toolbar:$('.v2-network-shortcuts'),getWorld:networkHost.getWorld,getView:networkHost.getView,busy:()=>busy,error:reportAppearanceError,
  deferred:{commit:async positions=>{
    if(!world)return;
    settings.region??={};
    settings.region.placement={...settings.region.placement,mode:'list',list:(world.settlements??[]).map(place=>({
      key:place.key,name:place.name??'',population:place.population,culture:place.culture,
      siteType:place.archetype,sitePrefs:{...place.options?.sitePrefs},position:positions.get(place.key)??{...place.center},
    }))};
    for(const [key,center]of positions){
      const previous=world.settlements?.find(place=>place.key===key)?.center;
      const scope=settings.urban?.local?.[key];
      if(previous)for(const edits of [scope?.layout?.overrides?.quarters,scope?.parcels?.overrides?.parcels])for(const edit of Object.values(edits??{}))if(edit.shape)edit.shape=translateLand(edit.shape,center.x-previous.x,center.y-previous.y);
      settings.local[key]={...settings.local[key],center:{...center}};
    }
    touchRecipe();await generate('region');
  }},
  commit:async(next,key,dx,dy)=>{
    const scope=settings.urban?.local?.[key];
    for(const edits of [scope?.layout?.overrides?.quarters,scope?.parcels?.overrides?.parcels])for(const edit of Object.values(edits??{}))if(edit.shape)edit.shape=translateLand(edit.shape,dx,dy);
    const oldNames=new Map(world?.names?.entries.map(e=>[e.id,e.anchor])??[]);
    for(const e of next.names?.entries??[]){const p=oldNames.get(e.id),edit=settings.naming?.labels?.[e.id];if(edit&&p&&(p.x!==e.anchor.x||p.y!==e.anchor.y))edit.anchor={...e.anchor};}
    await applyDirectMapEdit(next);
  }});
let namingRevision=0,namingWork:Promise<void>=Promise.resolve();
function redrawNames():Promise<void>{
  if(busy)return Promise.resolve();
  labelBaseline=undefined;
  const revision=++namingRevision;projectRevision++;
  $('#map-names-apply').setAttribute('aria-busy','true');
  namingWork=namingWork.catch(()=>{}).then(async()=>{
    if(revision!==namingRevision||busy)return;
    if(!world){mapControls.sync();syncNameOrigins();return;}
    pristine=renameMap(pristine??world,settings,getLanguage());
    world=applyBuildingEdits(pristine,mods).world;
    await client.show(world,true);
    if(revision===namingRevision){updateWorld(true);syncNameOrigins();inspectorForms.forEach(form=>form.sync());await refresh3dWorld();}
  }).catch(reportAppearanceError).finally(()=>{if(revision===namingRevision)$('#map-names-apply').setAttribute('aria-busy','false');});
  return namingWork;
}
function cityControlDefaults(key: string): Partial<Options> | undefined {
  const source = world, place = source?.settlements?.find(place => place.key === key);
  return source && place ? { ...place.options,
    culture: String(source.stats[`v2.culture:${key}`] ?? place.culture),
    population: Number(source.stats[`v2.population:${key}`] ?? place.population) } : undefined;
}
const urbanParts:[string,UrbanControlParts][]=[
  ['city-composition',{sections:['layout','footprint','growth','fortifications','ports'],extras:['header','phases','archetypes']}],
  ['city-roads',{sections:['streets'],extras:[]}],['city-parcels',{sections:['parcels'],extras:[]}],['city-programme',{sections:['programme'],extras:[]}],
  ['city-buildings',{sections:['placement'],extras:[]}],['city-houses',{sections:['house','workshop'],extras:['mixtures','catalogue']}],
];
{
  const forms=urbanParts.map(([stage,parts])=>{const host=document.createElement('div');chain.body(stage).append(host);return mountUrbanControls(host,()=>settings,()=>{mods=mods.filter(m=>!(m&&typeof m==='object'&&(m as BuildingEdit).type==='building'&&(cityScope==='all'||selectedCities.has((m as BuildingEdit).settlement))));touchRecipe();syncUrbanBackend();urbanControls.sync();},{kind:'global'},{...parts,
    targets:()=> (world?.settlements??[]).filter(place=>cityScope==='all'||selectedCities.has(place.key)).map(place=>place.key),
    placeDefaults:cityControlDefaults, disabled:()=>busy||!!world?.settlements?.length&&cityScope==='selection'&&!selectedCities.size});});
  urbanControls={sync:()=>batchUrbanSync(()=>forms.forEach(form=>form.sync())),dispose:()=>forms.forEach(form=>form.dispose())};
}
// Model and service URLs (terrain schema) belong to Settings, next to the service checks.
$('#hardware-dialog .dialog-actions').before($('#settings-endpoints-box'));
const neuralModelHost = document.createElement('div');
$('#hardware-dialog .dialog-actions').before(neuralModelHost);
const nativeNeuralManager = mountDesktopNeural(neuralModelHost);
const neuralModelManager = nativeNeuralManager ? { dispose() {} } : mountNeuralModelManager(neuralModelHost, () => new URL(settings.runtime?.neuralAssets ?? './neural/', location.href).href);
const modelShortcut = document.createElement('button'); modelShortcut.type = 'button'; modelShortcut.className = 'small'; modelShortcut.id = 'neural-models-open';
setText(modelShortcut, 'Downloaded neural models'); chain.body('relief-neural-base').append(modelShortcut);
function openNeuralModelsSettings():void {
  dialog('#hardware-dialog');
  const section=$<HTMLDetailsElement>('#neural-model-manager');section.open=true;
  requestAnimationFrame(()=>{section.scrollIntoView({block:'start'});const download=section.querySelector<HTMLButtonElement>('#neural-model-download-all');(download&&!download.disabled?download:section.querySelector<HTMLElement>('summary'))?.focus({preventScroll:true});});
}
let neuralSelectionRevision=0;
async function inspectNeuralSelection():Promise<void> {
  const revision=++neuralSelectionRevision,source=settings.runtime?.source;
  if(source==='neural-python')return;
  $('#source-neural').setAttribute('aria-busy','true');
  const assets=new URL(settings.runtime?.neuralAssets??'./neural/',location.href).href;
  try {
    const ready=nativeNeuralManager
      ? await (await import('./desktopNeural')).desktopNeuralModelsReady()
      : source==='neural-wasm' ? await (await import('../../../rust/bridge/neuralModels')).hasStoredNeuralModels(assets) : true;
    if(revision!==neuralSelectionRevision||settings.runtime?.source!==source||busy||assets!==new URL(settings.runtime?.neuralAssets??'./neural/',location.href).href)return;
    const capabilities=backendStatus();
    if(!ready)openNeuralModelsSettings();
    else if(!nativeNeuralManager&&source==='neural-wasm'&&capabilities.checked&&!capabilities.webgpu)openExecutionSettings();
  } catch { if(revision===neuralSelectionRevision&&settings.runtime?.source===source&&!busy)openNeuralModelsSettings(); }
  finally {if(revision===neuralSelectionRevision)$('#source-neural').setAttribute('aria-busy','false');}
}
modelShortcut.onclick = openNeuralModelsSettings;
function syncPlacesPanel(family:StageFamily=chain.family()):void{document.body.dataset.workbenchFamily=family;$('#places-panel').hidden=!['settlements','cities'].includes(family);}
$('#cities-select-all').onclick=()=>{selectedCities.clear();cityScope='all';selectedTown='';selectedBuilding=null;selectedSubdivision=undefined;selectionOutline.set();$('#inspector').hidden=true;document.querySelectorAll('[data-town]').forEach(button=>button.setAttribute('aria-pressed','false'));syncCitySelection();};
$('#cities-select-none').onclick=()=>{selectedCities.clear();cityScope='selection';syncCitySelection();};
$('#places-collapse').onclick=()=>{const panel=$('#places-panel'),collapsed=panel.dataset.collapsed!=='true';panel.dataset.collapsed=String(collapsed);$('#places-collapse').setAttribute('aria-expanded',String(!collapsed));setText($('#places-collapse'),collapsed?'+':'–');};

function disposeInspectorForms():void{inspectorForms.forEach(form=>form.dispose());inspectorForms=[];}
function syncUrbanBackend():void{const backend=settings.urban?.backend??settings.runtime?.backend??'typescript';$('#urban-controls').hidden=backend==='typescript';}
insertHTML($('#inspect-mode').parentElement!, 'beforeend', `<select id="inspect-target" aria-label="Inspection level" style="width:90px;padding:3px 5px;font-size:10px"><option value="settlement">Settlements</option><option value="quarter">Quarter</option><option value="block">Block</option><option value="parcel">Parcel</option><option value="house">House</option></select>`);
const editingTools=mountEditingTools({canEdit:()=>!!world&&!busy&&!previewBase&&!city3d?.active});
// Layer toggles live in the Display stages (widget:layer-*).
insertHTML($('#hardware-details'), 'afterend', `<details class="section"><summary>Local service addresses</summary><p class="hint">The desktop edition starts Rust automatically. Python can use an existing local service. Addresses stay on your machine.</p><label class="label" for="rust-server">Native Rust</label><input id="rust-server" type="url" value="${esc(bootRuntime.localServer)}"><label class="label" for="python-server">Neural Python</label><input id="python-server" type="url" value="${esc(bootRuntime.pythonServer)}"><button id="services-apply" class="small" style="margin-top:12px">Save & verify</button><p class="hint">Python and model configuration: <a href="./scientific/index.html#runtime" target="_blank" rel="noopener">read the atlas ↗</a></p></details>`);
insertHTML($('#project-file'), 'beforebegin', `<label class="label" for="import-scope">What should be imported from this file?</label><select id="import-scope"><option value="complete">Complete project · map + recipe + edits</option><option value="terrain">Territory · keep my settlement recipe</option><option value="urban">Settlement recipe · keep my territory</option></select><p class="hint" style="margin:8px 0 14px">Compositions retain the exact terrain and reset urban geometry: rebuild the settlements with the selected recipe.</p>`);
interface ToastAction { detail?: string; label: string; run(): void }
function toast(message: string, error = false, action?: ToastAction): void {
  clearTimeout(toastTimer); const element = $('#toast'), text = document.createElement('span'); setText(text, message); element.replaceChildren(text);
  if (action) {
    if (action.detail) { const detail = document.createElement('p'); detail.className = 'toast-detail'; detail.textContent = action.detail; element.append(detail); }
    const button = document.createElement('button'); button.type = 'button'; button.className = 'small toast-action'; setText(button, action.label);
    button.onclick = () => { element.hidden = true; action.run(); }; element.append(button);
  }
  element.dataset.error = String(error); element.hidden = false; toastTimer = setTimeout(() => { element.hidden = true; }, action ? 20000 : error ? 12000 : 5000);
}
const runtimeCapabilities = () => { const s = backendStatus(); return { checked: s.checked, webgpu: s.webgpu, native: s.native.available, python: s.python.available }; };
/** A recipe restored from another machine, or a service that went away, must not fail the run: switch to the best available backend first. */
async function ensureRuntimeBackends(): Promise<void> {
  if (runtimeNeedsProbe(settings, runtimeCapabilities())) { try { await refreshBackends(backendBindings); } catch (error) { log(String(error)); } }
  const notes = fallbackRuntime(settings, runtimeCapabilities());
  if (!notes.length) return;
  notes.forEach(note => log(note));
  toast(notes.map(note => translate(note)).join(' '), false, { label: RUNTIME_FALLBACK.open, run: openExecutionSettings });
  backendBindings.onRuntimeChange(); settingsPanel.render();
}
/** A missing backend names the best available alternative and opens Settings on demand. */
async function reportGenerationFailure(message: string): Promise<void> {
  const failure = backendFailure(message);
  if (!failure) { toast(message, true); return; }
  try { await refreshBackends(backendBindings); } catch { /* The suggestion uses the last known capabilities. */ }
  const alternative = backendAlternative(settings, runtimeCapabilities(), failure);
  toast(message, true, { detail: alternative ? translate(RUNTIME_FALLBACK.suggest).replace('{alternative}', translate(alternative)) : translate(RUNTIME_FALLBACK.check),
    label: RUNTIME_FALLBACK.open, run: openExecutionSettings });
}
const logLine=(entry:{time:Date;message:string}):string=>`${entry.time.toLocaleTimeString(numberLocale())}  ${translate(entry.message)}`;
let logScroll=0;
function scrollLog():void{if(logScroll)return;logScroll=requestAnimationFrame(()=>{logScroll=0;const el=$('#job-log');el.scrollTop=el.scrollHeight;});}
function renderLog():void{$('#job-log').textContent=logs.map(logLine).join('\n');scrollLog();}
/** Append-only: the whole log is re-rendered only when the oldest line drops or the language changes. */
function log(message: string): void {
  const entry={time:new Date(),message};logs.push(entry);
  if(logs.length>150){logs.shift();renderLog();return;}
  const el=$('#job-log');el.append((logs.length>1?'\n':'')+logLine(entry));scrollLog();
}
function dialog(id: string): void { if(id==='#export-dialog')syncExportOptions();$<HTMLDialogElement>(id).showModal(); }
client.onEngineReset=()=>chain.clearResults();
let workbenchLayout: ReturnType<typeof mountWorkbenchLayout> | undefined, roadDisplay: ReturnType<typeof mountRoadDisplayControl> | undefined;
const regionalParents=new WeakMap<V2Settings,string>([[settings,regionalParentKey(settings)]]);
function resetRegionEdits(): void {
  mods=resetRegionalChildren(settings,mods);selectedCities.clear();cityScope='all';smallPlaceRecipe=undefined;
  for(const source of new Set([world,pristine]))if(source){source.options={...source.options,culture:settings.options.culture};for(const place of source.settlements??[]){place.culture=settings.options.culture;source.stats['v2.culture:'+place.key]=settings.options.culture;}}
  chain.clearCityResults();disposeInspectorForms();$('#inspector').hidden=true;selectedBuilding=null;selectedSubdivision=undefined;selectionOutline.set();
  $<HTMLInputElement>('#seed').value=settings.options.seed;
  urbanControls.sync();regionControls.sync();syncNameOrigins();
}
function touchRecipe(): void { workbenchLayout?.sync();const parent=regionalParentKey(settings),previous=regionalParents.get(settings);if(previous!==undefined&&previous!==parent)resetRegionEdits();regionalParents.set(settings,regionalParentKey(settings));projectRevision++; scheduleAutosave();
  // A recipe change drops the place in flight; the pass resumes only while the city recipe still matches the displayed map.
  smallPlaces?.cancel(); smallPlaces?.start(); updateExtent(); scheduleChainSync(); setText($('#footer-status'), world ? 'Settings changed · ready to generate' : 'Terrain and water, in one click'); }
function updateExtent(): void { setDynamicText($('#extent-hint'), ()=>formatDistance(adaptedExtent(settings),getDistanceUnit(),numberLocale(),true)); }
function syncControls(): Promise<void> {
  if (!world?.stats['v2.previewStage']) previewBase = undefined;
  document.querySelectorAll<HTMLInputElement|HTMLSelectElement>('[data-option]').forEach(input => { const key = input.dataset.option!; const value = key.startsWith('center.') ? settings.options.center?.[key.endsWith('x') ? 'x' : 'y'] : (settings.options as unknown as Record<string,unknown>)[key]; input.value = String(value ?? (key === 'sprawl' ? 1 : input.tagName === 'SELECT' ? 'auto' : '')); });
  const legacyCount=document.querySelector<HTMLInputElement>('#town-count');if(legacyCount)legacyCount.value=String(settings.settlementCount);
  $<HTMLInputElement>('#rust-server').value=settings.runtime?.localServer??bootRuntime.localServer??'';
  $<HTMLInputElement>('#python-server').value=settings.runtime?.pythonServer??bootRuntime.pythonServer??'';
  terrainControls.sync();regionControls.sync();urbanControls.sync();syncUrbanBackend();updateExtent();
  syncDisplayWidgets();
  renderControls.sync();mapControls.sync();syncNameOrigins();return client.setAppearance(settings).catch(reportAppearanceError);
}
function selectTab(tab: string): void { currentTab = tab; chain.selectFamily(tab==='terrain'?'region':tab==='map'?'map':tab==='cities'?'cities':'settlements'); }
function updateProgress(p: V2Progress): void {
  setText($('#progress-label'), p.label);
  const meter=$<HTMLProgressElement>('#progress');
  if(p.total>0)meter.value=Math.max(0,Math.min(100,100*p.completed/p.total));else meter.removeAttribute('value');
  meter.setAttribute('aria-labelledby','progress-label');meter.setAttribute('aria-describedby','progress-detail');
  const cache = p.cache === 'memory' ? 'Memory cache reused' : p.cache === 'disk' ? 'Terrain restored from disk' : 'Computing in a worker';
  chain.progress(p);
  setText($('#progress-detail'), p.detail??cache); log(p.label + (p.cache ? ` · ${p.cache}` : ''));
}
function setBusy(value: boolean): void {
  if(value)window.dispatchEvent(new CustomEvent('v2-edit-mode',{detail:'busy'}));
  labelEditorHostInert(value);
  busy = value; $('#progress-card').hidden = !value; $('#hardware-led').classList.toggle('busy-led',value); $('#app').setAttribute('aria-busy',String(value));
  for(const selector of ['#terrain-controls .chain-scroll','#urban-settings-panel','#inspector','#editor-content']){const panel=document.querySelector<HTMLElement>(selector);if(panel)panel.inert=value;}
  for (const id of ['generate-region','run-chain','relief-symbolic-open','relief-modify-open','terrain-only','region-only','towns-only','cities-select-all','cities-select-none','random-seed','expert-apply','export-go','save-map','clear-heightmap','preview-close']) $<HTMLButtonElement>(`#${id}`).disabled = value;
  document.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLButtonElement>('[data-option],#culture-environment,#culture-random,#town-count,#project-file,#heightmap-file,#terrain-controls .chain-scroll input,#terrain-controls .chain-scroll select,#terrain-controls .chain-scroll button,#urban-settings-panel input,#urban-settings-panel select,#urban-settings-panel button').forEach(e=>e.disabled=value);
  document.querySelectorAll<HTMLButtonElement>('[data-relief],#inspector button').forEach(e=>e.disabled=value);
  if (!value && elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = undefined; }
  terrainControls.sync();regionControls.sync();urbanControls.sync();inspectorForms.forEach(form=>form.sync());if(!value)syncUrbanBackend();
  $<HTMLButtonElement>('#cancel-job').disabled=false;
  syncCitySelection();mapControls.sync();syncNameOrigins();riverEditor.sync();roadEditor.sync();townMover.sync();editingTools.sync();workbenchLayout?.sync();
}
function labelEditorHostInert(value:boolean):void{const panel=document.querySelector<HTMLElement>('.map-label-editor');if(panel)panel.inert=value;}
// ── Small places built in the background (smallPlaces.ts) ───────────────────────────────
for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown'] as const)
  window.addEventListener(type, event => { if (type !== 'pointermove' || (event as PointerEvent).buttons) lastGesture = performance.now(); }, { passive: true, capture: true });
function smallPlaceRecipeKey(): string { return cityStageValidityKeys(settings, pristine, JSON.stringify(['all', []])).get('city-houses')!; }
const GESTURE_QUIET_MS = 400;
smallPlaces = new SmallPlaceQueue({
  canonicalOrder: true,
  canBuild: (base, keys) => boundedSmallPlaceRun(base, settings, keys, effectiveRegion(settings).autoBuildPopulation),
  base: () => {
    if (busy || !pristine || !world || previewBase || !pristine.urban || pristine.stats['v2.cityOutput']
      || smallPlaceRecipe === undefined || smallPlaceRecipe !== smallPlaceRecipeKey()) return undefined;
    return { world: pristine, limit: effectiveRegion(settings).autoBuildPopulation, recipe: smallPlaceRecipe,
      backend: settings.urban?.backend ?? settings.runtime?.backend ?? 'typescript' };
  },
  focus: () => { const view = client.viewer.getView(); return Number.isFinite(view.cx) && Number.isFinite(view.cy) ? { x: view.cx, y: view.cy } : undefined; },
  // One bounded batch uses the existing parallel targeted-city path; silent progress.
  build: (base, keys) => client.run('towns', settings, base, undefined, undefined, undefined, [...keys], undefined, () => undefined, true),
  release: () => client.releaseUrbanLanes(),
  apply: async (result, keys) => {
    labelBaseline = undefined; applyLabelEdits(result, settings.naming?.labels);
    pristine = result; world = applyBuildingEdits(result, mods).world;
    log(`Built in the background: ${keys.map(key => settlementDisplayName(world!, key, settings) ?? key).join(', ')}`);
    // Same world swap as after a targeted build: the place now has its `urban` layer and detail 'eager'.
    for (const key of keys) window.dispatchEvent(new CustomEvent('v2-place-built', { detail: { key, world } }));
    await client.show(world, true); updateWorld(true); scheduleAutosave();
  },
  idle: async () => {
    for (;;) {
      const quiet = performance.now() - lastGesture;
      if (busy || quiet < GESTURE_QUIET_MS) { await new Promise(resolve => setTimeout(resolve, busy ? 250 : GESTURE_QUIET_MS - quiet)); continue; }
      await new Promise<void>(resolve => typeof requestIdleCallback === 'function' ? requestIdleCallback(() => resolve(), { timeout: 1000 }) : setTimeout(resolve, 50));
      if (!busy && performance.now() - lastGesture >= GESTURE_QUIET_MS) return;
    }
  },
  onError: (keys, error) => log(`Background build of ${keys.join(', ')} failed: ${error instanceof Error ? error.message : String(error)}`),
});
/** Test and shot scripts: terrain, placement, then the main town only (secondary places stay lazy for the background pass). */
async function generateMainOnly(): Promise<void> {
  await generate('terrain'); if (!world) return;
  await generate('region'); if (!world?.settlements?.length) return;
  await generate('town', world.settlements.find(place => place.main)?.key ?? 'main');
}
async function generate(action: Action, key?: string, townStage?:V2TownStage, terrainStage?: string, keys?: string[], cityOutput?: string): Promise<boolean> {
  if (busy) return false; cancelled = false;
  const previousSeed = settings.options.seed; migrateUrbanSeeds(settings);
  if (previousSeed !== settings.options.seed) { $<HTMLInputElement>('#seed').value = settings.options.seed; projectRevision++; }
  if (action !== 'terrain' && action !== 'all' && !world) { toast('Create the territory first.'); selectTab('terrain'); return false; }
  if (['all', 'region', 'settlements'].includes(action)) workbenchLayout?.prepareGeneration();
  setBusy(true);
  // A user run takes the engine: the background place in flight (if any) completes and is dropped.
  await smallPlaces?.stop(); if (cancelled) return false;
  await ensureRuntimeBackends(); if (cancelled) return false;
  const started = performance.now(); const revision = projectRevision; let completed = false;
  if (['terrain','region','settlements','town'].includes(action)) chain.clearCityResults();
  chain.beginRun(action === 'town' ? [] : stagesForAction(action, townStage, terrainStage, settings.terrain?.procedural?.coastAfter));
  setText($('#progress-label'), 'Preparing computation…'); setText($('#progress-time'), '0 s');
  elapsedTimer = setInterval(()=>{ setText($('#progress-time'), `${Math.round((performance.now()-started)/1000)} s`); },500);
  log(`Started: ${action} · seed ${settings.options.seed}`);
  try {
    const retainedSelection = selectedBuilding ? { ...selectedBuilding } : undefined, retainedSubdivision = selectedSubdivision;
    const result = await client.run(action,settings, previewBase?.pristine ?? previewBase?.world ?? pristine ?? world,key,townStage,terrainStage,keys,cityOutput);
    if (cancelled) return false;
    if (terrainStage && terrainStage !== 'cover-climate') {
      if (!world?.stats['v2.previewStage']) previewBase = { world, pristine };
    } else previewBase = undefined;
    labelBaseline=undefined;applyLabelEdits(result,settings.naming?.labels);
    pristine = result;
    const edited = applyBuildingEdits(result, mods); world = edited.world;
    if (edited.skipped) log(`${edited.skipped} edit(s) no longer match their original building.`);
    setText($('#progress-label'), 'Drawing the map…');$<HTMLButtonElement>('#cancel-job').disabled=true;log('Preparing the scene and drawing in the render worker…');
    const showStart=performance.now();await client.show(world,action === 'town' || action === 'towns');canvas.hidden=false; $('#empty-map').hidden = true;
    updateWorld();void refresh3dWorld();performance.measure('v2:show',{start:showStart}); if (['region','settlements'].includes(action)) selectTab('settlements'); else if (['all','towns'].includes(action)) selectTab('cities');
    setText($('#footer-status'), `Map ready · ${((performance.now()-started)/1000).toFixed(1)} s`);
    const completion = `Finished in ${((performance.now()-started)/1000).toFixed(2)} s · relief ${String(world.stats.backend ?? 'typescript-cpu')}`;
    const hasBuiltTowns = !!world.urban || world.settlements?.some(place => !!place.urban);
    log(hasBuiltTowns ? `${completion} · cities ${String(world.stats['v2.urbanBackend'] ?? 'typescript-cpu')}` : completion);
    const refused=Object.entries(world.stats).filter(([name])=>name.startsWith('v2.urbanRefusals:')).reduce((count,[,value])=>count+Number(value||0),0);
    if(refused){log(`${refused} construction request(s) refused by the engine: see the settlement report.`);toast(`${refused} construction(s) refused. Each settlement report explains the constraints.`,true);}
    if(world.stats['settlements.warning']){log(String(world.stats['settlements.warning']));if(!refused)toast(String(world.stats['settlements.warning']));}
    if (key && retainedSelection?.settlement === key) {
      const buildings = townUrban(world, key)?.buildings ?? [], identity = retainedSelection.building as UrbanBuilding & { nativeRequestId?: string; nativeId?: string };
      const index = buildings.findIndex(b => identity.nativeRequestId ? (b as typeof identity).nativeRequestId === identity.nativeRequestId : identity.nativeId ? (b as typeof identity).nativeId === identity.nativeId : buildingSignature(b) === buildingSignature(identity));
      if (index >= 0) showBuilding({ settlement: key, index, building: buildings[index] }); else showInspector(key);
    } else if (key && retainedSubdivision?.key === key) {
      if (!inspectSubdivision(retainedSubdivision.kind, retainedSubdivision.point, key, retainedSubdivision.id)) showInspector(key);
    } else if (key) showInspector(key);
    smallPlaceRecipe = ['town','towns','all'].includes(action) && !cityOutput && !terrainStage ? smallPlaceRecipeKey() : undefined;
    completed = true;
  } catch (e) { if (!cancelled) { const message = e instanceof Error ? e.message : String(e); log(`Failed: ${message}`); if (message.startsWith('plan_refused:')) toast('This model does not fit the parcel. The previous building is retained.',true); else void reportGenerationFailure(message); } }
  finally { chain.endRun(completed); setBusy(false); if (projectRevision !== revision) setText($('#footer-status'), 'New settings ready to generate'); if (completed) smallPlaces?.start(); }
  return completed;
}
/** `keepInspector`: a background place arrived; the user's open inspector stays as it is. */
function updateWorld(keepInspector = false): void {
  if (!world) return;
  labelEditor.sync();
  riverEditor.sync();roadEditor.sync();townMover.sync();editingTools.sync();
  mapControls.sync();
  if(!keepInspector)disposeInspectorForms();regionControls.sync();terrainControls.sync();city3d?.refresh();
  const towns = (world.settlements ?? []).map(place=>({...place,name:settlementDisplayName(world!,place.key,settings)}));
  setText($('#map-metrics'), `${world.terrain.rivers.length} watercourses\n${towns.length} settlements`);
  const preview = stageById.get(String(world.stats['v2.previewStage'] ?? ''));
  $('#preview-close').hidden = !preview || !previewBase?.world;
  setText($('#towns-count'), String(towns.length));
  setHTML($('#settlement-list'), towns.length ? [...towns].sort((a,b)=>b.population-a.population).map((s,index,list)=>`${index===0||demographicClass(list[index-1].population)!==demographicClass(s.population)?`<h3 class="settlement-group">${esc(translate(demographicClass(s.population)))}</h3>`:''}<div class="settlement-choice"><input type="radio" name="city-target" data-city-select="${esc(s.key)}" aria-label="${esc(translate('Select {name} for generation').replace('{name}',s.name??s.key))}" ${selectedCities.has(s.key)?'checked':''}><button class="settlement-item" data-town="${esc(s.key)}" aria-pressed="${selectedTown===s.key}"><span class="settlement-dot ${(s.main ? world?.urban : s.urban)?'ready':''}"></span><span class="grow"><strong>${nameHTML(s.name,s.main?'Main settlement':s.key)}</strong><small>${populationMarkup(s.key,s.population)} · <span>${esc(s.archetype)}</span></small>${reachedPopulation(s.key,s.population)?.shortfallHouseholds?`<small class="warning" title="${esc(populationShortfallText(reachedPopulation(s.key,s.population),popFormat()))}">⚠ ${esc(populationShortfallText(reachedPopulation(s.key,s.population),popFormat()))}</small>`:''}<small class="settlement-stage">${cityStageLabel(s.key)}</small></span><span class="count-badge">${(s.main ? world?.urban : s.urban)?'↗':'＋'}</span></button></div>`).join('') : '<p class="hint">Create settlement sites to select a place.</p>');
  const activities=activitySitesOf(world);
  if(activities.length)insertHTML($('#settlement-list'),'beforeend',`<h3 class="settlement-group">Isolated buildings · ${activities.length}</h3>${[...activities].sort((a,b)=>b.buildings.length-a.buildings.length).map(site=>`<button class="activity-place" data-activity="${esc(site.id)}"><strong>${esc(site.template)}</strong><small>${esc(site.kind)} · ${site.buildings.length}</small></button>`).join('')}`);
  document.querySelectorAll<HTMLButtonElement>('[data-activity]').forEach(button=>button.onclick=()=>{const site=activities.find(site=>site.id===button.dataset.activity);if(!site)return;client.viewer.setView({cx:site.x,cy:site.y,scale:2});showInspector(site.parent);setHTML($('#building-inspector'),`<div class="edit-building"><h3>${esc(site.template)}</h3><p>${esc(site.kind)} · ${site.buildings.length} buildings · ${site.residents} inhabitants</p><p class="hint">${esc(site.resource)} · ${esc(site.culture)}</p></div>`);});
  document.querySelectorAll<HTMLButtonElement>('[data-town]').forEach(b=>b.onclick=()=>{selectedCities.clear();selectedCities.add(b.dataset.town!);cityScope='selection';syncCitySelection();showInspector(b.dataset.town!,true);});
  document.querySelectorAll<HTMLInputElement>('[data-city-select]').forEach(input=>input.onchange=()=>{const key=input.dataset.citySelect!;if(!input.checked)return;selectedCities.clear();selectedCities.add(key);cityScope='selection';smallPlaces?.prioritize(key);syncCitySelection();showInspector(key);});
  syncCitySelection();
  if (!keepInspector) { $('#inspector').hidden = true; selectedBuilding = null; selectedSubdivision = undefined; selectionOutline.set(); }
  syncPlacesPanel(); chain.sync();
}
/** Direct map edits replace the current snapshot; the full project saves that result. */
async function applyDirectMapEdit(next:World):Promise<void>{
  if(busy)return;
  labelBaseline=undefined;
  previewBase=undefined;
  if(next.terrain!==world?.terrain)next.stats={...next.stats,'v2.waterEditRevision':Math.max(Number(next.stats['v2.waterEditRevision']??0),Number(world?.stats['v2.waterEditRevision']??0)+1)};
  pristine=next;mods=[];world=next;smallPlaceRecipe=undefined;
  client.invalidateRetained();touchRecipe();
  await client.show(next,true);updateWorld();void refresh3dWorld();
}
function showInspector(key: string, focus = false): void {
  if (!world) return; const source = world.settlements?.find(s=>s.key===key); if (!source) return; const s={...source,name:settlementDisplayName(world,key,settings)};
  if (!townUrban(world,key)) smallPlaces?.prioritize(key);
  window.dispatchEvent(new CustomEvent('v2-edit-mode',{detail:'selection'}));
  disposeInspectorForms();selectedTown = key; selectedBuilding = null; selectedSubdivision = undefined; selectionOutline.set();selectedCities.clear();selectedCities.add(key);cityScope='selection';syncCitySelection();
  document.querySelectorAll<HTMLButtonElement>('[data-town]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.town===key)));$('#places-panel').hidden=false;chain.sync();
  const urban = townUrban(world,key), local = settings.local[key] ?? {};
  const current = { ...settings.options, sprawl: settings.options.sprawl ?? 1, population: s.population, culture: s.culture, ...local } as Record<string, unknown>;
  if(chain.family()!=='cities')chain.selectFamily('cities');
  $('#inspector').dataset.scope='settlement';
  $('#inspector').hidden = false;
  setHTML($('#inspector'), `<button class="close" aria-label="Close inspector">×</button><span class="eyebrow">Local settings</span><h2>${nameHTML(s.name,s.main?'Main settlement':s.key)}</h2><p class="hint">${reachedPopulation(key,s.population)?populationMarkup(key,s.population):`${numberHTML(s.population)} inhabitants`} · <span>${esc(s.archetype)}</span></p>${populationShortfallText(reachedPopulation(key,s.population),popFormat())?`<p class="warning">${esc(populationShortfallText(reachedPopulation(key,s.population),popFormat()))}</p>`:''}<div class="breadcrumbs">Territory › ${nameHTML(s.name,s.key)}</div><p class="inspect-note">The fields show the current values. Previous stages and other settlements are retained.</p><label class="label">Culture</label><select id="local-culture">${options(CULTURE_LABELS)}</select><div class="control-grid"><div><label class="label">Population</label><input id="local-population" type="number" min="1" max="5000000" value="${current.population}"></div><div><label class="label">Sprawl</label><input id="local-sprawl" type="number" min="0.5" max="2" step="0.1" value="${current.sprawl ?? 1}"></div></div><label class="label">Fortifications</label><select id="local-walls">${options([['none','None'],['single','Simple'],['double','Double'],['auto','Automatic']])}</select><button class="primary" id="build-town">${urban?'Rebuild this settlement':'Build this settlement'}</button><p class="hint" style="margin-top:8px">${urban ? `${urban.quarters.length} quarters · ${urban.parcels.length} parcels · ${urban.buildings.length} buildings` : 'Site reserved · build on demand'}</p><details class="section"><summary>This settlement’s stages</summary><ol class="pipeline-list"><li>Plan & footprint<span>Population, culture and site.</span></li><li>Quarters & streets<span>Growth, layout and hierarchy.</span></li><li>Blocks & parcels<span>Land, access and occupation.</span></li><li>Buildings & houses<span>Typologies, envelopes and landmarks.</span></li></ol></details><details class="section"><summary>Full local recipe</summary><p class="hint">All exposed urban settings: growth plans, landmarks, defences and preferences. Terrain settings are global.</p><textarea id="local-json" spellcheck="false">${esc(JSON.stringify(local,null,2))}</textarea><button id="local-apply" class="small">Apply</button><button id="local-reset" class="quiet small">Restore default settings</button></details><div id="building-inspector"></div>`);
  $('#inspector .close').onclick = ()=>{ $('#inspector').hidden=true; selectedBuilding=null; selectedSubdivision=undefined; selectionOutline.set(); };
  for (const name of ['culture','population','sprawl','walls']) { const input = $<HTMLInputElement|HTMLSelectElement>(`#local-${name}`); input.value = String(current[name] ?? ''); input.onchange=()=>{ if(input instanceof HTMLInputElement&&!input.checkValidity()){input.reportValidity();return;} const next = { ...settings.local[key] } as Record<string,unknown>; if (input.value==='') delete next[name]; else next[name]=name==='population'||name==='sprawl'?Number(input.value):input.value; resetUrbanChildren(settings,{kind:'settlement',key},name==='culture'||name==='population'?'layout.culture':'layout.tissue'); mods=mods.filter(m=>!(m&&typeof m==='object'&&(m as BuildingEdit).settlement===key)); settings.local[key]=next;if(name==='culture' && (settings.urban?.backend??settings.runtime?.backend)!=='typescript')writeUrbanControl(settings,{kind:'settlement',key},'layout.culture',input.value||undefined); touchRecipe(); urbanControls.sync(); inspectorForms.forEach(form=>form.sync()); }; }
  groupCultureSelector($<HTMLSelectElement>('#local-culture'));
  const editPlaceName=document.createElement('button');editPlaceName.type='button';editPlaceName.className='quiet small';editPlaceName.id='edit-place-name';setText(editPlaceName,'Edit name and visibility');
  editPlaceName.onclick=()=>{chain.selectFamily('map');labelEditor.selectPlace(key);};$('#inspector h2').after(editPlaceName);
  const origin=document.createElement('section');$('#build-town').before(origin);
  inspectorForms.push(mountNameOriginControls(origin,'city-name-origin',{getSettings:()=>settings,busy:()=>busy,city:key,getCulture:()=>settings.local[key]?.culture ?? s.culture,changed:()=>{void redrawNames();}}));
  $('#build-town').onclick=()=>void generate('town',key);
  const reroll=document.createElement('button');reroll.id='reroll-town';reroll.type='button';reroll.className='settlement-reroll';reroll.innerHTML='<i class="art art-dice" aria-hidden="true"></i>';
  registerMessages({'Rebuild this settlement differently':{en:'Rebuild this settlement differently',fr:'Reconstruire ce lieu autrement'}});reroll.title=translate('Rebuild this settlement differently');reroll.setAttribute('aria-label',reroll.title);
  const rebuildActions=document.createElement('div');rebuildActions.className='settlement-rebuild-actions';$('#build-town').before(rebuildActions);rebuildActions.append($('#build-town'),reroll);$('#build-town').classList.add('small');$('#build-town').textContent='↻ '+translate('Regenerate area');
  reroll.onclick=()=>{if(busy)return;resetUrbanChildren(settings,{kind:'settlement',key},'layout.tissue');mods=mods.filter(m=>!(m&&typeof m==='object'&&(m as BuildingEdit).settlement===key));rerollSettlement(settings,key);$<HTMLInputElement>('#seed').value=settings.options.seed;touchRecipe();void generate('town',key);};
  const backend=settings.urban?.backend??settings.runtime?.backend??'typescript';
  if(backend!=='typescript'){
    insertHTML(rebuildActions, 'afterend', `<div class="section"><span class="eyebrow">Proceed stage by stage</span><div class="urban-stage-buttons">${[['layout','1 · Plan & quarters'],['parcels','2 · Blocks & parcels'],['programme','3 · Programme'],['buildings','4 · Houses']].map(([stage,label])=>`<button class="small" data-town-stage="${stage}">${label}</button>`).join('')}</div><p class="hint">These are actual stopping points in the Rust engine. The map shows only the layers already built.</p></div><details class="section"><summary>Rust settings for this settlement</summary><p class="hint">Current values for this settlement. Plan, parcelling and houses each have their own configuration.</p><textarea id="local-rust-json" spellcheck="false">${esc(JSON.stringify(settings.urban?.local?.[key]??{},null,2))}</textarea><button id="local-rust-apply" class="small">Apply to this settlement</button></details>`);
    document.querySelectorAll<HTMLButtonElement>('[data-town-stage]').forEach(button=>button.onclick=()=>void generate('town',key,button.dataset.townStage as V2TownStage));
    $('#local-rust-apply').onclick=()=>{try{const value=JSON.parse($<HTMLTextAreaElement>('#local-rust-json').value);const candidate={...settings,urban:{...settings.urban,backend,local:{...settings.urban?.local,[key]:value}}};validateSettings(candidate);settings=candidate;touchRecipe();toast('Local Rust settings saved. Choose the stage to rebuild.');}catch(e){toast(String(e),true);}};
    insertHTML(rebuildActions,'afterend','<div class="section" id="local-urban-controls"></div>');
    inspectorForms.push(mountUrbanControls($('#local-urban-controls'),()=>settings,()=>{touchRecipe();$<HTMLTextAreaElement>('#local-rust-json').value=JSON.stringify(settings.urban?.local?.[key]??{},null,2);},{kind:'settlement',key,defaults:cityControlDefaults(key)},{hideReset:true}));
    const native=nativeCityRecords(world)?.[key];
    if(native){
      const refusals=native.stage==='buildings'?native.scene?.refusals??[]:[],warnings=native.warnings??[];
      insertHTML($('#inspector'), 'beforeend', `<details class="section" ${refusals.length||warnings.length?'open':''}><summary>Engine report · ${refusals.length} refusals</summary><p class="hint">${esc(populationText(s.population,reachedPopulation(key,s.population),popFormat()))}</p>${populationShortfallText(reachedPopulation(key,s.population),popFormat())?`<p class="warning">${esc(populationShortfallText(reachedPopulation(key,s.population),popFormat()))}</p>`:''}<p class="hint">Stage: ${esc(native.stage)} · ${esc(native.backend)}. ${native.lastBuildingRequests??0} house request(s) recomputed in the last run.</p>${warnings.length?`<pre class="job-log">${esc(warnings.map(warning=>translate(warning)).join('\n'))}</pre>`:'<p class="hint">No generation warnings.</p>'}${refusals.slice(0,20).map(refusal=>{const id=(native.sites??native.requests)?.find(r=>r.id===refusal.id||r.parcel_id===refusal.parcel_id)?.id??refusal.id;return `<details class="section"><summary>House ${esc(id)}</summary><p class="warning">${esc(refusal.message)}</p><textarea class="refusal-json" spellcheck="false">${esc(JSON.stringify(settings.urban?.buildings?.[`${key}/${id}`]??{},null,2))}</textarea><button class="small" data-retry-house="${esc(id)}">Retry with these settings</button><p class="hint">Enter {} to restore settlement inheritance. Recipe limits remain enforced by the engine.</p></details>`;}).join('')}</details>`);
      document.querySelectorAll<HTMLButtonElement>('[data-retry-house]').forEach(button=>button.onclick=()=>{try{const value=JSON.parse(button.parentElement!.querySelector('textarea')!.value),id=button.dataset.retryHouse!,next={...settings,urban:{...settings.urban,backend,buildings:{...settings.urban?.buildings,[`${key}/${id}`]:value}}};validateSettings(next);settings=next;touchRecipe();void generate('town',key,'buildings');}catch(e){toast(String(e),true);}});
    }
  }
  const localOverrides=settings.urban?.local?.[key];
  const deletedEntries=[...Object.entries(localOverrides?.layout?.overrides?.quarters??{}).filter(([,v])=>v?.deleted).map(([id])=>({kind:'quarter' as const,id})),...Object.entries(localOverrides?.parcels?.overrides?.parcels??{}).filter(([,v])=>v?.deleted).map(([id])=>({kind:'parcel' as const,id}))];
  mountDeletedSubdivisions($('#inspector'),getLanguage()==='fr',deletedEntries,(kind,id)=>{try{
    const local={...settings.urban?.local},scope={...local[key]};
    if(kind==='quarter'){const quarters={...scope.layout?.overrides?.quarters},value={...quarters[id]};delete value.deleted;quarters[id]=value;scope.layout={...scope.layout,overrides:{...scope.layout?.overrides,quarters}};}
    else{const parcels={...scope.parcels?.overrides?.parcels},value={...parcels[id]};delete value.deleted;parcels[id]=value;scope.parcels={...scope.parcels,overrides:{...scope.parcels?.overrides,parcels}};}
    local[key]=scope;const next={...settings,urban:{...settings.urban,backend:settings.urban?.backend??settings.runtime?.backend??'rust' as const,local}};validateSettings(next);settings=next;touchRecipe();const stage=world?.stats[`v2.urbanStage:${key}`] as V2TownStage|undefined;void generate('town',key,stage??(kind==='quarter'?'layout':'parcels'));
  }catch(e){toast(String(e),true);}});
  $('#local-apply').onclick=()=>{ try { const patch=JSON.parse($<HTMLTextAreaElement>('#local-json').value); const candidate={...settings,local:{...settings.local,[key]:patch}}; validateSettings(candidate); settings=candidate; touchRecipe(); toast('Local recipe saved. Rebuild this settlement to apply it.'); }catch(e){toast(String(e),true);} };
  setText($('#local-reset'),'Use parent settings');$('#local-reset').title=translate('Remove local overrides and regenerate using the parent settings.');rebuildActions.append($('#local-reset'));
  $('#local-reset').onclick=()=>{if(busy)return;delete settings.local[key];if(settings.urban?.local)delete settings.urban.local[key];if(settings.urban?.buildings)for(const id of Object.keys(settings.urban.buildings))if(id.startsWith(`${key}/`))delete settings.urban.buildings[id];touchRecipe();void generate('town',key);};
  organizeInspector($('#inspector'));
  if (focus && city3d?.active) city3d.focus(s.center, s.radius);
  else if (focus) client.viewer.setView({cx:s.center.x,cy:s.center.y,scale:Math.min(3,Math.min($('#map').clientHeight,$('#map').clientWidth)/Math.max(600,s.radius*3))});
}
function showBuilding(hit: NonNullable<ReturnType<typeof buildingAt>>): void {
  showInspector(hit.settlement); selectedBuilding = hit;$('#inspector').dataset.scope='house';
  const b=hit.building;
  selectionOutline.set([b.poly, ...b.courtyards ?? []]);
  setHTML($('#building-inspector'), `<div class="edit-building"><span class="eyebrow">House ${hit.index+1}</span><h3>The last detail</h3><p class="hint">${esc(b.kind)} · ${esc(b.arch || 'generated typology')}</p><div class="control-grid"><div><label class="label">Storeys</label><input id="house-storeys" type="number" min="1" max="100" value="${b.storeys??1}"></div><div><label class="label"><span data-i18n="Height">${translate("Height")}</span> (<span data-house-height-unit>${getDistanceUnit()}</span>)</label><input id="house-height" data-distance-unit="${getDistanceUnit()}" type="number" min="${.5/unitFactor(getDistanceUnit())}" max="${1000/unitFactor(getDistanceUnit())}" step="any" value="${(b.height??3)/unitFactor(getDistanceUnit())}"></div></div><label class="label">Roof</label><select id="house-roof">${options(['gable','hip','flat','dome','pyramidal','pagoda','thatch-round','none','tiled-hip','conical','barrel','terraced'])}</select><label class="label">Material</label><input id="house-material" type="text" maxlength="100" value="${esc(b.material??'')}"><details class="section"><summary>Building properties</summary><textarea id="house-json" spellcheck="false">${esc(JSON.stringify({kind:b.kind,arch:b.arch,material:b.material},null,2))}</textarea><p class="hint">Architectural metadata is exported; its appearance depends on the renderer.</p></details><button id="house-apply">Save house</button><button id="house-undo" class="quiet small">Undo the last edit</button></div>`);
  groupCultureSelector($<HTMLSelectElement>('#local-culture'));
  $<HTMLSelectElement>('#house-roof').value=b.roof??'gable';
  $('#house-apply').onclick=()=>{
    try {
      if (!selectedBuilding || !pristine) return;
      const source=townUrban(pristine,hit.settlement)?.buildings[hit.index]; if (!source) throw new Error('Source building not found.');
      const json=JSON.parse($<HTMLTextAreaElement>('#house-json').value);
      const patch=validateBuildingPatch({...json,storeys:Number($<HTMLInputElement>('#house-storeys').value),height:Number($<HTMLInputElement>('#house-height').value)*unitFactor(getDistanceUnit()),roof:$<HTMLSelectElement>('#house-roof').value,material:$<HTMLInputElement>('#house-material').value});
      const ids=source as UrbanBuilding&{nativeId?:string;nativeRequestId?:string};
      const edit:BuildingEdit={type:'building',settlement:hit.settlement,index:hit.index,nativeId:ids.nativeId,nativeRequestId:ids.nativeRequestId,signature:buildingSignature(source),patch};
      mods=mods.filter(m=>!(m&&typeof m==='object'&&(m as BuildingEdit).type==='building'&&(m as BuildingEdit).settlement===hit.settlement&&(m as BuildingEdit).index===hit.index)); mods.push(edit);
      world=applyBuildingEdits(pristine,mods).world; client.show(world,true); touchRecipe(); toast('House edited and retained in the project.');
    }catch(e){toast(String(e),true);}
  };
  $('#house-undo').onclick=()=>{if(!pristine)return;mods.pop();world=applyBuildingEdits(pristine,mods).world;client.show(world,true);touchRecipe();showInspector(hit.settlement);toast('Last edit undone.');};
  const requestId=(b as UrbanBuilding & {nativeRequestId?:string}).nativeRequestId;
  if(requestId){
    // Native houses have one authoritative generation form; the metadata-only
    // editor cannot change a retained native roof or its structural geometry.
    $('#building-inspector').replaceChildren();
    const nameId = `urban:${encodeURIComponent(hit.settlement)}:building:${encodeURIComponent((b as UrbanBuilding&{nativeId?:string}).nativeId ?? requestId)}`;
    const named = featureDisplayName(world!, nameId, settings);
    setHTML($('#building-inspector'), `<h3>${nameHTML(named,translate('House')+' '+(hit.index+1))}</h3>`);
    if(named){
      selectionOutline.set([b.poly,...b.courtyards??[]],named);
      insertHTML($('#building-inspector'),'beforeend','<label class="label"><input type="checkbox" id="house-name-pin"> <span data-i18n="Always show this name">'+translate('Always show this name')+'</span></label>');
      const pin=$<HTMLInputElement>('#house-name-pin');pin.checked=settings.naming?.labels?.[nameId]?.hidden===false;
      pin.onchange=()=>{settings.naming??={};settings.naming.labels??={};settings.naming.labels[nameId]={...settings.naming.labels[nameId],hidden:!pin.checked};void redrawNames().then(()=>{if(world){const buildings=townUrban(world,hit.settlement)?.buildings??[],index=buildings.findIndex(building=>(building as UrbanBuilding&{nativeRequestId?:string}).nativeRequestId===requestId);if(index>=0)showBuilding({settlement:hit.settlement,index,building:buildings[index]});}});};
    }
    const scopedId=`${hit.settlement}/${requestId}`;
    insertHTML($('#building-inspector'), 'beforeend', `<div class="edit-building"><div class="v2-edit-actions"><button id="house-native-apply" class="small selection-rebuild">↻ <span data-i18n="Regenerate building">${translate('Regenerate building')}</span></button><button id="house-native-reset" class="quiet small selection-reset" data-i18n="Use parent settings">${translate('Use parent settings')}</button><button id="house-reroll" class="settlement-reroll subdivision-reroll" aria-label="${translate('Reroll house')}"><i class="art art-dice" aria-hidden="true"></i></button></div><div id="house-native-controls"></div></div>`);
    const apply=(value:unknown)=>{if(busy)return;const next={...settings,urban:{...settings.urban,backend:settings.urban?.backend??settings.runtime?.backend??'rust' as const,buildings:{...settings.urban?.buildings,[scopedId]:value}}};validateSettings(next);settings=next;touchRecipe();void generate('town',hit.settlement,'buildings');};
    const city=nativeCityRecords(world??undefined)?.[hit.settlement],site=city?.sites?.find(s=>s.id===requestId);
    let nativeRequest=city?.requests?.find(request=>request.id===requestId);
    const houseControls=$('#house-native-controls'),surface={surface:[{outer:b.poly,holes:b.courtyards??[]}]};
    const parcelId=(b as UrbanBuilding&{nativeParcelId?:string}).nativeParcelId;
    if(parcelId){
      const typeControl=document.createElement('div');houseControls.before(typeControl);
      const allocation=(city?.programmePartitions??city?.partitions)?.[0]?.programme?.allocations.find(a=>a.parcelId===parcelId);
      const field={...urbanField('role','','parcel'),help:'Changes the use of this parcel and regenerates its buildings.'};
      const form=mountParameterForm(typeControl,[field],{
        getValue:()=>settings.urban?.local?.[hit.settlement]?.parcels?.overrides?.parcels?.[parcelId]?.role??allocation?.role,
        choices:()=>compatibleBuildingTypes({culture:settings.urban?.buildings?.[scopedId]?.culture??settings.urban?.local?.[hit.settlement]?.parcels?.overrides?.parcels?.[parcelId]?.culture??nativeRequest?.culture.culture??site?.culture.culture??settings.options.culture,
          area:polygonArea((city?.partitions?.[0]?.parcels.find(parcel=>parcel.id===parcelId))?.envelope??(city?.partitions?.[0]?.parcels.find(parcel=>parcel.id===parcelId))?.shape??{outer:townUrban(world!,hit.settlement)?.parcels.find(parcel=>parcel.nativeId===parcelId)?.poly??b.poly}),
          architecture:settings.urban?.architecture,pack:nativeRequest?.culture.pack??site?.culture.pack,mode:city?.layouts[0]?.config?.programme.mode,period:city?.layouts[0]?.config?.programme.period,navigableAccess:city?.layouts[0]?.config?.programme.navigableAccess}),
        setValue:(_path,value)=>{
          settings.urban??={backend:settings.runtime?.backend??'rust'};const local=settings.urban.local??={};const controls=local[hit.settlement]??={};controls.parcels??={};controls.parcels.overrides??={};const entries=controls.parcels.overrides.parcels??={};const edit=entries[parcelId]??={};
          if(value&&value!=='auto')edit.role=String(value);else delete edit.role;
          delete edit.function;delete edit.households;delete edit.houseConfig;
          if(settings.urban.buildings){const own=settings.urban.buildings[scopedId];const requests=(city?.sites??city?.requests??[]).filter(site=>site.parcel_id===parcelId).map(site=>site.id);resetSubdivisionChildren(settings,hit.settlement,'parcel',{parcels:[parcelId],requests});if(own?.culture)edit.culture=own.culture;settings.urban.buildings[scopedId]={...(own?.culture?{culture:own.culture}:{}),...(own?.seed?{seed:own.seed}:{})};}
          touchRecipe();form.sync();
        },
      });inspectorForms.push(form);
    }
    const mountHouseControls=()=>{
      const actual=city?.scene?.buildings.find(building=>building.id===(b as UrbanBuilding&{nativeId?:string}).nativeId);
      const roof=actual?.volumes[0]?.roof_system??actual?.cartographic?.roof_system;
      inspectorForms.push(mountUrbanControls(houseControls,()=>settings,()=>{touchRecipe();inspectorForms.forEach(form=>form.sync());},{kind:'building',key:hit.settlement,id:requestId,parcel:(b as UrbanBuilding&{nativeParcelId?:string}).nativeParcelId,quarter:city?siteQuarter(city.layouts,surface):undefined,block:city?siteBlock(city.layouts,surface):undefined,defaults:{...nativeRequest?.config,culture:nativeRequest?.culture.culture??site?.culture.culture,overrides:{...houseControlDefaults().overrides,...nativeRequest?.config?.overrides,...(roof?{roof}:{}),floors:b.storeys??1}}},{hideReset:true}));
      organizeInspector($('#building-inspector'));
    };
    if(nativeRequest||!site||!city?.siteQuery)mountHouseControls();
    else void import('../../../rust/bridge/urbanBuildingSite').then(m=>m.readUrbanBuildingSite(city.siteQuery!,{profile:'local',server:backendBindings.localServer()},site.offset,site.id,city.sites!.length))
      .then(request=>{nativeRequest=request;},()=>undefined).then(()=>{if(houseControls.isConnected)mountHouseControls();});
    $('#house-reroll').title=translate('Reroll house');
    $('#house-reroll').onclick=()=>{try{const current=settings.urban?.buildings?.[scopedId]??{};const base=String(current.seed??nativeRequest?.config?.seed??settings.options.seed);apply({...current,seed:rerollSeed(base,['house'])});}catch(e){toast(String(e),true);}};
    $('#house-native-apply').onclick=()=>{try{apply(settings.urban?.buildings?.[scopedId]??{});}catch(e){toast(String(e),true);}};
    $('#house-native-reset').title=translate('Remove local overrides and regenerate using the parent settings.');
    $('#house-native-reset').onclick=()=>{try{if(busy)return;const buildings={...settings.urban?.buildings};delete buildings[scopedId];if(parcelId){const edit=settings.urban?.local?.[hit.settlement]?.parcels?.overrides?.parcels?.[parcelId];if(edit){delete edit.role;delete edit.function;}}settings.urban={...settings.urban,backend:settings.urban?.backend??settings.runtime?.backend??'rust',buildings};touchRecipe();void generate('town',hit.settlement,'buildings');}catch(e){toast(String(e),true);}};

  }
  organizeInspector($('#building-inspector'));
  insertHTML($('#building-inspector'),'afterbegin','<button id="back-to-city" class="quiet small">← '+('Back to city')+'</button>');$('#back-to-city').onclick=()=>showInspector(hit.settlement);
  $('#building-inspector').scrollIntoView({block:'nearest',behavior:'smooth'});
}
function inspectSubdivision(kind:'quarter'|'block'|'parcel',p:{x:number;y:number},settlementKey?:string,selectedId?:string):boolean {
  if(!world)return false;
  for(const settlement of world.settlements??[]){
    if(settlementKey && settlement.key!==settlementKey)continue;
    const urban=townUrban(world,settlement.key);if(!urban)continue;
    const native=nativeCityRecords(world)?.[settlement.key],layout=native?.layouts[0];
    const items = kind==='quarter' ? urban.quarters.map((q,i)=>({shape:q.poly,id:q.nativeId,index:i}))
      : kind==='block' ? urban.blocks.map((ring,i)=>({shape:layout?.blocks[i]?.shape??{outer:ring,holes:[]},id:layout?blockEditId(layout,layout.blocks[i].shape):undefined,index:i}))
      : urban.parcels.map((parcel,i)=>({shape:native?.partitions?.[0]?.parcels[i]?.shape??{outer:parcel.poly,holes:[]},id:parcel.nativeId,index:i}));
    const item=items.find(item=>selectedId!==undefined ? item.id===selectedId : pointInRing(item.shape.outer,p)&&!item.shape.holes?.some(h=>pointInRing(h,p)));
    if(!item)continue;
    const nativeId=item.id;
    showInspector(settlement.key);$('#inspector').dataset.scope=kind;
    selectedSubdivision={key:settlement.key,kind,id:nativeId??String(item.index),point:p};
    const rings=[item.shape.outer,...item.shape.holes??[]];selectionOutline.set(rings);
    const title=translate(kind==='quarter'?'Quarter':kind==='block'?'Block':'Parcel')+' '+(item.index+1);
    setHTML($('#building-inspector'), `<div class="edit-building"><h3 data-l10n-keep>${esc(title)}</h3><p class="hint" data-i18n="Regenerate this area and its descendants. Display settings stay unchanged.">${translate('Regenerate this area and its descendants. Display settings stay unchanged.')}</p><div id="subdivision-actions" class="v2-edit-actions"><button id="subdivision-apply" class="small selection-rebuild">↻ <span data-i18n="Regenerate area">${translate('Regenerate area')}</span></button><button id="subdivision-reset" class="quiet small selection-reset" data-i18n="Use parent settings">${translate('Use parent settings')}</button></div><p id="selection-status" class="hint selection-status" role="status" data-i18n="Regenerate keeps the seed. The dice creates a new random layout and descendants.">${translate('Regenerate keeps the seed. The dice creates a new random layout and descendants.')}</p><div id="subdivision-controls"></div></div>`);
    if(!nativeId){setText($('#subdivision-controls'),'Local editing requires the Rust engine.');$('#subdivision-actions').hidden=true;return true;}
    const quarterId=kind==='quarter'?nativeId:kind==='block'?String(layout!.blocks[item.index].quarter):String(layout?.blocks[urban.parcels[item.index].block]?.quarter??0);
    const blockId=kind==='block'?nativeId:kind==='parcel'&&layout?blockEditId(layout,layout.blocks[urban.parcels[item.index].block].shape):undefined;
    const blockIds=new Set(kind==='quarter'?layout?.blocks.flatMap((b,i)=>String(b.quarter)===nativeId?[String(i)]:[]):kind==='block'?[String(item.index)]:[]);
    const parcelIds=new Set(kind==='parcel'?[nativeId]:urban.parcels.filter(parcel=>blockIds.has(String(parcel.block))).map(parcel=>parcel.nativeId).filter((id):id is string=>!!id));
    const children={blocks:layout?[...blockIds].map(id=>blockEditId(layout,layout.blocks[Number(id)].shape)):[],parcels:[...parcelIds],requests:[...new Set([...(native?.sites??native?.requests??[]).filter(site=>parcelIds.has(site.parcel_id)).map(site=>site.id),...urban.buildings.filter(building=>parcelIds.has((building as UrbanBuilding&{nativeParcelId?:string}).nativeParcelId??'')).map(building=>(building as UrbanBuilding&{nativeRequestId?:string}).nativeRequestId)].filter((id):id is string=>!!id))]};
    const get=():QuarterOverride|BlockOverride|ParcelOverride|undefined=>{const local=settings.urban?.local?.[settlement.key];return kind==='quarter'?local?.layout?.overrides?.quarters?.[nativeId]:kind==='block'?local?.parcels?.overrides?.blocks?.[nativeId]:local?.parcels?.overrides?.parcels?.[nativeId];};
    const apply=(value:QuarterOverride|BlockOverride|ParcelOverride|undefined)=>{
      if(busy)return;
      const next=structuredClone(settings);next.urban??={backend:settings.runtime?.backend??'rust'};const local=next.urban.local??={};const scope=local[settlement.key]??={};
      if(kind==='quarter'){scope.layout??={};scope.layout.overrides??={};const entries=scope.layout.overrides.quarters??={};if(value)entries[nativeId]=value as QuarterOverride;else delete entries[nativeId];}
      else{scope.parcels??={};scope.parcels.overrides??={};if(kind==='block'){const entries=scope.parcels.overrides.blocks??={};if(value)entries[nativeId]=value as BlockOverride;else delete entries[nativeId];}else{const entries=scope.parcels.overrides.parcels??={};if(value)entries[nativeId]=value as ParcelOverride;else delete entries[nativeId];}}
      resetSubdivisionChildren(next,settlement.key,kind,children);validateSettings(next);settings=next;touchRecipe();
      void generate('town',settlement.key,'buildings');
    };
    mountSubdivisionActions($('#subdivision-actions'),{kind,actionsOnly:true,french:getLanguage()==='fr',get,apply:value=>{try{apply(value);}catch(e){toast(String(e),true);}},shape:item.shape,map:$('#map'),getView:()=>client.viewer.getView()});
    $('#subdivision-apply').onclick=()=>{try{apply(get()??{});}catch(e){toast(String(e),true);}};
    $('#subdivision-reset').title=translate('Remove local overrides and regenerate using the parent settings.');
    $('#subdivision-reset').onclick=()=>{try{apply(undefined);}catch(e){toast(String(e),true);}};
    const controls=$('#subdivision-controls');
    const allocation=kind==='parcel'?native?.programmePartitions?.[0]?.programme?.allocations.find(a=>a.parcelId===nativeId):undefined;
    const quarter=layout?.quarters[Number(quarterId)];
    const defaults:Record<string,unknown>=kind==='quarter'?{culture:layout?.phases?.[quarter?.phase??0]?.culture??layout?.culture,zone:quarter?.zone}:kind==='block'?{culture:layout?.config?.overrides?.quarters?.[quarterId]?.culture??layout?.phases?.[layout.blocks[item.index].phase??quarter?.phase??0]?.culture??layout?.culture}:allocation?{culture:allocation.culture,role:allocation.role,function:allocation.function,households:allocation.households}:{};
    const available=urban.parcels.filter(parcel=>parcelIds.has(parcel.nativeId??'')).map(parcel=>polygonArea(native?.partitions?.[0]?.parcels.find(p=>p.id===parcel.nativeId)?.envelope??native?.partitions?.[0]?.parcels.find(p=>p.id===parcel.nativeId)?.shape??{outer:parcel.poly}));
    Object.assign(defaults,{area:kind==='parcel'?available[0]:available.length?Math.min(...available):polygonArea(item.shape),blockArea:polygonArea(item.shape),historicalMode:layout?.config?.programme.mode??'inspired',period:layout?.config?.programme.period,navigableAccess:layout?.config?.programme.navigableAccess});
    const source=(native?.sites??native?.requests??[]).find(site=>parcelIds.has(site.parcel_id));
    if(source)defaults.houseConfig={pack:source.culture.pack,mode:source.culture.mode};
    inspectorForms.push(mountUrbanControls(controls,()=>settings,()=>{touchRecipe();setText($('#selection-status'),'Changes pending. Regenerate to apply them to this area and its descendants.');},{kind,key:settlement.key,id:nativeId,quarter:quarterId,block:blockId,defaults},{hideReset:true}));
    organizeInspector($('#building-inspector'));
    insertHTML($('#building-inspector'),'afterbegin','<button id="back-to-city" class="quiet small">← '+translate('Back to city')+'</button>');$('#back-to-city').onclick=()=>showInspector(settlement.key);
    $('#building-inspector').scrollIntoView({block:'nearest',behavior:'smooth'});return true;
  }
  return false;
}

document.querySelectorAll<HTMLInputElement|HTMLSelectElement>('[data-option]').forEach(input=>input.addEventListener('change',()=>{
  const key=input.dataset.option!, value=input instanceof HTMLInputElement && input.type==='number' ? (input.value===''?undefined:input.valueAsNumber):input.value;
  if (typeof value==='number'&&!Number.isFinite(value)) return;
  if (key.startsWith('center.')) { const axis=key.endsWith('x')?'x':'y'; if(value===undefined)delete settings.options.center;else settings.options.center={...(settings.options.center??{x:adaptedExtent(settings)/2,y:adaptedExtent(settings)/2}),[axis]:value}; }
  else (settings.options as unknown as Record<string,unknown>)[key]=value;
  touchRecipe();
  if(key==='sprawl'&&value===undefined)input.value='1';
  if(key==='culture'||key==='sprawl'||key==='population'){urbanControls.sync();inspectorForms.forEach(form=>form.sync());}
}));
$('#random-seed').onclick=()=>{migrateUrbanSeeds(settings);settings.options.seed=Array.from(crypto.getRandomValues(new Uint32Array(2)),n=>n.toString(36)).join('-');mods=[];touchRecipe();syncControls();};
$<HTMLInputElement>('#town-count').onchange=e=>{settings.settlementCount=Number((e.target as HTMLInputElement).value);if(settings.region?.placement){delete settings.region.placement.counts;settings.region.placement.mode='counts';}touchRecipe();regionControls.sync();};
$('#generate-region').onclick=()=>runFamily(chain.family());$('#run-chain').onclick=()=>void runFullGeneration();$('#terrain-only').onclick=()=>void generate('terrain');$('#region-only').onclick=()=>void generate('region');$('#towns-only').onclick=()=>runCities();
$('#cancel-job').onclick=()=>{cancelled=true;client.cancel();const local=settings.runtime?.backend==='native'||settings.runtime?.source==='neural-python'||settings.urban?.backend==='native';const message=local?'Waiting cancelled. The previous map is retained; the local service may finish its computation in the background.':'Computation cancelled. The previous map is retained.';log(message);setBusy(false);toast(message);};
$('#zoom-in').onclick=()=>client.viewer.zoomBy(1.5);$('#zoom-out').onclick=()=>client.viewer.zoomBy(1/1.5);$('#fit-map').onclick=()=>client.viewer.fit();
$<HTMLSelectElement>('#map-style').onchange=e=>writeRecipe('preset',(e.target as HTMLSelectElement).value);
$('#mobile-toggle').onclick=()=>{const closed=$('#sidebar').classList.toggle('mobile-closed');$('#mobile-toggle').setAttribute('aria-expanded',String(!closed));};
let pointerStart={x:0,y:0};$('#map').addEventListener('pointerdown',e=>{pointerStart={x:e.clientX,y:e.clientY};});
$('#map').addEventListener('click',e=>{
  if(!world || busy || (!pendingRegionPosition&&!labelEditor.active()&&!$<HTMLInputElement>('#inspect-mode').checked) || Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)>5)return;
  const rect=$('#map').getBoundingClientRect(),[x,y]=screenToWorld(client.viewer.getView(),rect.width,rect.height,e.clientX-rect.left,e.clientY-rect.top),p={x,y};
  if(labelEditor.active()){labelEditor.pick(p);return;}
  if(pendingRegionPosition){const spec=settings.region?.placement?.list?.find(spec=>spec.key===pendingRegionPosition);if(spec){spec.position={x:Math.max(0,Math.min(world.mapSize,x)),y:Math.max(0,Math.min(world.mapSize,y))};touchRecipe();regionControls.sync();}pendingRegionPosition=undefined;toast('Position saved. Run placement to apply it.');return;}
  const target=$<HTMLSelectElement>('#inspect-target').value;
  if(target==='quarter'||target==='block'||target==='parcel'){if(!inspectSubdivision(target,p))toast('No geometry at this location. Build this stage first.');return;}
  if(target==='settlement'){const town=nearestSettlement(world,p);if(town)showInspector(town.key);return;}
  const hit=buildingAt(world,p); if(hit){showBuilding(hit);return;} const town=nearestSettlement(world,p);if(town)showInspector(town.key);else toast('Select a settlement or a house. Zoom in to reach the buildings.');
});
document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(b=>b.onclick=()=>{$<HTMLDialogElement>(`#${b.dataset.close}`).close();});
$('#import-open').onclick=()=>dialog('#import-dialog');$('#heightmap-import-quick').onclick=()=>dialog('#import-dialog');$('#export-open').onclick=()=>{dialog('#export-dialog');};
$('#expert-open').onclick=()=>{ const clone=structuredClone(settings);delete clone.options.importedHeight;$<HTMLTextAreaElement>('#expert-json').value=JSON.stringify(clone,null,2);setText($('#expert-error'), '');dialog('#expert-dialog'); };
$('#expert-apply').onclick=()=>{try{const next=JSON.parse($<HTMLTextAreaElement>('#expert-json').value);if(settings.options.importedHeight)next.options.importedHeight=settings.options.importedHeight;validateSettings(next);settings=next;touchRecipe();syncControls();$<HTMLDialogElement>('#expert-dialog').close();toast('Recipe applied. Run the generation you need.');}catch(e){setText($('#expert-error'), String(e));}};
async function loadProject(project: { settings: V2Settings; mods: unknown[]; world?: World }): Promise<void> {
  labelBaseline=undefined;smallPlaceRecipe=undefined;await smallPlaces?.stop();
  const connections={localServer:settings.runtime?.localServer??bootRuntime.localServer,pythonServer:settings.runtime?.pythonServer??bootRuntime.pythonServer};
  if(connectLocal&&project.settings.runtime)project.settings.runtime={...project.settings.runtime,...connections};
  client.invalidateRetained();chain.clearResults();previewBase=undefined;selectedCities.clear();settings=project.settings;mods=project.mods;pristine=project.world?renameMap(project.world,settings,getLanguage()):undefined;world=pristine?applyBuildingEdits(pristine,mods).world:undefined;
  if(world)applyLabelEdits(world,settings.naming?.labels);
  touchRecipe();await syncControls();
  if(world){await client.show(world);canvas.hidden=false;$('#empty-map').hidden=true;updateWorld();const notice=world.stats['v2.compositionNotice'];if(notice)toast(String(notice));}
  else {await client.clear();city3d?.dispose();city3d=undefined;setText($('#view3d'),'3D');$('#view3d').setAttribute('aria-pressed','false');$('#capture3d').hidden=true;canvas.hidden=true;$('#empty-map').hidden=false;setHTML($('#settlement-list'), '<p class="hint">Create the region to restore this recipe’s settlements.</p>');$('#inspector').hidden=true;toast('Recipe loaded. Create the region to rebuild it.');}
}
const cityCodeSharing = mountCityCodeSharing({
  getRecipe: () => ({ settings, mods }), busy: () => busy,
  load: async recipe => {
    if (busy) return;
    if (localEdition && recipe.settings.runtime?.backend === 'rust') {
      recipe.settings.runtime.backend = 'native';
      if (recipe.settings.runtime.source === 'neural-wasm') recipe.settings.runtime.source = 'neural';
      if (recipe.settings.urban?.backend === 'rust') recipe.settings.urban.backend = 'native';
    }
    setBusy(true);
    try { await loadProject(recipe); log('Import: generation code'); }
    finally { setBusy(false); }
  },
});
$<HTMLInputElement>('#project-file').onchange=async e=>{
  const input=e.target as HTMLInputElement,file=input.files?.[0];if(!file||busy)return;
  setBusy(true);$<HTMLButtonElement>('#cancel-job').disabled=true;setText($('#progress-label'), 'Reading & preparing the project…');setText($('#progress-time'), '');
  try{
    if(file.size>MAX_BINARY_PROJECT_BYTES)throw new Error('Binary project is too large (2 GiB compressed maximum).');
    const binary=isBinaryProject(new Uint8Array(await file.slice(0,8).arrayBuffer()));
    if(!binary&&file.size>256*1024*1024)throw new Error('JSON project is too large (256 MiB maximum). Use a .muproj file for large maps.');
    const source=binary?{buffer:await file.arrayBuffer()}:{text:await file.text()},transfer='buffer' in source?[source.buffer!]:[],scope=$<HTMLSelectElement>('#import-scope').value;
    const project=scope==='complete'?await projectJob<{settings:V2Settings;world?:World;mods:unknown[]}>({action:binary?'parse-binary':'parse',...source},transfer):await composeJob({scope,...source,current:settings,world:previewBase?.pristine??previewBase?.world??pristine??world,mods},transfer);
    await loadProject(project);
    $<HTMLDialogElement>('#import-dialog').close();log(`Import ${scope} : ${file.name}`);
  }catch(e){reportAppearanceError(e);}finally{input.value='';setBusy(false);}
};
$<HTMLInputElement>('#heightmap-file').onchange=async e=>{const input=e.target as HTMLInputElement,file=input.files?.[0];if(!file)return;try{const image=await readHeightmap(file);settings.options.importedHeight=image;if(settings.terrain){delete settings.terrain.sketch;delete settings.terrain.zones;}settings.options.heightScale??=120;settings.options.importSea??=0;setText($('#import-height-info'), `${file.name} · ${image.w} × ${image.h} px`);touchRecipe();syncControls();toast('Heightmap ready. Set the elevations, then create the topography.');}catch(e){toast(String(e),true);}finally{input.value='';}};
$('#clear-heightmap').onclick=()=>{delete settings.options.importedHeight;if(settings.terrain){delete settings.terrain.sketch;delete settings.terrain.zones;}terrainControls.sync();setText($('#import-height-info'), 'No heightmap imported.');touchRecipe();};

function projectJob<T>(request:unknown,transfer:Transferable[]=[]):Promise<T>{if((request as {action?:string}).action==='serialize-binary'){request=structuredClone(request);transfer=resultTransferBuffers(request);}const worker=new ProjectWorker();return new Promise<T>((resolve,reject)=>{worker.onmessage=({data})=>{worker.terminate();if(data.error)reject(new Error(data.error));else resolve(data.result);};worker.onerror=e=>{worker.terminate();reject(new Error(e.message));};worker.postMessage(request,transfer);});}
function composeJob(request:unknown,transfer:Transferable[]=[]):Promise<{settings:V2Settings;world?:World;mods:unknown[]}>{const worker=new ComposeWorker();return new Promise((resolve,reject)=>{worker.onmessage=({data})=>{worker.terminate();if(data.error)reject(new Error(data.error));else resolve(data.result);};worker.onerror=e=>{worker.terminate();reject(new Error(e.message));};worker.postMessage(request,transfer);});}
function download(blob: Blob,name: string): void { const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000); }
async function svgExport(): Promise<Blob> {
  const layers=exportLayers(),width=Number($<HTMLSelectElement>('#export-resolution').value);
  const resolved=resolveSettingsAppearance(settings,world,'export');
  if(!supportsSvgExport(resolved))throw new Error(translate('SVG is unavailable for the current style. Use PNG.'));
  if(!resolved.cartography.roads){layers.roads=false;layers.streets=false;}
  if(!resolved.ground.layers.water)layers.water=false;
  const display=resolvedDisplayOptions(resolved);
  if(!resolved.ground.layers.relief)display.raster=false;
  const lu=resolved.composition.landuse;
  if(world&&layers.landuse!==false&&lu.rural!=='off')display.semanticLegend=ruralSemanticLegend(world.landuse,lu.classes,lu.rural); // urban entries need the city scenes (composite path only)
  const brushes=resolved.cartography.painted?(await import('../render/assets/brushAssets')).BRUSH_SOURCES:undefined;
  const worker=new ExportWorker();
  try { return await new Promise<Blob>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('SVG export timed out')),120000);
    worker.onmessage=({data})=>{clearTimeout(timer);data.error?reject(new Error(data.error)):resolve(data.blob);};
    worker.onerror=e=>{clearTimeout(timer);reject(new Error(e.message));};
    worker.onmessageerror=()=>{clearTimeout(timer);reject(new Error('Could not read the SVG export.'));};
    try{worker.postMessage({id:1,world:world?exportWorld(mapPresentation(world,settings)):world,options:{width,style:resolved.palette.mapStyle,layers,roadLook:resolved.composition.networks.roads.look,roadEmphasis:resolved.composition.networks.roads.emphasis,roadNight:resolved.composition.ambience==='night'},display,brushes});}
    catch(error){clearTimeout(timer);reject(error);}
  }); }finally{worker.terminate();}
}
function exportLayers():Partial<ExportLayers>{return Object.fromEntries(Array.from($('#export-dialog').querySelectorAll<HTMLInputElement>('[data-layer]')).map(c=>[c.dataset.layer,c.checked]));}
async function pngMapExport(width:number,crop:boolean):Promise<Blob|null>{
  const resolved=resolveSettingsAppearance(settings,world,'export');
  if(resolved.path==='classic'){
    let blob=await svgExport(),dimensions:number|{width:number;height:number}=width;
    if(crop){const result=await chooseExportCrop(blob,width,bindTree);if(!result)return null;blob=result.blob;dimensions=result;}
    return exportPng(blob,dimensions,phase=>{setText($('#export-note'),`Export PNG : ${phase}`);log(`Export PNG : ${phase}`);});
  }
  const image=await client.exportBench(settings,resolved,width,exportLayers());
  try{
    setText($('#export-note'),'Encoding PNG…');
    const png=await canvasPng(image);
    if(!crop)return png;
    const bounds={x:0,y:0,width:world!.mapSize,height:world!.mapSize};
    const area=await chooseExportArea(png,bounds,width,bindTree);
    return area?await cropCanvasPng(image,bounds,area.rect,area):null;
  }finally{image.width=image.height=0;}
}
/** The SVG export never reads the native town snapshots: they are not cloned into its worker. */
function exportWorld(world:World):World{
  if(!world.debug?.v2RustCities)return world;
  const {v2RustCities:_cities,...debug}=world.debug;
  return {...world,debug};
}
async function heightmapBlob(): Promise<{blob:Blob;metadata:Blob}> {
  if(!world)throw new Error('Create a map first.');const grid=world.terrain.height,c=document.createElement('canvas');c.width=grid.w;c.height=grid.h;
  const ctx=c.getContext('2d')!,pixels=ctx.createImageData(grid.w,grid.h);let lo=Infinity,hi=-Infinity;for(const value of grid.data){lo=Math.min(lo,value);hi=Math.max(hi,value);}
  for(let i=0;i<grid.data.length;i++){const value=Math.round(255*(grid.data[i]-lo)/Math.max(1e-9,hi-lo));pixels.data.set([value,value,value,255],i*4);}ctx.putImageData(pixels,0,0);log(`8-bit heightmap: black ${lo.toFixed(3)} m, white ${hi.toFixed(3)} m. Use a JSON project to retain FP32.`);
  const metadata=new Blob([JSON.stringify({format:'magna-urbis-heightmap',version:1,width:grid.w,height:grid.h,mapSize:world.mapSize,minHeight:lo,maxHeight:hi,seed:world.seed},null,2)],{type:'application/json'});
  try{return {blob:await canvasPng(c),metadata};}finally{c.width=c.height=0;}
}
registerMessages({
  'SVG is unavailable for the current style. Use PNG.':{en:'SVG is unavailable for the current style. Use PNG.',fr:'Le SVG n’est pas disponible pour le style actuel. Utilisez le PNG.'},
  'SVG vector map · unavailable for this style':{en:'SVG vector map · unavailable for this style',fr:'Carte vectorielle SVG · indisponible pour ce style'},
  'Encoding PNG…':{en:'Encoding PNG…',fr:'Encodage du PNG…'},
});
function syncExportOptions():void{
  const svg=$<HTMLOptionElement>('#export-format option[value="svg"]'),available=supportsSvgExport(resolveSettingsAppearance(settings,world,'export'));
  svg.disabled=!available;
  setText(svg,available?'SVG vector map':'SVG vector map · unavailable for this style');
  const select=$<HTMLSelectElement>('#export-format');if(!available&&select.value==='svg')select.value='png';
  const format=select.value;$('#export-map-options').hidden=!['png','svg'].includes(format);
  setText($('#export-note'),format==='binary'?'The binary project retains the exact map, settings and edits in a compressed file.':format==='project'?'The JSON project is a readable interchange format. Use Save map for a smaller file.':format==='heightmap'?'256-level PNG accompanied by minimum/maximum elevations. Save map retains the exact FP32 grids.':format==='recipe'?'The recipe retains settings and edits. Faithful reproduction requires the same engine version.':format==='seed'?'The seed alone contains neither your settings nor your edits.':!available?'SVG is unavailable for the current style. Use PNG.':'Visual exports use the current map without rerunning generation.');
}
$<HTMLSelectElement>('#export-format').onchange=syncExportOptions;
$('#export-go').onclick=async()=>{
  if(busy||$<HTMLButtonElement>('#export-go').disabled)return;const format=$<HTMLSelectElement>('#export-format').value;
  migrateUrbanSeeds(settings); $<HTMLInputElement>('#seed').value = settings.options.seed;
  if(!world&&!['recipe','seed'].includes(format)){toast('Create a map first.');return;}
  $<HTMLButtonElement>('#export-go').disabled=true;$<HTMLButtonElement>('#save-map').disabled=true;
  let exportError:string|undefined;
  try {
    const name=`magna-urbis-${settings.options.seed.replace(/[^\w-]/g,'_').slice(0,45)}`;
    if(format==='binary'){const buffer=await projectJob<ArrayBuffer>({action:'serialize-binary',settings,world:previewBase?.pristine??previewBase?.world??pristine??world,mods});download(new Blob([buffer],{type:'application/octet-stream'}),`${name}.project.muproj`);}
    else if(format==='project'||format==='recipe'){download(await projectJob<Blob>({action:'serialize',settings:format==='recipe'&&world?{...settings,extent:world.mapSize,options:{...settings.options,mapSize:world.mapSize}}:settings,world:format==='project'?(previewBase?.pristine??previewBase?.world??pristine??world):undefined,mods}),`${name}.${format}.json`);}
    else if(format==='seed'){download(new Blob([JSON.stringify({format:'magna-urbis-v2-seed',version:1,seed:settings.options.seed})],{type:'application/json'}),`${name}.seed.json`);}
    else if(format==='heightmap'){const result=await heightmapBlob();download(result.blob,`${name}.heightmap.png`);download(result.metadata,`${name}.heightmap.metadata.json`);}
    else {
      toast('Preparing map layers…');setText($('#export-note'),'Preparing map layers…');
      await new Promise<void>(resolve=>setTimeout(resolve,0));
      const width=Number($<HTMLSelectElement>('#export-resolution').value),crop=$<HTMLInputElement>('#export-crop').checked;
      let blob:Blob|null;
      if(format==='png')blob=await pngMapExport(width,crop);
      else{blob=await svgExport();if(crop)blob=(await chooseExportCrop(blob,width,bindTree))?.blob??null;}
      if(!blob)return;download(blob,`${name}.${format}`);
    }
    log(`Export : ${format}`);toast('Export downloaded.');$<HTMLDialogElement>('#export-dialog').close();
  }catch(e){exportError=e instanceof Error?e.message:String(e);toast(exportError,true);}finally{
    $<HTMLButtonElement>('#export-go').disabled=false;$<HTMLButtonElement>('#save-map').disabled=busy;syncExportOptions();
    if(exportError)setText($('#export-note'),exportError);
  }
};
$('#save-map').onclick=()=>{$<HTMLSelectElement>('#export-format').value='binary';$('#export-go').click();};
async function inspectHardware():Promise<void>{
  settingsPanel.render();
  try{await refreshBackends(backendBindings);chain.sync();}
  catch(e){log(String(e));}
}
$('#hardware-open').onclick=()=>{dialog('#hardware-dialog');void inspectHardware();};$('#hardware-refresh').onclick=()=>void inspectHardware();
$('#services-apply').onclick=()=>{try{const localServer=loopbackServer($<HTMLInputElement>('#rust-server').value),pythonServer=loopbackServer($<HTMLInputElement>('#python-server').value);settings.runtime={compute:'auto',backend:'rust',source:'procedural',...settings.runtime,localServer,pythonServer};connectLocal=true;touchRecipe();syncControls();void inspectHardware();}catch(e){toast(String(e),true);}};
window.addEventListener('beforeunload',()=>{clearTimeout(renderTimer);renderControls.dispose();city3d?.dispose();terrainControls.dispose();urbanControls.dispose();regionControls.dispose();neuralModelManager.dispose();disposeInspectorForms();client.destroy();});
registerMessages({'Units':{en:'Units',fr:'Unités'},'Metric (m / km)':{en:'Metric (m / km)',fr:'Métrique (m / km)'},'Imperial (ft / mi)':{en:'Imperial (ft / mi)',fr:'Impérial (ft / mi)'},'Yards (yd / mi)':{en:'Yards (yd / mi)',fr:'Yards (yd / mi)'}});
insertHTML($('#workbench-preferences'),'afterbegin',`<label class="language-control"><span>Units</span><select id="units-select" aria-label="Units"><option value="m">Metric (m / km)</option><option value="ft">Imperial (ft / mi)</option><option value="yd">Yards (yd / mi)</option></select></label>`);
$<HTMLSelectElement>('#language-select').onchange=event=>setLanguage((event.target as HTMLSelectElement).value as Language);
$<HTMLSelectElement>('#units-select').value=getDistanceUnit();
$<HTMLSelectElement>('#units-select').onchange=event=>setDistanceUnit((event.target as HTMLSelectElement).value as DistanceUnit);
let preferenceDraw:Promise<void>=Promise.resolve(),preferenceRevision=0;
const refreshPresentation=()=>{
  updateExtent();
  setText($('#scale-label'),formatDistance(80/client.viewer.getView().scale,getDistanceUnit(),numberLocale()));
  const height=document.querySelector<HTMLInputElement>('#house-height');
  if(height){
    const previous=(height.dataset.distanceUnit??'m') as DistanceUnit;
    if(previous!==getDistanceUnit()&&height.value!=='')height.value=String(Number((Number(height.value)*unitFactor(previous)/unitFactor(getDistanceUnit())).toFixed(6)));
    height.dataset.distanceUnit=getDistanceUnit();height.min=String(.5/unitFactor(getDistanceUnit()));height.max=String(1000/unitFactor(getDistanceUnit()));
    const label=document.querySelector('[data-house-height-unit]');if(label)label.textContent=getDistanceUnit();
  }
  if(world&&!busy){const shown=world,revision=++preferenceRevision;preferenceDraw=preferenceDraw.catch(()=>{}).then(async()=>{
    if(revision!==preferenceRevision||world!==shown||busy)return;
    await client.show(shown,true);
    if(revision===preferenceRevision&&world===shown)city3d?.refresh();
  }).catch(reportAppearanceError);}
};
onUnitsChange(refreshPresentation);
onLanguageChange(()=>{syncFullGenerationButton(chain.family());renderLog();document.querySelectorAll<HTMLOptGroupElement>('optgroup[data-render-label]').forEach(group=>group.label=translate(group.dataset.renderLabel!));renderControls.sync();refreshPresentation();if(!busy){if(selectedBuilding)showBuilding(selectedBuilding);else if(selectedSubdivision)inspectSubdivision(selectedSubdivision.kind,selectedSubdivision.point,selectedSubdivision.key,selectedSubdivision.id);}});
registerMessages({'General seed':{en:'General seed',fr:'Graine générale'}});
setText($('label[for="seed"]'),'General seed');
$<HTMLInputElement>('#seed').maxLength=65536;
initializeLanguage();
workbenchLayout=mountWorkbenchLayout({getSettings:()=>settings,getWorld:()=>world,changed:touchRecipe,appearance:()=>{projectRevision++;void refreshAppearance();},syncForms:()=>{regionControls.sync();urbanControls.sync();inspectorForms.forEach(form=>form.sync());}});
{
  const host=document.createElement('section');host.id='settlements-name-origin';
  document.querySelector('#family-settlements .family-general')!.append(host);
  nameOrigins.push(mountNameOriginControls(host,'settlements-name-origin',{getSettings:()=>settings,busy:()=>busy,changed:()=>{syncNameOrigins();void redrawNames();}}));
}
// Roads as plan, hidden or rendered: next to the urban plan field of the top bar.
roadDisplay=mountRoadDisplayControl(document.querySelector('[data-setting-path="appearance.city.plan"]')?.closest('.parameter-field')??null,$('.view-strip'),{getSettings:()=>settings,onChange:()=>{projectRevision++;clearTimeout(renderTimer);renderTimer=setTimeout(()=>void refreshAppearance(),120);}});
setText($('#build-info'),`${import.meta.env.VITE_BUILD_DATE ?? 'dev'} · ${import.meta.env.VITE_BUILD_COMMIT ?? 'local'}`);
syncControls();
try{await client.init();}finally{document.getElementById('boot-splash')?.remove();}
mountV2TestHook({getSettings:()=>settings,getWorld:()=>world??undefined,isBusy:()=>busy,load:loadProject,run:async places=>{if(places==='main')await generateMainOnly();else await generate('all');},smallPlacesSettled:()=>smallPlaces?.settled()??Promise.resolve(),getViewer:()=>client.viewer,get3d:()=>city3d,prepareCapture:()=>client.prepareViewportCapture(),rerollTown:key=>rerollCityStep('composition',[key]),displaySettled:()=>client.displaySettled()});
await cityCodeSharing.restoreFromLocation();
{ // Reload recovery: an explicit #city= or ?test=1 wins; otherwise restore the autosaved recipe through the project import path.
  const explicit = new URLSearchParams(location.hash.slice(1)).has('city') || new URLSearchParams(location.search).get('test') === '1';
  const saved = explicit ? undefined : await takeAutosave(); // the entry is removed here and written back only after a successful restore
  if (saved) {
    setBusy(true);
    try { await loadProject({ settings: saved.settings, mods: saved.mods }); log('Restore: latest recipe'); } catch (e) { console.info('Autosave restore failed, starting fresh:', e); }
    setBusy(false);
    await generate('all');
    try { if (saved.view) client.viewer.setView(saved.view as never); } catch { /* The viewport is optional. */ }
    try {
      if (saved.ui?.tab) selectTab(saved.ui.tab);
      if (saved.ui?.mode3d && world && !city3d?.active) {
        await ($('#view3d').onclick as unknown as () => Promise<void>)();
        if (saved.ui.camera) city3d?.setCamera(saved.ui.camera as never);
      }
    } catch { /* View state is optional. */ }
  }
  armAutosave(() => ({ settings, mods, view: world ? client.viewer.getView() : undefined, ui: { tab: currentTab, mode3d: !!city3d?.active, camera: city3d?.active ? city3d.getCamera() : undefined } }));
  mountNewButton($('#import-open'));
  $('#export-open').before($('#city-code-open'));
}
void inspectHardware();
// Keep source, dimensions and coasts editable before the first generation.
