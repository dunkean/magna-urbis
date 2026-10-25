import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../..', import.meta.url));
const interpreter = process.env.MAGNA_ILLUSTRATION_PYTHON || join(root, '.venv-illustration', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (!existsSync(interpreter)) throw Error('Exécutez npm run illustration:setup.');
const result = spawnSync(interpreter, ['-m', 'unittest', 'discover', '-s', 'illustration/tests', '-v'], { cwd: root, stdio: 'inherit', windowsHide: true });
process.exitCode = result.status ?? 1;
