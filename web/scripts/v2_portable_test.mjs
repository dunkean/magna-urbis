import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { unzipSync } from 'fflate';
import { createPortable } from './v2_portable.mjs';
import { requiredResources } from './v2_release_resources.mjs';

const base = await mkdtemp(join(tmpdir(), 'magna-portable-test-'));
try {
  const resources = join(base, 'resources'), binary = join(base, 'app.exe'), output = join(base, 'app.zip');
  await writeFile(binary, 'desktop executable');
  for (const name of requiredResources('windows-x64')) {
    const file = join(resources, name); await mkdir(dirname(file), { recursive: true }); await writeFile(file, `fixture:${name}`);
  }
  for (const name of ['modules.json', 'debug.pdb', 'weights/model.pt', 'venvs/terrain/python.exe']) {
    const file = join(resources, name); await mkdir(dirname(file), { recursive: true }); await writeFile(file, 'exclude');
  }
  await createPortable({ binary, resources, output });
  const archive = unzipSync(await readFile(output));
  assert.equal(new TextDecoder().decode(archive['Magna Urbis V2/magna-urbis-v2-desktop.exe']), 'desktop executable');
  assert.ok(archive['Magna Urbis V2/README.txt']);
  for (const name of requiredResources('windows-x64')) assert.ok(archive[`Magna Urbis V2/resources/${name}`], name);
  assert.ok(!Object.keys(archive).some(name => /(?:modules\.json|\.pdb|\.pt|\/venvs\/)/.test(name)));
  await assert.rejects(createPortable({ binary: join(base, 'absent.exe'), resources, output }), /executable/);
  try {
    await symlink(binary, join(resources, 'link.exe'), 'file');
    await assert.rejects(createPortable({ binary, resources, output }), /Symbolic link/);
    await rm(join(resources, 'link.exe'));
  } catch (error) { if (!['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) throw error; }
  await rm(join(resources, 'bin/uv.exe'));
  await assert.rejects(createPortable({ binary, resources, output }), /uv\.exe/);
  console.log('Portable archive includes required files, excludes user/build data, and rejects incomplete inputs.');
} finally {
  const actualRoot = await realpath(tmpdir()), actualTarget = await realpath(base);
  const within = relative(actualRoot, actualTarget);
  if (!within || within === '..' || within.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(within)) throw new Error(`Unsafe cleanup target: ${actualTarget}`);
  await rm(actualTarget, { recursive: true, force: true });
}
