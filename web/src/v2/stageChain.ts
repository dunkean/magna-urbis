/** The V2 generation chain as inspectable stages (relief → water/cover → settlements → city → display).
 * Rows come from stageRegistry.ts. Existing live controls are moved into their stage, never rebuilt:
 * the mounted terrain/region/render forms keep their handlers, validation and sync. */
import { FAMILIES, STAGES, stagesOf, stageForControl, stageForProgress, stageAnchor, type StageContext, type StageDef, type StageFamily, type Copy } from './stageRegistry';
import { allTerrainFields, terrainProceduralStageFields, coastDirections } from './terrainControlSchema';
import { regionControlFields } from './regionControls';
import { effectiveRegion } from './regionSettings';
import { urbanControlFields } from './urbanControlSchema';
import { urbanScopeValues, writeUrbanControl } from './urbanControls';
import { renderControlFields, renderControlValues, writeAppearanceControl } from './renderControls';
import { mountParameterForm, readSettingPath, writeSettingPath, type ParameterField, type ParameterForm } from './parameterForm';
import { atlasUrl, bindTree, getLanguage, numberLocale, registerMessages, setDynamicText, setText, translate } from './i18n';
import { iconImg, type IconId } from './stageIcons';
import { isCompactProcedural } from '../../../rust/bridge/terrainGenerationRecipe';
import type { TerrainControls } from './terrainControls';
import type { V2Progress, V2Settings, V2TerrainSettings } from './contracts';
import type { World } from '../gen/types';
import './stageChain.css';

