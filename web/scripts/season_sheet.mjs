/** Season sheet: one 500-inhabitant town per climate zone and relief, on a neural 40 km map, in every season, style and zoom.
 *
 * Each world is generated once in V2; seasons, styles and zooms are render-only, so 22 generations give the whole grid.
 * Needs the Python neural service on :8793. From web/, with Vite on a port 5191-5199:
 *   node scripts/season_sheet.mjs --port 5191 --label sheet-1 [--zones nordic,desert] [--reliefs plain] [--seasons winter,summer] [--styles satellite] [--zooms far,near]
 * Output: web/out/season-sheet/<label>/, one meta.json. A world already shot is skipped unless --force. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), arg = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; }, flag = name => args.includes(`--${name}`);
const port = Number(arg('port', '')), label = arg('label', '');
if (!Number.isInteger(port) || port < 5191 || port > 5199 || !/^[\w.-]+$/.test(label)) throw Error('Usage: --port 5191..5199 --label name [--zones a,b] [--reliefs a,b] [--seasons a,b] [--styles a,b] [--zooms a,b] [--force]');

export const SEASONS = { winter: 0, spring: .25, summer: .5, autumn: .75 };
export const RELIEFS = { plain: 'flat', mountain: 'mountains' };
/** The town itself, its surroundings, the whole 40 km; shot in this order from the view of the town. */
export const ZOOMS = ['near', 'mid', 'far'];
const MID_ZOOM_OUT_CLICKS = 5;
/** Culture of the town, by climate zone then relief. */
export const ZONES = {
  temperate: { plain: 'bastide', mountain: 'european-organic' },
  mediterranean: { plain: 'roman-core', mountain: 'byzantine-greek' },
  continental: { plain: 'hanseatic', mountain: 'russian-kremlin' },
  nordic: { plain: 'norse-ringfort', mountain: 'barbarian-norse' },
  alpine: { plain: 'european-organic', mountain: 'celtic-oppidum' },
  arctic: { plain: 'nomad-camp', mountain: 'norse-ringfort' },
  steppe: { plain: 'nomad-camp', mountain: 'persian' },
  desert: { plain: 'medina', mountain: 'native-pueblo' },
  savanna: { plain: 'sahel', mountain: 'kraal' },
  tropical: { plain: 'khmer', mountain: 'maya' },
  wetland: { plain: 'stilt-town', mountain: 'japanese-jokamachi' },
};
const pick = (name, all) => { const list = arg(name, all.join(',')).split(','); for (const v of list) if (!all.includes(v)) throw Error(`Unknown ${name}: ${v}`); return list; };
const zones = pick('zones', Object.keys(ZONES)), reliefs = pick('reliefs', Object.keys(RELIEFS)), seasons = pick('seasons', Object.keys(SEASONS)), styles = pick('styles', ['satellite', 'parchment']), zooms = pick('zooms', ZOOMS);
const POPULATION = 500, EXTENT = 40000, viewport = { width: 1400, height: 1000 };
const out = path.join(web, 'out/season-sheet', label); fs.mkdirSync(out, { recursive: true });
const metaFile = path.join(out, 'meta.json'), meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : { label, population: POPULATION, extent: EXTENT, viewport, worlds: {}, failures: [] };
const save = () => fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
const start = Date.now(), log = (...m) => console.log(`[${Math.round((Date.now() - start) / 1000)}s]`, ...m);

const hide = `html,body,#app{width:100%!important;height:100%!important;overflow:hidden!important}.app-header,#sidebar,.mobile-toggle,.map-topbar,.map-bottom,.map-compass,.map-tools,.map-hint,.inspector-mode,.places-panel,.inspector,.toast,.hint,.legend-strip,.progress-card,.city3d-bar,.city3d-info,.city3d-help{visibility:hidden!important;pointer-events:none!important}.workspace{display:block!important;position:fixed!important;inset:0!important;height:100vh!important}.map-area{position:absolute!important;inset:0!important;width:100%!important;height:100%!important}.city3d{position:absolute!important;inset:0!important}`;
const viteStub = 'export const createHotContext=()=>({accept(){},dispose(){},prune(){},invalidate(){},on(){},off(){},send(){},data:{}});export const updateStyle=(id,css)=>{let e=document.querySelector(`style[data-vite-dev-id="${id}"]`);if(!e){e=document.createElement("style");e.dataset.viteDevId=id;document.head.append(e);}e.textContent=css;};export const removeStyle=()=>{};export const injectQuery=u=>u;export const ErrorOverlay=class{};';

