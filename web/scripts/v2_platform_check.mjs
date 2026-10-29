/** Real browser smoke checks for V2 Rust CPU/WebGPU/native bridges. Vite V2 must be running. */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('..', import.meta.url));
const base = process.env.MAGNA_V2_URL ?? 'http://127.0.0.1:5174';
const nativeBinary = process.env.MAGNA_LOCAL_BIN ?? fileURLToPath(new URL('../../rust/desktop-v2/resources/magna-urbis-local.exe', import.meta.url));
let child, browser;
const result = { time: new Date().toISOString(), checks: {} };
try {
  browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true, args: ['--enable-unsafe-webgpu'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(90000); page.setDefaultNavigationTimeout(120000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${base}/v2.html?empty`, { waitUntil: 'domcontentloaded' });
  await page.locator('#terrain-only').waitFor({ state: 'visible' });
  await mkdir(`${web}/out`, { recursive: true });
  await page.screenshot({ path: `${web}/out/v2-platform-ui.png`, fullPage: true });
  result.checks.ui = { title: await page.title(), errors };
  const moduleUrl = `/@fs/${web.replaceAll('\\', '/')}/src/v2/platform.ts`;
  const run = (request) => page.evaluate(async ({ moduleUrl, request }) => {
    const { generateEngineHeight } = await import(moduleUrl);
    const events = [];
    const output = await generateEngineHeight(request, event => events.push(event));
    return { backend: output.backend, generationBackend: output.generationBackend, stats: output.stats,
      count: output.importedHeight.elevations.length, finite: output.importedHeight.elevations.every(Number.isFinite),
      min: Math.min(...output.importedHeight.elevations), max: Math.max(...output.importedHeight.elevations), events };
  }, { moduleUrl, request });
  result.checks.cpu = await run({ seed: 'v2-platform-check', width: 2400, relief: 'hills', coast: 'S', compute: 'cpu', source: 'procedural', erosion: 1, resolution: 64 });
  if (result.checks.cpu.backend !== 'rust-wasm-cpu' || !result.checks.cpu.finite || result.checks.cpu.count !== 4096) throw new Error('Invalid Rust/WASM CPU output');
  result.checks.gpuCapability = await page.evaluate(async moduleUrl => {
    const { detectPlatform } = await import(moduleUrl); return detectPlatform({ profile: 'web' });
  }, moduleUrl);
  if (result.checks.gpuCapability.webgpu) {
    result.checks.gpu = await run({ seed: 'v2-platform-check', width: 2400, relief: 'hills', coast: 'S', compute: 'gpu', source: 'procedural', erosion: 1, resolution: 64 });
    if (result.checks.gpu.backend !== 'rust-webgpu' || !result.checks.gpu.finite || !result.checks.gpu.generationBackend.startsWith('gpu-')) throw new Error('Invalid WebGPU generation output');
  } else result.checks.gpu = { skipped: 'No usable WebGPU device in this browser' };
  if (existsSync(nativeBinary)) {
    child = spawn(nativeBinary, ['--port', '0'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MAGNA_LOCAL_ADDR: '127.0.0.1:0' } });
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Native service startup timed out')), 15000);
      let text = '';
      child.stdout.on('data', chunk => {
        text += chunk;
        for (const line of text.split('\n')) {
          try { const data = JSON.parse(line); if (data.ready && data.port) { clearTimeout(timer); resolve(data.port); } } catch {}
        }
      });
      child.once('error', reject);
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Native service exited: ${code}`)); });
    });
    result.checks.native = await run({ seed: 'v2-platform-check', width: 2400, relief: 'hills', coast: 'S', compute: 'cpu', source: 'procedural', native: true, localServer: `http://127.0.0.1:${port}`, erosion: 1, resolution: 64 });
    if (result.checks.native.backend !== 'rust-native' || !result.checks.native.finite || result.checks.native.count !== 4096) throw new Error('Invalid native Rust output');
  } else result.checks.native = { skipped: 'Native binary not prepared' };
  if (['local', 'all'].includes(process.env.MAGNA_TEST_NEURAL)) {
    result.checks.neuralPython = await run({ seed: 'v2-platform-check-neural', width: 40000, relief: 'hills', coast: 'S',
      compute: 'gpu', source: 'neural-python', pythonServer: 'http://127.0.0.1:8793', neuralAssets: `${base}/neural/`, resolution: 64 });
    if (result.checks.neuralPython.backend !== 'python-cuda' || !result.checks.neuralPython.finite) throw new Error('Invalid Python/CUDA output');
  }
  if (['web', 'all'].includes(process.env.MAGNA_TEST_NEURAL)) {
    result.checks.neuralWeb = await run({ seed: 'v2-platform-check-neural-web', width: 40000, relief: 'hills', coast: 'S',
      compute: 'gpu', source: 'neural-wasm', neuralAssets: `${base}/neural/`, resolution: 64 });
    if (!result.checks.neuralWeb.finite || result.checks.neuralWeb.generationBackend !== 'neural') throw new Error('Invalid browser neural WebGPU output');
  }
  result.ok = true;
} catch (error) { result.ok = false; result.error = error.stack; process.exitCode = 1; }
finally {
  await browser?.close();
  if (child && child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); }
  await mkdir(`${web}/out`, { recursive: true });
  await writeFile(`${web}/out/v2-platform-check.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
