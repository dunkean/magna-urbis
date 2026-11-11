import type { TerrainData } from '../../../rust/bridge/terrain';
import { loadRenderGeometry } from '../../../rust/bridge/renderGeometry';
import { cityContourPaths, type ContourWorkerRequest, type ContourWorkerResponse } from './cityContours';

let terrain: TerrainData | undefined;
self.onmessage = async ({ data }: MessageEvent<ContourWorkerRequest>) => {
  if (data.terrain) terrain = data.terrain as TerrainData;
  const source = terrain;
  const response: ContourWorkerResponse = { id: data.id };
  try {
    await loadRenderGeometry();
    if (!source) throw new Error('Contour samples are missing.');
    response.paths = cityContourPaths(source, data.landform, data.scale);
  } catch (error) { response.error = String(error); }
  self.postMessage(response);
};
