// Checks the built documentation: every stage of the V2 registry has a card in both atlas pages
// (the V2 "?" links target them), pages are fresh, and every referenced local file exists.
// Usage: node docs/scientific/check.mjs
import { readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url)), root = resolve(dir, '../..');
const registry = await readFile(resolve(root, 'web/src/v2/stageRegistry.ts'), 'utf8');
const ids = [...registry.matchAll(/\bid:\s*'([a-z0-9-]+)',\s*family:\s*'/g)].map(m => m[1]);
if (!ids.length) throw new Error('No V2 stage IDs found in the registry');
const pages = ['index.html', 'fr.html', 'catalogue-architecture.html', 'catalogue-architecture-fr.html'];
// A Windows checkout and generated fragments may use different line endings.
const readPage = async p => (await readFile(resolve(dir, p), 'utf8')).replace(/\r\n/g, '\n');
const before = Object.fromEntries(await Promise.all(pages.map(async p => [p, await readPage(p)])));
execFileSync(process.execPath, [resolve(dir, 'src/build.mjs')], { stdio: 'ignore' });
const problems = [];
for (const p of pages) {
  const html = await readPage(p);
  if (html !== before[p]) problems.push(`${p} was stale (rebuilt now, commit it)`);
  if (p === 'index.html' || p === 'fr.html') for (const id of ids) if (!html.includes(`id="stage-${id}"`)) problems.push(`${p}: no card for stage ${id}`);
  for (const [, ref] of html.matchAll(/(?:src|href)="((?:assets\/|[\w-]+\.(?:html|css|js))[^"#?]*)/g)) {
    try { await access(resolve(dir, ref)); } catch { problems.push(`${p}: missing ${ref}`); }
  }
}
if (problems.length) { console.error([...new Set(problems)].join('\n')); process.exit(1); }
console.log(`Documentation OK: ${ids.length} stages, ${pages.length} pages.`);
