/** Terrain-owned contour geometry, shared by minimal views and captures across renderer lifetimes.
 * Extraction and motion detail run off-thread; only bounded exact Path2D construction runs on the UI thread.
 * Weak keys release both pending work and retained paths when the terrain leaves the project cache.
 */
import { buildMinimalGeometry, emptyMinimalGeometry, type MinimalHeight } from '../render/minimalMap';
import type { MinimalContourSet, MinimalContourProducts } from '../render/minimalContours';
const cache = new WeakMap<object, Promise<MinimalContourSet>>();
export function retainedMinimalContours(height: MinimalHeight, motion = false): Promise<MinimalContourSet> {
  const key = height.data as object;
  let pending = cache.get(key);
  if (pending) return pending;
  pending = new Promise<MinimalContourProducts>((resolve, reject) => {
    const worker = new Worker(new URL('./minimalContourWorker.ts', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('Contour extraction timed out'));
    }, 30000);
    worker.onmessage = event => {
      clearTimeout(timer);
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = event => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error(event.message));
    };
    // Structured clone: the retained terrain is never transferred/detached.
    worker.postMessage({ height, motion });
  })
    .then(async ({ features, levels }) => {
      const exact = emptyMinimalGeometry(height.width),
        steps = buildMinimalGeometry(height.width, features, exact);
      let done = false;
      while (!done) {
        const start = performance.now();
        do {
          done = !!steps.next().done;
        } while (!done && performance.now() - start < 6);
        if (!done) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      return { exact, levels };
    })
    .catch(error => {
      cache.delete(key);
      throw error;
    });
  cache.set(key, pending);
  return pending;
}
