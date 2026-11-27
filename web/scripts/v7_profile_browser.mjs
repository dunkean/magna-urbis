// One V2 page and native service for the reduced V7 profiling campaign.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { chromium } from 'playwright';

const [configPath, output] = process.argv.slice(2);
if (!configPath || !output) throw Error('Launch through v7_profile.py with a campaign manifest');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const now = () => performance.timeOrigin + performance.now();
const timeout = 300_000;
const gpuId = 0x2684;
const gpuEnvironment = { VK_LOADER_DEVICE_ID_FILTER: '0x2684', MAGNA_GPU_DEVICE_ID: '0x2684' };
const decorFiles = new Map(config.cases.map(c => [basename(c.decorFile), c.decorFile]));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.txt': 'text/plain' };
const traceCategories = ['blink.user_timing', 'devtools.timeline', 'v8', 'disabled-by-default-v8.cpu_profiler',
  'disabled-by-default-devtools.timeline', 'gpu', 'viz'];
// Use the same full-viewport framing as the V7 sheet, with app controls hidden.
const sheetFrame = `
  html, body, #app { width: 100% !important; height: 100% !important; overflow: hidden !important }
  .app-header, .workbench-bar, #sidebar, .mobile-toggle, .map-topbar, .map-bottom, .map-compass,
  .map-tools, .map-hint, .inspector-mode, .places-panel, .inspector, .toast, .hint, .legend-strip,
  .progress-card, .city3d-bar, .city3d-info, .city3d-help { visibility: hidden !important; pointer-events: none !important }
  .workspace, .map-area, .city3d { position: absolute !important; inset: 0 !important; height: 100vh !important; width: 100vw !important }
  .workspace { display: block !important }
`;
const report = { schema: 1, clock: 'Unix epoch ms', phases: [], cases: [], requests: [], diagnostics: [] };
let caseId = null;
const engineLog = createWriteStream(join(output, 'engine.ndjson'), { flags: 'wx' });
const save = () => writeFileSync(join(output, 'browser.json'), JSON.stringify(report, null, 2));
async function phase(name, run) {
  const span = { caseId, name, startMs: now() };
  report.phases.push(span);
  try {
    return await run();
  } catch (error) {
    span.error = String(error);
    throw error;
  } finally {
    span.endMs = now();
    save();
  }
}

// Serve the frozen bundle as an isolated origin. The decors are the bytes used
// by the V7 artifact. Stream them outside Chromium's DevTools request routing.
const server = createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);
    const root = resolve(config.dist);
    const file = pathname.startsWith('/decors/') ? decorFiles.get(basename(pathname)) : resolve(root, '.' + pathname);
    if (!file || (!pathname.startsWith('/decors/') && !file.startsWith(root + sep))) {
      res.writeHead(404).end();
      return;
    }
    const size = statSync(file).size;
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Content-Length': size,
      'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
    createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch {
    res.writeHead(404).end();
  }
});

function requestKind(request) {
  const data = request.postDataBuffer();
  if (!data?.length) return undefined;
  return data.subarray(0, 1024).toString('utf8').match(/"kind"\s*:\s*"([^"]+)"/)?.[1];
}

