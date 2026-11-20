/**
 * The camera of the world view (contract.ts): pure math, no GL and no DOM.
 *
 * A view is a centre on the ground, a scale in CSS pixels per metre, a pitch (0 looks straight down) and a yaw (the
 * compass direction at the top of the screen). The eye looks at the ground point of the centre from the distance at
 * which that point is seen at the view's scale, so zooming feels the same at every pitch; in the top view the
 * projection is the orthographic mapping of the 2D map (`topViewMapping`), which a perspective looking straight down
 * at a flat map equals. The relief rises with the pitch (`riseAt`), so the two meet without a jump.
 *
 * A free eye (View.eye: walking, flying; navigation.ts) stands over the view's centre at its own altitude and looks
 * along its pitch and yaw, past the horizon if it likes; the relief then stands at its full height, and the target is
 * the ground under the eye.
 *
 * Callers: the live compositor fills `LiveFrame.camera` with `frameCamera` once per frame; the viewer (ui/viewer.ts)
 * pans and zooms a tilted view with `panOnGround` and `zoomAtGround`, and shows the view's footprint on the miniature
 * (`viewFootprint`); the page picks with `groundHit` and draws its overlays with `screenProjection`.
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
export const isTilted = (view: View): boolean => isFreeEye(view) || clampPitch(view.pitch) > 0 || wrapYaw(view.yaw) !== 0;
/** The view is a free eye (walking, flying), not the orbit camera. */
export const isFreeEye = (view: View): boolean => Number.isFinite(view.eye);
/** Height of a walking eye above the ground, metres: the separate 3D view's. */
export const WALK_EYE_HEIGHT = 1.7;
/** Pitch of a free eye: from nearly straight down to well above the horizon (69 degrees up). */
const FREE_PITCH_MIN = 0.05,
  FREE_PITCH_MAX = Math.PI / 2 + 1.2;
export const clampLook = (pitch: number | undefined): number => (Number.isFinite(pitch) ? Math.max(FREE_PITCH_MIN, Math.min(FREE_PITCH_MAX, pitch!)) : Math.PI / 2);
/** How far a free eye looks (CameraPose.distance), at least: the haze is twice that, the separate 3D view's walking
 * fog; on a map wider than it, the side of the map. */
const FREE_REACH = 2500;
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
  /** A free eye (View.eye). */
  free: boolean;
  rise: number;
  /** CSS pixels on screen per unit of (offset across the view axis / depth along it). */
  focal: number;
  /** How far the camera looks (FrameCamera.distance): from the eye to the target in the orbit, the reach of a free eye. */
  distance: number;
  /** Height of the eye above the ground under it (metres as drawn; above the target's level without a relief). */
  clearance: number;
  /** Level of the horizontal plane a pixel falls on when there is no relief to meet: the target's, or the ground under
   * a free eye. */
  plane: number;
  readonly target: Float64Array;
  readonly eye: Float64Array;
  readonly right: Float64Array;
  readonly up: Float64Array;
  readonly forward: Float64Array;
}
export const createCameraPose = (): CameraPose => ({
  pitch: 0,
  yaw: 0,
  tilted: false,
  free: false,
  rise: 0,
  focal: 1,
  distance: 1,
  clearance: 1,
  plane: 0,
  target: new Float64Array(3),
  eye: new Float64Array(3),
  right: new Float64Array(3),
  up: new Float64Array(3),
  forward: new Float64Array(3),
});

/** The axes of a camera looking at `pitch` from the vertical towards `yaw`. */
function aim(pose: CameraPose, sinYaw: number, cosYaw: number, sinPitch: number, cosPitch: number): void {
  const { right, up, forward } = pose;
  right[0] = cosYaw;
  right[1] = sinYaw;
  right[2] = 0;
  up[0] = sinYaw * cosPitch;
  up[1] = -cosYaw * cosPitch;
  up[2] = sinPitch;
  forward[0] = sinYaw * sinPitch;
  forward[1] = -cosYaw * sinPitch;
  forward[2] = -cosPitch;
}

/** The pose of a free eye: over (cx, cy) at its altitude, never closer to the ground than a walking eye, the relief at
 * its full height. */
function poseFreeEye(pose: CameraPose, view: View, cssH: number, relief?: WorldRelief): CameraPose {
  const pitch = clampLook(view.pitch),
    yaw = wrapYaw(view.yaw),
    ground = relief ? relief.heightAt(view.cx, view.cy) : 0,
    altitude = Math.max(view.eye!, ground + WALK_EYE_HEIGHT);
  const { target, eye } = pose;
  target[0] = eye[0] = view.cx;
  target[1] = eye[1] = view.cy;
  target[2] = ground;
  eye[2] = altitude;
  aim(pose, Math.sin(yaw), Math.cos(yaw), Math.sin(pitch), Math.cos(pitch));
  pose.pitch = pitch;
  pose.yaw = yaw;
  pose.tilted = pose.free = true;
  pose.rise = 1;
  pose.focal = cssH / (2 * TAN_HALF_FIELD);
  pose.distance = Math.max(FREE_REACH, relief?.width ?? 0);
  pose.clearance = altitude - ground;
  pose.plane = ground;
  return pose;
}

