/** Terrain-owned contour geometry, shared by minimal views and captures across renderer lifetimes.
 * Extraction always runs off-thread; only bounded Path2D construction runs on the UI thread.
 * Weak keys release both pending work and retained paths when the terrain leaves the project cache.
 */
import { buildMinimalGeometry, emptyMinimalGeometry, type MinimalFeature, type MinimalGeometry, type MinimalHeight } from '../render/minimalMap';
const cache = new WeakMap<object, Promise<MinimalGeometry>>();
export function retainedMinimalContours(height: MinimalHeight): Promise<MinimalGeometry> {
  const key = height.data as object;
  let pending = cache.get(key);
  if (pending) return pending;
  pending = new Promise<MinimalFeature[]>((resolve, reject) => {
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
    worker.postMessage(height);
  })
    .then(async features => {
      const geometry = emptyMinimalGeometry(height.width),
        steps = buildMinimalGeometry(height.width, features, geometry);
      let done = false;
      while (!done) {
        const start = performance.now();
        do {
          done = !!steps.next().done;
        } while (!done && performance.now() - start < 6);
        if (!done) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      return geometry;
    })
    .catch(error => {
      cache.delete(key);
      throw error;
    });
  cache.set(key, pending);
  return pending;
}
