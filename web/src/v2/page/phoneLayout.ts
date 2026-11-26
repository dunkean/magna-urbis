/**
 * The compact (phone) layout: the Workshop sidebar becomes a sheet, the header keeps its main actions and lends the
 * others to a "⋯" menu, the toolbar keeps the style, padlock and 3D buttons and lends the rest to a Display panel, the
 * places panel folds into a chip, and an empty map offers a first run. The layout is phoneLayout.css; this module moves
 * nodes only while a menu is open (they return to their place when it closes) and opens or closes the sheets. Outside
 * the compact condition it does nothing, and rotating or resizing across it restores the desktop DOM.
 */
import { registerMessages, setText, translate } from '../i18n';
import { $ } from './dom';
import { acceptResume, onResumeOffer, resumeOffered, withdrawResume } from '../resumeOffer';
import '../phoneLayout.css';

/** A phone in portrait or landscape (and narrow windows). phoneLayout.css repeats this condition. */
export const COMPACT_QUERY = '(max-width: 720px), (pointer: coarse) and (max-height: 500px)';

registerMessages({
  'Resume my last map': { en: 'Resume my last map', fr: 'Reprendre ma dernière carte' },
  'Generate a map': { en: 'Generate a map', fr: 'Générer une carte' },
  'Settings…': { en: 'Settings…', fr: 'Réglages…' },
  Display: { en: 'Display', fr: 'Affichage' },
  'More actions': { en: 'More actions', fr: 'Plus d’actions' },
  'Close the workshop': { en: 'Close the workshop', fr: 'Fermer l’atelier' },
  'Show or hide the places': { en: 'Show or hide the places', fr: 'Afficher ou masquer les lieux' },
});

/** Header items that wait in the "⋯" menu on a phone (phoneLayout.css hides them in the header), in menu order. */
const HEADER_OVERFLOW = ['#save-map', '#export-open', '#osm-open', '#city-code-open', '#city-code-chip-debug', '#changelog-open', '.app-header .illustration-trigger', '#project-links-open', '#desktop-download'];
/** A pick on the map or in the places list opens the inspector within this delay (ms). */
const PICK_WINDOW = 1500;

/** Moves live nodes into a host and back to where they were, keeping their handlers. */
function lender(host: HTMLElement) {
  const homes: { node: Element; mark: Comment }[] = [];
  return {
    lend(nodes: Element[]): void {
      for (const node of nodes) {
        if (homes.some(home => home.node === node)) continue;
        const mark = document.createComment('phone-layout');
        node.before(mark);
        host.append(node);
        homes.push({ node, mark });
      }
    },
    restore(): void {
      for (const { node, mark } of homes.splice(0)) if (mark.isConnected) mark.replaceWith(node);
    },
  };
}

function labelled<T extends HTMLElement>(node: T, label: string): T {
  node.dataset.i18nAriaLabel = label;
  node.setAttribute('aria-label', translate(label));
  return node;
}

/** `text` is a message key; a symbol label (×, ⋯) is set as plain text by the caller. */
function button(id: string, className: string, text?: string): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.id = id;
  node.className = className;
  if (text) setText(node, text);
  return node;
}

const toggleState = (event: Event) => (event as Event & { newState?: string }).newState;

