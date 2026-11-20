/** View depth in the tilted toolbar, mounted by view3d. Saved in this browser independently of project/style settings:
 * dragging changes only per-frame LOD and haze; it never composes a town or writes an appearance patch. */
import { getViewDepth, setViewDepth } from '../../render/world/viewDepth';
import { machineDecision } from '../machineTier';
import { machineViewDefaults } from '../machineView';
import { insertHTML, registerMessages } from '../i18n';
import type { PageState } from './contract';
import { $ } from './dom';

const STORAGE_KEY = 'magna-urbis-v2-view-depth';

registerMessages({
  'View depth': { en: 'View depth', fr: 'Profondeur de vue' },
  'Extend building detail and visibility to the whole town (uses more GPU memory and triangles)': {
    en: 'Extend building detail and visibility to the whole town (uses more GPU memory and triangles)',
    fr: 'Étendre le détail et la visibilité des bâtiments à toute la ville (utilise plus de mémoire graphique et de triangles)',
  },
});

export function mountWorldDepthControl(state: PageState): void {
  const defaultDepth = machineViewDefaults(machineDecision().tier).viewDepth;
  try {
    setViewDepth(Number(globalThis.localStorage?.getItem(STORAGE_KEY) ?? defaultDepth));
  } catch {
    setViewDepth(defaultDepth);
  }
  const bar = $('#world-bar');
  insertHTML(bar, 'beforeend', '<label title="Extend building detail and visibility to the whole town (uses more GPU memory and triangles)">View depth <input type="range" data-view-depth min="1" max="8" step="0.25" value="1" aria-label="View depth"></label>');
  const slider = bar.querySelector<HTMLInputElement>('[data-view-depth]')!;
  slider.value = String(getViewDepth());
  slider.oninput = () => {
    setViewDepth(Number(slider.value));
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, String(getViewDepth()));
    } catch {
      /* Optional storage. */
    }
    state.client.viewer.invalidate();
  };
}
