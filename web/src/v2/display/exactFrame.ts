/**
 * Exact frames: the whole map picture of a view flattened into one 2D canvas by the exact renderers, bottom to top:
 * the paper and the ground (captured from the terrain renderer, or the CPU raster with its illustrated washes and
 * stamps), the vector water, the cartography overlay (or the whole-map overlay rasters of an export), the town, the
 * names.
 *
 * A capture, an export, a sheet and the render board get such a frame complete, in one synchronous paint at full
 * quality: it is what must be exact by definition. A caller that shows the frame on screen asks for it stepwise
 * (`ExactPaint`, contract.ts): the renderers then paint what they have and ask for the frame again as they progress.
 */
import type { RenderReadiness } from '../../render/renderReadiness';
import { type View, viewRect } from '../../render/view';
import { terrainRendererCanvas } from '../../ui/terrainRenderer';
import { isFantasyStyle } from '../../../../rust/bridge/fantasyTerrain';
import { drawFantasyRaster, KEEP_NONE } from '../../ui/fantasyRaster';
import { reportDrawnLabels } from '../drawnLabels';
import type { DisplayParts, ExactPaint } from './contract';
import type { MapState } from './mapState';

export interface ExportFrame {
  view: View;
  width: number;
  height: number;
}

export class ExactFrame {
  constructor(
    private readonly map: MapState,
    private readonly parts: DisplayParts,
  ) {}

  /** Paints the frame of `view` into `canvas`, sized to `w` x `h` CSS pixels at `dpr`. */
  paint(canvas: HTMLCanvasElement, view: View, w: number, h: number, dpr: number, mode: ExactPaint): HTMLCanvasElement {
    const map = this.map,
      { ground, water, cartography, town } = this.parts,
      r = map.resolved!,
      size = map.world!.mapSize,
      stepwise = mode.stepwise,
      groundBeneath = mode.groundBeneath && ground.gpuActive;
    map.dpr = dpr;
    const pixelW = Math.round(w * dpr),
      pixelH = Math.round(h * dpr);
    if (canvas.width !== pixelW) canvas.width = pixelW;
    if (canvas.height !== pixelH) canvas.height = pixelH;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (map.exportLayers.background !== false && !groundBeneath) {
      ctx.fillStyle = map.paper;
      ctx.fillRect(0, 0, w, h);
    }
    /** How the town puts the ground back over itself along the rivers, when the ground is in this canvas. */
    let groundRedraw: ((c: CanvasRenderingContext2D) => void) | undefined;
    if (ground.gpuActive && !groundBeneath) {
      ground.gpu!.setView(view, w, h);
      ground.gpu!.redrawForCapture();
      const captured = terrainRendererCanvas(ground.gpu!, ground.gpuCanvas);
      ctx.drawImage(captured, 0, 0, w, h);
      groundRedraw = c => {
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.drawImage(captured, 0, 0, w, h);
      };
    }
    ctx.save();
    ctx.translate(w / 2 - view.cx * view.scale, h / 2 - view.cy * view.scale);
    ctx.scale(view.scale, view.scale);
    if (ground.base) ctx.drawImage(ground.base, 0, 0, size, size);
    // Only while the active ground is Illustrated: a style switch must never keep the previous painting.
    // Illustrated: water (and the frame) pass behind the brushes; overhanging crowns hide part of a river, corridors keep it readable.
    const fantasy = ground.fantasy && isFantasyStyle(r.ground.style) ? ground.fantasy : undefined;
    // Wash under the water, stamps over it.
    if (fantasy) drawFantasyRaster(ctx, fantasy, viewRect(view, w, h), view.scale * dpr, KEEP_NONE);
    const vectors = water.vectorRaster(view, w, h, dpr);
    if (vectors) ctx.drawImage(vectors.image, vectors.region.x, vectors.region.y, vectors.region.width, vectors.region.height);
    // The export overlay is one whole-map raster: only where it is at least as fine as the frame.
    const exportOverlay = cartography.exportOverlay && view.scale * dpr * size <= cartography.exportOverlay.width * 1.01 ? cartography.exportOverlay : undefined;
    // Export order: physical land use, rural semantics, then roads/labels/furniture (as on screen).
    if (exportOverlay) {
      if (cartography.exportGround) ctx.drawImage(cartography.exportGround, 0, 0, size, size);
      // The export overlay carries the labels too: there the stamps stay under it.
      if (fantasy) drawFantasyRaster(ctx, fantasy, viewRect(view, w, h), view.scale * dpr, undefined, false, true, stepwise, stepwise);
      cartography.paintRural(ctx, viewRect(view, w, h), 1 / view.scale);
      ctx.drawImage(exportOverlay, 0, 0, size, size);
    }
    ctx.restore();
    if (!exportOverlay) {
      // Exports and fallback frames own their farm and placeholder roofs even if the on-screen compositor uses meshes.
      const volumes = map.volumeBuildings;
      map.volumeBuildings = false;
      let overlay: HTMLCanvasElement | undefined;
      try {
        overlay = cartography.paintOverlay(view, canvas.width, canvas.height, stepwise);
      } finally {
        map.volumeBuildings = volumes;
      }
      if (overlay) ctx.drawImage(overlay, 0, 0, w, h);
    }
    // Illustrated: stamps above roads, rivers and field edges (anchors stay clear of them, crowns may overhang); towns and labels stay on top.
    if (fantasy && !exportOverlay) {
      ctx.save();
      ctx.translate(w / 2 - view.cx * view.scale, h / 2 - view.cy * view.scale);
      ctx.scale(view.scale, view.scale);
      drawFantasyRaster(ctx, fantasy, viewRect(view, w, h), view.scale * dpr, undefined, false, true, stepwise, stepwise);
      ctx.restore();
    }
    if (map.exportLayers.city !== false || map.exportLayers.streets !== false) map.stats.city = town.draw(ctx, view, w, h, dpr, { stepwise: stepwise ? { key: map.townContent, moving: false } : undefined, groundRedraw });
    const renderer = cartography.renderer;
    if (renderer) {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderer.drawText(ctx, view, w, h);
      ctx.restore();
      reportDrawnLabels(renderer.lastPlaced().map(p => p.label.id));
    }
    return canvas;
  }

  /** Paint an export frame at its own density, defaulting to the whole map. */
  async capture(size: number, canvas: HTMLCanvasElement, capture: RenderReadiness, frame?: ExportFrame): Promise<HTMLCanvasElement> {
    const { ground, water, contours, town } = this.parts,
      mapSize = this.map.world!.mapSize;
    await ground.exactReady();
    if (ground.gpuActive) await ground.gpu!.variantReady(); // the paint is synchronous: it would create a missing pipeline in place
    capture.mark('programs-ready');
    const { view, width, height } = frame ?? { view: { cx: mapSize / 2, cy: mapSize / 2, scale: size / mapSize }, width: size, height: size };
    await contours.contoursAt(view.scale, viewRect(view, width, height));
    await water.vectorsReadyFor(view, width, height, 1);
    await town.prepare();
    const image = this.paint(canvas, view, width, height, 1, { stepwise: false, groundBeneath: false });
    capture.mark('capture-complete');
    return image;
  }
}
