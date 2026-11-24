/**
 * The entity sheet: what the selection tool picked on the map (entityPick.ts) with its name, type and key facts
 * (entityFacts.ts), the entities that hold it, and the actions the page already has for it: rename, redraw, edit, centre
 * on it, pin it. The sheet follows the displayed world (a run, a rename, another language) and closes with the tool.
 */
import type { PageActions, PageState } from './contract';
import type { Vec2 } from '../../gen/types';
import { entitiesAt, type Entity, type TownHit } from '../entityPick';
import { entityFacts, entityLabel, type EntityFacts, type EntityFactsInput } from '../entityFacts';
import { lineIcon } from '../editorIcons';
import { onLanguageChange, registerMessages, translate } from '../i18n';
import { renameToponym, TOPONYM_MAX_LENGTH } from '../toponymOverrides';
import { onUnitsChange } from '../units';
import { $ } from './dom';
import '../entitySheet.css';

registerMessages(
  Object.fromEntries(
    Object.entries({
      'Selected entity': 'Élément sélectionné',
      'Close the sheet': 'Fermer la fiche',
      'Nothing to select here.': 'Rien à sélectionner ici.',
      Rename: 'Renommer',
      Edit: 'Modifier',
      Centre: 'Centrer',
      'Add pin': 'Ajouter une épingle',
      'Pin added. Pins are shared with the map code.': 'Épingle ajoutée. Les épingles sont partagées avec le code de la carte.',
      'Redraw this place or area differently': 'Redessiner ce lieu ou cette zone autrement',
      Redraw: 'Redessiner',
    }).map(([en, fr]) => [en, { en, fr }]),
  ),
);
/** Pixels round the click within which a line (road, wall, river) is picked. */
const PICK_PX = 6;
/** Edit modes that keep the sheet: the selection itself and the runs it starts. */
const KEEPING_MODES = new Set(['buildings', 'selection', 'busy', 'family']);

