/** Real wheel -> viewer clamp -> captured context -> battlemap option. No generation. */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const base = process.env.MAGNA_ILLUSTRATION_BENCH || 'http://127.0.0.1:5173';
const moduleUrl = path => '/@fs/' + fileURLToPath(new URL(path, import.meta.url)).replaceAll('\\', '/');
const modules = { viewer: moduleUrl('../src/ui/viewer.ts'), context: moduleUrl('../src/ui/illustrationContext.ts'), panel: moduleUrl('../../illustration/web/index.mjs') };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const [width, height] of [[1920, 1080], [3840, 2160]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(15000);
    let submissions = 0;
    await page.route('http://127.0.0.1:8794/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/prompt')) return route.fulfill({ json: { description: 'Measured viewer crop', prompt: 'Measured viewer crop' } });
      if (path === '/status') return route.fulfill({ json: { service: 'magna-illustration', protocol: 1, promptRevision: 6, localDependencies: true, outputs: ['illustration', 'battlemap'] } });
      if (route.request().method() === 'POST') submissions++;
      return route.fulfill({ json: { jobs: [] } });
    });
    await page.route(base + '/zoom-fixture', route => route.fulfill({ contentType: 'text/html', body: '<html><body style="margin:0"><header style="position:absolute;z-index:1"></header><div id="view" style="width:100vw;height:100vh"><canvas></canvas></div></body></html>' }));
    await page.goto(base + '/zoom-fixture');
    await page.evaluate(async modules => {
      const [{ createViewer }, { illustrationContext }, { mountIllustration, captureViewport }] = await Promise.all([import(modules.viewer), import(modules.context), import(modules.panel)]);
      const viewport = document.querySelector('#view'), canvas = viewport.querySelector('canvas');
      const viewer = window.zoomViewer = createViewer({ container: viewport, canvas });
      viewer.setRenderer({
        draw(view) { const ctx = canvas.getContext('2d'); ctx.fillStyle = '#738765'; ctx.fillRect(0, 0, canvas.width, canvas.height); return { ms: 0, band: 2, scale: view.scale }; },
        dispose() {},
      }, 10000);
      viewer.setView({ cx: 5000, cy: 5000, scale: 8 });
      mountIllustration({ host: document.querySelector('header'), capture: async () => ({
        image: await captureViewport(viewport), context: illustrationContext({ sourceStyle: 'parchment', seed: 'wheel', view: { ...viewer.getView() }, width: viewport.clientWidth, height: viewport.clientHeight }),
      }) });
    }, modules);
    await page.locator('.illustration-trigger').click();
    await page.waitForFunction(() => document.querySelector('.illustration-status').textContent === 'Capture prête.');
    assert.equal(await page.locator('option[value=battlemap]').evaluate(option => option.disabled), false, 'Battlemap scale now accepts a broader crop even at the old zoom ceiling.');
    await page.locator('[data-illustration-close]').click();
    await page.mouse.move(width / 2, height / 2);
    await page.mouse.wheel(0, -2200);
    await page.waitForFunction(() => window.zoomViewer.getView().scale === 128);
    const preview = page.waitForRequest(request => request.url().endsWith('/prompt') && request.method() === 'POST');
    await page.locator('.illustration-trigger').click();
    const context = (await preview).postDataJSON().context;
    assert.equal(context.camera.scale, 128);
    assert.equal(context.extentMetres.width, width / 128);
    await page.waitForFunction(() => !document.querySelector('option[value=battlemap]').disabled);
    await page.locator('[name=output]').selectOption('battlemap');
    await page.locator('[name=grid]').waitFor({ state: 'visible' });
    assert.equal(submissions, 0);
    console.log(`${width} × ${height}: wheel zoom reaches ${context.extentMetres.width} × ${context.extentMetres.height} m; battlemap selectable.`);
    await page.close();
  }
} finally { await browser.close(); }
