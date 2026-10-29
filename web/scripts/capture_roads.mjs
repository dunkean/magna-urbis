// Capture the settlements/roads inputs of the terrain -> settlements chain for one profile.
// From web/: node scripts/capture_roads.mjs web|local [--server http://127.0.0.1:8798]
// Writes out/roads-<profile>-raster.bin (native /raster upload format) and out/roads-<profile>-request.json.
// Replay natively: cargo run --release -p magna-urbis-core --example roads_replay -- ../web/out/roads-<profile>-raster.bin ../web/out/roads-<profile>-request.json
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { createServer as netServer } from 'node:net';
const freePort = () => new Promise(ok => { const s = netServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });
const web = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const profile = process.argv[2] ?? 'web';
const opt = (n, f) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : f; };
const server = opt('server', 'http://127.0.0.1:8798');
const port = await freePort();
const vite = await createServer({ configFile: resolve(web, 'vite.config.ts'), mode: 'rustbench', logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true, watch: null, hmr: false }, clearScreen: false });
await vite.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-webgpu', '--no-proxy-server'] });
const toBin = r => {
  const header = Buffer.from(JSON.stringify({ session: 'replay', width: r.width, n: r.n }));
  const padded = Buffer.alloc(Math.ceil(header.length / 4) * 4, 32); header.copy(padded);
  const len = Buffer.alloc(4); len.writeUInt32LE(padded.length);
  const b = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
  return Buffer.concat([len, padded, b(r.height), b(r.waterLevel), b(r.riverWidth), b(r.riverIds), b(r.water)]);
};
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...rest) {
      try { if (message && typeof message === 'object' && 'roads' in message && message.roads) (window.top.__roadsCaptured ??= []).push(structuredClone(message)); } catch { /* ignore */ }
      return post.call(this, message, ...rest);
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(300000);
  const native = [];
  if (profile === 'local') await page.route(`${server}/**`, async route => {
    const req = route.request();
    if (/\/(raster|settlements)$/.test(req.url())) native.push({ url: req.url(), body: req.postDataBuffer() });
    await route.continue();
  });
  const q = new URLSearchParams({ profile, generation: profile === 'local' ? 'native' : 'cpu', render: 'gpu', source: 'procedural' });
  if (profile === 'local') q.set('localServer', server); else q.set('threads', 'off');
  const t = new URLSearchParams({ seed: 'bench-matrix', width: '3000', auto: '1', ...(profile === 'local' ? {} : { compute: 'wasm' }) });
  await page.goto(`http://127.0.0.1:${port}/rustbench.html?${q}#terrain?${t}`, { waitUntil: 'commit' });
  await page.waitForFunction(() => { const w = document.querySelector('iframe[data-bench=terrain]')?.contentWindow; return w?.magnaBenchTimings?.stages?.terrain !== undefined && !!w.magnaBenchContext?.ready?.(); });
  await page.waitForFunction(() => !document.querySelector('iframe[data-bench=terrain]')?.contentDocument?.querySelector('#pipelineNext')?.disabled);
  const frame = page.frames().find(f => f.url().includes('terrainbench.html') && !f.url().includes('stage=settlements'));
  await frame.locator('#pipelineNext').click();
  await page.waitForFunction(() => { const w = document.querySelector('iframe[data-bench=settlements]')?.contentWindow; return w?.magnaBenchTimings?.stages?.roads !== undefined || (w?.magnaBenchTimings?.errors?.length ?? 0) > 0; });
  const stages = await page.evaluate(() => document.querySelector('iframe[data-bench=settlements]').contentWindow.magnaBenchTimings.stages);
  console.log('stages', JSON.stringify(stages));
  if (profile === 'local') {
    const raster = native.filter(n => n.url.endsWith('/raster')).at(-1), request = native.filter(n => n.url.endsWith('/settlements') && n.body.includes('"roads"')).at(-1);
    console.log('captured', native.map(n => `${n.url} ${n.body.length}`));
    if (raster) writeFileSync(resolve(web, `out/roads-${profile}-raster.bin`), raster.body);
    if (request) writeFileSync(resolve(web, `out/roads-${profile}-request.json`), request.body);
  } else {
    const captured = await page.evaluate(() => (window.__roadsCaptured ?? []).map(m => ({ ...m, raster: m.raster ? { width: m.raster.width, n: m.raster.n, height: [...m.raster.height], water: [...m.raster.water], waterLevel: [...m.raster.waterLevel], riverWidth: [...m.raster.riverWidth], riverIds: [...m.raster.riverIds] } : undefined })));
    console.log('captured', captured.length, captured.map(c => Object.keys(c).join(',')));
    const withRaster = captured.filter(c => c.raster).at(-1), last = captured.filter(c => !c.kind && ('place' in c || 'sites' in c)).at(-1);
    if (withRaster) { const r = withRaster.raster; writeFileSync(resolve(web, `out/roads-${profile}-raster.bin`), toBin({ width: r.width, n: r.n, height: Float32Array.from(r.height), water: Uint8Array.from(r.water), waterLevel: Float32Array.from(r.waterLevel), riverWidth: Float32Array.from(r.riverWidth), riverIds: Int32Array.from(r.riverIds) })); }
    if (last) { const { raster: _r, runtime: _rt, ...rest } = last; writeFileSync(resolve(web, `out/roads-${profile}-request.json`), JSON.stringify(rest)); }
  }
  await context.close();
} finally { await browser.close(); await vite.close(); }
