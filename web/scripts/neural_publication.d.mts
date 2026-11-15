import type { NeuralManifest } from '../../rust/bridge/neuralModels';
export function stageNeuralPublication(prepared: string, destination: string): Promise<NeuralManifest>;
