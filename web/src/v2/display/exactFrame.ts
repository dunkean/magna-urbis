/**
 * Exact frames: the whole map picture of a view flattened into one 2D canvas by the exact renderers (the ground
 * captured from the terrain renderer or the CPU raster, the vector water, the cartography, the town, the names).
 *
 * This is what a capture, an export, a sheet and the render board get, and what must be exact by definition. The
 * fallback view (fallbackView.ts) paints its picture at rest with the same code (`live`: the GPU ground then stays in
 * its own canvas under the frame, and the renderers paint in steps). Also here: the background of the 3D view, which
 * is the same ground as one whole-map image.
 */
import { RenderReadiness } from '../../render/renderReadiness';
import { noteLivePart } from '../../render/vectorEngine';
import { type View, viewRect } from '../../render/view';
import { terrainRendererCanvas } from '../../ui/terrainRenderer';
import { isFantasyStyle } from '../../../../rust/bridge/fantasyTerrain';
import { drawFantasyRaster, fantasyRasterImages, KEEP_NONE } from '../../ui/fantasyRaster';
import { viewRasterFits, viewRasterRegion } from '../../render/viewRaster';
import { reportDrawnLabels } from '../drawnLabels';
import type { MapState } from './mapState';
import type { DisplayParts } from './parts';
import { svgOf, wholeMap } from './mapSvg';

export class ExactFrame {
  constructor(
    private readonly map: MapState,
    private readonly parts: DisplayParts,
    /** The view counts as moving: the names follow the map instead of being placed again. */
    private readonly moving: () => boolean,
  ) {}

