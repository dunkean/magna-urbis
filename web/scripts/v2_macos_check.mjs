/** Mount the candidate DMG, copy the app and exercise its actual WKWebView. */
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { appendFile, mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'arm64');
const [dmg, weights] = process.argv.slice(2);
assert.ok(dmg?.endsWith('.dmg') && weights, 'Usage: v2_macos_check.mjs FILE.dmg WEIGHTS_DIR');
// macOS can expose TMPDIR under /var, a symlink to /private/var.
// Tauri rejects executable paths with symlinked ancestors on this platform.
const directory = await mkdtemp(join(await realpath(tmpdir()), 'magna-desktop-smoke-'));
const mount = join(directory, 'volume');
const command = (binary, args) => execFileSync(binary, args, { encoding: 'utf8', timeout: 90_000 }).trim();

async function checkStopped(name, origin) {
  const url = new URL(origin);
  assert.equal(url.hostname, '127.0.0.1');
  for (let attempt = 0; attempt < 16; attempt++) {
    try {
      await fetch(new URL('/status', url), { signal: AbortSignal.timeout(1000) });
    } catch {
      return;
    }
    await sleep(250);
  }
  throw new Error(`The installed app left its ${name} service running`);
}

try {
  await mkdir(mount);
  command('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, resolve(dmg)]);
  let installed;
  try {
    const bundles = (await readdir(mount)).filter(name => name.endsWith('.app'));
    assert.equal(bundles.length, 1, 'The DMG must contain exactly one app');
    installed = join(directory, bundles[0]);
    command('ditto', [join(mount, bundles[0]), installed]);
  } finally {
    command('hdiutil', ['detach', mount]);
  }
  const plist = join(installed, 'Contents/Info.plist');
  const executable = command('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', plist]);
  const binary = join(installed, 'Contents/MacOS', executable);
  const resources = join(installed, 'Contents/Resources/resources');
  command('codesign', ['--verify', '--deep', installed]);
  for (const path of [binary, join(resources, 'magna-urbis-local'), join(resources, 'magna-urbis-neural'), join(resources, 'bin/uv')]) {
    assert.equal(command('lipo', ['-archs', path]), 'arm64', `Unexpected architecture: ${path}`);
  }
  const env = {
    ...process.env,
    MAGNA_RUNTIME_DATA: join(directory, 'data'),
    MAGNA_RUNTIME_CACHE: join(directory, 'cache'),
    MAGNA_DESKTOP_NEURAL_WEIGHTS: resolve(weights),
    // The prepared files must work offline. Loopback service traffic never uses these proxies.
    HTTPS_PROXY: 'http://127.0.0.1:1',
    HTTP_PROXY: 'http://127.0.0.1:1',
    ALL_PROXY: 'http://127.0.0.1:1',
    NO_PROXY: '127.0.0.1,localhost',
  };
  for (const key of ['MAGNA_LOCAL_BIN', 'MAGNA_NEURAL_PYTHON', 'MAGNA_ILLUSTRATION_PYTHON', 'MAGNA_NEURAL_EARTH', 'https_proxy', 'http_proxy', 'all_proxy', 'no_proxy']) delete env[key];
  const app = spawn(binary, ['--desktop-smoke'], { cwd: directory, env, stdio: ['ignore', 'pipe', 'inherit'] });
  let output = '';
  app.stdout.setEncoding('utf8');
  app.stdout.on('data', text => {
    output += text;
    process.stdout.write(text);
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    if (!app.pid || app.exitCode !== null || app.signalCode !== null) return;
    timedOut = true;
    // Stop only the two native services owned by this launched app.
    const children = spawnSync('pgrep', ['-P', String(app.pid)], { encoding: 'utf8' }).stdout ?? '';
    for (const pid of children.split(/\s+/).filter(value => /^\d+$/.test(value))) {
      try {
        process.kill(Number(pid), 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') console.error(error);
      }
    }
    app.kill('SIGKILL');
  }, 8 * 60_000);
  let code, signal;
  try {
    [code, signal] = await once(app, 'close');
  } finally {
    clearTimeout(timer);
  }
  assert.ok(!timedOut, 'The installed WKWebView smoke test timed out');
  const resultLine = output.split(/\r?\n/).find(line => line.startsWith('MAGNA_DESKTOP_SMOKE '));
  assert.ok(resultLine, `Installed app exited before reporting checks (${signal ?? code})`);
  const report = JSON.parse(resultLine.slice('MAGNA_DESKTOP_SMOKE '.length));
  for (const [name, origin] of Object.entries(report.services)) await checkStopped(name, origin);
  assert.ok(report.ok, report.error);
  assert.equal(code, 0, `Installed app exited with ${signal ?? code}`);
  const skipped = ['webgl', 'neural'].filter(check => report.checks[check]?.skipped);
  for (const check of skipped) console.log(`::warning::${check}: ${report.checks[check].skipped}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Installed Apple Silicon app\n\n\`\`\`json\n${JSON.stringify(report.checks, null, 2)}\n\`\`\`\n`);
  }
  if (process.env.MAGNA_REQUIRE_MAC_GPU === '1') assert.deepEqual(skipped, [], 'GPU checks are required on this runner');
} finally {
  await rm(directory, { recursive: true, force: true });
}
