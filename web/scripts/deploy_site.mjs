/** Publish a committed source snapshot to one of the two custom domains. */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stageNeuralPublication } from './neural_publication.mjs';

const version = process.argv[2] ?? 'v2';
if (!['v1', 'v2'].includes(version)) throw new Error('Usage: node scripts/deploy_site.mjs v1|v2');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const targets = { v1: { repository: 'https://github.com/dunkean/magna-urbis-v1.git', domain: 'v1.magna-urbis.org', output: 'dist' }, v2: { repository: 'https://github.com/dunkean/magna-urbis.git', domain: 'magna-urbis.org', output: 'dist-v2' } };
const target = targets[version];
/** Days a hashed asset of an earlier build stays published, for pages opened before a publication. */
const ASSET_RETENTION_DAYS = 3;
function run(command, args, cwd = root, capture = false) {
  const result = spawnSync(command, args, {
    cwd,
    windowsHide: true,
    encoding: 'utf8',
    // npm is a .cmd shim on Windows. All npm arguments below are fixed literals.
    shell: process.platform === 'win32' && command === 'npm',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status})`);
  return capture ? result.stdout.trim() : undefined;
}

const revision = run('git', ['rev-parse', 'HEAD'], root, true);
// Vite's HTML proxy cache needs one path spelling. Windows TEMP can use an
// 8.3 alias while Vite resolves imports to the long user-directory path.
const temporaryRoot = realpathSync.native(tmpdir());
const temporary = mkdtempSync(join(temporaryRoot, 'magna-urbis-publish-'));
// One persistent worktree per site, beside the checkout: it is reset to the published commit
// each time, but keeps node_modules, the Rust target and the built WASM packages between runs,
// so a publication rebuilds only what the commit changed. `--fresh` rebuilds everything.
const source = resolve(root, '..', '_worktrees', `publish-${version}`),
  site = join(temporary, 'site');
const state = join(source, '.publish-state');
const fresh = process.argv.includes('--fresh');
/** Inputs of a step, as git object ids of the commit: equal ids mean byte-identical inputs. */
const inputs = paths => paths.map(path => `${path} ${run('git', ['rev-parse', `${revision}:${path}`], root, true)}`).join('\n');
const stamp = name => (existsSync(join(state, name)) ? readFileSync(join(state, name), 'utf8') : '');
const remember = (name, value) => {
  mkdirSync(state, { recursive: true });
  writeFileSync(join(state, name), value);
};
try {
  if (fresh && existsSync(source)) run('git', ['worktree', 'remove', '--force', source]);
  if (!existsSync(source)) run('git', ['worktree', 'add', '--detach', source, revision]);
  else {
    run('git', ['checkout', '--detach', '--force', revision], source);
    // Drop everything the commit does not hold, except the reusable build state.
    run('git', ['clean', '-fdx', '-e', 'node_modules', '-e', 'rust/target', '-e', 'rust/pkg', '-e', '.publish-state'], source);
  }
  const web = join(source, 'web');
  const lock = inputs(['web/package-lock.json']);
  if (stamp('npm') !== lock || !existsSync(join(web, 'node_modules'))) {
    run('npm', ['ci'], web);
    remember('npm', lock);
  } else console.log('npm ci skipped: package-lock.json unchanged since the last publication.');
  // Both current interfaces import the Rust/WASM bridge. Its packages depend only on the Rust
  // sources and the preparation scripts: unchanged inputs give the same packages, kept from the
  // last publication. Otherwise cargo rebuilds incrementally in the persistent target.
  const wasm = inputs(['rust', 'web/scripts', 'web/package-lock.json']);
  const packages = ['wasm', 'wasm-threads', 'houses'].every(name => existsSync(join(source, 'rust/pkg', name)));
  if (stamp('wasm') !== wasm || !packages) {
    remember('wasm', '');
    run('npm', ['run', 'prepare:v2'], web);
    remember('wasm', wasm);
  } else console.log('prepare:v2 skipped: Rust sources and preparation scripts unchanged since the last publication.');
  if (version === 'v2') {
    // The detached worktree has no sibling infinite_map or generated neural package.
    // Accept only the prepared main-checkout runtime and verified profile; never rebuild it here.
    // Staged afresh each time: the persistent worktree must not carry an older model set.
    rmSync(join(source, 'rust/pkg/neural-web'), { recursive: true, force: true });
    await stageNeuralPublication(join(root, 'rust/pkg/neural-web'), join(source, 'rust/pkg/neural-web'));
    run('npm', ['run', 'build:v2'], web);
    run('npm', ['run', 'test:v2:static'], web);
    // prepare:v2 builds both core packages; the site must ship the threads one (cross-origin
    // isolated browsers) beside the single-thread fallback.
    const coreWasm = readdirSync(join(web, target.output, 'assets')).filter(name => /^magna_urbis_wasm_bg-.+\.wasm$/.test(name));
    if (coreWasm.length < 2) throw new Error(`Expected the single and threads core WASM assets, found: ${coreWasm.join(', ') || 'none'}`);
  } else run('npm', ['run', 'build'], web);
  const artifact = join(web, target.output);
  if (!existsSync(join(artifact, 'index.html'))) throw new Error('Missing index.html in build output');

  run('git', ['clone', '--depth', '1', '--branch', 'gh-pages', target.repository, site]);
  // A page opened before this publication still lazily loads chunks of its own build: hashed
  // assets that leave the build stay published for ASSET_RETENTION_DAYS, counted from the first
  // publication without them (assets-retained.json on gh-pages records that date per file).
  const retentionFile = join(site, 'assets-retained.json'),
    retainedDir = join(temporary, 'retained');
  const leftSince = existsSync(retentionFile) ? JSON.parse(readFileSync(retentionFile, 'utf8')) : {};
  const builtAssets = new Set(readdirSync(join(artifact, 'assets')));
  const now = Date.now(),
    retained = {};
  mkdirSync(retainedDir, { recursive: true });
  for (const name of existsSync(join(site, 'assets')) ? readdirSync(join(site, 'assets')) : []) {
    if (builtAssets.has(name)) continue;
    const since = Number.isFinite(leftSince[name]) ? leftSince[name] : now;
    if (now - since > ASSET_RETENTION_DAYS * 86400000) continue;
    retained[name] = since;
    renameSync(join(site, 'assets', name), join(retainedDir, name));
  }
  // Preserve the separately published gallery and documentation.
  for (const entry of readdirSync(site)) {
    if (['.git', 'gallery', 'scientific'].includes(entry)) continue;
    const path = resolve(site, entry);
    if (dirname(path) !== resolve(site)) throw new Error('Unexpected publication path');
    rmSync(path, { recursive: true, force: true });
  }
  cpSync(artifact, site, { recursive: true });
  cpSync(retainedDir, join(site, 'assets'), { recursive: true });
  writeFileSync(retentionFile, `${JSON.stringify(retained, null, 1)}\n`);
  console.log(`Kept ${Object.keys(retained).length} assets of earlier builds (${ASSET_RETENTION_DAYS} days after they leave the build).`);
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    if (existsSync(join(source, name))) cpSync(join(source, name), join(site, name));
  }
  writeFileSync(join(site, 'CNAME'), `${target.domain}\n`);
  writeFileSync(join(site, '.nojekyll'), '');
  writeFileSync(join(site, 'version.json'), `${JSON.stringify({ version, revision })}\n`);
  if (version === 'v2') {
    mkdirSync(join(site, 'v2'), { recursive: true });
    writeFileSync(join(site, 'v2/index.html'), '<!doctype html><meta charset="utf-8"><title>Magna Urbis V2</title><meta http-equiv="refresh" content="0;url=/"><script>location.replace("/"+location.search+location.hash)</script><a href="/">Magna Urbis V2</a>\n');
  }
  run('git', ['add', '-A'], site);
  if (run('git', ['diff', '--cached', '--name-only'], site, true)) {
    run('git', ['commit', '-m', `Publish Magna Urbis ${version.toUpperCase()} (${revision.slice(0, 8)})`], site);
    // A concurrent publication fails safely: no force push.
    run('git', ['push', 'origin', 'gh-pages'], site);
  }
  console.log(`Published ${version.toUpperCase()}: https://${target.domain}/ (${revision})`);
} finally {
  if (dirname(resolve(temporary)) !== temporaryRoot) throw new Error('Unexpected temporary directory');
  rmSync(temporary, { recursive: true, force: true });
}
