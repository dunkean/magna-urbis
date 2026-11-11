import { forestOccupation, unpackOccupationShapes, withOccupationShapes } from '../ui/forestOccupation';
import { landDetail } from '../ui/landDetail';
import type { LandUseLayer } from '../gen/types';
import type { ForestCorridor } from '../render/forestRoom';
import type { ForestOccupation } from '../../../rust/bridge/terrainForest';
const ctx = self as unknown as Worker;
type Request = { landuse: LandUseLayer; corridors?: ForestCorridor[]; part: 'occupation' | 'detail' } | { source?: Omit<ForestOccupation, 'detail'>; shapes: Float64Array };
/** Pure rasters off the UI thread, same bytes as the main-thread path: one part of the rural land use (the occupation
 * or the holdings detail, rastered in two workers at once), or the merge of packed building footprints into an occupation. */
ctx.onmessage = ({ data }: MessageEvent<Request>) => {
  try {
    const result = !('landuse' in data) ? withOccupationShapes(data.source, unpackOccupationShapes(data.shapes))
      : data.part === 'detail' ? landDetail(data.landuse) : forestOccupation(data.landuse, undefined, undefined, data.corridors);
    const buffers: ArrayBuffer[] = [];
    if (result) { buffers.push(result.rgba.buffer as ArrayBuffer); const detail = (result as ForestOccupation).detail; if (detail) buffers.push(detail.rgba.buffer as ArrayBuffer); }
    ctx.postMessage({ result }, buffers);
  } catch (error) { ctx.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
