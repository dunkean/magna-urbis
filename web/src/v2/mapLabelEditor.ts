import type { World, Vec2 } from '../gen/types';
import type { NameEntry } from '../gen/names/types';
import type { View } from '../render/view';
import { worldToScreen } from '../render/view';
import type { V2Settings } from './contracts';
import { onLanguageChange, translate, registerMessages } from './i18n';
import { mapPresentation } from './mapPresentation';
import { labelCandidates, settlementKeyOf, type LabelCandidate, type LabelEdit } from './mapLabels';
import { TOPONYM_PROFILES } from '../gen/names/profiles';
import { varyNames } from '../gen/names/policy';
import { nameProfileLabels } from './mapControls';
import { presentName } from '../gen/names/displayNames';
import type { NamePresentation } from '../gen/names/types';
import { lineIcon } from './editorIcons';
import { drawnLabelIds, onDrawnLabelsChange } from './drawnLabels';
import { mountParameterForm } from './parameterForm';
import { CULTURE_LABELS } from '../gen/options';
import { editorButtonIcon } from './editorIcons';
import { hasToponymOverride, renameToponym, resetToponymName, setToponymHidden, TOPONYM_MAX_LENGTH, type ToponymTarget } from './toponymOverrides';

const copy = (en: string, fr: string): string => {
  registerMessages({ [en]: { en, fr } });
  return en;
};
const T = {
  towns: copy('Town names', 'Noms des villes'),
  townsHint: copy('Leave empty to keep the generated name.', 'Laisser vide pour garder le nom généré.'),
  noTowns: copy('Generate a map to name its towns.', 'Générez une carte pour nommer ses villes.'),
  idle: copy('Select a name below or click one on the map.', 'Sélectionnez un nom ci-dessous ou cliquez dessus sur la carte.'),
  creating: copy('Click on the map where the new label goes. Esc cancels.', 'Cliquez sur la carte à l’endroit du nouveau label. Échap pour annuler.'),
  moving: copy('Click on the map where this label goes. Esc cancels.', 'Cliquez sur la carte à la nouvelle place du label. Échap pour annuler.'),
  add: copy('+ Add a label', '+ Ajouter un label'),
  newLabel: copy('New label', 'Nouveau label'),
  text: copy('Label text', 'Texte du label'),
  keepGeneric: copy('Rename only the proper name (keep “Street”, “Gate”…)', 'Renommer seulement le nom propre (garder « Rue », « Porte »…)'),
  move: copy('Move', 'Déplacer'),
  cancelMove: copy('Cancel move', 'Annuler le déplacement'),
  hide: copy('Hide', 'Masquer'),
  show: copy('Show', 'Afficher'),
  other: copy('Other name', 'Autre nom'),
  reset: copy('Reset', 'Réinitialiser'),
  remove: copy('Delete label', 'Supprimer le label'),
  hidden: copy('hidden', 'masqué'),
  edited: copy('edited', 'modifié'),
  style: copy('Style', 'Style'),
  colour: copy('Colour', 'Couleur'),
  size: copy('Size', 'Taille'),
  bold: copy('Bold', 'Gras'),
  italic: copy('Italic', 'Italique'),
  profile: copy('Name profile', 'Profil du nom'),
  inherit: copy('Inherit from the district or town', 'Hériter du quartier ou de la ville'),
  list: copy('All names', 'Tous les noms'),
  search: copy('Search names', 'Rechercher un nom'),
  more: copy('{shown} of {matches} · refine the search', '{shown} sur {matches} · affinez la recherche'),
  none: copy('No name matches.', 'Aucun nom ne correspond.'),
  nothing: copy('Nothing selected.', 'Aucune sélection.'),
  browse: copy('Browse place names', 'Parcourir les toponymes'),
  browseHint: copy(
    'Type in a field to rename the place everywhere. The eye shows what the map draws now (dimmed: not drawn at this view); click it to show or hide the name. The arrow restores the generated name and automatic visibility. A typed name is shown as written in every map language.',
    'Écrivez dans un champ pour renommer le lieu partout. L’œil montre ce que la carte dessine maintenant (atténué : non dessiné dans cette vue) ; cliquez dessus pour afficher ou masquer le nom. La flèche rétablit le nom généré et la visibilité automatique. Un nom saisi s’affiche tel quel dans toutes les langues de la carte.',
  ),
  shownEye: copy('Shown on the map now · click to hide it', 'Affiché sur la carte · cliquer pour le masquer'),
  hiddenEye: copy('Hidden by you · click to show it at every zoom', 'Masqué par vous · cliquer pour l’afficher à tous les zooms'),
  undrawnEye: copy('Not drawn at this view (off screen, zoom level or overlapping names) · click to always show it', 'Non dessiné dans cette vue (hors écran, niveau de zoom ou noms qui se chevauchent) · cliquer pour toujours l’afficher'),
  restoreName: copy('Restore the generated name and automatic visibility', 'Rétablir le nom généré et la visibilité automatique'),
  restoreNamed: copy('Restore the generated name ({name}) and automatic visibility', 'Rétablir le nom généré ({name}) et la visibilité automatique'),
  unnamed: copy('Unnamed · type a name', 'Sans nom · saisir un nom'),
  culture: copy('Toponym culture', 'Culture des toponymes'),
  ownCulture: copy('Each place’s own culture', 'Culture propre à chaque lieu'),
  pick: copy('Pick on map', 'Choisir sur la carte'),
  picking: copy('Click a name or a named place on the map. Esc stops.', 'Cliquez sur un nom ou un lieu nommé de la carte. Échap pour arrêter.'),
  select: copy('Select', 'Sélectionner'),
  automatic: copy('Automatic', 'Automatique'),
  visibility: copy('Name visibility', 'Visibilité du nom'),
  allStates: copy('All visibility choices', 'Toutes les visibilités'),
  forced: copy('Always shown', 'Toujours affichés'),
  hiddenNames: copy('Hidden names', 'Noms masqués'),
  allPlaces: copy('All places', 'Tous les lieux'),
  previous: copy('Previous', 'Précédent'),
  next: copy('Next', 'Suivant'),
  page: copy('{from}–{to} of {total}', '{from}–{to} sur {total}'),
  applyMatches: copy('Apply to matching names:', 'Appliquer aux noms filtrés :'),
};
const FILTERS: [string, string, (c: LabelCandidate) => boolean][] = [
  ['all', copy('All names', 'Tous les noms'), c => !!c.text],
  ['places', copy('Towns and villages', 'Villes et villages'), c => ['town', 'village', 'farm'].includes(c.kind)],
  ['districts', copy('Districts', 'Quartiers'), c => ['quarter', 'district'].includes(c.kind) && !!c.text],
  ['streets', copy('Streets and roads', 'Rues et routes'), c => ['street', 'road', 'bridge'].includes(c.kind)],
  ['landmarks', copy('Gates, squares and monuments', 'Portes, places et monuments'), c => ['gate', 'castle', 'church', 'square', 'building', 'parcel'].includes(c.kind) && !!c.text && !c.id.startsWith('free:')],
  ['nature', copy('Water and nature', 'Eau et nature'), c => ['river', 'lake', 'sea', 'forest', 'hill'].includes(c.kind)],
  ['free', copy('My labels', 'Mes labels'), c => c.id.startsWith('free:')],
  ['unnamed', copy('Unnamed objects', 'Objets sans nom'), c => !c.text],
];
const KIND_NAMES: Record<string, string> = {
  town: copy('Town', 'Ville'),
  village: copy('Village', 'Village'),
  farm: copy('Farm', 'Ferme'),
  street: copy('Street', 'Rue'),
  road: copy('Road', 'Route'),
  bridge: copy('Bridge', 'Pont'),
  quarter: copy('District', 'Quartier'),
  district: copy('District', 'Quartier'),
  gate: copy('Gate', 'Porte'),
  castle: copy('Castle', 'Château'),
  church: copy('Place of worship', 'Lieu de culte'),
  square: copy('Square', 'Place'),
  building: copy('Building', 'Bâtiment'),
  parcel: copy('Parcel', 'Parcelle'),
  river: copy('River', 'Rivière'),
  lake: copy('Lake', 'Lac'),
  sea: copy('Sea', 'Mer'),
  forest: copy('Forest', 'Forêt'),
  hill: copy('Hill', 'Colline'),
  free: copy('Free label', 'Label libre'),
  cavern: copy('Cavern', 'Caverne'),
  tunnel: copy('Tunnel', 'Tunnel'),
};
/** Caverns and tunnels are named as relief ('hill') entries; their role tells them apart. */
const kindName = (c: LabelCandidate, role?: string): string => translate(c.id.startsWith('free:') ? KIND_NAMES.free : role === 'terrain.cavern' ? KIND_NAMES.cavern : role?.startsWith('terrain.tunnel.') ? KIND_NAMES.tunnel : (KIND_NAMES[c.kind] ?? KIND_NAMES.building));
const PICK_PX = 28;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (cls = ''): HTMLButtonElement => {
  const b = el('button', cls);
  b.type = 'button';
  return b;
};

