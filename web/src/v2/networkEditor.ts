/**
 * Map tools for the regional network: select, reshape, move, draw and delete roads; delete a river with its whole
 * upstream network. Geometry and native products are rewritten by ./networkEdits; this module only draws a world-
 * coordinate SVG overlay over the map, listens to the map's pointer events while a tool is active, and hands every
 * committed World to the host (which redraws it and makes it the saved project world).
 */
import type { World, Vec2, Polyline } from '../gen/types';
import type { View } from '../render/view';
import { screenToWorld } from '../render/view';
import type { V2Settings } from './contracts';
import { getLanguage, numberLocale, onLanguageChange, registerMessages, setText, translate } from './i18n';
import { getDistanceUnit, formatDistance, unitFactor, onUnitsChange } from './units';
import { ROAD_CLASS_ORDER, addRoad, deleteRiver, deleteRoad, junctionPoints, planRiverDeletion, refreshNaturalForest, riverAt, roadAt, roadClassOf, setRoadClass, splitRoadWithGap, samePath, type RiverDeletionPlan, type RoadClass } from './networkEdits';
import { polylineLength } from '../gen/core/geom';
import { clampRoadPoint, editableRoadGeometry, insideRoadMap, roadBorderPoint, sameRoadPoint, type RoadGeometry } from './roadControlModel';
import {
  addRoadEntries,
  fixedRoadEndpoint,
  commitRoutedRoads,
  connectedRoadControls,
  deleteRoadEntry,
  entryForControl,
  insertRoadWaypoint,
  refreshRoadExitConnections,
  roadCutPieces,
  roadEntryDeletionPlan,
  roadExitReports,
  translatedRoadControls,
  withRoadExitReports,
} from './roadEditing';
import { effectiveRegionalExits, REGIONAL_EXIT_CLASSES } from './regionalExits';
import type { ExitCounts } from '../../../rust/bridge/settlements';
import RoadRouteWorker from './roadRoute.worker?worker';
import { wasmWorkerOptions } from '../../../rust/bridge/wasmThreads';
import { runtimeWorkerOptions } from './platform';
import { namePresentation } from './mapPresentation';
import { presentName } from '../gen/names/displayNames';
import { editorButtonIcon, networkToolIcon } from './editorIcons';
import { confirmAction } from './actionDialog';
import { editableRuralRoads } from './ruralRoadEditing';
import { editableUrbanRoads, syncUrbanRoadEdits, adoptUrbanRoad } from './urbanRoadEditing';
import { identifyRoads, roadControlSegment, translatedRoadSegment, insertRoadControlGeometry, deleteRoadControlSegment } from './roadGestures';

export type NetworkTool = 'off' | 'roads' | 'draw' | 'rivers';
export interface NetworkEditorHost {
  /** The element the viewer draws in (`#map`): overlay parent and pointer source. */
  map: HTMLElement;
  /** Where the tool panel is mounted. */
  panel: HTMLElement;
  tools?: Exclude<NetworkTool, 'off'>[];
  getWorld(): World | undefined;
  /** Replace the displayed and saved world with an edited one (root: `applyDirectMapEdit`). */
  setWorld(world: World): void | Promise<void>;
  /** Called once on explicit session validation; undefined keeps the draft open. */
  prepareRoadEdit?(before: World, next: World): Promise<World | undefined>;
  /** Current viewer camera (`client.viewer.getView()`). */
  getView(): View;
  /** The overlay maps the map through the top view: no tool starts while the camera is tilted or turned. */
  topView?(): boolean;
  /** Enables the forest refresh after a river deletion. */
  getSettings?(): V2Settings;
  busy?(): boolean;
  toast?(message: string, error?: boolean): void;
  /** After a committed edit has been shown. */
  changed?(): void;
}
export interface NetworkEditor {
  /** Revalidate the selection against the current world and refresh the panel (call after any world change). */
  sync(): void;
  /** Opens a tool; `focus`: the road (roads tool) or river (rivers tool) under that point is selected. False: not started. */
  start(tool: Exclude<NetworkTool, 'off'>, focus?: Vec2): boolean;
  stop(): void;
  active(): boolean;
  pending(): boolean;
  validate(): Promise<boolean>;
  cancel(): Promise<boolean>;
  tool(): NetworkTool;
  /** Map point in world metres for a client position, with the host's view. */
  toWorld(clientX: number, clientY: number): Vec2;
  destroy(): void;
}

const copy = (en: string, fr: string): string => {
  registerMessages({ [en]: { en, fr } });
  return en;
};
const T = {
  title: copy('Regional network', 'Réseau régional'),
  autoHint: copy('Click to place waypoints. Esc or Enter finishes. Click outside the map to finish at a regional entry.', 'Cliquez pour poser les points de passage. Échap ou Entrée termine. Cliquez hors carte pour terminer sur une entrée régionale.'),
  routing: copy('Calculating the route over the terrain…', 'Calcul du parcours sur le relief…'),
  noRoute: copy('No road route could be found between these points.', 'Aucun parcours praticable entre ces deux points. Choisissez une autre arrivée.'),
  roads: copy('Edit roads', 'Modifier les routes'),
  draw: copy('Draw a road', 'Tracer une route'),
  rivers: copy('Delete a river', 'Supprimer une rivière'),
  idle: copy(
    'Choose a tool, then work on the map. Edits apply directly to this map and are saved with the complete project; regenerating the region replaces them.',
    'Choisissez un outil puis travaillez sur la carte. Les modifications s’appliquent directement à cette carte et sont enregistrées dans le projet complet ; régénérer la région les remplace.',
  ),
  roadsHint: copy(
    'Click: select line or point. Double-click: add a point, or select the line from a point. Hold: select a segment. Delete removes the selection.',
    'Clic : ligne ou point. Double-clic : ajouter un point, ou revenir du point à la ligne. Appui long : segment. Suppr retire la sélection.',
  ),
  addPoint: copy('Add a waypoint', 'Ajouter une étape'),
  addHint: copy('Click the selected road where you want a new waypoint. Esc cancels.', 'Cliquez sur la route à l’endroit où ajouter une étape. Échap annule.'),
  riversHint: copy('Click a river. It is deleted together with every upstream tributary, its braids and its oxbows.', 'Cliquez sur une rivière. Elle est supprimée avec tous ses affluents amont, ses bras et ses bras morts.'),
  road: copy('Road {n}', 'Route {n}'),
  roadInfo: copy('{distance} · {points} handles', '{distance} · {points} poignées'),
  cls: copy('Class', 'Catégorie'),
  width: copy('Width (m)', 'Largeur (m)'),
  deleteRoad: copy('Delete road', 'Supprimer la route'),
  removePoint: copy('Remove point', 'Retirer le point'),
  deselect: copy('Deselect', 'Désélectionner'),
  points: copy('{n} points', '{n} points'),
  finish: copy('Finish road', 'Terminer la route'),
  cancel: copy('Cancel', 'Annuler'),
  riverPlan: copy('{name} and {n} upstream or side channels', '{name} et {n} affluents ou bras'),
  riverOnly: copy('{name} alone', '{name} seule'),
  aRiver: copy('This river', 'Cette rivière'),
  throughLakes: copy('Also follow rivers that feed it through a lake', 'Suivre aussi les rivières qui l’alimentent à travers un lac'),
  deleteRiver: copy('Delete river and tributaries', 'Supprimer la rivière et ses affluents'),
  working: copy('Updating the map…', 'Mise à jour de la carte…'),
  forest: copy('Regrowing the forest over the former bed…', 'Reboisement de l’ancien lit…'),
  roadDeleted: copy('Road deleted.', 'Route supprimée.'),
  roadAdded: copy('Road added.', 'Route ajoutée.'),
  riverDeleted: copy('River deleted with {n} channels. Rebuild the towns on its banks to update their waterfront.', 'Rivière supprimée avec {n} chenaux. Reconstruisez les villes riveraines pour mettre à jour leurs rives.'),
  noWorld: copy('Create the terrain first.', 'Créez d’abord le terrain.'),
  overlay: copy('Network editing overlay', 'Calque d’édition du réseau'),
  highway: copy('Highway', 'Grande route'),
  main: copy('Main road', 'Route principale'),
  local: copy('Local road', 'Route locale'),
  track: copy('Track', 'Chemin'),
  trail: copy('Trail', 'Sentier'),
  cutPoint: copy('Cut the road here', 'Couper la route ici'),
  entry: copy('Regional entry', 'Entrée régionale'),
  deleteEntry: copy('Delete regional entry and its road', 'Supprimer l’entrée régionale et sa route'),
  confirmEntry: copy('Delete this regional entry and its road? Shared road sections will be kept.', 'Supprimer cette entrée régionale et sa route ? Les tronçons partagés seront conservés.'),
  cutPreview: copy('The red gap previews the road cut. Click the scissors to apply.', 'L’interruption rouge prévisualise la coupure. Cliquez sur les ciseaux pour l’appliquer.'),
  undo: copy('Undo road edit', 'Annuler la modification de route'),
  redo: copy('Redo road edit', 'Rétablir la modification de route'),
  reroll: copy('Reroll route', 'Autre trajet'),
  sameRoute: copy('This search found the same practicable route.', 'Cette recherche a retrouvé le même trajet praticable.'),
  validate: copy('Finish Editing', 'Terminer l’édition'),
  cancelEdits: copy('Cancel road edits', 'Annuler l’édition des routes'),
  continueEdits: copy('Continue road editing', 'Continuer l’édition des routes'),
  pending: copy('Road editing in progress · settlements update when you validate.', 'Édition des routes en cours · les localités seront mises à jour à la validation.'),
  lineSelected: copy('Line selected', 'Ligne sélectionnée'),
  pointSelected: copy('Point selected', 'Point sélectionné'),
  segmentSelected: copy('Segment selected', 'Segment sélectionné'),
  changed: copy('{n} edits · Ctrl+Z to undo', '{n} modifications · Ctrl+Z pour annuler'),
  pointAdded: copy('Control point added.', 'Point de contrôle ajouté.'),
  pointRemoved: copy('Control point removed.', 'Point de contrôle retiré.'),
  roadMoved: copy('Road updated.', 'Route mise à jour.'),
  roadCut: copy('Road cut into two lines.', 'Route coupée en deux lignes.'),
  segmentRemoved: copy('Road segment deleted.', 'Segment de route supprimé.'),
  complete: copy('Road edits applied.', 'Modifications des routes appliquées.'),
  undone: copy('Road edit undone.', 'Modification de route annulée.'),
  redone: copy('Road edit restored.', 'Modification de route rétablie.'),
};
const CLASS_LABEL: Record<RoadClass, string> = { highway: T.highway, main: T.main, local: T.local, track: T.track, trail: T.trail };
const SVG = 'http://www.w3.org/2000/svg';
const SNAP_PX = 12,
  PICK_PX = 9,
  CLICK_PX = 5;
