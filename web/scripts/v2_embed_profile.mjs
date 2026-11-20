/** Manual profiling CLI for the served embed. Records generation timings in disposable contexts without instrumenting production sources. */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const endpoint = process.env.MAGNA_EMBED_CHECK_URL ?? 'http://127.0.0.1:5187/embed.html';
const origin = new URL(endpoint).origin;
const host = createServer((req, res) => {
  const query = new URL(req.url, 'http://localhost').searchParams;
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<!doctype html><style>body{margin:0}iframe{border:0;width:640px;height:440px}</style><iframe sandbox="allow-scripts allow-same-origin" allow="cross-origin-isolated"></iframe><script>document.querySelector('iframe').src=${JSON.stringify(query.get('src'))}</script>`);
});
await new Promise(resolve => host.listen(0, '127.0.0.1', resolve));
const parent = `http://127.0.0.1:${host.address().port}/`;

// Runs before the actual engine module in the worker. Calls retain their inputs/outputs and memory.
function instrumentWorker() {
  const calls = new Map(),
    json = { parse: { ms: 0, calls: 0, chars: 0 }, stringify: { ms: 0, calls: 0, chars: 0 } };
  const instances = [],
    start = performance.now();
  const wrapInstance = instance => {
    const exports = { ...instance.exports };
    for (const [name, fn] of Object.entries(exports))
      if (typeof fn === 'function' && /urban|terrain|settlement|biome|landuse|forest|hydro/.test(name)) {
        exports[name] = (...args) => {
          const t = performance.now();
          try {
            return fn(...args);
          } finally {
            const entry = calls.get(name) ?? { name, ms: 0, calls: 0 };
            entry.ms += performance.now() - t;
            entry.calls++;
            calls.set(name, entry);
          }
        };
      }
    // wasm-bindgen also checks instanceof Instance when given a compiled Module.
    return Object.defineProperty(Object.create(WebAssembly.Instance.prototype), 'exports', { value: exports });
  };
  for (const method of ['instantiate', 'instantiateStreaming']) {
    const original = WebAssembly[method].bind(WebAssembly);
    WebAssembly[method] = async (...args) => {
      const t = performance.now(),
        result = await original(...args);
      instances.push({ method, ms: performance.now() - t });
      return result instanceof WebAssembly.Instance ? wrapInstance(result) : { ...result, instance: wrapInstance(result.instance) };
    };
  }
  for (const method of ['parse', 'stringify']) {
    const original = JSON[method];
    JSON[method] = (...args) => {
      const t = performance.now();
      let result;
      try {
        return (result = original(...args));
      } finally {
        const entry = json[method];
        entry.ms += performance.now() - t;
        entry.calls++;
        entry.chars += (method === 'parse' ? args[0] : result)?.length ?? 0;
      }
    };
  }
  const post = self.postMessage.bind(self);
  self.postMessage = (data, ...rest) => {
    const absoluteMs = performance.timeOrigin + performance.now();
    if (data.type === 'progress') data = { ...data, __at: absoluteMs };
    if (data.type === 'result' || data.type === 'error')
      data = {
        ...data,
        __at: absoluteMs,
        __profile: {
          workerMs: performance.now() - start,
          instances,
          json,
          calls: [...calls.values()].sort((a, b) => b.ms - a.ms),
          resources: performance.getEntriesByType('resource').map(r => ({ name: r.name, ms: r.duration, transferBytes: r.transferSize, bytes: r.encodedBodySize })),
        },
      };
    return post(data, ...rest);
  };
}

const common = { preview: '1', demo: '1', coast: '0', river: '0', walls: '1' };
const cases = [
  { name: 'Brackenford', params: { ...common, name: 'Brackenford', population: '2500', seed: '12340007', cultureBase: 'English' } },
  {
    name: 'Longxi',
    params: {
      ...common,
      name: 'Longxi',
      population: '3050',
      seed: '1288490188',
      cultureBase: 'Chinese',
      cultureType: 'River',
      biome: 'Temperate deciduous forest',
      temperature: '18',
      precipitation: '1400',
      elevation: '80',
      sea: '.5',
      river: '1',
      port: '0',
      citadel: '1',
      capital: '0',
      temple: '1',
      plaza: '1',
      shantytown: '1',
      hub: '1',
      farms: '1',
    },
  },
  {
    name: 'Karak Ordu',
    params: {
      ...common,
      name: 'Karak Ordu',
      population: '1250',
      seed: '3521165402',
      cultureBase: 'Mongolian',
      cultureType: 'Nomadic',
      biome: 'Grassland',
      temperature: '8',
      precipitation: '350',
      elevation: '900',
      sea: '1',
      port: '0',
      walls: '0',
      citadel: '0',
      capital: '0',
      temple: '1',
      plaza: '0',
      shantytown: '0',
      hub: '1',
      farms: '0',
    },
  },
];
const browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true });
const report = { date: new Date().toISOString(), endpoint, runs: [] };
try {
  async function session(test, mode = 'off') {
    const context = await browser.newContext({ viewport: { width: 700, height: 500 } });
    await context.addInitScript(
      ({ workerCode, mode }) => {
        window.__embedProfile = { stages: [] };
        new MutationObserver(() => {
          if (document.documentElement?.dataset.state === 'ready' && !window.__embedProfile.readyAt) window.__embedProfile.readyAt = performance.timeOrigin + performance.now();
        }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-state'] });
        const NativeWorker = window.Worker;
        window.Worker = class extends NativeWorker {
          constructor(source, options) {
            const profile = window.__embedProfile;
            profile.workerAt = performance.timeOrigin + performance.now();
            const bootstrap = URL.createObjectURL(
              new Blob(
                [
                  `const queued=[];const hold=e=>{e.stopImmediatePropagation();queued.push(e);};self.addEventListener('message',hold);(${workerCode})();await import(${JSON.stringify(new URL(source, document.baseURI).href)});self.removeEventListener('message',hold);for(const e of queued)self.dispatchEvent(new MessageEvent('message',{data:e.data,ports:e.ports}));`,
                ],
                { type: 'text/javascript' },
              ),
            );
            super(bootstrap, { ...options, type: 'module', name: options.name.replace(/threads=\w+/, `threads=${mode}`) });
            this.addEventListener('message', ({ data }) => {
              if (data.type === 'progress') profile.stages.push({ at: data.__at, ...data.progress });
              if (data.__profile) Object.assign(profile, { worker: data.__profile, resultAt: data.__at });
              if (data.type === 'result') Object.assign(profile, { wasm: data.wasm, stats: Object.fromEntries(Object.entries(data.world.stats).filter(([key]) => key.startsWith('ms.'))), buildings: data.world.urban?.buildings?.length, culture: data.world.options.culture });
            });
          }
        };
      },
      { workerCode: instrumentWorker.toString(), mode },
    );
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const source = new URL(endpoint);
    source.search = new URLSearchParams(test.params).toString();
    const target = new URL(parent);
    target.searchParams.set('src', source.href);
    async function run(condition) {
      await page.goto(target.href, { waitUntil: 'domcontentloaded' });
      const frame = page.frames().find(frame => frame.url().startsWith(origin));
      // The frame can still be about:blank when the parent navigation resolves.
      await page.frameLocator('iframe').locator('html[data-state="ready"],html[data-state="error"]').waitFor({ timeout: 180000 });
      const loaded = frame ?? page.frames().find(frame => frame.url().startsWith(origin));
      assert.equal(await loaded.locator('html').getAttribute('data-state'), 'ready', await loaded.locator('#status').textContent());
      const data = await loaded.evaluate(() => ({
        ...window.__embedProfile,
        navigationAt: performance.timeOrigin,
        cached: document.documentElement.dataset.cached === '1',
        isolated: crossOriginIsolated,
        hardwareConcurrency: navigator.hardwareConcurrency,
        resources: performance.getEntriesByType('resource').map(r => ({ name: r.name, ms: r.duration, transferBytes: r.transferSize, bytes: r.encodedBodySize })),
      }));
      const at = stage => data.stages.find(p => p.stage === stage)?.at;
      const elapsed = (a, b) => (a && b ? Math.round(b - a) : 0);
      const townEnd = at('urban-complete'),
        resultAt = data.resultAt;
      const breakdown = data.cached
        ? { thumbnail: elapsed(data.navigationAt, data.readyAt) }
        : {
            startup: elapsed(data.navigationAt, at('terrain-cache')),
            terrain: data.stats['ms.total'],
            region: data.stats['ms.region'],
            layout: elapsed(at('urban-layout'), at('urban-parcels')),
            parcels: elapsed(at('urban-parcels'), at('urban-programme')),
            programme: elapsed(at('urban-programme'), at('urban-building-sites')),
            buildingSites: elapsed(at('urban-building-sites'), at('urban-buildings')),
            massing: elapsed(at('urban-buildings'), townEnd),
            landuseNamesTransport: elapsed(townEnd, resultAt),
            receiveAndRender: elapsed(resultAt, data.readyAt),
          };
      const item = { city: test.name, mode, condition, totalMs: elapsed(data.navigationAt, data.readyAt), breakdown, ...data };
      if (!data.cached) assert.ok(data.worker.calls.length, 'WASM export instrumentation must have run.');
      report.runs.push(item);
      console.log(JSON.stringify({ city: test.name, mode, condition, totalMs: item.totalMs, breakdown, wasm: data.wasm, buildings: data.buildings, wasmCalls: data.worker?.calls.slice(0, 4) }));
      return loaded;
    }
    const first = await run('cold');
    // Delete only this disposable browser context's generated products, while keeping its HTTP cache warm.
    await first.evaluate(async () => {
      localStorage.removeItem('magna-urbis-city-previews-v1');
      const databases = await indexedDB.databases();
      await Promise.all(
        databases.map(
          db =>
            new Promise((resolve, reject) => {
              const request = indexedDB.deleteDatabase(db.name);
              request.onsuccess = resolve;
              request.onerror = () => reject(request.error);
              request.onblocked = () => reject(new Error(`Generated-product database still open: ${db.name}`));
            }),
        ),
      );
    });
    await run('http-warm-products-empty');
    await run('thumbnail');
    assert.deepEqual(errors, []);
    await context.close();
  }
  for (const test of cases) await session(test);
  if (process.argv.includes('--pool')) await session(cases[0], 'pool');
} finally {
  await mkdir('out/city-embed', { recursive: true });
  await writeFile('out/city-embed/performance.json', JSON.stringify(report, null, 2));
  await browser.close();
  await new Promise(resolve => host.close(resolve));
}
