/**
 * Camera matrices, orbit framing and ground clearance, called by terrain navigation and owners.
 * Reads/writes: Reads terrain/cavern geometry and viewport policy; writes camera, town framing and settle scheduling on the supplied context. Matrix helpers allocate local outputs.
 */
import { cavernRoofAt } from '../../render/underdarkCavern';
import { groundNavigationScale, navigationFogDistance, WALK_EYE_HEIGHT } from '../terrain3dNavigation';
import { TERRAIN_3D_SETTLE_MS } from '../terrain3dResolution';
import { Vec3, FrameGeometry, Terrain3dCamera } from './terrainTypes';
import { FOV, clamp } from './terrainPolicy';
import type { Terrain3dContext } from './terrainContext';

function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    }
  return out;
}

function normalize(v: Vec3): Vec3 {
  const scale = 1 / Math.max(1e-12, Math.hypot(...v));
  return [v[0] * scale, v[1] * scale, v[2] * scale];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function lookAt(eye: Vec3, target: Vec3): Float32Array {
  const z = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const x = normalize(cross([0, 1, 0], z)),
    y = cross(z, x);
  const dot = (v: Vec3): number => -(v[0] * eye[0] + v[1] * eye[1] + v[2] * eye[2]);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, dot(x), dot(y), dot(z), 1]);
}

function perspective(aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(FOV / 2),
    q = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * q, -1, 0, 0, 2 * far * near * q, 0]);
}

export function frameGeometry(context: Terrain3dContext): FrameGeometry {
  const c = context.camera,
    targetHeight = context.heightAt(c.x, c.y)! * c.exaggeration;
  if (c.navigation === 'walk' || c.navigation === 'fly') {
    const eye: Vec3 = [0, c.navigation === 'fly' ? (c.flightAltitude ?? targetHeight / c.exaggeration + 30) * c.exaggeration - targetHeight : WALK_EYE_HEIGHT, 0];
    const forward: Vec3 = [-Math.sin(c.yaw) * Math.cos(c.pitch), -Math.sin(c.pitch), -Math.cos(c.yaw) * Math.cos(c.pitch)];
    const right = normalize(cross(forward, [0, 1, 0])),
      up = cross(right, forward);
    const view = lookAt(eye, [forward[0], eye[1] + forward[1], forward[2]]);
    const far = Math.max(c.distance * 4, context.layer!.width * 2 + context.heightRange * c.exaggeration * 2);
    return { eye, targetHeight, matrix: multiply(perspective(context.width / context.height, 0.02, far), view), focal: context.height / (2 * Math.tan(FOV / 2)), right, up, forward };
  }
  const eye: Vec3 = [Math.sin(c.yaw) * Math.cos(c.pitch) * c.distance, Math.sin(c.pitch) * c.distance, Math.cos(c.yaw) * Math.cos(c.pitch) * c.distance];
  const ex = c.x + eye[0],
    ey = c.y + eye[2];
  const clearance = Math.max(0.15, c.distance * 0.0015);
  const ground = context.heightAt(ex, ey)! * c.exaggeration - targetHeight;
  eye[1] = Math.max(eye[1], ground + clearance);
  const forward = normalize([-eye[0], -eye[1], -eye[2]]),
    right = normalize(cross(forward, [0, 1, 0])),
    up = cross(right, forward);
  const view = lookAt(eye, [0, 0, 0]);
  const far = Math.max(c.distance * 4, context.layer!.width * 2 + context.heightRange * c.exaggeration * 2);
  const matrix = multiply(perspective(context.width / context.height, Math.max(0.02, c.distance * 0.0002), far), view);
  return { eye, targetHeight, matrix, focal: context.height / (2 * Math.tan(FOV / 2)), right, up, forward };
}

/** One atmospheric distance for terrain, trees and billboards, shared by both GPU backends. */
export function fogDistance(context: Terrain3dContext): number {
  return navigationFogDistance(context.camera.navigation, context.camera.distance, context.layer?.width ?? 0);
}

