import type { View } from '../render/view';
import type { ScreenProjection } from '../render/world/camera';
import type { Vec2 } from '../gen/types';

/** A screen-width outline, kept aligned while the map pans and zooms. In the top view the SVG's view box follows the
 * view (no point is moved); in a tilted view (`projection().tilted`) the rings are projected onto the relief again
 * whenever the projection changes, a point behind the eye breaking its ring. `highlight` tints the volume of a selected
 * building in the tilted view (its volume id), cleared by every other selection. */
export function createSelectionOverlay(map: HTMLElement, getView: () => View, projection: () => ScreenProjection, highlight: (volume: string | undefined) => void) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'),
    halo = document.createElementNS(ns, 'path'),
    path = document.createElementNS(ns, 'path');
  svg.dataset.urbanSelection = '';
  svg.setAttribute('aria-hidden', 'true');
  Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '11' });
  for (const stroke of [halo, path]) {
    stroke.setAttribute('fill', 'none');
    stroke.setAttribute('vector-effect', 'non-scaling-stroke');
    stroke.setAttribute('stroke-linejoin', 'round');
  }
  halo.setAttribute('stroke', '#fff');
  halo.setAttribute('stroke-width', '5');
  path.setAttribute('stroke', '#e52b36');
  path.setAttribute('stroke-width', '2.5');
  svg.append(halo, path);
  map.append(svg);
  svg.style.display = 'none';
  const caption = document.createElement('div');
  caption.className = 'urban-selection-name';
  caption.dataset.l10nKeep = '';
  Object.assign(caption.style, { position: 'absolute', pointerEvents: 'none', zIndex: '12', transform: 'translate(-50%, -100%)', background: '#fff9ed', color: '#9f1c25', border: '1px solid #e52b36', borderRadius: '4px', padding: '4px 7px', fontSize: '12px', maxWidth: '240px' });
  caption.hidden = true;
  map.append(caption);
  let frame = 0,
    anchor: Vec2 | undefined,
    shown: readonly (readonly Vec2[])[] = [],
    /** The path of the rings in world metres (top view), and the projection the screen path was last made for. */
    worldPath = '',
    projected: ScreenProjection | undefined,
    named = false;
  const at: [number, number] = [0, 0];
  const setPath = (d: string): void => {
    halo.setAttribute('d', d);
    path.setAttribute('d', d);
  };
  function update(): void {
    const view = getView(),
      w = map.clientWidth,
      h = map.clientHeight,
      current = projection();
    if (!current.tilted) {
      if (projected) {
        projected = undefined;
        setPath(worldPath);
        caption.hidden = !named || !anchor;
      }
      svg.setAttribute('viewBox', `${view.cx - w / (2 * view.scale)} ${view.cy - h / (2 * view.scale)} ${w / view.scale} ${h / view.scale}`);
      if (anchor) {
        caption.style.left = `${w / 2 + (anchor.x - view.cx) * view.scale}px`;
        caption.style.top = `${h / 2 + (anchor.y - view.cy) * view.scale - 10}px`;
      }
    } else if (current !== projected) {
      projected = current;
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      let d = '';
      for (const ring of shown) {
        let open = false;
        for (const p of ring) {
          if (!current.project(p.x, p.y, at)) {
            open = false;
            continue;
          }
          d += `${open ? 'L' : 'M'}${at[0].toFixed(1)},${at[1].toFixed(1)}`;
          open = true;
        }
        if (open && ring.length && current.project(ring[0].x, ring[0].y, at)) d += 'Z';
      }
      setPath(d);
      const visible = !!anchor && current.project(anchor.x, anchor.y, at);
      caption.hidden = !named || !visible;
      if (visible) {
        caption.style.left = `${at[0]}px`;
        caption.style.top = `${at[1] - 10}px`;
      }
    }
    frame = requestAnimationFrame(update);
  }
  return {
    /** Outlines `rings` with an optional caption; `volume`: the volume id of the building selected, if any. */
    set(rings?: readonly (readonly Vec2[])[], name?: string, volume?: string): void {
      cancelAnimationFrame(frame);
      highlight(volume);
      svg.style.display = rings?.length ? '' : 'none';
      shown = (rings ?? []).filter(ring => ring.length >= 3);
      worldPath = shown.map(ring => `M${ring.map(p => `${p.x},${p.y}`).join('L')}Z`).join('');
      projected = undefined;
      setPath(worldPath);
      const ring = rings?.[0];
      anchor = ring?.length ? ring.reduce((sum, p) => ({ x: sum.x + p.x / ring.length, y: sum.y + p.y / ring.length }), { x: 0, y: 0 }) : undefined;
      caption.textContent = name ?? '';
      named = !!name;
      caption.hidden = !name || !anchor;
      if (rings?.length) update();
    },
  };
}
