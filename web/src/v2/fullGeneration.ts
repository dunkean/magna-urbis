import type { StageFamily } from './stageRegistry';

export type FullGenerationAction = 'all' | 'region' | 'towns';

/** Continue the existing UI actions from the selected family, without running upstream stages. */
export async function runRemainingGeneration(family: StageFamily, api: {
  generate(action: FullGenerationAction, keys?: string[]): Promise<boolean>;
  targets(): string[] | undefined;
  redraw(): Promise<void>;
}): Promise<boolean> {
  if (family === 'region') return api.generate('all');
  if (family === 'map') { await api.redraw(); return true; }
  if (family === 'settlements' && !await api.generate('region')) return false;
  const keys = api.targets();
  if (keys && !keys.length) return false;
  return api.generate('towns', keys);
}