const GOLD = '#dcb86f',
  INK = '#26271f',
  PAPER = '#f7f0dc',
  DANGER = '#d9725a';
const STYLE_ID = 'v2-network-editor-style';
const CSS = `.v2-network-editor{display:grid;gap:9px;margin:12px 0;padding:12px;border:1px solid #dcb86f33;border-radius:7px;background:#ffffff05}
.v2-network-editor .v2-network-tools{display:flex;gap:5px;flex-wrap:wrap}.v2-network-editor .v2-network-tools button{flex:1 1 30%;font-size:11px;padding:7px 8px}
.v2-network-editor button[aria-pressed=true]{border-color:#dcb86f88;background:#dcb86f1c;color:var(--gold)}
.v2-network-editor .v2-network-detail{display:grid;gap:8px}.v2-network-editor .v2-network-detail:empty{display:none}
.v2-network-editor .v2-network-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.v2-network-editor .v2-network-row button{font-size:11px;padding:7px 10px}
.v2-network-editor label{display:grid;gap:4px;font-size:10px;color:var(--muted)}.v2-network-editor label.checkline{display:flex;align-items:center;gap:7px}
.v2-network-editor select,.v2-network-editor input[type=number]{width:100%;min-width:0;background:var(--field);color:inherit;border:1px solid var(--line);border-radius:6px;padding:6px 8px}
.v2-network-editor .danger{border-color:#dd977d66;color:#ffd7c1}.v2-network-editor strong{font-weight:500;font-size:12px}
.v2-network-overlay{position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none;overflow:hidden;touch-action:none;user-select:none}
.v2-network-overlay [data-role]{pointer-events:all}.v2-network-overlay [data-role=road]{pointer-events:stroke;cursor:move}
.v2-network-overlay [data-role=vertex],.v2-network-overlay [data-role=ghost]{cursor:grab}.v2-network-overlay [data-role=draw-last]{cursor:pointer}
.v2-network-overlay [data-role=segment]{pointer-events:stroke;cursor:move}.v2-network-overlay [aria-disabled=true]{opacity:.4;cursor:default}
.v2-network-overlay[data-adding=true] [data-role=road]{cursor:crosshair}
.v2-network-overlay [role=button]{cursor:pointer}.v2-network-overlay [data-fixed=true]{cursor:default}
.v2-network-banner{position:absolute;top:84px;left:50%;transform:translateX(-50%);z-index:2;max-width:min(560px,80%);padding:8px 13px;font-size:11px;line-height:1.5;pointer-events:none;text-align:center}
.canvas-wrap.v2-network-active canvas{cursor:crosshair}
.v2-network-shortcuts{position:absolute;left:22px;top:125px;z-index:4;display:flex;gap:4px;padding:4px}
.v2-network-shortcuts button{font-size:11px;padding:6px 9px}
.v2-network-shortcuts button[aria-pressed=true]{color:#ffdc93;border-color:#dcb86f;background:#665435}
.v2-road-session{position:absolute;bottom:140px;left:22px;z-index:5;display:flex;align-items:center;gap:7px;padding:10px;width:290px;max-width:calc(100% - 24px);flex-wrap:wrap;border:1px solid #dcb86f66;border-radius:8px;pointer-events:auto}.map-bottom>.v2-road-session{bottom:calc(100% + 12px);left:0}.v2-road-session[hidden]{display:none}.v2-road-session span{font-size:11px;line-height:1.4;width:100%}.v2-road-session button{font-size:11px;padding:8px 11px}.v2-road-session [data-road-validate]{order:-1;width:100%;padding:14px 12px;font-size:16px;font-weight:600}.v2-road-session [data-road-feedback]{color:#ffdc93;max-height:64px;overflow:auto}
@media(max-width:720px){.v2-network-shortcuts{left:12px;top:195px}}`;

const fmt = (template: string, values: Record<string, string | number>): string =>
  translate(template).replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = values[key];
    return typeof v === 'number' ? v.toLocaleString(numberLocale(), { maximumFractionDigits: 2 }) : String(v ?? '');
  });
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
};
const svgEl = (tag: string, attrs: Record<string, string | number>): SVGElement => {
  const node = document.createElementNS(SVG, tag) as SVGElement;
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
};
const pathData = (path: readonly Vec2[]): string => path.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('');

type Drag = { kind: 'vertex' | 'road' | 'segment'; pointer: number; road: number; index: number; base: Polyline; controls: Polyline; inserted?: boolean; origin: Vec2; moved: boolean; start: Vec2; lineTap: boolean };
type HistoryState = { world: World; exits: Partial<ExitCounts> | undefined; roadsDisabled: boolean; selected: number; vertex: number; segment: number };
type HistoryEdit = { before: HistoryState; after: HistoryState; validated?: boolean; session?: { before: HistoryState; start: number } };

