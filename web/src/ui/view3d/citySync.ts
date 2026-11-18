/**
 * City input synchronization and first scene framing, called by the mounted API.
 * Reads/writes: Reads current option getters; updates input/cache keys, timings, terrain inputs, scene/text synchronization and initial focus on the supplied context.
 */
import { decorClimate } from '../decorClimate';
import { DEFAULT_TERRAIN_LIGHTING } from '../../render/terrainLighting';
import { seedHash } from './cityGround';
import type { City3dContext } from './cityContext';

export function sync(cityContext: City3dContext): void {
  const t = cityContext.terrain,
    d = cityContext.options.getDecor();
  if (!t || !d) return;
  cityContext.syncView();
  let at = performance.now();
  const lap = (key: keyof typeof cityContext.timings): void => {
    const now = performance.now();
    cityContext.timings[key] = Math.round(now - at);
    at = now;
  };
  if (d !== cityContext.surfaceDecor) {
    cityContext.setSurface(d);
    lap('surface');
  } else cityContext.syncImage(d);
  const surface = cityContext.options.getSurface?.();
  if (surface) t.setSurface(surface.height, surface.water, surface.waterVisible);
  const configured = cityContext.options.getGroundSettings?.(cityContext.ground),
    procedural = cityContext.ground !== 'map' && !cityContext.softwareMaterial && (!cityContext.options.getGroundSettings || !!configured);
  const look = cityContext.options.getLook?.() ?? configured ?? {};
  t.setLook({ ...look, paperMap: cityContext.options.getText?.().palette.name === 'parchment' });
  if (procedural && configured) t.setGroundMaterial(configured);
  if (cityContext.groundKey !== cityContext.groundResourceKey(configured) || cityContext.waterDisplay !== cityContext.options.getWaterDisplay?.() || cityContext.retainedWater !== cityContext.options.getRetainedWater?.()) cityContext.applyGround();
  t.setHeightSampler(cityContext.options.getHeightSampler?.());
  const forest = cityContext.proceduralGround || cityContext.ground === 'map' || !cityContext.softwareMaterial ? cityContext.groundForest() : undefined;
  t.setForest(forest?.field, forest?.occupation, { seed: seedHash(d.meta.seed), climate: decorClimate(d.meta), lighting: configured?.lighting ?? DEFAULT_TERRAIN_LIGHTING });
  const { labels: _tileLabels, ...tilePlanOptions } = cityContext.options.getPlanOptions?.() ?? {};
  const { ambience: _planAmbience, lightsOn: _planLights, ...planAppearance } = tilePlanOptions.appearance ?? {};
  const nextPlanKey = JSON.stringify([cityContext.planOverlay, { ...tilePlanOptions, ...(procedural ? { appearance: planAppearance } : {}) }, procedural ? look.waterLook : undefined]);
  if (cityContext.planKey !== nextPlanKey) {
    cityContext.planKey = nextPlanKey;
    t.invalidateTiles();
  }
  const semantic = cityContext.options.getSemantic?.(),
    nextSemanticKey = semantic ? JSON.stringify([semantic.rural, semantic.urban, semantic.opacity, semantic.classes]) : '';
  if (cityContext.semanticKey !== nextSemanticKey || cityContext.semanticLanduse !== semantic?.landuse) {
    cityContext.semanticKey = nextSemanticKey;
    cityContext.semanticLanduse = semantic?.landuse;
    t.invalidateTiles();
  }
  const nextPhysicalKey = cityContext.options.getPhysicalGround?.(cityContext.proceduralGround)?.key ?? '';
  if (cityContext.physicalKey !== nextPhysicalKey) {
    cityContext.physicalKey = nextPhysicalKey;
    t.invalidateTiles();
  }
  const regional = cityContext.options.getRegionalStreets?.();
  if (regional !== cityContext.tileRoadsOf) {
    cityContext.tileRoadsOf = regional;
    t.invalidateTiles();
  }
  const layouts = cityContext.options.getLayouts?.(),
    partitions = cityContext.options.getPartitions?.();
  if (!cityContext.planOf ? layouts?.length : cityContext.planOf[0] !== layouts || cityContext.planOf[1] !== partitions) {
    cityContext.cityPlan();
    t.invalidateTiles();
    lap('plan');
  }
  if (cityContext.textured() !== cityContext.texturedSeen) {
    cityContext.texturedSeen = cityContext.textured();
    t.invalidateTiles();
  } // the appearance below carries the flag
  cityContext.$<HTMLInputElement>('[data-textured]').checked = cityContext.texturedSeen;
  cityContext.syncBuildings();
  lap('buildings');
  cityContext.syncText();
  if (!cityContext.focused) {
    cityContext.focused = true;
    // Regional bridges and long enclosure meshes must not pull the target
    // away from the occupied village. Frame the retained architecture itself.
    const extent = cityContext.plan?.extent,
      points = cityContext.sceneOf?.buildings.flatMap(b => b.footprint.flatMap(s => s.outer));
    const box = points?.length ? points.reduce((b, p) => ({ minX: Math.min(b.minX, p.x), minY: Math.min(b.minY, p.y), maxX: Math.max(b.maxX, p.x), maxY: Math.max(b.maxY, p.y) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }) : extent;
    if (box && Number.isFinite(box.minX)) cityContext.api.focus({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }, Math.max(box.maxX - box.minX, box.maxY - box.minY) / 2);
    else t.fit();
  }
}
