/** Bilingual V2 regression: real controls, retained worlds and both atlas editions. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { sep, extname } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'vite';

const web = fileURLToPath(new URL('..', import.meta.url));
const out = resolve(web, process.argv.includes('--production')?'out/v2-locales-production':'out/v2-locales');
const report = { time: new Date().toISOString(), checks: {}, errors: [], missing: [] };
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const preferenceKey = 'magna-urbis-v2-language';
let vite, production, browser, page;

async function sourceServer() {
  // Vite otherwise closes on the noninteractive tool runner's stdin EOF.
  process.env.CI='true';
  const server = await createServer({ configFile: resolve(web, 'vite.v2.config.ts'),
    server: { host: '127.0.0.1', port: Number(process.env.MAGNA_LOCALE_PORT ?? 5175), strictPort: true, hmr: false },
    clearScreen: false });
  await server.listen();
  return server;
}
async function productionServer(port=0,prefix='/magna-urbis/v2/'){
  const directory=resolve(web,'dist-v2');
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.wasm':'application/wasm','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};
  const server=createHttpServer(async(request,response)=>{
    try{
      const url=new URL(request.url,'http://localhost');if(!url.pathname.startsWith(prefix)){response.writeHead(404).end();return;}
      const file=resolve(directory,decodeURIComponent(url.pathname.slice(prefix.length))||'index.html');
      if(!file.startsWith(directory+sep)||!(await stat(file)).isFile()){response.writeHead(404).end();return;}
      response.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream'});createReadStream(file).pipe(response);
    }catch{response.writeHead(404).end();}
  });
  await new Promise(done=>server.listen(port,'127.0.0.1',done));
  return {server,base:`http://127.0.0.1:${server.address().port}${prefix}`};
}

if (process.argv.includes('--serve')) {
  if(process.argv.includes('--production'))production=await productionServer(Number(process.env.MAGNA_PREVIEW_PORT??5174),'/');
  else vite = await sourceServer();
  console.log(production?`V2 production preview: ${production.base}v2.html`:`V2 source QA (HMR disabled): ${vite.resolvedUrls.local[0]}v2.html`);
  console.log('Write stop on stdin to close this server.');
  await new Promise(done=>{
    const keepAlive=setInterval(()=>{},10000);
    const stop=()=>{clearInterval(keepAlive);if(vite)void vite.close().then(done);else production.server.close(done);};
    process.stdin.setEncoding('utf8');
    process.stdin.on('data',value=>{if(value.trim()==='stop')stop();});
    process.on('SIGINT',stop);process.on('SIGTERM',stop);process.stdin.resume();
  });
} else {
  await mkdir(out, { recursive: true });
  try {
    if(process.argv.includes('--production'))production=await productionServer();
    else if (!process.env.MAGNA_V2_URL) vite = await sourceServer();
    const base = (production?.base??process.env.MAGNA_V2_URL ?? vite.resolvedUrls.local[0]).replace(/\/$/, '');
    report.mode=production?'production':'source';
    report.base = base;
    browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const context = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    page = await context.newPage();
    page.setDefaultTimeout(90000); page.setDefaultNavigationTimeout(120000);
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400 && !response.url().includes('favicon.ico')) report.missing.push(response.url()); });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const goto = async query => { await page.goto(`${base}/v2.html${query}`, { waitUntil: 'domcontentloaded' }); await page.locator('#language-select').waitFor(); };
    const language = async value => {
      await page.locator('#language-select').selectOption(value);
      await page.waitForFunction(value => document.documentElement.lang === value, value);
    };
    const reveal = async selector => { await page.locator(selector).evaluate(element => { const sections=[]; for(let parent=element.parentElement;parent;parent=parent.parentElement)if(parent instanceof HTMLDetailsElement)sections.push(parent); for(const section of sections.reverse())section.open=true; }); };
    const input = async (selector, value) => { await reveal(selector); await page.locator(selector).fill(String(value)); await page.locator(selector).dispatchEvent('change'); };
    const select = async (selector, value) => { await reveal(selector); await page.locator(selector).selectOption(value); };
    const job = async (selector, during) => {
      await page.locator(selector).click();
      if (during) await during();
      await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false', null, { timeout: 180000 });
      const log = await page.locator('#job-log').textContent();
      assert(!/(?:Échec :|Failed:|Failure:)/.test(log), log);
      return log;
    };
    const project = async name => {
      await page.locator('#export-open').click(); await page.locator('#export-format').selectOption('project');
      const pending = page.waitForEvent('download', { timeout: 120000 }); await page.locator('#export-go').click();
      const download = await pending, path = resolve(out, `${name}.json`); await download.saveAs(path);
      await page.locator('#export-dialog').waitFor({ state: 'hidden' });
      return JSON.parse(await readFile(path, 'utf8'));
    };
    const canvasDigest = async () => digest(await page.locator('#map-canvas').evaluate(canvas => canvas.toDataURL('image/png')));
    const assertEnglish = async () => {
      assert.equal(await page.locator('html').getAttribute('lang'), 'en');
      assert.match(await page.locator('#tab-terrain').innerText(), /Topography/i);
      assert.match(await page.locator('#tab-settlements').innerText(), /Settlements/i);
      assert(!/Créer ma région|Topographie|Peuplements|Du relief à/.test(await page.locator('body').innerText()));
    };
    const assertFrench = async () => {
      assert.equal(await page.locator('html').getAttribute('lang'), 'fr');
      assert.match(await page.locator('#tab-terrain').innerText(), /Topographie/);
      assert.match(await page.locator('#tab-settlements').innerText(), /Peuplements/);
    };

    await goto('?empty'); await assertEnglish();
    assert.equal(await page.evaluate(() => navigator.language), 'fr-FR');
    report.checks.default = { language: 'en', ignoresBrowserFrench: true };
    await page.screenshot({ path: resolve(out, '01-default-en.png'), fullPage: true });
    await language('fr'); await assertFrench();
    assert.equal(await page.evaluate(key => localStorage.getItem(key), preferenceKey), 'fr');
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('#language-select').waitFor(); await assertFrench();
    await goto('?empty');await assertFrench();
    await goto('?empty&lang=en'); await assertEnglish();
    await goto('?empty&lang=fr'); await assertFrench();
    report.checks.preference = { FrenchPersists: true, URLOverridesPreference: true };

    await language('en');
    const customSeed = 'Carte Maison Auto — seed 42';
    await input('#seed', customSeed); await select('#terrain-backend', 'typescript');
    await input('#terrain-width', '2.4'); await page.locator('#terrain-width').blur();
    await select('[data-setting-path="options.relief"]', 'flat'); await select('[data-setting-path="options.coast"]', 'none');
    await select('[data-setting-path="options.river"]', 'stream');
    await page.locator('#tab-settlements').click(); await input('[data-option="population"]', 100); await input('#town-count', 1);
    const progress = [];
    await page.locator('#progress-label').evaluate(element => {
      window.localeProgress = [];
      new MutationObserver(() => window.localeProgress.push(element.textContent)).observe(element, { childList: true, subtree: true, characterData: true });
    });
    await job('#generate-region');
    const primary = await project('02a-primary-terrain-en');
    assert.equal(primary.world.stats['v2.stage'], 'terrain');
    assert(!primary.world.urban); assert(!primary.world.settlements?.length);
    report.checks.primaryAction = { terrainOnly: true };
    await page.locator('#tab-settlements').click();
    await job('#region-only');
    await job('#towns-only');
    progress.push(...await page.evaluate(() => window.localeProgress));
    assert(progress.some(text => /terrain|topograph|site|road|building|drawing|prepar|generation/i.test(text)));
    assert(!progress.some(text => /Calcul du relief|Recherche des sites|Préparation de la scène|Lieux générés|Topographie prête/.test(text)), progress.join('\n'));
    await page.locator('[data-town="main"]').click();
    let switchingWhileBusy=false;
    await job('#build-town',async()=>{
      switchingWhileBusy=await page.locator('#app').getAttribute('aria-busy')==='true';
      assert(switchingWhileBusy,'The live-language test did not observe an active calculation');
      assert(await page.locator('#language-select').isEnabled(),'Language picker is disabled during generation');
      await language('fr');
      assert.match(await page.locator('#progress-label').textContent(),/quartiers|parcelles|bâtiments|Mise à jour|Lieux|Dessin|Préparation/);
    });
    await assertFrench();await language('en');
    report.checks.activeJob={languageChangedWhileBusy:switchingWhileBusy,jobCompleted:true};
    const before = await project('02-world-en');
    assert.equal(before.settings.options.seed, customSeed);
    assert.equal(before.world.seed, customSeed);
    assert.equal(before.settings.options.relief, 'flat');
    assert.equal(before.settings.runtime.backend, 'typescript');
    assert.equal(before.world.stats.backend, 'typescript-cpu');
    await page.locator('[data-town="main"]').click();
    assert.match(await page.locator('#inspector').innerText(), /local|inheri|population|culture/i);
    const canvasBefore = await canvasDigest(), logBefore = await page.locator('#job-log').textContent();
    const frameURL = page.url(), timeOrigin=await page.evaluate(()=>performance.timeOrigin); let navigations = 0;
    const onNavigation = frame => { if (frame === page.mainFrame()) navigations++; };
    page.on('framenavigated', onNavigation);
    await language('fr'); await assertFrench();
    assert.match(await page.locator('#inspector').innerText(), /Réglages locaux|Culture|Population/);
    assert.equal(page.url().split('#')[0].split('?')[0], frameURL.split('#')[0].split('?')[0]);
    assert.equal(await page.evaluate(()=>performance.timeOrigin), timeOrigin, 'Language switching reloaded the app');
    assert.equal(await canvasDigest(), canvasBefore, 'Language switching changed the rendered world/view');
    const after = await project('03-world-fr');
    assert.equal(digest(after.world), digest(before.world), 'Language switching mutated generated data');
    assert.equal(await page.locator('#seed').inputValue(), customSeed);
    report.checks.liveSwitch = { retainedWorldHash: digest(before.world), retainedCanvasHash: canvasBefore,
      noDocumentReload: true, sameDocumentURLChanges:navigations, technicalValuesAndUserSeedRetained: true, dynamicInspectorTranslated: true,
      EnglishProgress: progress.slice(0, 12), generationLogWasPresent: logBefore.length > 0 };
    page.off('framenavigated', onNavigation);
    await page.screenshot({ path: resolve(out, '04-live-fr.png'), fullPage: true });

    // UI errors are localized; imported recipes and their enum keys are not rewritten.
    await language('en');
    await page.locator('#import-open').click();
    await page.locator('#project-file').setInputFiles({ name: 'unknown.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"unknown","version":1}') });
    await page.waitForFunction(()=>{const toast=document.querySelector('#toast');return toast&&!toast.hidden&&toast.dataset.error==='true';});
    assert.match(await page.locator('#toast').innerText(), /unknown|invalid|format/i);
    assert(!/inconnu|invalide|Paramètres/.test(await page.locator('#toast').innerText()));
    await page.locator('#import-dialog [data-close]').last().click();
    await page.locator('#export-open').click(); await page.locator('#export-format').selectOption('svg');
    await page.locator('#export-crop').check(); await page.locator('#export-go').click();
    await page.locator('.export-crop').waitFor();
    assert.match(await page.locator('.export-crop').innerText(), /crop|export|selection/i);
    assert(!/Recadrer|Tracez un rectangle|Carte entière|Annuler/.test(await page.locator('.export-crop').innerText()));
    await page.locator('.export-crop [data-action="cancel"]').click();
    await page.locator('#export-dialog [data-close]').last().click();
    report.checks.dialogs = { EnglishImportErrors: true, EnglishCrop: true };

    await language('fr');
    const atlasHref = await page.locator('.science-link').getAttribute('href');
    assert(/fr\.html|[?&]lang=fr/.test(atlasHref), atlasHref);
    const atlas = await context.newPage();
    atlas.setDefaultTimeout(90000);
    await atlas.goto(new URL(atlasHref, page.url()).href, { waitUntil: 'domcontentloaded' });
    assert.equal(await atlas.locator('html').getAttribute('lang'), 'fr');
    assert.equal(await atlas.locator('section.chapter').count(), 19);
    const chapter = 'maisons';
    await atlas.goto(`${base}/scientific/fr.html#${chapter}`, { waitUntil: 'domcontentloaded' });
    await atlas.locator('a[hreflang="en"]').click();
    assert.equal(await atlas.locator('html').getAttribute('lang'), 'en');
    assert.equal(new URL(atlas.url()).hash, `#${chapter}`);
    await atlas.locator('#search').fill('roof');
    assert(await atlas.locator('section.chapter:visible').count() > 0);
    assert(!/chapitre|Recherche par mots/.test(await atlas.locator('#search-status').innerText()));
    await atlas.locator('a[hreflang="fr"]').click();
    assert.equal(await atlas.locator('html').getAttribute('lang'), 'fr');
    await atlas.locator('#search').fill('toiture'); assert(await atlas.locator('section.chapter:visible').count() > 0);
    await atlas.screenshot({ path: resolve(out, '05-atlas-fr.png'), fullPage: false });
    const fresh = await browser.newContext({ locale: 'fr-FR' });
    const freshAtlas = await fresh.newPage();
    await freshAtlas.goto(`${base}/scientific/index.html`, { waitUntil: 'domcontentloaded' });
    assert.equal(await freshAtlas.locator('html').getAttribute('lang'), 'en');
    assert.equal(await freshAtlas.locator('section.chapter').count(), 19);
    await freshAtlas.screenshot({ path: resolve(out, '06-atlas-default-en.png'), fullPage: false });
    await fresh.close();
    report.checks.atlas = { defaultEnglish: true, FrenchAccessible: true, sharedPreferenceLink: true,
      chapterAnchorRetained: true, chapterCount: 19, localizedSearch: true };

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-FR' });
    const mobilePage = await mobile.newPage();
    await mobilePage.goto(`${base}/v2.html?empty`, { waitUntil: 'domcontentloaded' });
    await mobilePage.locator('#language-select').waitFor({ state: 'visible' });
    assert.equal(await mobilePage.locator('html').getAttribute('lang'), 'en');
    await mobilePage.locator('#language-select').selectOption('fr');
    await mobilePage.waitForFunction(() => document.documentElement.lang === 'fr');
    assert(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await mobilePage.screenshot({ path: resolve(out, '07-mobile-fr.png'), fullPage: true });
    await mobile.close();
    report.checks.mobile = { width: 390, languagePickerVisible: true, noHorizontalOverflow: true };
    assert.deepEqual(report.errors, []); assert.deepEqual(report.missing, []);
    report.ok = true;
  } catch (error) {
    report.ok = false; report.error = error.stack; process.exitCode = 1;
    if (page) { await page.screenshot({ path: resolve(out, 'failure.png'), fullPage: true }).catch(() => {}); report.body = (await page.locator('body').innerText().catch(() => '')).slice(-5000); }
  } finally {
    await browser?.close(); await vite?.close();if(production)await new Promise(done=>production.server.close(done));
    await writeFile(resolve(out, 'results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
}
