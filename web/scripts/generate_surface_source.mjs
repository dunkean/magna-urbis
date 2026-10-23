/** Fresh Infinite Generation proof. Run with node --import tsx; never substitutes a heightfield fixture or noise source. */
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { decodeSurfaceBinary, encodeSurfaceBinary } from '../src/surface/binary.ts';
import { compileSurfaceWorld } from '../src/surface/compiler.ts';
import { hashString } from '../src/surface/model.ts';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const base = option('--url', 'http://127.0.0.1:5197').replace(/\/$/, '');
const neural = option('--neural', 'http://127.0.0.1:8893').replace(/\/$/, '');
const width = Number(option('--width', '40000')), seed = option('--seed', 'surface-proof-40km');
const decoderModel = option('--decoder-model', undefined);
const timeoutMs = Number(option('--timeout-ms', '900000'));
const out = resolve(option('--out', 'out/surface/real40km'));
if (!Number.isFinite(width) || width < 500 || width > 100000 || !(timeoutMs > 0)) throw new Error('Invalid source dimensions/timeout');
await mkdir(out, { recursive: true });
const began = Date.now(), errors = [], network = [], progress = [], sessions = [];
const paths = { report: resolve(out, 'report.json'), progress: resolve(out, 'progress.json'), screenshot: resolve(out, 'fresh-source.png'),
  source: resolve(out, 'fresh-source.surfacebin'), live: resolve(out, 'live-refinement.surfacebin'), neuralHeightfield: resolve(out, 'fresh-neural-heightfield.f32') };
const report = { format: 'magna-fresh-source-proof', version: 1, startedAt: new Date(began).toISOString(), base, neural, widthM: width, seed,
  requestedSource: 'neural-python', freshGeneration: true, paths, errors, network, progress, status: 'starting' };
if (decoderModel) report.requestedModels = { decoderModel };
const save = async () => writeFile(paths.report, JSON.stringify(report, null, 2));
const serviceStatus = async () => {
  try { return await fetch(`${neural}/status`, { signal: AbortSignal.timeout(5000) }).then(r => r.json()); }
  catch (error) { return { error: String(error) }; }
};
const summarizeBody = value => {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.length > 16 ? { type: 'array', length: value.length, first: value.slice(0, 4) } : value.map(summarizeBody);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, key === 'heights' ? `<${String(entry).length} base64 chars>` : summarizeBody(entry)]));
};
report.initialService = await serviceStatus(); await save();
const cachedBrowser = process.env.LOCALAPPDATA && resolve(process.env.LOCALAPPDATA, 'ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-win64/chrome-headless-shell.exe');
const browser = await chromium.launch({ ...(cachedBrowser && existsSync(cachedBrowser) ? { executablePath: cachedBrowser } : { channel: option('--channel', 'msedge') }),
  headless: true, args: ['--use-angle=swiftshader'] });
