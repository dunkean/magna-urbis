import UrbanWorker from './urbanWorker?worker&inline';
import catalogueJson from '../../../rust/crates/core/src/urban/catalogue.json';
import { defaultLayoutConfig, defaultParcelConfig, runUrbanRequest, type Layout, type LayoutConfig, type ParcelConfig, type Partition, type Point, type Shape, type UrbanRequest, type UrbanResponse } from '../../../rust/bridge/urban';
import { settlementRaster, type RoadOutput, type SettlementOutput } from '../../../rust/bridge/settlements';
import type { TerrainData } from '../../../rust/bridge/terrain';
import './terrainUrban.css';

interface Catalogue { fields: Record<'quarters' | 'parcels', string[]>; presets: Record<string, { label: string; params: Record<string, unknown> }>; cultures: Record<string, { label: string; recipes: { id: string; label: string; zone: string; preset: string }[] }> }
const catalogue = catalogueJson as Catalogue;
const ns = 'http://www.w3.org/2000/svg';
const clone = <T>(v: T): T => structuredClone(v);
const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const operators: Record<string, string[]> = { streetOp: ['organic', 'grid'], closeOp: ['closes', 'culDeSacTree', 'hutong', 'roji', 'none'], orientation: ['road', 'cardinal', 'terrain', 'water'], plotOp: ['burgage', 'courtyard', 'siheyuan', 'machiya', 'compound', 'garden', 'wholeBlock'] };
const labels: Record<string, string> = { streetOp: 'Rues', closeOp: 'Dessertes', orientation: 'Orientation', laneSpacing: 'Espacement des ruelles', wardArea: 'Surface des quartiers', accessDepth: 'Profondeur accessible', fieldTwist: 'Rotation du champ', curvature: 'Courbure', fieldNoise: 'Bruit du champ', fieldWavelength: 'Longueur du champ', fieldRandom: 'Variation du champ', gridSpacing: 'Espacement de grille', gridSkew: 'Obliquité de grille', blockSize: 'Taille des îlots', minBlock: 'Surface minimale des îlots', minWidth: 'Largeur minimale', widthByRank: 'Largeurs par rang', widthScale: 'Échelle des largeurs', widthJitter: 'Variation des largeurs', placeThreshold: 'Seuil des places', deadEndRatio: 'Impasse / longueur', slitDepth: 'Profondeur des passages', plotDepth: 'Profondeur des parcelles', contourFollow: 'Suivi des courbes de niveau', contourBlend: 'Influence du relief', longCut: 'Coupures longues', plotOp: 'Méthode de parcelles', houseArea: 'Surface de cour', coverage: 'Occupation', frontage: 'Largeur de façade', plotTilt: 'Inclinaison des parcelles', wideLotChance: 'Probabilité de grande parcelle', deepFill: 'Remplir les fonds' };
const path = (pts: Point[], close = false): string => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ') + (close ? 'Z' : '');
const shapePath = (s: Shape): string => [s.outer, ...(s.holes ?? [])].map(p => path(p, true)).join(' ');
interface Render { quarters: boolean; blocks: boolean; streets: boolean; parcels: boolean; gardens: boolean; places: boolean; fronts: boolean; axes: boolean; opacity: number; width: number; palette: 'atlas' | 'ink' | 'terrain' }
type Kind = 'quarters' | 'parcels';

