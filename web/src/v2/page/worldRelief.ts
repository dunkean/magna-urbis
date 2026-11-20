/** The single camera's terrain exaggeration, using the same persisted appearance value as the render panel. */
import { applyAppearancePatch } from '../../render/appearanceRecipe';
import { resolveSettingsAppearance } from '../appearance';
import { insertHTML, registerMessages } from '../i18n';
import type { PageActions, PageState } from './contract';
import { $ } from './dom';

registerMessages({ 'Terrain exaggeration': { en: 'Terrain exaggeration', fr: 'Exagération du relief' } });

export function mountWorldReliefControl(state: PageState, actions: PageActions): void {
  const bar = $('#world-bar');
  insertHTML(bar, 'beforeend', '<label class="city3d-relief-control" title="Terrain exaggeration">Relief <input type="range" data-world-relief min="0.2" max="5" step="0.1" aria-label="Terrain exaggeration"><output data-relief-value></output></label>');
  const slider = bar.querySelector<HTMLInputElement>('[data-world-relief]')!,
    output = bar.querySelector<HTMLOutputElement>('[data-relief-value]')!;
  const sync = (): void => {
    const value = resolveSettingsAppearance(state.settings, state.world, 'view2d').city.exaggeration;
    slider.value = String(value);
    output.textContent = `×${value}`;
  };
  slider.oninput = () => {
    const exaggeration = Math.max(0.2, Math.min(5, Number(slider.value)));
    state.settings.appearance = applyAppearancePatch(state.settings.appearance, state.settings.options.style, { city: { exaggeration } });
    state.projectRevision++;
    sync();
    actions.scheduleAppearance();
  };
  state.client.viewer.onCamera(sync);
  $('#map-style').addEventListener('change', () => setTimeout(sync));
  sync();
}
