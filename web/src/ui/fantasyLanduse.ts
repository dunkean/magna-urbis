import type { LandUseLayer } from '../gen/types';
import { pointInRing } from '../gen/geo/poly';
import { boxesOf, TileIndex } from '../render/tileindex';
import type { PaintLanduse } from '../../../rust/bridge/fantasyPainting';

/** Exact retained polygons, including holes. Display filters never affect this lookup. */
export function fantasyLanduseSample(layer: LandUseLayer, width: number): (x: number, y: number) => PaintLanduse | undefined {
  const areas = layer.areas, index = new TileIndex(width, width / 64, boxesOf(areas.map(a => a.poly)), 'overlap');
  return (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= width) return;
    for (const i of index.itemsOf(index.tileAt(x, y))) {
      const area = areas[i];
      if (pointInRing(area.poly, { x, y }) && !area.holes?.some(hole => pointInRing(hole, { x, y }))) return area.kind;
    }
  };
}