/** The camera of a framing view of (point, distance): in the Underdark a whole-map frame becomes the first town seen
 * from inside its chamber, the eye under the roof where the chamber allows. */
export function framingView(context: Terrain3dContext, x: number, y: number, distance: number): { x: number; y: number; distance: number; pitch: number } {
  const town = context.groundSettings?.townSites ?? context.groundSettings?.townGlow,
    layer = context.layer,
    field = context.cavern;
  context.townFrame = undefined;
  if (context.groundSettings?.underdark && field && layer && distance > layer.width * 0.25) {
    if (town && town.length >= 3) {
      const headroom = cavernRoofAt(field, town[0], town[1]) - (context.heightAt(town[0], town[1]) ?? 0);
      const near = Math.min(clamp(town[2] * 1.6, 320, 700), Math.max(220, ((0.7 * headroom) / Math.sin(0.16)) * context.camera.exaggeration));
      return { x: town[0], y: town[1], distance: near, pitch: context.framingPitch(town[0], town[1], near) };
    }
    // No town known yet: the most open chamber near the centre, until the towns arrive (setGroundMaterial).
    let best = -Infinity,
      bx = x,
      by = y;
    const n = field.n,
      cell = field.width / n;
    for (let i = 0; i < n * n; i += 3) {
      const px = field.x + ((i % n) + 0.5) * cell,
        py = field.y + (Math.floor(i / n) + 0.5) * cell;
      const score = field.texels[i * 4 + 2] - Math.hypot(px - x, py - y) / field.width;
      if (score > best) {
        best = score;
        bx = px;
        by = py;
      }
    }
    const view = { x: bx, y: by, distance: 450, pitch: context.framingPitch(bx, by, 450) };
    context.townFrame = { ...view };
    return view;
  }
  if (context.groundSettings?.underdark && field) {
    // A town frame in the cave: near enough that the eye stays under the roof of its chamber.
    const headroom = cavernRoofAt(field, x, y) - (context.heightAt(x, y) ?? 0),
      near = Math.min(distance, Math.max(220, ((0.7 * headroom) / Math.sin(0.16)) * context.camera.exaggeration));
    return { x, y, distance: near, pitch: context.framingPitch(x, y, near) };
  }
  return { x, y, distance, pitch: context.framingPitch(x, y, distance) };
}

/** Pitch of a framing view of (x, y) at an orbit distance: the Underdark looks across the cave from a low angle, the
 * eye under the roof where the chamber allows (the far vault, its stalactites and the far chambers then show). */
export function framingPitch(context: Terrain3dContext, x?: number, y?: number, distance?: number): number {
  if (!context.groundSettings?.underdark || !context.cavern) return 0.82;
  if (x === undefined || y === undefined || !distance) return 0.36;
  const headroom = cavernRoofAt(context.cavern, x, y) - (context.heightAt(x, y) ?? 0);
  return clamp(Math.asin(clamp((0.75 * headroom) / (distance / Math.max(context.camera.exaggeration, 0.2)), 0, 1)), 0.16, 0.36);
}

export function setCamera(context: Terrain3dContext, camera: Terrain3dCamera): void {
  context.stopWalking();
  context.camera = { ...camera };
  context.limitCamera();
  if (context.active) context.cameraMoving();
  context.request();
}

export function getCamera(context: Terrain3dContext): Terrain3dCamera {
  return { ...context.camera };
}

