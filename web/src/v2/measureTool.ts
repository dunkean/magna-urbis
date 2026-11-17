import type { View } from '../render/view';
import { screenToWorld, worldToScreen } from '../render/view';
import { sampleGrid, type Grid } from '../gen/core/grid';
import { registerMessages, setText, numberLocale } from './i18n';
import { formatDistance, getDistanceUnit, onUnitsChange } from './units';
import './measureTool.css';

registerMessages({
  'Measure': { en: 'Measure', fr: 'Mesurer' },
  'Measure distances: click to add points, drag a point to move it, click a point to remove it. Backspace removes the last point, Escape clears.': {
    en: 'Measure distances: click to add points, drag a point to move it, click a point to remove it. Backspace removes the last point, Escape clears.',
    fr: 'Mesurer des distances : cliquez pour ajouter des points, faites glisser un point pour le déplacer, cliquez sur un point pour le retirer. Retour arrière retire le dernier point, Échap efface.',
  },
  'Click on the map to start measuring': { en: 'Click on the map to start measuring', fr: 'Cliquez sur la carte pour commencer à mesurer' },
  'Clear': { en: 'Clear', fr: 'Effacer' },
  'Total distance': { en: 'Total distance', fr: 'Distance totale' },
});

interface Point { x: number; y: number }
export interface MeasureToolApi {
  /** The interactive map container (same element the viewer listens on). */
  map: HTMLElement;
  canvas: HTMLCanvasElement;
  /** Where the toolbar button goes. */
  slot: HTMLElement;
  /** Element that receives the X / Y / Z readout under the cursor. */
  readout: HTMLElement;
  getView(): View;
  getHeight(): Grid | undefined;
  getMapSize(): number | undefined;
}

const RULER_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M3 16.5 16.5 3 21 7.5 7.5 21z"/><path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="m7 12.5 2 2M9.5 10l1.5 1.5M12 7.5l2 2M14.5 5l1.5 1.5"/></svg>';
const CLICK_SLOP_PX = 5;

