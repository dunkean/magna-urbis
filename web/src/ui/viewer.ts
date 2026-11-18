/**
 * Pan/zoom viewer.
 * Drag + touch pan, wheel zoom toward cursor, pinch, double-click zoom, keyboard (+ - 0 arrows),
 * fit-to-map, devicePixelRatio aware, work only when dirty (requestAnimationFrame).
 * Wheel notches, double-clicks and the zoom keys set a target view that the camera eases to over a few frames
 * (the end view is the one a direct jump gives); touchpad and pinch deltas are followed directly.
 *
 * Two drawing modes:
 *  - sync (fallback): a CanvasRenderer on this thread draws every dirty frame (`setRenderer`).
 *  - async (default when OffscreenCanvas works): a render worker draws frames (`setSource`). The page shows the
 *    last delivered bitmap and moves/scales it with a CSS transform to follow the current view at once (compositor
 *    only, so panning and zooming stay at the display rate however long a real frame takes); at most one frame
 *    request is in flight and the newest view always wins. When a fresh bitmap arrives it replaces the old one and
 *    the transform is recomputed in the same task, so the swap is seamless.
 * Optional minimap canvas (drawn by the renderer, or from a base bitmap + the view rectangle).
 *
 * One camera (render/world/camera.ts): when the frame source presents a map that tilts (its element says so,
 * `data-camera="tilt"`; never with `?camera=dual`), the view also has a pitch and a yaw. Right-drag or Ctrl-drag
 * turns and tilts it, as do Shift+arrows, Shift+wheel and a two-finger vertical drag; Home eases back to the top
 * view and the fit key (0) resets it. Pan and zoom then act on the ground under the cursor. In the top view the
 * views handed out carry no pitch and no yaw: they are the views of the 2D map.
 */
import type { CanvasRenderer } from '../render/canvas';
import { dualCameras } from '../render/live/policy';
import { View, fitView, clampView, zoomAt, panBy, viewRect } from '../render/view';
import { clampPitch, panOnGround, wrapYaw, zoomAtGround } from '../render/world/camera';
import type { WorldRelief } from '../render/world/contract';

export interface ViewerOptions {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  minimap?: HTMLCanvasElement;
  onFrame?: (ms: number, band: number, scale: number) => void;
  onError?: (error: Error) => void;
  /** The (clamped) view of the frame about to be shown, with the container size: overlays (pins) follow it. */
  onView?: (v: View, w: number, h: number) => void;
}

export interface FrameRequest {
  seq: number;
  view: View;
  w: number;
  h: number;
  dpr: number;
  /** minimap size in device px */ mini: number;
}
export interface FrameSource {
  request(r: FrameRequest): void;
}
/** A renderer on this thread can present its own layers without creating a bitmap. */
export interface DirectFrameSource {
  element: HTMLElement;
  draw(r: FrameRequest): { mini?: HTMLCanvasElement; ms: number; band: number; scale: number };
}
export interface PresentedFrame {
  seq: number;
  ver?: number;
  view: View;
  w: number;
  h: number;
  dpr: number;
  bitmap?: ImageBitmap;
  mini?: ImageBitmap;
  ms: number;
  band: number;
  scale: number;
}

export interface Viewer {
  setRenderer(r: CanvasRenderer, mapSize: number, keepView?: boolean): void;
  /** Async mode: frames come from `src` (a worker); call `present` for every answer. */
  setSource(src: FrameSource): void;
  setDirectSource(src: DirectFrameSource): void;
  /** Rejecting an obsolete answer still releases the in-flight request and closes its bitmaps. */
  present(f: PresentedFrame, accept?: boolean): boolean;
  /** The drawn content changed (new world snapshot, style...): request a new frame; refit if the map size changed (or `keepView` is false). */
  contentChanged(mapSize: number, keepView: boolean, markerColor?: string): void;
  fit(): void;
  /** Set the view directly (clamped). Debug / scripted screenshots. */
  setView(v: View): void;
  zoomBy(factor: number): void;
  invalidate(): void;
  /** Keep shared products/camera while another view covers this viewer. */
  setPaused(paused: boolean): void;
  getView(): View;
  /** Eases the camera to a pitch (radians, 0 looks straight down) and a yaw (radians clockwise from north; the
   * current one when absent). Without effect while the map on screen does not tilt. */
  tiltTo(pitch: number, yaw?: number): void;
  /** Calls `listener` with the view whenever its pitch or yaw changed; returns the function that stops it. */
  onCamera(listener: (view: View) => void): () => void;
  /** The relief of the map on screen: a zoom of a tilted view then aims at the terrain under the cursor rather than
   * at the plane through the centre of the view. */
  setRelief(relief: (() => WorldRelief | undefined) | undefined): void;
  /** Wait until the displayed pixels represent the current camera, including worker replies. */
  waitForFrame(): Promise<void>;
  clear(): void;
  destroy(): void;
}

