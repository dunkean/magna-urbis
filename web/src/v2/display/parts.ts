/**
 * The products of the appearance passes, one object per family. They read each other (the cartography inks the
 * contours and cuts the water, the town clears its ground over the rivers), so each receives this whole set.
 */
import { suspendFantasyRaster } from '../../ui/fantasyRaster';
import type { MapState } from './mapState';
import type { GroundProducts } from './groundProducts';
import type { WaterProducts } from './waterProducts';
import type { ContourInk } from './contours';
import type { CartographyProducts } from './cartographyProducts';
import type { TownProducts } from './townProducts';

export interface DisplayParts {
  readonly ground: GroundProducts;
  readonly water: WaterProducts;
  readonly contours: ContourInk;
  readonly cartography: CartographyProducts;
  readonly town: TownProducts;
}

/** Stops the stepwise paints of the exact renderers (overlay tiles, the kept town layer, illustrated stamps): the view
 * moved, or the renderers are wanted elsewhere. */
export function suspendStepwisePaints(map: MapState, parts: DisplayParts): void {
  parts.cartography.renderer?.suspendLive();
  if (map.ownsShared) parts.town.city?.suspendLive();
  if (parts.ground.fantasy) suspendFantasyRaster(parts.ground.fantasy);
}
