/**
 * The exact raster tiles of the map: drawVector rendered per tile (recorded and rasterized on WebGL2 by the shared
 * GPU instance, or drawn by the processor), cached per scale bucket, composed into the view with the furniture on top.
 * Callers: captures, exports and sheets (`draw(view)`: exact scale, synchronous); the fallback display of the page
 * (`draw(view, { live: true })`: half-octave density buckets, progressive filling under a coarse whole-map preview and
 * the last picture, never blocking); the 3D drape (`drawGround`, and the pyramid of live tiles it reuses); the
 * miniature (`drawCachedMap`).
 * Reads: scene, world, palette, the semantic and road keys of the host. Writes: activeLive, activeLight, activeDpr,
 * layerTilesFit, rasterFailed, stats.
 */
import { isUnderdarkBiome } from '../../gen/biomes';
import type { Vec2 } from '../../gen/types';
import { Palette } from '../styles';
import { roadCanopyRevision } from '../roadStyle';
import { whiteWaterRevision } from '../whiteWater';
import { RasterTileCache } from '../rasterTiles';
import { LiveTileFill } from '../liveTileFill';
import { LAND_ORDER, PolyLayer } from '../scene';
import { selectLod, FURROW_MIN_PX, FURROW_HOLDER_BUDGET } from '../lod';
import { View, viewRect, Rect4 } from '../view';
import { displayQualityFor } from '../displayQuality';
import { RecordingCanvas } from '../gpu/recorder';
import type { DisplayList } from '../gpu/displayList';
import { getVectorEngine, noteCpuTile, noteGpuFailure, noteGpuFallback, noteGpuTile, vectorRasterizer } from '../vectorEngine';
import { CanvasLike, FrameStats } from './types';
import type { CartographyContext } from './context';
import { drawVector } from './vector';
import { addRing } from './geometry';
import { releaseDrapeTemps, layerTilesFitView } from './woods';
import { forestWashSteps } from './forest';
import { BUILDING_BUDGET_FULL, BUILDING_BUDGET_MAX, BUILDING_BUDGET_INDIV } from './urban';

