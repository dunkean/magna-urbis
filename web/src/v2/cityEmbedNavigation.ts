/** Pointer and keyboard navigation for the two preview phases. */
import { panBy, zoomAt, type View } from '../render/view';

const MAX_ZOOM = 36;

export function mountCityEmbedNavigation(host: HTMLElement, draw: () => void, enabled: () => boolean) {
  let camera: View = { cx: 0, cy: 0, scale: 1 };
  const controller = new AbortController(),
    signal = controller.signal;
  const pointers = new Map<number, { x: number; y: number }>();
  const changed = () => {
    host.dataset.zoom = String(camera.scale);
    host.dataset.panX = String(camera.cx);
    host.dataset.panY = String(camera.cy);
    draw();
  };
  const size = () => host.getBoundingClientRect();
  const zoom = (factor: number, x = host.clientWidth / 2, y = host.clientHeight / 2) => {
    const scale = Math.min(MAX_ZOOM, Math.max(0.5, camera.scale * factor));
    if (scale === camera.scale) return;
    camera = zoomAt(camera, scale / camera.scale, x, y, host.clientWidth, host.clientHeight);
    changed();
  };
  const position = (event: { clientX: number; clientY: number }) => {
    const r = size();
    return { x: event.clientX - r.left, y: event.clientY - r.top };
  };
  host.addEventListener(
    'wheel',
    event => {
      if (!enabled()) return;
      event.preventDefault();
      const p = position(event),
        delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.clientHeight : 1);
      zoom(Math.exp(-Math.min(500, Math.max(-500, delta)) * 0.002), p.x, p.y);
    },
    { passive: false, signal },
  );
  host.addEventListener(
    'dblclick',
    event => {
      if (enabled()) {
        event.preventDefault();
        const p = position(event);
        zoom(2, p.x, p.y);
      }
    },
    { signal },
  );
  host.addEventListener(
    'pointerdown',
    event => {
      if (!enabled() || event.button !== 0) return;
      event.preventDefault();
      host.focus({ preventScroll: true });
      host.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, position(event));
      host.classList.add('dragging');
    },
    { signal },
  );
  host.addEventListener(
    'pointermove',
    event => {
      if (!pointers.has(event.pointerId)) return;
      const before = [...pointers.values()],
        old = pointers.get(event.pointerId)!;
      const next = position(event);
      pointers.set(event.pointerId, next);
      if (pointers.size === 1) camera = panBy(camera, next.x - old.x, next.y - old.y);
      else {
        const after = [...pointers.values()];
        const distance = (points: typeof before) => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
        const middle = (points: typeof before) => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
        const a = middle(before),
          b = middle(after),
          previousDistance = distance(before);
        if (previousDistance > 1) zoom(distance(after) / previousDistance, a.x, a.y);
        camera = panBy(camera, b.x - a.x, b.y - a.y);
      }
      changed();
    },
    { signal },
  );
  const release = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (!pointers.size) host.classList.remove('dragging');
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) host.addEventListener(type, release, { signal });
  const reset = () => {
    camera = { cx: 0, cy: 0, scale: 1 };
    changed();
  };
  host.addEventListener(
    'keydown',
    event => {
      if (!enabled()) return;
      if (event.key === '+' || event.key === '=') zoom(1.5);
      else if (event.key === '-') zoom(1 / 1.5);
      else if (event.key === '0' || event.key === 'Home') reset();
      else if (event.key.startsWith('Arrow')) {
        const delta: Record<string, [number, number]> = { ArrowLeft: [50, 0], ArrowRight: [-50, 0], ArrowUp: [0, 50], ArrowDown: [0, -50] };
        const step = delta[event.key];
        if (!step) return;
        camera = panBy(camera, ...step);
        changed();
      } else return;
      event.preventDefault();
    },
    { signal },
  );
  changed();
  return {
    zoom,
    reset,
    camera: () => ({ ...camera }),
    restore: (saved: View) => {
      camera = { ...saved };
      changed();
    },
    view: (base: View): View => ({ cx: base.cx + camera.cx / base.scale, cy: base.cy + camera.cy / base.scale, scale: base.scale * camera.scale }),
    dispose: () => controller.abort(),
  };
}
