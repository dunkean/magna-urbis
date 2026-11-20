import { registerMessages, setText, onLanguageChange, translate } from './i18n';

registerMessages({
  Appearance: { en: 'Appearance', fr: 'Apparence' },
  'Edit map': { en: 'Edit map', fr: 'Modifier la carte' },
  Navigate: { en: 'Navigate', fr: 'Explorer' },
  Buildings: { en: 'Buildings', fr: 'Bâtiments' },
  'Network editing': { en: 'Road editing', fr: 'Édition des routes' },
  Rivers: { en: 'Rivers', fr: 'Rivières' },
  'Finish editing': { en: 'Finish editing', fr: 'Terminer l’édition' },
  'Preferences & documentation': { en: 'Preferences & documentation', fr: 'Préférences et documentation' },
  'Select a town, district or building on the map to edit its properties.': { en: 'Select a town, district or building on the map to edit its properties.', fr: 'Sélectionnez une ville, un quartier ou un bâtiment sur la carte pour modifier ses propriétés.' },
  'Choose the engine for each process. Available hardware and the last execution are shown separately.': {
    en: 'Choose the engine for each process. Available hardware and the last execution are shown separately.',
    fr: 'Choisissez le moteur de chaque traitement. Le matériel disponible et la dernière exécution sont présentés séparément.',
  },
});

/** Mode tokens that leave an active map selection untouched (it stays on until the user ends it). */
export function stickySelection(token: string, selecting: boolean): boolean {
  return selecting && (token === 'busy' || token === 'family' || token === 'selection');
}

/** One place for activation, one contextual dock. Existing tools keep ownership of their edits. `canSelect`: "Select on
 * map" is offered (it picks in a tilted view too, where the editors are not). */
export function mountEditingTools(api: { canEdit(): boolean; canSelect(): boolean; roadSession?(): boolean; finishRoads?(): Promise<boolean>; cancelRoads?(): Promise<boolean> }): { sync(): void } {
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
  const dock = $('#editor-dock'),
    inspect = $<HTMLInputElement>('#inspect-mode'),
    toolbar = $('#header-menu');
  $('#edit-buildings').append($('#inspector'));
  const river = $<HTMLButtonElement>('#edit-rivers [data-network-tool="rivers"]');
  $('#rivers-open').replaceWith(river);
  river.id = 'rivers-open';
  let mode = 'navigate';
  function sync(): void {
    const available = api.canEdit(),
      selectable = api.canSelect();
    for (const selector of ['#labels-open', '#rivers-open', '#move-towns', '[data-network-quick]']) document.querySelectorAll<HTMLButtonElement | HTMLInputElement>(selector).forEach(control => (control.disabled = !available));
    inspect.disabled = !selectable;
    $<HTMLSelectElement>('#inspect-target').disabled = !selectable || !inspect.checked;
    setText($('#edit-done'), api.roadSession?.() ? 'Validate road edits' : 'Finish editing');
  }
  function show(next: string): void {
    mode = next;
    const section = next === 'buildings' || next === 'selection' ? 'buildings' : next.startsWith('network:roads') ? 'roads' : next === 'network:rivers' ? 'rivers' : next === 'labels' ? 'labels' : '';
    dock.hidden = !section || section === 'buildings';
    for (const key of ['buildings', 'roads', 'rivers', 'labels']) $(`#edit-${key}`).hidden = key !== section;
    const label =
      next === 'contours'
        ? 'Edit outline'
        : section === 'buildings'
          ? 'Buildings'
          : section === 'roads'
            ? 'Network editing'
            : section === 'rivers'
              ? 'Rivers'
              : section === 'labels'
                ? 'Names & labels'
                : next === 'town-move'
                  ? 'Move towns'
                  : next === 'placement'
                    ? 'Choose a position on the map'
                    : 'Navigate';
    setText($('#editor-title'), label);
    setText($('#active-tool'), label);
    const closeLabel = section === 'roads' ? 'Cancel road edits' : 'Close';
    $('#editor-close').setAttribute('aria-label', translate(closeLabel));
    $('#editor-close').title = translate(closeLabel);
    $('#edit-navigate').setAttribute('aria-pressed', String(next === 'navigate'));
    $('#labels-open').setAttribute('aria-pressed', String(next === 'labels'));
    $('#edit-done').hidden = next === 'navigate';
    if (next !== 'buildings' && next !== 'selection') inspect.checked = false;
    document.body.classList.toggle('editing-map', !!section);
    sync();
  }
  const finish = () => window.dispatchEvent(new CustomEvent('v2-edit-mode', { detail: 'navigate' }));
  $('#edit-navigate').onclick = finish;
  $('#edit-done').onclick = async () => {
    if (api.roadSession?.() && api.finishRoads && !(await api.finishRoads())) return;
    finish();
  };
  $('#editor-close').onclick = async () => {
    if (api.roadSession?.() && api.cancelRoads && !(await api.cancelRoads())) return;
    finish();
  };
  inspect.onchange = () => {
    if (inspect.checked && !api.canSelect()) {
      inspect.checked = false;
      return;
    }
    window.dispatchEvent(new CustomEvent('v2-edit-mode', { detail: inspect.checked ? 'buildings' : 'navigate' }));
  };
  $('#labels-open').onclick = () => {
    if (!api.canEdit()) return;
    window.dispatchEvent(new CustomEvent('v2-edit-mode', { detail: mode === 'labels' ? 'navigate' : 'labels' }));
  };
  window.addEventListener('v2-edit-mode', event => {
    const token = (event as CustomEvent<string>).detail;
    // "Select on map" is sticky: a pick (which opens the Cities tab), a tab change or the regeneration it
    // triggers keep it on. Only Escape, a second click on the button or another tool end it.
    if (stickySelection(token, inspect.checked)) return;
    show(['busy', 'family', '3d'].includes(token) ? 'navigate' : token);
  });
  // Tools also stop themselves (second click, Escape). Reflect that in the shared state.
  const observer = new MutationObserver(() => {
    const network = toolbar.querySelector('[data-network-quick][aria-pressed="true"]');
    if ((mode.startsWith('network:roads') && !network) || (mode === 'network:rivers' && river.getAttribute('aria-pressed') !== 'true') || (mode === 'town-move' && $('#move-towns').getAttribute('aria-pressed') !== 'true')) show('navigate');
  });
  observer.observe(toolbar, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
  toolbar.addEventListener('click', event => {
    if ((event.target as Element).closest('[data-network-quick]'))
      requestAnimationFrame(() => {
        if (mode.startsWith('network:roads')) show(mode);
      });
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('dialog[open]')) finish();
  });
  onLanguageChange(() => show(mode));
  show('navigate');
  return { sync };
}
