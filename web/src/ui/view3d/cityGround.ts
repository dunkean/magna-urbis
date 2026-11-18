/**
 * City surface samplers, background loading and ground configuration, called by citySync and controls.
 * Reads/writes: Reads decor, background and look getters; writes surface/image/forest/resource keys and loading tickets on the supplied context, forwarding inputs to Terrain3d.
 */
import { city3dSurfaceSamplers } from '../../render/city3dHeight';
import { type Terrain3dGroundSettings } from '../terrain3d';
import { decorClimate } from '../decorClimate';
import { DEFAULT_TERRAIN_LIGHTING } from '../../render/terrainLighting';
import { forestOccupation } from '../forestOccupation';
import { withLandDetail } from '../landDetail';
import type { Decor } from '../decor';
import { City3dOptions } from './cityTypes';
import { WATER } from './cityWater';
import type { City3dContext } from './cityContext';

export const seedHash = (text: string): number => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h | 0;
};

export function groundForest(cityContext: City3dContext): ReturnType<NonNullable<City3dOptions['getForest']>> {
  const forest = cityContext.options.getForest?.();
  if (forest?.occupation || cityContext.options.getGroundSettings?.(cityContext.ground)?.renderV2 !== 1) return forest;
  const semantic = cityContext.options.getSemantic?.(),
    landuse = semantic?.landuse;
  if (landuse !== cityContext.occupationLanduse) {
    cityContext.occupationLanduse = landuse;
    cityContext.occupationGround = landuse && withLandDetail(forestOccupation(landuse), landuse, semantic?.cultures);
  }
  return { ...forest, occupation: cityContext.occupationGround };
}

// ------------------------------------------------------------ relief and texture
export function backgroundUrl(cityContext: City3dContext, d: Decor): string | undefined {
  const custom = cityContext.options.getBackground?.();
  if (custom) return custom;
  const source = d.meta.id.startsWith('city-') ? d.meta.id : d.meta.pipeline?.parent;
  return source ? `decors/${source}.png` : undefined;
}

export function hillshade(cityContext: City3dContext, d: Decor): HTMLCanvasElement {
  const { n, height, water, width } = d.raster,
    cell = width / n,
    c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!,
    pixels = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x,
        o = i * 4;
      if (water[i]) {
        pixels.data.set([...WATER, 255], o);
        continue;
      }
      const dx = (height[y * n + Math.min(n - 1, x + 1)] - height[y * n + Math.max(0, x - 1)]) / (2 * cell),
        dy = (height[Math.min(n - 1, y + 1) * n + x] - height[Math.max(0, y - 1) * n + x]) / (2 * cell);
      const light = Math.max(0, Math.min(1, 0.8 + (-dx - dy) * 1.4));
      pixels.data.set([214 * light, 207 * light, 168 * light, 255].map(Math.round), o);
    }
  ctx.putImageData(pixels, 0, 0);
  return c;
}

export async function loadImage(cityContext: City3dContext, url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  return img;
}

export function setSurface(cityContext: City3dContext, d: Decor): void {
  const t = cityContext.terrain!,
    r = d.raster;
  // The natural drawn ground (before footings and moats carve it): one height for town, roads, bridges, quays and walls.
  const samplers = city3dSurfaceSamplers(r, (x, y) => t.groundAt(x, y));
  cityContext.surfaceDecor = d;
  cityContext.heightAt = samplers.heightAt;
  cityContext.bridgeWaterAt = cityContext.stiltWaterAt = samplers.waterAt;
  cityContext.sceneOf = undefined;
  cityContext.sourceEpoch++;
  cityContext.details.clear();
  cityContext.detailBases.clear();
  // Every displayed structure shares the terrain's unexaggerated surface.
  // Quay water also samples the wet edge of its bank band, outside the mask.
  cityContext.quayHeightAt = cityContext.quayWaterAt = cityContext.heightAt;
  cityContext.waterMask = undefined;
  cityContext.waterPaths = undefined;
  cityContext.openWater = undefined;
  cityContext.image = undefined;
  cityContext.mapFallback = undefined;
  cityContext.planOf = undefined;
  cityContext.imageBillboards = undefined;
  const surface = cityContext.options.getSurface?.();
  t.setSurface(surface?.height ?? { x: 0, y: 0, width: r.width, n: r.n, data: r.height }, surface?.water, surface?.waterVisible);
  cityContext.imageUrl = undefined;
  cityContext.backgroundKey = undefined;
  cityContext.syncImage(d);
  cityContext.applyGround();
}

