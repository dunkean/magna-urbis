import { spawn } from 'node:child_process';
import { mkdir, cp, access } from 'node:fs/promises';
import { updateNeuralManifest } from './neural_manifest.mjs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { homedir } from 'node:os';

const rust = fileURLToPath(new URL('../../rust/', import.meta.url));
const earth = fileURLToPath(new URL('../../../infinite_map/', import.meta.url));
const output = join(rust, 'pkg/neural-web');
const conditioningOnly = process.argv.slice(2).includes('--conditioning-only');
const run = (command, args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true });
  child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Error(`${command}: ${code}`)));
});
await access(join(earth, 'native/neural-earth/Cargo.toml'));
await run(process.execPath, ['tools/wasm/prepare-engine.mjs'], earth);
await mkdir(output, { recursive: true });
await run(join(homedir(), '.cargo/bin/wasm-pack' + (process.platform === 'win32' ? '.exe' : '')),
  ['build', 'crates/neural-wasm', '--target', 'web', '--out-dir', '../../pkg/neural-web', '--release', '--no-opt'], rust);
if (!conditioningOnly) {
  await cp(join(earth, 'wasm/dist/runtime/models'), join(output, 'models'), { recursive: true });
}
await updateNeuralManifest(output, { conditioningOnly });
console.log(`${conditioningOnly ? 'Conditionnement neuronal WASM (sans poids)' : 'Neuronal WASM'} : ${output}`);
