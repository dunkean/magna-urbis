import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Update an existing model manifest after building the shared WASM runtime. */
export async function updateNeuralManifest(output, { conditioningOnly = false } = {}) {
  const manifestPath = join(output, 'models/manifest.json');
  let contents;
  try { contents = await readFile(manifestPath, 'utf8'); }
  catch (error) {
    if (conditioningOnly && error.code === 'ENOENT') return false;
    throw error;
  }
  const manifest = JSON.parse(contents);
  if (!conditioningOnly) manifest.upstreamRuntimeSha256 = manifest.runtimeSha256;
  manifest.runtimeSha256 = createHash('sha256').update(await readFile(join(output, 'magna_urbis_neural_wasm_bg.wasm'))).digest('hex');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return true;
}
