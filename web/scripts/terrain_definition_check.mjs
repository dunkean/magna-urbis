// Physical definition check: one seed and width, sources from 256² to 4096², real browser WebGPU.
// Run from web/ with the dev server up: node scripts/terrain_definition_check.mjs [--page=terrainbench|v2]
// Both pages run the same bridge module. `terrainbench` also saves one screenshot per case; V2 takes
// no settings from its URL, so `v2` saves a single page screenshot. Ports 5173 and 5174; MAGNA_BENCH_ORIGIN overrides.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const page_ = process.argv.find(arg => arg.startsWith('--page='))?.slice(7) ?? 'terrainbench';
const origin = process.env.MAGNA_BENCH_ORIGIN ?? `http://127.0.0.1:${page_ === 'v2' ? 5174 : 5173}`;
const root = fileURLToPath(new URL('../..', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '');
const out = fileURLToPath(new URL('../out/terrain-definition/', import.meta.url));
await mkdir(out, { recursive: true });

// A power-of-two width keeps width / spacing exact, so ceil() gives the intended n.
const WIDTH = 32768, MOTIF = 10000, SEED = 'definition-check', COMMON = 256, REFERENCE = 1024;
const SIZES = [256, 512, 1024, 2048, 4096], RELIEFS = ['mountains', 'hills'], CPU_CHECK_N = 512;
// Landforms: heights in fractions of the reference p1-p99 span; slopes on one common 128 m baseline,
// because slopes at native spacing rightly grow with finer detail and are reported only.
const LIMITS = { height: .08, slopeRatio: 1.35, correlation: .97 };
const CPU_LIMITS = { height: .2, slopeRatio: 1.6, correlation: .9 };

const settingsFor = (relief, n, extra = {}) => ({ source: 'procedural', seed: SEED, width: WIDTH, sampleSpacing: WIDTH / n, motifSize: MOTIF, relief, erosion: 1, mountainMix: .5,
  resolution: 512, compute: 'gpu-f32', generationCompute: 'gpu-erosion', climate: 'temperate', coastMask: 0, refine: false, hydrology: { enabled: false }, ...extra });

/** Runs in the page. Only statistics and the common grid leave it: a 4096² field stays there. */
async function measure({ root, settings, common, repeatSeed }) {
  const { sampleRustTerrain } = await import(`/@fs/${root}/rust/bridge/terrain.ts`);
  const run = async value => {
    const id = window.__definitionRuns = (window.__definitionRuns ?? 0) + 1, started = performance.now();
    const data = await sampleRustTerrain({ id, generation: id, kind: 'overview', display: 'gl', settings: value, region: { x: 0, y: 0, extent: value.width, resolution: 512 }, retainField: true });
    return { data, ms: performance.now() - started };
  };
  const { data, ms } = await run(settings);
  const { n, height } = data.physical, cell = settings.width / n;
  const quantiles = (values, ranks) => Object.fromEntries(ranks.map(rank => [`p${rank}`, values[Math.min(values.length - 1, Math.floor(values.length * rank / 100))]]));
  const slopes = (field, size, spacing) => {
    const result = new Float32Array((size - 2) ** 2); let k = 0;
    for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++)
      result[k++] = Math.hypot(field[y * size + x + 1] - field[y * size + x - 1], field[(y + 1) * size + x] - field[(y - 1) * size + x]) / (2 * spacing);
    return result.sort();
  };
  const heights = Float32Array.from(height).sort();
  let sum = 0; for (let i = 0; i < height.length; i++) sum += height[i];
  // Box mean onto one physical grid, so that every definition is measured at the same baseline.
  const step = n / common, field = new Float32Array(common * common);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) field[Math.floor(y / step) * common + Math.floor(x / step)] += height[y * n + x] / (step * step);
  // Same size, new seed: pipelines and buffers already exist, so this is the time a user waits next.
  const repeat = repeatSeed ? await run({ ...settings, seed: repeatSeed }) : undefined;
  const pick = value => value && { factor: value.factor, coarseSize: value.coarseSize, surfaceSize: value.surfaceSize, allocatedMiB: Math.round((value.allocatedBytes ?? 0) / 1048576), gpuStagesMs: value.gpuStagesMs, maxSolveSteps: value.maxSolveSteps };
  return { n, spacing: cell, backend: data.generationBackend, reason: data.generationReason, sampling: data.backend,
    erosionSpacing: data.definition?.erosionSpacing, regionalErosionSpacing: data.definition?.regionalErosionSpacing,
    timeMs: { first: ms, nextSeed: repeat?.ms, prepare: data.prepareMs, gpuSimulation: data.gpuSimulationMs, sampling: data.samplingMs }, profile: pick(data.erosionProfile?.at(-1)),
    height: { min: heights[0], max: heights.at(-1), mean: sum / height.length, ...quantiles(heights, [1, 5, 25, 50, 75, 95, 99]) },
    slopeNative: quantiles(slopes(height, n, cell), [50, 90, 99]), slopeCommon: quantiles(slopes(field, common, settings.width / common), [50, 90, 99]), common: Array.from(field) };
}

