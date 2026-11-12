// V2 display profile: time from a build click to the town on screen and to the complete map, main-thread long tasks,
// pan/zoom frame times and memory, then 2D shots per style. One headless Chrome page (RTX 5090, ANGLE Vulkan), closed in finally.
//   node scripts/v2_display_profile.mjs --decor city-temperate-river-s --pop 2000 --profile web|local [--throttle 4]
//        [--port 5196] [--out out/display-perf/<case>] [--label before] [--styles parchment,satellite] [--edits 2]
// Phases: "build" = the whole chain from an empty map; "edit" = a town composition reroll rebuilt alone (the previous map stays).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const decor = arg('decor', 'city-temperate-river-s'), culture = arg('culture', 'european-organic'), pop = Number(arg('pop', '2000'));
const profile = arg('profile', 'web'), throttle = Number(arg('throttle', '1')), port = arg('port', '5196'), label = arg('label', 'run');
const out = arg('out', `out/display-perf/${decor}-${pop}`), styles = arg('styles', 'parchment,satellite').split(',').filter(Boolean);
const edits = Number(arg('edits', '2')), server = arg('server', 'http://127.0.0.1:8791');
fs.mkdirSync(out, { recursive: true });
const query = profile === 'web' ? 'profile=web' : `profile=local&localServer=${server}`;
const quantile = (values, q) => { if (!values.length) return 0; const s = [...values].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))]); };

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, env: { ...process.env, VK_LOADER_DEVICE_ID_FILTER: '0x2b85' },
    args: ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'en-US' });
  const page = await context.newPage(); page.setDefaultTimeout(600000);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });
  await page.goto(`http://127.0.0.1:${port}/v2.html?test=1&lang=en&${query}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => window.__v2Test?.ready, undefined, { timeout: 180000 });
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') !== 'true', undefined, { timeout: 180000 });
  await page.evaluate(() => {
    window.__longTasks = [];
    try { new PerformanceObserver(list => { for (const e of list.getEntries()) window.__longTasks.push({ at: e.startTime, ms: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch { /* no long task API */ }
    // Frame probe: one rAF loop records frame gaps and the moments the town and the complete map appear after `__probe.start()`.
    const map = () => document.querySelector('#map canvas[data-render-pending]') ?? document.querySelector('canvas[data-render-pending]');
    const probe = window.__probe = { t0: 0, busySeen: false, idleAt: 0, townAt: 0, completeAt: 0, frames: [], last: 0, running: false,
      start() { Object.assign(probe, { t0: performance.now(), busySeen: false, idleAt: 0, townAt: 0, completeAt: 0, frames: [], last: performance.now() }); },
    };
    const tick = () => {
      const now = performance.now(); probe.frames.push(now - probe.last); probe.last = now;
      if (probe.t0) {
        const busy = document.querySelector('#app')?.getAttribute('aria-busy') === 'true';
        if (busy) probe.busySeen = true;
        else if (probe.busySeen && !probe.idleAt) probe.idleAt = now;
        const canvas = map(), city = canvas ? JSON.parse(canvas.dataset.cityRender || '{}') : {};
        if (probe.idleAt && !probe.townAt && (city.visibleBuildings > 0 || city.buildings > 0)) probe.townAt = now;
        if (probe.townAt && !probe.completeAt && canvas?.dataset.renderPending === '0' && document.querySelector('#render-status')?.hidden !== false) probe.completeAt = now;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  const heap = async () => { const { metrics } = await cdp.send('Performance.getMetrics'); const m = Object.fromEntries(metrics.map(x => [x.name, x.value])); return Math.round(m.JSHeapUsedSize / 1e6); };
  /** Runs `action` (page-side) and waits for the town and the complete map; returns the timings from the click. */
  const measure = async (name, action) => {
    await page.evaluate(() => { window.__longTasks.length = 0; window.__probe.start(); });
    await page.evaluate(action);
    await page.waitForFunction(() => window.__probe.completeAt > 0 || performance.now() - window.__probe.t0 > 300000, undefined, { timeout: 330000, polling: 100 });
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => { const p = window.__probe, lt = window.__longTasks.filter(t => t.at >= p.t0);
      return { idle: Math.round(p.idleAt - p.t0), town: Math.round(p.townAt - p.t0), complete: Math.round(p.completeAt - p.t0), longTasks: lt.length, longMs: Math.round(lt.reduce((s, t) => s + t.ms, 0)), longMax: Math.round(Math.max(0, ...lt.map(t => t.ms))),
        footer: document.querySelector('#footer-status')?.textContent, show: Math.round(performance.getEntriesByName('v2:show').filter(m => m.startTime >= p.t0).at(-1)?.duration ?? -1), passMs: Object.fromEntries(performance.getEntriesByType('measure').filter(m => m.startTime >= p.t0 && (m.name.startsWith('v2pass:') || m.name === 'v2:cartography-dirty' || m.name === 'v2:terrain-intern')).map(m => [m.name.replace(/^v2(pass)?:/, ''), Math.round(m.duration)])), passes: document.querySelector('canvas[data-render-passes]')?.dataset.renderPasses }; });
    // The town and the map after the generation: display time = from the end of the chain (idle) is chain-independent.
    const row = { name, ...r, heapMB: await heap() };
    console.log(`${name.padEnd(8)} idle ${String(r.idle).padStart(6)} town ${String(r.town).padStart(6)} (+${r.town - r.idle}) complete ${String(r.complete).padStart(6)} (+${r.complete - r.idle}) · long tasks ${r.longTasks} / ${r.longMs} ms (max ${r.longMax}) · show ${r.show} ms · heap ${row.heapMB} MB · passes ${JSON.stringify(r.passMs)}`);
    return row;
  };
  const prep = await page.evaluate(req => window.__v2Test.prepare(req), { decor, culture, population: pop, seed: `perf-${culture}`, autoPosition: true, site: 'plain' });
  const rows = [await measure('build', () => { void window.__v2Test.run(); })];
  // 2D shots right after the build (unthrottled, before any town edit: the edits change the seed), then back to the first style.
  const shots = [];
  if (styles.length) {
    if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const settle = async () => {
      await page.waitForTimeout(400);
      await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') !== 'true' && document.querySelector('#render-status')?.hidden !== false, undefined, { timeout: 300000, polling: 100 });
      await page.evaluate(() => window.__v2Test.view('2d'));
      await page.waitForTimeout(600);
      await page.waitForFunction(() => document.querySelector('canvas[data-render-pending]')?.dataset.renderPending === '0', undefined, { timeout: 120000, polling: 100 }).catch(() => {});
    };
    for (const style of styles) {
      await page.selectOption('#map-style', style); await settle();
      await page.evaluate(() => window.__v2Test.prepareCapture()); await page.waitForTimeout(1200);
      const file = path.join(out, `${label}-${style}.png`);
      await page.locator('#map').screenshot({ path: file }); shots.push(file); console.log('SHOT', file);
    }
    await page.selectOption('#map-style', styles[0]); await settle();
    if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  }
  for (let k = 0; k < edits; k++) rows.push(await measure(`edit${k + 1}`, () => { void window.__v2Test.rerollTown(); }));
  // Pan/zoom on the town: wheel notches in, a drag, notches out; frame gaps during the gesture and the settle after it.
  await page.evaluate(() => window.__v2Test.view('2d'));
  await page.waitForFunction(() => document.querySelector('canvas[data-render-pending]')?.dataset.renderPending === '0', undefined, { timeout: 120000, polling: 100 });
  await page.waitForTimeout(800);
  const box = await page.locator('#map').boundingBox(), cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.evaluate(() => { window.__longTasks.length = 0; window.__probe.frames = []; window.__probe.t0 = 0; window.__navStart = performance.now(); });
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(120); }
  await page.mouse.down();
  for (let i = 0; i < 20; i++) { await page.mouse.move(cx - i * 15, cy - i * 8); await page.waitForTimeout(30); }
  await page.mouse.up();
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 240); await page.waitForTimeout(120); }
  const gestureEnd = await page.evaluate(() => performance.now());
  await page.waitForFunction(() => document.querySelector('canvas[data-render-pending]')?.dataset.renderPending === '0', undefined, { timeout: 120000, polling: 50 }).catch(() => {});
  const nav = await page.evaluate(end => ({ frames: window.__probe.frames.slice(1), settle: Math.round(performance.now() - end), long: window.__longTasks.filter(t => t.at >= window.__navStart) }), gestureEnd);
  const navRow = { p50: quantile(nav.frames, .5), p90: quantile(nav.frames, .9), max: Math.round(Math.max(0, ...nav.frames)), settle: nav.settle, longTasks: nav.long.length, longMs: Math.round(nav.long.reduce((s, t) => s + t.ms, 0)), heapMB: await heap() };
  console.log(`pan/zoom frame p50 ${navRow.p50} p90 ${navRow.p90} max ${navRow.max} ms · settle ${navRow.settle} ms · long tasks ${navRow.longTasks} / ${navRow.longMs} ms · heap ${navRow.heapMB} MB`);
  fs.writeFileSync(path.join(out, `${label}-${profile}-x${throttle}.json`), JSON.stringify({ decor, culture, pop, profile, throttle, prep, rows, nav: navRow, shots, errors }, null, 1));
  if (errors.length) console.log('errors', errors.slice(0, 8));
} finally {
  await browser?.close();
}
