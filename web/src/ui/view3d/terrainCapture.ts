/**
 * Exact terrain capture readiness and image/depth encoding, called through Terrain3d.
 * Reads/writes: Reads view readiness and canvas/depth data; toggles capture mode and frame demand on the supplied context, preserving the original asynchronous waits.
 */
import { captureWebGlFrame } from '../illustrationDepth';
import { Terrain3dCamera } from './terrainTypes';
import { FOV } from './terrainPolicy';
import type { Terrain3dContext } from './terrainContext';

/** Refine live previews through the original whole-tile painter before encoding. */
export async function prepareCapture(context: Terrain3dContext): Promise<void> {
  context.captureMode = true;
  try {
    do {
      context.draw(true);
      if (!context.active || context.disposed || context.contextLost()) throw new DOMException('Capture cancelled', 'AbortError');
      if (!context.jobs.size && !context.preparation.pending && !context.meshJobs.size && !context.animating) return;
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    } while (true);
  } catch (error) {
    context.captureMode = false;
    throw error;
  }
}

/** Draw and read in the same task: no permanent drawing-buffer retention. */
export async function capture(context: Terrain3dContext): Promise<Blob> {
  if (!context.active || !context.layer || context.contextLost()) return Promise.reject(new Error('Ouvrez la vue 3D avant de la capturer.'));
  await context.prepareCapture();
  try {
    return await new Promise<Blob>((resolve, reject) => context.canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Capture 3D indisponible.'))), 'image/png'));
  } finally {
    context.captureMode = false;
    context.request();
  }
}

export async function captureIllustration(context: Terrain3dContext): Promise<{ image: Blob; depth: Blob; camera: Terrain3dCamera }> {
  if (!context.active || !context.layer || context.contextLost()) throw new Error('Ouvrez la vue 3D avant de la capturer.');
  await context.prepareCapture();
  try {
    const camera = context.getCamera(),
      geometry = context.frameGeometry();
    camera.heightAboveTargetMetres = geometry.eye[1];
    camera.viewAngleDegrees = (Math.atan2(-geometry.forward[1], Math.hypot(geometry.forward[0], geometry.forward[2])) * 180) / Math.PI;
    // Map north is decreasing world y; yaw=0 puts the eye south of the target.
    camera.azimuthDegrees = ((((-camera.yaw * 180) / Math.PI) % 360) + 360) % 360;
    camera.verticalFovDegrees = (FOV * 180) / Math.PI;
    if (camera.exaggeration === 1) camera.altitudeMetres = geometry.targetHeight + geometry.eye[1];
    const far = Math.max(camera.distance * 4, context.layer.width * 2 + context.heightRange * camera.exaggeration * 2);
    const frame = await context.captureFrame(Math.max(0.02, camera.distance * 0.0002), far);
    context.request();
    const encode = (canvas: HTMLCanvasElement): Promise<Blob> => new Promise((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Capture 3D indisponible.'))), 'image/png'));
    const [image, depth] = await Promise.all([encode(frame.color), encode(frame.depth)]);
    return { image, depth, camera };
  } finally {
    context.captureMode = false;
    context.request();
  }
}

/** Colour and normalized inverse depth of the frame just drawn (illustrationDepth.ts). */
export function captureFrame(context: Terrain3dContext, near: number, far: number): Promise<{ color: HTMLCanvasElement; depth: HTMLCanvasElement }> {
  return Promise.resolve(captureWebGlFrame(context.gl, near, far, context.msaa?.framebuffer));
}
