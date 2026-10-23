/** One exact user CityBench reproduction; existing services, no product changes. */
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const out = resolve(process.argv[2] ?? 'out/roman-user-04-8791'); await mkdir(out, { recursive: true });
const url = (await readFile('../_agents_blackboard/roman-user-url.txt', 'utf8')).trim();
const report = { started: new Date().toISOString(), url, source: 'Parent transcription of exact user URL; no Pueblo settings', runtime: JSON.parse(await readFile('../_agents_blackboard/LOCAL_RUNTIME.json', 'utf8')), errors: [], warnings: [], network: [], captures: [] };
await writeFile(resolve(out, 'url.txt'), url); await copyFile('../_agents_blackboard/roman-user-options.json', resolve(out, 'input-options.json'));
const pending = new Set(), responses = []; let serial = 0;
const browser = await chromium.launch({ channel: 'msedge', headless: true }); let page;
try {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  await context.grantPermissions(['local-network-access'], { origin: new URL(url).origin });
  await context.routeWebSocket(u => u.host === new URL(url).host, socket => {
    const upstream = socket.connectToServer(); upstream.onMessage(message => {
      let data; try { data = JSON.parse(String(message)); } catch {}
      if (['update', 'full-reload'].includes(data?.type)) { report.warnings.push(`HMR ignored: ${data.type}`); return; }
      socket.send(message);
    });
  });
  page = await context.newPage();
  page.on('pageerror', error => report.errors.push(String(error)));
  page.on('response', response => {
    const request = response.request(), u = new URL(response.url());
    if (u.origin !== 'http://127.0.0.1:8791' || request.method() !== 'POST') return;
    const body = request.postDataJSON(), entry = { path: u.pathname, kind: body?.kind, status: response.status(), atMs: Date.now() };
    report.network.push(entry);
    if (u.pathname.startsWith('/houses/')) report.errors.push(`Unexpected native architecture call ${u.pathname}`);
    if (u.pathname !== '/urban' || !['quarters', 'parcels', 'buildingSites'].includes(body?.kind)) return;
    const prefix = `${String(++serial).padStart(2, '0')}-${body.kind}`;
    const task = (async () => {
      const text = await response.text(), value = JSON.parse(text), data = value.data ?? value;
      const { session, source, ...replay } = body;
      // Runtime source tokens are not a replay fixture. Layouts/partitions are archived separately.
      const saved = { ...replay, ...(source ? { source: { version: source.version, runtimeOnly: true } } : {}) };
      await writeFile(resolve(out, `${prefix}-request.json`), JSON.stringify(saved));
      const { urbanSource, ...retained } = data;
      await writeFile(resolve(out, `${prefix}-response.json`), JSON.stringify(retained));
      Object.assign(entry, { requestFile: `${prefix}-request.json`, responseFile: `${prefix}-response.json`, responseBytes: Buffer.byteLength(text), responseSha256: createHash('sha256').update(text).digest('hex'), runtimeReferencesOmitted: Boolean(session || source || urbanSource) });
      responses.push({ kind: body.kind, prefix, data: retained, receivedAt: entry.atMs });
    })().catch(error => report.errors.push(`Archive ${prefix}: ${error}`));
    pending.add(task); task.finally(() => pending.delete(task));
  });
  await page.addInitScript(() => {
    const Base = window.Worker; window.__roman = { stages: [], scene: null, errors: [] };
    window.Worker = class extends Base { constructor(...args) { super(...args); this.addEventListener('message', e => {
      for (const kind of ['roads', 'layouts', 'partitions']) if (e.data?.[kind]) window.__roman.stages.push({ kind, at: performance.now() });
      if (e.data?.scene) { window.__roman.scene = e.data.scene; window.__roman.sceneAt = performance.now(); }
      if (e.data?.error) window.__roman.errors.push(e.data.error);
    }); } };
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  report.stage = 'terrain ready';
  await page.waitForFunction(() => window.magnaBenchContext?.ready(), null, { timeout: 120000 });
  report.stage = 'roads ready';
  // A .decor may restore already generated roads: no new Worker roads message is required.
  await page.waitForFunction(() => document.querySelector('#roadStage')?.getAttribute('aria-busy') !== 'true'
    && /^Rust\s*·/.test(document.querySelector('#roadStatus')?.textContent ?? ''), null, { timeout: 120000 });
  await page.waitForTimeout(500);
  report.stage = 'urban ready';
  await page.waitForFunction(() => {
    const stages = window.__roman.stages, r = stages.findLast(s => s.kind === 'roads'), l = stages.findLast(s => s.kind === 'layouts'), p = stages.findLast(s => s.kind === 'partitions');
    return l && (!r || l.at > r.at) && p?.at >= l.at && document.querySelector('#urbanParcelStage [data-apply]')?.getAttribute('aria-busy') !== 'true';
  }, null, { timeout: 120000 });
  // Generated:true normally restores automatically. Trigger only if the final plan has no current scene and no active generation.
  await page.waitForTimeout(600);
  const state = await page.evaluate(() => ({ sceneAt: window.__roman.sceneAt ?? 0, parcelsAt: window.__roman.stages.findLast(s => s.kind === 'partitions').at,
    busy: document.querySelector('[data-buildings-generate]')?.getAttribute('aria-busy') === 'true' }));
  if (state.sceneAt < state.parcelsAt && !state.busy) {
    await page.locator('[data-buildings-generate]').evaluate(button => { for (let p = button.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true; });
    await page.locator('[data-buildings-generate]').click(); report.manualGenerate = true;
  }
  report.stage = 'silhouettes ready';
  await page.locator('#focusCity').click();
  await page.waitForFunction(() => window.__roman.sceneAt > window.__roman.stages.findLast(s => s.kind === 'partitions').at
    && Number(document.querySelector('[data-city-frame]')?.dataset.buildingsPainted ?? 0) > 0
    && document.querySelector('[data-buildings-generate]')?.getAttribute('aria-busy') !== 'true', null, { timeout: 120000 });
  await Promise.all([...pending]);
  const last = kind => responses.filter(r => r.kind === kind).sort((a, b) => b.receivedAt - a.receivedAt)[0];
  const layouts = last('quarters')?.data.layouts ?? [], partitions = last('parcels')?.data.partitions ?? [], requests = last('buildingSites')?.data.placementRequests ?? [];
  const scene = await page.evaluate(() => window.__roman.scene);
  await writeFile(resolve(out, 'silhouette-scene.json'), JSON.stringify(scene));
  report.inputs = { quarters: last('quarters')?.prefix, parcels: last('parcels')?.prefix, sites: last('buildingSites')?.prefix };
  const ports = layouts.flatMap(layout => (layout.structure?.districts ?? []).filter(d => d.role === 'port').map(d => ({ layout, district: d, blocks: layout.blocks.filter(b => d.quarters.includes(b.quarter)) })));
  const coords = ports.flatMap(p => p.blocks.flatMap(b => b.shape.outer));
  const bounds = coords.length ? { minX: Math.min(...coords.map(p => p.x)), minY: Math.min(...coords.map(p => p.y)), maxX: Math.max(...coords.map(p => p.x)), maxY: Math.max(...coords.map(p => p.y)) } : undefined;
  report.geometry = { layouts: layouts.length, blocks: layouts.reduce((n, l) => n + l.blocks.length, 0), parcels: partitions.reduce((n, p) => n + p.parcels.length, 0), sites: requests.length,
    silhouettes: scene.buildings.length, opens: scene.open_spaces.length, ports: ports.map(p => ({ district: p.district, blocks: p.blocks.length })), portBounds: bounds,
    quayStreets: layouts.flatMap(l => l.streets).filter(s => s.role === 'quay').length };
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const capture = async name => {
    await settle();
    report.captures.push(await page.evaluate(name => ({ name, view: window.magnaBenchContext.capture().view, viewBox: document.querySelector('#map').getAttribute('viewBox'),
      frame: document.querySelector('[data-city-frame]')?.textContent, data: { ...document.querySelector('[data-city-frame]')?.dataset },
      architecture: document.querySelector('[data-city-architecture]')?.value, palette: document.querySelector('[data-render="palette"]')?.value }), name));
    await page.locator('#viewport').screenshot({ path: resolve(out, `${name}.png`) });
  };
  await page.locator('#focusCity').click(); await capture('01-overview');
  await page.evaluate(() => window.magnaBenchContext.restore({ view: { cx: 2639.9315590685324, cy: 2668.9433913724934, scale: 1 / .4 } })); await capture('02-centre');
  if (!bounds) throw new Error('No port district found; no arbitrary port camera substituted.');
  const mpp = Math.max(.35, (bounds.maxX - bounds.minX + 140) / 1200, (bounds.maxY - bounds.minY + 140) / 925);
  await page.evaluate(({ bounds, mpp }) => window.magnaBenchContext.restore({ view: { cx: (bounds.minX + bounds.maxX) / 2, cy: (bounds.minY + bounds.maxY) / 2, scale: 1 / mpp } }), { bounds, mpp }); await capture('03-port');
  report.worker = await page.evaluate(() => ({ stages: window.__roman.stages, errors: window.__roman.errors }));
  report.completed = true; report.stage = 'completed';
} catch (error) {
  report.errors.push(error.stack ?? String(error)); process.exitCode = 1;
  if (page) try {
    report.failure = await page.evaluate(() => ({ ready: window.magnaBenchContext?.ready(), view: window.magnaBenchContext?.capture().view,
      roads: document.querySelector('#roadStatus')?.textContent, roadsBusy: document.querySelector('#roadStage')?.getAttribute('aria-busy'),
      stages: window.__roman?.stages, sceneAt: window.__roman?.sceneAt, buildings: window.__roman?.scene?.buildings?.length,
      frame: document.querySelector('[data-city-frame]')?.textContent, workerErrors: window.__roman?.errors }));
    await page.locator('#viewport').screenshot({ path: resolve(out, 'failure.png') });
  } catch (captureError) { report.errors.push(`Failure capture: ${captureError}`); }
}
finally { await Promise.all([...pending]); await browser.close(); await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ out, completed: report.completed, errors: report.errors, geometry: report.geometry, captures: report.captures }, null, 2));