const copy = (en: string, fr: string): string => { registerMessages({ [en]: { en, fr } }); return en; };
const T = {
  run: copy('Run from this stage', 'Exécuter depuis cette étape'), required: copy('Required stage', 'Étape obligatoire'),
  enable: copy('Enable or disable this stage', 'Activer ou désactiver cette étape'), help: copy('Method in the scientific atlas', 'Méthode dans l’atlas scientifique'),
  open: copy('Show all options', 'Afficher toutes les options'), stale: copy('Settings changed since the last run', 'Réglages modifiés depuis la dernière exécution'),
  cached: copy('Kept from an earlier run', 'Conservé d’une exécution précédente'), running: copy('Running', 'En cours'),
  family: copy('Run the {family} stages', 'Exécuter les étapes : {family}'), place: copy('Place', 'Lieu'), noPlace: copy('Choose a place on the right', 'Choisissez un lieu à droite'),
  needTerrain: copy('Create the relief first', 'Créez d’abord le relief'), needRegion: copy('Place the settlements first', 'Implantez d’abord les peuplements'),
  needPlace: copy('Choose a place in the list on the right', 'Choisissez un lieu dans la liste à droite'), procedural: copy('Procedural', 'Procédural'), neural: copy('Neural', 'Neuronal'),
  heightmap: copy('Heightmap', 'Heightmap'), source: copy('Relief source', 'Source du relief'), width: copy('Width (km)', 'Largeur (km)'), paint: copy('Paint the mask', 'Peindre le masque'),
  view2d: copy('2D map', 'Carte 2D'), view3d: copy('3D view', 'Vue 3D'), style: copy('Map style', 'Style de carte'), inland: copy('Inland', 'Intérieur des terres'),
  noNeural: copy('Neural generation needs WebGPU in this browser, the Python/CUDA server or the native neural service. None is available (see Settings).', 'Le neuronal exige WebGPU dans ce navigateur, le serveur Python/CUDA ou le service neuronal natif. Aucun n’est disponible (voir Réglages).'),
  overrides: copy('Local settings of this place', 'Réglages locaux de ce lieu'),
  needGpu: copy('Needs WebGPU, which this browser does not provide (see Settings).', 'Nécessite WebGPU, absent de ce navigateur (voir Réglages).'),
  needNative: copy('Needs the native Rust service, which is offline (see Settings).', 'Nécessite le service Rust natif, hors ligne (voir Réglages).'),
  needPython: copy('Needs the Python/CUDA neural server, which is offline (see Settings).', 'Nécessite le serveur neuronal Python/CUDA, hors ligne (voir Réglages).'),
};
/** Relief-source fields that only apply to some sources. */
const SOURCE_FIELDS: Record<string, readonly StageContext['relief'][]> = {
  'runtime.source': ['procedural', 'neural'], 'terrain.relief': ['procedural', 'neural'], 'terrain.motifSize': ['procedural'], 'terrain.procedural.preset': ['procedural'],
  'terrain.environment': ['procedural'], 'terrain.mountainMix': ['procedural', 'neural'], 'terrain.generationCompute': ['procedural'], 'terrain.erosion': ['procedural', 'heightmap'],
};
/** Choices that depend on a backend: [select, option value, requirement]. */
const BACKEND_CHOICES: readonly [string, string, 'webgpu' | 'native' | 'python'][] = [
  ['[data-setting-path="runtime.source"]', 'neural-wasm', 'webgpu'], ['[data-setting-path="runtime.source"]', 'neural-python', 'python'], ['[data-setting-path="runtime.source"]', 'neural', 'native'],
  ['[data-setting-path="runtime.backend"]', 'native', 'native'], ['[data-setting-path="runtime.compute"]', 'gpu', 'webgpu'],
  ['[data-setting-path="terrain.generationCompute"]', 'gpu', 'webgpu'], ['[data-setting-path="terrain.generationCompute"]', 'gpu-all', 'webgpu'], ['[data-setting-path="terrain.generationCompute"]', 'gpu-erosion', 'webgpu'], ['[data-setting-path="terrain.generationCompute"]', 'native', 'native'],
  ['[data-setting-path="terrain.compute"]', 'gpu-f32', 'webgpu'], ['[data-setting-path="terrain.hydrology.compute"]', 'gpu', 'webgpu'], ['#urban-backend', 'native', 'native'],
];
for (const family of FAMILIES) registerMessages({ [family.label.en]: family.label, [family.summary.en]: family.summary });
for (const stage of STAGES) registerMessages({ [stage.label.en]: stage.label, [stage.summary.en]: stage.summary, ...(stage.toggle?.reason ? { [stage.toggle.reason.en]: stage.toggle.reason } : {}) });
const familyIcon: Record<StageFamily, IconId> = { relief: 'family-relief', water: 'family-water', settlements: 'family-settlements', city: 'family-city', display: 'family-display' };
const text = (value: Copy) => value.en;
const toggleIcons: Record<string, IconId> = { 'lighting.enabled': 'display-light', 'terrainLayers.water': 'family-water', lakes: 'family-water', roads: 'display-roads', buildings: 'display-buildings', legend: 'display-labels' };

export interface StageChainBindings {
  root: HTMLElement; staging: HTMLElement; terrain: TerrainControls; regionRoot: HTMLElement; renderRoot: HTMLElement;
  getSettings(): V2Settings; getWorld(): World | undefined; getPlace(): { key: string; name: string } | undefined;
  busy(): boolean;
  onChange(): void; onAppearance(): void; onRegionChange(): void;
  run(stage: StageDef): void; runFamily(family: StageFamily): void; openPlace(): void;
  /** Detected backends (Settings); unavailable choices are disabled with their reason. */
  availability(): { checked: boolean; webgpu: boolean; native: boolean; python: boolean };
  heightmap: { source(host: HTMLElement): { sync(): void }; fit(host: HTMLElement): { sync(): void; quick: HTMLElement } };
  onFamily?(family: StageFamily): void;
}
export interface StageChain {
  body(id: string): HTMLElement; sync(): void; family(): StageFamily; selectFamily(family: StageFamily): void;
  beginRun(stages: readonly string[]): void; progress(progress: V2Progress): void; endRun(ok: boolean): void; context(): StageContext;
}
interface Row { stage: StageDef; element: HTMLElement; node: HTMLButtonElement; time: HTMLOutputElement; run: HTMLButtonElement; body: HTMLElement; quick: HTMLElement; note: HTMLElement; title: HTMLButtonElement }

