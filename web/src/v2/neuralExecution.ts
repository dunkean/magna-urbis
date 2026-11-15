import type { ComputePreference } from './platform';

/** Generation and its download preflight must reject the same unsupported compute choice. */
export function assertNeuralCompute(usesNeural: boolean, compute: ComputePreference = 'auto'): void {
  if (usesNeural && compute === 'cpu') throw new Error('Les moteurs neuronaux actuels nécessitent WebGPU ou un service GPU local. Le relief procédural fonctionne sur CPU.');
}
