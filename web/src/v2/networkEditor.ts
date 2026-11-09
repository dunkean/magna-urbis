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
import {
  ROAD_CLASS_ORDER, addRoad, deleteRiver, deleteRoad, junctionPoints,
  planRiverDeletion, refreshNaturalForest, riverAt, roadAt, roadClassOf, setRoadClass, setRoadPath,
  translatePath, type RiverDeletionPlan, type RoadClass,
} from './networkEdits';
import { polylineLength } from '../gen/core/geom';
import { roadControlIndices, roadControlMidpoint, deformRoadControl, removeRoadControl } from './roadControls';
import RoadRouteWorker from './roadRoute.worker?worker';

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
  /** Current viewer camera (`client.viewer.getView()`). */
  getView(): View;
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
  start(tool: Exclude<NetworkTool, 'off'>): void;
  stop(): void;
  active(): boolean;
  tool(): NetworkTool;
  /** Map point in world metres for a client position, with the host's view. */
  toWorld(clientX: number, clientY: number): Vec2;
  destroy(): void;
}

const copy = (en: string, fr: string): string => { registerMessages({ [en]: { en, fr } }); return en; };
const T = {
  title: copy('Regional network', 'Réseau régional'),
  autoHint: copy('Click the start, then the destination. The route follows terrain and regional road settings. Esc cancels.', 'Cliquez le départ puis l’arrivée. Le tracé suit le relief et les réglages des routes régionales. Échap annule.'),
  method: copy('Route drawing', 'Mode de tracé'),auto: copy('Automatic · terrain', 'Automatique · relief'),free: copy('Free · control points', 'Libre · points de contrôle'),
  routing: copy('Calculating the route over the terrain…', 'Calcul du parcours sur le relief…'),
  noRoute: copy('No road route could be found between these points.', 'Aucun parcours praticable entre ces deux points. Choisissez une autre arrivée.'),
  roads: copy('Edit roads', 'Modifier les routes'), draw: copy('Draw a road', 'Tracer une route'), rivers: copy('Delete a river', 'Supprimer une rivière'),
  idle: copy('Choose a tool, then work on the map. Edits apply directly to this map and are saved with the complete project; regenerating the region replaces them.',
    'Choisissez un outil puis travaillez sur la carte. Les modifications s’appliquent directement à cette carte et sont enregistrées dans le projet complet ; régénérer la région les remplace.'),
  roadsHint: copy('Drag a road to move it. Drag a point to reshape it; double-click a point to remove it. Press Esc to finish.',
    'Glissez une route pour la déplacer. Glissez un point pour modifier son tracé ; double-cliquez sur un point pour le retirer. Échap pour terminer.'),
  drawHint: copy('Click to add points. Click the last point again or press Enter to finish; Esc cancels. Ends snap to junctions, settlements and roads.',
    'Cliquez pour ajouter des points. Cliquez à nouveau sur le dernier point ou appuyez sur Entrée pour terminer ; Échap annule. Les extrémités s’accrochent aux carrefours, aux lieux et aux routes.'),
  riversHint: copy('Click a river. It is deleted together with every upstream tributary, its braids and its oxbows.',
    'Cliquez sur une rivière. Elle est supprimée avec tous ses affluents amont, ses bras et ses bras morts.'),
  road: copy('Road {n}', 'Route {n}'), roadInfo: copy('{km} km · {points} handles', '{km} km · {points} poignées'),
  cls: copy('Class', 'Catégorie'), width: copy('Width (m)', 'Largeur (m)'),
  deleteRoad: copy('Delete road', 'Supprimer la route'), removePoint: copy('Remove point', 'Retirer le point'), deselect: copy('Deselect', 'Désélectionner'),
  points: copy('{n} points', '{n} points'), finish: copy('Finish road', 'Terminer la route'), cancel: copy('Cancel', 'Annuler'),
  riverPlan: copy('{name} and {n} upstream or side channels', '{name} et {n} affluents ou bras'),
  riverOnly: copy('{name} alone', '{name} seule'),
  aRiver: copy('This river', 'Cette rivière'),
  throughLakes: copy('Also follow rivers that feed it through a lake', 'Suivre aussi les rivières qui l’alimentent à travers un lac'),
  deleteRiver: copy('Delete river and tributaries', 'Supprimer la rivière et ses affluents'),
  working: copy('Updating the map…', 'Mise à jour de la carte…'),
  forest: copy('Regrowing the forest over the former bed…', 'Reboisement de l’ancien lit…'),
  roadDeleted: copy('Road deleted.', 'Route supprimée.'), roadAdded: copy('Road added.', 'Route ajoutée.'),
  riverDeleted: copy('River deleted with {n} channels. Rebuild the towns on its banks to update their waterfront.', 'Rivière supprimée avec {n} chenaux. Reconstruisez les villes riveraines pour mettre à jour leurs rives.'),
  noWorld: copy('Create the terrain first.', 'Créez d’abord le terrain.'),
  overlay: copy('Network editing overlay', 'Calque d’édition du réseau'),
  highway: copy('Highway', 'Grande route'), main: copy('Main road', 'Route principale'), local: copy('Local road', 'Route locale'),
  track: copy('Track', 'Chemin'), trail: copy('Trail', 'Sentier'),
};
const CLASS_LABEL: Record<RoadClass, string> = { highway: T.highway, main: T.main, local: T.local, track: T.track, trail: T.trail };
const SVG = 'http://www.w3.org/2000/svg';
const SNAP_PX = 12, PICK_PX = 9, CLICK_PX = 5;
const GOLD = '#dcb86f', INK = '#26271f', PAPER = '#f7f0dc', DANGER = '#d9725a';
const STYLE_ID = 'v2-network-editor-style';
const CSS = `.v2-network-editor{display:grid;gap:9px;margin:12px 0;padding:12px;border:1px solid #dcb86f33;border-radius:7px;background:#ffffff05}
.v2-network-editor .v2-network-tools{display:flex;gap:5px;flex-wrap:wrap}.v2-network-editor .v2-network-tools button{flex:1 1 30%;font-size:11px;padding:7px 8px}
.v2-network-editor button[aria-pressed=true]{border-color:#dcb86f88;background:#dcb86f1c;color:var(--gold)}
.v2-network-editor .v2-network-detail{display:grid;gap:8px}.v2-network-editor .v2-network-detail:empty{display:none}
.v2-network-editor .v2-network-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.v2-network-editor .v2-network-row button{font-size:11px;padding:7px 10px}
.v2-network-editor label{display:grid;gap:4px;font-size:10px;color:var(--muted)}.v2-network-editor label.checkline{display:flex;align-items:center;gap:7px}
.v2-network-editor select,.v2-network-editor input[type=number]{width:100%;min-width:0;background:var(--field);color:inherit;border:1px solid var(--line);border-radius:6px;padding:6px 8px}
.v2-network-editor .danger{border-color:#dd977d66;color:#ffd7c1}.v2-network-editor strong{font-weight:500;font-size:12px}
.v2-network-overlay{position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none;overflow:hidden}
.v2-network-overlay [data-role]{pointer-events:all}.v2-network-overlay [data-role=road]{pointer-events:stroke;cursor:move}
.v2-network-overlay [data-role=vertex],.v2-network-overlay [data-role=ghost]{cursor:grab}.v2-network-overlay [data-role=draw-last]{cursor:pointer}
.v2-network-banner{position:absolute;top:84px;left:50%;transform:translateX(-50%);z-index:2;max-width:min(560px,80%);padding:8px 13px;font-size:11px;line-height:1.5;pointer-events:none;text-align:center}
.canvas-wrap.v2-network-active canvas{cursor:crosshair}
.v2-network-shortcuts{position:absolute;left:22px;top:125px;z-index:4;display:flex;gap:4px;padding:4px}
.map-area:has(>.city3d:not([hidden]))>.v2-network-shortcuts{display:none}
.v2-network-shortcuts button{font-size:11px;padding:6px 9px}
.v2-network-shortcuts button[aria-pressed=true]{color:#ffdc93;border-color:#dcb86f;background:#665435}
@media(max-width:720px){.v2-network-shortcuts{left:12px;top:195px}}`;

