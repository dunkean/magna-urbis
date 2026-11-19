/**
 * drawVector: the whole cartography of a view as Canvas 2D calls, the one description both vector engines draw (the
 * native context, or a RecordingContext replayed on WebGL2). Callers: the exact raster tiles and captures
 * (exactTiles.ts, mode 'map' per tile then 'overlays'), the 3D drape ('ground'), the bands of the live overlay layer
 * (liveHost.ts, 'map' with the crisp mark), the furniture of a live frame ('overlays'), hosts without raster ('all').
 *
 * This module builds the frame (frame.ts) and lists the layers in draw order; each family paints in its own module.
 * The order is the picture: a layer moved across another changes the pixels where they overlap.
 * Reads: everything the layers read. Writes: recordingNow, layerTilesFit (unless a tile of a larger request),
 * stats (the frame's FrameStats).
 */
import { selectLod, lineWidth, BAND_MIN_EDGE, type Lod } from '../lod';
import { viewRect, type Rect4, type View } from '../view';
import { RecordingContext } from '../gpu/recorder';
import { CRISP_MARK } from '../gpu/contract';
import type { LineLayer, PolyLayer } from '../scene';
import { growRect, linePath, polyPath } from './geometry';
import type { CartographyContext, DrawMode } from './context';
import type { CanvasLike, FrameStats } from './contract';
import type { FrameBase, VectorFrame } from './frame';
import { layerTilesFitView } from './woods';
import { landPainters, paintContours, paintLandMask, paintLandUseSteps } from './landuse';
import { paintFieldNetwork } from './fields';
import { paintTextureLayerSteps } from './symbols';
import { paintWater } from './water';
import { paintFarmsteads } from './farmsteads';
import { paintRegionalRoads, roadPainters } from './roads';
import { paintUrban } from './urban';
import { paintStructures } from './structures';
import { paintFurniture, paintGraticule } from './furniture';

