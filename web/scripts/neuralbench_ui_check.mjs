// From web/: node scripts/neuralbench_ui_check.mjs [URL] (requires neural:serve).
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const target = new URL(process.argv[2] ?? 'http://127.0.0.1:5173/neuralbench.html');
const output = resolve('out/neuralbench-share');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1550, height: 1150 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
const errors = [], requests = [], heights = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  if (new URL(request.url()).pathname === '/generate') requests.push(new URL(request.url()).search);
});
page.on('response', async response => {
  if (new URL(response.url()).pathname === '/generate' && response.ok()) {
    heights.push(createHash('sha256').update(await response.body()).digest('hex'));
  }
});
const ready = async () => {
  await page.waitForFunction(() => !document.getElementById('generate').hasAttribute('aria-busy')
    && document.getElementById('status').dataset.error !== undefined, null, { timeout: 120000 });
  assert.equal(await page.locator('#status').getAttribute('data-error'), 'false', await page.locator('#status').innerText());
  assert.ok(await page.locator('#map image').count());
};
const scene = () => page.locator('#map').evaluate(map => Array.from(map.children)
  .filter(node => !node.classList.contains('distance-measure')).map(node => node.outerHTML).join('')
  // Local SVG IDs depend on how often the renderer ran, not on map geometry.
  .replace(/terrain-land-main-\d+/g, 'terrain-land-main'));
