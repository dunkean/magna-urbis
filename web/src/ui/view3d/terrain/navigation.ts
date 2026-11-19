/**
 * Input of a 3D terrain view: pointer, touch, wheel and keyboard gestures on the owner's element, and the walking and
 * flying modes with their held keys and step loop. Installed once by Terrain3d; it moves the camera rig and asks it
 * to report each change.
 */
import { walkDisplacement, flightDisplacement, WALK_EYE_HEIGHT } from '../../terrain3dNavigation';
import { clamp } from './policy';
import type { TerrainViewContext } from './context';
import type { Terrain3dCamera } from './contract';
import type { TerrainCameraRig } from './camera';
import type { TerrainSurface } from './surface';
import type { TerrainBuildings } from './buildings';

export class TerrainNavigation {
  /** Orbit distance and pitch before walking or flying, restored on the way back to orbit. */
  orbitBeforeWalk?: Pick<Terrain3dCamera, 'distance' | 'pitch'>;
  private pointers = new Map<number, { x: number; y: number; orbit: boolean }>();
  private gesture?: { x: number; y: number; distance: number };
  private walkKeys = new Set<string>();
  private walkFrame = 0;
  private walkTime = 0;
  private readonly walkPoint: [number, number] = [0, 0];
  private readonly groundHeight = (x: number, y: number): number => this.surface.heightAt(x, y) ?? 0;

  constructor(
    private readonly context: TerrainViewContext,
    private readonly rig: TerrainCameraRig,
    private readonly surface: TerrainSurface,
    private readonly buildings: TerrainBuildings,
  ) {}

  setNavigation(navigation: 'orbit' | 'walk' | 'fly'): void {
    const rig = this.rig;
    if (!this.context.options.navigation || (rig.camera.navigation ?? 'orbit') === navigation) return;
    this.stopWalking();
    this.release();
    const previous = rig.camera.navigation ?? 'orbit';
    if (previous === 'orbit') this.orbitBeforeWalk = { distance: rig.camera.distance, pitch: rig.camera.pitch };
    if (navigation === 'fly') {
      if (!Number.isFinite(rig.camera.flightAltitude)) {
        rig.camera = { ...rig.camera, navigation, flightAltitude: (this.surface.heightAt(rig.camera.x, rig.camera.y) ?? 0) + WALK_EYE_HEIGHT, distance: 20, pitch: 0.08 };
      } else {
        const frame = rig.frameGeometry();
        rig.camera = { ...rig.camera, navigation, x: rig.camera.x + frame.eye[0], y: rig.camera.y + frame.eye[2], flightAltitude: (frame.targetHeight + frame.eye[1]) / rig.camera.exaggeration, distance: 20 };
      }
    } else if (navigation === 'walk') {
      rig.camera = { ...rig.camera, navigation, distance: 20, pitch: 0.08 };
      this.walk(0, 0, 0);
    } else {
      rig.camera = { ...rig.camera, navigation, distance: this.orbitBeforeWalk?.distance ?? 120, pitch: this.orbitBeforeWalk?.pitch ?? 0.8 };
    }
    rig.changed();
  }

  private walk(forward: number, right: number, seconds: number, fast = false): void {
    const c = this.rig.camera,
      [dx, dy] = walkDisplacement(c.yaw, forward, right, seconds, fast);
    [c.x, c.y] = this.buildings.walkCollisions.move(c.x, c.y, dx, dy, this.groundHeight, c.exaggeration, this.walkPoint);
  }

  private fly(forward: number, right: number, up: number, seconds: number, fast = false): void {
    const c = this.rig.camera,
      [dx, dy, dz] = flightDisplacement(c.yaw, c.pitch, forward, right, up, seconds, fast);
    c.x += dx;
    c.y += dy;
    c.flightAltitude = (c.flightAltitude ?? (this.surface.heightAt(c.x, c.y) ?? 0) + 30) + dz;
  }

  stopWalking(): void {
    this.walkKeys.clear();
    cancelAnimationFrame(this.walkFrame);
    this.walkFrame = 0;
    this.walkTime = 0;
  }

  /** Drops the pointers and the gesture in progress (the view stops, or the navigation mode changes). */
  release(): void {
    this.pointers.clear();
    this.gesture = undefined;
    this.context.element.classList.remove('drag');
  }

  /** The view is disposed: pointers in progress are forgotten. */
  forgetPointers(): void {
    this.pointers.clear();
  }

  private startWalking(): void {
    if (this.walkFrame) return;
    this.walkTime = performance.now();
    const step = (now: number): void => {
      this.walkFrame = 0;
      const c = this.rig.camera;
      if (!this.context.active || !['walk', 'fly'].includes(c.navigation ?? 'orbit') || !this.walkKeys.size) return;
      const held = (...keys: string[]): number => (keys.some(key => this.walkKeys.has(key)) ? 1 : 0);
      const forward = held('KeyW', 'KeyZ', 'ArrowUp') - held('KeyS', 'ArrowDown');
      const right = held('KeyD', 'ArrowRight') - held('KeyA', 'KeyQ', 'ArrowLeft');
      // Bound catch-up after a stalled or backgrounded frame.
      const seconds = Math.min(0.05, Math.max(0, (now - this.walkTime) / 1000)),
        fast = !!held('ShiftLeft', 'ShiftRight');
      const up = held('Space', 'KeyE') - held('ControlLeft', 'ControlRight', 'KeyC');
      if (c.navigation === 'fly') this.fly(forward, right, up, seconds, fast);
      else this.walk(forward, right, seconds, fast);
      this.walkTime = now;
      if (forward || right || up) this.rig.changed();
      this.walkFrame = requestAnimationFrame(step);
    };
    this.walkFrame = requestAnimationFrame(step);
  }

