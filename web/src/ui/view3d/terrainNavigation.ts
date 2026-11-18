/**
 * Pointer, keyboard, walking and flight controls installed by the Terrain3d constructor.
 * Reads/writes: Reads camera and input events; writes pointers, gestures, held keys, movement timers and camera changes on the supplied context.
 */
import { walkDisplacement, flightDisplacement, WALK_EYE_HEIGHT } from '../terrain3dNavigation';
import { clamp } from './terrainPolicy';
import type { Terrain3dContext } from './terrainContext';

export function setNavigation(context: Terrain3dContext, navigation: 'orbit' | 'walk' | 'fly'): void {
  if (!context.options.navigation || (context.camera.navigation ?? 'orbit') === navigation) return;
  context.stopWalking();
  context.pointers.clear();
  context.gesture = undefined;
  context.element.classList.remove('drag');
  const previous = context.camera.navigation ?? 'orbit';
  if (previous === 'orbit') context.orbitBeforeWalk = { distance: context.camera.distance, pitch: context.camera.pitch };
  if (navigation === 'fly') {
    if (!Number.isFinite(context.camera.flightAltitude)) {
      context.camera = { ...context.camera, navigation, flightAltitude: (context.heightAt(context.camera.x, context.camera.y) ?? 0) + WALK_EYE_HEIGHT, distance: 20, pitch: 0.08 };
    } else {
      const frame = context.frameGeometry();
      context.camera = { ...context.camera, navigation, x: context.camera.x + frame.eye[0], y: context.camera.y + frame.eye[2], flightAltitude: (frame.targetHeight + frame.eye[1]) / context.camera.exaggeration, distance: 20 };
    }
  } else if (navigation === 'walk') {
    context.camera = { ...context.camera, navigation, distance: 20, pitch: 0.08 };
  } else {
    context.camera = { ...context.camera, navigation, distance: context.orbitBeforeWalk?.distance ?? 120, pitch: context.orbitBeforeWalk?.pitch ?? 0.8 };
  }
  context.changed();
}

export function walk(context: Terrain3dContext, forward: number, right: number, seconds: number, fast: boolean): void {
  const [dx, dy] = walkDisplacement(context.camera.yaw, forward, right, seconds, fast);
  context.camera.x += dx;
  context.camera.y += dy;
}

export function fly(context: Terrain3dContext, forward: number, right: number, up: number, seconds: number, fast: boolean): void {
  const [dx, dy, dz] = flightDisplacement(context.camera.yaw, context.camera.pitch, forward, right, up, seconds, fast);
  context.camera.x += dx;
  context.camera.y += dy;
  context.camera.flightAltitude = (context.camera.flightAltitude ?? (context.heightAt(context.camera.x, context.camera.y) ?? 0) + 30) + dz;
}

export function stopWalking(context: Terrain3dContext): void {
  context.walkKeys.clear();
  cancelAnimationFrame(context.walkFrame);
  context.walkFrame = 0;
  context.walkTime = 0;
}

export function startWalking(context: Terrain3dContext): void {
  if (context.walkFrame) return;
  context.walkTime = performance.now();
  const step = (now: number): void => {
    context.walkFrame = 0;
    if (!context.active || !['walk', 'fly'].includes(context.camera.navigation ?? 'orbit') || !context.walkKeys.size) return;
    const held = (...keys: string[]): number => (keys.some(key => context.walkKeys.has(key)) ? 1 : 0);
    const forward = held('KeyW', 'KeyZ', 'ArrowUp') - held('KeyS', 'ArrowDown');
    const right = held('KeyD', 'ArrowRight') - held('KeyA', 'KeyQ', 'ArrowLeft');
    // Bound catch-up after a stalled or backgrounded frame.
    const seconds = Math.min(0.05, Math.max(0, (now - context.walkTime) / 1000)),
      fast = !!held('ShiftLeft', 'ShiftRight');
    const up = held('Space', 'KeyE') - held('ControlLeft', 'ControlRight', 'KeyC');
    if (context.camera.navigation === 'fly') context.fly(forward, right, up, seconds, fast);
    else context.walk(forward, right, seconds, fast);
    context.walkTime = now;
    if (forward || right || up) context.changed();
    context.walkFrame = requestAnimationFrame(step);
  };
  context.walkFrame = requestAnimationFrame(step);
}

