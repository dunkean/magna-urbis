// From web/: node scripts/urban_natural_scenes_check.mjs [--baseline]
// Five frozen sites compare automatic geography and explicit user intentions.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const baseline = process.argv.includes('--baseline');
const out = `out/urban-natural/scenes-${baseline ? 'before' : 'after'}`;
mkdirSync(out, { recursive: true });
const base = new URL(process.env.URBAN_BENCH_URL ?? 'http://127.0.0.1:5173/urbanbench.html');
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
await page.routeWebSocket('**', () => {});
const errors = [], reports = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  const Base = window.Worker;
  window.naturalResults = [];
  window.Worker = class extends Base {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', event => {
        if (event.data.layouts || event.data.partitions || event.data.error) window.naturalResults.push(event.data);
      });
    }
  };
});

const scenes = [
  { id: 'organic-flat', label: 'Organique · plaine', terrain: 'flat', culture: 'european-organic', epochs: 3 },
  { id: 'organic-valley', label: 'Organique · vallée courbe', terrain: 'valley', culture: 'european-organic', epochs: 3 },
  { id: 'chinese-valley', label: 'Fondation chinoise · vallée courbe', terrain: 'valley', culture: 'chinese', epochs: 1 },
  { id: 'chinese-flat', label: 'Fondation chinoise · plaine', terrain: 'flat', culture: 'chinese', epochs: 1 },
  { id: 'explicit-circle-valley', label: 'Ovale planifié explicite · vallée courbe', terrain: 'valley', culture: 'european-organic', epochs: 3, mechanism: 'planned', family: 'circle' },
];

async function decor(scene) {
  const bytes = await page.evaluate(async ({ moduleUrl, scene }) => {
    const { encodeDecor } = await import(moduleUrl);
    const n = 192, width = 6000, size = n * n;
    const valleyX = y => 3000 + 400 * Math.sin((y - 3000) / 950);
    const height = new Float32Array(size);
    let minHeight = Infinity, maxHeight = -Infinity;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const px = (x + 0.5) * width / n, py = (y + 0.5) * width / n;
      const dy = py - 3000, dx = px - valleyX(py);
      const h = scene.terrain === 'flat' ? 100 : 100 + 0.01 * dy + 8 * Math.sin(dy / 780) + 0.00085 * dx * dx;
      height[y * n + x] = h; minHeight = Math.min(minHeight, h); maxHeight = Math.max(maxHeight, h);
    }
    const path = Array.from({ length: 101 }, (_, i) => {
      const y = 500 + i * 50;
      return { x: scene.terrain === 'valley' ? valleyX(y) : 3000, y };
    });
    const length = path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - path[i].x, p.y - path[i].y), 0);
    const roads = { segments: [{ path, class: 'main', surface: 'dirt', profile: scene.culture === 'chinese' ? 'chinese' : 'european', width: 6, a: 0, b: 1, length, grade: 0.025, importance: 1, crossings: [] }],
      junctions: [], warnings: [], unreachable: [], routes: 1, lengthByClass: { main: length }, lengthBySurface: { dirt: length }, ms: 0 };
    const meta = { format: 'magna-decor', version: 1, id: `natural-${scene.id}`, label: scene.label,
      tags: { relief: scene.terrain === 'flat' ? 'flat' : 'mountains', coast: 'inland', roads: 'main', culture: scene.culture }, seed: 'natural-sites-2026-10-13', width,
      query: '', created: '2026-10-13T00:00:00Z', settlements: [], roadConfig: null, roads, waterSvg: '',
      stats: { land: 1, minHeight, maxHeight, roadKm: length / 1000, riverKm: 0 } };
    return Array.from(encodeDecor({ meta, raster: { n, width, height, water: new Uint8Array(size),
      waterLevel: new Float32Array(size), riverWidth: new Float32Array(size), riverIds: new Int32Array(size).fill(-1) } }));
  }, { moduleUrl: `/@fs/${process.cwd().replaceAll('\\', '/')}/src/ui/decor.ts`, scene });
  const bytesBuffer = Buffer.from(bytes); writeFileSync(`${out}/${scene.id}.decor`, bytesBuffer);
  await page.route(`**/decors/natural-${scene.id}.decor`, route => route.fulfill({ body: bytesBuffer, contentType: 'application/octet-stream' }));
}

async function ready() {
  await page.waitForFunction(() => window.naturalResults.some(r => r.error || r.partitions)
    && document.querySelector('#urbanQuarterStage [data-apply]')?.getAttribute('aria-busy') !== 'true'
    && document.querySelector('#urbanParcelStage [data-apply]')?.getAttribute('aria-busy') !== 'true', undefined, { timeout: 180000 });
  const failures = await page.evaluate(() => window.naturalResults.filter(r => r.error));
  assert.deepEqual(failures, [], 'Native generation must return a scene rather than fail');
}

async function frameCity() {
  // The startup camera is clamped before the decor loads; use the real focus
  // control, then keep the same physical scale in every comparison image.
  await page.locator('#focusSeed').click();
  await page.locator('#viewport').evaluate(viewport => {
    const box = viewport.getBoundingClientRect(), map = viewport.querySelector('svg');
    const current = viewport.clientWidth / map.viewBox.baseVal.width;
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -Math.log(0.55 / current) / 0.0015, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, cancelable: true }));
  });
  await page.waitForTimeout(180);
}

