/** Check staged desktop resources and collect the installers produced by Tauri. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkResources } from './v2_release_resources.mjs';
import { createPortable } from './v2_portable.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const options = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--([\w-]+)=(.+)$/.exec(arg);
  if (!match) throw new Error(`Expected --name=value, got ${arg}`);
  return [match[1], match[2]];
}));
const platform = options.platform;
if (!['windows-x64', 'linux-x64'].includes(platform)) throw new Error('Use --platform=windows-x64 or --platform=linux-x64');
const target = join(root, 'rust/desktop-v2/target/release');
const resources = resolve(options.resources ?? join(root, platform === 'windows-x64' ? 'rust/desktop-v2/target/release/resources' : 'rust/desktop-v2/resources'));
const bundle = resolve(options.bundle ?? join(root, 'rust/desktop-v2/target/release/bundle'));
const output = resolve(options.output ?? join(root, 'release-v2', platform));
await checkResources(resources, platform);
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]))).flat();
}
const all = await files(bundle);
const version = JSON.parse(await readFile(join(root, 'rust/desktop-v2/tauri.conf.json'), 'utf8')).version;
if (typeof version !== 'string' || !version) throw new Error('Desktop version is missing');
const versionPattern = new RegExp(`(?:^|[^0-9])${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^0-9])`);
const extensions = platform === 'windows-x64' ? ['.exe'] : ['.deb', '.AppImage'];
const installers = extensions.map(ext => {
  const matches = all.filter(path => path.endsWith(ext) && versionPattern.test(basename(path)));
  if (matches.length !== 1) throw new Error(`Expected exactly one ${ext} installer for version ${version} in ${bundle}; found ${matches.length}`);
  return matches[0];
});
await mkdir(output, { recursive: true });
if (platform === 'windows-x64') {
  const portable = join(output, `Magna Urbis V2_${version}_x64-portable.zip`);
  await createPortable({ binary: options.binary ?? join(target, 'magna-urbis-v2-desktop.exe'), resources, output: portable });
  installers.push(portable);
}
const hashes = [];
for (const installer of installers) {
  if (!(await stat(installer)).size) throw new Error(`Empty installer: ${installer}`);
  const name = basename(installer);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(installer)) hash.update(chunk);
  hashes.push({ file: name, sha256: hash.digest('hex') });
  if (resolve(installer) !== resolve(output, name)) await copyFile(installer, join(output, name));
}
await writeFile(join(output, `SHA256SUMS-${platform}.txt`), hashes.map(item => `${item.sha256}  ${item.file}\n`).join(''));
await writeFile(join(output, `metadata-${platform}.json`), `${JSON.stringify({ version, platform, commit: process.env.GITHUB_SHA ?? null, artifacts: hashes }, null, 2)}\n`);
console.log(`Checked desktop resources and staged ${hashes.map(item => item.file).join(', ')} in ${output}`);
