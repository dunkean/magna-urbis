// From web/: node scripts/generation_perf.mjs [page URL] [report.json] [reference.json]
// Use the same release build, browser and machine for both reports. Geometry and
// SVG hashes are assertions; timings are observations, never CI thresholds.
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import assert from 'node:assert/strict';

const base = new URL(process.argv[2] ?? 'http://localhost:5173/urbanbench.html');
const output = process.argv[3] ?? 'out/generation-perf/current.json';
const reference = process.argv[4] ? JSON.parse(readFileSync(process.argv[4], 'utf8')) : undefined;
mkdirSync(dirname(output), { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  const Base = window.Worker;
  window.measurements = []; window.completed = 0;
  window.Worker = class extends Base {
    constructor(...args) {
      super(...args); this.starts = new Map();
      this.addEventListener('message', event => {
        const response = event.data, start = this.starts.get(response.id);
        if (!response.layouts && !response.partitions) return;
        if (response.layouts) window.layouts = response.layouts;
        if (response.partitions) { window.partitions = response.partitions; window.completed++; }
        const timing = { kind: response.layouts ? 'quarters' : 'parcels', engine: response.ms,
          roundTrip: start ? performance.now() - start.at : null, post: start?.post };
        window.measurements.push(timing);
        requestAnimationFrame(() => { timing.mainAfterReply = performance.now() - (start.at + timing.roundTrip); });
      });
    }
    postMessage(message, ...args) {
      const start = { at: performance.now(), post: 0 };
      if (message.kind === 'quarters' || message.kind === 'parcels') this.starts.set(message.id, start);
      super.postMessage(message, ...args); start.post = performance.now() - start.at;
    }
  };
});
const hash = value => createHash('sha256').update(value).digest('hex');
const ready = async after => {
  await page.waitForFunction(after => window.completed > after &&
    document.querySelector('#urbanParcelStage [data-apply]')?.getAttribute('aria-busy') === 'false', after, { timeout: 180000 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
};
try {
  const empty = new URL(base); empty.searchParams.set('city', '{"removed":true}');
  await page.goto(empty.href);
  // A portable, deterministic decor avoids the neural service and GPU variance.
  const bytes = await page.evaluate(async moduleUrl => {
    const { encodeDecor } = await import(moduleUrl);
    const n = 64, width = 3200, size = n * n;
    const paths = [[{ x: 100, y: 1600 }, { x: 3100, y: 1600 }], [{ x: 1600, y: 100 }, { x: 1600, y: 3100 }]];
    const segments = paths.map((path, i) => ({ path, class: 'main', surface: 'dirt', profile: 'european', width: 6,
      a: i * 2, b: i * 2 + 1, length: 3000, grade: 0, importance: 1, crossings: [] }));
    const roads = { segments, junctions: [], warnings: [], unreachable: [], routes: 2,
      lengthByClass: { main: 6000 }, lengthBySurface: { dirt: 6000 }, ms: 0 };
    const meta = { format: 'magna-decor', version: 1, id: 'generation-perf', label: 'Performance fixture',
      tags: { relief: 'flat', coast: 'inland', roads: 'main', culture: 'european-organic' }, seed: 'generation-perf', width,
      query: '', created: '2026-10-14T00:00:00Z', settlements: [], roadConfig: null, roads, waterSvg: '',
      stats: { land: 1, minHeight: 20, maxHeight: 20, roadKm: 6, riverKm: 0 } };
    return Array.from(encodeDecor({ meta, raster: { n, width, height: new Float32Array(size).fill(20),
      water: new Uint8Array(size), waterLevel: new Float32Array(size).fill(20),
      riverWidth: new Float32Array(size), riverIds: new Int32Array(size).fill(-1) } }));
  }, `/@fs/${process.cwd().replaceAll('\\', '/')}/src/ui/decor.ts`);
  await page.route('**/decors/generation-perf.decor', route => route.fulfill({ body: Buffer.from(bytes), contentType: 'application/octet-stream' }));
  const cases = [];
  for (const [name, population, culture, tissue] of [
    ['organic-town', 3000, 'european-organic', 'organic'],
    ['organic-city', 10000, 'european-organic', 'organic'],
    ['grid-town', 4000, 'chinese', 'grid'],
  ]) {
    const url = new URL(base); url.searchParams.set('decor', 'generation-perf');
    url.searchParams.set('city', JSON.stringify({ key: 'perf-city', name: 'Performance', population, culture,
      center: { x: 1600, y: 1600 }, radius: 400, site: '', roads: 'decor' }));
    url.searchParams.set('landuse', '{"enabled":false}');
    url.searchParams.set('urban', JSON.stringify({ target: 'perf-city', quarterSeed: 'quarters-42', parcelSeed: 'parcels-42',
      layoutConfig: { scope: 'settlement', culture, tissue, fortification: 'none',
        footprint: { mechanism: 'auto', family: 'compact', budget: 'population' } } }));
    await page.goto(url.href); await ready(0);
    const runs = [];
    // First page load warms WASM. Three subsequent identical generations.
    for (let i = 0; i < 3; i++) {
      const before = await page.evaluate(() => window.completed);
      await page.evaluate(() => { window.measurements = []; window.runStart = performance.now(); document.querySelector('#urbanQuarterStage [data-apply]').click(); });
      await ready(before);
      runs.push(await page.evaluate(() => ({ total: performance.now() - window.runStart, stages: window.measurements })));
    }
    const data = await page.evaluate(() => {
      const svg = selector => {
        const source = document.querySelector(selector); if (!source) return '';
        const copy = source.cloneNode(true);
        // DOM attribute insertion order has no visual meaning (opacity can now
        // update in place). Compare all attributes/paths in canonical order.
        for (const node of [copy, ...copy.querySelectorAll('*')]) {
          const attrs = [...node.attributes].map(a => [a.name, a.value]).sort(([a], [b]) => a.localeCompare(b));
          for (const [key] of attrs) node.removeAttribute(key);
          for (const [key, value] of attrs) node.setAttribute(key, value);
        }
        return copy.outerHTML;
      };
      return { layouts: JSON.stringify(window.layouts), partitions: JSON.stringify(window.partitions),
        svg: svg('#urbanOverlay'), roads: svg('#roadOverlay'),
        counts: { blocks: window.layouts.reduce((n, l) => n + l.blocks.length, 0), parcels: window.partitions.reduce((n, p) => n + p.parcels.length, 0) } };
    });
    const redraws = await page.evaluate(() => {
      const palette = document.querySelector('[data-render="palette"]'), runs = [];
      for (const value of ['ink', 'atlas', 'growth']) { const start = performance.now(); palette.value = value; palette.dispatchEvent(new Event('change')); runs.push(performance.now() - start); }
      return runs;
    });
    const result = { name, counts: data.counts, hashes: { layouts: hash(data.layouts), parcels: hash(data.partitions), svg: hash(data.svg), roads: hash(data.roads ?? '') }, runs, redraws };
    writeFileSync(`${dirname(output)}/${basename(output, '.json')}-${name}.svg`, data.svg);
    cases.push(result);
    if (reference) assert.deepEqual(result.hashes, reference.cases.find(c => c.name === name).hashes, `${name}: complete geometry and rendered paths must be identical`);
    console.log(JSON.stringify(result));
  }
  assert.deepEqual(errors, []);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify({ browser: await browser.version(), cases, errors }, null, 2));
} finally { await browser.close(); }
