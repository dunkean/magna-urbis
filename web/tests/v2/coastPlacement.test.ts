import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../src/v2/settings';
import { effectiveTerrainSettings } from '../../src/v2/terrainSettings';
import { effectiveRegion } from '../../src/v2/regionSettings';
import { releaseTerrainCheckpoints, sampleRustTerrain } from '../../../rust/bridge/terrain';
import { runSettlementRequest, settlementRaster } from '../../../rust/bridge/settlements';

describe('small coastal settlement placement', () => {
  it('places the automatic population on a 4 km island', async () => {
    const settings = defaultSettings();
    settings.extent = 4000;
    settings.terrain = { ...settings.terrain, coastMask: 255, islandMode: 'island', resolution: 128 };
    const terrain = effectiveTerrainSettings(settings, 4000);
    terrain.compute = 'wasm';
    terrain.generationCompute = 'cpu';
    try {
      const data = await sampleRustTerrain({ id: 1, generation: 1, kind: 'overview', settings: terrain, region: { x: 0, y: 0, extent: 4000, resolution: 128 }, retainField: true });
      const raster = settlementRaster(data),
        place = effectiveRegion(settings).placement,
        result = await runSettlementRequest({ id: 1, seed: settings.options.seed, raster, place, roads: null });
      expect('error' in result ? result.error : null).toBeNull();
      if ('error' in result) return;
      expect(result.settlements!.settlements.length).toBeGreaterThan(0);
    } finally {
      releaseTerrainCheckpoints();
    }
  }, 120000);
});
