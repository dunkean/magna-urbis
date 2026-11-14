// Builds the documentation pages from src/: atlas (index.html, fr.html) and catalogue (EN, FR).
// Usage: node docs/scientific/src/build.mjs [--only atlas|catalogue]
import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { page, PAGES } from './shell.mjs';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const UPDATED = { en: 'Updated on 14 November 2026.', fr: 'Mis à jour le 14 novembre 2026.' };

for (const name of ['atlas', 'catalogue']) {
  if (only && only !== name) continue;
  const mod = await import(`./${name}.mjs`);
  for (const lang of ['en', 'fr']) {
    const p = await mod.render(lang);
    await writeFile(resolve(dir, PAGES[name][lang]), page({ lang, page: name, updated: UPDATED[lang], ...p }));
  }
  console.log(`${name}: ${PAGES[name].en}, ${PAGES[name].fr}`);
}