export function createEntitySheet(state: PageState, actions: PageActions) {
  let sheet: HTMLElement | undefined,
    /** The shown entity, then those that hold it. */
    chain: Entity[] = [],
    tolerance = 0;
  const input = (): EntityFactsInput => ({ world: state.world!, settings: state.settings, reachedPopulation: actions.reachedPopulation });

  function host(): HTMLElement {
    if (sheet) return sheet;
    sheet = document.createElement('aside');
    sheet.id = 'entity-sheet';
    sheet.className = 'entity-sheet glass';
    sheet.hidden = true;
    $('.map-area').append(sheet);
    window.addEventListener('v2-edit-mode', event => {
      if (!KEEPING_MODES.has((event as CustomEvent<string>).detail)) close();
    });
    onLanguageChange(render);
    onUnitsChange(render);
    return sheet;
  }
  function close(): void {
    if (!chain.length) return;
    chain = [];
    host().hidden = true;
    state.selectionOutline.set();
  }
  function outline(): void {
    const [entity] = chain;
    if (entity) state.selectionOutline.set(entity.rings, entityLabel(entity, input()));
  }
  function button(label: string, run: () => void, title = label): HTMLButtonElement {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'small';
    node.textContent = translate(label);
    node.title = translate(title);
    node.onclick = run;
    return node;
  }
  function rename(heading: HTMLElement, facts: EntityFacts): void {
    const field = document.createElement('input');
    field.type = 'text';
    field.className = 'place-title-input';
    field.maxLength = TOPONYM_MAX_LENGTH;
    field.value = facts.title;
    field.setAttribute('aria-label', translate('Rename'));
    let done = false;
    const finish = (commit: boolean): void => {
      if (done) return;
      done = true;
      if (commit && field.value.trim() !== facts.title && renameToponym(state.settings, facts.name!, field.value)) void actions.redrawNames();
      render();
    };
    field.onkeydown = event => {
      if (event.key === 'Enter') finish(true);
      else if (event.key === 'Escape') {
        event.stopPropagation();
        finish(false);
      }
    };
    field.onblur = () => finish(true);
    heading.replaceChildren(field);
    field.focus();
    field.select();
  }
  /** Opens the inspector of the entity, on the level it edits. */
  function edit(entity: Entity): boolean {
    if (entity.kind === 'building') actions.showBuilding(entity.hit!);
    else if (entity.kind === 'block' || entity.kind === 'quarter') return actions.inspectSubdivision(entity.kind, entity.point, entity.town);
    else if (entity.kind === 'settlement') actions.showInspector(entity.town!);
    else return false;
    outline();
    return true;
  }
  function redraw(entity: Entity): void {
    if (state.busy) return;
    if (entity.kind === 'settlement') actions.rerollTown(entity.town!);
    // The dice of a quarter or block belongs to its inspector.
    else if (edit(entity)) document.querySelector<HTMLButtonElement>('#subdivision-actions .subdivision-reroll')?.click();
  }
  function centre(entity: Entity): void {
    const points = entity.rings.flat(),
      xs = points.map(p => p.x),
      ys = points.map(p => p.y);
    const near = ['building', 'gate', 'wall', 'bridge', 'harbour', 'farm', 'isolated', 'block', 'quarter', 'settlement', 'lake'].includes(entity.kind) && points.length > 0;
    const view = state.client.viewer.getView(),
      focus: Vec2 = near ? { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 } : entity.point,
      span = near ? Math.max(30, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) : 0;
    const fit = span ? Math.min(6, (0.5 * Math.min($('#map').clientWidth, $('#map').clientHeight)) / span) : view.scale;
    // A tilted camera stays tilted; a walk or a flight returns to the orbit there.
    state.client.viewer.setView({ cx: focus.x, cy: focus.y, scale: fit, pitch: view.eye === undefined ? view.pitch : 1, yaw: view.yaw });
  }
  function pin(entity: Entity): void {
    (state.settings.pins ??= []).push({ x: Math.round(entity.point.x), y: Math.round(entity.point.y) });
    actions.touchRecipe();
    actions.toast('Pin added. Pins are shared with the map code.');
  }
  function render(): void {
    const [entity, ...parents] = chain,
      root = host();
    root.hidden = !entity;
    if (!entity || !state.world) return;
    const facts = entityFacts(entity, input());
    root.setAttribute('aria-label', translate('Selected entity'));
    root.replaceChildren();
    const shut = button('×', close, 'Close the sheet');
    shut.className = 'entity-sheet-close quiet';
    shut.setAttribute('aria-label', translate('Close the sheet'));
    const type = document.createElement('span');
    type.className = 'eyebrow';
    type.textContent = facts.type;
    const title = document.createElement('h2');
    title.dataset.l10nKeep = '';
    title.textContent = facts.title;
    if (facts.name) {
      const pencil = document.createElement('button');
      pencil.type = 'button';
      pencil.className = 'place-title-rename';
      pencil.append(lineIcon('pencil'));
      pencil.title = translate('Rename');
      pencil.setAttribute('aria-label', pencil.title);
      pencil.onclick = () => rename(title, facts);
      title.append(pencil);
    }
    root.append(shut, type, title);
    if (parents.length) {
      const path = document.createElement('nav');
      path.className = 'entity-sheet-parents';
      path.dataset.l10nKeep = '';
      // Largest first, as an address: settlement, quarter, block.
      [...parents].reverse().forEach((parent, i) => {
        if (i) path.append(' › ');
        const link = button('', () => {
          chain = chain.slice(chain.indexOf(parent));
          render();
          outline();
        });
        link.className = 'quiet';
        link.textContent = link.title = entityLabel(parent, input());
        path.append(link);
      });
      root.append(path);
    }
    const list = document.createElement('dl');
    list.className = 'local-facts-grid';
    list.dataset.l10nKeep = '';
    for (const [label, value] of facts.facts) {
      const term = document.createElement('dt'),
        detail = document.createElement('dd');
      term.textContent = label;
      detail.textContent = value;
      list.append(term, detail);
    }
    const bar = document.createElement('div');
    bar.className = 'entity-sheet-actions';
    if (['building', 'block', 'quarter', 'settlement'].includes(entity.kind)) bar.append(button('Edit', () => void edit(entity)));
    if (['block', 'quarter', 'settlement'].includes(entity.kind)) bar.append(button('Redraw', () => redraw(entity), 'Redraw this place or area differently'));
    bar.append(
      button('Centre', () => centre(entity)),
      button('Add pin', () => pin(entity)),
    );
    root.append(list, bar);
  }

  /** The map click of the selection tool: the sheet of what lies at the point. */
  function inspectEntity(point: Vec2, picked?: TownHit): void {
    if (!state.world) return;
    host();
    tolerance = PICK_PX / state.client.viewer.getView().scale;
    const found = entitiesAt(state.world, point, tolerance, picked);
    if (!found.length) {
      close();
      actions.toast('Nothing to select here.');
      return;
    }
    // Only what holds the picked entity is its address: the town levels, whatever line crosses the same point.
    const [first, ...others] = found,
      levels = ['block', 'quarter', 'settlement'];
    chain = [first, ...others.filter(e => levels.includes(e.kind) && (first.town === undefined || e.town === first.town) && levels.indexOf(e.kind) > levels.indexOf(first.kind))];
    render();
    outline();
  }
  /** The displayed world changed: the same entity, found again where it was picked. */
  function refreshEntitySheet(): void {
    const [shown] = chain;
    if (!shown || !state.world) return;
    const found = entitiesAt(state.world, shown.point, tolerance),
      at = found.findIndex(e => e.kind === shown.kind && e.town === shown.town);
    if (at < 0) {
      close();
      return;
    }
    const parents = chain.slice(1).flatMap(parent => found.find(e => e.kind === parent.kind && e.town === parent.town) ?? []);
    chain = [found[at], ...parents];
    render();
    outline();
  }
  return { inspectEntity, refreshEntitySheet };
}
