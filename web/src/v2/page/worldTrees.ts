/**
 * The "3D trees" switch and the tree distance, in the bar of the tilted map (worldNavigation.ts, mounted before this),
 * shown while the map is tilted (the modelled trees stand only in a tilted
 * view) and only for the looks that model their near trees (worldTreesAvailable: not the fast satellite, whose switch
 * is hidden with its setting kept). They write the appearance's `city.trees3d` and `city.treeDistance`; the trees
 * layer reads them (v2/display/worldVolumes.ts). Mounted by view3d.ts.
 */
import { applyAppearancePatch, type AppearancePatch } from '../../render/appearanceRecipe';
import { isTilted } from '../../render/world/camera';
import { TREE_DISTANCE_MIN, TREE_DISTANCE_MAX, clampTreeDistance } from '../../ui/terrain3dTrees';
import { machineDecision, onMachineDecision } from '../machineTier';
import { machineViewDefaults } from '../machineView';
import { resolveSettingsAppearance } from '../appearance';
import { worldTreesAvailable } from '../display/worldVolumes';
import { insertHTML, registerMessages } from '../i18n';
import type { PageActions, PageState } from './contract';
import { $ } from './dom';

registerMessages({
  '3D trees': { en: '3D trees', fr: 'Arbres 3D' },
  'Modelled trees near the camera (satellite looks)': { en: 'Modelled trees near the camera (satellite looks)', fr: 'Arbres modélisés près de la caméra (sols satellite)' },
  'Display distance of the modelled trees (m)': { en: 'Display distance of the modelled trees (m)', fr: 'Distance d’affichage des arbres modélisés (m)' },
});

export function mountWorldTreeControls(state: PageState, actions: PageActions): void {
  const bar = $('#world-bar');
  insertHTML(
    bar,
    'beforeend',
    '<label title="Modelled trees near the camera (satellite looks)" hidden><input type="checkbox" data-trees>3D trees</label>' +
      // The range follows the switch without its own words, so the tilted row keeps to 1600 px with the PNG button.
      `<label title="Display distance of the modelled trees (m)" data-tree-distance-label hidden><input type="range" data-tree-distance min="${TREE_DISTANCE_MIN}" max="${TREE_DISTANCE_MAX}" step="100" aria-label="Display distance of the modelled trees (m)"></label>`,
  );
  const on = bar.querySelector<HTMLInputElement>('[data-trees]')!,
    distance = bar.querySelector<HTMLInputElement>('[data-tree-distance]')!,
    switchLabel = on.closest('label')!,
    distanceLabel = bar.querySelector<HTMLElement>('[data-tree-distance-label]')!;
  let tilted = false;
  /** The controls follow the settings: a project load or a style change while tilted is shown at the next sync. */
  const sync = (): void => {
    const shown = tilted && worldTreesAvailable(state.world, state.settings);
    switchLabel.hidden = !shown;
    if (!shown) {
      distanceLabel.hidden = true;
      return;
    }
    const city = resolveSettingsAppearance(state.settings, state.world, 'view3d').city;
    on.checked = city.trees3d;
    distance.value = String(clampTreeDistance(city.treeDistance));
    distanceLabel.hidden = !city.trees3d;
  };
  const write = (patch: AppearancePatch): void => {
    state.settings.appearance = applyAppearancePatch(state.settings.appearance, state.settings.options.style, patch);
    state.projectRevision++;
    void actions.refreshAppearance();
  };
  let defaultDistance = machineViewDefaults(machineDecision().tier).treeDistance;
  onMachineDecision(choice => {
    const nextDistance = machineViewDefaults(choice.tier).treeDistance;
    if (nextDistance === defaultDistance) return;
    defaultDistance = nextDistance;
    sync();
    if (state.world && state.settings.appearance?.city?.treeDistance === undefined) void actions.refreshAppearance();
  });
  state.client.viewer.onCamera(view => {
    if (tilted === isTilted(view)) return;
    tilted = !tilted;
    sync();
  });
  // A look without modelled trees (the fast satellite) hides the switch at once. The select's own handler, which writes
  // the look, is set later (toolbar.ts) and so runs after this listener: the sync waits for it.
  $('#map-style').addEventListener('change', () => setTimeout(sync));
  on.onchange = () => {
    distanceLabel.hidden = !on.checked;
    write({ city: { trees3d: on.checked } });
  };
  distance.onchange = () => write({ city: { treeDistance: clampTreeDistance(Number(distance.value)) } });
}
