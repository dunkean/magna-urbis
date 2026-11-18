/**
 * Camera of a 3D terrain view: the orbit or ground-level camera, its limits and framings, the frame geometry
 * (matrices and basis) every part draws and picks with, and the moving/resting state that sets the resolution and the
 * display quality. Terrain3d and the navigation drive it; each change asks for a frame and notifies the owner.
 */
import { cavernRoofAt, type CavernField } from '../../../render/underdarkCavern';
import { groundNavigationScale, navigationFogDistance, WALK_EYE_HEIGHT } from '../../terrain3dNavigation';
import { terrain3dPixelRatio, TERRAIN_3D_SETTLE_MS } from '../../terrain3dResolution';
import { FOV, TERRAIN_GROUND_MAX_SCALE, TERRAIN_3D_MAX_SCALE, clamp } from './policy';
import type { TerrainViewContext } from './context';
import type { FrameGeometry, Terrain3dCamera, Vec3 } from './contract';
import type { TerrainSurface } from './surface';

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

type Framing = { x: number; y: number; distance: number; pitch: number };

export class TerrainCameraRig {
  camera: Terrain3dCamera = { x: 0, y: 0, distance: 1000, yaw: 0, pitch: 0.8, exaggeration: 1 };
  /** A framing view chosen before the towns were known; replaced by the first town once they arrive, if untouched. */
  townFrame?: Framing;
  private movedAt = -Infinity;
  private settleTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly context: TerrainViewContext,
    private readonly surface: TerrainSurface,
    private readonly cavern: () => CavernField | undefined,
    /** The terrain point under a canvas pixel (picking of the displayed patches). */
    private readonly groundHit: (x: number, y: number) => [number, number] | null,
    private readonly onChange: () => void,
  ) {}

  frameGeometry(): FrameGeometry {
    const c = this.camera,
      context = this.context,
      targetHeight = this.surface.heightAt(c.x, c.y)! * c.exaggeration;
    if (c.navigation === 'walk' || c.navigation === 'fly') {
      const eye: Vec3 = [0, c.navigation === 'fly' ? (c.flightAltitude ?? targetHeight / c.exaggeration + 30) * c.exaggeration - targetHeight : WALK_EYE_HEIGHT, 0];
      const forward: Vec3 = [-Math.sin(c.yaw) * Math.cos(c.pitch), -Math.sin(c.pitch), -Math.cos(c.yaw) * Math.cos(c.pitch)];
      const right = normalize(cross(forward, [0, 1, 0])),
        up = cross(right, forward);
      const view = lookAt(eye, [forward[0], eye[1] + forward[1], forward[2]]);
      const far = Math.max(c.distance * 4, this.surface.layer!.width * 2 + this.surface.heightRange * c.exaggeration * 2);
      return { eye, targetHeight, matrix: multiply(perspective(context.width / context.height, 0.02, far), view), focal: context.height / (2 * Math.tan(FOV / 2)), right, up, forward };
    }
    const eye: Vec3 = [Math.sin(c.yaw) * Math.cos(c.pitch) * c.distance, Math.sin(c.pitch) * c.distance, Math.cos(c.yaw) * Math.cos(c.pitch) * c.distance];
    const ex = c.x + eye[0],
      ey = c.y + eye[2];
    const clearance = Math.max(0.15, c.distance * 0.0015);
    const ground = this.surface.heightAt(ex, ey)! * c.exaggeration - targetHeight;
    eye[1] = Math.max(eye[1], ground + clearance);
    const forward = normalize([-eye[0], -eye[1], -eye[2]]),
      right = normalize(cross(forward, [0, 1, 0])),
      up = cross(right, forward);
    const view = lookAt(eye, [0, 0, 0]);
    const far = Math.max(c.distance * 4, this.surface.layer!.width * 2 + this.surface.heightRange * c.exaggeration * 2);
    const matrix = multiply(perspective(context.width / context.height, Math.max(0.02, c.distance * 0.0002), far), view);
    return { eye, targetHeight, matrix, focal: context.height / (2 * Math.tan(FOV / 2)), right, up, forward };
  }

  /** One atmospheric distance for terrain, trees and billboards, shared by both GPU backends. */
  fogDistance(): number {
    return navigationFogDistance(this.camera.navigation, this.camera.distance, this.surface.layer?.width ?? 0);
  }

  /** The camera of a framing view of (point, distance): in the Underdark a whole-map frame becomes the first town seen
   * from inside its chamber, the eye under the roof where the chamber allows. */
  framingView(x: number, y: number, distance: number): Framing {
    const ground = this.context.ground,
      town = ground?.townSites ?? ground?.townGlow,
      layer = this.surface.layer,
      field = this.cavern();
    this.townFrame = undefined;
    if (ground?.underdark && field && layer && distance > layer.width * 0.25) {
      if (town && town.length >= 3) {
        const headroom = cavernRoofAt(field, town[0], town[1]) - (this.surface.heightAt(town[0], town[1]) ?? 0);
        const near = Math.min(clamp(town[2] * 1.6, 320, 700), Math.max(220, ((0.7 * headroom) / Math.sin(0.16)) * this.camera.exaggeration));
        return { x: town[0], y: town[1], distance: near, pitch: this.framingPitch(town[0], town[1], near) };
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
      const view = { x: bx, y: by, distance: 450, pitch: this.framingPitch(bx, by, 450) };
      this.townFrame = { ...view };
      return view;
    }
    if (ground?.underdark && field) {
      // A town frame in the cave: near enough that the eye stays under the roof of its chamber.
      const headroom = cavernRoofAt(field, x, y) - (this.surface.heightAt(x, y) ?? 0),
        near = Math.min(distance, Math.max(220, ((0.7 * headroom) / Math.sin(0.16)) * this.camera.exaggeration));
      return { x, y, distance: near, pitch: this.framingPitch(x, y, near) };
    }
    return { x, y, distance, pitch: this.framingPitch(x, y, distance) };
  }

  /** Pitch of a framing view of (x, y) at an orbit distance: the Underdark looks across the cave from a low angle, the
   * eye under the roof where the chamber allows (the far vault, its stalactites and the far chambers then show). */
  framingPitch(x?: number, y?: number, distance?: number): number {
    const field = this.cavern();
    if (!this.context.ground?.underdark || !field) return 0.82;
    if (x === undefined || y === undefined || !distance) return 0.36;
    const headroom = cavernRoofAt(field, x, y) - (this.surface.heightAt(x, y) ?? 0);
    return clamp(Math.asin(clamp((0.75 * headroom) / (distance / Math.max(this.camera.exaggeration, 0.2)), 0, 1)), 0.16, 0.36);
  }

  /** A new ground of towns: a framing chosen before they were known (and not touched since) moves to the first one. */
  reframeOnTowns(): void {
    const framed = this.townFrame,
      sites = this.context.ground?.townSites ?? this.context.ground?.townGlow;
    if (!framed || !sites || sites.length < 3) return;
    const c = this.camera;
    if (Math.abs(c.x - framed.x) < 1 && Math.abs(c.y - framed.y) < 1 && Math.abs(c.distance - framed.distance) < 1) {
      const near = clamp(sites[2] * 1.6, 320, 700);
      this.camera = { ...c, x: sites[0], y: sites[1], distance: near, pitch: this.framingPitch(sites[0], sites[1], near) };
      this.limit();
      this.context.request();
    }
    this.townFrame = undefined;
  }

  set(camera: Terrain3dCamera): void {
    this.camera = { ...camera };
    this.limit();
    if (this.context.active) this.moving();
    this.context.request();
  }

  fit(x?: number, y?: number, visibleWidth?: number): void {
    const layer = this.surface.layer!,
      ground = this.context.ground,
      field = this.cavern(),
      span = visibleWidth ?? layer.width,
      town = ground?.townSites ?? ground?.townGlow;
    // Underdark: open on the first town, from inside its chamber, the eye under the roof where it allows.
    if (x === undefined && y === undefined && ground?.underdark && field && town && town.length >= 3) {
      // Near enough that the eye stays under the roof of the chamber at the framing pitch.
      const headroom = cavernRoofAt(field, town[0], town[1]) - (this.surface.heightAt(town[0], town[1]) ?? 0);
      const distance = Math.min(clamp(town[2] * 1.6, 320, 700), Math.max(220, ((0.7 * headroom) / Math.sin(0.16)) * this.camera.exaggeration));
      this.camera = { ...this.camera, navigation: 'orbit', x: town[0], y: town[1], distance, yaw: 0.5, pitch: this.framingPitch(town[0], town[1], distance) };
      this.changed();
      return;
    }
    this.camera = {
      ...this.camera,
      navigation: 'orbit',
      x: x ?? layer.x + layer.width / 2,
      y: y ?? layer.y + layer.width / 2,
      distance: (Math.max(span, this.surface.heightRange * this.camera.exaggeration) / (2 * Math.tan(FOV / 2))) * Math.max(1, this.context.height / this.context.width) * 1.18,
      yaw: 0,
      pitch: ground?.underdark && field ? 0.36 : 0.88,
    };
    this.changed();
  }

  /** Zooms the orbit distance. With a cursor position (CSS pixels in the canvas) the ground point under the
   * cursor stays under it: the orbit target slides toward that point in proportion to the distance change. */
  zoom(factor: number, cursorX?: number, cursorY?: number): void {
    if (!Number.isFinite(factor) || factor <= 0) return;
    if (this.camera.navigation === 'walk' || this.camera.navigation === 'fly') return;
    const before = this.camera.distance,
      anchor = cursorX === undefined || cursorY === undefined ? null : this.cursorGround(cursorX, cursorY);
    this.camera.distance = before / factor ** this.navigationScale();
    this.limit();
    if (anchor) {
      const k = this.camera.distance / before,
        c = this.camera;
      c.x = anchor[0] + (c.x - anchor[0]) * k;
      c.y = anchor[1] + (c.y - anchor[1]) * k;
    }
    this.changed();
  }

  /** Ground point under a canvas pixel: the terrain hit, else the horizontal plane through the orbit target. */
  private cursorGround(x: number, y: number): [number, number] | null {
    const hit = this.groundHit(x, y);
    if (hit) return hit;
    if (!this.surface.layer || !this.context.active) return null;
    const frame = this.frameGeometry(),
      c = this.camera;
    const u = (x - this.context.width / 2) / frame.focal,
      v = (this.context.height / 2 - y) / frame.focal;
    const dy = frame.forward[1] + u * frame.right[1] + v * frame.up[1];
    if (dy >= -1e-4) return null;
    const t = -frame.eye[1] / dy;
    if (!(t > 0)) return null;
    return [c.x + frame.eye[0] + (frame.forward[0] + u * frame.right[0] + v * frame.up[0]) * t, c.y + frame.eye[2] + (frame.forward[2] + u * frame.right[2] + v * frame.up[2]) * t];
  }

  north(): void {
    this.camera.yaw = 0;
    this.changed();
  }

  limit(): void {
    const layer = this.surface.layer,
      options = this.context.options,
      width = layer?.width ?? 1000,
      c = this.camera;
    c.x = clamp(Number.isFinite(c.x) ? c.x : width / 2, layer?.x ?? 0, (layer?.x ?? 0) + width);
    c.y = clamp(Number.isFinite(c.y) ? c.y : width / 2, layer?.y ?? 0, (layer?.y ?? 0) + width);
    const minimumDistance = options.navigation ? 2.5 : this.context.height / (2 * Math.tan(FOV / 2) * this.maxScale());
    c.distance = clamp(Number.isFinite(c.distance) ? c.distance : width, minimumDistance, Math.max(width * 5, minimumDistance));
    if (!options.navigation) c.navigation = 'orbit';
    if (c.navigation === 'fly') {
      const ground = this.surface.heightAt(c.x, c.y) ?? 0;
      c.flightAltitude = clamp(Number.isFinite(c.flightAltitude) ? c.flightAltitude! : ground + 30, ground + WALK_EYE_HEIGHT, ground + width * 5);
    }
    c.pitch = clamp(Number.isFinite(c.pitch) ? c.pitch : 0.8, c.navigation === 'walk' || c.navigation === 'fly' ? -1.45 : 0.14, c.navigation === 'walk' || c.navigation === 'fly' ? 1.45 : 1.48);
    c.yaw = Number.isFinite(c.yaw) ? ((((c.yaw + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI : 0;
    c.exaggeration = clamp(Number.isFinite(c.exaggeration) ? c.exaggeration : 1, 0.2, 5);
  }

  /** The camera moves: frames are drawn at the moving resolution until it rests, then once more at rest. */
  private moving(): void {
    this.movedAt = performance.now();
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => this.context.request(), TERRAIN_3D_SETTLE_MS + 1);
  }

  /** The view stops (inactive or disposed): no pending settle frame, the next one is drawn at rest. */
  rest(): void {
    clearTimeout(this.settleTimer);
    this.movedAt = -Infinity;
  }

  /** A gesture or a navigation step changed the camera. */
  changed(): void {
    this.moving();
    this.limit();
    this.keepEyeOutOfGround();
    this.context.request();
    this.onChange();
  }

  /** Orbit: the eye never sits inside the ground (a hillside, a cave wall, the rock under the Underdark roof). An eye
   * below the surface at its own position comes back along the orbit towards the target (same target and angles, a
   * shorter distance) to the first free position, with a small clearance. A few height lookups, on camera changes only. */
  private keepEyeOutOfGround(): void {
    const c = this.camera;
    if (c.navigation === 'walk' || c.navigation === 'fly' || !this.surface.layer || !this.context.options.navigation) return;
    const target = this.surface.heightAt(c.x, c.y) ?? 0,
      minimum = 2.5;
    const free = (d: number): boolean => {
      const h = Math.cos(c.pitch) * d,
        ground = this.surface.heightAt(c.x + Math.sin(c.yaw) * h, c.y + Math.cos(c.yaw) * h);
      return ground === undefined || target + (Math.sin(c.pitch) * d) / c.exaggeration >= ground + Math.max(0.5, d * 0.002);
    };
    if (free(c.distance)) return;
    let d = c.distance;
    for (let k = 0; k < 48 && d > minimum && !free(d); k++) d *= 0.92;
    c.distance = Math.max(minimum, d);
  }

  private navigationDistance(): number {
    const c = this.camera;
    if (!this.context.options.navigation || !this.surface.layer) return c.distance;
    const frame = this.frameGeometry();
    const ground = this.surface.heightAt(c.x + frame.eye[0], c.y + frame.eye[2])! * c.exaggeration;
    const clearance = frame.targetHeight + frame.eye[1] - ground;
    // Driven by the orbit distance with a floor: an eye grazing (or touching) the ground never stalls zoom, orbit or pan.
    return Math.min(c.distance, Math.max(2, c.distance * 0.3, clearance * 2));
  }

  navigationScale(): number {
    if (!this.context.options.navigation) return 1;
    const distance = this.navigationDistance();
    // A wheel step always zooms at a usable rate; the minimum orbit distance (limit) stops it, not a slowdown.
    return Math.max(0.35, (groundNavigationScale(this.camera.distance, distance / 2) * distance) / this.camera.distance);
  }

  orbit(dx: number, dy: number): void {
    const distance = this.navigationDistance();
    // A distant pivot must not sweep the eye across metres of ground per pixel.
    const scale = this.context.options.navigation ? (Math.sqrt(groundNavigationScale(this.camera.distance, distance / 2)) * distance) / this.camera.distance : 1;
    this.camera.yaw -= dx * 0.006 * scale;
    this.camera.pitch += dy * 0.005 * scale;
  }

  pan(dx: number, dy: number): void {
    const c = this.camera,
      metres = (2 * this.navigationDistance() * Math.tan(FOV / 2)) / this.context.height;
    const vertical = (dy * metres) / Math.max(0.25, Math.sin(c.pitch)),
      horizontal = dx * metres;
    c.x -= horizontal * Math.cos(c.yaw) + vertical * Math.sin(c.yaw);
    c.y += horizontal * Math.sin(c.yaw) - vertical * Math.cos(c.yaw);
  }

  /** Whether the camera moved within the settle delay (captures always draw at rest). */
  interacting(): boolean {
    return !this.context.fullQualityCapture && !this.context.captureMode && performance.now() - this.movedAt < TERRAIN_3D_SETTLE_MS;
  }

  /** Device pixel ratio of the frame: the moving and resting budgets of terrain3dResolution.ts. */
  dpr(): number {
    return terrain3dPixelRatio(this.context.width, this.context.height, window.devicePixelRatio || 1, this.context.maxFramebufferDimension, this.interacting());
  }

  /** Closest zoom: the material ground resolves far finer than the draped map. */
  maxScale(): number {
    return this.context.ground ? TERRAIN_GROUND_MAX_SCALE : TERRAIN_3D_MAX_SCALE;
  }
}
