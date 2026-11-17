import type { World } from '../gen/types';
import type { V2Progress, V2Settings, V2TownStage } from './contracts';
import { generationValidityKeys, savedGenerationKey } from './stageValidity';
import { stageById, stagesOf, type StageDef, type StageFamily } from './stageRegistry';
import { registerMessages } from './i18n';
import { refreshEngineIdentity } from './runtimeChoices';

const copy = (en: string, fr: string) => { registerMessages({ [en]: { en, fr } }); return en; };
/** Stages a full generation keeps because their recipe and engine build are unchanged: said, never silent. */
export const REUSED = {
  terrain: copy('Terrain reused (unchanged recipe)', 'Relief réutilisé (recette inchangée)'),
  placement: copy('Settlement placement and roads reused (unchanged recipe and engine)', 'Placement des lieux et routes réutilisés (recette et moteur inchangés)'),
  all: copy('Nothing to regenerate: every stage reused', 'Rien à régénérer : toutes les étapes réutilisées'),
};

export type FullGenerationAction = 'terrain' | 'region' | 'roads' | 'towns';

function cityProducts(settings: V2Settings, world: World, targets?: readonly string[]) {
  const backend = settings.urban?.backend ?? settings.runtime?.backend ?? 'typescript';
  return (world.settlements ?? []).filter(place => (!targets || targets.includes(place.key))
    && (backend !== 'typescript' || place.detail !== 'farmstead'))
    .map(place => [place.key, generationValidityKeys(settings, world, place.key)] as const);
}

/** The first missing/stale product in the whole chain, independent of the tab. */
export function firstPendingGeneration(settings: V2Settings, world?: World, targets?: readonly string[]): StageDef | undefined {
  if (!world || world.stats['v2.previewStage']) return stageById.get('relief-source');
  const keys = generationValidityKeys(settings, world);
  const pending = (id: string) => savedGenerationKey(world, id) !== keys.get(id);
  if (pending('terrain')) {
    return stagesOf('region', settings.terrain?.procedural?.coastAfter).find(stage => keys.has(stage.id) && pending(stage.id))
      ?? stageById.get('relief-source');
  }
  const placement = stagesOf('settlements').find(stage => pending(stage.id));
  if (placement) return placement;
  const cityKeys = cityProducts(settings, world, targets);
  return stagesOf('cities').find(stage => cityKeys.some(([town, current]) => savedGenerationKey(world, stage.id, town) !== current.get(stage.id)));
}

/** Recheck after each action: terrain and placement replace downstream products,
 * and the city target list may change when placement is regenerated. */
export async function runRemainingGeneration(_family: StageFamily, api: {
  settings(): V2Settings;
  world(): World | undefined;
  generate(action: FullGenerationAction, keys?: string[], through?: V2TownStage): Promise<boolean>;
  targets(): string[] | undefined;
  redraw(): Promise<void>;
  /** Log line of each stage kept as it is. */
  progress?(progress: V2Progress): void;
}): Promise<boolean> {
  // A rebuilt or restarted engine is another binary: read its identity before deciding what is still valid.
  await refreshEngineIdentity(api.settings());
  let first = firstPendingGeneration(api.settings(), api.world(), api.targets());
  if (!first) { if (api.world()) api.progress?.({ stage: 'reused', label: REUSED.all, completed: 1, total: 1 }); return true; }
  const reused = (label: string) => api.progress?.({ stage: 'reused', label, completed: 0, total: 0 });
  if (first.family !== 'region') reused(REUSED.terrain);
  if (first.family === 'cities') reused(REUSED.placement);
  if (first.family === 'region') {
    if (!await api.generate('terrain')) return false;
    first = firstPendingGeneration(api.settings(), api.world(), api.targets());
  }
  if (first?.family === 'settlements') {
    const settings = api.settings();
    const roadsOnly = first.id === 'settle-roads' && settings.runtime?.backend && settings.runtime.backend !== 'typescript';
    if (!await api.generate(roadsOnly ? 'roads' : 'region')) return false;
    first = firstPendingGeneration(api.settings(), api.world(), api.targets());
  }
  if (first?.family === 'cities') {
    const world = api.world()!;
    const keys = cityProducts(api.settings(), world, api.targets())
      .filter(([town, current]) => stagesOf('cities').some(stage => savedGenerationKey(world, stage.id, town) !== current.get(stage.id)))
      .map(([town]) => town);
    if (!keys.length) return false;
    // Explicitly complete the chain even if a previous preview stopped at layout.
    if (!await api.generate('towns', keys, 'buildings')) return false;
  }
  await api.redraw();
  return true;
}
