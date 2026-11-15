import { copyFile, lstat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export const TERRAIN_PYTHON_SCRIPTS = Object.freeze(['neural_python.py', 'neural_model_catalog.py', 'neural_refinement.py', 'neural_sampling.py']);
/** Staging and package validation share the Python service's local modules. */
export async function stageTerrainPythonScripts(web, destination) {
  await mkdir(destination, { recursive: true });
  for (const name of TERRAIN_PYTHON_SCRIPTS) await copyFile(join(web, 'scripts', name), join(destination, name));
}

export function requiredResources(platform) {
  return [
    `magna-urbis-local${platform === 'windows-x64' ? '.exe' : ''}`,
    `magna-urbis-neural${platform === 'windows-x64' ? '.exe' : ''}`,
    'rust/models/neural-earth/desktop-profile.json',
    `bin/uv${platform === 'windows-x64' ? '.exe' : ''}`,
    'bin/LICENSE-UV-MIT', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'python_runtime/runtime_manager.py', 'scripts/neural_release.py',
    ...['__init__.py', '__main__.py', 'context.py', 'images.py', 'local.py', 'providers.py', 'service.py', 'settings.py', 'requirements.txt'].map(name => `illustration/${name}`),
    ...TERRAIN_PYTHON_SCRIPTS.map(name => `web/scripts/${name}`),
    ...['__init__.py', 'features.py', 'tile40_conditioning.py', 'tile40_export_utils.py', 'tile40_flow_network.py', 'tile40_flow_runtime.py', 'tile40_height.py', 'tile40_runtime.py'].map(name => `web/scripts/neural_earth_tile40/${name}`),
    ...['catalog.json', 'model-inventory.json', 'coarse-config.json', 'pipeline-config.json', 'LICENSE-TEACHER.txt'].map(name => `rust/models/neural-earth/${name}`),
  ];
}
export async function checkResources(resources, platform) {
  for (const path of requiredResources(platform)) {
    const file = join(resources, path);
    const info = await lstat(file).catch(() => null);
    if (!info?.isFile() || !info.size) throw new Error(`Missing or empty desktop resource: ${file}`);
  }
}