function configuration(scene) {
  return { enabled: true, parcelEnabled: true, target: 'natural-city', quarterSeed: '', parcelSeed: '',
    layoutConfig: { scope: 'settlement', settlementForm: 'auto', suburbs: 'auto', phases: 0, preset: 'culture', culture: 'site', recipe: 'auto', zone: 'auto', density: 1, count: 4, rings: 1, radius: 0, radiusScale: 1, placement: 'center', params: {}, monument: 'none', fortification: 'culture', maxStreetGrade: 0.12, maxLaneGrade: 0.18, maxStairGrade: 0.65, allowStairs: true,
      footprint: { mechanism: scene.mechanism ?? 'auto', family: scene.family ?? 'auto', budget: 'population', grossDensity: 100, aspect: 1.4, orientation: 0, nuclei: 3, irregularity: 0.2, anisotropy: 0.65, separation: 1.3, epochs: scene.epochs }, tissue: 'culture', accessMode: 'adaptive', accessDepth: 0, accessBudget: 4 },
    parcelConfig: { preset: 'culture', culture: 'site', recipe: 'auto', zone: 'auto', density: 1, params: {}, operator: 'culture' },
    render: { reserve: false, allocated: true, centers: false, domains: true, quarters: false, blocks: true, streets: true, enclosures: true, parcels: true, gardens: true, places: true, fronts: false, axes: false, access: false, opacity: 0.8, width: 0.6, palette: 'growth' } };
}

try {
  await page.goto(`${base.origin}/urbanbench.html?city=${encodeURIComponent(JSON.stringify({ removed: true }))}`);
  for (const scene of scenes) await decor(scene);
  for (const scene of scenes) {
    const url = new URL(base.href);
    url.searchParams.set('decor', `natural-${scene.id}`);
    url.searchParams.set('city', JSON.stringify({ key: 'natural-city', name: scene.label, population: 3000, culture: scene.culture, center: { x: 3000, y: 3000 }, radius: 400, site: '', roads: 'decor' }));
    url.searchParams.set('urban', JSON.stringify(configuration(scene)));
    url.searchParams.set('landuse', JSON.stringify({ enabled: false }));
    url.searchParams.set('view', '3000,3000,0.65');
    await page.goto(url.href); await ready();
    const results = await page.evaluate(() => window.naturalResults);
    const layout = results.find(r => r.layouts)?.layouts[0], partition = results.find(r => r.partitions)?.partitions[0];
    assert.ok(layout?.structure && layout.quarters.length && layout.blocks.length && partition?.parcels.length);
    const rings = [...layout.structure.allocated, ...layout.quarters.map(q => q.shape), ...layout.blocks.map(b => b.shape), ...partition.parcels.map(p => p.shape)];
    assert.ok(rings.every(s => [s.outer, ...s.holes].every(r => r.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)))), 'All native geometry must remain finite');
    if (scene.id === 'chinese-flat') {
      assert.equal(layout.structure.mechanism, 'planned'); assert.equal(layout.structure.family, 'rectangle');
    }
    if (scene.mechanism) {
      assert.equal(layout.structure.mechanism, scene.mechanism); assert.equal(layout.structure.family, scene.family);
    }
    if (!baseline && ['organic-flat', 'organic-valley', 'chinese-valley'].includes(scene.id)) assert.equal(layout.structure.mechanism, 'accessibility');
    const points = layout.structure.allocated.flatMap(s => s.outer);
    const bounds = { minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)) };
    const report = { id: scene.id, label: scene.label, population: 3000, requested: configuration(scene).layoutConfig.footprint,
      mechanism: layout.structure.mechanism, family: layout.structure.family, bounds, components: layout.structure.allocated.length,
      blocks: layout.blocks.length, streets: layout.streets.length, parcels: partition.parcels.length,
      metrics: layout.structure.metrics, diagnostics: partition.diagnostics, warnings: [...layout.warnings, ...partition.warnings],
      timings: results.map(r => ({ kind: r.layouts ? 'quarters' : 'parcels', ms: r.ms })) };
    await frameCity();
    report.view = await page.locator('#map').evaluate(map => {
      const b = map.viewBox.baseVal;
      return { cx: b.x + b.width / 2, cy: b.y + b.height / 2, scale: map.parentElement.clientWidth / b.width };
    });
    writeFileSync(`${out}/${scene.id}-geometry.json`, JSON.stringify({ layout, partition }));
    writeFileSync(`${out}/${scene.id}-replay.txt`, page.url());
    if (scene.id === 'organic-valley') {
      const snapshot = JSON.stringify({ layout, partition }), replay = page.url();
      await page.goto(replay); await ready();
      const replayed = await page.evaluate(() => ({ layout: window.naturalResults.find(r => r.layouts).layouts[0], partition: window.naturalResults.find(r => r.partitions).partitions[0] }));
      assert.equal(JSON.stringify(replayed), snapshot, 'The curved-valley city must replay exactly');
      report.exactReplay = true;
      await frameCity();
    }
    await page.locator('#viewport').screenshot({ path: `${out}/${scene.id}.png` });
    reports.push(report);
    console.log(JSON.stringify({ id: scene.id, mechanism: report.mechanism, family: report.family, blocks: report.blocks, parcels: report.parcels, timings: report.timings }));
  }
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/result.json`, JSON.stringify({ scenes: reports, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png` });
  console.error(await page.locator('[data-status], [data-warnings], #status').allTextContents());
  throw error;
} finally { await browser.close(); }
