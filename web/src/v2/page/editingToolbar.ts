/**
 * The inspection level selector next to "Select on map", and the editing tools that switch the map between navigation,
 * selection and the editors of the workbench bar.
 */
import type { PageState } from './contract';
import { insertHTML } from '../i18n';
import { mountEditingTools } from '../editingTools';
import { isTilted } from '../../render/world/camera';
import { $ } from './dom';

export function mountEditingToolbar(state: PageState): void {
  insertHTML(
    $('#inspect-mode').parentElement!,
    'beforeend',
    `<select id="inspect-target" aria-label="Inspection level" style="width:90px;padding:3px 5px;font-size:10px"><option value="settlement">Settlements</option><option value="quarter">Quarter</option><option value="block">Block</option><option value="parcel">Parcel</option><option value="house">House</option></select>`,
  );

  // The tools pick on the top view of the map: not behind the separate 3D view, nor while the camera is tilted.
  state.editingTools = mountEditingTools({ canEdit: () => !!state.world && !state.busy && !state.previewBase && !state.city3d?.active && !isTilted(state.client.viewer.getView()) });
}
