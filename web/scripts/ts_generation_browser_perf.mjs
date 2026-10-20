// From web/: node scripts/ts_generation_browser_perf.mjs [origin] [baseline module URL] [report.json]
// Optional baseline must export benchLayout/benchParcels/benchBuildings with its
// original dependencies. Runs alternate to limit JIT/temperature/order bias.
// TS_PERF_APP=town (or city) measures the full app pipeline instead; its baseline
// must export generate. TS_PERF_RUNS controls measured runs after one warmup.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const origin = process.argv[2] ?? 'http://localhost:5173';
const baseline = process.argv[3];
const output = process.argv[4] ?? 'out/generation-perf/ts-browser.json';
const root = `/@fs/${process.cwd().replaceAll('\\', '/')}`;
const appSize = process.env.TS_PERF_APP;
const repeats = Math.max(1, Number(process.env.TS_PERF_RUNS ?? 3));
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
try {
  const page = await browser.newPage();
  // An empty same-origin page avoids running another generator during measurement.
  await page.route('**/generation-perf-empty', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Generation benchmark</title>' }));
  await page.goto(new URL('/generation-perf-empty', origin).href);
  const cases = appSize ? [[appSize, { size: appSize, seed: '42' }, '42']]
    : await page.evaluate(async root => (await import(`${root}/scripts/ts_generation_perf_cases.ts`)).TS_GENERATION_PERF_CASES, root);
  const results = [];
  for (const scenario of cases) {
    const result = await page.evaluate(async ({ root, baseline, scenario, appSize, repeats }) => {
      const after = await import(`${root}/src/gen/${appSize ? 'pipeline' : 'urban/testbench'}.ts`);
      const before = baseline ? await import(baseline) : undefined;
      const makeOptions = appSize ? (await import(`${root}/src/gen/options.ts`)).makeOptions : undefined;
      const [name, options, seed] = scenario, samples = { before: [], after: [] };
      const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value,
        (key, v) => appSize && (key.startsWith('ms.') || key.includes('.ms.') || key.includes('slowestBlock')) ? undefined : v)))), b => b.toString(16).padStart(2, '0')).join('');
      let expected;
      for (let repeat = 0; repeat <= repeats; repeat++) {
        const order = before ? repeat % 2 ? ['after', 'before'] : ['before', 'after'] : ['after'];
        for (const variant of order) {
          const api = variant === 'before' ? before : after;
          let times, hashes;
          if (appSize) {
            const config = makeOptions(options), start = performance.now(), world = api.generate(config);
            times = [performance.now() - start]; hashes = [await hash(world)];
          } else {
            const start = performance.now(), layout = api.benchLayout(options, seed), lt = performance.now();
            const parcels = api.benchParcels(layout, seed), pt = performance.now();
            const buildings = api.benchBuildings(layout, parcels, seed), bt = performance.now();
            times = [lt - start, pt - lt, bt - pt, bt - start];
            hashes = await Promise.all([hash({ ...layout, streets: { list: layout.streets.list, connected: [...layout.streets.connected] } }), hash(parcels), hash(buildings)]);
          }
          expected ??= hashes;
          if (hashes.some((h, i) => h !== expected[i])) throw new Error(`${name}: ${variant} geometry differs`);
          if (repeat) samples[variant].push(times);
        }
      }
      const median = values => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
      return { name, hashes: expected, samples, medianMs: Object.fromEntries(Object.entries(samples).filter(([, v]) => v.length).map(([k, v]) => [k, v[0].map((_, i) => median(v.map(t => t[i])))])) };
    }, { root, baseline, scenario, appSize, repeats });
    results.push(result); console.log(JSON.stringify(result));
  }
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify({ browser: await browser.version(), results }, null, 2));
} finally { await browser.close(); }
