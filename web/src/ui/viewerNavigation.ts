/** Camera and navigation for createViewer. Owns orbit, walk/fly, easing and projection so input and presentation share one camera. */
import { dualCameras } from '../render/live/policy';
import { View, fitView, clampView, zoomAt, panBy } from '../render/view';
import { clampLook, clampPitch, panOnGround, screenProjection, wrapYaw, zoomAtGround, type ScreenProjection } from '../render/world/camera';
import type { WorldRelief } from '../render/world/contract';
import type { Terrain3dCollisions } from '../render/world/terrain3dCollisions';
import { enterFreeEye, leaveFreeEye, lookFreeEye, moveFreeEye, switchFreeEye, walkingEye, type Navigation } from '../render/world/navigation';

const sameView = (a: View, b: View): boolean => a.cx === b.cx && a.cy === b.cy && a.scale === b.scale;
/** Time in which eased zoom covers 63% of the remaining distance. */
const ZOOM_EASE_MS = 45;
/** Time constant of an eased tilt or turn (keys, the tilt button), slower than the zoom: the swing is larger. */
const TILT_EASE_MS = 90;
/** Seconds of walk or flight per wheel notch (100 px, the separate 3D view's), and per metre-free step of a button. */
export const WHEEL_STRIDE_S = 0.25;
/** Longest step of a held key: a stalled or background frame does not throw the eye far. */
const MOVE_STEP_S = 0.05;

export function createViewerNavigation(capable: () => boolean, invalidate: () => void) {
  let mapSize = 1000,
    view: View = { cx: 500, cy: 500, scale: 0.5 },
    w = 1,
    h = 1;
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
  let walkCollisions: (() => Terrain3dCollisions | undefined) | undefined;
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
  const tilts = (): boolean => !tiltLocked && !dualCameras() && capable();
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
    if (forward || right || up) takeEye(moveFreeEye(withTilt(view), navigation as 'walk' | 'fly', forward, right, up, seconds, !!key('ShiftLeft', 'ShiftRight'), relief?.(), navigation === 'walk' ? walkCollisions?.() : undefined));
  }
  /** A step of a free eye forward (negative: back) for `seconds`: the wheel, the zoom buttons and keys, two fingers. */
  const stride = (forward: number, right: number, seconds: number, fast = false): void => {
    if (forward || right) takeEye(moveFreeEye(withTilt(view), navigation as 'walk' | 'fly', forward, right, 0, seconds, fast, relief?.(), navigation === 'walk' ? walkCollisions?.() : undefined));
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
    takeEye(mode === 'walk' ? moveFreeEye(next, mode, 0, 0, 0, 0, false, relief?.(), walkCollisions?.()) : next);
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

  return {
    get view() {
      return view;
    },
    get w() {
      return w;
    },
    get h() {
      return h;
    },
    get mapSize() {
      return mapSize;
    },
    get relief() {
      return relief?.();
    },
    get camera() {
      return withTilt(view);
    },
    get zooming() {
      return !!zoomTarget;
    },
    get tilting() {
      return !!tiltTarget;
    },
    get mode() {
      return navigation;
    },
    tilts,
    free,
    withTilt,
    stride,
    set,
    fit,
    zoomBy,
    easeZoomBy,
    tiltBy,
    easeTiltBy,
    panned,
    zoomed,
    tellCamera,
    look(dx: number, dy: number) {
      takeEye(lookFreeEye(withTilt(view), dx, dy));
    },
    resize(width: number, height: number) {
      w = width;
      h = height;
    },
    contentChanged(size: number, keepView: boolean) {
      const changed = size !== mapSize;
      mapSize = size;
      // Loading content refits only the centre and scale; it keeps the camera's tilt.
      if (!keepView || changed) {
        zoomTarget = null;
        view = fitView(mapSize, w, h);
      }
    },
    pan(x0: number, y0: number, x1: number, y1: number) {
      // A drag during an eased zoom moves its target too.
      const target = zoomTarget && clampView(panned(zoomTarget, x0, y0, x1, y1), mapSize, w, h);
      set(panned(view, x0, y0, x1, y1));
      zoomTarget = target;
    },
    step(stamp?: number) {
      if (zoomTarget) stepZoom(typeof stamp === 'number' ? Math.max(stamp, zoomStamp) : performance.now());
      if (tiltTarget) stepTilt(typeof stamp === 'number' ? Math.max(stamp, tiltStamp) : performance.now());
      if (held.size) stepHeld(typeof stamp === 'number' ? Math.max(stamp, heldStamp) : performance.now());
      view = clampView(view, mapSize, w, h);
    },
    sourceChanged(wasTilting: boolean) {
      if (wasTilting !== tilts() && (pitch !== 0 || yaw !== 0 || navigation !== 'orbit')) invalidate();
    },
    hold(e: KeyboardEvent) {
      if (!held.size) heldStamp = performance.now();
      held.add(e.code);
      invalidate();
    },
    release(e: KeyboardEvent) {
      if (held.delete(e.code)) e.preventDefault();
    },
    releaseAll() {
      held.clear();
    },
    setView(v: View) {
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
    tiltTo: (toPitch: number, toYaw?: number) => tiltTo(toPitch, toYaw ?? tiltTarget?.yaw ?? yaw),
    setTiltLocked(locked: boolean) {
      if (locked === tiltLocked) return;
      // A walk or a flight goes back to the orbit above where the eye stands, then the top view.
      if (locked && navigation !== 'orbit' && tilts()) setNavigation('orbit');
      if (locked) level();
      tiltLocked = locked;
      invalidate();
    },
    onCamera(listener: (view: View) => void) {
      cameraListeners.add(listener);
      return () => cameraListeners.delete(listener);
    },
    setRelief(value: (() => WorldRelief | undefined) | undefined) {
      relief = value;
    },
    setWalkCollisions(value: (() => Terrain3dCollisions | undefined) | undefined) {
      walkCollisions = value;
    },
  };
}
export type ViewerNavigation = ReturnType<typeof createViewerNavigation>;
