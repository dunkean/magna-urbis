/**
 * TerrainGl: the WebGL2 renderer of the 2D ground. Everything is drawn by the GPU from retained grids, so panning and
 * zooming only change a few uniforms:
 * - relief: cubic B-spline of a control grid (the Rust engine's physical raster, or sampled heights) with its
 *   box-filtered pyramid, analytic gradient, slope-driven fractal refinement below the source cell;
 * - hypsometric tint and the bench's two-light hillshade, antialiased coast, cavern rock, contour lines of constant
 *   screen width; the material looks (Satellite, Render v2, paper map, Underdark) with forest crowns and water;
 * - diagnostic rasters, continuous procedural lake shores and river capsules with hydraulic widths in world metres.
 * Heights in metres, coordinates in metres from the map's north-west corner.
 *
 * Callers: the V2 map (v2/display, through terrainRenderer.ts), the benches, TerrainGpu after a definitive device
 * loss. Outputs: world tiles of the live compositor, the fallback display (redrawNow), captures for the 3D views and
 * exports. This class assembles the parts of one WebGL2 context (terrain/gl/: programs, inputs, redraw, world tiles,
 * captures), rebuilt together when the context is restored (terrain/gl/contextLoss.ts), with the state that outlives
 * a context: the look, the view, the content revision and the fallback presentation.
 */
import { onDisplayQualityChange } from '../render/displayQuality';
import { disposeForestBrushes } from '../render/forestBrushAtlas';
import { disposeCrownClumps } from '../render/crownClumpAtlas';
import { disposeTreeSymbols } from '../render/treeSymbols';
import { styleTraits } from '../render/terrainStyle';
import type { Rect4, View } from '../render/view';
import type { ForestField, ForestOccupation } from '../../../rust/bridge/terrainForest';
import { MapContextLostError, RESTORE_TIMEOUT_MS, noteMapRenderer } from './glContextRecovery';
import { FallbackGround } from './terrain/fallbackGround';
import { ContentRevision, type InputChange } from './terrain/revision';
import { hasAuxPass } from './terrain/variant';
import { displayPixelRatio, needsPaintedWater, type ViewState } from './terrain/redraw';
import { GlPrograms } from './terrain/gl/programs';
import { GlInputs } from './terrain/gl/inputs';
import { GlRedraw } from './terrain/gl/redraw';
import { GlWorldTiles } from './terrain/gl/worldTiles';
import { GlCaptures } from './terrain/gl/captures';
import { GlContextLoss } from './terrain/gl/contextLoss';
import type { HeightLayer, OverlayLayer, RetainedWaterOptions, SurfaceSample, TerrainLook, WaterLayer } from './terrain/contract';

/** The objects of one WebGL2 context, built together and rebuilt together after a restore. */
interface GlParts {
  programs: GlPrograms;
  inputs: GlInputs;
  redraw: GlRedraw;
  tiles: GlWorldTiles;
  captures: GlCaptures;
}

