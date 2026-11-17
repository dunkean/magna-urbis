// "Reset" of the top bar: every generation and display setting back to a fresh page's defaults.
// The engine/profile choice stays; the interface language and saved projects live outside the recipe.
import type { V2Settings } from './contracts';
import type { World } from '../gen/types';
import { defaultSettings } from './settings';
import { applySceneClock, DEFAULT_SCENE } from './sceneClock';
import { registerMessages } from './i18n';

export const RESET_LABEL = 'Reset';
export const RESET_TITLE = 'Reset every setting to its default';
export const RESET_CONFIRM = 'Reset every setting to its default? The current map stays until you generate again.';
export const RESET_DONE = 'Settings reset to their defaults. Generate to apply them.';
registerMessages({
  [RESET_LABEL]: { en: RESET_LABEL, fr: 'Réinitialiser' },
  [RESET_TITLE]: { en: RESET_TITLE, fr: 'Remettre chaque réglage à sa valeur par défaut' },
  [RESET_CONFIRM]: { en: RESET_CONFIRM, fr: 'Remettre chaque réglage à sa valeur par défaut ? La carte actuelle reste affichée jusqu’à la prochaine génération.' },
  [RESET_DONE]: { en: RESET_DONE, fr: 'Réglages remis à leurs valeurs par défaut. Lancez la génération pour les appliquer.' },
});

/** Checkpoints the Python neural service loads: part of the neural source choice, not of the map recipe. */
const TERRAIN_PROFILE = ['coarseModel', 'baseModel', 'decoderModel'] as const;

/** The settings of a fresh page, keeping the runtime choice (engine, neural source, services) of `current`.
 * Region, settlements, cities, appearance, naming and every local/building/place override are dropped. */
export function resetSettings(current: V2Settings): V2Settings {
  const next = defaultSettings();
  applySceneClock(next, DEFAULT_SCENE);
  next.generation = current.generation;
  if (current.runtime) {
    const { engineBuilds: _run, ...runtime } = current.runtime;
    next.runtime = structuredClone(runtime);
  }
  if (current.urban?.backend) next.urban = { backend: current.urban.backend };
  for (const key of TERRAIN_PROFILE) {
    const value = current.terrain?.[key];
    if (value !== undefined) (next.terrain ??= {})[key] = value as never;
  }
  return next;
}

/** Forget which stages each map was built from: the next Full generation runs again from the relief. */
export function markAllStagesStale(...worlds: (World | undefined)[]): void {
  for (const world of new Set(worlds)) {
    if (!world) continue;
    for (const name of Object.keys(world.stats)) if (name.startsWith('v2.valid:')) delete world.stats[name];
  }
}
