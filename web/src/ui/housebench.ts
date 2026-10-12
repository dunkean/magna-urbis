import './housebench.css';
import HouseWorker from './houseWorker?worker&inline';
import { callHouses, compileHousesModule, defaultHouseConfig, decodeHouseReplay, encodeHouseReplay, parseHouseBatch, parseHouseCatalogue, parseHouseEnvelope, ROLE_LABELS, validateHouseConfig, wellFormedSeed, type CatalogueBundle, type HouseBatch, type HouseConfig, type HouseRequest, type HouseResponse, type HouseUnit, type HouseView, type Preflight, type Point } from '../../../rust/bridge/houses';
import { commonHouseExtent, renderHouseSheet, renderHouseSvg, surfaceArea, unitBounds, xml } from '../../../rust/bridge/houseRender';

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Élément maisons manquant : ${id}`);
  return element as T;
};
const input = (id: string) => $<HTMLInputElement>(id);
const select = (id: string) => $<HTMLSelectElement>(id);
const button = (id: string) => $<HTMLButtonElement>(id);
const form = $<HTMLFormElement>('controls');
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
const NO_MATERIAL = '__house_no_material__';
let screenSource: 'atlas' | 'workshop' = 'atlas';
const sourceState = new Map<string, Map<string, string | boolean>>();
const sourceFields = ['pack', 'recipe', 'mode', 'era', 'allow-late', 'size', ...overrideInputs.map(element => element.id)];
function workshopPresets() { return bundle?.catalogue.workshop_presets ?? []; }
function isWorkshop(): boolean { return select('source').value === 'workshop'; }
function updateSourceControls(): void {
  const workshop = isWorkshop();
  $('atlas-controls').hidden = workshop; $('workshop-controls').hidden = !workshop; $('workshop-advanced').hidden = !workshop;
  for (const id of ['pack', 'recipe', 'mode', 'era']) select(id).disabled = workshop;
  input('allow-late').disabled = workshop; input('size').disabled = workshop;
  select('variant').disabled = workshop || !select('recipe').value;
  button('tour').disabled = workshop || tourRunning;
  if (workshop) { select('mode').value = 'fantasy_mix'; select('era').value = 'any'; input('allow-late').checked = false; input('size').value = '1'; }
  for (const id of ['footprint', 'roof', 'frame', 'infill', 'coating', 'cladding']) if (select(id).options[0]) select(id).options[0].text = workshop ? 'Selon le preset' : 'Selon la recette';
  $('footprint-hint').textContent = workshop ? 'Primitive native du preset. Les combinaisons incompatibles restent refusées.' : "L'organisation de l'ensemble reste celle de la recette. Une substitution non appliquée est refusée.";
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

function message(text: string, loading = false): void { status.textContent = text; status.classList.toggle('busy', loading); }
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
    if (syncFatal) throw new Error('Le module WASM a rencontré une erreur fatale. Rechargez la page pour le réinitialiser.');
    if (config && config.count > 10) throw new Error('Le mode sans worker est limité à dix unités.');
    const started = performance.now();
    const message = kind === 'catalogue' ? {ticket: id, kind, module} : {ticket: id, kind, config: config!, module};
    let json: string;
    try { json = await callHouses(message as HouseRequest); }
    catch (error) { if (error instanceof WebAssembly.RuntimeError) syncFatal = true; throw error; }
    return {json, elapsed_ms: performance.now() - started};
  }
  if (!worker) {
    try { worker = makeWorker(); }
    catch { noWorker = true; message('Worker indisponible : exécution WASM synchrone, dix unités maximum.'); return request(kind, config); }
  }
  if (pending) throw new Error('Une génération est déjà active.');
  return new Promise((resolve, reject) => {
    pending = {ticket: id, resolve: response => {
      if ('error' in response) reject(new Error(response.error.message));
      else resolve(response);
    }, reject};
    // Browsers may refuse Module cloning between opaque file:// origins.
    // The offline worker compiles its own embedded bytes in that case.
    const sharedModule = location.protocol === 'file:' ? undefined : module;
    const payload = kind === 'catalogue' ? {ticket: id, kind, module: sharedModule} : {ticket: id, kind, config, module: sharedModule};
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
  if (!wellFormedSeed(config.seed)) throw new Error('La graine contient une séquence Unicode invalide.');
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
  select('recipe').replaceChildren(option('', 'Palette résidentielle du pack'));
  for (const recipe of bundle.catalogue.recipes.filter(recipe => recipe.pack_id === select('pack').value)) {
    const role = recipe.role === 'dwelling' ? '' : ` · ${ROLE_LABELS[recipe.role]}`;
    const rejected = lastPreflight?.rejected_recipes.some(rejection => rejection.id === recipe.id);
    select('recipe').add(option(recipe.id, `${recipe.label}${recipe.temporal.late_only ? ' · L tardif' : ''}${role}${rejected ? ' · incompatible' : ''}`));
  }
  if (current && Array.from(select('recipe').options).some(option => option.value === current)) select('recipe').value = current;
  populateVariants();
}
function populateVariants(): void {
  const recipe = bundle?.catalogue.recipes.find(recipe => recipe.id === select('recipe').value);
  const previous = select('variant').value;
  select('variant').replaceChildren(option('', recipe ? 'Tirage parmi les variantes admises' : 'Choisissez un type explicite'));
  select('variant').disabled = !recipe;
  if (!recipe) return;
  select('variant').add(option(recipe.parameters.variant_id, 'Variante principale'));
  for (const variant of recipe.variants) select('variant').add(option(variant.id, variant.label));
  if (Array.from(select('variant').options).some(option => option.value === previous)) select('variant').value = previous;
}
function updateRecipeHint(): void {
  if (isWorkshop()) {
    const preset = workshopPresets().find(preset => preset.id === select('workshop-preset').value);
    $('recipe-hint').textContent = preset ? `${preset.parameters.footprint_family} · ${preset.parameters.roof_system} · confiance ${preset.confidence}. ${preset.description}` : 'L’atelier nécessite le catalogue natif de presets.';
    return;
  }
  const recipe = bundle?.catalogue.recipes.find(recipe => recipe.id === select('recipe').value);
  $('recipe-hint').textContent = recipe ? `${recipe.parameters.footprint_family} · ${recipe.parameters.roof_system} · ${ROLE_LABELS[recipe.role]}. ${recipe.temporal.late_only ? 'Profil caractéristique tardif. ' : ''}${recipe.chronology_note || recipe.context_note || 'Preset cartographique stylisé.'}` : 'Palette résidentielle : un choix déterministe parmi les recettes compatibles de cette tradition.';
}
function populateCatalogueControls(): void {
  if (!bundle) return;
  const {catalogue, inventory} = bundle;
  select('pack').replaceChildren(...catalogue.packs.map(pack => option(pack.id, pack.label)));
  select('workshop-preset').replaceChildren(...workshopPresets().map(preset => option(preset.id, preset.label)));
  select('source').disabled = false; select('source').querySelector<HTMLOptionElement>('option[value="workshop"]')!.disabled = !workshopPresets().length;
  select('workshop-preset').disabled = !workshopPresets().length;
  for (const [id, prefix] of [['footprint', 'FP-'], ['roof', 'RF-']] as const) {
    select(id).replaceChildren(option('', 'Selon la recette'), ...inventory.entries.filter(entry => entry.id.startsWith(prefix)).map(entry => option(entry.id, `${entry.id} · ${entry.label}`)));
  }
  for (const [id, roles] of [['frame', ['frame', 'load_bearing']], ['infill', ['infill']], ['coating', ['coating']], ['cladding', ['cladding']]] as const) {
    select(id).replaceChildren(option('', 'Selon la recette'), ...catalogue.materials.filter(material => material.roles.some(role => (roles as readonly string[]).includes(role))).map(material => option(material.id, material.label)));
    if (id === 'coating') select(id).add(option(NO_MATERIAL, 'Aucun'), 1);
  }
  for (const [id, roles] of [['workshop-roof-frame', ['roof_frame', 'load_bearing']], ['workshop-base', ['base', 'floor']], ['workshop-support-material', ['support', 'load_bearing', 'frame', 'base']]] as const) {
    select(id).replaceChildren(option('', 'Preset'), ...catalogue.materials.filter(material => material.roles.some(role => (roles as readonly string[]).includes(role))).map(material => option(material.id, material.label)));
    if (id === 'workshop-base') select(id).add(option(NO_MATERIAL, 'Aucune'), 1);
  }
  select('pack').disabled = false; select('recipe').disabled = false;
  for (const id of ['generate', 'show-catalogue', 'tour']) button(id).disabled = false;
  $('catalogue-summary').textContent = `${catalogue.packs.length} packs · ${catalogue.recipes.length} recettes · ${catalogue.coverage.length} entrées B classées · ${inventory.entries.filter(entry => entry.id.startsWith('FP-')).length} plans · ${inventory.entries.filter(entry => entry.id.startsWith('RF-')).length} toitures · ${catalogue.materials.length} matériaux. Version ${catalogue.catalogue_version}. Les associations de sources et leurs statuts ne prouvent pas la génération de chaque configuration.`;
}
async function preflight(config: HouseConfig): Promise<Preflight> {
  const result = await request('preflight', config);
  const check = parseHouseEnvelope<Preflight>(result.json);
  if (check.schema_version !== config.schema_version) throw new Error('Version de prévalidation incompatible.');
  return check;
}
function displayPreflight(check: Preflight): void {
  lastPreflight = check;
  const explicit = select('recipe').value;
  if (!check.settings.workshop) populateRecipes(explicit || null);
  const rejection = check.rejected_recipes.find(recipe => recipe.id === explicit);
  $('preflight').textContent = rejection ? rejection.reason : `${check.admissible_recipes.length} ${check.settings.workshop ? 'preset admis' : 'recettes admises'} · estimation par unité : ${check.estimate.bodies} corps, ${check.estimate.rooms} pièces, ${check.estimate.faces} faces. Budget du lot : ${check.budgets.faces} faces.`;
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
  if (batch && !busy && !tourRunning) message('Paramètres modifiés · la planche conserve le dernier lot réussi.');
}
function setBusy(value: boolean): void { busy = value; button('generate').textContent = value ? 'Relancer la génération ↗' : 'Générer les maisons ↗'; }
function updateReplay(): boolean {
  if (!batch) return false;
  try {
    const url = new URL(location.href);
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
function renderBatch(): void {
  if (!batch || !bundle) return;
  const pack = bundle.catalogue.packs.find(pack => pack.id === batch!.settings.pack);
  $('batch-title').textContent = batch.settings.workshop ? `Atelier libre · ${workshopPresets().find(preset => preset.id === batch!.settings.workshop!.preset_id)?.label ?? batch.settings.workshop.preset_id}` : pack?.label ?? batch.settings.pack;
  $('batch-number').textContent = String(batch.units.length).padStart(2, '0');
  $('batch-meta').textContent = `Graine ${batch.settings.seed} · ${batch.units.length} unités à échelle commune · ${batch.generator_version} · cliquez pour le détail`;
  const levels = [...new Map(batch.units.flatMap(unit => unit.levels).map(level => [level.index, level])).values()].sort((a, b) => a.index - b.index);
  select('level').replaceChildren(...levels.map(level => option(String(level.index), `${level.index} · ${level.z_min.toFixed(1)}–${level.z_max.toFixed(1)} m`)));
  if (!levels.some(level => level.index === view.level)) view.level = levels[0]?.index ?? 0;
  select('level').value = String(view.level); select('level').disabled = view.mode !== 'plan' || !levels.length;
  button('view-roof').classList.toggle('active', view.mode === 'roof'); button('view-plan').classList.toggle('active', view.mode === 'plan');
  const extent = commonHouseExtent(batch.units);
  const cards = batch.units.map((unit, index) => {
    const card = document.createElement('button'); card.type = 'button'; card.className = 'house-card'; card.dataset.unit = unit.id;
    const metric = `${unit.bodies.length} corps · ${unit.rooms.length} pièces · ${surfaceArea(unit.partition.occupied).toFixed(0)} m²`;
    card.innerHTML = `<div class="card-top"><span>${String(index + 1).padStart(2, '0')} / ${xml(ROLE_LABELS[unit.role])}</span><span>↗</span></div>${renderHouseSvg(unit, bundle!.catalogue, view, {extent, prefix: `card-${index}`})}<div class="card-foot"><h3>${xml(unit.label)}</h3><p>${xml(metric)}<br/>${xml(unit.recipe_id)}${view.mode === 'plan' && !unit.levels.some(level => level.index === view.level) ? ' · niveau absent' : ''}</p></div>`;
    card.addEventListener('click', () => openDetail(unit));
    return card;
  });
  $('gallery').replaceChildren(...cards);
  const used = new Set(batch.units.flatMap(unit => unit.bodies.flatMap(body => body.levels.flatMap(level => Object.values(level.materials)))));
  const colors: Record<string, string> = {tile: '#ad7f62', thatch: '#c9b47b', wood: '#b69b72', stone: '#bbb9a9', earth: '#c5ac8a', fabric: '#dad1b4', snow: '#e5e9e4', plain: '#cfbf9b'};
  $('legend').innerHTML = bundle.catalogue.materials.filter(material => used.has(material.id)).map(material => `<span class="legend-item"><i class="legend-swatch" style="background:${colors[material.pattern] ?? colors.plain}"></i>${xml(material.label)}</span>`).join('');
  $('legend').hidden = false;
  for (const id of ['copy-link', 'export-svg', 'export-json']) button(id).disabled = false;
  if (selected) { selected = batch.units.find(unit => unit.id === selected!.id); if (selected) renderDetail(); else $<HTMLDialogElement>('detail-dialog').close(); }
  updateReplay();
}
function commitBatch(next: HouseBatch, elapsed: number): void {
  batch = next; renderBatch();
  message(`${next.units.length} unités générées en ${elapsed.toFixed(0)} ms${noWorker ? ' · WASM synchrone, sans worker' : ' · moteur Rust/WASM'}.${next.diagnostics.length ? ` ${next.diagnostics.join(' ')}` : ''}`);
  if (!tourRunning) {
    try { if (JSON.stringify(readConfig()) !== JSON.stringify(next.settings)) message(`${status.textContent} Paramètres modifiés pendant le calcul · la planche conserve les réglages de ce lot.`); }
    catch { message(`${status.textContent} Les contrôles diffèrent du lot affiché.`); }
  }
  if (replayGenerator && replayGenerator !== next.generator_version) {
    $('replay-warning').textContent = `Le lien utilisait ${replayGenerator}, le moteur courant est ${next.generator_version} : le rejeu peut différer.`;
    $('replay-warning').hidden = false;
  }
}
async function generate(config?: HouseConfig): Promise<void> {
  const currentAction = ++action; clearTimeout(preflightTimer); stopTour = true; tourRunning = false; button('tour').disabled = isWorkshop(); button('stop-tour').hidden = true; cancelRequest(); clearError(); setBusy(true);
  try {
    const settings = config ?? readConfig();
    message('Vérification des paramètres et du budget…', true);
    const check = await preflight(settings);
    if (currentAction !== action) return;
    displayPreflight(check); message(`Génération de ${settings.count} unités architecturales…`, true);
    const response = await request('generate', settings);
    if (currentAction !== action) return;
    commitBatch(parseHouseBatch(response.json), response.elapsed_ms);
  } catch (error) {
    if (currentAction === action) { showError(error); message(batch ? 'Génération rejetée · le dernier lot réussi reste affiché.' : 'Génération rejetée. Corrigez les paramètres puis relancez.'); }
  } finally { if (currentAction === action) setBusy(false); }
}
function recipeInfo(unit: HouseUnit): string {
  const recipe = bundle?.catalogue.recipes.find(recipe => recipe.id === unit.recipe_id);
  const variant = recipe?.variants.find(variant => variant.id === unit.variant_id);
  const preset = workshopPresets().find(preset => preset.id === unit.recipe_id);
  const slots = unit.bodies[0]?.levels[0]?.materials;
  const materialName = (id: string) => id === '' ? 'Aucun matériau' : bundle?.catalogue.materials.find(material => material.id === id)?.label ?? id;
  const context = recipe ? `<h3>Contexte</h3><p>${xml(recipe.subtradition || recipe.context_note)}</p><p>${xml(recipe.chronology_note)} ${recipe.temporal.late_only ? 'Profil caractéristique postérieur à 1500.' : ''}</p><div class="source-note"><strong>Confiance de la recette : ${xml(recipe.confidence)}</strong>${variant ? `<br/>Bundle ${xml(variant.label)} : ${xml(variant.confidence)}` : ''}<br/>Toit : ${xml(recipe.roof_confidence)} · chronologie : ${xml(recipe.chronology_confidence)}<p>${recipe.source_description.map(description => xml(description)).join('<br/>')}</p><small>${recipe.sources.map(source => `${xml(source.path)}:${source.line}`).join('<br/>')}</small></div>` : `<h3>Atelier libre</h3><p>${xml(preset?.label ?? unit.label)}</p><p>${xml(preset?.description ?? 'Primitive paramétrique sans recette culturelle.')}</p><div class="source-note"><strong>Confiance : ${xml(preset?.confidence ?? 'non renseignée')}</strong><p>Origine : preset libre du moteur. Aucune chronologie ou provenance archéologique attribuée.</p></div>`;
  return `<h3>Forme et métriques</h3><dl><dt>${recipe ? 'Recette' : 'Preset'}</dt><dd>${xml(unit.recipe_id)}</dd><dt>Variante</dt><dd>${xml(unit.variant_id)}</dd><dt>Rôle</dt><dd>${xml(ROLE_LABELS[unit.role])}</dd><dt>Corps / pièces</dt><dd>${unit.bodies.length} / ${unit.rooms.length}</dd><dt>Emprise occupée</dt><dd>${surfaceArea(unit.partition.occupied).toFixed(1)} m²</dd><dt>Cours ouvertes</dt><dd>${surfaceArea(unit.partition.courtyards).toFixed(1)} m²</dd><dt>Niveaux</dt><dd>${unit.levels.length}</dd><dt>Toitures</dt><dd>${xml([...new Set(unit.bodies.map(body => body.roof_system))].join(', '))}</dd></dl>${slots ? `<h3>Construction du corps principal</h3><dl><dt>Structure</dt><dd>${xml(materialName(slots.frame))}</dd><dt>Remplissage</dt><dd>${xml(materialName(slots.infill))}</dd><dt>Enduit</dt><dd>${xml(materialName(slots.coating))}</dd><dt>Couverture</dt><dd>${xml(materialName(slots.cladding))}</dd><dt>Porteur du toit</dt><dd>${xml(materialName(slots.roof_frame))}</dd><dt>Base</dt><dd>${xml(materialName(slots.base))}</dd></dl>` : ''}${context}${unit.diagnostics.length ? `<h3>Diagnostics</h3><p>${unit.diagnostics.map(diagnostic => xml(diagnostic)).join('<br/>')}</p>` : ''}`;
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
  $('detail-title').textContent = selected.label;
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
  const match = (value: unknown) => JSON.stringify(value).toLocaleLowerCase('fr-FR').includes(term);
  let entries: string[] = [];
  if (kind === 'coverage') entries = bundle.catalogue.coverage.filter(match).map(entry => {
    const source = bundle!.inventory.entries.find(source => source.id === entry.id);
    return `<article class="catalogue-entry"><h3>${xml(source?.label ?? entry.id)}</h3><code>${xml(entry.id)} · ${xml(ROLE_LABELS[entry.role])} · ${xml(entry.status)}</code><p>${xml(entry.reason)}</p><small>Atlas · ligne ${source?.source_line ?? '?'}${source?.pack_id ? ` · ${xml(source.pack_id)}` : ''}</small></article>`;
  });
  else if (kind === 'recipes') entries = bundle.catalogue.recipes.filter(match).map(recipe => `<article class="catalogue-entry"><h3>${xml(recipe.label)}</h3><code>${xml(recipe.id)} · ${xml(recipe.pack_id)} · ${xml(ROLE_LABELS[recipe.role])} · ${xml(recipe.priority)}</code><p>${xml(recipe.parameters.footprint_family)} · ${xml(recipe.parameters.roof_system)} · ${xml(recipe.compound_pattern)}</p><p>${xml(recipe.context_note)} ${xml(recipe.chronology_note)}</p><p>${recipe.source_description.map(description => xml(description)).join('<br/>')}</p><small>Confiance ${xml(recipe.confidence)} · toit ${xml(recipe.roof_confidence)} · ${recipe.sources.map(source => `${xml(source.path)}:${source.line}`).join(', ')}</small></article>`);
  else if (kind === 'workshop') entries = workshopPresets().filter(match).map(preset => `<article class="catalogue-entry"><h3>${xml(preset.label)}</h3><code>${xml(preset.id)} · ${xml(preset.parameters.footprint_family)} · ${xml(preset.parameters.roof_system)}</code><p>${xml(preset.description)}</p><small>Preset libre · confiance ${xml(preset.confidence)}</small></article>`);
  else if (kind === 'materials') entries = bundle.catalogue.materials.filter(match).map(material => `<article class="catalogue-entry"><h3>${xml(material.label)}</h3><code>${xml(material.id)} · ${xml(material.pattern)}</code><p>Fonctions : ${xml(material.roles.join(', '))}</p><small>Origine : ${xml(material.origin ?? 'non renseignée')}${material.source_ref ? ` · ${xml(material.source_ref)}` : ''}</small></article>`);
  else if (kind === 'functional') entries = bundle.catalogue.functional_mappings.filter(match).map(mapping => `<article class="catalogue-entry"><h3>${xml(mapping.label)}</h3><code>${xml(mapping.kind)} · ${xml(mapping.status)}</code><p>${xml(mapping.usage)} · ${xml(mapping.recipe_ids.join(', '))}</p><small>Catalogue fonctionnel · ligne ${mapping.source_line}</small></article>`);
  else if (kind === 'geometry') entries = bundle.catalogue.geometry_traits.filter(match).map(trait => `<article class="catalogue-entry"><h3>${xml(trait.id)}</h3><code>${xml(trait.status)}</code><p>Opérateur déclaré : ${xml(trait.operator)}</p></article>`);
  else entries = bundle.inventory.entries.filter(entry => entry.id.startsWith(kind === 'footprints' ? 'FP-' : 'RF-')).filter(match).map(entry => `<article class="catalogue-entry"><h3>${xml(entry.label)}</h3><code>${xml(entry.id)} · ${xml(entry.priority)}</code><p>${xml(entry.columns.at(-1) ?? '')}</p><small>Atlas · ligne ${entry.source_line}</small></article>`);
  $('catalogue-content').innerHTML = entries.join('') || '<p>Aucune entrée ne correspond à la recherche.</p>';
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
      message(`Tournée · ${pack.label}`, true);
      const row = document.createElement('tr');
      const nameCell = document.createElement('td'), nameButton = document.createElement('button'); nameButton.textContent = pack.label; nameButton.disabled = true;
      nameCell.append(nameButton); row.append(nameCell);
      for (let index = 0; index < 3; index++) row.append(document.createElement('td'));
      row.cells[1].textContent = 'Génération…'; table.append(row);
      try {
        await preflight(config);
        const response = await request('generate', config);
        if (currentAction !== action) break;
        const generated = parseHouseBatch(response.json);
        row.cells[1].textContent = `${generated.units.length} unités · réussi`;
        row.cells[2].textContent = String(generated.units.reduce((sum, unit) => sum + unit.rooms.length, 0));
        row.cells[3].textContent = `${response.elapsed_ms.toFixed(0)} ms`;
        nameButton.disabled = false;
        nameButton.addEventListener('click', () => { stopTour = true; setConfig(config); void generate(config); });
        commitBatch(generated, response.elapsed_ms);
      } catch (error) { row.cells[1].textContent = error instanceof Error ? error.message : String(error); row.cells[1].title = row.cells[1].textContent; }
    }
    if (currentAction === action) {
      if (batch) setConfig(batch.settings);
      message(`Tournée ${stopTour ? 'arrêtée' : 'terminée'} · ${completed} packs examinés. Cliquez une ligne réussie pour rejouer son lot.`);
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
button('copy-link').addEventListener('click', async () => { if (!updateReplay()) return; try { await navigator.clipboard.writeText(location.href); message('Lien rejouable copié.'); } catch { input('link-input').value = location.href; $<HTMLDialogElement>('link-dialog').showModal(); input('link-input').select(); } });
button('tour').addEventListener('click', () => void tour()); button('stop-tour').addEventListener('click', () => { stopTour = true; button('stop-tour').disabled = true; $('tour-progress').textContent += ' · arrêt demandé'; });
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
    module = await compileHousesModule();
    bundle = parseHouseCatalogue((await request('catalogue')).json); populateCatalogueControls();
    let config = defaultHouseConfig();
    const url = new URL(location.href);
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
void start();
