/**
 * The camera of the world view (contract.ts): pure math, no GL and no DOM.
 *
 * A view is a centre on the ground, a scale in CSS pixels per metre, a pitch (0 looks straight down) and a yaw (the
 * compass direction at the top of the screen). The eye looks at the ground point of the centre from the distance at
 * which that point is seen at the view's scale, so zooming feels the same at every pitch; in the top view the
 * projection is the orthographic mapping of the 2D map (`topViewMapping`), which a perspective looking straight down
 * at a flat map equals. The relief rises with the pitch (`riseAt`), so the two meet without a jump.
 *
 * Callers: the live compositor fills `LiveFrame.camera` with `frameCamera` once per frame; the viewer (ui/viewer.ts)
 * pans and zooms a tilted view with `panOnGround` and `zoomAtGround`.
 */
import type { View } from '../view';
import type { FrameCamera, WorldRelief } from './contract';

/** Vertical field of view of a tilted camera: the one of the 3D terrain view. */
export const FIELD_OF_VIEW = Math.PI / 3.7;
const TAN_HALF_FIELD = Math.tan(FIELD_OF_VIEW / 2);
/** Steepest tilt: at 70 degrees the horizon is just inside the top of the view. */
export const MAX_PITCH = (70 * Math.PI) / 180;
/** Pitch from which the relief stands at its full height. Below, it rises from the flat map of the top view. */
const RISE_PITCH = 0.25;