/** The pose of the camera of `view` in a viewport `cssH` CSS pixels high. With a relief the target sits on the
 * ground and the eye stays above it: an eye that would be inside a slope is lifted and aimed at the target again. */
export function poseCamera(pose: CameraPose, view: View, cssH: number, relief?: WorldRelief): CameraPose {
  if (isFreeEye(view)) return poseFreeEye(pose, view, cssH, relief);
  const pitch = clampPitch(view.pitch),
    yaw = wrapYaw(view.yaw),
    rise = riseAt(pitch);
  const sinYaw = Math.sin(yaw),
    cosYaw = Math.cos(yaw);
  let sinPitch = Math.sin(pitch),
    cosPitch = Math.cos(pitch);
  const focal = cssH / (2 * TAN_HALF_FIELD);
  let distance = focal / view.scale;
  const { target, eye } = pose;
  target[0] = view.cx;
  target[1] = view.cy;
  target[2] = relief && rise > 0 ? relief.heightAt(view.cx, view.cy) * rise : 0;
  // The ground direction at the top of the screen is (sinYaw, -cosYaw): north at yaw 0.
  eye[0] = target[0] - sinYaw * sinPitch * distance;
  eye[1] = target[1] + cosYaw * sinPitch * distance;
  eye[2] = target[2] + cosPitch * distance;
  let clearance = eye[2] - target[2];
  if (relief && rise > 0) {
    const under = relief.heightAt(eye[0], eye[1]) * rise,
      floor = under + Math.max(0.3, distance * 0.01);
    if (eye[2] < floor) {
      eye[2] = floor;
      const flat = Math.hypot(target[0] - eye[0], target[1] - eye[1]);
      distance = Math.hypot(flat, eye[2] - target[2]);
      sinPitch = flat / distance;
      cosPitch = (eye[2] - target[2]) / distance;
    }
    clearance = eye[2] - under;
  }
  aim(pose, sinYaw, cosYaw, sinPitch, cosPitch);
  pose.pitch = pitch;
  pose.yaw = yaw;
  pose.tilted = pitch > 0 || yaw !== 0;
  pose.free = false;
  pose.rise = rise;
  pose.focal = focal;
  pose.distance = distance;
  pose.clearance = clearance;
  pose.plane = target[2];
  return pose;
}

