import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tsImport } from '../../web/node_modules/tsx/dist/esm/api/index.mjs';

const rust = fileURLToPath(new URL('../', import.meta.url));
const fixture = readFileSync(new URL('../fixtures/houses/batch-reference.json', import.meta.url), 'utf8');
const replay = execFileSync('cargo', ['run', '-q', '-p', 'magna-urbis-houses', '--example', 'houses', '--', '--input', 'fixtures/houses/config-reference.json'], { cwd: rust, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (replay !== fixture) throw new Error('Le lot natif diverge de la référence versionnée. Examiner le changement de géométrie avant de la régénérer.');
const imported = await tsImport('../bridge/housesContract.ts', import.meta.url);
const { parseHouseBatch } = imported.parseHouseBatch ? imported : imported.default;
const batch = parseHouseBatch(replay);
if (batch.settings.seed !== 'étoile 🏠' || batch.units.length !== 1) throw new Error('Contrat UTF-8 ou lot de référence invalide.');
for (const value of ['null', '{"schema_version":"1"}', replay.replace(/"orientation_deg":0/, '"orientation_deg":null')]) {
  let rejected = false;
  try { parseHouseBatch(value); } catch { rejected = true; }
  if (!rejected) throw new Error('Le validateur accepte une version ou un nombre invalide.');
}
console.log('Contrat maisons : référence native déterministe, validateur TS et rejets vérifiés.');
