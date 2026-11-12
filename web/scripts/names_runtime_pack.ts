// Writes src/gen/names/data/names-pack-runtime.json: the names pack restricted to the countries a
// toponym profile can reach (7.6 MB -> ~1 MB). Every bundle that names features (page, engine worker,
// road worker) parsed the whole 253-country corpus at load. tests/toponyms.test.ts checks it stays in sync.
//   From web/: npx tsx scripts/names_runtime_pack.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { PROFILE_COUNTRIES } from '../src/gen/names/profiles';

const dir = new URL('../src/gen/names/data/', import.meta.url);
const pack = JSON.parse(readFileSync(new URL('names-pack.json', dir), 'utf8'));
const runtime = { ...pack, countries: Object.fromEntries(PROFILE_COUNTRIES.map(id => [id, pack.countries[id]])) };
writeFileSync(new URL('names-pack-runtime.json', dir), JSON.stringify(runtime));
console.log(`names-pack-runtime.json: ${PROFILE_COUNTRIES.join(', ')}`);
