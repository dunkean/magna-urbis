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

const copy = (en: string, fr: string): string => { registerMessages({ [en]: { en, fr } }); return en; };
const T = {
  towns: copy('Town names', 'Noms des villes'),
  townsHint: copy('Leave empty to keep the generated name.', 'Laisser vide pour garder le nom généré.'),
  noTowns: copy('Generate a map to name its towns.', 'Générez une carte pour nommer ses villes.'),
  idle: copy('Click a name on the map to edit it.', 'Cliquez sur un nom de la carte pour le modifier.'),
  creating: copy('Click on the map where the new label goes. Esc cancels.', 'Cliquez sur la carte à l’endroit du nouveau label. Échap pour annuler.'),
  moving: copy('Click on the map where this label goes. Esc cancels.', 'Cliquez sur la carte à la nouvelle place du label. Échap pour annuler.'),
  add: copy('+ Add a label', '+ Ajouter un label'),
  newLabel: copy('New label', 'Nouveau label'),
  text: copy('Label text', 'Texte du label'),
  keepGeneric: copy('Rename only the proper name (keep “Street”, “Gate”…)', 'Renommer seulement le nom propre (garder « Rue », « Porte »…)'),
  move: copy('Move', 'Déplacer'), cancelMove: copy('Cancel move', 'Annuler le déplacement'),
  hide: copy('Hide', 'Masquer'), show: copy('Show', 'Afficher'),
  other: copy('Other name', 'Autre nom'),
  reset: copy('Reset', 'Réinitialiser'), remove: copy('Delete label', 'Supprimer le label'),
  hidden: copy('hidden', 'masqué'), edited: copy('edited', 'modifié'),
  style: copy('Style', 'Style'), colour: copy('Colour', 'Couleur'), size: copy('Size', 'Taille'), bold: copy('Bold', 'Gras'), italic: copy('Italic', 'Italique'),
  profile: copy('Name profile', 'Profil du nom'), inherit: copy('Inherit from the district or town', 'Hériter du quartier ou de la ville'),
  list: copy('All names', 'Tous les noms'), search: copy('Search names', 'Rechercher un nom'),
  more: copy('{shown} of {matches} · refine the search', '{shown} sur {matches} · affinez la recherche'),
  none: copy('No name matches.', 'Aucun nom ne correspond.'),
  nothing: copy('Nothing selected.', 'Aucune sélection.'),
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
  town: copy('Town', 'Ville'), village: copy('Village', 'Village'), farm: copy('Farm', 'Ferme'), street: copy('Street', 'Rue'), road: copy('Road', 'Route'),
  bridge: copy('Bridge', 'Pont'), quarter: copy('District', 'Quartier'), district: copy('District', 'Quartier'), gate: copy('Gate', 'Porte'),
  castle: copy('Castle', 'Château'), church: copy('Place of worship', 'Lieu de culte'), square: copy('Square', 'Place'), building: copy('Building', 'Bâtiment'),
  parcel: copy('Parcel', 'Parcelle'), river: copy('River', 'Rivière'), lake: copy('Lake', 'Lac'), sea: copy('Sea', 'Mer'), forest: copy('Forest', 'Forêt'),
  hill: copy('Hill', 'Colline'), free: copy('Free label', 'Label libre'),
};
const kindName = (c: LabelCandidate): string => translate(c.id.startsWith('free:') ? KIND_NAMES.free : KIND_NAMES[c.kind] ?? KIND_NAMES.building);
const PICK_PX = 28;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node;
};
const button = (cls = ''): HTMLButtonElement => { const b = el('button', cls); b.type = 'button'; return b; };

function pathDistance(path: Vec2[] | undefined, p: Vec2): number {
  if (!path || path.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
    best = Math.min(best, Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y));
  }
  return best;
}

