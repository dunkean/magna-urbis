/** FMG's compact two-stage Canvas view. The editor is reached through the original burg data. */
import PreviewWorker from './cityPreview.worker?worker';
import type { PreviewReply } from './cityPreview.worker';
import { cityEmbedEditorUrl, cityEmbedHints, cityEmbedSource, cityEmbedView } from './cityEmbedInput';
import { randomCityEmbedUrl } from './cityEmbedDemo';
import { mountCityEmbedNavigation } from './cityEmbedNavigation';
import { CityPreviewCanvas } from './cityPreviewCanvas';
import { preferredLanguage } from './languages';
import { cityEmbedText, localizeCityEmbed, cityEmbedSummary } from './cityEmbedMessages';
import type { CityPreviewPlan } from './cityPreviewPlan';

const language = preferredLanguage(location.search);
const translate = (text: string) => cityEmbedText(text, language);
document.documentElement.lang = language === 'fr' ? 'fr' : 'en';
document.title = translate('Magna Urbis · City preview');
localizeCityEmbed(document.body, language);

const root = document.documentElement;
const status = document.getElementById('status')!;
const host = document.getElementById('map')!;
let worker: Worker | undefined;
let navigation: ReturnType<typeof mountCityEmbedNavigation> | undefined;
let resize: ResizeObserver | undefined;
let drawFrame = 0;
let paintFrame = 0;

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

  let plan: CityPreviewPlan | undefined;
  let renderer: CityPreviewCanvas | undefined;
  const draw = () => {
    if (!renderer || !plan) return;
    const { width, height } = host.getBoundingClientRect();
    if (width < 1 || height < 1) return;
    renderer.draw(navigation!.view(cityEmbedView(plan.bounds, width, height)), width, height, window.devicePixelRatio || 1);
  };
  const scheduleDraw = () => {
    if (drawFrame) return;
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

  worker = new PreviewWorker({ name: 'magna-city-preview' });
  worker.onerror = () => fail(new Error('The city generator stopped.'));
  worker.onmessage = ({ data }: MessageEvent<PreviewReply>) => {
    try {
      if (data.type === 'plan') {
        plan = data.plan;
        const canvas = document.createElement('canvas');
        renderer = new CityPreviewCanvas(canvas, plan);
        host.append(canvas);
        paintFrame = requestAnimationFrame(() => {
          draw();
          paintFrame = requestAnimationFrame(() => {
            root.dataset.state = 'ready';
            root.dataset.readyMs = String(Math.round(performance.now()));
            status.hidden = true;
            document.querySelectorAll<HTMLButtonElement>('#map-navigation button').forEach(button => {
              button.disabled = false;
            });
            worker?.postMessage({ type: 'detail' });
          });
        });
      } else if (renderer) {
        stopWorker();
        renderer.setDetail(data.detail);
        paintFrame = requestAnimationFrame(() => {
          draw();
          paintFrame = requestAnimationFrame(() => {
            root.dataset.detail = 'ready';
            root.dataset.detailMs = String(Math.round(performance.now()));
          });
        });
      }
    } catch (error) {
      fail(error);
    }
  };
  worker.postMessage({ type: 'plan', hints });
}

try {
  start();
} catch (error) {
  fail(error);
}

window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  stopWorker();
  navigation?.dispose();
  resize?.disconnect();
  cancelAnimationFrame(drawFrame);
  cancelAnimationFrame(paintFrame);
});
