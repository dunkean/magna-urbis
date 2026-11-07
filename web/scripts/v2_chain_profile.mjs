// End-to-end V2 stage profile: runs the whole chain once on the default map and prints the
// time of every stage row, the job log tail and the long main-thread tasks.
// From web/: node scripts/v2_chain_profile.mjs [origin=http://127.0.0.1:5173] [out.json] [query]
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const origin = process.argv[2] ?? 'http://127.0.0.1:5173';
const out = process.argv[3] ?? 'out/v2-chain-profile/run.json';
const query = process.argv[4] ?? '';
mkdirSync(dirname(out), { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage(); page.setDefaultTimeout(600000);
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', r => errors.push(`requestfailed: ${r.method()} ${r.url()} ${r.failure()?.errorText}`));
context.on('requestfailed', r => { if (!r.frame?.()) errors.push(`worker requestfailed: ${r.method()} ${r.url()} ${r.failure()?.errorText}`); });
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });
await page.addInitScript(() => {
  window.__long = [];
  try { new PerformanceObserver(list => { for (const e of list.getEntries()) window.__long.push({ at: Math.round(e.startTime), ms: Math.round(e.duration) }); }).observe({ type: 'longtask', buffered: true }); } catch {}
});
await page.goto(`${origin}/v2.html?lang=en${query ? '&' + query : ''}`, { waitUntil: 'commit' });
await page.locator('#run-chain').waitFor();
await page.waitForTimeout(1500);
// Optional recipe through the UI: RECIPE="extentPreset,count" (preset in metres: 2400|10000|40000).
if (process.env.RECIPE) {
  const [extent, count] = process.env.RECIPE.split(',').map(Number);
  await page.evaluate(([extent, count]) => {
    document.querySelector(`[data-extent="${extent}"]`)?.click();
    const c = document.querySelector('#town-count'); c.value = String(count); c.dispatchEvent(new Event('change', { bubbles: true }));
  }, [extent, count]);
  await page.waitForTimeout(800);
  console.log('recipe', process.env.RECIPE, await page.locator('#extent-hint').textContent());
}
// TRACE=<file>: whole-browser trace with the V8 sampling profiler (main thread and workers).
if (process.env.TRACE) await browser.startTracing(page, { path: process.env.TRACE, categories: ['disabled-by-default-v8.cpu_profiler', 'v8', 'devtools.timeline', 'disabled-by-default-devtools.timeline'] });
const t0 = Date.now();
await page.locator('#run-chain').click();
await page.waitForTimeout(1500);
await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false', null, { timeout: 900000 });
const wall = Date.now() - t0;
await page.waitForTimeout(3000);
if (process.env.TRACE) await browser.stopTracing();
// SHOT=<png>: the final map canvas, for before/after pixel diffs.
if (process.env.SHOT) await page.locator('#map').screenshot({ path: process.env.SHOT }).catch(async () => page.screenshot({ path: process.env.SHOT }));
const result = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[id^="row-"]')].map(r => ({ id: r.id.slice(4), hidden: r.hidden, time: r.querySelector('.stage-time')?.textContent?.trim() }))
    .filter(r => !r.hidden);
  const families = [...document.querySelectorAll('.chain-family-time')].map(e => e.textContent);
  return { rows, families, footer: document.querySelector('#footer-status')?.textContent, log: (document.querySelector('#job-log')?.textContent ?? ''), long: window.__long.filter(l => l.ms > 200) };
});
const report = { origin, query, wall, ...result, errors };
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`wall ${wall} ms · ${report.footer}`);
for (const r of report.rows) console.log(`${r.id.padEnd(24)} ${r.time}`);
console.log('families', report.families.join(' | '));
console.log('long tasks >200ms:', report.long.length, 'sum', report.long.reduce((s, l) => s + l.ms, 0), 'max', Math.max(0, ...report.long.map(l => l.ms)));
if (errors.length) console.log('errors', errors.slice(0, 8));
await browser.close();
