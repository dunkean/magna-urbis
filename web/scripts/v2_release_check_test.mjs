/** Public asset names must survive GitHub upload without invalidating checksums. */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { dirname, join, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { checkResources, requiredResources, stageTerrainPythonScripts } from './v2_release_resources.mjs';
const root = fileURLToPath(new URL('../..', import.meta.url));
const temporary = join(root, '.tmp');
await mkdir(temporary, { recursive: true });
const base = await mkdtemp(join(temporary, 'release-collection-'));
try {
  const version = JSON.parse(await readFile(join(root, 'rust/desktop-v2/tauri.conf.json'), 'utf8')).version;
  for (const platform of ['windows-x64', 'linux-x64', 'macos-arm64']) {
    const resources = join(base, platform, 'resources'),
      bundle = join(base, platform, 'bundle'),
      output = join(base, platform, 'output');
    await mkdir(bundle, { recursive: true });
    for (const name of requiredResources(platform)) {
      const path = join(resources, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, 'fixture');
    }
    // The real staged entrypoint must include every adjacent neural helper it
    // imports. A fixture built from the resource list alone cannot catch this.
    const pythonScripts = join(resources, 'web/scripts');
    await stageTerrainPythonScripts(join(root, 'web'), pythonScripts);
    for (const name of await readdir(pythonScripts))
      if (name.endsWith('.py')) {
        const imports = (await readFile(join(pythonScripts, name), 'utf8')).matchAll(/^\s*(?:from|import)\s+(neural_[A-Za-z0-9_]+)/gm);
        for (const [, module] of imports) {
          const adjacent = module === 'neural_earth_tile40' ? 'neural_earth_tile40' : `${module}.py`;
          assert.ok((await readdir(pythonScripts)).includes(adjacent), `${name} imports missing local module ${module}`);
        }
      }
    await checkResources(resources, platform);
    await rm(join(pythonScripts, 'neural_sampling.py'));
    await assert.rejects(checkResources(resources, platform), /neural_sampling\.py/);
    await stageTerrainPythonScripts(join(root, 'web'), pythonScripts);
    const extensions = { 'windows-x64': ['x64-setup.exe'], 'linux-x64': ['amd64.deb', 'amd64.AppImage'], 'macos-arm64': ['aarch64.dmg'] }[platform];
    for (const extension of extensions) await writeFile(join(bundle, `Magna Urbis V2_${version}_${extension}`), 'installer fixture');
    const binary = join(base, 'app.exe');
    await writeFile(binary, 'desktop fixture');
    const result = spawnSync(process.execPath, [join(root, 'web/scripts/v2_release_check.mjs'), `--platform=${platform}`, `--bundle=${bundle}`, `--resources=${resources}`, `--output=${output}`, `--binary=${binary}`], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    const files = await readdir(output);
    assert.ok(
      files.every(file => !file.includes(' ')),
      'GitHub must not rename collected assets',
    );
    const count = platform === 'macos-arm64' ? 1 : 2;
    assert.equal(files.length, count + 2, 'Only expected installers, metadata and checksums');
    const metadata = JSON.parse(await readFile(join(output, `metadata-${platform}.json`), 'utf8'));
    const checksums = await readFile(join(output, `SHA256SUMS-${platform}.txt`), 'utf8');
    assert.equal(metadata.artifacts.length, count);
    for (const artifact of metadata.artifacts) {
      assert.ok(artifact.file.startsWith('Magna.Urbis.V2_'));
      assert.ok(files.includes(artifact.file));
      assert.ok(checksums.includes(`${artifact.sha256}  ${artifact.file}\n`));
    }
  }
  console.log('Desktop asset names, checksums and metadata match GitHub filenames.');
} finally {
  const parent = await realpath(temporary),
    target = await realpath(base),
    within = relative(parent, target);
  if (!within || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw Error(`Unsafe cleanup target: ${target}`);
  await rm(target, { recursive: true, force: true });
}
