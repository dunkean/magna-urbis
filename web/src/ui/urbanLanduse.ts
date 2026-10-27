import { bindGear, gearButton } from './mapGroup';
import { localizeCityInspector } from './cityInspectorLocale';
import { urbanText } from './urbanPanelLocale';
import { LOCALE_KEY } from './shellLocale';
import LanduseWorker from './urbanLanduseWorker?worker&inline';
import { BIOME_NAMES, type BiomeName } from '../gen/biomes';
import { SIZE_PRESETS } from '../gen/options';
import { createCanvasRenderer, type CanvasRenderer } from '../render/canvas';
import type { VegetationStyle } from '../render/canopy';
import type { View } from '../render/view';
import type { Scene } from '../render/scene';
import type { World, LandKind } from '../gen/types';
import { fantasyLanduseSample } from './fantasyLanduse';
import { biomePalette } from '../render/biomes';
import { STYLE_LIST, isMapStyle, type MapStyle } from '../render/styles';
import { decodeBrushes, type BrushImages } from '../render/brushes';
import { BRUSH_SOURCES } from '../render/assets/brushAssets';
import { generateUrbanLanduse, urbanLanduseRenderWorld, type UrbanLanduseInput, type UrbanLanduseResponse, type UrbanLanduseScene } from './urbanLanduseData';

type Context = Omit<UrbanLanduseInput, 'biome'>;
interface Settings { seed: string; biome: BiomeName; style: MapStyle; vegetation: VegetationStyle; painted: boolean; opacity: number; visible: boolean; enabled: boolean; hiddenKinds: LandKind[]; showFarms: boolean }
const biomeLabels = ['Campagne tempérée', 'Forêt', 'Désert et oasis', 'Steppe', 'Forêt tropicale', 'Toundra', 'Outreterre', 'Cavernes'];
const landKinds: [LandKind, string][] = [['forest', 'Forêts'], ['orchard', 'Vergers'], ['field', 'Champs et sillons'], ['garden', 'Jardins'], ['meadow', 'Prairies'], ['pasture', 'Pâturages'], ['marsh', 'Marais'], ['commons', 'Terrains communaux']];

