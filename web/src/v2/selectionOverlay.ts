import type { View } from '../render/view';
import type { Vec2 } from '../gen/types';

/** A screen-width outline, kept aligned while the map pans and zooms. */
export function createSelectionOverlay(map: HTMLElement, getView: () => View) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'), halo = document.createElementNS(ns, 'path'), path = document.createElementNS(ns, 'path');
  svg.dataset.urbanSelection = ''; svg.setAttribute('aria-hidden', 'true');
  Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '11' });
  for (const stroke of [halo, path]) { stroke.setAttribute('fill', 'none'); stroke.setAttribute('vector-effect', 'non-scaling-stroke'); stroke.setAttribute('stroke-linejoin', 'round'); }
  halo.setAttribute('stroke', '#fff'); halo.setAttribute('stroke-width', '5');
  path.setAttribute('stroke', '#e52b36'); path.setAttribute('stroke-width', '2.5');
  svg.append(halo, path); map.append(svg); svg.style.display = 'none';
  const caption = document.createElement('div'); caption.className = 'urban-selection-name'; caption.dataset.l10nKeep = '';
  Object.assign(caption.style, { position: 'absolute', pointerEvents: 'none', zIndex: '12', transform: 'translate(-50%, -100%)', background: '#fff9ed', color: '#9f1c25', border: '1px solid #e52b36', borderRadius: '4px', padding: '4px 7px', fontSize: '12px', maxWidth: '240px' });
  caption.hidden = true; map.append(caption);
  let frame = 0, anchor: Vec2 | undefined;
  function update(): void {
    const view = getView(), w = map.clientWidth, h = map.clientHeight;
    svg.setAttribute('viewBox', `${view.cx - w / (2 * view.scale)} ${view.cy - h / (2 * view.scale)} ${w / view.scale} ${h / view.scale}`);
    if (anchor) { caption.style.left = `${w / 2 + (anchor.x - view.cx) * view.scale}px`; caption.style.top = `${h / 2 + (anchor.y - view.cy) * view.scale - 10}px`; }
    frame = requestAnimationFrame(update);
  }
  return { set(rings?: readonly (readonly Vec2[])[], name?: string): void {
    cancelAnimationFrame(frame);
    svg.style.display = rings?.length ? '' : 'none';
    const d = (rings ?? []).filter(ring => ring.length >= 3).map(ring => `M${ring.map(p => `${p.x},${p.y}`).join('L')}Z`).join('');
    halo.setAttribute('d', d); path.setAttribute('d', d);
    const ring = rings?.[0]; anchor = ring?.length ? ring.reduce((sum,p) => ({ x: sum.x + p.x / ring.length, y: sum.y + p.y / ring.length }), { x: 0, y: 0 }) : undefined;
    caption.textContent = name ?? ''; caption.hidden = !name || !anchor;
    if (rings?.length) update();
  } };
}
