/** embed.html entry: generate one imported city and show the shared Minimal renderer without bootstrapping the studio page. */
import EngineWorker from './engine.worker?worker';
import { cityEmbedSettings, cityEmbedEditorUrl, cityEmbedView, cityEmbedSource } from './cityEmbedInput';
import { cachedCityPreview, cacheCityPreview } from './cityEmbedCache';
import { randomCityEmbedUrl } from './cityEmbedDemo';
import { mountCityEmbedNavigation } from './cityEmbedNavigation';
import { MinimalRenderer } from './minimalRenderer';
import { resolveSettingsAppearance } from './appearance';
import { unpackWorldLanduse } from './landusePack';
import { unpackWorldPartitions } from './urbanPack';
import type { V2WorkerRequest, V2WorkerResponse } from './contracts';
import type { World } from '../gen/types';
import { bindTree, getLanguage, registerMessages, translate } from './i18n';
import { cityEmbedMessages, cityEmbedSummary } from './cityEmbedMessages';

registerMessages(cityEmbedMessages);
document.documentElement.lang = getLanguage();
document.title = translate('Magna Urbis · City preview');
bindTree(document.body);

const status = document.getElementById('status')!;
const host = document.getElementById('map')!;
const root = document.documentElement;
const started = performance.now();
let worker: Worker | undefined, renderer: MinimalRenderer | undefined, world: World | undefined;
let navigation: ReturnType<typeof mountCityEmbedNavigation> | undefined;
let bitmap: HTMLCanvasElement | undefined;
let drawFrame = 0;
let resizeObserver: ResizeObserver | undefined;
const fail = (error: unknown) => {
  worker?.terminate();
  worker = undefined;
  root.dataset.state = 'error';
  status.hidden = false;
  status.textContent = translate(error instanceof Error ? error.message : String(error));
};

const ready = () => {
  root.dataset.state = 'ready';
  root.dataset.readyMs = String(Math.round(performance.now() - started));
  status.hidden = true;
  document.querySelectorAll<HTMLButtonElement>('#map-navigation button').forEach(button => {
    button.disabled = false;
  });
};
async function start(): Promise<void> {
  const current = new URL(location.href);
  const settings = cityEmbedSettings(current);
  const editor = cityEmbedEditorUrl(current);
  if (current.searchParams.get('preview') !== '1') location.replace(editor);
  else {
    const open = document.getElementById('open') as HTMLAnchorElement;
    open.href = editor;
    const controls = document.getElementById('demo-controls')!;
    controls.hidden = window.parent !== window && current.searchParams.get('demo') !== '1';
    document.getElementById('randomize')!.onclick = () => location.assign(randomCityEmbedUrl(new URL(location.href)).href);
    document.getElementById('demo-params')!.textContent = cityEmbedSummary(settings.options, current.searchParams.get('cultureBase'));
    const source = cityEmbedSource(current);
    const draw = () => {
      if (drawFrame) return;
      drawFrame = requestAnimationFrame(() => {
        drawFrame = 0;
        if (bitmap) {
          bitmap.style.transform = navigation!.bitmapTransform();
          return;
        }
        if (!world || !renderer) return;
        const { width, height } = host.getBoundingClientRect();
        renderer.drawLive(navigation!.view(cityEmbedView(world, width, height)), width, height, devicePixelRatio || 1);
      });
    };
    navigation = mountCityEmbedNavigation(host, draw, () => root.dataset.state === 'ready');
    document.getElementById('zoom-in')!.onclick = () => navigation!.zoom(1.5);
    document.getElementById('zoom-out')!.onclick = () => navigation!.zoom(1 / 1.5);
    document.getElementById('fit-view')!.onclick = () => navigation!.reset();
    resizeObserver = new ResizeObserver(draw);
    resizeObserver.observe(host);
    const width = host.clientWidth,
      height = host.clientHeight;
    const thumbnail = cachedCityPreview(source, width, height);
    if (thumbnail) {
      const image = new Image();
      image.src = thumbnail;
      try {
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;transform-origin:50% 50%;pointer-events:none';
        canvas.getContext('2d')!.drawImage(image, 0, 0);
        host.append(canvas);
        bitmap = canvas;
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        root.dataset.cached = '1';
        ready();
        return;
      } catch {
        /* A damaged thumbnail regenerates normally. */
      }
    }
    renderer = new MinimalRenderer(draw);
    host.append(renderer.element);
    // Ordinary cross-origin iframes cannot rely on SharedArrayBuffer/isolation. Start one worker,
    // use the cached single-thread engine, and stop it as soon as the city has been received.
    worker = new EngineWorker({ name: 'magna-city-preview profile=web threads=off' });
    worker.onerror = event => fail(new Error(event.message || 'The city generator stopped.'));
    worker.onmessage = async ({ data: message }: MessageEvent<V2WorkerResponse>) => {
      if (message.type === 'progress') status.textContent = translate('Generating city…');
      else if (message.type === 'error') fail(new Error(message.error));
      else if (message.type === 'result') {
        worker?.terminate();
        worker = undefined;
        try {
          world = unpackWorldPartitions(unpackWorldLanduse(message.world));
          await renderer!.set(world, settings, resolveSettingsAppearance(settings, world, 'view2d'));
          draw();
          requestAnimationFrame(() => {
            ready();
            const canvas = renderer!.element.querySelector('canvas');
            if (canvas) cacheCityPreview(source, host.clientWidth, host.clientHeight, canvas);
          });
        } catch (error) {
          fail(error);
        }
      }
    };
    worker.postMessage({ id: 1, action: 'all', settings, assetBase: document.baseURI } satisfies V2WorkerRequest);
  }
}
void start().catch(fail);

window.addEventListener('pagehide', () => {
  worker?.terminate();
  renderer?.dispose();
  navigation?.dispose();
  resizeObserver?.disconnect();
  cancelAnimationFrame(drawFrame);
});