// Rust uses port zero so the profiling service never replaces the local engine.
async function startEngine() {
  const engine = spawn(config.engine, ['--port', '0'], {
    windowsHide: true,
    env: { ...process.env, ...gpuEnvironment, MAGNA_LOCAL_ADDR: '127.0.0.1:0', RAYON_NUM_THREADS: '12', URBAN_PROFILE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let port;
  const stdout = createInterface({ input: engine.stdout });
  const stderr = createInterface({ input: engine.stderr });
  engine.on('error', error => report.diagnostics.push({ caseId, atMs: now(), kind: 'engine', message: String(error) }));
  for (const [stream, lines] of [['stdout', stdout], ['stderr', stderr]]) {
    lines.on('line', line => {
      const lap = line.match(/^\s+([\w.\[\]-]+): ([\d.]+) ms$/);
      engineLog.write(JSON.stringify({
        receivedMs: now(), caseId, stream, line,
        ...(lap ? { probe: lap[1], reportedMs: Number(lap[2]) } : {}),
      }) + '\n');
      if (stream === 'stdout' && line.startsWith('{')) {
        try { const ready = JSON.parse(line); if (ready.ready) port = ready.port; } catch { /* raw line retained */ }
      }
    });
  }
  try {
    const until = now() + 30_000;
    while (!port) {
      if (engine.exitCode !== null || now() > until) throw Error('Native profiling engine did not open its socket');
      await new Promise(r => setTimeout(r, 25));
    }
    return { engine, port };
  } catch (error) {
    engine.kill();
    throw error;
  }
}

async function waitForPaint(page) {
  // Moving the camera alone can reuse the current display request. Its view
  // pending counter still has to drain before recording the screenshot.
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  await page.waitForFunction(() => {
    const marks = performance.getEntriesByType('mark');
    const started = marks.findLast(m => m.name === 'v2:render:request' && m.detail?.target === '2d');
    const canvas = document.querySelector('#map canvas[data-render-pending]');
    return document.querySelector('#app')?.getAttribute('aria-busy') !== 'true'
      && document.querySelector('#render-status')?.hidden !== false
      && (!canvas || Number(canvas.dataset.renderPending) === 0)
      && Boolean(started && marks.some(m => m.name === 'v2:render:visible-complete' && m.detail?.request === started.detail?.request));
  }, undefined, { timeout });
}

async function captureMap(page, path, stable) {
  const map = page.locator('.map-area');
  if (!stable) {
    await map.screenshot({ path, timeout });
    return;
  }
  // Render readiness is scoped to a style, while a later camera tilt can
  // still replace draped tiles and meshes. Require the actual image at rest.
  await page.waitForTimeout(900);
  const started = now();
  let lastDigest;
  let identical = 0;
  for (let i = 0; i < 16; i++) {
    await waitForPaint(page);
    const png = await map.screenshot({ timeout });
    const digest = createHash('sha256').update(png).digest('hex');
    identical = digest === lastDigest ? identical + 1 : 1;
    if (identical >= 3 && now() - started >= 1500) {
      writeFileSync(path, png);
      return { identical, samples: i + 1, sha256: digest };
    }
    lastDigest = digest;
    await page.waitForTimeout(400);
  }
  throw Error('Capture still changing at rest: ' + basename(path));
}

async function applyStyle(page, style, season) {
  await page.evaluate(({ style, season }) => {
    const select = document.querySelector('#map-style');
    const preset = style.replace(/-night$/, '');
    if (!select || !Array.from(select.options).some(o => o.value === preset && !o.disabled)) throw Error('Unavailable preset ' + preset);
    const change = (element, value) => {
      if (!element) throw Error('Missing composition control');
      if (element.value !== String(value)) {
        element.value = String(value);
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }
    };
    change(select, preset);
    change(document.querySelector('input[data-setting-path="appearance.composition.effects.season"]'), season);
    const ambience = document.querySelector('select[data-setting-path="appearance.composition.effects.ambience"]');
    if (ambience || style.endsWith('-night')) change(ambience, style.endsWith('-night') ? 'night' : 'day');
    const labels = document.querySelector('input[data-setting-path="appearance.composition.text.visible"]');
    if (labels?.checked) labels.click();
  }, { style, season });
}

// Take the proof after the measured generation and display work. Map keys are
// canonicalized, while geometry values and every array's order are preserved.
async function generationProof(page, id) {
  const serialized = await page.evaluate(() => {
    const world = window.__v2Test.world();
    const town = world?.settlements?.[0];
    const snap = world?.debug?.v2RustCities?.[town?.key];
    if (!snap || snap.backend !== 'rust-native-cpu' || !snap.layouts.length || !snap.partitions?.[0]?.parcels?.length)
      throw Error('The rendered town has no complete native layout and cadastre');
    const { placement, roads } = world.debug.v2RustRegion ?? {};
    const products = {
      placed: placement?.settlements,
      regional: roads && { segments: roads.segments, junctions: roads.junctions, nodes: roads.nodes, approaches: roads.approaches, exits: roads.exits },
      layouts: snap.layouts,
      cadastre: snap.partitions,
      programme: snap.programmePartitions,
      sites: snap.sites,
      requests: snap.requests,
      buildingIds: snap.buildingIds,
      buildings: snap.scene?.buildings,
    };
    const sorted = (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map(k => [k, value[k]]))
      : value;
    return Object.fromEntries(Object.entries(products).map(([key, value]) => [key, JSON.stringify(value ?? null, sorted)]));
  });
  return Object.fromEntries(Object.entries(serialized).map(([key, data]) => {
    writeFileSync(join(output, id + '-' + key + '.json'), data);
    return [key, createHash('sha256').update(data).digest('hex')];
  }));
}

const requests = new Map();
let native, browser, context, tracing = false;
try {
  const started = now();
  await new Promise((done, reject) => server.once('error', reject).listen(0, '127.0.0.1', done));
  native = await phase('native-start', startEngine);
  report.enginePid = native.engine.pid;
  const web = 'http://127.0.0.1:' + server.address().port;
  const engineOrigin = 'http://127.0.0.1:' + native.port;
  const angleArgs = config.adapterLuid ? ['--use-angle=d3d11', '--use-adapter-luid=' + config.adapterLuid, '--enable-unsafe-webgpu'] : ['--use-angle=vulkan'];
  browser = await phase('chrome-start', () => chromium.launch({ channel: 'chrome', headless: true,
    env: { ...process.env, ...gpuEnvironment },
    args: [...angleArgs, '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-networking',
      '--disable-gpu-shader-disk-cache'] }));
  report.startedMs = started;
  context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1, locale: 'en-US', serviceWorkers: 'block' });
  const pending = new Set();
  const profilePaths = /^\/(urban|raster|houses|terrain|settlements|roads|landuse|hydrology)(\/|$)/;
  context.on('request', request => {
    const url = new URL(request.url());
    if (url.origin !== engineOrigin && !url.pathname.startsWith('/decors/')) return;
    const entry = { caseId, path: url.pathname, method: request.method(), kind: profilePaths.test(url.pathname) ? requestKind(request) : undefined, observedStartMs: now() };
    report.requests.push(entry);
    requests.set(request, entry);
  });
  context.on('requestfinished', request => {
    const entry = requests.get(request);
    if (!entry) return;
    entry.observedEndMs = now();
    const timing = request.timing();
    Object.assign(entry, { timing, startMs: timing.startTime, endMs: timing.startTime + timing.responseEnd });
    const detail = Promise.all([request.sizes(), request.response()]).then(([sizes, response]) => {
      entry.sizes = sizes;
      entry.status = response?.status();
    }).catch(error => { entry.metadataError = String(error); });
    pending.add(detail);
    void detail.finally(() => pending.delete(detail));
  });
  context.on('requestfailed', request => {
    const entry = requests.get(request);
    if (entry) Object.assign(entry, { observedEndMs: now(), failure: request.failure()?.errorText });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(timeout);
  const cdp = await browser.newBrowserCDPSession();
  await browser.startTracing(page, { path: join(output, 'chrome-trace.json'), categories: traceCategories });
  tracing = true;
  page.on('pageerror', error => report.diagnostics.push({ caseId, atMs: now(), kind: 'pageerror', message: String(error) }));
  page.on('console', msg => {
    if (/context lost|swiftshader|^WebGPU map pipeline /i.test(msg.text()) || ['error', 'warning'].includes(msg.type()))
      report.diagnostics.push({ caseId, atMs: now(), kind: msg.type(), message: msg.text() });
  });
  await phase('adapter-check', async () => {
    const { gpu } = await cdp.send('SystemInfo.getInfo');
    const renderer = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const info = gl?.getExtension('WEBGL_debug_renderer_info');
      return info && gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
    });
    report.gpu = { renderer, devices: gpu.devices, attributes: gpu.auxAttributes };
    if (!gpu.devices.some(d => d.deviceId === gpuId) || !/RTX\s+4090/i.test(renderer ?? '') || /5090|swiftshader/i.test(renderer))
      throw Error('Chrome WebGL did not select the RTX 4090: ' + renderer);
    if (config.adapterLuid) {
      report.gpu.webgpu = await page.evaluate(async () => {
        const adapter = await navigator.gpu?.requestAdapter();
        return adapter && { vendor: adapter.info.vendor, architecture: adapter.info.architecture };
      });
      if (report.gpu.webgpu && !/lovelace/i.test(report.gpu.webgpu.architecture))
        throw Error('Chrome WebGPU did not select the expected Lovelace adapter');
    }
  });
  const url = web + '/v2.html?' + new URLSearchParams({ test: '1', quality: 'full', lang: 'en', profile: 'local', source: 'procedural', localServer: engineOrigin });
  // Navigate the same tab for each decor. Only the first navigation is cold.
  for (const test of config.cases) {
    caseId = test.id;
    const result = { id: caseId, request: test.request, views: test.views };
    report.cases.push(result);
    await phase('v2-load', async () => {
      await page.goto(url, { waitUntil: 'load', timeout });
      await page.waitForFunction(() => window.__v2Test?.ready, undefined, { timeout });
    });
    result.prepared = await phase('decor-prepare', () => page.evaluate(req => window.__v2Test.prepare(req), test.request));
    await phase('generate-and-present', () => page.evaluate(() => window.__v2Test.run()));
    await phase('background-places', () => page.evaluate(() => window.__v2Test.smallPlacesSettled?.()));
    await Promise.all([...pending]);
    const recent = report.requests.filter(r => r.caseId === caseId);
    const stages = [['quarters'], ['parcels'], ['programme'], ['buildingSites', 'buildingSiteVisuals', 'buildingSitesPage']];
    for (const kinds of stages) {
      if (!recent.some(r => r.path === '/urban' && kinds.includes(r.kind) && r.status === 200))
        throw Error('Missing successful native ' + kinds[0] + ' request for ' + caseId);
    }
    await phase('read-town-summary', async () => {
      result.summary = await page.evaluate(() => window.__v2Test.summary());
      if (result.summary.decor !== test.request.decor || !(result.summary.town?.buildings > 0))
        throw Error('Wrong decor or empty town');
    });
    await phase('sheet-frame', () => page.addStyleTag({ content: sheetFrame }));
    for (const [view, style] of Object.entries(test.views)) {
      await phase(view + '-appearance', async () => {
        await applyStyle(page, style, test.season);
        await waitForPaint(page);
      });
      await phase(view + '-camera', async () => {
        await page.evaluate(async view => {
          const hook = window.__v2Test;
          const framed = await hook.view('2d');
          if (view === '3d') hook.setCamera3d({ x: framed.cx, y: framed.cy, scale: framed.scale * 1.8, pitch: Math.PI / 2 - 0.72, navigation: 'orbit' });
        }, view);
        await waitForPaint(page);
        if (view === '3d' && !(await page.evaluate(() => window.__v2Test.camera3d().pitch > 0.3)))
          throw Error('The 3D view did not tilt');
      });
      if (view === '2d') await phase('2d-capture-ready', async () => {
        await page.waitForFunction(() => {
          try {
            window.__v2Test.prepareCapture();
            return true;
          } catch (error) {
            if (!String(error?.message ?? error).startsWith('HD loading')) throw error;
            return false;
          }
        }, undefined, { timeout });
      });
      const evidence = await phase(view + '-png', () => captureMap(page, join(output, caseId + '-' + view + '.png'), config.stableCaptures));
      if (evidence) (result.captureStability ??= {})[view] = evidence;
    }
    result.performance = await page.evaluate(() => {
      const entries = [...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('measure'), ...performance.getEntriesByType('mark')];
      return { timeOrigin: performance.timeOrigin, entries: entries.map(e => e.toJSON()), jobLog: document.querySelector('#job-log')?.textContent };
    });
    result.products = await phase('generation-proof', () => generationProof(page, caseId));
    const loss = report.diagnostics.find(d => d.caseId === caseId && /context lost|swiftshader/i.test(d.message));
    if (loss) throw Error('Renderer lost during ' + caseId + ': ' + loss.message);
    result.complete = true;
    save();
  }
  await Promise.all([...pending]);
  report.complete = true;
} catch (error) {
  report.failure = String(error?.stack ?? error);
  console.error(report.failure);
  process.exitCode = 1;
} finally {
  caseId = null;
  if (tracing) await browser.stopTracing().catch(error => {
    report.traceError = String(error);
    process.exitCode = 1;
  });
  await browser?.close();
  if (native?.engine && native.engine.exitCode === null && native.engine.signalCode === null) {
    const closed = new Promise(done => native.engine.once('close', done));
    native.engine.kill();
    await closed;
  }
  await new Promise(done => engineLog.end(done));
  server.close();
  report.finishedMs = now();
  save();
  if (config.captureNativeRequests && report.complete && native) {
    // Give targeted native replays the actual session inputs. Read the
    // cached Playwright bodies after the campaign clock has stopped.
    const origin = 'http://127.0.0.1:' + native.port;
    const directory = join(output, 'native-http');
    mkdirSync(directory);
    const posts = [];
    for (const [request, entry] of requests) {
      const url = new URL(request.url());
      if (url.origin !== origin || !entry.caseId || entry.method !== 'POST') continue;
      const body = request.postDataBuffer();
      if (!body?.length) continue;
      const file = String(posts.length).padStart(4, '0') + '.body';
      writeFileSync(join(directory, file), body);
      posts.push({ caseId: entry.caseId, path: url.pathname + url.search, kind: entry.kind,
        status: entry.status, file, sha256: createHash('sha256').update(body).digest('hex'),
        contentType: request.headers()['content-type'] });
    }
    writeFileSync(join(directory, 'index.json'), JSON.stringify(posts, null, 2));
  }
}
