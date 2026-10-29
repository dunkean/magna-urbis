// V2 app default-flow screenshots for the bench matrix (web/out/bench-matrix/v2/).
// Called by bench_matrix.mjs with a headless browser and the origin of a Vite server serving v2.html.
// Each shot is best effort: a failing step is recorded in v2/report.json and the next shot still runs.
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

export async function runV2Screens(browser, origin, dir, { limit = 300000 } = {}) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage(); page.setDefaultTimeout(Math.min(limit, 120000));
  const report = { shots: [], errors: [], city: null };
  page.on('pageerror', e => report.errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(`console: ${m.text().slice(0, 300)}`); });
  const shot = async (name, step) => {
    const entry = { name, file: `${name}.png`, ok: true };
    try { await step?.(); await page.waitForTimeout(600); } catch (error) { entry.ok = false; entry.error = String(error.message ?? error).split('\n')[0]; }
    try { await page.screenshot({ path: resolve(dir, entry.file) }); } catch { entry.ok = false; }
    report.shots.push(entry); console.log(`v2 ${name}: ${entry.ok ? 'ok' : entry.error}`);
  };
  const tab = family => page.locator(`#family-tab-${family}`).click();
  const expand = id => page.evaluate(stage => { const t = document.querySelector(`#row-${stage} .stage-title`); if (t && t.getAttribute('aria-expanded') !== 'true') t.click(); }, id);
  await page.goto(`${origin}/v2.html?lang=en`, { waitUntil: 'commit' });
  await page.locator('#app').waitFor();
  await page.locator('#run-chain').waitFor();

  await shot('01-relief-procedural-expanded', async () => { await tab('relief'); await page.locator('#source-procedural').click(); await expand('relief-source'); });
  await shot('02-relief-heightmap-source', async () => { await page.locator('#source-heightmap').click(); await expand('relief-source'); });
  await page.locator('#source-procedural').click().catch(() => {});
  await shot('03-settings-backends', async () => {
    await page.locator('#hardware-open').click();
    await page.locator('#hardware-dialog[open]').waitFor();
    await page.locator('#settings-endpoints-box summary').click().catch(() => {});
  });
  await page.keyboard.press('Escape'); await page.evaluate(() => document.querySelector('#hardware-dialog')?.close?.());

  // The city needs a map: run the whole chain once (small default map) and wait for the app to be idle.
  const started = Date.now();
  await shot('04-chain-running', async () => { await page.locator('#run-chain').click(); await page.waitForTimeout(4000); });
  try {
    await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false', null, { timeout: limit });
    report.city = { ok: true, ms: Date.now() - started, status: await page.locator('#footer-status').textContent() };
  } catch (error) {
    report.city = { ok: false, ms: Date.now() - started, error: String(error.message).split('\n')[0], status: await page.locator('#footer-status').textContent().catch(() => ''), log: (await page.locator('#job-log').textContent().catch(() => '')).slice(-800) };
  }
  await shot('05-city-generation-and-places', async () => { await tab('city'); await page.locator('#places-panel').scrollIntoViewIfNeeded().catch(() => {}); });
  await shot('06-display-customisation', async () => { await tab('display'); await expand('display-terrain'); });
  writeFileSync(resolve(dir, 'report.json'), JSON.stringify(report, null, 2));
  await context.close();
  return report;
}
