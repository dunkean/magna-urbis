/** FMG displays a real V2 town with a compact plan and optional studio looks. */
import CityWorker from './cityEmbed.worker?worker';
import { cityEmbedEditorUrl, cityEmbedHints, cityEmbedSource, cityEmbedView } from './cityEmbedInput';
import { compactPreviewKey, readCompactPreview, saveCompactPreview, readCityView, saveCityView, readCityWorld, saveCityWorld, type SavedCityView } from './cityEmbedCache';
import { mountCityEmbedPopulation, randomCityEmbedUrl } from './cityEmbedDemo';
import { mountCityEmbedNavigation } from './cityEmbedNavigation';
import { mountCityEmbedOverlay } from './cityEmbedOverlay';
import { MinimalCanvasRenderer } from './minimalCanvas';
import { cityEmbedText, localizeCityEmbed, cityEmbedSummary, embedLocale, loadEmbedLocale } from './cityEmbedMessages';
import { cityEmbedStartsWithBlocks, unpackMinimalFeatures, type CityDetailStyle, type CityPreviewResult, type DetailedCityResult, type CityPreviewMode, type CityPreviewResponse, type CityPreviewRequest } from './cityPreviewMap';
import type { Rect4 } from '../render/view';

const current = new URL(location.href);
if (window.parent === window && !current.hash && [...current.searchParams.keys()].every(key => key === 'lang')) {
  for (const [key, value] of Object.entries({ preview: '1', name: 'Brackenford', seed: '12340007', population: '2500', coast: '0', river: '0', walls: '1' })) current.searchParams.set(key, value);
  history.replaceState(null, '', current);
}
let hostLanguage = '';
if (window.parent !== window) {
  try { hostLanguage = window.parent.document.documentElement.lang; } catch { /* Cross-origin hosts pass lang in the preview URL. */ }
}
const language = embedLocale(current.searchParams.get('lang') ?? '', hostLanguage, ...(navigator.languages.length ? navigator.languages : [navigator.language]));
await loadEmbedLocale(language);
const translate = (text: string) => cityEmbedText(text, language);
document.documentElement.lang = language;
document.title = translate('Magna Urbis · City preview');
localizeCityEmbed(document.body, language);

const root = document.documentElement;
const status = document.getElementById('status')!;
const progressLabel = document.getElementById('progress-label')!;
const bar = document.querySelector<HTMLProgressElement>('#city-progress')!;

function showProgress(label: string, step?: number): void {
  status.hidden = bar.hidden = false;
  const text = translate(label);
  if (progressLabel.textContent !== text) progressLabel.textContent = text;
  if (step === undefined) bar.removeAttribute('value');
  else bar.value = step;
}

// Milestones of this town, not a time estimate. Repeated worker substeps stay in the same phase.
const generationSteps: Record<string, [number, string]> = { 'terrain-cache': [1, 'Preparing terrain…'], sites: [2, 'Laying out roads…'], town: [3, 'Laying out city blocks…'], 'urban-parcels': [4, 'Dividing plots…'], 'urban-building-sites': [5, 'Placing buildings…'] };
const host = document.getElementById('map')!;
let worker: Worker | undefined;
const detailedButton = document.querySelector<HTMLButtonElement>('#detailed')!;
const housesButton = document.querySelector<HTMLButtonElement>('#houses')!;
const saveButton = document.querySelector<HTMLButtonElement>('#save-view')!;
const planButton = document.querySelector<HTMLButtonElement>('#plan')!;
const paintedButton = document.querySelector<HTMLButtonElement>('#painted')!;
const views = [planButton, detailedButton, paintedButton, housesButton];
document.querySelectorAll<HTMLElement>('.icon[aria-label], #open').forEach(icon => { icon.title = icon.getAttribute('aria-label')!; });

function iconLabel(icon: HTMLElement, label: string, sprite: string) {
  icon.title = translate(label);
  icon.setAttribute('aria-label', icon.title);
  icon.dataset.icon = sprite;
}

function viewControls(selected: HTMLButtonElement) {
  for (const button of views) {
    button.disabled = false;
    button.setAttribute('aria-pressed', String(button === selected));
    button.removeAttribute('aria-busy');
  }
}