/** Google-Maps-like multi-point ruler on the 2D map, plus the X / Y / Z cursor readout. */
export function mountMeasureTool(api: MeasureToolApi): { deactivate(): void } {
  const { map, canvas } = api;
  const ns = 'http://www.w3.org/2000/svg';
  const button = document.createElement('button');
  button.type = 'button'; button.id = 'measure-tool'; button.className = 'measure-tool-button'; button.setAttribute('aria-pressed', 'false');
  button.innerHTML = `${RULER_ICON}<span></span>`;
  setText(button.querySelector('span')!, 'Measure');
  button.title = 'Measure distances: click to add points, drag a point to move it, click a point to remove it. Backspace removes the last point, Escape clears.';
  api.slot.append(button);

  const svg = document.createElementNS(ns, 'svg');
  svg.classList.add('measure-overlay'); svg.setAttribute('aria-hidden', 'true');
  const halo = document.createElementNS(ns, 'polyline'), line = document.createElementNS(ns, 'polyline');
  const previewHalo = document.createElementNS(ns, 'line'), preview = document.createElementNS(ns, 'line');
  halo.classList.add('measure-halo'); line.classList.add('measure-line');
  previewHalo.classList.add('measure-halo'); preview.classList.add('measure-line', 'measure-preview');
  const vertices = document.createElementNS(ns, 'g');
  svg.append(halo, previewHalo, line, preview, vertices);
  const label = document.createElement('div');
  label.className = 'measure-label'; label.dataset.l10nKeep = '';
  const panel = document.createElement('div');
  panel.className = 'measure-panel glass';
  panel.innerHTML = '<span class="measure-panel-title"></span><strong class="measure-panel-total" data-l10n-keep></strong><button type="button" class="quiet small measure-clear"></button>';
  setText(panel.querySelector('.measure-panel-title')!, 'Total distance');
  setText(panel.querySelector('.measure-clear')!, 'Clear');
  map.append(svg, label, panel);

  const points: Point[] = [];
  let active = false, cursor: Point | undefined, frame = 0;
  let press: { id: number; x: number; y: number } | undefined;
  let drag: { index: number; moved: boolean; x: number; y: number } | undefined;

  const local = (e: MouseEvent): Point => { const r = map.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const toWorld = (p: Point): Point => { const [x, y] = screenToWorld(api.getView(), map.clientWidth, map.clientHeight, p.x, p.y); return { x, y }; };
  const inside = (p: Point): boolean => { const size = api.getMapSize(); return size !== undefined && p.x >= 0 && p.y >= 0 && p.x <= size && p.y <= size; };
  const length = (list: readonly Point[]): number => list.reduce((sum, p, i) => i ? sum + Math.hypot(p.x - list[i - 1].x, p.y - list[i - 1].y) : 0, 0);
  const fmt = (metres: number): string => formatDistance(metres, getDistanceUnit(), numberLocale());

  function draw(): void {
    frame = 0;
    const view = api.getView(), w = map.clientWidth, h = map.clientHeight;
    const screen = points.map(p => worldToScreen(view, w, h, p.x, p.y));
    const attr = screen.map(([x, y]) => `${x},${y}`).join(' ');
    halo.setAttribute('points', attr); line.setAttribute('points', attr);
    while (vertices.childElementCount > screen.length) vertices.lastElementChild!.remove();
    while (vertices.childElementCount < screen.length) {
      const dot = document.createElementNS(ns, 'circle'); dot.classList.add('measure-vertex'); dot.setAttribute('r', '5'); vertices.append(dot);
    }
    screen.forEach(([x, y], i) => {
      const dot = vertices.children[i] as SVGCircleElement;
      dot.setAttribute('cx', String(x)); dot.setAttribute('cy', String(y)); dot.dataset.index = String(i);
      dot.classList.toggle('measure-vertex-first', i === 0);
    });
    const tail = points.at(-1), hover = active && !drag && cursor && tail ? cursor : undefined;
    for (const el of [preview, previewHalo]) el.style.display = hover ? '' : 'none';
    if (hover && tail) {
      const [ax, ay] = worldToScreen(view, w, h, tail.x, tail.y), [bx, by] = worldToScreen(view, w, h, hover.x, hover.y);
      for (const el of [preview, previewHalo]) { el.setAttribute('x1', String(ax)); el.setAttribute('y1', String(ay)); el.setAttribute('x2', String(bx)); el.setAttribute('y2', String(by)); }
    }
    const total = length(points);
    const anchor = hover ?? tail;
    label.hidden = !anchor;
    if (anchor) {
      const [x, y] = worldToScreen(view, w, h, anchor.x, anchor.y);
      label.style.left = `${x}px`; label.style.top = `${y}px`;
      label.textContent = hover && tail ? fmt(total + Math.hypot(hover.x - tail.x, hover.y - tail.y)) : fmt(total);
      if (!hover && points.length < 2) label.hidden = true;
    }
    const totalEl = panel.querySelector('.measure-panel-total')!;
    if (points.length) totalEl.textContent = fmt(total); else setText(totalEl, 'Click on the map to start measuring');
    if (active || points.length) frame = requestAnimationFrame(draw);
  }
  const schedule = (): void => { if (!frame) frame = requestAnimationFrame(draw); };

  function setActive(next: boolean): void {
    if (active === next) return;
    active = next;
    button.setAttribute('aria-pressed', String(active));
    map.classList.toggle('measuring', active);
    if (!active) { points.length = 0; cursor = undefined; drag = undefined; }
    svg.style.display = active ? '' : 'none'; panel.hidden = !active; label.hidden = !active;
    if (active) { window.dispatchEvent(new CustomEvent('v2-edit-mode', { detail: 'navigate' })); schedule(); }
    else { cancelAnimationFrame(frame); frame = 0; }
  }
  setActive(false); svg.style.display = 'none'; panel.hidden = true; label.hidden = true;

  button.onclick = () => setActive(!active);
  panel.querySelector<HTMLButtonElement>('.measure-clear')!.onclick = () => { points.length = 0; schedule(); };
  // Any other editing tool or the 3D view ends the measurement.
  window.addEventListener('v2-edit-mode', event => { if ((event as CustomEvent<string>).detail !== 'navigate') setActive(false); });
  window.addEventListener('keydown', event => {
    if (!active || document.querySelector('dialog[open]')) return;
    const t = event.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (event.key === 'Escape') { if (points.length) { points.length = 0; schedule(); } else setActive(false); }
    else if (event.key === 'Backspace' || event.key === 'Delete') { points.pop(); event.preventDefault(); schedule(); }
  });

  // Plain click on the map adds a point; a drag still pans.
  canvas.addEventListener('pointerdown', e => { if (active && e.button === 0 && e.isPrimary) { const p = local(e); press = { id: e.pointerId, ...p }; } });
  canvas.addEventListener('pointerup', e => {
    const start = press; press = undefined;
    if (!active || !start || start.id !== e.pointerId) return;
    const p = local(e);
    if (Math.hypot(p.x - start.x, p.y - start.y) > CLICK_SLOP_PX) return;
    const world = toWorld(p);
    if (!inside(world)) return;
    const tail = points.at(-1);
    if (tail) { const [tx, ty] = worldToScreen(api.getView(), map.clientWidth, map.clientHeight, tail.x, tail.y); if (Math.hypot(tx - p.x, ty - p.y) < 3) return; }
    points.push(world); schedule();
  });
  canvas.addEventListener('pointercancel', () => { press = undefined; });
  // Double-click zoom would fight the second click of a fast pair of points.
  map.addEventListener('dblclick', e => { if (active) e.stopPropagation(); }, true);

  // Vertices: drag to move, click to remove.
  vertices.addEventListener('pointerdown', e => {
    const dot = (e.target as Element).closest<SVGCircleElement>('.measure-vertex');
    if (!dot || e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    dot.setPointerCapture(e.pointerId);
    const p = local(e); drag = { index: Number(dot.dataset.index), moved: false, ...p };
  });
  vertices.addEventListener('pointermove', e => {
    if (!drag) return;
    const p = local(e);
    if (!drag.moved && Math.hypot(p.x - drag.x, p.y - drag.y) <= CLICK_SLOP_PX) return;
    drag.moved = true;
    const world = toWorld(p); if (inside(world)) points[drag.index] = world;
    schedule();
  });
  const release = (e: PointerEvent): void => {
    if (!drag) return;
    if (!drag.moved && e.type === 'pointerup') points.splice(drag.index, 1);
    drag = undefined; schedule();
  };
  vertices.addEventListener('pointerup', release);
  vertices.addEventListener('pointercancel', release);

  // Coordinates stay in metres: XY to the metre, altitude to a tenth.
  api.readout.classList.add('cursor-readout'); api.readout.dataset.l10nKeep = '';
  api.readout.innerHTML = '<span>X <b data-axis="x">—</b></span><span>Y <b data-axis="y">—</b></span><span>Z <b data-axis="z">—</b></span>';
  const cells = { x: api.readout.querySelector('[data-axis="x"]')!, y: api.readout.querySelector('[data-axis="y"]')!, z: api.readout.querySelector('[data-axis="z"]')! };
  let last: Point | undefined;
  function showReadout(p?: Point): void {
    last = p;
    const n = (metres: number, decimals = 0): string => `${metres.toLocaleString(numberLocale(), { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} m`;
    const height = api.getHeight();
    const ok = !!p && inside(p);
    cells.x.textContent = ok ? n(p!.x) : '—';
    cells.y.textContent = ok ? n(p!.y) : '—';
    cells.z.textContent = ok && height ? n(sampleGrid(height, p!.x, p!.y), 1) : '—';
  }
  map.addEventListener('pointermove', e => {
    const p = toWorld(local(e));
    showReadout(p);
    if (active) { cursor = (e.target as Element).closest('.measure-panel') ? undefined : p; if (drag || !(e.buttons & 1)) schedule(); }
  });
  map.addEventListener('pointerleave', () => { showReadout(undefined); cursor = undefined; schedule(); });
  onUnitsChange(() => { showReadout(last); schedule(); });
  return { deactivate: () => setActive(false) };
}
