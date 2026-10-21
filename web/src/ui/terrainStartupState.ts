import type { TerrainSource } from '../../../rust/bridge/terrain';

/** Resolve the source before the renderer, assets and engine are imported. */
export function initialTerrainSource(params: URLSearchParams, neuralDefault: string): TerrainSource {
  const requested = params.get('source');
  if (requested === 'neural' && !params.has('neural')) return 'neural-python';
  if (requested === 'procedural' || requested === 'neural' || requested === 'neural-wasm' || requested === 'neural-python') return requested;
  return neuralDefault === 'neural-python' ? 'neural-python' : 'neural-wasm';
}

export interface NeuralServiceState { state: string; message: string; loaded?: boolean }
export function neuralModelLabel(status: NeuralServiceState): string {
  if (status.state === 'error') return `Service neuronal indisponible · ${status.message}`;
  if (status.state === 'loading') return 'Chargement des modèles sur le GPU…';
  if (status.loaded) return status.state === 'generating' ? 'Modèles chargés · calcul sur le GPU…' : 'Modèles chargés · GPU prêt';
  return status.state === 'ready' ? 'Service prêt · modèles chargés au premier calcul' : status.message;
}
