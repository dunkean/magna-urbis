import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
await mkdir('out/fantasy', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
try {
  for (const backend of ['gl','svg']) {
    const url = new URL(process.argv[2] || 'http://127.0.0.1:5174/terrainbench.html');
    url.search = new URLSearchParams({ seed: '42', width: '40000', motif: '9000', relief: 'mixed', climate: 'oceanic', erosion: '.3', hydro_enabled: '0', auto: '0', generation: 'cpu', compute: 'wasm', style: 'fantasy-color', ...(backend === 'svg' ? {render:'svg'} : {}) }).toString();
    await page.goto(url.href);
    await page.waitForFunction(() => document.querySelectorAll('.fantasy-brushes > use').length > 50, null, {timeout:120000});
    for (const style of ['fantasy-color','fantasy-ink']) {
      await page.selectOption('#style', style);
      await page.waitForFunction(style => document.getElementById('style').value === style && document.querySelector('.fantasy-brushes'), style);
      await page.locator('#viewport').screenshot({ path: `out/fantasy/${backend}-${style}.png` });
      console.log(backend,style,await page.locator('.fantasy-brushes > use').count());
    }
    const before = await page.locator('.fantasy-brushes > use').count();
    await page.locator('#lightingControls > summary').click();
    await page.locator('#brush_density').evaluate(input => { input.value = '.4'; input.dispatchEvent(new Event('input')); });
    const count = await page.locator('.fantasy-brushes > use').count();
    assert(count > 0 && count < before, 'density changes display without replacing the terrain');
    if (backend === 'gl') {
      for (const format of ['svg','png']) {
        const download = page.waitForEvent('download');
        await page.locator(`#fantasyExport_${format}`).click();
        const result = await download;
        assert(result.suggestedFilename().endsWith(`.${format}`));
        await result.saveAs(`out/fantasy/export.${format}`);
        const content = await readFile(`out/fantasy/export.${format}`);
        if (format === 'svg') assert(content.toString('utf8').startsWith('<svg'));
        else { assert.equal(content.readUInt32BE(16),4096); assert.equal(content.readUInt32BE(20),4096); }
      }
    }
    await page.locator('#lightingControls > summary').click();
    await page.selectOption('#style','parchment');
    assert.equal(await page.locator('#fantasyPainting').count(),0);
  }
  assert.deepEqual(errors,[]);
} finally { await browser.close(); }