/** The frame camera the compositor refills in place; layers receive it as a FrameCamera. */
export type WritableFrameCamera = { -readonly [K in keyof FrameCamera]: FrameCamera[K] } & { readonly pose: CameraPose };
export function createFrameCamera(): WritableFrameCamera {
  const pose = createCameraPose();
  return {
    pose,
    pitch: 0,
    yaw: 0,
    tilted: false,
    free: false,
    rise: 0,
    viewProjection: new Float32Array(16),
    targetViewProjection: new Float32Array(16),
    target: pose.target,
    eye: pose.eye,
    right: pose.right,
    up: pose.up,
    forward: pose.forward,
    focal: 1,
    distance: 1,
    near: 0,
    far: 1,
  };
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
  camera.free = pose.free;
  camera.rise = pose.rise;
  camera.focal = pose.focal * dpr;
  camera.distance = pose.distance;
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
  // The far plane holds the whole map; the near one stays under the clearance the eye keeps over the ground (a free
  // eye: a walker's feet are 1.7 m below it).
  let reach = pose.distance * 16;
  if (relief) reach = Math.hypot(Math.max(Math.abs(eye[0]), Math.abs(eye[0] - relief.width)), Math.max(Math.abs(eye[1]), Math.abs(eye[1] - relief.width)), eye[2] - relief.low * pose.rise);
  const near = pose.free ? Math.max(0.05, pose.clearance * 0.03) : Math.max(0.1, pose.distance * 0.004),
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

/** The ray of the CSS pixel (sx, sy) of a `cssW` x `cssH` viewport: from the eye along `out` (x, y, z), a direction
 * whose component along the view axis is 1 (so `t` along it is the depth). */
export function pixelRay(pose: CameraPose, sx: number, sy: number, cssW: number, cssH: number, out: Float64Array | number[]): void {
  const { right, up, forward } = pose,
    u = (sx - cssW / 2) / pose.focal,
    v = (cssH / 2 - sy) / pose.focal;
  for (let i = 0; i < 3; i++) out[i] = forward[i] + u * right[i] + v * up[i];
}

const ray = new Float64Array(3);
/** Where the ray of the CSS pixel (sx, sy) meets the ground: `t` along `pixelRay` (its depth), the point into `out`
 * (x, y). With a relief: the first point of the terrain the ray meets. Without: the horizontal plane of the pose
 * (`plane`). Infinity when the ray meets no ground (it points at or above the horizon). */
export function groundHit(pose: CameraPose, sx: number, sy: number, cssW: number, cssH: number, relief: WorldRelief | undefined, out: [number, number]): number {
  const eye = pose.eye;
  pixelRay(pose, sx, sy, cssW, cssH, ray);
  const dx = ray[0],
    dy = ray[1],
    dz = ray[2];
  const at = (t: number): number => {
    out[0] = eye[0] + dx * t;
    out[1] = eye[1] + dy * t;
    return t;
  };
  if (!relief || pose.rise === 0) return dz > -1e-6 ? Infinity : at((pose.plane - eye[2]) / dz);
  const rise = pose.rise,
    above = (t: number): number => eye[2] + dz * t - relief.heightAt(eye[0] + dx * t, eye[1] + dy * t) * rise;
  // The ray is below every ground of the map from `end` on (a descending ray), or has left the map (a level one).
  const end = dz < -1e-6 ? (relief.low * rise - eye[2]) / dz : relief.width * 3;
  // The first step: a fraction of the orbit's distance, or of a free eye's height (a walker's feet are near).
  const first = pose.free ? Math.max(0.25, pose.clearance * 0.25) : pose.distance * 0.02;
  let before = 0,
    t = 0;
  for (let step = 0; step < RAY_STEPS && before < end; step++) {
    t = Math.min(end, before + Math.max(first, before * 0.06));
    if (above(t) <= 0) {
      let low = before,
        high = t;
      for (let i = 0; i < RAY_REFINE; i++) {
        const middle = (low + high) / 2;
        if (above(middle) <= 0) high = middle;
        else low = middle;
      }
      return at(high);
    }
    before = t;
  }
  return dz > -1e-6 ? Infinity : at(end);
}
/** The ground point under a pixel (groundHit), into `out`; false when the ray meets no ground. */
export const groundPoint = (pose: CameraPose, sx: number, sy: number, cssW: number, cssH: number, relief: WorldRelief | undefined, out: [number, number]): boolean => groundHit(pose, sx, sy, cssW, cssH, relief, out) < Infinity;

/** Where the ground points of the map are on screen, for the page's overlays (the selection outline): the 2D mapping in
 * the top view, the camera's perspective onto the relief when tilted. Made once per view. */
export interface ScreenProjection {
  readonly tilted: boolean;
  /** The CSS pixel of the ground point (x, y) into `out`; false when it lies behind the eye. */
  project(x: number, y: number, out: [number, number]): boolean;
}
export function screenProjection(view: View, cssW: number, cssH: number, relief?: WorldRelief): ScreenProjection {
  if (!isTilted(view))
    return {
      tilted: false,
      project(x, y, out) {
        out[0] = (x - view.cx) * view.scale + cssW / 2;
        out[1] = (y - view.cy) * view.scale + cssH / 2;
        return true;
      },
    };
  const pose = poseCamera(createCameraPose(), view, cssH, relief),
    { eye, right, up, forward, rise } = pose,
    near = Math.max(0.05, pose.clearance * 0.03);
  return {
    tilted: true,
    project(x, y, out) {
      const dx = x - eye[0],
        dy = y - eye[1],
        dz = (relief ? relief.heightAt(x, y) * rise : pose.plane) - eye[2];
      const depth = dx * forward[0] + dy * forward[1] + dz * forward[2];
      if (depth < near) return false;
      out[0] = cssW / 2 + (pose.focal * (dx * right[0] + dy * right[1] + dz * right[2])) / depth;
      out[1] = cssH / 2 - (pose.focal * (dx * up[0] + dy * up[1] + dz * up[2])) / depth;
      return true;
    },
  };
}

/** How far the miniature draws the footprint of a tilted view towards its horizon, in camera distances of the orbit. */
const FOOTPRINT_REACH = 8;
const corner: [number, number] = [0, 0];
/** The ground a tilted view sees, for the miniature: the points under the four corners of the viewport on the plane of
 * the pose (top left, top right, bottom right, bottom left), into `out` (x0, y0, ... x3, y3). A corner above the
 * horizon, or further than FOOTPRINT_REACH distances (a free eye: its reach), is cut there along its ray. */
export function viewFootprint(view: View, cssW: number, cssH: number, relief: WorldRelief | undefined, out: Float64Array | number[]): void {
  const pose = poseCamera(scratch, view, cssH, relief),
    reach = pose.free ? pose.distance : pose.distance * FOOTPRINT_REACH,
    eye = pose.eye;
  const corners = [0, 0, cssW, 0, cssW, cssH, 0, cssH];
  for (let i = 0; i < 4; i++) {
    let t = groundHit(pose, corners[i * 2], corners[i * 2 + 1], cssW, cssH, undefined, corner);
    const flat = Math.hypot(ray[0], ray[1]);
    if (flat > 1e-9) t = Math.min(t, reach / flat);
    if (!(t < Infinity)) t = 0;
    out[i * 2] = eye[0] + ray[0] * t;
    out[i * 2 + 1] = eye[1] + ray[1] * t;
  }
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
