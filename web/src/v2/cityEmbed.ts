/** FMG displays a real V2 town through the shared Minimal Canvas renderer. */
import CityWorker from './cityEmbed.worker?worker';
import { cityEmbedEditorUrl, cityEmbedHints, cityEmbedSource, cityEmbedView } from './cityEmbedInput';
import { compactPreviewKey, readCompactPreview, saveCompactPreview } from './cityEmbedCache';
import { mountCityEmbedPopulation, randomCityEmbedUrl } from './cityEmbedDemo';
import { mountCityEmbedNavigation } from './cityEmbedNavigation';
import { MinimalCanvasRenderer } from './minimalCanvas';
import { preferredLanguage } from './languages';
import { cityEmbedText, localizeCityEmbed, cityEmbedSummary } from './cityEmbedMessages';
import { unpackMinimalFeatures, type CityPreviewMode, type CityPreviewResponse, type CityPreviewRequest } from './cityPreviewMap';
import type { Rect4 } from '../render/view';

const language = preferredLanguage(location.search);
const translate = (text: string) => cityEmbedText(text, language);
document.documentElement.lang = language === 'fr' ? 'fr' : 'en';
document.title = translate('Magna Urbis · City preview');
localizeCityEmbed(document.body, language);

const root = document.documentElement;
const status = document.getElementById('status')!;
const host = document.getElementById('map')!;
let worker: Worker | undefined;
const detailedButton = document.querySelector<HTMLButtonElement>('#detailed')!;
let renderer: MinimalCanvasRenderer | undefined;
let pendingRenderer: MinimalCanvasRenderer | undefined;
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
    root.dataset.detail = 'unavailable';
    detailedButton.disabled = false;
    detailedButton.textContent = translate('retry detail');
    detailedButton.title = translate('Detailed map unavailable. Try again.');
    detailedButton.removeAttribute('aria-busy');
    return;
  }
  root.dataset.state = 'error';
  status.textContent = translate(error instanceof Error ? error.message : String(error));
}

const afterPaint = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

