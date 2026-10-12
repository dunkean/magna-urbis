import { existsSync, watch } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rustDir = fileURLToPath(new URL('..', import.meta.url));
const webDir = resolve(rustDir, '../web');
const cargoBin = join(homedir(), '.cargo', 'bin');
const env = {
  ...process.env,
  PATH: cargoBin + delimiter + (process.env.PATH ?? ''),
  CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR ?? join(rustDir, 'out/target-houses'),
};
const windows = process.platform === 'win32';
const executable = name => {
  const local = join(cargoBin, name + (windows ? '.exe' : ''));
  return existsSync(local) ? local : name;
};
function run(command, args, cwd = rustDir) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`${command} exited with ${code}`)));
  });
}
const wasm = release => run(executable('wasm-pack'), ['build', 'crates/houses-wasm', '--target', 'web', '--out-dir', '../../pkg/houses', release ? '--release' : '--dev', '--no-opt']);
const vite = (...args) => run(process.execPath, [join(webDir, 'node_modules/vite/bin/vite.js'), ...args], webDir);

async function main() {
  const action = process.argv[2] ?? 'dev';
  if (action === 'wasm') return wasm(false);
  if (action === 'build') {
    await wasm(true);
    await vite('build', '--mode', 'housebench');
    console.log(`Banc maisons autonome : ${join(rustDir, 'out/houses/housebench.html')}`);
    return;
  }
  if (action === 'check') {
    const packages = ['-p', 'magna-urbis-houses', '-p', 'magna-urbis-houses-wasm', '-p', 'magna-urbis-random'];
    await run(executable('cargo'), ['fmt', ...packages, '--', '--check']);
    await run(executable('cargo'), ['clippy', ...packages, '--all-targets', '--', '-D', 'warnings']);
    await run(executable('cargo'), ['check', ...packages, '--target', 'wasm32-unknown-unknown']);
    await run(executable('cargo'), ['test', '-p', 'magna-urbis-houses', '-p', 'magna-urbis-random']);
    // The native fixture checker is supplied beside the engine.
    const contractCheck = join(rustDir, 'scripts/check-house-contract.mjs');
    if (!existsSync(contractCheck)) throw new Error('Vérification du contrat maisons manquante : rust/scripts/check-house-contract.mjs');
    await run(process.execPath, [contractCheck]);
    return;
  }
  if (action !== 'dev') throw new Error('Usage: houses.mjs dev|wasm|build|check');
  await wasm(false);
  let timer, building = false, pending = false;
  async function rebuild() {
    if (building) { pending = true; return; }
    building = true;
    try { await wasm(false); } catch (error) { console.error(error.message); }
    finally { building = false; if (pending) { pending = false; void rebuild(); } }
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => void rebuild(), 250); };
  const crates = watch(join(rustDir, 'crates'), {recursive: true}, (_event, file) => {
    if (file && /^(houses|houses-wasm|random)[\\/]/.test(String(file)) && /\.(rs|toml|json)$/.test(String(file))) schedule();
  });
  const manifest = watch(join(rustDir, 'Cargo.toml'), schedule);
  console.log('Banc maisons : http://localhost:5173/housebench.html · reconstruction Rust automatique');
  try { await vite('--mode', 'housebench', '--host', '127.0.0.1', ...process.argv.slice(3)); }
  finally { clearTimeout(timer); crates.close(); manifest.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