export function createExactTiles(c: CartographyContext) {
  const { pal, deps, S, P, makeCanvas, now, canvas, cache, polyL, paintMargin, getTerrain } = c;
  /** Side of the coarse whole-map raster shown under the missing live tiles. */
  const PREVIEW_PX = 2048;
  /** Exact tiles and live tiles of the fallback display, per key (scale bucket, pixel ratio, engine, quality, budgets, semantic key, tile). */
  const rasterCache = new RasterTileCache<CanvasImageSource>(deps.rasterBytes);
  const mapPyramid = new Map<string, { x: number; y: number; span: number; pixels: number; gutter: number; density: number; semantic: string; light: boolean }>();
  const rasterFill = new LiveTileFill(now);
  const previewFill = new LiveTileFill(now);
  let lastRaster: { canvas: CanvasLike; view: View; dpr: number } | undefined;
  const suspendLive = (): void => {
    rasterFill.suspend();
    previewFill.suspend();
  };
  const dropLastRaster = (): void => {
    if (lastRaster) {
      lastRaster.canvas.width = 0;
      lastRaster.canvas.height = 0;
    }
    lastRaster = undefined;
  };
  /** The whole map rasterised once at a coarse density: a live view shows it under its missing tiles, never blank tiles. */
  let preview: { key: string; canvas: CanvasLike } | undefined;
  const dropPreview = (): void => {
    previewFill.suspend();
    if (preview) {
      preview.canvas.width = 0;
      preview.canvas.height = 0;
    }
    preview = undefined;
  };
  function rasterBudget(rect: Rect4, scale: number): string {
    const count = (l?: PolyLayer): number => (l ? l.index.tilesInRect(rect).reduce((n, t) => n + l.index.itemsOf(t).length, l.index.bigInRect(rect).length) : 0);
    const masses = count(polyL('u-masses')),
      buildings = count(polyL('u-bldg'));
    let furrows = 0;
    if (c.scene.furrows)
      for (const i of c.scene.furrows.index.query(rect)) {
        const b = i * 4,
          boxes = c.scene.furrows.index.boxes;
        if (Math.min(boxes[b + 2] - boxes[b], boxes[b + 3] - boxes[b + 1]) * scale >= FURROW_MIN_PX) furrows++;
        if (furrows > FURROW_HOLDER_BUDGET) break;
      }
    return `${masses <= BUILDING_BUDGET_FULL},${masses <= BUILDING_BUDGET_MAX},${buildings <= BUILDING_BUDGET_INDIV},${furrows <= FURROW_HOLDER_BUDGET}|` + c.scene.textures.map(tl => `${tl.kind}:${tl.index.tilesInRect(rect).length <= 500}`).join(',');
  }

  /** Capture callers omit options: exact scale, synchronous completion, full detail. */
  function draw(view: View, options?: { live: boolean }): FrameStats {
    c.activeLive = !!options?.live;
    c.activeLight = displayQualityFor(c.activeLive) === 'light';
    if (!c.activeLive) suspendLive();
    try {
      return drawFrame(view);
    } finally {
      c.activeLight = c.activeLive = false;
      c.activeDpr = undefined;
    }
  }
  function drawFrame(view: View): FrameStats {
    if (deps.raster === false || c.rasterFailed) return drawVector(c, view);
    const start = now(),
      dpr = deps.dpr ?? (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return c.stats;
    const cssW = canvas.width / dpr,
      cssH = canvas.height / dpr,
      rect = viewRect(view, cssW, cssH);
    const live = c.activeLive && !!deps.invalidate && typeof requestAnimationFrame === 'function';
    const scale = live ? 2 ** (Math.floor(2 * Math.log2(view.scale)) / 2) : view.scale;
    const k = scale * dpr,
      outputK = view.scale * dpr,
      ratio = view.scale / scale;
    // Small live CPU tiles bound each indivisible raster operation; captures
    // retain their exact density and larger tiles. Polygon paths are clipped below.
    // Raster cost no longer bounds GPU tiles: live ones are larger, so a view needs fewer.
    const engine = getVectorEngine();
    const tilePx = live ? (engine === 'gpu' ? 512 : 256) : 512,
      gutter = live ? (engine === 'gpu' ? 16 : 8) : 32,
      tileSize = tilePx / k;
    const x0 = Math.floor(rect.minX / tileSize),
      y0 = Math.floor(rect.minY / tileSize);
    const x1 = Math.floor(rect.maxX / tileSize),
      y1 = Math.floor(rect.maxY / tileSize);
    const budget = rasterBudget(rect, scale);
    c.layerTilesFit = (c.activeLight && scale < 1) || layerTilesFitView(c, rect, k);
    const requests: { key: string; x: number; y: number }[] = [];
    const semanticKey = `${deps.semantic?.key() ?? ''}|${deps.roadStyle?.().emphasis ?? 1}|${deps.urbanPlan?.() !== false}|${roadCanopyRevision()}|${whiteWaterRevision()}`;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) requests.push({ key: `${scale}|${dpr}|${live ? 'live' : 'exact'}|${engine}|${c.activeLight}|${budget}|${semanticKey}|${x},${y}`, x, y });
    if (requests.length * (tilePx + 2 * gutter) ** 2 * 4 > rasterCache.maxBytes) return drawVector(c, view);
    const buildTile = (request: (typeof requests)[number]): CanvasImageSource => {
      const side = tilePx + 2 * gutter,
        bytes = side * side * 4;
      const tileView = { cx: (request.x + 0.5) * tileSize, cy: (request.y + 0.5) * tileSize, scale };
      let resource: CanvasImageSource | undefined,
        release = (): void => {};
      if (getVectorEngine() === 'gpu') {
        // GPU engine: record the same drawVector calls, replay them on WebGL2. Unsupported lists and errors fall back to the CPU below.
        try {
          const t0 = now(),
            rec = new RecordingCanvas(side, side);
          // A recording failure (a Canvas call the recorder lacks) costs this tile only; a raster failure demotes the engine.
          let st: FrameStats | undefined, list: DisplayList | undefined;
          try {
            st = drawVector(c, tileView, rec as unknown as CanvasLike, 'map', rect);
            list = rec.finish();
          } catch (error) {
            noteGpuFallback(`record: ${error instanceof Error ? error.message : String(error)}`);
          }
          const t1 = now(),
            gpu = list ? vectorRasterizer() : null;
          if (list?.unsupported) noteGpuFallback(list.unsupported);
          else if (list && st && gpu) {
            try {
              const bitmap = gpu.rasterize(list);
              noteGpuTile(t1 - t0, now() - t1, gpu.lastStats().synced);
              pathsBuilt += st.pathsBuilt;
              mapStats = st;
              resource = bitmap;
              release = () => bitmap.close();
            } catch (error) {
              noteGpuFailure(error);
            }
          }
        } finally {
          releaseDrapeTemps(c);
        }
      }
      if (!resource) {
        const t0 = now(),
          target = makeCanvas(side, side);
        // Keep vector replay local to a small CPU surface. Only the finished tile
        // is uploaded; multiply display lists cannot accumulate in Chrome's GPU queue.
        if (!target?.getContext('2d', { willReadFrequently: true })) throw new Error('Overlay tile allocation failed');
        const st = drawVector(c, tileView, target, 'map', rect);
        pathsBuilt += st.pathsBuilt;
        mapStats = st;
        // The finished CPU tile becomes an ImageBitmap here: its deferred raster runs inside this progressive step
        // (one tile), not in the first drawImage of the frame that composes every tile, and later blits of a bitmap
        // are cheaper than re-blitting the software canvas.
        const bitmap = typeof (target as { transferToImageBitmap?: () => ImageBitmap }).transferToImageBitmap === 'function' ? (target as unknown as OffscreenCanvas).transferToImageBitmap() : undefined;
        resource = (bitmap ?? target) as unknown as CanvasImageSource;
        release = () => {
          if (bitmap) bitmap.close();
          else {
            target.width = 0;
            target.height = 0;
          }
        };
        noteCpuTile(now() - t0);
      }
      const margin = paintMargin(scale) + gutter / k;
      rasterCache.put(request.key, { value: resource, bytes, bounds: { minX: request.x * tileSize - margin, minY: request.y * tileSize - margin, maxX: (request.x + 1) * tileSize + margin, maxY: (request.y + 1) * tileSize + margin }, release });
      if (live) {
        mapPyramid.set(request.key, { x: request.x * tileSize, y: request.y * tileSize, span: tileSize, pixels: tilePx, gutter, density: k, semantic: semanticKey, light: c.activeLight });
        // Metadata owns no images; prune descriptors when their LRU images have gone away.
        if (mapPyramid.size > 2048) for (const key of mapPyramid.keys()) if (!rasterCache.get(key)) mapPyramid.delete(key);
      }
      rasterBuilt++;
      return resource;
    };
    const tiles: { image: CanvasImageSource; x: number; y: number }[] = [];
    let rasterBuilt = 0,
      rasterHits = 0,
      pathsBuilt = 0,
      missing = 0;
    let mapStats: FrameStats | undefined;
    try {
      for (const request of requests) {
        let image = rasterCache.get(request.key);
        if (image) rasterHits++;
        else if (live) {
          missing++;
          continue;
        } else image = buildTile(request);
        tiles.push({ image, x: request.x, y: request.y });
      }
      if (live && missing) {
        const jobKey = requests.map(r => r.key).join(';') + `|${rect.minX},${rect.minY},${rect.maxX},${rect.maxY}`;
        const light = c.activeLight,
          fit = c.layerTilesFit;
        rasterFill.start(
          jobKey,
          function* () {
            // The first forest tile must not build eleven whole-map wash layers in
            // one frame. Captures drain the same generator synchronously.
            if (!isUnderdarkBiome(c.world.options.biome) && !(light && pal.name === 'parchment' && scale < 1)) {
              for (const name of ['lu-forest', 'u-cover-forest']) yield* forestWashSteps(c, name);
            }
            const cx = view.cx / tileSize - 0.5,
              cy = view.cy / tileSize - 0.5;
            const queue = requests.filter(r => !rasterCache.get(r.key)).sort((a, b) => (a.x - cx) ** 2 + (a.y - cy) ** 2 - (b.x - cx) ** 2 - (b.y - cy) ** 2);
            // The coarse map stands in meanwhile: the view sharpens at once when its tiles are ready (a long job shows its
            // progress once a second), instead of a repaint per tile that shows the tiles filling one by one.
            let shown = now();
            for (let i = 0; i < queue.length; i++) {
              const request = queue[i];
              c.activeLive = true;
              c.activeLight = light;
              c.activeDpr = dpr;
              c.layerTilesFit = fit;
              try {
                if (!rasterCache.get(request.key)) buildTile(request);
              } finally {
                c.activeLive = c.activeLight = false;
                c.activeDpr = undefined;
              }
              const present = i === queue.length - 1 || now() - shown > 1000;
              if (present) shown = now();
              yield present;
            }
          },
          deps.invalidate!,
          () => {
            c.rasterFailed = true;
          },
        );
      } else suspendLive();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      const coarse = live && missing ? mapPreview(semanticKey) : undefined;
      if (coarse) {
        ctx.save();
        ctx.setTransform(outputK, 0, 0, outputK, -rect.minX * outputK, -rect.minY * outputK);
        ctx.drawImage(coarse, 0, 0, S, S);
        ctx.restore();
      }
      if (live && missing && lastRaster) {
        const old = lastRaster,
          factor = ((view.scale / old.view.scale) * dpr) / old.dpr;
        const x = canvas.width / 2 + (old.view.cx - view.cx) * outputK - (old.canvas.width * factor) / 2;
        const y = canvas.height / 2 + (old.view.cy - view.cy) * outputK - (old.canvas.height * factor) / 2;
        // Replaces the coarse map where it reaches (translucent tints never double).
        if (coarse) ctx.clearRect(x, y, old.canvas.width * factor, old.canvas.height * factor);
        ctx.drawImage(old.canvas as unknown as CanvasImageSource, x, y, old.canvas.width * factor, old.canvas.height * factor);
      }
      for (const tile of tiles) {
        const x = (tile.x * tileSize - rect.minX) * outputK,
          y = (tile.y * tileSize - rect.minY) * outputK;
        // Gutters supply filtering samples, but each output pixel belongs to one
        // tile only. Overpainting them darkens transparent land-use overlays.
        // Integer device-pixel partitions also avoid fractional clipping seams.
        const left = Math.round(x),
          top = Math.round(y);
        const width = Math.round(x + tilePx * ratio) - left,
          height = Math.round(y + tilePx * ratio) - top;
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        ctx.clearRect(left, top, width, height);
        ctx.drawImage(tile.image, x - gutter * ratio, y - gutter * ratio, (tilePx + 2 * gutter) * ratio, (tilePx + 2 * gutter) * ratio);
        ctx.restore();
      }
      if (live) {
        if (!lastRaster || lastRaster.canvas.width !== canvas.width || lastRaster.canvas.height !== canvas.height) {
          dropLastRaster();
          const target = makeCanvas(canvas.width, canvas.height);
          if (target) lastRaster = { canvas: target, view: { ...view }, dpr };
        }
        const retained = lastRaster?.canvas.getContext('2d');
        if (retained && lastRaster) {
          retained.clearRect(0, 0, canvas.width, canvas.height);
          retained.drawImage(canvas as unknown as CanvasImageSource, 0, 0);
          lastRaster.view = { ...view };
          lastRaster.dpr = dpr;
        }
      }
      const overlay = drawVector(c, view, canvas, 'overlays');
      c.stats = { ...(mapStats ?? overlay), ms: now() - start, band: selectLod(view.scale).band, scale: view.scale, pathsBuilt, pathCache: cache.size, rasterHits, rasterBuilt, rasterPending: missing, rasterBytes: rasterCache.bytes };
      return c.stats;
    } catch {
      c.rasterFailed = true;
      rasterCache.clear();
      return drawVector(c, view);
    }
  }
  /** A CPU preview with a fixed geometry budget, refined cooperatively. Never run
   * the full renderer (wash/stamp passes) over the whole map just to hide a missing tile. */
  function mapPreview(semantic: string): CanvasImageSource | undefined {
    const key = `${semantic}|${c.activeLight}`;
    if (preview?.key === key) return preview.canvas as unknown as CanvasImageSource;
    dropPreview();
    const px = PREVIEW_PX,
      target = makeCanvas(px, px);
    const ctx = target?.getContext('2d', { willReadFrequently: true });
    if (!target || !ctx) return undefined;
    ctx.setTransform(px / S, 0, 0, px / S, 0, 0);
    if (!deps.transparentBackground) {
      ctx.fillStyle = pal.paper;
      ctx.fillRect(0, 0, S, S);
    }
    preview = { key, canvas: target };
    previewFill.start(
      key,
      function* () {
        const tex = getTerrain();
        if (tex) ctx.drawImage(tex, 0, 0, S, S);
        yield true;
        let remaining = 32768,
          shapes = 4096;
        const names = [...LAND_ORDER.map(kind => 'lu-' + kind), 'sea', 'lakes', 'rivers', 'u-masses'];
        for (const name of names) {
          const layer = polyL(name);
          if (!layer) continue;
          const kind = name.slice(3) as keyof Palette['land'];
          if (name.startsWith('lu-') && !(deps.mask?.landuse ?? c.world.options.landuse)) continue;
          ctx.fillStyle = name === 'sea' ? pal.seaFill : name === 'lakes' ? pal.lakeFill : name === 'rivers' ? pal.riverFill : name === 'u-masses' ? pal.urban.mass : pal.land[kind];
          ctx.globalAlpha = name.startsWith('lu-') ? pal.landOpacity : 1;
          ctx.globalCompositeOperation = name.startsWith('lu-') && pal.landBlend === 'multiply' ? 'multiply' : 'source-over';
          for (let i = 0; i < layer.polys.length && remaining > 0 && shapes > 0; i++) {
            const b = i * 4,
              box = layer.index.boxes;
            if ((box[b + 2] - box[b]) * (box[b + 3] - box[b + 1]) < (S / px) ** 2) continue;
            const path = new P();
            let vertices = 0;
            for (const ring of [layer.polys[i], ...(layer.holes?.[i] ?? [])]) {
              if (remaining < 3) break;
              const stride = Math.max(1, Math.ceil(ring.length / Math.min(256, remaining)));
              const points: Vec2[] = [];
              let last: Vec2 | undefined;
              for (let j = 0; j < ring.length && remaining > 0; j += stride) {
                const p = ring[j];
                if (last && (p.x - last.x) ** 2 + (p.y - last.y) ** 2 < (S / px) ** 2) continue;
                points.push(p);
                last = p;
                remaining--;
                vertices++;
              }
              addRing(path, points);
            }
            if (vertices >= 3) {
              ctx.fill(path, 'evenodd');
              shapes--;
            }
            // At most one small polygon per cooperative step; no stamp passes.
            yield true;
          }
        }
      },
      deps.invalidate ?? (() => {}),
      () => {},
    );
    return target as unknown as CanvasImageSource;
  }
  function drawCachedMap(target: CanvasLike, box: Rect4): boolean {
    const ctx = target.getContext('2d');
    if (!ctx) return false;
    const semantic = `${deps.semantic?.key() ?? ''}|${deps.roadStyle?.().emphasis ?? 1}|${deps.urbanPlan?.() !== false}|${roadCanopyRevision()}|${whiteWaterRevision()}`;
    const light = displayQualityFor(true) === 'light',
      density = target.width / (box.maxX - box.minX);
    // Coarse first; a finer cached quadrant replaces it without doubling translucent ink.
    const tiles = [...mapPyramid].filter(([, t]) => t.semantic === semantic && t.light === light && t.density <= density * 2 && t.x < box.maxX && t.y < box.maxY && t.x + t.span > box.minX && t.y + t.span > box.minY).sort((a, b) => a[1].density - b[1].density);
    let drawn = false;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (preview?.key === `${semantic}|${light}`) {
      ctx.drawImage(preview.canvas as unknown as CanvasImageSource, -box.minX * density, -box.minY * density, S * density, S * density);
      drawn = true;
    }
    for (const [key, tile] of tiles) {
      const image = rasterCache.get(key);
      if (!image) {
        mapPyramid.delete(key);
        continue;
      }
      const x = (tile.x - box.minX) * density,
        y = (tile.y - box.minY) * density,
        size = tile.span * density;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, size, size);
      ctx.clip();
      ctx.clearRect(x, y, size, size);
      ctx.drawImage(image, tile.gutter, tile.gutter, tile.pixels, tile.pixels, x, y, size, size);
      ctx.restore();
      drawn = true;
    }
    ctx.restore();
    return drawn;
  }
  function drawGround(target: CanvasLike, box: Rect4, options?: { live: boolean }): boolean {
    const previousLive = c.activeLive,
      previousLight = c.activeLight;
    c.activeLive = !!options?.live;
    c.activeLight = displayQualityFor(c.activeLive) === 'light';
    try {
      return paintGround(target, box);
    } finally {
      c.activeLive = previousLive;
      c.activeLight = previousLight;
    }
  }
  function paintGround(target: CanvasLike, box: Rect4): boolean {
    const dpr = deps.dpr ?? (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1;
    const view = { cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2, scale: target.width / (box.maxX - box.minX) / dpr };
    const drawn = (fs: FrameStats): boolean => fs.tilesDrawn + fs.bigDrawn + fs.textureTiles > 0;
    if (getVectorEngine() === 'gpu') {
      const t0 = now();
      try {
        const rec = new RecordingCanvas(target.width, target.height);
        let fs: FrameStats | undefined, list: DisplayList | undefined;
        try {
          fs = drawVector(c, view, rec as unknown as CanvasLike, 'ground');
          list = rec.finish();
        } catch (error) {
          noteGpuFallback(`record: ${error instanceof Error ? error.message : String(error)}`);
        }
        const t1 = now(),
          gpu = list ? vectorRasterizer() : null,
          tx = target.getContext('2d');
        if (list?.unsupported) noteGpuFallback(list.unsupported);
        else if (list && fs && gpu && tx) {
          let bitmap: ImageBitmap | undefined;
          try {
            bitmap = gpu.rasterize(list);
          } catch (error) {
            noteGpuFailure(error);
          }
          if (bitmap) {
            try {
              tx.setTransform(1, 0, 0, 1, 0, 0);
              tx.globalAlpha = 1;
              tx.globalCompositeOperation = 'source-over';
              tx.clearRect(0, 0, target.width, target.height);
              tx.drawImage(bitmap, 0, 0);
            } finally {
              bitmap.close();
            }
            noteGpuTile(t1 - t0, now() - t1, gpu.lastStats().synced);
            return drawn(fs);
          }
        }
      } finally {
        releaseDrapeTemps(c);
      }
    }
    const t0 = now(),
      fs = drawVector(c, view, target, 'ground');
    noteCpuTile(now() - t0);
    return drawn(fs);
  }
  /** Bytes held by the tiles, the last picture and the preview. */
  const bytes = (): number => rasterCache.bytes + (lastRaster ? lastRaster.canvas.width * lastRaster.canvas.height * 4 : 0) + (preview ? preview.canvas.width * preview.canvas.height * 4 : 0);
  return { rasterCache, mapPyramid, suspendLive, dropLastRaster, dropPreview, draw, drawCachedMap, drawGround, bytes };
}
