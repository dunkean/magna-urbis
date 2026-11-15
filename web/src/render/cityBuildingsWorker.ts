/** City volumes — build worker (cityBuildingsParallel.ts): the items, roof pans and shadows of one share of a town's
 * buildings, from its own copy of the binary site visuals; the typed roof arrays are transferred back. */
import { cityBuildingsChunk, type CityBuildingsTask } from './cityBuildingsParallel';

const scope = self as unknown as { onmessage: ((e: MessageEvent<CityBuildingsTask>) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void };
scope.onmessage = e => {
  try {
    const chunk = cityBuildingsChunk(e.data), r = chunk.roofs;
    scope.postMessage({ chunk }, [r.owner, r.light, r.tone, r.dir, r.flat, r.snow, r.patch, r.grain, r.rim].flatMap(a => a ? [a.buffer] : []));
  } catch (error) { scope.postMessage({ error: String((error as Error)?.stack ?? error) }); }
};