const sameScene = async (expected, message) => {
  const actual = await scene();
  if (actual !== expected) {
    writeFileSync(resolve(output, 'expected.svg'), expected);
    writeFileSync(resolve(output, 'actual.svg'), actual);
    let index = 0;
    while (index < Math.min(actual.length, expected.length) && actual[index] === expected[index]) index++;
    console.log('First scene difference:', index, expected.slice(index - 80, index + 160), actual.slice(index - 80, index + 160));
  }
  assert.equal(createHash('sha256').update(actual).digest('hex'), createHash('sha256').update(expected).digest('hex'), message);
};
const query = () => new URL(page.url()).searchParams;
const change = async (id, value) => {
  const node = page.locator(`#${id}`);
  if (await node.evaluate(node => node.tagName === 'SELECT')) await node.selectOption(value);
  else { await node.fill(value); await node.dispatchEvent('change'); }
};
const copy = async () => {
  await page.locator('#copy').click();
  await page.waitForFunction(() => document.getElementById('shareState').textContent.startsWith('Lien copié'));
  return page.evaluate(() => navigator.clipboard.readText());
};
const camera = () => page.locator('#map').getAttribute('viewBox');
const markers = () => page.locator('#pinLayer .pin').evaluateAll(nodes => nodes.map(node => ({ title: node.title, transform: node.style.transform })));
let release;
try {
  target.search = new URLSearchParams({ seed: 'pins-replay', coasts: 'N,W', climate: 'oceanic',
    hydroResolution: '512', steps: '5', detail: '0.9', noise: '0.95', auto: '0' }).toString();
  await page.goto(target.href); await ready();
  const originalScene = await scene(), originalRequest = requests.at(-1), originalHeights = heights.at(-1);
  assert.ok(originalHeights);
  await page.locator('#pinMode').click();
  await page.locator('#map').click({ position: { x: 500, y: 250 } });
  const note = 'Confluence, étrange ; café & 100% ☃ <repère>';
  await page.getByRole('textbox', { name: 'Note du pin' }).fill(note);
  await page.getByRole('textbox', { name: 'Note du pin' }).press('Enter');
  await page.keyboard.press('Escape');
  await page.locator('#map').click({ position: { x: 650, y: 300 }, modifiers: ['Alt'] });
  await page.getByRole('textbox', { name: 'Note du pin' }).fill('Deuxième pin');
  await page.getByRole('textbox', { name: 'Note du pin' }).press('Enter');
  assert.equal(await page.locator('#pinLayer .pin').count(), 2);
  assert.ok((await markers())[0].title.includes(note));
  assert.equal(requests.length, 1, 'Pins must not regenerate the terrain');
  await page.locator('#zoomIn').click();
  const bounds = await page.locator('#map').boundingBox();
  await page.mouse.move(bounds.x + 350, bounds.y + 180);
  await page.mouse.down(); await page.mouse.move(bounds.x + 385, bounds.y + 200); await page.mouse.up();
  const savedCamera = await camera(), savedMarkers = await markers();
  const link = await copy();
  assert.equal(link, page.url());
  assert.ok(new URL(link).searchParams.get('pins').includes(encodeURIComponent(note)));
  await sameScene(originalScene, 'Pins and navigation must preserve the scene');
  await page.goto(link); await ready();
  assert.equal(requests.at(-1), originalRequest);
  assert.equal(heights.at(-1), originalHeights, 'Neural relief must replay byte-for-byte');
  await sameScene(originalScene, 'Terrain, rivers and lakes must replay identically');
  assert.equal(await camera(), savedCamera);
  assert.deepEqual(await markers(), savedMarkers);
  assert.equal(await copy(), link, 'A replay must keep a canonical URL');
  await page.screenshot({ path: resolve(output, 'pins-replay.png'), fullPage: true });

  await page.uncheck('#showPins');
  const hiddenLink = await copy();
  await page.goto(hiddenLink); await ready();
  assert.equal(await page.locator('#pinLayer').isVisible(), false);
  assert.equal(await page.locator('#pinLayer .pin').count(), 2);
  await page.locator('#pins .pinbtn').first().click();
  assert.equal(await page.locator('#showPins').isChecked(), true);
  assert.equal(await page.getByRole('textbox', { name: 'Note du pin' }).inputValue(), note);
  await page.getByRole('textbox', { name: 'Note du pin' }).fill('Note modifiée');
  await page.getByRole('textbox', { name: 'Note du pin' }).press('Enter');
  await page.locator('#pinMode').click(); await page.locator('#measure').click();
  assert.equal(await page.locator('#pinMode').getAttribute('aria-pressed'), 'false');
  await page.locator('#pinMode').click();
  assert.equal(await page.locator('#measure').getAttribute('aria-pressed'), 'false');
  await page.keyboard.press('Escape');

  // Unapplied drafts cannot contaminate the link to the displayed map.
  await change('seed', 'draft-not-generated');
  await change('relief', 'mountains');
  await change('riverArea', '12');
  await change('climate', 'arid');
  await page.locator('[data-coast="S"]').click();
  await page.selectOption('#style', 'atlas');
  const draftLink = new URL(await copy()).searchParams;
  assert.equal(draftLink.get('seed'), 'pins-replay');
  assert.equal(draftLink.get('relief'), 'hills');
  assert.equal(draftLink.get('riverArea'), '5');
  assert.equal(draftLink.get('climate'), 'oceanic');
  assert.equal(draftLink.get('temperature'), '11');
  assert.equal(draftLink.get('coasts'), 'N,W');
  assert.equal(draftLink.get('style'), 'atlas');

  // Hold a generation request, then edit controls while it is in flight.
  let signal;
  const started = new Promise(resolve => { signal = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  await page.route('**/generate?**', async route => { signal(); await held; await route.continue(); }, { times: 1 });
  await page.locator('#generate').click(); await started;
  await change('seed', 'next-draft'); await change('riverArea', '20');
  assert.equal(new URL(await copy()).searchParams.get('seed'), 'pins-replay');
  release(); await ready();
  const appliedLink = await copy(), appliedQuery = new URL(appliedLink).searchParams;
  assert.equal(appliedQuery.get('seed'), 'draft-not-generated');
  assert.equal(appliedQuery.get('riverArea'), '12');
  assert.equal(appliedQuery.get('temperature'), '23');
  assert.equal(appliedQuery.get('coasts'), 'N,S,W');
  const appliedScene = await scene(), appliedRequest = requests.at(-1), appliedHeights = heights.at(-1);
  await page.goto(appliedLink); await ready();
  assert.equal(requests.at(-1), appliedRequest);
  assert.equal(heights.at(-1), appliedHeights);
  await sameScene(appliedScene, 'Applied settings must replay identically');
  assert.equal(await copy(), appliedLink);
  assert.equal(await page.locator('#pinLayer .pin').count(), 2);
  await page.locator('#pins .pinbtn').first().click();
  assert.equal(await page.getByRole('textbox', { name: 'Note du pin' }).inputValue(), 'Note modifiée');
  await page.screenshot({ path: resolve(output, 'pin-note.png'), fullPage: true });
  await page.locator('#pinPopover button').click();
  assert.equal(await page.locator('#pinLayer .pin').count(), 1);
  await page.locator('#pins .pinrow > button.small').click();
  assert.equal(await page.locator('#pinLayer .pin').count(), 0);
  assert.equal(query().has('pins'), false);
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, 'audit.json'), JSON.stringify({ requests: requests.length, heights, errors, link, appliedLink }, null, 2));
  console.log('Neuralbench: deterministic relief/water replay, pins, notes, camera, visibility, deletion, Auto-off drafts and in-flight changes passed.');
} finally {
  writeFileSync(resolve(output, 'requests.json'), JSON.stringify(requests, null, 2));
  release?.();
  await browser.close();
}
