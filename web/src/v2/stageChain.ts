/** The V2 generation chain as inspectable stages (Region → Settlements → Map).
 * Rows come from stageRegistry.ts. Existing live controls are moved into their stage, never rebuilt:
 * the mounted terrain/region/render forms keep their handlers, validation and sync. */
import { SETTINGS_PANEL_CONTROLS, FAMILIES, STAGES, GENERATION_STAGE_ROWS, stagesOf, stageForControl, stageForProgress, stageAnchor, type StageContext, type StageDef, type StageFamily, type Copy } from './stageRegistry';
import { terrainProceduralStageFields, terrainBasicFields, climateZoneHelp } from './terrainControlSchema';
import { mountParameterForm, readSettingPath, writeSettingPath, type ParameterForm } from './parameterForm';
import { atlasUrl, bindTree, getLanguage, numberLocale, registerMessages, setDynamicText, setText, translate } from './i18n';
import { iconImg, type IconId } from './stageIcons';
import { isCompactProcedural, generationStageActive, type GenerationStage } from '../../../rust/bridge/terrainGenerationRecipe';
import { effectiveTerrainSettings } from './terrainSettings';
import { adaptedExtent } from './settings';
import { stageLed, terrainStageValidityKeys, settlementStageValidityKeys, cityStageValidityKeys } from './stageValidity';
import type { TerrainControls } from './terrainControls';
import type { V2Progress, V2Settings, V2TerrainSettings } from './contracts';
import type { World } from '../gen/types';
import './stageChain.css';
import { runtimeSummary } from './runtimeChoices';

const copy = (en: string, fr: string): string => { registerMessages({ [en]: { en, fr } }); return en; };
const T = {
  run: copy('Show this stage’s output', 'Afficher la sortie de cette étape'), required: copy('Required stage', 'Étape obligatoire'),
  enable: copy('Enable or disable this stage', 'Activer ou désactiver cette étape'), help: copy('Method in the scientific atlas', 'Méthode dans l’atlas scientifique'),
  general: copy('General settings', 'Paramètres généraux'), method: copy('Method', 'Méthode'), size: copy('Size', 'Taille'), stale: copy('Settings changed since the last run', 'Réglages modifiés depuis la dernière exécution'),
  cached: copy('Kept from an earlier run', 'Conservé d’une exécution précédente'), running: copy('Running', 'En cours'),
  disabled: copy('Disabled · never run', 'Désactivée · ne jamais lancer'), valid: copy('Calculated · result available', 'Calculée · résultat disponible'),
  pending: copy('To calculate · missing or outdated result', 'À calculer · résultat absent ou périmé'),
  family: copy('Run the {family} stages', 'Exécuter les étapes : {family}'), place: copy('Place', 'Lieu'), noPlace: copy('Choose a place on the right', 'Choisissez un lieu à droite'),
  needTerrain: copy('Create the relief first', 'Créez d’abord le relief'), needRegion: copy('Place the settlements first', 'Implantez d’abord les peuplements'),
  needPlace: copy('Choose a place in the list on the right', 'Choisissez un lieu dans la liste à droite'), procedural: copy('Procedural', 'Procédural'), neural: copy('Neural', 'Neuronal'),
  heightmap: copy('Heightmap', 'Heightmap'), source: copy('Relief source', 'Source du relief'),
  view2d: copy('2D map', 'Carte 2D'), view3d: copy('3D view', 'Vue 3D'), style: copy('Map style', 'Style de carte'),
  noNeural: copy('Neural generation needs WebGPU in this browser, the Python/CUDA server or the native neural service. None is available (see Settings).', 'Le neuronal exige WebGPU dans ce navigateur, le serveur Python/CUDA ou le service neuronal natif. Aucun n’est disponible (voir Réglages).'),
  overrides: copy('Local settings of this place', 'Réglages locaux de ce lieu'),
  scope: copy('Cities to generate', 'Villes à générer'), allCities: copy('All cities', 'Toutes les villes'), selection: copy('Selection on the right', 'Sélection à droite'),
  targets: copy('{count} / {total} cities · roads → quarters → parcels → houses', '{count} / {total} villes · routes → quartiers → parcelles → maisons'),
  execution: copy('Execution…', 'Exécution…'),
  needGpu: copy('Needs WebGPU, which this browser does not provide (see Settings).', 'Nécessite WebGPU, absent de ce navigateur (voir Réglages).'),
  needNative: copy('Needs the native Rust service, which is offline (see Settings).', 'Nécessite le service Rust natif, hors ligne (voir Réglages).'),
  needPython: copy('Needs the Python/CUDA neural server, which is offline (see Settings).', 'Nécessite le serveur neuronal Python/CUDA, hors ligne (voir Réglages).'),
};
/** Relief-source fields that only apply to some sources. */
const SOURCE_FIELDS: Record<string, readonly StageContext['relief'][]> = {
  'terrain.relief': ['procedural', 'neural'], 'terrain.motifSize': ['procedural'], 'terrain.procedural.preset': ['procedural'],
  'terrain.environment': ['procedural'], 'terrain.mountainMix': ['procedural', 'neural'], 'terrain.erosion': ['procedural', 'heightmap'],
};
for (const family of FAMILIES) registerMessages({ [family.label.en]: family.label, [family.summary.en]: family.summary });
for (const stage of STAGES) registerMessages({ [stage.label.en]: stage.label, [stage.summary.en]: stage.summary, ...(stage.toggle?.reason ? { [stage.toggle.reason.en]: stage.toggle.reason } : {}) });
const familyIcon: Record<StageFamily, IconId> = { region: 'family-relief', settlements: 'family-settlements', cities: 'family-city', map: 'family-display' };
const text = (value: Copy) => value.en;
/** Live controls promoted above the stage boxes, in display order. */
const GENERAL_CONTROLS: Record<StageFamily, readonly string[]> = {
  region: ['widget:extent', 'terrain.relief', 'options.relief', 'options.biome', 'terrain.climate', 'terrain.motifSize', 'widget:seed', 'widget:coasts'],
  settlements: ['main:town-count', 'main:population', 'main:culture'],
  cities: ['main:sprawl', 'main:walls'],
  map: ['widget:style', 'widget:view3d'],
};
const METHOD_CONTROLS = ['terrain.procedural.preset'] as const;

