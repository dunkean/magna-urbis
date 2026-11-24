/**
 * Assembles the page operations (`PageActions` in `contract.ts`) from their owner modules. main.ts calls it once,
 * before the first mount: the control callbacks wired by the mounts call these operations later (user events, runs,
 * the boot), and an operation reads the controls it needs from the state at call time. Building them creates
 * closures only: no state read, no DOM work.
 */
import type { PageActions, PageState } from './contract';
import { createPlacesActions } from './places';
import { createStageChainActions } from './stageChain';
import { createAppearanceActions } from './appearance';
import { createRuntimeActions } from './runtime';
import { createMapEditingActions } from './mapEditing';
import { createSettingsActions } from './settings';
import { createStatusActions } from './status';
import { createGenerationActions } from './generation';
import { createTownInspector } from './townInspector';
import { createHouseInspector } from './houseInspector';
import { createSubdivisionInspector } from './subdivisionInspector';
import { createEntitySheet } from './entitySheet';
import { createProjectsActions } from './projects';
import { createExportsActions } from './exports';

export function createPageActions(state: PageState): PageActions {
  // Each owner receives the finished object: its operations call the others only once start-up has run.
  const actions = {} as PageActions;
  return Object.assign(
    actions,
    createPlacesActions(state, actions),
    createStageChainActions(state, actions),
    createAppearanceActions(state, actions),
    createRuntimeActions(state, actions),
    createMapEditingActions(state, actions),
    createSettingsActions(state, actions),
    createStatusActions(state, actions),
    createGenerationActions(state, actions),
    createTownInspector(state, actions),
    createHouseInspector(state, actions),
    createSubdivisionInspector(state, actions),
    createEntitySheet(state, actions),
    createProjectsActions(state, actions),
    createExportsActions(state, actions),
  );
}
