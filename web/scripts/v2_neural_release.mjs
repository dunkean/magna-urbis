/** Recreate the public desktop model assets from pinned upstream inputs. No GPU or Python. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const profile = JSON.parse(await readFile(join(root, 'rust/models/neural-earth/desktop-profile.json'), 'utf8'));
const catalog = JSON.parse(await readFile(join(root, 'rust/models/neural-earth/catalog.json'), 'utf8'));
const inventory = JSON.parse(await readFile(join(root, 'rust/models/neural-earth/model-inventory.json'), 'utf8'));
const args = Object.fromEntries(
  process.argv.slice(2).map(arg => {
    const match = /^--([\w-]+)=(.+)$/.exec(arg);
    if (!match) throw Error(`Expected --name=value: ${arg}`);
    return [match[1], match[2]];
  }),
);
const output = resolve(args.output ?? join(root, 'release-v2/models'));
const cache = join(root, 'web/out/desktop-model-sources');
const hash = data => createHash('sha256').update(data).digest('hex');
await mkdir(output, { recursive: true });
await mkdir(cache, { recursive: true });
async function obtain(name, url, sha256) {
  const path = join(cache, name);
  let bytes = await readFile(path).catch(() => undefined);
  if (!bytes || hash(bytes) !== sha256) {
    console.log(`Downloading pinned model source ${name}…`);
    const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
    if (!response.ok) throw Error(`Download ${name}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (hash(bytes) !== sha256) throw Error(`Integrity mismatch: ${name}`);
    await writeFile(path, bytes);
  }
  return { path, bytes };
}
const students = {};
for (const name of ['coarse4', 'decoder64']) {
  const model = inventory.models[name];
  students[name] = (await obtain(model.file, `https://huggingface.co/${catalog.distribution.repo}/resolve/${catalog.distribution.revision}/${model.file}`, model.sha256)).path;
}
const binary = resolve(args.binary ?? join(root, 'rust/target/release', `magna-urbis-neural${process.platform === 'win32' ? '.exe' : ''}`));
await new Promise((done, reject) => {
  const child = spawn(binary, ['prepare-models', '--coarse', students.coarse4, '--decoder', students.decoder64, '--output', output], { stdio: 'inherit', windowsHide: true });
  child.once('error', reject);
  child.once('exit', code => (code === 0 ? done() : reject(Error(`Model preparation exited ${code}`))));
});
const upstream = 'https://github.com/dunkean/neural-earth/releases/download/base-nf4-b75-v1';
const manifest = (await obtain('b75-manifest.json', `${upstream}/manifest.json`, '5fd0bd9d5d759674fa27df5d0375d7dcbf093a2a57cf80897816376087534b93')).bytes;
const weights = (await obtain('b75-weights.bin', `${upstream}/weights.bin`, '4f84df2853aecb830b7cf4bee60572e08e2503232a25d7ebaaee0231930d6dd2')).bytes;
const header = Buffer.from(JSON.stringify(JSON.parse(manifest)));
const length = Buffer.alloc(8);
length.writeBigUInt64LE(BigInt(header.length));
await writeFile(join(output, 'base.nf4'), Buffer.concat([length, header, weights]));
const sums = [];
for (const model of profile.models) {
  const bytes = await readFile(join(output, model.file));
  if (bytes.length !== model.bytes || hash(bytes) !== model.sha256) throw Error(`Prepared model differs from the supported desktop profile: ${model.file}`);
  sums.push(`${model.sha256}  ${model.file}`);
}
await copyFile(join(root, 'rust/models/neural-earth/LICENSE-TEACHER.txt'), join(output, 'LICENSE-NEURAL-MODELS.txt'));
await copyFile(join(root, 'rust/models/neural-earth/desktop-profile.json'), join(output, 'desktop-neural-profile.json'));
await writeFile(join(output, 'SHA256SUMS-neural-models.txt'), `${sums.join('\n')}\n`);
console.log(`Verified ${profile.profile}: ${profile.models.reduce((n, m) => n + m.bytes, 0)} bytes in ${output}`);
