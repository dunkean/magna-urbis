import { sampleRustTerrain, type TerrainRegion, type TerrainSettings } from '../../../../rust/bridge/terrain';

/** Dedicated SurfaceWorld worker. It never shares the current page terrain queue. */
self.onmessage = async (event: MessageEvent<{ region: TerrainRegion; settings: TerrainSettings }>) => {
  try {
    const terrain = await sampleRustTerrain({ id: 1, generation: 0, kind: 'detail', settings: event.data.settings,
      region: event.data.region, display: 'gl' });
    self.postMessage({ terrain });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