export const clampPitch = (pitch: number | undefined): number => (Number.isFinite(pitch) ? Math.max(0, Math.min(MAX_PITCH, pitch!)) : 0);
/** Into [-pi, pi). */
export const wrapYaw = (yaw: number | undefined): number => (Number.isFinite(yaw) ? ((((yaw! + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI : 0);
/** The view is not the top view: it has a pitch or a yaw. */
export const isTilted = (view: View): boolean => clampPitch(view.pitch) > 0 || wrapYaw(view.yaw) !== 0;
/** Share of the relief shown at a pitch (FrameCamera.rise): a smooth step from the top view to RISE_PITCH. */
export function riseAt(pitch: number): number {
  const t = Math.max(0, Math.min(1, pitch / RISE_PITCH));
  return t * t * (3 - 2 * t);
}

/** The 2D mapping of the top view, in device pixels of a `width` x `height` target: `worldToClip` (column-major 3x3,
 * y down on screen) and `worldToPixel` ([sx, sy, tx, ty]) of LiveFrame. */
export function topViewMapping(view: View, width: number, height: number, dpr: number, worldToClip: Float32Array, worldToPixel: number[]): void {
  const s = view.scale * dpr,
    tx = width / 2 - view.cx * s,
    ty = height / 2 - view.cy * s;
  worldToClip[0] = (2 * s) / width;
  worldToClip[1] = 0;
  worldToClip[2] = 0;
  worldToClip[3] = 0;
  worldToClip[4] = (-2 * s) / height;
  worldToClip[5] = 0;
  worldToClip[6] = (2 * tx) / width - 1;
  worldToClip[7] = 1 - (2 * ty) / height;
  worldToClip[8] = 1;
  worldToPixel[0] = s;
  worldToPixel[1] = s;
  worldToPixel[2] = tx;
  worldToPixel[3] = ty;
}

/** Where the camera of a view stands and looks: map metres and metres as drawn. One object, refilled in place. */
export interface CameraPose {
  pitch: number;
  yaw: number;
  tilted: boolean;
  rise: number;
  /** CSS pixels on screen per unit of (offset across the view axis / depth along it). */
  focal: number;
  /** From the eye to the target. */
  distance: number;
  readonly target: Float64Array;
  readonly eye: Float64Array;
  readonly right: Float64Array;
  readonly up: Float64Array;
  readonly forward: Float64Array;
}
export const createCameraPose = (): CameraPose => ({ pitch: 0, yaw: 0, tilted: false, rise: 0, focal: 1, distance: 1, target: new Float64Array(3), eye: new Float64Array(3), right: new Float64Array(3), up: new Float64Array(3), forward: new Float64Array(3) });

/** The pose of the camera of `view` in a viewport `cssH` CSS pixels high. With a relief the target sits on the
 * ground and the eye stays above it: an eye that would be inside a slope is lifted and aimed at the target again. */
export function poseCamera(pose: CameraPose, view: View, cssH: number, relief?: WorldRelief): CameraPose {
  const pitch = clampPitch(view.pitch),
    yaw = wrapYaw(view.yaw),
    rise = riseAt(pitch);
  const sinYaw = Math.sin(yaw),
    cosYaw = Math.cos(yaw);
  let sinPitch = Math.sin(pitch),
    cosPitch = Math.cos(pitch);
  const focal = cssH / (2 * TAN_HALF_FIELD);
  let distance = focal / view.scale;
  const { target, eye, right, up, forward } = pose;
  target[0] = view.cx;
  target[1] = view.cy;
  target[2] = relief && rise > 0 ? relief.heightAt(view.cx, view.cy) * rise : 0;
  // The ground direction at the top of the screen is (sinYaw, -cosYaw): north at yaw 0.
  eye[0] = target[0] - sinYaw * sinPitch * distance;
  eye[1] = target[1] + cosYaw * sinPitch * distance;
  eye[2] = target[2] + cosPitch * distance;
  if (relief && rise > 0) {
    const floor = relief.heightAt(eye[0], eye[1]) * rise + Math.max(0.3, distance * 0.01);
    if (eye[2] < floor) {
      eye[2] = floor;
      const flat = Math.hypot(target[0] - eye[0], target[1] - eye[1]);
      distance = Math.hypot(flat, eye[2] - target[2]);
      sinPitch = flat / distance;
      cosPitch = (eye[2] - target[2]) / distance;
    }
  }
  right[0] = cosYaw;
  right[1] = sinYaw;
  right[2] = 0;
  up[0] = sinYaw * cosPitch;
  up[1] = -cosYaw * cosPitch;
  up[2] = sinPitch;
  forward[0] = sinYaw * sinPitch;
  forward[1] = -cosYaw * sinPitch;
  forward[2] = -cosPitch;
  pose.pitch = pitch;
  pose.yaw = yaw;
  pose.tilted = pitch > 0 || yaw !== 0;
  pose.rise = rise;
  pose.focal = focal;
  pose.distance = distance;
  return pose;
}

/** The frame camera the compositor refills in place; layers receive it as a FrameCamera. */
export type WritableFrameCamera = { -readonly [K in keyof FrameCamera]: FrameCamera[K] } & { readonly pose: CameraPose };
export function createFrameCamera(): WritableFrameCamera {
  const pose = createCameraPose();
  return { pose, pitch: 0, yaw: 0, tilted: false, rise: 0, viewProjection: new Float32Array(16), targetViewProjection: new Float32Array(16), target: pose.target, eye: pose.eye, right: pose.right, up: pose.up, forward: pose.forward, focal: 1, near: 0, far: 1 };
}

/** One row set of a perspective matrix: `tr`, `tu`, `tf` are the eye-relative origin along right, up and forward. */
function perspective(m: Float32Array, pose: CameraPose, kx: number, ky: number, a: number, b: number, tr: number, tu: number, tf: number): void {
  const { right, up, forward } = pose;
  for (let c = 0; c < 3; c++) {
    m[c * 4] = kx * right[c];
    m[c * 4 + 1] = ky * up[c];
    m[c * 4 + 2] = a * forward[c];
    m[c * 4 + 3] = forward[c];
  }
  m[12] = kx * tr;
  m[13] = ky * tu;
  m[14] = a * tf + b;
  m[15] = tf;
}

/** Fills the camera of a frame: `cssW` x `cssH` CSS pixels drawn into `width` x `height` device pixels. */
export function frameCamera(camera: WritableFrameCamera, view: View, cssW: number, cssH: number, width: number, height: number, dpr: number, relief?: WorldRelief): void {
  const pose = poseCamera(camera.pose, view, cssH, relief),
    { target, eye, right, up, forward } = pose;
  camera.pitch = pose.pitch;
  camera.yaw = pose.yaw;
  camera.tilted = pose.tilted;
  camera.rise = pose.rise;
  camera.focal = pose.focal * dpr;
  const absolute = camera.viewProjection,
    relative = camera.targetViewProjection;
  if (!pose.tilted) {
    // The mapping of the 2D map (topViewMapping), z ignored.
    const s = view.scale * dpr;
    absolute.fill(0);
    relative.fill(0);
    absolute[0] = relative[0] = (2 * s) / width;
    absolute[5] = relative[5] = (-2 * s) / height;
    absolute[12] = (2 * (width / 2 - view.cx * s)) / width - 1;
    absolute[13] = 1 - (2 * (height / 2 - view.cy * s)) / height;
    absolute[15] = relative[15] = 1;
    camera.near = 0;
    camera.far = pose.distance;
    return;
  }
  // The far plane holds the whole map; the near one stays under the clearance the eye keeps over the ground.
  let reach = pose.distance * 16;
  if (relief) reach = Math.hypot(Math.max(Math.abs(eye[0]), Math.abs(eye[0] - relief.width)), Math.max(Math.abs(eye[1]), Math.abs(eye[1] - relief.width)), eye[2] - relief.low * pose.rise);
  const near = Math.max(0.1, pose.distance * 0.004),
    far = Math.max(reach * 1.02, pose.distance * 2),
    a = (far + near) / (far - near),
    b = (-2 * far * near) / (far - near);
  const kx = (2 * camera.focal) / width,
    ky = (2 * camera.focal) / height;
  const along = (axis: Float64Array, x: number, y: number, z: number): number => axis[0] * x + axis[1] * y + axis[2] * z;
  perspective(absolute, pose, kx, ky, a, b, -along(right, eye[0], eye[1], eye[2]), -along(up, eye[0], eye[1], eye[2]), -along(forward, eye[0], eye[1], eye[2]));
  const ox = target[0] - eye[0],
    oy = target[1] - eye[1],
    oz = target[2] - eye[2];
  perspective(relative, pose, kx, ky, a, b, along(right, ox, oy, oz), along(up, ox, oy, oz), along(forward, ox, oy, oz));
  camera.near = near;
  camera.far = far;
}

/** Steps of the walk along a ray, and of the bisection that follows. */
const RAY_STEPS = 160,
  RAY_REFINE = 12;

/** The ground point under the CSS pixel (sx, sy) of a `cssW` x `cssH` viewport, into `out` (x, y). With a relief:
 * the first point of the terrain the ray meets. Without: the horizontal plane through the target. False when the ray
 * meets no ground (it points at or above the horizon). */
export function groundPoint(pose: CameraPose, sx: number, sy: number, cssW: number, cssH: number, relief: WorldRelief | undefined, out: [number, number]): boolean {
  const { eye, right, up, forward, target } = pose,
    u = (sx - cssW / 2) / pose.focal,
    v = (cssH / 2 - sy) / pose.focal;
  const dx = forward[0] + u * right[0] + v * up[0],
    dy = forward[1] + u * right[1] + v * up[1],
    dz = forward[2] + u * right[2] + v * up[2];
  if (!relief || pose.rise === 0) {
    if (dz > -1e-6) return false;
    const t = (target[2] - eye[2]) / dz;
    out[0] = eye[0] + dx * t;
    out[1] = eye[1] + dy * t;
    return true;
  }
  const rise = pose.rise,
    above = (t: number): number => eye[2] + dz * t - relief.heightAt(eye[0] + dx * t, eye[1] + dy * t) * rise;
  // The ray is below every ground of the map from `end` on (a descending ray), or has left the map (a level one).
  const end = dz < -1e-6 ? (relief.low * rise - eye[2]) / dz : relief.width * 3;
  let before = 0,
    t = 0;
  for (let step = 0; step < RAY_STEPS && before < end; step++) {
    t = Math.min(end, before + Math.max(pose.distance * 0.02, before * 0.06));
    if (above(t) <= 0) {
      let low = before,
        high = t;
      for (let i = 0; i < RAY_REFINE; i++) {
        const middle = (low + high) / 2;
        if (above(middle) <= 0) high = middle;
        else low = middle;
      }
      out[0] = eye[0] + dx * high;
      out[1] = eye[1] + dy * high;
      return true;
    }
    before = t;
  }
  if (dz > -1e-6) return false;
  out[0] = eye[0] + dx * end;
  out[1] = eye[1] + dy * end;
  return true;
}

const scratch = createCameraPose(),
  from: [number, number] = [0, 0],
  to: [number, number] = [0, 0];
/** A cursor near the horizon points kilometres away. A drag moves the centre at most this many times what it moves it
 * in the top view, and a zoom is anchored at most this many half-views from the centre. */
const PAN_REACH = 6;

/** Pans a tilted view: the ground under (x0, y0) comes under (x1, y1), CSS pixels of a `cssW` x `cssH` viewport. The
 * ground is the horizontal plane through the target, so the camera slides without bobbing over the relief. */
export function panOnGround(view: View, x0: number, y0: number, x1: number, y1: number, cssW: number, cssH: number): View {
  const pose = poseCamera(scratch, view, cssH);
  if (!groundPoint(pose, x0, y0, cssW, cssH, undefined, from) || !groundPoint(pose, x1, y1, cssW, cssH, undefined, to)) return view;
  let dx = to[0] - from[0],
    dy = to[1] - from[1];
  const limit = (PAN_REACH * Math.hypot(x1 - x0, y1 - y0)) / view.scale,
    length = Math.hypot(dx, dy);
  if (length > limit && length > 0) {
    dx *= limit / length;
    dy *= limit / length;
  }
  return { ...view, cx: view.cx - dx, cy: view.cy - dy };
}

/** Zooms a tilted view by `factor` towards the ground under the CSS pixel (sx, sy): the terrain point with a relief,
 * the plane through the target without. The centre slides towards that point as the eye comes closer, which keeps it
 * under the cursor. */
export function zoomAtGround(view: View, factor: number, sx: number, sy: number, cssW: number, cssH: number, relief?: WorldRelief): View {
  const pose = poseCamera(scratch, view, cssH, relief),
    scale = view.scale * factor;
  if (!groundPoint(pose, sx, sy, cssW, cssH, relief, from)) return { ...view, scale };
  // A cursor near the horizon points kilometres away: the anchor stays within reach of the centre.
  let ax = from[0] - view.cx,
    ay = from[1] - view.cy;
  const limit = (PAN_REACH * Math.max(cssW, cssH)) / (2 * view.scale),
    length = Math.hypot(ax, ay);
  if (length > limit) {
    ax *= limit / length;
    ay *= limit / length;
  }
  return { ...view, scale, cx: view.cx + ax - ax / factor, cy: view.cy + ay - ay / factor };
}
