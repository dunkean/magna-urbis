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

  const canSelect = (): boolean => !!state.world && !state.busy && !state.previewBase && !state.city3d?.active;
  // A road session is finished (one rebuild of the affected towns) or cancelled from the bar's Finish and Close.
  state.editingTools = mountEditingTools({ canSelect, canEdit: () => canSelect() && atTopView(state), roadSession: () => state.roadEditor.active() || state.roadEditor.pending(), finishRoads: () => state.roadEditor.validate(), cancelRoads: () => state.roadEditor.cancel() });
}

/** The editors work on the top view of the map: not behind the separate 3D view, nor while the camera is tilted or
 * turned (their overlays use the 2D mapping). "Select on map" picks in a tilted view as well (worldPicking.ts). */
export function atTopView(state: PageState): boolean {
  return !isTilted(state.client.viewer.getView());
}
