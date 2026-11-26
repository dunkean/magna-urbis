/**
 * Interactive Canvas 2D cartography renderer with level of detail (SVG stays for export): the entry the pages call.
 *
 * - The World is flattened once into a `Scene` (tile-indexed layers, see scene.ts).
 * - Per (layer, LOD band, tile) a Path2D is built lazily and cached; a frame only touches tiles intersecting the
 *   viewport, and only layers enabled by `selectLod`.
 * - The context transform is world->screen, so all widths are in meters; screen-space minimum widths are applied with
 *   `lineWidth(w, minPx, scale)`.
 * - Palettes come from styles.ts (read-only).
 * Everything DOM-ish is injectable (`CanvasRendererDeps`) so a mock 2D context can drive it in Node.
 *
 * The work lives in render/cartography/: the shared state (context.ts), drawVector and its layer families
 * (vector.ts and the modules it lists), the exact raster tiles (exactTiles.ts), the names (names.ts), the furniture
 * and the miniature (furniture.ts), the host of the live overlay layer (liveHost.ts). This function assembles them and
 * owns the scene updates.
 */
import { cavernDisplayWorld } from './cavernDisplay';
import { renderView } from '../gen/settlements/merge';
import { biomePalette } from './biomes';
import { cartoucheModel } from './legend';
import type { World } from '../gen/types';
import type { Palette, MapStyle } from './styles';
import type { Scene } from './scene';
import type { Label } from './labels';
import { CartographyContext } from './cartography/context';
import { createExactTiles } from './cartography/exactTiles';
import { createNames } from './cartography/names';
import { createLiveHost } from './cartography/liveHost';
import { drawFurniture, drawMinimap } from './cartography/furniture';
import { LAYER_TILE_GUTTER, LAYER_TILE_REACH } from './cartography/woods';
import type { CanvasLike, CanvasRenderer, CanvasRendererDeps, Overlays } from './cartography/contract';

export type { CanvasLike, CanvasRenderer, CanvasRendererDeps, FrameStats, Overlays } from './cartography/contract';
export { clipRingRect } from './cartography/geometry';

