import { spawn } from 'node:child_process';
import { mkdir, cp, access, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { installZoneRuntime } from './neural_zone_runtime.mjs';

const rust = fileURLToPath(new URL('../../rust/', import.meta.url));
const earth = fileURLToPath(new URL('../../../infinite_map/', import.meta.url));
const output = join(rust, 'pkg/neural-web');
const run = (command, args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true });
  child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Error(`${command}: ${code}`)));
});
await access(join(earth, 'native/neural-earth/Cargo.toml'));
await run(process.execPath, ['tools/wasm/prepare-engine.mjs'], earth);
await installZoneRuntime(earth, rust);
await mkdir(output, { recursive: true });
await run(join(homedir(), '.cargo/bin/wasm-pack' + (process.platform === 'win32' ? '.exe' : '')),
  ['build', 'crates/neural-wasm', '--target', 'web', '--out-dir', '../../pkg/neural-web', '--release', '--no-opt'], rust);
await cp(join(earth, 'wasm/dist/runtime/models'), join(output, 'models'), { recursive: true });
const manifestPath = join(output, 'models/manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.upstreamRuntimeSha256 = manifest.runtimeSha256;
manifest.runtimeSha256 = createHash('sha256').update(await readFile(join(output, 'magna_urbis_neural_wasm_bg.wasm'))).digest('hex');
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Neuronal WASM : ${output}`);
