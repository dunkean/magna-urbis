/** Actual City Bench capture with retained native houses; no generation or paid API call. */
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
const base = process.env.MAGNA_ILLUSTRATION_BENCH || 'http://127.0.0.1:5173';
const fixture = JSON.parse(await readFile('tests/fixtures/housing-floor-java-ui-native.json', 'utf8'));
const output = resolve('../_agents_blackboard/illustration'); await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.context().grantPermissions(['local-network-access'], { origin: base });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route(base + '/city-history-fixture', route => route.fulfill({ contentType: 'text/html', body: '<html><body>Retained native city</body></html>' }));
  await page.goto(base + '/city-history-fixture');
  const retained = await page.evaluate(async fixture => {
    const { decodeDecor } = await import('/decor.ts'), { saveHistory } = await import('/benchHistory.ts');
    const decor = decodeDecor(new Uint8Array(await (await fetch('/decors/city-01-river-plain-l.decor')).arrayBuffer()));
    const points = fixture.buildings[0].footprint.flatMap(s => s.outer);
    const minX = Math.min(...points.map(p => p.x)) - 20, minY = Math.min(...points.map(p => p.y)) - 20;
    const maxX = Math.max(...points.map(p => p.x)) + 20, maxY = Math.max(...points.map(p => p.y)) + 20;
    const shape = { outer: [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }], holes: [] };
    const scene = { schema_version: '1', generator_version: fixture.generator_version, buildings: fixture.buildings, materials: fixture.materials, refusals: [], open_spaces: [] };
    const layout = { key: 'city', center: decor.meta.settlements[0].center, culture: 'javanese-courts', quarters: [{ shape, phase: 0 }],
      blocks: [{ shape, kind: 'urban', quarter: 0, axis: { x: 1, y: 0 } }],
      streets: [{ path: [{ x: minX, y: minY - 6 }, { x: maxX, y: minY - 6 }], widths: [6], rank: 0, role: 'main' }], enclosures: [], phases: [] };
    decor.meta.pipeline = { ...decor.meta.pipeline, parent: decor.meta.id, city: 'city', urban: {
      siteKey: 'city', quarterSeed: 'retained', parcelSeed: 'retained', layouts: [layout], partitions: [{ key: 'city', parcels: [] }], view: 'buildings',
      buildingState: { seed: 'retained', generated: true, visible: true, appearance: { style: 'cartographic', diagnostic: 'none' }, scene } } };
    const saved = await saveHistory(decor);
    return { id: saved.meta.id, bounds: { minX, minY, maxX, maxY } };
  }, fixture);
  await page.goto(base + '/citybench.html?standalone=1&profile=web&artifact=' + retained.id);
  await page.waitForFunction(() => window.magnaBenchContext?.ready() && document.querySelector('[data-city-canvas]'), null, { timeout: 60000 });
  await page.evaluate(bounds => {
    const viewport = document.getElementById('viewport');
    window.magnaBenchContext.restore({ view: { cx: (bounds.minX + bounds.maxX) / 2, cy: (bounds.minY + bounds.maxY) / 2,
      scale: Math.min(viewport.clientWidth / (bounds.maxX - bounds.minX), viewport.clientHeight / (bounds.maxY - bounds.minY)) * .8 } });
  }, retained.bounds);
  await page.waitForFunction(() => Number(document.querySelector('[data-city-frame]')?.dataset.buildingsPainted) > 0, null, { timeout: 30000 });
  await page.waitForTimeout(300);
  await page.locator('.illustration-trigger').click();
  await page.waitForFunction(() => document.querySelector('.illustration-status')?.textContent === 'Capture prête.', null, { timeout: 30000 });
  const capture = await page.locator('[data-source]').evaluate(async image => [...new Uint8Array(await (await fetch(image.src)).arrayBuffer())]);
  await writeFile(resolve(output, 'city-source.png'), Buffer.from(capture));
  await page.screenshot({ path: resolve(output, 'city-dialog.png'), fullPage: true });
  const difference = await page.evaluate(async captureModule => {
    const { captureViewport } = await import(captureModule), viewport = document.getElementById('viewport');
    const host = document.querySelector('[data-city-canvas]');
    const source = await (await fetch(document.querySelector('[data-source]').src)).blob();
    // Remove only the native 2D roofs after the production synchronous redraw;
    // the GPU city plan and the terrain stay identical for this comparison.
    const clearRoofs = () => {
      const canvas = [...host.querySelectorAll('canvas')].at(-1), ctx = canvas.getContext('2d');
      ctx.save(); ctx.resetTransform(); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.restore();
    };
    let background;
    try { host.addEventListener('illustration:capture', clearRoofs); background = await captureViewport(viewport, { exclude: ['#cityPins', '#mini', '.ruler'] }); }
    finally { host.removeEventListener('illustration:capture', clearRoofs); host.dispatchEvent(new Event('illustration:capture')); }
    const read = async blob => {
      const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const a = await read(source), b = await read(background);
    let count = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) count++;
    return count;
  }, '/@fs/' + resolve('../illustration/web/index.mjs').replaceAll('\\', '/'));
  assert.ok(difference > 1000, `The source must include native roofs above the GPU plan and decor (${difference} changed pixels).`);
  assert.deepEqual(errors, []);
  console.log('City Bench native houses captured:', fixture.buildings.length, 'buildings,', difference, 'pixels above the decor.', resolve(output, 'city-source.png'));
} finally { await browser.close(); }
