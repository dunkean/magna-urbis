/** Adapt the retained V2 world to the shared responsive Minimal canvas. */
import type { World } from '../gen/types';
import type { ResolvedAppearance } from '../render/appearanceRecipe';
import type { ExportLayers } from '../render/exportLayers';
import type { MinimalHeight } from '../render/minimalMap';
import type { RenderReadiness } from '../render/renderReadiness';
import type { V2Settings } from './contracts';
import { renderScene, revisionOf } from './renderScene';
import { minimalFeatures } from './minimalFeatures';
import { MinimalCanvasRenderer } from './minimalCanvas';

export class MinimalRenderer extends MinimalCanvasRenderer {
  set(world: World, settings: V2Settings, resolved: ResolvedAppearance, layers: Partial<ExportLayers> = {}, readiness?: RenderReadiness): Promise<void> {
    const scene = renderScene(world, settings),
      v = scene.revisions,
      plan = resolved.composition.buildings;
    const key = JSON.stringify([v.terrain, v.roads, v.landuse, v.settlements, v.cities, revisionOf(world.urban), world.mapSize, world.stats['v2.cityOutput'], world.stats['v2.waterEditRevision'], plan.parcels]);
    // Names are already part of the product. Never invoke name generation or presentation engines.
    const names = new Map(world.names?.entries.filter(e => e.id.startsWith('settlement:')).map(e => [e.id.slice(11), e.text]));
    let places = (world.settlements ?? [])
      .map(place => ({ ...(place.core ?? place.center), name: names.get(place.key) ?? place.name ?? (place.main ? world.names?.town : '') ?? '', population: place.population }))
      .filter(place => !!place.name)
      .sort((a, b) => b.population - a.population);
    if (!places.length && world.names?.town && world.site) places = [{ ...world.site.center, name: world.names.town, population: 1 }];
    const height = (): MinimalHeight => {
      const { height: data, resolution: n, width, maxHeight } = scene.terrain;
      return { data, n, width, maxHeight };
    };
    return this.setContent({ size: world.mapSize, features: minimalFeatures(world, scene, plan.parcels), places, height, key, terrainKey: v.terrain }, resolved.composition.recipe, plan, layers, readiness);
  }
}
