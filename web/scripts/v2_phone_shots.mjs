// Screenshots and layout facts of the V2 page on an emulated phone (portrait, landscape) and on a desktop control,
// one page at a time on the RTX 5090. It checks layout and wiring; it does not measure a phone's speed or memory.
// Usage: node web/scripts/v2_phone_shots.mjs [--url http://127.0.0.1:5174/v2.html] [--out web/out/phone-shots] [--only portrait,landscape,desktop] [--lang en]
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchWebGpuChrome } from './webgpu_headless.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const base = arg('url', 'http://127.0.0.1:5174/v2.html'),
  out = resolve(root, arg('out', 'web/out/phone-shots')),
  lang = arg('lang', 'en'),
  only = arg('only', '')?.split(',').filter(Boolean);
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 13; 2201116SG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36';
const PROFILES = [
  { name: 'portrait', phone: true, context: { viewport: { width: 393, height: 851 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true, userAgent: PHONE_UA } },
  { name: 'landscape', phone: true, context: { viewport: { width: 851, height: 393 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true, userAgent: PHONE_UA } },
  { name: 'desktop', phone: false, context: { viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 } },
].filter(profile => !only?.length || only.includes(profile.name));
mkdirSync(out, { recursive: true });

/** Layout facts read in the page: device class, overflow, visibility of the phone-only nodes, live canvas density, level. */
const facts = () => {
  const shown = selector => {
    const node = document.querySelector(selector);
    if (!node) return 'absent';
    const box = node.getBoundingClientRect();
    return getComputedStyle(node).display === 'none' || node.hidden ? 'hidden' : `${Math.round(box.left)},${Math.round(box.top)} ${Math.round(box.width)}x${Math.round(box.height)}`;
  };
  const map = document.querySelector('.map-area')?.getBoundingClientRect();
  return {
    viewport: `${innerWidth}x${innerHeight}@${devicePixelRatio}`,
    coarse: matchMedia('(pointer: coarse)').matches,
    hoverNone: matchMedia('(hover: none)').matches,
    compact: matchMedia('(max-width: 720px), (pointer: coarse) and (max-height: 500px)').matches,
    overflowX: document.documentElement.scrollWidth - innerWidth,
    mapShare: map ? Math.round((100 * map.width * map.height) / (innerWidth * innerHeight)) : 0,
    busy: document.querySelector('#app')?.getAttribute('aria-busy'),
    nodes: Object.fromEntries(['#phone-more', '#phone-display-open', '#workshop-close', '.phone-first-run', '#mobile-toggle', '#sidebar', '#places-panel', '#minimap', '#machine-notice', '#browserAdvice', '#desktop-download'].map(s => [s, shown(s)])),
    canvases: [...document.querySelectorAll('.canvas-wrap canvas, #map canvas')].map(c => `${c.id || c.className || 'canvas'} ${c.width}x${c.height} css ${c.clientWidth}x${c.clientHeight}`),
    performance: document.querySelector('#settings-performance option[value="auto"]')?.textContent ?? null,
    smallInputs: [...document.querySelectorAll('#app input:not([type=checkbox]):not([type=radio]):not([type=range]), #app select, #app textarea')].filter(n => n.offsetParent && parseFloat(getComputedStyle(n).fontSize) < 16).length,
  };
};

const report = {};
let browser;
try {
  browser = await launchWebGpuChrome();
  for (const profile of PROFILES) {
    const context = await browser.newContext({ ...profile.context, locale: lang === 'fr' ? 'fr-FR' : 'en-US' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error.stack ?? error).slice(0, 400)));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(`console: ${message.text().slice(0, 300)}`);
    });
    const log = (report[profile.name] = { errors, steps: {} });
    const shot = async name => {
      await page.waitForTimeout(600);
      await page.screenshot({ path: resolve(out, `${profile.name}-${name}.png`) });
      log.steps[name] = await page.evaluate(facts);
      console.log(profile.name, name, JSON.stringify(log.steps[name].nodes));
    };
    const tap = async selector => (profile.phone ? page.tap(selector, { timeout: 8000 }) : page.click(selector, { timeout: 8000 }));
    const step = async (name, action) => {
      try {
        await action();
        await shot(name);
      } catch (error) {
        errors.push(`step ${name}: ${String(error).slice(0, 300)}`);
        console.log(profile.name, name, 'FAILED', String(error).slice(0, 200));
      }
    };
    try {
      await page.goto(`${base}?lang=${lang}`, { waitUntil: 'load' });
      // A published site reloads once on the first visit (its service worker installs cross-origin isolation): wait again.
      const ready = () => page.waitForFunction(() => !document.getElementById('boot-splash') && !!document.querySelector('#run-chain'), null, { timeout: 120000 });
      await ready().catch(() => page.waitForLoadState('load').then(ready));
      await page.waitForTimeout(2500);
      await shot('01-first-load');
      if (profile.phone) {
        await step('02-workshop', () => tap('#mobile-toggle'));
        await step('03-workshop-closed', () => tap('#workshop-close'));
        await step('04-display', () => tap('#phone-display-open'));
        await step('05-display-closed', () => tap('#phone-display-close'));
        await step('06-more', () => tap('#phone-more'));
        await page.keyboard.press('Escape');
        await step('07-settings', () => tap('#hardware-open'));
        await page.keyboard.press('Escape');
      } else await step('07-settings', () => tap('#hardware-open')).then(() => page.keyboard.press('Escape'));
      await step('08-generating', async () => {
        await tap(profile.phone ? '#phone-generate' : '#run-chain');
        await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'true', null, { timeout: 30000 });
        await page.waitForTimeout(2500);
      });
      await step('09-generated', async () => {
        await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') !== 'true', null, { timeout: 420000 });
        await page.waitForTimeout(6000);
      });
      if (profile.phone) {
        await step('10-workshop-generated', () => tap('#mobile-toggle'));
        await step('11-cities-tab', () => tap('#family-tab-cities'));
        await step('12-map-again', () => tap('#workshop-close'));
        await step('13-places', () => tap('#places-title'));
        await step('14-display-generated', async () => {
          await tap('#places-title');
          await tap('#phone-display-open');
        });
        await tap('#phone-display-close').catch(() => {});
      }
      await step('15-tilted', async () => {
        await tap('#view3d');
        await page.waitForTimeout(6000);
      });
    } catch (error) {
      errors.push(`fatal: ${String(error).slice(0, 400)}`);
      await page.screenshot({ path: resolve(out, `${profile.name}-failure.png`) }).catch(() => {});
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  for (const [name, log] of Object.entries(report)) console.log(name, 'errors:', log.errors.length, log.errors.slice(0, 6));
}
