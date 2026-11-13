/** Retained decor banks shared by the V2 and City Bench, including vegetation clearance. */
import type { Decor } from './decor';
import type { City3dRetainedWater } from './city3d';
import type { TerrainStyle } from '../../../rust/bridge/terrainRender';
import type { RenderColors } from '../render/customColors';
import type { WaterSeason } from '../render/waterRegime';
import { decorWaterSvg } from './decorWater';
import { retainedWaterPaths } from '../render/retainedWaterGeometry';
import { retainedRegime } from './retainedWaterRegime';
import { hydrologyWaterColour } from '../../../rust/bridge/hydrologyRender';
import { styleTraits } from '../render/terrainStyle';

const cache = new WeakMap<Decor, { key: string; water: City3dRetainedWater }>();
export function decorWater3d(decor: Decor, style: TerrainStyle, lakes: boolean, colors: RenderColors | undefined, season: WaterSeason): City3dRetainedWater {
  const key = JSON.stringify([style, lakes, colors, season]), found = cache.get(decor);
  if (found?.key === key) return found.water;
  const paths = retainedWaterPaths(decorWaterSvg(decor, style, lakes, colors), decor.raster.width);
  // On a satellite ground the ice comes from the land's snow at the water's altitude (terrainRenderV2Winter): the regime carries none.
  const regimeSeason = styleTraits(style).satelliteVariant > 0 ? { ...season, landIce: true } : season;
  const water = { paths, color: hydrologyWaterColour(style, colors), regime: retainedRegime(paths, decor.raster.width, regimeSeason), style };
  cache.set(decor, { key, water }); return water;
}
