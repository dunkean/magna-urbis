// End-to-end V2 town profile: one saved decor + one town (window.__v2Test), the whole chain ("Whole chain"),
// timed until the map is drawn. Prints the job-log timeline (ms), engine calls (path, ms, bytes) and the
// v2:* / v2pass:* measures. One headless Chrome page, RTX 5090, ANGLE Vulkan, closed in finally.
//   node scripts/v2_town_profile.mjs --decor city-temperate-river-l --culture european-organic --pop 2000 [--profile local|web]
//        [--runs 2] [--out out/small-town-perf/<case>] [--shot before.png] [--trace trace.json]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const decor = arg('decor', 'city-temperate-river-l'), culture = arg('culture', 'european-organic'), pop = Number(arg('pop', '2000'));
const profile = arg('profile', 'local'), runs = Number(arg('runs', '2')), out = arg('out', `out/small-town-perf/${decor}-${pop}`);
const shot = arg('shot'), trace = arg('trace'), port = arg('port', '5173'), server = arg('server', 'http://127.0.0.1:8791');
const enginePort = new URL(server).port;
fs.mkdirSync(out, { recursive: true });
const query = profile === 'web' ? 'profile=web' : `profile=local&localServer=${server}`;
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, env: { ...process.env, VK_LOADER_DEVICE_ID_FILTER: '0x2b85' },
    args: ['--use-angle=vulkan', '--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'en-US' });
  const page = await context.newPage(); page.setDefaultTimeout(600000);
  const errors = [], calls = []; let t00 = 0;
  context.on('requestfinished', async r => {
    const u = new URL(r.url()); if (u.port !== enginePort || u.pathname === '/status') return;
    const t = r.timing(), size = await r.sizes().catch(() => ({}));
    calls.push({ path: u.pathname, at: Math.round(t.startTime - t00), ms: Math.round(t.responseEnd), up: size.requestBodySize, down: size.responseBodySize });
  });
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });
  await page.goto(`http://127.0.0.1:${port}/v2.html?test=1&lang=en&${query}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__v2Test?.ready, undefined, { timeout: 120000 });
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') !== 'true', undefined, { timeout: 120000 });
  const results = [];
  for (let k = 0; k < runs; k++) {
    const prep = await page.evaluate(req => window.__v2Test.prepare(req), { decor, culture, population: pop, seed: `perf-${culture}`, autoPosition: true, site: 'plain' });
    await page.evaluate(() => {
      performance.clearMeasures();
      const log = document.querySelector('#job-log'); window.__timeline = [];
      window.__obs?.disconnect(); window.__t0 = performance.now();
      let last = log.textContent.length;
      window.__obs = new MutationObserver(() => { const text = log.textContent; const added = text.slice(last); last = text.length;
        for (const line of added.split('\n').filter(Boolean)) window.__timeline.push({ at: Math.round(performance.now() - window.__t0), line: line.replace(/^\S+\s+/, '').slice(0, 140) }); });
      window.__obs.observe(log, { childList: true, characterData: true, subtree: true });
    });
    if (trace && k === runs - 1) await browser.startTracing(page, { path: path.join(out, trace), categories: ['disabled-by-default-v8.cpu_profiler', 'v8', 'devtools.timeline', 'disabled-by-default-devtools.timeline'] });
    calls.length = 0; t00 = Date.now();
    const t0 = Date.now();
    await page.evaluate(() => window.__v2Test.run());
    const chain = Date.now() - t0;
    // Displayed: busy off and the render status card hidden (the worker finished drawing).
    await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') !== 'true' && document.querySelector('#render-status')?.hidden !== false, undefined, { timeout: 600000, polling: 50 });
    const shown = Date.now() - t0;
    await page.waitForTimeout(1500);
    if (trace && k === runs - 1) await browser.stopTracing();
    const r = await page.evaluate(() => ({
      measures: performance.getEntriesByType('measure').filter(m => m.name.startsWith('v2')).map(m => ({ name: m.name, at: Math.round(m.startTime - window.__t0), ms: Math.round(m.duration) })),
      timeline: window.__timeline, summary: window.__v2Test.summary(), region: (r => ({ placeMs: r?.placement?.ms, roadsMs: r?.roads?.ms }))(window.__v2Test.world()?.debug?.v2RustRegion), footer: document.querySelector('#footer-status')?.textContent,
    }));
    results.push({ run: k, prep, chain, shown, ...r, calls: [...calls] });
    console.log(`\n=== run ${k} ${decor} ${culture} pop ${pop} ${profile}: chain ${chain} ms, displayed ${shown} ms · buildings ${r.summary.town?.buildings} · map ${r.summary.mapSize} · place ${r.region.placeMs} ms roads ${r.region.roadsMs} ms · ${r.footer}`);
    if (k === runs - 1) {
      for (const e of r.timeline) console.log(`${String(e.at).padStart(7)}  ${e.line}`);
      console.log('-- engine calls');
      for (const c of calls) console.log(`${String(c.at).padStart(7)} ${c.path.padEnd(36)} ${String(c.ms).padStart(6)} ms  up ${((c.up ?? 0) / 1e3).toFixed(0).padStart(7)} kB  down ${((c.down ?? 0) / 1e3).toFixed(0).padStart(7)} kB`);
      console.log('-- measures');
      for (const m of r.measures) console.log(`${String(m.at).padStart(7)} ${m.name.padEnd(28)} ${m.ms} ms`);
    }
  }
  if (shot) {
    await page.evaluate(() => window.__v2Test.view('2d')); await page.waitForTimeout(1500);
    await page.waitForFunction(() => document.querySelector('#render-status')?.hidden !== false, undefined, { timeout: 120000 });
    await page.evaluate(() => window.__v2Test.prepareCapture()); await page.waitForTimeout(1500);
    await page.locator('#map').screenshot({ path: path.join(out, shot) });
    console.log('SHOT', path.join(out, shot));
  }
  fs.writeFileSync(path.join(out, `profile-${profile}.json`), JSON.stringify({ decor, culture, pop, profile, results, errors }, null, 1));
  if (errors.length) console.log('errors', errors.slice(0, 8));
} finally {
  await browser?.close();
}
