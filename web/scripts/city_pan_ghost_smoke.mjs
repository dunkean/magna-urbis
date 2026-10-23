/** Small existing CityBench scene; no server lifecycle or whole-city architecture. */
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const phase = process.argv[2] ?? 'before';
if (!/^[a-z0-9-]+$/.test(phase)) throw new Error('Invalid phase');
const out = resolve('out/city-pan-ghosting', phase); await mkdir(out, { recursive: true });
const fixture = JSON.parse(await readFile('out/city-visual-bench/07-site-store-fallback8791/07-pueblo.json', 'utf8'));
const report = { phase, started: new Date().toISOString(), errors: [], warnings: [], stages: [], frames: [] };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  await context.grantPermissions(['local-network-access'], { origin: 'http://127.0.0.1:5173' });
  await context.routeWebSocket(url => url.host === '127.0.0.1:5173', socket => {
    const upstream = socket.connectToServer(); upstream.onMessage(message => {
      let data; try { data = JSON.parse(String(message)); } catch {}
      if (['update', 'full-reload'].includes(data?.type)) { report.warnings.push(`HMR ignored: ${data.type}`); return; }
      socket.send(message);
    });
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(String(error)));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) report.warnings.push(message.text()); });
  await page.addInitScript(() => {
    const WorkerBase = window.Worker;
    window.__panStages = [];
    window.Worker = class extends WorkerBase {
      constructor(...args) { super(...args); this.addEventListener('message', e => {
        for (const kind of ['roads', 'layouts', 'partitions']) if (e.data?.[kind]) window.__panStages.push({ kind, at: performance.now() });
      }); }
    };
  });
  await page.goto(fixture.navigationUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.magnaBenchContext?.ready(), { timeout: 120000 });
  await page.waitForFunction(() => {
    const stages = window.__panStages, roads = stages.findLast(s => s.kind === 'roads');
    const layouts = stages.findLast(s => s.kind === 'layouts'), parcels = stages.findLast(s => s.kind === 'partitions');
    return roads && layouts?.at > roads.at && parcels?.at > layouts.at && document.querySelector('#urbanParcelStage [data-apply]')?.getAttribute('aria-busy') !== 'true';
  }, { timeout: 120000 });
  await page.locator('#focusCity').click();
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await settle();
  const initial = await page.evaluate(() => window.magnaBenchContext.capture().view);
  report.camera = initial;
  const capture = async name => {
    await settle();
    report.frames.push(await page.evaluate(name => {
      const host = document.querySelector('[data-city-gl]'), canvases = [...host.querySelectorAll('canvas')];
      const gl = canvases[0]?.getContext('webgl2'), ext = gl?.getExtension('WEBGL_debug_renderer_info');
      const box = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      return { name, view: window.magnaBenchContext.capture().view, viewBox: document.querySelector('#map').getAttribute('viewBox'), frame: document.querySelector('[data-city-frame]')?.textContent,
        renderer: document.querySelector('[data-city-frame]')?.dataset.renderer, host: box(host), background: box(document.querySelector('#cityBackground')),
        canvases: canvases.map(c => ({ box: box(c), backing: [c.width, c.height], display: getComputedStyle(c).display, visibility: getComputedStyle(c).visibility })),
        gpu: gl && { renderer: gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER), lost: gl.isContextLost() } };
    }, name));
    await page.locator('#viewport').screenshot({ path: resolve(out, `${name}.png`) });
  };
  const restore = view => page.evaluate(view => window.magnaBenchContext.restore({ view }), view);
  const drag = async () => { const r = await page.locator('#viewport').boundingBox(); await page.mouse.move(r.x + r.width * .6, r.y + r.height * .55); await page.mouse.down(); await page.mouse.move(r.x + r.width * .6 + 160, r.y + r.height * .55 + 80, { steps: 8 }); await page.mouse.up(); };
  await capture('01-normal'); await drag(); await capture('02-normal-pan');
  await restore(initial);
  await page.locator('[data-render="palette"]').evaluate(select => { select.value = 'parchment'; select.dispatchEvent(new Event('change')); });
  await capture('03-parchment'); await drag(); await capture('04-parchment-pan');
  await page.locator('[data-city-gl] canvas').first().evaluate(canvas => canvas.style.visibility = 'hidden');
  await capture('05-parchment-pan-gl-hidden');
  await page.locator('[data-city-gl] canvas').first().evaluate(canvas => canvas.style.visibility = '');
  const r = await page.locator('#viewport').boundingBox(); await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.wheel(0, -180);
  await capture('06-parchment-zoom');
  await page.setViewportSize({ width: 1300, height: 850 }); await capture('07-parchment-resize');
  await page.locator('[data-render="palette"]').evaluate(select => { select.value = 'growth'; select.dispatchEvent(new Event('change')); });
  await capture('08-normal-restored');
  report.stages = await page.evaluate(() => window.__panStages);
  const digest = async name => createHash('sha256').update(await readFile(resolve(out, `${name}.png`))).digest('hex');
  report.hidingInactiveGlChangesImage = await digest('04-parchment-pan') !== await digest('05-parchment-pan-gl-hidden');
} catch (error) { report.errors.push(String(error)); process.exitCode = 1; }
finally { await browser.close(); await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ out, errors: report.errors, renderers: report.frames.map(f => [f.name, f.renderer, f.gpu?.renderer]) }, null, 2));
