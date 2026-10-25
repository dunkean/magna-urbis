import { executionProfiles, executionRuntime } from './executionProfile';
import { initialTerrainSource } from './terrainStartupState';

/** Presentation only: keep the engines, input identities and event handlers owned by each stage. */
type PanelSpec = {
  main: string;
  method?: string;
  compute?: string;
  methodText?: string;
  computeText?: string;
  action?: string;
};

const specs: Record<string, PanelSpec> = {
  reliefStage: { main: '#width, #relief, #climate, #motifSize, #erosion, #environment, #mountainMix', method: '#terrainMethod', compute: '#terrainSource, #generationCompute, #compute', action: '#generateRelief' },
  coastStage: { main: '#coastControl', methodText: 'Découpe du relief', computeText: 'Support du terrain · Rust / WebGPU', action: '#generateCoasts' },
  hydroStage: { main: '#hydroEnabled, #rustControls', method: '#hydroEngine', compute: '#hydroCompute', action: '#generateHydrology' },
  settlementStage: { main: '#setEnabled, #setAutoRefresh, #setRefresh, #setMainPop, #setCulture, #setCounts', method: '#setMode, #setDistribution', computeText: 'CPU · Rust / WASM', action: '#setGenerate' },
  roadStage: { main: '#roadEnabled, #roadLevel, #roadCulture, [data-road="density"]', methodText: 'Routage selon le terrain', computeText: 'CPU · Rust / WASM', action: '#roadRecalculate' },
  urbanQuarterStage: { main: '[data-enabled], #urbanTarget, [data-footprint="family"], [data-config="culture"]', method: '[data-config="composition"], [data-footprint="mechanism"], [data-config="tissue"]', computeText: 'CPU · Rust / WASM', action: '[data-apply]' },
  urbanParcelStage: { main: '[data-enabled], [data-config="culture"]', method: '[data-config="operator"]', computeText: 'CPU · Rust / WASM', action: '[data-apply]' },
  seedStage: { main: '#seedName, #seedPopulation, #seedCulture, #seedSite, .settlement-actions', method: '#seedRoads', computeText: 'Placement sur la carte' },
  decorStage: { main: '#decorList, #decorInfo', methodText: 'Décor conservé', computeText: 'Import local', },
  landuseStage: { main: '#landuseEnabled, #landuseBiome', methodText: 'Occupation procédurale', computeText: 'CPU · TypeScript', action: '#landuseGenerate' },
};

/** City Bench (citybench.html): one city, its editor, the exploration tools and the seeds stay in view. */
const citySpecs: Record<string, PanelSpec> = {
  settlementStage: { main: '#setAutoRefresh, #setRefresh, #setEditor', methodText: 'Une ville · position fixée', computeText: 'CPU · Rust / WASM' },
  urbanQuarterStage: { main: '[data-enabled], .settlement-style-controls, .urban-explorer, [data-seed], [data-warnings]', method: '[data-config="composition"]', computeText: 'CPU · Rust / WASM', action: '[data-apply]' },
  urbanParcelStage: { main: '[data-enabled], [data-config="operator"], [data-seed]', computeText: 'CPU · Rust / WASM', action: '[data-apply]' },
};
const stageSpecs = document.body.dataset.bench === 'city' ? { ...specs, ...citySpecs } : specs;

function group(title: string, className: string): HTMLElement {
  const section = document.createElement('section'); section.className = `panel-group ${className}`;
  section.setAttribute('aria-label', title);
  {
    const icon = document.createElement('span'); icon.className = 'panel-group-icon'; icon.title = title; icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = className === 'panel-main'
      ? '<svg viewBox="0 0 20 20"><path d="M3 5h14M3 10h14M3 15h14M6 3v4m7 1v4m-5 1v4"/></svg>'
      : className === 'panel-method'
      ? '<svg viewBox="0 0 20 20"><path d="M2 14c4 0 3-8 7-8s3 8 9 8M2 5h3m10 0h3"/></svg>'
      : '<svg viewBox="0 0 20 20"><rect x="5" y="5" width="10" height="10" rx="1"/><path d="M8 2v3m4-3v3M8 15v3m4-3v3M2 8h3m-3 4h3m10-4h3m-3 4h3"/></svg>';
    section.append(icon);
  }
  return section;
}

