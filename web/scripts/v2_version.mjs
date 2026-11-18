/** Align the package versions used by the desktop release workflow. */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../..', import.meta.url));
const files = ['rust/desktop-v2/tauri.conf.json', 'rust/desktop-v2/Cargo.toml', 'rust/desktop-v2/Cargo.lock'];
const contents = await Promise.all(files.map(file => readFile(join(root, file), 'utf8')));
const current = JSON.parse(contents[0]).version;
const cargoPattern = /(^name = "magna-urbis-v2-desktop"\r?\nversion = ")([^"]+)(")/m;
const versions = [current, ...contents.slice(1).map(text => text.match(cargoPattern)?.[2])];
const argument = process.argv[2] ?? '--check';
if (argument === '--check') {
  if (versions.some(version => version !== current)) throw Error(`Desktop versions differ: ${versions.join(', ')}`);
  if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `desktop-v${current}`) throw Error(`Expected tag desktop-v${current}`);
  console.log(`Desktop version ${current}; tag desktop-v${current}`);
} else {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(argument)) throw Error('Use a semantic version, e.g. 0.3.1 or 0.4.0-alpha.1');
  if (contents.slice(1).some(text => !cargoPattern.test(text))) throw Error('Desktop package missing from Cargo.toml or Cargo.lock');
  const config = JSON.parse(contents[0]);
  config.version = argument;
  await writeFile(join(root, files[0]), `${JSON.stringify(config, null, 2)}\n`);
  for (let i = 1; i < files.length; i++) await writeFile(join(root, files[i]), contents[i].replace(cargoPattern, `$1${argument}$3`));
  console.log(`Version set to ${argument}. Commit the changes, then push tag desktop-v${argument} to build and publish with GitHub Actions.`);
}
