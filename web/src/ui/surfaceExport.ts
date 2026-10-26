import type { Decor } from './decor';
import type { Building3dScene } from '../render/urbanBuildingGeometry';
import { isSurfaceBinary } from '../surface/binary';

/** Export ownership lasts for one job. Cancellation physically stops every compiler phase. */
export function exportSurfaceInWorker(decor: Decor, scene: Building3dScene | undefined, signal: AbortSignal): Promise<ArrayBuffer> {
  if (signal.aborted) return Promise.reject(new DOMException('Surface export cancelled', 'AbortError'));
  const worker = new Worker(new URL('./surfaceExport.worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const finish = (error?: Error, binary?: ArrayBuffer) => { signal.removeEventListener('abort', abort); worker.terminate(); error ? reject(error) : resolve(binary!); };
    const abort = () => finish(new DOMException('Surface export cancelled', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.error) finish(new Error(data.error));
      else if (!(data.binary instanceof ArrayBuffer) || !isSurfaceBinary(new Uint8Array(data.binary))) finish(new Error('Invalid surface export reply'));
      else finish(undefined, data.binary);
    };
    worker.onerror = event => finish(new Error(event.message || 'Surface export worker failed'));
    worker.onmessageerror = () => finish(new Error('Surface export transfer failed'));
    try { worker.postMessage({ decor, scene }); } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}
