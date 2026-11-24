/**
 * The selection tool of the view strip, the inspection level selector next to "Select on map" (the same switch), and the
 * editing tools that switch the map between navigation, selection and the editors of the workbench bar.
 */
import type { PageState } from './contract';
import { insertHTML, registerMessages } from '../i18n';
import { mountEditingTools } from '../editingTools';
import { isTilted } from '../../render/world/camera';
import { $ } from './dom';

registerMessages({
  Select: { en: 'Select', fr: 'Sélectionner' },
  'Select on the map: click a place, a building, a road, a wall or a river to see its sheet.': {
    en: 'Select on the map: click a place, a building, a road, a wall or a river to see its sheet.',
    fr: 'Sélectionner sur la carte : cliquez un lieu, un bâtiment, une route, une enceinte ou une rivière pour voir sa fiche.',
  },
  Anything: { en: 'Anything', fr: 'Tout' },
});
const SELECT_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M5 3.5 18.5 12l-6 1.6L9 19.5z"/><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="m13.5 14.5 4 6"/></svg>';

export function mountEditingToolbar(state: PageState): void {
  insertHTML(
    $('#measure-tool'),
    'beforebegin',
    `<button id="select-tool" type="button" class="measure-tool-button" aria-pressed="false" aria-label="Select" title="Select on the map: click a place, a building, a road, a wall or a river to see its sheet.">${SELECT_ICON}</button>`,
  );
  insertHTML(
    $('#inspect-mode').parentElement!,
    'beforeend',
    `<select id="inspect-target" aria-label="Inspection level" style="width:90px;padding:3px 5px;font-size:10px"><option value="any">Anything</option><option value="settlement">Settlements</option><option value="quarter">Quarter</option><option value="block">Block</option><option value="parcel">Parcel</option><option value="house">House</option></select>`,
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