process.once('SIGINT', () => { report.interrupted = true; void browser.close(); });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  // Other agents may edit the dev checkout during this proof. Ignore development hot reloads in this isolated tab only.
  report.suppressedDevelopmentUpdates = 0;
  await page.routeWebSocket(url => url.host === new URL(base).host, route => {
    const server = route.connectToServer();
    server.onMessage(message => {
      let event; try { event = JSON.parse(String(message)); } catch {}
      if (event?.type === 'full-reload' || event?.type === 'update') { report.suppressedDevelopmentUpdates++; return; }
      route.send(message);
    });
  });
  await page.exposeFunction('recordFreshSurfaceSession', sessionId => { sessions.push(sessionId); console.log(`Live source session: ${sessionId}`); });
  await page.addInitScript(() => {
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      constructor(...options) {
        super(...options);
        this.addEventListener('ready', event => { try { window.recordFreshSurfaceSession(JSON.parse(event.data).sessionId); } catch {} });
      }
    };
  });
  page.on('pageerror', error => { errors.push({ type: 'pageerror', message: String(error), elapsedMs: Date.now() - began }); console.error(String(error)); });
  page.on('console', message => {
    if (message.type() === 'error') { errors.push({ type: 'console', message: message.text(), elapsedMs: Date.now() - began }); console.error(message.text()); }
  });
  page.on('requestfailed', request => {
    const entry = { type: 'requestfailed', url: request.url(), message: request.failure()?.errorText, elapsedMs: Date.now() - began };
    network.push(entry); console.error(`${entry.url}: ${entry.message}`);
  });
  page.on('response', async response => {
    if (!response.url().startsWith(neural) || response.url().endsWith('/status')) return;
    const entry = { url: response.url(), status: response.status(), elapsedMs: Date.now() - began };
    network.push(entry);
    try {
      const metadata = response.headers()['x-neural-meta'];
      if (metadata) entry.meta = JSON.parse(metadata);
      if (response.url().includes('/generate?') && response.ok() && !report.neuralOutput) {
        const bodyBytes = await response.body();
        if (bodyBytes.length !== 1024 * 1024 * 4) throw new Error('Fresh neural output is not a 1024² FP32 heightfield');
        await writeFile(paths.neuralHeightfield, bodyBytes);
        report.neuralOutput = { path: paths.neuralHeightfield, bytes: bodyBytes.length, width: 1024, height: 1024,
          extentM: 40000, sampleSpacingM: 40000 / 1024, sourceStage: 'raw Python neural response before Magna reconstruction/hydrology',
          sha256: createHash('sha256').update(bodyBytes).digest('hex'), meta: entry.meta };
      }
      if (response.url().includes('/refinement/register')) entry.registration = await response.json();
      const body = response.request().postData();
      if (body && body.startsWith('{')) entry.request = summarizeBody(JSON.parse(body));
      if (!response.ok()) entry.error = (await response.text()).slice(0, 12000);
      console.log(JSON.stringify({ sourceResponse: entry }));
    } catch (error) { entry.captureError = String(error); }
  });
  const query = new URLSearchParams({ standalone: '1', profile: 'web', source: 'neural-python', neural, width: String(width), seed,
    relief: 'mountains', climate: 'temperate', auto: '0', render: 'svg' });
  if (decoderModel) query.set('decoderModel', decoderModel);
  report.url = `${base}/terrainbench.html?${query}`;
  console.log(`Generating fresh ${width / 1000} × ${width / 1000} km source ${seed}…`);
  await page.goto(report.url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  report.status = 'generating'; await save();
  let generated = false;
  while (Date.now() - began < timeoutMs) {
    const state = await page.evaluate(() => ({ ready: typeof window.magnaBenchContext?.ready === 'function' && window.magnaBenchContext.ready(),
      neuralState: document.querySelector('#neuralState')?.textContent ?? '', status: document.querySelector('#status')?.textContent ?? '',
      pipelineStatus: document.querySelector('#pipelineStatus')?.textContent ?? '',
      hydroStatus: document.querySelector('#hydroStatus')?.textContent ?? '', exportPresent: !!document.querySelector('#pipelineSurface') }));
    const entry = { elapsedMs: Date.now() - began, ...state, service: await serviceStatus() };
    progress.push(entry); await writeFile(paths.progress, JSON.stringify(entry, null, 2)); await save();
    console.log(JSON.stringify({ progress: entry }));
    if (state.ready && state.exportPresent && entry.service.generated > report.initialService.generated) { generated = true; break; }
    if (state.ready && /Rust engine error:|runtime unavailable|Service unavailable|generation failed/i.test(state.status)) throw new Error(`Fresh generation failed: ${state.status}`);
    if (entry.service.state === 'error') throw new Error(`Neural source failed: ${entry.service.message}`);
    if (errors.some(error => error.type === 'pageerror')) throw new Error('Fresh terrain generation reported a browser runtime error');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  if (!generated || !await page.evaluate(() => window.magnaBenchContext?.ready())) throw new Error('Fresh source generation timed out without an actual completed source calculation');
  await page.screenshot({ path: paths.screenshot, fullPage: false });
  const optionsSummary = page.locator('#pipelineTransfer details > summary');
  if (await optionsSummary.count()) await optionsSummary.click();
  console.log('Exporting fresh source as MUFSURF1…');
  const downloadPromise = page.waitForEvent('download', { timeout: 240000 });
  await page.locator('#pipelineSurface').click();
  const download = await downloadPromise; await download.saveAs(paths.source);
  const sourceBytes = await readFile(paths.source), packet = decodeSurfaceBinary(sourceBytes);
  const retainedWidth = packet.source.meta.width, sourceQuery = new URLSearchParams(packet.source.meta.query);
  if (retainedWidth !== width || packet.source.meta.seed !== seed || sourceQuery.get('source') !== 'neural-python') throw new Error('Exported source provenance does not match the requested fresh source');
  let min = Infinity, max = -Infinity;
  for (const h of packet.world.terrain.heights) { if (!Number.isFinite(h)) throw new Error('Non-finite fresh source height'); min = Math.min(min, h); max = Math.max(max, h); }
  report.source = { id: packet.source.meta.id, created: packet.source.meta.created, query: packet.source.meta.query, bytes: sourceBytes.length,
    grid: { width: packet.world.terrain.width, height: packet.world.terrain.height, spacingM: packet.world.terrain.spacingM },
    sourceIdentity: packet.world.terrain.source, heightRangeM: { min, max }, diagnostics: packet.world.diagnostics,
    climate: packet.world.climate, buildings: packet.urban.buildings.length };
  report.status = 'source-exported'; await save();
  if (args.includes('--native-packet')) {
    if (!report.neuralOutput) throw new Error('Cannot export a native packet without the actual captured neural response');
    const beganNative = performance.now(), raw = await readFile(paths.neuralHeightfield), n = 1024, spacingM = 40000 / n;
    const meta = report.neuralOutput.meta;
    const world = compileSurfaceWorld({ seed: parseInt(hashString(seed), 16), terrain: {
      width: n, height: n, spacingM, originX: spacingM / 2, originZ: spacingM / 2,
      heights: new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)),
      source: { id: `neural-response:${meta.neuralToken}`, version: meta.modelIdentity,
        sourceLOD: 0, sourceLODKnown: false, nativeSpacingM: spacingM,
        provenance: `Exact fresh Python /generate 1024² FP32 response over 40 km, before Magna reconstruction/hydrology; sha256=${report.neuralOutput.sha256}; model=${JSON.stringify(meta.selectedModels)}` },
    }, climate: packet.world.climate, hydrology: { version: 'raw-neural-no-source-routing-1',
      provenance: 'Raw neural height response contains no Magna drainage graph; D8 fallback is explicit, no source water geometry is claimed', boundary: 'truncated' } });
    const copiedHash = createHash('sha256').update(new Uint8Array(world.terrain.heights.buffer)).digest('hex');
    if (copiedHash !== report.neuralOutput.sha256) throw new Error('Native packet changed source height samples');
    const nativePacket = { format: 'magna-surface-packet', version: 1, world,
      urban: { buildings: [], occupationBuildings: [], roads: [] }, candidates: [],
      source: { meta: { id: `raw-neural-${seed}`, seed, width: 40000, created: new Date().toISOString(), query: new URL(report.url).search.slice(1) },
        generation: meta, sourceStage: report.neuralOutput.sourceStage, heightfieldSha256: copiedHash,
        limitation: 'Independent raw-neural context for geometry stress. It does not claim the retained Magna hydrology or UI context.' } };
    const nativeBytes = encodeSurfaceBinary(nativePacket), path = resolve(out, 'raw-neural-1024.surfacebin');
    await writeFile(path, nativeBytes);
    report.nativePacket = { path, bytes: nativeBytes.length, grid: { width: n, height: n, spacingM }, sha256: copiedHash, durationMs: performance.now() - beganNative };
    console.log(JSON.stringify({ nativePacket: report.nativePacket })); await save();
  }
  if (!sessions.length) throw new Error('Fresh browser did not register its live source session');
  const region = { x: width / 2 - 20, y: width / 2 - 20, extent: 40, resolution: 64 };
  console.log('Refining the fresh source through its retained neural token and compiler worker…');
  const liveStarted = Date.now();
  const response = await fetch(`${base}/surface-live/terrain`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: sessions.at(-1), region }), signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Fresh live refinement failed: ${response.status} ${await response.text()}`);
  const liveBytes = new Uint8Array(await response.arrayBuffer()); await writeFile(paths.live, liveBytes);
  const live = decodeSurfaceBinary(liveBytes);
  const registrations = network.filter(entry => entry.registration).map(entry => entry.registration);
  const decoderUsed = registrations.some(registration => registration.decoderUsed === true) || live.world.terrain.source.provenance?.includes('decoderUsed=true');
  report.live = { region, bytes: liveBytes.length, durationMs: Date.now() - liveStarted, source: live.world.terrain.source,
    grid: { width: live.world.terrain.width, height: live.world.terrain.height, spacingM: live.world.terrain.spacingM },
    contextId: live.world.canonicalContextRef?.id, includesCanonicalContext: !!live.world.canonicalContext, decoderUsed, registrations };
  if (!live.world.terrain.source.sourceLODKnown || !live.world.canonicalContext || !decoderUsed) throw new Error('Fresh refinement did not prove a decoder-backed source level and canonical context');
  report.finalService = await serviceStatus(); report.status = 'complete'; report.durationMs = Date.now() - began;
  await page.screenshot({ path: resolve(out, 'fresh-source-after-refinement.png') });
  await save(); console.log(JSON.stringify({ result: { status: report.status, durationMs: report.durationMs, widthM: width,
    sourceBytes: report.source.bytes, neuralOutput: report.neuralOutput, live: report.live, paths, errors } }));
} catch (error) {
  report.status = 'failed'; report.failure = String(error); report.finalService = await serviceStatus(); report.durationMs = Date.now() - began;
  await save(); throw error;
} finally { await browser.close(); }