export function createUrbanLanduse(options: { map: SVGSVGElement; before: Element; onChange(): void; onPlanChange?(): void;
  getView(): { view: View; width: number; height: number };
  getBackground(): { image?: HTMLCanvasElement; opacity: number };
  /** Render3D forest owns woodland: hide the cartoon forest fill and canopy, keep farmland. */
  forestMaterial?(): boolean;
  /** The displayed scene; `applied` is false for the city-less natural cover. */
  onScene?(scene: UrbanLanduseScene | undefined, applied: boolean): void;
}) {
  /** `enabled` is the « auto » switch, off by default; `manual` keeps a scene made once by the Générer button. */
  let manual = false;
  const settings: Settings = { seed: '', biome: 'temperate', style: 'parchment', vegetation: 'canopy', painted: false, opacity: 1, visible: true, enabled: false, hiddenKinds: [], showFarms: true };
  try {
    const saved = JSON.parse(new URLSearchParams(location.search).get('landuse') ?? 'null');
    if (saved) {
      if (typeof saved.seed === 'string') settings.seed = saved.seed;
      if (BIOME_NAMES.includes(saved.biome)) settings.biome = saved.biome;
      if (isMapStyle(saved.style)) settings.style = saved.style;
      if (saved.vegetation === 'classic' || saved.vegetation === 'canopy') settings.vegetation = saved.vegetation;
      if (typeof saved.painted === 'boolean') settings.painted = saved.painted;
      if (typeof saved.visible === 'boolean') settings.visible = saved.visible;
      if (typeof saved.enabled === 'boolean') settings.enabled = saved.enabled;
      if (Array.isArray(saved.hiddenKinds)) settings.hiddenKinds = landKinds.map(([kind]) => kind).filter(kind => saved.hiddenKinds.includes(kind));
      if (typeof saved.showFarms === 'boolean') settings.showFarms = saved.showFarms;
      if (Number.isFinite(saved.opacity)) settings.opacity = Math.max(0, Math.min(1, saved.opacity));
    }
  } catch { /* Broken optional settings retain the defaults. */ }
  const panel = document.createElement('details'); panel.className = 'stage map-group'; panel.id = 'landuseStage'; panel.open = true;
  panel.innerHTML = `<summary>Occupation des sols</summary><div class="stage-controls" data-map-body>
    <div class="map-line"><span class="map-icon" role="img" aria-label="Occupation des sols" title="Occupation des sols">🌾</span>
      <label class="map-field map-grow" title="Génère l’occupation du territoire à chaque changement du plan. Décoché : rien n’est généré tant que vous ne cliquez pas sur Générer."><input id="landuseEnabled" type="checkbox">auto</label>
      <span id="landuseState" class="map-summary"></span>${gearButton()}</div>
    <small id="landuseStatus" class="map-status" role="status">En attente du décor…</small>
    <div class="map-detail" hidden>
    <button id="landuseGenerate" type="button">Générer l’occupation du territoire</button>
    <label title="Affiche ou masque la couche d’occupation du territoire sur la carte"><input id="showLanduse" type="checkbox" checked>Occupation du territoire visible</label>
    <label>Graine des paysages<input id="landuseSeed" type="text" placeholder="Graine du décor"></label>
    <label>Biome<select id="landuseBiome"></select></label>
    <details class="advanced"><summary>Affichage</summary>
      <label hidden><input id="landuseVisible" type="checkbox">Afficher tous les objets d’occupation</label>
      <label>Style<select id="landuseStyle"></select></label>
      <label>Végétation<select id="landuseVegetation"><option value="canopy">Feuillages et canopée</option><option value="classic">Symboles classiques</option></select></label>
      <label><input id="landusePainted" type="checkbox">Textures peintes</label>
      <label>Opacité de tous les objets<input id="landuseOpacity" type="range" min="0" max="1" step="0.05"></label>
      <details><summary>Visibilité par type d’objet</summary>
        ${landKinds.map(([kind, label]) => `<label><input type="checkbox" data-land-kind="${kind}">${label}</label>`).join('')}
        <label><input id="landuseFarms" type="checkbox">Fermes et dépendances</label>
      </details>
      <small>Ces réglages masquent le dessin uniquement. Les brushes peuvent continuer à suivre les zones générées.</small>
    </details>
    <small>Champs, sillons, haies, chemins agricoles, vergers, jardins et végétation. Les quartiers réservent leur emprise avant l’ajout des maisons.</small>
    </div></div>`;
  bindGear(panel);
  localizeCityInspector(panel);
  options.before.parentElement!.insertBefore(panel, options.before);
  const q = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const seed = q<HTMLInputElement>('landuseSeed'), biome = q<HTMLSelectElement>('landuseBiome');
  const style = q<HTMLSelectElement>('landuseStyle'), painted = q<HTMLInputElement>('landusePainted');
  const vegetation = q<HTMLSelectElement>('landuseVegetation');
  const opacity = q<HTMLInputElement>('landuseOpacity'), visible = q<HTMLInputElement>('showLanduse');
  const panelVisible = q<HTMLInputElement>('landuseVisible'), farms = q<HTMLInputElement>('landuseFarms');
  const enabled = q<HTMLInputElement>('landuseEnabled');
  const button = q<HTMLButtonElement>('landuseGenerate'), status = q<HTMLElement>('landuseStatus');
  let layer = options.map.querySelector<SVGGElement>('#landuseLayer');
  if (!layer) { layer = document.createElementNS('http://www.w3.org/2000/svg', 'g'); layer.id = 'landuseLayer'; }
  const landuseLayer = layer;
  landuseLayer.style.pointerEvents = 'none';
  biome.replaceChildren(...BIOME_NAMES.map((id, i) => new Option(biomeLabels[i], id)));
  style.replaceChildren(...STYLE_LIST.map(s => new Option(s.label, s.id)));
  seed.value = settings.seed; biome.value = settings.biome; style.value = settings.style;
  painted.checked = settings.painted; opacity.value = String(settings.opacity); visible.checked = settings.visible;
  enabled.checked = settings.enabled;
  panelVisible.checked = settings.visible; farms.checked = settings.showFarms;
  for (const box of Array.from(panel.querySelectorAll<HTMLInputElement>('[data-land-kind]'))) {
    box.checked = !settings.hiddenKinds.includes(box.dataset.landKind as LandKind);
    box.onchange = () => {
      settings.hiddenKinds = Array.from(panel.querySelectorAll<HTMLInputElement>('[data-land-kind]')).filter(b => !b.checked).map(b => b.dataset.landKind as LandKind);
      renderWorld = undefined; renderScene = undefined; draw(); options.onChange();
    };
  }
  vegetation.value = settings.vegetation; vegetation.disabled = settings.painted;
  const active = (): boolean => settings.enabled || manual;
  let context: Context | undefined, waiting = false, scene: UrbanLanduseScene | undefined;
  let sample: ReturnType<typeof fantasyLanduseSample> | undefined;
  let worker: Worker | undefined, fallback = false, id = 0, timer: ReturnType<typeof setTimeout> | undefined;
  let previous: Context | undefined, previousKey = '', previousWaiting = false;
  let applied = false, requested = false, withoutForest = false;
  let renderer: CanvasRenderer | undefined, renderWorld: World | undefined, renderScene: Scene | undefined;
  let canvas: HTMLCanvasElement | undefined, host: SVGForeignObjectElement | undefined, frame = 0, rendererDpr = 1;
  let brushImages: BrushImages | undefined, brushPromise: Promise<void> | undefined;

  function state(text: string, busy = false): void {
    status.textContent = text; button.setAttribute('aria-busy', String(busy));
  }
  function summary(stats: UrbanLanduseScene['stats']): string {
    return `${stats.areas} ${urbanText(['zones','zones','个区域','zonas','zonas'])} · ${stats.fieldHa ?? 0} ${urbanText(['ha cultivés','ha cultivated','公顷耕地','ha cultivadas','ha cultivados'])} · ${stats.strips ?? 0} ${urbanText(['bandes','strips','条带','franjas','faixas'])} · ${stats.ms} ms`;
  }
  const refreshLocale = (): void => {
    const styles: Record<string, readonly [string,string,string,string,string]> = { parchment:['Parchemin','Parchment','羊皮纸','Pergamino','Pergaminho'], atlas:['Atlas','Atlas','图集','Atlas','Atlas'], watabou:['Simple (classique)','Plain (classic)','简洁（经典）','Sencillo (clásico)','Simples (clássico)'], engraving:['Gravure','Engraving','版画','Grabado','Gravura'], cadastre:['Cadastre 1:1250','Cadastre 1:1250','地籍图 1:1250','Catastro 1:1250','Cadastro 1:1250'], blueprint:['Plan bleu','Blueprint','蓝图','Plano azul','Planta azul'], illuminated:['Enluminé','Illuminated','手抄本','Iluminado','Iluminado'], topographic:['Topographique','Topographic','地形图','Topográfico','Topográfico'], night:['Nuit','Night','夜间','Noche','Noite'] };
    for (const option of Array.from(style.options)) if (styles[option.value]) option.textContent = urbanText(styles[option.value]);
    if (scene && active()) { q('landuseState').textContent = `${scene.stats.areas} ${urbanText(['zones','zones','个区域','zonas','zonas'])}`; if (button.getAttribute('aria-busy') !== 'true') status.textContent = summary(scene.stats); }
    else if (button.getAttribute('aria-busy') !== 'true' && !active()) status.textContent = urbanText(['Auto désactivé : ouvrez ⚙ et cliquez sur Générer.','Auto disabled: open ⚙ and click Generate.','自动模式已禁用：打开 ⚙ 并点击生成。','Auto desactivado: abre ⚙ y pulsa Generar.','Auto desativado: abra ⚙ e clique em Gerar.']);
    else if (button.getAttribute('aria-busy') !== 'true' && (!context || waiting)) status.textContent = context ? urbanText(['En attente des quartiers…','Waiting for districts…','等待街区…','Esperando los barrios…','Aguardando os bairros…']) : urbanText(['En attente du décor…','Waiting for the decor…','等待场景…','Esperando el decor…','Aguardando o decor…']);
  };
  window.addEventListener('magna-locale-change', refreshLocale);
  window.addEventListener('storage', event => { if (event.key === LOCALE_KEY) refreshLocale(); });
  refreshLocale();
  function visibility(): void {
    // Terrain redraws replace the SVG children. Restore this retained overlay
    // above the terrain painting and below water, streets and city markers.
    const anchor = options.map.querySelector('#hydrologyOverlay, #urbanOverlay, #roadOverlay, #settlementOverlay');
    if (landuseLayer.parentNode !== options.map || landuseLayer.nextSibling !== anchor) options.map.insertBefore(landuseLayer, anchor);
    const painting = options.map.querySelector('#fantasyPainting');
    // The painting is lazily appended by the terrain renderer.
    if (painting && painting.nextSibling !== landuseLayer) options.map.insertBefore(painting, landuseLayer);
    landuseLayer.style.display = active() && settings.visible ? '' : 'none'; landuseLayer.setAttribute('opacity', String(settings.opacity));
  }
  function draw(): void {
    visibility();
    renderer?.dispose(); renderer = undefined; cancelAnimationFrame(frame);
    if (!active() || !scene || !context) { landuseLayer.replaceChildren(); canvas = undefined; host = undefined; renderWorld = undefined; renderScene = undefined; return; }
    if (!canvas) {
      landuseLayer.innerHTML = `<defs><clipPath id="urban-landuse-clip"><rect width="${scene.mapSize}" height="${scene.mapSize}"/></clipPath></defs><g clip-path="url(#urban-landuse-clip)"><foreignObject/></g>`;
      host = landuseLayer.querySelector('foreignObject')!;
      canvas = document.createElement('canvas'); canvas.id = 'landuseCanvas'; canvas.style.display = 'block'; host.append(canvas);
    }
    if (withoutForest !== !!options.forestMaterial?.()) { withoutForest = !withoutForest; renderWorld = undefined; renderScene = undefined; }
    renderWorld ??= urbanLanduseRenderWorld({ ...scene, landuse: scene.landuse && { ...scene.landuse,
      areas: scene.landuse.areas.filter(a => !settings.hiddenKinds.includes(a.kind) && !(withoutForest && a.kind === 'forest')),
      farmsteads: settings.showFarms ? scene.landuse.farmsteads : [] } }, context.raster);
    const pal = { ...biomePalette(settings.style, scene.options.biome), frameKind: 'none' as const };
    const background = options.getBackground();
    rendererDpr = window.devicePixelRatio || 1;
    renderer = createCanvasRenderer(canvas, renderWorld, pal, {
      dpr: rendererDpr, scene: renderScene, transparentBackground: true, raster: false,
      vegetation: settings.vegetation, brushes: settings.painted ? brushImages : undefined,
      furrowReferenceSize: SIZE_PRESETS[scene.options.size].mapSize,
      terrain: () => {
        if (!background.image || background.opacity <= 0) return null;
        if (background.opacity === 1) return background.image;
        const base = document.createElement('canvas'); base.width = background.image.width; base.height = background.image.height;
        const ctx = base.getContext('2d')!; ctx.fillStyle = pal.paper; ctx.fillRect(0, 0, base.width, base.height);
        ctx.globalAlpha = background.opacity; ctx.drawImage(background.image, 0, 0); return base;
      },
    });
    renderScene = renderer.scene; renderer.setOverlays({ labels: false, legend: false, cartouche: false });
    updateView();
    if (settings.painted && !brushPromise) brushPromise = decodeBrushes(BRUSH_SOURCES).then(images => {
      brushImages = images ?? undefined; if (settings.painted && brushImages) draw();
    });
  }
  function updateView(): void {
    visibility();
    cancelAnimationFrame(frame);
    if (!renderer || !canvas || !host || !active() || !settings.visible) return;
    if (rendererDpr !== (window.devicePixelRatio || 1)) { draw(); return; }
    const { view, width, height } = options.getView(), w = width / view.scale, h = height / view.scale;
    host.setAttribute('x', String(view.cx - w / 2)); host.setAttribute('y', String(view.cy - h / 2));
    host.setAttribute('width', String(w)); host.setAttribute('height', String(h));
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    const cw = Math.max(1, Math.round(width * rendererDpr)), ch = Math.max(1, Math.round(height * rendererDpr));
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    frame = requestAnimationFrame(() => { renderer?.draw(view); });
  }
  function cancel(): void {
    ++id; clearTimeout(timer); worker?.terminate(); worker = undefined;
  }
  function receive(response: UrbanLanduseResponse): void {
    if (response.id !== id) return;
    worker?.terminate(); worker = undefined;
    if ('error' in response) { state(`${urbanText(['Occupation du territoire','Land use','土地利用','Uso del territorio','Uso do território'])} : ${response.error}`); return; }
    scene = response.scene; applied = requested; renderWorld = undefined; renderScene = undefined; draw(); notify();
    const stats = scene.stats;
    q('landuseState').textContent = `${stats.areas} ${urbanText(['zones','zones','个区域','zonas','zonas'])}`;
    state(summary(stats));
  }
  function generate(): void {
    cancel();
    if (!active() || !context || waiting) return;
    scene = undefined;
    notify(); draw();
    const request = { id, input: { ...context, seed: settings.seed || context.seed, biome: settings.biome } };
    requested = !!request.input.city;
    state(urbanText(['Génération des champs et de la végétation…','Generating fields and vegetation…','正在生成田地和植被…','Generando campos y vegetación…','Gerando campos e vegetação…']), true);
    const runFallback = (): void => {
      worker?.terminate(); worker = undefined; fallback = true;
      // Give the browser a frame to display the busy state, including file:// without workers.
      timer = setTimeout(() => {
        if (request.id !== id) return;
        try { receive({ id: request.id, scene: generateUrbanLanduse(request.input) }); }
        catch (error) { receive({ id: request.id, error: String(error) }); }
      }, 0);
    };
    if (fallback) { runFallback(); return; }
    try {
      worker = new LanduseWorker(); worker.onmessage = (event: MessageEvent<UrbanLanduseResponse>) => receive(event.data);
      worker.onerror = event => { event.preventDefault(); if (request.id === id) runFallback(); };
      // Structured cloning keeps the decor's retained buffers available to the other stages.
      worker.postMessage(request);
    } catch { runFallback(); }
  }
  function schedule(): void {
    button.disabled = !context || waiting;
    visible.disabled = !active();
    panelVisible.disabled = !active();
    if (!active()) { q('landuseState').textContent = ''; state(urbanText(['Auto désactivé : ouvrez ⚙ et cliquez sur Générer.','Auto disabled: open ⚙ and click Generate.','自动模式已禁用：打开 ⚙ 并点击生成。','Auto desactivado: abre ⚙ y pulsa Generar.','Auto desativado: abra ⚙ e clique em Gerar.'])); return; }
    q('landuseState').textContent = scene ? `${scene.stats.areas} ${urbanText(['zones','zones','个区域','zonas','zonas'])}` : '';
    if (!context || waiting) { state(context ? urbanText(['En attente des quartiers…','Waiting for districts…','等待街区…','Esperando los barrios…','Aguardando os bairros…']) : urbanText(['En attente du décor…','Waiting for the decor…','等待场景…','Esperando el decor…','Aguardando o decor…'])); return; }
    if (scene) {
      q('landuseState').textContent = `${scene.stats.areas} ${urbanText(['zones','zones','个区域','zonas','zonas'])}`;
      state(summary(scene.stats));
      return;
    }
    q('landuseState').textContent = '';
    state(urbanText(['Préparation des paysages…','Preparing landscapes…','正在准备景观…','Preparando paisajes…','Preparando paisagens…']), true);
    timer = setTimeout(generate, 120);
  }
  function notify(): void {
    sample = active() && scene?.landuse ? fantasyLanduseSample(scene.landuse, scene.mapSize) : undefined;
    options.onPlanChange?.();
    options.onScene?.(active() ? scene : undefined, applied);
  }
  enabled.onchange = () => {
    settings.enabled = enabled.checked; if (settings.enabled) manual = false; cancel(); draw(); notify(); schedule(); options.onChange();
  };
  button.onclick = () => {
    settings.seed = seed.value.trim(); settings.biome = biome.value as BiomeName;
    manual = true; options.onChange(); generate();
  };
  style.onchange = () => { settings.style = style.value as MapStyle; draw(); options.onChange(); };
  vegetation.onchange = () => { settings.vegetation = vegetation.value as VegetationStyle; draw(); options.onChange(); };
  painted.onchange = () => { settings.painted = painted.checked; vegetation.disabled = settings.painted; draw(); options.onChange(); };
  opacity.oninput = () => { settings.opacity = Number(opacity.value); visibility(); options.onChange(); };
  const setVisible = (value: boolean): void => { settings.visible = value; visible.checked = value; panelVisible.checked = value; visibility(); updateView(); options.onChange(); };
  visible.onchange = () => setVisible(visible.checked);
  panelVisible.onchange = () => setVisible(panelVisible.checked);
  farms.onchange = () => { settings.showFarms = farms.checked; renderWorld = undefined; renderScene = undefined; draw(); options.onChange(); };
  visibility(); schedule();
  return {
    get sample() { return sample; },
    updateView,
    refreshBackground: draw,
    /** Re-evaluate the Render3D forest suppression after a style or forest change. */
    refreshForest(): void { if (withoutForest !== !!options.forestMaterial?.()) draw(); },
    set(next?: Context, pending = false): void {
      context = next; waiting = pending;
      const key = next ? JSON.stringify({ seed: next.seed, city: next.city, neighbours: next.neighbours, relief: next.relief,
        forest: next.forest?.key ?? (next.forest && { seed: next.forest.input?.seed,
          climate: next.forest.input?.climate, settings: next.forest.settings }) }) : '';
      if (next?.raster === previous?.raster && next?.layouts === previous?.layouts && next?.roads === previous?.roads && key === previousKey && pending === previousWaiting) return;
      const samePlan = next?.raster === previous?.raster && next?.layouts === previous?.layouts && next?.roads === previous?.roads;
      previous = next; previousKey = key; previousWaiting = pending;
      cancel(); manual = manual && samePlan; scene = undefined; draw(); notify(); q('landuseState').textContent = '';
      schedule();
    },
    share(params: URLSearchParams): void { params.set('landuse', JSON.stringify(settings)); },
  };
}
