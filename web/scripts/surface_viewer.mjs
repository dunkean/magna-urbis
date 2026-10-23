import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const project = fileURLToPath(new URL('../../viewer-local/', import.meta.url));
const args = process.argv.slice(2);
const option = args.indexOf('--godot');
let godot = process.env.GODOT;
if (option >= 0) { godot = args[option + 1]; args.splice(option, 2); }
godot ??= ['godot', 'godot4'].find(name => spawnSync(name, ['--version'], { windowsHide: true, stdio: 'ignore' }).status === 0);
if (!godot) throw new Error('Set GODOT or pass --godot <Godot 4.7.2 executable>. See viewer-local/README.md.');
if (!existsSync(path.join(project, 'addons/terrain_3d/terrain.gdextension'))) {
  if (process.platform !== 'win32') throw new Error('Install pinned Terrain3D archive as described in viewer-local/README.md.');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(project, 'bootstrap.ps1'), '-Godot', godot], { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const check = args.indexOf('--check');
if (check >= 0) {
  args.splice(check, 1);
  const result = spawnSync(godot, ['--headless', '--path', project, '--check-only', '--script', 'scene/main.gd'], { stdio: 'inherit', windowsHide: true });
  process.exit(result.status ?? 1);
}
if (!args.includes('--world')) throw new Error('Required: --world <surface-world.json>. Options: --assets <resolved.json> --top --width <metres> --live-url <url> --capture <png> --frames 120 --metrics <json> --tour <directory>.');
const result = spawnSync(godot, ['--path', project, '--', ...args], { stdio: 'inherit', windowsHide: true });
process.exit(result.status ?? 1);
