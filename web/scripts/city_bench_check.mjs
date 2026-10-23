// From web/: node scripts/city_bench_check.mjs [--server http://127.0.0.1:8791] [--maps city-01-river-plain-s,...] [--out out/city-bench] [--parcels]
// Opens each City Bench map on the native Rust profile, runs the city plan
// (and parcels with --parcels), and records the plan, timings and screenshots.
// The browser runs without GPU: the bench draws SVG and the RTX 5090 stays free.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const server = option('server', 'http://127.0.0.1:8791');
const maps = option('situation', '') ? ['situation'] : option('maps', 'city-01-river-plain-s,city-09-boreal-river-s,city-13-temperate-valley-s').split(',');
const out = option('out', 'out/city-bench');
const parcels = args.includes('--parcels');
const bench = option('bench', 'http://127.0.0.1:5173/citybench.html');
// --position x,y moves the city to that point (metres) before planning.
const position = option('position', '')?.split(',').map(Number);
// --zoom cx,cy,metresPerPixel adds a close-up screenshot.
const zoom = option('zoom', '')?.split(',').map(Number);
// --situation <MU1.… code>: open that exact situation and add a close-up at each pin.
const situation = option('situation', '');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true, args: ['--disable-gpu'] });
const reports = [];
try {
  for (const id of maps) {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    const errors = [], responses = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', async response => {
      if (!response.url().endsWith('/urban') || response.request().method() !== 'POST') return;
      try {
        const request = JSON.parse(response.request().postData() ?? '{}'), body = await response.json();
        responses.push({ kind: request.kind, request, ...(body.data ?? body) });
      } catch (error) { errors.push(String(error)); }
    });
    const url = new URL(bench);
    for (const [k, v] of Object.entries(situation ? { standalone: '1', situation } : { standalone: '1', profile: 'local', localServer: server, artifact: id })) url.searchParams.set(k, v);
    const started = Date.now();
    await page.goto(url.href);
    await page.waitForFunction(() => window.magnaBenchContext?.ready(), undefined, { timeout: 120000 });
    const busy = kind => page.locator(`#${kind} [data-apply]`).getAttribute('aria-busy');
    const waitIdle = async (kind, timeout = 600000) => {
      await page.waitForFunction(k => document.querySelector(`#${k} [data-apply]`)?.getAttribute('aria-busy') !== 'true', kind, { timeout });
    };
    // The plan may already be computing from the restored map; otherwise ask for it.
    await page.waitForTimeout(1500);
    if (position?.length === 2) {
      await waitIdle('urbanQuarterStage');
      responses.length = 0;
      await page.locator('#setX').fill(String(position[0]));
      await page.locator('#setY').fill(String(position[1]));
      await page.locator('#setY').dispatchEvent('change');
      await page.waitForFunction(() => document.querySelector('#urbanQuarterStage [data-apply]')?.getAttribute('aria-busy') === 'true', undefined, { timeout: 60000 }).catch(() => {});
    }
    if (!responses.some(r => r.kind === 'quarters') && await busy('urbanQuarterStage') !== 'true') await page.locator('#urbanQuarterStage [data-apply]').click();
    await page.waitForFunction(() => true);
    await waitIdle('urbanQuarterStage');
    await page.waitForTimeout(500);
    if (parcels) {
      if (!responses.some(r => r.kind === 'parcels')) await page.locator('#urbanParcelStage [data-apply]').click();
      await waitIdle('urbanParcelStage');
    }
    await page.waitForTimeout(800);
    const quarters = responses.filter(r => r.kind === 'quarters' && r.layouts).at(-1);
    const layout = quarters?.layouts?.[0];
    const report = { id, ms: Date.now() - started, errors: [...errors, ...responses.filter(r => r.error).map(r => r.error)] };
    if (layout) {
      const s = layout.structure ?? {};
      Object.assign(report, {
        mechanism: s.mechanism, family: s.family, components: s.allocated?.length, centers: s.centers?.length,
        metrics: s.metrics, blocks: layout.blocks.length, streets: layout.streets.length,
        crossings: layout.streets.filter(t => ['bridge', 'ford', 'causeway'].includes(t.role)).length,
        warnings: layout.warnings, quartersMs: quarters.ms,
      });
      writeFileSync(`${out}/${id}-layout.json`, JSON.stringify(layout));
      // Replayable inputs: node scripts/city_replay.mjs --decor <id> --request <file>
      const { layouts: _l, partitions: _p, session: _s, ...request } = quarters.request;
      writeFileSync(`${out}/${id}-quarters-request.json`, JSON.stringify(request));
    }
    const partition = responses.filter(r => r.kind === 'parcels' && r.partitions).at(-1);
    if (partition) {
      Object.assign(report, { parcels: partition.partitions[0]?.parcels?.length, parcelsMs: partition.ms });
      writeFileSync(`${out}/${id}-partition.json`, JSON.stringify(partition.partitions[0]));
    }
    report.status = await page.locator('#urbanQuarterStage [data-status]').textContent().catch(() => '');
    await page.locator('#focusCity').click().catch(() => {});
    await page.waitForTimeout(600);
    await page.locator('#viewport').screenshot({ path: `${out}/${id}.png` });
    if (zoom?.length === 3) {
      await page.evaluate(([cx, cy, mpp]) => window.magnaBenchContext.restore({ view: { cx, cy, scale: 1 / mpp } }), zoom);
      await page.waitForTimeout(800);
      await page.locator('#viewport').screenshot({ path: `${out}/${id}-zoom.png` });
    }
    if (situation) {
      // The bench reloads itself on the situation's own query; pins come back with it.
      const pins = await page.evaluate(() => Array.from(document.querySelectorAll('#situationPins li small')).map(e => e.textContent.split(',').map(v => parseFloat(v))));
      report.pins = pins;
      for (const [i, [x, y]] of pins.entries()) {
        await page.evaluate(([cx, cy]) => window.magnaBenchContext.restore({ view: { cx, cy, scale: 2 } }), [x, y]);
        await page.waitForTimeout(800);
        await page.locator('#viewport').screenshot({ path: `${out}/${id}-pin${i + 1}.png` });
      }
    }
    reports.push(report);
    console.log(JSON.stringify(report));
    await page.close();
  }
} finally { await browser.close(); }
writeFileSync(`${out}/result.json`, JSON.stringify(reports, null, 2));
