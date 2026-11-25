import { defaultProgrammeContext, type Layout, type Shape, type UrbanProgramme } from '../../../../rust/bridge/urban';
import type { World } from '../../gen/types';
import { differenceSafeS, intersectionS, mpArea, unionMany } from '../../gen/geo/bool';
import { ribbon } from '../../gen/geo/offset';
import { GridIndex } from '../../gen/geo/spatial';

const TILE = 256;
const FRONTAGE_DEPTH = 24;

export function osmHousingProgramme(key: string, population: number): UrbanProgramme {
  const homes = Math.max(1, Math.round(population / 3.5));
  return {
    version: 1,
    population,
    context: defaultProgrammeContext(),
    cultures: [],
    demands: [{ id: `${key}/demand/domestic`, function: 'domestic', unit: 'domesticUnits', requested: homes, targetArea: homes * 70, targetFrontage: 4, provenance: ['OpenStreetMap frontage'], requires: [], parcelCapacity: 0, builtCapacity: 0, deficit: homes, reasons: [] }],
    reservations: [],
    allocations: [],
    adjacency: [],
    environment: [],
    reconciliationPasses: 0,
    warnings: [],
  };
}

/** Make cadastral blocks from strips served by real streets. Divide the geometric operations into tiles so a
 * dense import doesn't require one union of every road in the map. The engine cuts lots in these blocks. */
export function osmStreetLayout(world: World, source: Layout, boundary?: Shape[]): Layout {
  const frontage = new GridIndex<Shape>(TILE);
  const exclusions = new GridIndex<Shape>(TILE);
  function indexShape(index: GridIndex<Shape>, shape: Shape): void {
    if (shape.outer.length >= 3) index.insertPts(shape.outer, shape);
  }
  for (const street of source.streets) {
    indexShape(exclusions, {
      outer: ribbon(
        street.path,
        street.widths.map(width => width + 1),
      ),
      holes: [],
    });
    if (street.rank <= 3)
      indexShape(frontage, {
        outer: ribbon(
          street.path,
          street.widths.map(width => width + 2 * FRONTAGE_DEPTH),
        ),
        holes: [],
      });
  }
  for (const road of world.roads ?? []) indexShape(exclusions, { outer: ribbon(road.path, road.width + 1), holes: [] });
  for (const river of world.terrain.rivers)
    indexShape(exclusions, {
      outer: ribbon(
        river.path,
        river.width.map(width => width + 2),
      ),
      holes: [],
    });
  for (const [outer, ...holes] of world.terrain.waterGeometry ?? []) indexShape(exclusions, { outer, holes });
  for (const wall of world.urban?.walls ?? []) {
    const path = wall.closed ? [...wall.path, wall.path[0]] : wall.path;
    indexShape(exclusions, { outer: ribbon(path, wall.thickness + 1), holes: [] });
  }
  for (const outer of world.urban?.squares ?? []) indexShape(exclusions, { outer, holes: [] });
  for (const land of world.landuse?.areas ?? []) {
    if (['forest', 'marsh', 'commons', 'garden'].includes(land.kind)) indexShape(exclusions, { outer: land.poly, holes: land.holes ?? [] });
  }

  const blocks: Layout['blocks'] = [];
  const quarters: Layout['quarters'] = [];
  for (let y = 0; y < world.mapSize; y += TILE) {
    for (let x = 0; x < world.mapSize; x += TILE) {
      const east = Math.min(x + TILE, world.mapSize);
      const south = Math.min(y + TILE, world.mapSize);
      const nearby = frontage.query(x, y, east, south);
      if (!nearby.length) continue;
      const tile = [
        { x, y },
        { x: east, y },
        { x: east, y: south },
        { x, y: south },
      ];
      const served = intersectionS(tile, unionMany(nearby, 24, true));
      const allowed = boundary ? intersectionS(served, boundary) : served;
      const open = differenceSafeS(allowed, ...exclusions.query(x, y, east, south));
      for (const shape of open) {
        if (mpArea([shape]) < 45) continue;
        blocks.push({ shape, quarter: quarters.length, kind: 'block', axis: { x: 1, y: 0 }, zone: 'core', phase: 0 });
        quarters.push({ shape, phase: 0, zone: 'core' });
      }
    }
  }
  const population = Math.min(5_000_000, Math.max(4, Math.round(mpArea(blocks.map(block => block.shape)) / 45)));
  return { ...source, blocks, quarters, programme: osmHousingProgramme(source.key, population) };
}
