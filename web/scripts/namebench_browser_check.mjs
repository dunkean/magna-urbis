/** Bundle the real naming runtime, then generate with the browser network disabled. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium } from 'playwright';

const web = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(web, 'out/namebench-browser');
await mkdir(output, { recursive: true });
const entry = resolve(output, 'entry.ts');
await writeFile(entry, `
import { generateToponym, ALGORITHM_VERSION, CORPUS_VERSION } from '../../src/gen/names/toponyms';
import { CULTURE_PROFILES } from '../../src/gen/names/profiles';
import { presentName } from '../../src/gen/names/displayNames';
import { mountMapControls } from '../../src/v2/mapControls';
import { defaultSettings } from '../../src/v2/settings';
import { compositionFields, compositionMessages } from '../../src/ui/compositionControls';
import { mountParameterForm, readSettingPath, writeSettingPath } from '../../src/ui/parameterForm';
import { presetComposition } from '../../src/render/composition';
import { selectNameLevels } from '../../src/render/textLayer';
import { registerMessages, setLanguage } from '../../src/v2/i18n';
const settings = defaultSettings();
settings.appearance={style:'atlas',composition:presetComposition('atlas')};
const host = document.createElement('div'), exports = document.createElement('div');
document.body.append(host, exports);
mountMapControls(host, exports, {getSettings:()=>settings,getWorld:()=>({settlements:[{key:'main',name:'Demo',culture:'chinese',main:true}]} as any),busy:()=>false,onNames:()=>{},onExport:()=>{}});
registerMessages(compositionMessages);
const sliders=document.createElement('div');document.body.append(sliders);
mountParameterForm(sliders,Object.values(compositionFields).filter(f=>f.path.includes('.text.levels.')),{getValue:path=>readSettingPath(settings,path),setValue:(path,value)=>writeSettingPath(settings,path,value)});
globalThis.visibleRiverNames=()=>selectNameLevels(Array.from({length:20},(_,i)=>({id:'river:'+i,kind:'river',text:'River '+i,detail:i/20})),settings.appearance.composition.text).map(l=>l.id);
globalThis.namingSetLanguage=setLanguage;
globalThis.namePresentationSettings = settings;
const cultures = Object.keys(CULTURE_PROFILES).sort();
const kinds = ['town','river','lake','forest','hill','region'];
globalThis.runNamebenchSmoke = () => ({ algorithm: ALGORITHM_VERSION, corpus: CORPUS_VERSION,
  localized: ['fr','en','ja','ar','es','pt','zh','ru'].map(language => presentName({proper:'Tsing Tao',cultural:'Tsing Tao',kind:'river',opaque:false},{mode:'localized',language})),
  rows: cultures.map(culture => ({ culture, names: kinds.map(kind => generateToponym({
    seed: 'namebench-browser-check', key: culture + ':' + kind, kind, culture
  })) })) });
`, 'utf8');
await build({
  configFile: false, root: web, logLevel: 'warn',
  worker:{format:'es'},
  build: { outDir: resolve(output, 'bundle'), emptyOutDir: true, minify: true,
    lib: { entry, formats: ['es'], fileName: () => 'names.js' } },
});
const bundle = await readFile(resolve(output, 'bundle/names.js'));
const html = '<!doctype html><meta charset="utf-8"><title>Namebench offline check</title><script type="module" src="/names.js"></script>';
const server = createServer((request, response) => {
  if (request.url === '/names.js') response.writeHead(200, { 'Content-Type': 'application/javascript' }).end(bundle);
  else if (request.url === '/') response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
  else response.writeHead(404).end();
});
await new Promise(ready => server.listen(0, '127.0.0.1', ready));
const errors = [], requests = [];
let browser;
const result = { ok: false, bundleBytes: bundle.length };
try {
  browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof globalThis.runNamebenchSmoke === 'function');
  await context.setOffline(true);
  const requestCount = requests.length;
  const first = await page.evaluate(() => globalThis.runNamebenchSmoke());
  const second = await page.evaluate(() => globalThis.runNamebenchSmoke());
  assert.deepEqual(first, second, 'Offline generation must replay identically');
  assert(first.rows.length >= 79);
  assert.equal(first.localized[0], 'Fleuve Tsing Tao');
  assert.equal(first.localized[1], 'Tsing Tao River');
  await page.locator('#map-naming-mode').selectOption('localized');
  await page.locator('#map-naming-language').selectOption('ar');
  assert.deepEqual(await page.evaluate(() => ({ mode:globalThis.namePresentationSettings.naming.mode,language:globalThis.namePresentationSettings.naming.mapLanguage })),{mode:'localized',language:'ar'});
  await page.locator('#map-naming-profile').selectOption('swahili');
  await page.locator('#map-naming-source').selectOption('invented');
  assert.deepEqual(await page.evaluate(()=>({profile:globalThis.namePresentationSettings.naming.profile,source:globalThis.namePresentationSettings.naming.source})),{profile:'swahili',source:'invented'});
  await page.locator('#map-naming-mode').selectOption('cultural');
  assert.equal(await page.evaluate(() => globalThis.namePresentationSettings.naming.mode),'cultural');
  await page.locator('#map-naming-scope').selectOption('city:main');
  await page.locator('#map-naming-profile').selectOption('japanese');
  assert.equal(await page.evaluate(()=>globalThis.namePresentationSettings.naming.local.main.profile),'japanese');
  await page.locator('#map-naming-regenerate').click();
  assert.equal(await page.evaluate(()=>globalThis.namePresentationSettings.naming.variations['city:main']),1);
  const riverSlider=page.locator('[data-slider-path="appearance.composition.text.levels.rivers"]');
  for(const [value,count]of [[0,0],[1,1],[100,20]]){
    await riverSlider.fill(String(value));await riverSlider.dispatchEvent('input');
    assert.equal((await page.evaluate(()=>globalThis.visibleRiverNames())).length,count);
  }
  assert.equal(await page.locator('[data-slider-path*=".text.levels."]').count(),9);
  for(const language of ['en','fr','es','pt','zh','ar','ru','ja']){
    await page.evaluate(language=>globalThis.namingSetLanguage(language),language);
    assert.equal(await page.locator('html').getAttribute('lang'),language);
    assert.equal(await page.locator('[data-setting-path="appearance.composition.text.levels.rivers"]').inputValue(),'100');
  }
  for (const row of first.rows) {
    assert.equal(row.names.length, 6);
    assert(row.names.every(name => typeof name === 'string' && name.trim().length > 0), row.culture);
  }
  assert.equal(requests.length, requestCount, 'Generating names must not request any network resource');
  assert.deepEqual(errors, []);
  Object.assign(result, { ok: true, offline: true, sliders:9,interfaceLanguages:8,scopedProfile:true, ...first });
} catch (error) {
  Object.assign(result, { error: error.stack, errors });
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise(closed => server.close(closed));
  await writeFile(resolve(web, 'out/namebench-browser-check.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ ...result, rows: result.rows?.filter(row => ['bastide','persian','maori-pa','native-pueblo','roman-core'].includes(row.culture)), culturesChecked: result.rows?.length }, null, 2));
}
