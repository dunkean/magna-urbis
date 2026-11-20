/**
 * City drape tile painting and physical/semantic/network layers, called by the terrain tile loader.
 * Reads/writes: Reads surface images, look, plan and world getters; writes per-mount drape/footprint/road/plan caches and local tile canvases, preserving painter order.
 */
import { displayQualityFor } from '../../render/displayQuality';
import { drawTileRoads, tileRoadVisible, cityTileHasInk } from '../../render/tileNetworks';
import { outsideUrbanStreets } from '../../../../rust/bridge/urbanNetwork';
import { layoutPavementSites } from '../../render/roadPavement';
import { type Terrain3dTile, type Terrain3dTileContent } from '../terrain3d';
import { terrain3dRaisedTexture, terrain3dSetRaisedTexture } from '../terrain3dTexture';
import { buildCityBuildings, buildCityScene, drawCity, selectCityLod, type CityLayers, type CityScene } from '../../render/cityCanvas';
import { drawFarmLotPieces } from '../../render/farmRoofs';
import { withoutUrbanPlan } from '../../render/appearanceRecipe';
import { drawRuralSemantic, drawUrbanSemantic } from '../../render/semanticLayer';
import { groundRoadLook } from '../../render/composition';
import type { Street } from '../../../../rust/bridge/urban';
import { City3dPhysicalGround } from './cityTypes';
import { WATER } from './cityWater';
import type { City3dContext } from './cityContext';

const PLAN_LAYERS: CityLayers = { reserve: false, allocated: false, centers: false, domains: false, quarters: false, blocks: true, streets: true, enclosures: true, parcels: true, gardens: true, places: true, fronts: false, axes: false, access: false };

export async function semanticLayer(cityContext: City3dContext, tile: Terrain3dTile, paint: (ctx: CanvasRenderingContext2D) => boolean): Promise<HTMLCanvasElement | undefined> {
  const size = cityContext.proceduralGround ? Math.ceil(tile.pixels / 2) : tile.pixels,
    k = size / tile.width;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.setTransform(k, 0, 0, k, -tile.x * k, -tile.y * k);
  if (!paint(ctx)) return undefined;
  if (!cityContext.proceduralGround) await cityContext.clearSemanticWater(tile, ctx);
  return c;
}

/** Physical land use at tile resolution, as roads: a map tile takes it at once (the scratch is free again), a material tile keeps it as its overlay. */
export async function physicalLayer(cityContext: City3dContext, tile: Terrain3dTile, ground: City3dPhysicalGround, box: { minX: number; minY: number; maxX: number; maxY: number }): Promise<HTMLCanvasElement | undefined> {
  if (tile.exact) await ground.ready?.(box, tile.pixels);
  const c = document.createElement('canvas');
  c.width = c.height = tile.pixels;
  // Async completions (contours) repaint only the tile that drew the provisional content; it keeps its texture until then.
  const stale = (): void => cityContext.terrain?.invalidateTiles(tile.key);
  if (!tile.exact && tile.prepare) await tile.prepare(cityContext.drapeTiles.paint(c, box, `${ground.key}|${displayQualityFor(true)}`, (target, area, defer) => ground.paint(target, area, { live: true }, defer), stale));
  else if (!ground.paint(c, box, undefined, () => stale)) return undefined;
  if (!cityContext.proceduralGround && !ground.keepsWater) await cityContext.clearSemanticWater(tile, c.getContext('2d')!);
  return c;
}