export function mountNetworkEditor(host: NetworkEditorHost): NetworkEditor {
  const modeToken = `network:${host.tools?.join('-') ?? 'all'}`;
  if (!document.getElementById(STYLE_ID)) {
    const style = el('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.append(style);
  }
  // ---- panel
  const box = el('section', 'v2-network-editor'),
    eyebrow = el('span', 'eyebrow'),
    tools = el('div', 'v2-network-tools'),
    hint = el('p', 'hint'),
    detail = el('div', 'v2-network-detail');
  setText(eyebrow, T.title);
  tools.setAttribute('role', 'toolbar');
  const toolButtons = (host.tools ?? (['roads', 'draw', 'rivers'] as const)).map(tool => {
    const button = el('button');
    button.type = 'button';
    button.dataset.networkTool = tool;
    setText(button, T[tool]);
    networkToolIcon(button, tool);
    button.onclick = () => (current === tool ? stop() : start(tool));
    tools.append(button);
    return button;
  });
  box.append(eyebrow, tools, hint, detail);
  host.panel.append(box);
  // ---- overlay
  const svg = document.createElementNS(SVG, 'svg');
  svg.classList.add('v2-network-overlay');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-label', translate(T.overlay));
  svg.toggleAttribute('hidden', true);
  const banner = el('div', 'v2-network-banner glass');
  banner.hidden = true;
  banner.setAttribute('role', 'status');
  host.map.append(svg, banner);
  const sessionBar = el('div', 'v2-road-session glass'),
    sessionHint = el('span'),
    feedback = el('span'),
    validateButton = el('button'),
    cancelButton = el('button'),
    continueButton = el('button');
  feedback.dataset.roadFeedback = '';
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');
  sessionBar.dataset.roadSession = '';
  sessionBar.hidden = true;
  sessionBar.setAttribute('role', 'region');
  sessionBar.setAttribute('aria-label', translate(T.validate));
  validateButton.type = cancelButton.type = continueButton.type = 'button';
  validateButton.className = 'primary';
  validateButton.dataset.roadValidate = '';
  cancelButton.dataset.roadCancel = '';
  continueButton.dataset.roadContinue = '';
  validateButton.onclick = () => void validateSession();
  cancelButton.onclick = () => void cancelSession();
  continueButton.onclick = () => start('roads');
  sessionBar.append(sessionHint, feedback, continueButton, cancelButton, validateButton);
  if (host.tools?.includes('roads')) (host.map.parentElement?.querySelector('.map-bottom') ?? host.map.parentElement)?.append(sessionBar);
  // Quick actions stay on the map even when the stage controls are collapsed.
  const shortcuts = host.tools?.includes('roads') ? el('div', 'v2-network-shortcuts glass') : undefined;
  const quickButtons: HTMLButtonElement[] = [];
  if (shortcuts) {
    shortcuts.setAttribute('role', 'toolbar');
    for (const tool of ['roads', 'draw'] as const)
      if (host.tools?.includes(tool)) {
        const b = el('button');
        b.type = 'button';
        b.dataset.networkQuick = tool;
        setText(b, T[tool]);
        networkToolIcon(b, tool);
        b.onclick = () => (current === tool ? stop() : start(tool));
        shortcuts.append(b);
        quickButtons.push(b);
      }
    host.map.parentElement?.append(shortcuts);
  }

  let current: NetworkTool = 'off',
    selected = -1,
    activeVertex = -1,
    activeSegment = -1,
    drag: Drag | undefined,
    working = false,
    status = '',
    lastFeedback = '';
  let holdTimer: ReturnType<typeof setTimeout> | undefined,
    lastDoubleAt = -Infinity;
  const clearHold = () => {
    clearTimeout(holdTimer);
    holdTimer = undefined;
  };
  const announce = (message: string) => {
    lastFeedback = translate(message);
    feedback.textContent = lastFeedback;
  };
  let draft: Polyline = [],
    cursor: Vec2 | undefined,
    drawClass: RoadClass = 'local';
  let drawVariant = 0;
  let addingPoint = false;
  let cancelRouting: (() => void) | undefined,
    preview: RoadGeometry | undefined,
    previewError = false,
    previewTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingControls: { road: number; controls: Polyline } | undefined;
  let previewToken = 0,
    previewRequest: number | undefined,
    cutPreview = false;
  let routeWorker: Worker | undefined,
    nextRouteRequest = 0,
    nextTerrainToken = 0;
  const terrainTokens = new WeakMap<object, number>();
  const routeCallbacks = new Map<number, { worker: Worker; done: (data: RoadGeometry) => void; failed: (error: Error) => void }>();
  const undoStack: HistoryEdit[] = [],
    redoStack: HistoryEdit[] = [];
  let sessionBefore: HistoryState | undefined,
    sessionHistoryStart = 0;
  let knownWorld = host.getWorld();
  let plan: { world: World; plan: RiverDeletionPlan } | undefined,
    throughLakes = true;
  let suppressClick = false;
  let lastLineTap: { time: number; road: number; point: Vec2; vertex: number } | undefined;
  let downAt: { x: number; y: number } | undefined,
    frame = 0,
    lastBox = '',
    junctionCache: { world: World; points: ReturnType<typeof junctionPoints> } | undefined;

  const editable = (w: World) => identifyRoads(editableUrbanRoads(editableRuralRoads(w)));
  const world = (): World | undefined => {
    const w = host.getWorld();
    // Building the editable road graph is only needed while a tool or a pending session uses it.
    return w && host.tools?.includes('roads') && (current !== 'off' || sessionBefore) ? editable(w) : w;
  };
  const scale = (): number => host.getView().scale;
  function toWorld(clientX: number, clientY: number): Vec2 {
    const rect = host.map.getBoundingClientRect(),
      [x, y] = screenToWorld(host.getView(), rect.width, rect.height, clientX - rect.left, clientY - rect.top);
    return { x, y };
  }
  const junctions = (w: World): ReturnType<typeof junctionPoints> => {
    if (junctionCache?.world !== w) junctionCache = { world: w, points: junctionPoints(w) };
    return junctionCache.points;
  };
  /** Where a draft end would attach (same priority as networkEdits.attachEnd), for the cursor indicator only. */
  function snapTarget(w: World, p: Vec2): Vec2 | undefined {
    const snap = SNAP_PX / scale();
    let best: Vec2 | undefined,
      distance = snap;
    for (const j of junctions(w)) {
      const d = Math.hypot(j.point.x - p.x, j.point.y - p.y);
      if (d <= distance) {
        distance = d;
        best = j.point;
      }
    }
    if (best) return best;
    const hit = roadAt(w, p, snap);
    return hit && hit.distance <= snap ? hit.point : undefined;
  }
  const fail = (error: unknown): void => {
    const message = translate(error instanceof Error ? error.message : String(error));
    announce(message);
    host.toast?.(message, true);
  };
  const exitSettings = (): Partial<ExitCounts> | undefined => {
    const exits = host.getSettings?.().region?.roads?.exits;
    return exits ? { ...exits } : undefined;
  };
  function restoreExitSettings(exits: Partial<ExitCounts> | undefined, disabled = false): void {
    const s = host.getSettings?.();
    if (!s) return;
    if (disabled) {
      s.region ??= {};
      s.region.roads = null;
      return;
    }
    if (exits) {
      s.region ??= {};
      s.region.roads ??= {};
      s.region.roads.exits = { ...exits };
    } else if (s.region?.roads) delete s.region.roads.exits;
    else if (s.region?.roads === null) s.region.roads = {};
  }
  function updateExitCounts(before: World, next: World): void {
    const s = host.getSettings?.();
    if (!s) return;
    const counts = effectiveRegionalExits(s),
      exits: Partial<ExitCounts> = s.region?.roads === null ? { highway: 0, main: 0, local: 0, track: 0 } : { ...exitSettings() };
    let changed = false;
    for (const cls of REGIONAL_EXIT_CLASSES) {
      const delta = roadExitReports(next).filter(e => e.requested === cls).length - roadExitReports(before).filter(e => e.requested === cls).length;
      if (delta) {
        exits[cls] = Math.max(0, counts[cls] + delta);
        changed = true;
      }
    }
    if (changed) {
      if (REGIONAL_EXIT_CLASSES.reduce((n, cls) => n + (exits[cls] ?? counts[cls]), 0) > 16) throw new Error('At most 16 regional road exits can be requested.');
      restoreExitSettings(exits);
    }
  }
  const historyState = (w: World): HistoryState => ({ world: w, exits: exitSettings(), roadsDisabled: host.getSettings?.().region?.roads === null, selected, vertex: activeVertex, segment: activeSegment });
  const pending = (): boolean => !!sessionBefore && world() !== sessionBefore.world;
  function clearSession(): void {
    sessionBefore = undefined;
    sessionHistoryStart = undoStack.length;
  }
  async function commit(next: World, message?: string, after?: (w: World) => void): Promise<void> {
    if (host.busy?.()) return;
    const source = world();
    if (!source) return;
    const before = historyState(source);
    if (host.tools?.includes('roads') && !sessionBefore) {
      sessionBefore = before;
      sessionHistoryStart = undoStack.length;
    }
    working = true;
    status = T.working;
    render();
    try {
      updateExitCounts(source, next);
      const edited = next;
      if (host.tools?.includes('roads')) next = identifyRoads(syncUrbanRoadEdits(editableRuralRoads(next), source));
      await host.setWorld(next);
      knownWorld = next;
      after?.(next);
      const selectedRoad = edited.roads?.[selected];
      if (selectedRoad?.editorId) {
        const id = selectedRoad.editorId;
        selected = next.roads?.findIndex(r => r.editorId === id || r.editorId?.startsWith(id + ':')) ?? -1;
      } else if (selectedRoad?.urban) {
        const u = selectedRoad.urban;
        selected = next.roads?.findIndex(r => r.urban?.key === u.key && r.urban.id === u.id && (r.urban.part === u.part || r.urban.part.startsWith(u.part + ':'))) ?? -1;
      } else if (selectedRoad && next !== edited) selected = next.roads?.findIndex(r => !r.urban && (r.path === selectedRoad.path || samePath(r.path, selectedRoad.path))) ?? -1;
      undoStack.push({ before, after: historyState(next) });
      if (undoStack.length > 30) {
        undoStack.shift();
        sessionHistoryStart = Math.max(0, sessionHistoryStart - 1);
      }
      redoStack.length = 0;
      lastLineTap = undefined;
      host.changed?.();
      announce(message ?? T.roadMoved);
      if (message) host.toast?.(message);
      cutPreview = false;
      drawOverlay();
    } catch (error) {
      restoreExitSettings(before.exits, before.roadsDisabled);
      fail(error);
    } finally {
      working = false;
      status = '';
      drawOverlay();
      render();
    }
  }
  async function historyMove(redo: boolean): Promise<void> {
    if (working || host.busy?.()) return;
    const from = redo ? redoStack : undoStack,
      to = redo ? undoStack : redoStack,
      entry = from.at(-1);
    if (!entry) return;
    const expected = redo ? entry.before : entry.after,
      target = redo ? entry.after : entry.before;
    if (world() !== expected.world) {
      fail('The map changed outside road editing. Reopen the road editor before continuing.');
      render();
      return;
    }
    working = true;
    status = T.working;
    lastLineTap = undefined;
    clearHold();
    cancelPreview();
    render();
    try {
      restoreExitSettings(target.exits, target.roadsDisabled);
      await host.setWorld(target.world);
      knownWorld = target.world;
      selected = target.selected;
      activeVertex = target.vertex;
      activeSegment = target.segment;
      from.pop();
      to.push(entry);
      host.changed?.();
      announce(redo ? T.redone : T.undone);
      drawOverlay();
      if (entry.validated) {
        if (redo) {
          clearSession();
          stop();
        } else {
          sessionBefore = entry.session?.before;
          sessionHistoryStart = entry.session?.start ?? undoStack.length;
          if (current === 'off') start('roads');
        }
      }
    } catch (error) {
      restoreExitSettings(expected.exits, expected.roadsDisabled);
      fail(error);
    } finally {
      working = false;
      status = '';
      drawOverlay();
      render();
    }
  }
  /** Finish is one undoable action; the preceding gestures remain individually undoable. */
  async function validateSession(): Promise<boolean> {
    if (working || host.busy?.()) return false;
    if (current === 'draw' && draft.length) {
      if (draft.length < 2) return false;
      await finishDraft();
      if (draft.length) return false;
    }
    const currentWorld = world();
    if (!currentWorld) return false;
    if (!pending()) {
      if (sessionBefore) undoStack.splice(sessionHistoryStart);
      redoStack.length = 0;
      clearSession();
      stop();
      return true;
    }
    const baseline = sessionBefore!;
    working = true;
    status = T.working;
    cancelPreview();
    render();
    try {
      const updated = host.prepareRoadEdit ? await host.prepareRoadEdit(baseline.world, currentWorld) : currentWorld;
      if (!updated) {
        if (current === 'off') start('roads');
        return false;
      }
      const next = editable(updated);
      await host.setWorld(next);
      knownWorld = next;
      undoStack.push({ before: historyState(currentWorld), after: historyState(next), validated: true, session: { before: baseline, start: sessionHistoryStart } });
      redoStack.length = 0;
      clearSession();
      host.changed?.();
      host.toast?.(String(next.stats['v2.roadEditReport'] ?? translate(T.complete)));
      stop();
      return true;
    } catch (error) {
      fail(error);
      return false;
    } finally {
      working = false;
      status = '';
      drawOverlay();
      render();
    }
  }
  async function cancelSession(): Promise<boolean> {
    if (working || host.busy?.()) return false;
    cancelPreview();
    draft = [];
    cursor = undefined;
    if (!sessionBefore) {
      stop();
      return true;
    }
    const baseline = sessionBefore,
      previous = historyState(world() ?? baseline.world);
    working = true;
    status = T.working;
    render();
    try {
      restoreExitSettings(baseline.exits, baseline.roadsDisabled);
      await host.setWorld(baseline.world);
      knownWorld = baseline.world;
      undoStack.splice(sessionHistoryStart);
      redoStack.length = 0;
      clearSession();
      host.changed?.();
      stop();
      return true;
    } catch (error) {
      restoreExitSettings(previous.exits, previous.roadsDisabled);
      fail(error);
      return false;
    } finally {
      working = false;
      status = '';
      drawOverlay();
      render();
    }
  }
  function cancelPreview(): void {
    previewToken++;
    clearTimeout(previewTimer);
    previewTimer = undefined;
    if (previewRequest !== undefined) cancelRouteRequest(previewRequest);
    previewRequest = undefined;
    preview = undefined;
    previewError = false;
  }
  function cancelRouteRequest(id: number): void {
    const request = routeCallbacks.get(id);
    routeCallbacks.delete(id);
    request?.worker.postMessage({ type: 'cancel', id });
  }
  function failRouteWorker(worker: Worker, error: Error): void {
    if (routeWorker === worker) routeWorker = undefined;
    const requests = [...routeCallbacks].filter(([, request]) => request.worker === worker);
    for (const [id] of requests) routeCallbacks.delete(id);
    worker.terminate();
    for (const [, request] of requests) request.failed(error);
  }
  function getRouteWorker(): Worker {
    if (routeWorker) return routeWorker;
    const worker = (routeWorker = new RoadRouteWorker(runtimeWorkerOptions(wasmWorkerOptions('v2-road-route'))));
    worker.onmessage = ({ data }) => {
      if (data.type === 'disposed') {
        worker.terminate();
        return;
      }
      const request = routeCallbacks.get(data.id);
      if (!request || request.worker !== worker) return;
      routeCallbacks.delete(data.id);
      if (data.error) request.failed(new Error(data.error));
      else request.done(data);
    };
    worker.onerror = event => failRouteWorker(worker, new Error(event.message));
    return worker;
  }
  function disposeRouteWorker(): void {
    const worker = routeWorker;
    routeWorker = undefined;
    if (!worker) return;
    const requests = [...routeCallbacks].filter(([, request]) => request.worker === worker);
    for (const [id] of requests) routeCallbacks.delete(id);
    for (const [, request] of requests) request.failed(new DOMException('Cancelled', 'AbortError'));
    // Let the worker release its own native terrain session before it exits. A stuck calculation is bounded.
    const timeout = setTimeout(() => worker.terminate(), 10000);
    worker.onmessage = ({ data }) => {
      if (data.type === 'disposed') {
        clearTimeout(timeout);
        worker.terminate();
      }
    };
    worker.postMessage({ type: 'dispose' });
  }
  function postRoute(w: World, settings: V2Settings, points: Polyline, cls: RoadClass, done: (data: RoadGeometry) => void, failed: (error: Error) => void, variant = 0): number {
    const worker = getRouteWorker(),
      id = ++nextRouteRequest;
    let token = terrainTokens.get(w.terrain);
    if (token === undefined) {
      token = ++nextTerrainToken;
      terrainTokens.set(w.terrain, token);
    }
    routeCallbacks.set(id, { worker, done, failed });
    try {
      worker.postMessage({ type: 'route', id, terrainToken: String(token), world: { terrain: w.terrain, mapSize: w.mapSize, seed: w.seed, options: w.options, stats: w.stats }, settings, points, cls, variant });
    } catch (error) {
      routeCallbacks.delete(id);
      queueMicrotask(() => failed(error instanceof Error ? error : new Error(String(error))));
    }
    return id;
  }
  function requestRoute(w: World, points: Polyline, cls: RoadClass, variant = 0): Promise<RoadGeometry> {
    const settings = host.getSettings?.();
    if (!settings) return Promise.reject(new Error('Road settings unavailable.'));
    return new Promise((resolve, reject) => {
      const close = () => {
        cancelRouting = undefined;
      };
      const id = postRoute(
        w,
        settings,
        points,
        cls,
        data => {
          close();
          resolve(data);
        },
        error => {
          close();
          reject(error);
        },
        variant,
      );
      cancelRouting = () => {
        cancelRouteRequest(id);
        close();
        reject(new DOMException('Cancelled', 'AbortError'));
      };
    });
  }
  function queuePreview(): void {
    cancelPreview();
    const w = world(),
      settings = host.getSettings?.();
    if (!w || !settings || working) return;
    const editing = current === 'roads' && drag?.moved ? drag : undefined;
    if (!editing && (!draft.length || current !== 'draw')) return;
    const target = cursor && (insideRoadMap(cursor, w.mapSize) ? (snapTarget(w, cursor) ?? cursor) : roadBorderPoint(cursor, w.mapSize));
    const points = editing ? editing.controls : target && !sameRoadPoint(target, draft.at(-1)!) ? [...draft, target] : draft.slice();
    if (points.length < 2) return;
    const token = previewToken,
      tool = current,
      cls = editing ? roadClassOf(w, editing.road) : drawClass,
      variant = editing ? (w.roads![editing.road].routingVariant ?? 0) : drawVariant;
    previewTimer = setTimeout(() => {
      if (token !== previewToken || world() !== w || current !== tool) return;
      previewRequest = postRoute(
        w,
        settings,
        points,
        cls,
        data => {
          if (token !== previewToken || world() !== w || current !== tool) return;
          previewRequest = undefined;
          previewError = false;
          preview = data;
          drawOverlay();
        },
        () => {
          if (token !== previewToken) return;
          previewRequest = undefined;
          previewError = true;
          drawOverlay();
        },
        variant,
      );
    }, 120);
  }
  async function rerouteControls(index: number, controls: Polyline, after?: () => void, cls?: RoadClass, reroll = false): Promise<void> {
    const w = world();
    if (!w || working || host.busy?.()) return;
    pendingControls = { road: index, controls };
    working = true;
    status = T.routing;
    cancelPreview();
    drawOverlay();
    render();
    try {
      const edits = [];
      for (const change of connectedRoadControls(w, index, controls)) {
        let geometry: RoadGeometry | undefined;
        const original = w.roads![change.index],
          first = original.routingVariant ?? 0;
        for (let attempt = reroll && change.index === index ? 1 : 0; attempt <= (reroll && change.index === index ? 6 : 0); attempt++) {
          geometry = await requestRoute(w, change.controls, change.index === index && cls ? cls : roadClassOf(w, change.index), first + attempt);
          if (!reroll || change.index !== index || geometry.path.length !== original.path.length || geometry.path.some((p, i) => !sameRoadPoint(p, original.path[i]))) break;
        }
        if (reroll && change.index === index && geometry!.path.length === original.path.length && geometry!.path.every((p, i) => sameRoadPoint(p, original.path[i]))) {
          host.toast?.(translate(T.sameRoute));
          return;
        }
        edits.push({ index: change.index, geometry: geometry! });
      }
      if (world() !== w || current !== 'roads') return;
      let next = commitRoutedRoads(w, edits);
      if (cls) {
        next = setRoadClass(next, index, cls).world;
        const old = w.roads![index].path;
        next = withRoadExitReports(
          next,
          roadExitReports(next).map(e => (e.point && (sameRoadPoint(e.point, old[0]) || sameRoadPoint(e.point, old.at(-1)!)) ? { ...e, class: cls, requested: cls === 'trail' ? 'track' : cls } : e)),
        );
      }
      working = false;
      await commit(next, undefined, () => after?.());
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) fail(error);
    } finally {
      pendingControls = undefined;
      working = false;
      status = '';
      drawOverlay();
      render();
    }
  }

  // ---- tools
  function start(tool: Exclude<NetworkTool, 'off'>, focus?: Vec2): boolean {
    if (host.busy?.() || host.topView?.() === false) return false;
    if (!host.getWorld()) {
      host.toast?.(translate(T.noWorld), true);
      return false;
    }
    window.dispatchEvent(new CustomEvent('v2-edit-mode', { detail: modeToken }));
    clearHold();
    cancelPreview();
    current = tool;
    knownWorld = world();
    draft = [];
    drawVariant = 0;
    addingPoint = false;
    cursor = undefined;
    plan = undefined;
    drag = undefined;
    activeVertex = -1;
    activeSegment = -1;
    cutPreview = false;
    lastLineTap = undefined;
    if (tool !== 'roads') selected = -1;
    // The same picks as a click on the map with the tool open.
    const w = knownWorld;
    if (focus && w && tool === 'roads') {
      selected = roadAt(w, focus, PICK_PX / scale())?.index ?? selected;
      announce(T.lineSelected);
    } else if (focus && w && tool === 'rivers') {
      const hit = riverAt(w, focus, PICK_PX / scale());
      try {
        if (hit) plan = { world: w, plan: planRiverDeletion(w, hit.index, { throughLakes }) };
      } catch (error) {
        fail(error);
      }
    }
    host.map.classList.add('v2-network-active');
    svg.toggleAttribute('hidden', false);
    lastBox = '';
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(follow);
    render();
    return true;
  }
  function stop(): void {
    clearHold();
    cancelRouting?.();
    cancelRouting = undefined;
    cancelPreview();
    cutPreview = false;
    pendingControls = undefined;
    addingPoint = false;
    disposeRouteWorker();
    lastLineTap = undefined;
    if (current === 'off') return;
    current = 'off';
    draft = [];
    cursor = undefined;
    plan = undefined;
    drag = undefined;
    selected = -1;
    activeVertex = -1;
    activeSegment = -1;
    host.map.classList.remove('v2-network-active');
    svg.toggleAttribute('hidden', true);
    banner.hidden = true;
    cancelAnimationFrame(frame);
    frame = 0;
    svg.replaceChildren();
    render();
  }
  /** Keep the overlay's world viewBox on the live camera. */
  function follow(): void {
    if (current === 'off') return;
    const view = host.getView(),
      w = host.map.clientWidth || 1,
      h = host.map.clientHeight || 1;
    const next = `${view.cx - w / (2 * view.scale)} ${view.cy - h / (2 * view.scale)} ${w / view.scale} ${h / view.scale}`;
    if (next !== lastBox) {
      lastBox = next;
      svg.setAttribute('viewBox', next);
      drawOverlay();
    }
    frame = requestAnimationFrame(follow);
  }
  async function finishDraft(): Promise<void> {
    const w = world();
    if (!w || draft.length < 2 || working) return;
    const points = draft.map(p => ({ ...p }));
    cancelPreview();
    working = true;
    status = T.routing;
    render();
    try {
      const geometry = await requestRoute(w, points, drawClass, drawVariant);
      if (world() !== w || current !== 'draw') return;
      const result = addRoad(w, geometry.path, { snap: SNAP_PX / scale(), cls: drawClass, controls: geometry.controls, routingVariant: drawVariant });
      const ends = ([0, 1] as const).filter(end => {
        const p = end ? points.at(-1)! : points[0];
        return p.x === 0 || p.y === 0 || p.x === w.mapSize || p.y === w.mapSize;
      });
      const next = adoptUrbanRoad(addRoadEntries(result.world, result.road!, ends), result.road!);
      working = false;
      await commit(next, translate(T.roadAdded), () => {
        draft = [];
        cursor = undefined;
        current = 'roads';
        selected = result.road ?? -1;
        activeVertex = -1;
      });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) fail(error);
    } finally {
      working = false;
      status = '';
      drawOverlay();
      render();
    }
  }
  async function deletePlannedRiver(): Promise<void> {
    const w = world();
    if (!w || !plan || plan.world !== w) return;
    try {
      let next = deleteRiver(w, plan.plan.selected, { throughLakes }).world;
      const removed = plan.plan.rivers.length,
        settings = host.getSettings?.();
      if (settings) {
        working = true;
        status = T.forest;
        render();
        try {
          next = await refreshNaturalForest(next, settings);
        } catch (error) {
          console.warn('Forest refresh after the river deletion failed:', error);
        }
      }
      plan = undefined;
      working = false;
      await commit(next, fmt(T.riverDeleted, { n: removed }));
    } catch (error) {
      working = false;
      status = '';
      fail(error);
      render();
    }
  }
  /** Build the edited world from the current one, then commit it. */
  async function edit(make: (w: World) => World, message?: string, after?: (w: World) => void): Promise<void> {
    const w = world();
    if (!w || working) return;
    let next: World;
    try {
      next = make(w);
    } catch (error) {
      fail(error);
      drawOverlay();
      return;
    }
    await commit(next, message, after);
  }

  // ---- map events (capture on the map: overlay handles are its descendants, the viewer pans on the canvas)
  const inOverlay = (target: EventTarget | null): SVGElement | undefined => {
    const node = (target as Element | null)?.closest?.('[data-role]');
    return node && svg.contains(node) ? (node as SVGElement) : undefined;
  };
  function onPointerDown(event: PointerEvent): void {
    if (current === 'off') return;
    downAt = { x: event.clientX, y: event.clientY };
    suppressClick = false;
    const handle = inOverlay(event.target),
      w = world();
    if (current !== 'roads' || !w || working || host.busy?.() || event.button !== 0) return;
    const p = toWorld(event.clientX, event.clientY),
      start = { x: event.clientX, y: event.clientY };
    const role = handle?.dataset.role;
    if (role === 'remove-control' || role === 'cut-control' || role === 'delete-entry') {
      event.stopPropagation();
      return;
    }
    const hit = roadAt(w, p, PICK_PX / scale()),
      index = handle?.dataset.road !== undefined ? Number(handle.dataset.road) : hit?.index;
    if (index === undefined || !w.roads?.[index]) return;
    clearHold();
    const geometry = editableRoadGeometry(w.roads[index], w.mapSize),
      wasSelected = selected === index,
      oldSegment = activeSegment;
    const insertion = role === 'add-control' || addingPoint || event.altKey;
    const at = role === 'add-control' ? { x: Number(handle!.dataset.x), y: Number(handle!.dataset.y) } : p;
    const inserted = insertion ? insertRoadWaypoint(geometry, at) : undefined;
    const nearest = geometry.controls.map((q, i) => ({ i, d: Math.hypot(p.x - q.x, p.y - q.y) * scale() })).sort((a, b) => a.d - b.d)[0];
    const vertex = inserted?.index ?? (role === 'vertex' ? Number(handle!.dataset.index) : nearest?.d <= 8 ? nearest.i : -1);
    const segment = roadControlSegment(w, index, p),
      keepSegment = wasSelected && oldSegment === segment && vertex < 0 && !insertion;
    const whole = vertex < 0 && !keepSegment;
    selected = index;
    activeVertex = vertex;
    activeSegment = keepSegment ? segment : -1;
    cutPreview = false;
    suppressClick = true;
    addingPoint = false;
    const controls = (inserted?.controls ?? geometry.controls).map(q => ({ ...q }));
    drag = {
      kind: keepSegment ? 'segment' : whole ? 'road' : 'vertex',
      pointer: event.pointerId,
      road: index,
      index: keepSegment ? segment : vertex,
      origin: p,
      base: controls,
      controls,
      moved: false,
      start,
      lineTap: !insertion,
      inserted: !!inserted && inserted.controls.length !== geometry.controls.length,
    };
    if (wasSelected && whole && !insertion)
      holdTimer = setTimeout(() => {
        if (!drag || drag.moved || drag.road !== index) return;
        activeVertex = -1;
        activeSegment = segment;
        drag.kind = 'segment';
        drag.index = segment;
        drag.lineTap = false;
        lastLineTap = undefined;
        announce(T.segmentSelected);
        drawOverlay();
        render();
      }, 500);
    // Keep compatibility click/dblclick events: cancelling pointerdown suppresses them.
    event.stopPropagation();
    try {
      host.map.setPointerCapture(event.pointerId);
    } catch {
      /* A synthetic pointer cannot be captured. */
    }
    drawOverlay();
    render();
  }
  function onPointerMove(event: PointerEvent): void {
    if (current === 'off') return;
    const p = toWorld(event.clientX, event.clientY);
    if (drag && event.pointerId === drag.pointer) {
      if (Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) > 3) {
        drag.moved = true;
        clearHold();
      }
      const w = world();
      if (!w) return;
      const dx = p.x - drag.origin.x,
        dy = p.y - drag.origin.y;
      if (drag.kind === 'vertex') {
        const i = drag.index,
          last = drag.base.length - 1;
        if ((i === 0 || i === last) && fixedRoadEndpoint(w, drag.road, i === 0 ? 0 : 1)) {
          announce('Road connections to places stay fixed.');
          event.stopPropagation();
          return;
        }
        const target = { x: drag.base[i].x + dx, y: drag.base[i].y + dy };
        drag.controls = drag.base.map((q, k) => (k === i ? (entryForControl(w, drag!.road, i) >= 0 ? roadBorderPoint(target, w.mapSize) : clampRoadPoint(target, w.mapSize)) : { ...q }));
      } else if (drag.kind === 'segment') {
        try {
          drag.controls = translatedRoadSegment(w, drag.road, drag.index, drag.base, dx, dy);
        } catch (error) {
          announce(error instanceof Error ? error.message : String(error));
          event.stopPropagation();
          return;
        }
      } else drag.controls = translatedRoadControls(w, drag.road, drag.base, dx, dy);
      queuePreview();
      event.stopPropagation();
      drawOverlay();
      return;
    }
    if (current === 'draw') {
      cursor = p;
      queuePreview();
      drawOverlay();
    }
  }
  function onPointerUp(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointer) return;
    clearHold();
    const done = drag,
      index = done.road;
    drag = undefined;
    try {
      host.map.releasePointerCapture(event.pointerId);
    } catch {
      /* Already released. */
    }
    event.stopPropagation();
    if (done.inserted && event.type !== 'pointercancel') {
      lastLineTap = undefined;
      if (done.moved)
        void rerouteControls(index, done.controls, () => {
          activeVertex = done.index;
          activeSegment = -1;
        });
      else addWaypointAt(done.origin);
      return;
    }
    if (event.type === 'pointercancel' || !done.moved || index < 0) {
      if (event.type !== 'pointercancel' && !done.moved) {
        const previous = lastLineTap;
        lastLineTap = done.lineTap ? { time: event.timeStamp, road: index, point: done.start, vertex: done.index } : undefined;
        if (done.lineTap && previous && previous.road === index && event.timeStamp - previous.time < 420 && Math.hypot(done.start.x - previous.point.x, done.start.y - previous.point.y) <= CLICK_PX) {
          lastLineTap = undefined;
          lastDoubleAt = event.timeStamp;
          if (done.kind === 'vertex' && previous.vertex === done.index) {
            activeVertex = -1;
            activeSegment = -1;
            announce(T.lineSelected);
            drawOverlay();
            render();
          } else addWaypointAt(toWorld(done.start.x, done.start.y));
          return;
        }
        announce(activeSegment >= 0 ? T.segmentSelected : activeVertex >= 0 ? T.pointSelected : T.lineSelected);
      } else lastLineTap = undefined;
      drawOverlay();
      render();
      return;
    }
    lastLineTap = undefined;
    if (done.controls.length === done.base.length && done.controls.every((p, i) => sameRoadPoint(p, done.base[i]))) {
      drawOverlay();
      return;
    }
    void rerouteControls(index, done.controls);
  }
  function onClick(event: MouseEvent): void {
    if (current === 'off') return;
    // The map's own selection (inspector, placement) must not react while a network tool is active.
    event.stopPropagation();
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const moved = downAt && Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > CLICK_PX;
    const handle = inOverlay(event.target),
      w = world();
    if (moved || !w || working || host.busy?.()) return;
    const p = toWorld(event.clientX, event.clientY),
      tolerance = PICK_PX / scale();
    if (current === 'draw') {
      const last = draft[draft.length - 1];
      if (handle?.dataset.role === 'draw-last' || (last && draft.length >= 2 && Math.hypot(last.x - p.x, last.y - p.y) <= tolerance)) {
        void finishDraft();
        return;
      }
      const outside = !insideRoadMap(p, w.mapSize),
        point = outside ? roadBorderPoint(p, w.mapSize) : (snapTarget(w, p) ?? p);
      if (last && sameRoadPoint(last, point)) return;
      draft.push(point);
      cursor = undefined;
      queuePreview();
      drawOverlay();
      render();
      if (outside && draft.length >= 2) void finishDraft();
      return;
    }
    if (current === 'roads') {
      if (handle?.dataset.role === 'remove-control') {
        removeActiveVertex();
        return;
      }
      if (handle?.dataset.role === 'cut-control') {
        void cutActiveVertex();
        return;
      }
      if (handle?.dataset.role === 'delete-entry') {
        deleteActiveEntry();
        return;
      }
      if (handle) return;
      const hit = roadAt(w, p, tolerance);
      if (!hit) {
        selected = -1;
        activeVertex = -1;
        activeSegment = -1;
        cutPreview = false;
        drawOverlay();
        render();
      }
      return;
    }
    if (current === 'rivers') {
      const hit = riverAt(w, p, tolerance);
      if (!hit) {
        plan = undefined;
        drawOverlay();
        render();
        return;
      }
      try {
        plan = { world: w, plan: planRiverDeletion(w, hit.index, { throughLakes }) };
      } catch (error) {
        plan = undefined;
        fail(error);
      }
      drawOverlay();
      render();
    }
  }
  function onDoubleClick(event: MouseEvent): void {
    if (current === 'off') return;
    // No zoom on a double click while drawing or reshaping: those clicks are edits.
    event.stopPropagation();
    event.preventDefault();
    const handle = inOverlay(event.target),
      w = world();
    if (current === 'roads' && w && !working && !host.busy?.()) {
      if (event.timeStamp - lastDoubleAt < 500) return;
      if (handle?.dataset.role?.includes('control') || handle?.dataset.role === 'delete-entry') return;
      if (handle?.dataset.role === 'vertex') {
        selected = Number(handle.dataset.road);
        activeVertex = -1;
        activeSegment = -1;
        announce(T.lineSelected);
        drawOverlay();
        render();
        return;
      }
      addWaypointAt(toWorld(event.clientX, event.clientY));
    }
  }
  function addWaypointAt(p: Vec2): void {
    const w = world();
    if (!w || working || host.busy?.()) return;
    const hit = roadAt(w, p, PICK_PX / scale());
    if (!hit) return;
    selected = hit.index;
    const geometry = editableRoadGeometry(w.roads![selected], w.mapSize),
      inserted = insertRoadControlGeometry(w, selected, p),
      road = selected;
    activeVertex = inserted.index;
    activeSegment = -1;
    cutPreview = false;
    if (inserted.geometry.controls.length !== geometry.controls.length)
      void edit(
        source => commitRoutedRoads(source, [{ index: road, geometry: inserted.geometry }]),
        translate(T.pointAdded),
        () => {
          activeVertex = inserted.index;
          activeSegment = -1;
        },
      );
    else {
      drawOverlay();
      render();
    }
  }
  function onKey(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    const historyKey = (event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase());
    if (current === 'off' && !(host.tools?.includes('roads') && historyKey && (undoStack.length || redoStack.length))) return;
    const target = event.target as HTMLElement | null;
    if (document.querySelector('dialog[open]')) return;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (event.key === 'Escape') {
      if (addingPoint) {
        addingPoint = false;
        render();
        drawOverlay();
      } else if (current === 'draw' && !working) {
        if (draft.length >= 2) void finishDraft();
        else stop();
      } else if (working) {
        cancelRouting?.();
      } else if (selected >= 0) {
        selected = -1;
        activeVertex = -1;
        activeSegment = -1;
        cutPreview = false;
        drawOverlay();
        render();
      } else stop();
      event.preventDefault();
    } else if (event.key === 'Enter' && current === 'draw') {
      void finishDraft();
      event.preventDefault();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      void historyMove(event.shiftKey);
      event.preventDefault();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      void historyMove(true);
      event.preventDefault();
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && current === 'roads' && selected >= 0) {
      const w = world();
      if (activeVertex >= 0) {
        if (w && entryForControl(w, selected, activeVertex) >= 0) deleteActiveEntry();
        else removeActiveVertex();
      } else if (activeSegment >= 0) {
        const road = selected,
          segment = activeSegment;
        void edit(
          source => deleteRoadControlSegment(source, road, segment),
          translate(T.segmentRemoved),
          () => {
            activeVertex = -1;
            activeSegment = -1;
          },
        );
      } else deleteSelectedRoad();
      event.preventDefault();
      event.stopPropagation();
    }
  }
  function removeActiveVertex(): void {
    const road = selected,
      w = world(),
      vertex = activeVertex;
    if (!w || !w.roads?.[road]) return;
    const geometry = editableRoadGeometry(w.roads[road], w.mapSize);
    if (vertex < 0) return;
    if (vertex === 0 || vertex === geometry.controls.length - 1) {
      void edit(
        source => deleteRoadControlSegment(source, road, vertex === 0 ? 0 : geometry.controls.length - 2),
        translate(T.pointRemoved),
        () => {
          activeVertex = -1;
          activeSegment = -1;
        },
      );
      return;
    }
    void rerouteControls(
      road,
      geometry.controls.filter((_, i) => i !== vertex),
      () => {
        activeVertex = -1;
        activeSegment = -1;
        announce(T.pointRemoved);
      },
    );
  }
  async function cutActiveVertex(): Promise<void> {
    const w = world(),
      road = selected,
      vertex = activeVertex;
    if (!w || !w.roads?.[road] || working || host.busy?.()) return;
    const geometry = editableRoadGeometry(w.roads[road], w.mapSize);
    if (vertex <= 0 || vertex >= geometry.controls.length - 1) return;
    working = true;
    status = T.working;
    render();
    try {
      const [first, second] = roadCutPieces(geometry, vertex, Math.max(1, Math.min(3, w.roads[road].width * 0.5)));
      if (world() !== w || current !== 'roads') return;
      const next = refreshRoadExitConnections(splitRoadWithGap(w, road, first, second));
      working = false;
      await commit(next, translate(T.roadCut), () => {
        activeVertex = -1;
        activeSegment = -1;
      });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) fail(error);
    } finally {
      working = false;
      status = '';
      drawOverlay();
      render();
    }
  }
  async function deleteActiveEntry(entry?: number): Promise<void> {
    const w = world();
    if (!w || selected < 0 || working || host.busy?.()) return;
    entry ??= entryForControl(w, selected, activeVertex);
    if (entry < 0 || !(await confirmAction(T.confirmEntry, { id: 'delete-road-entry-dialog', title: T.deleteEntry, confirmLabel: T.deleteRoad, danger: true }))) return;
    if (world() !== w || working || host.busy?.()) return;
    const index = entry;
    void edit(
      source => deleteRoadEntry(source, index),
      translate(T.roadDeleted),
      () => {
        selected = -1;
        activeVertex = -1;
        activeSegment = -1;
      },
    );
  }
  function deleteSelectedRoad(): void {
    const w = world(),
      road = selected;
    if (!w || road < 0) return;
    const controls = editableRoadGeometry(w.roads![road], w.mapSize).controls;
    const entry = entryForControl(w, road, 0),
      other = entryForControl(w, road, controls.length - 1);
    if (entry >= 0 || other >= 0) {
      deleteActiveEntry(entry >= 0 ? entry : other);
      return;
    }
    void edit(
      source => refreshRoadExitConnections(deleteRoad(source, road).world),
      translate(T.roadDeleted),
      () => {
        selected = -1;
        activeVertex = -1;
        activeSegment = -1;
      },
    );
  }
  const forwardWheel = (event: WheelEvent): void => {
    const canvas = host.map.querySelector<HTMLCanvasElement>('canvas');
    if (!canvas || event.target === canvas) return;
    event.preventDefault();
    canvas.dispatchEvent(new WheelEvent('wheel', { clientX: event.clientX, clientY: event.clientY, deltaX: event.deltaX, deltaY: event.deltaY, deltaZ: event.deltaZ, deltaMode: event.deltaMode, cancelable: true }));
  };
  host.map.addEventListener('pointerdown', onPointerDown, true);
  host.map.addEventListener('pointermove', onPointerMove, true);
  host.map.addEventListener('pointerup', onPointerUp, true);
  host.map.addEventListener('pointercancel', onPointerUp, true);
  host.map.addEventListener('click', onClick, true);
  host.map.addEventListener('dblclick', onDoubleClick, true);
  svg.addEventListener('wheel', forwardWheel, { passive: false });
  window.addEventListener('keydown', onKey);
  const onMode = (event: Event): void => {
    if ((event as CustomEvent<string>).detail !== modeToken) stop();
  };
  window.addEventListener('v2-edit-mode', onMode);

  // ---- overlay drawing (world coordinates; non-scaling strokes keep pixel widths)
  function line(path: readonly Vec2[], stroke: string, width: number, extra: Record<string, string | number> = {}): SVGElement {
    return svgEl('path', { d: pathData(path), fill: 'none', stroke, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke', ...extra });
  }
  function dot(p: Vec2, px: number, fill: string, stroke: string, extra: Record<string, string | number> = {}): SVGElement {
    return svgEl('circle', { cx: p.x, cy: p.y, r: px / scale(), fill, stroke, 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke', ...extra });
  }
  function entryDot(p: Vec2, extra: Record<string, string | number> = {}): SVGElement {
    const r = 7 / scale(),
      node = svgEl('path', { d: `M${p.x} ${p.y - r}L${p.x + r} ${p.y}L${p.x} ${p.y + r}L${p.x - r} ${p.y}Z`, fill: GOLD, stroke: INK, 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', ...extra });
    const title = svgEl('title', {});
    title.textContent = translate(T.entry);
    node.append(title);
    return node;
  }
  function pointAction(p: Vec2, side: -1 | 1, role: string, label: string, icon: 'minus' | 'cut' | 'trash', action: () => void, disabled = false): SVGElement {
    const s = scale(),
      v = host.getView(),
      width = host.map.clientWidth,
      height = host.map.clientHeight;
    const left = v.cx - width / 2 / s,
      top = v.cy - height / 2 / s;
    const cx = Math.max(left + 32 / s, Math.min(left + (width - 32) / s, p.x)) + (side * 17) / s;
    const cy = p.y - top < 42 / s ? p.y + 27 / s : p.y - 27 / s;
    const group = svgEl('g', { transform: `translate(${cx} ${cy}) scale(${1 / s})`, 'data-role': role, role: 'button', tabindex: working || disabled ? -1 : 0, 'aria-label': translate(label), 'aria-disabled': String(working || disabled) });
    const title = svgEl('title', {});
    title.textContent = translate(label);
    group.append(title, svgEl('circle', { r: 12, fill: cutPreview && icon === 'cut' ? DANGER : PAPER, stroke: '#8a6a2c', 'stroke-width': 1.5 }));
    const shape = icon === 'minus' ? 'M-5 0H5' : icon === 'trash' ? 'M-5 -3H5M-2 -5H2M-4 -3L-3 5H3L4 -3M-1 -1V3M1 -1V3' : 'M-4 -3L5 4M-4 3L5 -4M-3 -4a2 2 0 1 0 -4 0a2 2 0 1 0 4 0M-3 4a2 2 0 1 0 -4 0a2 2 0 1 0 4 0';
    group.append(svgEl('path', { d: shape, fill: 'none', stroke: icon === 'minus' ? INK : '#943c2b', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'pointer-events': 'none' }));
    group.addEventListener('keydown', event => {
      const key = (event as KeyboardEvent).key;
      if (key === 'Enter' || key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        if (!working && !disabled) action();
      }
    });
    return group;
  }
  function drawOverlay(): void {
    if (current === 'off') return;
    const w = world(),
      nodes: SVGElement[] = [];
    if (w && (current === 'roads' || current === 'draw')) for (const j of junctions(w)) nodes.push(dot(j.point, j.site ? 3.5 : 2.5, j.site ? GOLD : PAPER, INK, { opacity: 0.75 }));
    if (w && current === 'roads' && selected >= 0) {
      const road = w.roads?.[selected];
      if (road) {
        const geometry = editableRoadGeometry(road, w.mapSize),
          controls = drag?.controls ?? (pendingControls?.road === selected ? pendingControls.controls : geometry.controls);
        const entry = activeVertex >= 0 ? entryForControl(w, selected, activeVertex) : -1;
        if (entry >= 0) for (const index of roadEntryDeletionPlan(w, entry)) if (index !== selected) nodes.push(line(w.roads![index].path, GOLD, 5, { opacity: 0.7 }));
        const shown = drag?.moved && preview ? preview.path : road.path;
        nodes.push(line(shown, INK, Math.max(7, road.width * scale() + 4), { opacity: 0.45 }), line(shown, activeVertex < 0 ? '#ffe09a' : GOLD, Math.max(activeVertex < 0 ? 5 : 3, road.width * scale()), { opacity: drag?.moved && !preview ? 0.5 : 1 }));
        nodes.push(line(road.path, 'transparent', 16, { 'data-role': 'road', 'data-road': selected }));
        if (activeSegment >= 0 && activeSegment < geometry.controls.length - 1) {
          const path = geometry.path.slice(geometry.controlIndices[activeSegment], geometry.controlIndices[activeSegment + 1] + 1);
          nodes.push(line(path, '#fff5c9', 7, { 'data-role': 'segment', 'data-road': selected, 'data-segment': activeSegment }));
        }
        if (drag?.moved) nodes.push(line(controls, GOLD, 3, { 'stroke-dasharray': '6 4' }));
        controls.forEach((p, i) => {
          const extra = { 'data-role': 'vertex', 'data-road': selected, 'data-index': i, 'data-selected': String(i === activeVertex), 'data-fixed': String((i === 0 || i === controls.length - 1) && fixedRoadEndpoint(w, selected, i === 0 ? 0 : 1)) };
          if (roadExitReports(w).some(e => e.class && e.point && sameRoadPoint(e.point, p))) nodes.push(entryDot(p, extra));
          else nodes.push(dot(p, i === activeVertex ? 7 : 5, i === activeVertex || i === activeSegment || (i === activeSegment + 1 && activeSegment >= 0) ? GOLD : PAPER, '#8a6a2c', extra));
        });
        if (activeVertex >= 0 && controls[activeVertex] && !drag) {
          const p = controls[activeVertex];
          nodes.push(entry >= 0 ? pointAction(p, -1, 'delete-entry', T.deleteEntry, 'trash', deleteActiveEntry) : pointAction(p, -1, 'remove-control', T.removePoint, 'minus', removeActiveVertex));
          nodes.push(pointAction(p, 1, 'cut-control', T.cutPoint, 'cut', () => void cutActiveVertex(), activeVertex === 0 || activeVertex === controls.length - 1));
        }
      }
    }
    if (w && current === 'roads')
      for (const e of roadExitReports(w))
        if (e.class && e.point) {
          const index = w.roads?.findIndex(r => sameRoadPoint(r.path[0], e.point!) || sameRoadPoint(r.path.at(-1)!, e.point!)) ?? -1;
          if (index < 0 || index === selected) continue;
          const g = editableRoadGeometry(w.roads![index], w.mapSize),
            i = sameRoadPoint(g.controls[0], e.point) ? 0 : g.controls.length - 1;
          nodes.push(entryDot(e.point, { 'data-role': 'vertex', 'data-road': index, 'data-index': i }));
        }
    if (w && current === 'draw') {
      const target = cursor && (insideRoadMap(cursor, w.mapSize) ? (snapTarget(w, cursor) ?? cursor) : roadBorderPoint(cursor, w.mapSize));
      const intention = target && draft.length ? [...draft, target] : draft,
        path = preview?.path ?? intention;
      if (path.length > 1) nodes.push(line(path, INK, 6, { opacity: 0.4 }), line(path, previewError ? DANGER : GOLD, 3, { 'stroke-dasharray': '6 4' }));
      draft.forEach((p, i) => nodes.push(dot(p, i === draft.length - 1 && draft.length >= 2 ? 7 : 4.5, i === draft.length - 1 ? GOLD : PAPER, '#8a6a2c', i === draft.length - 1 && draft.length >= 2 ? { 'data-role': 'draw-last' } : {})));
      if (target) nodes.push(dot(target, 9, 'none', GOLD, { 'stroke-width': 2 }));
      if (cursor && !insideRoadMap(cursor, w.mapSize) && target) nodes.push(entryDot(target));
    }
    if (w && current === 'rivers' && plan?.world === w) {
      for (const index of plan.plan.rivers) {
        const river = w.terrain.rivers[index];
        if (!river) continue;
        nodes.push(line(river.path, INK, index === plan.plan.selected ? 9 : 6, { opacity: 0.35 }), line(river.path, DANGER, index === plan.plan.selected ? 5 : 3, index === plan.plan.selected ? {} : { 'stroke-dasharray': '5 3' }));
      }
    }
    svg.replaceChildren(...nodes);
  }

  // ---- panel
  function button(text: string, action: () => void, options: { primary?: boolean; danger?: boolean; disabled?: boolean } = {}): HTMLButtonElement {
    const b = el('button');
    b.type = 'button';
    setText(b, text);
    b.onclick = action;
    b.setAttribute('aria-label', translate(text));
    if (text === T.addPoint) editorButtonIcon(b, 'display-roads', '+');
    else if (text === T.reroll) {
      const icon = el('i', 'art art-dice');
      icon.setAttribute('aria-hidden', 'true');
      b.prepend(icon);
      b.dataset.roadReroll = 'true';
    } else if (text === T.deleteRiver) editorButtonIcon(b, 'family-water', '×');
    else if (text === T.undo || text === T.redo) editorButtonIcon(b, 'display-roads', '↶');
    else if (text === T.deleteRoad) editorButtonIcon(b, 'display-roads', '×');
    else if (text === T.removePoint) editorButtonIcon(b, 'display-roads', '−');
    else if (text === T.deselect) editorButtonIcon(b, 'display-layers', '×');
    else editorButtonIcon(b, text === T.finish ? 'display-roads' : 'display-2d', text === T.finish ? '✓' : '×');
    if (options.primary) b.classList.add('primary');
    if (options.danger) b.classList.add('danger');
    b.disabled = !!options.disabled || working;
    return b;
  }
  function classSelect(value: RoadClass, onChange: (cls: RoadClass) => void): HTMLLabelElement {
    const label = el('label'),
      caption = el('span'),
      select = el('select');
    setText(caption, T.cls);
    for (const cls of ROAD_CLASS_ORDER) select.add(new Option(translate(CLASS_LABEL[cls]), cls));
    select.value = value;
    select.disabled = working;
    select.onchange = () => onChange(select.value as RoadClass);
    label.append(caption, select);
    return label;
  }
  function render(): void {
    const w = world(),
      busy = !!host.busy?.();
    const roadSession = !!host.tools?.includes('roads'),
      dirty = pending();
    sessionBar.hidden = !roadSession || (current === 'off' && !dirty);
    sessionBar.dataset.pending = String(dirty);
    sessionBar.setAttribute('aria-busy', String(working));
    sessionBar.setAttribute('aria-label', translate(T.validate));
    sessionHint.textContent = working ? translate(status || T.working) : dirty ? fmt(T.changed, { n: Math.max(0, undoStack.length - sessionHistoryStart) }) : translate(T.pending);
    feedback.textContent = lastFeedback;
    feedback.hidden = !lastFeedback;
    setText(validateButton, T.validate);
    setText(cancelButton, T.cancelEdits);
    setText(continueButton, T.continueEdits);
    continueButton.hidden = current !== 'off';
    continueButton.disabled = cancelButton.disabled = busy || working;
    validateButton.disabled = busy || working || (current === 'draw' && draft.length === 1);
    box.setAttribute('aria-busy', String(working));
    banner.setAttribute('aria-busy', String(working));
    svg.dataset.adding = String(addingPoint);
    for (const b of quickButtons) {
      b.setAttribute('aria-pressed', String(current === b.dataset.networkQuick));
      b.disabled = busy || working || !w;
    }
    for (const b of toolButtons) {
      b.setAttribute('aria-pressed', String(current === b.dataset.networkTool));
      b.disabled = busy || working || !w;
    }
    setText(hint, current === 'roads' ? (addingPoint ? T.addHint : T.roadsHint) : current === 'draw' ? T.autoHint : current === 'rivers' ? T.riversHint : T.idle);
    detail.replaceChildren();
    banner.hidden = current === 'off' || !(status || current === 'roads' || current === 'draw' || (current === 'rivers' && !plan));
    banner.textContent = status ? translate(status) : cutPreview ? translate(T.cutPreview) : current === 'roads' ? translate(addingPoint ? T.addHint : T.roadsHint) : current === 'draw' ? translate(T.autoHint) : translate(T.riversHint);
    if (!w || current === 'off') return;
    if (current === 'roads') {
      const history = el('div', 'v2-network-row');
      history.append(
        button(T.undo, () => void historyMove(false), { disabled: !undoStack.length }),
        button(T.redo, () => void historyMove(true), { disabled: !redoStack.length }),
      );
      detail.append(history);
    }
    if (current === 'roads' && selected >= 0 && w.roads?.[selected]) {
      const road = w.roads[selected],
        title = el('strong'),
        info = el('span', 'hint');
      title.textContent = road.urban ? `${translate(road.urban.access ? 'Town access' : 'Town street')} · ${w.settlements?.find(t => t.key === road.urban!.key)?.name ?? road.urban.key}` : fmt(T.road, { n: selected + 1 });
      const geometry = editableRoadGeometry(road, w.mapSize);
      info.textContent = `${translate(activeVertex >= 0 ? T.pointSelected : activeSegment >= 0 ? T.segmentSelected : T.lineSelected)} · ${fmt(T.roadInfo, { distance: formatDistance(polylineLength(road.path), getDistanceUnit(), numberLocale()), points: geometry.controls.length })}`;
      const width = el('label'),
        widthCaption = el('span'),
        widthInput = el('input');
      widthCaption.textContent = `${translate(T.width).replace(/\s*[（(][^()（）]*[)）]\s*$/, '')} (${getDistanceUnit()})`;
      widthInput.type = 'number';
      widthInput.min = String(0.5 / unitFactor(getDistanceUnit()));
      widthInput.max = String(60 / unitFactor(getDistanceUnit()));
      widthInput.step = 'any';
      widthInput.value = String(road.width / unitFactor(getDistanceUnit()));
      widthInput.disabled = working;
      const index = selected;
      widthInput.onchange = () => {
        const value = widthInput.valueAsNumber * unitFactor(getDistanceUnit());
        if (Number.isFinite(value) && value >= 0.5 && value <= 60) void edit(source => setRoadClass(source, index, roadClassOf(source, index), value).world);
      };
      width.append(widthCaption, widthInput);
      const row = el('div', 'v2-network-row');
      const add = button(T.addPoint, () => {
        addingPoint = !addingPoint;
        render();
        drawOverlay();
      });
      add.setAttribute('aria-pressed', String(addingPoint));
      row.append(
        add,
        button(T.reroll, () => void rerouteControls(index, geometry.controls, undefined, undefined, true)),
        button(T.removePoint, removeActiveVertex, { disabled: activeVertex < 0 }),
        button(T.deselect, () => {
          selected = -1;
          activeVertex = -1;
          activeSegment = -1;
          drawOverlay();
          render();
        }),
        button(T.deleteRoad, deleteSelectedRoad, { danger: true }),
      );
      detail.append(
        title,
        info,
        classSelect(roadClassOf(w, index), cls => void rerouteControls(index, geometry.controls, undefined, cls)),
        width,
        row,
      );
    } else if (current === 'draw') {
      const count = el('span', 'hint');
      count.textContent = fmt(T.points, { n: draft.length });
      const row = el('div', 'v2-network-row');
      const cancel = button(T.cancel, () => {
        if (cancelRouting) {
          stop();
          return;
        }
        cancelPreview();
        draft = [];
        cursor = undefined;
        drawOverlay();
        render();
      });
      cancel.disabled = working ? !cancelRouting : !draft.length;
      row.append(
        button(
          T.reroll,
          () => {
            drawVariant++;
            cursor = undefined;
            queuePreview();
            drawOverlay();
            render();
          },
          { disabled: draft.length < 2 },
        ),
        button(T.finish, () => void finishDraft(), { primary: true, disabled: draft.length < 2 }),
        cancel,
      );
      detail.append(
        classSelect(drawClass, cls => {
          drawClass = cls;
          queuePreview();
        }),
        count,
        row,
      );
    } else if (current === 'rivers' && plan?.world === w) {
      const river = w.terrain.rivers[plan.plan.selected],
        entry = w.names?.entries.find(e => e.kind === 'river' && (e.path === river?.path || e.id === `river:${river?.id}`));
      const name = entry?.parts ? presentName(entry.parts, namePresentation(host.getSettings?.())) : (entry?.text ?? river?.name ?? translate(T.aRiver)),
        extra = plan.plan.rivers.length - 1;
      const summary = el('strong');
      summary.textContent = extra > 0 ? fmt(T.riverPlan, { name, n: extra }) : fmt(T.riverOnly, { name });
      const row = el('div', 'v2-network-row');
      row.append(
        button(T.deleteRiver, () => void deletePlannedRiver(), { primary: true }),
        button(T.cancel, () => {
          plan = undefined;
          drawOverlay();
          render();
        }),
      );
      detail.append(summary, row);
    }
  }
  function sync(): void {
    const w = world();
    if (!w) {
      clearSession();
      undoStack.length = redoStack.length = 0;
      stop();
      render();
      return;
    }
    if (w !== knownWorld && !working) {
      undoStack.length = redoStack.length = 0;
      clearSession();
      clearHold();
      cancelPreview();
      selected = -1;
      activeVertex = -1;
      activeSegment = -1;
      draft = [];
      drag = undefined;
    }
    knownWorld = w;
    if (selected >= (w.roads?.length ?? 0)) {
      selected = -1;
      activeVertex = -1;
    }
    if (plan && plan.world !== w) plan = undefined;
    if (current !== 'off') drawOverlay();
    render();
  }
  const offLanguage = onLanguageChange(() => {
    svg.setAttribute('aria-label', translate(T.overlay));
    drawOverlay();
    render();
  });
  const offUnits = onUnitsChange(render);
  render();
  return {
    sync,
    start,
    stop,
    pending,
    validate: validateSession,
    cancel: cancelSession,
    active: () => current !== 'off',
    tool: () => current,
    toWorld,
    destroy() {
      stop();
      offLanguage();
      offUnits();
      host.map.removeEventListener('pointerdown', onPointerDown, true);
      host.map.removeEventListener('pointermove', onPointerMove, true);
      host.map.removeEventListener('pointerup', onPointerUp, true);
      host.map.removeEventListener('pointercancel', onPointerUp, true);
      host.map.removeEventListener('click', onClick, true);
      host.map.removeEventListener('dblclick', onDoubleClick, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('v2-edit-mode', onMode);
      svg.remove();
      banner.remove();
      shortcuts?.remove();
      sessionBar.remove();
      box.remove();
    },
  };
}
/** Language of the default copy, for hosts that build their own entry button. */
export const networkEditorLabel = (): string => (getLanguage() === 'fr' ? 'Réseau régional' : 'Regional network');