export function mountPhoneLayout(): void {
  const media = matchMedia(COMPACT_QUERY),
    app = $('#app'),
    sidebar = $('#sidebar'),
    workshop = $('#mobile-toggle'),
    places = $('#places-panel'),
    placesTitle = $('#places-title'),
    inspector = $('#inspector'),
    emptyMap = $('#empty-map'),
    mapArea = $('.map-area'),
    toolbar = $('.toolbar-row');
  let compact = media.matches,
    lastPick = 0,
    entityShown = false;

  // The sheet: the existing toggle opens it; its close button, a map tap, a run and the entity sheet close it.
  const sheetOpen = () => !sidebar.classList.contains('mobile-closed');
  const setSheet = (open: boolean) => {
    if (sheetOpen() === open) return;
    sidebar.classList.toggle('mobile-closed', !open);
    workshop.setAttribute('aria-expanded', String(open));
  };
  const close = labelled(button('workshop-close', 'quiet workshop-close'), 'Close the workshop');
  close.textContent = '×';
  close.onclick = () => setSheet(false);
  sidebar.prepend(close);
  $('#map').addEventListener('pointerdown', () => {
    if (compact) setSheet(false);
  });

  // First run: one call to action over the empty map.
  const firstRun = document.createElement('div');
  firstRun.className = 'phone-first-run';
  firstRun.hidden = true;
  const generate = button('phone-generate', 'primary', 'Generate a map'),
    settings = button('phone-settings', '', 'Settings…');
  // The same button resumes the map left recently when the page offers it (resumeOffer.ts).
  generate.onclick = () => (resumeOffered() ? acceptResume() : $<HTMLButtonElement>('#run-chain').click());
  settings.onclick = () => setSheet(true);
  firstRun.append(generate, settings);
  mapArea.append(firstRun);

  // Header: the "⋯" menu borrows the secondary actions while it is open.
  const more = labelled(button('phone-more', 'phone-more'), 'More actions');
  more.textContent = '⋯';
  const menu = document.createElement('div');
  menu.id = 'phone-header-menu';
  menu.className = 'phone-header-menu';
  menu.popover = 'auto';
  labelled(menu, 'More actions');
  more.setAttribute('aria-controls', menu.id);
  more.setAttribute('aria-expanded', 'false');
  more.onclick = () => menu.togglePopover();
  $('.header-tools').append(more, menu);
  const headerLoan = lender(menu);
  menu.addEventListener('beforetoggle', event => {
    if (toggleState(event) === 'open') headerLoan.lend(HEADER_OVERFLOW.flatMap(selector => Array.from(document.querySelectorAll(selector))));
    else headerLoan.restore();
  });
  menu.addEventListener('toggle', () => more.setAttribute('aria-expanded', String(menu.matches(':popover-open'))));
  // A menu action opens a dialog or a download: the menu gives its items back first.
  menu.addEventListener('click', event => {
    if ((event.target as Element).closest('button, a')) queueMicrotask(() => menu.matches(':popover-open') && menu.hidePopover());
  });

  // Toolbar: the Display panel borrows every control but the style, padlock and 3D while it is open. Its body is a second
  // `.toolbar-row`, so the borrowed controls keep their toolbar styles; it exists only in the compact layout (the page
  // has one toolbar row otherwise, and worldNavigation.ts takes the first).
  const display = button('phone-display-open', 'phone-display-open', 'Display');
  display.setAttribute('aria-expanded', 'false');
  display.setAttribute('aria-controls', 'phone-display');
  toolbar.querySelector(':scope > .style-control')!.after(display);
  let panel: HTMLElement | undefined;
  let toolbarLoan: ReturnType<typeof lender> | undefined;
  const borrowed = () => Array.from(toolbar.children).filter(node => !node.matches('.style-control, #phone-display-open'));
  function displayPanel(): HTMLElement {
    if (panel) return panel;
    const node = document.createElement('section');
    node.id = 'phone-display';
    node.className = 'phone-display';
    node.popover = 'auto';
    labelled(node, 'Display');
    const head = document.createElement('header'),
      title = document.createElement('h2'),
      shut = button('phone-display-close', 'quiet small', 'Close');
    setText(title, 'Display');
    shut.onclick = () => node.hidePopover();
    head.append(title, shut);
    const body = document.createElement('div');
    body.className = 'toolbar-row phone-display-body';
    node.append(head, body);
    const loan = lender(body);
    node.addEventListener('beforetoggle', event => {
      if (toggleState(event) === 'open') loan.lend(borrowed());
      else loan.restore();
    });
    node.addEventListener('toggle', () => display.setAttribute('aria-expanded', String(node.matches(':popover-open'))));
    $('.workbench-bar').append(node);
    toolbarLoan = loan;
    return (panel = node);
  }
  display.onclick = () => displayPanel().togglePopover();
  function dropDisplayPanel(): void {
    if (!panel) return;
    if (panel.matches(':popover-open')) panel.hidePopover();
    toolbarLoan?.restore();
    panel.remove();
    panel = toolbarLoan = undefined;
  }

  // Places: a chip ("Places", its count and "Select on map") that unfolds on a tap and folds when the sheet opens.
  const setPlacesOpen = (open: boolean) => {
    if (open) places.dataset.phoneOpen = 'true';
    else delete places.dataset.phoneOpen;
    if (compact) placesTitle.setAttribute('aria-expanded', String(open));
  };
  places.querySelector('header')!.addEventListener('click', event => {
    if (!compact || (event.target as Element).closest('button, input, select, label, a')) return;
    setPlacesOpen(places.dataset.phoneOpen !== 'true');
  });
  placesTitle.addEventListener('keydown', event => {
    if (!compact || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    setPlacesOpen(places.dataset.phoneOpen !== 'true');
  });
  // A tap (not a pan) on the map or in the places list is a pick.
  let down = { x: 0, y: 0 };
  for (const node of [$('#map'), $('#settlement-list')]) {
    node.addEventListener('pointerdown', event => (down = { x: event.clientX, y: event.clientY }), true);
    node.addEventListener(
      'pointerup',
      event => {
        if (Math.hypot(event.clientX - down.x, event.clientY - down.y) < 6) lastPick = performance.now();
      },
      true,
    );
  }

  function syncFirstRun(): void {
    const busy = app.getAttribute('aria-busy') === 'true';
    // Another run than the offered one makes another map: the offer ends.
    if (busy) withdrawResume();
    setText(generate, resumeOffered() ? 'Resume my last map' : 'Generate a map');
    firstRun.hidden = !compact || emptyMap.hidden || busy;
  }
  onResumeOffer(syncFirstRun);

  function reconcile(records: MutationRecord[]): void {
    syncFirstRun();
    if (!compact) return;
    const entity = document.getElementById('entity-sheet'),
      shown = !!entity && !entity.hidden;
    if (shown && !entityShown) setSheet(false);
    entityShown = shown;
    for (const record of records) {
      if (record.target === app && app.getAttribute('aria-busy') === 'true') setSheet(false);
      if (record.target === sidebar && sheetOpen()) {
        setPlacesOpen(false);
        if (entityShown) entity!.querySelector<HTMLButtonElement>('.entity-sheet-close')?.click();
      }
      for (const node of Array.from(record.addedNodes)) if (node instanceof HTMLElement && node.id === 'entity-sheet') watch.observe(node, { attributes: true, attributeFilter: ['hidden'] });
    }
    const picked = records.some(record => record.target === inspector);
    if (picked && !shown && !inspector.hidden && inspector.childElementCount && performance.now() - lastPick < PICK_WINDOW) {
      lastPick = 0;
      const tab = document.getElementById('family-tab-cities');
      if (tab && tab.getAttribute('aria-selected') !== 'true') tab.click();
      setSheet(true);
    }
  }
  const watch = new MutationObserver(reconcile);
  watch.observe(app, { attributes: true, attributeFilter: ['aria-busy'] });
  watch.observe(emptyMap, { attributes: true, attributeFilter: ['hidden'] });
  watch.observe(sidebar, { attributes: true, attributeFilter: ['class'] });
  watch.observe(inspector, { attributes: true, attributeFilter: ['hidden'], childList: true });
  watch.observe(mapArea, { childList: true });
  const entitySheet = document.getElementById('entity-sheet');
  if (entitySheet) watch.observe(entitySheet, { attributes: true, attributeFilter: ['hidden'] });

  function apply(): void {
    compact = media.matches;
    more.hidden = display.hidden = close.hidden = !compact;
    if (compact) {
      placesTitle.tabIndex = 0;
      placesTitle.setAttribute('role', 'button');
      labelled(placesTitle, 'Show or hide the places');
      setPlacesOpen(places.dataset.phoneOpen === 'true');
    } else {
      if (menu.matches(':popover-open')) menu.hidePopover();
      headerLoan.restore();
      dropDisplayPanel();
      setPlacesOpen(false);
      for (const attr of ['tabindex', 'role', 'aria-label', 'data-i18n-aria-label', 'aria-expanded']) placesTitle.removeAttribute(attr);
    }
    syncFirstRun();
  }
  media.addEventListener('change', apply);
  apply();
}