export function drawVector(c: CartographyContext, view: View, target: CanvasLike = c.canvas, mode: DrawMode = 'all', fullRect?: Rect4): FrameStats {
  const steps = drawVectorSteps(c, view, target, mode, fullRect);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/** Same calls and draw order as a synchronous vector draw, with boundaries for the drape's idle slices. */
export function* drawVectorSteps(c: CartographyContext, view: View, target: CanvasLike = c.canvas, mode: DrawMode = 'all', fullRect?: Rect4): Generator<void, FrameStats> {
  const { deps, pal, S, now, cache, furrowCache, brushes } = c;
  const t0 = now();
  const ctx = target.getContext('2d');
  if (!ctx) return c.stats;
  const built0 = c.built;
  const dpr = c.dpr();
  const cssW = target.width / dpr,
    cssH = target.height / dpr;
  const sc = view.scale;
  const lod: Lod = selectLod(sc);
  const band = lod.band;
  const rect: Rect4 = viewRect(view, cssW, cssH, fullRect ? c.paintMargin(view.scale) : 0);
  const budgetRect = fullRect ?? rect;
  if (!fullRect && mode !== 'overlays') c.layerTilesFit = layerTilesFitView(c, rect, sc * dpr);
  const fs: FrameStats = { band, scale: sc, ms: 0, tilesDrawn: 0, bigDrawn: 0, pathsBuilt: 0, pathCache: 0, buildingsCandidate: 0, buildingsDrawn: false, textureTiles: 0 };

  if (mode !== 'overlays') {
    // background (device pixels)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    if (deps.transparentBackground || mode === 'ground') ctx.clearRect(0, 0, target.width, target.height);
    else {
      ctx.fillStyle = pal.paper;
      ctx.fillRect(0, 0, target.width, target.height);
    }
    // world -> device
    ctx.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * (cssW / 2 - view.cx * sc), dpr * (cssH / 2 - view.cy * sc));
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash([]);
    // everything below is clipped to the map rectangle (sea polygons etc. run past it)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, S, S);
    ctx.clip();

    const base = frameBase(c, ctx, view, mode, dpr, cssW, cssH, lod, rect, budgetRect, fs);
    const roads = roadPainters(c, base),
      land = landPainters(c, base);
    // 1. terrain
    const tex = c.getTerrain();
    if (tex) {
      ctx.imageSmoothingEnabled = true;
      (ctx as { imageSmoothingQuality?: string }).imageSmoothingQuality = 'high';
      ctx.drawImage(tex, 0, 0, S, S);
    }
    const drawVisibleTerrain = (): void => {
      if (!tex) return;
      const x = Math.max(0, rect.minX),
        y = Math.max(0, rect.minY);
      const w = Math.min(S, rect.maxX) - x,
        h = Math.min(S, rect.maxY) - y;
      if (w <= 0 || h <= 0) return;
      const tw = Number((tex as { width?: unknown }).width),
        th = Number((tex as { height?: unknown }).height);
      if (Number.isFinite(tw) && Number.isFinite(th) && tw > 0 && th > 0) {
        ctx.drawImage(tex, (x * tw) / S, (y * th) / S, (w * tw) / S, (h * th) / S, x, y, w, h);
      } else ctx.drawImage(tex, 0, 0, S, S);
    };
    const cavernFloor = c.world.terrain.caverns && c.polyL('cavern-floor');
    if (cavernFloor) {
      const floorClip = c.exactCavernPath('floor');
      ctx.save();
      if (floorClip) ctx.clip(floorClip, 'nonzero');
    }
    // hierarchy: cased major roads; thinner cased minor roads; tracks as thin dashed earth lines from mid zoom only
    const f: VectorFrame = {
      ...base,
      ...roads,
      ...land,
      tex,
      drawVisibleTerrain,
      cavernFloor,
      land: c.landClip(),
      roads: c.linesOf(l => l.role === 'road' && l.kind !== 'track' && (lod.minorRoads || l.kind === 'major')),
      tracks: c.linesOf(l => l.role === 'road' && l.kind === 'track' && lod.band >= 1),
    };

    // 2. land use (tints multiply over the hillshade so relief reads through them); graticule and contours under it
    paintGraticule(c, f);
    yield;
    paintContours(c, f);
    yield;
    yield* paintLandUseSteps(c, f);
    yield;
    paintLandMask(c, f);
    paintFieldNetwork(c, f);
    yield;
    // textures (procedural marks, visible tiles only, cached per tile)
    // Sprites need only their own overhang and the bake gutter, not the widest road's screen-space paint margin.
    yield* paintTextureLayerSteps(c, recordingTextureFrame(c, f, fullRect));
    yield;
    if (mode === 'ground') {
      if (cavernFloor) ctx.restore();
      ctx.restore();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      return fs;
    }

    // Live compositor layer: everything above is the prefix of the list, baked once per region: the physical land
    // use as `ground` mode draws it (tints, washes and their clips, furrows, strips, then the field network and the
    // wood and land symbols), with the graticule and the contour lines painted under the tints. Its cost per frame
    // followed the content most (whole-map washes, thousands of hedges and trees) and nothing below can go under it.
    // From here on the layers are replayed at every frame, in the same order over the baked prefix.
    if (c.markCrisp && ctx instanceof RecordingContext) ctx.mark(CRISP_MARK);
    // Semantic land use: above every physical land-use layer, below water, roads and labels.
    c.timedRec('semantic', () => deps.semantic?.draw(ctx, rect, 1 / sc, c.activeLight ? 'light' : 'full'));
    yield;
    // 3. rivers + water
    paintWater(c, f);
    yield;
    // 4. farmsteads, then regional roads
    paintFarmsteads(c, f);
    yield;
    paintRegionalRoads(c, f);
    yield;
    // 5. urban
    paintUrban(c, f);
    yield;
    // 6. walls, bridges, site marker, caverns
    paintStructures(c, f);

    ctx.restore();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  // 7. map frame, labels, cartouche, legend (screen space)
  if (mode !== 'map') paintFurniture(c, ctx, view, cssW, cssH, dpr, sc);

  fs.pathsBuilt = c.built - built0;
  fs.pathCache = cache.size;
  fs.furrowCache = furrowCache.size;
  fs.furrowsDrawn ??= 0;
  if (brushes) fs.brushBytes = brushes.cachedBytes;
  fs.ms = now() - t0;
  c.stats = fs;
  return fs;
}

function recordingTextureFrame(c: CartographyContext, f: VectorFrame, band: Rect4 | undefined): VectorFrame {
  return c.recordingClip && band ? { ...f, rect: growRect(band, 2 / (f.sc * f.dpr)) } : f;
}

/** The view-dependent part of a frame: culling rectangles, widths, and the paths of a layer for this view. */
function frameBase(c: CartographyContext, ctx: CanvasRenderingContext2D, view: View, mode: DrawMode, dpr: number, cssW: number, cssH: number, lod: Lod, rect: Rect4, budgetRect: Rect4, fs: FrameStats): FrameBase {
  const { cached, polyL } = c;
  const sc = view.scale,
    band = lod.band,
    minEdge = BAND_MIN_EDGE[band];
  const px = (n: number): number => n / sc;
  const lw = (w: number, minPx: number): number => lineWidth(w, minPx, sc);
  // Include the stamp/shadow reach and put artificial clipping edges safely
  // outside the canvas, so stroked polygons retain their original borders.
  const pathRect = growRect(rect, Math.max(16, c.paintMargin(sc)));
  const recording = (c.recordingNow = ctx instanceof RecordingContext);
  // A drape recording clips before constructing paths: a single forest may span the entire 40 km map.
  const clipTo = recording ? c.recordingClip : pathRect;
  const PP = recording ? c.recordedP : c.P;
  const framePaths = new Map<PolyLayer, Path2D[]>();
  const polyPaths = (l: PolyLayer): Path2D[] => {
    const known = framePaths.get(l);
    if (known) return known;
    const out: Path2D[] = [];
    const wood = l.name === 'lu-forest' || l.name.includes('-edge-') || l.name.includes('-fringe-');
    const pathClip = clipTo && recording && !wood ? growRect(clipTo, c.paintMargin(sc)) : clipTo;
    const rectKey = pathClip ? `${recording ? 'gpu|' : ''}${pathClip.minX},${pathClip.minY},${pathClip.maxX},${pathClip.maxY}` : 'gpu';
    for (const t of l.index.tilesInRect(pathRect)) {
      const p = cached(`${l.name}|${band}|${rectKey}|t${t}|${l.tileKeys?.[t] ?? ''}`, () => polyPath(PP, l, l.index.itemsOf(t), minEdge, pathClip, recording));
      if (p) {
        out.push(p);
        fs.tilesDrawn++;
      }
    }
    const big = l.index.bigInRect(pathRect);
    // Vectorized wash regions are disjoint. Batch them after clipping rather
    // than enqueueing thousands of identical multiply operations per stamp.
    if (l.name.includes('-edge-') || l.name.includes('-fringe-')) {
      const stamp = l.bigKeys?.join(';') ?? '';
      const p = cached(`${l.name}|${band}|${rectKey}|big|${recording ? big.join(',') + '|' : ''}${stamp}`, () => polyPath(PP, l, big, minEdge, pathClip, recording));
      if (p) {
        out.push(p);
        fs.bigDrawn += big.length;
      }
    } else
      for (const i of big) {
        const p = cached(`${l.name}|${band}|${rectKey}|b${i}|${l.bigKeys?.[Array.prototype.indexOf.call(l.index.big, i)] ?? ''}`, () => polyPath(PP, l, [i], minEdge, pathClip, recording));
        if (p) {
          out.push(p);
          fs.bigDrawn++;
        }
      }
    framePaths.set(l, out);
    return out;
  };
  const linePaths = (l: LineLayer): Path2D[] => {
    const out: Path2D[] = [];
    for (const t of l.index.tilesInRect(rect)) {
      const p = cached(`${l.name}|${band}|t${t}|${l.tileKeys?.[t] ?? ''}`, () => linePath(c.P, l, l.index.itemsOf(t), minEdge));
      if (p) {
        out.push(p);
        fs.tilesDrawn++;
      }
    }
    for (const i of l.index.bigInRect(rect)) {
      const p = cached(`${l.name}|${band}|b${i}|${l.bigKeys?.[Array.prototype.indexOf.call(l.index.big, i)] ?? ''}`, () => linePath(c.P, l, [i], minEdge));
      if (p) {
        out.push(p);
        fs.bigDrawn++;
      }
    }
    return out;
  };
  const fillPolys = (name: string, color: string, alpha = 1, rule: CanvasFillRule = 'evenodd'): PolyLayer | undefined => {
    const l = polyL(name);
    if (!l) return undefined;
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    for (const p of polyPaths(l)) ctx.fill(p, rule);
    ctx.globalAlpha = 1;
    return l;
  };
  const strokePolys = (name: string, color: string, width: number, alpha = 1, dash: number[] = []): void => {
    const l = polyL(name);
    if (!l) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    ctx.setLineDash(dash);
    for (const p of polyPaths(l)) ctx.stroke(p);
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  };
  const strokeLines = (ls: LineLayer[], color: string, widthOf: (l: LineLayer) => number, alpha = 1, dash: number[] = [], cap: CanvasLineCap = 'round'): void => {
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.setLineDash(dash);
    ctx.lineCap = cap;
    for (const l of ls) {
      ctx.lineWidth = widthOf(l);
      for (const p of linePaths(l)) ctx.stroke(p);
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.lineCap = 'round';
  };
  return { ctx, view, mode, dpr, cssW, cssH, sc, lod, band, rect, budgetRect, pathRect, fs, minEdge, px, lw, polyPaths, linePaths, fillPolys, strokePolys, strokeLines };
}
