import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../..', import.meta.url)), windows = process.platform === 'win32';
const environment = join(root, '.venv-illustration'), interpreter = join(environment, windows ? 'Scripts/python.exe' : 'bin/python');
const args = process.argv.slice(2), setup = args.includes('--setup');
function run(command, args) {
  return new Promise((resolve, reject) => { const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(Error(`Le processus s’est arrêté (${code}).`))); });
}
try {
  if (setup) {
    if (!existsSync(interpreter)) await run(process.env.MAGNA_ILLUSTRATION_BOOTSTRAP_PYTHON || (windows ? 'py' : 'python3'), windows ? ['-3.12', '-m', 'venv', environment] : ['-m', 'venv', environment]);
    await run(interpreter, ['-m', 'pip', 'install', '-r', 'illustration/requirements.txt', '--extra-index-url', 'https://download.pytorch.org/whl/cu128']);
  } else {
    const python = process.env.MAGNA_ILLUSTRATION_PYTHON || interpreter;
    if (!existsSync(python)) throw Error('Exécutez npm run illustration:setup pour créer le service d’illustration.');
    await run(python, ['-u', '-m', 'illustration', ...args]);
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
