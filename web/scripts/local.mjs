import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('..', import.meta.url));
const root = resolve(web, '..');
const rust = join(root, 'rust');
const desktop = join(rust, 'desktop');
const windows = process.platform === 'win32';
const cargoBin = join(homedir(), '.cargo', 'bin');
const env = { ...process.env, PATH: cargoBin + delimiter + (process.env.PATH ?? '') };
const cargo = existsSync(join(cargoBin, windows ? 'cargo.exe' : 'cargo'))
  ? join(cargoBin, windows ? 'cargo.exe' : 'cargo') : 'cargo';
const args = process.argv.slice(2);
const action = args.find(arg => !arg.startsWith('--')) ?? 'dev';
const children = new Set();
let stopping = false;

function start(command, commandArgs, cwd = web, extraEnv = {}, capture = false) {
  const child = spawn(command, commandArgs, {
    cwd, env: { ...env, ...extraEnv }, windowsHide: true, detached: !windows,
    stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'],
  });
  children.add(child);
  let output = '';
  child.stdout?.on('data', data => { output += data; });
  const done = new Promise((resolveDone, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      children.delete(child);
      if (code === 0 || stopping) resolveDone(output);
      else reject(new Error(`${command} s'est arrêté (${signal ?? code}).`));
    });
  });
  // A background service can fail before its readiness check finishes.
  void done.catch(() => {});
  return { child, done };
}

const run = (command, commandArgs, cwd = web) => start(command, commandArgs, cwd).done;
const pause = ms => new Promise(resolvePause => setTimeout(resolvePause, ms));

async function stop() {
  if (stopping) return;
  stopping = true;
  await Promise.all([...children].map(child => new Promise(resolveStop => {
    const timer = setTimeout(resolveStop, 3000);
    timer.unref();
    child.once('exit', () => { clearTimeout(timer); resolveStop(); });
    // CLI tools can have their own children (Tauri, Cargo, Vite/esbuild).
    if (windows) {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      killer.once('error', () => child.kill());
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
    }
  })));
}

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  void stop().then(() => process.exit(signal === 'SIGINT' ? 130 : 143));
});

async function status(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1200) });
    return response.ok ? response : null;
  } catch { return null; }
}

async function waitFor(url, service, validate = () => true) {
  for (let tries = 0; tries < 240; tries++) {
    if (service.child.exitCode !== null || service.child.signalCode !== null) {
      await service.done;
      throw new Error(`Service arrêté avant de répondre : ${url}`);
    }
    const response = await status(url);
    if (response && await validate(response)) return;
    await pause(250);
  }
  throw new Error(`Le service ne répond pas : ${url}`);
}

async function freePort(port) {
  await new Promise((resolvePort, reject) => {
    const socket = createServer();
    socket.once('error', () => reject(new Error(`Le port ${port} est déjà utilisé.`)));
    socket.listen(port, '127.0.0.1', () => socket.close(resolvePort));
  });
}

async function nativeBinary() {
  if (!args.includes('--no-build')) {
    await run(cargo, ['build', '--release', '-p', 'magna-urbis-local'], rust);
  }
  const metadata = JSON.parse(await start(cargo,
    ['metadata', '--format-version', '1', '--no-deps'], rust, {}, true).done);
  const binary = process.env.MAGNA_LOCAL_BIN
    ?? join(metadata.target_directory, 'release', `magna-urbis-local${windows ? '.exe' : ''}`);
  if (!existsSync(binary)) throw new Error(`Moteur absent : ${binary}. Lance npm run build:local.`);
  return binary;
}

