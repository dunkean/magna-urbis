/** City volumes — build worker (cityBuildingsParallel.ts): the items, roof pans and shadows of one share of a town's
 * buildings, from its own copy of the binary site visuals; the typed roof arrays are transferred back. */
import { cityBuildingsChunk, type CityBuildingsTask } from './cityBuildingsParallel';
import type { GroundClipTask } from './cityGround';
import { clipCityGroundPacked, loadRenderGeometry } from '../../../rust/bridge/renderGeometry';

const scope = self as unknown as { onmessage: ((e: MessageEvent<CityBuildingsTask | { clip: GroundClipTask }>) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void };
scope.onmessage = e => {
  // A share of a plan's ground clip (CityGround.clipAhead): the same kernel as on the page, on this worker's package.
  if ('clip' in e.data) {
    const task = e.data.clip;
    loadRenderGeometry()
      .then(() => {
        const clipped = clipCityGroundPacked(task, task.canals, task.subjects);
        scope.postMessage({ clipped }, [clipped.buffer]);
      })
      .catch(error => scope.postMessage({ error: String((error as Error)?.stack ?? error) }));
    return;
  }
  const data = e.data;
  try {
    const chunk = cityBuildingsChunk(data),
      r = chunk.roofs;
    scope.postMessage(
      { chunk },
      [r.owner, r.light, r.tone, r.dir, r.flat, r.snow, r.patch, r.grain, r.rim].flatMap(a => (a ? [a.buffer] : [])),
    );
  } catch (error) {
    scope.postMessage({ error: String((error as Error)?.stack ?? error) });
  }
};