  private touchGesture(): { x: number; y: number; distance: number } | undefined {
    if (this.pointers.size !== 2) return undefined;
    const [a, b] = [...this.pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
  }

  /** Installs the listeners on the owner's element (removed with the view's events). */
  install(): void {
    const context = this.context,
      rig = this.rig,
      canvas = context.element,
      signal = context.events.signal;
    const walking = (): boolean => rig.camera.navigation === 'walk' || rig.camera.navigation === 'fly';
    canvas.addEventListener(
      'contextmenu',
      event => {
        if (context.active) event.preventDefault();
      },
      { signal },
    );
    canvas.addEventListener(
      'pointerdown',
      event => {
        if (!context.active || (event.button !== 0 && event.button !== 2)) return;
        event.preventDefault();
        event.stopPropagation();
        canvas.focus({ preventScroll: true });
        canvas.setPointerCapture(event.pointerId);
        this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, orbit: event.button === 2 || event.shiftKey });
        this.gesture = this.touchGesture();
        canvas.classList.add('drag');
      },
      { signal },
    );
    canvas.addEventListener(
      'pointermove',
      event => {
        if (!context.active) return;
        const previous = this.pointers.get(event.pointerId);
        if (!previous) return;
        event.preventDefault();
        event.stopPropagation();
        const dx = event.clientX - previous.x,
          dy = event.clientY - previous.y;
        this.pointers.set(event.pointerId, { ...previous, x: event.clientX, y: event.clientY });
        const gesture = this.touchGesture();
        if (walking()) {
          if (gesture && this.gesture) {
            const forward = (gesture.y - this.gesture.y) * 0.04,
              right = (this.gesture.x - gesture.x) * 0.04;
            if (rig.camera.navigation === 'fly') this.fly(forward, right, 0, 0.12);
            else this.walk(forward, right, 0.12);
          } else if (this.pointers.size === 1) {
            rig.camera.yaw -= dx * 0.003;
            rig.camera.pitch += dy * 0.003;
          }
        } else if (gesture && this.gesture) {
          rig.pan(gesture.x - this.gesture.x, gesture.y - this.gesture.y);
          if (gesture.distance > 0 && this.gesture.distance > 0) rig.camera.distance *= (this.gesture.distance / gesture.distance) ** rig.navigationScale();
        } else if (this.pointers.size === 1) {
          if (previous.orbit || event.shiftKey) rig.orbit(dx, dy);
          else rig.pan(dx, dy);
        }
        this.gesture = gesture;
        rig.changed();
      },
      { signal },
    );
    const up = (event: PointerEvent): void => {
      this.pointers.delete(event.pointerId);
      this.gesture = this.touchGesture();
      if (!this.pointers.size) canvas.classList.remove('drag');
    };
    canvas.addEventListener('pointerup', up, { signal });
    canvas.addEventListener('pointercancel', up, { signal });
    canvas.addEventListener('lostpointercapture', up, { signal });
    canvas.addEventListener(
      'wheel',
      event => {
        if (!context.active) return;
        event.preventDefault();
        event.stopPropagation();
        const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? context.height : 1);
        if (walking()) {
          if (rig.camera.navigation === 'fly') this.fly(-clamp(delta, -200, 200) / 100, 0, 0, 0.25, event.shiftKey);
          else this.walk(-clamp(delta, -200, 200) / 100, 0, 0.25, event.shiftKey);
          rig.changed();
        } else {
          const rect = canvas.getBoundingClientRect();
          rig.zoom(Math.exp(-clamp(delta, -1000, 1000) * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
        }
      },
      { passive: false, signal },
    );
    canvas.addEventListener(
      'dblclick',
      event => {
        if (!context.active) return;
        event.preventDefault();
        event.stopPropagation();
        rig.zoom(event.shiftKey ? 0.5 : 2);
      },
      { signal },
    );
    canvas.addEventListener(
      'keydown',
      event => {
        if (context.active && walking()) {
          if (event.code === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.setNavigation('orbit');
            return;
          }
          const horizontal = ['KeyW', 'KeyZ', 'KeyS', 'KeyA', 'KeyQ', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(event.code);
          const vertical = rig.camera.navigation === 'fly' && ['Space', 'KeyE', 'KeyC', 'ControlLeft', 'ControlRight'].includes(event.code);
          if (!horizontal && !vertical) return;
          event.preventDefault();
          event.stopPropagation();
          this.walkKeys.add(event.code);
          this.startWalking();
          return;
        }
        if (!context.active || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) {
          rig.orbit(event.key === 'ArrowLeft' ? 13 : event.key === 'ArrowRight' ? -13 : 0, event.key === 'ArrowUp' ? 12 : event.key === 'ArrowDown' ? -12 : 0);
        } else {
          rig.pan(event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0, event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0);
        }
        rig.changed();
      },
      { signal },
    );
    canvas.addEventListener(
      'keyup',
      event => {
        if (!this.walkKeys.delete(event.code)) return;
        event.preventDefault();
        event.stopPropagation();
        if (![...this.walkKeys].some(key => !key.startsWith('Shift'))) this.stopWalking();
      },
      { signal },
    );
    canvas.addEventListener('blur', () => this.stopWalking(), { signal });
    window.addEventListener('blur', () => this.stopWalking(), { signal });
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) this.stopWalking();
      },
      { signal },
    );
  }
}
