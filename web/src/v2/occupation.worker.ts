import { forestOccupation, unpackOccupationShapes, withOccupationShapes } from '../ui/forestOccupation';
import { withLandDetail } from '../ui/landDetail';
import type { LandUseLayer } from '../gen/types';
import type { ForestOccupation } from '../../../rust/bridge/terrainForest';
const ctx = self as unknown as Worker;
type Request = { landuse: LandUseLayer } | { source?: Omit<ForestOccupation, 'detail'>; shapes: Float64Array };
/** Pure rasters off the UI thread, same bytes as the main-thread path: the rural land use (occupation +
 * holdings detail), or the merge of packed building footprints into an occupation (no holdings detail). */
ctx.onmessage = ({ data }: MessageEvent<Request>) => {
  try {
    const result = 'landuse' in data ? withLandDetail(forestOccupation(data.landuse), data.landuse)
      : withOccupationShapes(data.source, unpackOccupationShapes(data.shapes));
    const buffers: ArrayBuffer[] = [];
    if (result) { buffers.push(result.rgba.buffer as ArrayBuffer); if (result.detail) buffers.push(result.detail.rgba.buffer as ArrayBuffer); }
    ctx.postMessage({ result }, buffers);
  } catch (error) { ctx.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
