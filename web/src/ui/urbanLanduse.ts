import LanduseWorker from './urbanLanduseWorker?worker&inline';
import { BIOME_NAMES, type BiomeName } from '../gen/biomes';
import { SIZE_PRESETS } from '../gen/options';
import { createCanvasRenderer, type CanvasRenderer } from '../render/canvas';
import type { VegetationStyle } from '../render/canopy';
import type { View } from '../render/view';
import type { Scene } from '../render/scene';
import type { World } from '../gen/types';
import { biomePalette } from '../render/biomes';
import { STYLE_LIST, isMapStyle, type MapStyle } from '../render/styles';
import { decodeBrushes, type BrushImages } from '../render/brushes';
import { BRUSH_SOURCES } from '../render/assets/brushAssets';
import { generateUrbanLanduse, urbanLanduseRenderWorld, type UrbanLanduseInput, type UrbanLanduseResponse, type UrbanLanduseScene } from './urbanLanduseData';

type Context = Omit<UrbanLanduseInput, 'biome'>;
interface Settings { seed: string; biome: BiomeName; style: MapStyle; vegetation: VegetationStyle; painted: boolean; opacity: number; visible: boolean }
const biomeLabels = ['Campagne tempérée', 'Forêt', 'Désert et oasis', 'Steppe', 'Forêt tropicale', 'Toundra', 'Outreterre', 'Cavernes'];

