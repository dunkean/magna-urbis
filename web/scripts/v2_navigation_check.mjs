/** Real V2 UI + WebGL checks for walking, camera transitions and fine orbit controls. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const base = process.env.MAGNA_V2_URL ?? 'http://127.0.0.1:5174';
const moduleRoot = '/@fs/' + fileURLToPath(new URL('../src', import.meta.url)).replace(/\\/g, '/');
const out = new URL('../out/v2-navigation/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = { errors: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 780 } });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(`${base}/v2.html?empty&lang=fr&renderer=webgl`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async root => {
    const { mountV2Urban3d } = await import(root + '/v2/urban3d.ts');
    const { defaultSettings } = await import(root + '/v2/settings.ts');
    const settings = defaultSettings(), n = 32, width = 1000;
    const height = Float32Array.from({ length: n * n }, (_, i) => 10 + i % n * .5 + Math.floor(i / n) * 1.5);
    const world = { seed: 'navigation', options: settings.options, mapSize: width,
      terrain: { height: { w: n, h: n, cell: width / n, data: height }, water: new Uint8Array(n * n), filled: height,
        seaLevel: 0, coastline: [], lakes: [], rivers: [] } };
    const host = document.createElement('div'); host.id = 'navigation-test'; host.style.cssText = 'position:fixed;inset:0;z-index:10000'; document.body.append(host);
    const view = await mountV2Urban3d({ host, getWorld: () => world, getSettings: () => settings, onAppearancePatch: () => {} });
    view.show(); window.__navigation = { view, host };
  }, moduleRoot);
  const camera = () => page.evaluate(() => window.__navigation.view.getCamera());
  const canvas = page.locator('#navigation-test canvas').first();
  const select = page.locator('#navigation-test [data-navigation]');
  const before = await camera();
  await select.selectOption('walk');
  let walk = await camera();
  assert.equal(walk.navigation, 'walk'); assert.equal(walk.x, before.x); assert.equal(walk.y, before.y);
  assert.match(await canvas.getAttribute('aria-label'), /ZQSD/);
  const heldMove = async (key, milliseconds = 350, fast = false) => {
    const start = await camera();
    if (fast) await page.keyboard.down('Shift');
    await page.keyboard.down(key); await page.waitForTimeout(milliseconds); await page.keyboard.up(key);
    if (fast) await page.keyboard.up('Shift');
    const end = await camera(); return Math.hypot(end.x - start.x, end.y - start.y);
  };
  report.walk = { forward: await heldMove('w'), azerty: await heldMove('z'), arrow: await heldMove('ArrowUp'), fast: await heldMove('w', 350, true) };
  for (const key of ['forward', 'azerty', 'arrow']) assert(report.walk[key] > .15 && report.walk[key] < 2, `${key}: ${report.walk[key]}`);
  assert(report.walk.fast > report.walk.forward * 1.5);
  await page.mouse.move(500, 400); await page.mouse.down(); await page.mouse.move(560, 280, { steps: 5 }); await page.mouse.up();
  walk = await camera(); assert(walk.pitch < 0, 'Walking can look above the horizon');
  await page.mouse.wheel(0, -100); await page.waitForTimeout(100);
  const wheeled = await camera(); assert.equal(wheeled.distance, walk.distance); assert(Math.hypot(wheeled.x - walk.x, wheeled.y - walk.y) > .1);
  await page.keyboard.down('w'); await page.waitForTimeout(100); await canvas.evaluate(element => element.blur());
  const blurred = await camera(); await page.waitForTimeout(180); assert.deepEqual(await camera(), blurred); await page.keyboard.up('w');
  await canvas.focus(); await page.keyboard.down('w'); await page.waitForTimeout(80);
  await page.evaluate(() => { window.__navigation.view.hide(); window.__navigation.view.show(); });
  const reopened = await camera(); await page.waitForTimeout(150); assert.deepEqual(await camera(), reopened); await page.keyboard.up('w');
  await page.locator('#navigation-test').screenshot({ path: fileURLToPath(new URL('walk.png', out)) });
  await page.keyboard.press('Escape');
  const returned = await camera(); assert.equal(returned.navigation, 'orbit'); assert.equal(returned.distance, before.distance); assert.equal(returned.pitch, before.pitch);
  assert.equal(await select.inputValue(), 'orbit'); assert.match(await canvas.getAttribute('aria-label'), /molette/);

  const measure = async (distance, pitch = 1) => {
    await page.evaluate(({ distance, pitch }) => window.__navigation.view.setCamera({ x: 500, y: 500, distance, pitch, yaw: 0, exaggeration: 1, navigation: 'orbit' }), { distance, pitch });
    const start = await camera();
    await page.mouse.move(500, 400); await page.mouse.down(); await page.mouse.move(540, 400, { steps: 4 }); await page.mouse.up();
    const panned = await camera();
    await page.mouse.down({ button: 'right' }); await page.mouse.move(580, 400, { steps: 4 }); await page.mouse.up({ button: 'right' });
    const rotated = await camera(); await page.mouse.wheel(0, -100); await page.waitForTimeout(100);
    const zoomed = await camera();
    return { pan: Math.hypot(panned.x - start.x, panned.y - start.y), orbit: Math.abs(rotated.yaw - panned.yaw), zoom: 1 - zoomed.distance / rotated.distance };
  };
  report.orbit = { high: await measure(1000), near: await measure(5), grazing: await measure(100, .14), elevated: await measure(100, 1) };
  assert(report.orbit.near.pan < report.orbit.high.pan * .02);
  assert(report.orbit.near.orbit < report.orbit.high.orbit * .65);
  assert(report.orbit.near.zoom < report.orbit.high.zoom * .5);
  assert(report.orbit.grazing.pan < report.orbit.elevated.pan * .5);
  assert(report.orbit.grazing.orbit < report.orbit.elevated.orbit * .5);
  assert(report.orbit.grazing.zoom < report.orbit.elevated.zoom * .5);
  await page.evaluate(() => window.__navigation.view.setCamera({ x: 500, y: 500, distance: .01, pitch: 1, yaw: 0, exaggeration: 1 }));
  assert.equal((await camera()).distance, 2.5);

  report.surface = await page.evaluate(async root => {
    const { Terrain3d } = await import(root + '/ui/terrain3d.ts');
    const element = document.createElement('canvas');
    const view = new Terrain3d(element, () => {}, undefined, { navigation: true, fastMapShader: true });
    view.setSurface({ x: 0, y: 0, width: 100, n: 2, data: new Float32Array([10, 20, 30, 40]) });
    view.setHeightSampler((x, y) => 10 + .1 * x + .2 * y);
    const poses = [];
    for (const exaggeration of [1, 5]) for (const pitch of [-1, 0, 1]) {
      view.setCamera({ x: 20, y: 30, distance: 20, yaw: .7, pitch, exaggeration, navigation: 'walk' });
      const frame = view.frameGeometry();
      poses.push({ eye: frame.eye, ground: frame.targetHeight, physicalGround: view.heightAt(20, 30), pitch, exaggeration,
        forward: frame.forward, finite: Array.from(frame.matrix).every(Number.isFinite) });
    }
    view.dispose(); return poses;
  }, moduleRoot);
  for (const pose of report.surface) {
    assert.deepEqual(pose.eye, [0, 1.7, 0]); assert.equal(pose.ground, pose.physicalGround * pose.exaggeration);
    assert(pose.finite); assert(Math.abs(pose.forward[1] + Math.sin(pose.pitch)) < 1e-10);
  }
  await page.evaluate(() => { window.__navigation.view.dispose(); window.__navigation.host.remove(); });
  assert.deepEqual(report.errors, []); report.ok = true;
} catch (error) { report.ok = false; report.error = error.stack; process.exitCode = 1; }
finally { await browser.close(); await writeFile(new URL('results.json', out), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
