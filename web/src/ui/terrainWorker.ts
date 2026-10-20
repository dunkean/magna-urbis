import { sampleRustTerrain, type TerrainData, type TerrainRequest, type TerrainResponse } from '../../../rust/bridge/terrain';
import { renderRustTerrain } from '../../../rust/bridge/terrainRender';

let latestGeneration = 0;
const transfers = (t: TerrainData): ArrayBuffer[] => [t.height.buffer, t.caveMask.buffer, t.normalX.buffer, t.normalY.buffer, t.normalZ.buffer,
  ...(t.field ? [t.field.data.buffer, ...(t.field.cave ? [t.field.cave.buffer] : [])] : [])] as ArrayBuffer[];
let pending: TerrainRequest | undefined;
let running = false;
self.onmessage = (event: MessageEvent<TerrainRequest>) => {
  const { generation } = event.data;
  if (generation < latestGeneration) return;
  latestGeneration = generation;
  pending = event.data;
  if (!running) void drain();
};
async function drain(): Promise<void> {
  running = true;
  try {
    while (pending) {
      const request = pending; pending = undefined;
      const { id, generation, kind } = request;
      try {
        const terrain = await sampleRustTerrain(request, relief => {
          if (generation === latestGeneration) self.postMessage({ id, generation, kind, terrain: relief, partial: true } satisfies TerrainResponse, { transfer: transfers(relief) });
        }, progress => {
          if (generation === latestGeneration) self.postMessage({ id, generation, kind, progress } satisfies TerrainResponse);
        });
        const waiting = pending as TerrainRequest | undefined;
        // A newer camera region replaces a region; nothing but a new generation replaces an overview.
        if (generation !== latestGeneration || (waiting && waiting.id > id && waiting.kind === kind)) continue;
        const started = performance.now();
        const scene = request.scene ? renderRustTerrain(terrain, request.scene.style, kind === 'overview', request.settings, request.scene.showContours, `worker-${generation}-${id}`, request.scene.lighting, request.scene.layers) : undefined;
        const scenePreparationMs = scene ? performance.now() - started : undefined;
        self.postMessage({ id, generation, kind, terrain, scene, scenePreparationMs } satisfies TerrainResponse, { transfer: transfers(terrain) });
      } catch (error) {
        if (generation === latestGeneration) self.postMessage({ id, generation, kind, error: error instanceof Error ? error.message : String(error) } satisfies TerrainResponse);
      }
    }
  } finally { running = false; }
}
