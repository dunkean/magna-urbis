/**
 * The miniature of the page: the whole map at a few hundred pixels, drawn from what is already cached (the CPU ground
 * raster or the whole-map capture of the GPU ground, the cartography's cached map, the whole-map vector water).
 *
 * It never renders the map: a miniature must not cancel the stepwise paints of the view or move the camera of the
 * terrain renderer. The page asks for it after a frame of new content and again until `complete`.
 */

import type { DisplayParts, ViewStatus } from './contract';
import type { MapState } from './mapState';

export class Miniature {
  private readonly canvas = document.createElement('canvas');
  /** True when the last miniature had its map content (cached ground/vectors) and no work was pending: otherwise it must be drawn again. */
  complete = false;

  constructor(
    private readonly map: MapState,
    private readonly parts: DisplayParts,
    private readonly view: ViewStatus,
    private readonly pendingWork: () => number,
  ) {}

  draw(size: number): HTMLCanvasElement {
    const width = this.map.world!.mapSize,
      { ground, water, cartography } = this.parts;
    const canvas = this.canvas;
    // While the view moves the miniature keeps its last drawing: it costs as much as a full frame, and the page asks
    // for it again every 350 ms until it is complete, which a moving view (its picture at rest owed) never lets it be.
    if (canvas.width === size && canvas.height === size && this.view.busy()) {
      this.complete = false;
      return canvas;
    }
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = this.map.paper;
    ctx.fillRect(0, 0, size, size);
    if (ground.base) ctx.drawImage(ground.base, 0, 0, size, size);
    // GPU ground: no CPU raster; the cached ground capture (also the 3D background) is the miniature's terrain.
    const gpuGround = ground.gpuActive ? ground.miniGround() : undefined;
    if (gpuGround) ctx.drawImage(gpuGround, 0, 0, size, size);
    const cached = cartography.renderer?.drawCachedMap(canvas, { minX: 0, minY: 0, maxX: width, maxY: width }) ?? false;
    const vectors = water.vectorBase;
    // What only concerns the view on screen is not in the miniature: waiting for it redrew the whole miniature every
    // 350 ms for as long as a gesture lasted.
    this.complete = (cached || !!ground.base || !!gpuGround || !!vectors) && this.pendingWork() - this.view.pendingViewOnly() <= 0;
    if (vectors) ctx.drawImage(vectors.image, (vectors.region.x * size) / width, (vectors.region.y * size) / width, (vectors.region.width * size) / width, (vectors.region.height * size) / width);
    return canvas;
  }
}
