/** Explicit maintenance command only. Never imported by UI or auto-run in build.
 * node web/scripts/update_native_admission_periods.mjs [--check]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const sourceUrl = new URL('../../rust/crates/houses/data/urban-admission.json', import.meta.url);
const outputUrl = new URL('../src/data/nativeAdmissionPeriods.json', import.meta.url);
const flags = process.argv.slice(2);
if (flags.some(flag => flag !== '--check') || flags.length > 1) throw new Error('Usage: node web/scripts/update_native_admission_periods.mjs [--check]');
const raw = await readFile(sourceUrl), catalogue = JSON.parse(raw.toString('utf8'));
if (!Array.isArray(catalogue.profiles) || catalogue.schema_version === undefined || typeof catalogue.generator_version !== 'string') throw new Error('Invalid native admission catalogue.');
const periods = new Set();
for (const profile of catalogue.profiles) {
  if (!Array.isArray(profile.eras) || profile.eras.some(era => typeof era !== 'string' || !era.length)) throw new Error('Invalid native profile era list.');
  for (const era of profile.eras) periods.add(era);
}
const projection = { format: 'native-admission-periods-1', source: 'rust/crates/houses/data/urban-admission.json',
  sourceSha256: createHash('sha256').update(raw).digest('hex'), schemaVersion: catalogue.schema_version,
  generatorVersion: catalogue.generator_version, periods: [...periods].sort() };
const text = JSON.stringify(projection, null, 2) + '\n';
if (flags.includes('--check')) {
  if (await readFile(outputUrl, 'utf8') !== text) throw new Error('Native period projection is stale. Run the explicit maintenance command and review the delta.');
  process.stdout.write(`Native periods match ${projection.sourceSha256}\n`);
} else {
  await writeFile(outputUrl, text, 'utf8');
  process.stdout.write(`Updated ${fileURLToPath(outputUrl)} from ${projection.sourceSha256}: ${projection.periods.join(', ')}\n`);
}
