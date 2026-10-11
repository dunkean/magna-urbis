import { existsSync, watch } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rustDir = fileURLToPath(new URL('..', import.meta.url));
const webDir = resolve(rustDir, '../web');
const cargoBin = join(homedir(), '.cargo', 'bin');
const env = { ...process.env, PATH: cargoBin + delimiter + (process.env.PATH ?? '') };
const action = process.argv[2] ?? 'dev';
const windows = process.platform === 'win32';
const executable = name => {
  const local = join(cargoBin, name + (windows ? '.exe' : ''));
  return existsSync(local) ? local : name;
};

function run(command, args, cwd = rustDir) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit', windowsHide: true });
    child.once('error', error => reject(new Error(`${command}: ${error.message}`)));
    child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`${command} exited with ${code}`)));
  });
}

const wasm = release => run(executable('wasm-pack'), [
  'build', 'crates/wasm', '--target', 'web', '--out-dir', '../../pkg/wasm',
  release ? '--release' : '--dev', '--no-opt',
]);
const vite = (...args) => run(process.execPath, [join(webDir, 'node_modules/vite/bin/vite.js'), ...args], webDir);

// Native neural relief service (pure Rust, Vulkan/DX12/Metal through wgpu).
async function neural() {
  const neuralArgs = ['run', '--release', '-p', 'magna-urbis-neural', '--bin', 'neural', '--'];
  const weights = process.env.MAGNA_NEURAL_WEIGHTS ?? join(rustDir, 'pkg/neural-weights');
  if (!['coarse', 'base', 'decoder'].every(name => existsSync(join(weights, `${name}.safetensors`)))) {
    console.log('Préparation des poids neuronaux (une fois) depuis Infinite Map et le cache Terrain Diffusion…');
    await run(executable('cargo'), [...neuralArgs, 'export', '--out', weights]);
  }
  await run(executable('cargo'), [...neuralArgs, 'serve', '--weights', weights, ...process.argv.slice(3)]);
}

async function main() {
  if (action === 'wasm') return wasm(false);
  if (action === 'neural') return neural();
  if (action === 'check') {
    await run(executable('cargo'), ['fmt', '--all', '--', '--check']);
    await run(executable('cargo'), ['clippy', '--workspace', '--all-targets', '--', '-D', 'warnings']);
    await run(executable('cargo'), ['check', '--workspace', '--target', 'wasm32-unknown-unknown']);
    return;
  }
  if (action === 'build') {
    await wasm(true);
    await vite('build', '--mode', 'terrainbench');
    await vite('build', '--mode', 'neuralbench');
    console.log(`Terrain bench: ${join(rustDir, 'out/browser/terrainbench.html')}`);
    console.log(`Neural bench: ${join(rustDir, 'out/browser/neuralbench.html')}`);
    return;
  }
  if (action !== 'dev') throw new Error('Usage: terrain.mjs dev|wasm|build|check|neural');
  await wasm(false);
  let timer, building = false, pending = false;
  async function rebuild() {
    if (building) { pending = true; return; }
    building = true;
    try { await wasm(false); }
    catch (error) { console.error(error.message); }
    finally {
      building = false;
      if (pending) { pending = false; void rebuild(); }
    }
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => void rebuild(), 250); };
  const crateWatch = watch(join(rustDir, 'crates'), { recursive: true }, (_event, file) => {
    // The native neural crates are not part of the bench's WASM package.
    if (file && /\.(rs|toml)$/.test(String(file)) && !/^neural/.test(String(file))) schedule();
  });
  const manifestWatch = watch(join(rustDir, 'Cargo.toml'), schedule);
  console.log('Terrain bench: http://localhost:5173/terrainbench.html · Neural bench: http://localhost:5173/neuralbench.html · Rust auto-rebuild enabled');
  try { await vite('--mode', 'terrainbench', '--host', '127.0.0.1'); }
  finally { clearTimeout(timer); crateWatch.close(); manifestWatch.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
