/**
 * The controls of the tilted map: a bar of the toolbar, shown while the map is tilted, with its navigation select
 * (orbit, walk, free flight: Viewer.setNavigation, render/world/navigation.ts) and the modelled trees (worldTrees.ts,
 * mounted after this), and the PNG of the view (the compositor's tilted frame read back, LiveCompositor.capture).
 * While tilted, the measure tool, which reads the map through the 2D mapping, is put away. Mounted by view3d.ts.
 */
import { isTilted } from '../../render/world/camera';
import type { Navigation } from '../../render/world/navigation';
import { canvasPng } from '../../ui/canvasExport';
import { insertHTML, registerMessages, setText, translate } from '../i18n';
import type { PageActions, PageState } from './contract';
import { $ } from './dom';
import { handheldDevice } from '../../../../rust/bridge/deviceClass';

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
  'Walk and fly: drag to look, slide two fingers to move (down goes forward).': {
    en: 'Walk and fly: drag to look, slide two fingers to move (down goes forward).',
    fr: 'Marche et vol : glisser pour regarder, glisser à deux doigts pour se déplacer (vers le bas pour avancer).',
  },
  'Fly up': { en: 'Fly up', fr: 'Monter' },
  'Fly down': { en: 'Fly down', fr: 'Descendre' },
  'Generated map: drag to pan, pinch to zoom': { en: 'Generated map: drag to pan, pinch to zoom', fr: 'Carte générée : glisser pour déplacer, pincer pour zoomer' },
  PNG: { en: 'PNG', fr: 'PNG' },
  'Export the tilted view as PNG': { en: 'Export the tilted view as PNG', fr: 'Exporter la vue inclinée en PNG' },
  'The view is not ready for a capture yet.': { en: 'The view is not ready for a capture yet.', fr: 'La vue n’est pas encore prête pour une capture.' },
});

export function mountWorldNavigation(state: PageState, actions: PageActions): void {
  // The gestures of ui/viewerInput.ts on a handheld, the keys elsewhere.
  const hint = handheldDevice() ? 'Walk and fly: drag to look, slide two fingers to move (down goes forward).' : 'Walk and fly: W A S D or arrows, Shift faster, drag to look; flying: Space or E up, C down. Escape: orbit, Home: map.';
  if (handheldDevice()) {
    const map = $('#map-canvas');
    map.setAttribute('data-i18n-aria-label', 'Generated map: drag to pan, pinch to zoom');
    map.setAttribute('aria-label', translate('Generated map: drag to pan, pinch to zoom'));
  }
  // The class of City Bench's 3D bar (ui/view3d/cityDom.ts); its look in the toolbar is in workbenchLayout.css.
  insertHTML(
    $('#view3d'),
    'afterend',
    `<div id="world-bar" class="city3d-bar" role="group" aria-label="3D view" hidden><label data-navigation-label title="${hint}"><span data-navigation-caption>Navigation</span><select data-navigation aria-label="Navigation"><option value="orbit">Orbit</option><option value="walk">Walk</option><option value="fly">Free flight</option></select></label></div>`,
  );
  const bar = $('#world-bar'),
    select = bar.querySelector<HTMLSelectElement>('[data-navigation]')!,
    capture = $<HTMLButtonElement>('#capture3d'),
    viewer = state.client.viewer;
  setText(capture, 'PNG');
  capture.setAttribute('data-i18n-title', 'Export the tilted view as PNG');
  capture.title = translate('Export the tilted view as PNG');
  // A handheld has no Space or C: two buttons over the map, held down, climb and descend in a free flight.
  let flight: HTMLElement | undefined;
  if (handheldDevice()) {
    flight = document.createElement('div');
    flight.className = 'glass world-flight';
    flight.hidden = true;
    for (const [code, label, glyph] of [
      ['Space', 'Fly up', '▲'],
      ['KeyC', 'Fly down', '▼'],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = glyph;
      button.setAttribute('data-i18n-aria-label', label);
      button.setAttribute('aria-label', translate(label));
      button.addEventListener('pointerdown', event => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        viewer.holdMove(code, true);
      });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) button.addEventListener(type, () => viewer.holdMove(code, false));
      flight.append(button);
    }
    $('.map-area').append(flight);
  }
  let tilted = false;
  viewer.onCamera(view => {
    select.value = viewer.navigation();
    if (flight) flight.hidden = viewer.navigation() !== 'fly';
    if (tilted === isTilted(view)) return;
    tilted = !tilted;
    // At the end of the toolbar row, before "Advanced". The row is laid out after this
    // mount (workbenchLayout.ts), so the bar joins it at the first tilt. The PNG button goes at its end: the layout put
    // it in the Advanced panel, which the tilted row hides.
    const row = document.querySelector('.toolbar-row');
    if (row && bar.parentElement !== row) {
      row.insertBefore(bar, row.querySelector(':scope > .advanced-open'));
      bar.append(capture);
    }
    bar.hidden = capture.hidden = !tilted;
    // The measure tool reads the map through the 2D mapping: away while tilted (the tilt ends a measurement already,
    // through the edit mode event).
    const measure = document.querySelector<HTMLButtonElement>('#measure-tool');
    if (measure) measure.disabled = tilted;
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
