import { TERRAIN_STYLE_LIST, terrainStyle, isTerrainStyle, waterShoreColor, type TerrainStyle } from '../render/terrainStyle';
import { waterAppearanceSvg, type RetainedWaterMaterial } from './decorWater';
import { DISPLAY_VOCABULARY } from '../render/displayLayers';
import { CULTURES, getCulture } from '../gen/urban/culture';
import { benchLayout, benchParcels, benchBuildings, type BenchOptions, type BenchLayout, type BenchHouses, type BenchParcels } from '../gen/urban/testbench';
import { BENCH_STAGES, BENCH_PRESETS, BENCH_FIELDS, BENCH_OPERATORS, BENCH_METHODS, benchMethod, benchMethodFields, benchRecipes, benchMorph, validateBenchParams, type BenchStage, type BenchParams } from '../gen/urban/testbenchConfig';
import { HOUSE_VARIATION_ENABLED, effectiveHouseVariation, deepMerge, type MorphologyParams, type Zone } from '../gen/urban/morphology';
import type { Polygon } from '../gen/core/geom';
import { polygonCentroid } from '../gen/core/geom';
import { waterContains } from '../gen/urban/waterland';
import { createWorkshopClient, WORKSHOP_CHANNEL, normalizeWorkshopContext, workshopConfig, workshopOptions, workshopView, workshopStreetSvg, workshopEnclosureSvg, type WorkshopCatalogue, type WorkshopContext, type WorkshopResult, type WorkshopState } from './testbenchUrban';
import type { LayoutConfig, ParcelConfig } from '../../../rust/bridge/urban';
import { normalizeLayoutConfig, normalizeParcelConfig } from '../../../rust/bridge/urbanConfig';
import { installWorkshopSkin } from './testbenchWorkshop';

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const input = (id: string) => el<HTMLInputElement>(id);
const select = (id: string) => el<HTMLSelectElement>(id);
const map = document.getElementById('map') as unknown as SVGSVGElement;
const culture = select('culture'), monument = select('monument');
select('mapStyle').replaceChildren(...TERRAIN_STYLE_LIST.map(style => new Option(style.label, style.id)));
select('mapStyle').title = DISPLAY_VOCABULARY.style; select('planDiagnostic').title = DISPLAY_VOCABULARY.diagnostic;
interface Pin { x: number; y: number; note: string }
interface State {
  v: 2; options: BenchOptions; settings: BenchOptions; plotOptions: BenchOptions; houseOptions: BenchOptions;
  layoutSeed: string; plotSeed: string; houseSeed: string; stage: 1 | 2 | 3;
  pins: Pin[]; view: number[]; showBlocks: boolean; showPlots: boolean; showHouses: boolean; showOrientation?: boolean; realPlan?: boolean;
  mapStyle?: TerrainStyle;
  engine?: 'typescript' | 'rust'; urban?: WorkshopContext;
}
const query = new URLSearchParams(location.search);
const hosted = window.parent !== window && query.get('embedded') === '1';
if (hosted || query.get('engine') === 'rust') installWorkshopSkin();
if (hosted) { el('copy').textContent = 'Copier code'; el('copy').title = 'Copier le code unique de cette carte'; }
let rustMode = query.get('engine') === 'rust';
if (rustMode && !hosted) {
  const params = new URLSearchParams({ space: 'workshop' });
  if (query.has('case')) params.set('workshop', query.get('case')!);
  location.replace(`urbanbench.html?${params}`);
}
const nativeClient = createWorkshopClient();
let nativeCatalogue: WorkshopCatalogue | undefined = hosted ? await nativeClient.catalogue() : undefined;
function editorRecipes(id: string) {
  if (!rustMode || !nativeCatalogue) return benchRecipes(getCulture(id));
  const recipes = nativeCatalogue.cultures[id]?.recipes ?? [];
  return [{ id: 'auto', label: 'Par phase du plan', zone: 'core' as Zone, preset: `${id}/core` }, ...recipes];
}
function editorPresets() { return rustMode && nativeCatalogue ? nativeCatalogue.presets : BENCH_PRESETS; }
function cultureLabel(id: string): string { return rustMode && nativeCatalogue ? nativeCatalogue.cultures[id]?.label ?? id : getCulture(id).label; }
function validCulture(id: string): boolean { return !!(rustMode && nativeCatalogue ? nativeCatalogue.cultures[id] : CULTURES[id]); }
function editorMorph(options: BenchOptions, stage: BenchStage): MorphologyParams {
  if (!rustMode || !nativeCatalogue) return benchMorph(options, stage);
  const config = options.stages?.[stage];
  if (config?.params) validateBenchParams(stage, config.params);
  const preset = config?.preset && config.preset !== 'culture' ? config.preset : nativeCatalogue.cultures[options.culture]?.recipes.find(r => r.id === (options.recipe === 'auto' ? 'core' : options.recipe ?? 'core'))?.preset;
  const P = preset && nativeCatalogue.presets[preset]?.params;
  if (!P) throw new Error(`Recette native inconnue : ${options.culture}/${options.recipe}`);
  // Mirror the native resolver's five density-scaled fields before overrides.
  const resolved = structuredClone(P), f = Math.log2(Math.max(0.5, Math.min(2, 1 / options.density)));
  for (const [key, scale, lo, hi] of [
    ['coverage', 1 - 0.24 * f, 0.05, 0.97], ['frontage', 1 + 0.32 * f, 3.5, Infinity],
    ['plotDepth', 1 + 0.22 * f, 8, Infinity], ['blockSize', 1 + (f > 0 ? 0.45 : 0.1) * f, 300, Infinity],
    ['houseArea', 1 + (f > 0 ? 0.25 : 0.12) * f, 30, Infinity],
  ] as const) {
    const values = resolved[key]; if (!values) continue;
    for (const [zone, range] of Object.entries(values)) values[zone as Zone] = range.map(n => Math.max(lo, Math.min(hi, n * scale))) as [number, number];
  }
  return deepMerge(resolved, config?.params ?? {});
}
function cultureMenus(): void {
  const previous = culture.value; culture.replaceChildren();
  for (const [id, c] of Object.entries(rustMode && nativeCatalogue ? nativeCatalogue.cultures : CULTURES)) culture.add(new Option(c.label, id));
  culture.value = validCulture(previous) ? previous : 'european-organic';
  for (const stage of BENCH_STAGES) {
    const menu = select(stage + 'Preset'), previous = menu.value;
    menu.replaceChildren(new Option('Culture / recette sélectionnée', 'culture'));
    const morphs = document.createElement('optgroup'); morphs.label = 'Morphologies';
    const cultural = document.createElement('optgroup'); cultural.label = 'Recettes culturelles / phases / secteurs';
    for (const [id, preset] of Object.entries(editorPresets())) (id.startsWith('morph/') ? morphs : cultural).append(new Option(preset.label, id));
    menu.append(morphs, cultural); menu.value = previous in editorPresets() ? previous : 'culture';
  }
}
let nativeResult: WorkshopResult | undefined;
let inheritedWater: { geometry: string; material: RetainedWaterMaterial } | undefined;
const nativeControls = document.createElement('fieldset'); nativeControls.hidden = true;
nativeControls.innerHTML = '<legend>Plan urbain · Rust</legend><label>Enceinte <select data-native="fortification"><option value="culture">Selon la culture</option><option value="none">Sans enceinte</option><option value="wall">Muraille</option><option value="palisade">Palissade</option></select></label><button data-remove-enclosure type="button">Retirer l’enceinte</button><label><input data-native="autoQuarterZones" type="checkbox">Progression des quartiers</label><label><input data-native="autoParcelZones" type="checkbox">Parcelles selon leur quartier</label><label>Pente maximale des rues <input data-native="maxStreetGrade" type="number" min="0.01" max="1" step="0.01"></label><label>Pente des ruelles <input data-native="maxLaneGrade" type="number" min="0.01" max="1" step="0.01"></label><label><input data-native="allowStairs" type="checkbox">Escaliers piétons</label><label>Pente des escaliers <input data-native="maxStairGrade" type="number" min="0.01" max="1" step="0.01"></label><small>0,12 = 12 %. La progression utilise les zones du plan ; décochez-la pour appliquer la zone sélectionnée partout.</small>';
nativeControls.style.cssText = 'margin:8px 12px;gap:12px;flex-direction:row;flex-wrap:wrap;align-items:center';
document.querySelector('header')!.after(nativeControls);
nativeControls.addEventListener('change', changed);
const initial: BenchOptions = { culture: 'european-organic', recipe: 'core', zone: 'core', placement: 'center', density: 1, count: 4, radius: 160, monument: 'none', stages: {} };
let draft = structuredClone(initial);
let state: State = { v: 2, options: structuredClone(initial), settings: structuredClone(initial), plotOptions: structuredClone(initial), houseOptions: structuredClone(initial), layoutSeed: '42', plotSeed: '42', houseSeed: '42', stage: 2, pins: [], view: [280, 280, 440, 440], showBlocks: true, showPlots: true, showHouses: true };
let layout: BenchLayout, houses: BenchHouses = { parcels: [], buildings: [] };
let partition: BenchParcels = { parcels: [], plots: [], compounds: [] };
let pinMode = false, busy = false;
let pendingWorkshopMessage: MessageEvent | undefined;
const status = (text: string) => { el('status').textContent = text; };
cultureMenus();
for (const stage of BENCH_STAGES) {
  const menu = select(stage + 'Preset');
  menu.onchange = () => {
    draft.stages![stage] = { preset: menu.value };
    syncMethods(); changed();
  };
}
for (const [key, values] of Object.entries(BENCH_OPERATORS)) {
  const menu = select(key);
  const stage: BenchStage = key === 'plotOp' ? 'plots' : key === 'buildingOp' ? 'buildings' : 'streets';
  if (stage === 'streets') values.forEach(value => menu.add(new Option(value, value)));
  else BENCH_METHODS[stage].forEach(method => menu.add(new Option(method.id, method.id)));
  menu.onchange = () => {
    const config = draft.stages![stage] ??= {};
    const P = editorMorph(controls(), stage);
    const method = stage === 'streets' ? undefined : BENCH_METHODS[stage].find(m => m.id === menu.value)!;
    const value = method ? (method.aliases.includes(String(P[key as keyof MorphologyParams])) ? P[key as keyof MorphologyParams] : method.aliases[0]) : menu.value;
    config.params = { ...config.params, [key]: value };
    syncMethods(); changed();
  };
}
function recipes(value = 'core'): void {
  const menu = select('recipe'); menu.replaceChildren();
  editorRecipes(culture.value).forEach(r => menu.add(new Option(r.label, r.id)));
  menu.value = value;
  if (!menu.value) menu.selectedIndex = 0;
}
function monuments(value = 'none'): void {
  monument.replaceChildren(new Option('Aucun', 'none'));
  const c = getCulture(culture.value);
  const kinds = new Set(c.landmarks.map(l => l.kind));
  if (c.nucleus.compound) kinds.add(c.nucleus.builder ?? ({ mosque: 'great-mosque', temple: 'hindu-temple' } as Record<string, string>)[c.nucleus.kind] ?? c.nucleus.kind);
  const nucleus = rustMode ? nativeCatalogue?.cultures[culture.value]?.nucleus : undefined;
  if (nucleus?.compound) kinds.add(nucleus.builder ?? nucleus.kind);
  if (rustMode && value !== 'none') kinds.add(value);
  kinds.forEach(kind => monument.add(new Option(kind, kind)));
  monument.value = kinds.has(value) ? value : 'none';
}
culture.onchange = () => {
  recipes(); monuments(); applyRecipe();
};
select('recipe').onchange = () => applyRecipe();
function applyRecipe(): void {
  draft.culture = culture.value; draft.recipe = select('recipe').value; draft.stages = {};
  select('zone').value = editorRecipes(culture.value).find(r => r.id === draft.recipe)?.zone ?? 'core';
  syncMethods(); changed();
}
function controls(): BenchOptions {
  return { ...structuredClone(draft), mode: select('mode').value as BenchOptions['mode'], microScale: Math.max(1, Math.min(5, Number(input('microScale').value) || 1)), microFrontage: select('microFrontage').value as BenchOptions['microFrontage'], culture: culture.value, recipe: select('recipe').value, zone: select('zone').value as Zone, placement: select('placement').value as BenchOptions['placement'], rings: select('rings').value === '2' ? 2 : 1, density: Number(select('density').value), count: Math.max(3, Math.min(rustMode ? 64 : 8, Math.round(Number(input('count').value) || 4))), radius: Math.max(rustMode ? 0.1 : 80, Math.min(rustMode ? 25000 : 300, Number(input('radius').value) || 160)), monument: monument.value, relief: select('relief').value as BenchOptions['relief'], reliefSlope: Math.max(5, Math.min(60, Number(input('reliefSlope').value) || 18)), river: select('river').value as BenchOptions['river'], riverWidth: Math.max(4, Math.min(50, Number(input('riverWidth').value) || 14)) };
}
function restoreControls(): void {
  select('engine').value = rustMode ? 'rust' : 'typescript';
  const buildingsOption = select('advancedStage').querySelector<HTMLOptionElement>('option[value=buildings]')!;
  buildingsOption.disabled = rustMode; buildingsOption.hidden = rustMode;
  if (rustMode && select('advancedStage').value === 'buildings') select('advancedStage').value = 'streets';
  input('radius').min = rustMode ? '0.1' : '80'; input('radius').max = rustMode ? '25000' : '300';
  input('radius').step = rustMode ? 'any' : '20'; input('count').max = rustMode ? '64' : '8';
  el('houses').closest('fieldset')!.hidden = rustMode;
  el('houses').closest('fieldset')!.style.display = rustMode ? 'none' : '';
  input('showHouses').closest('label')!.hidden = rustMode;
  select('placement').querySelector<HTMLOptionElement>('option[value=center]')!.textContent = rustMode ? 'Plan culturel adapté au terrain' : 'Autour du centre';
  el('editorSource').textContent = rustMode ? state.urban?.source === 'map' ? 'Rust · plan de la carte' : 'Rust · atelier indépendant' : '';
  nativeControls.hidden = !rustMode; nativeControls.style.display = rustMode ? 'flex' : 'none';
  const native = { fortification: 'culture', maxStreetGrade: 0.12, maxLaneGrade: 0.18, maxStairGrade: 0.65, allowStairs: true, ...state.urban?.layoutConfig,
    autoQuarterZones: state.urban?.layoutConfig?.zone === 'auto', autoParcelZones: state.urban?.parcelConfig?.zone === 'auto' };
  for (const control of Array.from(nativeControls.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-native]'))) {
    const value = native[control.dataset.native! as keyof typeof native];
    if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = Boolean(value); else control.value = String(value);
  }
  draft = structuredClone(state.settings); draft.stages ??= {};
  culture.value = draft.culture; recipes(draft.recipe ?? (draft.zone === 'village' ? 'village' : 'core'));
  select('zone').value = draft.zone;
  select('mode').value = draft.mode ?? 'quarters';
  input('microScale').value = String(draft.microScale ?? 1);
  select('microFrontage').value = draft.microFrontage ?? 'front';
  syncMode();
  select('placement').value = draft.placement === 'lateral' ? 'rectangle' : draft.placement ?? 'center';
  select('rings').value = String(draft.rings ?? 1);
  if (!Array.from(select('density').options).some(option => option.value === String(draft.density))) select('density').add(new Option(`× ${draft.density}`, String(draft.density)));
  select('density').value = String(draft.density);
  input('count').value = String(draft.count);
  input('radius').value = String(draft.radius);
  monuments(draft.monument);
  select('relief').value = draft.relief ?? 'flat'; input('reliefSlope').value = String(draft.reliefSlope ?? 18);
  select('river').value = draft.river ?? 'none'; input('riverWidth').value = String(draft.riverWidth ?? 14);
  input('layoutSeed').value = state.layoutSeed;
  input('plotSeed').value = state.plotSeed;
  input('houseSeed').value = state.houseSeed;
  input('blocks').checked = state.showBlocks;
  input('plots').checked = state.showPlots;
  input('showOrientation').checked = state.showOrientation ?? true;
  input('showHouses').checked = state.showHouses;
  input('realPlan').checked = state.realPlan ?? false;
  select('planDiagnostic').value = input('realPlan').checked ? 'none' : 'quarters';
  select('mapStyle').value = state.mapStyle ?? (isTerrainStyle(query.get('style')) ? query.get('style')! : 'parchment');
  syncMethods();
}
function syncMode(): void {
  const micro = select('mode').value === 'micro';
  el('layoutLegend').textContent = micro ? '1 · Micro formes' : '1 · Rues et îlots';
  el('layout').textContent = micro ? 'Appliquer les formes' : 'Appliquer les rues / îlots';
  el('randomLayout').textContent = micro ? '↻ Random shapes' : '↻ Graine';
  el('randomLayout').title = micro ? 'Nouvelle graine et variantes des dix formes' : 'Nouvelle graine et génération des rues';
  el('shapePresetLabel').hidden = !micro;
  el('microScaleLabel').hidden = !micro;
  el('microFrontageLabel').hidden = !micro;
  el('shapeHelp').hidden = !micro;
  for (const id of ['placement', 'rings', 'count', 'radius', 'monument', 'relief', 'reliefSlope', 'river', 'riverWidth', 'streetsPreset', 'streetOp', 'orientation', 'closeOp']) {
    el(id).closest('label')!.hidden = micro;
  }
}
select('mode').onchange = () => { syncMode(); changed(); };
input('microScale').oninput = () => { el('microScaleValue').textContent = `×${input('microScale').value}`; };
function syncMethods(): void {
  el('microScaleValue').textContent = `×${input('microScale').value}`;
  const options = controls();
  for (const stage of BENCH_STAGES) {
    if (rustMode && stage === 'buildings') continue;
    select(stage + 'Preset').value = draft.stages?.[stage]?.preset ?? 'culture';
    const P = editorMorph(options, stage);
    for (const key of Object.keys(BENCH_OPERATORS) as (keyof typeof BENCH_OPERATORS)[]) {
      if ((stage === 'plots' && key === 'plotOp') || (stage === 'buildings' && key === 'buildingOp') || (stage === 'streets' && ['streetOp', 'closeOp', 'orientation'].includes(key))) select(key).value = stage === 'streets' ? String(P[key]) : benchMethod(stage, String(P[key]));
    }
  }
  refreshAdvanced();
  refreshMethodParams();
}
const zoneFields = new Set(['houseArea', 'coverage', 'frontage', 'plotDepth', 'buildDepth', 'setback', 'footprintConformity', 'cornerFill']);
function methodValues(stage: 'plots' | 'buildings', P: MorphologyParams, zone: Zone): Record<string, unknown> {
  const defaults: Partial<Record<keyof MorphologyParams, unknown>> = { deepFill: false, blockCourtShare: [0.12, 0.45], blockSolidChance: 0.08, blockInfillChance: 0.22 };
  return Object.fromEntries(benchMethodFields(stage, P).map(key => [key, zoneFields.has(key) ? (P[key] as Record<Zone, unknown>)[zone] : key === 'houseVariation' ? HOUSE_VARIATION_ENABLED ? effectiveHouseVariation(P) : 0 : P[key] ?? defaults[key]]));
}
function refreshMethodParams(): void {
  const options = controls();
  for (const stage of ['plots', 'buildings'] as const) {
    if (rustMode && stage === 'buildings') continue;
    const P = editorMorph(options, stage), container = el(stage + 'Params');
    const values = methodValues(stage, P, options.zone);
    container.replaceChildren();
    const caption = document.createElement('small');
    const preset = draft.stages?.[stage]?.preset;
    const source = preset && preset !== 'culture' ? editorPresets()[preset].label : `${cultureLabel(options.culture)} / ${select('recipe').selectedOptions[0].textContent}`;
    caption.textContent = `${source} · zone ${options.zone} · valeurs après densité et surcharges`;
    container.append(caption);
    const editors: { path: string[]; control: HTMLInputElement; value: unknown }[] = [];
    const append = (value: unknown, path: string[]) => {
      if (value === undefined) {
        const button = document.createElement('button'); button.type = 'button';
        button.textContent = `Définir ${path.join('.')} (automatique)`;
        button.onclick = () => {
          const config = draft.stages![stage] ??= {};
          config.params = { ...config.params, courtyardShare: [0.35, 0.45] };
          syncMethods(); changed();
        };
        container.append(button); return;
      }
      if (value !== null && typeof value === 'object') {
        Object.entries(value).forEach(([key, item]) => append(item, [...path, key])); return;
      }
      const label = document.createElement('label'), name = document.createElement('span'), control = document.createElement('input');
      name.textContent = path.join('.').replace(/\.0$/, ' · min').replace(/\.1$/, ' · max');
      control.setAttribute('aria-label', `${stage} ${path.join('.')}`);
      control.dataset.param = path.join('.');
      control.type = typeof value === 'boolean' ? 'checkbox' : typeof value === 'number' ? 'number' : 'text';
      if (control.type === 'number') { control.step = 'any'; control.min = '0'; }
      if (['houseVariation', 'blockSolidChance', 'blockInfillChance'].includes(path[0])) control.max = '1';
      if (path[0] === 'blockCourtShare') control.max = '0.75';
      control.value = String(value); control.checked = value === true;
      if (path[0] === 'houseVariation' && !HOUSE_VARIATION_ENABLED) {
        control.disabled = true; control.title = 'Perturbations temporairement désactivées.';
      }
      editors.push({ path, control, value }); label.append(name, control); container.append(label);
      control.onchange = () => {
        editors.forEach(editor => editor.control.setCustomValidity(''));
        const params = structuredClone(draft.stages?.[stage]?.params ?? {}) as Record<string, unknown>;
        for (const editor of editors) {
          const keys = zoneFields.has(editor.path[0]) ? [editor.path[0], options.zone, ...editor.path.slice(1)] : editor.path;
          let target = params;
          keys.slice(0, -1).forEach((key, i) => {
            target[key] ??= /^\d+$/.test(keys[i + 1]) ? [] : {};
            target = target[key] as Record<string, unknown>;
          });
          target[keys.at(-1)!] = typeof editor.value === 'boolean' ? editor.control.checked : typeof editor.value === 'number' ? (editor.control.value === '' ? NaN : Number(editor.control.value)) : editor.control.value;
        }
        try {
          validateBenchParams(stage, params);
          (draft.stages![stage] ??= {}).params = params as BenchParams;
          refreshAdvanced(); refreshCultureDifferences(stage); changed();
          el(stage + 'ParamStatus').textContent = 'Paramètres enregistrés. Appliquer l’étape pour générer.';
        } catch (error) { control.setCustomValidity(String(error)); el(stage + 'ParamStatus').textContent = String(error); }
      };
    };
    Object.entries(values).forEach(([key, value]) => append(value, [key]));
    if (!Object.keys(values).length) container.append('Aucun paramètre configurable pour cet opérateur.');
    else {
      const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = 'Revenir aux paramètres du préréglage';
      reset.onclick = () => {
        const config = draft.stages![stage] ??= {}, key = stage === 'plots' ? 'plotOp' : 'buildingOp';
        config.params = { [key]: P[key] };
        syncMethods(); changed();
      };
      container.append(reset);
    }
    el(stage + 'ParamStatus').textContent = P.buildingOp === 'perimeterBlock' && stage === 'buildings'
      ? 'Pâté de maisons : conserve cutPlots et ses parcelles. Les profondeurs variées des bâtiments laissent un cœur irrégulier libre.' : '';
    refreshCultureDifferences(stage);
  }
}
function refreshCultureDifferences(stage: 'plots' | 'buildings'): void {
  const options = controls(), P = editorMorph(options, stage), key = stage === 'plots' ? 'plotOp' : 'buildingOp';
  const method = benchMethod(stage, P[key]), current = methodValues(stage, P, options.zone);
  const grouped = new Map<string, string[]>();
  for (const [id, culture] of Object.entries(rustMode && nativeCatalogue ? nativeCatalogue.cultures : CULTURES)) for (const recipe of editorRecipes(id)) {
    const native = editorMorph({ ...options, culture: id, recipe: recipe.id, stages: {} }, stage);
    if (benchMethod(stage, native[key]) !== method) continue;
    const values = methodValues(stage, native, options.zone);
    const differences = Object.fromEntries(Object.entries(values).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(current[k])));
    const signature = Object.entries(differences).map(([k, v]) => `${k} = ${v === undefined ? 'automatique' : JSON.stringify(v)}`).join('\n');
    if (!signature) continue;
    const labels = grouped.get(signature) ?? []; labels.push(`${culture.label} / ${recipe.label}`); grouped.set(signature, labels);
  }
  const container = el(stage + 'Cultures'); container.replaceChildren();
  if (!grouped.size) { container.textContent = 'Aucune différence pour cet opérateur dans la zone sélectionnée.'; return; }
  const table = document.createElement('table');
  const header = table.createTHead().insertRow();
  for (const title of ['Cultures / recettes', 'Paramètres différents des valeurs affichées']) { const cell = document.createElement('th'); cell.textContent = title; header.append(cell); }
  const body = table.createTBody();
  for (const [signature, labels] of grouped) {
    const row = body.insertRow(); row.insertCell().textContent = labels.join('\n'); row.insertCell().textContent = signature;
  }
  container.append(table);
}
function refreshAdvanced(): void {
  const stage = select('advancedStage').value as BenchStage;
  const P = editorMorph(controls(), stage);
  el<HTMLTextAreaElement>('params').value = JSON.stringify(draft.stages?.[stage]?.params ?? {}, null, 2);
  el('effectiveParams').textContent = JSON.stringify(Object.fromEntries(BENCH_FIELDS[stage].filter(key => P[key] !== undefined).map(key => [key, P[key]])), null, 2);
}
function changed(): void {
  if (hosted && rustMode && state.urban?.source === 'map') {
    const options = controls(), context = normalizeWorkshopContext(state.urban);
    const native: Record<string, unknown> = {};
    for (const control of Array.from(nativeControls.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-native]'))) {
      if (!control.checkValidity()) return;
      native[control.dataset.native!] = control instanceof HTMLInputElement ? control.type === 'checkbox' ? control.checked : Number(control.value) : control.value;
    }
    const quarterZone = native.autoQuarterZones ? 'auto' : options.zone, parcelZone = native.autoParcelZones ? 'auto' : options.zone;
    delete native.autoQuarterZones; delete native.autoParcelZones;
    context.layoutConfig = { ...context.layoutConfig, ...native, zone: quarterZone } as LayoutConfig;
    context.parcelConfig = { ...context.parcelConfig, zone: parcelZone } as ParcelConfig;
    const shared = { layoutConfig: state.stage < 2 ? workshopConfig(options, context, 'quarters') : context.layoutConfig!, parcelConfig: state.stage >= 2 ? workshopConfig(options, context, 'parcels') : context.parcelConfig!, quarterSeed: input('layoutSeed').value, parcelSeed: input('plotSeed').value };
    window.parent.postMessage({ channel: WORKSHOP_CHANNEL, type: 'settings', state: shared }, location.protocol === 'file:' ? '*' : location.origin);
  }
  status('Réglages modifiés : appliquer l’étape concernée (les graines sont conservées).');
}
for (const id of ['layoutSeed', 'plotSeed']) input(id).addEventListener('change', changed);
select('advancedStage').onchange = () => refreshAdvanced();
el('applyParams').onclick = () => {
  const stage = select('advancedStage').value as BenchStage;
  try {
    const params: unknown = JSON.parse(el<HTMLTextAreaElement>('params').value);
    validateBenchParams(stage, params);
    (draft.stages![stage] ??= {}).params = params;
    syncMethods(); changed(); el('paramStatus').textContent = 'Paramètres enregistrés. Appliquer l’étape pour générer.';
  } catch (error) { el('paramStatus').textContent = String(error); }
};
el('resetParams').onclick = () => {
  const stage = select('advancedStage').value as BenchStage;
  if (draft.stages?.[stage]) draft.stages[stage]!.params = {};
  syncMethods(); changed(); el('paramStatus').textContent = 'Surcharges réinitialisées.';
};
for (const id of ['zone', 'placement', 'rings', 'density', 'microScale', 'microFrontage', 'count', 'radius', 'monument', 'relief', 'reliefSlope', 'river', 'riverWidth']) el(id).addEventListener('change', () => { syncMethods(); changed(); });
function save(): void {
  if (rustMode && state.urban) state.urban = normalizeWorkshopContext(state.urban);
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  const payload = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const params = new URLSearchParams({ case: payload });
  if (rustMode) params.set('engine', 'rust'); if (query.get('embedded') === '1') params.set('embedded', '1');
  history.replaceState(null, '', `${location.pathname}?${params}`);
  if (rustMode && state.urban?.layoutConfig && state.urban?.parcelConfig) nativeClient.state(payload, {
    layoutConfig: workshopConfig(state.options, state.urban, 'quarters'),
    parcelConfig: workshopConfig(state.plotOptions, state.urban, 'parcels'),
    quarterSeed: state.layoutSeed, parcelSeed: state.plotSeed,
    style: state.mapStyle ?? 'parchment',
  }, state.urban.source);
}
function path(poly: Polygon): string { return poly.length ? 'M' + poly.map(p => `${p.x},${p.y}`).join('L') + 'Z' : ''; }
function escape(text: string): string { return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }
function render(): void {
  const realPlan = input('realPlan').checked;
  const style = isTerrainStyle(select('mapStyle').value) ? select('mapStyle').value as TerrainStyle : 'parchment';
  const palette = terrainStyle(style).palette, streetColor = palette.urban.street;
  map.style.background = palette.paper;
  const nativeQuarters = nativeResult?.layouts.flatMap(l => l.quarters), nativeBlocks = nativeResult?.layouts.flatMap(l => l.blocks);
  const nativeParcels = nativeResult?.partitions?.flatMap(p => p.parcels);
  const quarterPath = (i: number): string => path(layout.quarters[i].lp.pts) + (nativeQuarters?.[i]?.shape.holes.map(path).join(' ') ?? '');
  const quarterPaths = layout.quarters.map((_, i) => `<path d="${quarterPath(i)}" fill-rule="evenodd" clip-rule="evenodd"/>`).join('');
  const waterPath = (water: BenchLayout['water'][number]): string => path(water.outer) + (water.holes ?? []).map(path).join('');
  let svg = `<defs><clipPath id="landClip">${quarterPaths}</clipPath><clipPath id="waterClip">${layout.water.map(w => `<path d="${waterPath(w)}" fill-rule="evenodd" clip-rule="evenodd"/>`).join('')}</clipPath></defs>`;
  for (const road of nativeResult?.roads ?? []) svg += `<path data-overlay="regional-roads" d="M${road.path.map(p => `${p.x},${p.y}`).join('L')}" fill="none" stroke="${palette.trackFill}" stroke-width="${road.widths[0] ?? 4}"/>`;
  for (const contour of layout.contours) svg += `<path data-overlay="relief" d="M${contour.map(p => `${p.x},${p.y}`).join('L')}" fill="none" stroke="${palette.contour}" stroke-opacity=".45" stroke-dasharray="3 4" stroke-width="1"/>`;
  if (inheritedWater) svg += waterAppearanceSvg(inheritedWater.geometry, inheritedWater.material, style);
  else for (const water of layout.water) svg += `<path data-overlay="river" d="${waterPath(water)}" fill="${waterShoreColor(style)}" fill-rule="evenodd"/>`;
  layout.quarters.forEach((q, i) => {
    svg += `<path data-quarter="${i}" d="${quarterPath(i)}" fill-rule="evenodd" fill="${realPlan ? streetColor : `hsl(${i * 137.5 % 360} 60% 75%)`}" fill-opacity="${realPlan ? 1 : .35}" stroke="${realPlan ? 'none' : '#888'}" stroke-width=".5"/>`;
    const c = polygonCentroid(q.lp.pts);
    const name = layout.shapeNames?.[i];
    const y = name ? Math.min(...q.lp.pts.map(p => p.y)) - 5 : c.y;
    svg += `<text data-shape-label="${i}" x="${c.x}" y="${y}" text-anchor="middle" fill="#777" font-size="${name ? 4 : 8}">${name ? escape(name) : 'Q' + (i + 1)}</text>`;
  });
  svg += '<g clip-path="url(#landClip)">';
  for (const st of layout.streets.list) if (!nativeResult && st.ribbon) svg += `<path d="M${st.path.map(p => `${p.x},${p.y}`).join('L')}" fill="none" stroke="${streetColor}" stroke-width="${st.widths[0]}" stroke-linejoin="round"/>`;
  svg += '</g>';
  if (!nativeResult && layout.water.length) {
    svg += '<g data-overlay="bridges" clip-path="url(#waterClip)">';
    for (const st of layout.streets.list) {
      if (!st.ribbon || st.path.length < 2 || waterContains(layout.water, st.path[0]) || waterContains(layout.water, st.path[st.path.length - 1])) continue;
      const d = `M${st.path.map(p => `${p.x},${p.y}`).join('L')}`;
      svg += `<path d="${d}" fill="none" stroke="#7b6a4d" stroke-width="${st.widths[0] + 1}"/><path d="${d}" fill="none" stroke="#e5d8b8" stroke-width="${st.widths[0]}"/>`;
    }
    svg += '</g>';
  }
  if (nativeResult) svg += workshopStreetSvg(nativeResult.layouts);
  if (input('showHouses').checked) for (const b of houses.buildings) svg += `<path data-building="${b.parcel}" d="${path(b.poly)} ${b.courtyards?.map(path).join(' ') ?? ''}" fill="${b.kind === 'garden' ? palette.urban.garden : b.kind === 'landmark' ? palette.urban.landmark : palette.urban.mass}" fill-rule="evenodd" stroke="${palette.urban.massEdge}" stroke-width=".45"><title>${escape(b.arch ?? b.kind)} · parcelle ${b.parcel}</title></path>`;
  if (input('plots').checked) {
    svg += '<g data-overlay="plots" stroke-width="1" stroke-opacity=".8">';
    houses.parcels.forEach((p, i) => {
      const color = ['garden', 'reserve'].includes(p.use) ? '#5f8d42' : p.use === 'place' ? '#9b6450' : '#d68634';
      svg += `<path data-parcel="${i}" d="${path(p.poly)} ${nativeParcels?.[i]?.shape.holes.map(path).join(' ') ?? ''}" fill-rule="evenodd" fill="${color}" fill-opacity=".07" stroke="${color}" vector-effect="non-scaling-stroke"><title>Parcelle ${i} · ${escape(p.use)} · îlot ${p.block} · ${p.poly.length} sommets</title></path>`;
    });
    svg += '</g>';
  }
  if (input('blocks').checked && !realPlan) {
    svg += '<g data-overlay="blocks" fill="none" stroke="#b12e86" stroke-width="1.4" stroke-dasharray="5 3" pointer-events="none">';
    for (const [i, b] of layout.blocks.entries()) svg += `<path data-block-kind="${nativeBlocks?.[i]?.kind ?? b.kind}" ${nativeBlocks?.[i]?.kind === 'reserve' ? 'stroke="#7e9569" fill="#b8c8a9" fill-opacity=".2"' : ''} d="${path(b.poly)} ${nativeBlocks?.[i]?.shape.holes.map(path).join(' ') ?? ''}" fill-rule="evenodd" vector-effect="non-scaling-stroke"/>`;
    svg += '</g>';
  }
  if (input('showOrientation').checked) {
    svg += '<g data-overlay="block-y-axes" pointer-events="none">';
    for (const [index, block] of layout.blocks.entries()) {
      if (nativeBlocks?.[index]?.kind === 'reserve') continue;
      // Display the same post-cut frame that drives this sub-quarter's parcels.
      const frame = block.plotFrame;
      const axis = frame.u.y < 0 ? { x: -frame.u.x, y: -frame.u.y } : frame.u;
      const length = Math.hypot(axis.x, axis.y);
      if (!(length > 0)) continue;
      const dx = axis.x / length, dy = axis.y / length;
      const center = polygonCentroid(block.poly);
      const half = Math.max(10, Math.min(35, frame.hu * 0.6));
      const a = { x: center.x - dx * half, y: center.y - dy * half };
      const b = { x: center.x + dx * half, y: center.y + dy * half };
      const wingA = { x: b.x - dx * 4 - dy * 2, y: b.y - dy * 4 + dx * 2 };
      const wingB = { x: b.x - dx * 4 + dy * 2, y: b.y - dy * 4 - dx * 2 };
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      svg += `<g data-block-y="${index}"><title>Sous-quartier / îlot ${index} · axe Y des parcelles : ${angle.toFixed(1)}°</title><path d="M${a.x},${a.y}L${b.x},${b.y}" fill="none" stroke="white" stroke-width="4.5" vector-effect="non-scaling-stroke"/><path d="M${a.x},${a.y}L${b.x},${b.y}" fill="none" stroke="#006cff" stroke-width="2.5" vector-effect="non-scaling-stroke"/><path d="M${wingA.x},${wingA.y}L${b.x},${b.y}L${wingB.x},${wingB.y}" fill="none" stroke="#006cff" stroke-width="2.5" vector-effect="non-scaling-stroke"/><text x="${b.x + 3}" y="${b.y - 3}" fill="#006cff" stroke="white" stroke-width="1.5" paint-order="stroke" font-size="7" font-weight="bold">Y</text></g>`;
    }
    svg += '</g>';
  }
  if (nativeResult) svg += workshopEnclosureSvg(nativeResult.layouts);
  const pinSize = state.view[2] / 100;
  state.pins.forEach((p, i) => { svg += `<g data-pin="${i}" style="cursor:pointer"><circle cx="${p.x}" cy="${p.y}" r="${pinSize * 1.25}" fill="#bd2638" stroke="white" stroke-width="${pinSize * .2}"/><text x="${p.x}" y="${p.y}" text-anchor="middle" dominant-baseline="central" fill="white" font-size="${pinSize * 1.7}">${i + 1}</text><title>${escape(p.note)}</title></g>`; });
  map.innerHTML = svg;
  map.setAttribute('viewBox', state.view.join(' '));
  const list = el<HTMLOListElement>('pins');
  list.replaceChildren();
  state.pins.forEach((p, i) => {
    const li = document.createElement('li'), note = document.createElement('input'), remove = document.createElement('button');
    note.value = p.note; note.placeholder = `Pin ${i + 1}`; note.setAttribute('aria-label', `Note du pin ${i + 1}`);
    note.onchange = () => { p.note = note.value; save(); render(); };
    remove.textContent = 'Supprimer'; remove.title = 'Supprimer ce pin'; remove.setAttribute('aria-label', `Supprimer le pin ${i + 1}`);
    remove.onclick = () => { state.pins.splice(i, 1); save(); render(); };
    const coordinates = document.createElement('small'); coordinates.textContent = `${p.x.toFixed(1)}, ${p.y.toFixed(1)} m`;
    li.append(note, remove, coordinates); list.append(li);
  });
}
function fit(): void {
  const pts = layout.quarters.flatMap(q => q.lp.pts);
  if (!pts.length) return;
  const x0 = Math.min(...pts.map(p => p.x)) - 20, y0 = Math.min(...pts.map(p => p.y)) - 20;
  if (layout.options.mode === 'micro') {
    state.view = [x0, y0, Math.max(...pts.map(p => p.x)) - x0 + 20, Math.max(...pts.map(p => p.y)) - y0 + 20];
    return;
  }
  const size = Math.max(Math.max(...pts.map(p => p.x)) - x0, Math.max(...pts.map(p => p.y)) - y0) + 20;
  state.view = [x0, y0, size, size];
}
function newSeed(): string { return crypto.getRandomValues(new Uint32Array(1))[0].toString(36); }
function counts(ms?: number): void {
  el('pipeline').textContent = `${layout.options.mode === 'micro' ? 'Diversité · 10 micro formes' : layout.morph.streetOp + ' → ' + layout.morph.closeOp} → ${state.stage >= 2 ? benchMethod('plots', editorMorph(state.plotOptions, 'plots').plotOp) : '…'} → ${state.stage === 3 ? benchMethod('buildings', editorMorph(state.houseOptions, 'buildings').buildingOp) : '…'}`;
  status(`${rustMode ? 'Rust · ' : ''}${layout.quarters.length} ${layout.options.mode === 'micro' ? 'micro formes' : 'quartiers'} · ${layout.blocks.length} îlots · ${houses.parcels.filter(p => p.use === 'plot').length} parcelles constructibles · ${houses.parcels.filter(p => p.use === 'garden').length} arrière-terrains${rustMode ? '' : ` · ${houses.buildings.filter(b => b.kind !== 'garden').length} bâtiments`}${ms === undefined ? '' : ` · ${Math.round(ms)} ms`}${nativeResult?.layouts.flatMap(l => l.warnings).length ? ' · ' + nativeResult.layouts.flatMap(l => l.warnings).join(' ') : ''}`);
}
async function generate(action: 'layout' | 'parcels' | 'houses' | 'replay' | 'random' | 'load' | 'fortification'): Promise<void> {
  if (busy) return;
  if (action !== 'load' && action !== 'fortification') {
    const invalid = document.querySelector<HTMLInputElement>('.operator-params input:invalid');
    if (invalid) { invalid.reportValidity(); status('Corriger les paramètres invalides avant de générer.'); return; }
  }
  busy = true;
  document.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = true; });
  status('Génération…');
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const start = performance.now();
  const previous = structuredClone(state);
  const previousLayout = layout, previousPartition = partition, previousHouses = houses, previousNative = nativeResult;
  try {
    const settings = action === 'fortification' ? state.options : controls();
    for (const stage of BENCH_STAGES) if (!rustMode || stage !== 'buildings') editorMorph(settings, stage);
    if (action !== 'load' && action !== 'fortification') state.settings = settings;
    if (action === 'layout') {
      state.options = settings; state.layoutSeed = input('layoutSeed').value || '42'; state.stage = 1; state.pins = [];
    }
    if (action === 'parcels') {
      state.plotOptions = settings; state.plotSeed = input('plotSeed').value || '42'; state.stage = 2;
    }
    if (action === 'houses') {
      state.houseOptions = settings; state.houseSeed = input('houseSeed').value || '42';
      if (state.stage === 1) { state.plotOptions = settings; state.plotSeed = input('plotSeed').value || '42'; }
      state.stage = 3; state.showHouses = true;
    }
    if (action === 'random') {
      state.stage = 3; state.pins = []; state.showHouses = true;
    }
    if (action === 'replay' || action === 'random') {
      state.options = settings; state.plotOptions = settings; state.houseOptions = settings;
      state.layoutSeed = input('layoutSeed').value || '42'; state.plotSeed = input('plotSeed').value || '42'; state.houseSeed = input('houseSeed').value || '42';
    }
    if (rustMode) {
      state.engine = 'rust'; state.urban = normalizeWorkshopContext(state.urban ?? { source: 'fixture' });
      if (action === 'fortification') {
        state.urban.layoutConfig = { ...state.urban.layoutConfig, fortification: 'none' } as LayoutConfig;
      } else if (action !== 'load') {
        const native: Record<string, unknown> = {};
        for (const control of Array.from(nativeControls.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-native]'))) {
          if (!control.checkValidity()) { control.reportValidity(); throw new Error('Corrigez les paramètres du plan urbain.'); }
          native[control.dataset.native!] = control instanceof HTMLInputElement ? control.type === 'checkbox' ? control.checked : Number(control.value) : control.value;
        }
        const quarterZone = native.autoQuarterZones ? 'auto' : settings.zone, parcelZone = native.autoParcelZones ? 'auto' : settings.zone; delete native.autoQuarterZones; delete native.autoParcelZones;
        if (['layout', 'replay', 'random'].includes(action)) state.urban.layoutConfig = { ...state.urban.layoutConfig, ...native, zone: quarterZone } as LayoutConfig;
        if (['parcels', 'replay', 'random'].includes(action)) state.urban.parcelConfig = { ...state.urban.parcelConfig, zone: parcelZone } as ParcelConfig;
      }
      if (state.stage === 3) state.stage = 2;
      if (action === 'layout' || action === 'replay' || action === 'random' || action === 'load' || action === 'fortification') nativeResult = await nativeClient.generate({ kind: 'quarters', options: state.options, seed: state.layoutSeed, context: state.urban });
      if (!nativeResult) throw new Error('Générez d’abord les quartiers.');
      if (state.stage >= 2) nativeResult = await nativeClient.generate({ kind: 'parcels', options: state.plotOptions, seed: state.plotSeed, context: { ...state.urban, layoutConfig: nativeResult.layoutConfig }, layouts: nativeResult.layouts });
      state.urban = { ...state.urban, layoutConfig: nativeResult.layoutConfig, parcelConfig: nativeResult.parcelConfig };
      const view = workshopView(nativeResult, state.options, editorMorph(state.options, 'streets')); layout = view.layout; partition = view.partition;
      houses = { parcels: partition.parcels, buildings: [] };
    } else {
      nativeResult = undefined; state.engine = 'typescript';
      if (action === 'layout' || action === 'replay' || action === 'random' || action === 'load') layout = benchLayout(state.options, state.layoutSeed);
      if (state.stage === 1) partition = { parcels: [], plots: [], compounds: [] };
      else if (action !== 'houses' || previous.stage === 1) partition = benchParcels(layout, state.plotSeed, state.plotOptions);
      houses = state.stage === 3 ? benchBuildings(layout, partition, state.houseSeed, state.houseOptions) : { parcels: partition.parcels, buildings: [] };
    }
    if (action === 'layout' || action === 'replay' || action === 'random') fit();
    if (action !== 'fortification') restoreControls();
    render(); save();
    counts(performance.now() - start);
  } catch (error) {
    state = previous; layout = previousLayout; partition = previousPartition; houses = previousHouses; nativeResult = previousNative;
    status(`Erreur : ${String(error)}`);
  }
  finally { busy = false; document.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = false; });
    if (pendingWorkshopMessage) { const pending = pendingWorkshopMessage; pendingWorkshopMessage = undefined; receiveWorkshop(pending); }
  }
}
el('layout').onclick = () => void generate('layout');
el('parcels').onclick = () => void generate('parcels');
el('houses').onclick = () => void generate('houses');
nativeControls.querySelector<HTMLButtonElement>('[data-remove-enclosure]')!.onclick = () => {
  if (busy) return;
  nativeControls.querySelector<HTMLSelectElement>('[data-native="fortification"]')!.value = 'none';
  void generate('fortification');
};
for (const [id, action] of [
  ['streetsPreset', 'layout'], ['streetOp', 'layout'],
  ['plotsPreset', 'parcels'], ['plotOp', 'parcels'],
  ['buildingsPreset', 'houses'], ['buildingOp', 'houses'],
] as const) {
  const menu = select(id);
  const label = menu.closest('label')!.firstChild!.textContent!.trim();
  const stepper = document.createElement('span');
  stepper.className = 'select-stepper';
  menu.replaceWith(stepper);
  for (const direction of [-1, 1]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = direction === -1 ? '←' : '→';
    button.dataset.select = id;
    button.dataset.direction = String(direction);
    button.title = button.ariaLabel = `${label} ${direction === -1 ? 'précédent' : 'suivant'} · générer`;
    button.onclick = () => {
      if (busy || menu.options.length < 2) return;
      menu.selectedIndex = (menu.selectedIndex + direction + menu.options.length) % menu.options.length;
      menu.dispatchEvent(new Event('change', { bubbles: true }));
      void generate(action);
    };
    if (direction === -1) stepper.append(button, menu);
    else stepper.append(button);
  }
}
for (const [button, seed, action] of [['randomLayout', 'layoutSeed', 'layout'], ['randomPlots', 'plotSeed', 'parcels'], ['randomHouses', 'houseSeed', 'houses']] as const) el(button).onclick = () => { input(seed).value = newSeed(); void generate(action); };
el('clearHouses').onclick = () => {
  if (busy) return;
  state.stage = state.stage === 1 ? 1 : 2;
  houses = { parcels: partition.parcels, buildings: [] };
  render(); save();
  counts();
};
el('replay').onclick = () => void generate('replay');
select('engine').onchange = () => {
  const next = select('engine').value;
  if (next === 'rust' && !hosted) {
    save(); const params = new URLSearchParams({ space: 'workshop', workshop: new URLSearchParams(location.search).get('case')! });
    location.href = `urbanbench.html?${params}`; return;
  }
  rustMode = next === 'rust'; state.engine = rustMode ? 'rust' : 'typescript';
  cultureMenus();
  if (!validCulture(state.settings.culture)) { state.settings = { ...state.settings, culture: culture.value, recipe: 'core', stages: {} }; }
  restoreControls(); void generate('replay');
};
el('randomAll').onclick = () => {
  if (busy) return;
  const randomIndex = (count: number): number => Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000 * count);
  const randomSelect = (id: string): void => {
    const menu = select(id);
    menu.selectedIndex = randomIndex(menu.options.length);
  };
  randomSelect('culture');
  recipes(); monuments();
  randomSelect('recipe');
  draft.culture = culture.value; draft.recipe = select('recipe').value; draft.stages = {};
  for (const id of ['zone', 'placement', 'rings', 'density', 'monument', 'relief', 'river']) randomSelect(id);
  for (const id of ['count', 'radius', 'reliefSlope', 'riverWidth']) {
    const field = input(id);
    const min = Number(field.min), max = Number(field.max), step = Number(field.step) || 1;
    field.value = String(min + randomIndex(Math.floor((max - min) / step) + 1) * step);
  }
  for (const id of ['layoutSeed', 'plotSeed', 'houseSeed']) input(id).value = newSeed();
  syncMethods();
  void generate('random');
};
el('fit').onclick = () => { fit(); render(); save(); };
input('plots').onchange = () => { state.showPlots = input('plots').checked; render(); save(); };
input('showOrientation').onchange = () => { state.showOrientation = input('showOrientation').checked; render(); save(); };
input('blocks').onchange = () => { state.showBlocks = input('blocks').checked; render(); save(); };
input('showHouses').onchange = () => { state.showHouses = input('showHouses').checked; render(); save(); };
input('realPlan').onchange = () => { state.realPlan = input('realPlan').checked; select('planDiagnostic').value = state.realPlan ? 'none' : 'quarters'; render(); save(); };
select('mapStyle').onchange = () => { state.mapStyle = select('mapStyle').value as TerrainStyle; render(); save(); };
select('planDiagnostic').onchange = () => { state.realPlan = select('planDiagnostic').value === 'none'; input('realPlan').checked = state.realPlan; render(); save(); };
el('pinMode').onclick = () => { pinMode = !pinMode; el('pinMode').setAttribute('aria-pressed', String(pinMode)); map.style.cursor = pinMode ? 'crosshair' : 'grab'; };
el('copy').onclick = async () => {
  save();
  if (rustMode && window.parent !== window) { window.parent.postMessage({ channel: WORKSHOP_CHANNEL, type: 'copy' }, location.protocol === 'file:' || location.origin === 'null' ? '*' : location.origin); return; }
  try { await navigator.clipboard.writeText(location.href); status('URL copiée : graines, paramètres, pins et vue.'); }
  catch { window.prompt('Copier cette URL', location.href); }
};
function point(event: MouseEvent): DOMPoint {
  return new DOMPoint(event.clientX, event.clientY).matrixTransform(map.getScreenCTM()!.inverse());
}
let drag: { x: number; y: number; view: number[]; moved: boolean } | undefined;
map.onpointerdown = event => {
  if (event.button !== 0 || pinMode || event.altKey || (event.target as Element).closest('[data-pin]')) return;
  drag = { x: event.clientX, y: event.clientY, view: [...state.view], moved: false }; map.setPointerCapture(event.pointerId);
};
map.onpointermove = event => {
  if (!drag) return;
  const scale = Math.min(map.clientWidth / state.view[2], map.clientHeight / state.view[3]);
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  drag.moved ||= Math.hypot(dx, dy) > 3;
  state.view = [drag.view[0] - dx / scale, drag.view[1] - dy / scale, drag.view[2], drag.view[3]];
  map.setAttribute('viewBox', state.view.join(' '));
};
let moved = false;
map.onpointerup = () => { moved = drag?.moved ?? false; drag = undefined; save(); };
map.onpointercancel = () => { drag = undefined; };
map.onclick = event => {
  if (moved) { moved = false; return; }
  const target = (event.target as Element).closest('[data-pin]');
  if (target) { const i = Number(target.getAttribute('data-pin')); const note = window.prompt('Note du pin', state.pins[i].note); if (note !== null) state.pins[i].note = note; }
  else if (pinMode || event.altKey) { const p = point(event); const note = window.prompt('Note du pin', ''); if (note === null) return; state.pins.push({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, note }); }
  else return;
  render(); save();
};
map.addEventListener('wheel', event => {
  event.preventDefault(); const p = point(event), [x, y, w, h] = state.view;
  const factor = Math.max(20 / w, Math.min(2000 / w, Math.exp(Math.sign(event.deltaY) * .15)));
  state.view = [p.x - (p.x - x) * factor, p.y - (p.y - y) * factor, w * factor, h * factor]; render(); save();
}, { passive: false });
try {
  const encoded = new URLSearchParams(location.search).get('case');
  if (encoded) {
    let parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)))) as State;
    // Keep links from the prototype readable, including the old lateral rectangle.
    if (Number(parsed.v) === 1) {
      const old = parsed as unknown as { options: BenchOptions; layoutSeed: string; houseSeed: string; houseCulture: string; houseDensity: number; houses: boolean; pins: Pin[]; view: number[]; showBlocks?: boolean; showPlots?: boolean };
      const fill = { ...old.options, culture: old.houseCulture, density: old.houseDensity };
      parsed = { v: 2, options: old.options, settings: fill, plotOptions: fill, houseOptions: fill, layoutSeed: old.layoutSeed, plotSeed: old.houseSeed, houseSeed: old.houseSeed, stage: old.houses ? 3 : 1, pins: old.pins, view: old.view, showBlocks: old.showBlocks ?? true, showPlots: old.showPlots ?? false, showHouses: true };
    }
    if (parsed.v !== 2 || !validCulture(parsed.options.culture) || !Array.isArray(parsed.pins) || !Array.isArray(parsed.view) || parsed.view.length !== 4 || !parsed.view.every(Number.isFinite) || parsed.view[2] <= 0 || parsed.view[3] <= 0 || ![1, 2, 3].includes(parsed.stage)) throw new Error('Cas invalide');
    parsed.options.count = Math.max(3, Math.min(rustMode ? 64 : 8, Math.round(parsed.options.count)));
    parsed.options.radius = Math.max(rustMode ? 0.1 : 80, Math.min(rustMode ? 25000 : 300, parsed.options.radius));
    for (const options of [parsed.options, parsed.settings, parsed.plotOptions, parsed.houseOptions]) {
      if (!validCulture(options.culture) || !Number.isFinite(options.density) || options.density <= 0) throw new Error('Culture ou densité invalide');
      if (!Number.isFinite(options.count) || !Number.isFinite(options.radius) || !['core', 'middle', 'edge', 'faubourg', 'village'].includes(options.zone)) throw new Error('Dimensions ou zone invalides');
      if (options.microScale !== undefined && (!Number.isFinite(options.microScale) || options.microScale < 1 || options.microScale > 5)) throw new Error('Facteur de taille invalide');
      if (options.microFrontage !== undefined && !['front', 'perimeter'].includes(options.microFrontage)) throw new Error('Desserte micro invalide');
      if (options.mode && !['quarters', 'micro'].includes(options.mode)) throw new Error('Mode invalide');
      if (options.placement && !['center', 'lateral', 'rectangle', 'skew', 'notched'].includes(options.placement)) throw new Error('Forme invalide');
      if (options.relief && !['flat', 'valley', 'hill'].includes(options.relief)) throw new Error('Relief invalide');
      if (options.river && !['none', 'vertical', 'horizontal', 'diagonal'].includes(options.river)) throw new Error('Rivière invalide');
      if (options.reliefSlope !== undefined && (!Number.isFinite(options.reliefSlope) || options.reliefSlope < 5 || options.reliefSlope > 60)) throw new Error('Pente invalide');
      if (options.riverWidth !== undefined && (!Number.isFinite(options.riverWidth) || options.riverWidth < 4 || options.riverWidth > 50)) throw new Error('Largeur rivière invalide');
      for (const stage of BENCH_STAGES) if (!rustMode || stage !== 'buildings') editorMorph(options, stage);
    }
    if (parsed.urban) parsed.urban = normalizeWorkshopContext(parsed.urban);
    state = parsed;
  }
} catch { status('URL invalide, paramètres par défaut.'); }
function receiveWorkshop(event: MessageEvent): void {
  if (event.source === window.parent && event.origin === (location.protocol === 'file:' ? 'null' : location.origin) && event.data?.channel === WORKSHOP_CHANNEL && event.data.type === 'sync-settings') {
    const incoming = event.data.state as WorkshopState;
    state.urban = normalizeWorkshopContext({ ...state.urban, source: 'map', layoutConfig: incoming.layoutConfig, parcelConfig: incoming.parcelConfig });
    state.options = workshopOptions(incoming.layoutConfig, state.options);
    state.plotOptions = workshopOptions(incoming.parcelConfig, state.plotOptions);
    state.settings = structuredClone(state.stage >= 2 ? state.plotOptions : state.options);
    state.layoutSeed = incoming.quarterSeed; state.plotSeed = incoming.parcelSeed;
    restoreControls(); status('Réglages synchronisés · appliquer l’étape pour recalculer.');
    return;
  }

  if (event.source !== window.parent || event.origin !== (location.protocol === 'file:' ? 'null' : location.origin) || event.data?.channel !== WORKSHOP_CHANNEL || !['import', 'fixture'].includes(event.data.type)) return;
  if (busy) { pendingWorkshopMessage = event; return; }
  if (event.source === window.parent && event.origin === (location.protocol === 'file:' ? 'null' : location.origin) && event.data?.channel === WORKSHOP_CHANNEL && event.data.type === 'fixture') {
    if (busy) return;
    inheritedWater = undefined; rustMode = true; state.urban = { source: 'fixture' }; state.settings.radius = 160; state.settings.relief = 'flat'; state.settings.river = 'none';
    restoreControls(); void generate('replay'); return;
  }
  if (event.source !== window.parent || event.origin !== (location.protocol === 'file:' ? 'null' : location.origin) || event.data?.channel !== WORKSHOP_CHANNEL || event.data.type !== 'import') return;
  const incoming = event.data.state as WorkshopState;
  const imported = { ...incoming, layoutConfig: normalizeLayoutConfig(incoming?.layoutConfig, true), parcelConfig: normalizeParcelConfig(incoming?.parcelConfig) };
  if (!imported?.layouts?.length) return;
  inheritedWater = event.data.waterAppearance;
  rustMode = true; state.engine = 'rust';
  if (isTerrainStyle(imported.style)) state.mapStyle = imported.style;
  const first = imported.layouts[0];
  const base = { ...initial, culture: first.culture, radius: event.data.radius ?? initial.radius };
  state.options = workshopOptions(imported.layoutConfig, base);
  state.plotOptions = workshopOptions(imported.parcelConfig, state.options);
  state.settings = structuredClone(state.plotOptions); state.houseOptions = structuredClone(state.plotOptions);
  state.layoutSeed = imported.quarterSeed; state.plotSeed = imported.parcelSeed;
  state.urban = { source: 'map', siteCulture: first.culture, layoutConfig: imported.layoutConfig, parcelConfig: imported.parcelConfig, radius: base.radius };
  state.stage = imported.partitions ? 2 : 1; state.pins = [];
  nativeResult = { layouts: imported.layouts, partitions: imported.partitions, water: event.data.water ?? [], contours: event.data.contours ?? [], roads: event.data.roads ?? [], layoutConfig: imported.layoutConfig, parcelConfig: imported.parcelConfig };
  const adapted = workshopView(nativeResult, state.options, editorMorph(state.options, 'streets')); layout = adapted.layout; partition = adapted.partition;
  houses = { parcels: partition.parcels, buildings: [] };
  restoreControls(); fit(); render(); save(); counts();
}
window.addEventListener('message', receiveWorkshop);
restoreControls();
if (hosted) window.parent.postMessage({ channel: WORKSHOP_CHANNEL, type: 'ready' }, location.protocol === 'file:' || location.origin === 'null' ? '*' : location.origin);
void generate('load');