export function mountStageChain(b: StageChainBindings): StageChain {
  const { root } = b, get = b.getSettings;
  root.classList.add('stage-chain');
  const leftovers = document.createElement('div'); leftovers.className = 'stage-leftovers'; leftovers.hidden = true;
  leftovers.append(...Array.from(root.childNodes)); root.append(leftovers);
  const forms: ParameterForm[] = [], syncers: (() => void)[] = [];
  const rows = new Map<string, Row>();
  const stashes: { zones?: V2TerrainSettings['zones']; coastMask?: number; heightmap?: { sketch?: V2TerrainSettings['sketch']; image?: V2Settings['options']['importedHeight'] }; neural?: string } = {};
  let pendingHeightmap = false, family: StageFamily = 'relief';
  const timings = new Map<string, { ms: number; state: 'done' | 'cached' | 'stale' | 'running' | '' }>();
  let active: { id: string; started: number } | undefined, runScope = new Set<string>();

  // ── Family navigation (the chain overview) ───────────────────────────────
  const nav = document.createElement('nav'); nav.className = 'chain-families'; nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', translate('Generation chain'));
  copy('Generation chain', 'Chaîne de génération');
  const tabs = new Map<StageFamily, HTMLButtonElement>(), panels = new Map<StageFamily, HTMLElement>(), familyTimes = new Map<StageFamily, HTMLElement>();
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
    if (f.id === 'city') {
      const place = document.createElement('div'); place.className = 'family-place'; place.id = 'chain-place';
      const caption = document.createElement('span'); caption.className = 'family-place-caption'; setText(caption, T.place);
      const name = document.createElement('strong'); name.id = 'chain-place-name';
      const open = document.createElement('button'); open.type = 'button'; open.className = 'small'; open.id = 'chain-place-open'; setText(open, T.overrides); open.onclick = b.openPlace;
      place.append(caption, name, open); panel.append(place);
      syncers.push(() => { const current = b.getPlace(); open.disabled = !current; if (current) { name.dataset.l10nKeep = ''; name.removeAttribute('data-i18n'); name.textContent = current.name; } else setText(name, T.noPlace); });
    }
    const spine = document.createElement('div'); spine.className = 'chain-spine'; panel.append(spine);
    for (const stage of stagesOf(f.id)) spine.append(buildRow(stage).element);
    panels.set(f.id, panel); scroller.append(panel);
  }
  root.prepend(nav, scroller);

  function buildRow(stage: StageDef): Row {
    const element = document.createElement('section'); element.className = 'stage-row'; element.id = `row-${stage.id}`; element.dataset.stage = stage.id;
    const head = document.createElement('div'); head.className = 'stage-head';
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
    help.textContent = '?'; help.title = translate(T.help); help.setAttribute('aria-label', `${translate(T.help)} · ${translate(text(stage.label))}`); help.dataset.l10nKeep = '';
    const chevron = document.createElement('button'); chevron.type = 'button'; chevron.className = 'stage-open'; chevron.title = translate(T.open); chevron.setAttribute('aria-label', `${translate(T.open)} · ${translate(text(stage.label))}`);
    chevron.setAttribute('aria-controls', `body-${stage.id}`); chevron.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
    chevron.onclick = () => expand(stage.id, title.getAttribute('aria-expanded') !== 'true');
    head.append(node, title, time, run, help, chevron);
    const quick = document.createElement('div'); quick.className = 'stage-quick';
    const note = document.createElement('p'); note.className = 'stage-note'; note.hidden = true;
    const body = document.createElement('div'); body.className = 'stage-body'; body.id = `body-${stage.id}`; body.hidden = true;
    const summary = document.createElement('p'); summary.className = 'stage-summary hint'; setText(summary, text(stage.summary)); body.append(summary);
    element.append(head, quick, note, body);
    const row = { stage, element, node, time, run, body, quick, note, title };
    rows.set(stage.id, row); return row;
  }
  function expand(id: string, open: boolean): void {
    const row = rows.get(id)!; row.body.hidden = !open; row.title.setAttribute('aria-expanded', String(open)); row.element.querySelector('.stage-open')!.setAttribute('aria-expanded', String(open));
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
    return { relief: reliefOf(settings), classicTerrain: settings.runtime?.backend === 'typescript', finiteRelief: ['plateau', 'volcano', 'caldera', 'cavern'].includes(relief),
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
  const place = (node: Element | null | undefined, stageId: string | undefined, where: 'body' | 'quick' = 'body') => {
    if (!node || !stageId) return; const row = rows.get(stageId); if (!row) return;
    (where === 'quick' ? row.quick : row.body).append(node);
  };
  const tRoot = leftovers, sketchHost = b.terrain.sketchHost;
  // Composite widgets first, so their fields stay together.
  const coastPanel = tRoot.querySelector('#terrain-coast-panel'); place(coastPanel, 'relief-coasts');
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
    if (stage === 'settings') { b.staging.querySelector('#settings-endpoints')?.append(field); continue; }
    place(field, stage);
  }
  place(histogram, 'relief-neural-base'); place(neuralNote, 'relief-source'); place(modelNote, 'relief-neural-coarse');
  place(tRoot.querySelector('#terrain-erosion-reset'), 'relief-regional'); place(tRoot.querySelector('#terrain-detail-reset'), 'relief-refine');
  place(tRoot.querySelector('#terrain-phasor-method'), 'relief-phasor');
  // Main-page controls (seed, places, city options) declare their owner with data-control.
  for (const element of Array.from(b.staging.querySelectorAll<HTMLElement>('[data-control]'))) {
    const id = element.dataset.control!, stage = owner(id); if (!stage || stage === 'settings') continue;
    place(element, stage, rows.get(stage)!.stage.quick.includes(id) ? 'quick' : 'body');
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
  const terrainFields = new Map([...allTerrainFields, ...terrainProceduralStageFields].map(field => [field.path, field]));
  for (const stage of STAGES) {
    const fields = terrainProceduralStageFields.filter(field => stageForControl(field.path) === stage.id);
    if (!fields.length) continue;
    const host = document.createElement('div'); rows.get(stage.id)!.body.append(host);
    forms.push(mountParameterForm(host, fields.map(field => ({ ...field, id: `stage-${field.path.replace(/[^a-z0-9]/gi, '-')}` })), { getValue: b.terrain.access.get, setValue: b.terrain.access.set, disabled: b.busy }));
  }

  // ── Quick strips (collapsed rows) ────────────────────────────────────────
  const urbanFields = new Map(urbanControlFields().map(field => [field.path, field]));
  const regionFields = new Map(regionControlFields.map(field => [field.path, field]));
  const quickForm = (row: Row, field: ParameterField, getValue: (path: string) => unknown, setValue: (path: string, value: unknown) => void) => {
    const host = document.createElement('div'); host.className = 'quick-form'; row.quick.append(host);
    forms.push(mountParameterForm(host, [{ ...field, help: undefined, ...(field.placeholder ? { placeholder: 'auto' } : {}), id: `quick-${row.stage.id}-${field.path.replace(/[^a-z0-9]/gi, '-')}` }], { getValue, setValue, disabled: b.busy }));
    // A quick copy must not be mistaken for the live field by the forms that query their paths.
    for (const element of Array.from(host.querySelectorAll<HTMLElement>('[data-field-path]'))) { element.dataset.quickPath = element.dataset.fieldPath; delete element.dataset.fieldPath; }
    for (const element of Array.from(host.querySelectorAll<HTMLElement>('[data-setting-path]'))) { element.dataset.quickSetting = element.dataset.settingPath; delete element.dataset.settingPath; }
  };
  for (const row of rows.values()) for (const id of row.stage.quick) {
    if (id.startsWith('main:') || id.startsWith('widget:layer-')) continue; // moved live controls (above)
    if (terrainFields.has(id)) quickForm(row, terrainFields.get(id)!, b.terrain.access.get, b.terrain.access.set);
    else if (id.startsWith('region.') && regionFields.has(id.slice(7))) quickForm(row, regionFields.get(id.slice(7))!, path => readSettingPath(effectiveRegion(get()), path), (path, value) => { const s = get(); s.region ??= {}; if (path.startsWith('roads.') && s.region.roads === null) s.region.roads = {}; writeSettingPath(s.region, path, value); b.onRegionChange(); });
    else if (id.startsWith('urban.') && urbanFields.has(id.slice(6))) quickForm(row, urbanFields.get(id.slice(6))!, path => readSettingPath(urbanScopeValues(get()), path), (path, value) => { writeUrbanControl(get(), { kind: 'global' }, path, value); b.onChange(); });
    else if (id === 'widget:source-mode') row.quick.append(sourceSwitch());
    else if (id === 'widget:extent-km') row.quick.append(extentQuick());
    else if (id === 'widget:paint') { const button = document.createElement('button'); button.type = 'button'; button.className = 'small quick-action'; setText(button, T.paint); button.onclick = () => paint(); row.quick.append(button); }
    else if (id === 'widget:coast-summary') row.quick.append(coastSummary());
    else if (id === 'widget:style') row.quick.append(styleQuick());
    else if (id === 'widget:view3d') row.quick.append(viewQuick());
    else if (id.startsWith('toggle:')) row.quick.append(appearanceToggle(id.slice(7).replace(/^appearance./, '')));
    else if (id.startsWith('seg:')) row.quick.append(appearanceSegments(id.slice(4).replace(/^appearance./, '')));
    else if (id === 'widget:heightmap-scale') { /* filled by the fit block below */ }
    else console.warn(`[stage-chain] unknown quick control ${id}`);
  }
  // Heightmap alternative inside Relief source; its fit stage.
  const library = document.createElement('div'); library.id = 'heightmap-library'; rows.get('relief-source')!.body.insertBefore(library, rows.get('relief-source')!.body.children[1] ?? null);
  const librarySync = b.heightmap.source(library); syncers.push(() => { library.hidden = reliefOf(get()) !== 'heightmap'; librarySync.sync(); });
  const fitHost = document.createElement('div'); rows.get('relief-heightmap-fit')!.body.insertBefore(fitHost, rows.get('relief-heightmap-fit')!.body.children[1] ?? null);
  const fit = b.heightmap.fit(fitHost); rows.get('relief-heightmap-fit')!.quick.append(fit.quick); syncers.push(fit.sync);
  // Seed and extent hint sit at the top of the source body.
  const seed = rows.get('relief-source')!.body.querySelector('[data-control="widget:seed"]'); if (seed) rows.get('relief-source')!.body.insertBefore(seed, library);

  function extentQuick(): HTMLElement {
    const label = document.createElement('label'); label.className = 'parameter-field parameter-number quick-field';
    const caption = document.createElement('span'); caption.className = 'parameter-caption'; setText(caption, T.width);
    const input = document.createElement('input'); input.type = 'number'; input.id = 'quick-extent-km'; input.min = '.5'; input.max = '100'; input.step = '.1';
    input.addEventListener('change', () => { const km = Number(input.value); if (!Number.isFinite(km) || km < .5 || km > 100) { input.setAttribute('aria-invalid', 'true'); return; } input.removeAttribute('aria-invalid'); get().extent = Math.round(km * 1000); b.onChange(); b.terrain.sync(); });
    label.append(caption, input);
    syncers.push(() => { const s = get(); input.disabled = b.busy() || s.extent === 'auto'; if (document.activeElement !== input) input.value = String((typeof s.extent === 'number' ? s.extent : b.getWorld()?.mapSize ?? 6000) / 1000); });
    return label;
  }
  function coastSummary(): HTMLElement {
    const out = document.createElement('output'); out.className = 'quick-summary';
    syncers.push(() => {
      const mask = Number(b.terrain.access.get('terrain.coastMask') ?? 0), dirs = coastDirections.filter((_, i) => mask & 1 << i);
      out.dataset.l10nKeep = '';
      out.textContent = mask === 0 ? translate(T.inland) : mask === 255 ? `${translate(String(b.terrain.access.get('terrain.islandMode')) === 'archipelago' ? 'Archipelago' : 'Island')} · 8 / 8` : `${dirs.join(' · ')}`;
    });
    return out;
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
  function appearanceToggle(path: string): HTMLElement {
    const field = renderControlFields.find(f => f.path === `appearance.${path}`)!;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'icon-toggle'; button.dataset.appearance = path;
    button.append(iconImg(toggleIcons[path] ?? 'display-layers', 24)); const caption = document.createElement('span'); setText(caption, field.label); button.append(caption);
    const value = () => readSettingPath({ appearance: renderControlValues(get(), b.getWorld()) }, `appearance.${path}`) === true;
    button.onclick = () => { writeAppearanceControl(get(), `appearance.${path}`, !value()); b.onAppearance(); sync(); };
    syncers.push(() => button.setAttribute('aria-pressed', String(value())));
    return button;
  }
  function appearanceSegments(path: string): HTMLElement {
    const field = renderControlFields.find(f => f.path === `appearance.${path}`)!;
    const group = document.createElement('div'); group.className = 'text-segments'; group.setAttribute('role', 'radiogroup'); group.setAttribute('aria-label', translate(field.label));
    const buttons = (field.options ?? []).map(option => {
      const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'radio'); setText(button, option.label);
      button.onclick = () => { writeAppearanceControl(get(), `appearance.${path}`, option.value); b.onAppearance(); sync(); };
      group.append(button); return [option.value, button] as const;
    });
    syncers.push(() => { const value = readSettingPath({ appearance: renderControlValues(get(), b.getWorld()) }, `appearance.${path}`); for (const [v, button] of buttons) button.setAttribute('aria-checked', String(v === value)); });
    return group;
  }

  // Leftover legacy wrappers stay hidden but mounted (their sync keeps working).
  bindTree(root);
  // A change inside a row makes it, and every later generation stage, stale.
  root.addEventListener('change', event => { const row = (event.target as Element).closest<HTMLElement>('.stage-row'); if (row) markStale(row.dataset.stage!); });
  function markStale(id: string): void {
    const index = STAGES.findIndex(stage => stage.id === id), stage = STAGES[index];
    if (!stage || stage.family === 'display') return;
    for (const later of STAGES.slice(index)) {
      if (later.family === 'display') continue;
      const timing = timings.get(later.id); if (timing && timing.state !== 'running') timing.state = 'stale';
    }
    renderTimes();
  }
  function renderTimes(): void {
    for (const [id, row] of rows) {
      const timing = timings.get(id);
      row.element.dataset.run = timing?.state ?? '';
      // Stages without their own progress events ran inside a neighbouring row: no invented time.
      if (!timing || timing.state !== 'running' && timing.ms === 0) { row.time.textContent = ''; row.time.title = ''; continue; }
      row.time.textContent = timing.state === 'running' ? '…' : timing.ms < 1000 ? `${Math.max(1, Math.round(timing.ms))} ms` : `${(timing.ms / 1000).toLocaleString(numberLocale(), { maximumFractionDigits: 2 })} s`;
      row.time.title = translate(timing.state === 'stale' ? T.stale : timing.state === 'cached' ? T.cached : timing.state === 'running' ? T.running : text(row.stage.label));
    }
    for (const f of FAMILIES) {
      const total = stagesOf(f.id).reduce((sum, stage) => sum + (timings.get(stage.id)?.ms ?? 0), 0), label = familyTimes.get(f.id)!;
      label.textContent = total ? total < 1000 ? `${Math.round(total)} ms` : `${(total / 1000).toLocaleString(numberLocale(), { maximumFractionDigits: 1 })} s` : '';
      tabs.get(f.id)!.dataset.stale = String(stagesOf(f.id).some(stage => timings.get(stage.id)?.state === 'stale'));
    }
  }
  const close = (now = performance.now()) => {
    if (!active) return; const timing = timings.get(active.id) ?? { ms: 0, state: 'running' as const };
    timing.ms += now - active.started; timings.set(active.id, timing); active = undefined;
  };
  function sync(): void {
    const ctx = context(), busy = b.busy();
    for (const form of forms) form.sync();
    for (const syncer of syncers) syncer();
    // Source alternatives: fields that do not apply to the chosen relief source are set aside.
    for (const [path, sources] of Object.entries(SOURCE_FIELDS)) for (const element of Array.from(root.querySelectorAll<HTMLElement>(`[data-field-path="${path}"],[data-quick-path="${path}"]`)))
      element.toggleAttribute('data-chain-hidden', !sources.includes(ctx.relief));
    // The 8-bit image scale and sea level only apply to an imported grayscale image.
    for (const path of ['options.heightScale', 'options.importSea']) root.querySelector<HTMLElement>(`[data-field-path="${path}"]`)?.toggleAttribute('data-chain-hidden', !get().options.importedHeight);
    // Quick copies follow the visibility of their live field (relief family, compact preset…).
    for (const quick of Array.from(root.querySelectorAll<HTMLElement>('.stage-quick [data-quick-path]'))) {
      const live = root.querySelector<HTMLElement>(`.stage-body [data-field-path="${quick.dataset.quickPath}"]`);
      if (live) quick.hidden = live.hidden;
    }
    const caps = b.availability();
    for (const [selector, value, need] of BACKEND_CHOICES) for (const select of Array.from(root.querySelectorAll<HTMLSelectElement>(selector))) {
      const option = Array.from(select.options).find(o => o.value === value); if (!option) continue;
      const missing = caps.checked && !caps[need];
      if (missing) { option.disabled = true; option.dataset.unavailable = ''; option.title = translate(need === 'webgpu' ? T.needGpu : need === 'native' ? T.needNative : T.needPython); }
      else if (option.dataset.unavailable !== undefined) { option.disabled = false; delete option.dataset.unavailable; option.title = ''; }
    }
    for (const row of rows.values()) {
      const { stage } = row, visible = stage.when(ctx); row.element.hidden = !visible; if (!visible) continue;
      const reason = stage.unavailable?.(ctx);
      row.note.hidden = !reason; if (reason) setText(row.note, text(reason)); row.element.dataset.na = String(!!reason);
      const on = toggleState(stage); row.element.dataset.enabled = String(on);
      if (!stage.optional || stage.toggle?.kind === 'unavailable') row.node.disabled = true;
      if (stage.optional && stage.toggle && stage.toggle.kind !== 'unavailable') { row.node.setAttribute('aria-checked', String(on)); row.node.disabled = busy || !!reason; }
      const prerequisite = stage.family === 'settlements' ? !ctx.hasTerrain && T.needTerrain : stage.family === 'city' ? !ctx.hasRegion ? T.needRegion : !ctx.place && T.needPlace : stage.family === 'display' ? !ctx.hasTerrain && T.needTerrain : false;
      row.run.disabled = busy || !!reason || !!prerequisite || stage.optional && !on && stage.toggle?.kind !== 'unavailable';
      row.run.title = translate(prerequisite || (reason ? text(reason) : T.run));
      if (!row.quick.childElementCount) row.quick.hidden = true;
    }
    for (const f of FAMILIES) { const button = panels.get(f.id)!.querySelector<HTMLButtonElement>('.family-run')!; button.disabled = busy || (f.id !== 'relief' && f.id !== 'water' && !ctx.hasTerrain) || f.id === 'city' && !ctx.hasRegion; }
    renderTimes();
  }
  selectFamily('relief'); sync();
  return {
    body: id => rows.get(id)!.body, sync, family: () => family, selectFamily, context,
    beginRun(stages) {
      runScope = new Set(stages);
      for (const id of stages) timings.set(id, { ms: 0, state: 'running' }); active = undefined; renderTimes();
    },
    progress(progress) {
      const id = stageForProgress(progress.stage);
      if (progress.stage.startsWith('pipeline:') && progress.stage.endsWith(':done')) { close(); renderTimes(); return; }
      if (!id || !runScope.has(id) || id === active?.id) return;
      close(); active = { id, started: performance.now() }; const timing = timings.get(id); if (timing) timing.state = 'running'; renderTimes();
    },
    endRun(ok) {
      close();
      for (const id of runScope) { const timing = timings.get(id); if (!timing) continue; timing.state = ok ? 'done' : 'stale'; }
      runScope = new Set(); renderTimes(); sync();
    },
  };
}
