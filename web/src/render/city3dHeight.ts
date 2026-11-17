import type { SettlementRaster } from '../../../rust/bridge/settlements';
import { CityGround } from './cityGround';
import { rasterHeight, type City3dHeight } from './city3dMeshes';

/** Placement and roads use a coarse planning raster. Display structures must
 * instead share the terrain mesh's surface, in metres before exaggeration:
 * `surface` is the natural drawn ground (Terrain3d.groundAt), before footings
 * and moats carve it, so a rebuild never reads back its own footings or cuts.
 * River water is painted on that surface; planning water levels only describe
 * the engine's cells and can be tens of metres above the displayed river.
 * Keep the water footprint, but sample its displayed height like the banks. */
export function city3dSurfaceSamplers(
  raster: Pick<SettlementRaster, 'height' | 'water' | 'n' | 'width' | 'geometry'>,
  surface: (x: number, y: number) => number | undefined,
): { heightAt: City3dHeight; waterAt: City3dHeight } {
  const fallback = rasterHeight(raster.height, raster.n, raster.width), ground = new CityGround(raster);
  const heightAt: City3dHeight = (x, y) => surface(x, y) ?? fallback(x, y);
  return { heightAt, waterAt: (x, y) => ground.waterAt({ x, y }) ? heightAt(x, y) : NaN };
}
