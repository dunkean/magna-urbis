/**
 * Walking and flying with the camera of the world view (contract.ts): a free eye (View.eye), entered from the orbit
 * camera and left back to it, moved by held keys and turned by the pointer. Pure math on views; the viewer
 * (ui/viewer.ts) holds the mode and the input, the camera (camera.ts) makes the pose of a free eye.
 *
 * The keys and speeds are those of the separate 3D view (ui/view3d/terrain/navigation.ts): walking keeps the eye at a
 * person's height over the ground; flying moves along the look, its vertical keys change the altitude, which is kept
 * when the ground falls away and lifted when it rises.
 */
import type { View } from '../view';
import { WALK_EYE_HEIGHT, clampLook, clampPitch, createCameraPose, groundHit, isFreeEye, poseCamera, wrapYaw } from './camera';
import type { WorldRelief } from './contract';
import type { Terrain3dCollisions } from './terrain3dCollisions';

export type Navigation = 'orbit' | 'walk' | 'fly';

/** Metres per second, and the factor of Shift (the separate 3D view's). */
export const WALK_SPEED = 12,
  FLIGHT_SPEED = 60,
  WALK_FAST = 3,
  FLIGHT_FAST = 4;
/** Radians per CSS pixel of a look drag. */
export const LOOK_RATE = 0.003;
/** Pitch of a walker who arrives: just under the horizon (the separate 3D view's 0.08 rad below it). */
const ARRIVAL_PITCH = Math.PI / 2 - 0.08;
/** Back to the orbit: the ground looked at becomes its centre when it lies within this many viewport heights (at the
 * orbit's scale) of the eye. */
const ORBIT_REACH = 4;

const ground = (relief: WorldRelief | undefined, x: number, y: number): number => (relief ? relief.heightAt(x, y) : 0);
/** The altitude of a walking eye over (x, y). */
export const walkingEye = (relief: WorldRelief | undefined, x: number, y: number): number => ground(relief, x, y) + WALK_EYE_HEIGHT;

const pose = createCameraPose(),
  point: [number, number] = [0, 0];
const walkPoint: [number, number] = [0, 0];

/** The free eye that takes over from an orbit view: a walker stands at its centre and looks at the horizon the way the
 * view faced; a flyer is the orbit's eye itself, looking where it looked. */
export function enterFreeEye(view: View, mode: 'walk' | 'fly', cssH: number, relief?: WorldRelief): View {
  const orbit = poseCamera(pose, { cx: view.cx, cy: view.cy, scale: view.scale, pitch: view.pitch, yaw: view.yaw }, cssH, relief);
  if (mode === 'walk') return { cx: view.cx, cy: view.cy, scale: view.scale, pitch: ARRIVAL_PITCH, yaw: orbit.yaw, eye: walkingEye(relief, view.cx, view.cy) };
  return { cx: orbit.eye[0], cy: orbit.eye[1], scale: view.scale, pitch: clampLook(orbit.pitch), yaw: orbit.yaw, eye: Math.max(orbit.eye[2], walkingEye(relief, orbit.eye[0], orbit.eye[1])) };
}

/** Another free mode at the same place: a walker who takes off keeps his eye; a flyer who lands stands on the ground. */
export function switchFreeEye(view: View, mode: 'walk' | 'fly', relief?: WorldRelief): View {
  return { ...view, eye: mode === 'walk' ? walkingEye(relief, view.cx, view.cy) : Math.max(view.eye ?? 0, walkingEye(relief, view.cx, view.cy)) };
}

/** The orbit view that takes over from a free eye at `pitch`: centred on the ground the eye looks at when it is near
 * enough, else where the eye stands; the scale is the orbit's own (`view.scale`, kept through the walk). */
export function leaveFreeEye(view: View, pitch: number, cssW: number, cssH: number, relief?: WorldRelief): View {
  const yaw = wrapYaw(view.yaw);
  if (!isFreeEye(view)) return { cx: view.cx, cy: view.cy, scale: view.scale, pitch: clampPitch(pitch), yaw };
  const free = poseCamera(pose, view, cssH, relief),
    reach = (ORBIT_REACH * cssH) / view.scale,
    t = groundHit(free, cssW / 2, cssH / 2, cssW, cssH, relief, point),
    near = t < Infinity && Math.hypot(point[0] - view.cx, point[1] - view.cy) <= reach;
  return { cx: near ? point[0] : view.cx, cy: near ? point[1] : view.cy, scale: view.scale, pitch: clampPitch(pitch), yaw };
}

/** A free eye moved for `seconds` by held keys: `forward` and `right` in -1..1 (and `up` when flying), `fast` with
 * Shift. Walking goes along the ground the eye faces and stays at a person's height over it; flying goes along the look
 * at its altitude, never closer to the ground than a walking eye. */
export function moveFreeEye(view: View, mode: 'walk' | 'fly', forward: number, right: number, up: number, seconds: number, fast: boolean, relief?: WorldRelief, collisions?: Terrain3dCollisions): View {
  const yaw = wrapYaw(view.yaw),
    sinYaw = Math.sin(yaw),
    cosYaw = Math.cos(yaw);
  if (mode === 'walk') {
    const step = (WALK_SPEED * (fast ? WALK_FAST : 1) * seconds) / Math.max(1, Math.hypot(forward, right)),
      dx = (forward * sinYaw + right * cosYaw) * step,
      dy = (-forward * cosYaw + right * sinYaw) * step;
    let cx = view.cx + dx,
      cy = view.cy + dy;
    if (collisions) [cx, cy] = collisions.move(view.cx, view.cy, dx, dy, undefined, 1, walkPoint);
    return { ...view, cx, cy, eye: walkingEye(relief, cx, cy) };
  }
  const pitch = clampLook(view.pitch),
    along = Math.sin(pitch),
    dx = right * cosYaw + forward * sinYaw * along,
    dy = right * sinYaw - forward * cosYaw * along,
    dz = up - forward * Math.cos(pitch);
  const step = (FLIGHT_SPEED * (fast ? FLIGHT_FAST : 1) * seconds) / Math.max(1, Math.hypot(dx, dy, dz)),
    cx = view.cx + dx * step,
    cy = view.cy + dy * step,
    altitude = Math.max(view.eye ?? 0, walkingEye(relief, view.cx, view.cy));
  return { ...view, cx, cy, eye: Math.max(altitude + dz * step, walkingEye(relief, cx, cy)) };
}

/** A free eye turned by a look drag of (dx, dy) CSS pixels: right turns right, down looks down. */
export function lookFreeEye(view: View, dx: number, dy: number): View {
  return { ...view, yaw: wrapYaw((view.yaw ?? 0) + dx * LOOK_RATE), pitch: clampLook(clampLook(view.pitch) - dy * LOOK_RATE) };
}
