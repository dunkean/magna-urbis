/**
 * The controls of the tilted map (single camera): the bar of the separate 3D view's toolbar, shown while the map is
 * tilted, with its navigation select (orbit, walk, free flight: Viewer.setNavigation, render/world/navigation.ts) and
 * the modelled trees (worldTrees.ts, mounted after this), and the PNG of the view (the compositor's tilted frame read
 * back, LiveCompositor.capture). While tilted, the measure tool and the cursor readout, which read the map through the
 * 2D mapping, are put away. Mounted by view3d.ts for the single camera only; with `?camera=dual` the separate 3D view
 * keeps its own controls and its own PNG.
 */
import { isTilted } from '../../render/world/camera';
import type { Navigation } from '../../render/world/navigation';
import { canvasPng } from '../../ui/canvasExport';
import { insertHTML, registerMessages, setText, translate } from '../i18n';
import type { PageActions, PageState } from './contract';
import { $ } from './dom';

registerMessages({
  '3D view': { en: '3D view', fr: 'Vue 3D' },
  Navigation: { en: 'Navigation', fr: 'Navigation' },
  Orbit: { en: 'Orbit', fr: 'Orbite' },
  Walk: { en: 'Walk', fr: 'Marche' },
  'Free flight': { en: 'Free flight', fr: 'Vol libre' },
  'Walk and fly: W A S D or arrows, Shift faster, drag to look; flying: Space or E up, C down. Escape: orbit, Home: map.': {
    en: 'Walk and fly: W A S D or arrows, Shift faster, drag to look; flying: Space or E up, C down. Escape: orbit, Home: map.',
    fr: 'Marche et vol : Z Q S D ou flèches, Maj pour aller plus vite, glisser pour regarder ; en vol : Espace ou E pour monter, C pour descendre. Échap : orbite, Origine : carte.',
  },
  PNG: { en: 'PNG', fr: 'PNG' },
  'Export the tilted view as PNG': { en: 'Export the tilted view as PNG', fr: 'Exporter la vue inclinée en PNG' },
  'The view is not ready for a capture yet.': { en: 'The view is not ready for a capture yet.', fr: 'La vue n’est pas encore prête pour une capture.' },
});

export function mountWorldNavigation(state: PageState, actions: PageActions): void {
  // The separate 3D view's bar (ui/view3d/cityDom.ts): its markup, so its look in the toolbar (workbenchLayout.css).
  insertHTML(
    $('#view3d'),
    'afterend',
    '<div id="world-bar" class="city3d-bar" role="group" aria-label="3D view" hidden><label data-navigation-label title="Walk and fly: W A S D or arrows, Shift faster, drag to look; flying: Space or E up, C down. Escape: orbit, Home: map.">Navigation <select data-navigation><option value="orbit">Orbit</option><option value="walk">Walk</option><option value="fly">Free flight</option></select></label></div>',
  );
  const bar = $('#world-bar'),
    select = bar.querySelector<HTMLSelectElement>('[data-navigation]')!,
    capture = $<HTMLButtonElement>('#capture3d'),
    viewer = state.client.viewer;
  setText(capture, 'PNG');
  capture.setAttribute('data-i18n-title', 'Export the tilted view as PNG');
  capture.title = translate('Export the tilted view as PNG');
  let tilted = false;
  viewer.onCamera(view => {
    select.value = viewer.navigation();
    if (tilted === isTilted(view)) return;
    tilted = !tilted;
    // Where the 3D view put its bar: at the end of the toolbar row, before "Advanced". The row is laid out after this
    // mount (workbenchLayout.ts), so the bar joins it at the first tilt. The PNG button goes at its end: the layout put
    // it in the Advanced panel, which the tilted row hides.
    const row = document.querySelector('.toolbar-row');
    if (row && bar.parentElement !== row) {
      row.insertBefore(bar, row.querySelector(':scope > .advanced-open'));
      bar.append(capture);
    }
    bar.hidden = capture.hidden = !tilted;
    // The measure tool and the readout read the map through the 2D mapping: away while tilted (the tilt ends a
    // measurement already, through the edit mode event).
    const measure = document.querySelector<HTMLButtonElement>('#measure-tool'),
      readout = document.querySelector<HTMLElement>('#cursor-readout');
    if (measure) measure.disabled = tilted;
    if (readout) readout.style.visibility = tilted ? 'hidden' : '';
  });
  select.onchange = () => {
    viewer.setNavigation(select.value as Navigation);
    select.value = viewer.navigation();
    // The keys go to the map, not to the select.
    select.blur();
  };
  capture.onclick = async () => {
    try {
      await viewer.waitForFrame();
      const image = state.client.captureView();
      if (!image) throw new Error('The view is not ready for a capture yet.');
      try {
        actions.download(await canvasPng(image), `magna-urbis-${state.settings.options.seed}.3d.png`);
      } finally {
        image.width = image.height = 0;
      }
    } catch (error) {
      actions.toast(error instanceof Error ? error.message : String(error), true);
    }
  };
}
