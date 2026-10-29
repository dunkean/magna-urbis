/** Real City Bench architecture smoke, 01-l / 100,000 inhabitants.
 * From web/: node scripts/city_architecture_progress_smoke.mjs [--server http://127.0.0.1:8810]
 *   [--bench http://127.0.0.1:5173/citybench.html] [--out ../web/out/work/city-architecture-progress-smoke]
 *   [--complete] [--timeout-ms 300000] [--headed]
 * Replays ONLY frozen /urban quarters, parcels and buildingSites. The decor/raster
 * loads normally; all house plans and exterior details use the actual server.
 * Default: prove partial painting, navigation and close detail, then stop dispatch
 * and drain physical calls. --complete also waits for the entire city plan.
 * Never starts, stops or rebuilds a server. Legacy eager routes are blocked.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const args = process.argv.slice(2), root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const option = (key, fallback) => {
  const equal = args.find(arg => arg.startsWith(`--${key}=`));
  if (equal) return equal.slice(key.length + 3);
  const i = args.indexOf(`--${key}`); return i >= 0 ? args[i + 1] : fallback;
};
const server = option('server', 'http://127.0.0.1:8810').replace(/\/$/, '');
const bench = option('bench', 'http://127.0.0.1:5173/citybench.html');
const corpus = resolve(option('corpus', resolve(root, 'web/out/work/city-visual-audit/01-l')));
const output = resolve(option('out', resolve(root, 'web/out/work/city-architecture-progress-smoke')));
const timeout = Number(option('timeout-ms', '300000')), complete = args.includes('--complete');
await mkdir(output, { recursive: true });
const [source, quarterRequest, layout, partition, requests] = await Promise.all(
  ['source', 'quarters-request', 'layout', 'partition', 'requests'].map(async name => JSON.parse(await readFile(resolve(corpus, `${name}.json`), 'utf8'))));
assert.equal(source.population, 100000, 'This smoke requires the frozen 100k scene.');
assert.equal(source.decor, 'city-01-river-plain-l');
const payloads = { quarters: `"layouts":[${JSON.stringify(layout)}]`, parcels: `"partitions":[${JSON.stringify(partition)}]`,
  buildingSites: `"placementRequests":${JSON.stringify(requests)}` };
const started = performance.now(), elapsed = () => Math.round(performance.now() - started);
const report = { started: new Date().toISOString(), server, bench, corpus, source,
  scope: 'Architecture integration on the real City Bench. Urban stages replayed; house generation live. This is not an end-to-end city-generation benchmark.',
  completeRequested: complete, sourceCounts: { blocks: layout.blocks.length, parcels: partition.parcels.length, requests: requests.length },
  replay: [], houses: [], rasterUploads: [], pageLoads: [], ignoredHmr: [], forbiddenEagerCalls: [], blockedAfterObservation: [], errors: [], consoleErrors: [], requestFailures: [], captures: [] };
let browser, context, page, stopping = false, observationDone = false, physical = 0, detailsPhysical = 0, detailPeak = 0;
const active = new Map(), responseReads = new Set();
const track = promise => { responseReads.add(promise); promise.finally(() => responseReads.delete(promise)); };
const pause = ms => new Promise(done => setTimeout(done, ms));
async function until(predicate, label, limit = timeout) {
  const before = performance.now();
  while (!predicate()) {
    assert.equal(report.forbiddenEagerCalls.length, 0, `Legacy eager route attempted: ${JSON.stringify(report.forbiddenEagerCalls)}`);
    if (performance.now() - before > limit) throw new Error(`Timed out: ${label}`);
    await pause(100);
  }
}
async function ui() {
  return page.evaluate(() => {
    const count = document.querySelector('[data-city-building-counts]'), frame = document.querySelector('[data-city-frame]');
    const canvas = document.querySelector('[data-city-canvas] canvas');
    let paintedPixels = 0;
    if (canvas) { const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i]) paintedPixels++; }
    return { status: document.querySelector('[data-buildings-status]')?.textContent,
      architecture: document.querySelector('[data-city-architecture]')?.value,
      busy: document.querySelector('[data-buildings-generate]')?.getAttribute('aria-busy'),
      counts: count?.textContent, countsData: { ...count?.dataset }, frame: frame?.textContent, frameData: { ...frame?.dataset },
      camera: window.magnaBenchContext?.capture(), canvas: canvas && { width: canvas.width, height: canvas.height, paintedPixels },
      svgBuildingNodes: document.querySelectorAll('[data-urban-building]').length, probe: window.__architectureProgressSmoke };
  });
}
async function capture(name) {
  const data = await ui();
  await page.locator('#viewport').screenshot({ path: resolve(output, `${name}.png`) });
  report.captures.push({ name, atMs: elapsed(), ...data });
  return data;
}
async function camera(cx, cy, scale) {
  await page.evaluate(view => window.magnaBenchContext.restore({ view }), { cx, cy, scale });
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
}

try {
  const health = await fetch(`${server}/status`, { signal: AbortSignal.timeout(5000) });
  report.nativeStatus = await health.json();
  assert(health.ok && report.nativeStatus.capabilities?.includes('houses.compact-plans'), 'Actual compact-plan native service is required.');
  browser = await chromium.launch({ headless: !args.includes('--headed'), channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined), args: ['--disable-gpu'] });
  context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  await context.grantPermissions(['local-network-access'], { origin: new URL(bench).origin });
  // Concurrent agents may save unrelated files while this browser is observing.
  // Keep the loaded app stable: suppress only Vite update/reload notifications.
  // Pings, error overlays and every application message still reach the page.
  await context.routeWebSocket(url => url.host === new URL(bench).host, socket => {
    const upstream = socket.connectToServer();
    upstream.onMessage(message => {
      let data; try { data = JSON.parse(String(message)); } catch { /* Non-JSON is passed through. */ }
      if (data?.type === 'update' || data?.type === 'full-reload') {
        report.ignoredHmr.push({ atMs: elapsed(), message: data }); return;
      }
      socket.send(message);
    });
  });
  // Context-level interception includes dedicated workers. This is a frozen input
  // witness, deliberately independent of the concurrently edited urban operators.
  await context.route('**/urban', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const input = route.request().postDataJSON(), fragment = payloads[input.kind];
    if (!fragment) return route.continue();
    report.replay.push({ kind: input.kind, id: input.id, atMs: elapsed(), url: route.request().url(), bytes: Buffer.byteLength(fragment) });
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: `{"id":${JSON.stringify(input.id)},${fragment},"ms":0}` });
  });
  await context.route('**/houses/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() !== 'POST') return route.continue();
    if (['/houses/placement', '/houses/generate', '/houses/enrich'].includes(path)) {
      report.forbiddenEagerCalls.push({ path, atMs: elapsed() });
      return route.fulfill({ status: 409, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"error":"Smoke blocked legacy eager architecture."}' });
    }
    if (!['/houses/plans', '/houses/realize-plan'].includes(path)) return route.continue();
    if (stopping) {
      report.blockedAfterObservation.push({ path, atMs: elapsed() });
      return route.fulfill({ status: 409, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"error":"Smoke observation complete; no further native work dispatched."}' });
    }
    assert.equal(new URL(request.url()).origin, new URL(server).origin, 'House request escaped the selected native server.');
    const input = request.postDataJSON(), detail = path.endsWith('/realize-plan');
    const entry = { path, startMs: elapsed(), inputs: input.requests?.length, id: input.building?.id, interiors: input.interiors };
    report.houses.push(entry); active.set(request, entry); physical++;
    if (detail) { detailsPhysical++; detailPeak = Math.max(detailPeak, detailsPhysical); }
    await route.continue();
  });
  context.on('response', response => {
    const entry = active.get(response.request()); if (!entry) return;
    entry.httpStatus = response.status();
    track((async () => {
      try {
        await response.finished();
        const envelope = await response.json(), data = envelope.data ?? envelope;
        entry.responseOk = envelope.ok !== false && response.ok();
        if (entry.path.endsWith('/plans')) {
          entry.buildings = data.buildings?.length; entry.refusals = data.refusals?.length; entry.openSpaces = data.open_spaces?.length;
          entry.meshVertices = data.buildings?.reduce((sum, b) => sum + b.volumes.reduce((n, v) => n + v.roof_mesh.vertices.length, 0), 0);
        } else {
          entry.units = data.units?.length; entry.meshFaces = data.units?.reduce((sum, unit) => sum + unit.roofs.faces.length, 0);
        }
        if (!entry.responseOk) entry.error = envelope.error ?? data.error;
      } catch (error) { entry.readError = String(error); }
    })());
  });
  context.on('requestfinished', request => {
    if (new URL(request.url()).pathname === '/raster') report.rasterUploads.push({ finishedMs: elapsed(), timing: request.timing() });
    const entry = active.get(request); if (!entry) return;
    entry.finishedMs = elapsed(); active.delete(request); physical--;
    if (entry.path.endsWith('/realize-plan')) detailsPhysical--;
  });
  context.on('requestfailed', request => {
    const entry = active.get(request); if (entry) entry.physicalCompletionUnknown = true;
    // An HTTP abort does not establish that Rust stopped. Do not free this slot.
    report.requestFailures.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText, atMs: elapsed(), trackedNative: Boolean(entry) });
  });
  await context.addInitScript(() => {
    const state = window.__architectureProgressSmoke = { documentOrigin: performance.timeOrigin, started: null, firstBatch: null, firstVisible: null, final: null,
      batches: [], candidates: [], statusChanges: [], frames: 0, maxFrameGapMs: 0, longTasks: 0, longTaskMs: 0, maxLongTaskMs: 0 };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...values) { super(...values); this.addEventListener('message', event => {
        const value = event.data;
        if (value?.partitions) state.parcelsAt = performance.now();
        if (!state.started) return;
        const batch = value?.batch, scene = batch?.delta ?? value?.scene;
        if (batch) {
          const progress = batch.progress ?? batch;
          const item = { atMs: performance.now() - state.started, completed: progress.completed, total: progress.total, buildings: scene?.buildings?.length ?? 0 };
          state.firstBatch ??= item; state.batches.push(item);
        }
        if (scene?.buildings?.length && !state.candidates.length) state.candidates = scene.buildings.slice(0, 64).map(building => {
          const points = building.roof_footprint.flatMap(polygon => polygon.outer);
          const xs = points.map(p => p.x), ys = points.map(p => p.y);
          return { id: building.id, recipe: building.recipe_id, cx: (Math.min(...xs) + Math.max(...xs)) / 2,
            cy: (Math.min(...ys) + Math.max(...ys)) / 2, size: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) };
        });
        if (value?.complete || (value?.scene && !batch)) state.final = { atMs: performance.now() - state.started, buildings: scene?.buildings?.length };
      }); }
    };
    try { new PerformanceObserver(list => { if (!state.started) return; for (const task of list.getEntries()) {
      state.longTasks++; state.longTaskMs += task.duration; state.maxLongTaskMs = Math.max(state.maxLongTaskMs, task.duration);
    } }).observe({ type: 'longtask', buffered: false }); } catch { /* Unsupported browser: RAF still measured. */ }
    let previous = 0, sampled = 0, previousStatus = '';
    const tick = now => {
      if (state.started) {
        state.frames++; if (previous) state.maxFrameGapMs = Math.max(state.maxFrameGapMs, now - previous); previous = now;
        if (now - sampled > 100) {
          sampled = now;
          const frame = document.querySelector('[data-city-frame]'), count = document.querySelector('[data-city-building-counts]');
          const text = frame?.textContent ?? '', status = document.querySelector('[data-buildings-status]')?.textContent ?? '';
          if (status !== previousStatus) { previousStatus = status; state.statusChanges.push({ atMs: now - state.started, status }); }
          const visible = Number(frame?.dataset.buildingsPainted ?? (text.match(/([\d\s\u00a0\u202f,.]+) bâtiments/)?.[1] ?? '').replace(/[^0-9]/g, ''));
          if (visible > 0 && !state.firstVisible) state.firstVisible = { atMs: now - state.started, visible, frame: text,
            planning: count?.dataset.planning, completed: count?.dataset.completed, total: count?.dataset.total,
            busy: document.querySelector('[data-buildings-generate]')?.getAttribute('aria-busy') };
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  page = await context.newPage();
  page.on('domcontentloaded', () => report.pageLoads.push({ atMs: elapsed(), url: page.url() }));
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  const settlements = { enabled: true, showPoints: true, config: { mode: 'list', distribution: 'classes',
    main: { key: 'main', population: 300, culture: 'european-organic', kind: 'settlement', siteType: 'auto', sitePrefs: {} },
    counts: { city: 0, town: 0, village: 0, hamlet: 0, farmstead: 0 },
    list: [{ key: layout.key, name: 'Plaine fluviale tempérée · 100 000', population: 100000, culture: layout.culture, kind: 'settlement', siteType: 'auto', sitePrefs: {}, position: layout.center }], relief: 'flat', density: 1 } };
  const urban = { enabled: true, parcelEnabled: true, target: layout.key, quarterSeed: quarterRequest.seed, parcelSeed: quarterRequest.seed,
    layoutConfig: quarterRequest.layoutConfig, parcelConfig: partition.config ?? { preset: 'culture', culture: 'site', recipe: 'auto', zone: 'auto', density: 1 },
    render: { view: 'parcels' }, architecture: 'silhouette', buildingState: { visible: true, generated: false, seed: quarterRequest.seed, appearance: { style: 'cartographic', diagnostic: 'none' } } };
  const url = new URL(bench);
  for (const [key, value] of Object.entries({ artifact: source.decor, standalone: '1', profile: 'local', localServer: server,
    settlements: JSON.stringify(settlements), urban: JSON.stringify(urban) })) url.searchParams.set(key, value);
  report.url = url.href;
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.magnaBenchContext?.ready(), null, { timeout: 120000 });
  await page.locator('[data-city-architecture]').waitFor({ state: 'attached', timeout: 30000 });
  await page.locator('[data-city-architecture]').evaluate(select => { for (let node = select.parentElement; node; node = node.parentElement) if (node.tagName === 'DETAILS') node.open = true; });
  // Routes compute independently at startup and their completion invalidates the
  // urban plan. Wait for their real result before the final replayed city stages.
  // Waiting only for an early parcel result can launch architecture too soon.
  await page.waitForFunction(() => document.querySelector('#roadStage')?.getAttribute('aria-busy') !== 'true'
    && /^Rust\s*·/.test(document.querySelector('#roadStatus')?.textContent ?? ''), null, { timeout: 120000 });
  report.roadsReady = { atMs: elapsed(), status: await page.locator('#roadStatus').textContent() };
  // The routes callback schedules the city stages with a short UI debounce.
  await page.waitForTimeout(500);
  // Restoring the city normally starts both stages. If it does not, use their UI.
  for (const [kind, id] of [['quarters', 'urbanQuarterStage'], ['parcels', 'urbanParcelStage']]) {
    if (!report.replay.some(item => item.kind === kind) && await page.locator(`#${id} [data-apply]`).getAttribute('aria-busy') !== 'true') await page.locator(`#${id} [data-apply]`).click();
    await until(() => report.replay.some(item => item.kind === kind), `${kind} replay`);
    await page.waitForFunction(id => document.querySelector(`#${id} [data-apply]`)?.getAttribute('aria-busy') !== 'true', id, { timeout });
  }
  await page.locator('#focusCity').click();
  await capture('00-urban-replay');
  await page.locator('[data-city-architecture]').selectOption('detailed');
  await page.evaluate(() => { window.__architectureProgressSmoke.started = performance.now(); });
  report.generationClickMs = elapsed();
  await page.locator('[data-buildings-generate]').click();
  await until(() => report.houses.some(item => item.path === '/houses/plans'), 'first live /houses/plans');
  await page.waitForFunction(() => window.__architectureProgressSmoke?.firstVisible, null, { timeout });
  const first = await capture('01-first-partial-plan');
  report.firstVisible = first.probe.firstVisible; report.firstBatch = first.probe.firstBatch;
  report.firstNativePlanDispatchMs = report.houses.find(item => item.path === '/houses/plans').startMs - report.generationClickMs;
  report.nativeDispatchToFirstPaintMs = report.firstVisible.atMs - report.firstNativePlanDispatchMs;
  assert(first.probe.firstBatch && first.probe.firstBatch.completed < first.probe.firstBatch.total, 'No streamed native partial batch was observed.');
  assert(first.probe.firstVisible.busy === 'true' || first.probe.firstVisible.planning === 'true', 'Buildings became visible only after planning finished.');
  assert(first.canvas?.paintedPixels > 0 && first.svgBuildingNodes === 0, 'Native building Canvas did not paint, or per-building SVG was inserted.');
  assert.equal(report.houses.filter(item => item.path.endsWith('/realize-plan')).length, 0, 'Overview started detailed native geometry.');

  // Actual pointer navigation while planning is still active, not a synthetic
  // benchmark-only renderer. Camera restore below only chooses a known building.
  const box = await page.locator('#viewport').boundingBox(); assert(box);
  const beforePan = first.camera.view, navigationStart = elapsed();
  await page.mouse.move(box.x + box.width * .52, box.y + box.height * .5);
  await page.mouse.down(); await page.mouse.move(box.x + box.width * .52 + 70, box.y + box.height * .5 + 30, { steps: 5 }); await page.mouse.up();
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  const afterPan = await ui();
  report.navigation = { elapsedMs: elapsed() - navigationStart, before: beforePan, after: afterPan.camera.view, busy: afterPan.busy,
    framesDuringGeneration: afterPan.probe.frames };
  assert(Math.hypot(beforePan.cx - afterPan.camera.view.cx, beforePan.cy - afterPan.camera.view.cy) > 1, 'Pointer pan did not move the camera.');
  assert(afterPan.probe.frames > 2, 'UI did not paint while native planning was active.');

  const candidate = first.probe.candidates.sort((a, b) => Math.hypot(a.cx - 8000, a.cy - 8000) - Math.hypot(b.cx - 8000, b.cy - 8000))[0];
  assert(candidate, 'First native batch has no retained building to inspect.');
  report.closeTarget = candidate;
  // Fits the retained building and crosses both automatic detail gates: .5 m/px
  // and 72 projected pixels. This is an actual accepted lot, never a fake proxy.
  await camera(candidate.cx, candidate.cy, Math.max(4, 100 / Math.max(1, candidate.size)));
  await capture('02-close-plan');
  await until(() => report.houses.some(item => item.path.endsWith('/realize-plan') && item.finishedMs !== undefined), 'close native exterior', 60000);
  await until(() => report.houses.some(item => item.path.endsWith('/realize-plan') && item.meshFaces > 0), 'successful native exterior', 60000);
  await page.waitForFunction(() => Number(document.querySelector('[data-city-frame]')?.dataset.detailCached ?? 0) > 0, null, { timeout: 30000 });
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  const detailed = await capture('03-close-native-detail');
  assert(detailPeak <= 2, `Too many simultaneous physical detail calls: ${detailPeak}`);
  assert(report.houses.filter(item => item.path.endsWith('/realize-plan')).every(item => item.interiors === false), 'Close view requested interiors.');
  assert(Number(detailed.frameData.detailCached) > 0, 'Native detail response was not installed in the visible renderer.');
  const beforeFarCalls = report.houses.filter(item => item.path.endsWith('/realize-plan')).length;
  await page.locator('#focusCity').click();
  await page.waitForTimeout(500);
  const overview = await capture('04-return-overview');
  assert.equal(overview.probe.documentOrigin, first.probe.documentOrigin, 'The page reloaded during observation (possibly a concurrent Vite update).');
  assert(Number(overview.frameData.buildingsPainted) > 0, 'The accepted native plans disappeared when returning to overview.');
  report.returnOverview = { beforeCalls: beforeFarCalls, afterCalls: report.houses.filter(item => item.path.endsWith('/realize-plan')).length, frame: overview.frame, frameData: overview.frameData };
  if (complete) {
    await page.waitForFunction(() => document.querySelector('[data-buildings-generate]')?.getAttribute('aria-busy') !== 'true', null, { timeout });
    const committed = await capture('05-completed-plan');
    assert(/^\s*[\d\s,.]+ bâtiments/.test(committed.status ?? ''), `Planning did not commit successfully: ${committed.status}`);
    assert(Number(committed.frameData.detailCached) >= Number(detailed.frameData.detailCached), 'Final scene commit discarded the retained detail cache.');
    const successful = new Set(report.houses.filter(item => item.path.endsWith('/realize-plan') && item.meshFaces > 0).map(item => item.id));
    const beforeRevisit = report.houses.length;
    await camera(candidate.cx, candidate.cy, Math.max(4, 100 / Math.max(1, candidate.size)));
    await page.waitForTimeout(300);
    const revisited = await capture('06-detail-after-commit');
    report.finalCommit = { status: committed.status, cachedBefore: Number(detailed.frameData.detailCached), cachedAfter: Number(committed.frameData.detailCached),
      cachedOnRevisit: Number(revisited.frameData.detailCached), repainted: Number(revisited.frameData.buildingsPainted),
      duplicateRealizations: report.houses.slice(beforeRevisit).filter(item => item.path.endsWith('/realize-plan') && successful.has(item.id)).map(item => item.id) };
    assert(report.finalCommit.repainted > 0 && report.finalCommit.cachedOnRevisit > 0, 'Retained detail did not paint after committing the full city.');
    assert.equal(report.finalCommit.duplicateRealizations.length, 0, 'Previously realized buildings were regenerated after the final scene commit.');
  }
  report.observed = await ui();
  assert.equal(report.observed.probe.documentOrigin, first.probe.documentOrigin, 'The page reloaded before the final observation.');
  report.cityPlanningComplete = report.observed.busy !== 'true' && /^\s*[\d\s,.]+ bâtiments/.test(report.observed.status ?? '');
  report.detailPeakPhysical = detailPeak;
  assert.equal(report.forbiddenEagerCalls.length, 0);
  assert(report.houses.filter(item => item.path.endsWith('/plans')).every(item => item.meshVertices === undefined || item.meshVertices === 0), 'Plan route eagerly generated roof meshes.');
  assert.equal(report.errors.length, 0, report.errors.join('\n'));
  assert.equal(report.requestFailures.filter(item => item.trackedNative).length, 0, 'A dispatched native HTTP request was aborted; physical concurrency is unknown.');
  observationDone = true; report.ok = true;
} catch (error) {
  report.ok = false; report.errors.push(error.stack ?? String(error)); process.exitCode = 1;
  if (page) try { report.failureUi = await page.locator('body').innerText(); await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }); } catch { /* Original error stays primary. */ }
} finally {
  // Stop ONLY future calls from this isolated browser context. Existing native
  // fetches drain before closing it, so cancellation cannot hide CPU concurrency.
  stopping = true;
  const drainStart = performance.now();
  while (physical > 0 && performance.now() - drainStart < 60000) await pause(100);
  await Promise.allSettled([...responseReads]);
  report.cleanup = { observationDone, drained: physical === 0, physicalRemaining: physical, durationMs: Math.round(performance.now() - drainStart),
    deliberatelyStoppedBeforeCityCompletion: observationDone && !report.cityPlanningComplete };
  if (physical > 0) { report.ok = false; process.exitCode = 1; report.errors.push('Native calls did not physically finish before the cleanup deadline.'); }
  await browser?.close();
  report.finished = new Date().toISOString(); report.totalMs = elapsed(); report.detailPeakPhysical = detailPeak;
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ ok: report.ok, population: source.population, replay: report.replay.map(item => item.kind),
  firstVisible: report.firstVisible, plans: report.houses.filter(item => item.path.endsWith('/plans')).length,
  details: report.houses.filter(item => item.path.endsWith('/realize-plan')).length, detailPeakPhysical: detailPeak,
  cityPlanningComplete: report.cityPlanningComplete, forbiddenEagerCalls: report.forbiddenEagerCalls, cleanup: report.cleanup,
  errors: report.errors, report: resolve(output, 'report.json') }, null, 2));