async function neural() {
  if (args.includes('--no-neural') || await status('http://127.0.0.1:8793/status')) return null;
  const earth = process.env.MAGNA_NEURAL_EARTH ?? resolve(root, '../infinite_map');
  const python = process.env.MAGNA_NEURAL_PYTHON
    ?? join(earth, windows ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  if (!existsSync(python)) {
    console.log('Neural Python/CUDA optionnel absent ; relief procédural et navigateur disponibles.');
    return null;
  }
  try {
    await freePort(8793);
    const service = start(python, ['-u', join(web, 'scripts/neural_python.py')]);
    await waitFor('http://127.0.0.1:8793/status', service);
    return service;
  } catch (error) {
    console.log(`Neural Python/CUDA indisponible : ${error.message}`);
    return null;
  }
}

async function vite() {
  const url = 'http://127.0.0.1:5173/rustbench.html';
  if (await status(url)) return null;
  await freePort(5173);
  const service = start(process.execPath, [join(web, 'node_modules/vite/bin/vite.js'),
    '--mode', 'rustbench', '--host', '127.0.0.1', '--port', '5173', '--strictPort']);
  await waitFor(url, service);
  return service;
}

function open(url) {
  if (args.includes('--no-open')) return;
  const command = windows ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const commandArgs = windows ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, commandArgs, { stdio: 'ignore', windowsHide: true, detached: true });
  child.once('error', error => console.log(`Ouvre le lien ci-dessus (${error.message}).`));
  child.unref();
}

function tauri(commandArgs) {
  // npm supplies its own CLI path on every platform; no Cargo CLI installation.
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error('Lance cette commande via npm run app:dev ou npm run app:build.');
  return run(process.execPath, [npm, 'exec', '--yes', '--package=@tauri-apps/cli@^2', '--', 'tauri', ...commandArgs], desktop);
}

async function main() {
  if (action === 'build') { await nativeBinary(); return; }
  if (action === 'desktop-build' || action === 'desktop-dev') {
    const binary = await nativeBinary();
    await mkdir(join(desktop, 'resources'), { recursive: true });
    const bundledBinary = join(desktop, 'resources', `magna-urbis-local${windows ? '.exe' : ''}`);
    await copyFile(binary, bundledBinary);
    if (!windows) await chmod(bundledBinary, 0o755);
    if (!existsSync(join(desktop, 'icons/icon.ico'))) {
      await tauri(['icon', join(web, 'src/ui/assets/logo-magna-urbis.png'), '--output', join(desktop, 'icons')]);
    }
    if (action === 'desktop-build') {
      await run(process.execPath, [join(web, 'scripts/rust_benches.mjs')]);
    } else {
      await vite();
      await neural();
    }
    await tauri([action === 'desktop-build' ? 'build' : 'dev',
      ...args.filter(arg => !['--no-build', '--no-neural', '--no-open', action].includes(arg))]);
    return;
  }
  if (action !== 'dev') throw new Error('Usage : local.mjs dev|build|desktop-dev|desktop-build [--no-build] [--no-neural] [--no-open]');
  const profiles = JSON.parse(await readFile(join(root, 'config/execution.json'), 'utf8'));
  const server = new URL(process.env.MAGNA_LOCAL_SERVER ?? profiles.local.server);
  if (!['127.0.0.1', 'localhost'].includes(server.hostname) || server.protocol !== 'http:') {
    throw new Error('Le moteur local doit utiliser http://127.0.0.1:<port>.');
  }
  const port = Number(server.port || 80);
  const nativeStatus = await status(new URL('/status', server));
  let native = null;
  if (nativeStatus) {
    if ((await nativeStatus.json()).backend !== 'rust-native') throw new Error(`Un autre service utilise ${server.origin}.`);
    console.log(`Moteur existant réutilisé : ${server.origin}`);
  } else {
    await freePort(port);
    native = start(await nativeBinary(), ['--port', String(port)], rust, { MAGNA_LOCAL_ADDR: `127.0.0.1:${port}` });
    await waitFor(new URL('/status', server), native, async response => (await response.json()).backend === 'rust-native');
  }
  const site = await vite();
  const python = await neural();
  const url = new URL('http://127.0.0.1:5173/rustbench.html');
  url.searchParams.set('profile', 'local');
  url.searchParams.set('localServer', server.origin);
  console.log(`\nMagna Urbis · profil local : ${url}\nCtrl+C arrête les services démarrés ici.`);
  open(url.href);
  const owned = [native, site, python].filter(Boolean);
  if (owned.length) await Promise.race(owned.map(service => service.done));
}

try { await main(); }
catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { await stop(); }