export interface StageChainBindings {
  root: HTMLElement; staging: HTMLElement; terrain: TerrainControls; regionRoot: HTMLElement; renderRoot: HTMLElement;
  getSettings(): V2Settings; getWorld(): World | undefined; getPlace(): { key: string; name: string } | undefined;
  busy(): boolean;
  cityScope(): { mode: 'all' | 'selection'; count: number; total: number; key: string };
  onCityScope(mode: 'all' | 'selection'): void;
  onChange(): void; onAppearance(): void; onRegionChange(): void;
  run(stage: StageDef): void; runFamily(family: StageFamily): void; openPlace(): void;
  /** Detected backends (Settings); unavailable choices are disabled with their reason. */
  /** Opens Settings on the Execution block. */
  openExecution(): void;
  availability(): { checked: boolean; webgpu: boolean; native: boolean; python: boolean };
  heightmap: { source(host: HTMLElement): { sync(): void }; fit(host: HTMLElement): { sync(): void; quick: HTMLElement } };
  onFamily?(family: StageFamily): void;
}
export interface StageChain {
  clearResults(): void;
  clearCityResults(): void;
  body(id: string): HTMLElement; sync(): void; family(): StageFamily; selectFamily(family: StageFamily): void;
  beginRun(stages: readonly string[]): void; progress(progress: V2Progress): void; endRun(ok: boolean): void; context(): StageContext;
}
interface Row { stage: StageDef; element: HTMLElement; node: HTMLButtonElement; time: HTMLOutputElement; run: HTMLButtonElement; body: HTMLElement; number: HTMLElement; note: HTMLElement; title: HTMLButtonElement }