function pathDistance(path: Vec2[] | undefined, p: Vec2): number {
  if (!path || path.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i],
      dx = b.x - a.x,
      dy = b.y - a.y,
      l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
    best = Math.min(best, Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y));
  }
  return best;
}

/** Names panel: towns first, then the name picked on the map; the full list stays one click away. */
export function mountMapLabelEditor(
  host: HTMLElement,
  api: {
    getWorld(): World | undefined;
    getSettings(): V2Settings;
    onChange(): void;
    onNames?(): void;
    /** A settlement picked on the map: shared with the Places selection. */
    onPlace?(key: string): void;
    map?: HTMLElement;
    getView?(): View;
    focus?(point: Vec2): void;
  },
): { sync(): void; active(): boolean; stop(): void; pick(point: Vec2): void; start(): void; selectPlace(key: string): void } {
  const box = el('section', 'map-label-editor');
  host.append(box);
  const status = el('p', 'hint map-label-status');
  status.setAttribute('aria-live', 'polite');
  const add = button('primary map-label-add');
  // Towns.
  const towns = el('details', 'map-label-towns');
  const townsTitle = el('summary'),
    townsHint = el('p', 'hint'),
    townRows = el('div', 'map-label-town-rows');
  towns.append(townsTitle, townsHint, townRows);
  // Selected label.
  const card = el('div', 'map-label-card');
  const cardHead = el('div', 'map-label-card-head'),
    kind = el('span', 'map-label-kind'),
    state = el('span', 'map-label-state');
  cardHead.append(kind, state);
  const input = el('input');
  input.type = 'text';
  input.maxLength = 200;
  const genericRow = el('label', 'map-label-check'),
    generic = el('input'),
    genericText = el('span');
  generic.type = 'checkbox';
  genericRow.append(generic, genericText);
  const actions = el('div', 'map-label-actions');
  const move = button(),
    hide = button(),
    autoVisibility = button(),
    other = button(),
    reset = button();
  actions.append(move, hide, autoVisibility, other, reset);
  const styleBox = el('details', 'map-label-style'),
    styleTitle = el('summary');
  const color = el('input'),
    size = el('input'),
    bold = el('input'),
    italic = el('input'),
    profile = el('select');
  color.type = 'color';
  size.type = 'number';
  size.min = '.25';
  size.max = '4';
  size.step = '.1';
  bold.type = italic.type = 'checkbox';
  profile.id = 'map-label-profile';
  const field = (control: HTMLElement): [HTMLLabelElement, HTMLSpanElement] => {
    const l = el('label', 'map-label-field'),
      s = el('span');
    l.append(s, control);
    return [l, s];
  };
  const [colorField, colorText] = field(color),
    [sizeField, sizeText] = field(size),
    [boldField, boldText] = field(bold),
    [italicField, italicText] = field(italic),
    [profileField, profileText] = field(profile);
  const styleRow = el('div', 'map-label-style-row');
  styleRow.append(colorField, sizeField, boldField, italicField);
  styleBox.append(styleTitle, styleRow, profileField);
  const empty = el('p', 'hint');
  card.append(cardHead, input, genericRow, actions, styleBox);
  // Full list.
  const listBox = el('section', 'map-label-list'),
    listTitle = el('h3'),
    browseHint = el('p', 'hint');
  const filter = el('select'),
    placeFilter = el('select'),
    visibilityFilter = el('select'),
    search = el('input'),
    list = el('div', 'map-label-results'),
    count = el('small', 'hint');
  search.type = 'search';
  const filters = el('div', 'map-label-filters');
  filters.append(filter, placeFilter, visibilityFilter);
  const bulk = el('div', 'map-label-bulk'),
    bulkCaption = el('span');
  bulk.append(bulkCaption);
  const bulkButtons = [button(), button(), button()];
  bulk.append(...bulkButtons);
  const pager = el('div', 'map-label-pager'),
    previous = button(),
    next = button();
  pager.append(previous, count, next);
  listBox.append(listTitle, browseHint, search, filters, bulk, list, pager);
  // Map-wide toponym culture (same setting as the map naming stage): names-only, applied at once.
  const cultureHost = el('div', 'map-label-culture');
  const cultureForm = mountParameterForm(cultureHost, [{ path: 'toponymCulture', id: 'labels-toponym-culture', type: 'select', label: T.culture, optional: true, emptyLabel: T.ownCulture, options: CULTURE_LABELS.map(([value, label]) => ({ value, label })) }], {
    getValue: () => api.getSettings().naming?.toponymCulture,
    setValue: (_path, value) => {
      const s = api.getSettings();
      s.naming ??= {};
      if (value) s.naming.toponymCulture = String(value);
      else delete s.naming.toponymCulture;
      renamed();
    },
  });
  // Pick on map: the panel's click-to-select, extended from labels to the named features under them.
  const pickButton = button('map-label-pick'),
    pickText = el('span');
  pickButton.append(lineIcon('crosshair'), pickText);
  pickButton.id = 'map-label-pick';
  box.append(cultureHost, pickButton, status, listBox, empty, card, add, towns);
  const marker = el('div', 'map-label-marker');
  marker.hidden = true;
  document.body.append(marker);

  let candidates: LabelCandidate[] = [],
    entries = new Map<string, NameEntry>(),
    selected = '';
  let open = false,
    picking: 'select' | 'create' | 'place' = 'select',
    frame = 0,
    townKeys = '',
    pickOn = false;
  const selectTool = button();
  selectTool.id = 'edit-select';
  selectTool.setAttribute('aria-pressed', 'false');
  document.getElementById('labels-open')?.before(selectTool);
  editorButtonIcon(selectTool, 'display-layers');
  let townInputs: { key: string; input: HTMLInputElement }[] = [];
  let page = 0,
    matches: LabelCandidate[] = [];
  const PAGE_SIZE = 100;
  const settings = api.getSettings;
  const edits = (): Record<string, LabelEdit> => {
    const s = settings();
    s.naming ??= {};
    return (s.naming.labels ??= {});
  };
  const changed = (): void => {
    api.onChange();
  };
  const renamed = (): void => {
    (api.onNames ?? api.onChange)();
  };
  const current = (): LabelCandidate | undefined => candidates.find(c => c.id === selected);
  const kindOf = (c: LabelCandidate): string => kindName(c, entries.get(c.id)?.parts?.role);
  let presentation: NamePresentation | undefined;
  const targetOf = (c: LabelCandidate): ToponymTarget => {
    const entry = entries.get(c.id);
    return { id: c.id, town: entry ? settlementKeyOf(entry) : undefined, kind: c.id.startsWith('free:') ? 'free' : c.kind };
  };
  /** The name the generator gives for the current culture and language, when the names bank retains it. */
  const generatedName = (id: string): string | undefined => {
    const parts = api.getWorld()?.names?.bank?.[id]?.parts;
    return parts ? presentName(parts, presentation) : undefined;
  };

  function locale(): void {
    townsTitle.textContent = translate(T.towns);
    townsHint.textContent = translate(T.townsHint);
    add.textContent = translate(T.add);
    status.textContent = translate(picking === 'create' ? T.creating : picking === 'place' ? T.moving : pickOn ? T.picking : T.idle);
    pickText.textContent = translate(T.pick);
    selectTool.textContent = translate(T.select);
    input.setAttribute('aria-label', translate(T.text));
    input.placeholder = translate(T.text);
    genericText.textContent = translate(T.keepGeneric);
    hide.textContent = translate(edits()[selected]?.hidden === false ? T.hide : T.show);
    autoVisibility.textContent = translate(T.automatic);
    autoVisibility.disabled = edits()[selected]?.hidden === undefined;
    move.textContent = translate(picking === 'place' ? T.cancelMove : T.move);
    other.textContent = translate(T.other);
    reset.textContent = translate(selected.startsWith('free:') ? T.remove : T.reset);
    styleTitle.textContent = translate(T.style);
    colorText.textContent = translate(T.colour);
    sizeText.textContent = translate(T.size);
    boldText.textContent = translate(T.bold);
    italicText.textContent = translate(T.italic);
    profileText.textContent = translate(T.profile);
    const profileValue = profile.value;
    profile.replaceChildren(new Option(translate(T.inherit), ''), ...TOPONYM_PROFILES.map(p => new Option(translate(nameProfileLabels[p.id] ?? p.id.replaceAll('-', ' ')), p.id)));
    profile.value = profileValue;
    listTitle.textContent = translate(T.browse);
    browseHint.textContent = translate(T.browseHint);
    search.placeholder = translate(T.search);
    search.setAttribute('aria-label', search.placeholder);
    filter.setAttribute('aria-label', translate(T.list));
    placeFilter.setAttribute('aria-label', translate(T.allPlaces));
    visibilityFilter.setAttribute('aria-label', translate(T.visibility));
    const visibilityValue = visibilityFilter.value || 'all';
    visibilityFilter.replaceChildren(
      ...[
        ['all', T.allStates],
        ['auto', T.automatic],
        ['show', T.forced],
        ['hide', T.hiddenNames],
      ].map(([id, text]) => new Option(translate(text), id)),
    );
    visibilityFilter.value = visibilityValue;
    previous.textContent = translate(T.previous);
    next.textContent = translate(T.next);
    bulkCaption.textContent = translate(T.applyMatches);
    bulkButtons.forEach((b, i) => (b.textContent = translate([T.automatic, T.show, T.hide][i])));
    const filterValue = filter.value || 'all';
    filter.replaceChildren(...FILTERS.map(([id, text]) => new Option(translate(text), id)));
    filter.value = filterValue;
    empty.textContent = translate(T.nothing);
  }

  function syncTowns(): void {
    const world = api.getWorld();
    // A map with a single town has no settlement list: its town label still names it.
    const named = [...entries.values()].map(settlementKeyOf).filter((key): key is string => !!key);
    const places = world?.settlements?.length ? world.settlements.map(p => ({ key: p.key })) : [...new Set(named)].map(key => ({ key }));
    const keys = JSON.stringify(places.map(p => p.key));
    if (keys !== townKeys) {
      townKeys = keys;
      townRows.replaceChildren();
      townInputs = [];
      if (!places.length) townRows.append(el('p', 'hint', translate(T.noTowns)));
      for (const place of places) {
        const town = el('input');
        town.type = 'text';
        town.maxLength = 200;
        town.dataset.placeName = place.key;
        town.onchange = () => {
          const s = settings();
          s.naming ??= {};
          s.naming.places ??= {};
          if (town.value.trim()) s.naming.places[place.key] = town.value.trim();
          else delete s.naming.places[place.key];
          renamed();
        };
        town.onfocus = () => {
          const entry = [...entries.values()].find(e => settlementKeyOf(e) === place.key);
          if (entry) select(entry.id, false);
        };
        townRows.append(town);
        townInputs.push({ key: place.key, input: town });
      }
    }
    for (const { key, input: town } of townInputs) {
      const generated = world ? ([...entries.values()].find(e => settlementKeyOf(e) === key && !settings().naming?.places?.[key])?.text ?? world.settlements?.find(p => p.key === key)?.name) : undefined;
      if (document.activeElement !== town) town.value = settings().naming?.places?.[key] ?? '';
      town.placeholder = generated ?? key;
      town.setAttribute('aria-label', generated ?? key);
    }
  }

  function populate(): void {
    const term = search.value.trim().toLocaleLowerCase(),
      test = FILTERS.find(f => f[0] === filter.value)?.[2] ?? FILTERS[0][2];
    const shownEdits = edits();
    // Keep a name being typed (and its caret) through background refreshes of the list.
    const active = document.activeElement instanceof HTMLInputElement && list.contains(document.activeElement) ? document.activeElement : undefined;
    const typing = active ? { id: active.closest<HTMLElement>('[data-label-id]')?.dataset.labelId, value: active.value, start: active.selectionStart, end: active.selectionEnd } : undefined;
    list.replaceChildren();
    matches = [];
    const sorted = candidates.filter(test).sort((a, b) => kindOf(a).localeCompare(kindOf(b)) || a.text.localeCompare(b.text));
    for (const c of sorted) {
      const caption = `${c.text || c.id} — ${kindOf(c)}`;
      if (term && !caption.toLocaleLowerCase().includes(term)) continue;
      if (placeFilter.value && candidatePlace(c) !== placeFilter.value) continue;
      const hidden = shownEdits[c.id]?.hidden;
      if ((visibilityFilter.value === 'auto' && hidden !== undefined) || (visibilityFilter.value === 'show' && hidden !== false) || (visibilityFilter.value === 'hide' && hidden !== true)) continue;
      matches.push(c);
    }
    page = Math.min(page, Math.max(0, Math.ceil(matches.length / PAGE_SIZE) - 1));
    let group = '';
    for (const c of matches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
      const name = kindOf(c);
      if (name !== group) {
        group = name;
        list.append(el('h4', 'map-label-group', name));
      }
      list.append(resultRow(c, name));
    }
    if (typing?.id) {
      const field = list.querySelector<HTMLInputElement>(`[data-label-id="${CSS.escape(typing.id)}"] .map-label-name`);
      if (field) {
        field.value = typing.value;
        field.focus({ preventScroll: true });
        try {
          field.setSelectionRange(typing.start, typing.end);
        } catch {
          /* not a text selection */
        }
      }
    }
    count.textContent = matches.length
      ? translate(T.page)
          .replace('{from}', String(page * PAGE_SIZE + 1))
          .replace('{to}', String(Math.min(matches.length, (page + 1) * PAGE_SIZE)))
          .replace('{total}', String(matches.length))
      : translate(T.none);
    previous.disabled = page === 0;
    next.disabled = (page + 1) * PAGE_SIZE >= matches.length;
    bulkButtons.forEach(b => (b.disabled = !matches.length));
  }

  /** One toponym: its name in an editable field, an eye (shown / hidden) and a reset to the generated name. */
  function resultRow(c: LabelCandidate, kind: string): HTMLElement {
    const row = el('div', 'map-label-result');
    row.dataset.labelId = c.id;
    row.classList.toggle('is-selected', selected === c.id);
    const target = targetOf(c),
      generated = generatedName(c.id);
    const field = el('input', 'map-label-name');
    field.type = 'text';
    field.maxLength = TOPONYM_MAX_LENGTH;
    field.value = c.text;
    field.spellcheck = false;
    if (!c.text) field.placeholder = translate(T.unnamed);
    field.title = `${c.text || translate(T.unnamed)} · ${kind}`;
    field.setAttribute('aria-label', `${translate(T.text)} · ${kind}`);
    field.onfocus = () => {
      if (selected !== c.id) {
        highlight(c.id);
        api.focus?.(edits()[c.id]?.anchor ?? c.anchor);
      }
    };
    field.onchange = () => {
      if (field.value.trim() === c.text) return;
      // Empty text is refused: the previous name comes back (the arrow is the way to the generated name).
      if (!renameToponym(settings(), target, field.value, generated)) {
        field.value = c.text;
        return;
      }
      c.text = field.value.trim();
      renamed();
    };
    field.onkeydown = e => {
      if (e.key === 'Enter') field.blur();
      else if (e.key === 'Escape') {
        field.value = c.text;
        field.blur();
        e.stopPropagation();
      }
    };
    const eye = button('map-label-icon map-label-eye');
    paintEye(eye, c, kind);
    // Drawn → hide; hidden or not drawn → always show. Automatic comes back through the reset arrow.
    // Acting on a row selects it, so the card below always describes that row.
    eye.onclick = () => {
      selected = c.id;
      setVisibility(c, eye.dataset.eye === 'shown' ? 'hide' : 'show');
      populate();
      fields();
      track();
      changed();
    };
    const restore = button('map-label-icon map-label-reset');
    restore.append(lineIcon('reset'));
    const visibilityEdited = edits()[c.id]?.hidden !== undefined;
    restore.disabled = !hasToponymOverride(settings(), target) && !visibilityEdited;
    restore.title = generated && hasToponymOverride(settings(), target) ? translate(T.restoreNamed).replace('{name}', generated) : translate(T.restoreName);
    restore.setAttribute('aria-label', restore.title);
    restore.onclick = () => {
      highlight(c.id);
      resetToponymName(settings(), target);
      setVisibility(c, 'auto');
      restore.disabled = true;
      renamed();
    };
    row.append(field, eye, restore);
    return row;
  }
  /** The eye tells what the map shows now: drawn, hidden by the user, or automatic but not drawn at this view. */
  function paintEye(eye: HTMLButtonElement, c: LabelCandidate, kind: string): void {
    const hidden = edits()[c.id]?.hidden === true,
      drawn = drawnLabelIds();
    const state = hidden ? 'hidden' : !drawn || drawn.has(c.id) ? 'shown' : 'undrawn';
    if (eye.dataset.eye === state) return;
    eye.dataset.eye = state;
    eye.replaceChildren(lineIcon(state === 'hidden' ? 'eye-off' : 'eye'));
    eye.setAttribute('aria-pressed', String(state === 'shown'));
    eye.title = translate(state === 'hidden' ? T.hiddenEye : state === 'undrawn' ? T.undrawnEye : T.shownEye);
    eye.setAttribute('aria-label', `${eye.title} · ${c.text || kind}`);
  }
  function repaintEyes(): void {
    for (const row of Array.from(list.querySelectorAll<HTMLElement>('.map-label-result'))) {
      const c = candidates.find(candidate => candidate.id === row.dataset.labelId),
        eye = row.querySelector<HTMLButtonElement>('.map-label-eye');
      if (c && eye) paintEye(eye, c, kindOf(c));
    }
  }
  onDrawnLabelsChange(() => {
    if (open) repaintEyes();
  });
  /** Select without rebuilding the list, so the field the user clicked keeps its focus and caret. */
  function highlight(id: string): void {
    selected = id;
    if (picking === 'place') picking = 'select';
    for (const row of Array.from(list.querySelectorAll<HTMLElement>('.map-label-result'))) row.classList.toggle('is-selected', row.dataset.labelId === id);
    fields();
    track();
  }

  function candidatePlace(c: LabelCandidate): string {
    const entry = entries.get(c.id);
    const parts = c.id.split(':');
    return (
      entry?.cityKey ??
      (entry && settlementKeyOf(entry)) ??
      (parts[0] === 'urban'
        ? decodeURIComponent(parts[1])
        : parts[0] === 'classic'
          ? ['quarter', 'parcel', 'building'].includes(parts[1])
            ? 'main'
            : decodeURIComponent(parts[1])
          : ['street', 'quarter', 'district', 'gate', 'castle', 'church', 'square', 'building', 'parcel'].includes(c.kind) && !c.id.startsWith('free:')
            ? 'main'
            : '')
    );
  }
  function setVisibility(c: LabelCandidate, value: string): void {
    const edit = { ...edits()[c.id] };
    if (value === 'auto') delete edit.hidden;
    else edit.hidden = value === 'hide';
    // Native landmarks may have a suggested caption without a generated NameEntry.
    if (value === 'show' && !entries.has(c.id) && c.text) {
      edit.text ??= c.text;
      if (c.kind === 'quarter' || c.kind === 'parcel' || c.kind === 'building') edit.kind = c.kind;
    }
    if (Object.keys(edit).length) edits()[c.id] = edit;
    else delete edits()[c.id];
  }

  function fields(): void {
    const c = current(),
      edit = edits()[selected],
      entry = entries.get(selected);
    card.hidden = !c;
    empty.hidden = !!c;
    if (!c) {
      marker.hidden = true;
      return;
    }
    const town = entry ? settlementKeyOf(entry) : undefined;
    kind.textContent = kindOf(c);
    state.textContent = [edit?.hidden ? translate(T.hidden) : '', edit && (edit.text || edit.anchor || edit.style) ? translate(T.edited) : ''].filter(Boolean).join(' · ');
    if (document.activeElement !== input) input.value = town ? (settings().naming?.places?.[town] ?? entry?.text ?? '') : (edit?.text ?? c.text);
    const canKeepGeneric = !town && !!entry?.parts && !entry.parts.opaque && entry.kind !== 'town' && entry.kind !== 'village';
    genericRow.hidden = !canKeepGeneric;
    generic.checked = edit?.mode === 'proper';
    other.hidden = !entry?.parts || !!entry.manual || !!town;
    profileField.hidden = !entry?.parts || !!town;
    profile.value = settings().naming?.features?.[selected]?.profile ?? '';
    color.value = edit?.style?.color ?? '#493c2b';
    size.value = String(edit?.style?.size ?? 1);
    bold.checked = !!edit?.style?.bold;
    italic.checked = !!edit?.style?.italic;
    hide.hidden = false;
    locale();
  }

  function select(id: string, focus = true): void {
    selected = id;
    if (picking === 'place') picking = 'select';
    populate();
    fields();
    track();
    if (focus) {
      input.focus();
      input.select();
    }
  }

  function write(patch: Partial<LabelEdit>): void {
    const c = current();
    if (!c) return;
    const next: LabelEdit = { ...edits()[selected], ...patch };
    if (c.id.startsWith('free:')) next.kind = 'free';
    else if (c.kind === 'quarter' || c.kind === 'parcel' || c.kind === 'building') next.kind ??= c.kind;
    edits()[selected] = next;
    changed();
  }

  function setPicking(next: typeof picking): void {
    picking = next;
    if (api.map) api.map.style.cursor = next === 'select' && !pickOn ? '' : 'crosshair';
    locale();
  }
  function setPick(on: boolean): void {
    pickOn = on;
    pickButton.setAttribute('aria-pressed', String(on));
    selectTool.setAttribute('aria-pressed', String(on && open));
    setPicking(picking);
  }
  /** Show a name's row whatever the current filters or page, with its field focused for editing. */
  function reveal(id: string): void {
    filter.value = 'all';
    placeFilter.value = '';
    visibilityFilter.value = 'all';
    search.value = '';
    selected = id;
    page = 0;
    populate();
    const index = matches.findIndex(c => c.id === id);
    if (index >= PAGE_SIZE) {
      page = Math.floor(index / PAGE_SIZE);
      populate();
    }
    fields();
    track();
    const field = list.querySelector<HTMLInputElement>(`[data-label-id="${CSS.escape(id)}"] .map-label-name`);
    if (field) {
      field.scrollIntoView({ block: 'center' });
      field.focus({ preventScroll: true });
      field.select();
    }
  }

  // The marker follows the view while a label is selected and the panel is open.
  function track(): void {
    cancelAnimationFrame(frame);
    const step = (): void => {
      const c = current(),
        view = api.getView?.(),
        map = api.map;
      if (!open || !c || !view || !map) {
        marker.hidden = true;
        return;
      }
      const anchor = edits()[selected]?.anchor ?? c.anchor,
        rect = map.getBoundingClientRect();
      const [x, y] = worldToScreen(view, rect.width, rect.height, anchor.x, anchor.y);
      const inside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
      marker.hidden = !inside;
      if (inside) marker.style.transform = `translate(${rect.left + x}px, ${rect.top + y}px)`;
      frame = requestAnimationFrame(step);
    };
    step();
  }

  function nearest(point: Vec2, feature = false): LabelCandidate | undefined {
    const view = api.getView?.(),
      limit = view ? PICK_PX / view.scale : (api.getWorld()?.mapSize ?? 0) * 0.03,
      drawn = drawnLabelIds();
    let best: LabelCandidate | undefined,
      distance = limit;
    for (const c of candidates) {
      if (!c.text) continue;
      const edit = edits()[c.id];
      if (edit?.hidden && !feature) continue;
      // Picking reads what the map shows: a label counts only where it is drawn.
      if (feature && drawn && !drawn.has(c.id)) continue;
      const entry = entries.get(c.id),
        anchor = edit?.anchor ?? c.anchor;
      const d = Math.min(Math.hypot(anchor.x - point.x, anchor.y - point.y), edit?.anchor ? Infinity : pathDistance(entry?.path, point));
      // Author labels win ties: they are what the user just placed.
      const score = d * (c.id.startsWith('free:') ? 0.7 : 1);
      if (score < distance) {
        distance = score;
        best = c;
      }
    }
    if (best || !feature) return best;
    // No drawn label under the click: the settlement around it, else the nearest named feature (river course, relief, water…).
    const world = api.getWorld();
    const place = world?.settlements?.map(s => ({ s, d: Math.hypot((s.core ?? s.center).x - point.x, (s.core ?? s.center).y - point.y) })).sort((a, b) => a.d - b.d)[0];
    if (place && place.d < Math.max(limit * 6, Math.sqrt(place.s.population) * 3))
      best = candidates.find(c => {
        const e = entries.get(c.id);
        return !!e && settlementKeyOf(e) === place.s.key;
      });
    if (best) return best;
    let reach = limit * 4;
    for (const c of candidates) {
      if (!c.text || c.id.startsWith('free:') || c.kind === 'building' || c.kind === 'parcel') continue;
      const entry = entries.get(c.id);
      const d = Math.min(Math.hypot(c.anchor.x - point.x, c.anchor.y - point.y), pathDistance(entry?.path, point));
      if (d < reach) {
        reach = d;
        best = c;
      }
    }
    return best;
  }

  function create(point: Vec2): void {
    const id = `free:${crypto.randomUUID()}`,
      text = translate(T.newLabel);
    edits()[id] = { kind: 'free', text, anchor: { ...point } };
    candidates.push({ id, kind: 'square', text, anchor: { ...point } });
    setPicking('select');
    filter.value = 'all';
    search.value = '';
    select(id);
    changed();
  }

  input.addEventListener('change', () => {
    const c = current();
    if (!c) return;
    const entry = entries.get(selected),
      town = entry ? settlementKeyOf(entry) : undefined,
      value = input.value.trim().slice(0, 200);
    if (town) {
      const s = settings();
      s.naming ??= {};
      s.naming.places ??= {};
      if (value) s.naming.places[town] = value;
      else delete s.naming.places[town];
      renamed();
      return;
    }
    if (!value && !c.id.startsWith('free:')) {
      const { text: _text, mode: _mode, ...rest } = edits()[selected] ?? {};
      edits()[selected] = rest;
      changed();
      return;
    }
    write({ text: value, mode: generic.checked ? 'proper' : 'label' });
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') input.blur();
  });
  generic.onchange = () => {
    if (edits()[selected]?.text) write({ mode: generic.checked ? 'proper' : 'label' });
  };
  for (const control of [color, size, bold, italic]) control.addEventListener('change', () => write({ style: { color: color.value, size: Math.max(0.25, Math.min(4, Number(size.value) || 1)), bold: bold.checked, italic: italic.checked } }));
  move.onclick = () => setPicking(picking === 'place' ? 'select' : 'place');
  hide.onclick = () => {
    const c = current();
    if (!c) return;
    setVisibility(c, edits()[selected]?.hidden === false ? 'hide' : 'show');
    populate();
    fields();
    changed();
  };
  autoVisibility.onclick = () => {
    const c = current();
    if (!c) return;
    setVisibility(c, 'auto');
    populate();
    fields();
    changed();
  };
  other.onclick = () => {
    const s = settings();
    s.naming ??= {};
    varyNames(s.naming, `feature:${selected}`);
    renamed();
  };
  reset.onclick = () => {
    const free = selected.startsWith('free:');
    delete edits()[selected];
    const s = settings();
    if (s.naming?.features?.[selected]) {
      delete s.naming.features[selected];
    }
    if (free) {
      candidates = candidates.filter(c => c.id !== selected);
      selected = '';
    }
    populate();
    fields();
    changed();
  };
  profile.onchange = () => {
    const s = settings();
    s.naming ??= {};
    s.naming.features ??= {};
    if (profile.value) s.naming.features[selected] = { ...s.naming.features[selected], profile: profile.value };
    else delete s.naming.features[selected];
    renamed();
  };
  add.onclick = () => {
    if (!api.getWorld()) return;
    setPicking(picking === 'create' ? 'select' : 'create');
  };
  for (const control of [search, filter, placeFilter, visibilityFilter])
    control.addEventListener(control === search ? 'input' : 'change', () => {
      page = 0;
      populate();
    });
  previous.onclick = () => {
    page--;
    populate();
    list.scrollTop = 0;
  };
  next.onclick = () => {
    page++;
    populate();
    list.scrollTop = 0;
  };
  bulkButtons.forEach(
    (b, i) =>
      (b.onclick = () => {
        for (const c of matches) setVisibility(c, ['auto', 'show', 'hide'][i]);
        populate();
        fields();
        changed();
      }),
  );
  document.addEventListener('keydown', e => {
    if (!open || e.key !== 'Escape') return;
    if (picking !== 'select') setPicking('select');
    else if (pickOn) setPick(false);
  });
  window.addEventListener('v2-edit-mode', e => {
    open = (e as CustomEvent).detail === 'labels';
    if (!open) {
      pickOn = false;
      setPick(false);
      setPicking('select');
      marker.hidden = true;
      cancelAnimationFrame(frame);
    } else {
      selectTool.setAttribute('aria-pressed', String(pickOn));
      track();
    }
  });
  pickButton.onclick = () => setPick(!pickOn);
  // The Editor tab's Select tool: the names panel in pick mode.
  selectTool.onclick = () => {
    if (!api.getWorld()) return;
    if (open && pickOn) {
      window.dispatchEvent(new CustomEvent('v2-edit-mode', { detail: 'navigate' }));
      return;
    }
    if (!open) window.dispatchEvent(new CustomEvent('v2-edit-mode', { detail: 'labels' }));
    setPick(true);
  };

  function sync(): void {
    const world = api.getWorld();
    add.disabled = !world;
    const shown = world ? mapPresentation(world, settings()) : undefined;
    presentation = shown?.names?.presentation;
    entries = new Map((shown?.names?.entries ?? []).map(e => [e.id, e]));
    candidates = shown ? labelCandidates(shown) : [];
    const place = placeFilter.value;
    placeFilter.replaceChildren(new Option(translate(T.allPlaces), ''), ...(world?.settlements ?? []).map(p => new Option(p.name || p.key, p.key)));
    if (Array.from(placeFilter.options).some(o => o.value === place)) placeFilter.value = place;
    // Free labels without text are still selectable until the user types one.
    for (const [id, edit] of Object.entries(settings().naming?.labels ?? {})) if (id.startsWith('free:') && !candidates.some(c => c.id === id) && edit.anchor) candidates.push({ id, kind: 'square', text: edit.text ?? '', anchor: edit.anchor });
    if (selected && !candidates.some(c => c.id === selected)) selected = '';
    cultureForm.sync();
    syncTowns();
    populate();
    fields();
  }
  onLanguageChange(() => {
    townKeys = '';
    locale();
    sync();
  });
  locale();
  fields();
  return {
    sync,
    active: () => open,
    stop: () => setPicking('select'),
    start: () => {
      if (selected) setPicking('place');
    },
    selectPlace(key) {
      const entry = [...entries.values()].find(e => settlementKeyOf(e) === key);
      if (entry) {
        filter.value = 'all';
        placeFilter.value = '';
        visibilityFilter.value = 'all';
        search.value = '';
        select(entry.id);
        card.scrollIntoView({ block: 'nearest' });
      }
    },
    pick(point) {
      if (!open || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      if (picking === 'create') {
        create(point);
        return;
      }
      if (picking === 'place') {
        setPicking('select');
        write({ anchor: { x: point.x, y: point.y } });
        track();
        return;
      }
      if (!pickOn) {
        const hit = nearest(point);
        if (hit) select(hit.id);
        else {
          selected = '';
          populate();
          fields();
        }
        return;
      }
      const hit = nearest(point, true);
      if (!hit) {
        selected = '';
        populate();
        fields();
        return;
      }
      reveal(hit.id);
      const entry = entries.get(hit.id),
        town = entry ? settlementKeyOf(entry) : undefined;
      if (town) api.onPlace?.(town);
    },
  };
}
