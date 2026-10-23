/** Exact Java 100k user URL, one run on existing services. No eager detail or comparison. */
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createArchitectureBenchEvidence, recordDetailHttpFailure } from './architecture_bench_evidence.mjs';

const out = resolve(process.argv[2] ?? 'out/javanese-user-10-8791');
await mkdir(out, { recursive: true });
const url = (await readFile('../_agents_blackboard/javanese-user-url.txt', 'utf8')).trim();
const started = Date.now(), elapsed = () => Date.now() - started;
const report = { started: new Date(started).toISOString(), url, runtime: JSON.parse(await readFile('../_agents_blackboard/LOCAL_RUNTIME.json', 'utf8')),
  source: 'Exact user URL, unchanged. Runtime8791 predates shore-safe, frontage and C1 programmes. One pipeline run; no comparison.',
  errors: [], warnings: [], network: [], captures: [], maxDetailConcurrency: 0 };
await writeFile(resolve(out, 'url.txt'), url);
await copyFile('../_agents_blackboard/javanese-user-options.json', resolve(out, 'input-options.json'));
const pending = new Set(), active = new Map(), detailActive = new Set(); let serial = 0;
const detailEvidence = createArchitectureBenchEvidence();
const browser = await chromium.launch({ channel: 'msedge', headless: true }); let page;
const log = async stage => { report.stage = stage; console.log(JSON.stringify({ stage, atMs: elapsed() })); await writeFile(resolve(out, 'progress.json'), JSON.stringify({ stage, atMs: elapsed(), network: report.network }, null, 2)); };
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
  page.on('pageerror', e => report.errors.push(String(e)));
  page.on('request', request => {
    const u = new URL(request.url()); if (u.origin !== 'http://127.0.0.1:8791' || request.method() !== 'POST') return;
    const entry = { path: u.pathname, startMs: elapsed(), requestBytes: request.postDataBuffer()?.length ?? 0 };
    active.set(request, entry); report.network.push(entry);
    if (u.pathname === '/houses/realize-plan') { detailActive.add(request); report.maxDetailConcurrency = Math.max(report.maxDetailConcurrency, detailActive.size); }
    if (['/houses/placement', '/houses/generate', '/houses/enrich'].includes(u.pathname)) report.errors.push(`Unexpected eager route: ${u.pathname}`);
  });
  const finish = request => { const entry = active.get(request); if (entry) entry.endMs = elapsed(); active.delete(request); detailActive.delete(request); };
  page.on('requestfinished', finish); page.on('requestfailed', request => { const entry = active.get(request); if (entry) entry.error = request.failure()?.errorText; finish(request); });
  page.on('response', response => {
    const request = response.request(), u = new URL(response.url());
    if (u.origin !== 'http://127.0.0.1:8791') return;
    if (u.pathname === '/status') {
      const task = response.json().then(data => writeFile(resolve(out, 'native-status.json'), JSON.stringify(data, null, 2))).catch(e => report.warnings.push(`Status: ${e}`)); pending.add(task); task.finally(() => pending.delete(task));
    }
    const entry = active.get(request); if (!entry) return; entry.status = response.status();
    if (u.pathname === '/houses/realize-plan' && entry.status >= 400) {
      const task = recordDetailHttpFailure(response, detailEvidence); pending.add(task); task.finally(() => pending.delete(task));
    }
    if (u.pathname !== '/urban') return;
    const body = request.postDataJSON(); entry.kind = body?.kind;
    if (!['quarters', 'parcels', 'buildingSites', 'buildingSitesBegin', 'buildingSitesPage', 'buildingSite'].includes(body?.kind)) return;
    const prefix = `${String(++serial).padStart(3, '0')}-${body.kind}`;
    const task = (async () => {
      const raw = await response.text(), value = JSON.parse(raw), data = value.data ?? value;
      const { session, source, sourceId, ...replay } = body;
      const saved = { ...replay, ...(source ? { source: { version: source.version, runtimeOnly: true } } : {}), ...(sourceId ? { pagedQueryRuntimeOnly: true } : {}) };
      const { urbanSource, sourceId: responseSourceId, ...retained } = data;
      await writeFile(resolve(out, `${prefix}-request.json`), JSON.stringify(saved));
      await writeFile(resolve(out, `${prefix}-response.json`), JSON.stringify(retained));
      Object.assign(entry, { requestFile: `${prefix}-request.json`, responseFile: `${prefix}-response.json`, responseBytes: Buffer.byteLength(raw), responseSha256: createHash('sha256').update(raw).digest('hex'), runtimeReferencesOmitted: Boolean(session || source || sourceId || urbanSource || responseSourceId),
        ...(body.kind === 'quarters' ? { layouts: retained.layouts?.length, blocks: retained.layouts?.reduce((n,l) => n + l.blocks.length, 0) } : {}),
        ...(body.kind === 'parcels' ? { partitions: retained.partitions?.length, parcels: retained.partitions?.reduce((n,p) => n + p.parcels.length, 0) } : {}),
        ...(['buildingSites', 'buildingSitesPage'].includes(body.kind) ? { sites: retained.placementRequests?.length, offset: retained.offset, next: retained.next, total: retained.total } : {}) });
    })().catch(e => report.errors.push(`Archive ${prefix}: ${e}`)); pending.add(task); task.finally(() => pending.delete(task));
  });
  const installProbe = createEvidence => {
    const probe = window.__java = { stages: {}, runs: {}, errors: [], firstPaint: null };
    const evidence = new Map();
    window.__javaEvidence = () => Object.fromEntries([...evidence].map(([id, item]) => [id, item.snapshot()]));
    const add = (map, key) => { if (key) map[key] = (map[key] ?? 0) + 1; };
    const Base = window.Worker;
    window.Worker = class extends Base { constructor(...args) { super(...args); this.addEventListener('message', e => {
      const d = e.data, at = performance.now();
      if (d?.roads) probe.stages.roads = { at, segments: d.roads.segments?.length, ms: d.roads.ms };
      if (d?.layouts) probe.stages.layouts = { at, count: d.layouts.length, blocks: d.layouts.reduce((n,l) => n + l.blocks.length, 0) };
      if (d?.partitions) probe.stages.partitions = { at, count: d.partitions.length, parcels: d.partitions.reduce((n,p) => n + p.parcels.length, 0), diagnostics: d.partitions.map(p => p.diagnostics) };
      if (d?.error) probe.errors.push({ at, id: d.id, error: d.error });
      const scene = d?.batch?.delta ?? d?.scene;
      if (!scene && !d?.complete) return;
      if (!evidence.has(d.id)) evidence.set(d.id, createEvidence());
      evidence.get(d.id).consumeMessage(d);
      const run = probe.runs[d.id] ??= { id: d.id, firstAt: at, batches: 0, accepted: 0, refused: 0, openSpaces: 0, recipes: {}, variants: {}, refusalCodes: {}, refusalSamples: [] };
      if (scene) {
        run.batches += Number(Boolean(d.batch)); run.generatorVersion = scene.generator_version;
        run.accepted += scene.buildings?.length ?? 0; run.refused += scene.refusals?.length ?? 0; run.openSpaces += scene.open_spaces?.length ?? 0;
        for (const b of scene.buildings ?? []) { add(run.recipes, b.recipe_id); add(run.variants, `${b.recipe_id}::${b.variant_id}`); }
        for (const r of scene.refusals ?? []) { add(run.refusalCodes, r.code); if (run.refusalSamples.length < 40) run.refusalSamples.push(r); }
      }
      if (d.batch) run.progress = d.batch.progress;
      if (d.complete || d.scene) run.final = { at, counts: d.complete ?? { buildings: run.accepted, refusals: run.refused, open_spaces: run.openSpaces }, timing: d.timing };
    }); } };
    function tick(at) { const frame = document.querySelector('[data-city-frame]'); if (Number(frame?.dataset.buildingsPainted) > 0) probe.firstPaint ??= { at, data: { ...frame.dataset } }; requestAnimationFrame(tick); }
    requestAnimationFrame(tick);
  };
  await page.addInitScript({ content: `(${installProbe.toString()})(${createArchitectureBenchEvidence.toString()});` });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await log('terrain ready'); await page.waitForFunction(() => window.magnaBenchContext?.ready(), null, { timeout: 180000 });
  await log('roads ready'); await page.waitForFunction(() => document.querySelector('#roadStage')?.getAttribute('aria-busy') !== 'true' && /^Rust\s*·/.test(document.querySelector('#roadStatus')?.textContent ?? ''), null, { timeout: 180000 });
  await page.waitForTimeout(500);
  await log('urban ready'); await page.waitForFunction(() => { const { roads:r, layouts:l, partitions:p } = window.__java.stages; return l && (!r || l.at > r.at) && p?.at >= l.at && document.querySelector('#urbanParcelStage [data-apply]')?.getAttribute('aria-busy') !== 'true'; }, null, { timeout: 180000 });
  await page.waitForTimeout(600);
  const state = await page.evaluate(() => ({ started: Object.values(window.__java.runs).some(r => r.firstAt > window.__java.stages.partitions.at), busy: document.querySelector('[data-buildings-generate]')?.getAttribute('aria-busy') === 'true' }));
  if (!state.started && !state.busy) { await page.locator('[data-buildings-generate]').evaluate(b => { for (let p=b.parentElement;p;p=p.parentElement) if(p.tagName==='DETAILS') p.open=true; }); await page.locator('[data-buildings-generate]').click(); report.manualGenerate = true; }
  await log('native plans terminal');
  await page.waitForFunction(() => Object.values(window.__java.runs).some(r => r.final?.at > window.__java.stages.partitions.at) && document.querySelector('[data-buildings-generate]')?.getAttribute('aria-busy') !== 'true', null, { timeout: 180000 });
  await Promise.all([...pending]);
  const snapshot = () => page.evaluate(() => ({ probe: { ...window.__java, architectureEvidence: window.__javaEvidence() }, view: window.magnaBenchContext.capture().view, viewBox: document.querySelector('#map').getAttribute('viewBox'), frame: document.querySelector('[data-city-frame]')?.textContent,
    frameData: { ...document.querySelector('[data-city-frame]')?.dataset }, counts: document.querySelector('[data-city-building-counts]')?.textContent, countsData: { ...document.querySelector('[data-city-building-counts]')?.dataset }, status: document.querySelector('[data-buildings-status]')?.textContent, architecture: document.querySelector('[data-city-architecture]')?.value }));
  report.terminal = await snapshot();
  if (report.terminal.architecture !== 'detailed') throw new Error('Exact URL architecture was not restored as detailed.');
  const capture = async name => { await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); report.captures.push({ name, atMs: elapsed(), ...await snapshot() }); await page.locator('#viewport').screenshot({ path: resolve(out, `${name}.png`) }); };
  await page.locator('#focusCity').click(); await page.waitForTimeout(750); await capture('01-overview');
  await log('bounded visible centre details');
  await page.evaluate(() => window.magnaBenchContext.restore({ view: { cx: 8000, cy: 8000, scale: 5 } }));
  await page.waitForTimeout(1500);
  try { await page.waitForFunction(() => Number(document.querySelector('[data-city-frame]')?.dataset.detailInFlight ?? 0) === 0, null, { timeout: 45000 }); } catch { report.warnings.push('Centre details exceeded45s snapshot budget; plans retained, physical calls drain below.'); }
  await capture('02-centre');
  // Move back to overview to stop scheduling close details, without aborting in-flight native CPU work.
  await page.locator('#focusCity').click();
  report.completed = true; await log('completed');
} catch (error) {
  report.errors.push(error.stack ?? String(error)); process.exitCode = 1;
  if (page) try { report.failure = await page.evaluate(() => ({ probe: { ...window.__java, architectureEvidence: window.__javaEvidence?.() }, view: window.magnaBenchContext?.capture().view, frame: document.querySelector('[data-city-frame]')?.textContent, counts: document.querySelector('[data-city-building-counts]')?.textContent, status: document.querySelector('[data-buildings-status]')?.textContent })); await page.locator('#viewport').screenshot({ path: resolve(out, 'failure.png') }); await page.locator('#focusCity').click(); } catch(e) { report.errors.push(`Failure capture: ${e}`); }
} finally {
  const drainStart = Date.now(); while (active.size && Date.now() - drainStart < 60000) await new Promise(r => setTimeout(r, 250));
  await Promise.all([...pending]); report.drain = { ms: Date.now()-drainStart, physicalRemaining: active.size, detailRemaining: detailActive.size };
  report.detailRefusals = { ...detailEvidence.snapshot().detailRefusals,
    scope: 'HTTP failures of existing exterior requests only; separate from plan refusals and client validation failures.' };
  report.ended = new Date().toISOString(); report.wallMs = elapsed(); await browser.close();
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ out, completed: report.completed, stage: report.stage, errors: report.errors, wallMs: report.wallMs, terminal: report.terminal?.counts, maxDetailConcurrency: report.maxDetailConcurrency, drain: report.drain }, null, 2));
