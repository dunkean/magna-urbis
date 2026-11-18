/**
 * City drape water cover, masks, retained banks and semantic clearance, called by ground/tile painters.
 * Reads/writes: Reads decor, displayed water and retained banks; writes per-mount cover/mask caches and local raster targets through the supplied context.
 */
import { paintSeaCover } from '../../render/seaCover';
import { PALETTES } from '../../render/styles';
import { cityWaterwayPaths } from '../../render/cityWaterways';
import { type Terrain3dTile, type Terrain3dTileContent } from '../terrain3d';
import type { Decor } from '../decor';
import { paintRetainedRegime } from '../retainedWaterRegime';
import { City3dWaterDisplay } from './cityTypes';
import type { City3dContext } from './cityContext';

export const WATER = [74, 134, 179];

export function fillCanals(cityContext: City3dContext, ctx: CanvasRenderingContext2D, tile: { x: number; y: number }, k: number): void {
  const layouts = cityContext.options.getLayouts?.();
  if (!layouts?.length || cityContext.options.getPlanOptions?.()?.layers?.waterways === false) return;
  ctx.save();
  ctx.setTransform(k, 0, 0, k, -tile.x * k, -tile.y * k);
  ctx.fill(cityWaterwayPaths(layouts).water);
  ctx.restore();
}

/** `cover`: the running water only (dry and frozen courses leave the cover); `ink`: the map symbols too. */
export function fillRetainedWater(cityContext: City3dContext, ctx: CanvasRenderingContext2D, tile: Terrain3dTile, k: number, color: string, mode: 'cover' | 'ink' | 'symbols' | 'ground' | 'ice' = 'cover'): void {
  if (!cityContext.retainedWater?.paths.length) return;
  ctx.save();
  ctx.setTransform(k, 0, 0, k, -tile.x * k, -tile.y * k);
  ctx.fillStyle = color;
  if (cityContext.retainedWater.regime) paintRetainedRegime(ctx, cityContext.retainedWater.paths, cityContext.retainedWater.regime, mode, color, cityContext.retainedWater.style);
  else if (mode === 'cover' || mode === 'ink') for (const item of cityContext.retainedWater.paths) ctx.fill(item.path, item.rule);
  ctx.restore();
}

/** Render3D mode: water only, land left transparent for the procedural ground. */
export function water(cityContext: City3dContext, d: Decor, visible = true): HTMLCanvasElement {
  const { n, water, height } = d.raster,
    c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!,
    pixels = ctx.createImageData(n, n);
  const rivers = !cityContext.vectorRivers(),
    heights = height?.length === n * n ? height : undefined;
  // The sea follows the 2D coast (render/seaCover.ts): the zero level of the decor heights, not the sea cell flag.
  if (visible) for (let i = 0; i < n * n; i++) if (water[i] && !(heights && water[i] === 1) && (rivers || water[i] !== 3)) pixels.data.set([...WATER, 255], i * 4);
  if (visible && heights) paintSeaCover(pixels.data, heights, [...WATER, 255]);
  ctx.putImageData(pixels, 0, 0);
  return c;
}

export function waterPath(cityContext: City3dContext, d: Decor): Path2D | undefined {
  // Retained banks already include rivers and lakes, rounded for display. Adding
  // the planning polygons again restores their unsmoothed grid corners.
  if (cityContext.vectorRivers()) return;
  const polygons = d.raster.geometry?.water;
  if (!polygons?.length) return undefined;
  const path = new Path2D();
  for (const polygon of polygons)
    for (const ring of polygon) {
      if (ring.length < 3) continue;
      path.moveTo(ring[0].x, ring[0].y);
      for (let i = 1; i < ring.length; i++) path.lineTo(ring[i].x, ring[i].y);
      path.closePath();
    }
  return path;
}

