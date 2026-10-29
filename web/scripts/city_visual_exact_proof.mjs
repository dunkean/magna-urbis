/** Standalone offline preparation evidence, for root's centralized validation.
 * No bench import, browser, fetch, native request, decor decode or server call. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareExactVisualInput } from './city_visual_exact_input.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const manifestPath = resolve(process.argv[2] ?? resolve(root, 'web/out/work/CITY_VISUAL_BENCH_52_PROPOSED.json'));
const rawManifest = await readFile(manifestPath), manifest = JSON.parse(rawManifest.toString('utf8').replace(/^\uFEFF/, ''));
const cases = [];
for (const item of manifest.cases.filter(item => item.exactInput)) {
  const raw = await readFile(resolve(root, item.exactInput.path)), sha256 = createHash('sha256').update(raw).digest('hex');
  if (sha256 !== item.exactInput.sha256) throw new Error(`${item.id}: frozen URL hash mismatch`);
  const prepared = prepareExactVisualInput(item, raw.toString('utf8'));
  cases.push({ id: item.id, inputSha256: sha256, initialQuery: prepared.query.toString(), intendedQuery: prepared.intendedQuery,
    identity: prepared.identity, proof: prepared.proof });
}
process.stdout.write(JSON.stringify({ scope: 'offline source preparation only; no image/UI/runtime proof',
  manifestSha256: createHash('sha256').update(rawManifest).digest('hex'), cases }, null, 2) + '\n');
