// From web/: node scripts/v2_editor_levels_check.mjs [--base http://127.0.0.1:5173] [--out out/editor-fix]
// Real V2 editor on the shared native :8791 engine (Chrome on the RTX 5090, see webgpu_headless.mjs):
// pick a parcel, set its content to a tavern then to housing, regenerate, read the native programme;
// pick a house, change its roof, regenerate, read the native scene; "Select on map" stays on throughout.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { launchWebGpuChrome } from './webgpu_headless.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const out = option('out', 'out/editor-fix');
mkdirSync(out, { recursive: true });
const report = { steps: [], errors: [], toasts: [] };
const check = (name, ok, detail) => {
  report.steps.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, detail === undefined ? '' : JSON.stringify(detail));
};
let browser, dev;
try {
  // A private dev server without file watching: edits by other sessions must not reload the page mid-run.
  dev = await createServer({ mode: 'rustbench', server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });
  await dev.listen();
  const base = option('base', `http://127.0.0.1:${dev.httpServer.address().port}`);
  browser = await launchWebGpuChrome();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'en-US' });
  page.setDefaultTimeout(120000);
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(`${base}/v2.html?empty&test=1&lang=en&profile=local`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__v2Test?.ready, undefined, { timeout: 90000 });
  await page.evaluate(() => window.__v2Test.prepare({ decor: 'city-temperate-river-s', culture: 'european-organic', population: 1500, seed: 'editor-fix', fortification: 'none' }));
  await page.evaluate(() => window.__v2Test.run());
  await page.evaluate(() => {
    new MutationObserver(list => {
      for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1 && /toast/.test(n.className)) (window.__toasts ??= []).push(n.textContent);
    }).observe(document.body, { subtree: true, childList: true });
  });
  const idle = () => page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false', undefined, { timeout: 600000 }).then(() => page.waitForTimeout(1500));
  const city = () =>
    page.evaluate(() => {
      const w = window.__v2Test.world();
      const [key, snap] = Object.entries(w.debug.v2RustCities)[0];
      return { key, allocations: (snap.programmePartitions ?? snap.partitions)?.[0]?.programme?.allocations?.map(a => ({ parcelId: a.parcelId, role: a.role })) ?? [] };
    });
  const view = await page.evaluate(() => window.__v2Test.view('2d-core')),
    box = await page.locator('#map').boundingBox();
  const toScreen = p => ({ x: box.x + box.width / 2 + (p.x - view.cx) * view.scale, y: box.y + box.height / 2 + (p.y - view.cy) * view.scale });
  const houses = await page.evaluate(() =>
    window.__v2Test
      .world()
      .urban.buildings.filter(b => b.nativeRequestId && b.nativeParcelId)
      .map(b => ({ id: b.nativeRequestId, parcel: b.nativeParcelId, x: b.poly.reduce((s, p) => s + p.x / b.poly.length, 0), y: b.poly.reduce((s, p) => s + p.y / b.poly.length, 0) })),
  );
  const target = houses.map(h => ({ ...h, screen: toScreen(h) })).find(h => h.screen.x > box.x + 420 && h.screen.x < box.x + box.width - 380 && h.screen.y > box.y + 120 && h.screen.y < box.y + box.height - 120);
  if (!target) throw new Error('no editable building in view');
  const selecting = () => page.evaluate(() => document.querySelector('#inspect-mode').checked);
  // The real "Select on map" control, once; it must stay on for every following pick and regeneration.
  await page.evaluate(() => {
    const input = document.querySelector('#inspect-mode');
    if (!input.checked) input.click();
  });
  const pick = async level => {
    await page.evaluate(level => {
      const select = document.querySelector('#inspect-target');
      select.value = level;
      select.dispatchEvent(new Event('change'));
    }, level);
    await page.mouse.click(target.screen.x, target.screen.y);
    await page.waitForTimeout(800);
  };

  // 1. Parcel content: tavern, then housing.
  await pick('parcel');
  const role = page.locator('#subdivision-controls select[data-setting-path="role"]');
  await role.waitFor();
  const options = await role.locator('option').evaluateAll(list => list.map(o => ({ value: o.value, text: o.textContent, disabled: o.disabled })));
  check(
    'parcel content lists localized enabled types',
    options.filter(o => o.value && !o.disabled).length > 3 && !options.some(o => /^[a-z]+\.[a-z.-]+$/.test(o.text ?? '')),
    options.map(o => o.text),
  );
  const parcelId = (await city()).allocations.find(a => a.parcelId === target.parcel)?.parcelId ?? target.parcel;
  for (const [step, wanted] of [
    ['tavern', 'commerce.tavern'],
    ['house', 'dwelling'],
  ]) {
    const value = options.some(o => o.value === wanted) ? wanted : options.find(o => o.value.startsWith(wanted.split('.')[0]))?.value;
    await role.selectOption(value);
    await page.locator('#subdivision-apply').click();
    await idle();
    const allocation = (await city()).allocations.find(a => a.parcelId === parcelId);
    check(`parcel ${step}: native programme allocates ${value}`, allocation?.role === value || (value === 'dwelling' && allocation?.role?.startsWith('dwelling')), allocation);
    check(`parcel ${step}: selection still on and panel still on the parcel`, (await selecting()) && (await role.isVisible()), { selecting: await selecting() });
    await page.screenshot({ path: `${out}/parcel-${step}.png` });
  }

  // 2. House roof.
  await pick('house');
  const roof = page.locator('#house-native-controls select[data-setting-path="overrides.roof"]');
  await roof.waitFor();
  await page.waitForTimeout(2500);
  const roofOptions = await roof.locator('option').evaluateAll(list => list.map(o => ({ value: o.value, text: o.textContent })));
  check(
    'roof options are named, not coded',
    roofOptions.length > 2 && !roofOptions.some(o => /RF-/.test(o.text ?? '')),
    roofOptions.map(o => o.text),
  );
  const sceneRoof = () =>
    page.evaluate(id => {
      const w = window.__v2Test.world();
      const snap = Object.values(w.debug.v2RustCities)[0];
      const b = window.__v2Test.world().urban.buildings.find(x => x.nativeRequestId === id);
      const native = snap.scene?.buildings.find(x => x.id === b?.nativeId);
      return { roof: b?.roof, volumes: native?.volumes?.map(v => v.roof_system), massing: native?.programme?.massing?.map(m => m.roof) };
    }, target.id);
  const before = await sceneRoof(),
    current = await roof.inputValue();
  const shapes = { 'RF-HIP': 'hip', 'RF-FLAT': 'flat', 'RF-DOME': 'dome' };
  const next = roofOptions.find(o => o.value && o.value !== current && shapes[o.value] && !before.massing?.includes(shapes[o.value]))?.value ?? roofOptions.find(o => o.value && o.value !== current)?.value;
  await roof.selectOption(next);
  await page.locator('#house-native-apply').click();
  await idle();
  const after = await sceneRoof();
  report.toasts = await page.evaluate(() => window.__toasts ?? []);
  check(`house roof ${current || 'auto'} -> ${next}: scene changed`, JSON.stringify(before) !== JSON.stringify(after), { before, after, toasts: report.toasts });
  check('house: selection still on', await selecting());
  await page.screenshot({ path: `${out}/house-roof.png` });
  await page.keyboard.press('Escape');
  check('Escape leaves Select on map', !(await selecting()));
} catch (error) {
  report.errors.push(String(error?.stack ?? error));
  console.error(error);
} finally {
  await browser?.close();
  await dev?.close();
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
}