/** Names panel: towns first, then the name picked on the map; the full list stays one click away. */
export function mountMapLabelEditor(host: HTMLElement, api: {
  getWorld(): World | undefined; getSettings(): V2Settings; onChange(): void; onNames?(): void;
  map?: HTMLElement; getView?(): View;
}): { sync(): void; active(): boolean; stop(): void; pick(point: Vec2): void; start(): void } {
  const box = el('section', 'map-label-editor'); host.append(box);
  const status = el('p', 'hint map-label-status'); status.setAttribute('aria-live', 'polite');
  const add = button('primary map-label-add');
  // Towns.
  const towns = el('details', 'map-label-towns'); towns.open = true;
  const townsTitle = el('summary'), townsHint = el('p', 'hint'), townRows = el('div', 'map-label-town-rows');
  towns.append(townsTitle, townsHint, townRows);
  // Selected label.
  const card = el('div', 'map-label-card');
  const cardHead = el('div', 'map-label-card-head'), kind = el('span', 'map-label-kind'), state = el('span', 'map-label-state');
  cardHead.append(kind, state);
  const input = el('input'); input.type = 'text'; input.maxLength = 200;
  const genericRow = el('label', 'map-label-check'), generic = el('input'), genericText = el('span'); generic.type = 'checkbox'; genericRow.append(generic, genericText);
  const actions = el('div', 'map-label-actions');
  const move = button(), hide = button(), other = button(), reset = button();
  actions.append(move, hide, other, reset);
  const styleBox = el('details', 'map-label-style'), styleTitle = el('summary');
  const color = el('input'), size = el('input'), bold = el('input'), italic = el('input'), profile = el('select');
  color.type = 'color'; size.type = 'number'; size.min = '.25'; size.max = '4'; size.step = '.1'; bold.type = italic.type = 'checkbox'; profile.id = 'map-label-profile';
  const field = (control: HTMLElement): [HTMLLabelElement, HTMLSpanElement] => { const l = el('label', 'map-label-field'), s = el('span'); l.append(s, control); return [l, s]; };
  const [colorField, colorText] = field(color), [sizeField, sizeText] = field(size), [boldField, boldText] = field(bold), [italicField, italicText] = field(italic), [profileField, profileText] = field(profile);
  const styleRow = el('div', 'map-label-style-row'); styleRow.append(colorField, sizeField, boldField, italicField);
  styleBox.append(styleTitle, styleRow, profileField);
  const empty = el('p', 'hint');
  card.append(cardHead, input, genericRow, actions, styleBox);
  // Full list.
  const listBox = el('details', 'map-label-list'), listTitle = el('summary');
  const filter = el('select'), search = el('input'), list = el('select'), count = el('small', 'hint');
  search.type = 'search'; list.size = 10;
  listBox.append(listTitle, filter, search, list, count);
  box.append(status, add, towns, empty, card, listBox);
  const marker = el('div', 'map-label-marker'); marker.hidden = true; document.body.append(marker);

  let candidates: LabelCandidate[] = [], entries = new Map<string, NameEntry>(), selected = '';
  let open = false, picking: 'select' | 'create' | 'place' = 'select', frame = 0, townKeys = '';
  let townInputs: { key: string; input: HTMLInputElement }[] = [];
  const settings = api.getSettings;
  const edits = (): Record<string, LabelEdit> => { const s = settings(); s.naming ??= {}; return s.naming.labels ??= {}; };
  const changed = (): void => { api.onChange(); };
  const renamed = (): void => { (api.onNames ?? api.onChange)(); };
  const current = (): LabelCandidate | undefined => candidates.find(c => c.id === selected);

  function locale(): void {
    townsTitle.textContent = translate(T.towns); townsHint.textContent = translate(T.townsHint);
    add.textContent = translate(T.add);
    status.textContent = translate(picking === 'create' ? T.creating : picking === 'place' ? T.moving : T.idle);
    input.setAttribute('aria-label', translate(T.text)); input.placeholder = translate(T.text);
    genericText.textContent = translate(T.keepGeneric);
    hide.textContent = translate(edits()[selected]?.hidden ? T.show : T.hide);
    move.textContent = translate(picking === 'place' ? T.cancelMove : T.move);
    other.textContent = translate(T.other);
    reset.textContent = translate(selected.startsWith('free:') ? T.remove : T.reset);
    styleTitle.textContent = translate(T.style); colorText.textContent = translate(T.colour); sizeText.textContent = translate(T.size);
    boldText.textContent = translate(T.bold); italicText.textContent = translate(T.italic); profileText.textContent = translate(T.profile);
    const profileValue = profile.value;
    profile.replaceChildren(new Option(translate(T.inherit), ''), ...TOPONYM_PROFILES.map(p => new Option(translate(nameProfileLabels[p.id] ?? p.id.replaceAll('-', ' ')), p.id)));
    profile.value = profileValue;
    listTitle.textContent = translate(T.list); search.placeholder = translate(T.search); search.setAttribute('aria-label', search.placeholder);
    list.setAttribute('aria-label', translate(T.list));
    const filterValue = filter.value || 'all';
    filter.replaceChildren(...FILTERS.map(([id, text]) => new Option(translate(text), id))); filter.value = filterValue;
    empty.textContent = translate(T.nothing);
  }

  function syncTowns(): void {
    const world = api.getWorld();
    // A map with a single town has no settlement list: its town label still names it.
    const named = [...entries.values()].map(settlementKeyOf).filter((key): key is string => !!key);
    const places = world?.settlements?.length ? world.settlements.map(p => ({ key: p.key })) : [...new Set(named)].map(key => ({ key }));
    const keys = JSON.stringify(places.map(p => p.key));
    if (keys !== townKeys) {
      townKeys = keys; townRows.replaceChildren(); townInputs = [];
      if (!places.length) townRows.append(el('p', 'hint', translate(T.noTowns)));
      for (const place of places) {
        const town = el('input'); town.type = 'text'; town.maxLength = 200; town.dataset.placeName = place.key;
        town.onchange = () => {
          const s = settings(); s.naming ??= {}; s.naming.places ??= {};
          if (town.value.trim()) s.naming.places[place.key] = town.value.trim(); else delete s.naming.places[place.key];
          renamed();
        };
        town.onfocus = () => { const entry = [...entries.values()].find(e => settlementKeyOf(e) === place.key); if (entry) select(entry.id, false); };
        townRows.append(town); townInputs.push({ key: place.key, input: town });
      }
    }
    for (const { key, input: town } of townInputs) {
      const generated = world ? [...entries.values()].find(e => settlementKeyOf(e) === key && !settings().naming?.places?.[key])?.text ?? world.settlements?.find(p => p.key === key)?.name : undefined;
      if (document.activeElement !== town) town.value = settings().naming?.places?.[key] ?? '';
      town.placeholder = generated ?? key; town.setAttribute('aria-label', generated ?? key);
    }
  }

  function populate(): void {
    const term = search.value.trim().toLocaleLowerCase(), test = FILTERS.find(f => f[0] === filter.value)?.[2] ?? FILTERS[0][2];
    const shownEdits = edits();
    list.replaceChildren();
    let shown = 0, matches = 0;
    const sorted = candidates.filter(test).sort((a, b) => kindName(a).localeCompare(kindName(b)) || a.text.localeCompare(b.text));
    for (const c of sorted) {
      const text = shownEdits[c.id]?.text || c.text || c.id;
      const caption = `${text} — ${kindName(c)}${shownEdits[c.id]?.hidden ? ` (${translate(T.hidden)})` : ''}`;
      if (term && !caption.toLocaleLowerCase().includes(term)) continue;
      matches++; if (shown >= 300) continue;
      list.add(new Option(caption, c.id)); shown++;
    }
    count.textContent = matches > shown ? translate(T.more).replace('{shown}', String(shown)).replace('{matches}', String(matches)) : matches ? String(matches) : translate(T.none);
    if (selected && Array.from(list.options).some(o => o.value === selected)) list.value = selected;
  }

  function fields(): void {
    const c = current(), edit = edits()[selected], entry = entries.get(selected);
    card.hidden = !c; empty.hidden = !!c;
    if (!c) { marker.hidden = true; return; }
    const town = entry ? settlementKeyOf(entry) : undefined;
    kind.textContent = kindName(c);
    state.textContent = [edit?.hidden ? translate(T.hidden) : '', edit && (edit.text || edit.anchor || edit.style) ? translate(T.edited) : ''].filter(Boolean).join(' · ');
    if (document.activeElement !== input) input.value = town ? settings().naming?.places?.[town] ?? entry?.text ?? '' : edit?.text ?? c.text;
    const canKeepGeneric = !town && !!entry?.parts && !entry.parts.opaque && entry.kind !== 'town' && entry.kind !== 'village';
    genericRow.hidden = !canKeepGeneric; generic.checked = edit?.mode === 'proper';
    other.hidden = !entry?.parts || !!entry.manual || !!town;
    profileField.hidden = !entry?.parts || !!town;
    profile.value = settings().naming?.features?.[selected]?.profile ?? '';
    color.value = edit?.style?.color ?? '#493c2b'; size.value = String(edit?.style?.size ?? 1);
    bold.checked = !!edit?.style?.bold; italic.checked = !!edit?.style?.italic;
    hide.hidden = !!town;
    locale();
  }

  function select(id: string, focus = true): void {
    selected = id; if (picking === 'place') picking = 'select';
    populate(); fields(); track();
    if (focus) { input.focus(); input.select(); }
  }

  function write(patch: Partial<LabelEdit>): void {
    const c = current(); if (!c) return;
    const next: LabelEdit = { ...edits()[selected], ...patch };
    if (c.id.startsWith('free:')) next.kind = 'free';
    else if (c.kind === 'quarter' || c.kind === 'parcel' || c.kind === 'building') next.kind ??= c.kind;
    edits()[selected] = next; changed();
  }

  function setPicking(next: typeof picking): void {
    picking = next;
    if (api.map) api.map.style.cursor = next === 'select' ? '' : 'crosshair';
    locale();
  }

  // The marker follows the view while a label is selected and the panel is open.
  function track(): void {
    cancelAnimationFrame(frame);
    const step = (): void => {
      const c = current(), view = api.getView?.(), map = api.map;
      if (!open || !c || !view || !map) { marker.hidden = true; return; }
      const anchor = edits()[selected]?.anchor ?? c.anchor, rect = map.getBoundingClientRect();
      const [x, y] = worldToScreen(view, rect.width, rect.height, anchor.x, anchor.y);
      const inside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
      marker.hidden = !inside;
      if (inside) marker.style.transform = `translate(${rect.left + x}px, ${rect.top + y}px)`;
      frame = requestAnimationFrame(step);
    };
    step();
  }

  function nearest(point: Vec2): LabelCandidate | undefined {
    const view = api.getView?.(), limit = view ? PICK_PX / view.scale : (api.getWorld()?.mapSize ?? 0) * .03;
    let best: LabelCandidate | undefined, distance = limit;
    for (const c of candidates) {
      if (!c.text) continue;
      const edit = edits()[c.id]; if (edit?.hidden) continue;
      const entry = entries.get(c.id), anchor = edit?.anchor ?? c.anchor;
      const d = Math.min(Math.hypot(anchor.x - point.x, anchor.y - point.y), edit?.anchor ? Infinity : pathDistance(entry?.path, point));
      // Author labels win ties: they are what the user just placed.
      const score = d * (c.id.startsWith('free:') ? .7 : 1);
      if (score < distance) { distance = score; best = c; }
    }
    return best;
  }

  function create(point: Vec2): void {
    const id = `free:${crypto.randomUUID()}`, text = translate(T.newLabel);
    edits()[id] = { kind: 'free', text, anchor: { ...point } };
    candidates.push({ id, kind: 'square', text, anchor: { ...point } });
    setPicking('select'); filter.value = 'all'; search.value = ''; select(id); changed();
  }

  input.addEventListener('change', () => {
    const c = current(); if (!c) return;
    const entry = entries.get(selected), town = entry ? settlementKeyOf(entry) : undefined, value = input.value.trim().slice(0, 200);
    if (town) { const s = settings(); s.naming ??= {}; s.naming.places ??= {}; if (value) s.naming.places[town] = value; else delete s.naming.places[town]; renamed(); return; }
    if (!value && !c.id.startsWith('free:')) { const { text: _text, mode: _mode, ...rest } = edits()[selected] ?? {}; edits()[selected] = rest; changed(); return; }
    write({ text: value, mode: generic.checked ? 'proper' : 'label' });
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  generic.onchange = () => { if (edits()[selected]?.text) write({ mode: generic.checked ? 'proper' : 'label' }); };
  for (const control of [color, size, bold, italic]) control.addEventListener('change', () => write({ style: {
    color: color.value, size: Math.max(.25, Math.min(4, Number(size.value) || 1)), bold: bold.checked, italic: italic.checked } }));
  move.onclick = () => setPicking(picking === 'place' ? 'select' : 'place');
  hide.onclick = () => { write({ hidden: !edits()[selected]?.hidden || undefined }); fields(); };
  other.onclick = () => { const s = settings(); s.naming ??= {}; varyNames(s.naming, `feature:${selected}`); renamed(); };
  reset.onclick = () => {
    const free = selected.startsWith('free:');
    delete edits()[selected];
    const s = settings(); if (s.naming?.features?.[selected]) { delete s.naming.features[selected]; }
    if (free) { candidates = candidates.filter(c => c.id !== selected); selected = ''; }
    populate(); fields(); changed();
  };
  profile.onchange = () => {
    const s = settings(); s.naming ??= {}; s.naming.features ??= {};
    if (profile.value) s.naming.features[selected] = { ...s.naming.features[selected], profile: profile.value }; else delete s.naming.features[selected];
    renamed();
  };
  add.onclick = () => { if (!api.getWorld()) return; setPicking(picking === 'create' ? 'select' : 'create'); };
  search.addEventListener('input', populate); filter.addEventListener('change', populate);
  list.addEventListener('change', () => { if (list.value) select(list.value, false); });
  document.addEventListener('keydown', e => { if (open && e.key === 'Escape' && picking !== 'select') setPicking('select'); });
  window.addEventListener('v2-edit-mode', e => {
    open = (e as CustomEvent).detail === 'labels';
    if (!open) { setPicking('select'); marker.hidden = true; cancelAnimationFrame(frame); } else track();
  });

  function sync(): void {
    const world = api.getWorld();
    add.disabled = !world;
    const shown = world ? mapPresentation(world, settings()) : undefined;
    entries = new Map((shown?.names?.entries ?? []).map(e => [e.id, e]));
    candidates = shown ? labelCandidates(shown) : [];
    // Free labels without text are still selectable until the user types one.
    for (const [id, edit] of Object.entries(settings().naming?.labels ?? {})) if (id.startsWith('free:') && !candidates.some(c => c.id === id) && edit.anchor)
      candidates.push({ id, kind: 'square', text: edit.text ?? '', anchor: edit.anchor });
    if (selected && !candidates.some(c => c.id === selected)) selected = '';
    syncTowns(); populate(); fields();
  }
  onLanguageChange(() => { townKeys = ''; locale(); sync(); });
  locale(); fields();
  return {
    sync, active: () => open, stop: () => setPicking('select'), start: () => { if (selected) setPicking('place'); },
    pick(point) {
      if (!open || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      if (picking === 'create') { create(point); return; }
      if (picking === 'place') { setPicking('select'); write({ anchor: { x: point.x, y: point.y } }); track(); return; }
      const hit = nearest(point);
      if (hit) select(hit.id); else { selected = ''; populate(); fields(); }
    },
  };
}