function loadingView(target: HTMLButtonElement) {
  for (const button of views) button.disabled = true;
  target.setAttribute('aria-busy', 'true');
  saveButton.disabled = true;
}
type MapRenderer = Pick<MinimalCanvasRenderer, 'drawLive' | 'dispose'> & { element: HTMLElement };
let renderer: MapRenderer | undefined;
let pendingRenderer: MapRenderer | undefined;
let navigation: ReturnType<typeof mountCityEmbedNavigation> | undefined;
let resize: ResizeObserver | undefined;
let drawFrame = 0;
let disposed = false;

function stopWorker(): void {
  worker?.terminate();
  worker = undefined;
}

function fail(error: unknown): void {
  stopWorker();
  pendingRenderer?.dispose();
  pendingRenderer = undefined;
  if (disposed) return;
  if (root.dataset.state === 'ready') {
    saveButton.disabled = false;
    status.hidden = true;
    root.dataset.detail = 'unavailable';
    for (const button of views) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
    progressLabel.textContent = translate('Detailed map unavailable. Try again.');
    bar.hidden = true;
    status.hidden = false;
    console.error(error);
    return;
  }
  root.dataset.state = 'error';
  status.hidden = false;
  bar.hidden = true;
  progressLabel.textContent = translate(error instanceof Error ? error.message : String(error));
}

const afterPaint = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

