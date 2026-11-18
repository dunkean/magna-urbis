/**
 * City capture program readiness, called by cityApi before capture.
 * Reads/writes: Reads active/disposed/program state from the supplied context; awaits preparation/frames and marks the capture readiness request.
 */
import { RenderReadiness } from '../../render/renderReadiness';
import type { City3dContext } from './cityContext';
export async function captureReady(cityContext: City3dContext): Promise<RenderReadiness> {
  const request = new RenderReadiness('capture'),
    until = performance.now() + 90_000;
  await cityContext.api.prepare();
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  while (!cityContext.programsReady()) {
    if (!cityContext.active || cityContext.disposed) throw new DOMException('Capture cancelled', 'AbortError');
    if (performance.now() > until) throw new Error('The 3D material did not finish compiling.');
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
  request.mark('programs-ready');
  return request;
}
