// From web/: node scripts/urban_styles_ui_check.mjs [Terrain Bench URL]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = new URL(process.argv[2] ?? 'http://localhost:5173/terrainbench.html?seed=42&width=40000&source=neural&relief=valley&coasts=N&climate=mediterranean&auto=0');
if (!base.searchParams.has('settlements')) base.searchParams.set('settlements', JSON.stringify({ config: { mode: 'counts', distribution: 'classes', main: { key: 'main', population: 3000, culture: 'european-organic' }, counts: { village: 9, hamlet: 12, farmstead: 25 } } }));
if (!base.searchParams.has('urban')) base.searchParams.set('urban', JSON.stringify({ target: 'main', layoutConfig: { composition: 'settlement', culture: 'european-organic', preset: 'culture', recipe: 'auto', zone: 'auto', tissue: 'organic', footprint: { mechanism: 'auto', family: 'composite', budget: 'population' }, fortification: 'none' } }));
const out = 'out/urban-styles'; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const errors = [], reports = [];
async function open(url, fallback = false) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  await page.routeWebSocket('**', () => {});
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ fallback }) => {
    if (fallback) {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) { return type === 'webgl2' ? null : get.call(this, type, ...args); };
    }
    window.urbanCalls = 0;
    const Base = window.Worker;
    window.Worker = class extends Base {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', event => { if (event.data.layouts) window.testLayouts = event.data.layouts; });
      }
      postMessage(message, ...args) { if (message.kind === 'quarters' || message.kind === 'parcels') window.urbanCalls++; super.postMessage(message, ...args); }
    };
  }, { fallback });
  await page.goto(url);
  await page.waitForFunction(() => window.testLayouts?.length && document.querySelector('#urbanParcelStage [data-apply]')?.getAttribute('aria-busy') === 'false', null, { timeout: 120000 });
  const axial = await page.evaluate(() => {
    let perimeter = 0, aligned = 0;
    for (const l of window.testLayouts) for (const s of l.structure?.allocated ?? []) for (let i = 0; i < s.outer.length; i++) {
      const a = s.outer[i], b = s.outer[(i + 1) % s.outer.length], length = Math.hypot(a.x - b.x, a.y - b.y);
      perimeter += length; if (Math.min(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) < length * .001) aligned += length;
    }
    return aligned / perimeter;
  });
  assert(axial < .35, 'The organic allocated outline must not fall back to a lattice staircase');
  return page;
}
async function fingerprint(page) {
  return page.evaluate(() => ({ calls: window.urbanCalls,
    geometry: [...document.querySelectorAll('#urbanOverlay path')].map(p => p.getAttribute('d')),
    roads: [...document.querySelectorAll('#roadOverlay [data-road]')].map(p => p.getAttribute('d')),
  }));
}
async function styles(page, select, label) {
  const initial = await fingerprint(page); assert(initial.roads.length > 0); assert(initial.geometry.length > 0);
  const values = await page.locator(select + ' option').evaluateAll(options => options.map(o => o.value));
  for (const style of values) {
    await page.locator(select).selectOption(style);
    const after = await fingerprint(page);
    assert.deepEqual(after, initial, `${label}/${style}: rendering must keep native urban geometry and the regional roads without regeneration`);
    if (style.startsWith('fantasy-')) assert(await page.locator('#fantasyPainting .fantasy-brushes > use').count() > 0);
    await page.screenshot({ path: `${out}/${label}-${style}.png` });
  }
  const roadStage = page.locator('#roadStage'); await roadStage.evaluate(panel => { panel.open = true; panel.querySelectorAll('details').forEach(d => { d.open = true; }); });
  for (const preset of ['surface', 'atlas', 'topographic', 'ink', 'minimal']) {
    await page.locator('#roadPreset').selectOption(preset);
    assert.deepEqual(await fingerprint(page), initial, `${label}/${preset}: road appearance must retain the same clipping, curves and native junctions`);
  }
  const curves = page.locator('[data-road-style="curves"]'); await curves.uncheck();
  const straight = await fingerprint(page); assert(straight.roads.every(d => !d.includes('C')));
  await curves.check(); assert.deepEqual(await fingerprint(page), initial);
  reports.push({ page: label, styles: values, roadPresets: 5, retainedGeometry: true, regeneration: false });
}
try {
  for (const fallback of [true, false]) {
    const page = await open(base.href, fallback); await page.locator('#urbanFocus').click();
    await styles(page, '#style', fallback ? 'terrain-svg' : 'terrain-webgl'); await page.close();
  }
  const urbanUrl = new URL('/urbanbench.html?decor=d070-flat-bay-SW-town&landuse=' + encodeURIComponent(JSON.stringify({ enabled: false })), base);
  urbanUrl.searchParams.set('urban', JSON.stringify({ layoutConfig: { composition: 'settlement', culture: 'site', mixCulture: 'korean', tissue: 'organic', fortification: 'none', footprint: { mechanism: 'accessibility', family: 'composite', budget: 'population' } } }));
  const urban = await open(urbanUrl.href); await urban.locator('#focusSeed').click(); await styles(urban, '#mapStyle', 'urban');
  assert.deepEqual(errors, []); writeFileSync(`${out}/report.json`, JSON.stringify({ reports, errors }, null, 2));
  console.log(JSON.stringify({ reports, errors }));
} finally { await browser.close(); }
