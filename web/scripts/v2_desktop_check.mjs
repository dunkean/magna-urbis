/** Windows desktop smoke test. Runs only the supplied executable with isolated user data. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

if (process.platform !== 'win32') throw new Error('This check requires Windows and WebView2.');
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--(binary|timeout)=(.+)$/.exec(arg);
  if (!match) throw new Error(`Expected --binary=<absolute path> or --timeout=<milliseconds>: ${arg}`);
  return [match[1], match[2]];
}));
const binary = args.binary ?? join(root, 'rust/desktop-v2/target/release/magna-urbis-v2-desktop.exe');
if (!isAbsolute(binary) || !existsSync(binary)) throw new Error(`Desktop binary must be an existing absolute path: ${binary}`);
const timeout = Number(args.timeout ?? 30000);
if (!Number.isSafeInteger(timeout) || timeout < 1000) throw new Error('Timeout must be an integer of at least 1000 ms');
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolveListen));
  const port = server.address().port;
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  return port;
}
async function waitFor(description, check, limit = timeout) {
  const deadline = Date.now() + limit;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null || child?.signalCode !== null) throw new Error(`Desktop exited while waiting for ${description}: ${child?.exitCode ?? child?.signalCode}`);
    try { const value = await check(); if (value) return value; } catch { /* Retry until deadline. */ }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${description}`);
}
const tempRoot = join(root, '.tmp'); await mkdir(tempRoot, { recursive: true });
const isolated = await mkdtemp(join(tempRoot, 'desktop-smoke-'));
const data = join(isolated, 'data'), cache = join(isolated, 'cache');
const port = await freePort();
const env = { ...process.env, MAGNA_RUNTIME_DATA: data, MAGNA_RUNTIME_CACHE: cache,
  WEBVIEW2_USER_DATA_FOLDER: join(isolated, 'webview'),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` };
