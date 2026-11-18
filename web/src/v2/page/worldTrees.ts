/**
 * The "3D trees" switch and the tree distance of the single camera: in the workbench bar beside the "3D" button,
 * shown while the map is tilted (the modelled trees stand only in a tilted view) and only for the looks that model
 * their near trees (worldTreesAvailable). They write the appearance's `city.trees3d` and `city.treeDistance`, as the
 * separate 3D view's toolbar did; the trees layer reads them (v2/display/worldVolumes.ts). Mounted by view3d.ts for
 * the single camera; with `?camera=dual` the separate 3D view keeps its own controls.
 */
import { applyAppearancePatch, type AppearancePatch } from '../../render/appearanceRecipe';
import { isTilted } from '../../render/world/camera';
import { clampTreeDistance } from '../../ui/terrain3dTrees';
import { resolveSettingsAppearance } from '../appearance';
import { worldTreesAvailable } from '../display/worldVolumes';
import { insertHTML, registerMessages } from '../i18n';
import type { PageActions, PageState } from './contract';
import { $ } from './dom';

registerMessages({
  '3D trees': { en: '3D trees', fr: 'Arbres 3D' },
  'Tree distance': { en: 'Tree distance', fr: 'Distance des arbres' },
  'Modelled trees near the camera (satellite looks)': { en: 'Modelled trees near the camera (satellite looks)', fr: 'Arbres modélisés près de la caméra (sols satellite)' },
  'Display distance of the modelled trees (m)': { en: 'Display distance of the modelled trees (m)', fr: 'Distance d’affichage des arbres modélisés (m)' },
});

export function mountWorldTreeControls(state: PageState, actions: PageActions): void {
  insertHTML(
    $('#view3d'),
    'afterend',
    '<label id="world-trees" hidden title="Modelled trees near the camera (satellite looks)"><input type="checkbox" id="world-trees-on"> 3D trees</label>' +
      '<label id="world-tree-distance" hidden title="Display distance of the modelled trees (m)">Tree distance <input type="range" id="world-tree-distance-range" min="200" max="1500" step="100"></label>',
  );
  const switchLabel = $('#world-trees'),
    distanceLabel = $('#world-tree-distance'),
    on = $<HTMLInputElement>('#world-trees-on'),
    distance = $<HTMLInputElement>('#world-tree-distance-range');
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
  state.client.viewer.onCamera(view => {
    if (tilted === isTilted(view)) return;
    tilted = !tilted;
    sync();
  });
  on.onchange = () => {
    distanceLabel.hidden = !on.checked;
    write({ city: { trees3d: on.checked } });
  };
  distance.onchange = () => write({ city: { treeDistance: clampTreeDistance(Number(distance.value)) } });
}