export function materialCover(cityContext: City3dContext, d: Decor, mask: HTMLCanvasElement, waterVisible: boolean): HTMLCanvasElement {
  const display = cityContext.waterDisplay,
    retained = cityContext.retainedWater,
    paths = cityContext.waterPaths;
  if (cityContext.coverOf && cityContext.coverOf.mask === mask && cityContext.coverOf.paths === paths && cityContext.coverOf.display === display && cityContext.coverOf.retained === retained && cityContext.coverOf.visible === waterVisible) return cityContext.coverOf.canvas;
  let canvas = mask;
  if (waterVisible && (paths || display?.riverPaths || retained?.paths.length)) {
    canvas = document.createElement('canvas');
    canvas.width = mask.width;
    canvas.height = mask.height;
    const ctx = canvas.getContext('2d')!,
      k = mask.width / d.raster.width,
      mpp = 1 / k,
      whole: Terrain3dTile = { key: 'cover', x: 0, y: 0, width: d.raster.width, level: 0, pixels: mask.width };
    ctx.drawImage(mask, 0, 0);
    ctx.save();
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.fillStyle = ctx.strokeStyle = `rgb(${WATER})`;
    if (paths) ctx.fill(paths, 'evenodd');
    if (display?.riverPaths) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = 1.5 * mpp;
      ctx.fill(display.riverPaths);
      ctx.stroke(display.riverPaths);
    }
    if (display?.regime) display.regime(ctx, 'erase', mpp);
    ctx.restore();
    cityContext.fillRetainedWater(ctx, whole, k, `rgb(${WATER})`);
  }
  cityContext.coverOf = { mask, paths, display, retained, visible: waterVisible, canvas };
  return canvas;
}

export function currentWaterDisplay(cityContext: City3dContext): City3dWaterDisplay | undefined {
  const supplied = cityContext.options.getWaterDisplay?.();
  if (supplied) return supplied;
  const d = cityContext.surfaceDecor,
    look = cityContext.options.getLook?.();
  if (!d || !look) return;
  const palette = cityContext.options.getText?.().palette ?? PALETTES.parchment,
    key = JSON.stringify([look.waterVisible, look.waterLook, palette.lakeFill, palette.waterEdge, cityContext.vectorRivers()]);
  if (cityContext.fallbackWater?.decor === d && cityContext.fallbackWater.key === key) return cityContext.fallbackWater.display;
  const texture = cityContext.water(d, look.waterVisible !== false),
    ink = look.waterLook === 'ink' ? { fill: palette.lakeFill, stroke: palette.waterEdge } : undefined;
  if (ink) {
    const ctx = texture.getContext('2d')!;
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = ink.fill;
    ctx.fillRect(0, 0, texture.width, texture.height);
    ctx.globalCompositeOperation = 'source-over';
  }
  const display = { texture, paths: cityContext.waterPath(d), ink };
  cityContext.fallbackWater = { decor: d, key, display };
  return display;
}