export async function loadTile(cityContext: City3dContext, tile: Terrain3dTile): Promise<TexImageSource | Terrain3dTileContent> {
  const d = cityContext.surfaceDecor!,
    size = tile.pixels,
    c = document.createElement('canvas');
  c.width = c.height = size;
  const width = d.raster.width;
  const source = cityContext.proceduralGround ? cityContext.waterMask : (cityContext.image ?? (cityContext.mapFallback ??= cityContext.hillshade(d)));
  const draped = source && terrain3dRaisedTexture(source),
    ink = draped ? document.createElement('canvas') : c;
  if (draped) {
    ink.width = ink.height = size;
  }
  const ctx = ink.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // V2 can supply a physical raster without a pre-rendered external PNG.
  // Use the same hillshade for both the overview and close-up map tiles.
  // A map ground lies on its paper, as the 2D map does: a flat style without relief (topographic, cadastre) supplies
  // a background that is transparent on land, which the 3D shader would otherwise read as black ground.
  const paper = !cityContext.proceduralGround ? cityContext.options.getText?.()?.palette.paper : undefined;
  if (paper) {
    const base = c.getContext('2d')!;
    base.fillStyle = paper;
    base.fillRect(0, 0, size, size);
  }
  // A material tile's source is the water-cell raster: its shore is smoothed at tile resolution.
  if (source) {
    const k = source.width / width,
      base = c.getContext('2d')!;
    if (cityContext.proceduralGround) await cityContext.drawWaterCells(base, source, tile.x * k, tile.y * k, tile.width * k, size);
    else base.drawImage(source, tile.x * k, tile.y * k, tile.width * k, tile.width * k, 0, 0, size, size);
  }
  const k = size / tile.width,
    mpp = tile.width / size,
    semanticMpp = cityContext.proceduralGround ? tile.width / Math.ceil(size / 2) : mpp;
  const groundSettings = cityContext.options.getGroundSettings?.(cityContext.ground),
    satellite = cityContext.proceduralGround && groundSettings?.renderV2 === 1;
  const waterVisible = groundSettings?.waterVisible !== false;
  if (cityContext.proceduralGround && cityContext.waterPaths && waterVisible) {
    ctx.save();
    ctx.setTransform(k, 0, 0, k, -tile.x * k, -tile.y * k);
    ctx.fillStyle = `rgb(${WATER})`;
    ctx.fill(cityContext.waterPaths, 'evenodd');
    ctx.restore();
  }
  if (cityContext.proceduralGround && waterVisible) cityContext.fillRetainedWater(ctx, tile, k, `rgb(${WATER})`);
  if (waterVisible && cityContext.materialCanals()) {
    ctx.fillStyle = `rgb(${WATER})`;
    cityContext.fillCanals(ctx, tile, k);
  }
  const regimeDisplay = cityContext.currentWaterDisplay();
  if (cityContext.proceduralGround && waterVisible && regimeDisplay?.riverPaths) {
    ctx.save();
    ctx.setTransform(k, 0, 0, k, -tile.x * k, -tile.y * k);
    ctx.fillStyle = `rgb(${WATER})`;
    ctx.fill(regimeDisplay.riverPaths);
    ctx.restore();
  }
  // The material shader paints water wherever this tile is opaque: the seasonal regime takes the dry and frozen
  // courses out of the cover at tile resolution (the closed water paths above hold every river ribbon) and redraws
  // the running ones crisp. Their beds and ice are painted on the ground and ink layers below.
  if (cityContext.proceduralGround && waterVisible && regimeDisplay?.regime) {
    ctx.save();
    ctx.setTransform(k, 0, 0, k, -tile.x * k, -tile.y * k);
    regimeDisplay.regime(ctx, 'erase', mpp);
    ctx.restore();
  }
  const semantic = cityContext.options.getSemantic?.(),
    box = { minX: tile.x, minY: tile.y, maxX: tile.x + tile.width, maxY: tile.y + tile.width };
  const physicalGround = cityContext.options.getPhysicalGround?.(cityContext.proceduralGround);
  let physical: HTMLCanvasElement | undefined;
  if (tile.preview && !cityContext.proceduralGround) {
    physical = document.createElement('canvas');
    physical.width = physical.height = size;
    if (!physicalGround?.preview?.(physical, box)) physical = undefined;
  } else physical = physicalGround && (await cityContext.physicalLayer(tile, physicalGround, box));
  if (physical && !cityContext.proceduralGround) ctx.drawImage(physical, 0, 0);
  const rural =
    !tile.preview && semantic && semantic.rural !== 'off'
      ? await cityContext.semanticLayer(tile, target => drawRuralSemantic(target, semantic.landuse, { look: semantic.rural, opacity: semantic.opacity, mpp: semanticMpp, viewport: box, classes: semantic.classes, indexed: true }))
      : undefined;
  if (rural && !cityContext.proceduralGround) ctx.drawImage(rural, 0, 0);
  // Map ground: the pre-rendered map holds no water. The 2D banks are inked here, at tile resolution and in the 2D
  // colour, over the land use and under the roads and the plan (bridges, quays), as on the 2D map.
  if (!cityContext.proceduralGround && waterVisible && !tile.preview) cityContext.fillRetainedWater(ctx, tile, k, cityContext.retainedWater?.color ?? '#000', 'ink');
  // Keep the water tile pure. Only tiles with roads or plan ink promote the half-size semantic overlay.
  let overlay = rural;
  if (physical && cityContext.proceduralGround) {
    if (rural) physical.getContext('2d')!.drawImage(rural, 0, 0, size, size);
    overlay = physical;
  }
  const inkContext = (): CanvasRenderingContext2D => {
    if (!cityContext.proceduralGround) return ctx;
    if (!overlay || overlay.width !== size) {
      const full = document.createElement('canvas');
      full.width = full.height = size;
      if (overlay) full.getContext('2d')!.drawImage(overlay, 0, 0, size, size);
      overlay = full;
    }
    return overlay.getContext('2d')!;
  };
  let groundTile: HTMLCanvasElement | undefined;
  const groundContext = (): CanvasRenderingContext2D => {
    if (!satellite) return inkContext();
    if (!groundTile) {
      groundTile = document.createElement('canvas');
      groundTile.width = groundTile.height = size;
    }
    return groundTile.getContext('2d')!;
  };
  const planOptions = cityContext.options.getPlanOptions?.();
  // Roads follow the Roads switch in the plan layers.
  const roads = !tile.preview && planOptions?.layers?.streets !== false ? cityContext.groundRegionalStreets().filter(road => tileRoadVisible(road, box, mpp)) : undefined;
  if (roads?.length) {
    const roadLook = planOptions?.roadLook ?? (planOptions?.groundBlend ? 'natural' : 'ink');
    const target = groundRoadLook(roadLook) ? groundContext() : inkContext();
    target.save();
    target.setTransform(k, 0, 0, k, -tile.x * k, -tile.y * k);
    drawTileRoads(
      target,
      roads,
      box,
      mpp,
      { look: roadLook, emphasis: planOptions?.roadEmphasis ?? 1, night: !satellite && planOptions?.appearance?.ambience === 'night', colors: planOptions?.appearance?.colors },
      planOptions?.roadInk,
      layoutPavementSites(cityContext.options.getLayouts?.()),
    );
    target.restore();
  }
  // Remote accesses of activity sites (stairs, causeways, rope bridges, tunnels) lie in the ground tile like the roads.
  const siteGround = !tile.preview ? cityContext.options.getSiteGround?.(box, mpp) : undefined;
  if (siteGround) {
    const target = groundContext();
    target.save();
    target.setTransform(k, 0, 0, k, -tile.x * k, -tile.y * k);
    siteGround(target, !!satellite);
    target.restore();
  }
  // The lots of the countryside farms (yard, garden, pond, tree marks) lie in the ground tile of a natural ground,
  // under their building meshes, as the 2D map paints them (farmRoofs.ts).
  const farmLots = !tile.preview && satellite ? semantic?.landuse?.farmsteads : undefined;
  if (farmLots?.length) {
    const target = groundContext();
    target.save();
    target.setTransform(k, 0, 0, k, -tile.x * k, -tile.y * k);
    for (const part of ['ground', 'trees'] as const) drawFarmLotPieces(target, farmLots, { part, viewport: box, mpp, altitude: cityContext.heightAt });
    target.restore();
  }
  const footprintScene = planOptions?.buildingsVisible ? cityContext.options.getScene() : undefined;
  let footprints = footprintScene && cityContext.footprintPlans.get(footprintScene);
  if (footprintScene && !footprints) {
    footprints = buildCityBuildings(footprintScene);
    cityContext.footprintPlans.set(footprintScene, footprints);
  }
  const city = cityContext.cityPlan() ?? (footprints ? cityContext.emptyFootprintPlan : undefined);
  // The map style only suppresses the abstract plan drawing here.
  const requestedLayers = planOptions?.layers ?? PLAN_LAYERS;
  const planLayers = { ...(cityContext.planOverlay ? requestedLayers : withoutUrbanPlan(requestedLayers)), lotEnclosureMeshes: planOptions?.layers?.lotEnclosureMeshes !== false },
    lod = selectCityLod(mpp);
  const planInk = city && cityTileHasInk(city, box, planLayers, lod, footprints);
  if (city && planInk && (planOptions?.opacity ?? 1) > 0) {
    if (satellite) {
      // Satellite: streets and town walls lie in the ground tile, under the crowns that overhang them.
      const target = groundContext();
      target.save();
      target.setTransform(k, 0, 0, k, -tile.x * k, -tile.y * k);
      target.globalAlpha = planOptions?.opacity ?? 1;
      drawCity(target, city, {
        viewport: box,
        mpp,
        dpr: 1,
        lod,
        view: 'buildings',
        palette: 'terrain',
        width: 0,
        layers: { ...planLayers, reserve: false, allocated: false, centers: false, quarters: false, streets: planLayers.streets && planOptions?.roadLook !== 'ink', enclosures: planLayers.enclosures, waterways: false, fronts: false, axes: false, access: false },
        buildingsVisible: false,
        appearance: { style: 'geometric', diagnostic: 'none' },
        materialGround: true,
        groundBlend: true,
        roadLook: 'natural',
        roadEmphasis: planOptions?.roadEmphasis,
        textured: cityContext.textured(),
        onTexturesReady: () => cityContext.terrain?.invalidateTiles(),
      });
      target.restore();
    }
    const target = inkContext();
    target.save();
    target.setTransform(k, 0, 0, k, -tile.x * k, -tile.y * k);
    target.globalAlpha = planOptions?.opacity ?? 1;
    const thematic = planOptions?.view === 'uses' || planOptions?.view === 'roles';
    const inkLayers = satellite
      ? {
          ...planLayers,
          blocks: thematic && planLayers.blocks,
          domains: thematic && planLayers.domains,
          parcels: thematic && planLayers.parcels,
          gardens: thematic && planLayers.gardens,
          places: thematic && planLayers.places,
          streets: planLayers.streets && planOptions?.roadLook === 'ink',
          enclosures: false,
          lotEnclosures: false,
        }
      : planLayers;
    if (cityContext.materialCanals()) inkLayers.waterways = false;
    drawCity(target, city, {
      viewport: box,
      mpp,
      dpr: 1,
      lod,
      colors: planOptions?.colors,
      view: planOptions?.view ?? 'parcels',
      labels: false,
      palette: planOptions?.palette ?? 'terrain',
      width: planOptions?.width ?? 0.6,
      layers: inkLayers,
      buildings: footprints,
      buildingsVisible: planOptions?.buildingsVisible ?? false,
      appearance: { ...(planOptions?.appearance ?? { style: 'cartographic', diagnostic: 'none' }), ...(cityContext.proceduralGround && cityContext.options.getLook?.().underdark ? { lightsOn: false } : {}) },
      textured: cityContext.textured(),
      roadLook: planOptions?.roadLook,
      roadEmphasis: planOptions?.roadEmphasis,
      waterColor: planOptions?.waterColor,
      streetPalette: planOptions?.streetPalette,
      night: planOptions?.night,
      groundBlend: planOptions?.groundBlend ?? false,
      onTexturesReady: () => cityContext.terrain?.invalidateTiles(),
    });
    target.restore();
  }
  const scene = semantic && semantic.urban !== 'off' ? cityContext.cityPlan() : undefined;
  const urban =
    semantic && scene && scene.extent.maxX >= box.minX && scene.extent.minX <= box.maxX && scene.extent.maxY >= box.minY && scene.extent.minY <= box.maxY
      ? await cityContext.semanticLayer(tile, target => drawUrbanSemantic(target, [scene], { look: semantic.urban, opacity: semantic.opacity, mpp: semanticMpp, viewport: box }))
      : undefined;
  const paintRegime = (target: CanvasRenderingContext2D, mode: 'ground' | 'ice' | 'ink'): void => {
    if (!regimeDisplay?.regime || !waterVisible) return;
    target.save();
    target.setTransform(k, 0, 0, k, -tile.x * k, -tile.y * k);
    regimeDisplay.regime(target, mode, mpp);
    target.restore();
  };
  if (!cityContext.proceduralGround) {
    if (urban) ctx.drawImage(urban, 0, 0);
    paintRegime(ctx, 'ink');
    if (draped) {
      const full = document.createElement('canvas');
      full.width = full.height = size;
      const target = full.getContext('2d')!,
        scale = draped.width / width;
      target.drawImage(draped, tile.x * scale, tile.y * scale, tile.width * scale, tile.width * scale, 0, 0, size, size);
      target.drawImage(ink, 0, 0);
      c.getContext('2d')!.drawImage(ink, 0, 0);
      terrain3dSetRaisedTexture(c, full);
    }
    return { texture: c, water: await cityContext.waterTile(tile) };
  }
  if (urban) {
    if (overlay) {
      const target = overlay.getContext('2d')!;
      target.setTransform(1, 0, 0, 1, 0, 0);
      target.drawImage(urban, 0, 0, overlay.width, overlay.height);
    } else overlay = urban;
  }
  if (overlay) await cityContext.clearSemanticWater(tile, overlay.getContext('2d')!);
  if (groundTile) await cityContext.clearSemanticWater(tile, groundTile.getContext('2d')!);
  const display = cityContext.currentWaterDisplay(),
    look = cityContext.options.getLook?.();
  if (look?.waterLook === 'ink' && look.waterVisible !== false && display?.ink) {
    const target = inkContext(),
      source = display.texture,
      scale = source.width / width;
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    await cityContext.drawWaterCells(target, source, tile.x * scale, tile.y * scale, tile.width * scale, size);
    if (display.paths) {
      target.setTransform(k, 0, 0, k, -tile.x * k, -tile.y * k);
      target.fillStyle = display.ink.fill;
      target.fill(display.paths, 'evenodd');
      target.strokeStyle = display.ink.stroke;
      target.lineWidth = mpp * 0.8;
      target.stroke(display.paths);
    }
    if (display.riverPaths) {
      target.setTransform(k, 0, 0, k, -tile.x * k, -tile.y * k);
      target.fillStyle = display.ink.fill;
      target.fill(display.riverPaths);
    }
    target.restore();
  }
  // Dry beds: albedo on a material ground; ice: a decal over the snowed ground; symbols on an ink ground.
  if (regimeDisplay?.regime) {
    if (look?.waterLook === 'ink') paintRegime(inkContext(), 'ink');
    else {
      paintRegime(groundContext(), 'ground');
      if (regimeDisplay.frozen) paintRegime(inkContext(), 'ice');
    }
  }
  // The same on the retained banks (City Bench): the cover above holds only their running water.
  if (cityContext.retainedWater?.regime && waterVisible) {
    if (look?.waterLook === 'ink') cityContext.fillRetainedWater(inkContext(), tile, k, cityContext.retainedWater.color, 'symbols');
    else {
      cityContext.fillRetainedWater(inkContext(), tile, k, cityContext.retainedWater.color, 'symbols');
      if (cityContext.retainedWater.regime.frozen) cityContext.fillRetainedWater(inkContext(), tile, k, cityContext.retainedWater.color, 'ice');
    }
  }
  return { texture: c, semantic: overlay, ground: groundTile, water: await cityContext.waterTile(tile) };
}

export function groundRegionalStreets(cityContext: City3dContext): Street[] {
  const roads = cityContext.options.getRegionalStreets?.(),
    layouts = cityContext.options.getLayouts?.();
  if (roads !== cityContext.groundRoadSource || layouts !== cityContext.groundRoadLayouts) {
    cityContext.groundRoadSource = roads;
    cityContext.groundRoadLayouts = layouts;
    // Use the same ownership as the 2D road layer. Camp entrances replace
    // destination routes inside the camp; the raw regional span stays outside.
    cityContext.groundRoads = outsideUrbanStreets([...(roads ?? [])], [...(layouts ?? [])]);
  }
  return cityContext.groundRoads;
}

export function cityPlan(cityContext: City3dContext): CityScene | undefined {
  const layouts = cityContext.options.getLayouts?.(),
    partitions = cityContext.options.getPartitions?.();
  if (!layouts?.length) return (cityContext.plan = undefined);
  if (!cityContext.planOf || cityContext.planOf[0] !== layouts || cityContext.planOf[1] !== partitions) {
    cityContext.plan = buildCityScene(layouts, partitions ?? [], cityContext.surfaceDecor?.raster);
    cityContext.planOf = [layouts, partitions];
  }
  return cityContext.plan;
}
