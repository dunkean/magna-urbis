/** FMG displays a real V2 town through the shared Minimal Canvas renderer. */
import EngineWorker from './engine.worker?worker';
import { unpackWorldLanduse } from './landusePack';
import { unpackWorldPartitions } from './urbanPack';
import { cityEmbedBounds, cityEmbedEditorUrl, cityEmbedHints, cityEmbedSettings, cityEmbedSource, cityEmbedView } from './cityEmbedInput';
import { randomCityEmbedUrl } from './cityEmbedDemo';
import { mountCityEmbedNavigation } from './cityEmbedNavigation';
import { resolveSettingsAppearance } from './appearance';
import { MinimalRenderer } from './minimalRenderer';
import { preferredLanguage } from './languages';
import { cityEmbedText, localizeCityEmbed, cityEmbedSummary } from './cityEmbedMessages';
import type { World } from '../gen/types';
import type { Rect4 } from '../render/view';
import type { V2WorkerRequest, V2WorkerResponse } from './contracts';

const language = preferredLanguage(location.search);
const translate = (text: string) => cityEmbedText(text, language);
document.documentElement.lang = language === 'fr' ? 'fr' : 'en';
document.title = translate('Magna Urbis · City preview');
localizeCityEmbed(document.body, language);

const root = document.documentElement;
const status = document.getElementById('status')!;
const host = document.getElementById('map')!;
let worker: Worker | undefined;
let renderer: MinimalRenderer | undefined;
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
  if (root.dataset.state === 'ready') {
    root.dataset.detail = 'unavailable';
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
  controls.hidden = !demo;
  if (demo) {
    document.getElementById('randomize')!.onclick = () => location.assign(randomCityEmbedUrl(current).href);
    document.getElementById('demo-params')!.textContent = cityEmbedSummary(hints, current.searchParams.get('cultureBase'), language);
  }

  // Local profiling uses the same V2 native engine as the studio and the benches.
  const local = current.searchParams.get('profile') === 'local' && ['127.0.0.1', 'localhost', '[::1]'].includes(current.hostname);
  const settings = cityEmbedSettings(hints, local);
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
  renderer = new MinimalRenderer(scheduleDraw);
  host.append(renderer.element);

  const showTown = async (world: World) => {
    bounds = cityEmbedBounds(world);
    const appearance = resolveSettingsAppearance(settings, world, 'view2d');
    await renderer!.set(world, settings, appearance, { terrain: false, landuse: false, labels: false });
    draw();
    await afterPaint();
    if (disposed) return;
    root.dataset.state = 'ready';
    root.dataset.readyMs = String(Math.round(performance.now()));
    status.hidden = true;
    document.querySelectorAll<HTMLButtonElement>('#map-navigation button').forEach(button => {
      button.disabled = false;
    });
  };
  const showContext = async (world: World) => {
    const appearance = settings.appearance!;
    const composition = appearance.composition!;
    const detailed = resolveSettingsAppearance({ ...settings, appearance: { ...appearance, composition: { ...composition, landuse: { ...composition.landuse, rural: 'subtle' }, effects: { ...composition.effects, relief: true } } } }, world, 'view2d');
    await renderer!.set(world, settings, detailed, { labels: false });
    draw();
    await afterPaint();
    if (disposed) return;
    root.dataset.detail = 'ready';
    root.dataset.detailMs = String(Math.round(performance.now()));
  };

  let firstPaint: Promise<void> | undefined;
  const unpack = (world: World) => unpackWorldPartitions(unpackWorldLanduse(world));
  worker = new EngineWorker({ name: 'magna-city-preview profile=' + (local ? 'local' : 'web') + ' threads=off' });
  worker.onerror = () => fail(new Error('The city generator stopped.'));
  worker.onmessage = ({ data }: MessageEvent<V2WorkerResponse>) => {
    if (data.type === 'error') fail(new Error(data.error));
    else if (data.type === 'progress' && data.progress.stage === 'runtime-fallback') root.dataset.runtime = 'wasm';
    else if (data.type === 'city-preview') {
      firstPaint ??= Promise.resolve().then(() => showTown(unpack(data.world)));
      void firstPaint.catch(fail);
    } else if (data.type === 'result') {
      stopWorker();
      root.dataset.runtime = data.world.stats['v2.urbanBackend'] === 'rust-native-cpu' ? 'native' : 'wasm';
      void Promise.resolve()
        .then(async () => {
          const world = unpack(data.world);
          await (firstPaint ?? showTown(world));
          if (!disposed) await showContext(world);
        })
        .catch(fail);
    }
  };
  worker.postMessage({ id: 1, action: 'all', settings, assetBase: document.baseURI, cityPreview: true } satisfies V2WorkerRequest);
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
  cancelAnimationFrame(drawFrame);
});