function advanced(title = 'Paramètres avancés'): HTMLDetailsElement {
  const details = document.createElement('details'); details.className = 'panel-advanced';
  const summary = document.createElement('summary'); summary.title = title; summary.setAttribute('aria-label', title);
  summary.textContent = title === 'Paramètres avancés' ? 'Avancé' : title;
  const body = document.createElement('div'); body.className = 'panel-advanced-body';
  details.append(summary, body); return details;
}

/** Move complete labels/groups, retaining conditional containers where they are needed. */
function take(root: ParentNode, selector: string | undefined, destination: Element): void {
  if (!selector) return;
  for (const field of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
    const node = field.closest<HTMLElement>('.terrain-help-row') ?? field.closest<HTMLElement>('label') ?? field;
    if (!destination.contains(node)) destination.append(node);
  }
}

function terrainMethod(): void {
  const source = document.querySelector<HTMLSelectElement>('#terrainSource');
  if (!source || document.getElementById('terrainMethod')) return;
  if (!source.dataset.sourceInitialized) {
    source.value = initialTerrainSource(new URLSearchParams(location.search), executionProfiles[executionRuntime.profile].neural);
    source.dataset.sourceInitialized = 'true';
  }
  const method = document.createElement('select'); method.id = 'terrainMethod';
  method.add(new Option('Procédurale', 'procedural')); method.add(new Option('Neuronale', 'neural'));
  const label = document.createElement('label'); label.append('Méthode ', method);
  source.closest('label')!.before(label);
  source.closest('label')!.childNodes[0].textContent = 'Exécution ';
  const names: Record<string, string> = { procedural: 'Rust · CPU / WebGPU', 'neural-wasm': 'Navigateur · WASM / WebGPU', 'neural-python': 'Python · CUDA' };
  for (const option of Array.from(source.options)) option.textContent = names[option.value] ?? option.textContent;
  let neuralSupport: string = executionProfiles[executionRuntime.profile].neural;
  const sync = (): void => {
    method.value = source.value === 'procedural' ? 'procedural' : 'neural'; method.disabled = source.disabled;
    if (method.value === 'neural') neuralSupport = source.value;
    source.closest('label')!.hidden = method.value === 'procedural';
    const generation = document.getElementById('generationCompute');
    if (generation) generation.closest('label')!.hidden = method.value === 'neural';
    for (const option of Array.from(source.options)) {
      option.hidden = (option.value === 'procedural') !== (method.value === 'procedural');
      option.disabled = option.hidden;
    }
  };
  method.addEventListener('change', () => {
    source.value = method.value === 'procedural' ? 'procedural' : neuralSupport;
    source.dispatchEvent(new Event('input', { bubbles: true }));
    source.dispatchEvent(new Event('change', { bubbles: true })); sync();
  });
  source.addEventListener('input', sync);
  source.addEventListener('change', sync);
  window.addEventListener('bench-source-change', sync);
  new MutationObserver(sync).observe(source, { attributes: true, attributeFilter: ['disabled'], childList: true });
  sync();
}