function start(): void {
  const current = new URL(location.href);
  const source = cityEmbedSource(current);
  const hints = cityEmbedHints(source);
  const editor = cityEmbedEditorUrl(current, source);
  if (current.searchParams.get('preview') !== '1') {
    location.replace(editor);
    return;
  }

  (document.getElementById('open') as HTMLAnchorElement).href = editor;
  const name = document.getElementById('burg-name')!;
  name.textContent = hints.name?.slice(0, 200) ?? '';
  name.hidden = !name.textContent;
  const controls = document.getElementById('demo-controls')!;
  const demo = window.parent === window || current.searchParams.get('demo') === '1';
  const detailLabel = demo ? translate('Improve map') : 'detailed';
  controls.hidden = !demo;
  if (demo) {
    controls.insertBefore(detailedButton, document.getElementById('demo-params'));
    detailedButton.textContent = detailLabel;
    mountCityEmbedPopulation(current, hints.population ?? 2500);
    document.getElementById('randomize')!.onclick = () => location.assign(randomCityEmbedUrl(current).href);
    document.getElementById('demo-params')!.textContent = cityEmbedSummary(hints, current.searchParams.get('cultureBase'), language);
  }

  // Local profiling uses the same V2 native engine as the studio and the benches.
  const local = current.searchParams.get('profile') === 'local' && ['127.0.0.1', 'localhost', '[::1]'].includes(current.hostname);
  const threaded = !local && crossOriginIsolated && typeof SharedArrayBuffer === 'function' && current.searchParams.get('threads') !== 'off';
  let previewKey: string | undefined;
  let bounds: Rect4 | undefined;
  const draw = () => {
    if (!renderer || !bounds || disposed) return;
    const { width, height } = host.getBoundingClientRect();
    if (width < 1 || height < 1) return;
    renderer.drawLive(navigation!.view(cityEmbedView(bounds, width, height)), width, height, window.devicePixelRatio || 1);
  };
  const scheduleDraw = () => {
    if (drawFrame || disposed) return;
    drawFrame = requestAnimationFrame(() => {
      drawFrame = 0;
      draw();
    });
  };

  navigation = mountCityEmbedNavigation(host, scheduleDraw, () => root.dataset.state === 'ready');
  document.getElementById('zoom-in')!.onclick = () => navigation!.zoom(1.5);
  document.getElementById('zoom-out')!.onclick = () => navigation!.zoom(1 / 1.5);
  document.getElementById('fit-view')!.onclick = () => navigation!.reset();
  resize = new ResizeObserver(scheduleDraw);
  resize.observe(host);
  const show = async (data: Extract<CityPreviewResponse, { type: 'city-preview' }>) => {
    const { map, mode } = data;
    const next = new MinimalCanvasRenderer(scheduleDraw);
    pendingRenderer = next;
    const height = map.height;
    await next.setContent({ key: mode, terrainKey: 1, size: map.size, features: unpackMinimalFeatures(map.geometry), places: [], height: height ? () => height : undefined }, map.recipe, map.plan, { terrain: mode === 'detailed', landuse: mode === 'detailed', labels: false });
    if (disposed) return;
    // Paint offscreen first. Throughout generation, panning and resizing still use the live compact map.
    const { width, height: h } = host.getBoundingClientRect();
    if (width > 0 && h > 0) next.drawLive(navigation!.view(cityEmbedView(map.bounds, width, h)), width, h, window.devicePixelRatio || 1);
    host.append(next.element);
    renderer?.dispose();
    renderer = next;
    pendingRenderer = undefined;
    bounds = map.bounds;
    root.dataset.runtime = data.runtime;
    if (data.wasm) {
      root.dataset.wasmMode = data.wasm.mode;
      root.dataset.wasmThreads = String(data.wasm.threads);
    }
    await afterPaint();
    if (disposed) return;
    if (mode === 'compact') {
      root.dataset.state = 'ready';
      root.dataset.readyMs = String(Math.round(performance.now()));
      root.dataset.detail = 'idle';
      status.hidden = true;
      detailedButton.disabled = false;
      document.querySelectorAll<HTMLButtonElement>('#map-navigation button').forEach(button => {
        button.disabled = false;
      });
    } else {
      root.dataset.detail = 'ready';
      root.dataset.detailMs = String(Math.round(performance.now()));
      detailedButton.removeAttribute('aria-busy');
      detailedButton.textContent = demo ? translate('Detailed view') : detailLabel;
      detailedButton.title = translate('Detailed map shown');
    }
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
        if (data.type === 'error') fail(new Error(data.error));
        else if (data.type === 'city-preview') {
          stopWorker();
          if (mode === 'compact' && previewKey && data.runtime === 'wasm') saveCompactPreview(previewKey, data);
          void show(data).catch(fail);
        }
      };
      active.postMessage({ hints, local, mode } satisfies CityPreviewRequest);
    } catch (error) {
      fail(error);
    }
  };
  detailedButton.onclick = () => {
    if (detailedButton.disabled || disposed) return;
    detailedButton.disabled = true;
    detailedButton.setAttribute('aria-busy', 'true');
    detailedButton.textContent = translate('detailing…');
    detailedButton.title = translate('Generating the detailed map');
    root.dataset.detail = 'loading';
    generate('detailed');
  };
  const showCompact = async () => {
    // A loopback engine can be rebuilt independently of the web app.
    if (!local) {
      try {
        previewKey = await compactPreviewKey(hints, threaded);
        const stable = previewKey && (await readCompactPreview(previewKey));
        if (disposed) return;
        if (stable) {
          root.dataset.previewCache = 'hit';
          await show(stable);
          return;
        }
      } catch {
        pendingRenderer?.dispose();
        pendingRenderer = undefined;
      }
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
