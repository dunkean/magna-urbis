import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const project = fileURLToPath(new URL('../../viewer-local/', import.meta.url));
const args = process.argv.slice(2);
if (!args.includes('--style-catalogue')) args.push('--style-catalogue', fileURLToPath(new URL('../../surface/presentation/palettes.json', import.meta.url)));
const rendering = args.indexOf('--renderer');
const renderer = rendering >= 0 ? args[rendering + 1] : 'forward_plus';
if (!['forward_plus', 'mobile', 'gl_compatibility'].includes(renderer)) throw new Error('Renderer must be forward_plus, mobile, or gl_compatibility.');
if (rendering >= 0) args.splice(rendering, 2);
const option = args.indexOf('--godot');
let godot = process.env.GODOT;
if (option >= 0) { godot = args[option + 1]; args.splice(option, 2); }
godot ??= ['godot', 'godot4'].find(name => spawnSync(name, ['--version'], { windowsHide: true, stdio: 'ignore' }).status === 0);
if (!godot) throw new Error('Set GODOT or pass --godot <Godot 4.7.2 executable>. See viewer-local/README.md.');
if (godot.includes('/') || godot.includes('\\')) godot = path.resolve(godot);
const version = spawnSync(godot, ['--version'], { encoding: 'utf8', windowsHide: true });
if (!/^4\.7\.2\.stable\./m.test(version.stdout ?? '')) throw new Error(`Expected pinned Godot 4.7.2 stable; got ${(version.stdout ?? version.stderr ?? '').trim()}`);
for (const name of ['--world', '--assets', '--vegetation-assets', '--capture', '--metrics', '--tour', '--stream-dir', '--style-catalogue']) {
  const index = args.indexOf(name);
  if (index < 0) continue;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} requires a path.`);
  args[index + 1] = path.resolve(args[index + 1]);
}
if (!existsSync(path.join(project, 'addons/terrain_3d/terrain.gdextension'))) {
  if (process.platform !== 'win32') throw new Error('Install pinned Terrain3D archive as described in viewer-local/README.md.');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(project, 'bootstrap.ps1'), '-Godot', godot], { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (!existsSync(path.join(project, '.godot/extension_list.cfg'))) {
  const imported = spawnSync(godot, ['--headless', '--path', project, '--editor', '--import', '--quit'], { stdio: 'inherit', windowsHide: true });
  if (imported.status !== 0) process.exit(imported.status ?? 1);
}
const check = args.indexOf('--check');
if (check >= 0) {
  args.splice(check, 1);
  const result = spawnSync(godot, ['--headless', '--path', project, '--script', 'diagnostics/check.gd'], { encoding: 'utf8', windowsHide: true });
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
  process.exit(/(?:SCRIPT|SHADER) ERROR|ERROR:/.test((result.stdout ?? '') + (result.stderr ?? '')) ? 1 : result.status ?? 1);
}
if (!args.includes('--world')) throw new Error('Required: --world <surface-world.json>. Options: --assets <resolved.json> --top --width <metres> --live-url <url> --capture <png> --frames 120 --metrics <json> --tour <directory>.');
const result = spawnSync(godot, ['--path', project, '--rendering-method', renderer, '--', ...args], { stdio: 'inherit', windowsHide: true });
process.exit(result.status ?? 1);
