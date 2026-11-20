/** Pointer, wheel, keyboard and minimap gestures installed by createViewer. Translates input into viewerNavigation commands. */
import { WHEEL_STRIDE_S, type ViewerNavigation } from './viewerNavigation';
const WHEEL_NOTCH_PX = 40,
  DRAG_PITCH = 0.006,
  DRAG_YAW = 0.008,
  WHEEL_PITCH = 0.003,
  KEY_PITCH = Math.PI / 18,
  KEY_YAW = Math.PI / 12;
const MOVE_KEYS = new Set(['KeyW', 'KeyZ', 'KeyS', 'KeyA', 'KeyQ', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']),
  FLY_KEYS = new Set(['Space', 'KeyE', 'KeyC']);
const SLIDE_STRIDE = 0.04,
  GESTURE_TRAVEL = 8;
type TwoFingers = { d: number; mode: 'undecided' | 'pinch' | 'tilt'; starts: Map<number, { x: number; y: number }> };
export function installViewerInput(container: HTMLElement, canvas: HTMLCanvasElement, minimap: HTMLCanvasElement | undefined, nav: ViewerNavigation): () => void {
  const pts = new Map<number, { x: number; y: number }>();
  let pinch: TwoFingers | null = null;
  /** The one pointer down turns and tilts the camera instead of panning. */
  let orbiting = false;
  const local = (e: PointerEvent | WheelEvent | MouseEvent): { x: number; y: number } => {
    const r = container.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const dist = (): number => {
    const [a, b] = [...pts.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const mid = (): { x: number; y: number } => {
    const [a, b] = [...pts.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  canvas.addEventListener('pointerdown', e => {
    pts.set(e.pointerId, local(e));
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('drag');
    orbiting = pts.size === 1 && (e.button === 2 || e.ctrlKey) && nav.tilts();
    if (pts.size === 2) pinch = { d: dist(), mode: nav.tilts() ? 'undecided' : 'pinch', starts: new Map(pts) };
    if (nav.free()) orbiting = false;
  });
  // The right button drags the camera of a map that tilts.
  canvas.addEventListener('contextmenu', e => {
    if (nav.tilts()) e.preventDefault();
  });
  /** Reads a two-finger gesture once a finger has travelled: both fingers sliding up or down together, at a
   * constant distance, tilt the camera; anything else pans and zooms. */
  const readGesture = (two: TwoFingers): void => {
    let travelled = false,
      together = true,
      direction = 0;
    for (const [id, at] of pts) {
      const start = two.starts.get(id);
      if (!start) return;
      const dx = at.x - start.x,
        dy = at.y - start.y;
      if (Math.hypot(dx, dy) >= GESTURE_TRAVEL) travelled = true;
      if (Math.abs(dy) < GESTURE_TRAVEL / 2 || Math.abs(dx) > Math.abs(dy) * 0.6 || (direction !== 0 && Math.sign(dy) !== direction)) together = false;
      direction = Math.sign(dy);
    }
    if (!travelled) return;
    const [a, b] = [...two.starts.values()],
      apart = Math.hypot(a.x - b.x, a.y - b.y);
    two.mode = together && apart > 0 && Math.abs(dist() / apart - 1) < 0.12 ? 'tilt' : 'pinch';
  };
  canvas.addEventListener('pointermove', e => {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    const cur = local(e);
    // A free eye: a drag looks around, two fingers walk or fly (sliding down goes forward).
    if (nav.free()) {
      const m0 = pts.size === 2 ? mid() : undefined;
      pts.set(e.pointerId, cur);
      if (m0) {
        const m1 = mid();
        nav.stride((m1.y - m0.y) * SLIDE_STRIDE, (m0.x - m1.x) * SLIDE_STRIDE, 0.12);
      } else if (pts.size === 1) nav.look(cur.x - prev.x, cur.y - prev.y);
      return;
    }
    if (pts.size === 2 && pinch) {
      const m0 = mid();
      pts.set(e.pointerId, cur);
      const m1 = mid(),
        d = dist();
      if (pinch.mode === 'undecided') readGesture(pinch);
      if (pinch.mode === 'tilt') nav.tiltBy((m0.y - m1.y) * DRAG_PITCH, 0);
      else if (pinch.mode === 'pinch') {
        let v = nav.panned(nav.view, m0.x, m0.y, m1.x, m1.y);
        if (pinch.d > 0 && d > 0) v = nav.zoomed(v, d / pinch.d, m1.x, m1.y);
        nav.set(v);
      }
      pinch.d = d;
    } else if (orbiting) {
      pts.set(e.pointerId, cur);
      nav.tiltBy((prev.y - cur.y) * DRAG_PITCH, (cur.x - prev.x) * DRAG_YAW);
    } else {
      pts.set(e.pointerId, cur);
      nav.pan(prev.x, prev.y, cur.x, cur.y);
    }
  });
  const up = (e: PointerEvent): void => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    orbiting = false;
    if (!pts.size) canvas.classList.remove('drag');
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener(
    'wheel',
    e => {
      e.preventDefault();
      const p = local(e);
      // A free eye steps forward or back (Shift: faster).
      if (nav.free()) {
        const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
        nav.stride(-Math.max(-200, Math.min(200, delta)) / 100, 0, WHEEL_STRIDE_S, e.shiftKey);
        return;
      }
      // Shift+wheel tilts (a mouse reports it on either axis); a notch is eased, a touchpad step followed.
      if (e.shiftKey && nav.tilts()) {
        const raw = e.deltaY || e.deltaX,
          delta = e.deltaMode === 1 ? raw * 16 : e.deltaMode === 2 ? raw * 400 : raw;
        if (nav.tilting || Math.abs(delta) >= WHEEL_NOTCH_PX) nav.easeTiltBy(-delta * WHEEL_PITCH, 0);
        else nav.tiltBy(-delta * WHEEL_PITCH, 0);
        return;
      }
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      // A wheel notch is a large step (16 % and more): eased. Touchpads and pinch gestures (ctrl+wheel) send many small
      // steps that are already continuous: followed directly, unless a notch is still being eased.
      if (nav.zooming || (Math.abs(dy) >= WHEEL_NOTCH_PX && !e.ctrlKey)) nav.easeZoomBy(Math.exp(-dy * 0.0015), p.x, p.y);
      else nav.zoomBy(Math.exp(-dy * 0.0015), p.x, p.y);
    },
    { passive: false },
  );
  canvas.addEventListener('dblclick', e => {
    if (nav.free()) return;
    const p = local(e);
    nav.easeZoomBy(e.shiftKey ? 0.5 : 2, p.x, p.y);
  });
  const key = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    // A free eye: the held keys move it (the frames step it), Escape returns to the orbit, Home to the top view.
    // The zoom keys step it and 0 fits the map, below.
    if (nav.free() && !e.defaultPrevented) {
      const moving = MOVE_KEYS.has(e.code) || (nav.mode === 'fly' && FLY_KEYS.has(e.code));
      if (e.key === 'Escape') nav.setNavigation('orbit');
      else if (e.key === 'Home') nav.tiltTo(0, 0);
      else if (moving) {
        nav.hold(e);
      }
      if (e.key === 'Escape' || e.key === 'Home' || moving) {
        e.preventDefault();
        return;
      }
    }
    // The camera keys of a map that tilts: Shift+arrows tilt and turn, Home returns to the top view. A control that
    // took the key for itself (it prevented the default) keeps it.
    if (nav.tilts() && !e.defaultPrevented && (e.key === 'Home' || (e.shiftKey && e.key.startsWith('Arrow')))) {
      if (e.key === 'Home') nav.tiltTo(0, 0);
      else if (e.key === 'ArrowUp') nav.easeTiltBy(KEY_PITCH, 0);
      else if (e.key === 'ArrowDown') nav.easeTiltBy(-KEY_PITCH, 0);
      else nav.easeTiltBy(0, e.key === 'ArrowLeft' ? -KEY_YAW : KEY_YAW);
      e.preventDefault();
      return;
    }
    switch (e.key) {
      case '+':
      case '=':
        nav.easeZoomBy(1.4);
        break;
      case '-':
      case '_':
        nav.easeZoomBy(1 / 1.4);
        break;
      case '0':
        nav.fit();
        break;
      case 'ArrowLeft':
        nav.set(nav.panned(nav.view, nav.w / 2, nav.h / 2, nav.w / 2 + 80, nav.h / 2));
        break;
      case 'ArrowRight':
        nav.set(nav.panned(nav.view, nav.w / 2, nav.h / 2, nav.w / 2 - 80, nav.h / 2));
        break;
      case 'ArrowUp':
        nav.set(nav.panned(nav.view, nav.w / 2, nav.h / 2, nav.w / 2, nav.h / 2 + 80));
        break;
      case 'ArrowDown':
        nav.set(nav.panned(nav.view, nav.w / 2, nav.h / 2, nav.w / 2, nav.h / 2 - 80));
        break;
      default:
        return;
    }
    e.preventDefault();
  };
  window.addEventListener('keydown', key);
  const release = nav.release,
    releaseAll = nav.releaseAll;
  window.addEventListener('keyup', release);
  window.addEventListener('blur', releaseAll);

  const mini = (e: PointerEvent): void => {
    if (!minimap || !(e.buttons & 1)) return;
    const r = minimap.getBoundingClientRect();
    nav.set({ ...nav.view, cx: ((e.clientX - r.left) / r.width) * nav.mapSize, cy: ((e.clientY - r.top) / r.height) * nav.mapSize });
  };
  minimap?.addEventListener('pointerdown', e => {
    minimap.setPointerCapture(e.pointerId);
    mini(e);
  });
  minimap?.addEventListener('pointermove', mini);

  return () => {
    window.removeEventListener('keydown', key);
    window.removeEventListener('keyup', release);
    window.removeEventListener('blur', releaseAll);
  };
}