for (const key of ['MAGNA_LOCAL_BIN', 'MAGNA_NEURAL_PYTHON', 'MAGNA_ILLUSTRATION_PYTHON', 'MAGNA_NEURAL_EARTH']) delete env[key];
let child, browser, page, nativeUrl, failure;
const checks = {};
try {
  child = spawn(binary, [], { cwd: dirname(binary), env, windowsHide: true, stdio: 'ignore' });
  const spawnError = new Promise((_, reject) => child.once('error', reject));
  await Promise.race([spawnError, waitFor('WebView2 debugging endpoint', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  })]);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout });
  page = await waitFor('desktop page', async () => {
    for (const context of browser.contexts()) for (const candidate of context.pages()) {
      if (await candidate.locator('#terrain-only').count()) return candidate;
    }
    return null;
  });
  page.setDefaultTimeout(timeout);
  await page.locator('#terrain-only').waitFor({ state: 'attached', timeout });
  await page.locator('#boot-splash').waitFor({ state: 'detached', timeout });
  await page.locator('#hardware-open').waitFor({ state: 'visible', timeout });
  // Fetch the original embedded document even after boot removed the splash.
  const splashBytes = await page.evaluate(async () => {
    const documentResponse = await fetch(location.href);
    if (!documentResponse.ok) throw Error(`Desktop HTML HTTP ${documentResponse.status}`);
    const html = new DOMParser().parseFromString(await documentResponse.text(), 'text/html');
    const src = html.querySelector('#boot-splash img')?.getAttribute('src');
    if (!src) throw Error('Desktop splash image is missing from the embedded document');
    const image = await fetch(new URL(src, location.href));
    if (!image.ok) throw Error(`Desktop splash image HTTP ${image.status}`);
    return Array.from(new Uint8Array(await image.arrayBuffer()));
  });
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const expectedLogo = await readFile(join(root, 'rust/desktop-v2/assets/app-icon.png'));
  assert.equal(hash(Buffer.from(splashBytes)), hash(expectedLogo), 'Desktop splash must use the requested detailed logo');
  await page.waitForFunction(() => /Magna Urbis/.test(document.title), null, { timeout });
  assert.match(await page.title(), /Magna Urbis/);
  const url = new URL(page.url());
  assert.equal(url.searchParams.get('profile'), 'local');
  nativeUrl = url.searchParams.get('localServer');
  const native = new URL(nativeUrl);
  assert.equal(native.protocol, 'http:'); assert.equal(native.hostname, '127.0.0.1');
  const nativeStatus = await (await fetch(new URL('/status', native), { signal: AbortSignal.timeout(3000) })).json();
  assert.equal(nativeStatus.service, 'magna-urbis-local'); assert.equal(nativeStatus.backend, 'rust-native');
  const terrainResponse = await fetch(new URL('/terrain', native), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeout),
    body: JSON.stringify({ session: 'desktop-smoke', settings: { seed: 'desktop-smoke', width: 2400, relief: 'hills', erosion: 0, motifSize: 800, mountainMix: 0.5, source: 'procedural' },
      region: { x: 0, y: 0, extent: 2400, resolution: 64 } }),
  });
  assert.equal(terrainResponse.ok, true, `Native terrain request failed: ${terrainResponse.status}`);
  const packet = Buffer.from(await terrainResponse.arrayBuffer());
  assert.ok(packet.length > 4, 'Missing terrain packet');
  const headerBytes = packet.readUInt32LE(0);
  assert.ok(headerBytes > 0 && 4 + headerBytes <= packet.length, 'Invalid terrain packet header');
  const header = JSON.parse(packet.subarray(4, 4 + headerBytes).toString('utf8'));
  assert.equal(header.resolution, 64);
  assert.equal(header.arrays[0]?.name, 'height'); assert.equal(header.arrays[0]?.type, 'f32'); assert.equal(header.arrays[0]?.count, 64 * 64);
  assert.ok(packet.length >= 4 + headerBytes + 64 * 64 * 4, 'Truncated terrain heights');
  for (let i = 0; i < 64 * 64; i++) assert.ok(Number.isFinite(packet.readFloatLE(4 + headerBytes + i * 4)), 'Non-finite terrain height');
  assert.equal(await page.locator('#terrain-backend').inputValue(), 'native');
  assert.equal(await page.locator('#terrain-source').inputValue(), 'procedural');
  const status = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('desktop_status'));
  assert.equal(status.uv, true); assert.equal(status.busy, false);
  assert.equal(resolve(status.dataDir).toLowerCase(), resolve(data).toLowerCase());
  assert.equal(resolve(status.cacheDir).toLowerCase(), resolve(cache).toLowerCase());
  for (const name of ['terrain', 'illustration']) assert.equal(status.components.find(item => item.component === name)?.installed, false, `${name} must start absent`);
  await page.locator('#hardware-open').click();
  const panel = page.locator('.desktop-modules');
  await panel.evaluate(element => { for (let parent = element.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true; });
  await panel.locator('summary').click();
  await panel.locator('button[data-i18n="Download original model (several GB)"]').waitFor({ state: 'visible' });
  assert.equal(await panel.locator('.desktop-module').count(), 3);
  const modelInputs = panel.locator('.desktop-module').last().locator('input');
  assert.equal(await modelInputs.nth(0).inputValue(), 'dunkean/neural-earth-distilled');
  assert.equal(await modelInputs.nth(1).inputValue(), 'b1782a3f80f5001de5ac701c1ff37128f128b9d7');
  const rejection = await page.evaluate(async () => {
    try { await window.__TAURI_INTERNALS__.invoke('desktop_configure', { component: 'terrain', python: 'relative-python', earth: '' }); return ''; }
    catch (error) { return String(error); }
  });
  assert.ok(rejection, 'Invalid path should be rejected');
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('desktop_action', { action: 'probe-terrain' }));
  const after = await waitFor('offline terrain probe', async () => {
    const value = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('desktop_status'));
    return !value.busy && value.lastOperation?.action === 'probe-terrain' ? value : null;
  });
  assert.equal(after.lastOperation.success, false);
  assert.equal(after.components.find(item => item.component === 'terrain')?.installed, false);
  checks.desktop = { title: await page.title(), native: nativeStatus.backend, terrainHeights: 64 * 64, uv: status.uv, absentModules: true, probeRejected: true };
} catch (error) { failure = error; }
finally {
  // Close only this process's native window, as a user would. Closing the CDP
  // page directly can bypass the Tauri shutdown path that owns the Rust child.
  if (child && child.exitCode === null && child.signalCode === null) {
    const closeWindow = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `[Diagnostics.Process]::GetProcessById(${child.pid}).CloseMainWindow() | Out-Null`], { windowsHide: true, stdio: 'ignore' });
    await new Promise(resolveExit => { closeWindow.once('exit', resolveExit); closeWindow.once('error', resolveExit); });
    if (child.exitCode === null && child.signalCode === null)
      await Promise.race([new Promise(resolveExit => child.once('exit', resolveExit)), sleep(15000)]);
    if (child.exitCode === null && child.signalCode === null) {
      failure ??= new Error('Desktop did not exit after its window received WM_CLOSE; forced cleanup was necessary');
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      await new Promise(resolveExit => { killer.once('exit', resolveExit); killer.once('error', resolveExit); });
    } else checks.windowClosed = true;
  } else if (child && !failure) failure = new Error('Desktop exited before the window-close test');
  try { await browser?.close(); } catch {}
  if (nativeUrl) {
    const deadline = Date.now() + 15000;
    let stopped = false;
    while (Date.now() < deadline) {
      try { await fetch(new URL('/status', nativeUrl), { signal: AbortSignal.timeout(1000) }); }
      catch { stopped = true; break; }
      await sleep(250);
    }
    if (stopped) checks.nativeStopped = true;
    else failure ??= new Error('Spawned native service still responds after desktop exit');
  }
  try {
    const actualRoot = await realpath(tempRoot), actualTarget = await realpath(isolated);
    const within = relative(actualRoot, actualTarget);
    if (!within || within === '..' || within.startsWith(`..\\`) || isAbsolute(within)) throw new Error(`Unsafe cleanup target: ${actualTarget}`);
    await rm(actualTarget, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
  catch (error) { failure ??= new Error(`Could not remove isolated test data: ${error.message}`); }
}
if (failure) { console.error(failure.stack ?? String(failure)); process.exitCode = 1; }
else console.log(JSON.stringify({ ok: true, checks }, null, 2));