export function fit(context: Terrain3dContext, x?: number, y?: number, visibleWidth?: number): void {
  if (!context.layer) return;
  context.stopWalking();
  const layer = context.layer,
    span = visibleWidth ?? layer.width,
    town = context.groundSettings?.townSites ?? context.groundSettings?.townGlow;
  // Underdark: open on the first town, from inside its chamber, the eye under the roof where it allows.
  if (x === undefined && y === undefined && context.groundSettings?.underdark && context.cavern && town && town.length >= 3) {
    // Near enough that the eye stays under the roof of the chamber at the framing pitch.
    const headroom = cavernRoofAt(context.cavern, town[0], town[1]) - (context.heightAt(town[0], town[1]) ?? 0);
    const distance = Math.min(clamp(town[2] * 1.6, 320, 700), Math.max(220, ((0.7 * headroom) / Math.sin(0.16)) * context.camera.exaggeration));
    context.camera = { ...context.camera, navigation: 'orbit', x: town[0], y: town[1], distance, yaw: 0.5, pitch: context.framingPitch(town[0], town[1], distance) };
    context.changed();
    return;
  }
  context.camera = {
    ...context.camera,
    navigation: 'orbit',
    x: x ?? layer.x + layer.width / 2,
    y: y ?? layer.y + layer.width / 2,
    distance: (Math.max(span, context.heightRange * context.camera.exaggeration) / (2 * Math.tan(FOV / 2))) * Math.max(1, context.height / context.width) * 1.18,
    yaw: 0,
    pitch: context.groundSettings?.underdark && context.cavern ? 0.36 : 0.88,
  };
  context.changed();
}

/** Zooms the orbit distance. With a cursor position (CSS pixels in the canvas) the ground point under the
 * cursor stays under it: the orbit target slides toward that point in proportion to the distance change. */
export function zoom(context: Terrain3dContext, factor: number, cursorX?: number, cursorY?: number): void {
  if (!Number.isFinite(factor) || factor <= 0) return;
  if (context.camera.navigation === 'walk' || context.camera.navigation === 'fly') return;
  const before = context.camera.distance,
    anchor = cursorX === undefined || cursorY === undefined ? null : context.cursorGround(cursorX, cursorY);
  context.camera.distance = before / factor ** context.navigationScale();
  context.limitCamera();
  if (anchor) {
    const k = context.camera.distance / before,
      c = context.camera;
    c.x = anchor[0] + (c.x - anchor[0]) * k;
    c.y = anchor[1] + (c.y - anchor[1]) * k;
  }
  context.changed();
}

/** Ground point under a canvas pixel: the terrain hit, else the horizontal plane through the orbit target. */
export function cursorGround(context: Terrain3dContext, x: number, y: number): [number, number] | null {
  const hit = context.screenToWorld(x, y);
  if (hit) return hit;
  if (!context.layer || !context.active) return null;
  const frame = context.frameGeometry(),
    c = context.camera;
  const u = (x - context.width / 2) / frame.focal,
    v = (context.height / 2 - y) / frame.focal;
  const dy = frame.forward[1] + u * frame.right[1] + v * frame.up[1];
  if (dy >= -1e-4) return null;
  const t = -frame.eye[1] / dy;
  if (!(t > 0)) return null;
  return [c.x + frame.eye[0] + (frame.forward[0] + u * frame.right[0] + v * frame.up[0]) * t, c.y + frame.eye[2] + (frame.forward[2] + u * frame.right[2] + v * frame.up[2]) * t];
}

export function north(context: Terrain3dContext): void {
  context.camera.yaw = 0;
  context.changed();
}

