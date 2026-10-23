import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { decodeSurfaceBinary } from '../src/surface/binary.ts';

const args = process.argv.slice(2), option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const base = option('--url', 'http://127.0.0.1:5197').replace(/\/$/, '');
const source = option('--decor', 'D:/workspace/self/magna-urbis/web/decors/city-04-mountain-bay-s.decor');
const out = resolve(option('--out', 'out/surface/ui'));
await mkdir(out, { recursive: true });
const bytes = await readFile(source), errors = [];
const cachedBrowser = process.env.LOCALAPPDATA && resolve(process.env.LOCALAPPDATA, 'ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-win64/chrome-headless-shell.exe');
const browser = await chromium.launch({ ...(cachedBrowser && existsSync(cachedBrowser) ? { executablePath: cachedBrowser } : { channel: option('--channel', 'msedge') }), headless: true, args: ['--use-angle=swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  page.on('pageerror', error => { errors.push(String(error)); console.error(String(error)); });
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  page.on('requestfailed', request => console.error(`${request.url()}: ${request.failure()?.errorText}`));
  console.log('Loading isolated Terrain Bench…');
  await page.goto(`${base}/terrainbench.html?standalone=1&profile=web&stage=settlements&source=procedural&auto=0&render=svg`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => typeof window.magnaBenchContext?.ready === 'function', undefined, { timeout: 120000 });
  const metadata = await page.evaluate(async encoded => {
    const [{ readDecorFile }, { saveHistory }] = await Promise.all([import('/decorFile.ts'), import('/benchHistory.ts')]);
    const data = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    const decor = await readDecorFile(new Blob([data]));
    await saveHistory(decor, false, data);
    return { id: decor.meta.id, query: decor.meta.query, seed: decor.meta.seed, n: decor.raster.n, width: decor.raster.width };
  }, bytes.toString('base64'));
  console.log(`Importing retained source ${metadata.id}…`);
  const query = new URLSearchParams(metadata.query); query.set('artifact', metadata.id); query.set('stage', 'terrain'); query.set('auto', '0');
  query.set('neural', 'http://127.0.0.1:8893');
  query.set('render', 'svg');
  query.set('standalone', '1'); query.set('profile', 'web');
  await page.goto(`${base}/terrainbench.html?${query}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.magnaBenchContext?.ready(), undefined, { timeout: 120000 });
  await page.screenshot({ path: resolve(out, 'retained-source.png') });
  await page.locator('#pipelineTransfer details > summary').click();
  const [file] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.locator('#pipelineSurface').click()]);
  const binaryPath = resolve(out, 'retained-source.surfacebin');
  await file.saveAs(binaryPath);
  const packet = decodeSurfaceBinary(await readFile(binaryPath));
  if (packet.world.terrain.width !== metadata.n || packet.world.terrain.height !== metadata.n) throw new Error('Source sample grid changed during UI export');
  if (packet.source.meta.id !== metadata.id || packet.source.meta.seed !== metadata.seed) throw new Error('Source identity changed during UI export');
  const sessions = await fetch(`${base}/surface-live/sessions`).then(r => r.json());
  if (!sessions.sessions.length) throw new Error('Terrain Bench did not register a live generation session');
  let live = null;
  if (args.includes('--live')) {
    console.log('Requesting actual retained-source refinement through the compiler worker…');
    const centre = metadata.width / 2, extent = 40;
    const started = performance.now();
    const response = await fetch(`${base}/surface-live/terrain`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessions.sessions.at(-1), region: { x: centre - extent / 2, y: centre - extent / 2, extent, resolution: 64 } }), signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Actual live source failed: ${response.status} ${await response.text()}`);
    const liveBytes = new Uint8Array(await response.arrayBuffer()), livePacket = decodeSurfaceBinary(liveBytes);
    const livePath = resolve(out, 'live-refinement.surfacebin'); await writeFile(livePath, liveBytes);
    if (!livePacket.world.terrain.source.sourceLODKnown || !livePacket.world.canonicalContext) throw new Error('Live source lost its real source level or initial context');
    live = { path: livePath, bytes: liveBytes.length, durationMs: performance.now() - started,
      source: livePacket.world.terrain.source, grid: { n: livePacket.world.terrain.width, spacingM: livePacket.world.terrain.spacingM },
      contextId: livePacket.world.canonicalContextRef.id };
  }
  const result = { source, metadata, binaryPath, bytes: (await readFile(binaryPath)).length,
    samples: packet.world.terrain.heights.length, sourceIdentity: packet.world.terrain.source,
    buildings: packet.urban.buildings.length, liveSessions: sessions.sessions.length, live, errors };
  await writeFile(resolve(out, 'report.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (errors.length) throw new Error('Browser reported runtime errors');
} finally { await browser.close(); }
