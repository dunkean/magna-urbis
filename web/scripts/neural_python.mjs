import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';
const python = process.env.MAGNA_NEURAL_PYTHON ?? fileURLToPath(new URL(process.platform === 'win32'
  ? '../../../infinite_map/.venv/Scripts/python.exe' : '../../../infinite_map/.venv/bin/python', import.meta.url));
await access(python);
const child = spawn(python, ['-u', fileURLToPath(new URL('./neural_python.py', import.meta.url)), ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
