// From web/: node scripts/terrainwater_ui_check.mjs [terrainbench URL]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const target = new URL(process.argv[2] ?? 'http://localhost:5173/terrainbench.html');
if (!target.search) target.search = new URLSearchParams({
  engine: 'rust', v: '4', seed: '7', width: '40000', motif: '8000', relief: 'flat', erosion: '1', style: 'parchment', auto: '1',
  hydro_enabled: '1', hydro_engine: 'vector', hydro_condMode: 'both', hydro_condStrength: '2', hydro_condDepth: '30', hydro_condLength: '3000',
  hydro_riverArea: '0', hydro_lakeDepth: '1', hydro_lakeArea: '10', hydro_riverMode: 'vector', hydro_flatSlope: '1', hydro_sinuosity: '1.8',
  hydro_vectorWidth: '3', hydro_vectorResolution: '1024', hydro_balance: '1', hydro_braiding: '1', hydro_anabranching: '1', hydro_terrainInfluence: '1',
  hydro_avulsions: '1', hydro_confluence: 'climate', hydro_deltas: '1', overlay: 'none', water: '1', contours: '1',
  light_azimuth: '230', light_elevation: '45', light_strength: '0.2', light_exaggeration: '0.9', climate: 'temperate', refine: '1', lakes: '1', oxbows: '1',
  coasts: 'S', islands: 'island', compute: 'gpu-f32', generation: 'gpu-erosion',
  pins: '25643.4,32305.8,;5963.9,32215.5,;31059.8,21224.7,', view: '19820.8,29101.1,0.04431',
}).toString();
if (process.env.PLAYWRIGHT_RENDER === 'svg') target.searchParams.set('render', 'svg');
const output = resolve(target.searchParams.get('render') === 'svg' ? 'out/terrainwater-svg' : 'out/terrainwater');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', ...(process.env.PLAYWRIGHT_SOFTWARE === '1' ? ['--use-angle=swiftshader'] : [])] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
const errors = [];
await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(() => {
  const WorkerBase = window.Worker;
  window.Worker = class extends WorkerBase {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', event => {
        if (event.data?.terrain?.water) window.__waterTest = event.data.terrain.water;
      });
    }
  };
});
try {
  await page.goto(target.href);
  await page.waitForFunction(() => window.__waterTest && document.getElementById('hydrologyStatus').textContent.startsWith('Vector water'), null, { timeout: 180000 });
  const audit = await page.evaluate(async () => {
    const { lakeField, lakeSample } = await import('/lakeGeometry.ts');
    const { riverSegments } = await import('/vectorWaterRender.ts');
    const water = window.__waterTest, h = water.hydro, cell = h.width / h.n;
    const field = lakeField(water.lake, h.n), rivers = water.rivers.rivers;
    const terrainAt = (x, y) => {
      const gx = Math.max(0, Math.min(h.n - 1.000001, x / cell - 0.5)), gy = Math.max(0, Math.min(h.n - 1.000001, y / cell - 0.5));
      const ix = Math.floor(gx), iy = Math.floor(gy), u = gx - ix, v = gy - iy, c = iy * h.n + ix;
      return (h.height[c] * (1 - u) + h.height[c + 1] * u) * (1 - v) + (h.height[c + h.n] * (1 - u) + h.height[c + h.n + 1] * u) * v;
    };
    const distance = (x, y, points) => {
      let best = Infinity;
      for (let k = 0; k + 3 < points.length; k += 2) {
        const ax = points[k], ay = points[k + 1], dx = points[k + 2] - ax, dy = points[k + 3] - ay, length = dx * dx + dy * dy;
        const t = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0;
        best = Math.min(best, Math.hypot(x - ax - dx * t, y - ay - dy * t));
      }
      return best;
    };
    const orphans = [];
    for (const line of rivers) {
      const p = line.points, x = p[p.length - 2], y = p[p.length - 1];
      const cx = Math.max(0, Math.min(h.n - 1, Math.floor(x / cell))), cy = Math.max(0, Math.min(h.n - 1, Math.floor(y / cell))), c = cy * h.n + cx;
      if (Math.min(x, y, h.width - x, h.width - y) < 0.2 || h.sea[c] || terrainAt(x, y) <= 1e-4 || lakeSample(field, h.width, x, y) > -0.002) continue;
      let nearest = Infinity;
      for (const other of rivers) if (other !== line) nearest = Math.min(nearest, distance(x, y, other.points));
      if (nearest > 1) orphans.push({ id: line.id, joins: line.joins, x, y, nearest, shore: lakeSample(field, h.width, x, y), lake: water.lake[c], kind: water.lakeKind[c], height: h.height[c], depth: h.filled[c] - h.height[c], receiver: h.receiver[c], lakeLevel: water.lakeLevel[c], outlet: line.outlet, outletLake: water.lake[line.outlet], outletHeight: h.height[line.outlet], outletKind: water.lakeKind[line.outlet] });
    }
    const display = { style: 'parchment', showLakes: true, showOxbows: true, riverArea: 4.8, riverMode: 'vector', overlay: 'none' };
    const shown = riverSegments(water, display), hidden = riverSegments(water, { ...display, showLakes: false });
    const widths = shown.filter((_, i) => i % 9 === 4);
    return { rivers: rivers.length, lakes: water.lakes, lakeLinks: water.rivers.lakeLinks.length, orphans, shownSegments: shown.length / 9, hiddenSegments: hidden.length / 9,
      status: document.getElementById('status').textContent, hydroStatus: document.getElementById('hydrologyStatus').textContent, gpu: document.getElementById('viewport').className, svgPaths: document.querySelectorAll('#hydrologyOverlay .water path').length,
      widths: { min: Math.min(...widths), max: Math.max(...widths) } };
  });
  console.log(JSON.stringify(audit, null, 2));
  writeFileSync(resolve(output, 'audit.json'), JSON.stringify(audit, null, 2));
  for (const [i, x, y] of [[1, 25643.4, 32305.8], [2, 5963.9, 32215.5], [3, 31059.8, 21224.7]]) {
    await page.evaluate(([x, y]) => window.__setView(x, y, 0.45), [x, y]);
    await page.screenshot({ path: resolve(output, `pin-${i}.png`) });
    await page.locator('#showLakes').uncheck();
    await page.screenshot({ path: resolve(output, `pin-${i}-hidden.png`) });
    await page.locator('#showLakes').check();
  }
  assert.equal(audit.orphans.length, 0, 'River mouths must reach water, another channel or the map edge');
  assert.ok(audit.hiddenSegments > audit.shownSegments, 'Hiding lakes must expose their retained connections');
  if (target.searchParams.get('render') === 'svg') assert.ok(audit.svgPaths > 0 && audit.svgPaths < 10, 'SVG must batch tapered banks instead of creating thousands of DOM paths');
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('Terrain water UI and topology checks passed');
} finally { await browser.close(); }