export function createCanvasRenderer(canvas: CanvasLike, world0: World, style: MapStyle | Palette, deps: CanvasRendererDeps = {}): CanvasRenderer {
  const c = new CartographyContext(canvas, world0, style, deps);
  const tiles = createExactTiles(c),
    names = createNames(c),
    live = createLiveHost(c);
  c.drawNames = (ctx, view, cssW, cssH) => names.drawText(ctx, view, cssW, cssH);

  function update(nextSource: World, nextScene: Scene, nextStyle: MapStyle | Palette = style, sameContent = false): boolean {
    const { scene, sourceWorld, world } = c;
    if ((c.brushes || c.canopy) && nextSource.seed !== sourceWorld.seed) return false;
    if (nextSource.mapSize !== c.S || (!c.deps.palette && biomePalette(nextStyle, nextSource.options.biome) !== c.basePalette)) return false;
    // Prepare potentially fallible metadata before committing the replacement.
    const nextWorld = cavernDisplayWorld(nextScene.renderedWorld ? { ...nextScene.renderedWorld, options: nextSource.options, names: nextSource.names } : renderView(cavernDisplayWorld(nextSource)));
    const nextLabels = names.namesOf(nextWorld);
    const terrainChanged = nextSource.terrain !== sourceWorld.terrain;
    // Dirty-region update (a town build or edit on the same terrain): tiles outside the changed areas stay cached,
    // and the last frame stands in for the repainted tiles until they are ready.
    const local = !!nextScene.dirty && nextScene !== scene && !terrainChanged && world.options.landuse === nextSource.options.landuse && world.options.contours === nextSource.options.contours;
    tiles.suspendStepwise();
    if (!local) tiles.dropLastPicture();
    if (!local) tiles.mapPyramid.clear();
    if (nextSource.seed !== sourceWorld.seed) c.cavernRockImg = undefined;
    if (terrainChanged || nextScene.poly.get('sea') !== scene.poly.get('sea') || nextScene.poly.get('lakes') !== scene.poly.get('lakes')) c.landPath = undefined;
    if (terrainChanged) {
      c.terrainImg = c.waterImg = undefined;
      c.cache.clear();
      tiles.rasterCache.clear();
    }
    if (c.deps.terrain && nextSource.landuse?.areas !== sourceWorld.landuse?.areas) c.terrainImg = undefined;
    if (nextScene.density?.cov !== scene.density?.cov) c.densityImg = undefined;
    if (nextScene.furrows !== scene.furrows) c.furrowCache.clear();
    // Forest sprite atlas rows encode the biome-dependent conifer choice.
    if (nextScene !== scene || nextWorld.options.biome !== world.options.biome) c.treeSprites.clear();
    if (nextScene !== scene) {
      c.treeMarks.clear();
      if (!sameContent) {
        c.penMarks.clear();
        c.penBlocks.invalidate(local ? nextScene.dirty : undefined, LAYER_TILE_REACH);
      }
      c.forestWashes.clear();
      c.strayMarks.clear();
    }
    // Woods depend on the scene, the forest wash and the roads/farms that clear them (forestRoom below): rebuild them all,
    // or, on a local update, those near the changed areas (the dirty rects already include the reach of the derived products).
    if (local) {
      c.carryBrushIds(nextScene);
      c.layerTiles.invalidate(nextScene.dirty, LAYER_TILE_REACH + LAYER_TILE_GUTTER);
    } else if (nextScene !== scene || terrainChanged || nextSource.roads !== sourceWorld.roads || nextSource.landuse !== sourceWorld.landuse) c.layerTiles.clear();
    // Path caches are keyed by index tile: only the incremental builder's tile keys tell a rebuilt tile from a retained one.
    if (nextScene !== scene && (!nextScene.dirty || ![...nextScene.poly.values()].some(l => l.tileKeys))) c.cache.clear();
    if (world.options.landuse !== nextSource.options.landuse || world.options.contours !== nextSource.options.contours) tiles.rasterCache.clear();
    // Entries can predate several scene updates; expand by the new absolute paint radius, not a last-update delta.
    else if (nextScene !== scene) tiles.rasterCache.invalidate(nextScene.dirty, c.paintMargin(1, nextScene));
    if (local) for (const key of [...tiles.mapPyramid.keys()]) if (!tiles.rasterCache.has(key)) tiles.mapPyramid.delete(key);
    c.scene = nextScene;
    c.sourceWorld = nextSource;
    c.world = nextWorld;
    names.setNames(nextLabels);
    c.overlays.labels = nextWorld.options.labels !== false;
    c.overlays.legend = !!nextWorld.options.legend;
    c.dropPanels();
    c.litCache = undefined;
    c.forestRoom = undefined;
    // The region a live layer shows keeps showing until its replacement is recorded (no blank frame after a town build).
    live.invalidateLayers(local ? nextScene.dirty : undefined, sameContent);
    return true;
  }

  let measuredScene: Scene | undefined,
    geometryBytes = 0;
  function retainedBytes(): number {
    if (c.scene !== measuredScene) {
      measuredScene = c.scene;
      geometryBytes = c.scene.textures.reduce((n, layer) => n + layer.areas.reduce((s, a) => s + a.poly.length * 16, 0), 0);
    }
    return live.retainedBytes() + tiles.bytes() + c.layerTiles.bytes + c.penBlocks.bytes + (c.brushes?.cachedBytes ?? 0) + (c.canopy ? 48 * 1024 * 1024 : 0) + c.cache.size * 1024 + c.furrowCache.size * 2048 + geometryBytes;
  }
  return {
    get scene() {
      return c.scene;
    },
    get palette() {
      return c.pal;
    },
    draw: tiles.draw,
    drawText: names.drawText,
    placeText: names.placeText,
    drawGround: tiles.drawGround,
    drawCachedMap: tiles.drawCachedMap,
    update,
    setLook(look) {
      const previous = c.pal,
        vegetation = deps.vegetation,
        brushes = deps.brushes,
        colors = deps.colors;
      Object.assign(deps, look);
      const symbolsChanged = vegetation !== deps.vegetation || brushes !== deps.brushes;
      c.syncPalette(symbolsChanged || JSON.stringify(colors) !== JSON.stringify(deps.colors));
      if (symbolsChanged || (previous.name === 'parchment') !== (c.pal.name === 'parchment')) c.treeMarks.clear();
      if (previous !== c.pal) names.setText(names.text());
      c.terrainImg = undefined;
      tiles.suspendStepwise();
      tiles.dropLastPicture();
    },
    suspendStepwise: tiles.suspendStepwise,
    createLiveLayer: live.createLiveLayer,
    drawFurniture: (target, view, cssW, cssH) => drawFurniture(c, target, view, cssW, cssH),
    setLabels(l: Label[]) {
      c.labels = l;
    },
    setOverlays(o: Partial<Overlays>) {
      if (o.text && JSON.stringify(o.text) !== JSON.stringify(names.text())) names.setText(o.text);
      Object.assign(c.overlays, o);
    },
    lastPlaced: names.lastPlaced,
    liveText: names.liveText,
    drawMinimap: (target, view, viewW, viewH, withRect) => drawMinimap(c, target, view, viewW, viewH, withRect),
    lastStats: () => c.stats,
    retainedBytes,
    getMapInfo: () => ({ cartouche: (c.infoPanel ??= cartoucheModel(c.world, c.pal, 1, false)), legend: c.legendNow(), fontFamily: c.family }),
    dispose() {
      c.disposed = true;
      tiles.suspendStepwise();
      tiles.dropLastPicture();
      c.canopy?.dispose();
      c.brushes?.dispose();
      c.treeMarks.clear();
      c.treeSprites.clear();
      c.strayMarks.clear();
      c.penBlocks.clear();
      c.layerTiles.clear();
      c.forestWashes.clear();
      c.patterns.clear();
      c.cache.clear();
      c.furrowCache.clear();
      tiles.rasterCache.clear();
      tiles.mapPyramid.clear();
      c.terrainImg = c.waterImg = c.densityImg = c.cavernRockImg = undefined;
    },
  };
}