export function limitCamera(context: Terrain3dContext): void {
  const width = context.layer?.width ?? 1000,
    c = context.camera;
  c.x = clamp(Number.isFinite(c.x) ? c.x : width / 2, context.layer?.x ?? 0, (context.layer?.x ?? 0) + width);
  c.y = clamp(Number.isFinite(c.y) ? c.y : width / 2, context.layer?.y ?? 0, (context.layer?.y ?? 0) + width);
  const minimumDistance = context.options.navigation ? 2.5 : context.height / (2 * Math.tan(FOV / 2) * context.maxScale());
  c.distance = clamp(Number.isFinite(c.distance) ? c.distance : width, minimumDistance, Math.max(width * 5, minimumDistance));
  if (!context.options.navigation) c.navigation = 'orbit';
  if (c.navigation === 'fly') {
    const ground = context.heightAt(c.x, c.y) ?? 0;
    c.flightAltitude = clamp(Number.isFinite(c.flightAltitude) ? c.flightAltitude! : ground + 30, ground + WALK_EYE_HEIGHT, ground + width * 5);
  }
  c.pitch = clamp(Number.isFinite(c.pitch) ? c.pitch : 0.8, c.navigation === 'walk' || c.navigation === 'fly' ? -1.45 : 0.14, c.navigation === 'walk' || c.navigation === 'fly' ? 1.45 : 1.48);
  c.yaw = Number.isFinite(c.yaw) ? ((((c.yaw + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI : 0;
  c.exaggeration = clamp(Number.isFinite(c.exaggeration) ? c.exaggeration : 1, 0.2, 5);
}

export function cameraMoving(context: Terrain3dContext): void {
  context.cameraMovedAt = performance.now();
  clearTimeout(context.settleTimer);
  context.settleTimer = setTimeout(() => context.request(), TERRAIN_3D_SETTLE_MS + 1);
}

export function changed(context: Terrain3dContext): void {
  context.cameraMoving();
  context.limitCamera();
  context.keepEyeOutOfGround();
  context.request();
  context.onChange();
}

/** Orbit: the eye never sits inside the ground (a hillside, a cave wall, the rock under the Underdark roof). An eye
 * below the surface at its own position comes back along the orbit towards the target (same target and angles, a
 * shorter distance) to the first free position, with a small clearance. A few height lookups, on camera changes only. */
export function keepEyeOutOfGround(context: Terrain3dContext): void {
  const c = context.camera;
  if (c.navigation === 'walk' || c.navigation === 'fly' || !context.layer || !context.options.navigation) return;
  const target = context.heightAt(c.x, c.y) ?? 0,
    minimum = 2.5;
  const free = (d: number): boolean => {
    const h = Math.cos(c.pitch) * d,
      ground = context.heightAt(c.x + Math.sin(c.yaw) * h, c.y + Math.cos(c.yaw) * h);
    return ground === undefined || target + (Math.sin(c.pitch) * d) / c.exaggeration >= ground + Math.max(0.5, d * 0.002);
  };
  if (free(c.distance)) return;
  let d = c.distance;
  for (let k = 0; k < 48 && d > minimum && !free(d); k++) d *= 0.92;
  c.distance = Math.max(minimum, d);
}

export function navigationDistance(context: Terrain3dContext): number {
  const c = context.camera;
  if (!context.options.navigation || !context.layer) return c.distance;
  const frame = context.frameGeometry();
  const ground = context.heightAt(c.x + frame.eye[0], c.y + frame.eye[2])! * c.exaggeration;
  const clearance = frame.targetHeight + frame.eye[1] - ground;
  // Driven by the orbit distance with a floor: an eye grazing (or touching) the ground never stalls zoom, orbit or pan.
  return Math.min(c.distance, Math.max(2, c.distance * 0.3, clearance * 2));
}

export function navigationScale(context: Terrain3dContext): number {
  if (!context.options.navigation) return 1;
  const distance = context.navigationDistance();
  // A wheel step always zooms at a usable rate; the minimum orbit distance (limitCamera) stops it, not a slowdown.
  return Math.max(0.35, (groundNavigationScale(context.camera.distance, distance / 2) * distance) / context.camera.distance);
}

export function orbit(context: Terrain3dContext, dx: number, dy: number): void {
  const distance = context.navigationDistance();
  // A distant pivot must not sweep the eye across metres of ground per pixel.
  const scale = context.options.navigation ? (Math.sqrt(groundNavigationScale(context.camera.distance, distance / 2)) * distance) / context.camera.distance : 1;
  context.camera.yaw -= dx * 0.006 * scale;
  context.camera.pitch += dy * 0.005 * scale;
}

export function pan(context: Terrain3dContext, dx: number, dy: number): void {
  const c = context.camera,
    metres = (2 * context.navigationDistance() * Math.tan(FOV / 2)) / context.height;
  const vertical = (dy * metres) / Math.max(0.25, Math.sin(c.pitch)),
    horizontal = dx * metres;
  c.x -= horizontal * Math.cos(c.yaw) + vertical * Math.sin(c.yaw);
  c.y += horizontal * Math.sin(c.yaw) - vertical * Math.cos(c.yaw);
}
