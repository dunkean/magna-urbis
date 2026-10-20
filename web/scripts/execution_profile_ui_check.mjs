import { chromium } from 'playwright';
import assert from 'node:assert/strict';

// From web/: node scripts/execution_profile_ui_check.mjs [shared bench origin] [--profile-only]
const base = new URL(process.argv.slice(2).find(arg => !arg.startsWith('--')) ?? 'http://127.0.0.1:5173').origin;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
if (process.argv.includes('--profile-only')) {
  // Exercise the real shell and shared picker without loading terrain engines.
  await page.route('**/terrainbench.html?*', route => route.fulfill({ contentType: 'text/html', body: `
    <header></header><script type="module">
      import { installExecutionProfile } from '/executionProfile.ts';
      installExecutionProfile(document.querySelector('header'));
    </script>` }));
}
const picker = '[data-execution-profile] select';
const query = new URLSearchParams({ source: 'procedural', relief: 'flat', seed: 'execution-sync', width: '500',
  compute: 'wasm', generation: 'cpu', hydro_enabled: '0', auto: '0', refine: '0' });

async function synchronized(profile) {
  await page.waitForFunction(({ picker, profile }) => {
    const child = document.querySelector('iframe[data-bench=terrain]')?.contentDocument;
    return document.querySelector(picker)?.value === profile && child?.querySelector(picker)?.value === profile;
  }, { picker, profile }, { timeout: 90000 });
  const frame = page.frames().find(frame => frame.parentFrame() && frame.url().includes('terrainbench.html'));
  assert.ok(frame);
  assert.equal(await frame.evaluate(async () => (await import('/executionProfile.ts')).executionRuntime.profile), profile);
  return frame;
}

try {
  // The URL printed by Vite opens the Rust shell with the local startup profile.
  await page.goto(`${base}/?entry=execution-check`);
  await page.locator(picker).waitFor();
  assert.equal(new URL(page.url()).pathname, '/rustbench.html');
  assert.equal(new URL(page.url()).searchParams.get('entry'), 'execution-check');
  assert.equal(await page.locator(picker).inputValue(), 'local');

  if (!process.argv.includes('--profile-only')) {
    // Inspect fresh terrain defaults in Settlements mode, without generating relief.
    await page.goto(`${base}/rustbench.html#terrain?stage=settlements`);
    const fresh = await synchronized('local');
    await fresh.waitForFunction(() => document.querySelector('#terrainSource')?.value === 'neural-python'
      && document.querySelector('#generationCompute')?.value === 'native');
    assert.equal(await fresh.locator('#terrainSource').inputValue(), 'neural-python');
    assert.equal(await fresh.locator('#generationCompute').inputValue(), 'native');
  }

  await page.goto(`${base}/rustbench.html?profile=web#terrain?${query}&profile=local`);
  let frame = await synchronized('web');

  // A retained atelier URL must not override the host's execution profile.
  const stale = new URL(frame.url()); stale.searchParams.set('profile', 'local');
  await frame.goto(stale.href);
  frame = await synchronized('web');

  // Changing the embedded picker updates the shell and normalizes both URLs.
  await frame.locator(picker).selectOption('local');
  await page.waitForURL(url => url.searchParams.get('profile') === 'local');
  await synchronized('local');
  let host = new URL(page.url());
  let route = new URLSearchParams(host.hash.slice(host.hash.indexOf('?') + 1));
  assert.equal(route.get('profile'), 'local');
  assert.equal(route.get('localServer'), host.searchParams.get('localServer'));
  assert.equal(route.get('seed'), 'execution-sync');

  // Changing the shell picker updates the embedded picker, also after reload.
  await page.locator(picker).selectOption('web');
  await page.waitForURL(url => url.searchParams.get('profile') === 'web');
  frame = await synchronized('web');
  host = new URL(page.url());
  route = new URLSearchParams(host.hash.slice(host.hash.indexOf('?') + 1));
  assert.equal(route.get('profile'), 'web');
  assert.equal(route.has('localServer'), false);
  assert.notEqual(new URL(frame.url()).searchParams.get('generation'), 'native');
  await page.reload(); await synchronized('web');

  // An old map's Web profile cannot replace the default native host on loopback.
  await page.goto(`${base}/rustbench.html#terrain?${query}&profile=web`);
  frame = await synchronized('local');
  assert.notEqual(new URL(frame.url()).searchParams.get('generation'), 'cpu');
  assert.equal(new URL(frame.url()).searchParams.get('seed'), 'execution-sync');
  if (!process.argv.includes('--profile-only')) {
    await frame.waitForFunction(() => document.querySelector('#generationCompute')?.value === 'native');
    assert.equal(await frame.locator('#generationCompute').inputValue(), 'native');
  }
  stale.search = new URL(frame.url()).search;
  stale.searchParams.set('profile', 'web');
  await frame.goto(stale.href);
  await synchronized('local');
  await page.reload(); await synchronized('local');

  // Standalone pages continue to own their profile without a container.
  await page.goto(`${base}/terrainbench.html?${query}&standalone=1`);
  await page.locator(picker).waitFor();
  assert.equal(await page.locator(picker).inputValue(), 'local');
  await page.goto(`${base}/terrainbench.html?${query}&standalone=1&profile=web`);
  await page.locator(picker).selectOption('local');
  await page.waitForURL(url => url.searchParams.get('profile') === 'local');
  assert.equal(await page.locator(picker).inputValue(), 'local');
  assert.equal(new URL(page.url()).searchParams.get('seed'), 'execution-sync');
  assert.deepEqual(errors, []);
  console.log('Execution profile UI: local startup, CUDA/native defaults, shell, embedded picker, stale URL, reload and standalone passed.');
} finally {
  await browser.close();
}
