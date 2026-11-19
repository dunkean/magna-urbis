/** Terrain/decor adapter shared by renderScene and urban3d so Minimal/embed views need no 3D viewer dependency. */
import type { World } from '../gen/types';
import type { Decor } from '../ui/decor';
import type { V2Settings } from './contracts';
import { retainedDecorOf } from './decorTerrain';
import { rustSettlementRaster } from './rustUrban';
import { nativeTerrainOf } from './nativeProducts';
import { effectiveTerrainSettings } from './terrainSettings';

const rasterMetrics = new WeakMap<ReturnType<typeof rustSettlementRaster>, { minHeight: number; maxHeight: number; land: number }>();

export function v2WorldDecor(world: World, settings: V2Settings): Decor {
  const retained = retainedDecorOf(world.terrain);
  if (retained) return retained;
  const raster = rustSettlementRaster(world);
  let metrics = rasterMetrics.get(raster);
  if (!metrics) {
    const heights = raster.height;
    let minHeight = Infinity,
      maxHeight = -Infinity,
      wet = 0;
    for (let i = 0; i < heights.length; i++) {
      minHeight = Math.min(minHeight, heights[i]);
      maxHeight = Math.max(maxHeight, heights[i]);
      if (raster.water[i]) wet++;
    }
    metrics = { minHeight, maxHeight, land: 1 - wet / heights.length };
    rasterMetrics.set(raster, metrics);
  }
  const { minHeight, maxHeight, land } = metrics,
    native = nativeTerrainOf(world),
    configuration = effectiveTerrainSettings(settings, world.mapSize);
  // The zone names the decor; its effective values travel with it.
  const climate = configuration.climateZone ?? configuration.climate ?? 'temperate';
  const query = new URLSearchParams({ climate });
  for (const [key, value] of Object.entries(configuration.climateValues ?? {})) query.set(key, String(value));
  return {
    raster,
    meta: {
      format: 'magna-decor',
      version: 1,
      id: `v2-${world.seed}`,
      label: 'Magna Urbis V2',
      tags: { climate },
      seed: world.seed,
      width: world.mapSize,
      query: query.toString(),
      created: '',
      settlements: [],
      roadConfig: null,
      roads: null,
      waterSvg: '',
      terrainDisplay: {
        floor: native?.field?.floor ?? minHeight,
        sourceCell: native ? native.width / (native.field?.n ?? native.resolution) : world.terrain.height.cell,
        refine: configuration.refine !== false && configuration.relief !== 'cavern',
        globalMinHeight: native?.globalMinHeight ?? minHeight,
        globalMaxHeight: native?.globalMaxHeight ?? maxHeight,
        motifSize: native?.motifSize ?? configuration.motifSize,
      },
      stats: { land, minHeight, maxHeight, riverKm: 0, roadKm: 0 },
    },
  };
}