export class TerrainGl {
  readonly gl: WebGL2RenderingContext;
  private parts!: GlParts;
  private readonly loss: GlContextLoss;
  private roads?: import('../render/groundRoads').GroundRoadPaint;
  setGroundRoads(paint: typeof this.roads): void {
    if (paint === this.roads) return;
    this.roads = paint;
    this.changed('content');
  }
  private look?: TerrainLook;
  private view?: ViewState;
  private frame = 0;
  private disposed = false;
  private capturing = false;
  private livePaused = false;
  private unlistenQuality?: () => void;
  private readonly fallbackGround = new FallbackGround();
  private readonly revision = new ContentRevision();
  /** Last frame's GPU submission time, ms (CPU side). */
  get drawMs(): number {
    return this.parts.redraw.drawMs;
  }

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 indisponible');
    // A canvas keeps its first context, lost or not (a GPU process exit loses them all): callers retry on a fresh canvas.
    if (gl.isContextLost()) throw new MapContextLostError('The map canvas carries a lost WebGL2 context.');
    this.gl = gl;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    noteMapRenderer(String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? ''));
    this.loss = new GlContextLoss(canvas, {
      disposed: () => this.disposed,
      stop: () => {
        cancelAnimationFrame(this.frame);
        this.frame = 0;
      },
      rebuild: () => this.rebuild(),
    });
    this.parts = this.build();
    this.unlistenQuality = onDisplayQualityChange(() => this.request());
  }
  /** The context's objects: programs (preview variant, river, composite), inputs (river buffers, empty texture),
   * the redraw and its targets, world tiles, captures. */
  private build(): GlParts {
    const gl = this.gl;
    // The poll fires while a variant links and once more when it is linked: world tiles re-bake when the look's own
    // programs became complete.
    const programs = new GlPrograms(gl, () => {
      this.revision.noteLookComplete(!!this.look && !this.gl.isContextLost() && this.lookLinked(this.look));
      this.request();
    });
    const inputs = new GlInputs(gl);
    const redraw = new GlRedraw(gl, this.canvas, programs, inputs, { canvasDrawn: () => this.fallbackGround.invalidate(this.canvas), alive: () => !this.disposed && !this.gl.isContextLost(), animate: () => this.request(), roads: () => this.roads, shoreRingBaked: () => this.changed('content') });
    return { programs, inputs, redraw, tiles: new GlWorldTiles(gl, this.canvas, redraw, inputs), captures: new GlCaptures(gl, this.canvas, redraw, inputs) };
  }
  /** On a restored context every GL object is gone: build the parts again and replay the retained CPU inputs. The
   * look is kept; the next draw links its variant. */
  private rebuild(): void {
    const lost = this.parts;
    lost.programs.lose();
    disposeForestBrushes(this.gl, false);
    disposeCrownClumps(this.gl, false);
    disposeTreeSymbols(this.gl, false);
    this.parts = this.build();
    this.parts.inputs.replay(lost.inputs, this.look?.mapWidth);
    this.changed('content');
  }
  /** `region`: the world boxes a 'content' change is limited to (setForest of a local edit); undefined: the whole map. */
  private changed(change: InputChange, region?: readonly Rect4[]): void {
    if (change === 'content') this.revision.bump(region);
    if (change !== 'none') this.request();
  }

  /** Preparation can upload and compile while its previous frame stays displayed. */
  setLivePaused(paused: boolean): void {
    this.livePaused = paused;
    if (paused) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    } else this.request();
  }
  /** The whole map's control grid; drops detail layers. */
  setBase(layer: HeightLayer): void {
    this.changed(this.parts.inputs.setBase(layer));
  }
  /** A finer square region drawn over the base, cross-faded in; keeps at most two. */
  setDetail(layer: HeightLayer | undefined): void {
    this.changed(this.parts.inputs.setDetail(layer));
  }
  /** Explicit Render3D refinement only; ordinary 2D layers never consume it. */
  setEnhancedDetail(layer: HeightLayer | undefined): void {
    this.changed(this.parts.inputs.setEnhancedDetail(layer));
  }
  /** Retained exports keep exact SVG banks, including accumulated crop transforms (terrain/retainedWater.ts). */
  setRetainedWater(svg: string | undefined, width = 1, options?: RetainedWaterOptions): void {
    this.changed(this.parts.inputs.setRetainedWater(svg, width, options));
  }
  setWater(water: WaterLayer | undefined): void {
    this.changed(this.parts.inputs.setWater(water, this.look?.mapWidth));
  }
  setOverlay(overlay: OverlayLayer | undefined): void {
    this.changed(this.parts.inputs.setOverlay(overlay));
  }
  /** The paper map's lit land, drawn under the woods of its tree symbols (render/treeSymbols.ts). */
  setLandBackdrop(image: HTMLCanvasElement | undefined): void {
    this.changed(this.parts.inputs.setLandBackdrop(image));
  }
  /** Render3D forest: texture uploads only. `undefined` restores the macro canopy of the material exactly. */
  setForest(field: ForestField | undefined, occupation?: ForestOccupation): void {
    const inputs = this.parts.inputs;
    this.changed(inputs.setForest(field, occupation), inputs.forestRegion);
  }
  setRenderV2Season(season: number): void {
    if (!this.look) return;
    this.look = { ...this.look, v2Season: season };
    this.changed('content');
  }
  setLook(look: TerrainLook): void {
    this.look = look;
    this.changed('content');
  }
  setView(view: View, width: number, height: number): void {
    this.view = { view, width, height };
    this.request();
  }

  /** Every program the look's live redraw uses is linked (no stand-in): the map variant, its auxiliary pass, the painted water. */
  private lookLinked(look: TerrainLook): boolean {
    const { programs, inputs, redraw } = this.parts;
    return programs.linked(redraw.lookVariant(look), needsPaintedWater(look, inputs.riverCount, inputs.retainedWater.paths.length));
  }
  /** Resolves once the current look's variant is linked, without blocking: callers that can wait
   * (3D material tiles) capture after it instead of stalling the page on the link. */
  async variantReady(): Promise<void> {
    const recovery = this.loss.recovery;
    let lostSince = 0;
    while (this.look && !this.disposed) {
      // A lost context waits for its restore (rebuilt in place, then the light profile); only a final loss throws.
      if (recovery.failed) throw new MapContextLostError();
      if (this.gl.isContextLost() || recovery.waiting) {
        lostSince ||= performance.now();
        if (performance.now() - lostSince > RESTORE_TIMEOUT_MS + 2000) throw new MapContextLostError();
        await new Promise(resolve => setTimeout(resolve, 50));
        continue;
      }
      lostSince = 0;
      const { programs, inputs, redraw } = this.parts,
        v = redraw.lookVariant(this.look),
        painted = needsPaintedWater(this.look, inputs.riverCount, inputs.retainedWater.paths.length);
      const main = programs.map(v, false);
      const aux = !hasAuxPass(v) || programs.aux(v, false);
      const water = !painted || programs.water(false);
      if (programs.failed(v, painted)) throw new Error('A WebGL map style program failed to compile.');
      if (main && aux && water) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  /** Live ground tile (terrain/gl/worldTiles.ts). The canvas then holds the tile: the fallback presentation is
   * invalidated, and the fallback display redraws before it reads the canvas. */
  renderWorldTile(box: Rect4, px: number, treePlane?: TerrainLook['treePlane']): TexImageSource | undefined {
    if (this.disposed) return undefined;
    return this.parts.tiles.render(treePlane && this.look ? { ...this.look, treePlane } : this.look, box, px, look => this.lookLinked(look));
  }
  /** Changes whenever renderWorldTile would draw other pixels (inputs, a linked program, the style pixel ratio). */
  contentRevision(): number {
    return this.revision.value();
  }
  /** The world boxes whose pixels changed after revision `since` (GroundTileRenderer.contentChanges). */
  contentChanges(since: number): readonly Rect4[] | undefined {
    return this.revision.changesSince(since);
  }

  /** Reuse the map material for the perspective viewer without changing the 2D camera. */
  captureMap(size = 2048, groundOverlay = false): HTMLCanvasElement {
    if (!this.look) throw new Error('Le terrain est indisponible.');
    return this.captureRegion({ x: 0, y: 0, width: this.look.mapWidth }, size, false, true, undefined, groundOverlay);
  }
  redrawForCapture(): void {
    if (!this.parts.inputs.base || !this.look || this.gl.isContextLost()) throw new Error('Le terrain est indisponible.');
    this.capturing = true;
    try {
      this.draw();
    } finally {
      this.capturing = false;
    }
  }
  /** Render a world-space LOD tile with the same material and detail as the map (terrain/gl/captures.ts). */
  captureRegion(region: { x: number; y: number; width: number }, size = 512, includeDetails = true, restoreDisplay = true, height?: HeightLayer, groundOverlay = false, alphaOnly?: Uint8Array): HTMLCanvasElement {
    return this.capture(this.look, region, size, includeDetails, restoreDisplay, height, groundOverlay, alphaOnly);
  }
  /** Canonical 1 m water samples with a caller-supplied world-space halo. */
  captureWaterMask(region: { x: number; y: number; width: number }): Uint8Array {
    const n = Math.round(region.width),
      alpha = new Uint8Array(n * n),
      look = this.look;
    this.capture(look && styleTraits(look.style).waterAlwaysDrawn ? { ...look, layers: { ...look.layers, water: true } } : look, region, n, false, false, undefined, true, alpha);
    return alpha;
  }
  private capture(look: TerrainLook | undefined, region: { x: number; y: number; width: number }, size: number, includeDetails: boolean, restoreDisplay: boolean, height: HeightLayer | undefined, groundOverlay: boolean, alphaOnly?: Uint8Array): HTMLCanvasElement {
    if (!this.parts.inputs.base || !look || this.gl.isContextLost()) throw new Error('Le terrain est indisponible.');
    return this.parts.captures.region(look, region, size, includeDetails, restoreDisplay ? () => this.draw() : undefined, height, groundOverlay, alphaOnly);
  }

  createSurfaceSampler(): SurfaceSample | undefined {
    return this.look && this.parts.inputs.createSurfaceSampler(this.look);
  }
  /** Height (metres) the renderer shows at a world point, from the finest layer covering it. */
  heightAt(x: number, y: number): number | undefined {
    return this.parts.inputs.heightAt(x, y, this.look?.floor ?? 0);
  }

  /** Fallback display (terrain/fallbackGround.ts): present in the caller's animation frame; `interacting` moves the
   * picture painted at rest instead of drawing. */
  redrawNow(view?: View, width?: number, height?: number, interacting = false, pixelRatio = displayPixelRatio()): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (view && width && height) this.view = { view, width, height };
    const state = this.view;
    if (state) this.fallbackGround.present(this.canvas, state.view, state.width, state.height, pixelRatio, interacting, () => this.draw(pixelRatio));
  }
  private request(): void {
    this.fallbackGround.invalidate(this.canvas);
    if (this.disposed || this.frame || this.livePaused) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }
  /** The live view on the canvas. */
  private draw(pixelRatio = displayPixelRatio(), stylePixelRatio = pixelRatio): boolean {
    const { inputs, redraw } = this.parts;
    if (!this.look || !this.view) {
      this.fallbackGround.invalidate(this.canvas);
      return false;
    }
    return redraw.draw({ look: this.look, view: this.view, details: inputs.details, enhanced: inputs.enhanced, pixelRatio, stylePixelRatio, framebuffer: null, targets: redraw.liveTargets, capturing: this.capturing, tile: false });
  }

  dispose(): void {
    if (this.disposed) return;
    this.unlistenQuality?.();
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    const { programs, inputs, redraw, tiles, captures } = this.parts;
    programs.dispose();
    this.loss.dispose();
    redraw.dispose();
    inputs.dispose();
    disposeForestBrushes(this.gl);
    disposeCrownClumps(this.gl);
    disposeTreeSymbols(this.gl);
    tiles.dispose();
    captures.dispose();
  }
}