  /** Paints the frame of `view` into `canvas`. `live`: a frame of the fallback view (a GPU ground stays in its own
   * canvas under this one, the renderers paint in steps and at the display quality). */
  paint(canvas: HTMLCanvasElement, view: View, w: number, h: number, dpr: number, live: boolean): HTMLCanvasElement {
    const r = this.map.resolved!,
      size = this.map.world!.mapSize;
    this.map.dpr = dpr;
    const pixelW = Math.round(w * dpr),
      pixelH = Math.round(h * dpr);
    if (canvas.width !== pixelW) canvas.width = pixelW;
    if (canvas.height !== pixelH) canvas.height = pixelH;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.map.exportLayers.background !== false && !(live && this.parts.ground.gpuActive)) {
      ctx.fillStyle = this.map.paper;
      ctx.fillRect(0, 0, w, h);
    }
    this.parts.town.groundRedraw = undefined;
    if (this.parts.ground.gpuActive && !live) {
      this.parts.ground.gpu!.setView(view, w, h);
      this.parts.ground.gpu!.redrawForCapture();
      const ground = terrainRendererCanvas(this.parts.ground.gpu!, this.parts.ground.gpuCanvas);
      ctx.drawImage(ground, 0, 0, w, h);
      this.parts.town.groundRedraw = c => {
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.drawImage(ground, 0, 0, w, h);
      };
    }
    ctx.save();
    ctx.translate(w / 2 - view.cx * view.scale, h / 2 - view.cy * view.scale);
    ctx.scale(view.scale, view.scale);
    if (this.parts.ground.base) ctx.drawImage(this.parts.ground.base, 0, 0, size, size);
    // Only while the active ground is Illustrated: a style switch must never keep the previous painting.
    // Illustrated: water (and the frame) pass behind the brushes; overhanging crowns hide part of a river, corridors keep it readable.
    const fantasy = this.parts.ground.fantasy && isFantasyStyle(r.ground.style) ? this.parts.ground.fantasy : undefined;
    // Wash under the water, stamps over it.
    if (fantasy) drawFantasyRaster(ctx, fantasy, viewRect(view, w, h), view.scale * dpr, KEEP_NONE);
    let t0 = performance.now();
    const vectors = this.parts.water.vectorRaster(view, w, h, dpr);
    if (live) t0 = noteLivePart('water', t0);
    if (vectors) ctx.drawImage(vectors.image, vectors.region.x, vectors.region.y, vectors.region.width, vectors.region.height);
    // Fallback view: the ground (and its rivers) was redrawn just before, the vector water above.
    if (live && this.parts.water.waterShownDue) this.parts.water.noteWaterShown();
    // The export overlay is one whole-map raster: only where it is at least as fine as the frame.
    const overlay = this.parts.cartography.exportOverlay && view.scale * dpr * size <= this.parts.cartography.exportOverlay.width * 1.01 ? this.parts.cartography.exportOverlay : undefined;
    // Export order: physical land use, rural semantics, then roads/labels/furniture (as on screen).
    if (overlay) {
      if (this.parts.cartography.exportGround) ctx.drawImage(this.parts.cartography.exportGround, 0, 0, size, size);
      // The export overlay carries the labels too: there the stamps stay under it.
      if (fantasy) drawFantasyRaster(ctx, fantasy, viewRect(view, w, h), view.scale * dpr, undefined, false, true, live, live);
      this.parts.cartography.paintRural(ctx, viewRect(view, w, h), 1 / view.scale);
      ctx.drawImage(overlay, 0, 0, size, size);
    }
    ctx.restore();
    let t = performance.now();
    if (!overlay && this.parts.cartography.renderer) {
      if (this.parts.cartography.overlay.width !== canvas.width) this.parts.cartography.overlay.width = canvas.width;
      if (this.parts.cartography.overlay.height !== canvas.height) this.parts.cartography.overlay.height = canvas.height;
      this.parts.cartography.renderer.draw(view, { live });
      ctx.drawImage(this.parts.cartography.overlay, 0, 0, w, h);
    }
    if (live) t = noteLivePart('cartography', t);
    // Illustrated: stamps above roads, rivers and field edges (anchors stay clear of them, crowns may overhang); towns and labels stay on top.
    if (fantasy && !overlay) {
      ctx.save();
      ctx.translate(w / 2 - view.cx * view.scale, h / 2 - view.cy * view.scale);
      ctx.scale(view.scale, view.scale);
      drawFantasyRaster(ctx, fantasy, viewRect(view, w, h), view.scale * dpr, undefined, false, true, live, live);
      ctx.restore();
    }
    if (live) t = noteLivePart('fantasy', t);
    if (this.map.exportLayers.city !== false || this.map.exportLayers.streets !== false)
      this.map.stats.city = this.parts.town.city?.draw(ctx, view, w, h, dpr, r, { ...this.map.exportLayers, labels: false }, this.parts.town.hooks, live ? { key: this.map.townContent, moving: false } : undefined);
    if (live) t = noteLivePart('city', t);
    if (this.parts.cartography.renderer) {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.parts.cartography.renderer.drawText(ctx, view, w, h, this.moving());
      ctx.restore();
      reportDrawnLabels(this.parts.cartography.renderer.lastPlaced().map(p => p.label.id));
    }
    if (live) noteLivePart('text', t);
    return canvas;
  }
  /** The ground of the 3D view as one whole-map image URL. */
  backgroundUrl(): string | undefined {
    if (!this.parts.ground.backgroundHref) {
      // The open 3D view also polls while a new world prepares its GPU look.
      // Keep the background pending until the bitmap is ready; never cache a preview.
      if (this.parts.ground.gpuActive) this.parts.ground.backgroundHref = this.parts.ground.groundBackground()?.toDataURL('image/png');
      else if (this.parts.ground.terrainSvg || this.parts.water.vectors) {
        // Illustrated: the canvas-painted ground enters the 3D background draped, as in 2D: wash under the water, stamps over it.
        let painted = '',
          wash = '';
        if (this.parts.ground.fantasy && isFantasyStyle(this.map.resolved!.ground.style)) {
          const f = this.parts.ground.fantasy,
            frame = f.painting.frame!,
            images = (this.parts.ground.fantasyImages ??= fantasyRasterImages(f));
          const at = `x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.width}" preserveAspectRatio="none"`;
          wash = `<image class="fantasy-wash" ${at} href="${images.wash}"/>`;
          painted = `<image class="fantasy-stamps" ${at} href="${images.stamps}"/>`;
        }
        this.parts.ground.backgroundHref = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgOf(this.parts.ground.terrainSvg + wash + this.parts.water.vectors + painted, wholeMap(this.map.native!.width)))}`;
      }
    }
    return this.parts.ground.backgroundHref;
  }
  /** The whole map at `size` pixels into `canvas`, once every product it needs is ready at that density. */
  async capture(size: number, canvas: HTMLCanvasElement, capture: RenderReadiness): Promise<HTMLCanvasElement> {
    await this.parts.ground.exactReady();
    if (this.parts.ground.gpuActive) await this.parts.ground.gpu!.variantReady(); // draw() is synchronous: it would create a missing pipeline in place
    capture.mark('programs-ready');
    const view = { cx: this.map.world!.mapSize / 2, cy: this.map.world!.mapSize / 2, scale: size / this.map.world!.mapSize };
    await this.parts.contours.contoursAt(view.scale, viewRect(view, size, size));
    // Vectors at the export density before the synchronous draw.
    if (
      this.parts.water.vectors &&
      !viewRasterFits(this.parts.water.vectorView?.region, viewRect(view, size, size), view.scale, this.map.world!.mapSize) &&
      !viewRasterFits(this.parts.water.vectorBase?.region, viewRect(view, size, size), view.scale, this.map.world!.mapSize, Infinity)
    ) {
      await this.parts.water.vectorRequest;
      await this.parts.water.requestVectors(viewRasterRegion(viewRect(view, size, size), view.scale, this.map.world!.mapSize));
    }
    // The city plan on WebGL2 (same engine as the live view) is uploaded before the synchronous draw.
    await this.parts.town.city?.prepare(this.map.resolved!, { ...this.map.exportLayers, labels: false });
    const image = this.paint(canvas, view, size, size, 1, false);
    capture.mark('capture-complete');
    return image;
  }
}
