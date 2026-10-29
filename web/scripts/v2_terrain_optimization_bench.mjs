/** Fixed-quality browser/WASM benchmark. Run before/after; no native executable or GPU is started. */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
const web = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '');
const phase = process.env.MAGNA_BENCH_PHASE ?? 'after', base = process.env.MAGNA_V2_URL ?? 'http://127.0.0.1:5175';
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu', '--use-angle=swiftshader', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  const page = await browser.newPage(); await page.goto(`${base}/v2.html?empty`, { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async ({ web, phase }) => {
    const engine = await import(`/@fs/${web}/src/v2/engine.ts`), { TerrainCache } = await import(`/@fs/${web}/src/v2/cache.ts`);
    const hydro = await import(`/@fs/${web}/../rust/bridge/hydrologySurface.ts`);
    const settings = engine.defaultSettings(); settings.extent = 6000; settings.runtime = { backend: 'rust', compute: 'cpu', source: 'procedural' };
    settings.options.seed = 'v2-optimization-fixed'; settings.options.population = 80; settings.options.river = 'stream';
    settings.terrain = { resolution: 512, motifSize: 4500, relief: 'hills', erosion: .15, hydrology: { resolution: 512, compute: 'cpu', condMode: 'none' } };
    const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const hash = values => { let a = 2166136261; for (const byte of new Uint8Array(values.buffer, values.byteOffset, values.byteLength)) a = Math.imul(a ^ byte, 16777619); return (a >>> 0).toString(16); };
    const arrays = root => { const buffers = new Set(), seen = new Set(); const walk = item => { if (!item || typeof item !== 'object' || seen.has(item)) return; seen.add(item); if (ArrayBuffer.isView(item)) { buffers.add(item.buffer); return; } Object.values(item).forEach(walk); }; walk(root); return buffers; };
    const cache = new TerrainCache({ async get() {}, async put() {}, async clear() {} });
    const t0 = performance.now(), world = await engine.generateTerrain(settings, undefined, cache), coldMs = performance.now() - t0;
    const warm = []; for (let i = 0; i < 3; i++) { const t = performance.now(); await engine.generateTerrain(settings, undefined, cache); warm.push(performance.now() - t); }
    const sourceBuffers = arrays(world), sourceBytes = [...sourceBuffers].reduce((sum, b) => sum + b.byteLength, 0), cloneTimes = [], cloneNewBytes = [];
    let clone = structuredClone;
    if (phase !== 'before') { try { clone = (await import(`/@fs/${web}/src/v2/worldState.ts`)).cloneV2WorldForGeneration; } catch {} }
    for (let i = 0; i < 5; i++) { globalThis.gc?.(); const t = performance.now(), copy = clone(world); cloneTimes.push(performance.now() - t); cloneNewBytes.push([...arrays(copy)].filter(b => !sourceBuffers.has(b)).reduce((sum, b) => sum + b.byteLength, 0)); if (hash(copy.terrain.height.data) !== hash(world.terrain.height.data)) throw new Error('Clone changed physical heights.'); }
    const large = structuredClone(settings); large.terrain.sketch = { version: 1, resolution: 1024, processing: 'surface', heights: Array.from({ length: 1024 ** 2 }, (_, i) => Math.sin(i * .017) * 150 + 200) };
    const keyTimes = []; let key;
    for (let i = 0; i < 3; i++) { globalThis.gc?.(); const t = performance.now(); key = engine.terrainCacheKey(large); keyTimes.push(performance.now() - t); }
    const native = world.terrain.v2NativeTerrain, field = native.field, carving = [], carveHashes = [];
    for (let i = 0; i < 3; i++) {
      globalThis.gc?.(); const data = { x: 0, y: 0, width: 6000, resolution: field.n, height: field.data.slice(), minHeight: native.minHeight, maxHeight: native.maxHeight };
      const t = performance.now();
      if (phase !== 'before' && hydro.applyHydrologyHeight) hydro.applyHydrologyHeight(data, native.hydrology);
      else hydro.applyHydrologySurface({ ...data, normalX: new Float32Array(field.n ** 2), normalY: new Float32Array(field.n ** 2), normalZ: new Float32Array(field.n ** 2).fill(1) }, native.hydrology);
      carving.push(performance.now() - t); carveHashes.push(hash(data.height));
    }
    return { phase, time: new Date().toISOString(), hardware: navigator.userAgent, quality: { width: 6000, overview: 512, hydrology: 512, physicalField: field.n, seed: settings.options.seed },
      coldMs, warmMs: warm, warmMedianMs: median(warm), cloneMs: cloneTimes, cloneMedianMs: median(cloneTimes), sourceTypedArrayBytes: sourceBytes, clonedNewTypedArrayBytes: cloneNewBytes,
      largeKeyMs: keyTimes, largeKeyMedianMs: median(keyTimes), largeKeyCharacters: key.length, carvingMs: carving, carvingMedianMs: median(carving), carvingHash: carveHashes,
      physicalHash: { height: hash(world.terrain.height.data), water: hash(world.terrain.water), flow: hash(world.terrain.flow.data), receiver: hash(world.terrain.receiver), field: hash(field.data) },
      jsHeapBytes: performance.memory?.usedJSHeapSize };
  }, { web, phase });
  await mkdir(`${web}/out`, { recursive: true }); await writeFile(`${web}/out/v2-terrain-optimization-${phase}.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally { await browser?.close(); }
