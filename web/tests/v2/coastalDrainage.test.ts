import { expect, it } from 'vitest';
import { decodeCityCode } from '../../src/v2/cityCode';
import { effectiveTerrainSettings } from '../../src/v2/terrainSettings';
import { releaseTerrainCheckpoints, sampleRustTerrain } from '../../../rust/bridge/terrain';

it('drains the w93994 coastal plain into the sea after CPU terrain finishing', async () => {
  const { settings } = decodeCityCode('w939945zff-01k');
  const width = 6000;
  const terrain = effectiveTerrainSettings(settings, width);
  terrain.compute = 'wasm';
  terrain.generationCompute = 'cpu';
  try {
    const data = await sampleRustTerrain({ id: 1, generation: 1, kind: 'overview', settings: terrain, region: { x: 0, y: 0, extent: width, resolution: 256 } });
    const water = data.water!;
    const sea = water.hydro.sea.reduce((sum, value) => sum + value, 0);
    expect(sea).toBeGreaterThan(water.hydro.sea.length / 2);
    const rivers = water.rivers!.rivers;
    expect(rivers.length).toBeGreaterThan(0);
    for (const river of rivers) {
      const [x, y] = river.points.slice(-2);
      // The island outlets lie inside the map. Draining the artificial flat reached its edges.
      expect(Math.min(x, y, width - x, width - y)).toBeGreaterThan(100);
    }
  } finally {
    releaseTerrainCheckpoints();
  }
}, 120000);
