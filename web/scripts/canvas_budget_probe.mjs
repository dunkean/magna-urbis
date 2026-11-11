import { chromium } from '../node_modules/playwright/index.mjs';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { routeDecors } from '../out/planches-styles-v7/v2drive.mjs';

const label = process.argv[2] ?? 'after', village = process.argv.includes('--village');
const out = resolve('out/canvas-budget-20261111'); mkdirSync(out, { recursive: true });
const tag = `mu-canvas-budget-${label}-${Date.now()}`, udd = resolve(out, tag);
process.env.VK_LOADER_DEVICE_ID_FILTER = '0x2b85';
execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${process.pid}).ProcessorAffinity = 0xFFFE00`]);
const samples = [], phases = {}, start = Date.now();
let browser, monitor, stop = false, aborted = false, browserPid, peakGb = 0, phase = 'launch';
const mark = value => { phase = value; phases[value] = Date.now() - start; console.log(value, phases[value]); };
try {
  browser = await chromium.launchPersistentContext(udd, { channel: 'chrome', headless: true,
    viewport: { width: 1600, height: 1000 }, locale: 'en-US', args: ['--use-angle=vulkan', '--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'] });
  browserPid = Number(execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match '${tag}' -and $_.CommandLine -notmatch '--type=' } | ForEach-Object { $_.ProcessId }`], { encoding: 'utf8' }).trim());
  // Separate process: sampling continues while the renderer's main thread is busy.
  monitor = execFile('powershell.exe', ['-NoProfile', '-Command', `while ($true) { $sampleClock = [Diagnostics.Stopwatch]::StartNew(); Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match '${tag}' -and $_.CommandLine -match '--type=gpu-process' } | ForEach-Object { Write-Output "$($_.ProcessId) $($_.PrivatePageCount)" }; Start-Sleep -Milliseconds ([Math]::Max(1, 2000 - $sampleClock.ElapsedMilliseconds)) }`]);
  monitor.stdout.on('data', data => {
    for (const line of String(data).trim().split(/\r?\n/)) {
      const [pid, bytes] = line.trim().split(/\s+/).map(Number); if (!bytes) continue;
      const gb = bytes / 2 ** 30; peakGb = Math.max(peakGb, gb);
      samples.push({ ms: Date.now() - start, phase, pid, gb }); console.log('GPU', gb.toFixed(2), phase);
      if (gb > 20 && !aborted) { aborted = true; console.log('CAP EXCEEDED: closing owned browser', browserPid);
        void browser.close().catch(() => {});
        setTimeout(() => { if (!stop) { try { execFileSync('taskkill', ['/PID', String(browserPid), '/T', '/F']); } catch {} } }, 3000);
      }
    }
  });
  const page = browser.pages()[0];
  await routeDecors(page);
  await page.route('**/src/render/canvas.ts*', async route => {
    const response = await route.fetch(); let body = await response.text();
    body = body.replace(/return stats;/g, '{ globalThis.__canvasFrames?.push({t:performance.now(),view:{...view},live:activeLive,...stats}); return stats; }');
    await route.fulfill({ response, body });
  });
  await page.addInitScript(() => { window.__canvasFrames = []; window.__longTasks = [];
    new PerformanceObserver(list => { for (const e of list.getEntries()) window.__longTasks.push({ t: e.startTime, ms: e.duration }); }).observe({ entryTypes: ['longtask'] }); });
  page.on('pageerror', e => console.log('PAGE ERROR', String(e).slice(0, 300)));
  const watchdog = setTimeout(() => { console.log('Probe deadline'); void browser.close(); }, 600000);
  try {
    await page.goto('http://127.0.0.1:5199/v2.html?test=1&quality=full&lang=en&source=procedural&profile=local&localServer=http://127.0.0.1:8791', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__v2Test?.ready, null, { timeout: 120000 }); mark('ready');
    const request = village ? { decor: 'city-01-river-plain-s', culture: 'european-organic', population: 500, seed: 'canvas-budget-village', autoPosition: true, site: 'plain' }
      : { decor: 'city-v8r-formes--circle--persian-l-hr', culture: 'persian', population: 20000, seed: 'v8r-formes--circle--persian', autoPosition: true, site: 'bridge', options: ['streetFrontage', 'alignEnclosedGrid', 'hideUnusedQuarters', 'naturalCampApproaches'], params: { organicBranchVariation: '0.5', ribbonWidthVariation: '0.5' }, footprint: 'circle' };
    await page.evaluate(req => window.__v2Test.prepare(req), request); mark('prepared');
    mark('run-start'); await page.evaluate(() => window.__v2Test.run()); mark('chain-return');
    await page.waitForFunction(() => window.__canvasFrames.some(f => f.live && f.rasterPending === 0), null, { timeout: 180000 }); mark('first-full-2d');
    await page.evaluate(() => { const select = document.querySelector('#map-style'); select.value = 'parchment'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.evaluate(async () => { window.__viewAt = performance.now(); window.__targetView = await window.__v2Test.view('2d'); }); mark('view');
    await page.waitForFunction(() => window.__canvasFrames.some(f => f.live && f.rasterPending === 0 && f.t >= window.__viewAt && f.view.scale === window.__targetView.scale), null, { timeout: 180000 }); mark('full-live-frame');
    await page.waitForTimeout(3000);
    mark('capture-start'); await page.evaluate(() => window.__v2Test.prepareCapture()); mark('capture-end');
    await page.locator('.map-area').screenshot({ path: resolve(out, `${label}.png`), timeout: 120000 });
    const measurements = await page.evaluate(() => ({ summary: window.__v2Test.summary(), frames: window.__canvasFrames, longTasks: window.__longTasks }));
    writeFileSync(resolve(out, `${label}-frames.json`), JSON.stringify(measurements, null, 1));
    await page.waitForTimeout(8000); mark('done');
  } finally { clearTimeout(watchdog); }
} catch (error) { console.log('PROBE ERROR', String(error)); }
finally {
  stop = true; if (monitor) monitor.kill();
  if (browser) await browser.close().catch(() => {});
  writeFileSync(resolve(out, `${label}-samples.json`), JSON.stringify({ peakGb, aborted, phases, samples }, null, 1));
  console.log('RESULT', JSON.stringify({ label, peakGb, aborted, phases }));
}