function organizeStage(panel: HTMLDetailsElement, spec: PanelSpec): void {
  if (panel.dataset.panelLayout) return;
  panel.dataset.panelLayout = 'true'; panel.open = true; panel.classList.add('parameter-stage');
  // Main blocks stay open. Submenus alone are collapsible.
  const heading = panel.querySelector('summary')!;
  heading.addEventListener('click', event => { if (!(event.target as Element).closest('button, input, select, label')) event.preventDefault(); });
  panel.addEventListener('toggle', () => { if (!panel.open) panel.open = true; });
  const controls = panel.querySelector<HTMLElement>(':scope > .stage-controls')!;
  const main = group('Paramètres principaux', 'panel-main');
  const method = group('Méthode de calcul', 'panel-method');
  const compute = group('Support de calcul', 'panel-compute');
  const extra = advanced(), body = extra.lastElementChild!;
  if (panel.id === 'hydroStage') {
    const rust = controls.querySelector<HTMLElement>('#rustControls')!;
    const secondary = document.createElement('div'); secondary.className = 'control-group';
    take(rust, '#hydroCoastal, #hydroMeanders, #hydroEstuary', secondary);
    const sync = (): void => { secondary.hidden = rust.hidden; };
    new MutationObserver(sync).observe(rust, { attributes: true, attributeFilter: ['hidden'] }); sync();
    body.append(secondary);
    const engine = controls.querySelector<HTMLSelectElement>('#hydroEngine')!;
    engine.closest('label')!.childNodes[0].textContent = 'Méthode ';
    for (const option of Array.from(engine.options)) option.textContent = option.value === 'rust' ? 'Réseau hydrologique' : 'Vectoriel · référence';
    const support = controls.querySelector('#hydroCompute')!.closest('label')!;
    const vector = document.createElement('span'); vector.className = 'panel-value'; vector.textContent = 'CPU · TypeScript';
    compute.append(vector);
    const supportSync = (): void => { support.hidden = engine.value !== 'rust'; vector.hidden = engine.value === 'rust'; };
    engine.addEventListener('input', supportSync); engine.addEventListener('change', supportSync);
    new MutationObserver(supportSync).observe(rust, { attributes: true, attributeFilter: ['hidden'] }); supportSync();
  }
  // Select controls before reparenting the original containers.
  take(controls, spec.main, main); take(controls, spec.method, method); take(controls, spec.compute, compute);
  for (const [target, text] of [[method, spec.methodText], [compute, spec.computeText]] as const) {
    if (text) { const value = document.createElement('span'); value.className = 'panel-value'; value.textContent = text; target.append(value); }
  }
  const action = spec.action ? controls.querySelector<HTMLButtonElement>(spec.action) : undefined;
  const toolbar = document.createElement('div'); toolbar.className = 'panel-toolbar';
  if (action) {
    const title = action.textContent!.trim(); action.title = title; action.setAttribute('aria-label', title);
    action.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6.1 6.1a8 8 0 0 1 13 2.9M4.9 15a8 8 0 0 0 13 2.9"/></svg>';
    action.classList.add('panel-recalculate'); heading.append(action);
    if (panel.id === 'reliefStage') {
      const generation = document.querySelector('.generation-actions');
      if (generation) {
        const all = generation.querySelector<HTMLElement>('#generate'); if (all) all.hidden = true;
        generation.prepend(action); heading.append(generation);
      }
    }
  }
  // Keep live status messages beside their stage instead of hiding progress in Advanced.
  const statuses = Array.from(controls.querySelectorAll<HTMLElement>('[data-status], [data-draft-state], #setStatus, #roadStatus, #landuseStatus, #neuralState'));
  for (const status of statuses) toolbar.append(status);
  while (controls.firstChild) body.append(controls.firstChild);
  for (const details of Array.from(body.querySelectorAll('details'))) details.open = false;
  extra.hidden = body.children.length === 0;
  controls.append(toolbar, main, method, compute, extra);
}

function footer(): HTMLElement {
  let element = document.querySelector<HTMLElement>('.bench-footer');
  if (!element) {
    element = document.createElement('section'); element.className = 'bench-footer'; element.setAttribute('aria-label', 'Transfert et export');
    document.querySelector('.terrain-left-panel')!.append(element);
  }
  return element;
}

function organizeTransfer(): void {
  const transfer = document.querySelector<HTMLDetailsElement>('#pipelineTransfer');
  if (!transfer || transfer.dataset.panelLayout) return;
  transfer.dataset.panelLayout = 'true'; transfer.open = true;
  const dock = footer(); dock.append(transfer);
  const heading = transfer.querySelector('summary')!;
  heading.addEventListener('click', event => event.preventDefault());
  const controls = transfer.querySelector('.stage-controls')!, options = advanced('Options d’export');
  const actions = document.createElement('div'); actions.className = 'footer-actions';
  for (const selector of ['#pipelineNext', '#pipelineSave', '#pipelineDownload']) take(controls, selector, actions);
  const note = controls.querySelector('#pipelineStatus')!;
  while (controls.firstChild) options.lastElementChild!.append(controls.firstChild);
  controls.append(actions, options, note);
  // Legacy decor export uses the same applied snapshot; keep it available in the dock.
  const legacy = document.querySelector('#setExportDecor'); if (legacy) options.lastElementChild!.append(legacy);
}

