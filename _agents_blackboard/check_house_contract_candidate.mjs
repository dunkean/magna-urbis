// Validate one already-produced native candidate; never launch Cargo or a CLI.
import { readFileSync, writeFileSync } from 'node:fs';
import { tsImport } from '../web/node_modules/tsx/dist/esm/api/index.mjs';
const path = process.argv[2];
if (!path) throw new Error('Provide the separate native candidate JSON path.');
const wire = readFileSync(path, 'utf8');
const imported = await tsImport('../rust/bridge/housesContract.ts', import.meta.url);
const { parseHouseBatch, HOUSE_GENERATOR } = imported.parseHouseBatch ? imported : imported.default;
const batch = parseHouseBatch(wire);
if (batch.settings.seed !== 'étoile 🏠' || batch.units.length !== 1)
  throw new Error('UTF-8 seed or reference unit count changed.');
if (batch.generator_version !== HOUSE_GENERATOR || HOUSE_GENERATOR !== 'houses-3')
  throw new Error('The supplied candidate is not the current houses-3 output.');
const invalid = JSON.parse(wire); invalid.settings.orientation_deg = null;
for (const value of ['null', '{"schema_version":"1"}', JSON.stringify(invalid)]) {
  let rejected = false;
  try { parseHouseBatch(value); } catch { rejected = true; }
  if (!rejected) throw new Error('TS validator accepted an invalid batch/schema/number.');
}
const report = { status: 'passed', generator: batch.generator_version,
  catalogue: batch.catalogue_version, units: batch.units.length,
  utf8Seed: batch.settings.seed, invalidCasesRejected: 3, nativeCalls: 0, canonicalWritten: false };
writeFileSync(new URL('./house-contract-v3-proof/ts-contract.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
