/** Extract and smoke-test a Windows portable ZIP in an isolated temporary folder. */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') throw Error('The portable desktop smoke test requires Windows and WebView2.');
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const zipArg = process.argv.slice(2);
if (zipArg.length !== 1 || !zipArg[0].startsWith('--zip=')) throw Error('Use --zip=<portable ZIP path>.');
const zip = resolve(zipArg[0].slice('--zip='.length));
const tempRoot = join(root, '.tmp');
await mkdir(tempRoot, { recursive: true });
const isolated = await mkdtemp(join(tempRoot, 'portable-smoke-'));
const extract = String.raw`
import pathlib, shutil, stat, sys, zipfile
archive, destination = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
total = 0
with zipfile.ZipFile(archive) as z:
    members = z.infolist()
    for member in members:
        name = member.filename
        parts = pathlib.PurePosixPath(name).parts
        if not parts or name.startswith('/') or chr(92) in name or ':' in name or any(part in ('.', '..') for part in parts):
            raise ValueError('Unsafe ZIP path: ' + name)
        if stat.S_ISLNK(member.external_attr >> 16):
            raise ValueError('ZIP symlinks are not supported: ' + name)
        total += member.file_size
        if total > 2 * 1024 * 1024 * 1024:
            raise ValueError('Portable ZIP exceeds 2 GiB unpacked')
    for member in members:
        path = destination.joinpath(*pathlib.PurePosixPath(member.filename).parts)
        if member.is_dir():
            path.mkdir(parents=True, exist_ok=True)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            with z.open(member) as src, path.open('xb') as dest:
                shutil.copyfileobj(src, dest, 1024 * 1024)
    candidates = list(destination.rglob('magna-urbis-v2-desktop.exe'))
    if len(candidates) != 1:
        raise ValueError(f'Expected one desktop executable, found {len(candidates)}')
    print(candidates[0])
`;
function run(command, args, options = {}) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    child.once('error', fail);
    child.once('exit', (code, signal) => code === 0 ? done() : fail(Error(`${command} failed: ${signal ?? code}`)));
  });
}
let failure;
try {
  let output = '';
  const python = process.env.MAGNA_TEST_PYTHON || 'python';
  await new Promise((done, fail) => {
    const child = spawn(python, ['-c', extract, zip, isolated], { windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'] });
    child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => { output += chunk; });
    child.once('error', fail);
    child.once('exit', (code, signal) => code === 0 ? done() : fail(Error(`ZIP extraction failed: ${signal ?? code}`)));
  });
  const binary = output.trim();
  if (!isAbsolute(binary)) throw Error('ZIP extraction did not return an absolute executable path.');
  await run(process.execPath, [join(root, 'web/scripts/v2_desktop_check.mjs'), `--binary=${binary}`, '--timeout=60000'], { cwd: isolated, stdio: 'inherit' });
  console.log(`Portable ZIP passed the isolated desktop smoke test: ${zip}`);
} catch (error) { failure = error; }
finally {
  try {
    const parent = await realpath(tempRoot), target = await realpath(isolated), within = relative(parent, target);
    if (!within || within === '..' || within.startsWith(`..\\`) || isAbsolute(within)) throw Error(`Unsafe cleanup target: ${target}`);
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch (error) { failure ??= Error(`Could not remove isolated portable files: ${error.message}`); }
}
if (failure) { console.error(failure.stack ?? String(failure)); process.exitCode = 1; }
