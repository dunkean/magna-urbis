import type { TerrainData } from '../../../rust/bridge/terrain';
import { loadRenderGeometry } from '../../../rust/bridge/renderGeometry';
import { cityContourPaths, cityFineContourBlocks, type ContourWorkerRequest, type ContourWorkerResponse } from './cityContours';

let terrain: TerrainData | undefined;
const encoder = new TextEncoder();
let queue = Promise.resolve();
self.onmessage = ({ data }: MessageEvent<ContourWorkerRequest>) => {
  // Capture each source before the asynchronous bridge load; requests for other maps cannot replace it.
  if (data.terrain) terrain = data.terrain as TerrainData;
  const source = terrain;
  queue = queue.then(async () => {
    const response: ContourWorkerResponse = { id: data.id }, transfer: ArrayBuffer[] = [];
    const paths = (p: { thin: string; index: string }): { thin: Uint8Array; index: Uint8Array } => {
      const thin = encoder.encode(p.thin), index = encoder.encode(p.index);
      transfer.push(thin.buffer, index.buffer); return { thin, index };
    };
    try {
      await loadRenderGeometry();
      if (!source) throw new Error('Contour samples are missing.');
      if (data.fine) response.blocks = cityFineContourBlocks(source, data.landform, data.scale, data.fine).map(({ key, block }) => ({ key, ...paths(block) }));
      else { const p = cityContourPaths(source, data.landform, data.scale, data.topographic); response.paths = { step: p.step, ...paths(p) }; }
    } catch (error) { response.error = String(error); }
    self.postMessage(response, { transfer });
  });
};
