/** Stage the prepared browser profile without rebuilding Rust or consulting ../infinite_map. */
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const safeName = value => typeof value === 'string' && /^[\w.-]+$/.test(value);
export async function stageNeuralPublication(prepared, destination) {
  if (resolve(prepared) === resolve(destination)) throw new Error('Neural publication destination must differ from the prepared package.');
  const manifest = JSON.parse(await readFile(join(prepared, 'models/manifest.json'), 'utf8'));
  const wasm = await readFile(join(prepared, 'magna_urbis_neural_wasm_bg.wasm'));
  if (digest(wasm) !== manifest.runtimeSha256) throw new Error('Prepared neural runtime SHA-256 differs from manifest.runtimeSha256. Run prepare:v2 -- --neural in the main checkout before publication.');
  await mkdir(join(destination, 'models'), { recursive: true });
  await writeFile(join(destination, 'magna_urbis_neural_wasm_bg.wasm'), wasm);
  const javascript = await readFile(join(prepared, 'magna_urbis_neural_wasm.js'));
  manifest.runtimeJsSha256 = digest(javascript);
  await writeFile(join(destination, 'magna_urbis_neural_wasm.js'), javascript);
  for (const name of ['coarse', 'base', 'decoder']) {
    const entry = manifest.models[name];
    if (!entry || !safeName(entry.file)) throw new Error(`Invalid neural model entry: ${name}`);
    const bytes = await readFile(join(prepared, 'models', entry.file));
    if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256) throw new Error(`Prepared neural model integrity failure: ${name}`);
    entry.chunks = [];
    // Decimal 40 MB stays below GitHub's 50 MB warning and 100 MB hard limit.
    for (let offset = 0, part = 0; offset < bytes.length; offset += 40_000_000, part++) {
      const chunk = bytes.subarray(offset, offset + 40_000_000), file = `${entry.file}.part${part}`;
      entry.chunks.push({ file, bytes: chunk.length, sha256: digest(chunk) });
      await writeFile(join(destination, 'models', file), chunk);
    }
    // Also supports staging over a local Vite build, which initially contains full files.
    await unlink(join(destination, 'models', entry.file)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  await writeFile(join(destination, 'models/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
  await copyFile(join(root, 'docs/models-release/LICENSE'), join(destination, 'LICENSE-NEURAL-MODELS.txt'));
  await copyFile(join(root, 'rust/models/neural-earth/LICENSE-TEACHER.txt'), join(destination, 'LICENSE-TEACHER.txt'));
  return manifest;
}
