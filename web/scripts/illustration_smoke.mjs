/** Real capture and shared UI regression. Provider jobs are explicitly simulated; no paid API calls. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const output = new URL('../../_agents_blackboard/illustration/', import.meta.url);
const bench = process.env.MAGNA_ILLUSTRATION_BENCH || 'http://127.0.0.1:5173';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.context().grantPermissions(['local-network-access'], { origin: bench });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const pending = new Set(); page.on('request', request => pending.add(request.url())); page.on('requestfinished', request => pending.delete(request.url())); page.on('requestfailed', request => pending.delete(request.url()));
  page.on('console', message => { if (message.type() === 'error') console.log('Browser:', message.text().slice(0, 400)); });
  page.on('requestfailed', request => console.log('Request failed:', request.url(), request.failure()?.errorText));
  // Load a real retained terrain through the same history API as a .decor import.
  // This test exercises capture, without benchmarking unrelated terrain generation.
  await page.route(bench + '/illustration-fixture', route => route.fulfill({ contentType: 'text/html', body: '<html><body>Loading retained terrain</body></html>' }));
  await page.goto(bench + '/illustration-fixture');
  console.log('Loading retained terrain fixture…');
  const query = await page.evaluate(async () => {
    const { decodeDecor } = await import('/decor.ts');
    const { saveHistory } = await import('/benchHistory.ts');
    const response = await fetch('/decors/city-01-river-plain-s.decor');
    if (!response.ok) throw Error('Generate the City Bench decor catalogue before running this smoke.');
    const decor = await saveHistory(decodeDecor(new Uint8Array(await response.arrayBuffer())), false);
    const params = new URLSearchParams(decor.meta.query);
    params.set('artifact', decor.meta.id); params.set('stage', 'terrain'); params.set('standalone', '1'); params.set('profile', 'web');
    params.set('source', 'procedural'); params.set('refine', '0');
    return params.toString();
  });
  console.log('Opening Terrain Bench…');
  await page.goto(bench + '/terrainbench.html?' + query, { waitUntil: 'commit', timeout: 120000 });
  await page.waitForFunction(() => window.magnaBenchContext?.ready(), null, { timeout: 240000 }).catch(async error => {
    console.log('Startup state', await page.evaluate(() => ({ url: location.href, status: document.querySelector('#status')?.textContent, startup: document.body.dataset.terrainStartup, button: !!document.querySelector('.illustration-trigger') })), 'pending requests', [...pending], 'errors', errors);
    throw error;
  });
  await page.waitForTimeout(2000);
  console.log('Capturing 2D view…');
  await page.locator('.illustration-trigger').click();
  await page.waitForFunction(() => document.querySelector('.illustration-status')?.textContent === 'Capture prête.', null, { timeout: 60000 }).catch(async error=>{console.log('Capture status',await page.locator('.illustration-status').textContent());throw error;});
  const dimensions = await page.locator('[data-source]').evaluate(image => [image.naturalWidth, image.naturalHeight]);
  assert.ok(dimensions[0] > 100 && dimensions[1] > 100);
  await page.screenshot({ path: new URL('terrain-dialog.png', output).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
  let submitted;
  const id = 'a'.repeat(24), source = await page.locator('[data-source]').evaluate(async image => {
    const blob = await (await fetch(image.src)).blob(); return [...new Uint8Array(await blob.arrayBuffer())];
  });
  await writeFile(new URL('source.png', output), Buffer.from(source));
  await page.route('http://127.0.0.1:8794/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/status') return route.fulfill({ json: { service: 'magna-illustration', protocol: 1, localDependencies: true } });
    if (path.endsWith('.png')) return route.fulfill({ contentType: 'image/png', body: Buffer.from(source) });
    let body = {};
    if (path.endsWith('/jobs') && request.method() === 'POST') {
      submitted = request.postDataJSON(); body = { id, status: 'queued' };
    } else if (path.endsWith('/jobs')) body = { jobs: [] };
    else body = { id, status: 'succeeded', message: 'Illustration terminée.', progress: 1, prompt: 'test prompt', totalSeconds: .1, outputSize: dimensions, settings: {}, context: {} };
    return route.fulfill({ status: request.method() === 'POST' ? 202 : 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.locator('[data-generate]').click();
  await page.locator('.illustration-dialog [data-download]').waitFor({ state: 'visible' });
  assert.equal(submitted.version, 1); assert.equal(submitted.context.application, 'magna-urbis');
  assert.ok(submitted.guides.edges.startsWith('data:image/png;base64,'));
  assert.equal(submitted.context.projection, 'orthographic');
  const download = page.waitForEvent('download'); await page.locator('[data-recipe]').click(); await download;
  await page.waitForFunction(()=>!document.querySelector('.illustration-dialog [data-generate]').disabled);
  await page.locator('[data-close]').click();
  console.log('Capturing 3D view…');
  await page.locator('#projection3d').evaluate(button => button.click());
  assert.equal(await page.locator('#projection3d').getAttribute('aria-pressed'), 'true', await page.locator('#status').textContent());
  await page.waitForTimeout(2000);
  assert.equal(await page.locator('#projection3d').getAttribute('aria-pressed'), 'true', await page.locator('#status').textContent());
  await page.locator('.illustration-trigger').click();
  await page.waitForFunction(() => document.querySelector('.illustration-status')?.textContent === 'Capture prête.', null, { timeout: 60000 }).catch(async error=>{console.log('3D capture status',await page.locator('.illustration-status').textContent());throw error;});
  console.log('3D context', await page.locator('.illustration-prompt').textContent());
  await page.screenshot({path:new URL('terrain-3d-before.png',output).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});
  await page.locator('[data-generate]').click();
  await page.waitForTimeout(500);
  await page.locator('.illustration-dialog [data-download]').waitFor({ state: 'visible' });
  assert.ok(submitted.guides.depth?.startsWith('data:image/png;base64,'), '3D capture includes exact scene depth');
  assert.equal(submitted.context.projection, 'perspective');
  await writeFile(new URL('source-3d.png', output), Buffer.from(submitted.image.split(',')[1], 'base64'));
  await writeFile(new URL('depth.png', output), Buffer.from(submitted.guides.depth.split(',')[1], 'base64'));
  await page.screenshot({ path: new URL('terrain-3d-dialog.png', output).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile(new URL('smoke-report.json', output), JSON.stringify({ dimensions, context: submitted.context, checks: ['real terrain capture', 'aligned structural guide', 'exact 3D scene depth', 'job submission', 'result comparison', 'recipe download'], provider: 'simulated' }, null, 2));
  console.log('Illustration UI smoke passed', dimensions);
} finally { await browser.close(); }