export async function waterTile(cityContext: City3dContext, tile: Terrain3dTile): Promise<Terrain3dTileContent['water']> {
  const display = cityContext.currentWaterDisplay();
  if (!display) return;
  // A halo lets optical-depth taps cross tile borders without inventing banks there.
  // Bound the halo, not the raster density: capping n after expanding the world extent
  // magnified texels at close zoom and made narrow river sections disappear.
  const pixels = tile.pixels,
    pad = Math.min(Math.ceil(pixels / 2), Math.ceil((128 * pixels) / tile.width)),
    n = pixels + 2 * pad;
  const extent = { ...tile, x: tile.x - (pad * tile.width) / pixels, y: tile.y - (pad * tile.width) / pixels, width: (tile.width * (pixels + 2 * pad)) / pixels };
  const width = cityContext.surfaceDecor!.raster.width,
    k = n / extent.width,
    source = display.texture;
  const waterTileScratch = document.createElement('canvas');
  waterTileScratch.width = waterTileScratch.height = n;
  const ctx = waterTileScratch.getContext('2d')!;
  const scale = source.width / width;
  await cityContext.drawWaterCells(ctx, source, extent.x * scale, extent.y * scale, extent.width * scale, n);
  if (display.paths) {
    ctx.setTransform(k, 0, 0, k, -extent.x * k, -extent.y * k);
    ctx.fillStyle = '#fff';
    ctx.fill(display.paths, 'evenodd');
  }
  if (display.riverPaths) {
    // A river keeps a minimum width of two texels at every tile resolution: a thin ribbon on a far tile would
    // otherwise fade to a partial coverage and read as pale blue that darkens, and flickers, as the tiles refine.
    ctx.setTransform(k, 0, 0, k, -extent.x * k, -extent.y * k);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.5 / k;
    ctx.fill(display.riverPaths);
    ctx.stroke(display.riverPaths);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  cityContext.fillRetainedWater(ctx, extent, k, '#fff');
  // Full beds clear vegetation too; their flat silt colour is painted on the final overlay.
  if (cityContext.proceduralGround && cityContext.retainedWater) {
    ctx.setTransform(k, 0, 0, k, -extent.x * k, -extent.y * k);
    ctx.fillStyle = '#fff';
    for (const item of cityContext.retainedWater.paths) ctx.fill(item.path, item.rule);
  }
  ctx.fillStyle = '#fff';
  cityContext.fillCanals(ctx, extent, k);
  const alpha = await cityContext.tileWaterMask.read(waterTileScratch);
  return { x: extent.x, y: extent.y, width: extent.width, n, alpha };
}

/** Rural and urban material tints share one water clearance. The raster and exact shoreline both stay authoritative. */
export async function clearSemanticWater(cityContext: City3dContext, tile: Terrain3dTile, ctx: CanvasRenderingContext2D): Promise<void> {
  const d = cityContext.surfaceDecor!,
    size = ctx.canvas.width,
    k = size / tile.width;
  // Parchment: river cells are not cut out. A cut reveals the 1024 px map capture underneath, whose stream banks are
  // cream: in 3D every stream read as a white scratch. The streams are inked over the land use instead, in the river colour.
  const palette = cityContext.options.getText?.()?.palette,
    ink = palette?.name === 'parchment' ? palette.riverFill : undefined;
  const regime = cityContext.currentWaterDisplay();
  if (!cityContext.openWater || cityContext.openWater.ink !== ink || cityContext.openWater.display !== regime || cityContext.openWater.retained !== cityContext.retainedWater) {
    // With vector rivers the raster cuts only the sea and lakes: its 30 m river cells blurred a wide notch into the land use.
    const { n, water } = d.raster,
      mask = document.createElement('canvas'),
      rivers = !cityContext.vectorRivers();
    mask.width = mask.height = n;
    const context = mask.getContext('2d')!,
      pixels = context.createImageData(n, n);
    for (let i = 0; i < n * n; i++) if (water[i] > 0 && water[i] < (ink || !rivers ? 3 : 4)) pixels.data[i * 4 + 3] = 255;
    context.putImageData(pixels, 0, 0);
    cityContext.openWater = { mask, paths: cityContext.waterPath(d), ink, display: regime, retained: cityContext.retainedWater };
    if (ink && rivers) {
      const streams = document.createElement('canvas');
      streams.width = streams.height = n;
      const sx = streams.getContext('2d')!,
        inked = sx.createImageData(n, n),
        v = parseInt(ink.slice(1, 7), 16);
      for (let i = 0; i < n * n; i++)
        if (water[i] === 3) {
          inked.data[i * 4] = (v >> 16) & 255;
          inked.data[i * 4 + 1] = (v >> 8) & 255;
          inked.data[i * 4 + 2] = v & 255;
          inked.data[i * 4 + 3] = 230;
        }
      sx.putImageData(inked, 0, 0);
      cityContext.openWater.streams = streams;
      // Dry and frozen courses are not inked as running streams: their own symbols are drawn over the tile.
      if (regime?.regime) {
        sx.setTransform(n / d.raster.width, 0, 0, n / d.raster.width, 0, 0);
        regime.regime(sx, 'erase', d.raster.width / n);
        sx.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
  }
  const { mask, paths, streams } = cityContext.openWater,
    scale = mask.width / d.raster.width;
  ctx.setTransform(k, 0, 0, k, -tile.x * k, -tile.y * k);
  ctx.globalCompositeOperation = 'destination-out';
  if (paths) ctx.fill(paths, 'evenodd');
  if (cityContext.retainedWater) for (const item of cityContext.retainedWater.paths) ctx.fill(item.path, item.rule);
  if (regime?.riverPaths) ctx.fill(regime.riverPaths);
  if (cityContext.materialCanals()) {
    ctx.fillStyle = '#fff';
    cityContext.fillCanals(ctx, tile, k);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;
  await cityContext.drawWaterCells(ctx, mask, tile.x * scale, tile.y * scale, tile.width * scale, size);
  ctx.globalCompositeOperation = 'source-over';
  if (streams) ctx.drawImage(streams, tile.x * scale, tile.y * scale, tile.width * scale, tile.width * scale, 0, 0, size, size);
}
