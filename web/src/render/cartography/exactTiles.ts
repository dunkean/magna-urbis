/**
 * The exact raster tiles of the map: drawVector rendered per tile (recorded and rasterized on WebGL2 by the shared tile
 * rasterizer, or drawn by the processor), cached per key, composed into the view with the furniture on top.
 *
 * Two ways to paint a view:
 *  - synchronous (`draw(view)`): captures, exports and sheets, at the view's scale; every missing tile is built before
 *    the call returns.
 *  - stepwise (`draw(view, { stepwise: true })`): the composed view for an overlay whose live layer is not its picture at
 *    rest (`restExact` false), and the fallback display. A call composes the tiles it has and starts a job that builds
 *    the missing ones in slices of at most 8 ms per animation frame (StepwisePaint), asking for a repaint as they come.
 *    Under the missing tiles it draws the last picture it painted, moved to the view: the fallback display shows its
 *    picture while it fills. Its tiles are smaller (each one is a step), drawn at the half-octave scale of the view
 *    (the live overlay's), and feed the tile pyramid.
 * The 3D drape paints its tiles here too (`drawGround`), and reads the pyramid of stepwise tiles as its stand-in, as
 * does the miniature (`drawCachedMap`).
 * Reads: scene, world, palette, the semantic and road keys of the host. Writes: stepwise, activeLight, activeDpr,
 * layerTilesFit, rasterFailed, stats.
 */
import { isUnderdarkBiome } from '../../gen/biomes';
import { roadCanopyRevision } from '../roadStyle';
import { whiteWaterRevision } from '../whiteWater';
import { RasterTileCache } from '../rasterTiles';
import { StepwisePaint } from '../stepwisePaint';
import type { PolyLayer } from '../scene';
import { selectLod, FURROW_MIN_PX, FURROW_HOLDER_BUDGET } from '../lod';
import { viewRect, type Rect4, type View } from '../view';
import { displayQualityFor } from '../displayQuality';
import { RecordingCanvas } from '../gpu/recorder';
import type { DisplayList } from '../gpu/contract';
import { getVectorEngine, noteCpuTile, noteGpuFailure, noteGpuFallback, noteGpuTile, vectorRasterizer } from '../vectorEngine';
import type { CanvasLike, FrameStats } from './contract';
import type { CartographyContext } from './context';
import { drawVector } from './vector';
import { releaseDrapeTemps, layerTilesFitView } from './woods';
import { forestWashSteps } from './forest';
import { BUILDING_BUDGET_FULL, BUILDING_BUDGET_MAX, BUILDING_BUDGET_INDIV } from './urban/frame';