const browser = await chromium.launch({ channel: 'chrome', headless: true, env: { ...process.env, VK_LOADER_DEVICE_ID_FILTER: '0x2b85' }, args: ['--use-angle=vulkan', '--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'] });
if (process.platform === 'win32') {
  // Restrict only processes launched by this browser. Never select by image name.
  try { const cdp = await browser.newBrowserCDPSession(), { processInfo } = await cdp.send('SystemInfo.getProcessInfo'); execFileSync('powershell.exe', ['-NoProfile', '-Command', `foreach($i in @(${processInfo.map(p => p.id).join(',')})){try{(Get-Process -Id $i -ErrorAction Stop).ProcessorAffinity=[IntPtr]0xFFFE00}catch{}}`], { stdio: 'ignore' }); await cdp.detach(); } catch (e) { log('affinity', e.message); }
}
const busyDone = page => page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') !== 'true' && document.querySelector('#render-status')?.hidden !== false, null, { timeout: 240000 });
const settle = async (page, delay = 2500) => { await busyDone(page); await page.waitForTimeout(delay); };

async function openRecipe(page) { await page.locator('#expert-open').click(); return JSON.parse(await page.locator('#expert-json').inputValue()); }
async function applyRecipe(page, recipe) { await page.locator('#expert-json').fill(JSON.stringify(recipe)); await page.locator('#expert-apply').click(); const error = await page.locator('#expert-error').textContent(); if (error) throw Error(`Recipe refused: ${error}`); }
/** Render-only control: the same field the Global effects panel exposes. */
async function setSeason(page, value) {
  await page.evaluate(v => { const box = document.querySelector('[data-setting-path="composition.effects.season"],[data-setting-path="appearance.composition.effects.season"]'); if (!box) throw Error('No season control'); box.value = String(v); box.dispatchEvent(new Event('input', { bubbles: true })); box.dispatchEvent(new Event('change', { bubbles: true })); }, value);
}
async function setStyle(page, id) { await page.evaluate(v => { const select = document.querySelector('#map-style'); select.value = v; select.dispatchEvent(new Event('change', { bubbles: true })); }, id); }