export function touchGesture(context: Terrain3dContext): { x: number; y: number; distance: number } | undefined {
  if (context.pointers.size !== 2) return undefined;
  const [a, b] = [...context.pointers.values()];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
}

export function interactions(context: Terrain3dContext): void {
  const canvas = context.element,
    signal = context.events.signal;
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
      context.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, orbit: event.button === 2 || event.shiftKey });
      context.gesture = context.touchGesture();
      canvas.classList.add('drag');
    },
    { signal },
  );
  canvas.addEventListener(
    'pointermove',
    event => {
      if (!context.active) return;
      const previous = context.pointers.get(event.pointerId);
      if (!previous) return;
      event.preventDefault();
      event.stopPropagation();
      const dx = event.clientX - previous.x,
        dy = event.clientY - previous.y;
      context.pointers.set(event.pointerId, { ...previous, x: event.clientX, y: event.clientY });
      const gesture = context.touchGesture();
      if (context.camera.navigation === 'walk' || context.camera.navigation === 'fly') {
        if (gesture && context.gesture) {
          const forward = (gesture.y - context.gesture.y) * 0.04,
            right = (context.gesture.x - gesture.x) * 0.04;
          if (context.camera.navigation === 'fly') context.fly(forward, right, 0, 0.12);
          else context.walk(forward, right, 0.12);
        } else if (context.pointers.size === 1) {
          context.camera.yaw -= dx * 0.003;
          context.camera.pitch += dy * 0.003;
        }
      } else if (gesture && context.gesture) {
        context.pan(gesture.x - context.gesture.x, gesture.y - context.gesture.y);
        if (gesture.distance > 0 && context.gesture.distance > 0) context.camera.distance *= (context.gesture.distance / gesture.distance) ** context.navigationScale();
      } else if (context.pointers.size === 1) {
        if (previous.orbit || event.shiftKey) context.orbit(dx, dy);
        else context.pan(dx, dy);
      }
      context.gesture = gesture;
      context.changed();
    },
    { signal },
  );
  const up = (event: PointerEvent): void => {
    context.pointers.delete(event.pointerId);
    context.gesture = context.touchGesture();
    if (!context.pointers.size) canvas.classList.remove('drag');
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
      if (context.camera.navigation === 'walk' || context.camera.navigation === 'fly') {
        if (context.camera.navigation === 'fly') context.fly(-clamp(delta, -200, 200) / 100, 0, 0, 0.25, event.shiftKey);
        else context.walk(-clamp(delta, -200, 200) / 100, 0, 0.25, event.shiftKey);
        context.changed();
      } else {
        const rect = canvas.getBoundingClientRect();
        context.zoom(Math.exp(-clamp(delta, -1000, 1000) * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
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
      context.zoom(event.shiftKey ? 0.5 : 2);
    },
    { signal },
  );
  canvas.addEventListener(
    'keydown',
    event => {
      if (context.active && (context.camera.navigation === 'walk' || context.camera.navigation === 'fly')) {
        if (event.code === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          context.setNavigation('orbit');
          return;
        }
        const horizontal = ['KeyW', 'KeyZ', 'KeyS', 'KeyA', 'KeyQ', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(event.code);
        const vertical = context.camera.navigation === 'fly' && ['Space', 'KeyE', 'KeyC', 'ControlLeft', 'ControlRight'].includes(event.code);
        if (!horizontal && !vertical) return;
        event.preventDefault();
        event.stopPropagation();
        context.walkKeys.add(event.code);
        context.startWalking();
        return;
      }
      if (!context.active || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) {
        context.orbit(event.key === 'ArrowLeft' ? 13 : event.key === 'ArrowRight' ? -13 : 0, event.key === 'ArrowUp' ? 12 : event.key === 'ArrowDown' ? -12 : 0);
      } else {
        context.pan(event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0, event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0);
      }
      context.changed();
    },
    { signal },
  );
  canvas.addEventListener(
    'keyup',
    event => {
      if (!context.walkKeys.delete(event.code)) return;
      event.preventDefault();
      event.stopPropagation();
      if (![...context.walkKeys].some(key => !key.startsWith('Shift'))) context.stopWalking();
    },
    { signal },
  );
  canvas.addEventListener('blur', () => context.stopWalking(), { signal });
  window.addEventListener('blur', () => context.stopWalking(), { signal });
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) context.stopWalking();
    },
    { signal },
  );
}