export function createExactTiles(c: CartographyContext) {
  const { deps, makeCanvas, now, canvas, cache, polyL, paintMargin } = c;
  /** Tiles per key (scale, pixel ratio, tile geometry, engine, quality, detail budgets, semantic key, position). */
  const rasterCache = new RasterTileCache<CanvasImageSource>(deps.rasterBytes);
  /** Where each stepwise tile lies and at which density: the stand-in of the 3D drape and of the miniature. */
  const mapPyramid = new Map<string, { x: number; y: number; span: number; pixels: number; gutter: number; density: number; semantic: string; light: boolean }>();
  const tileFill = new StepwisePaint(now);
  /** The last stepwise picture, drawn under the tiles still missing from the next one. */
  let lastPicture: { canvas: CanvasLike; view: View; dpr: number } | undefined;
  const suspendStepwise = (): void => tileFill.suspend();
  const dropLastPicture = (): void => {
    if (lastPicture) {
      lastPicture.canvas.width = 0;
      lastPicture.canvas.height = 0;
    }
    lastPicture = undefined;
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

  /** Captures omit options: synchronous completion, full detail. Stepwise paints also follow the browser quality policy. */
  function draw(view: View, options?: { stepwise: boolean }): FrameStats {
    c.stepwise = !!options?.stepwise;
    c.activeLight = displayQualityFor(c.stepwise) === 'light';
    if (!c.stepwise) suspendStepwise();
    try {
      return drawFrame(view);
    } finally {
      c.activeLight = c.stepwise = false;
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
    const stepwise = c.stepwise && !!deps.invalidate && typeof requestAnimationFrame === 'function';
    // Captures are drawn at the view's exact scale. Stepwise tiles are drawn at the half-octave scale of the live
    // overlay's regions (render/live/overlayLayer.ts) and laid at the view's (`ratio`, within 2^±1/4): a pan or a
    // zoom inside the bucket reuses them instead of repainting every tile.
    const scale = stepwise ? 2 ** (Math.round(2 * Math.log2(view.scale)) / 2) : view.scale,
      k = scale * dpr,
      outputK = view.scale * dpr,
      ratio = view.scale / scale;
    // Small stepwise CPU tiles bound each indivisible raster operation; captures take larger tiles. Polygon paths are
    // clipped below. Raster cost does not bound GPU tiles: stepwise ones are larger, so a view needs fewer.
    const engine = getVectorEngine();
    const tilePx = stepwise ? (engine === 'gpu' ? 512 : 256) : 512,
      gutter = stepwise ? (engine === 'gpu' ? 16 : 8) : 32,
      tileSize = tilePx / k;
    const x0 = Math.floor(rect.minX / tileSize),
      y0 = Math.floor(rect.minY / tileSize);
    const x1 = Math.floor(rect.maxX / tileSize),
      y1 = Math.floor(rect.maxY / tileSize);
    const budget = rasterBudget(rect, scale);
    c.layerTilesFit = (c.activeLight && scale < 1) || layerTilesFitView(c, rect, k);
    const requests: { key: string; x: number; y: number }[] = [];
    const semanticKey = `${c.syncPalette()}|${deps.semantic?.key() ?? ''}|${deps.roadStyle?.().emphasis ?? 1}|${deps.urbanPlan?.() !== false}|${roadCanopyRevision()}|${whiteWaterRevision()}`;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) requests.push({ key: `${scale}|${dpr}|${tilePx}/${gutter}|${engine}|${c.activeLight}|${budget}|${semanticKey}|${x},${y}`, x, y });
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
              noteGpuTile(t1 - t0, now() - t1, gpu.lastStats().synced, side * side);
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
        // The finished CPU tile becomes an ImageBitmap here: its deferred raster runs inside this step (one tile), not
        // in the first drawImage of the frame that composes every tile, and later blits of a bitmap are cheaper than
        // re-blitting the software canvas.
        const bitmap = typeof (target as { transferToImageBitmap?: () => ImageBitmap }).transferToImageBitmap === 'function' ? (target as unknown as OffscreenCanvas).transferToImageBitmap() : undefined;
        resource = (bitmap ?? target) as unknown as CanvasImageSource;
        release = () => {
          if (bitmap) bitmap.close();
          else {
            target.width = 0;
            target.height = 0;
          }
        };
        noteCpuTile(now() - t0, side * side);
      }
      const margin = paintMargin(scale) + gutter / k;
      rasterCache.put(request.key, { value: resource, bytes, bounds: { minX: request.x * tileSize - margin, minY: request.y * tileSize - margin, maxX: (request.x + 1) * tileSize + margin, maxY: (request.y + 1) * tileSize + margin }, release });
      if (stepwise) {
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
        else if (stepwise) {
          missing++;
          continue;
        } else image = buildTile(request);
        tiles.push({ image, x: request.x, y: request.y });
      }
      if (stepwise && missing) {
        const jobKey = requests.map(r => r.key).join(';') + `|${rect.minX},${rect.minY},${rect.maxX},${rect.maxY}`;
        const light = c.activeLight,
          fit = c.layerTilesFit;
        tileFill.start(
          jobKey,
          function* () {
            // The first forest tile must not build eleven whole-map wash layers in
            // one step. Captures drain the same generator synchronously.
            if (!isUnderdarkBiome(c.world.options.biome) && !(light && c.pal.name === 'parchment' && scale < 1)) {
              for (const name of ['lu-forest', 'u-cover-forest']) yield* forestWashSteps(c, name);
            }
            const cx = view.cx / tileSize - 0.5,
              cy = view.cy / tileSize - 0.5;
            const queue = requests.filter(r => !rasterCache.get(r.key)).sort((a, b) => (a.x - cx) ** 2 + (a.y - cy) ** 2 - (b.x - cx) ** 2 - (b.y - cy) ** 2);
            // The last picture stands in meanwhile: the view sharpens at once when its tiles are ready (a long job shows
            // its progress once a second), instead of a repaint per tile that shows the tiles filling one by one.
            let shown = now();
            for (let i = 0; i < queue.length; i++) {
              const request = queue[i];
              c.stepwise = true;
              c.activeLight = light;
              c.activeDpr = dpr;
              c.layerTilesFit = fit;
              try {
                if (!rasterCache.get(request.key)) buildTile(request);
              } finally {
                c.stepwise = c.activeLight = false;
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
      } else suspendStepwise();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      if (stepwise && missing && lastPicture) {
        const old = lastPicture,
          factor = ((view.scale / old.view.scale) * dpr) / old.dpr;
        const x = canvas.width / 2 + (old.view.cx - view.cx) * outputK - (old.canvas.width * factor) / 2;
        const y = canvas.height / 2 + (old.view.cy - view.cy) * outputK - (old.canvas.height * factor) / 2;
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
      if (stepwise) {
        if (!lastPicture || lastPicture.canvas.width !== canvas.width || lastPicture.canvas.height !== canvas.height) {
          dropLastPicture();
          const target = makeCanvas(canvas.width, canvas.height);
          if (target) lastPicture = { canvas: target, view: { ...view }, dpr };
        }
        const kept = lastPicture?.canvas.getContext('2d');
        if (kept && lastPicture) {
          kept.clearRect(0, 0, canvas.width, canvas.height);
          kept.drawImage(canvas as unknown as CanvasImageSource, 0, 0);
          lastPicture.view = { ...view };
          lastPicture.dpr = dpr;
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
  /** The stepwise tiles of `box` on `target` (coarse first; a finer cached quadrant replaces it without doubling
   * translucent ink). False: none there. Never builds a tile. */
  function drawCachedMap(target: CanvasLike, box: Rect4): boolean {
    const ctx = target.getContext('2d');
    if (!ctx) return false;
    const semantic = `${c.syncPalette()}|${deps.semantic?.key() ?? ''}|${deps.roadStyle?.().emphasis ?? 1}|${deps.urbanPlan?.() !== false}|${roadCanopyRevision()}|${whiteWaterRevision()}`;
    const light = displayQualityFor(true) === 'light',
      density = target.width / (box.maxX - box.minX);
    const tiles = [...mapPyramid].filter(([, t]) => t.semantic === semantic && t.light === light && t.density <= density * 2 && t.x < box.maxX && t.y < box.maxY && t.x + t.span > box.minX && t.y + t.span > box.minY).sort((a, b) => a[1].density - b[1].density);
    let drawn = false;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
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
  /** A 3D drape tile: the physical land use of `box`. `stepwise`: a tile of the moving 3D view (quality policy, small sprite tiles). */
  function drawGround(target: CanvasLike, box: Rect4, options?: { stepwise: boolean }): boolean {
    const previousStepwise = c.stepwise,
      previousLight = c.activeLight;
    c.stepwise = !!options?.stepwise;
    c.activeLight = displayQualityFor(c.stepwise) === 'light';
    try {
      return paintGround(target, box);
    } finally {
      c.stepwise = previousStepwise;
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
            noteGpuTile(t1 - t0, now() - t1, gpu.lastStats().synced, target.width * target.height);
            return drawn(fs);
          }
        }
      } finally {
        releaseDrapeTemps(c);
      }
    }
    const t0 = now(),
      fs = drawVector(c, view, target, 'ground');
    noteCpuTile(now() - t0, target.width * target.height);
    return drawn(fs);
  }
  /** Bytes held by the tiles and the last picture. */
  const bytes = (): number => rasterCache.bytes + (lastPicture ? lastPicture.canvas.width * lastPicture.canvas.height * 4 : 0);
  return { rasterCache, mapPyramid, suspendStepwise, dropLastPicture, draw, drawCachedMap, drawGround, bytes };
}