function correlation(a, b) {
  const mean = values => values.reduce((sum, v) => sum + v, 0) / values.length, ma = mean(a), mb = mean(b);
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; ab += x * y; aa += x * x; bb += y * y; }
  return ab / Math.sqrt(aa * bb);
}
function compare(reference, item, limits, label, failures) {
  const span = reference.height.p99 - reference.height.p1, result = { correlation: correlation(reference.common, item.common), height: {}, slope: {} };
  for (const rank of ['p5', 'p50', 'p95', 'p99']) {
    result.height[rank] = (item.height[rank] - reference.height[rank]) / span;
    if (Math.abs(result.height[rank]) > limits.height) failures.push(`${label}: height ${rank} moved ${(result.height[rank] * 100).toFixed(1)} % of the span`);
  }
  for (const rank of ['p50', 'p90']) {
    result.slope[rank] = item.slopeCommon[rank] / reference.slopeCommon[rank];
    if (!(result.slope[rank] <= limits.slopeRatio && result.slope[rank] >= 1 / limits.slopeRatio)) failures.push(`${label}: slope ${rank} ratio ${result.slope[rank].toFixed(2)}`);
  }
  if (!(result.correlation >= limits.correlation)) failures.push(`${label}: correlation ${result.correlation.toFixed(3)}`);
  return result;
}
const withoutField = ({ common: _common, ...rest }) => rest;

const browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'chrome', headless: true, args: ['--no-proxy-server', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-webgpu-adapter=d3d12'] });
const report = { origin, page: page_, width: WIDTH, motif: MOTIF, seed: SEED, limits: LIMITS, cases: [], comparisons: {}, failures: [] }, failures = report.failures;
const benchUrl = settings => `${origin}/terrainbench.html?${new URLSearchParams({ standalone: '1', profile: 'web', engine: 'rust', seed: settings.seed, width: String(settings.width), sampleSpacing: String(settings.sampleSpacing), motif: String(settings.motifSize), relief: settings.relief, erosion: '1', source: 'procedural', render: 'svg', compute: 'gpu-f32', generation: 'gpu-erosion', hydro_enabled: '0', forest: '0' })}`;
const ready = page => page.waitForFunction(() => window.magnaBenchContext?.ready() && document.querySelector('#terrainLoading')?.hidden, undefined, { timeout: 600000 });
try {
  const host = await browser.newPage({ viewport: { width: 1600, height: 1100 } }), pageErrors = [];
  host.on('pageerror', error => pageErrors.push(error.message));
  await host.goto(page_ === 'v2' ? `${origin}/v2.html` : benchUrl(settingsFor('hills', 256)), { waitUntil: 'domcontentloaded', timeout: 120000 });
  if (page_ === 'v2') await host.waitForTimeout(5000); else await ready(host);
  await host.screenshot({ path: `${out}/${page_}-page.png` });
  report.adapter = await host.evaluate(async () => { const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' }); return adapter && { info: { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description }, maxBufferSize: adapter.limits.maxBufferSize, maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize }; });
  if (!report.adapter) throw new Error('No WebGPU adapter in this browser.');

  for (const relief of RELIEFS) {
    const rows = new Map();
    for (const n of SIZES) {
      const settings = settingsFor(relief, n);
      let row;
      try {
        row = await host.evaluate(measure, { root, settings, common: COMMON, repeatSeed: `${SEED}-next` });
      } catch (error) { failures.push(`${relief} ${n}²: ${error.message}`); continue; }
      if (row.backend !== 'gpu-erosion-f32') failures.push(`${relief} ${n}²: backend ${row.backend} (${row.reason ?? 'no reason'})`);
      rows.set(n, row); report.cases.push({ relief, ...withoutField(row) });
      console.log(`${relief} ${n}²: ${row.timeMs.first.toFixed(0)} ms, next seed ${row.timeMs.nextSeed?.toFixed(0)} ms, erosion ${row.erosionSpacing?.toFixed(2)} m, height p99 ${row.height.p99.toFixed(1)} m, slope p90 ${row.slopeCommon.p90.toFixed(3)}`);
      if (page_ === 'terrainbench') {
        const shot = await browser.newPage({ viewport: { width: 1600, height: 1100 } }), started = Date.now();
        await shot.goto(benchUrl(settings), { waitUntil: 'domcontentloaded', timeout: 120000 }); await ready(shot);
        report.cases.at(-1).pageMs = Date.now() - started; report.cases.at(-1).status = await shot.locator('#status').textContent();
        await shot.screenshot({ path: `${out}/${relief}-${n}.png` }); await shot.close();
      }
    }
    const reference = rows.get(REFERENCE);
    if (!reference) { failures.push(`${relief}: ${REFERENCE}² did not run`); continue; }
    report.comparisons[relief] = Object.fromEntries([...rows].filter(([n]) => n !== REFERENCE).map(([n, row]) => [n, compare(reference, row, LIMITS, `${relief} ${n}² vs ${REFERENCE}²`, failures)]));
  }

  // GPU and CPU differ by design in sampling and FP32; they must still draw the same land.
  const gpu = await host.evaluate(measure, { root, settings: settingsFor('mountains', CPU_CHECK_N), common: COMMON });
  const cpu = await host.evaluate(measure, { root, settings: settingsFor('mountains', CPU_CHECK_N, { compute: 'wasm', generationCompute: 'cpu' }), common: COMMON });
  report.gpuVsCpu = { n: CPU_CHECK_N, limits: CPU_LIMITS, gpu: withoutField(gpu), cpu: withoutField(cpu), comparison: compare(cpu, gpu, CPU_LIMITS, `GPU vs CPU ${CPU_CHECK_N}²`, failures) };

  // Calibrates generationCostMs: Auto must pick the faster backend on a small source too.
  const small = extra => ({ ...settingsFor('hills', 80, { width: 2400, sampleSpacing: 30, motifSize: 2400 }), ...extra });
  const smallRuns = {};
  for (const [name, extra] of [['gpu', {}], ['cpu', { compute: 'wasm', generationCompute: 'cpu' }], ['auto', { generationCompute: undefined }]]) {
    const row = await host.evaluate(({ settings, root }) => import(`/@fs/${root}/rust/bridge/terrain.ts`).then(async ({ sampleRustTerrain }) => {
      const id = window.__definitionRuns = (window.__definitionRuns ?? 0) + 1, started = performance.now();
      const data = await sampleRustTerrain({ id, generation: id, kind: 'overview', display: 'gl', settings, region: { x: 0, y: 0, extent: settings.width, resolution: 64 } });
      return { ms: performance.now() - started, backend: data.generationBackend, reason: data.generationReason };
    }), { settings: small(extra), root });
    smallRuns[name] = row;
  }
  report.smallSource = { n: 80, ...smallRuns };
  if (pageErrors.length) failures.push(...pageErrors.map(message => `page error: ${message}`));
} catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(failures.length ? `FAILED\n${failures.join('\n')}` : 'Landforms comparable at every definition.');
process.exitCode = failures.length ? 1 : 0;
