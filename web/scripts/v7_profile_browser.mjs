// One V2 page and native service for the reduced V7 profiling campaign.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, createWriteStream, readFileSync, statSync, writeFileSync } from 'node:fs';
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

let native, browser, context, tracing = false;
try {
  const started = now();
  await new Promise((done, reject) => server.once('error', reject).listen(0, '127.0.0.1', done));
  native = await phase('native-start', startEngine);
  report.enginePid = native.engine.pid;
  const web = 'http://127.0.0.1:' + server.address().port;
  const engineOrigin = 'http://127.0.0.1:' + native.port;
  browser = await phase('chrome-start', () => chromium.launch({ channel: 'chrome', headless: true,
    env: { ...process.env, ...gpuEnvironment },
    args: ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-networking',
      '--disable-gpu-program-cache', '--disable-gpu-shader-disk-cache'] }));
  report.startedMs = started;
  context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1, locale: 'en-US', serviceWorkers: 'block' });
  const requests = new Map();
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
    if (/context lost|swiftshader/i.test(msg.text()) || ['error', 'warning'].includes(msg.type()))
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
    const recent = report.requests.filter(r => r.caseId === caseId);
    await Promise.all([...pending]);
    for (const kind of ['quarters', 'parcels', 'programme', 'buildingSites']) {
      if (!recent.some(r => r.path === '/urban' && r.kind === kind && r.status === 200))
        throw Error('Missing successful native ' + kind + ' request for ' + caseId);
    }
    await phase('read-town-summary', async () => {
      result.summary = await page.evaluate(() => window.__v2Test.summary());
      if (result.summary.decor !== test.request.decor || !(result.summary.town?.buildings > 0))
        throw Error('Wrong decor or empty town');
    });
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
      await phase(view + '-png', () => page.locator('.map-area').screenshot({ path: join(output, caseId + '-' + view + '.png'), timeout }));
    }
    result.performance = await page.evaluate(() => {
      const entries = [...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('measure'), ...performance.getEntriesByType('mark')];
      return { timeOrigin: performance.timeOrigin, entries: entries.map(e => e.toJSON()), jobLog: document.querySelector('#job-log')?.textContent };
    });
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
}