export function mountStageChain(b: StageChainBindings): StageChain {
  const { root } = b, get = b.getSettings;
  root.classList.add('stage-chain');
  const leftovers = document.createElement('div'); leftovers.className = 'stage-leftovers'; leftovers.hidden = true;
  leftovers.append(...Array.from(root.childNodes)); root.append(leftovers);
  const forms: ParameterForm[] = [], syncers: (() => void)[] = [];
  root.addEventListener('terrain-defaults-ready', () => { forms.forEach(form => form.sync()); });
  const rows = new Map<string, Row>();
  const stashes: { zones?: V2TerrainSettings['zones']; coastMask?: number; heightmap?: { sketch?: V2TerrainSettings['sketch']; image?: V2Settings['options']['importedHeight'] }; neural?: string } = {};
  let pendingHeightmap = false, family: StageFamily = 'region';
  const timings = new Map<string, { ms: number; state: 'done' | 'cached' | 'stale' | 'running' | '' }>();
  const savedKeys = new Map<string, string>();
  let runKeys = new Map<string, string>();
  let active: { id: string; started: number } | undefined, runScope = new Set<string>();

  // ── Family navigation (the chain overview) ───────────────────────────────
  const nav = document.createElement('nav'); nav.className = 'chain-families'; nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', translate('Generation chain'));
  copy('Generation chain', 'Chaîne de génération');
  const tabs = new Map<StageFamily, HTMLButtonElement>(), panels = new Map<StageFamily, HTMLElement>(), familyTimes = new Map<StageFamily, HTMLElement>();
  const generalPanels = new Map<StageFamily, HTMLElement>();
  const methodPanel = document.createElement('section'); methodPanel.className = 'family-method';
  const methodTitle = document.createElement('h4'); methodTitle.id = 'terrain-method-title'; setText(methodTitle, T.method);
  methodPanel.setAttribute('aria-labelledby', methodTitle.id); methodPanel.append(methodTitle, sourceSwitch(), executionChip());
  const scroller = document.createElement('div'); scroller.className = 'chain-scroll';
  for (const [index, f] of FAMILIES.entries()) {
    const tab = document.createElement('button'); tab.type = 'button'; tab.className = 'chain-family-tab'; tab.id = `family-tab-${f.id}`; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', `family-${f.id}`);
    const label = document.createElement('span'); label.className = 'chain-family-label'; setText(label, text(f.label));
    const time = document.createElement('small'); time.className = 'chain-family-time'; familyTimes.set(f.id, time);
    tab.append(iconImg(familyIcon[f.id], 34), label, time); tab.onclick = () => selectFamily(f.id);
    tab.addEventListener('keydown', event => { const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0; if (!step) return; event.preventDefault(); const next = FAMILIES[(index + step + FAMILIES.length) % FAMILIES.length].id; selectFamily(next); tabs.get(next)!.focus(); });
    tabs.set(f.id, tab); nav.append(tab);
    const panel = document.createElement('section'); panel.className = 'chain-family'; panel.id = `family-${f.id}`; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tab.id); panel.dataset.family = f.id;
    const head = document.createElement('header'); head.className = 'family-head';
    const titles = document.createElement('div'); titles.className = 'family-titles';
    const h = document.createElement('h3'); setText(h, text(f.label)); const p = document.createElement('p'); p.className = 'hint'; setText(p, text(f.summary)); titles.append(h, p);
    const runFamily = document.createElement('button'); runFamily.type = 'button'; runFamily.className = 'family-run'; runFamily.dataset.family = f.id;
    setDynamicText(runFamily, () => translate(T.family).replace('{family}', translate(text(f.label)).toLocaleLowerCase(getLanguage() === 'fr' ? 'fr' : 'en')));
    runFamily.onclick = () => b.runFamily(f.id);
    head.append(titles, runFamily); panel.append(head);
    if (f.id === 'cities') {
      const scope = document.createElement('div'); scope.className = 'family-city-scope';
      const scopeCaption = document.createElement('label'); scopeCaption.htmlFor = 'city-scope'; setText(scopeCaption, T.scope);
      const select = document.createElement('select'); select.id = 'city-scope';
      for (const [value, label] of [['all', T.allCities], ['selection', T.selection]]) { const option = document.createElement('option'); option.value = value; setText(option, label); select.append(option); }
      select.onchange = () => b.onCityScope(select.value as 'all' | 'selection');
      const count = document.createElement('p'); count.className = 'hint'; count.id = 'city-scope-count'; count.setAttribute('aria-live', 'polite');
      scope.append(scopeCaption, select, count); panel.append(scope);
      syncers.push(() => { const current = b.cityScope(); select.value = current.mode; select.disabled = b.busy(); setDynamicText(count, () => translate(T.targets).replace('{count}', String(b.cityScope().count)).replace('{total}', String(b.cityScope().total))); });
      const place = document.createElement('div'); place.className = 'family-place'; place.id = 'chain-place';
      const caption = document.createElement('span'); caption.className = 'family-place-caption'; setText(caption, T.place);
      const name = document.createElement('strong'); name.id = 'chain-place-name';
      const open = document.createElement('button'); open.type = 'button'; open.className = 'small'; open.id = 'chain-place-open'; setText(open, T.overrides); open.onclick = b.openPlace;
      place.append(caption, name, open); panel.append(place);
      syncers.push(() => { place.hidden = !b.getWorld()?.settlements?.length; const current = b.getPlace(); open.disabled = !current; if (current) { name.dataset.l10nKeep = ''; name.removeAttribute('data-i18n'); name.textContent = current.name; } else setText(name, T.noPlace); });
    }
    if (f.id === 'region') panel.append(methodPanel);
    const general = document.createElement('div'); general.className = 'family-general'; general.setAttribute('role', 'group'); general.setAttribute('aria-label', translate(T.general)); generalPanels.set(f.id, general); panel.append(general);
    const spine = document.createElement('div'); spine.className = 'chain-spine'; panel.append(spine);
    for (const stage of stagesOf(f.id)) spine.append(buildRow(stage).element);
    panels.set(f.id, panel); scroller.append(panel);
  }
  root.prepend(nav, scroller);

  function buildRow(stage: StageDef): Row {
    const element = document.createElement('section'); element.className = 'stage-row'; element.id = `row-${stage.id}`; element.dataset.stage = stage.id;
    const head = document.createElement('div'); head.className = 'stage-head';
    const number = document.createElement('span'); number.className = 'stage-number'; number.dataset.l10nKeep = '';
    const node = document.createElement('button'); node.type = 'button'; node.className = 'stage-node'; node.setAttribute('role', 'switch');
    if (!stage.optional) { node.disabled = true; node.title = translate(T.required); node.setAttribute('aria-checked', 'true'); node.dataset.required = ''; }
    else if (stage.toggle?.kind === 'unavailable') { node.disabled = true; node.title = translate(text(stage.toggle.reason!)); node.dataset.locked = ''; node.setAttribute('aria-checked', 'true'); }
    else { node.title = translate(T.enable); node.onclick = () => toggle(stage); }
    node.setAttribute('aria-label', `${translate(T.enable)} · ${translate(text(stage.label))}`);
    const title = document.createElement('button'); title.type = 'button'; title.className = 'stage-title'; title.setAttribute('aria-expanded', 'false'); title.setAttribute('aria-controls', `body-${stage.id}`);
    const name = document.createElement('span'); name.className = 'stage-name'; setText(name, text(stage.label));
    title.append(name); title.title = translate(text(stage.summary)); title.onclick = () => expand(stage.id, title.getAttribute('aria-expanded') !== 'true');
    const time = document.createElement('output'); time.className = 'stage-time'; time.setAttribute('aria-live', 'off');
    const run = document.createElement('button'); run.type = 'button'; run.className = 'stage-run'; run.title = translate(T.run); run.setAttribute('aria-label', `${translate(T.run)} · ${translate(text(stage.label))}`);
    run.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.8v8.4L10 6z" fill="currentColor"/></svg>'; run.onclick = () => b.run(stage);
    const help = document.createElement('a'); help.className = 'stage-help'; help.href = atlasUrl(`./scientific/index.html#${stageAnchor(stage.id)}`); help.target = '_blank'; help.rel = 'noopener';
    setText(help, T.help); help.title = translate(T.help); help.setAttribute('aria-label', `${translate(T.help)} · ${translate(text(stage.label))}`); help.dataset.l10nKeep = '';
    head.append(number, title, node, run, time);
    const note = document.createElement('p'); note.className = 'stage-note'; note.hidden = true;
    const body = document.createElement('div'); body.className = 'stage-body'; body.id = `body-${stage.id}`; body.hidden = true;
    const summary = document.createElement('p'); summary.className = 'stage-summary hint'; setText(summary, text(stage.summary)); body.append(summary, help);
    element.append(head, note, body);
    const row = { stage, element, node, time, run, body, number, note, title };
    rows.set(stage.id, row); return row;
  }
  function expand(id: string, open: boolean): void {
    const row = rows.get(id)!; row.body.hidden = !open; row.title.setAttribute('aria-expanded', String(open));
    row.element.classList.toggle('is-open', open);
  }
  function selectFamily(next: StageFamily): void {
    family = next;
    for (const [id, tab] of tabs) { tab.setAttribute('aria-selected', String(id === next)); tab.tabIndex = id === next ? 0 : -1; panels.get(id)!.hidden = id !== next; }
    scroller.scrollTop = 0; b.onFamily?.(next);
  }

  // ── Context and toggles ──────────────────────────────────────────────────
  const reliefOf = (settings: V2Settings): StageContext['relief'] => {
    if (settings.terrain?.sketch?.processing || settings.options.importedHeight || pendingHeightmap) return 'heightmap';
    const source = settings.runtime?.source ?? (settings.generation === 'neural' ? 'neural-wasm' : 'procedural');
    return source === 'procedural' || source === 'procedural-phasor' ? 'procedural' : 'neural';
  };
  function context(): StageContext {
    const settings = get(), world = b.getWorld(), relief = String(b.terrain.access.get('terrain.relief') ?? settings.options.relief);
    return { relief: reliefOf(settings), classicTerrain: settings.runtime?.backend === 'typescript', finiteRelief: ['flat', 'plateau', 'volcano', 'caldera', 'cavern'].includes(relief),
      urban: settings.urban?.backend ?? settings.runtime?.backend ?? 'typescript', hasTerrain: !!world, hasRegion: !!world?.settlements?.length, place: b.getPlace()?.key };
  }
  const compact = () => { const s = get(); return isCompactProcedural({ source: s.runtime?.source, procedural: s.terrain?.procedural }); };
  function toggleState(stage: StageDef): boolean {
    const t = stage.toggle, settings = get();
    if (!t || t.kind === 'unavailable') return true;
    if (t.kind === 'coasts') return Number(b.terrain.access.get('terrain.coastMask') ?? 0) !== 0;
    if (t.kind === 'mask') return !!settings.terrain?.zones;
    if (t.kind === 'roads') return settings.region?.roads !== null;
    const value = t.path!.startsWith('terrain.procedural.') ? readSettingPath(settings, t.path!) : b.terrain.access.get(t.path!);
    if (typeof value === 'boolean') return value;
    const fallback = typeof t.fallback === 'function' ? t.fallback({ compact: compact(), relief: String(b.terrain.access.get('terrain.relief')) }) : t.fallback ?? true;
    return fallback;
  }
  function toggle(stage: StageDef): void {
    const t = stage.toggle!, settings = get(), on = toggleState(stage);
    if (t.kind === 'coasts') {
      if (on) { stashes.coastMask = Number(b.terrain.access.get('terrain.coastMask')); b.terrain.access.set('terrain.coastMask', 0); }
      else b.terrain.access.set('terrain.coastMask', stashes.coastMask || 1);
    } else if (t.kind === 'mask') {
      settings.terrain ??= {};
      if (on) { stashes.zones = settings.terrain.zones; delete settings.terrain.zones; b.onChange(); b.terrain.sync(); }
      else if (stashes.zones) { settings.terrain.zones = stashes.zones; b.onChange(); b.terrain.sync(); }
      else paint();
    } else if (t.kind === 'roads') {
      settings.region ??= {}; settings.region.roads = on ? null : {}; b.onRegionChange();
    } else if (t.path!.startsWith('terrain.procedural.')) {
      settings.terrain ??= {}; writeSettingPath(settings, t.path!, !on); b.onChange(); b.terrain.sync();
    } else b.terrain.access.set(t.path!, !on);
    markStale(stage.id); sync();
  }
  const paint = () => b.terrain.sketchHost.querySelector<HTMLButtonElement>('[data-id="edit"]')?.click();

  // ── Relief source alternatives ───────────────────────────────────────────
  function setSource(mode: StageContext['relief']): void {
    const settings = get(), current = reliefOf(settings);
    if (mode === current && !(mode === 'heightmap' && pendingHeightmap)) { if (mode === 'heightmap') expand('relief-source', true); return; }
    if (current === 'heightmap' && mode !== 'heightmap') {
      stashes.heightmap = { sketch: settings.terrain?.sketch?.processing ? settings.terrain.sketch : undefined, image: settings.options.importedHeight };
      if (settings.terrain?.sketch?.processing) delete settings.terrain.sketch;
      delete settings.options.importedHeight; pendingHeightmap = false;
    }
    if (mode === 'procedural') { if (current === 'neural') stashes.neural = String(settings.runtime?.source); b.terrain.access.set('runtime.source', 'procedural'); }
    else if (mode === 'neural') b.terrain.access.set('runtime.source', stashes.neural ?? 'neural-wasm');
    else {
      if (current === 'neural') stashes.neural = String(settings.runtime?.source);
      const stash = stashes.heightmap;
      if (stash?.sketch) { settings.terrain ??= {}; settings.terrain.sketch = stash.sketch; }
      else if (stash?.image) settings.options.importedHeight = stash.image;
      else pendingHeightmap = true;
      if (settings.runtime?.source && settings.runtime.source !== 'procedural') b.terrain.access.set('runtime.source', 'procedural');
      expand('relief-source', true);
    }
    b.onChange(); b.terrain.sync(); markStale('relief-source'); sync();
  }
  function executionChip(): HTMLElement {
    const chip = document.createElement('div'); chip.className = 'execution-chip'; chip.dataset.stageControl = 'relief-source';
    const label = document.createElement('span'); label.className = 'execution-chip-label'; label.dataset.l10nKeep = '';
    const open = document.createElement('button'); open.type = 'button'; open.className = 'small'; setText(open, T.execution); open.onclick = b.openExecution;
    chip.append(label, open);
    syncers.push(() => { label.textContent = runtimeSummary(get()); });
    return chip;
  }
  function sourceSwitch(): HTMLElement {
    const group = document.createElement('div'); group.className = 'source-switch'; group.setAttribute('role', 'radiogroup'); group.setAttribute('aria-label', translate(T.source));
    const buttons: [StageContext['relief'], HTMLButtonElement][] = [];
    for (const [mode, label, icon] of [['procedural', T.procedural, 'source-procedural'], ['neural', T.neural, 'source-neural'], ['heightmap', T.heightmap, 'source-heightmap']] as const) {
      const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'radio'); button.dataset.source = mode; button.id = `source-${mode}`;
      const caption = document.createElement('span'); setText(caption, label); button.append(iconImg(icon, 22), caption); button.onclick = () => setSource(mode);
      buttons.push([mode, button]); group.append(button);
    }
    syncers.push(() => {
      const mode = reliefOf(get()), caps = b.availability(), neuralReason = caps.checked && !caps.webgpu && !caps.python && !caps.native ? T.noNeural : undefined, busy = b.busy();
      for (const [value, button] of buttons) {
        button.setAttribute('aria-checked', String(value === mode)); button.tabIndex = value === mode ? 0 : -1;
        const blocked = value === 'neural' && !!neuralReason && mode !== 'neural';
        button.disabled = busy || blocked; button.title = blocked ? translate(neuralReason!) : '';
      }
    });
    return group;
  }

  // ── Placing the existing controls ────────────────────────────────────────
  const owner = (id: string) => { const stage = stageForControl(id); if (!stage) console.warn(`[stage-chain] no stage owns control ${id}`); return stage; };
  const place = (node: Element | null | undefined, stageId: string | undefined) => {
    if (!node || !stageId) return; const row = rows.get(stageId); if (!row) return;
    row.body.append(node);
  };
  const tRoot = leftovers, sketchHost = b.terrain.sketchHost;
  // Composite widgets first, so their fields stay together.
  const coastPanel = tRoot.querySelector<HTMLElement>('#terrain-coast-panel'); place(coastPanel, 'relief-source');
  if (coastPanel) prepareCoastGrid(coastPanel);
  // The checkable coast layouts edit this value directly, including random islands.
  tRoot.querySelector<HTMLElement>('[data-field-path="terrain.islandMode"]')?.setAttribute('data-chain-hidden', '');
  tRoot.querySelector<HTMLElement>('#terrain-coast-toggle')?.setAttribute('aria-expanded', 'true');
  place(sketchHost, 'relief-mask');
  const hydrology = tRoot.querySelector('#terrain-hydrology-panel');
  for (const group of Array.from(hydrology?.querySelectorAll(':scope > details') ?? [])) { (group as HTMLDetailsElement).open = true; group.classList.add('stage-subgroup'); place(group, 'water-hydrology'); }
  const classicGroup = tRoot.querySelector('[data-field-path="options.coast"]')?.closest('details');
  if (classicGroup) { (classicGroup as HTMLDetailsElement).open = true; classicGroup.classList.add('stage-subgroup'); place(classicGroup.querySelector('[data-field-path="options.heightScale"]'), 'relief-heightmap-fit'); place(classicGroup.querySelector('[data-field-path="options.importSea"]'), 'relief-heightmap-fit'); place(classicGroup, 'relief-source'); }
  place(tRoot.querySelector('.terrain-extent'), 'relief-source');
  const histogram = tRoot.querySelector('[data-field-path="terrain.neuralTuning.steps"]')?.closest('details')?.querySelector(':scope > .terrain-presets');
  const neuralNote = tRoot.querySelector('.terrain-neural-note');
  const modelNote = tRoot.querySelector('[data-field-path="terrain.coarseModel"]')?.closest('details')?.querySelector(':scope > p.hint');
  // Every remaining schema field goes to the stage that owns its path.
  for (const field of Array.from(tRoot.querySelectorAll<HTMLElement>('[data-field-path]'))) {
    if (field.closest('.stage-row')) continue;
    const id = field.dataset.fieldPath!, stage = owner(id);
    if (stage === 'settings') { if (/^runtime\.(neuralAssets|localServer|neuralServer|pythonServer)$/.test(id)) b.staging.querySelector('#settings-endpoints')?.append(field); continue; }
    place(field, stage);
  }
  // Execution choices are edited in Settings; the mounted fields only keep the terrain form state consistent.
  for (const id of SETTINGS_PANEL_CONTROLS) tRoot.querySelector<HTMLElement>(`[data-field-path="${id}"]`)?.setAttribute('hidden', '');
  place(histogram, 'relief-neural-base'); place(neuralNote, 'relief-source'); place(modelNote, 'relief-neural-coarse');
  place(tRoot.querySelector('#terrain-erosion-reset'), 'relief-regional'); place(tRoot.querySelector('#terrain-detail-reset'), 'relief-refine');
  place(tRoot.querySelector('#terrain-phasor-method'), 'relief-phasor');
  // Main-page controls (seed, places, city options) declare their owner with data-control.
  for (const element of Array.from(b.staging.querySelectorAll<HTMLElement>('[data-control]'))) {
    const id = element.dataset.control!, stage = owner(id); if (!stage || stage === 'settings') continue;
    place(element, stage);
  }
  // Region controls: every field by its path; the manual list as a block.
  const regionList = b.regionRoot.querySelector('#region-add-place')?.closest('details');
  if (regionList) { regionList.classList.add('stage-subgroup'); place(regionList, 'settle-sites'); }
  for (const field of Array.from(b.regionRoot.querySelectorAll<HTMLElement>('[data-field-path]'))) {
    if (field.closest('.stage-row')) continue;
    place(field, owner(`region.${field.dataset.fieldPath}`));
  }
  // Appearance panel sections → display rows (section bodies, with their colour pickers).
  const renderOwners: Record<string, string> = { ground: 'display-terrain', relief: 'display-terrain', diagnostics: 'display-terrain', water: 'display-water', cover: 'display-vegetation', roads: 'display-roads', buildings: 'display-buildings', general: 'display-labels' };
  for (const [section, stageId] of Object.entries(renderOwners)) {
    const sectionBody = b.renderRoot.querySelector(`[data-render-section="${section}"] > .render-settings-fields`);
    if (!sectionBody) continue;
    const box = document.createElement('div'); box.className = 'stage-render-section'; box.dataset.renderSection = section; box.append(sectionBody); place(box, stageId);
  }
  // Procedural recipe controls are new staged forms over the same terrain value model.
  for (const stage of STAGES) {
    const fields = terrainProceduralStageFields.filter(field => stageForControl(field.path) === stage.id);
    if (!fields.length) continue;
    const host = document.createElement('div'); rows.get(stage.id)!.body.append(host);
    forms.push(mountParameterForm(host, fields.map(field => ({ ...field, id: `stage-${field.path.replace(/[^a-z0-9]/gi, '-')}` })), { getValue: b.terrain.access.get, setValue: b.terrain.access.set, disabled: b.busy }));
  }

  // General settings use the mounted controls so all handlers and visibility stay in sync.
  for (const f of FAMILIES) for (const id of GENERAL_CONTROLS[f.id]) {
    let control: HTMLElement | null;
    if (id === 'widget:extent') {
      control = root.querySelector<HTMLElement>('.terrain-extent');
      const legend = control?.querySelector('legend'); if (legend) setText(legend, T.size);
    } else if (id === 'widget:coasts') control = coastPanel;
    else if (id === 'widget:style') control = styleQuick();
    else if (id === 'widget:view3d') control = viewQuick();
    else if (id === 'widget:seed') control = root.querySelector<HTMLElement>('[data-control="widget:seed"]');
    else control = root.querySelector<HTMLElement>(id.startsWith('main:') ? `[data-control="${id}"]` : `[data-field-path="${id}"]`);
    if (!control) continue;
    if (id === 'terrain.climate' || id === 'terrain.relief') prepareLandscapeStrip(control, id === 'terrain.climate' ? 'climate' : 'relief');
    control.dataset.stageControl = stageForControl(id) ?? (f.id === 'map' ? 'display-terrain' : 'relief-source');
    generalPanels.get(f.id)!.append(control);
  }
  for (const path of METHOD_CONTROLS) {
    const control = root.querySelector<HTMLElement>(`[data-field-path="${path}"]`);
    if (!control) continue;
    control.dataset.stageControl = 'relief-source'; methodPanel.append(control);
  }
  syncers.push(() => {
    const classic = context().classicTerrain;
    for (const path of ['terrain.procedural.preset'])
      methodPanel.querySelector<HTMLElement>(`[data-field-path="${path}"]`)?.toggleAttribute('data-general-hidden', classic);
  });
  // Heightmap alternative inside Relief source; its fit stage.
  const library = document.createElement('div'); library.id = 'heightmap-library'; rows.get('relief-source')!.body.insertBefore(library, rows.get('relief-source')!.body.children[1] ?? null);
  const librarySync = b.heightmap.source(library); syncers.push(() => { library.hidden = reliefOf(get()) !== 'heightmap'; librarySync.sync(); });
  const fitHost = document.createElement('div'); rows.get('relief-heightmap-fit')!.body.insertBefore(fitHost, rows.get('relief-heightmap-fit')!.body.children[1] ?? null);
  const fit = b.heightmap.fit(fitHost); syncers.push(fit.sync);

  function prepareCoastGrid(panel: HTMLElement): void {
    panel.classList.add('coast-picker'); panel.dataset.stageControl = 'relief-source';
    const compass = panel.querySelector<HTMLElement>('.terrain-coast-compass')!;
    const presets = panel.querySelector<HTMLElement>('.coast-presets')!;
    const grid = document.createElement('div'); grid.className = 'coast-grid';
    grid.append(compass, presets); panel.append(grid);
    grid.addEventListener('click', () => { markStale('relief-source'); sync(); });
    syncers.push(() => {
      panel.toggleAttribute('data-chain-hidden', context().relief === 'heightmap' || context().finiteRelief && b.terrain.access.get('terrain.relief') === 'cavern');
    });
  }
  function prepareLandscapeStrip(field: HTMLElement, kind: 'climate' | 'relief'): void {
    field.classList.add('climate-picker', `${kind}-picker`);
    const select = field.querySelector<HTMLSelectElement>('select')!; select.hidden = true;
    const strip = document.createElement('div'); strip.className = `region-icon-strip climate-strip ${kind}-strip`; strip.setAttribute('role', 'radiogroup');
    strip.setAttribute('aria-label', translate(kind === 'climate' ? copy('Climate', 'Climat') : copy('Relief type', 'Type de relief')));
    const buttons: HTMLButtonElement[] = [];
    for (const [index, option] of Array.from(select.options).entries()) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset[kind] = option.value; button.setAttribute('role', 'radio');
      const art = document.createElement('span'); art.className = `landscape-art ${kind}-art`; art.setAttribute('aria-hidden', 'true');
      art.style.backgroundPosition = `${index % 4 / 3 * 100}% ${Math.floor(index / 4) / 2 * 100}%`; button.append(art);
      const caption = document.createElement('span'); caption.className = 'region-icon-caption';
      const label = terrainBasicFields.find(f => f.path === `terrain.${kind}`)!.options!.find(o => o.value === option.value)!.label;
      setText(caption, label); button.append(caption);
      const help = kind === 'climate' ? climateZoneHelp[option.value] : undefined;
      syncers.push(() => { button.title = help ? `${translate(label)} — ${translate(help)}` : translate(label); button.setAttribute('aria-label', translate(label)); });
      button.onclick = () => {
        const biome = b.terrain.access.get('options.biome');
        select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true }));
        markStale(kind === 'relief' || b.terrain.access.get('options.biome') !== biome ? 'relief-source' : 'relief-climate'); if (kind === 'climate' && option.value === 'custom') expand('relief-climate', true); sync();
      };
      button.onkeydown = event => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return; event.preventDefault(); const available = buttons.filter(choice => !choice.hidden && !choice.disabled); if (!available.length) return;
        const next = available[(available.indexOf(button) + step + available.length) % available.length]; next.click(); next.focus();
      };
      buttons.push(button); strip.append(button);
    }
    field.append(strip);
    const selected = document.createElement('output'); selected.className = 'climate-selected';
    const caption = field.querySelector('.parameter-caption')!, head = document.createElement('div'); head.className = 'climate-caption';
    field.prepend(head); head.append(caption, selected);
    syncers.push(() => {
      const value = b.terrain.access.get(`terrain.${kind}`);
      const label = terrainBasicFields.find(f => f.path === `terrain.${kind}`)!.options!.find(o => o.value === value)?.label;
      if (label) setText(selected, label);
      for (const button of buttons) { button.hidden = !!select.querySelector<HTMLOptionElement>(`option[value="${button.dataset[kind]}"]`)?.disabled; const on = button.dataset[kind] === value; button.setAttribute('aria-checked', String(on)); button.tabIndex = on ? 0 : -1; button.disabled = b.busy(); }
    });
  }

  function styleQuick(): HTMLElement {
    const label = document.createElement('label'); label.className = 'quick-style';
    label.append(iconImg('display-palette', 24));
    const select = document.createElement('select'); select.id = 'quick-map-style'; select.setAttribute('aria-label', translate(T.style));
    const source = document.querySelector<HTMLSelectElement>('#map-style');
    if (source) { select.innerHTML = source.innerHTML; select.onchange = () => { source.value = select.value; source.dispatchEvent(new Event('change')); }; }
    label.append(select); syncers.push(() => { if (source && document.activeElement !== select) { if (select.options.length !== source.options.length) select.innerHTML = source.innerHTML; select.value = source.value; } });
    return label;
  }
  function viewQuick(): HTMLElement {
    const group = document.createElement('div'); group.className = 'icon-segments'; group.setAttribute('role', 'group'); group.setAttribute('aria-label', '2D / 3D');
    const make = (mode: '2d' | '3d') => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'icon-toggle'; button.dataset.view = mode;
      button.append(iconImg(mode === '2d' ? 'display-2d' : 'display-3d', 24)); const caption = document.createElement('span'); setText(caption, mode === '2d' ? T.view2d : T.view3d); button.append(caption);
      button.onclick = () => { const toggle3d = document.querySelector<HTMLButtonElement>('#view3d'); const is3d = toggle3d?.getAttribute('aria-pressed') === 'true'; if ((mode === '3d') !== is3d) toggle3d?.click(); setTimeout(sync, 50); };
      group.append(button); return button;
    };
    const flat = make('2d'), relief = make('3d');
    syncers.push(() => { const is3d = document.querySelector('#view3d')?.getAttribute('aria-pressed') === 'true'; flat.setAttribute('aria-pressed', String(!is3d)); relief.setAttribute('aria-pressed', String(is3d)); relief.disabled = !b.getWorld(); });
    return group;
  }
  // Leftover legacy wrappers stay hidden but mounted (their sync keeps working).
  bindTree(root);
  // General controls keep their stage ownership for invalidating later generation stages.
  root.addEventListener('change', event => { const control = (event.target as Element).closest<HTMLElement>('[data-stage-control],.stage-row'); if (control) markStale(control.dataset.stageControl ?? control.dataset.stage!); });
  function markStale(id: string): void {
    const ordered = [...stagesOf('region', get().terrain?.procedural?.coastAfter), ...stagesOf('settlements'), ...stagesOf('cities'), ...stagesOf('map')];
    const index = ordered.findIndex(stage => stage.id === id), stage = ordered[index];
    if (!stage || stage.family === 'map') return;
    for (const later of ordered.slice(index)) {
      if (later.family === 'map') continue;
      const timing = timings.get(later.id); if (timing && timing.state !== 'running') timing.state = 'stale';
    }
    renderTimes();
  }
  function validityKeys(): Map<string, string> {
    const terrain = terrainStageValidityKeys(get());
    const physicalKey = terrain.get('water-hydrology');
    return new Map([...terrain, ...settlementStageValidityKeys(get(), physicalKey), ...cityStageValidityKeys(get(), b.getWorld(), b.cityScope().key, physicalKey)]);
  }
  function clearCityResults(): void { for (const stage of stagesOf('cities')) { timings.delete(stage.id); savedKeys.delete(stage.id); } }
  function renderTimes(): void {
    const keys = validityKeys();
    const terrain = effectiveTerrainSettings(get(), adaptedExtent(get()));
    for (const [id, row] of rows) {
      const timing = timings.get(id);
      row.element.dataset.run = timing?.state ?? '';
      const phase = Object.entries(GENERATION_STAGE_ROWS).find(([phase, row]) => row === id && !['prepare','retain','sampling','render'].includes(phase))?.[0] as GenerationStage | undefined;
      const on = toggleState(row.stage) && (!phase || generationStageActive(terrain, phase)) && !row.stage.unavailable?.(context());
      const led = stageLed(on, active?.id === id, savedKeys.get(id), keys.get(id));
      row.element.dataset.led = row.stage.family !== 'map' ? led : !on ? 'disabled' : active?.id === id ? 'running' : timing?.state === 'done' || timing?.state === 'cached' ? 'valid' : 'pending';
      if(row.stage.family!=='map')row.element.dataset.run=led==='running'?'running':led==='valid'?(timing?.state==='cached'?'cached':'done'):timing&&led==='pending'?'stale':'';
      const status = row.element.dataset.led;
      row.node.title = translate(status === 'disabled' ? T.disabled : status === 'valid' ? T.valid : status === 'running' ? T.running : T.pending);
      // Stages without their own progress events ran inside a neighbouring row: no invented time.
      if (!timing || timing.state !== 'running' && timing.ms === 0) { row.time.textContent = '— ms'; row.time.title = ''; continue; }
      row.time.textContent = timing.state === 'running' ? '… ms' : `${Math.max(1, Math.round(timing.ms)).toLocaleString(numberLocale())} ms`;
      row.time.title = translate(timing.state === 'stale' ? T.stale : timing.state === 'cached' ? T.cached : timing.state === 'running' ? T.running : text(row.stage.label));
    }
    for (const f of FAMILIES) {
      const total = stagesOf(f.id).reduce((sum, stage) => sum + (timings.get(stage.id)?.ms ?? 0), 0), label = familyTimes.get(f.id)!;
      label.textContent = total ? total < 1000 ? `${Math.round(total)} ms` : `${(total / 1000).toLocaleString(numberLocale(), { maximumFractionDigits: 1 })} s` : '';
      tabs.get(f.id)!.dataset.stale = String(stagesOf(f.id).some(stage => rows.get(stage.id)?.element.dataset.led === 'pending'));
    }
  }
  const close = (now = performance.now()) => {
    if (!active) return; const timing = timings.get(active.id) ?? { ms: 0, state: 'running' as const };
    timing.ms += now - active.started; timings.set(active.id, timing); active = undefined;
  };
  function complete(id: string, cached = false): void {
    const timing = timings.get(id) ?? { ms: 0, state: '' as const };
    timing.state = cached ? 'cached' : 'done'; timings.set(id, timing);
    const key = runKeys.get(id); if (key !== undefined) savedKeys.set(id, key);
    if (id === 'relief-noise') for (const alias of ['relief-source', 'relief-climate']) {
      const initial = runKeys.get(alias); if (initial !== undefined) savedKeys.set(alias, initial);
    }
  }
  let cityScopeKey = '';
  function sync(): void {
    const nextScope = b.cityScope().key;
    if (cityScopeKey !== nextScope) { clearCityResults(); cityScopeKey = nextScope; }
    const ctx = context(), busy = b.busy();
    for (const form of forms) form.sync();
    for (const syncer of syncers) syncer();
    // Source alternatives: fields that do not apply to the chosen relief source are set aside.
    for (const [path, sources] of Object.entries(SOURCE_FIELDS)) for (const element of Array.from(root.querySelectorAll<HTMLElement>(`[data-field-path="${path}"]`)))
      element.toggleAttribute('data-chain-hidden', !sources.includes(ctx.relief));
    for (const [family, panel] of generalPanels) {
      for (const control of Array.from(panel.children) as HTMLElement[]) {
        const stage = rows.get(control.dataset.stageControl!)?.stage;
        control.toggleAttribute('data-general-hidden', !!stage && !stage.when(ctx) || family === 'region' && ctx.classicTerrain && control.matches('.climate-picker,#terrain-coast-panel'));
      }
      panel.hidden = !Array.from(panel.children).some(control => !(control as HTMLElement).hidden && !control.hasAttribute('data-general-hidden') && !control.hasAttribute('data-chain-hidden'));
    }
    // The 8-bit image scale and sea level only apply to an imported grayscale image.
    for (const path of ['options.heightScale', 'options.importSea']) root.querySelector<HTMLElement>(`[data-field-path="${path}"]`)?.toggleAttribute('data-chain-hidden', !get().options.importedHeight);
    const ordered = [...stagesOf('region', get().terrain?.procedural?.coastAfter), ...stagesOf('settlements'), ...stagesOf('cities'), ...stagesOf('map')];
    const regionOrder = ordered.filter(stage => stage.family === 'region');
    const cut = rows.get('relief-coast-cut')!.element, previous = rows.get(regionOrder[regionOrder.findIndex(stage => stage.id === 'relief-coast-cut') - 1].id)!.element;
    if (cut.previousElementSibling !== previous) previous.after(cut);
    const numbers = new Map<StageFamily, number>();
    for (const definition of ordered) {
      const row = rows.get(definition.id)!;
      const { stage } = row, visible = stage.when(ctx); row.element.hidden = !visible; if (!visible) continue;
      const index = (numbers.get(stage.family) ?? 0) + 1; numbers.set(stage.family, index); row.number.textContent = String(index).padStart(2, '0');
      const reason = stage.unavailable?.(ctx);
      row.note.hidden = !reason; if (reason) { registerMessages({ [reason.en]: reason }); setText(row.note, text(reason)); } row.element.dataset.na = String(!!reason);
      const on = toggleState(stage); row.element.dataset.enabled = String(on);
      if (!stage.optional || stage.toggle?.kind === 'unavailable') row.node.disabled = true;
      if (stage.optional && stage.toggle && stage.toggle.kind !== 'unavailable') { row.node.setAttribute('aria-checked', String(on)); row.node.disabled = busy || !!reason; }
      const prerequisite = stage.run.action === 'town' ? !ctx.hasRegion ? T.needRegion : !b.cityScope().count && T.needPlace : stage.family !== 'region' && stage.id !== 'map-export' ? !ctx.hasTerrain && T.needTerrain : false;
      row.run.disabled = busy || !!reason || !!prerequisite || stage.optional && !on && stage.toggle?.kind !== 'unavailable';
      row.run.title = translate(prerequisite || (reason ? text(reason) : T.run));
    }
    for (const f of FAMILIES) { const button = panels.get(f.id)!.querySelector<HTMLButtonElement>('.family-run')!; button.disabled = busy || (f.id !== 'region' && !ctx.hasTerrain) || (f.id === 'cities' && (!ctx.hasRegion || !b.cityScope().count)); }
    renderTimes();
  }
  selectFamily('region'); sync();
  return {
    clearResults() { timings.clear(); savedKeys.clear(); active=undefined; runScope.clear(); renderTimes(); },
    clearCityResults,
    body: id => rows.get(id)!.body, sync, family: () => family, selectFamily, context,
    beginRun(stages) {
      runScope = new Set(stages);
      if (stages.some(id => rows.get(id)?.stage.family === 'cities')) {
        for (const stage of stagesOf('cities')) if (!runScope.has(stage.id)) savedKeys.delete(stage.id);
      }
      runKeys = validityKeys(); active = undefined; renderTimes();
    },
    progress(progress) {
      const id = stageForProgress(progress.stage);
      if (progress.stage.startsWith('pipeline:') && /:(done|cached)$/.test(progress.stage)) {
        close(); if (id) complete(id, progress.stage.endsWith(':cached')); renderTimes(); return;
      }
      if (!id || !runScope.has(id) || id === active?.id) return;
      if (active && !progress.stage.startsWith('pipeline:')) complete(active.id);
      close(); active = { id, started: performance.now() }; timings.set(id, { ms: 0, state: 'running' }); renderTimes();
    },
    endRun(ok) {
      if (ok && active) complete(active.id);
      close();
      if (ok) for (const id of runScope) if (rows.get(id)?.stage.family === 'settlements') complete(id);
      // Urban rows share native output boundaries; validate the whole requested
      // prefix only after every targeted city has completed successfully.
      const finalKeys = validityKeys();
      const [, targets] = JSON.parse(b.cityScope().key) as [string, string[]];
      const order = ['layout', 'parcels', 'programme', 'buildings'];
      for (const id of runScope) if (rows.get(id)?.stage.family === 'cities') {
        const run = rows.get(id)!.stage.run;
        const available = run.action === 'town' && targets.every(key => order.indexOf(String(b.getWorld()?.stats[`v2.urbanStage:${key}`] ?? 'buildings')) >= order.indexOf(run.townStage));
        if (ok && available) { runKeys.set(id, finalKeys.get(id)!); complete(id); } else savedKeys.delete(id);
      }
      for (const id of runScope) { const timing = timings.get(id); if (timing?.state === 'running') timing.state = 'stale'; }
      runScope = new Set(); renderTimes(); sync();
    },
  };
}
