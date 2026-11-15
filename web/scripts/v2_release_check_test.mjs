/** Public asset names must survive GitHub upload without invalidating checksums. */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { dirname, join, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { requiredResources } from './v2_release_resources.mjs';
const root = fileURLToPath(new URL('../..', import.meta.url));
const temporary = join(root, '.tmp'); await mkdir(temporary, { recursive: true });
const base = await mkdtemp(join(temporary, 'release-collection-'));
try {
  const version = JSON.parse(await readFile(join(root, 'rust/desktop-v2/tauri.conf.json'), 'utf8')).version;
  for (const platform of ['windows-x64', 'linux-x64']) {
    const resources = join(base, platform, 'resources'), bundle = join(base, platform, 'bundle'), output = join(base, platform, 'output');
    await mkdir(bundle, { recursive: true });
    for (const name of requiredResources(platform)) {
      const path = join(resources, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, 'fixture');
    }
    const extensions = platform === 'windows-x64' ? ['x64-setup.exe'] : ['amd64.deb', 'amd64.AppImage'];
    for (const extension of extensions) await writeFile(join(bundle, `Magna Urbis V2_${version}_${extension}`), 'installer fixture');
    const binary = join(base, 'app.exe'); await writeFile(binary, 'desktop fixture');
    const result = spawnSync(process.execPath, [join(root, 'web/scripts/v2_release_check.mjs'), `--platform=${platform}`, `--bundle=${bundle}`, `--resources=${resources}`, `--output=${output}`, `--binary=${binary}`], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    const files = await readdir(output);
    assert.ok(files.every(file => !file.includes(' ')), 'GitHub must not rename collected assets');
    assert.equal(files.length, 4, 'No duplicate portable archive under its unsanitized name');
    const metadata = JSON.parse(await readFile(join(output, `metadata-${platform}.json`), 'utf8'));
    const checksums = await readFile(join(output, `SHA256SUMS-${platform}.txt`), 'utf8');
    assert.equal(metadata.artifacts.length, 2);
    for (const artifact of metadata.artifacts) {
      assert.ok(artifact.file.startsWith('Magna.Urbis.V2_'));
      assert.ok(files.includes(artifact.file));
      assert.ok(checksums.includes(`${artifact.sha256}  ${artifact.file}\n`));
    }
  }
  console.log('Windows/Linux asset names, checksums and metadata match public GitHub filenames; no duplicate ZIP.');
} finally {
  const parent = await realpath(temporary), target = await realpath(base), within = relative(parent, target);
  if (!within || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw Error(`Unsafe cleanup target: ${target}`);
  await rm(target, { recursive: true, force: true });
}
