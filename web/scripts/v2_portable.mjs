/** Create a Windows portable distribution without including user data or build caches. */
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Zip, ZipDeflate } from 'fflate';
import { checkResources } from './v2_release_resources.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const excluded = name => /^(?:venvs?|\.venv[^/]*|__pycache__|node_modules|target|build|cache|caches|modules\.json)$/i.test(name) || /\.(?:pdb|pyc|pt|safetensors)$/i.test(name);
const readme = `Magna Urbis V2 - portable Windows edition\r\n\r\nExtract the entire folder and run magna-urbis-v2-desktop.exe. Keep the resources folder beside it. No installation or administrator rights are required to run the app. Microsoft Edge WebView2 Runtime is required.\r\n\r\nProcedural generation uses the included Rust engine. Python/CUDA and model downloads are optional. Settings, optional environments, and model caches use your normal per-user application data, shared with the installed edition; they are not stored beside this executable.\r\n`;

async function* resourceFiles(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (/[\\/:*?"<>|\x00-\x1f]/.test(entry.name) || entry.name === '.' || entry.name === '..') throw new Error(`Invalid Windows resource name: ${entry.name}`);
    const path = join(dir, entry.name), relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Symbolic link in resources: ${path}`);
    if (excluded(entry.name)) continue;
    if (entry.isDirectory()) yield* resourceFiles(path, relative);
    else if (entry.isFile()) yield { path, name: relative };
    else throw new Error(`Unsupported resource: ${path}`);
  }
}

export async function createPortable({ binary, resources, output }) {
  binary = resolve(binary); resources = resolve(resources); output = resolve(output);
  const binaryInfo = await lstat(binary).catch(() => null);
  if (!binaryInfo?.isFile() || !binaryInfo.size) throw new Error(`Missing or empty desktop executable: ${binary}`);
  const resourceInfo = await lstat(resources).catch(() => null);
  if (!resourceInfo?.isDirectory()) throw new Error(`Missing resource directory: ${resources}`);
  await checkResources(resources, 'windows-x64');
  // Validate the entire tree before opening the output, including symlinks and file types.
  const files = []; for await (const file of resourceFiles(resources)) files.push(file);
  await mkdir(dirname(output), { recursive: true });
  const temp = `${output}.${process.pid}.${Date.now()}.tmp`;
  let stream, failure;
  try {
    stream = createWriteStream(temp, { flags: 'wx' });
    stream.on('error', error => { failure = error; });
    const zip = new Zip((error, data, final) => {
      if (error) { failure = error; stream.destroy(error); return; }
      stream.write(data);
      if (final) stream.end();
    });
    const add = async (name, source) => {
      const entry = new ZipDeflate(`Magna Urbis V2/${name}`, { level: 3 });
      zip.add(entry);
      if (typeof source === 'string') {
        for await (const chunk of createReadStream(source)) {
          if (failure) throw failure;
          entry.push(chunk);
          if (stream.writableNeedDrain) await once(stream, 'drain');
        }
        entry.push(new Uint8Array(0), true);
      } else entry.push(source, true);
      if (stream.writableNeedDrain) await once(stream, 'drain');
      if (failure) throw failure;
    };
    await add('README.txt', new TextEncoder().encode(readme));
    await add('magna-urbis-v2-desktop.exe', binary);
    for (const file of files) await add(`resources/${file.name}`, file.path);
    zip.end(); await finished(stream);
    await rename(temp, output);
  } catch (error) {
    stream?.destroy(); await rm(temp, { force: true }); throw error;
  }
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = Object.fromEntries(process.argv.slice(2).map(arg => {
    const match = /^--(binary|resources|output)=(.+)$/.exec(arg);
    if (!match) throw new Error(`Expected --binary=, --resources= or --output=: ${arg}`);
    return [match[1], match[2]];
  }));
  if (!options.output) throw new Error('Provide --output=<zip path>');
  const target = join(root, 'rust/desktop-v2/target/release');
  const result = await createPortable({ binary: options.binary ?? join(target, 'magna-urbis-v2-desktop.exe'), resources: options.resources ?? join(target, 'resources'), output: options.output });
  console.log(`Created ${basename(result)}`);
}