function start(): void {
  const source = cityEmbedSource(current);
  const hints = cityEmbedHints(source);
  const editor = new URL(cityEmbedEditorUrl(current, source));
  editor.searchParams.set('lang', language);
  if (current.searchParams.get('preview') !== '1') {
    location.replace(editor);
    return;
  }

  (document.getElementById('open') as HTMLAnchorElement).href = editor.href;
  const name = document.getElementById('burg-name')!;
  name.textContent = hints.name?.slice(0, 200) ?? '';
  name.hidden = !name.textContent;
  const controls = document.getElementById('demo-controls')!;
  const blocksOnly = cityEmbedStartsWithBlocks(hints.population);
  const summary = cityEmbedSummary(hints, current.searchParams.get('cultureBase'), language);
  if (window.parent === window) {
    document.documentElement.classList.add('demo-host');
    document.querySelectorAll('#map, #status, #map-navigation, #detail-actions, #open, #caption').forEach(el => el.remove());
    controls.hidden = false;
    mountCityEmbedPopulation(current, hints.population ?? 2500);
    document.getElementById('randomize')!.onclick = () => location.assign(randomCityEmbedUrl(current).href);
    document.getElementById('demo-params')!.textContent = blocksOnly ? summary + ' · ' + translate('City blocks') : summary;
    const frame = document.createElement('iframe');
    frame.id = 'test-frame';
    frame.title = translate('City preview');
    frame.sandbox.add('allow-scripts', 'allow-same-origin', 'allow-popups', 'allow-popups-to-escape-sandbox');
    frame.allow = "cross-origin-isolated 'none'";
    const inner = new URL(current);
    inner.searchParams.set('lang', language);
    // A different loopback site exercises the third-party storage and sandbox used by FMG.
    if (inner.hostname === '127.0.0.1') inner.hostname = 'localhost';
    else if (inner.hostname === 'localhost') inner.hostname = '127.0.0.1';
    frame.src = inner.href;
    document.body.append(frame);
    mountCityEmbedOverlay(frame);
    return;
  }
  const expand = document.getElementById('expand-preview')!;
  let hostOrigin: string | undefined;
  const askHost = (action: 'expand' | 'close') => {
    if (hostOrigin) window.parent.postMessage({ type: 'magna-urbis:frame-' + action }, hostOrigin);
  };
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.type !== 'magna-urbis:frame-state') return;
    hostOrigin = event.origin;
    const expanded = event.data.expanded === true;
    expand.hidden = false;
    expand.setAttribute('aria-expanded', String(expanded));
    iconLabel(expand, expanded ? 'Actual size' : 'Enlarge', expanded ? 'shrink' : 'expand');
    if (typeof event.data.lang === 'string' && event.data.lang && embedLocale(event.data.lang) !== language) {
      current.searchParams.set('lang', embedLocale(event.data.lang));
      location.replace(current);
    }
  });
  expand.onclick = () => askHost(expand.getAttribute('aria-expanded') === 'true' ? 'close' : 'expand');
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && expand.getAttribute('aria-expanded') === 'true') askHost('close');
  });
  window.parent.postMessage({ type: 'magna-urbis:frame-ready' }, '*');
  if (blocksOnly) {
    iconLabel(planButton, 'City blocks', 'plan');
    iconLabel(housesButton, 'Generate architectural houses', 'houses');
  }

  // Local profiling uses the same V2 native engine as the studio and the benches.
  const local = current.searchParams.get('profile') === 'local' && ['127.0.0.1', 'localhost', '[::1]'].includes(current.hostname);
  const threaded = !local && crossOriginIsolated && typeof SharedArrayBuffer === 'function' && current.searchParams.get('threads') !== 'off';
  let previewKey: string | undefined;
  let bounds: Rect4 | undefined;
  let tier: DetailedCityResult['mode'] = 'detailed';
  let requestedTier: DetailedCityResult['mode'] = tier;
  let cachedFrame: SavedCityView | undefined;
  let saveSerial = 0;
  let style: CityDetailStyle = 'satellite-light';
  let compactData: CityPreviewResult | undefined;
  const draw = () => {
    if (!renderer || !bounds || disposed) return;
    const { width, height } = host.getBoundingClientRect();
    if (width < 1 || height < 1) return;
    const view = navigation!.view(cityEmbedView(bounds, width, height));
    renderer.drawLive(view, width, height, window.devicePixelRatio || 1);
    if (cachedFrame && root.dataset.detail === 'ready' && (width !== cachedFrame.width || height !== cachedFrame.height || Math.abs(view.scale - cachedFrame.view.scale) > 1e-7 || Math.hypot(view.cx - cachedFrame.view.cx, view.cy - cachedFrame.view.cy) > 1e-5)) {
      void requestTier(tier).catch(fail);
    }
  };
  const scheduleDraw = () => {
    if (drawFrame || disposed) return;
    drawFrame = requestAnimationFrame(() => {
      drawFrame = 0;
      draw();
    });
  };

  navigation = mountCityEmbedNavigation(
    host,
    () => {
      if (root.dataset.detail === 'ready') {
        ++saveSerial;
        iconLabel(saveButton, 'Save view', 'save');
        delete root.dataset.saved;
      }
      scheduleDraw();
    },
    () => root.dataset.state === 'ready',
  );
  document.getElementById('zoom-in')!.onclick = () => navigation!.zoom(1.5);
  document.getElementById('zoom-out')!.onclick = () => navigation!.zoom(1 / 1.5);
  document.getElementById('fit-view')!.onclick = () => navigation!.reset();
  resize = new ResizeObserver(scheduleDraw);
  resize.observe(host);
  const install = (next: MapRenderer, area: Rect4) => {
    const { width, height } = host.getBoundingClientRect();
    if (width && height) next.drawLive(navigation!.view(cityEmbedView(area, width, height)), width, height, window.devicePixelRatio || 1);
    host.append(next.element);
    renderer?.element.remove();
    renderer?.dispose();
    renderer = next;
    pendingRenderer = undefined;
    bounds = area;
  };
  const showCompactMap = async (data: CityPreviewResult) => {
    showProgress('Drawing the map…', 6);
    const { map } = data;
    const next = new MinimalCanvasRenderer(scheduleDraw);
    pendingRenderer = next;
    await next.setContent({ key: 'compact', terrainKey: 1, size: map.size, features: unpackMinimalFeatures(map.geometry), places: [] }, map.recipe, map.plan, { terrain: false, landuse: false, labels: false });
    if (disposed) return;
    install(next, map.bounds);
    cachedFrame = undefined;
    detail = undefined;
    compactData = data;
    root.dataset.runtime = data.runtime;
    if (data.wasm) {
      root.dataset.wasmMode = data.wasm.mode;
      root.dataset.wasmThreads = String(data.wasm.threads);
    }
    await afterPaint();
    if (disposed) return;
    root.dataset.state = 'ready';
    root.dataset.readyMs = String(Math.round(performance.now()));
    root.dataset.detail = blocksOnly ? 'blocks' : 'idle';
    status.hidden = true;
    root.dataset.tier = 'compact';
    delete root.dataset.detailStyle;
    saveButton.hidden = true;
    viewControls(planButton);
    document.querySelectorAll<HTMLButtonElement>('#map-navigation button:not(#save-view)').forEach(button => {
      button.disabled = false;
    });
  };
  let detailModule: Promise<typeof import('./cityEmbedDetail')> | undefined;
  let detail: ReturnType<typeof import('./cityEmbedDetail').detailedCityMap> | undefined;
  const detailControls = () => {
    viewControls(tier === 'houses' ? housesButton : style === 'satellite-light' ? detailedButton : paintedButton);
    saveButton.hidden = saveButton.disabled = false;
    root.dataset.tier = tier;
  };
  const saveFrame = async () => {
    const serial = ++saveSerial;
    if (disposed) return;
    if (!previewKey || !detail || !bounds) {
      iconLabel(saveButton, 'Storage unavailable', 'alert');
      return;
    }
    const canvas = detail.renderer.snapshot();
    if (!canvas) {
      iconLabel(saveButton, 'Save view', 'save');
      return;
    }
    const { width, height } = host.getBoundingClientRect();
    const metadata = { tier, style, bounds, width, height, camera: navigation!.camera(), view: navigation!.view(cityEmbedView(bounds, width, height)) };
    iconLabel(saveButton, 'Saving…', 'wait');
    const image = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (disposed || serial !== saveSerial) return;
    const stored = !!image && (await saveCityView(previewKey, { ...metadata, image }));
    if (disposed || serial !== saveSerial) return;
    root.dataset.saved = stored ? 'yes' : 'no';
    iconLabel(saveButton, stored ? 'View saved' : 'Storage unavailable', stored ? 'saved' : 'alert');
  };
  const paintStyle = async (area: Rect4) => {
    if (!detail || disposed) return;
    root.dataset.detail = 'loading';
    showProgress(style === 'satellite-light' ? 'Rendering fast satellite…' : 'Rendering painted satellite…');
    await detail.setStyle(style);
    if (disposed) return;
    if (renderer !== detail.renderer) install(detail.renderer, area);
    else draw();
    await detail.renderer.settled();
    await afterPaint();
    if (disposed) return;
    status.hidden = true;
    root.dataset.detail = 'ready';
    root.dataset.detailStyle = style;
    root.dataset.detailMs = String(Math.round(performance.now()));
    tier = requestedTier;
    cachedFrame = undefined;
    detailControls();
    void saveFrame().catch(() => {
      iconLabel(saveButton, 'Storage unavailable', 'alert');
    });
  };
  const showDetailed = async (data: DetailedCityResult, fresh: boolean) => {
    showProgress('Drawing the map…', 6);
    // Unpacking mutates the transport objects. Commit the packed world before handing it to the renderer.
    if (fresh && previewKey) await saveCityWorld(previewKey, data);
    const { detailedCityMap } = await detailModule!;
    if (disposed) return;
    detail = detailedCityMap(data, scheduleDraw);
    pendingRenderer = detail.renderer;
    await paintStyle(bounds ?? data.bounds);
  };
  const requestTier = async (mode: DetailedCityResult['mode']) => {
    if (disposed) return;
    ++saveSerial;
    requestedTier = mode;
    root.dataset.detail = 'loading';
    delete root.dataset.saved;
    loadingView(mode === 'houses' ? housesButton : style === 'satellite-light' ? detailedButton : paintedButton);
    if (detail && renderer === detail.renderer && tier === mode && bounds) {
      await paintStyle(bounds);
      return;
    }
    showProgress(mode === 'houses' ? 'Generating architectural houses…' : 'Generating the detailed map');
    detailModule = import('./cityEmbedDetail');
    void detailModule.catch(fail);
    const cached = previewKey && (await readCityWorld(previewKey, mode));
    if (disposed) return;
    if (cached) await showDetailed(cached, false);
    else generate(mode);
  };
  const chooseView = (mode: DetailedCityResult['mode'], nextStyle: CityDetailStyle) => {
    if (root.dataset.detail === 'ready' && tier === mode && style === nextStyle) return;
    style = nextStyle;
    void requestTier(mode).catch(fail);
  };
  detailedButton.onclick = () => chooseView('detailed', 'satellite-light');
  paintedButton.onclick = () => chooseView('detailed', 'satellite-2');
  housesButton.onclick = () => chooseView('houses', 'satellite-2');
  planButton.onclick = async () => {
    if (root.dataset.tier === 'compact' && root.dataset.detail !== 'unavailable') return;
    ++saveSerial;
    root.dataset.detail = 'loading';
    loadingView(planButton);
    showProgress('Drawing the map…');
    try {
      const data = compactData ?? (previewKey && await readCompactPreview(previewKey));
      if (disposed) return;
      if (data) await showCompactMap(data);
      else generate('compact');
    } catch (error) {
      fail(error);
    }
  };
  saveButton.onclick = () => {
    if (cachedFrame) {
      iconLabel(saveButton, 'View saved', 'saved');
      return;
    }
    draw();
    if (detail)
      void detail.renderer
        .settled()
        .then(saveFrame)
        .catch(() => {
          iconLabel(saveButton, 'Storage unavailable', 'alert');
        });
  };
  const generate = (mode: CityPreviewMode) => {
    try {
      const active = new CityWorker({ name: 'magna-city-' + mode + ' profile=' + (local ? 'local' : 'web') + ' threads=' + (threaded ? 'auto' : 'off') });
      worker = active;
      const stopped = () => {
        if (worker === active) fail(new Error('The city generator stopped.'));
      };
      active.onerror = stopped;
      active.onmessageerror = stopped;
      active.onmessage = ({ data }: MessageEvent<CityPreviewResponse>) => {
        if (disposed || worker !== active) return;
        if (data.type === 'progress') {
          const milestone = generationSteps[data.progress.stage];
          if (milestone && milestone[0] > bar.value) showProgress(milestone[1], milestone[0]);
        } else if (data.type === 'error') fail(new Error(data.error));
        else if (data.type === 'city-preview') {
          stopWorker();
          if (data.mode === 'compact') {
            if (previewKey && data.runtime === 'wasm') saveCompactPreview(previewKey, data);
            void showCompactMap(data).catch(fail);
          } else void showDetailed(data, true).catch(fail);
        }
      };
      active.postMessage({ hints, local, mode } satisfies CityPreviewRequest);
    } catch (error) {
      fail(error);
    }
  };
  const showCompact = async () => {
    // A loopback engine can be rebuilt independently of the web app.
    try {
      previewKey = await compactPreviewKey(hints, threaded, local);
      const saved = previewKey && (await readCityView(previewKey));
      if (disposed) return;
      if (saved) {
        const { savedCityRenderer } = await import('./cityEmbedSaved');
        const next = await savedCityRenderer(saved);
        if (disposed) {
          next.dispose();
          return;
        }
        navigation!.restore(saved.camera);
        install(next, saved.bounds);
        cachedFrame = saved;
        tier = requestedTier = saved.tier;
        style = saved.style;
        root.dataset.state = root.dataset.detail = 'ready';
        root.dataset.detailStyle = saved.style;
        root.dataset.previewCache = 'render';
        root.dataset.saved = 'yes';
        root.dataset.readyMs = String(Math.round(performance.now()));
        root.dataset.runtime = local ? 'native' : 'wasm';
        status.hidden = true;
        detailControls();
        iconLabel(saveButton, 'View saved', 'saved');
        document.querySelectorAll<HTMLButtonElement>('#map-navigation button:not(#save-view)').forEach(button => {
          button.disabled = false;
        });
        scheduleDraw();
        return;
      }
      const stable = !local && previewKey && (await readCompactPreview(previewKey));
      if (disposed) return;
      if (stable) {
        root.dataset.previewCache = 'hit';
        await showCompactMap(stable);
        return;
      }
    } catch {
      pendingRenderer?.dispose();
      pendingRenderer = undefined;
    }
    if (disposed) return;
    root.dataset.previewCache = 'miss';
    generate('compact');
  };
  void showCompact().catch(fail);
}

try {
  start();
} catch (error) {
  fail(error);
}

window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  disposed = true;
  stopWorker();
  navigation?.dispose();
  resize?.disconnect();
  renderer?.dispose();
  pendingRenderer?.dispose();
  cancelAnimationFrame(drawFrame);
});