function organize(): void {
  const relief = document.querySelector('#reliefState')?.closest<HTMLDetailsElement>('.stage');
  const coast = document.querySelector('#coastState')?.closest<HTMLDetailsElement>('.stage');
  const hydro = document.querySelector('#hydroState')?.closest<HTMLDetailsElement>('.stage');
  if (relief) relief.id = 'reliefStage'; if (coast) coast.id = 'coastStage'; if (hydro) hydro.id = 'hydroStage';
  terrainMethod();
  // Compute settings belong to the terrain, rather than a separate pipeline stage.
  if (relief && !relief.dataset.panelLayout) {
    const width = document.getElementById('width');
    if (width) relief.querySelector('.stage-controls')!.prepend(width.closest('label')!);
    for (const id of ['generationCompute', 'compute']) {
      const field = document.getElementById(id); if (field) relief.querySelector('.stage-controls')!.append(field.closest('label')!);
    }
  }
  for (const [id, spec] of Object.entries(stageSpecs)) {
    const panel = document.getElementById(id); if (panel instanceof HTMLDetailsElement) organizeStage(panel, spec);
  }
  const sketch = document.querySelector<HTMLDetailsElement>('#terrainSketchEditor > details');
  if (sketch && !sketch.dataset.panelLayout) {
    const extra = relief?.querySelector<HTMLDetailsElement>(':scope > .stage-controls > .panel-advanced');
    if (extra) {
      sketch.dataset.panelLayout = 'true'; sketch.open = false;
      sketch.querySelector('summary')!.textContent = 'Dessin et heightmap';
      extra.lastElementChild!.append(sketch.parentElement!); extra.hidden = false;
    }
  }
  const history = document.querySelector<HTMLDetailsElement>('#benchHistory');
  if (history && !history.dataset.panelLayout) { history.dataset.panelLayout = 'true'; history.open = false; }
  organizeTransfer();
  if (document.getElementById('urbanSaveExport') && !document.getElementById('urbanExportDock')) {
    const dock = footer(); dock.id = 'urbanExportDock';
    take(document, '#urbanSaveExport', dock);
    const download = document.createElement('button'); download.id = 'urbanDownloadExport'; download.textContent = 'Exporter .decor';
    download.onclick = () => document.dispatchEvent(new Event('bench-export-urban'));
    dock.append(download);
    const workshop = document.querySelector<HTMLButtonElement>('[data-workshop-space]');
    if (workshop) {
      const next = document.createElement('button'); next.textContent = 'Ouvrir l’atelier quartiers / parcelles';
      next.onclick = () => workshop.click(); dock.prepend(next);
    }
  }
  const dock = document.querySelector('.bench-footer');
  if (dock) {
    const workshop = document.getElementById('urbanWorkshop');
    if (workshop) {
      const owner = workshop.hidden ? document.querySelector('.terrain-left-panel')! : workshop;
      if (dock.parentElement !== owner) owner.append(dock);
    }
    let options = dock.querySelector('.panel-advanced');
    if (!options) { options = advanced('Options d’export'); dock.append(options); }
    const recipes = document.querySelector('.recipe-actions'); if (recipes && !recipes.closest('dialog')) options.lastElementChild!.append(recipes);
    const svg = document.getElementById('fantasyExport_svg'), png = document.getElementById('fantasyExport_png');
    if (svg && png && !svg.closest('.footer-fantasy')) {
      const exports = document.createElement('div'); exports.className = 'footer-fantasy'; exports.append(svg, png); options.lastElementChild!.append(exports);
      const style = document.querySelector<HTMLSelectElement>('#style, #mapStyle')!;
      const sync = (): void => { exports.hidden = !style.value.startsWith('fantasy-'); };
      style.addEventListener('input', sync); style.addEventListener('change', sync); sync();
      const stage = document.getElementById('fantasyStyleControls');
      if (stage) new MutationObserver(sync).observe(stage, { attributes: true, attributeFilter: ['hidden'] });
    }
  }
}

const stages = document.querySelector('.stages');
if (stages) {
  organize();
  // Only watch the control column, never the map's large, frequently changing SVG tree.
  new MutationObserver(organize).observe(stages, { childList: true });
  window.addEventListener('bench-space-change', organize);
}

// Keep calculation feedback visible even when the responsible stage is off screen.
const displayBar = document.querySelector('nav');
if (displayBar) {
  const progress = document.createElement('span'); progress.id = 'calculationProgress';
  progress.setAttribute('role', 'status'); progress.setAttribute('aria-live', 'polite');
  progress.innerHTML = '<span class="calculation-spinner" aria-hidden="true"></span><span>Calcul en cours…</span>';
  progress.hidden = true; displayBar.append(progress);
  const syncProgress = (): void => { progress.hidden = !document.querySelector('[aria-busy="true"]'); };
  new MutationObserver(syncProgress).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-busy'] });
  syncProgress();
}