export function createTerrainUrban(options: { map: SVGSVGElement; before: Element | null; getTerrain(): TerrainData | undefined; getSeed(): string; onChange(): void; onFocus?(center: Point, radius: number): void }) {
  let settlements: SettlementOutput | undefined, roads: RoadOutput | undefined;
  let layouts: Layout[] | undefined, partitions: Partition[] | undefined;
  let layoutConfig = defaultLayoutConfig(), parcelConfig = defaultParcelConfig();
  let quarterSeed = '', parcelSeed = '', target = '', ready = false;
  let enabled = true, parcelEnabled = true, appliedKind: Kind = 'quarters';
  let worker: Worker | undefined, fallback = false, cachedTerrain: TerrainData | undefined, id = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let drawnLayer: SVGGElement | undefined, drawnLayouts: Layout[] | undefined, drawnPartitions: Partition[] | undefined, drawnState = '';
  let render: Render = { quarters: false, blocks: true, streets: true, parcels: true, gardens: true, places: true, fronts: false, axes: false, opacity: 0.8, width: 0.6, palette: 'atlas' };
  const saved = new URLSearchParams(location.search).get('urban');
  if (saved) try {
    const s = JSON.parse(saved);
    layoutConfig = { ...layoutConfig, ...s.layoutConfig }; parcelConfig = { ...parcelConfig, ...s.parcelConfig };
    quarterSeed = s.quarterSeed ?? ''; parcelSeed = s.parcelSeed ?? ''; target = s.target ?? '';
    enabled = s.enabled !== false; parcelEnabled = s.parcelEnabled !== false; render = { ...render, ...s.render };
  } catch { /* Broken links keep native defaults. */ }
  const stages = document.querySelector('.stages')!;
  const common = `<label>Culture<select data-config="culture"><option value="site">Culture de chaque settlement</option>${Object.entries(catalogue.cultures).map(([id, c]) => `<option value="${esc(id)}">${esc(c.label)}</option>`).join('')}</select></label>
    <label>Recette<select data-config="recipe"></select></label><label>Préréglage<select data-config="preset"><option value="culture">Recette culturelle</option>${Object.entries(catalogue.presets).map(([id, p]) => `<option value="${esc(id)}">${esc(p.label)}</option>`).join('')}</select></label>
    <label>Zone<select data-config="zone">${['core', 'middle', 'edge', 'faubourg', 'village'].map(z => `<option>${z}</option>`).join('')}</select></label><label>Densité<input data-config="density" type="number" min="0.1" max="10" step="0.1"></label>`;
  const number = (key: string, label: string, min: number, max: number, step = 1): string => `<label>${label}<input data-config="${key}" type="number" min="${min}" max="${max}" step="${step}"></label>`;
  function panel(kind: Kind, title: string): HTMLDetailsElement {
    const p = document.createElement('details'); p.className = 'stage urban-stage'; p.id = kind === 'quarters' ? 'urbanQuarterStage' : 'urbanParcelStage'; p.open = true;
    p.innerHTML = `<summary>${title}<span data-state></span></summary><div class="stage-controls">
      <label><input data-enabled type="checkbox">Générer ${kind === 'quarters' ? 'les quartiers' : 'les parcelles'}</label>
      ${kind === 'quarters' ? '<label>Settlement ciblé<select id="urbanTarget"></select></label><button type="button" id="urbanFocus">Centrer sur la sélection</button>' : '<small>Les parcelles utilisent les îlots du bloc 6, sans régénérer les rues.</small>'}
      <label>Graine ${kind === 'quarters' ? 'quartiers' : 'parcelles'}<input data-seed type="text" placeholder="Graine de la carte"></label>
      <div class="control-group">${common}${kind === 'quarters' ? number('count', 'Quartiers par anneau', 3, 8) + number('rings', 'Anneaux', 1, 2) + number('radius', 'Rayon (m · 0 = settlement)', 0, 20000) + number('radiusScale', 'Échelle du rayon', 0.1, 5, 0.1) + '<label>Disposition<select data-config="placement"><option value="center">Radiale</option><option value="rectangle">Rectangle</option><option value="skew">Oblique</option><option value="notched">Avec encoche</option></select></label><label>Réservation monument<input data-config="monument" type="text" list="urbanMonuments"></label><datalist id="urbanMonuments"><option value="none"><option value="cathedral"><option value="great-mosque"><option value="temple"><option value="castle"><option value="palace"></datalist>' : ''}</div>
      <details class="advanced"><summary>Tous les paramètres natifs</summary><div data-fields class="urban-fields"></div><label>Overrides JSON<textarea data-json rows="4" spellcheck="false" placeholder="{}"></textarea></label><small>Les valeurs modifiées remplacent la recette. Les mesures géométriques sont en mètres (surfaces en m²).</small><button data-reset type="button">Réinitialiser les paramètres</button></details>
      ${kind === 'quarters' ? '<small>Relief, rivières et lacs viennent du terrain réel. Les réglages de relief synthétique de l’ancien bench sont remplacés par les blocs 1–3.</small>' : ''}
      <button data-apply type="button">${kind === 'quarters' ? 'Générer les quartiers et îlots' : 'Générer les parcelles'}</button><small data-status role="status">En attente des settlements…</small><div data-warnings role="status"></div></div>`;
    stages.insertBefore(p, options.before); return p;
  }
  const quarterPanel = panel('quarters', '6 · Quartiers et îlots '), parcelPanel = panel('parcels', '7 · Parcelles ');
  const targetSelect = quarterPanel.querySelector<HTMLSelectElement>('#urbanTarget')!;
  const q = <T extends HTMLElement>(p: HTMLElement, selector: string): T => p.querySelector(selector) as T;
  const getConfig = (kind: Kind): LayoutConfig | ParcelConfig => kind === 'quarters' ? layoutConfig : parcelConfig;
  const getPanel = (kind: Kind): HTMLElement => kind === 'quarters' ? quarterPanel : parcelPanel;
  function siteCulture(kind: Kind = 'quarters'): string {
    const site = settlements?.settlements.find(s => s.key === target) ?? settlements?.settlements.slice().sort((a, b) => b.population - a.population)[0];
    return (kind === 'parcels' ? layouts?.find(l => l.key === site?.key)?.culture : undefined) ?? site?.culture ?? 'european-organic';
  }
  function baseline(config: ParcelConfig): Record<string, unknown> {
    const c = catalogue.cultures[config.culture && config.culture !== 'site' ? config.culture : siteCulture(config === parcelConfig ? 'parcels' : 'quarters')];
    const recipe = c?.recipes.find(r => r.id === config.recipe) ?? c?.recipes[0];
    return catalogue.presets[config.preset === 'culture' ? recipe?.preset ?? 'morph/european-organic' : config.preset]?.params ?? {};
  }
  function populate(kind: Kind): void {
    const p = getPanel(kind), config = getConfig(kind);
    q<HTMLInputElement>(p, '[data-enabled]').checked = kind === 'quarters' ? enabled : parcelEnabled;
    q<HTMLInputElement>(p, '[data-seed]').value = kind === 'quarters' ? quarterSeed : parcelSeed;
    const culture = catalogue.cultures[config.culture && config.culture !== 'site' ? config.culture : siteCulture(kind)];
    const recipe = q<HTMLSelectElement>(p, '[data-config="recipe"]');
    recipe.replaceChildren(...(culture?.recipes ?? [{ id: 'core', label: 'Cœur', zone: 'core', preset: '' }]).map(r => new Option(r.label, r.id)));
    // A shared recipe may be valid for another settlement culture; Rust validates it per site.
    if (!Array.from(recipe.options).some(o => o.value === config.recipe)) recipe.add(new Option(config.recipe, config.recipe));
    for (const c of Array.from(p.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-config]'))) c.value = String((config as unknown as Record<string, unknown>)[c.dataset.config!] ?? '');
    const base = baseline(config), fields = q<HTMLElement>(p, '[data-fields]'); fields.replaceChildren();
    for (const key of catalogue.fields[kind]) {
      const raw = config.params[key] ?? base[key] ?? (key === 'deepFill' ? false : 0);
      const zoned = base[key] !== null && typeof base[key] === 'object' && !Array.isArray(base[key]);
      const overrides = config.params[key] && typeof config.params[key] === 'object' && !Array.isArray(config.params[key]) ? config.params[key] as Record<string, unknown> : {};
      const value = zoned ? overrides[config.zone] ?? (base[key] as Record<string, unknown>)[config.zone] ?? [0, 0] : raw;
      const label = document.createElement('label'); label.title = key;
      const title = document.createElement('span'); title.textContent = labels[key] ?? key; label.append(title);
      if (operators[key]) {
        const select = document.createElement('select'); select.replaceChildren(...operators[key].map(v => new Option(v, v))); select.value = String(value);
        select.onchange = () => { config.params[key] = select.value; }; label.append(select);
      } else if (Array.isArray(value)) {
        const pair = document.createElement('span'); pair.className = 'urban-array';
        value.forEach((v, i) => {
          const input = document.createElement('input'); input.type = 'number'; input.step = 'any'; input.value = String(v); input.title = `${key}${zoned ? `.${config.zone}` : ''}[${i}]`;
          input.onchange = () => {
            const values = Array.from(pair.querySelectorAll('input')).map(e => Number(e.value));
            const previous = config.params[key];
            const zones = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous as Record<string, unknown> : {};
            if (values.every(Number.isFinite)) config.params[key] = zoned ? { ...zones, [config.zone]: values } : values;
          }; pair.append(input);
        }); label.append(pair);
      } else {
        const input = document.createElement('input'); input.type = typeof value === 'boolean' ? 'checkbox' : 'number'; input.step = 'any';
        if (typeof value === 'boolean') input.checked = value; else input.value = String(value);
        input.onchange = () => { config.params[key] = input.type === 'checkbox' ? input.checked : Number(input.value); }; label.append(input);
      }
      fields.append(label);
    }
  }
  const rendering = document.createElement('details'); rendering.className = 'advanced';
  rendering.innerHTML = `<summary>Rendu · quartiers et parcelles</summary><div class="control-group">${(['quarters', 'blocks', 'streets', 'parcels', 'gardens', 'places', 'fronts', 'axes'] as const).map((key, i) => `<label><input data-render="${key}" type="checkbox">${['Limites des quartiers', 'Îlots', 'Rues urbaines', 'Parcelles', 'Jardins', 'Places', 'Façades accessibles', 'Axes des parcelles'][i]}</label>`).join('')}<label>Palette<select data-render="palette"><option value="atlas">Atlas</option><option value="ink">Encre</option><option value="terrain">Terrain</option></select></label><label>Opacité<input data-render="opacity" type="number" min="0" max="1" step="0.05"></label><label>Épaisseur des traits (px)<input data-render="width" type="number" min="0" max="5" step="0.1"></label></div><small>Ces réglages redessinent les résultats conservés, sans appel de génération.</small>`;
  parcelPanel.querySelector('.stage-controls')!.append(rendering);
  for (const e of Array.from(rendering.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-render]'))) {
    const key = e.dataset.render as keyof Render;
    if (e instanceof HTMLInputElement && e.type === 'checkbox') e.checked = Boolean(render[key]); else e.value = String(render[key]);
    e.onchange = () => { (render as unknown as Record<string, unknown>)[key] = e instanceof HTMLInputElement && e.type === 'checkbox' ? e.checked : key === 'palette' ? e.value : Number(e.value); draw(); options.onChange(); };
  }
  let appliedLayout = clone(layoutConfig), appliedParcel = clone(parcelConfig), appliedQuarterSeed = quarterSeed, appliedParcelSeed = parcelSeed;
  function read(kind: Kind): void {
    const p = getPanel(kind), config = getConfig(kind);
    for (const c of Array.from(p.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-config]'))) {
      if (!c.checkValidity()) { c.reportValidity(); throw new Error('Corrigez les paramètres signalés.'); }
      (config as unknown as Record<string, unknown>)[c.dataset.config!] = c instanceof HTMLInputElement && c.type === 'number' ? Number(c.value) : c.value;
    }
    const json = q<HTMLTextAreaElement>(p, '[data-json]').value.trim();
    if (json) {
      const parsed: unknown = JSON.parse(json);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Les overrides doivent être un objet JSON.');
      for (const key of Object.keys(parsed)) if (!catalogue.fields[kind].includes(key)) throw new Error(`Paramètre inconnu à cette étape : ${key}`);
      for (const [key, value] of Object.entries(parsed)) {
        const previous = config.params[key];
        config.params[key] = value && typeof value === 'object' && !Array.isArray(value) && previous && typeof previous === 'object' && !Array.isArray(previous)
          ? { ...previous, ...value } : value;
      }
    }
    if (kind === 'quarters') { quarterSeed = q<HTMLInputElement>(p, '[data-seed]').value; appliedLayout = clone(layoutConfig); appliedQuarterSeed = quarterSeed; }
    else { parcelSeed = q<HTMLInputElement>(p, '[data-seed]').value; appliedParcel = clone(parcelConfig); appliedParcelSeed = parcelSeed; }
  }
  function status(kind: Kind, text: string, busy = false): void {
    const p = getPanel(kind); q(p, '[data-status]').textContent = text;
    q<HTMLButtonElement>(p, '[data-apply]').setAttribute('aria-busy', String(busy));
  }
  function request(kind: Kind): void {
    clearTimeout(timer);
    if (!ready || !options.getTerrain() || !settlements) return;
    if (kind === 'quarters' && !enabled || kind === 'parcels' && !parcelEnabled) return;
    if (kind === 'parcels' && !layouts) { status(kind, 'Générez d’abord les quartiers (bloc 6).'); return; }
    if (!worker && !fallback) {
      try { worker = new UrbanWorker(); worker.onmessage = (e: MessageEvent<UrbanResponse>) => receive(e.data); worker.onerror = e => { e.preventDefault(); useFallback(); }; }
      catch { fallback = true; }
    }
    const t = options.getTerrain()!;
    const selected = settlements.settlements.filter(s => target === 'all' || s.key === target);
    const message: UrbanRequest = { id: ++id, kind, seed: kind === 'quarters' ? appliedQuarterSeed || options.getSeed() : appliedParcelSeed || options.getSeed() };
    if (cachedTerrain !== t) { message.raster = settlementRaster(t); cachedTerrain = t; }
    if (kind === 'quarters') {
      layouts = undefined; partitions = undefined; draw();
      message.layoutConfig = clone(appliedLayout); message.sites = selected.map(s => ({ key: s.key, population: s.population, culture: s.culture, center: s.center, radius: s.radius }));
      message.roads = roads?.segments.map(s => ({ path: s.path, widths: s.path.map(() => s.width), rank: s.class === 'highway' ? 0 : s.class === 'main' ? 1 : 2, role: 'regional' })) ?? [];
    } else { message.layouts = clone(layouts!); message.parcelConfig = clone(appliedParcel); partitions = undefined; draw(); }
    appliedKind = kind;
    status(kind, `Rust · génération ${kind === 'quarters' ? 'des quartiers' : 'des parcelles'}…`, true);
    if (fallback) void runUrbanRequest(message).then(receive, error => receive({ id: message.id, error: String(error) }));
    else try { const r = message.raster; worker!.postMessage(message, r ? [r.height.buffer, r.water.buffer, r.waterLevel.buffer, r.riverWidth.buffer, r.riverIds.buffer] : []); } catch { useFallback(); }
  }
  function useFallback(): void { worker?.terminate(); worker = undefined; fallback = true; cachedTerrain = undefined; request(appliedKind); }
  function receive(response: UrbanResponse): void {
    if (response.id !== id) return;
    if (response.error) { status(appliedKind, response.error); return; }
    if (response.layouts) {
      layouts = response.layouts; partitions = undefined;
      populate('parcels');
      const count = layouts.reduce((n, l) => n + l.blocks.length, 0);
      status('quarters', `Rust · ${layouts.length} settlement(s) · ${count} îlots · ${response.ms?.toFixed(0)} ms`);
      q(quarterPanel, '[data-state]').textContent = `${count} îlots`;
      q(quarterPanel, '[data-warnings]').textContent = layouts.flatMap(l => l.warnings.map(w => `${l.key} : ${w}`)).join('\n');
      if (parcelEnabled) request('parcels'); else status('parcels', 'Génération des parcelles désactivée.');
    }
    if (response.partitions) {
      partitions = response.partitions;
      const count = partitions.reduce((n, p) => n + p.parcels.length, 0);
      status('parcels', `Rust · ${count} parcelles · ${response.ms?.toFixed(0)} ms`);
      q(parcelPanel, '[data-state]').textContent = `${count} parcelles`;
      q(parcelPanel, '[data-warnings]').textContent = partitions.flatMap(p => p.warnings.map(w => `${p.key} : ${w}`)).join('\n');
    }
    draw(); options.onChange();
  }
  const palette = ['#dfb973', '#90bdc7', '#c5a3ce', '#a0bc84', '#d29c8e', '#bdc4d5'];
  function draw(): void {
    let layer = options.map.querySelector<SVGGElement>('#urbanOverlay');
    if (!layer) { layer = document.createElementNS(ns, 'g'); layer.id = 'urbanOverlay'; layer.style.pointerEvents = 'none'; options.map.insertBefore(layer, options.map.querySelector('#roadOverlay, #settlementOverlay')); }
    const state = JSON.stringify({ enabled, parcelEnabled, render });
    if (layer === drawnLayer && layouts === drawnLayouts && partitions === drawnPartitions && state === drawnState) return;
    drawnLayer = layer; drawnLayouts = layouts; drawnPartitions = partitions; drawnState = state; layer.replaceChildren();
    if (!enabled || !layouts) return;
    layer.setAttribute('opacity', String(render.opacity));
    const add = (d: string, fill: string, stroke: string, width: number, scalable = false): SVGPathElement => {
      const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); p.setAttribute('fill', fill); p.setAttribute('stroke', stroke); p.setAttribute('stroke-width', String(width)); p.setAttribute('fill-rule', 'evenodd');
      if (!scalable) p.setAttribute('vector-effect', 'non-scaling-stroke'); p.setAttribute('stroke-linejoin', 'round'); layer!.append(p); return p;
    };
    const stroke = render.palette === 'ink' ? '#3c3024' : '#655847';
    for (const l of layouts) {
      if (render.quarters) for (const [i, quarter] of l.quarters.entries()) add(shapePath(quarter.shape), 'none', palette[i % palette.length], render.width * 2).setAttribute('stroke-dasharray', '4 3');
      if (render.blocks) for (const block of l.blocks) add(shapePath(block.shape), render.palette === 'terrain' ? 'none' : render.palette === 'ink' ? '#e3d1b5' : palette[block.quarter % palette.length], stroke, render.width);
      const partition = parcelEnabled ? partitions?.find(p => p.key === l.key) : undefined;
      for (const [i, parcel] of (partition?.parcels ?? []).entries()) {
        if ((['plot', 'compound'].includes(parcel.use) && render.parcels) || (parcel.use === 'garden' && render.gardens) || (['place', 'market'].includes(parcel.use) && render.places)) {
          const fill = render.palette === 'terrain' ? 'none' : render.palette === 'ink' ? '#eee0c9' : parcel.use === 'garden' ? '#a8bc89' : parcel.use === 'place' ? '#e6d1a5' : palette[i % palette.length];
          add(shapePath(parcel.shape), fill, stroke, render.width);
        }
        if (render.fronts && parcel.front) add(path(parcel.front), 'none', '#a92d34', render.width * 2);
        if (render.axes && parcel.shape.outer.length) {
          const vertices = parcel.shape.outer, center = vertices.reduce((c, p) => ({ x: c.x + p.x / vertices.length, y: c.y + p.y / vertices.length }), { x: 0, y: 0 });
          add(path([{ x: center.x - parcel.axis.x * 4, y: center.y - parcel.axis.y * 4 }, { x: center.x + parcel.axis.x * 4, y: center.y + parcel.axis.y * 4 }]), 'none', '#396781', render.width);
        }
      }
      if (render.streets) for (const street of l.streets) {
        // Rust widths are physical metres, independent of the screen-space diagnostic outlines.
        for (let i = 1; i < street.path.length; i++) add(path([street.path[i - 1], street.path[i]]), 'none', render.palette === 'ink' ? '#6b5640' : '#f3dfb3', ((street.widths[i - 1] ?? 3) + (street.widths[i] ?? street.widths[i - 1] ?? 3)) / 2, true);
      }
    }
  }
  function schedule(): void { clearTimeout(timer); timer = setTimeout(() => request('quarters'), 120); }
  for (const kind of ['quarters', 'parcels'] as const) {
    const p = getPanel(kind);
    q<HTMLButtonElement>(p, '[data-apply]').onclick = () => { try { read(kind); populate(kind); options.onChange(); request(kind); } catch (e) { status(kind, String(e)); } };
    q<HTMLInputElement>(p, '[data-enabled]').onchange = e => {
      const checked = (e.target as HTMLInputElement).checked;
      if (kind === 'quarters') {
        ++id; enabled = checked;
        if (!enabled) { layouts = undefined; partitions = undefined; status('quarters', 'Génération des quartiers désactivée.'); status('parcels', 'En attente des quartiers…'); }
        else schedule();
      } else {
        if (appliedKind === 'parcels') ++id;
        parcelEnabled = checked; partitions = undefined;
        if (checked) { if (layouts) request('parcels'); else if (enabled) schedule(); }
        else status('parcels', 'Génération des parcelles désactivée.');
      }
      draw(); options.onChange();
    };
    for (const c of Array.from(p.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-config]'))) c.onchange = () => {
      (getConfig(kind) as unknown as Record<string, unknown>)[c.dataset.config!] = c instanceof HTMLInputElement && c.type === 'number' ? Number(c.value) : c.value;
      if (c.dataset.config === 'zone') populate(kind);
    };
    q<HTMLInputElement>(p, '[data-seed]').oninput = e => {
      if (kind === 'quarters') quarterSeed = (e.target as HTMLInputElement).value;
      else parcelSeed = (e.target as HTMLInputElement).value;
    };
    for (const c of Array.from(p.querySelectorAll<HTMLSelectElement>('[data-config="culture"], [data-config="preset"], [data-config="recipe"]'))) c.onchange = () => {
      const config = getConfig(kind); (config as unknown as Record<string, unknown>)[c.dataset.config!] = c.value;
      if (c.dataset.config === 'culture') config.recipe = 'core';
      if (c.dataset.config === 'recipe') config.zone = catalogue.cultures[config.culture && config.culture !== 'site' ? config.culture : siteCulture(kind)]?.recipes.find(r => r.id === config.recipe)?.zone ?? config.zone;
      populate(kind);
    };
    q<HTMLButtonElement>(p, '[data-reset]').onclick = () => { getConfig(kind).params = {}; q<HTMLTextAreaElement>(p, '[data-json]').value = ''; populate(kind); };
  }
  targetSelect.onchange = () => { target = targetSelect.value; ++id; layouts = undefined; partitions = undefined; populate('quarters'); populate('parcels'); draw(); schedule(); options.onChange(); };
  q<HTMLButtonElement>(quarterPanel, '#urbanFocus').onclick = () => {
    const selection = settlements?.settlements.filter(s => target === 'all' || s.key === target) ?? [];
    if (!selection.length || !options.onFocus) return;
    const minX = Math.min(...selection.map(s => s.center.x - s.radius)), maxX = Math.max(...selection.map(s => s.center.x + s.radius)), minY = Math.min(...selection.map(s => s.center.y - s.radius)), maxY = Math.max(...selection.map(s => s.center.y + s.radius));
    options.onFocus({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, Math.max(maxX - minX, maxY - minY) / 2);
  };
  populate('quarters'); populate('parcels');
  return {
    setSettlements(output?: SettlementOutput, roadOutput?: RoadOutput): void {
      if (settlements === output && roads === roadOutput && ready) return;
      ++id; settlements = output; roads = roadOutput; ready = !!output;
      layouts = undefined; partitions = undefined;
      const sorted = output?.settlements.slice().sort((a, b) => b.population - a.population || a.key.localeCompare(b.key)) ?? [];
      if (target !== 'all' && !sorted.some(s => s.key === target)) target = sorted[0]?.key ?? '';
      targetSelect.replaceChildren(new Option('All · tous les settlements', 'all'), ...sorted.map(s => new Option(`${s.name || s.key} · ${s.population.toLocaleString()} hab. · ${Math.round(s.radius)} m`, s.key)));
      targetSelect.value = target; targetSelect.disabled = !sorted.length;
      populate('quarters'); populate('parcels'); draw();
      if (ready && sorted.length && enabled) schedule(); else { status('quarters', 'En attente des settlements…'); status('parcels', 'En attente des quartiers…'); }
    },
    terrainPending(): void { ++id; ready = false; clearTimeout(timer); layouts = undefined; partitions = undefined; cachedTerrain = undefined; draw(); status('quarters', 'En attente du terrain et des settlements…'); status('parcels', 'En attente des quartiers…'); },
    updateView: draw,
    share(params: URLSearchParams): void { params.set('urban', JSON.stringify({ enabled, parcelEnabled, target, quarterSeed: appliedQuarterSeed, parcelSeed: appliedParcelSeed, layoutConfig: appliedLayout, parcelConfig: appliedParcel, render })); },
  };
}
