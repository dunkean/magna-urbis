/** V2 launch/build entry. All outputs are isolated from the V1 application. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, copyFile, cp, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('..', import.meta.url));
const root = resolve(web, '..'), rust = join(root, 'rust'), desktop = join(rust, 'desktop-v2');
const windows = process.platform === 'win32';
const cargoDir = join(homedir(), '.cargo/bin');
const cargo = existsSync(join(cargoDir, windows ? 'cargo.exe' : 'cargo')) ? join(cargoDir, windows ? 'cargo.exe' : 'cargo') : 'cargo';
const env = { ...process.env, PATH: cargoDir + delimiter + (process.env.PATH ?? '') };
const flags = process.argv.slice(2), action = flags.find(arg => !arg.startsWith('--')) ?? 'dev';
const children = new Set();
let stopping = false;

function start(command, args, cwd = web, capture = false) {
  const child = spawn(command, args, { cwd, env, windowsHide: true, detached: !windows, stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'] });
  children.add(child);
  let output = '';
  child.stdout?.on('data', data => { output += data; });
  const done = new Promise((resolveDone, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      children.delete(child);
      code === 0 || stopping ? resolveDone(output) : reject(new Error(`${command} : ${signal ?? code}`));
    });
  });
  void done.catch(() => {});
  return { child, done };
}
const run = (command, args, cwd = web) => start(command, args, cwd).done;
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));

function requireWasm() {
  const missing = ['wasm/magna_urbis_wasm.js', 'wasm/magna_urbis_wasm_bg.wasm', 'houses/magna_urbis_houses_wasm.js', 'houses/magna_urbis_houses_wasm_bg.wasm']
    .filter(file => !existsSync(join(rust, 'pkg', file)));
  if (missing.length) throw new Error(`Packages WASM absents : ${missing.join(', ')}. Depuis web/, lancez npm run prepare:v2 (Rust et wasm-pack requis), puis relancez cette commande. Les sorties rust/pkg sont générées et ne sont pas suivies par Git.`);
}

async function prepare() {
  const wasmPack = existsSync(join(cargoDir, windows ? 'wasm-pack.exe' : 'wasm-pack')) ? join(cargoDir, windows ? 'wasm-pack.exe' : 'wasm-pack') : 'wasm-pack';
  try { await start(wasmPack, ['--version'], rust, true).done; }
  catch { throw new Error('wasm-pack est requis. Installez Rust/rustup puis exécutez cargo install wasm-pack --locked; la toolchain et la cible wasm32 sont définies dans rust/rust-toolchain.toml.'); }
  for (const [crate, output] of [['wasm', 'wasm'], ['houses-wasm', 'houses']]) {
    console.log(`Préparation V2 · Rust ${crate} → WASM release (${output})…`);
    await run(wasmPack, ['build', `crates/${crate}`, '--target', 'web', '--out-dir', `../../pkg/${output}`, '--release', '--no-opt'], rust);
  }
  requireWasm();
  if (flags.includes('--neural')) {
    const earth = resolve(root, '../infinite_map');
    if (!existsSync(join(earth, 'native/neural-earth/Cargo.toml')) || !existsSync(join(earth, 'tools/wasm/prepare-engine.mjs'))) {
      throw new Error(`Le neuronal navigateur exige le checkout Neural Earth complet à ${earth}, avec ses sous-modules initialisés. La préparation CPU/WebGPU procédurale est terminée. Consultez rust/desktop-v2/README.md, puis relancez npm run prepare:v2 -- --neural.`);
    }
    console.log('Préparation V2 · runtime neuronal et modèles navigateur (téléchargement externe)…');
    await run(process.execPath, [join(web, 'scripts/neural_wasm.mjs')]);
  } else {
    console.log('WASM V2 prêt : procédural CPU/WebGPU, villes et maisons. Neuronal facultatif : npm run prepare:v2 -- --neural (checkout ../infinite_map et modèles externes requis).');
  }
}

async function stop() {
  if (stopping) return;
  stopping = true;
  await Promise.all([...children].map(child => new Promise(resolveStop => {
    const timer = setTimeout(resolveStop, 3000); timer.unref();
    child.once('exit', () => { clearTimeout(timer); resolveStop(); });
    if (windows) {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      killer.once('error', () => child.kill());
    } else { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); } }
  })));
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void stop().then(() => process.exit(signal === 'SIGINT' ? 130 : 143)); });

async function status(url) {
  try { const response = await fetch(url, { signal: AbortSignal.timeout(1500) }); return response.ok ? response : null; }
  catch { return null; }
}
async function ready(url, service, check = () => true) {
  for (let i = 0; i < 240; i++) {
    if (service.child.exitCode !== null || service.child.signalCode !== null) { await service.done; throw new Error(`Service arrêté avant disponibilité : ${url}`); }
    const response = await status(url);
    if (response && await check(response)) return;
    await sleep(250);
  }
  throw new Error(`Service indisponible : ${url}`);
}
function localAddress() {
  const url = new URL(process.env.MAGNA_LOCAL_SERVER ?? 'http://127.0.0.1:8791');
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Error('MAGNA_LOCAL_SERVER doit être une adresse HTTP loopback.');
  return url;
}
async function nativeBinary() {
  if (!flags.includes('--no-build')) await run(cargo, ['build', '--release', '-p', 'magna-urbis-local'], rust);
  const metadata = JSON.parse(await start(cargo, ['metadata', '--format-version', '1', '--no-deps'], rust, true).done);
  const path = process.env.MAGNA_LOCAL_BIN ?? join(metadata.target_directory, 'release', `magna-urbis-local${windows ? '.exe' : ''}`);
  if (!existsSync(path)) throw new Error(`Moteur absent : ${path}`);
  return path;
}
async function native() {
  const server = localAddress(), current = await status(new URL('/status', server));
  if (current) {
    const data = await current.json();
    if (data.service !== 'magna-urbis-local' || data.backend !== 'rust-native') throw new Error(`Un autre service utilise ${server.origin}.`);
    return null;
  }
  const service = start(await nativeBinary(), ['--port', server.port || '80'], rust);
  await ready(new URL('/status', server), service, async response => (await response.json()).backend === 'rust-native');
  return service;
}
async function python() {
  if (flags.includes('--no-neural')) return null;
  const current = await status('http://127.0.0.1:8793/status');
  if (current) {
    if ((await current.json()).backend !== 'python-cuda') throw new Error('Un autre service utilise le port neuronal 8793.');
    return null;
  }
  const earth = process.env.MAGNA_NEURAL_EARTH ?? resolve(root, '../infinite_map');
  const interpreter = process.env.MAGNA_NEURAL_PYTHON ?? join(earth, windows ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  if (!existsSync(interpreter)) { console.log('Python/CUDA optionnel absent · les moteurs procéduraux CPU et WebGPU restent disponibles.'); return null; }
  const service = start(interpreter, ['-u', join(web, 'scripts/neural_python.py')]);
  try { await ready('http://127.0.0.1:8793/status', service, async response => (await response.json()).backend === 'python-cuda'); return service; }
  catch (error) { console.log(`Python/CUDA optionnel indisponible : ${error.message}`); return null; }
}
async function vite() {
  if (await status('http://127.0.0.1:5174/v2.html')) throw new Error('Le port V2 5174 est déjà utilisé. Réutilisez son URL ou arrêtez le service existant.');
  const service = start(process.execPath, [join(web, 'node_modules/vite/bin/vite.js'), '--config', join(web, 'vite.v2.config.ts')]);
  await ready('http://127.0.0.1:5174/v2.html', service);
  return service;
}
const buildWeb = () => { requireWasm(); return run(process.execPath, [join(web, 'node_modules/vite/bin/vite.js'), 'build', '--config', join(web, 'vite.v2.config.ts')]); };
async function tauri(args) {
  if (!process.env.npm_execpath) throw new Error('Lancez la commande desktop via npm run app:v2:dev ou npm run app:v2:build.');
  return run(process.execPath, [process.env.npm_execpath, 'exec', '--yes', '--package=@tauri-apps/cli@^2', '--', 'tauri', ...args], desktop);
}
async function resources() {
  const dir = join(desktop, 'resources'); await mkdir(join(dir, 'web/scripts'), { recursive: true });
  const engine = join(dir, `magna-urbis-local${windows ? '.exe' : ''}`);
  await copyFile(await nativeBinary(), engine);
  if (!windows) await chmod(engine, 0o755);
  await cp(join(root, 'illustration'), join(dir, 'illustration'), { recursive: true,
    filter: source => !source.includes('__pycache__') && !source.endsWith('.pyc') && !source.includes('tests') && !source.includes('output') });
  for (const name of ['neural_python.py', 'neural_model_catalog.py', 'neural_refinement.py']) await copyFile(join(web, 'scripts', name), join(dir, 'web/scripts', name));
  if (existsSync(join(rust, 'desktop/icons/icon.ico'))) await cp(join(rust, 'desktop/icons'), join(desktop, 'icons'), { recursive: true });
  else await tauri(['icon', join(web, 'src/ui/assets/logo-magna-urbis.png'), '--output', join(desktop, 'icons')]);
}

try {
  if (flags.includes('--help') || action === 'help') {
    console.log('Magna Urbis V2 : node scripts/v2.mjs prepare|dev|build|local|desktop-dev|desktop-build\nprepare : compile terrain + maisons en WASM release; --neural ajoute le runtime et les modèles depuis ../infinite_map.\ndev/build : application Web autonome; local : Web + Rust natif + Python/CUDA optionnel.\ndesktop-dev/build : application et installateur Tauri séparés de la V1.\nOptions : --no-build (binaire Rust existant), --no-neural (lanceur local sans Python).\nPrérequis et déploiement : rust/desktop-v2/README.md');
  } else if (action === 'prepare') await prepare();
  else if (action === 'build') await buildWeb();
  else if (action === 'dev' || action === 'local') {
    requireWasm();
    const services = [];
    if (action === 'local') { services.push(await native(), await python()); }
    services.push(await vite());
    const url = new URL('http://127.0.0.1:5174/v2.html');
    if (action === 'local') { url.searchParams.set('profile', 'local'); url.searchParams.set('localServer', localAddress().origin); }
    console.log(`\nMagna Urbis V2 : ${url}\nCtrl+C arrête uniquement les services démarrés ici.`);
    await Promise.race(services.filter(Boolean).map(service => service.done));
  } else if (action === 'desktop-dev' || action === 'desktop-build') {
    requireWasm();
    await resources();
    if (action === 'desktop-build') await buildWeb(); else { await vite(); await python(); }
    await tauri([action === 'desktop-build' ? 'build' : 'dev', ...flags.filter(arg => arg.startsWith('--') && !['--no-build', '--no-neural'].includes(arg))]);
  } else throw new Error('Usage : v2.mjs prepare|dev|build|local|desktop-dev|desktop-build [--neural] [--no-build] [--no-neural]');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await stop(); }
