/** Exact rendered-pixel comparison: the optional short map shader versus the
 * existing full shader with procedural ground disabled. Never changes LOD. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
const base = process.env.MAGNA_V2_URL ?? 'http://127.0.0.1:5175';
const source = '/@fs/' + fileURLToPath(new URL('../src/ui/terrain3d.ts', import.meta.url)).replace(/\\/g, '/');
const out = new URL('../out/v2-optimization/', import.meta.url);
await mkdir(out, { recursive: true });
const server = await chromium.launchServer({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true, args: ['--use-angle=d3d11'] });
const browser = await chromium.connect(server.wsEndpoint());
const result = {};
let timedOut = false;
const watchdog = setTimeout(() => {
  timedOut = true; result.ok = false; result.error = 'The optional full shader exceeded the 60-second comparison budget.';
  const pid = server.process()?.pid;
  if (pid) execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
}, 60000);
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(`${base}/v2.html?empty&lang=en`, { waitUntil: 'domcontentloaded' });
  Object.assign(result, await page.evaluate(async source => {
    const { Terrain3d } = await import(source), views = [], canvases = [], captures = [];
    const n = 32, width = 1800, data = Float32Array.from({ length: n * n }, (_, i) => 30 + 25 * Math.sin((i % n) / 7) * Math.cos(Math.floor(i / n) / 9));
    const image = document.createElement('canvas'); image.width = image.height = n;
    const ctx = image.getContext('2d'), pixels = ctx.createImageData(n, n);
    for (let i = 0; i < n * n; i++) pixels.data.set([90 + i % n * 3, 100 + Math.floor(i / n) * 2, 130, 255], i * 4);
    ctx.putImageData(pixels, 0, 0);
    const timings = [];
    for (const fast of [true, false]) {
      const canvas = document.createElement('canvas'); document.body.append(canvas); canvas.style.cssText = 'position:fixed;inset:0;width:320px;height:240px;z-index:10000'; canvases.push(canvas);
      const start = performance.now(), view = new Terrain3d(canvas, () => {}, () => {}, { fastMapShader: fast });
      view.setSurface({ x: 0, y: 0, width, n, data }); view.setTexture(image); view.resize(320, 240);
      view.setCamera({ x: width / 2, y: width / 2, distance: 1900, yaw: .2, pitch: .8, exaggeration: 1 }); view.setActive(true); views.push(view);
      await new Promise(resolve => setTimeout(resolve, 700));
      const blob = await view.capture(), bitmap = await createImageBitmap(blob), destination = new OffscreenCanvas(bitmap.width, bitmap.height), context = destination.getContext('2d'); context.drawImage(bitmap, 0, 0); bitmap.close();
      const rgba = context.getImageData(0, 0, destination.width, destination.height).data; captures.push(rgba);
      timings.push({ profile: view.getShaderProfile(), elapsedMs: Math.round(performance.now() - start), lod: view.getLodInfo() });
      view.setActive(false);
    }
    let changed = 0, maxChannelDelta = 0;
    for (let i = 0; i < captures[0].length; i++) { const delta = Math.abs(captures[0][i] - captures[1][i]); if (delta) changed++; maxChannelDelta = Math.max(maxChannelDelta, delta); }
    const gl = canvases[0].getContext('webgl2'), extension = gl.getExtension('WEBGL_debug_renderer_info'), renderer = extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    for (const view of views) view.dispose(); for (const canvas of canvases) canvas.remove();
    return { timings, channelsCompared: captures[0].length, changedChannels: changed, maxChannelDelta, renderer };
  }, source));
  assert.equal(result.changedChannels, 0); result.ok = true;
} catch (error) { result.ok = false; result.error ??= String(error); process.exitCode = 1; }
finally { clearTimeout(watchdog); if (!timedOut) { await browser.close(); await server.close(); } await writeFile(new URL('shader-equivalence.json', out), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2)); }
