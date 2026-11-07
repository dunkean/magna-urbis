import { forestOccupation } from '../ui/forestOccupation';
import { withLandDetail } from '../ui/landDetail';
import type { LandUseLayer } from '../gen/types';
const ctx = self as unknown as Worker;
/** Pure raster of the rural land use (occupation + holdings detail): same bytes as the main-thread path, off the UI thread. */
ctx.onmessage = ({ data }: MessageEvent<{ landuse: LandUseLayer }>) => {
  try {
    const result = withLandDetail(forestOccupation(data.landuse), data.landuse);
    const buffers: ArrayBuffer[] = [];
    if (result) { buffers.push(result.rgba.buffer as ArrayBuffer); if (result.detail) buffers.push(result.detail.rgba.buffer as ArrayBuffer); }
    ctx.postMessage({ result }, buffers);
  } catch (error) { ctx.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
