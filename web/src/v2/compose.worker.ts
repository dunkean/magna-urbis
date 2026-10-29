import { composeTerrain, composeUrbanRecipe } from './compose';
import { parseProject } from './project';
import type { V2Settings, V2Project } from './contracts';
import type { World } from '../gen/types';
import { resultTransferBuffers } from './transfer';

export interface ComposeWorkerRequest {
  scope: 'terrain' | 'urban';
  text: string;
  current: V2Settings;
  world?: World;
  mods?: unknown[];
}
export type ComposeWorkerResponse = { result: V2Project } | { error: string };
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async ({ data }: MessageEvent<ComposeWorkerRequest>) => {
  try {
    const source = parseProject(data.text);
    if (data.scope !== 'terrain' && data.scope !== 'urban') throw new Error('Type de composition inconnu.');
    if (data.scope === 'urban' && !data.world) throw new Error('Créez ou ouvrez d’abord le territoire qui recevra cette recette.');
    const result = data.scope === 'terrain' ? await composeTerrain(source, data.current)
      : await composeUrbanRecipe(source, data.world!, data.current, data.mods);
    scope.postMessage({ result } satisfies ComposeWorkerResponse, resultTransferBuffers(result));
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) } satisfies ComposeWorkerResponse);
  }
};
