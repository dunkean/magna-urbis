/** Terrain contours and motion detail, extracted once off-thread. MinimalRenderer requests motion products only
 * with a usable GPU; the CPU-only path pays for the exact paths alone. Buffers transfer without a second copy. */
import { minimalContours, minimalContourSegments, type MinimalContourProducts } from '../render/minimalContours';
import type { MinimalHeight } from '../render/minimalMap';
const SCALES = [1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8];
self.onmessage = (event: MessageEvent<{ height: MinimalHeight; motion: boolean }>): void => {
  const features = [...minimalContours(event.data.height)],
    levels: MinimalContourProducts['levels'] = [];
  if (event.data.motion)
    for (const scale of SCALES) {
      const steps = minimalContourSegments(features, scale);
      let step = steps.next();
      while (!step.done) step = steps.next();
      levels.push({ scale, segments: step.value });
    }
  const products: MinimalContourProducts = { features, levels };
  self.postMessage(products, { transfer: levels.map(level => level.segments.buffer as ArrayBuffer) });
};