const sameView = (a: View, b: View): boolean => a.cx === b.cx && a.cy === b.cy && a.scale === b.scale;
/** Time constant of the eased zoom (the camera covers 63 % of what is left in this time), and the wheel delta, in
 * pixels, from which a wheel event is a notch to ease rather than a touchpad or pinch step to follow. */
const ZOOM_EASE_MS = 45,
  WHEEL_NOTCH_PX = 40;
/** Time constant of an eased tilt or turn (keys, the tilt button), slower than the zoom: the swing is larger. */
const TILT_EASE_MS = 90;
/** Radians per CSS pixel of a camera drag (pitch, yaw) and per pixel of a tilting wheel; steps of the keys. */
const DRAG_PITCH = 0.006,
  DRAG_YAW = 0.008,
  WHEEL_PITCH = 0.003,
  KEY_PITCH = Math.PI / 18,
  KEY_YAW = Math.PI / 12;
/** A two-finger gesture is read once a finger has travelled this far (CSS pixels). */
const GESTURE_TRAVEL = 8;
/** What two fingers on the map do: not known yet, pan and zoom, or tilt (both sliding up or down together). */
type TwoFingers = { d: number; mode: 'undecided' | 'pinch' | 'tilt'; starts: Map<number, { x: number; y: number }> };

