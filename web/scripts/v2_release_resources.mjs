import { lstat } from 'node:fs/promises';
import { join } from 'node:path';

export function requiredResources(platform) {
  return [
    `magna-urbis-local${platform === 'windows-x64' ? '.exe' : ''}`,
    `bin/uv${platform === 'windows-x64' ? '.exe' : ''}`,
    'bin/LICENSE-UV-MIT', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'python_runtime/runtime_manager.py', 'scripts/neural_release.py',
    ...['__init__.py', '__main__.py', 'context.py', 'images.py', 'local.py', 'providers.py', 'service.py', 'settings.py', 'requirements.txt'].map(name => `illustration/${name}`),
    ...['neural_python.py', 'neural_model_catalog.py', 'neural_refinement.py'].map(name => `web/scripts/${name}`),
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