const fmt = (template: string, values: Record<string, string | number>): string =>
  translate(template).replace(/\{(\w+)\}/g, (_, key: string) => { const v = values[key]; return typeof v === 'number' ? v.toLocaleString(numberLocale(), { maximumFractionDigits: 2 }) : String(v ?? ''); });
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] => { const node = document.createElement(tag); if (className) node.className = className; return node; };
const svgEl = (tag: string, attrs: Record<string, string | number>): SVGElement => {
  const node = document.createElementNS(SVG, tag) as SVGElement;
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
};
const pathData = (path: readonly Vec2[]): string => path.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('');

type Drag =
  | { kind: 'vertex'; pointer: number; index: number; base: Polyline; path: Polyline; controls: number[]; left: number; right: number; moved: boolean; start: Vec2 }
  | { kind: 'road'; pointer: number; origin: Vec2; path: Polyline; controls: number[]; dx: number; dy: number; moved: boolean; start: Vec2 };

export function mountNetworkEditor(host: NetworkEditorHost): NetworkEditor {
  const modeToken=`network:${host.tools?.join('-')??'all'}`;
  if (!document.getElementById(STYLE_ID)) { const style = el('style'); style.id = STYLE_ID; style.textContent = CSS; document.head.append(style); }
  // ---- panel
  const box = el('section', 'v2-network-editor'), eyebrow = el('span', 'eyebrow'), tools = el('div', 'v2-network-tools'), hint = el('p', 'hint'), detail = el('div', 'v2-network-detail');
  setText(eyebrow, T.title); tools.setAttribute('role', 'toolbar');
  const toolButtons = (host.tools??['roads', 'draw', 'rivers'] as const).map(tool => {
    const button = el('button'); button.type = 'button'; button.dataset.networkTool = tool; setText(button, T[tool]);
    button.onclick = () => current === tool ? stop() : start(tool);
    tools.append(button); return button;
  });
  box.append(eyebrow, tools, hint, detail); host.panel.append(box);
  // ---- overlay
  const svg = document.createElementNS(SVG, 'svg'); svg.classList.add('v2-network-overlay'); svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-label', translate(T.overlay)); svg.toggleAttribute('hidden',true);
  const banner = el('div', 'v2-network-banner glass'); banner.hidden = true; banner.setAttribute('role', 'status');
  host.map.append(svg, banner);
  // Quick actions stay on the map even when the stage controls are collapsed.
  const shortcuts = host.tools?.includes('roads') ? el('div', 'v2-network-shortcuts glass') : undefined;
  const quickButtons: HTMLButtonElement[] = [];
  if (shortcuts) {
    shortcuts.setAttribute('role', 'toolbar');
    for (const tool of ['roads', 'draw'] as const) if (host.tools?.includes(tool)) {
      const b = el('button'); b.type = 'button'; b.dataset.networkQuick = tool; setText(b, T[tool]);
      b.onclick = () => current === tool ? stop() : start(tool); shortcuts.append(b); quickButtons.push(b);
    }
    host.map.parentElement?.append(shortcuts);
  }

  let current: NetworkTool = 'off', selected = -1, activeVertex = -1, drag: Drag | undefined, working = false, status = '';
  let draft: Polyline = [], cursor: Vec2 | undefined, drawClass: RoadClass = 'local';
  let drawMethod:'auto'|'free'='auto',cancelRouting:(()=>void)|undefined;
  let plan: { world: World; plan: RiverDeletionPlan } | undefined, throughLakes = true;
  let suppressClick = false;
  let downAt: { x: number; y: number } | undefined, frame = 0, lastBox = '', junctionCache: { world: World; points: ReturnType<typeof junctionPoints> } | undefined;

  const world = (): World | undefined => host.getWorld();
  const scale = (): number => host.getView().scale;
  function toWorld(clientX: number, clientY: number): Vec2 {
    const rect = host.map.getBoundingClientRect(), [x, y] = screenToWorld(host.getView(), rect.width, rect.height, clientX - rect.left, clientY - rect.top);
    return { x, y };
  }
  const junctions = (w: World): ReturnType<typeof junctionPoints> => {
    if (junctionCache?.world !== w) junctionCache = { world: w, points: junctionPoints(w) };
    return junctionCache.points;
  };
  /** Where a draft end would attach (same priority as networkEdits.attachEnd), for the cursor indicator only. */
  function snapTarget(w: World, p: Vec2): Vec2 | undefined {
    const snap = SNAP_PX / scale();
    let best: Vec2 | undefined, distance = snap;
    for (const j of junctions(w)) { const d = Math.hypot(j.point.x - p.x, j.point.y - p.y); if (d <= distance) { distance = d; best = j.point; } }
    if (best) return best;
    const hit = roadAt(w, p, snap);
    return hit && hit.distance <= snap ? hit.point : undefined;
  }
  const fail = (error: unknown): void => { host.toast?.(translate(error instanceof Error ? error.message : String(error)), true); };
  async function commit(next: World, message?: string, after?: (w: World) => void): Promise<void> {
    if (host.busy?.()) return;
    working = true; status = T.working; render();
    try { await host.setWorld(next); after?.(next); host.changed?.(); if (message) host.toast?.(message); drawOverlay(); }
    catch (error) { fail(error); }
    finally { working = false; status = ''; render(); }
  }

  // ---- tools
  function start(tool: Exclude<NetworkTool, 'off'>): void {
    if (host.busy?.()) return;
    if (!world()) { host.toast?.(translate(T.noWorld), true); return; }
    window.dispatchEvent(new CustomEvent('v2-edit-mode', { detail: modeToken }));
    current = tool; draft = []; cursor = undefined; plan = undefined; drag = undefined; activeVertex = -1;
    if (tool !== 'roads') selected = -1;
    host.map.classList.add('v2-network-active'); svg.toggleAttribute('hidden',false); lastBox = '';
    cancelAnimationFrame(frame); frame = requestAnimationFrame(follow);
    render();
  }
  function stop(): void {
    cancelRouting?.();cancelRouting=undefined;
    if (current === 'off') return;
    current = 'off'; draft = []; cursor = undefined; plan = undefined; drag = undefined; selected = -1; activeVertex = -1;
    host.map.classList.remove('v2-network-active'); svg.toggleAttribute('hidden',true); banner.hidden = true;
    cancelAnimationFrame(frame); frame = 0; svg.replaceChildren();
    render();
  }
  /** Keep the overlay's world viewBox on the live camera. */
  function follow(): void {
    if (current === 'off') return;
    const view = host.getView(), w = host.map.clientWidth || 1, h = host.map.clientHeight || 1;
    const next = `${view.cx - w / (2 * view.scale)} ${view.cy - h / (2 * view.scale)} ${w / view.scale} ${h / view.scale}`;
    if (next !== lastBox) { lastBox = next; svg.setAttribute('viewBox', next); drawOverlay(); }
    frame = requestAnimationFrame(follow);
  }
  async function finishDraft(): Promise<void> {
    const w = world();
    if (!w || draft.length < 2 || working) return;
    try {
      let path=draft,cls=drawClass,width:number|undefined;
      if(drawMethod==='auto'){
        const settings=host.getSettings?.();if(!settings)throw new Error('Road settings unavailable.');
        working=true;status=T.routing;render();
        path=await new Promise<Polyline>((resolve,reject)=>{
          const worker=new RoadRouteWorker();
          const close=()=>{worker.terminate();cancelRouting=undefined;};
          cancelRouting=()=>{close();reject(new DOMException('Cancelled','AbortError'));};
          worker.onmessage=({data})=>{close();if(data.error){reject(new Error(data.error));return;}if(ROAD_CLASS_ORDER.includes(data.cls))cls=data.cls;if(Number.isFinite(data.width)&&data.width>=.5&&data.width<=60)width=data.width;resolve(data.path);};
          worker.onerror=event=>{close();reject(new Error(event.message));};
          worker.postMessage({world:{terrain:w.terrain,mapSize:w.mapSize,seed:w.seed,options:w.options,stats:w.stats},settings,start:draft[0],end:draft[1]});
        });
        working=false;status='';if(world()!==w||current!=='draw')return;
      }
      const result = addRoad(w, path, { snap: SNAP_PX / scale(), cls, width });
      draft = []; cursor = undefined;
      await commit(result.world, translate(T.roadAdded), () => { current = 'roads'; selected = result.road ?? -1; activeVertex = -1; });
    } catch (error) { working=false;status='';if(!(error instanceof DOMException&&error.name==='AbortError')){if(drawMethod==='auto')draft=draft.slice(0,1);fail(error);}drawOverlay();render(); }
  }
  async function deletePlannedRiver(): Promise<void> {
    const w = world();
    if (!w || !plan || plan.world !== w) return;
    try {
      let next = deleteRiver(w, plan.plan.selected, { throughLakes }).world;
      const removed = plan.plan.rivers.length, settings = host.getSettings?.();
      if (settings) {
        working = true; status = T.forest; render();
        try { next = await refreshNaturalForest(next, settings); } catch (error) { console.warn('Forest refresh after the river deletion failed:', error); }
      }
      plan = undefined; working = false;
      await commit(next, fmt(T.riverDeleted, { n: removed }));
    } catch (error) { working = false; status = ''; fail(error); render(); }
  }
  /** Build the edited world from the current one, then commit it. */
  async function edit(make: (w: World) => World, message?: string, after?: (w: World) => void): Promise<void> {
    const w = world();
    if (!w || working) return;
    let next: World;
    try { next = make(w); } catch (error) { fail(error); drawOverlay(); return; }
    await commit(next, message, after);
  }

  // ---- map events (capture on the map: overlay handles are its descendants, the viewer pans on the canvas)
  const inOverlay = (target: EventTarget | null): SVGElement | undefined => {
    const node = (target as Element | null)?.closest?.('[data-role]');
    return node && svg.contains(node) ? node as SVGElement : undefined;
  };
  function onPointerDown(event: PointerEvent): void {
    if (current === 'off') return;
    downAt = { x: event.clientX, y: event.clientY }; suppressClick = false;
    const handle = inOverlay(event.target), w = world();
    if (current !== 'roads' || !w || working || event.button !== 0) return;
    const p = toWorld(event.clientX, event.clientY), start = { x: event.clientX, y: event.clientY };
    if (!handle) {
      const hit = roadAt(w, p, PICK_PX / scale());
      if (!hit) return; // empty map still pans
      selected = hit.index; activeVertex = -1;
      const path = w.roads?.[selected]?.path;
      if (!path) return;
      drag = { kind: 'road', pointer: event.pointerId, origin: p, path: path.slice(), controls: roadControlIndices(path, scale(), activeVertex), dx: 0, dy: 0, moved: false, start };
    } else {
      suppressClick = true;
      const role = handle.dataset.role, path = w.roads?.[selected]?.path;
      if (!path) return;
      if (role === 'vertex') {
        activeVertex = Number(handle.dataset.index);
        const controls = roadControlIndices(path, scale(), activeVertex), at = controls.indexOf(activeVertex);
        drag = { kind: 'vertex', pointer: event.pointerId, index: activeVertex, base: path.slice(), path: path.slice(), controls,
          left: controls[Math.max(0, at - 1)], right: controls[Math.min(controls.length - 1, at + 1)], moved: false, start };
      } else if (role === 'ghost') {
        const left = Number(handle.dataset.left), right = Number(handle.dataset.right), middle = roadControlMidpoint(path, left, right);
        const existing = Math.hypot(path[middle.segment + 1].x - middle.point.x, path[middle.segment + 1].y - middle.point.y) < 1e-6;
        const inserted = existing ? path.slice() : [...path.slice(0, middle.segment + 1), middle.point, ...path.slice(middle.segment + 1)];
        activeVertex = middle.segment + 1;
        const controls = roadControlIndices(path, scale()).map(i => !existing && i >= activeVertex ? i + 1 : i);
        if (!controls.includes(activeVertex)) controls.push(activeVertex); controls.sort((a,b)=>a-b);
        drag = { kind: 'vertex', pointer: event.pointerId, index: activeVertex, base: inserted, path: inserted, controls,
          left, right: right + (existing ? 0 : 1), moved: !existing, start };
      } else if (role === 'road') drag = { kind: 'road', pointer: event.pointerId, origin: p, path: path.slice(), controls: roadControlIndices(path, scale(), activeVertex), dx: 0, dy: 0, moved: false, start };
      else return;
    }
    event.preventDefault(); event.stopPropagation();
    try { host.map.setPointerCapture(event.pointerId); } catch { /* A synthetic pointer cannot be captured. */ }
    drawOverlay(); render();
  }
  function onPointerMove(event: PointerEvent): void {
    if (current === 'off') return;
    const p = toWorld(event.clientX, event.clientY);
    if (drag && event.pointerId === drag.pointer) {
      if (Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) > 2) drag.moved = true;
      if (drag.kind === 'vertex') drag.path = deformRoadControl(drag.base, drag.index, drag.left, drag.right, p);
      else { drag.dx = p.x - drag.origin.x; drag.dy = p.y - drag.origin.y; }
      event.stopPropagation(); drawOverlay(); return;
    }
    if (current === 'draw') { cursor = p; drawOverlay(); }
  }
  function onPointerUp(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointer) return;
    const done = drag, index = selected; drag = undefined;
    try { host.map.releasePointerCapture(event.pointerId); } catch { /* Already released. */ }
    event.stopPropagation();
    if (event.type === 'pointercancel' || !done.moved || index < 0) { drawOverlay(); render(); return; }
    const snap = SNAP_PX / scale(), path = done.kind === 'vertex' ? done.path : translatePath(done.path, done.dx, done.dy);
    void edit(source => setRoadPath(source, index, path, { snap }).world);
  }
  function onClick(event: MouseEvent): void {
    if (current === 'off') return;
    // The map's own selection (inspector, placement) must not react while a network tool is active.
    event.stopPropagation();
    if (suppressClick) { suppressClick = false; return; }
    const moved = downAt && Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > CLICK_PX;
    const handle = inOverlay(event.target), w = world();
    if (moved || !w || working || host.busy?.()) return;
    const p = toWorld(event.clientX, event.clientY), tolerance = PICK_PX / scale();
    if (current === 'draw') {
      const last = draft[draft.length - 1];
      if (handle?.dataset.role === 'draw-last' || (last && draft.length >= 2 && Math.hypot(last.x - p.x, last.y - p.y) <= tolerance)) { void finishDraft(); return; }
      draft.push(snapTarget(w,p)??p); drawOverlay(); render();if(drawMethod==='auto'&&draft.length===2)void finishDraft();return;
    }
    if (current === 'roads') {
      if (handle) return;
      const hit = roadAt(w, p, tolerance);
      selected = hit ? hit.index : -1; activeVertex = -1; drawOverlay(); render(); return;
    }
    if (current === 'rivers') {
      const hit = riverAt(w, p, tolerance);
      if (!hit) { plan = undefined; drawOverlay(); render(); return; }
      try { plan = { world: w, plan: planRiverDeletion(w, hit.index, { throughLakes }) }; } catch (error) { plan = undefined; fail(error); }
      drawOverlay(); render();
    }
  }
  function onDoubleClick(event: MouseEvent): void {
    if (current === 'off') return;
    // No zoom on a double click while drawing or reshaping: those clicks are edits.
    event.stopPropagation(); event.preventDefault();
    const handle = inOverlay(event.target), w = world();
    if (current === 'roads' && handle?.dataset.role === 'vertex' && w && selected >= 0) {
      const index = selected, path = w.roads?.[index]?.path, vertex = Number(handle.dataset.index);
      if (path && path.length > 2 && vertex > 0 && vertex < path.length - 1) { activeVertex = -1; void edit(source => setRoadPath(source, index, removeRoadControl(path, roadControlIndices(path, scale(), vertex), vertex), { snap: SNAP_PX / scale() }).world); }
    }
  }
  function onKey(event: KeyboardEvent): void {
    if (current === 'off') return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (event.key === 'Escape') {
      stop(); event.preventDefault();
    } else if (event.key === 'Enter' && current === 'draw') { void finishDraft(); event.preventDefault(); }
    else if ((event.key === 'Delete' || event.key === 'Backspace') && current === 'roads' && selected >= 0 && activeVertex >= 0) { removeActiveVertex(); event.preventDefault(); }
  }
  function removeActiveVertex(): void {
    const road = selected, path = world()?.roads?.[road]?.path, vertex = activeVertex;
    if (!path || path.length <= 2 || vertex <= 0 || vertex >= path.length - 1) return;
    activeVertex = -1;
    void edit(source => setRoadPath(source, road, removeRoadControl(path, roadControlIndices(path, scale(), vertex), vertex), { snap: SNAP_PX / scale() }).world);
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
  const onMode = (event: Event): void => { if ((event as CustomEvent<string>).detail !== modeToken) stop(); };
  window.addEventListener('v2-edit-mode', onMode);

  // ---- overlay drawing (world coordinates; non-scaling strokes keep pixel widths)
  function line(path: readonly Vec2[], stroke: string, width: number, extra: Record<string, string | number> = {}): SVGElement {
    return svgEl('path', { d: pathData(path), fill: 'none', stroke, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke', ...extra });
  }
  function dot(p: Vec2, px: number, fill: string, stroke: string, extra: Record<string, string | number> = {}): SVGElement {
    return svgEl('circle', { cx: p.x, cy: p.y, r: px / scale(), fill, stroke, 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke', ...extra });
  }
  function drawOverlay(): void {
    if (current === 'off') return;
    const w = world(), nodes: SVGElement[] = [];
    if (w && (current === 'roads' || current === 'draw')) for (const j of junctions(w)) nodes.push(dot(j.point, j.site ? 3.5 : 2.5, j.site ? GOLD : PAPER, INK, { opacity: .75 }));
    if (w && current === 'roads' && selected >= 0) {
      const road = w.roads?.[selected];
      if (road) {
        let path = road.path;
        if (drag?.kind === 'vertex') path = drag.path;
        else if (drag?.kind === 'road') path = translatePath(drag.path, drag.dx, drag.dy);
        nodes.push(line(path, INK, Math.max(7, road.width * scale() + 4), { opacity: .45 }), line(path, GOLD, Math.max(3, road.width * scale())));
        nodes.push(line(path, 'transparent', 16, { 'data-role': 'road' }));
        const controls = drag ? drag.controls : roadControlIndices(path, scale(), activeVertex);
        for (let i=1;i<controls.length;i++) {
          const left=controls[i-1],right=controls[i],middle=roadControlMidpoint(path,left,right);
          if(middle.length*scale()>48) nodes.push(dot(middle.point,3.5,'#dcb86fcc',INK,{'data-role':'ghost','data-left':left,'data-right':right}));
        }
        for (const i of controls) nodes.push(dot(path[i], i === 0 || i === path.length - 1 ? 6 : 5, i === activeVertex ? GOLD : PAPER, '#8a6a2c', { 'data-role': 'vertex', 'data-index': i }));
      }
    }
    if (w && current === 'draw') {
      const preview = cursor && draft.length ? [...draft, cursor] : draft;
      if (preview.length > 1) nodes.push(line(preview, INK, 6, { opacity: .4 }), line(preview, GOLD, 3, { 'stroke-dasharray': cursor ? '6 4' : 'none' }));
      draft.forEach((p, i) => nodes.push(dot(p, i === draft.length - 1 && draft.length >= 2 ? 7 : 4.5, i === draft.length - 1 ? GOLD : PAPER, '#8a6a2c', i === draft.length - 1 && draft.length >= 2 ? { 'data-role': 'draw-last' } : {})));
      const target = cursor && snapTarget(w, cursor);
      if (target) nodes.push(dot(target, 9, 'none', GOLD, { 'stroke-width': 2 }));
    }
    if (w && current === 'rivers' && plan?.world === w) {
      for (const index of plan.plan.rivers) {
        const river = w.terrain.rivers[index];
        if (!river) continue;
        nodes.push(line(river.path, INK, index === plan.plan.selected ? 9 : 6, { opacity: .35 }), line(river.path, DANGER, index === plan.plan.selected ? 5 : 3, index === plan.plan.selected ? {} : { 'stroke-dasharray': '5 3' }));
      }
    }
    svg.replaceChildren(...nodes);
  }

  // ---- panel
  function button(text: string, action: () => void, options: { primary?: boolean; danger?: boolean; disabled?: boolean } = {}): HTMLButtonElement {
    const b = el('button'); b.type = 'button'; setText(b, text); b.onclick = action;
    if (options.primary) b.classList.add('primary');
    if (options.danger) b.classList.add('danger');
    b.disabled = !!options.disabled || working; return b;
  }
  function classSelect(value: RoadClass, onChange: (cls: RoadClass) => void): HTMLLabelElement {
    const label = el('label'), caption = el('span'), select = el('select');
    setText(caption, T.cls);
    for (const cls of ROAD_CLASS_ORDER) select.add(new Option(translate(CLASS_LABEL[cls]), cls));
    select.value = value; select.disabled = working; select.onchange = () => onChange(select.value as RoadClass);
    label.append(caption, select); return label;
  }
  function render(): void {
    const w = world(), busy = !!host.busy?.();
    for (const b of quickButtons) { b.setAttribute('aria-pressed', String(current === b.dataset.networkQuick)); b.disabled = busy || working || !w; }
    for (const b of toolButtons) { b.setAttribute('aria-pressed', String(current === b.dataset.networkTool)); b.disabled = busy || working || !w; }
    setText(hint, current === 'roads' ? T.roadsHint : current === 'draw' ? drawMethod==='auto'?T.autoHint:T.drawHint : current === 'rivers' ? T.riversHint : T.idle);
    detail.replaceChildren();
    banner.hidden = current === 'off' || !(status || current === 'roads' || current === 'draw' || (current === 'rivers' && !plan));
    banner.textContent = status ? translate(status) : current === 'roads' ? translate(T.roadsHint) : current === 'draw' ? translate(drawMethod==='auto'?T.autoHint:T.drawHint) : translate(T.riversHint);
    if (!w || current === 'off') return;
    if (current === 'roads' && selected >= 0 && w.roads?.[selected]) {
      const road = w.roads[selected], title = el('strong'), info = el('span', 'hint');
      title.textContent = fmt(T.road, { n: selected + 1 });
      info.textContent = fmt(T.roadInfo, { km: Math.round(polylineLength(road.path) / 10) / 100, points: roadControlIndices(road.path, scale(), activeVertex).length });
      const width = el('label'), widthCaption = el('span'), widthInput = el('input');
      setText(widthCaption, T.width); widthInput.type = 'number'; widthInput.min = '0.5'; widthInput.max = '60'; widthInput.step = '0.5';
      widthInput.value = String(Math.round(road.width * 10) / 10); widthInput.disabled = working;
      const index = selected;
      widthInput.onchange = () => { const value = widthInput.valueAsNumber; if (Number.isFinite(value) && value > 0) void edit(source => setRoadClass(source, index, roadClassOf(source, index), value).world); };
      width.append(widthCaption, widthInput);
      const row = el('div', 'v2-network-row');
      row.append(button(T.removePoint, removeActiveVertex, { disabled: activeVertex <= 0 || activeVertex >= road.path.length - 1 }),
        button(T.deselect, () => { selected = -1; activeVertex = -1; drawOverlay(); render(); }),
        button(T.deleteRoad, () => void edit(source => deleteRoad(source, index).world, translate(T.roadDeleted), () => { selected = -1; activeVertex = -1; }), { danger: true }));
      detail.append(title, info, classSelect(roadClassOf(w, index), cls => void edit(source => setRoadClass(source, index, cls).world)), width, row);
    } else if (current === 'draw') {
      const method=el('label'),caption=el('span'),select=el('select');setText(caption,T.method);
      for(const [value,text]of [['auto',T.auto],['free',T.free]])select.add(new Option(translate(text),value));
      select.value=drawMethod;select.disabled=working;select.dataset.routeMethod='';
      select.onchange=()=>{drawMethod=select.value as typeof drawMethod;draft=[];cursor=undefined;drawOverlay();render();};method.append(caption,select);
      const count = el('span', 'hint'); count.textContent = fmt(T.points, { n: draft.length });
      const row = el('div', 'v2-network-row');
      const cancel=button(T.cancel,()=>{if(cancelRouting){stop();return;}draft=[];drawOverlay();render();});cancel.disabled=working?!cancelRouting:!draft.length;
      row.append(button(T.finish, () => void finishDraft(), { primary: true, disabled: draft.length < 2 }),cancel);
      detail.append(method,...(drawMethod==='free'?[classSelect(drawClass, cls => { drawClass = cls; })]:[]), count, row);
    } else if (current === 'rivers' && plan?.world === w) {
      const river = w.terrain.rivers[plan.plan.selected], name = river?.name || translate(T.aRiver), extra = plan.plan.rivers.length - 1;
      const summary = el('strong'); summary.textContent = extra > 0 ? fmt(T.riverPlan, { name, n: extra }) : fmt(T.riverOnly, { name });
      const row = el('div', 'v2-network-row');
      row.append(button(T.deleteRiver, () => void deletePlannedRiver(), { primary: true }), button(T.cancel, () => { plan = undefined; drawOverlay(); render(); }));
      detail.append(summary, row);
    }
  }
  function sync(): void {
    const w = world();
    if (!w) { stop(); render(); return; }
    if (selected >= (w.roads?.length ?? 0)) { selected = -1; activeVertex = -1; }
    if (plan && plan.world !== w) plan = undefined;
    if (current !== 'off') drawOverlay();
    render();
  }
  const offLanguage = onLanguageChange(() => { svg.setAttribute('aria-label', translate(T.overlay)); render(); });
  render();
  return {
    sync, start, stop, active: () => current !== 'off', tool: () => current, toWorld,
    destroy() {
      stop(); offLanguage();
      host.map.removeEventListener('pointerdown', onPointerDown, true); host.map.removeEventListener('pointermove', onPointerMove, true);
      host.map.removeEventListener('pointerup', onPointerUp, true); host.map.removeEventListener('pointercancel', onPointerUp, true);
      host.map.removeEventListener('click', onClick, true); host.map.removeEventListener('dblclick', onDoubleClick, true);
      window.removeEventListener('keydown', onKey); window.removeEventListener('v2-edit-mode', onMode);
      svg.remove(); banner.remove(); shortcuts?.remove(); box.remove();
    },
  };
}
/** Language of the default copy, for hosts that build their own entry button. */
export const networkEditorLabel = (): string => getLanguage() === 'fr' ? 'Réseau régional' : 'Regional network';