export function createUrbanLanduse(options: { map: SVGSVGElement; before: Element; onChange(): void;
  getView(): { view: View; width: number; height: number };
  getBackground(): { image?: HTMLCanvasElement; opacity: number };
}) {
  const settings: Settings = { seed: '', biome: 'temperate', style: 'parchment', vegetation: 'canopy', painted: false, opacity: 1, visible: true };
  try {
    const saved = JSON.parse(new URLSearchParams(location.search).get('landuse') ?? 'null');
    if (saved) {
      if (typeof saved.seed === 'string') settings.seed = saved.seed;
      if (BIOME_NAMES.includes(saved.biome)) settings.biome = saved.biome;
      if (isMapStyle(saved.style)) settings.style = saved.style;
      if (saved.vegetation === 'classic' || saved.vegetation === 'canopy') settings.vegetation = saved.vegetation;
      if (typeof saved.painted === 'boolean') settings.painted = saved.painted;
      if (typeof saved.visible === 'boolean') settings.visible = saved.visible;
      if (Number.isFinite(saved.opacity)) settings.opacity = Math.max(0, Math.min(1, saved.opacity));
    }
  } catch { /* Broken optional settings retain the defaults. */ }
  const panel = document.createElement('details'); panel.className = 'stage'; panel.id = 'landuseStage'; panel.open = true;
  panel.innerHTML = `<summary>8 · Occupation du territoire <span id="landuseState"></span></summary><div class="stage-controls">
    <label>Graine des paysages<input id="landuseSeed" type="text" placeholder="Graine du décor"></label>
    <label>Biome<select id="landuseBiome"></select></label>
    <button id="landuseGenerate" type="button">Générer l’occupation du territoire</button>
    <details class="advanced" open><summary>Affichage</summary>
      <label>Style<select id="landuseStyle"></select></label>
      <label>Végétation<select id="landuseVegetation"><option value="canopy">Feuillages et canopée</option><option value="classic">Symboles classiques</option></select></label>
      <label><input id="landusePainted" type="checkbox">Textures peintes</label>
      <label>Opacité<input id="landuseOpacity" type="range" min="0" max="1" step="0.05"></label>
    </details>
    <small>Champs, sillons, haies, chemins agricoles, vergers, jardins et végétation. Les quartiers réservent leur emprise avant l’ajout des maisons.</small>
    <small id="landuseStatus" role="status">En attente du décor…</small></div>`;
  options.before.parentElement!.insertBefore(panel, options.before);
  const q = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const seed = q<HTMLInputElement>('landuseSeed'), biome = q<HTMLSelectElement>('landuseBiome');
  const style = q<HTMLSelectElement>('landuseStyle'), painted = q<HTMLInputElement>('landusePainted');
  const vegetation = q<HTMLSelectElement>('landuseVegetation');
  const opacity = q<HTMLInputElement>('landuseOpacity'), visible = q<HTMLInputElement>('showLanduse');
  const button = q<HTMLButtonElement>('landuseGenerate'), status = q<HTMLElement>('landuseStatus');
  const layer = options.map.querySelector<SVGGElement>('#landuseLayer')!;
  biome.replaceChildren(...BIOME_NAMES.map((id, i) => new Option(biomeLabels[i], id)));
  style.replaceChildren(...STYLE_LIST.map(s => new Option(s.label, s.id)));
  seed.value = settings.seed; biome.value = settings.biome; style.value = settings.style;
  painted.checked = settings.painted; opacity.value = String(settings.opacity); visible.checked = settings.visible;
  vegetation.value = settings.vegetation; vegetation.disabled = settings.painted;
  let context: Context | undefined, waiting = false, scene: UrbanLanduseScene | undefined;
  let worker: Worker | undefined, fallback = false, id = 0, timer: ReturnType<typeof setTimeout> | undefined;
  let previous: Context | undefined, previousKey = '', previousWaiting = false;
  let renderer: CanvasRenderer | undefined, renderWorld: World | undefined, renderScene: Scene | undefined;
  let canvas: HTMLCanvasElement | undefined, host: SVGForeignObjectElement | undefined, frame = 0, rendererDpr = 1;
  let brushImages: BrushImages | undefined, brushPromise: Promise<void> | undefined;

  function state(text: string, busy = false): void {
    status.textContent = text; button.setAttribute('aria-busy', String(busy));
  }
  function visibility(): void {
    layer.style.display = settings.visible ? '' : 'none'; layer.setAttribute('opacity', String(settings.opacity));
  }
  function draw(): void {
    visibility();
    renderer?.dispose(); renderer = undefined; cancelAnimationFrame(frame);
    if (!scene || !context) { layer.replaceChildren(); canvas = undefined; host = undefined; renderWorld = undefined; renderScene = undefined; return; }
    if (!canvas) {
      layer.innerHTML = `<defs><clipPath id="urban-landuse-clip"><rect width="${scene.mapSize}" height="${scene.mapSize}"/></clipPath></defs><g clip-path="url(#urban-landuse-clip)"><foreignObject/></g>`;
      host = layer.querySelector('foreignObject')!;
      canvas = document.createElement('canvas'); canvas.id = 'landuseCanvas'; canvas.style.display = 'block'; host.append(canvas);
    }
    renderWorld ??= urbanLanduseRenderWorld(scene, context.raster);
    const pal = { ...biomePalette(settings.style, scene.options.biome), frameKind: 'none' as const };
    const background = options.getBackground();
    rendererDpr = window.devicePixelRatio || 1;
    renderer = createCanvasRenderer(canvas, renderWorld, pal, {
      dpr: rendererDpr, scene: renderScene, vegetation: settings.vegetation, brushes: settings.painted ? brushImages : undefined,
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
    cancelAnimationFrame(frame);
    if (!renderer || !canvas || !host || !settings.visible) return;
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
    if ('error' in response) { state(`Occupation du territoire : ${response.error}`); return; }
    scene = response.scene; renderWorld = undefined; renderScene = undefined; draw();
    const stats = scene.stats;
    q('landuseState').textContent = `${stats.areas} zones`;
    state(`${stats.areas} zones · ${stats.fieldHa ?? 0} ha cultivés · ${stats.strips ?? 0} bandes · ${stats.ms} ms`);
  }
  function generate(): void {
    cancel();
    if (!context || waiting) return;
    const request = { id, input: { ...context, seed: settings.seed || context.seed, biome: settings.biome } };
    state('Génération des champs et de la végétation…', true);
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
  button.onclick = () => {
    settings.seed = seed.value.trim(); settings.biome = biome.value as BiomeName;
    options.onChange(); generate();
  };
  style.onchange = () => { settings.style = style.value as MapStyle; draw(); options.onChange(); };
  vegetation.onchange = () => { settings.vegetation = vegetation.value as VegetationStyle; draw(); options.onChange(); };
  painted.onchange = () => { settings.painted = painted.checked; vegetation.disabled = settings.painted; draw(); options.onChange(); };
  opacity.oninput = () => { settings.opacity = Number(opacity.value); visibility(); options.onChange(); };
  visible.onchange = () => { settings.visible = visible.checked; visibility(); updateView(); options.onChange(); };
  visibility();
  return {
    updateView,
    refreshBackground: draw,
    set(next?: Context, pending = false): void {
      context = next; waiting = pending; button.disabled = !next || pending;
      const key = next ? JSON.stringify({ seed: next.seed, city: next.city, neighbours: next.neighbours, relief: next.relief }) : '';
      if (next?.raster === previous?.raster && next?.layouts === previous?.layouts && next?.roads === previous?.roads && key === previousKey && pending === previousWaiting) return;
      previous = next; previousKey = key; previousWaiting = pending;
      cancel(); scene = undefined; draw(); q('landuseState').textContent = '';
      if (!next || pending) { state(next ? 'En attente des quartiers…' : 'En attente du décor…'); return; }
      state('Préparation des paysages…', true);
      timer = setTimeout(generate, 120);
    },
    share(params: URLSearchParams): void { params.set('landuse', JSON.stringify(settings)); },
  };
}
