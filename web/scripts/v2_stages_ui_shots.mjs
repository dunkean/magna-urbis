// Headless screenshots of the V2 staged generation UI (one page, sequential).
// Usage: node web/scripts/v2_stages_ui_shots.mjs [--url http://127.0.0.1:5191/v2.html] [--out web/out/v2-stages-ui] [--only name,name] [--lang en]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : fallback; };
const base = arg('url', 'http://127.0.0.1:5191/v2.html'), out = resolve(root, arg('out', 'web/out/v2-stages-ui')), lang = arg('lang', 'en');
const only = arg('only', '')?.split(',').filter(Boolean);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: lang === 'fr' ? 'fr-FR' : 'en-US' });
const errors = [];
page.on('pageerror', error => errors.push(String(error.stack ?? error)));
page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') errors.push(`${message.type()}: ${message.text()}`); });
await page.goto(`${base}?lang=${lang}`, { waitUntil: 'load' });
await page.waitForSelector('.chain-family-tab', { timeout: 60000 });
await page.waitForTimeout(1200);
const shot = async (name, step) => {
  if (only?.length && !only.includes(name)) return;
  await step(); await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(out, `${name}.png`) }); console.log('shot', name);
};
const family = id => page.click(`#family-tab-${id}`);
const open = async id => { if (await page.getAttribute(`#row-${id} .stage-title`, 'aria-expanded') !== 'true') await page.click(`#row-${id} .stage-title`); };
const generate = async (action, timeout = 240000) => {
  await page.click(action);
  await page.waitForFunction(() => document.querySelector('#progress-card')?.hidden === false, null, { timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelector('#progress-card')?.hidden !== false, null, { timeout });
  await page.waitForTimeout(800);
};

await shot('01-relief-procedural', async () => { await family('region'); await open('relief-source'); await page.evaluate(() => document.querySelector('.chain-scroll')?.scrollTo(0, 0)); });
await shot('02-relief-procedural-generated', async () => { await generate('#generate-region'); await page.click('#row-relief-source .stage-title'); await open('relief-regional'); await page.evaluate(() => document.querySelector('#row-relief-regional')?.scrollIntoView({ block: 'center' })); });
await shot('03-relief-heightmap-source', async () => { await page.evaluate(() => document.querySelector('.chain-scroll')?.scrollTo(0, 0)); await page.click('#source-heightmap'); await page.waitForTimeout(300); await page.click('[data-heightmap="alpine-massif"]'); await page.waitForTimeout(1500); await open('relief-heightmap-fit'); await page.evaluate(() => document.querySelector('#row-relief-source')?.scrollIntoView({ block: 'start' })); });
await shot('03b-relief-heightmap-generated', async () => { await generate('#generate-region'); await page.evaluate(() => document.querySelector('#row-relief-heightmap-fit')?.scrollIntoView({ block: 'start' })); });
await shot('04-settings-backends', async () => { await page.click('#hardware-open'); await page.waitForTimeout(3500); });
await page.keyboard.press('Escape');
await shot('05-city-left-right', async () => {
  await page.click('#source-procedural'); await generate('#generate-region');
  await family('settlements'); await generate('#generate-region');
  await family('settlements');
  const first = await page.$('[data-town]'); if (first) await first.click();
  await page.waitForTimeout(600); await page.click('#fit-map'); await open('city-composition'); await open('city-quarters');
});
await shot('06-display-customisation', async () => { await family('map'); await open('display-buildings'); });
console.log(JSON.stringify(errors.slice(0, 30), null, 1));
await browser.close();