/** The 2D background may change (map style selector): follow its image. */
export function syncImage(cityContext: City3dContext, d: Decor): void {
  const bitmap = cityContext.options.getBackgroundImage?.();
  if (bitmap) {
    const revision = cityContext.options.getBackgroundKey?.();
    if (cityContext.image !== bitmap || cityContext.backgroundKey !== revision) {
      cityContext.backgroundKey = revision;
      ++cityContext.textureTicket;
      cityContext.imageUrl = undefined;
      cityContext.image = bitmap;
      cityContext.imageBillboards = undefined;
      cityContext.applyGround();
    }
    return;
  }
  const illustrated = cityContext.ground === 'map' ? cityContext.options.getIllustrated?.() : undefined;
  if (illustrated) {
    const key = `illustrated:${illustrated.key}`;
    if (key === cityContext.imageUrl) return;
    cityContext.imageUrl = key;
    const ticket = ++cityContext.textureTicket;
    void illustrated.load().then(
      result => {
        if (ticket !== cityContext.textureTicket || cityContext.disposed) return;
        cityContext.image = result.texture;
        cityContext.imageBillboards = result.billboards;
        cityContext.applyGround();
      },
      error => {
        if (ticket === cityContext.textureTicket) {
          cityContext.imageUrl = undefined;
          console.warn('Illustrated relief:', error);
        }
      },
    );
    return;
  }
  const url = cityContext.backgroundUrl(d);
  if (url === cityContext.imageUrl) return;
  cityContext.imageUrl = url;
  const ticket = ++cityContext.textureTicket;
  // A removed or not-yet-ready source must not leave the previous style draped.
  cityContext.image = undefined;
  cityContext.imageBillboards = undefined;
  if (!url) {
    cityContext.applyGround();
    return;
  }
  void cityContext.loadImage(url).then(
    img => {
      if (ticket === cityContext.textureTicket && !cityContext.disposed) {
        cityContext.image = img;
        cityContext.applyGround();
      }
    },
    () => {
      if (ticket === cityContext.textureTicket && !cityContext.disposed) {
        cityContext.imageUrl = undefined;
        cityContext.applyGround();
      }
    },
  );
}

export function applyGround(cityContext: City3dContext): void {
  const t = cityContext.terrain,
    d = cityContext.surfaceDecor;
  if (!t || !d) return;
  const configured = cityContext.options.getGroundSettings?.(cityContext.ground);
  t.setLook({ ...(cityContext.options.getLook?.() ?? configured ?? {}), paperMap: cityContext.options.getText?.().palette.name === 'parchment' });
  cityContext.waterDisplay = cityContext.options.getWaterDisplay?.();
  cityContext.retainedWater = cityContext.options.getRetainedWater?.();
  const procedural = cityContext.ground !== 'map' && !cityContext.softwareMaterial && (!cityContext.options.getGroundSettings || !!configured);
  cityContext.proceduralGround = procedural;
  cityContext.root.dataset.materialBackend = cityContext.softwareMaterial && cityContext.ground !== 'map' ? 'software-texture' : procedural ? 'gpu' : 'map';
  if (procedural) {
    const waterVisible = configured?.waterVisible !== false;
    if (cityContext.waterDisplay) {
      cityContext.waterMask = cityContext.waterDisplay.texture;
      cityContext.waterPaths = cityContext.waterDisplay.paths;
    } else {
      const maskKey = `${waterVisible}:${cityContext.vectorRivers()}`;
      if (!cityContext.waterMask || cityContext.waterMaskVisible !== maskKey) {
        cityContext.waterMask = cityContext.water(d, waterVisible);
        cityContext.waterMaskVisible = maskKey;
      }
      cityContext.waterPaths ??= cityContext.waterPath(d);
    }
    const climate = decorClimate(d.meta);
    t.setGroundMaterial(configured ?? { seed: seedHash(d.meta.seed), climate, sourceCell: d.meta.terrainDisplay?.sourceCell ?? d.raster.width / 1024, lighting: DEFAULT_TERRAIN_LIGHTING, displacement: false });
    const cover = cityContext.materialCover(d, cityContext.waterMask!, waterVisible);
    t.setTexture(cover);
    cityContext.noteWaterMaterial(cover);
  } else {
    t.setGroundMaterial(undefined);
    t.setTexture(cityContext.image ?? (cityContext.mapFallback ??= cityContext.hillshade(d)), cityContext.imageBillboards);
    // The draped map (the 2D ground capture) holds the rivers; the hillshade stand-in only the water cells.
    cityContext.noteWaterMaterial(cityContext.image);
  }
  // Only a software material raster already holds its canopy; a material ground draped for want of relief does not.
  const forest = procedural || cityContext.ground === 'map' || !cityContext.softwareMaterial ? cityContext.groundForest() : undefined;
  t.setForest(forest?.field, forest?.occupation, { seed: seedHash(d.meta.seed), climate: decorClimate(d.meta), lighting: configured?.lighting ?? DEFAULT_TERRAIN_LIGHTING });
  t.setHeightSampler(cityContext.options.getHeightSampler?.());
  cityContext.textOverlay.invalidate();
  cityContext.groundKey = cityContext.groundResourceKey(configured);
  t.setTileLoader(cityContext.loadTile);
  t.invalidateTiles();
}

export function noteWaterMaterial(cityContext: City3dContext, material: HTMLCanvasElement | HTMLImageElement | undefined): void {
  if (material === cityContext.waterMaterialOf) return;
  cityContext.waterMaterialOf = material;
  cityContext.waterShownDue = !!material;
}

export function groundResourceKey(cityContext: City3dContext, configured: Terrain3dGroundSettings | undefined): string {
  const { ambience: _ambience, waterLook: _waterLook, townGlow: _townGlow, ...resources } = configured ?? {};
  return JSON.stringify([cityContext.ground, cityContext.refinement, resources]);
}
