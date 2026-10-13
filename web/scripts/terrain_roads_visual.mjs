// From web/: node scripts/terrain_roads_visual.mjs [base URL] [relief] [seed]
// Screenshots of the settlement and road network on a relief map, full extent and a zoomed slope,
// for review of grades, merging and road typing (not an assertion suite).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const base = process.argv[2] ?? 'http://127.0.0.1:5174/terrainbench.html';
const relief = process.argv[3] ?? 'mountains', seed = process.argv[4] ?? '7';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  window.addEventListener('settlements:generated', event => { window.__settlementOutput = event.detail; });
  window.addEventListener('roads:generated', event => { window.__roadOutput = event.detail; });
  const Base = window.Worker;
  window.Worker = class extends Base {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', event => { if (event.data.terrain && event.data.kind === 'overview' && !event.data.partial) window.__terrain = event.data.terrain; });
    }
  };
});
const url = new URL(base);
url.search = new URLSearchParams({ width: '30000', motif: '4000', relief, seed, source: 'procedural', compute: 'wasm', generation: 'cpu', hydro_enabled: '1', auto: '0' }).toString();
const spec = { key: 'main', population: 20000, name: '', culture: 'european-organic', kind: 'settlement', siteType: 'auto', sitePrefs: {} };
url.searchParams.set('settlements', JSON.stringify({ config: { mode: 'auto', distribution: 'zipf', main: spec } }));
url.searchParams.set('roads', JSON.stringify({ config: JSON.parse(process.env.ROADS ?? '{}') }));
mkdirSync('out/terrain-roads', { recursive: true });
try {
  await page.goto(url.href);
  await page.waitForFunction(() => document.getElementById('roadStatus')?.textContent.startsWith('Rust ·') && !document.getElementById('roadStage').hasAttribute('aria-busy'), null, { timeout: 300000 });
  await page.waitForTimeout(1500);
  const stats = await page.evaluate(() => {
    const r = window.__roadOutput, s = window.__settlementOutput;
    const steep = [...r.segments].sort((a, b) => b.grade - a.grade).slice(0, 5).map(x => ({ class: x.class, grade: +x.grade.toFixed(3), km: +(x.length / 1000).toFixed(2) }));
    return { places: s.settlements.length, segments: r.segments.length, junctions: r.junctions.length, routes: r.routes, ms: Math.round(r.ms), placeMs: Math.round(s.ms), byClass: r.lengthByClass, bySurface: r.lengthBySurface, unreachable: r.unreachable, steep, status: document.getElementById('roadStatus').textContent };
  });
  console.log(JSON.stringify(stats, null, 1));
  const tag = `${relief}-${seed}${process.env.TAG ?? ''}`;
  if (process.env.DUMP) {
    // Adapted raster + sites + road options, for native analysis (rust/crates/core/examples/roads_inspect.rs).
    const adapterUrl = `/@fs/${fileURLToPath(new URL('../../rust/bridge/settlements.ts', import.meta.url)).replaceAll('\\', '/')}`;
    const dump = await page.evaluate(async adapterUrl => {
      const { settlementRaster } = await import(adapterUrl);
      const r = settlementRaster(window.__terrain);
      const b64 = a => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
      const s = window.__settlementOutput.settlements.map(s => ({ key: s.key, population: s.population, culture: s.culture, center: s.center, radius: s.radius }));
      return { width: r.width, n: r.n, height: b64(r.height), water: b64(r.water), waterLevel: b64(r.waterLevel), riverWidth: b64(r.riverWidth), riverIds: b64(r.riverIds), sites: s };
    }, adapterUrl);
    writeFileSync(`out/terrain-roads/${tag}-dump.json`, JSON.stringify(dump));
  }
  await page.screenshot({ path: `out/terrain-roads/${tag}-full.png` });
  // Zoom onto the steepest segment.
  const target = await page.evaluate(() => {
    const s = [...window.__roadOutput.segments].sort((a, b) => b.grade - a.grade)[0];
    return s.path[Math.floor(s.path.length / 2)];
  });
  const view = new URL(page.url()); view.searchParams.set('view', process.env.ZOOM ?? `${target.x.toFixed(0)},${target.y.toFixed(0)},0.25`);
  await page.goto(view.href);
  await page.waitForFunction(() => document.getElementById('roadStatus')?.textContent.startsWith('Rust ·') && !document.getElementById('roadStage').hasAttribute('aria-busy'), null, { timeout: 300000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `out/terrain-roads/${tag}-zoom.png` });
  console.log(JSON.stringify({ errors }));
} finally { await browser.close(); }
