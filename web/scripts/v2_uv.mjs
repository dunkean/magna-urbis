/** Stage a pinned, checksum-verified uv binary. Run only during desktop builds. */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, copyFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

export const UV_VERSION = '0.13.6';
const profiles = {
  win32: { archive: 'uv-x86_64-pc-windows-msvc.zip', sha256: 'a2a8820d5eea32f08ef467ef3b7f66883a9b076d5737a2fc2fbb5f458d1bb50f', binary: 'uv.exe' },
  linux: { archive: 'uv-x86_64-unknown-linux-gnu.tar.gz', sha256: 'f29c3e94ffabd7e6f3ba521dba169a9b7ec12100bf3257087f0f24f6123f3645', binary: 'uv' },
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function stageUv(destination) {
  const profile = profiles[process.platform];
  if (!profile || process.arch !== 'x64') throw Error('Desktop release supports Windows/Linux x64. Use an existing Python environment on other platforms.');
  await mkdir(destination, { recursive: true });
  const target = join(destination, profile.binary), metadata = join(destination, 'uv-version.json');
  try {
    const saved = JSON.parse(await readFile(metadata, 'utf8'));
    if (saved.version === UV_VERSION && saved.sha256 === hash(await readFile(target)) && (await readFile(join(destination, 'LICENSE-UV-MIT'), 'utf8')).includes('MIT')) return target;
  } catch { /* First build or altered staging file: fetch the verified archive again. */ }
  const url = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${profile.archive}`;
  console.log(`Desktop: downloading uv ${UV_VERSION} (${profile.archive})…`);
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw Error(`uv download failed: HTTP ${response.status}`);
  const archive = new Uint8Array(await response.arrayBuffer());
  if (hash(archive) !== profile.sha256) throw Error('uv archive failed its pinned SHA-256 check.');
  if (process.platform === 'win32') {
    const files = unzipSync(archive);
    const key = Object.keys(files).find(name => name === 'uv.exe' || name.endsWith('/uv.exe'));
    if (!key) throw Error('uv executable missing in release archive');
    await writeFile(target, files[key]);
  } else {
    const temporary = await mkdtemp(join(tmpdir(), 'magna-uv-'));
    try {
      const path = join(temporary, profile.archive); await writeFile(path, archive);
      await new Promise((done, reject) => {
        const child = spawn('tar', ['-xzf', path, '-C', temporary], { stdio: 'inherit' });
        child.once('error', reject); child.once('exit', code => code === 0 ? done() : reject(Error(`tar exited ${code}`)));
      });
      const directories = await readdir(temporary, { withFileTypes: true });
      const extracted = directories.find(entry => entry.isDirectory() && entry.name.startsWith('uv-'));
      if (!extracted) throw Error('uv directory missing in release archive');
      await copyFile(join(temporary, extracted.name, 'uv'), target); await chmod(target, 0o755);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
  await writeFile(metadata, JSON.stringify({ version: UV_VERSION, archive: profile.archive, archiveSha256: profile.sha256, sha256: hash(await readFile(target)), source: url }, null, 2) + '\n');
  const license = await fetch(`https://raw.githubusercontent.com/astral-sh/uv/${UV_VERSION}/LICENSE-MIT`, { signal: AbortSignal.timeout(30000) });
  if (!license.ok) throw Error(`uv license download failed: HTTP ${license.status}`);
  await writeFile(join(destination, 'LICENSE-UV-MIT'), await license.text());
  return target;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await stageUv(resolve(process.argv[2] ?? '../rust/desktop-v2/resources/bin'));
}