export function createViewer(o: ViewerOptions): Viewer {
  const { container, canvas, minimap } = o;
  let renderer: CanvasRenderer | null = null;
  let source: FrameSource | null = null;
  let direct: DirectFrameSource | null = null;
  const originalOpacity = canvas.style.opacity;
  let mapSize = 1000;
  let view: View = { cx: 500, cy: 500, scale: 0.5 };
  let w = 1,
    h = 1,
    dpr = 1;
  let dirty = false,
    raf = 0,
    destroyed = false,
    paused = false;
  /** Eased zoom: the view the camera is moving to, and the time of its last step. */
  let zoomTarget: View | null = null,
    zoomStamp = 0;
  /** The tilt of the camera (radians), where it eases to, and the time of its last step. `view` and `zoomTarget`
   * hold the centre and the scale only. */
  let pitch = 0,
    yaw = 0,
    tiltTarget: { pitch: number; yaw: number } | null = null,
    tiltStamp = 0;
  let relief: (() => WorldRelief | undefined) | undefined;
  const cameraListeners = new Set<(view: View) => void>();
  /** Pitch and yaw last told to the listeners. */
  let toldPitch = 0,
    toldYaw = 0;
  /** The frame source presents a map that tilts. */
  const tilts = (): boolean => !dualCameras() && direct?.element.dataset.camera === 'tilt';
  const tilted = (): boolean => (pitch !== 0 || yaw !== 0) && tilts();
  /** A centre and a scale with the tilt of the camera; in the top view, the view itself. */
  const withTilt = (v: View): View => (tilted() ? { ...v, pitch, yaw } : v);
  /** The ground under (x0, y0) comes under (x1, y1). */
  const panned = (v: View, x0: number, y0: number, x1: number, y1: number): View => {
    if (!tilted()) return panBy(v, x1 - x0, y1 - y0);
    const moved = panOnGround(withTilt(v), x0, y0, x1, y1, w, h);
    return { cx: moved.cx, cy: moved.cy, scale: moved.scale };
  };
  const zoomed = (v: View, factor: number, sx: number, sy: number): View => {
    if (!tilted()) return zoomAt(v, factor, sx, sy, w, h);
    const moved = zoomAtGround(withTilt(v), factor, sx, sy, w, h, relief?.());
    return { cx: moved.cx, cy: moved.cy, scale: moved.scale };
  };
  // async mode state
  let bmCtx: ImageBitmapRenderingContext | null = null;
  let shown: { view: View; w: number; h: number } | null = null;
  let req: { view: View; w: number; h: number; dpr: number } | null = null;
  let seq = 0,
    inflight = 0,
    requestSeq = 0,
    force = false;
  let miniBase: ImageBitmap | HTMLCanvasElement | null = null,
    marker = '#a33';
  const closeMini = (): void => {
    if (miniBase && 'close' in miniBase) miniBase.close();
    miniBase = null;
    miniShown = undefined;
  };
  /** Size last written to the canvas style by the direct mode. */
  let directW = 0,
    directH = 0;
  const detachDirect = (): void => {
    if (!direct) return;
    direct?.element.remove();
    direct = null;
    canvas.style.opacity = originalOpacity;
    directW = directH = 0;
    delete canvas.dataset.presentation;
  };
  const resetRequests = (): void => {
    inflight = 0;
    requestSeq = 0;
    req = null;
    shown = null;
    canvas.style.transform = '';
    force = true;
  };

  const size = (): void => {
    const r = container.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    w = Math.max(1, Math.round(r.width));
    h = Math.max(1, Math.round(r.height));
    if (!source && !direct) {
      const pw = Math.round(w * dpr),
        ph = Math.round(h * dpr);
      if (canvas.width !== pw) canvas.width = pw;
      if (canvas.height !== ph) canvas.height = ph;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
    }
    if (minimap) {
      const mw = Math.round(minimap.clientWidth || 140);
      const px = Math.round(mw * dpr);
      if (minimap.width !== px) {
        minimap.width = px;
        minimap.height = px;
        closeMini();
        force = true;
      } // the renderer redraws it at the new size
    }
  };
  const invalidate = (): void => {
    dirty = true;
    if (!raf && !destroyed && !paused) raf = requestAnimationFrame(frame);
  };

  /** Pan/zoom the displayed bitmap to the current view (CSS transform: compositor only). */
  function applyTransform(): void {
    if (!shown) return;
    if (sameView(shown.view, view) && shown.w === w && shown.h === h) {
      canvas.style.transform = '';
      return;
    }
    const k = view.scale / shown.view.scale;
    const tx = (shown.view.cx - view.cx) * view.scale + (w - shown.w) / 2;
    const ty = (shown.view.cy - view.cy) * view.scale + (h - shown.h) / 2;
    canvas.style.transform = `translate(${tx.toFixed(2)}px,${ty.toFixed(2)}px) scale(${k})`;
  }
  /** What the miniature last showed: its base, its size, the marker colour and the view rectangle in quarter pixels. */
  let miniShown: { base: ImageBitmap | HTMLCanvasElement | null; size: number; marker: string; x: number; y: number; rw: number; rh: number } | undefined;
  function drawMiniOverlay(): void {
    if (!minimap || !miniBase) return;
    const k = minimap.width / mapSize,
      r = viewRect(view, w, h, 0);
    // A frame of a gesture usually moves the rectangle by a fraction of a miniature pixel: a redraw would change
    // nothing on screen, yet every changed canvas costs the page a raster and a compositor update.
    const x = Math.round(r.minX * k * 4),
      y = Math.round(r.minY * k * 4),
      rw = Math.round((r.maxX - r.minX) * k * 4),
      rh = Math.round((r.maxY - r.minY) * k * 4);
    const shown = miniShown;
    if (shown && shown.base === miniBase && shown.size === minimap.width && shown.marker === marker && shown.x === x && shown.y === y && shown.rw === rw && shown.rh === rh) return;
    const ctx = minimap.getContext('2d');
    if (!ctx) return;
    miniShown = { base: miniBase, size: minimap.width, marker, x, y, rw, rh };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, minimap.width, minimap.height);
    ctx.drawImage(miniBase, 0, 0, minimap.width, minimap.height);
    ctx.strokeStyle = marker;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(r.minX * k, r.minY * k, (r.maxX - r.minX) * k, (r.maxY - r.minY) * k);
  }
  function sendRequest(): void {
    if (!source) return;
    const changed = !req || req.w !== w || req.h !== h || req.dpr !== dpr || !sameView(req.view, view);
    if (inflight || !(force || changed)) return;
    force = false;
    req = { view: { ...view }, w, h, dpr };
    inflight = ++seq;
    requestSeq = inflight;
    source.request({ seq: inflight, view: req.view, w, h, dpr, mini: minimap ? minimap.width : 0 });
  }

  /** One step of the eased zoom: the scale covers a share of what is left (geometric), around the screen point that the
   * current view and the target have in common (the cursor of a wheel zoom), which therefore stays put. */
  function stepZoom(now: number): void {
    const target = zoomTarget!,
      dt = Math.max(0, Math.min(64, now - zoomStamp));
    zoomStamp = now;
    const ratio = target.scale / view.scale;
    // Within 0.4 % of the scale and a pixel of the place: the camera takes the target itself.
    if (Math.abs(Math.log(ratio)) < 0.004 && Math.abs(target.cx - view.cx) * target.scale < 1 && Math.abs(target.cy - view.cy) * target.scale < 1) {
      view = target;
      zoomTarget = null;
      return;
    }
    const share = 1 - Math.exp(-dt / ZOOM_EASE_MS),
      scale = view.scale * Math.pow(ratio, share),
      spread = 1 / view.scale - 1 / target.scale;
    if (Math.abs(ratio - 1) > 1e-6) {
      const qx = (target.cx - view.cx) / spread,
        qy = (target.cy - view.cy) / spread;
      view = { cx: view.cx + qx / view.scale - qx / scale, cy: view.cy + qy / view.scale - qy / scale, scale };
    } else view = { cx: view.cx + (target.cx - view.cx) * share, cy: view.cy + (target.cy - view.cy) * share, scale: target.scale };
    invalidate();
  }
  /** One step of an eased tilt: pitch and yaw cover a share of what is left, the yaw by the shorter way round. */
  function stepTilt(now: number): void {
    const target = tiltTarget!,
      dt = Math.max(0, Math.min(64, now - tiltStamp));
    tiltStamp = now;
    const turn = wrapYaw(target.yaw - yaw),
      lift = target.pitch - pitch;
    if (Math.abs(turn) < 0.002 && Math.abs(lift) < 0.002) {
      pitch = target.pitch;
      yaw = target.yaw;
      tiltTarget = null;
      return;
    }
    const share = 1 - Math.exp(-dt / TILT_EASE_MS);
    pitch += lift * share;
    yaw = wrapYaw(yaw + turn * share);
    invalidate();
  }
  /** Tells the listeners the pitch and yaw of the view on screen when they changed. */
  function tellCamera(): void {
    const shownPitch = tilted() ? pitch : 0,
      shownYaw = tilted() ? yaw : 0;
    if (shownPitch === toldPitch && shownYaw === toldYaw) return;
    toldPitch = shownPitch;
    toldYaw = shownYaw;
    const current = withTilt(view);
    for (const listener of cameraListeners) listener(current);
  }
  function frame(stamp?: number): void {
    raf = 0;
    if (paused) return;
    if (!dirty) return;
    dirty = false;
    if (zoomTarget) stepZoom(typeof stamp === 'number' ? Math.max(stamp, zoomStamp) : performance.now());
    if (tiltTarget) stepTilt(typeof stamp === 'number' ? Math.max(stamp, tiltStamp) : performance.now());
    view = clampView(view, mapSize, w, h);
    const camera = withTilt(view),
      tilting = tilts();
    o.onView?.(camera, w, h);
    if (direct) {
      try {
        // Only when the size changed: a style write per frame makes the page recompute styles per frame.
        if (directW !== w || directH !== h) {
          directW = w;
          directH = h;
          canvas.style.width = w + 'px';
          canvas.style.height = h + 'px';
        }
        const st = direct.draw({ seq: ++seq, view: { ...camera }, w, h, dpr, mini: minimap ? minimap.width : 0 });
        // The source began or ceased to present a map that tilts: a tilt set meanwhile shows, or goes, next frame.
        if (tilting !== tilts() && (pitch !== 0 || yaw !== 0)) invalidate();
        tellCamera();
        // A miniature returned by the draw is new content, even in the same canvas object.
        if (st.mini) {
          if (miniBase !== st.mini) {
            closeMini();
            miniBase = st.mini;
          }
          miniShown = undefined;
        }
        drawMiniOverlay();
        o.onFrame?.(st.ms, st.band, st.scale);
      } catch (error) {
        o.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
      return;
    }
    if (source) {
      applyTransform();
      drawMiniOverlay();
      sendRequest();
      return;
    }
    if (!renderer) return;
    try {
      const st = renderer.draw(view);
      if (minimap) renderer.drawMinimap(minimap, view, w, h);
      o.onFrame?.(st.ms, st.band, view.scale);
    } catch (error) {
      o.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }
  const set = (v: View): void => {
    zoomTarget = null;
    view = clampView(v, mapSize, w, h);
    invalidate();
  };
  /** The top view at once. */
  const level = (): void => {
    pitch = yaw = 0;
    tiltTarget = null;
  };
  const fit = (): void => {
    level();
    set(fitView(mapSize, w, h));
  };
  const zoomBy = (f: number, sx = w / 2, sy = h / 2): void => set(zoomed(view, f, sx, sy));
  /** Zoom by `f` around a screen point, eased: successive calls move the target, as direct jumps would move the view. */
  const easeZoomBy = (f: number, sx = w / 2, sy = h / 2): void => {
    if (!zoomTarget) zoomStamp = performance.now();
    zoomTarget = clampView(zoomed(zoomTarget ?? view, f, sx, sy), mapSize, w, h);
    invalidate();
  };
  /** Tilts and turns the camera at once (a drag follows the pointer). */
  const tiltBy = (lift: number, turn: number): void => {
    if (!tilts()) return;
    tiltTarget = null;
    pitch = clampPitch(pitch + lift);
    yaw = wrapYaw(yaw + turn);
    invalidate();
  };
  /** Eases the camera to a pitch and a yaw: successive calls move the target. */
  const tiltTo = (toPitch: number, toYaw: number): void => {
    if (!tilts()) return;
    if (!tiltTarget) tiltStamp = performance.now();
    tiltTarget = { pitch: clampPitch(toPitch), yaw: wrapYaw(toYaw) };
    invalidate();
  };
  const easeTiltBy = (lift: number, turn: number): void => tiltTo((tiltTarget?.pitch ?? pitch) + lift, (tiltTarget?.yaw ?? yaw) + turn);

  size();
  const ro = new ResizeObserver(() => {
    size();
    invalidate();
  });
  ro.observe(container);

  // --- pointers (drag = pan, right-drag or Ctrl-drag = turn and tilt, two pointers = pinch or tilt) ---
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
    orbiting = pts.size === 1 && (e.button === 2 || e.ctrlKey) && tilts();
    if (pts.size === 2) pinch = { d: dist(), mode: tilts() ? 'undecided' : 'pinch', starts: new Map(pts) };
  });
  // The right button drags the camera of a map that tilts.
  canvas.addEventListener('contextmenu', e => {
    if (tilts()) e.preventDefault();
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
    if (pts.size === 2 && pinch) {
      const m0 = mid();
      pts.set(e.pointerId, cur);
      const m1 = mid(),
        d = dist();
      if (pinch.mode === 'undecided') readGesture(pinch);
      if (pinch.mode === 'tilt') tiltBy((m0.y - m1.y) * DRAG_PITCH, 0);
      else if (pinch.mode === 'pinch') {
        let v = panned(view, m0.x, m0.y, m1.x, m1.y);
        if (pinch.d > 0 && d > 0) v = zoomed(v, d / pinch.d, m1.x, m1.y);
        set(v);
      }
      pinch.d = d;
    } else if (orbiting) {
      pts.set(e.pointerId, cur);
      tiltBy((prev.y - cur.y) * DRAG_PITCH, (cur.x - prev.x) * DRAG_YAW);
    } else {
      pts.set(e.pointerId, cur);
      // A drag during an eased zoom moves its target too: the zoom ends where the drag left the map.
      const target = zoomTarget && clampView(panned(zoomTarget, prev.x, prev.y, cur.x, cur.y), mapSize, w, h);
      set(panned(view, prev.x, prev.y, cur.x, cur.y));
      zoomTarget = target;
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
      // Shift+wheel tilts (a mouse reports it on either axis); a notch is eased, a touchpad step followed.
      if (e.shiftKey && tilts()) {
        const raw = e.deltaY || e.deltaX,
          delta = e.deltaMode === 1 ? raw * 16 : e.deltaMode === 2 ? raw * 400 : raw;
        if (tiltTarget || Math.abs(delta) >= WHEEL_NOTCH_PX) easeTiltBy(-delta * WHEEL_PITCH, 0);
        else tiltBy(-delta * WHEEL_PITCH, 0);
        return;
      }
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      // A wheel notch is a large step (16 % and more): eased. Touchpads and pinch gestures (ctrl+wheel) send many small
      // steps that are already continuous: followed directly, unless a notch is still being eased.
      if (zoomTarget || (Math.abs(dy) >= WHEEL_NOTCH_PX && !e.ctrlKey)) easeZoomBy(Math.exp(-dy * 0.0015), p.x, p.y);
      else zoomBy(Math.exp(-dy * 0.0015), p.x, p.y);
    },
    { passive: false },
  );
  canvas.addEventListener('dblclick', e => {
    const p = local(e);
    easeZoomBy(e.shiftKey ? 0.5 : 2, p.x, p.y);
  });
  const key = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    // The camera keys of a map that tilts: Shift+arrows tilt and turn, Home returns to the top view. A control that
    // took the key for itself (it prevented the default) keeps it.
    if (tilts() && !e.defaultPrevented && (e.key === 'Home' || (e.shiftKey && e.key.startsWith('Arrow')))) {
      if (e.key === 'Home') tiltTo(0, 0);
      else if (e.key === 'ArrowUp') easeTiltBy(KEY_PITCH, 0);
      else if (e.key === 'ArrowDown') easeTiltBy(-KEY_PITCH, 0);
      else easeTiltBy(0, e.key === 'ArrowLeft' ? -KEY_YAW : KEY_YAW);
      e.preventDefault();
      return;
    }
    switch (e.key) {
      case '+':
      case '=':
        easeZoomBy(1.4);
        break;
      case '-':
      case '_':
        easeZoomBy(1 / 1.4);
        break;
      case '0':
        fit();
        break;
      case 'ArrowLeft':
        set(panned(view, w / 2, h / 2, w / 2 + 80, h / 2));
        break;
      case 'ArrowRight':
        set(panned(view, w / 2, h / 2, w / 2 - 80, h / 2));
        break;
      case 'ArrowUp':
        set(panned(view, w / 2, h / 2, w / 2, h / 2 + 80));
        break;
      case 'ArrowDown':
        set(panned(view, w / 2, h / 2, w / 2, h / 2 - 80));
        break;
      default:
        return;
    }
    e.preventDefault();
  };
  window.addEventListener('keydown', key);

  // minimap click = recenter
  const mini = (e: PointerEvent): void => {
    if (!minimap || !(e.buttons & 1)) return;
    const r = minimap.getBoundingClientRect();
    set({ ...view, cx: ((e.clientX - r.left) / r.width) * mapSize, cy: ((e.clientY - r.top) / r.height) * mapSize });
  };
  minimap?.addEventListener('pointerdown', e => {
    minimap.setPointerCapture(e.pointerId);
    mini(e);
  });
  minimap?.addEventListener('pointermove', mini);

  return {
    setRenderer(r, size2, keepView = false) {
      detachDirect();
      source = null;
      resetRequests();
      size();
      renderer?.dispose();
      const sizeChanged = size2 !== mapSize;
      renderer = r;
      mapSize = size2;
      if (!keepView || sizeChanged) {
        zoomTarget = null;
        level();
        view = fitView(mapSize, w, h);
      }
      invalidate();
    },
    setSource(src) {
      detachDirect();
      source = src;
      resetRequests();
      invalidate();
    },
    setDirectSource(src) {
      if (direct?.element !== src.element) {
        detachDirect();
        container.insertBefore(src.element, canvas);
      }
      direct = src;
      source = null;
      resetRequests();
      canvas.style.opacity = '0';
      canvas.dataset.presentation = 'direct';
      invalidate();
    },
    present(f, accept = true) {
      // An answer from a previous source must never replace the current view or release its request.
      if (!source || f.seq !== requestSeq) {
        f.bitmap?.close();
        f.mini?.close();
        return false;
      }
      inflight = 0;
      if (!accept) {
        f.bitmap?.close();
        f.mini?.close();
        force = true;
        invalidate();
        return false;
      }
      let presented = false;
      if (f.mini) {
        closeMini();
        miniBase = f.mini;
      }
      if (f.bitmap) {
        bmCtx ??= canvas.getContext('bitmaprenderer');
        if (bmCtx) {
          bmCtx.transferFromImageBitmap(f.bitmap); // sets the canvas size to the bitmap's (w*dpr x h*dpr)
          presented = true;
        } else {
          const c = canvas.getContext('2d');
          if (c) {
            canvas.width = Math.max(1, Math.round(f.w * f.dpr));
            canvas.height = Math.max(1, Math.round(f.h * f.dpr));
            c.drawImage(f.bitmap, 0, 0);
            presented = true;
          }
          f.bitmap.close();
        }
        if (presented) {
          canvas.style.width = f.w + 'px';
          canvas.style.height = f.h + 'px';
          shown = { view: f.view, w: f.w, h: f.h };
          applyTransform();
          o.onFrame?.(f.ms, f.band, f.scale);
        }
      }
      drawMiniOverlay();
      invalidate(); // sends the next request if the view moved meanwhile
      return presented;
    },
    contentChanged(size2, keepView, markerColor) {
      const sizeChanged = size2 !== mapSize;
      mapSize = size2;
      if (markerColor) marker = markerColor;
      if (!keepView || sizeChanged) {
        zoomTarget = null;
        level();
        view = fitView(mapSize, w, h);
      }
      force = true;
      invalidate();
    },
    fit,
    setView(v) {
      // The view is taken whole: its pitch and yaw too (absent: the top view), kept for a map that tilts.
      tiltTarget = null;
      pitch = dualCameras() ? 0 : clampPitch(v.pitch);
      yaw = dualCameras() ? 0 : wrapYaw(v.yaw);
      set(v);
    },
    tiltTo: (toPitch, toYaw) => tiltTo(toPitch, toYaw ?? tiltTarget?.yaw ?? yaw),
    onCamera(listener) {
      cameraListeners.add(listener);
      return () => cameraListeners.delete(listener);
    },
    setRelief(value) {
      relief = value;
    },
    zoomBy: f => zoomBy(f),
    invalidate,
    setPaused(value: boolean) {
      paused = value;
      if (!paused) invalidate();
    },
    getView: () => withTilt(view),
    async waitForFrame() {
      const started = performance.now();
      for (;;) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        if (!dirty && !raf && (!source || (!inflight && shown && sameView(shown.view, view)))) return;
        if (performance.now() - started > 15000) throw new Error('La vue voisine n’a pas terminé son rendu. Réessayez après le chargement de la carte.');
      }
    },
    clear() {
      detachDirect();
      source = null;
      renderer = null;
      resetRequests();
      closeMini();
      dirty = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      canvas.width = canvas.width;
    },
    destroy() {
      destroyed = true;
      ro.disconnect();
      window.removeEventListener('keydown', key);
      closeMini();
      detachDirect();
      if (raf) cancelAnimationFrame(raf);
    },
  };
}
