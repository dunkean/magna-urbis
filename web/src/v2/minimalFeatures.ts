import type { World, UrbanLayer } from '../gen/types';
import { offsetRibbon } from '../gen/core/geom';
import type { Shape, Street } from '../../../rust/bridge/urban';
import type { RenderScene } from './renderScene';
import { minimalWaterPolygons, type MinimalFeature } from '../render/minimalMap';

const polygon = (layer: string, shape: Shape): MinimalFeature => ({ layer, points: shape.outer, holes: shape.holes, closed: true });

/** Adapts only retained products. No city renderer, roof builder, naming engine or display worker. */
export function* minimalFeatures(world: World, scene: Pick<RenderScene, 'cities' | 'cityByKey'>, parcels = false, showsStreet?: (street: Pick<Street, 'role'>) => boolean): Generator<MinimalFeature> {
  for (const area of world.landuse?.areas ?? []) yield { layer: area.kind, points: area.poly, holes: area.holes, closed: true };
  // These are the projection's retained coast/lake rings, already derived from native water at generation time.
  yield* minimalWaterPolygons([...world.terrain.coastline, ...(world.terrain.islands ?? []), ...world.terrain.lakes]);
  for (const river of world.terrain.rivers) {
    if (river.path.length < 2) continue;
    const widths = river.path.map((_, i) => Math.max(0.5, river.width[i] ?? 1));
    yield { layer: 'river', closed: true, points: offsetRibbon(river.path, widths) };
  }
  // Town streets the road editor exposes as roads (`urban`) are drawn once, as the streets of their layout.
  for (const road of world.roads ?? []) if (!road.urban) for (let i = 1; i < road.path.length; i++) yield { layer: road.kind === 'track' ? 'path' : road.kind, points: [road.path[i - 1], road.path[i]] };
  const nativeKeys = new Set(Object.keys(scene.cityByKey));
  for (const city of scene.cities) {
    for (const layout of city.layouts) {
      for (const block of layout.blocks) if (block.kind !== 'deleted') yield polygon('block', block.shape);
      for (const quarter of layout.quarters) yield polygon('quarter', quarter.shape);
      for (const street of layout.streets) {
        if (showsStreet && !showsStreet(street)) continue;
        for (let i = 1; i < street.path.length; i++) yield { layer: street.rank <= 1 ? 'streetMajor' : 'streetMinor', points: [street.path[i - 1], street.path[i]] };
      }
      for (const wall of layout.enclosures ?? []) yield { layer: 'wall', points: wall.path, closed: true };
      for (const waterway of layout.structure?.waterways ?? []) {
        yield polygon('water', waterway.shape);
        for (const bridge of waterway.crossings) yield polygon('bridge', bridge);
      }
    }
    if (parcels) for (const partition of city.partitions ?? []) for (const parcel of partition.parcels) yield polygon('parcel', parcel.shape);
    const landmarkParcels = new Set(city.sites?.filter(site => site.programme?.landmark).map(site => site.parcel_id));
    if (city.scene?.buildings.length) {
      for (const building of city.scene.buildings) for (const shape of building.footprint) yield polygon(landmarkParcels.has(building.parcel_id) || (building as typeof building & { programme?: { landmark?: boolean } }).programme?.landmark ? 'landmark' : 'building', shape);
    } else for (const site of city.sites ?? []) if (site.function !== 'open_space') for (const shape of site.surface) yield polygon(site.programme?.landmark ? 'landmark' : 'building', shape);
  }
  function* urbanFeatures(urban: UrbanLayer): Generator<MinimalFeature> {
    for (const block of urban.blocks) yield { layer: 'block', points: block, closed: true };
    for (const street of urban.streets) {
      if (showsStreet && !showsStreet(street)) continue;
      for (let i = 1; i < street.path.length; i++) yield { layer: street.rank <= 1 ? 'streetMajor' : 'streetMinor', points: [street.path[i - 1], street.path[i]] };
    }
    for (const building of urban.buildings) yield { layer: 'building', points: building.poly, holes: building.courtyards, closed: true };
    for (const landmark of urban.landmarks) yield { layer: 'landmark', points: landmark.poly, closed: true };
    for (const wall of urban.walls ?? []) for (const points of wall.pieces ?? [wall.path]) yield { layer: 'wall', points, closed: !wall.pieces && wall.closed };
  }
  if (!scene.cities.length && world.urban) yield* urbanFeatures(world.urban);
  for (const place of world.settlements ?? []) if (!nativeKeys.has(place.key) && place.urban && place.urban !== world.urban) yield* urbanFeatures(place.urban);
  for (const farm of world.landuse?.farmsteads ?? []) for (const building of farm.buildings ?? []) yield { layer: 'building', points: building, closed: true };
}
