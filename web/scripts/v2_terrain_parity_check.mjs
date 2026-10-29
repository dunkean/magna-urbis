/** Real WASM terrain/water regression, served by Vite; no native service or GPU is required. */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
const web = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/');
const base = process.env.MAGNA_V2_URL ?? 'http://127.0.0.1:5175';
const result = { time: new Date().toISOString(), checks: [] };
let browser;
try {
  browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true, args: ['--disable-gpu', '--use-angle=swiftshader'] });
  const page = await browser.newPage();
  await page.goto(`${base}/v2.html?empty`, { waitUntil: 'domcontentloaded' });
  const cases = [
    { name: 'multidirectional-coast-rust-water', seed: 'v2-terrain-parity', width: 2400, relief: 'hills', compute: 'cpu', source: 'procedural', terrain: {
      motifSize: 3700, coastMask: 68, resolution: 64, erosion: .1, erosionTuning: { iterations: 3, surfaceIterations: 0 }, hydrology: { resolution: 256, compute: 'cpu', main: 'stream', condMode: 'none' } } },
    { name: 'no-water-retains-relief', seed: 'v2-terrain-parity', width: 2400, relief: 'hills', compute: 'cpu', source: 'procedural', terrain: {
      motifSize: 3700, coastMask: 68, resolution: 64, erosion: .1, erosionTuning: { iterations: 3, surfaceIterations: 0 }, hydrology: { enabled: false } } },
    { name: 'caldera-100km', seed: 'v2-caldera-wide', width: 100000, relief: 'caldera', compute: 'cpu', source: 'procedural', terrain: {
      environment: 'high-mountains', motifSize: 17500, coastMask: 0, resolution: 64, erosion: 0, hydrology: { enabled: false } } },
    { name: 'vector-water-custom-climate', seed: 'v2-vector-parity', width: 2400, relief: 'flat', compute: 'cpu', source: 'procedural', terrain: {
      coastMask: 16, motifSize: 5000, resolution: 64, erosion: 0, climateValues: { temperature: 25, temperatureStd: 200, precipitation: 1800, precipitationCv: 40 },
      hydrology: { engine: 'vector', vectorResolution: 512, riverArea: .025, condMode: 'none', balance: true, sinuosity: 2.2, braiding: 1.5 } } },
  ];
  for (const { name, ...request } of cases) {
    const check = await page.evaluate(async ({ web, request }) => {
      const { generateEngineHeight } = await import(`/@fs/${web}/src/v2/platform.ts`);
      const { projectEngineTerrain } = await import(`/@fs/${web}/src/v2/terrainProjection.ts`);
      const events = [], output = await generateEngineHeight(request, event => events.push(event));
      const t = projectEngineTerrain(output.terrain);
      let hash = 2166136261; for (const byte of new Uint8Array(t.height.data.buffer)) hash = Math.imul(hash ^ byte, 16777619);
      return { stats: output.stats, width: output.terrain.width, resolution: t.height.w, hydrologyResolution: output.terrain.hydrology?.resolution,
        vectorResolution: output.terrain.water?.hydro.n, rivers: t.rivers.length, lakes: t.lakes.length, seaFraction: t.seaFraction,
        heightHash: hash >>> 0, field: output.terrain.field ? { n: output.terrain.field.n, exact: output.terrain.field.exact } : null,
        finite: t.height.data.every(Number.isFinite), receiversValid: t.receiver.every(v => v >= -1 && v < t.receiver.length), events };
    }, { web, request });
    if (!check.finite || !check.receiversValid || check.width !== request.width || check.resolution !== 64 || !check.field) throw new Error(`Invalid result for ${name}: ${JSON.stringify(check)}`);
    if (request.terrain.hydrology.enabled === false && check.stats.hydrologyBackend !== 'disabled') throw new Error('Disabled water was regenerated.');
    if (request.terrain.hydrology.engine === 'vector' && !check.vectorResolution) throw new Error('Selected vector water was not retained.');
    result.checks.push({ name, ...check });
    console.log(`${name}: ${check.stats.backend}, water ${check.stats.hydrologyBackend}, ${check.rivers} rivers, ${check.width} m`);
  }
  result.ok = true;
} catch (error) { result.ok = false; result.error = error.stack; process.exitCode = 1; }
finally {
  await browser?.close(); await mkdir(`${web}/out`, { recursive: true });
  await writeFile(`${web}/out/v2-terrain-parity-check.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
