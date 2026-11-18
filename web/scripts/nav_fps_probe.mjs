// From web/: node scripts/nav_fps_probe.mjs <label> [--profile local|web] [--extent 40000] [--towns 8]
// See --help. Uncapped rAF throughput and compositor GPU timers measure different things; neither is scan-out FPS.
import { launchWebGpuChrome } from './webgpu_headless.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const usage = 'node scripts/nav_fps_probe.mjs <label> [--origin http://127.0.0.1:5173] [--profile local|web] [--extent 40000] [--towns <n>] [--styles satellite,parchment,satellite-2,atlas] [--modes compositor,classic] [--viewport 1600x1000] [--dpr 1] [--headed]';
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(usage);
  process.exit(0);
}
const label = args.shift();
if (!label || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(label)) throw new Error(usage);
const options = { origin: process.env.ORIGIN ?? 'http://127.0.0.1:5173', profile: 'local', extent: '', towns: '', styles: 'satellite,parchment,satellite-2,atlas', modes: 'compositor,classic', viewport: '1600x1000', dpr: '1', headed: false };
while (args.length) {
  const flag = args.shift();
  if (flag === '--headed') {
    options.headed = true;
    continue;
  }
  const key = flag?.slice(2);
  if (!flag?.startsWith('--') || !Object.hasOwn(options, key) || !args.length || args[0].startsWith('--')) throw new Error(usage);
  options[key] = args.shift();
}
const modes = [...new Set(options.modes.split(','))],
  styles = [...new Set(options.styles.split(','))];
const size = options.viewport.match(/^(\d+)x(\d+)$/),
  dpr = Number(options.dpr);
if (
  !['local', 'web'].includes(options.profile) ||
  modes.some(m => !['compositor', 'classic'].includes(m)) ||
  !styles.length ||
  styles.some(s => !/^[a-z0-9-]+$/.test(s)) ||
  !size ||
  Number(size[1]) < 320 ||
  Number(size[2]) < 240 ||
  !Number.isFinite(dpr) ||
  dpr <= 0 ||
  dpr > 4 ||
  (options.extent && !/^\d+$/.test(options.extent)) ||
  (options.towns && !/^[1-9]\d*$/.test(options.towns))
)
  throw new Error(usage);
const viewport = { width: Number(size[1]), height: Number(size[2]) };
const MAX_WAIT = Number(process.env.MAX_WAIT ?? 240000);
if (!Number.isFinite(MAX_WAIT) || MAX_WAIT < 1000 || MAX_WAIT > 600000) throw new Error('MAX_WAIT must be 1000..600000 ms');
const OUT = resolve('out/nav-fps', label);
mkdirSync(OUT, { recursive: true });
// Ignore environment overrides that could silently select the display GPU or an obsolete LUID.
process.env.VK_LOADER_DEVICE_ID_FILTER = '0x2b85';
process.env.MAGNA_GPU_DEVICE_ID = '0x2b85';
delete process.env.MAGNA_TEST_ADAPTER_LUID;
const chromeArgs = ['--disable-frame-rate-limit', '--disable-gpu-vsync', '--enable-gpu-rasterization'];
const t00 = Date.now(),
  stamp = () => ((Date.now() - t00) / 1000).toFixed(1);
