/** Publish a committed source snapshot to one of the two custom domains. */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2] ?? 'v2';
if (!['v1', 'v2'].includes(version)) throw new Error('Usage: node scripts/deploy_site.mjs v1|v2');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const targets = {
  v1: { repository: 'https://github.com/dunkean/magna-urbis-v1.git', domain: 'v1.magna-urbis.org', output: 'dist' },
  v2: { repository: 'https://github.com/dunkean/magna-urbis.git', domain: 'magna-urbis.org', output: 'dist-v2' },
};
const target = targets[version];
function run(command, args, cwd = root, capture = false) {
  const result = spawnSync(command, args, {
    cwd, windowsHide: true, encoding: 'utf8',
    // npm is a .cmd shim on Windows. All npm arguments below are fixed literals.
    shell: process.platform === 'win32' && command === 'npm',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status})`);
  return capture ? result.stdout.trim() : undefined;
}

const revision = run('git', ['rev-parse', 'HEAD'], root, true);
const temporary = mkdtempSync(join(tmpdir(), 'magna-urbis-publish-'));
const source = join(temporary, 'source'), site = join(temporary, 'site');
let worktreeAdded = false;
try {
  run('git', ['worktree', 'add', '--detach', source, revision]);
  worktreeAdded = true;
  const web = join(source, 'web');
  run('npm', ['ci'], web);
  // Both current interfaces import the Rust/WASM bridge.
  run('npm', ['run', 'prepare:v2'], web);
  if (version === 'v2') {
    run('npm', ['run', 'build:v2'], web);
    run('npm', ['run', 'test:v2:static'], web);
  } else run('npm', ['run', 'build'], web);
  const artifact = join(web, target.output);
  if (!existsSync(join(artifact, 'index.html'))) throw new Error('Missing index.html in build output');

  run('git', ['clone', '--depth', '1', '--branch', 'gh-pages', target.repository, site]);
  // Preserve the separately published gallery and documentation.
  for (const entry of readdirSync(site)) {
    if (['.git', 'gallery', 'scientific'].includes(entry)) continue;
    const path = resolve(site, entry);
    if (dirname(path) !== resolve(site)) throw new Error('Unexpected publication path');
    rmSync(path, { recursive: true, force: true });
  }
  cpSync(artifact, site, { recursive: true });
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
  if (worktreeAdded) run('git', ['worktree', 'remove', '--force', source]);
  if (dirname(resolve(temporary)) !== resolve(tmpdir())) throw new Error('Unexpected temporary directory');
  rmSync(temporary, { recursive: true, force: true });
}
