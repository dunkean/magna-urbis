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
 * `data-camera="tilt"`; never with `?camera=dual`, nor while the page locks it in 2D), the view also has a pitch and a yaw. Right-drag or Ctrl-drag
 * turns and tilts it, as do Shift+arrows, Shift+wheel and a two-finger vertical drag; Home eases back to the top
 * view and the fit key (0) resets it. Pan and zoom then act on the ground under the cursor. In the top view the
 * views handed out carry no pitch and no yaw: they are the views of the 2D map.
 *
 * Walking and flying (`setNavigation`, render/world/navigation.ts): the camera becomes a free eye (View.eye), with the
 * separate 3D view's keys: W/Z or Up forward, S or Down back, A/Q or Left and D or Right sideways, Shift faster; flying
 * also Space or E up, C down (not Ctrl: Ctrl+W closes the tab). A drag looks around, two fingers move, the wheel steps forward or back; Escape
 * returns to the orbit, Home to the top view. The held keys move the eye in the frames of the viewer's own loop.
 */
import type { CanvasRenderer } from '../render/canvas';
import { dualCameras } from '../render/live/policy';
import { View, fitView, clampView, zoomAt, panBy, viewRect } from '../render/view';
import { clampLook, clampPitch, panOnGround, screenProjection, viewFootprint, wrapYaw, zoomAtGround, type ScreenProjection } from '../render/world/camera';
import type { WorldRelief } from '../render/world/contract';
import { enterFreeEye, leaveFreeEye, lookFreeEye, moveFreeEye, switchFreeEye, walkingEye, type Navigation } from '../render/world/navigation';

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
  /** Holds the map in the top view (the page's 2D lock): a tilted camera returns to it at once, and no gesture, key or
   * call tilts it until unlocked. */
  setTiltLocked(locked: boolean): void;
  /** Calls `listener` with the view whenever its pitch, its yaw or the navigation mode changed; returns the function
   * that stops it. */
  onCamera(listener: (view: View) => void): () => void;
  /** Orbit (the default), walk or fly. Walking and flying need a map that tilts; back to the orbit at the pitch the
   * camera had before. */
  setNavigation(mode: Navigation): void;
  navigation(): Navigation;
  /** Where the ground points of the map are on screen for the view on screen (render/world/camera.ts), made again only
   * when the view, the size or the relief changed: the page's overlays follow a tilted camera with it. */
  projection(): ScreenProjection;
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
/** Keys that move a free eye (KeyboardEvent.code), and those that only a flyer has. */
const MOVE_KEYS = new Set(['KeyW', 'KeyZ', 'KeyS', 'KeyA', 'KeyQ', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']),
  FLY_KEYS = new Set(['Space', 'KeyE', 'KeyC']);
/** Seconds of walk or flight per wheel notch (100 px, the separate 3D view's), and per metre-free step of a button. */
const WHEEL_STRIDE_S = 0.25;
/** Walk or flight per CSS pixel of a two-finger slide (the separate 3D view's). */
const SLIDE_STRIDE = 0.04;
/** Longest step of a held key: a stalled or background frame does not throw the eye far. */
const MOVE_STEP_S = 0.05;
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
  /** Pitch, yaw and navigation last told to the listeners. */
  let toldPitch = 0,
    toldYaw = 0,
    toldNavigation: Navigation = 'orbit';
  /** Orbit, or a free eye: then `view` holds where the eye stands (and the orbit's scale), `pitch` its look, and a
   * flyer its altitude; the orbit's pitch waits for the way back. */
  let navigation: Navigation = 'orbit',
    flightAltitude = 0,
    orbitPitch = 1;
  /** Keys held that move a free eye (KeyboardEvent.code), and the time of the last step. */
  const held = new Set<string>();
  let heldStamp = 0;
  /** The page holds the map in the top view (Viewer.setTiltLocked). */
  let tiltLocked = false;
  /** The frame source presents a map that tilts, and the page lets it. */
  const tilts = (): boolean => !tiltLocked && !dualCameras() && direct?.element.dataset.camera === 'tilt';
  const free = (): boolean => navigation !== 'orbit' && tilts();
  const tilted = (): boolean => (pitch !== 0 || yaw !== 0 || navigation !== 'orbit') && tilts();
  /** A centre and a scale with the tilt of the camera (a free eye: its look and altitude); in the top view, the view
   * itself. */
  const withTilt = (v: View): View => {
    if (!tilted()) return v;
    if (navigation === 'orbit') return { ...v, pitch, yaw };
    return { ...v, pitch, yaw, eye: navigation === 'walk' ? walkingEye(relief?.(), v.cx, v.cy) : flightAltitude };
  };
  /** The free eye of `next` becomes the camera's (where it stands, its look and its altitude). */
  const takeEye = (next: View): void => {
    view = { cx: next.cx, cy: next.cy, scale: view.scale };
    pitch = next.pitch ?? pitch;
    yaw = next.yaw ?? yaw;
    if (navigation === 'fly') flightAltitude = next.eye ?? flightAltitude;
    invalidate();
  };
  let projected: { view: View; w: number; h: number; relief: WorldRelief | undefined; value: ScreenProjection } | undefined;
  const sameCamera = (a: View, b: View): boolean => sameView(a, b) && a.pitch === b.pitch && a.yaw === b.yaw && a.eye === b.eye;
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
  /** What the miniature last showed: its base, its size, the marker colour and the corners of the view's outline in
   * quarter pixels. */
  let miniShown: { base: ImageBitmap | HTMLCanvasElement | null; size: number; marker: string; corners: Int32Array } | undefined;
  const footprint = new Float64Array(8),
    corners = new Int32Array(8);
  /** The ground the view shows, on the miniature: its rectangle in the top view, the footprint of a tilted camera (the
   * ground under the corners of the screen, cut towards the horizon). */
  function drawMiniOverlay(): void {
    if (!minimap || !miniBase) return;
    const k = minimap.width / mapSize,
      camera = withTilt(view);
    if (camera === view) {
      const r = viewRect(view, w, h, 0);
      footprint.set([r.minX, r.minY, r.maxX, r.minY, r.maxX, r.maxY, r.minX, r.maxY]);
    } else viewFootprint(camera, w, h, relief?.(), footprint);
    // A frame of a gesture usually moves the outline by a fraction of a miniature pixel: a redraw would change nothing
    // on screen, yet every changed canvas costs the page a raster and a compositor update.
    for (let i = 0; i < 8; i++) corners[i] = Math.round(footprint[i] * k * 4);
    const shown = miniShown;
    if (shown && shown.base === miniBase && shown.size === minimap.width && shown.marker === marker && shown.corners.every((value, i) => value === corners[i])) return;
    const ctx = minimap.getContext('2d');
    if (!ctx) return;
    miniShown = { base: miniBase, size: minimap.width, marker, corners: corners.slice() };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, minimap.width, minimap.height);
    ctx.drawImage(miniBase, 0, 0, minimap.width, minimap.height);
    ctx.strokeStyle = marker;
    ctx.lineWidth = 1.5;
    if (camera === view) {
      ctx.strokeRect(footprint[0] * k, footprint[1] * k, (footprint[2] - footprint[0]) * k, (footprint[5] - footprint[1]) * k);
      return;
    }
    ctx.beginPath();
    for (let i = 0; i < 4; i++) ctx.lineTo(footprint[i * 2] * k, footprint[i * 2 + 1] * k);
    ctx.closePath();
    ctx.stroke();
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
  /** One step of a free eye moved by the held keys; the frames go on while a key is held. */
  function stepHeld(now: number): void {
    const seconds = Math.min(MOVE_STEP_S, Math.max(0, (now - heldStamp) / 1000));
    heldStamp = now;
    if (!free()) {
      held.clear();
      return;
    }
    const key = (...codes: string[]): number => (codes.some(code => held.has(code)) ? 1 : 0);
    const forward = key('KeyW', 'KeyZ', 'ArrowUp') - key('KeyS', 'ArrowDown'),
      right = key('KeyD', 'ArrowRight') - key('KeyA', 'KeyQ', 'ArrowLeft'),
      up = navigation === 'fly' ? key('Space', 'KeyE') - key('KeyC') : 0;
    // Shift alone moves nothing: no frame until a moving key comes.
    if (forward || right || up) takeEye(moveFreeEye(withTilt(view), navigation as 'walk' | 'fly', forward, right, up, seconds, !!key('ShiftLeft', 'ShiftRight'), relief?.()));
  }
  /** A step of a free eye forward (negative: back) for `seconds`: the wheel, the zoom buttons and keys, two fingers. */
  const stride = (forward: number, right: number, seconds: number, fast = false): void => {
    if (forward || right) takeEye(moveFreeEye(withTilt(view), navigation as 'walk' | 'fly', forward, right, 0, seconds, fast, relief?.()));
  };
  /** Walk, fly or orbit (Viewer.setNavigation). */
  function setNavigation(mode: Navigation): void {
    if (mode === navigation || (mode !== 'orbit' && !tilts())) return;
    held.clear();
    tiltTarget = null;
    zoomTarget = null;
    const camera = withTilt(view);
    if (mode === 'orbit') {
      const back = leaveFreeEye(camera, orbitPitch, w, h, relief?.());
      navigation = 'orbit';
      view = { cx: back.cx, cy: back.cy, scale: view.scale };
      pitch = back.pitch ?? orbitPitch;
      yaw = back.yaw ?? yaw;
      invalidate();
      return;
    }
    if (navigation === 'orbit') orbitPitch = pitch || 1;
    const next = navigation === 'orbit' ? enterFreeEye(camera, mode, h, relief?.()) : switchFreeEye(camera, mode, relief?.());
    navigation = mode;
    takeEye(next);
  }
  /** Tells the listeners the pitch, the yaw and the navigation of the view on screen when they changed. */
  function tellCamera(): void {
    const shownPitch = tilted() ? pitch : 0,
      shownYaw = tilted() ? yaw : 0,
      shownNavigation = tilted() ? navigation : 'orbit';
    if (shownPitch === toldPitch && shownYaw === toldYaw && shownNavigation === toldNavigation) return;
    toldPitch = shownPitch;
    toldYaw = shownYaw;
    toldNavigation = shownNavigation;
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
    if (held.size) stepHeld(typeof stamp === 'number' ? Math.max(stamp, heldStamp) : performance.now());
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
        if (tilting !== tilts() && (pitch !== 0 || yaw !== 0 || navigation !== 'orbit')) invalidate();
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
    navigation = 'orbit';
    held.clear();
  };
  const fit = (): void => {
    level();
    set(fitView(mapSize, w, h));
  };
  /** A free eye has no zoom: the zoom buttons and keys step it forward or back. */
  const zoomBy = (f: number, sx = w / 2, sy = h / 2): void => (free() ? stride(Math.sign(Math.log(f)), 0, WHEEL_STRIDE_S) : set(zoomed(view, f, sx, sy)));
  /** Zoom by `f` around a screen point, eased: successive calls move the target, as direct jumps would move the view. */
  const easeZoomBy = (f: number, sx = w / 2, sy = h / 2): void => {
    if (free()) return zoomBy(f);
    if (!zoomTarget) zoomStamp = performance.now();
    zoomTarget = clampView(zoomed(zoomTarget ?? view, f, sx, sy), mapSize, w, h);
    invalidate();
  };
  /** Tilts and turns the camera at once (a drag follows the pointer). */
  const tiltBy = (lift: number, turn: number): void => {
    if (!tilts() || navigation !== 'orbit') return;
    tiltTarget = null;
    pitch = clampPitch(pitch + lift);
    yaw = wrapYaw(yaw + turn);
    invalidate();
  };
  /** Eases the camera to a pitch and a yaw: successive calls move the target. */
  const tiltTo = (toPitch: number, toYaw: number): void => {
    if (!tilts()) return;
    // The tilt button and Home leave a walk or a flight for the orbit first.
    if (navigation !== 'orbit') setNavigation('orbit');
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
    if (free()) orbiting = false;
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
    // A free eye: a drag looks around, two fingers walk or fly (sliding down goes forward).
    if (free()) {
      const m0 = pts.size === 2 ? mid() : undefined;
      pts.set(e.pointerId, cur);
      if (m0) {
        const m1 = mid();
        stride((m1.y - m0.y) * SLIDE_STRIDE, (m0.x - m1.x) * SLIDE_STRIDE, 0.12);
      } else if (pts.size === 1) takeEye(lookFreeEye(withTilt(view), cur.x - prev.x, cur.y - prev.y));
      return;
    }
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
      // A free eye steps forward or back (Shift: faster).
      if (free()) {
        const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
        stride(-Math.max(-200, Math.min(200, delta)) / 100, 0, WHEEL_STRIDE_S, e.shiftKey);
        return;
      }
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
    if (free()) return;
    const p = local(e);
    easeZoomBy(e.shiftKey ? 0.5 : 2, p.x, p.y);
  });
  const key = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    // A free eye: the held keys move it (the frames step it), Escape returns to the orbit, Home to the top view.
    // The zoom keys step it and 0 fits the map, below.
    if (free() && !e.defaultPrevented) {
      const moving = MOVE_KEYS.has(e.code) || (navigation === 'fly' && FLY_KEYS.has(e.code));
      if (e.key === 'Escape') setNavigation('orbit');
      else if (e.key === 'Home') tiltTo(0, 0);
      else if (moving) {
        if (!held.size) heldStamp = performance.now();
        held.add(e.code);
        invalidate();
      }
      if (e.key === 'Escape' || e.key === 'Home' || moving) {
        e.preventDefault();
        return;
      }
    }
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
  const release = (e: KeyboardEvent): void => {
    if (held.delete(e.code)) e.preventDefault();
  };
  const releaseAll = (): void => held.clear();
  window.addEventListener('keyup', release);
  window.addEventListener('blur', releaseAll);

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
      // New content never tilts the camera back: a refit changes the centre and the scale only.
      if (!keepView || sizeChanged) {
        zoomTarget = null;
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
      // New content never tilts the camera back: a refit changes the centre and the scale only.
      if (!keepView || sizeChanged) {
        zoomTarget = null;
        view = fitView(mapSize, w, h);
      }
      force = true;
      invalidate();
    },
    fit,
    setView(v) {
      // The view is taken whole: its pitch and yaw too (absent: the top view), kept for a map that tilts; a view with an
      // eye is a flight (a walk stays a walk), one without is the orbit.
      tiltTarget = null;
      held.clear();
      const flat = dualCameras() || tiltLocked,
        eye = !flat && Number.isFinite(v.eye);
      if (eye && navigation === 'orbit') orbitPitch = pitch || 1;
      navigation = eye ? (navigation === 'walk' ? 'walk' : 'fly') : 'orbit';
      if (eye) flightAltitude = v.eye!;
      pitch = flat ? 0 : eye ? clampLook(v.pitch) : clampPitch(v.pitch);
      yaw = flat ? 0 : wrapYaw(v.yaw);
      set({ cx: v.cx, cy: v.cy, scale: v.scale });
    },
    setNavigation,
    navigation: () => (tilted() ? navigation : 'orbit'),
    projection() {
      const camera = withTilt(view),
        ground = camera === view ? undefined : relief?.();
      if (!projected || !sameCamera(projected.view, camera) || projected.w !== w || projected.h !== h || projected.relief !== ground) projected = { view: camera, w, h, relief: ground, value: screenProjection(camera, w, h, ground) };
      return projected.value;
    },
    tiltTo: (toPitch, toYaw) => tiltTo(toPitch, toYaw ?? tiltTarget?.yaw ?? yaw),
    setTiltLocked(locked) {
      if (locked === tiltLocked) return;
      // A walk or a flight goes back to the orbit above where the eye stands, then the top view.
      if (locked && navigation !== 'orbit' && tilts()) setNavigation('orbit');
      if (locked) level();
      tiltLocked = locked;
      invalidate();
    },
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
      window.removeEventListener('keyup', release);
      window.removeEventListener('blur', releaseAll);
      closeMini();
      detachDirect();
      if (raf) cancelAnimationFrame(raf);
    },
  };
}
