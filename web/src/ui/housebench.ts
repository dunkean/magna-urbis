import './housebench.css';
import { executionRuntime, applyExecutionProfile, installExecutionProfile } from './executionProfile';
import { installRecipeSharing, generationRecipe } from './recipeSharing';
import HouseWorker from './houseWorker?worker&inline';
import { callHouses, compileHousesModule, defaultHouseConfig, decodeHouseReplay, encodeHouseReplay, parseHouseBatch, parseHouseCatalogue, parseHouseEnvelope, ROLE_LABELS, validateHouseConfig, wellFormedSeed, type CatalogueBundle, type HouseBatch, type HouseConfig, type HouseRequest, type HouseResponse, type HouseUnit, type HouseView, type Preflight, type Point } from '../../../rust/bridge/houses';
import { commonHouseExtent, renderHouseSheet, renderHouseSvg, surfaceArea, unitBounds, xml } from '../../../rust/bridge/houseRender';
import { readUrbanHouseCase } from './urbanHouseTransfer';
import { enrichUrbanBuilding } from '../../../rust/bridge/architecture';
import { houseGenerateLabel } from './houseLocale';
import { houseGeometryLabel, houseGeometryDescription } from './houseGeometryLocale';
import { houseVariantText } from './houseVariantsLocale';
import { houseArchetypeLabel, houseMaterialLabel, housePackLabel, houseSourceDescription, houseSourceText } from './houseCatalogueLocale';
import { urbanText } from './urbanPanelLocale';

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Élément maisons manquant : ${id}`);
  return element as T;
};
const input = (id: string) => $<HTMLInputElement>(id);
const select = (id: string) => $<HTMLSelectElement>(id);
const button = (id: string) => $<HTMLButtonElement>(id);
const form = $<HTMLFormElement>('controls');
installExecutionProfile(document.querySelector('header') ?? form);
const status = $('status'), errorBox = $('error');
const view: HouseView = {mode: 'roof', level: 0, graph: false, dimensions: false};
let bundle: CatalogueBundle | undefined, batch: HouseBatch | undefined, selected: HouseUnit | undefined;
let worker: Worker | undefined, module: WebAssembly.Module | undefined, ticket = 0, action = 0, busy = false;
let pending: {ticket: number; resolve: (response: HouseResponse) => void; reject: (error: Error) => void} | undefined;
let lastPreflight: Preflight | undefined, preflightTimer: ReturnType<typeof setTimeout> | undefined;
let tourRunning = false, stopTour = false, replayGenerator: string | undefined;
let detailPan: Point = {x: 0, y: 0};
let detailMode: HouseView['mode'] = 'roof', syncFatal = false;
let noWorker = typeof Worker === 'undefined';
const overrideInputs = Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-override]'));
const localizedRoles: { [key in keyof typeof ROLE_LABELS]: readonly [string,string,string,string,string] } = {
  dwelling:['habitation','dwelling','住宅','vivienda','moradia'], residential_ensemble:['ensemble résidentiel','residential complex','住宅组群','conjunto residencial','conjunto residencial'],
  communal_dwelling:['habitat collectif','communal dwelling','集体住宅','vivienda colectiva','moradia coletiva'], mixed_residential:['habitat mixte','mixed residential','混合住宅','vivienda mixta','moradia mista'],
  domestic_annex:['annexe domestique','domestic annex','家庭附属建筑','anexo doméstico','anexo doméstico'], spatial_component:['composant spatial','spatial component','空间组件','componente espacial','componente espacial'],
  non_domestic:['non résidentiel','non-residential','非住宅','no residencial','não residencial'], landscape:['paysage','landscape','景观','paisaje','paisagem'],
};
const houseRole = (role: keyof typeof ROLE_LABELS): string => urbanText(localizedRoles[role] ?? [ROLE_LABELS[role],ROLE_LABELS[role],ROLE_LABELS[role],ROLE_LABELS[role],ROLE_LABELS[role]]);
const confidenceLabels: Record<string, readonly [string,string,string,string,string]> = {
  stylized: ['stylisé','stylized','风格化','estilizado','estilizado'],
  source_preset: ['préréglage issu des sources','source-based preset','基于来源的预设','preajuste basado en fuentes','predefinição baseada em fontes'],
  uncertain: ['incertain','uncertain','不确定','incierto','incerto'],
  not_applicable: ['sans objet','not applicable','不适用','no aplicable','não aplicável'],
  broad_tradition: ['tradition générale','broad tradition','广义传统','tradición general','tradição geral'],
  source_period: ['période des sources','source period','来源时期','período de las fuentes','período das fontes'],
  undated_tradition: ['tradition non datée','undated tradition','未定年代的传统','tradición sin datar','tradição sem datação'],
};
const houseConfidence = (value: string): string => confidenceLabels[value] ? urbanText(confidenceLabels[value]) : value;
const NO_MATERIAL = '__house_no_material__';
let screenSource: 'atlas' | 'workshop' = 'atlas';
const sourceState = new Map<string, Map<string, string | boolean>>();
const sourceFields = ['pack', 'recipe', 'mode', 'era', 'allow-late', 'size', ...overrideInputs.map(element => element.id)];
function workshopPresets() { return bundle?.catalogue.workshop_presets ?? []; }
function workshopLabel(preset: {id: string; label: string}): string {
  const id = preset.id.replace(/^WORKSHOP-/, '');
  if (!id.startsWith('FP-') && !id.startsWith('RF-')) return preset.label;
  const original = bundle?.inventory.entries.find(entry => entry.id === id)?.label ?? id;
  return `${id.startsWith('FP-') ? urbanText(['Plan','Footprint','平面','Planta','Planta']) : urbanText(['Toiture','Roof','屋顶','Cubierta','Telhado'])} · ${houseGeometryLabel(id, original)} (${id})`;
}
function workshopDescription(preset: {id: string; description: string}): string {
  if (preset.id.startsWith('WORKSHOP-FP-')) return urbanText(['Primitive géométrique expérimentale, matériaux et programme déclarés.','Experimental geometric primitive, with declared materials and programme.','实验性几何基本形体，材料和用途已声明。','Primitiva geométrica experimental, con materiales y programa declarados.','Primitiva geométrica experimental, com materiais e programa declarados.']);
  if (preset.id.startsWith('WORKSHOP-RF-')) return urbanText(['Toiture expérimentale sur emprise et porteur compatibles.','Experimental roof on a compatible footprint and support.','用于兼容占地和支撑结构的实验性屋顶。','Cubierta experimental sobre una planta y soporte compatibles.','Telhado experimental sobre implantação e suporte compatíveis.']);
  return preset.description;
}
function unitLabel(unit: HouseUnit): string { const preset = workshopPresets().find(value => value.id === unit.recipe_id); return preset ? workshopLabel(preset) : houseArchetypeLabel(unit.recipe_id, unit.label); }
function isWorkshop(): boolean { return select('source').value === 'workshop'; }
function updateSourceControls(): void {
  const workshop = isWorkshop();
  $('atlas-controls').hidden = workshop; $('workshop-controls').hidden = !workshop; $('workshop-advanced').hidden = !workshop;
  for (const id of ['pack', 'recipe', 'mode', 'era']) select(id).disabled = workshop;
  input('allow-late').disabled = workshop; input('size').disabled = workshop;
  select('variant').disabled = workshop || !select('recipe').value;
  button('tour').disabled = workshop || tourRunning;
  if (workshop) { select('mode').value = 'fantasy_mix'; select('era').value = 'any'; input('allow-late').checked = false; input('size').value = '1'; }
  for (const id of ['footprint', 'roof', 'frame', 'infill', 'coating', 'cladding']) if (select(id).options[0]) select(id).options[0].text = workshop ? urbanText(['Selon le preset', 'From preset', '遵循预设', 'Según el preajuste', 'Conforme a predefinição']) : urbanText(['Selon la recette', 'From recipe', '遵循配方', 'Según la receta', 'Conforme a receita']);
  $('footprint-hint').textContent = workshop ? urbanText(['Primitive native du preset. Les combinaisons incompatibles restent refusées.', 'Native preset primitive. Incompatible combinations are rejected.', '预设的原生基本形体。不兼容的组合会被拒绝。', 'Primitiva nativa del preajuste. Se rechazan las combinaciones incompatibles.', 'Primitiva nativa da predefinição. Combinações incompatíveis são rejeitadas.']) : urbanText(["L'organisation de l'ensemble reste celle de la recette. Une substitution non appliquée est refusée.", 'The overall layout follows the recipe. An unapplied substitution is rejected.', '整体布局遵循配方。未应用的替换会被拒绝。', 'La organización del conjunto sigue la receta. Se rechazan las sustituciones no aplicadas.', 'A organização do conjunto segue a receita. Substituições não aplicadas são rejeitadas.']);
  updateOutputs(); updateRecipeHint();
}
function switchSource(next: 'atlas' | 'workshop'): void {
  const saved = new Map<string, string | boolean>();
  for (const id of sourceFields) { const element = $<HTMLInputElement | HTMLSelectElement>(id); saved.set(id, element instanceof HTMLInputElement && element.type === 'checkbox' ? element.checked : element.value); }
  sourceState.set(screenSource, saved); screenSource = next; select('source').value = next;
  const restored = sourceState.get(next);
  if (restored) {
    select('pack').value = String(restored.get('pack')); populateRecipes(String(restored.get('recipe')) || null);
    for (const [id, value] of restored) { const element = $<HTMLInputElement | HTMLSelectElement>(id); if (typeof value === 'boolean' && element instanceof HTMLInputElement) element.checked = value; else element.value = String(value); }
  } else for (const element of overrideInputs) element.value = '';
  lastPreflight = undefined; $('preflight').textContent = ''; updateSourceControls(); dirtyState(); schedulePreflight();
}

type LocalizedMessage = [string, string, string, string, string];
let currentMessage: string | LocalizedMessage = '';
function message(text: string | LocalizedMessage, loading = false): void { currentMessage = text; status.textContent = typeof text === 'string' ? text : urbanText(text); status.classList.toggle('busy', loading); }
function showError(error: unknown): void { errorBox.textContent = error instanceof Error ? error.message : String(error); errorBox.hidden = false; }
function clearError(): void { errorBox.hidden = true; errorBox.textContent = ''; }
function cancelRequest(): void {
  if (pending) { pending.reject(new Error('Requête remplacée.')); pending = undefined; }
  worker?.terminate(); worker = undefined;
}
function makeWorker(): Worker {
  const next = new HouseWorker();
  next.onmessage = (event: MessageEvent<HouseResponse>) => {
    if (worker !== next || !pending || event.data.ticket !== pending.ticket) return;
    const current = pending; pending = undefined;
    if ('error' in event.data) {
      if (event.data.fatal) { next.terminate(); if (worker === next) worker = undefined; }
      current.reject(new Error(`[${event.data.error.code}] ${event.data.error.message}`));
    } else current.resolve(event.data);
  };
  next.onerror = event => {
    event.preventDefault();
    if (worker !== next) return;
    const current = pending; pending = undefined; next.terminate(); if (worker === next) worker = undefined;
    current?.reject(new Error(`Worker maisons : ${event.message || 'initialisation impossible'}.`));
  };
  return next;
}
async function request(kind: HouseRequest['kind'], config?: HouseConfig): Promise<{json: string; elapsed_ms: number}> {
  const id = ++ticket;
  if (noWorker) {
    if (syncFatal) throw new Error(urbanText(['Le module WASM a rencontré une erreur fatale. Rechargez la page pour le réinitialiser.', 'The WASM module encountered a fatal error. Reload the page to reset it.', 'WASM 模块发生严重错误。请重新加载页面以重置。', 'El módulo WASM sufrió un error fatal. Recarga la página para restablecerlo.', 'O módulo WASM encontrou um erro fatal. Recarregue a página para reiniciá-lo.']));
    if (executionRuntime.profile === 'web' && config && config.count > 10) throw new Error(urbanText(['Le mode sans worker est limité à dix unités.', 'Without a worker, generation is limited to ten units.', '无 worker 模式最多生成十个单元。', 'El modo sin worker está limitado a diez unidades.', 'O modo sem worker está limitado a dez unidades.']));
    const started = performance.now();
    const message = kind === 'catalogue' ? {ticket: id, kind, module, runtime: executionRuntime} : {ticket: id, kind, config: config!, module, runtime: executionRuntime};
    let json: string;
    try { json = await callHouses(message as HouseRequest); }
    catch (error) { if (error instanceof WebAssembly.RuntimeError) syncFatal = true; throw error; }
    return {json, elapsed_ms: performance.now() - started};
  }
  if (!worker) {
    try { worker = makeWorker(); }
    catch { noWorker = true; message(['Worker indisponible : exécution WASM synchrone, dix unités maximum.', 'Worker unavailable: synchronous WASM, maximum ten units.', 'Worker 不可用：使用同步 WASM，最多十个单元。', 'Worker no disponible: WASM síncrono, máximo diez unidades.', 'Worker indisponível: WASM síncrono, máximo de dez unidades.']); return request(kind, config); }
  }
  if (pending) throw new Error(urbanText(['Une génération est déjà active.', 'Generation is already running.', '生成任务已在运行。', 'Ya hay una generación en curso.', 'Uma geração já está em andamento.']));
  return new Promise((resolve, reject) => {
    pending = {ticket: id, resolve: response => {
      if ('error' in response) reject(new Error(response.error.message));
      else resolve(response);
    }, reject};
    // Browsers may refuse Module cloning between opaque file:// origins.
    // The offline worker compiles its own embedded bytes in that case.
    const sharedModule = location.protocol === 'file:' ? undefined : module;
    const payload = kind === 'catalogue' ? {ticket: id, kind, module: sharedModule, runtime: executionRuntime} : {ticket: id, kind, config, module: sharedModule, runtime: executionRuntime};
    try { worker!.postMessage(payload); }
    catch (error) {
      if (error instanceof DOMException && error.name === 'DataCloneError') {
        try { worker!.postMessage({...payload, module: undefined}); }
        catch (retryError) { pending = undefined; reject(retryError); }
      } else { pending = undefined; reject(error); }
    }
  });
}
function readConfig(): HouseConfig {
  const config = defaultHouseConfig();
  config.seed = input('seed').value;
  if (!wellFormedSeed(config.seed)) throw new Error(urbanText(['La graine contient une séquence Unicode invalide.', 'The seed contains an invalid Unicode sequence.', '种子包含无效的 Unicode 序列。', 'La semilla contiene una secuencia Unicode inválida.', 'A semente contém uma sequência Unicode inválida.']));
  config.pack = select('pack').value; config.recipe = select('recipe').value || null;
  config.mode = select('mode').value as HouseConfig['mode']; config.era = select('era').value; config.allow_late = input('allow-late').checked;
  for (const [id, key] of [['count', 'count'], ['size', 'size'], ['variation', 'variation'], ['wealth', 'wealth'], ['orientation', 'orientation_deg']] as const) {
    const text = input(id).value;
    if (!text.trim() || !Number.isFinite(Number(text))) throw new Error(`Valeur invalide : ${id}.`);
    config[key] = Number(text);
  }
  for (const element of overrideInputs) {
    const key = element.dataset.override as keyof HouseConfig['overrides'];
    const value = element.value.trim();
    if (element instanceof HTMLInputElement && value && !Number.isFinite(Number(value))) throw new Error(`Valeur invalide : ${key}.`);
    (config.overrides as unknown as Record<string, string | number | null>)[key] = value === NO_MATERIAL ? '' : value ? element instanceof HTMLInputElement ? Number(value) : value : null;
  }
  if (isWorkshop()) {
    const preset = workshopPresets().find(preset => preset.id === select('workshop-preset').value);
    if (!preset) throw new Error('Choisissez un preset natif de l’atelier.');
    const optionalNumber = (id: string): number | null => {
      const value = input(id).value.trim(); if (!value) return null;
      if (!Number.isFinite(Number(value))) throw new Error(`Valeur invalide : ${id}.`);
      return Number(value);
    };
    const supportHeight = optionalNumber('workshop-support-height'), supportMaterial = select('workshop-support-material').value;
    const supportKind = select('workshop-support').value;
    config.pack = 'atelier'; config.recipe = null; config.mode = 'fantasy_mix'; config.era = 'any'; config.allow_late = false; config.size = 1;
    config.workshop = {preset_id: preset.id, footprint: config.overrides.footprint, roof: config.overrides.roof,
      width_m: optionalNumber('workshop-width'), depth_m: optionalNumber('workshop-depth'), roof_frame: select('workshop-roof-frame').value || null, base: select('workshop-base').value === NO_MATERIAL ? '' : select('workshop-base').value || null,
      support: supportKind || supportMaterial || supportHeight !== null ? {kind: (supportKind || preset.parameters.support.kind) as typeof preset.parameters.support.kind, material: supportMaterial || preset.parameters.support.material, height_m: supportHeight === null ? [...preset.parameters.support.height_m] : [supportHeight, supportHeight]} : null};
    config.overrides.footprint = null; config.overrides.roof = null; config.overrides.variant = null;
  }
  validateHouseConfig(config);
  return config;
}
function updateOutputs(): void {
  $('size-out').textContent = `${Number(input('size').value).toLocaleString('fr-FR', {minimumFractionDigits: 2})}×`;
  $('variation-out').textContent = `${Math.round(Number(input('variation').value) * 100)} %`;
  $('wealth-out').textContent = `${Math.round(Number(input('wealth').value) * 100)} %`;
}
function setConfig(config: HouseConfig): void {
  const nextSource = config.workshop ? 'workshop' : 'atlas';
  if (screenSource !== nextSource) switchSource(nextSource);
  select('source').value = nextSource; screenSource = nextSource;
  select('pack').value = config.pack; populateRecipes(config.recipe);
  input('seed').value = config.seed; select('mode').value = config.mode; select('era').value = config.era; input('allow-late').checked = config.allow_late;
  for (const [id, key] of [['count', 'count'], ['size', 'size'], ['variation', 'variation'], ['wealth', 'wealth'], ['orientation', 'orientation_deg']] as const) input(id).value = String(config[key]);
  for (const element of overrideInputs) { const value = config.overrides[element.dataset.override as keyof HouseConfig['overrides']]; element.value = element.id === 'coating' && value === '' ? NO_MATERIAL : value?.toString() ?? ''; }
  if (config.workshop) {
    const workshop = config.workshop;
    select('workshop-preset').value = workshop.preset_id;
    select('footprint').value = workshop.footprint ?? ''; select('roof').value = workshop.roof ?? '';
    input('workshop-width').value = workshop.width_m?.toString() ?? ''; input('workshop-depth').value = workshop.depth_m?.toString() ?? '';
    select('workshop-roof-frame').value = workshop.roof_frame ?? ''; select('workshop-base').value = workshop.base === '' ? NO_MATERIAL : workshop.base ?? '';
    select('workshop-support').value = workshop.support?.kind ?? ''; select('workshop-support-material').value = workshop.support?.material ?? '';
    input('workshop-support-height').value = workshop.support?.height_m[0]?.toString() ?? '';
  }
  updateSourceControls();
}
function option(value: string, label: string): HTMLOptionElement { const result = document.createElement('option'); result.value = value; result.textContent = label; return result; }
function populateRecipes(current: string | null = null): void {
  if (!bundle) return;
  select('recipe').replaceChildren(option('', urbanText(['Palette résidentielle du pack', 'Pack residential palette', '文化包住宅组合', 'Paleta residencial del paquete', 'Paleta residencial do pacote'])));
  for (const recipe of bundle.catalogue.recipes.filter(recipe => recipe.pack_id === select('pack').value)) {
    const role = recipe.role === 'dwelling' ? '' : ` · ${houseRole(recipe.role)}`;
    const rejected = lastPreflight?.rejected_recipes.some(rejection => rejection.id === recipe.id);
    select('recipe').add(option(recipe.id, `${houseArchetypeLabel(recipe.id, recipe.label)}${recipe.temporal.late_only ? ` · ${urbanText(['L tardif', 'L late', 'L 晚期', 'L tardío', 'L tardio'])}` : ''}${role}${rejected ? ` · ${urbanText(['incompatible', 'incompatible', '不兼容', 'incompatible', 'incompatível'])}` : ''}`));
  }
  if (current && Array.from(select('recipe').options).some(option => option.value === current)) select('recipe').value = current;
  populateVariants();
}
function populateVariants(): void {
  const recipe = bundle?.catalogue.recipes.find(recipe => recipe.id === select('recipe').value);
  const previous = select('variant').value;
  select('variant').replaceChildren(option('', recipe ? urbanText(['Tirage parmi les variantes admises', 'Choose from allowed variants', '从允许的变体中选择', 'Elegir entre variantes admitidas', 'Escolher entre variantes permitidas']) : urbanText(['Choisissez un type explicite', 'Choose an explicit type', '请选择具体类型', 'Elige un tipo explícito', 'Escolha um tipo específico'])));
  select('variant').disabled = !recipe;
  if (!recipe) return;
  select('variant').add(option(recipe.parameters.variant_id, urbanText(['Variante principale', 'Main variant', '主要变体', 'Variante principal', 'Variante principal'])));
  for (const variant of recipe.variants) select('variant').add(option(variant.id, houseVariantText(variant.label)));
  if (Array.from(select('variant').options).some(option => option.value === previous)) select('variant').value = previous;
}
function updateRecipeHint(): void {
  if (isWorkshop()) {
    const preset = workshopPresets().find(preset => preset.id === select('workshop-preset').value);
    $('recipe-hint').textContent = preset ? `${preset.parameters.footprint_family} · ${preset.parameters.roof_system} · ${urbanText(['confiance', 'confidence', '可信度', 'confianza', 'confiança'])} ${preset.confidence}. ${workshopDescription(preset)}` : urbanText(['L’atelier nécessite le catalogue natif de presets.', 'The workshop requires the native preset catalogue.', '工作坊需要原生预设目录。', 'El taller necesita el catálogo nativo de preajustes.', 'O ateliê exige o catálogo nativo de predefinições.']);
    return;
  }
  const recipe = bundle?.catalogue.recipes.find(recipe => recipe.id === select('recipe').value);
  $('recipe-hint').textContent = recipe ? `${recipe.parameters.footprint_family} · ${recipe.parameters.roof_system} · ${houseRole(recipe.role)}. ${recipe.temporal.late_only ? urbanText(['Profil caractéristique tardif. ', 'Characteristic late profile. ', '典型晚期形态。', 'Perfil característico tardío. ', 'Perfil característico tardio. ']) : ''}${houseSourceText(recipe.chronology_note || recipe.context_note) || urbanText(['Preset cartographique stylisé.', 'Stylised map preset.', '风格化地图预设。', 'Preajuste cartográfico estilizado.', 'Predefinição cartográfica estilizada.'])}` : urbanText(['Palette résidentielle : un choix déterministe parmi les recettes compatibles de cette tradition.', 'Residential palette: a deterministic choice among recipes compatible with this tradition.', '住宅组合：从符合该传统的配方中确定性地选择。', 'Paleta residencial: selección determinista entre recetas compatibles con esta tradición.', 'Paleta residencial: escolha determinística entre receitas compatíveis com esta tradição.']);
}
function populateCatalogueControls(): void {
  if (!bundle) return;
  const {catalogue, inventory} = bundle;
  select('pack').replaceChildren(...catalogue.packs.map(pack => option(pack.id, housePackLabel(pack.id, pack.label))));
  select('workshop-preset').replaceChildren(...workshopPresets().map(preset => option(preset.id, workshopLabel(preset))));
  select('source').disabled = false; select('source').querySelector<HTMLOptionElement>('option[value="workshop"]')!.disabled = !workshopPresets().length;
  select('workshop-preset').disabled = !workshopPresets().length;
  for (const [id, prefix] of [['footprint', 'FP-'], ['roof', 'RF-']] as const) {
    select(id).replaceChildren(option('', urbanText(['Selon la recette', 'From recipe', '遵循配方', 'Según la receta', 'Conforme a receita'])), ...inventory.entries.filter(entry => entry.id.startsWith(prefix)).map(entry => option(entry.id, `${entry.id} · ${houseGeometryLabel(entry.id, entry.label)}`)));
  }
  for (const [id, roles] of [['frame', ['frame', 'load_bearing']], ['infill', ['infill']], ['coating', ['coating']], ['cladding', ['cladding']]] as const) {
    select(id).replaceChildren(option('', urbanText(['Selon la recette', 'From recipe', '遵循配方', 'Según la receta', 'Conforme a receita'])), ...catalogue.materials.filter(material => material.roles.some(role => (roles as readonly string[]).includes(role))).map(material => option(material.id, houseMaterialLabel(material.id, material.label))));
    if (id === 'coating') select(id).add(option(NO_MATERIAL, urbanText(['Aucun', 'None', '无', 'Ninguno', 'Nenhum'])), 1);
  }
  for (const [id, roles] of [['workshop-roof-frame', ['roof_frame', 'load_bearing']], ['workshop-base', ['base', 'floor']], ['workshop-support-material', ['support', 'load_bearing', 'frame', 'base']]] as const) {
    select(id).replaceChildren(option('', 'Preset'), ...catalogue.materials.filter(material => material.roles.some(role => (roles as readonly string[]).includes(role))).map(material => option(material.id, houseMaterialLabel(material.id, material.label))));
    if (id === 'workshop-base') select(id).add(option(NO_MATERIAL, urbanText(['Aucune', 'None', '无', 'Ninguna', 'Nenhuma'])), 1);
  }
  select('pack').disabled = false; select('recipe').disabled = false;
  for (const id of ['generate', 'show-catalogue', 'tour']) button(id).disabled = false;
  updateCatalogueSummary();
}
function updateCatalogueSummary(): void {
  if (!bundle) return;
  const {catalogue, inventory} = bundle, fp = inventory.entries.filter(entry => entry.id.startsWith('FP-')).length, roofs = inventory.entries.filter(entry => entry.id.startsWith('RF-')).length;
  $('catalogue-summary').textContent = urbanText([
    `${catalogue.packs.length} packs · ${catalogue.recipes.length} recettes · ${catalogue.coverage.length} entrées B classées · ${fp} plans · ${roofs} toitures · ${catalogue.materials.length} matériaux. Version ${catalogue.catalogue_version}. Les associations de sources et leurs statuts ne prouvent pas la génération de chaque configuration.`,
    `${catalogue.packs.length} packs · ${catalogue.recipes.length} recipes · ${catalogue.coverage.length} classified B entries · ${fp} footprints · ${roofs} roofs · ${catalogue.materials.length} materials. Version ${catalogue.catalogue_version}. Source associations and statuses do not prove that every configuration can be generated.`,
    `${catalogue.packs.length} 个包 · ${catalogue.recipes.length} 个配方 · ${catalogue.coverage.length} 个已分类 B 条目 · ${fp} 个平面 · ${roofs} 种屋顶 · ${catalogue.materials.length} 种材料。版本 ${catalogue.catalogue_version}。来源关联和状态不能证明每种配置均可生成。`,
    `${catalogue.packs.length} paquetes · ${catalogue.recipes.length} recetas · ${catalogue.coverage.length} entradas B clasificadas · ${fp} plantas · ${roofs} cubiertas · ${catalogue.materials.length} materiales. Versión ${catalogue.catalogue_version}. Las asociaciones de fuentes y sus estados no demuestran que se genere cada configuración.`,
    `${catalogue.packs.length} pacotes · ${catalogue.recipes.length} receitas · ${catalogue.coverage.length} entradas B classificadas · ${fp} plantas · ${roofs} telhados · ${catalogue.materials.length} materiais. Versão ${catalogue.catalogue_version}. As associações de fontes e seus estados não comprovam a geração de cada configuração.`,
  ]);
}
async function preflight(config: HouseConfig): Promise<Preflight> {
  const result = await request('preflight', config);
  const check = parseHouseEnvelope<Preflight>(result.json);
  if (check.schema_version !== config.schema_version) throw new Error('Version de prévalidation incompatible.');
  return check;
}
function updatePreflightText(check: Preflight): void {
  const rejection = check.rejected_recipes.find(recipe => recipe.id === select('recipe').value);
  if (rejection) { $('preflight').textContent = rejection.reason; return; }
  const count = check.admissible_recipes.length, bodies = check.estimate.bodies, rooms = check.estimate.rooms, faces = check.estimate.faces, budget = check.budgets.faces;
  $('preflight').textContent = check.settings.workshop ? urbanText([
    `${count} preset admis · estimation par unité : ${bodies} corps, ${rooms} pièces, ${faces} faces. Budget du lot : ${budget} faces.`,
    `${count} admissible presets · estimate per unit: ${bodies} volumes, ${rooms} rooms, ${faces} faces. Batch budget: ${budget} faces.`,
    `${count} 个可用预设 · 每个单元预计：${bodies} 个体量、${rooms} 个房间、${faces} 个面。批次预算：${budget} 个面。`,
    `${count} preajustes admitidos · estimación por unidad: ${bodies} volúmenes, ${rooms} habitaciones, ${faces} caras. Presupuesto del lote: ${budget} caras.`,
    `${count} predefinições admitidas · estimativa por unidade: ${bodies} volumes, ${rooms} cômodos, ${faces} faces. Orçamento do lote: ${budget} faces.`,
  ]) : urbanText([
    `${count} recettes admises · estimation par unité : ${bodies} corps, ${rooms} pièces, ${faces} faces. Budget du lot : ${budget} faces.`,
    `${count} admissible recipes · estimate per unit: ${bodies} volumes, ${rooms} rooms, ${faces} faces. Batch budget: ${budget} faces.`,
    `${count} 个可用配方 · 每个单元预计：${bodies} 个体量、${rooms} 个房间、${faces} 个面。批次预算：${budget} 个面。`,
    `${count} recetas admitidas · estimación por unidad: ${bodies} volúmenes, ${rooms} habitaciones, ${faces} caras. Presupuesto del lote: ${budget} caras.`,
    `${count} receitas admitidas · estimativa por unidade: ${bodies} volumes, ${rooms} cômodos, ${faces} faces. Orçamento do lote: ${budget} faces.`,
  ]);
}
function displayPreflight(check: Preflight): void {
  lastPreflight = check;
  const explicit = select('recipe').value;
  if (!check.settings.workshop) populateRecipes(explicit || null);
  updatePreflightText(check);
}
function schedulePreflight(): void {
  clearTimeout(preflightTimer);
  preflightTimer = setTimeout(async () => {
    if (busy || tourRunning || !bundle) return;
    const currentAction = action;
    try { const check = await preflight(readConfig()); if (currentAction === action) displayPreflight(check); }
    catch (error) { if (currentAction === action) $('preflight').textContent = error instanceof Error ? error.message : String(error); }
  }, 450);
}
function dirtyState(): void {
  if (batch && !busy && !tourRunning) message(['Paramètres modifiés · la planche conserve le dernier lot réussi.', 'Settings changed · the sheet retains the last successful batch.', '参数已更改 · 展示板保留上次成功的批次。', 'Parámetros modificados · la lámina conserva el último lote generado.', 'Parâmetros alterados · o painel mantém o último lote gerado.']);
}
function setBusy(value: boolean): void { busy = value; button('generate').dataset.busy = String(value); button('generate').textContent = houseGenerateLabel(value); }
function updateReplay(): boolean {
  if (!batch) return false;
  try {
    const url = new URL(location.href);
    if (url.searchParams.has('placement')) return true;
    url.searchParams.set('houses', 'v1'); url.searchParams.set('replay', encodeHouseReplay(batch.settings, view, batch.generator_version));
    history.replaceState(null, '', url);
    button('copy-link').disabled = false; $('link-warning').hidden = true;
    return true;
  } catch (error) {
    const url = new URL(location.href); url.searchParams.delete('houses'); url.searchParams.delete('replay'); history.replaceState(null, '', url);
    button('copy-link').disabled = true; $('link-warning').hidden = false;
    $('link-warning').textContent = `${error instanceof Error ? error.message : String(error)} Le lot reste exportable en JSON.`;
    return false;
  }
}
function houseMetric(unit: HouseUnit): string {
  const area = surfaceArea(unit.partition.occupied).toFixed(0);
  return urbanText([`${unit.bodies.length} corps · ${unit.rooms.length} pièces · ${area} m²`, `${unit.bodies.length} volumes · ${unit.rooms.length} rooms · ${area} m²`, `${unit.bodies.length} 个体量 · ${unit.rooms.length} 个房间 · ${area} m²`, `${unit.bodies.length} volúmenes · ${unit.rooms.length} habitaciones · ${area} m²`, `${unit.bodies.length} volumes · ${unit.rooms.length} cômodos · ${area} m²`]);
}
function updateLocalizedBatchText(): void {
  if (!batch) return;
  const count = batch.units.length, seed = batch.settings.seed, version = batch.generator_version;
  const pack = bundle?.catalogue.packs.find(item => item.id === batch!.settings.pack);
  $('batch-title').textContent = batch.settings.workshop ? `${urbanText(['Atelier libre', 'Free workshop', '自由工作坊', 'Taller libre', 'Ateliê livre'])} · ${(() => { const preset = workshopPresets().find(value => value.id === batch!.settings.workshop!.preset_id); return preset ? workshopLabel(preset) : batch!.settings.workshop!.preset_id; })()}` : housePackLabel(batch.settings.pack, pack?.label ?? batch.settings.pack);
  $('batch-meta').textContent = urbanText([`Graine ${seed} · ${count} unités à échelle commune · ${version} · cliquez pour le détail`, `Seed ${seed} · ${count} units at a common scale · ${version} · click for details`, `种子 ${seed} · ${count} 个同尺度单元 · ${version} · 点击查看详情`, `Semilla ${seed} · ${count} unidades a escala común · ${version} · pulsa para ver detalles`, `Semente ${seed} · ${count} unidades na mesma escala · ${version} · clique para detalhes`]);
  for (const [index, unit] of batch.units.entries()) {
    const card = Array.from(document.querySelectorAll<HTMLElement>('.house-card')).find(element => element.dataset.unit === unit.id);
    if (!card) continue;
    const title = card.querySelector<HTMLElement>('.card-foot h3'); if (title) title.textContent = unitLabel(unit);
    const role = card.querySelector<HTMLElement>('.card-top span'); if (role) role.textContent = `${String(index + 1).padStart(2, '0')} / ${houseRole(unit.role)}`;
    const metric = card.querySelector<HTMLElement>('.card-foot p'); if (metric) {
      const missing = view.mode === 'plan' && !unit.levels.some(level => level.index === view.level) ? ` · ${urbanText(['niveau absent','floor unavailable','楼层不可用','planta no disponible','pavimento indisponível'])}` : '';
      metric.replaceChildren(document.createTextNode(houseMetric(unit)), document.createElement('br'), document.createTextNode(unit.recipe_id + missing));
    }
  }
}
window.addEventListener('magna-locale-change', () => {
  if (bundle) {
    populateRecipes(select('recipe').value); updateRecipeHint(); updateSourceControls();
    for (const pack of bundle.catalogue.packs) { const item = Array.from(select('pack').options).find(option => option.value === pack.id); if (item) item.textContent = housePackLabel(pack.id, pack.label); }
    for (const item of Array.from(select('workshop-preset').options)) { const preset = workshopPresets().find(value => value.id === item.value); if (preset) item.textContent = workshopLabel(preset); }
    for (const id of ['footprint', 'roof']) for (const item of Array.from(select(id).options)) { const entry = bundle.inventory.entries.find(value => value.id === item.value); if (entry) item.textContent = `${entry.id} · ${houseGeometryLabel(entry.id, entry.label)}`; }
    for (const id of ['frame', 'infill', 'coating', 'cladding', 'workshop-roof-frame', 'workshop-base', 'workshop-support-material']) {
      for (const item of Array.from(select(id).options)) { const material = bundle.catalogue.materials.find(value => value.id === item.value); if (material) item.textContent = houseMaterialLabel(material.id, material.label); }
    }
    for (const item of Array.from(document.querySelectorAll<HTMLElement>('.legend-item[data-material]'))) { const material = bundle.catalogue.materials.find(value => value.id === item.dataset.material); if (material && item.lastChild) item.lastChild.textContent = houseMaterialLabel(material.id, material.label); }
    for (const id of ['coating', 'workshop-base']) {
      const none = Array.from(select(id).options).find(item => item.value === NO_MATERIAL);
      if (none) none.textContent = urbanText(['Aucun', 'None', '无', 'Ninguno', 'Nenhum']);
    }
    if ($<HTMLDialogElement>('catalogue-dialog').open) showCatalogue();
  }
  if (typeof currentMessage !== 'string') status.textContent = urbanText(currentMessage);
  updateCatalogueSummary(); updateLocalizedBatchText(); if (lastPreflight) updatePreflightText(lastPreflight); if (selected) { $('detail-title').textContent = unitLabel(selected); $('detail-info').innerHTML = recipeInfo(selected); }
});
function renderBatch(): void {
  if (!batch || !bundle) return;
  $('batch-number').textContent = String(batch.units.length).padStart(2, '0');
  updateLocalizedBatchText();
  const levels = [...new Map(batch.units.flatMap(unit => unit.levels).map(level => [level.index, level])).values()].sort((a, b) => a.index - b.index);
  select('level').replaceChildren(...levels.map(level => option(String(level.index), `${level.index} · ${level.z_min.toFixed(1)}–${level.z_max.toFixed(1)} m`)));
  if (!levels.some(level => level.index === view.level)) view.level = levels[0]?.index ?? 0;
  select('level').value = String(view.level); select('level').disabled = view.mode !== 'plan' || !levels.length;
  button('view-roof').classList.toggle('active', view.mode === 'roof'); button('view-plan').classList.toggle('active', view.mode === 'plan');
  const extent = commonHouseExtent(batch.units);
  const cards = batch.units.map((unit, index) => {
    const card = document.createElement('button'); card.type = 'button'; card.className = 'house-card'; card.dataset.unit = unit.id;
    const metric = houseMetric(unit);
    card.innerHTML = `<div class="card-top"><span>${String(index + 1).padStart(2, '0')} / ${xml(houseRole(unit.role))}</span><span>↗</span></div>${renderHouseSvg(unit, bundle!.catalogue, view, {extent, prefix: `card-${index}`})}<div class="card-foot"><h3>${xml(unitLabel(unit))}</h3><p>${xml(metric)}<br/>${xml(unit.recipe_id)}${view.mode === 'plan' && !unit.levels.some(level => level.index === view.level) ? ` · ${urbanText(['niveau absent','floor unavailable','楼层不可用','planta no disponible','pavimento indisponível'])}` : ''}</p></div>`;
    card.addEventListener('click', () => openDetail(unit));
    return card;
  });
  $('gallery').replaceChildren(...cards);
  const used = new Set(batch.units.flatMap(unit => unit.bodies.flatMap(body => body.levels.flatMap(level => Object.values(level.materials)))));
  const colors: Record<string, string> = {tile: '#ad7f62', thatch: '#c9b47b', wood: '#b69b72', stone: '#bbb9a9', earth: '#c5ac8a', fabric: '#dad1b4', snow: '#e5e9e4', plain: '#cfbf9b'};
  $('legend').innerHTML = bundle.catalogue.materials.filter(material => used.has(material.id)).map(material => `<span class="legend-item" data-material="${xml(material.id)}"><i class="legend-swatch" style="background:${colors[material.pattern] ?? colors.plain}"></i>${xml(houseMaterialLabel(material.id, material.label))}</span>`).join('');
  $('legend').hidden = false;
  for (const id of ['copy-link', 'export-svg', 'export-json']) button(id).disabled = false;
  if (selected) { selected = batch.units.find(unit => unit.id === selected!.id); if (selected) renderDetail(); else $<HTMLDialogElement>('detail-dialog').close(); }
  updateReplay();
}
function commitBatch(next: HouseBatch, elapsed: number): void {
  batch = next; renderBatch();
  const count = next.units.length, time = elapsed.toFixed(0), diagnostics = next.diagnostics.length ? ` ${next.diagnostics.join(' ')}` : '';
  const engine = executionRuntime.profile === 'local' ? ['moteur Rust natif', 'native Rust engine', '原生 Rust 引擎', 'motor Rust nativo', 'mecanismo Rust nativo'] : noWorker ? ['WASM synchrone, sans worker', 'synchronous WASM, no worker', '同步 WASM，无 worker', 'WASM síncrono, sin worker', 'WASM síncrono, sem worker'] : ['moteur Rust/WASM', 'Rust/WASM engine', 'Rust/WASM 引擎', 'motor Rust/WASM', 'mecanismo Rust/WASM'];
  let notices: LocalizedMessage = ['', '', '', '', ''];
  if (!tourRunning) {
    try { if (JSON.stringify(readConfig()) !== JSON.stringify(next.settings)) notices = [' Paramètres modifiés pendant le calcul · la planche conserve les réglages de ce lot.', ' Settings changed during generation · the sheet retains this batch’s settings.', ' 计算期间参数已更改 · 展示板保留此批次的设置。', ' Los parámetros cambiaron durante el cálculo · la lámina conserva los de este lote.', ' Os parâmetros mudaram durante o cálculo · o painel mantém os deste lote.']; }
    catch { notices = [' Les contrôles diffèrent du lot affiché.', ' The controls differ from the displayed batch.', ' 当前控件与显示的批次不同。', ' Los controles difieren del lote mostrado.', ' Os controles diferem do lote exibido.']; }
  }
  message([`${count} unités générées en ${time} ms · ${engine[0]}.${diagnostics}${notices[0]}`, `${count} units generated in ${time} ms · ${engine[1]}.${diagnostics}${notices[1]}`, `${count} 个单元生成耗时 ${time} 毫秒 · ${engine[2]}。${diagnostics}${notices[2]}`, `${count} unidades generadas en ${time} ms · ${engine[3]}.${diagnostics}${notices[3]}`, `${count} unidades geradas em ${time} ms · ${engine[4]}.${diagnostics}${notices[4]}`]);
  if (replayGenerator && replayGenerator !== next.generator_version) {
    $('replay-warning').textContent = urbanText([`Le lien utilisait ${replayGenerator}, le moteur courant est ${next.generator_version} : le rejeu peut différer.`, `The link used ${replayGenerator}; the current engine is ${next.generator_version}, so replay may differ.`, `链接使用 ${replayGenerator}，当前引擎为 ${next.generator_version}；重放结果可能不同。`, `El enlace usaba ${replayGenerator} y el motor actual es ${next.generator_version}; la reproducción puede variar.`, `O link usava ${replayGenerator} e o mecanismo atual é ${next.generator_version}; a reprodução pode variar.`]);
    $('replay-warning').hidden = false;
  }
}
async function generate(config?: HouseConfig): Promise<void> {
  const currentAction = ++action; clearTimeout(preflightTimer); stopTour = true; tourRunning = false; button('tour').disabled = isWorkshop(); button('stop-tour').hidden = true; cancelRequest(); clearError(); setBusy(true);
  try {
    const settings = config ?? readConfig();
    message(['Vérification des paramètres et du budget…', 'Checking settings and budget…', '正在检查参数和预算…', 'Comprobando parámetros y presupuesto…', 'Verificando parâmetros e orçamento…'], true);
    const check = await preflight(settings);
    if (currentAction !== action) return;
    displayPreflight(check); message([`Génération de ${settings.count} unités architecturales…`, `Generating ${settings.count} architectural units…`, `正在生成 ${settings.count} 个建筑单元…`, `Generando ${settings.count} unidades arquitectónicas…`, `Gerando ${settings.count} unidades arquitetônicas…`], true);
    const response = await request('generate', settings);
    if (currentAction !== action) return;
    const forkUrl = new URL(location.href); forkUrl.searchParams.delete('placement'); history.replaceState(null, '', forkUrl);
    commitBatch(parseHouseBatch(response.json), response.elapsed_ms);
  } catch (error) {
    if (currentAction === action) { showError(error); message(batch ? ['Génération rejetée · le dernier lot réussi reste affiché.', 'Generation rejected · the last successful batch remains displayed.', '生成被拒绝 · 仍显示上次成功的批次。', 'Generación rechazada · se conserva el último lote generado.', 'Geração rejeitada · o último lote gerado permanece exibido.'] : ['Génération rejetée. Corrigez les paramètres puis relancez.', 'Generation rejected. Correct the settings and try again.', '生成被拒绝。请修正参数后重试。', 'Generación rechazada. Corrige los parámetros y vuelve a intentarlo.', 'Geração rejeitada. Corrija os parâmetros e tente novamente.']); }
  } finally { if (currentAction === action) setBusy(false); }
}
function recipeInfo(unit: HouseUnit): string {
  const recipe = bundle?.catalogue.recipes.find(recipe => recipe.id === unit.recipe_id);
  const variant = recipe?.variants.find(variant => variant.id === unit.variant_id);
  const preset = workshopPresets().find(preset => preset.id === unit.recipe_id);
  const slots = unit.bodies[0]?.levels[0]?.materials;
  const materialName = (id: string) => id === '' ? urbanText(['Aucun matériau','No material','无材料','Sin material','Sem material']) : houseMaterialLabel(id, bundle?.catalogue.materials.find(material => material.id === id)?.label ?? id);
  const roofSystems = [...new Set([...unit.bodies.map(body => body.roof_system), ...unit.roofs.groups.filter(group => group.feature_id).map(group => group.rf)])];
  const roofName = (id: string) => { const label = bundle?.inventory.entries.find(entry => entry.id === id)?.label; return label ? `${houseGeometryLabel(id, label)} (${id})` : id; };
  const context = recipe ? `<h3>${urbanText(['Contexte','Context','背景','Contexto','Contexto'])}</h3><p>${xml(houseSourceText(recipe.subtradition || recipe.context_note))}</p><p>${xml(houseSourceText(recipe.chronology_note))} ${recipe.temporal.late_only ? urbanText(['Profil caractéristique postérieur à 1500.','Characteristic profile after 1500.','典型特征晚于 1500 年。','Perfil característico posterior a 1500.','Perfil característico posterior a 1500.']) : ''}</p><div class="source-note"><strong>${urbanText(['Confiance de la recette','Recipe confidence','配方可信度','Confianza de la receta','Confiança da receita'])} : ${xml(houseConfidence(recipe.confidence))}</strong>${variant ? `<br/>Bundle ${xml(houseVariantText(variant.label))} : ${xml(houseConfidence(variant.confidence))}` : ''}<br/>${urbanText(['Toit','Roof','屋顶','Cubierta','Telhado'])} : ${xml(houseConfidence(recipe.roof_confidence))} · ${urbanText(['chronologie','chronology','年代','cronología','cronologia'])} : ${xml(houseConfidence(recipe.chronology_confidence))}<p>${houseSourceDescription(recipe.id, recipe.source_description).map(description => xml(description)).join('<br/>')}</p><small>${recipe.sources.map(source => `${xml(source.path)}:${source.line}`).join('<br/>')}</small></div>` : `<h3>${urbanText(['Atelier libre','Free workshop','自由工作坊','Taller libre','Ateliê livre'])}</h3><p>${xml(preset ? workshopLabel(preset) : unit.label)}</p><p>${xml(preset ? workshopDescription(preset) : urbanText(['Primitive paramétrique sans recette culturelle.','Parametric primitive without a cultural recipe.','无文化配方的参数化基本形体。','Primitiva paramétrica sin receta cultural.','Primitiva paramétrica sem receita cultural.']))}</p><div class="source-note"><strong>${urbanText(['Confiance','Confidence','可信度','Confianza','Confiança'])} : ${xml(preset?.confidence ? houseConfidence(preset.confidence) : urbanText(['non renseignée','not specified','未指定','no indicada','não informada']))}</strong><p>${urbanText(['Origine : preset libre du moteur. Aucune chronologie ou provenance archéologique attribuée.','Origin: free engine preset. No archaeological chronology or provenance is assigned.','来源：引擎的自由预设，未指定考古年代或来源。','Origen: preajuste libre del motor. No se atribuyen cronología ni procedencia arqueológica.','Origem: predefinição livre do mecanismo. Não há cronologia ou proveniência arqueológica atribuída.'])}</p></div>`;
  return `<h3>${urbanText(['Forme et métriques','Form and metrics','形状与指标','Forma y métricas','Forma e métricas'])}</h3><dl><dt>${recipe ? urbanText(['Recette','Recipe','配方','Receta','Receita']) : urbanText(['Preset','Preset','预设','Preajuste','Predefinição'])}</dt><dd>${xml(unit.recipe_id)}</dd><dt>${urbanText(['Variante','Variant','变体','Variante','Variante'])}</dt><dd>${xml(unit.variant_id)}</dd><dt>${urbanText(['Rôle','Role','角色','Función','Função'])}</dt><dd>${xml(houseRole(unit.role))}</dd><dt>${urbanText(['Corps / pièces','Volumes / rooms','体量 / 房间','Volúmenes / habitaciones','Volumes / cômodos'])}</dt><dd>${unit.bodies.length} / ${unit.rooms.length}</dd><dt>${urbanText(['Emprise occupée','Occupied footprint','占地面积','Superficie ocupada','Área ocupada'])}</dt><dd>${surfaceArea(unit.partition.occupied).toFixed(1)} m²</dd><dt>${urbanText(['Cours ouvertes','Open courtyards','开放庭院','Patios abiertos','Pátios abertos'])}</dt><dd>${surfaceArea(unit.partition.courtyards).toFixed(1)} m²</dd><dt>${urbanText(['Niveaux','Floors','楼层','Plantas','Pavimentos'])}</dt><dd>${unit.levels.length}</dd><dt>${urbanText(['Toitures','Roofs','屋顶','Cubiertas','Telhados'])}</dt><dd>${xml(roofSystems.map(roofName).join(', '))}</dd></dl>${slots ? `<h3>${urbanText(['Construction du corps principal','Main volume construction','主体结构','Construcción del volumen principal','Construção do volume principal'])}</h3><dl><dt>${urbanText(['Structure','Structure','结构','Estructura','Estrutura'])}</dt><dd>${xml(materialName(slots.frame))}</dd><dt>${urbanText(['Remplissage','Infill','填充材料','Relleno','Vedação'])}</dt><dd>${xml(materialName(slots.infill))}</dd><dt>${urbanText(['Enduit','Coating','饰面','Revestimiento','Revestimento'])}</dt><dd>${xml(materialName(slots.coating))}</dd><dt>${urbanText(['Couverture','Roof covering','屋面材料','Material de cubierta','Cobertura'])}</dt><dd>${xml(materialName(slots.cladding))}</dd><dt>${urbanText(['Porteur du toit','Roof support','屋顶支撑','Soporte del techo','Suporte do telhado'])}</dt><dd>${xml(materialName(slots.roof_frame))}</dd><dt>${urbanText(['Base','Base','底部','Base','Base'])}</dt><dd>${xml(materialName(slots.base))}</dd></dl>` : ''}${context}${unit.diagnostics.length ? `<h3>${urbanText(['Diagnostics','Diagnostics','诊断','Diagnósticos','Diagnósticos'])}</h3><p>${unit.diagnostics.map(diagnostic => xml(diagnostic)).join('<br/>')}</p>` : ''}`;
}
function openDetail(unit: HouseUnit): void {
  selected = unit; detailMode = view.mode; detailPan = {x: 0, y: 0}; input('detail-zoom').value = '1';
  select('detail-level').replaceChildren(...unit.levels.map(level => option(String(level.index), `${level.index} · ${level.z_min.toFixed(1)}–${level.z_max.toFixed(1)} m`)));
  select('detail-level').value = String(unit.levels.some(level => level.index === view.level) ? view.level : unit.levels[0]?.index ?? 0);
  renderDetail(); $<HTMLDialogElement>('detail-dialog').showModal();
}
function detailView(): HouseView { return {...view, mode: detailMode, level: Number(select('detail-level').value)}; }
function renderDetail(): void {
  if (!selected || !bundle) return;
  $('detail-title').textContent = unitLabel(selected);
  button('detail-view-roof').classList.toggle('active', detailMode === 'roof'); button('detail-view-plan').classList.toggle('active', detailMode === 'plan'); select('detail-level').disabled = detailMode !== 'plan';
  $('detail-map').innerHTML = renderHouseSvg(selected, bundle.catalogue, detailView(), {width: 740, height: 620, prefix: 'detail', zoom: Number(input('detail-zoom').value), pan: detailPan});
  $('detail-info').innerHTML = recipeInfo(selected);
}
function safeName(value: string): string { return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 70) || 'maisons'; }
function download(content: string, mime: string, name: string): void {
  const url = URL.createObjectURL(new Blob([content], {type: mime}));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function showCatalogue(): void {
  if (!bundle) return;
  const term = input('catalogue-search').value.toLocaleLowerCase('fr-FR'), kind = select('catalogue-kind').value;
  const match = (value: unknown) => {
    const item = value as {id?: string; label?: string};
    const id = item?.id ?? '', label = item?.label ?? '';
    return `${JSON.stringify(value)} ${houseArchetypeLabel(id, label)} ${houseMaterialLabel(id, label)} ${housePackLabel(id, label)} ${houseGeometryLabel(id, label)} ${id.startsWith('WORKSHOP-') ? workshopLabel({id, label}) : ''}`.toLocaleLowerCase('fr-FR').includes(term);
  };
  let entries: string[] = [];
  if (kind === 'coverage') entries = bundle.catalogue.coverage.filter(match).map(entry => {
    const source = bundle!.inventory.entries.find(source => source.id === entry.id);
    return `<article class="catalogue-entry"><h3>${xml(houseArchetypeLabel(entry.id, source?.label ?? entry.id))}</h3><code>${xml(entry.id)} · ${xml(houseRole(entry.role))} · ${xml(houseVariantText(entry.status))}</code><p>${xml(houseVariantText(entry.reason))}</p><small>Atlas · ${urbanText(['ligne', 'line', '行', 'línea', 'linha'])} ${source?.source_line ?? '?'}${source?.pack_id ? ` · ${xml(source.pack_id)}` : ''}</small></article>`;
  });
  else if (kind === 'recipes') entries = bundle.catalogue.recipes.filter(match).map(recipe => `<article class="catalogue-entry"><h3>${xml(houseArchetypeLabel(recipe.id, recipe.label))}</h3><code>${xml(recipe.id)} · ${xml(recipe.pack_id)} · ${xml(houseRole(recipe.role))} · ${xml(recipe.priority)}</code><p>${xml(recipe.parameters.footprint_family)} · ${xml(recipe.parameters.roof_system)} · ${xml(recipe.compound_pattern)}</p><p>${xml(houseSourceText(recipe.context_note))} ${xml(houseSourceText(recipe.chronology_note))}</p><p>${houseSourceDescription(recipe.id, recipe.source_description).map(description => xml(description)).join('<br/>')}</p><small>${urbanText(['Confiance', 'Confidence', '可信度', 'Confianza', 'Confiança'])} ${xml(houseConfidence(recipe.confidence))} · ${urbanText(['toit', 'roof', '屋顶', 'cubierta', 'telhado'])} ${xml(houseConfidence(recipe.roof_confidence))} · ${recipe.sources.map(source => `${xml(source.path)}:${source.line}`).join(', ')}</small></article>`);
  else if (kind === 'workshop') entries = workshopPresets().filter(match).map(preset => `<article class="catalogue-entry"><h3>${xml(workshopLabel(preset))}</h3><code>${xml(preset.id)} · ${xml(preset.parameters.footprint_family)} · ${xml(preset.parameters.roof_system)}</code><p>${xml(workshopDescription(preset))}</p><small>${urbanText(['Preset libre · confiance', 'Free preset · confidence', '自由预设 · 可信度', 'Preajuste libre · confianza', 'Predefinição livre · confiança'])} ${xml(houseConfidence(preset.confidence))}</small></article>`);
  else if (kind === 'materials') entries = bundle.catalogue.materials.filter(match).map(material => `<article class="catalogue-entry"><h3>${xml(houseMaterialLabel(material.id, material.label))}</h3><code>${xml(material.id)} · ${xml(material.pattern)}</code><p>${urbanText(['Fonctions', 'Roles', '用途', 'Funciones', 'Funções'])} : ${xml(material.roles.join(', '))}</p><small>${urbanText(['Origine', 'Origin', '来源', 'Origen', 'Origem'])} : ${xml(material.origin ?? urbanText(['non renseignée', 'not specified', '未指定', 'no indicado', 'não informada']))}${material.source_ref ? ` · ${xml(material.source_ref)}` : ''}</small></article>`);
  else if (kind === 'functional') entries = bundle.catalogue.functional_mappings.filter(match).map(mapping => `<article class="catalogue-entry"><h3>${xml(mapping.label)}</h3><code>${xml(mapping.kind)} · ${xml(mapping.status)}</code><p>${xml(mapping.usage)} · ${xml(mapping.recipe_ids.join(', '))}</p><small>${urbanText(['Catalogue fonctionnel · ligne', 'Functional catalogue · line', '功能目录 · 行', 'Catálogo funcional · línea', 'Catálogo funcional · linha'])} ${mapping.source_line}</small></article>`);
  else if (kind === 'geometry') entries = bundle.catalogue.geometry_traits.filter(match).map(trait => `<article class="catalogue-entry"><h3>${xml(trait.id)}</h3><code>${xml(trait.status)}</code><p>${urbanText(['Opérateur déclaré', 'Declared operator', '声明的运算符', 'Operador declarado', 'Operador declarado'])} : ${xml(trait.operator)}</p></article>`);
  else entries = bundle.inventory.entries.filter(entry => entry.id.startsWith(kind === 'footprints' ? 'FP-' : 'RF-')).filter(match).map(entry => `<article class="catalogue-entry"><h3>${xml(houseGeometryLabel(entry.id, entry.label))}</h3><code>${xml(entry.id)} · ${xml(entry.priority)}</code><p>${xml(houseGeometryDescription(entry.id, entry.columns.at(-1) ?? ''))}</p><small>Atlas · ${urbanText(['ligne', 'line', '行', 'línea', 'linha'])} ${entry.source_line}</small></article>`);
  $('catalogue-content').innerHTML = entries.join('') || `<p>${urbanText(['Aucune entrée ne correspond à la recherche.', 'No entries match the search.', '没有符合搜索条件的条目。', 'Ninguna entrada coincide con la búsqueda.', 'Nenhuma entrada corresponde à busca.'])}</p>`;
}
async function tour(): Promise<void> {
  if (!bundle || isWorkshop()) return;
  const currentAction = ++action; clearTimeout(preflightTimer); cancelRequest(); clearError();
  let base: HouseConfig;
  try { base = readConfig(); } catch (error) { showError(error); return; }
  base.recipe = null; base.overrides = defaultHouseConfig().overrides; setConfig(base);
  tourRunning = true; stopTour = false; button('tour').disabled = true; button('stop-tour').hidden = false; button('stop-tour').disabled = false;
  const table = $('tour-table').querySelector('tbody')!; table.replaceChildren();
  let completed = 0;
  try {
    for (const pack of bundle.catalogue.packs) {
      if (stopTour || action !== currentAction) break;
      const config = {...base, pack: pack.id};
      $('tour-progress').textContent = `${++completed} / ${bundle.catalogue.packs.length}`;
      const packName = housePackLabel(pack.id, pack.label);
      message([`Tournée · ${packName}`, `Tour · ${packName}`, `巡览 · ${packName}`, `Recorrido · ${packName}`, `Percurso · ${packName}`], true);
      const row = document.createElement('tr');
      const nameCell = document.createElement('td'), nameButton = document.createElement('button'); nameButton.textContent = housePackLabel(pack.id, pack.label); nameButton.disabled = true;
      nameCell.append(nameButton); row.append(nameCell);
      for (let index = 0; index < 3; index++) row.append(document.createElement('td'));
      row.cells[1].textContent = urbanText(['Génération…', 'Generating…', '正在生成…', 'Generando…', 'Gerando…']); table.append(row);
      try {
        await preflight(config);
        const response = await request('generate', config);
        if (currentAction !== action) break;
        const generated = parseHouseBatch(response.json);
        const count = generated.units.length;
        row.cells[1].textContent = urbanText([`${count} unités · réussi`, `${count} units · successful`, `${count} 个单元 · 成功`, `${count} unidades · correcto`, `${count} unidades · concluído`]);
        row.cells[2].textContent = String(generated.units.reduce((sum, unit) => sum + unit.rooms.length, 0));
        row.cells[3].textContent = `${response.elapsed_ms.toFixed(0)} ms`;
        nameButton.disabled = false;
        nameButton.addEventListener('click', () => { stopTour = true; setConfig(config); void generate(config); });
        commitBatch(generated, response.elapsed_ms);
      } catch (error) { row.cells[1].textContent = error instanceof Error ? error.message : String(error); row.cells[1].title = row.cells[1].textContent; }
    }
    if (currentAction === action) {
      if (batch) setConfig(batch.settings);
      message([`Tournée ${stopTour ? 'arrêtée' : 'terminée'} · ${completed} packs examinés. Cliquez une ligne réussie pour rejouer son lot.`, `Tour ${stopTour ? 'stopped' : 'completed'} · ${completed} packs examined. Click a successful row to replay its batch.`, `巡览${stopTour ? '已停止' : '已完成'} · 已检查 ${completed} 个文化包。点击成功的行可重放其批次。`, `Recorrido ${stopTour ? 'detenido' : 'terminado'} · ${completed} paquetes examinados. Pulsa una fila correcta para reproducir su lote.`, `Percurso ${stopTour ? 'interrompido' : 'concluído'} · ${completed} pacotes examinados. Clique em uma linha concluída para reproduzir o lote.`]);
    }
  } finally { if (currentAction === action) { tourRunning = false; button('tour').disabled = isWorkshop(); button('stop-tour').hidden = true; } }
}

form.addEventListener('submit', event => { event.preventDefault(); void generate(); });
form.addEventListener('input', () => { if (!busy && !tourRunning) { action++; cancelRequest(); } updateOutputs(); dirtyState(); schedulePreflight(); });
select('source').addEventListener('change', () => switchSource(select('source').value as 'atlas' | 'workshop'));
select('workshop-preset').addEventListener('change', () => { lastPreflight = undefined; $('preflight').textContent = ''; updateRecipeHint(); });
select('pack').addEventListener('change', () => { lastPreflight = undefined; populateRecipes(); updateRecipeHint(); });
select('recipe').addEventListener('change', () => { select('variant').value = ''; populateVariants(); updateRecipeHint(); });
button('reset-overrides').addEventListener('click', () => {
  for (const element of overrideInputs) element.value = '';
  if (isWorkshop()) for (const id of ['workshop-width', 'workshop-depth', 'workshop-roof-frame', 'workshop-base', 'workshop-support', 'workshop-support-material', 'workshop-support-height']) $<HTMLInputElement | HTMLSelectElement>(id).value = '';
  dirtyState(); schedulePreflight();
});
button('view-roof').addEventListener('click', () => { view.mode = 'roof'; renderBatch(); renderDetail(); });
button('view-plan').addEventListener('click', () => { view.mode = 'plan'; renderBatch(); renderDetail(); });
select('level').addEventListener('change', () => { view.level = Number(select('level').value); renderBatch(); });
for (const key of ['graph', 'dimensions'] as const) input(key).addEventListener('change', () => { view[key] = input(key).checked; renderBatch(); renderDetail(); });
button('show-catalogue').addEventListener('click', () => { showCatalogue(); $<HTMLDialogElement>('catalogue-dialog').showModal(); });
input('catalogue-search').addEventListener('input', showCatalogue); select('catalogue-kind').addEventListener('change', showCatalogue);
for (const name of ['detail', 'catalogue', 'link']) button(`close-${name}`).addEventListener('click', () => $<HTMLDialogElement>(`${name}-dialog`).close());
select('detail-level').addEventListener('change', renderDetail); input('detail-zoom').addEventListener('input', renderDetail);
button('detail-view-roof').addEventListener('click', () => { detailMode = 'roof'; renderDetail(); }); button('detail-view-plan').addEventListener('click', () => { detailMode = 'plan'; renderDetail(); });
button('detail-svg').addEventListener('click', () => { if (selected && bundle) download(renderHouseSvg(selected, bundle.catalogue, detailView(), {width: 1200, height: 1000, prefix: 'export-detail', zoom: Number(input('detail-zoom').value), pan: detailPan}), 'image/svg+xml;charset=utf-8', `${safeName(selected.recipe_id)}-${safeName(batch?.settings.seed ?? '')}.svg`); });
button('export-svg').addEventListener('click', () => { if (batch && bundle) download(renderHouseSheet(batch, bundle.catalogue, view), 'image/svg+xml;charset=utf-8', `maisons-${safeName(batch.settings.pack)}-${safeName(batch.settings.seed)}.svg`); });
button('export-json').addEventListener('click', () => { if (batch) download(JSON.stringify(batch, null, 2), 'application/json;charset=utf-8', `maisons-${safeName(batch.settings.pack)}-${safeName(batch.settings.seed)}.json`); });
button('copy-link').addEventListener('click', async () => { if (!updateReplay()) return; try { await navigator.clipboard.writeText(location.href); message(['Lien rejouable copié.', 'Replay link copied.', '重放链接已复制。', 'Enlace reproducible copiado.', 'Link de reprodução copiado.']); } catch { input('link-input').value = location.href; $<HTMLDialogElement>('link-dialog').showModal(); input('link-input').select(); } });
button('tour').addEventListener('click', () => void tour()); button('stop-tour').addEventListener('click', () => { stopTour = true; button('stop-tour').disabled = true; $('tour-progress').textContent += ` · ${urbanText(['arrêt demandé', 'stop requested', '已请求停止', 'parada solicitada', 'parada solicitada'])}`; });
let drag: {x: number; y: number; pan: Point} | undefined;
$('detail-map').addEventListener('pointerdown', event => { if (!selected) return; drag = {x: event.clientX, y: event.clientY, pan: {...detailPan}}; $('detail-map').setPointerCapture(event.pointerId); });
$('detail-map').addEventListener('pointermove', event => {
  if (!drag || !selected) return;
  const b = unitBounds(selected), extent = Math.max(b.width, b.height) * 1.18 / Number(input('detail-zoom').value);
  const pixels = Math.min($('detail-map').clientWidth, $('detail-map').clientWidth * 620 / 740);
  detailPan = {x: drag.pan.x - (event.clientX - drag.x) * extent / pixels, y: drag.pan.y - (event.clientY - drag.y) * extent / pixels}; renderDetail();
});
$('detail-map').addEventListener('pointerup', () => { drag = undefined; }); $('detail-map').addEventListener('pointercancel', () => { drag = undefined; });

async function start(): Promise<void> {
  try {
    if (executionRuntime.profile === 'web') module = await compileHousesModule();
    bundle = parseHouseCatalogue((await request('catalogue')).json); populateCatalogueControls();
    let config = defaultHouseConfig();
    const url = new URL(location.href);
    if (url.searchParams.has('placement')) {
      const building = await readUrbanHouseCase(url.searchParams.get('placement')!);
      const started = performance.now();
      const enriched = await enrichUrbanBuilding(building, executionRuntime);
      setConfig(enriched.settings); commitBatch(enriched, performance.now() - started);
      message(`Copie du bâtiment ${building.parcel_id} · altitude ${building.ground_z_m.toFixed(2)} m · plan, niveaux et placement conservés. Les essais restent dans le banc de maisons.`);
      return;
    }
    if (url.searchParams.has('replay')) {
      try {
        if (url.searchParams.get('houses') !== 'v1') throw new Error('Version du lien maisons inconnue.');
        const replay = decodeHouseReplay(url.searchParams.get('replay')!); validateHouseConfig(replay.config);
        config = replay.config; Object.assign(view, replay.view); replayGenerator = replay.generator_version;
      } catch (error) { showError(error); message('Lien invalide. Les valeurs par défaut sont chargées ; générez pour continuer.'); setConfig(config); return; }
    }
    setConfig(config); input('graph').checked = view.graph; input('dimensions').checked = view.dimensions;
    if (noWorker) message('Exécution WASM synchrone sans worker, dix unités maximum.');
    await generate(config);
  } catch (error) { showError(error); message('Moteur maisons indisponible. Lancez « npm run dev:houses » depuis web/.'); }
}
window.magnaBenchContext = {
  ready: () => !!bundle && !busy,
  capture: () => {
    let config: HouseConfig | undefined;
    try { config = readConfig(); } catch { /* Keep incomplete field values in the DOM snapshot. */ }
    return { config, selected: selected?.id, detailMode, detailPan };
  },
  restore: saved => {
    if (saved?.config) setConfig(saved.config);
    const unit = batch?.units.find(unit => unit.id === saved?.selected);
    if (unit) { openDetail(unit); detailMode = saved.detailMode; detailPan = saved.detailPan; }
  },
  refresh: () => { updateOutputs(); dirtyState(); if (selected) renderDetail(); },
};
installRecipeSharing({
  host: button('copy-link').parentElement!, embedded: window.parent !== window,
  capture: async () => {
    if (!batch || busy || !updateReplay()) throw new Error('Générez un lot de maisons avant d’exporter.');
    return generationRecipe('houses', new URL(location.href).searchParams.toString());
  },
});
void start();