const delay = ms => new Promise(r => setTimeout(r, ms));
const round = n => Math.round(n * 100) / 100;
const q = (values, f) => {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? round(s[Math.min(s.length - 1, Math.floor(f * s.length))]) : null;
};
const distribution = v => ({ n: v.length, p50: q(v, 0.5), p95: q(v, 0.95), p99: q(v, 0.99), max: q(v, 1) });
let signalReject;
const interrupted = new Promise((_, reject) => {
  signalReject = reject;
});
// The race installs its rejection handler before any signal can be delivered during a browser operation.
interrupted.catch(() => {});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => signalReject(new Error(`Interrupted by ${signal}`)));
async function bounded(promise, ms, name, interruptible = true) {
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${name} timed out (${ms} ms)`)), ms);
    });
    return await Promise.race(interruptible ? [promise, timeout, interrupted] : [promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// The helper also starts a short-lived discovery browser. Only direct Chrome children of THIS Node PID are roots;
// /T (Windows) or the explicitly discovered descendant PIDs (POSIX) handles their renderers if graceful close wedges.
function ownedChromeRoots() {
  if (process.platform === 'win32') {
    const command = `Get-CimInstance Win32_Process -Filter "ParentProcessId=${process.pid}" | Where-Object { $_.Name -match '^(chrome|chromium)([.]exe)?$' } | Select-Object -ExpandProperty ProcessId`;
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 10000, windowsHide: true }).split(/\s+/).filter(Boolean).map(Number).filter(Number.isSafeInteger);
  }
  const rows = execFileSync('ps', ['-eo', 'pid=,ppid=,comm='], { encoding: 'utf8', timeout: 10000 })
    .trim()
    .split('\n')
    .map(l => l.trim().split(/\s+/));
  return rows.filter(([, ppid, name]) => Number(ppid) === process.pid && /(?:chrome|chromium)/.test(name)).map(([pid]) => Number(pid));
}
function killOwnedChrome(pid) {
  if (process.platform === 'win32') {
    execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', timeout: 10000, windowsHide: true });
  } else {
    const rows = execFileSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8', timeout: 10000 })
      .trim()
      .split('\n')
      .map(l => l.trim().split(/\s+/).map(Number));
    const descendants = parent => rows.filter(([, ppid]) => ppid === parent).flatMap(([child]) => [...descendants(child), child]);
    for (const child of [...descendants(pid), pid]) {
      try {
        process.kill(child, 'SIGKILL');
      } catch (e) {
        if (e.code !== 'ESRCH') throw e;
      }
    }
  }
}

for (const mode of modes) {
  const logs = [],
    report = {
      label,
      mode,
      profile: options.profile,
      extent: options.extent,
      towns: options.towns,
      seed: 'perf-audit',
      viewport,
      dpr,
      headed: options.headed,
      chromeArgs,
      gpuDevice: '0x2b85',
      gestures: {},
      rest: {},
      movingShots: {},
      measurement: 'Uncapped rAF callback intervals, not monitor scan-out or guaranteed presented frames. GPU timer samples are separate. Moving screenshots use an untimed replay.',
    };
  const log = message => {
    const line = `[${stamp()}] ${mode} ${message}`;
    logs.push(line);
    console.log(line);
  };
  let browser,
    failed = false;
  try {
    // Covers discovery evaluate/close too: those helper operations have no Playwright timeout of their own.
    browser = await bounded(launchWebGpuChrome({ headless: !options.headed, args: chromeArgs, env: { ...process.env }, timeout: 30000 }), 90000, 'Chrome launch and RTX discovery');
    const op = (promise, name = 'browser operation', ms = 20000) => bounded(promise, ms, name);
    const context = await op(browser.newContext({ viewport, deviceScaleFactor: dpr, locale: 'en-US', reducedMotion: 'no-preference' }));
    await op(context.routeWebSocket(/.*/, () => {}));
    const page = await op(context.newPage());
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(30000);
    page.on('pageerror', e => log(`pageerror: ${e.message}`));
    page.on('console', m => {
      const t = m.text();
      if (!/vite\]/.test(t)) logs.push(`[${stamp()}] ${m.type()}: ${t.slice(0, 500)}`);
    });
    await op(
      page.addInitScript(() => {
        const probe = (window.__navFps = { long: [], frames: [], collecting: false, dropped: 0, layers: {}, active: {}, lastLiveFrame: 0, longTaskSupported: false, lastLong: null, lastInput: 0 });
        try {
          probe.observer = new PerformanceObserver(list => {
            for (const e of list.getEntries()) {
              const task = { at: e.startTime, ms: e.duration };
              probe.lastLong = task;
              if (probe.collecting) probe.long.push(task);
            }
          });
          probe.observer.observe({ type: 'longtask', buffered: true });
          probe.longTaskSupported = true;
        } catch {}
        // Keep the last actual input time, rather than subtracting yesterday's trailing 60/300 ms sleep from settle.
        for (const type of ['wheel', 'pointermove', 'pointerup'])
          document.addEventListener(
            type,
            e => {
              if (e.target instanceof Element && e.target.closest('#map')) {
                probe.lastInput = performance.now();
                probe.quietSince = 0;
              }
            },
            { capture: true, passive: true },
          );
        let last = performance.now();
        const tick = () => {
          const now = performance.now(),
            live = window.__muLive;
          if (probe.collecting) {
            if (probe.frames.length < 200000) probe.frames.push({ at: now, ms: now - last });
            else probe.dropped++;
            if (now <= probe.inputEnd) {
              const key = live ? `${live.active}:${live.reason ?? ''}` : 'missing';
              probe.active[key] = (probe.active[key] ?? 0) + 1;
              if (live && live.frames !== probe.lastLiveFrame) {
                probe.lastLiveFrame = live.frames;
                for (const [name, layer] of Object.entries(live.layers)) {
                  const s = (probe.layers[name] ??= { observations: 0, ready: 0, standIn: 0, drawCalls: 0, triangles: 0, maxDrawCalls: 0, maxTriangles: 0 });
                  s.observations++;
                  s.ready += Number(layer.ready);
                  s.standIn += Number(layer.standIn);
                  s.drawCalls += layer.drawCalls;
                  s.triangles += layer.triangles;
                  s.maxDrawCalls = Math.max(s.maxDrawCalls, layer.drawCalls);
                  s.maxTriangles = Math.max(s.maxTriangles, layer.triangles);
                }
              }
            }
          }
          last = now;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    );
    const url = new URL('/v2.html', options.origin);
    // QUERY is the same escape hatch as yesterday, but cannot override the experiment's mode/profile/test flags.
    for (const [key, value] of new URLSearchParams(process.env.QUERY ?? '')) url.searchParams.set(key, value);
    url.searchParams.set('test', '1');
    url.searchParams.set('lang', 'en');
    url.searchParams.set('live', mode);
    if (options.profile === 'local') url.searchParams.set('profile', 'local');
    else url.searchParams.delete('profile');
    report.url = url.href;
    await op(page.goto(url.href, { waitUntil: 'commit' }), 'navigate', 35000);
    await op(page.locator('#run-chain').waitFor());
    await delay(2500);
    const origin0 = await op(page.evaluate(() => performance.timeOrigin));
    const idle = () =>
      op(
        page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false', null, { timeout: MAX_WAIT, polling: 250 }),
        'generation idle',
        MAX_WAIT + 1000,
      );
    const settled = async (quietMs = 2500, bound = 60000) => {
      const end = Date.now() + bound;
      while (Date.now() < end) {
        const ok = await op(
          page.evaluate(quiet => {
            const l = window.__navFps.lastLong,
              canvas = document.querySelector('canvas[data-render-pending]');
            return (!l || performance.now() - (l.at + l.ms) > quiet) && (!canvas || canvas.dataset.renderPending === '0') && document.querySelector('#render-status')?.hidden !== false && document.querySelector('#app')?.getAttribute('aria-busy') !== 'true';
          }, quietMs),
          'read readiness',
          Math.min(20000, Math.max(1, end - Date.now())),
        );
        if (ok) return;
        await delay(250);
      }
      throw new Error(`Display did not settle within ${bound} ms`);
    };
    // Same chain, seed, warm-up, extent/town handling and readiness conditions as gesture.mjs.
    if (!options.extent || options.extent === '0') {
      await op(page.locator('#run-chain').click());
      await delay(1500);
      await idle();
      await settled(3000, 60000);
    }
    await op(
      page.evaluate(seed => {
        const e = document.querySelector('#seed');
        e.value = seed;
        e.dispatchEvent(new Event('input', { bubbles: true }));
        e.dispatchEvent(new Event('change', { bubbles: true }));
      }, 'perf-audit'),
    );
    await delay(500);
    if (options.extent && options.extent !== '0') {
      await op(
        page.evaluate(
          ([extent, towns]) => {
            const button = document.querySelector(`[data-extent="${extent}"]`);
            if (!button) throw new Error(`Missing extent ${extent}`);
            button.click();
            const c = document.querySelector('#town-count');
            if (towns) {
              if (!c) throw new Error('Missing #town-count');
              c.value = String(towns);
              c.dispatchEvent(new Event('change', { bubbles: true }));
            }
          },
          [options.extent, options.towns],
        ),
      );
      await delay(1000);
    }
    const chainStart = Date.now();
    await op(page.locator('#run-chain').click());
    await delay(1500);
    await idle();
    await settled(3000, 90000);
    log(`chain ${Date.now() - chainStart} ms, ${await op(page.locator('#footer-status').textContent())}`);
    const world = (report.world = await op(
      page.evaluate(() => {
        const w = window.__v2Test.world(),
          s = [...(w?.settlements ?? [])].sort((a, b) => (b.population ?? b.radius ?? 0) - (a.population ?? a.radius ?? 0))[0];
        return { mapSize: w?.mapSize, town: s ? { x: s.center?.x ?? s.x, y: s.center?.y ?? s.y, radius: s.radius, population: s.population } : null, view: window.__v2Test.getView(), styles: [...document.querySelectorAll('#map-style option')].map(o => o.value) };
      }),
    ));
    if (!Number.isFinite(world.mapSize)) throw new Error('Seeded chain produced no world');
    log(`world ${JSON.stringify(world)}`);
    // Refuse a wrong adapter rather than publish numbers from the display GPU or a software renderer.
    report.adapter = await op(
      page.evaluate(async () => {
        const gl = document.createElement('canvas').getContext('webgl2'),
          ext = gl?.getExtension('WEBGL_debug_renderer_info');
        const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
        return { webgl: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null, webgpu: adapter ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device, description: adapter.info.description } : null };
      }),
      'verify adapter',
    );
    if (!/5090/.test(report.adapter.webgl ?? '')) throw new Error(`Expected RTX 5090: ${JSON.stringify(report.adapter)}`);
    const town = world.town ?? { x: world.mapSize / 2, y: world.mapSize / 2 };
    const townView = { cx: town.x, cy: town.y, scale: 0.8 },
      closeView = { cx: town.x, cy: town.y, scale: 4 };
    const setView = async view => {
      await op(page.evaluate(v => window.__v2Test.setView(v), view));
      await delay(400);
      await settled(1200, 60000);
    };
    const shot = async (style, name) => {
      await settled(1500, 40000);
      await op(page.evaluate(() => window.__v2Test.setView(window.__v2Test.getView())));
      await delay(300);
      await settled(800, 20000);
      const base = `${mode}-${style}-${name}`;
      await op(page.locator('#map').screenshot({ path: `${OUT}/${base}-live.png`, timeout: 15000 }), 'rest live screenshot');
      const state = await op(
        page.evaluate(() => {
          const c = document.querySelector('canvas[data-render-pending]');
          return { view: window.__v2Test.getView(), cache: c?.dataset.renderCache, pending: c?.dataset.renderPending, city: c?.dataset.cityRender };
        }),
      );
      await op(page.evaluate(() => window.__v2Test.prepareCapture?.()));
      await delay(1200);
      await settled(1500, 30000);
      await op(page.locator('#map').screenshot({ path: `${OUT}/${base}.png`, timeout: 15000 }), 'rest exact screenshot');
      report.rest[`${style}:${name}`] = { ...state, live: `${base}-live.png`, exact: `${base}.png` };
    };
    const box = await op(page.locator('#map').boundingBox());
    if (!box) throw new Error('Missing #map bounding box');
    const cx = Math.round(box.x + box.width / 2),
      cy = Math.round(box.y + box.height / 2);
    const gesture = async (style, name, inputs) => {
      const t = await op(
        page.evaluate(name => {
          console.timeStamp(name);
          const p = window.__navFps;
          p.observer?.takeRecords();
          p.long = [];
          p.frames = [];
          p.dropped = 0;
          p.layers = {};
          p.active = {};
          p.lastLiveFrame = 0;
          p.lastInput = 0;
          p.inputEnd = Infinity;
          window.__muVectorEngine?.reset?.();
          window.__muLive?.reset();
          p.collecting = true;
          p.quietSince = 0;
          const start = performance.now(),
            generation = (p.quietGeneration = (p.quietGeneration ?? 0) + 1);
          // Sample through the final input gap too, so a 300 ms slow-wheel sleep cannot hide the settle transition.
          const watch = () => {
            const now = performance.now();
            if (!p.collecting || p.quietGeneration !== generation || now - start > 120000) return;
            const c = document.querySelector('canvas[data-render-pending]');
            if (!c || c.dataset.renderPending === '0') p.quietSince ||= now;
            else p.quietSince = 0;
            p.quietObservedAt = now;
            setTimeout(watch, 20);
          };
          watch();
          return start;
        }, `${style}:${name}`),
      );
      await inputs();
      const last = await op(
        page.evaluate(() => {
          const p = window.__navFps,
            s = window.__muLive,
            v = window.__muVectorEngine?.stats?.();
          p.inputEnd = performance.now();
          return {
            end: p.inputEnd,
            lastInput: p.lastInput || p.inputEnd,
            view: window.__v2Test.getView(),
            live: s
              ? {
                  available: true,
                  mode: s.mode,
                  active: s.active,
                  reason: s.reason ?? null,
                  frames: s.frames,
                  frameMs: [...s.frameMs],
                  gpuMs: [...s.gpuMs],
                  slow: structuredClone(s.slow ?? []),
                  layers: structuredClone(s.layers),
                  pending: { ...s.pending },
                  observations: structuredClone(p.layers),
                  activeObservations: { ...p.active },
                }
              : { available: false },
            classic: { work: v?.liveSeries?.frame ?? [], parts: v?.liveParts ?? {}, engine: v?.engine, demoted: v?.demoted ?? null },
            city: (() => {
              try {
                const c = JSON.parse(document.querySelector('canvas[data-city-render]')?.dataset.cityRender ?? '{}');
                return { renderer: c.renderer, reason: c.reason, ms: Math.round(c.ms ?? 0), visible: c.visibleBuildings, lod: c.lod };
              } catch {
                return null;
              }
            })(),
          };
        }),
      );
      // Same 400 ms continuous render-pending quiet interval as yesterday. Page and Node each own a bound.
      const settleMs = await op(
        page.evaluate(
          end =>
            new Promise(resolve => {
              const p = window.__navFps;
              let quietSince = performance.now() - p.quietObservedAt < 100 && p.quietSince >= end ? p.quietSince : 0;
              const poll = () => {
                const now = performance.now(),
                  c = document.querySelector('canvas[data-render-pending]'),
                  ok = !c || c.dataset.renderPending === '0';
                if (ok) {
                  quietSince ||= now;
                  if (now - quietSince > 400) return resolve(Math.round(quietSince - end));
                } else quietSince = 0;
                if (now - end > 40000) return resolve(-1);
                setTimeout(poll, 20);
              };
              poll();
            }),
          last.lastInput,
        ),
        'gesture settle',
        45000,
      );
      await settled(800, 40000);
      const samples = await op(
        page.evaluate(
          ([t, end, lastInput]) => {
            const p = window.__navFps;
            for (const e of p.observer?.takeRecords() ?? []) p.long.push({ at: e.startTime, ms: e.duration });
            p.collecting = false;
            const during = p.long.filter(l => l.at >= t && l.at < lastInput),
              after = p.long.filter(l => l.at >= lastInput);
            const st = window.__muVectorEngine?.stats?.();
            const summary = a => ({ n: a.length, sum: Math.round(a.reduce((s, l) => s + l.ms, 0)), max: Math.round(a.reduce((s, l) => Math.max(s, l.ms), 0)) });
            return {
              frames: p.frames.filter(f => f.at >= t + 50 && f.at <= end + 20).map(f => f.ms),
              tail: p.frames.filter(f => f.at > end + 20 && f.at <= end + 420).map(f => f.ms),
              long: summary(during),
              restLong: { ...summary(after), lastEnd: Math.round(after.reduce((s, l) => Math.max(s, l.at + l.ms), lastInput) - lastInput) },
              longTaskSupported: p.longTaskSupported,
              dropped: p.dropped,
              classicAfter: { work: st?.liveSeries?.frame ?? [], parts: st?.liveParts ?? {}, engine: st?.engine, demoted: st?.demoted ?? null },
              // Queries resolve asynchronously. These tail samples can include subsequent settle frames; never call them gesture GPU time.
              gpuThroughSettle: [...(window.__muLive?.gpuMs ?? [])],
              observedUntil: performance.now(),
            };
          },
          [t, last.end, last.lastInput],
        ),
      );
      const frames = distribution(samples.frames),
        live = last.live;
      if (live.available) {
        live.cpu = distribution(live.frameMs);
        live.gpu = distribution(live.gpuMs);
        live.samplesCapped = live.frames > 4000;
      }
      const row = (report.gestures[`${style}:${name}`] = {
        durationMs: round(last.end - t),
        frames: frames.n,
        p50: frames.p50,
        p95: frames.p95,
        p99: frames.p99,
        max: frames.max,
        fpsP50: frames.p50 > 0 ? round(1000 / frames.p50) : null,
        fpsP95: frames.p95 > 0 ? round(1000 / frames.p95) : null,
        over50: samples.frames.filter(ms => ms > 50).length,
        tailMax: q(samples.tail, 1),
        frameMs: samples.frames,
        dropped: samples.dropped,
        work: distribution(samples.classicAfter.work),
        parts: samples.classicAfter.parts,
        engine: samples.classicAfter.engine,
        demoted: samples.classicAfter.demoted,
        classicDuring: last.classic,
        city: last.city,
        live,
        long: samples.long,
        restLong: samples.restLong,
        longTaskSupported: samples.longTaskSupported,
        settleMs,
        inputTailMs: round(last.end - last.lastInput),
        observedAfterMs: round(samples.observedUntil - last.lastInput),
        gpuThroughSettle: distribution(samples.gpuThroughSettle),
        endView: last.view,
      });
      log(
        `${style} ${name}: FPS ${row.fpsP50}/${row.fpsP95}, gap p50/p95/p99/max ${row.p50}/${row.p95}/${row.p99}/${row.max} ms, live ${live.available ? `${live.active}/${live.reason ?? ''} ${live.frames} frames CPU ${live.cpu.p50}/${live.cpu.p95} GPU ${live.gpu.p50}/${live.gpu.p95}` : 'missing __muLive'}, long ${row.long.n}/${row.long.sum}, settle ${settleMs} ms`,
      );
      writeFileSync(`${OUT}/${mode}.json`, JSON.stringify(report, null, 1));
    };
    let lastDispatchAt = 0;
    const wheel = async (n, dy, gap, middle) => {
      await op(page.mouse.move(cx, cy));
      for (let i = 0; i < n; i++) {
        await op(page.mouse.wheel(0, dy));
        lastDispatchAt = Date.now();
        if (middle && i === Math.floor(n / 2) - 1) await middle();
        await delay(gap);
      }
    };
    const drag = async (n, dx, dy, gap, middle) => {
      await op(page.mouse.move(cx, cy));
      await op(page.mouse.down());
      for (let i = 1; i <= n; i++) {
        await op(page.mouse.move(cx + i * dx, cy + i * dy));
        lastDispatchAt = Date.now();
        if (middle && i === Math.floor(n / 2)) await middle();
        await delay(gap);
      }
      await op(page.mouse.up());
    };
    const cdp = await op(context.newCDPSession(page));
    const movingShot = async (style, name) => {
      // CDP avoids locator.screenshot's stability/animation waits. Request immediately after the midpoint input;
      // capture latency is recorded because a slow GPU may still miss the 160 ms live-view window.
      const requestedAt = Date.now();
      const capture = await op(cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false, optimizeForSpeed: true, clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 } }), 'moving screenshot', 15000);
      const file = `${mode}-${style}-${name}-mid.png`;
      writeFileSync(`${OUT}/${file}`, Buffer.from(capture.data, 'base64'));
      report.movingShots[`${style}:${name}`] = {
        file,
        requestAfterInputAckMs: requestedAt - lastDispatchAt,
        captureMs: Date.now() - requestedAt,
        restDelayMs: 160,
        after: await op(page.evaluate(() => ({ view: window.__v2Test.getView(), active: window.__muLive?.active, reason: window.__muLive?.reason }))),
      };
      if (report.movingShots[`${style}:${name}`].captureMs >= 160) log(`WARNING ${style} ${name} screenshot took >=160 ms; inspect for a rest repaint`);
    };
    report.skippedStyles = styles.filter(s => !world.styles.includes(s));
    if (report.skippedStyles.length) log(`unsupported styles skipped: ${report.skippedStyles.join(',')}`);
    for (const style of styles.filter(s => world.styles.includes(s))) {
      if ((await op(page.locator('#map-style').inputValue())) !== style) {
        await op(page.selectOption('#map-style', style));
        await delay(300);
        await settled(2500, 120000);
      }
      await setView(world.view);
      await shot(style, 'full');
      await setView(townView);
      await shot(style, 'town');
      await setView(closeView);
      await shot(style, 'close');
      await setView(townView);
      await gesture(style, 'wheel-in', () => wheel(10, -120, 60));
      await gesture(style, 'wheel-out', () => wheel(10, 120, 60));
      await gesture(style, 'pan', () => drag(60, -8, -4, 16));
      await gesture(style, 'pan-back', () => drag(60, 8, 4, 16));
      await gesture(style, 'wheel-slow', () => wheel(6, -120, 300));
      await gesture(style, 'wheel-slow-out', () => wheel(6, 120, 300));
      await setView({ ...world.view });
      await gesture(style, 'far-wheel-in', () => wheel(14, -120, 60));
      await gesture(style, 'far-pan', () => drag(60, -8, -4, 16));
      await gesture(style, 'far-wheel-out', () => wheel(14, 120, 60));
      await setView(townView);
      await shot(style, 'town-after');
      // Visual replay follows the same input sequence up to pan, isolated from the timed nine gestures.
      await setView(townView);
      await wheel(10, -120, 60, () => movingShot(style, 'wheel-in'));
      await settled(800, 40000);
      await wheel(10, 120, 60);
      await settled(800, 40000);
      await drag(60, -8, -4, 16, () => movingShot(style, 'pan'));
      await settled(800, 40000);
    }
    report.reloaded = (await op(page.evaluate(() => performance.timeOrigin))) !== origin0;
    if (report.reloaded) throw new Error('PAGE RELOADED DURING MEASUREMENT: discard');
  } catch (e) {
    failed = true;
    process.exitCode = 1;
    report.error = String(e?.stack ?? e);
    log(`ERROR ${report.error}`);
  } finally {
    // Cleanup is deliberately independent of interruption, report I/O, and a wedged renderer's JavaScript thread.
    try {
      if (browser) await bounded(browser.close(), 12000, 'browser close', false);
    } catch (e) {
      log(String(e));
    }
    try {
      const pids = ownedChromeRoots();
      for (const pid of pids) {
        try {
          killOwnedChrome(pid);
          log(`ended owned Chrome PID ${pid}`);
        } catch (e) {
          process.exitCode = 1;
          log(`cleanup PID ${pid}: ${e.message}`);
        }
      }
    } catch (e) {
      process.exitCode = 1;
      log(`Chrome PID cleanup failed: ${e.message}`);
    }
    report.console = logs.filter(l => /pipeline|error|warn|Vector engine|context/i.test(l) && !/powerPreference|Password/.test(l)).slice(0, 100);
    writeFileSync(`${OUT}/${mode}.json`, JSON.stringify(report, null, 1));
    writeFileSync(`${OUT}/${mode}.log`, logs.join('\n') + '\n');
  }
  if (failed) break;
}
// A timed-out Playwright promise can keep transport handles alive; cleanup above has already closed/killed owned Chrome.
process.exit(process.exitCode ?? 0);
