// Lists visible V2 strings left equal to their source in a given language: node scripts/v2_untranslated_check.mjs fr (needs Vite on :5173).
// Cross it with the 'en' run: a string unchanged in both is untranslated.
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const lang = process.argv[2] ?? 'fr';
try {
  await page.goto(`http://127.0.0.1:5173/v2.html?lang=${lang}`);
  await page.locator('#import-open').waitFor({ state: 'attached' });
  await page.waitForTimeout(2500);
  const left = await page.evaluate(() => {
    const out = new Set();
    for (const el of document.querySelectorAll('[data-i18n]')) { const src = el.getAttribute('data-i18n').trim(); if (/[A-Za-z]{3}/.test(src) && el.textContent.trim() === src && !/^[A-Z0-9 ·/()+-]+$/.test(src)) out.add(src); }
    for (const attr of ['title', 'aria-label', 'placeholder']) for (const el of document.querySelectorAll(`[data-i18n-${attr}]`)) { const src = el.getAttribute(`data-i18n-${attr}`).trim(); if (/[A-Za-z]{3}/.test(src) && el.getAttribute(attr) === src) out.add(src); }
    return [...out];
  });
  console.log(JSON.stringify(left));
} finally { await browser.close(); }
