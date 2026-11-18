/** Native urban orchestration only: same farms and engine, cold sessions per batch versus a retained pass.
 * No terrain generation, process restart or model download. Uses the existing development server and native service. */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const web = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/');
const base = process.env.MAGNA_V2_URL ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`${base}/v2.html?test=1&empty`, { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(
    async ({ web }) => {
      const { makeOptions } = await import(`/@fs/${web}/src/gen/options.ts`);
      const { generateRustTown, releaseUrbanLanes } = await import(`/@fs/${web}/src/v2/rustUrban.ts`);
      const service = await (await fetch('http://127.0.0.1:8791/status')).json();
      const options = makeOptions({ seed: 'small-place-session-benchmark', culture: 'european-organic', population: 10, walls: 'none', castle: 'no' });
      const settings = { options, extent: 24000, local: {}, urban: { backend: 'native' }, runtime: { backend: 'native', localServer: 'http://127.0.0.1:8791' } };
      const n = 128,
        heights = new Float32Array(n * n).fill(20);
      const world = {
        seed: options.seed,
        options,
        mapSize: 24000,
        terrain: { height: { w: n, h: n, cell: 24000 / n, data: heights }, water: new Uint8Array(n * n), filled: heights, seaLevel: 0, coastline: [], lakes: [], rivers: [] },
        settlements: Array.from({ length: 32 }, (_, i) => ({ key: `farm-${i}`, population: 10, culture: options.culture, center: { x: 2000 + (i % 8) * 2800, y: 2000 + Math.floor(i / 8) * 5000 }, radius: 40 })),
        stats: { 'v2.terrainKey': 'small-place-session-benchmark' },
      };
      const digest = async value =>
        Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))))
          .map(v => v.toString(16).padStart(2, '0'))
          .join('');
      const originalFetch = window.fetch.bind(window),
        runs = [];
      // Exclude module/JIT/connection setup, including the raster-id lookup left after a released pass.
      await Promise.all(Array.from({ length: 4 }, (_, lane) => generateRustTown(world, settings, `farm-${lane}`, undefined, 'buildings', lane, [])));
      await releaseUrbanLanes();
      try {
        // ABBA balances remaining cache, CPU-frequency and run-order effects without a broad sweep.
        for (const retain of [false, true, true, false]) {
          const network = [],
            results = [],
            start = performance.now();
          window.fetch = async (input, init) => {
            const url = String(input),
              t = performance.now(),
              response = await originalFetch(input, init);
            if (url.startsWith('http://127.0.0.1:8791/')) network.push({ path: new URL(url).pathname, status: response.status, bytes: init?.body instanceof Blob ? init.body.size : typeof init?.body === 'string' ? init.body.length : 0, ms: performance.now() - t });
            return response;
          };
          await releaseUrbanLanes();
          for (let offset = 0; offset < 32; offset += 8) {
            let next = offset;
            await Promise.all(
              Array.from({ length: 4 }, (_, lane) =>
                (async () => {
                  for (;;) {
                    const i = next++;
                    if (i >= offset + 8) return;
                    results[i] = await generateRustTown(world, settings, `farm-${i}`, undefined, 'buildings', lane, []);
                  }
                })(),
              ),
            );
            if (!retain) await releaseUrbanLanes();
          }
          await releaseUrbanLanes();
          runs.push({
            retainSessions: retain,
            ms: performance.now() - start,
            buildings: results.reduce((n, r) => n + r.urban.buildings.length, 0),
            geometrySha256: await digest(results.map(r => r.urban)),
            rasterRequests: network.filter(r => r.path === '/raster').length,
            rasterBytes: network.filter(r => r.path === '/raster').reduce((n, r) => n + r.bytes, 0),
            releases: network.filter(r => r.path === '/release').length,
            requests: network.length,
          });
        }
      } finally {
        window.fetch = originalFetch;
        await releaseUrbanLanes();
      }
      return { service, workload: { farms: 32, inhabitants: 320, lanes: 4, batches: 4, warmupFarmsExcluded: 4, order: 'ABBA' }, runs };
    },
    { web },
  );
  for (const run of result.runs) {
    assert.equal(run.geometrySha256, result.runs[0].geometrySha256);
    assert.equal(run.buildings, result.runs[0].buildings);
    assert.equal(run.releases, run.retainSessions ? 4 : 16);
  }
  result.aggregate = Object.fromEntries(
    [false, true].map(retain => {
      const group = result.runs.filter(run => run.retainSessions === retain),
        first = group[0];
      for (const run of group) for (const key of ['rasterRequests', 'rasterBytes', 'releases', 'requests']) assert.equal(run[key], first[key], key);
      return [retain ? 'retained' : 'cold', { meanMs: group.reduce((sum, run) => sum + run.ms, 0) / group.length, rasterRequests: first.rasterRequests, rasterBytes: first.rasterBytes, releases: first.releases, requests: first.requests }];
    }),
  );
  result.speedup = +(result.aggregate.cold.meanMs / result.aggregate.retained.meanMs).toFixed(2);
  await mkdir(`${web}/out/small-places`, { recursive: true });
  await writeFile(`${web}/out/small-places/native-session-benchmark.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
