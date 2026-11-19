/** Dedicated extraction worker: marching squares can exceed a frame even on a 512-square height grid. */
import { minimalContours } from '../render/minimalContours';
import type { MinimalHeight } from '../render/minimalMap';
self.onmessage = (event: MessageEvent<MinimalHeight>): void => {
  self.postMessage([...minimalContours(event.data)]);
};
