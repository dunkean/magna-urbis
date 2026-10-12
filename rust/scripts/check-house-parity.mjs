import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tsImport } from '../../web/node_modules/tsx/dist/esm/api/index.mjs';

const rust = fileURLToPath(new URL('../', import.meta.url));
const out = join(rust, 'out', 'houses-parity');
mkdirSync(out, { recursive: true });
const pkg = process.argv[2] ? resolve(process.argv[2]) : join(rust, 'pkg', 'houses');
const api = await import(pathToFileURL(join(pkg, 'magna_urbis_houses_wasm.js')));
api.initSync({ module: readFileSync(join(pkg, 'magna_urbis_houses_wasm_bg.wasm')) });
const bundle = JSON.parse(api.catalogue_json());
assert.equal(bundle.ok, true, JSON.stringify(bundle.error));
const imported = await tsImport('../bridge/housesContract.ts', import.meta.url);
const { parseHouseBatch } = imported.parseHouseBatch ? imported : imported.default;
execFileSync('cargo', ['build', '-q', '-p', 'magna-urbis-houses', '--example', 'houses'], { cwd: rust, stdio: 'inherit' });
const target = JSON.parse(execFileSync('cargo', ['metadata', '--no-deps', '--format-version', '1'], { cwd: rust, encoding: 'utf8' })).target_directory;
const native = join(out, `houses-${process.pid}${process.platform === 'win32' ? '.exe' : ''}`);
copyFileSync(join(target, 'debug', 'examples', `houses${process.platform === 'win32' ? '.exe' : ''}`), native);
const base = { schema_version: '2', seed: 'étoile 🏠', pack: 'EUR-MED', recipe: null, mode: 'historical_inspired', era: 'any', allow_late: false, count: 1, size: 1, variation: 0.65, wealth: 0.5, orientation_deg: 33, overrides: {} };
const cases = bundle.data.catalogue.packs.map(pack => ({ ...base, pack: pack.id }));
for (const id of ['MED-ANT-B04', 'ATL-CEL-B08', 'AS-JAP-B03', 'AS-CHI-B13', 'AM-PUEB-B03', 'AM-ARC-B03', 'AS-SEA-B01']) {
  const recipe = bundle.data.catalogue.recipes.find(r => r.id === id);
  assert.ok(recipe, id);
  cases.push({ ...base, pack: recipe.pack_id, recipe: id, allow_late: true, variation: 0 });
  for (const variant of recipe.variants) cases.push({ ...base, pack: recipe.pack_id, recipe: id, allow_late: true, variation: 0, overrides: { variant: variant.id } });
}
cases.push({ ...base, seed: '42', count: 10 });
let succeeded = 0;
for (let i = 0; i < cases.length; ++i) {
  const input = join(out, `input-${i}.json`);
  writeFileSync(input, JSON.stringify(cases[i]));
  const wasm = api.generate_houses_json(JSON.stringify(cases[i]));
  const result = JSON.parse(wasm);
  assert.equal(result.ok, true, `${cases[i].pack}/${cases[i].recipe}: ${JSON.stringify(result.error)}`);
  const reference = execFileSync(native, ['--input', input], { cwd: rust, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
  // Compare serialized float values as well as topology and ordering.
  assert.equal(wasm.slice('{"ok":true,"data":'.length, -1), reference, `Native/WASM differ: ${cases[i].pack}/${cases[i].recipe}`);
  parseHouseBatch(reference);
  ++succeeded;
}
console.log(`Parité maisons : ${succeeded} scènes natives/WASM identiques, 32 packs, ensembles, variantes, UTF-8 et lot de dix.`);