async function shootWorld(zone, reliefId, attempt) {
  // A town generation can refuse its programme: the next attempt takes a new seed, then the zone's other culture.
  const id = `${zone}-${reliefId}`, cultures = Object.values(ZONES[zone]), culture = attempt < 2 ? ZONES[zone][reliefId] : cultures.find(c => c !== ZONES[zone][reliefId]) ?? ZONES[zone][reliefId], page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const record = meta.worlds[id] = { zone, relief: reliefId, culture, attempt, shots: [], errors: [] };
  page.on('pageerror', e => { record.errors.push(e.message.slice(0, 300)); log('PAGEERROR', id, e.message.slice(0, 200)); });
  page.on('console', m => { if (m.type() === 'error') record.errors.push(m.text().slice(0, 300)); });
  page.setDefaultTimeout(30000);
  // Other sessions edit this tree: a hot reload in the middle of a chain would lose the page.
  await page.route('**/@vite/client', route => route.fulfill({ contentType: 'text/javascript', body: viteStub }));
  await page.goto(`http://127.0.0.1:${port}/v2.html?test=1&quality=full&lang=en`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('#map-style').waitFor(); await page.waitForTimeout(5000);
  const recipe = await openRecipe(page), relief = RELIEFS[reliefId];
  if (flag('dump-recipe')) fs.writeFileSync(path.join(out, 'recipe.json'), JSON.stringify(recipe, null, 2));
  recipe.extent = EXTENT; recipe.generation = 'neural'; recipe.runtime = { ...recipe.runtime, backend: 'native', source: 'neural-python' };
  Object.assign(recipe.options, { seed: `season-${id}${attempt ? `-${attempt}` : ''}`, culture, population: POPULATION, relief, coast: reliefId === 'plain' ? 'S' : 'none' });
  recipe.terrain = { ...recipe.terrain, relief, climate: zone, ...(reliefId === 'plain' ? { coastMask: 16 } : {}), ...(flag('no-forest') ? { forest: { enabled: false, density: 0, clearings: 0 } } : {}) };
  await applyRecipe(page, recipe);
  await page.locator('#run-chain').click();
  const outcome = await page.waitForFunction(() => { const job = document.querySelector('#job-log')?.textContent ?? ''; if (/Failed:/.test(job)) return job.slice(job.lastIndexOf('Failed:')); return /ready/i.test(document.querySelector('#footer-status')?.textContent ?? '') && document.querySelector('#app')?.getAttribute('aria-busy') === 'false' ? 'ready' : false; }, null, { timeout: 300000 }).then(handle => handle.jsonValue());
  if (outcome !== 'ready') throw Error(outcome);
  await page.waitForTimeout(4000);
  if (await page.locator('#map-canvas').isHidden()) throw Error(`Generation failed: ${await page.locator('#toast').textContent()}`);
  record.status = await page.locator('#footer-status').textContent(); record.generatedAt = Math.round((Date.now() - start) / 1000);
  log('generated', id, record.status);
  await page.addStyleTag({ content: hide }); await page.waitForTimeout(500);
  const centre = { x: viewport.width / 2, y: viewport.height / 2 };
  for (const style of styles) {
    await setStyle(page, style); await settle(page, 4000);
    // --calendar key=value,... edits the zone's year through the panel's own fields.
    for (const pair of (arg('calendar', '') || '').split(',').filter(Boolean)) {
      const [key, value] = pair.split('=');
      await page.evaluate(([k, v]) => { const box = document.querySelector(`[data-setting-path="composition.effects.calendar.${k}"],[data-setting-path="appearance.composition.effects.calendar.${k}"]`); if (!box) throw Error(`No calendar control ${k}`); box.value = v; box.dispatchEvent(new Event('input', { bubbles: true })); box.dispatchEvent(new Event('change', { bubbles: true })); }, [key, value]);
      await settle(page, 1500);
    }
    if (arg('variant')) { await page.evaluate(v => { const box = document.querySelector('[data-setting-path="composition.ground.variant"],[data-setting-path="appearance.composition.ground.variant"]'); if (!box) throw Error('no variant control'); box.value = v; box.dispatchEvent(new Event('input', { bubbles: true })); box.dispatchEvent(new Event('change', { bubbles: true })); }, arg('variant')); await settle(page, 4000); }
    // The town does not always keep the requested centre: the place list frames it where it settled.
    record.places ??= await page.evaluate(() => [...document.querySelectorAll('[data-town]')].map(b => [b.dataset.town, b.textContent.trim().slice(0, 40)]));
    await page.evaluate(() => (document.querySelector('[data-town="main"]') ?? document.querySelector('[data-town]')).click()); await settle(page, 1500);
    for (const zoom of ZOOMS.filter(z => zooms.includes(z) || z === 'near')) {
      if (zoom === 'mid') await page.evaluate(n => { for (let i = 0; i < n; i++) document.querySelector('#zoom-out').click(); }, MID_ZOOM_OUT_CLICKS);
      if (zoom === 'far') await page.evaluate(() => document.querySelector('#fit-map').click());
      if (!zooms.includes(zoom)) continue;
      await settle(page, 2000);
      for (const season of seasons) {
        await setSeason(page, SEASONS[season]); await settle(page, 2500);
        const file = `${id}-${style}-${zoom}-${season}.png`;
        await page.evaluate(() => window.__v2Test.prepareCapture());
        await page.screenshot({ path: path.join(out, file), timeout: 120000 });
        record.shots.push({ style, zoom, season, file, scale: await page.locator('#scale-label').textContent().catch(() => null) });
        log('shot', file); save();
      }
    }
    if (flag('three-d')) {
      await page.evaluate(() => document.querySelector('#view3d').click());
      await page.waitForFunction(() => document.querySelector('#view3d')?.getAttribute('aria-pressed') === 'true', null, { timeout: 60000 }); await settle(page, Number(arg('hold', '8000')));
      for (const season of seasons) {
        await setSeason(page, SEASONS[season]); await settle(page, 6000);
        const file = `${id}-${style}-3d-${season}.png`;
        await page.screenshot({ path: path.join(out, file), timeout: 120000 }); log('shot', file);
      }
      await page.evaluate(() => document.querySelector('#view3d').click()); await settle(page, 1000);
    }
  }
  await page.close();
}

for (const zone of zones) for (const reliefId of reliefs) {
  const id = `${zone}-${reliefId}`;
  if (!flag('force') && meta.worlds[id]?.shots?.length === styles.length * seasons.length * zooms.length) continue;
  // --attempt replays a world from the seed an earlier run settled on, so both styles show the same town.
  for (let attempt = Number(arg('attempt', '0')); attempt < 4; attempt++) {
    try { await shootWorld(zone, reliefId, attempt); break; }
    catch (e) { meta.failures.push({ id, attempt, message: String(e.message).slice(0, 500) }); log('FAILED', id, attempt, e.message.slice(0, 200)); await Promise.all(browser.contexts().flatMap(c => c.pages()).map(p => p.close().catch(() => {}))); }
  }
  save();
}
await browser.close();
log('done', Object.keys(meta.worlds).length, 'worlds', meta.failures.length, 'failures');
