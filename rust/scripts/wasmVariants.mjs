// Browser builds of the core WASM crate (crates/wasm):
//   pkg/wasm          single thread, wasm-release profile (fat LTO, 1 CGU)
//   pkg/wasm-threads  shared memory + wasm-bindgen-rayon pool (`threads` feature), thread-caching
//                     allocator, panic=unwind with wasm exception handling. Needs nightly flags:
//                     RUSTC_BOOTSTRAP=1 on the pinned stable toolchain and `-Z build-std` (rust-src).
// The browser picks one at runtime (rust/bridge/wasmThreads.ts, `?threads=auto|on|off|pool`).
// Measured on the hanseatic 10k case (web/scripts/bench_urban_wasm.mjs, best of 3-4 runs, noise
// about +-15%): fat LTO ~ thin LTO, +simd128 no gain, wasm-opt -O3 no gain (-9% size, 5 min with
// binaryen.js) and the caching allocator neutral single-threaded, so none is on by default.
// MAGNA_WASM_OPT=1 runs wasm-opt -O3 (WASM_OPT=<path>, else web/node_modules/binaryen, else PATH).
import { existsSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rustDir = fileURLToPath(new URL('..', import.meta.url));
const webDir = resolve(rustDir, '../web');
const cargoBin = join(homedir(), '.cargo', 'bin');
const windows = process.platform === 'win32';
const executable = name => {
  const local = join(cargoBin, name + (windows ? '.exe' : ''));
  return existsSync(local) ? local : name;
};

function run(command, args, extraEnv = {}, cwd = rustDir) {
  const env = { ...process.env, PATH: cargoBin + delimiter + (process.env.PATH ?? ''), ...extraEnv };
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit', windowsHide: true });
    child.once('error', error => reject(new Error(`${command}: ${error.message}`)));
    child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`${command} exited with ${code}`)));
  });
}

// Rust's wasm32 default features (wasm-opt must accept what the module uses).
const BASE_FEATURES = ['--enable-bulk-memory', '--enable-nontrapping-float-to-int', '--enable-sign-ext',
  '--enable-mutable-globals', '--enable-reference-types', '--enable-multivalue'];
export const VARIANTS = {
  single: {
    outDir: 'pkg/wasm', targetDir: 'target/wasm-single',
    rustflags: '',
    cargo: [],
    opt: BASE_FEATURES,
  },
  threads: {
    outDir: 'pkg/wasm-threads', targetDir: 'target/wasm-threads',
    // Atomics need std rebuilt with them. The target default is panic=abort:
    // unwind (catch_unwind in the urban kernels) needs wasm exception handling,
    // emitted in the legacy encoding, which every threads-capable browser runs.
    // rustc does not link wasm32-unknown-unknown with shared memory by itself:
    // imported shared memory (max 4 GiB, the wasm32 limit) and the TLS exports
    // wasm-bindgen's thread start needs.
    rustflags: ['-C panic=unwind -C llvm-args=-wasm-use-legacy-eh',
      '-C target-feature=+atomics,+bulk-memory,+mutable-globals,+exception-handling',
      ...['--shared-memory', '--import-memory', '--max-memory=4294967296',
        '--export=__wasm_init_tls', '--export=__tls_size', '--export=__tls_align', '--export=__tls_base'].map(a => `-C link-arg=${a}`)].join(' '),
    cargo: ['--', '--features', 'threads', '-Z', 'build-std=panic_unwind,std'],
    env: { RUSTC_BOOTSTRAP: '1' },
    opt: [...BASE_FEATURES, '--enable-threads', '--enable-exception-handling'],
  },
};

function wasmOptCommand() {
  if (process.env.WASM_OPT) return [process.env.WASM_OPT];
  const npm = join(webDir, 'node_modules/binaryen/bin/wasm-opt');
  if (existsSync(npm)) return [process.execPath, npm];
  const probe = spawnSync('wasm-opt', ['--version'], { windowsHide: true });
  return probe.status === 0 ? ['wasm-opt'] : undefined;
}

export async function buildWasmVariant(name) {
  const variant = VARIANTS[name];
  const outDir = join(rustDir, variant.outDir);
  rmSync(outDir, { recursive: true, force: true });
  const started = performance.now();
  await run(executable('wasm-pack'), ['build', 'crates/wasm', '--target', 'web', '--out-dir', join('../..', variant.outDir),
    '--profile', 'wasm-release', '--no-opt', ...variant.cargo], {
    ...variant.env,
    CARGO_TARGET_DIR: join(rustDir, variant.targetDir),
    CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS: variant.rustflags,
  });
  const wasm = join(outDir, 'magna_urbis_wasm_bg.wasm');
  const before = statSync(wasm).size;
  const opt = process.env.MAGNA_WASM_OPT === '1' ? wasmOptCommand() : undefined;
  if (opt) {
    const [command, ...prefix] = opt;
    await run(command, [...prefix, wasm, '-o', wasm, '-O3', ...variant.opt]);
  } else if (process.env.MAGNA_WASM_OPT === '1') {
    console.warn('wasm-opt not found (npm i -D binaryen in web/, or WASM_OPT=<path>): module left as built.');
  }
  console.log(`${variant.outDir}: ${(before / 1048576).toFixed(1)} MiB${opt ? ` -> ${(statSync(wasm).size / 1048576).toFixed(1)} MiB after wasm-opt` : ''} in ${((performance.now() - started) / 1000).toFixed(0)} s`);
}

/** Both browser variants. A failing threads build leaves the single package usable (auto falls back). */
export async function buildWasmVariants({ threads = true } = {}) {
  await buildWasmVariant('single');
  if (!threads) return;
  try { await buildWasmVariant('threads'); }
  catch (error) {
    rmSync(join(rustDir, VARIANTS.threads.outDir), { recursive: true, force: true });
    console.warn(`pkg/wasm-threads not built (${error.message}); browsers will use pkg/wasm.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const names = process.argv.slice(2);
  (async () => { for (const name of names.length ? names : ['single', 'threads']) await buildWasmVariant(name); })()
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
