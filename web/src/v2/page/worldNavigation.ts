/**
 * The controls of the tilted map beside the "3D" button (single camera): the navigation select (orbit, walk, free
 * flight: Viewer.setNavigation, render/world/navigation.ts) and the PNG of the view (the compositor's tilted frame read
 * back, LiveCompositor.capture), both shown while the map is tilted. While tilted, the measure tool and the cursor
 * readout, which read the map through the 2D mapping, are put away. Mounted by view3d.ts for the single camera only;
 * with `?camera=dual` the separate 3D view keeps its own controls and its own PNG.
 */
import { isTilted } from '../../render/world/camera';
import type { Navigation } from '../../render/world/navigation';
import { canvasPng } from '../../ui/canvasExport';
import { insertHTML, registerMessages, translate } from '../i18n';
import type { PageActions, PageState } from './contract';
import { $ } from './dom';

registerMessages({
  Navigation: { en: 'Navigation', fr: 'Navigation' },
  Orbit: { en: 'Orbit', fr: 'Orbite' },
  Walk: { en: 'Walk', fr: 'Marche' },
  'Free flight': { en: 'Free flight', fr: 'Vol libre' },
  'Walk and fly: W A S D or arrows, Shift faster, drag to look; flying: Space or E up, C down. Escape: orbit, Home: map.': {
    en: 'Walk and fly: W A S D or arrows, Shift faster, drag to look; flying: Space or E up, C down. Escape: orbit, Home: map.',
    fr: 'Marche et vol : Z Q S D ou flèches, Maj pour aller plus vite, glisser pour regarder ; en vol : Espace ou E pour monter, C pour descendre. Échap : orbite, Origine : carte.',
  },
  'Download the tilted view as a PNG image': { en: 'Download the tilted view as a PNG image', fr: 'Télécharger la vue inclinée en image PNG' },
  'The view is not ready for a capture yet.': { en: 'The view is not ready for a capture yet.', fr: 'La vue n’est pas encore prête pour une capture.' },
});

export function mountWorldNavigation(state: PageState, actions: PageActions): void {
  insertHTML(
    $('#view3d'),
    'afterend',
    '<label id="world-navigation" hidden title="Walk and fly: W A S D or arrows, Shift faster, drag to look; flying: Space or E up, C down. Escape: orbit, Home: map.">Navigation <select id="world-navigation-mode"><option value="orbit">Orbit</option><option value="walk">Walk</option><option value="fly">Free flight</option></select></label>',
  );
  const label = $('#world-navigation'),
    select = $<HTMLSelectElement>('#world-navigation-mode'),
    capture = $<HTMLButtonElement>('#capture3d'),
    viewer = state.client.viewer;
  capture.setAttribute('data-i18n-title', 'Download the tilted view as a PNG image');
  capture.title = translate('Download the tilted view as a PNG image');
  let tilted = false;
  viewer.onCamera(view => {
    select.value = viewer.navigation();
    if (tilted === isTilted(view)) return;
    tilted = !tilted;
    label.hidden = capture.hidden = !tilted;
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
