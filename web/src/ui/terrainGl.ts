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
 * Callers: the V2 map (v2/benchRenderer.ts, through terrainRenderer.ts), the benches, TerrainGpu after a definitive
 * device loss. Outputs: world tiles of the live compositor (renderWorldTile), the fallback display (redrawNow,
 * terrain/fallbackGround.ts), captures for the 3D views and exports. Parts: terrain/ (shared with the WebGPU twin:
 * inputs, variants, the redraw description, the parameter block, layers, retained water) and terrain/gl/ (shaders,
 * programs, targets, water passes, forest bindings, context loss).
 */
import { displayQualityUniform, onDisplayQualityChange } from '../render/displayQuality';
import { MapContextLostError, RESTORE_TIMEOUT_MS, mapGpuLight, mapTextureCap, noteMapRenderer } from './glContextRecovery';
import { shoreRingPixels, shoreRingTexture } from '../../../rust/bridge/terrainForestBeach';
import type { ForestField, ForestOccupation, LandDetail } from '../../../rust/bridge/terrainForest';
import { setSeasonCalendarGl } from '../../../rust/bridge/terrainRenderV2Zones';
import { bindForestBrushes, disposeForestBrushes } from '../render/forestBrushAtlas';
import { bindCrownClumps, crownClumpMode, disposeCrownClumps } from '../render/crownClumpAtlas';
import { lakeDistances, seaDistanceSurface, type WaterSurface } from '../render/terrainWater';
import { styleTraits } from '../render/terrainStyle';
import type { Rect4, View } from '../render/view';
import { FallbackGround } from './terrain/fallbackGround';
import { ContentRevision } from './terrain/revision';
import { RetainedWaterSource } from './terrain/retainedWater';
import { SurfaceSamplerCache, dropHiddenDetails, heightAt, pushLayer } from './terrain/layers';
import { hasAuxPass, lookMode, lookVariant, variantKey, type TerrainVariant } from './terrain/variant';
import { captureLook, captureViewState, detailQuad, displayPixelRatio, fadeProgress, liveStyleRatio, lookPalettes, needsPaintedWater, paintedWaterLook, redrawFrame, separateWaterLayer, settled, settledDetails, tileViewState, waterBand, type RedrawFrame } from './terrain/redraw';
import { writeFieldParams, writeLookParams, writeMapParamsAfterWaterLayer, writeWaterLayerParams, type LookBindings, type LookParamsState, type LookTexture } from './terrain/lookParams';
import { GlPrograms } from './terrain/gl/programs';
import { GlContextLoss } from './terrain/gl/contextLoss';
import { GlViewTargets, deleteTarget, emptyUintTexture, glTexture, releaseHeightLayer, rgbaTarget, uintTarget, uploadHeightLayer, type GlHeightLayer, type GlTarget } from './terrain/gl/resources';
import { renderRetainedWater, renderRivers, type GlWaterPass } from './terrain/gl/passes';
import { bindForest, bindLandDetail, cappedForest, deleteForestTextures, forestTexture, forestTextures, glLandDetailUnit, type ForestTextures } from './terrain/gl/forest';
import type { HeightLayer, OverlayLayer, RetainedWaterOptions, SurfaceSample, TerrainLook, ViewState, WaterLayer } from './terrain/types';

export type { GlStyle, HeightLayer, OverlayLayer, RetainedWaterOptions, TerrainLook, WaterLayer } from './terrain/types';
export { COMPOSITE_FS, COMPOSITE_VS, RENDER_3D_FOREST_GLSL, RIVER_FS, RIVER_VS, TERRAIN_FS, TERRAIN_VS } from './terrain/gl/shaders';
export { bindForest, bindLandDetail, deleteForestTextures, forestTexture, forestTextures, glLandDetailUnit, type ForestTextures } from './terrain/gl/forest';

export class TerrainGl {
  readonly gl: WebGL2RenderingContext;
  private programs!: GlPrograms;
  private readonly loss: GlContextLoss;
  /** CPU inputs kept to rebuild every GL object on a restored context. */
  private waterInput?: WaterLayer;
  private overlayInput?: OverlayLayer;
  private forestSource?: ForestField;
  private occupationSource?: ForestOccupation;
  private emptyAux?: WebGLTexture;
  /** Bumped by setForest: the auxiliary pass depends on the forest field and the applied occupation. */
  private forestVersion = 0;
  private capturing = false;
  /** Intermediate targets of the live view, of the world tiles, and the ones the current draw uses. */
  private readonly liveTargets = new GlViewTargets();
  private readonly tileTargets = new GlViewTargets();
  private targets = this.liveTargets;
  private captureTarget?: GlTarget;
  private readonly retainedWater = new RetainedWaterSource();
  private base?: GlHeightLayer;
  private details: GlHeightLayer[] = [];
  private enhanced: GlHeightLayer[] = [];
  private look?: TerrainLook;
  private readonly surface = new SurfaceSamplerCache();
  private lake?: WebGLTexture;
  private lakeMode = 0;
  private lakeN = 0;
  private overlay?: WebGLTexture;
  private coastDistance?: WebGLTexture;
  private shoreRing?: { layer: object; revision: number; texture: WebGLTexture; x: number; y: number; width: number };
  /** A cast-shadow bake for a new light azimuth has landed in the shore ring: draw again to upload it. */
  private readonly ringChanged = (): void => {
    this.revision.bump();
    this.request();
  };
  /** Canonical Render3D forest field and applied occupation, sampled by world coordinates. */
  private forest?: ForestTextures;
  private occupation?: { data: ForestOccupation; texture: WebGLTexture };
  private landDetail?: { data: LandDetail; texture: WebGLTexture };
  private lakeInput?: Float32Array;
  private lakeWidth = 0;
  private seaSurface?: WaterSurface;
  private riverBuffer!: WebGLBuffer;
  private riverVao!: WebGLVertexArrayObject;
  private riverCount = 0;
  private riverRegime = false;
  private view?: ViewState;
  private frame = 0;
  private disposed = false;
  private unlistenQuality?: () => void;
  private empty!: WebGLTexture;
  /** Last frame's GPU submission time, ms (CPU side). */
  drawMs = 0;
  private readonly fallbackGround = new FallbackGround();
  private livePaused = false;
  private readonly revision = new ContentRevision();
  /** A world tile is being drawn (full quality, never a blocking link). */
  private tileRendering = false;
  /** The look's parameter block as glUniform* calls on the current map (or auxiliary) program. */
  private readonly params: LookBindings;

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
    this.params = this.paramBindings();
    this.createResources();
    this.unlistenQuality = onDisplayQualityChange(() => this.request());
  }
  /** Preparation can upload and compile while its previous frame stays displayed. */
  setLivePaused(paused: boolean): void {
    this.livePaused = paused;
    if (paused) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    } else this.request();
  }
  /** The context's fixed objects: programs (preview variant, river, composite), river buffers, empty texture. */
  private createResources(): void {
    const gl = this.gl;
    // The poll fires while a variant links and once more when it is linked: world tiles re-bake when the look's own
    // programs became complete.
    this.programs = new GlPrograms(gl, () => {
      this.revision.noteLookComplete(!!this.look && !this.gl.isContextLost() && this.lookLinked(this.look));
      this.request();
    });
    this.riverBuffer = gl.createBuffer()!;
    this.riverVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.riverVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.riverBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 36, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 36, 16);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 36, 24);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
    this.empty = glTexture(gl, 1, 1, gl.R8, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(1), gl.NEAREST);
  }
  /** On a restored context every GL object is gone: forget them all, recreate the fixed ones and replay the
   * retained CPU inputs (layers, water, overlay, forest). The look is kept; the next draw links its variant. */
  private rebuild(): void {
    const gl = this.gl;
    this.programs.lose();
    this.liveTargets.forget();
    this.tileTargets.forget();
    this.captureTarget = undefined;
    this.emptyAux = undefined;
    this.revision.bump();
    this.shoreRing = undefined;
    this.coastDistance = undefined;
    this.lake = undefined;
    this.lakeInput = undefined;
    this.overlay = undefined;
    this.forest = undefined;
    this.occupation = undefined;
    this.landDetail = undefined;
    disposeForestBrushes(gl, false);
    disposeCrownClumps(gl, false);
    const base = this.base?.layer,
      details = this.details.map(d => d.layer),
      enhanced = this.enhanced.map(d => d.layer);
    const water = this.waterInput,
      overlay = this.overlayInput,
      forest = this.forestSource,
      occupation = this.occupationSource;
    this.base = undefined;
    this.details = [];
    this.enhanced = [];
    this.forestSource = this.occupationSource = undefined;
    this.createResources();
    if (base) this.setBase(base);
    for (const layer of details) this.setDetail(layer);
    for (const layer of enhanced) this.setEnhancedDetail(layer);
    this.setWater(water);
    this.setOverlay(overlay);
    this.setForest(forest, occupation);
    this.request();
  }

  private lookVariant(look: TerrainLook): TerrainVariant {
    return lookVariant(look, !!this.forest);
  }
  /** The look's variant once linked; meanwhile the last drawn variant, or the preview, stands in
   * (undefined if none is linked yet). Captures wait for the link. */
  private terrainProgram(look: TerrainLook, wait: boolean): WebGLProgram | undefined {
    const v = this.lookVariant(look),
      target = this.programs.map(v, wait);
    // Automated shots (v7 sheets) wait for data-map-variant-ready="1": until then a stand-in variant draws another look.
    const canvas = this.gl.canvas;
    if (typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement) {
      const aux = !hasAuxPass(v) || !!this.programs.aux(v, wait);
      canvas.dataset.mapVariant = variantKey(v);
      canvas.dataset.mapVariantReady = target && aux ? '1' : '0';
    }
    if (target && !this.capturing) this.programs.prewarm(() => !this.disposed && !this.gl.isContextLost());
    return this.programs.orStandIn(target);
  }
  /** Every program the look's live redraw uses is linked (no stand-in): the map variant, its auxiliary pass, the painted water. */
  private lookLinked(look: TerrainLook): boolean {
    return this.programs.linked(this.lookVariant(look), needsPaintedWater(look, this.riverCount, this.retainedWater.paths.length));
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
      const v = this.lookVariant(this.look),
        painted = needsPaintedWater(this.look, this.riverCount, this.retainedWater.paths.length);
      const main = this.programs.map(v, false);
      const aux = !hasAuxPass(v) || this.programs.aux(v, false);
      const water = !painted || this.programs.water(false);
      if (this.programs.failed(v, painted)) throw new Error('A WebGL map style program failed to compile.');
      if (main && aux && water) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  private upload(layer: HeightLayer, pyramid: boolean): GlHeightLayer {
    return uploadHeightLayer(this.gl, layer, pyramid);
  }
  private readonly release = (layer: GlHeightLayer | undefined): void => releaseHeightLayer(this.gl, layer);

  /** The whole map's control grid; drops detail layers. */
  setBase(layer: HeightLayer): void {
    this.enhanced.forEach(this.release);
    this.enhanced = [];
    this.release(this.base);
    this.details.forEach(this.release);
    this.details = [];
    this.base = this.upload(layer, true);
    if (this.coastDistance) this.gl.deleteTexture(this.coastDistance);
    this.coastDistance = undefined;
    this.seaSurface = layer.waterSurface ?? seaDistanceSurface({ height: layer.data, resolution: layer.n, width: layer.width, x: layer.x, y: layer.y });
    if (!layer.cave?.length) {
      const surface = this.seaSurface;
      // Portable FP32 storage with explicit bilinear sampling; no 8-bit distance
      // quantization and no dependency on optional float linear filtering.
      this.coastDistance = glTexture(this.gl, surface.n, surface.n, this.gl.R32F, this.gl.RED, this.gl.FLOAT, surface.distance, this.gl.NEAREST);
    }
    this.revision.bump();
    this.request();
  }

  /** A finer square region drawn over the base, cross-faded in; keeps at most two. */
  setDetail(layer: HeightLayer | undefined): void {
    this.revision.bump();
    if (!layer) {
      this.details.forEach(this.release);
      this.details = [];
      this.request();
      return;
    }
    const next = this.upload(layer, false);
    next.alpha = 0;
    next.fadeStart = performance.now();
    pushLayer(this.details, next, this.release);
    this.request();
  }

  setRenderV2Season(season: number): void {
    if (this.look) {
      this.look = { ...this.look, v2Season: season };
      this.revision.bump();
      this.request();
    }
  }
  setLook(look: TerrainLook): void {
    this.look = look;
    this.revision.bump();
    this.request();
  }

  /** Explicit Render3D refinement only; ordinary 2D layers never consume it. */
  setEnhancedDetail(layer: HeightLayer | undefined): void {
    if (!layer) {
      if (this.enhanced.length) this.revision.bump();
      this.enhanced.forEach(this.release);
      this.enhanced = [];
      this.request();
      return;
    }
    if (this.enhanced.at(-1)?.layer === layer) return;
    this.revision.bump();
    const next = this.upload(layer, false);
    next.fadeStart = performance.now();
    pushLayer(this.enhanced, next, this.release);
    this.request();
  }

  /** Retained exports keep exact SVG banks, including accumulated crop transforms (terrain/retainedWater.ts). */
  setRetainedWater(svg: string | undefined, width = 1, options?: RetainedWaterOptions): void {
    if (!this.retainedWater.set(svg, width, options)) return;
    this.liveTargets.retained.invalidate();
    this.tileTargets.retained.invalidate();
    this.revision.bump();
    this.request();
  }

  setWater(water: WaterLayer | undefined): void {
    const gl = this.gl;
    this.waterInput = water;
    const width = this.look?.mapWidth ?? this.base?.layer.width ?? 0;
    if (water?.lake !== this.lakeInput || (water?.lake && (this.lakeN !== water.n || this.lakeWidth !== width))) {
      if (this.lake) gl.deleteTexture(this.lake);
      this.lake = undefined;
      this.lakeInput = water?.lake;
      this.lakeWidth = width;
      if (water?.lake) {
        const distances = lakeDistances(water.lake, water.n, width),
          values = new Float32Array(water.n * water.n * 2);
        for (let i = 0; i < water.lake.length; i++) {
          values[i * 2] = water.lake[i];
          values[i * 2 + 1] = distances[i];
        }
        this.lake = glTexture(gl, water.n, water.n, gl.RG32F, gl.RG, gl.FLOAT, values, gl.NEAREST);
        this.lakeN = water.n;
      }
    }
    this.lakeMode = water?.shore === 'exact' ? 2 : 1;
    const rivers = water?.rivers ?? new Float32Array();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.riverBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, rivers.byteLength ? rivers : new Float32Array(9), gl.STATIC_DRAW);
    this.riverCount = rivers.length / 9;
    this.riverRegime = !!water?.regime;
    this.revision.bump();
    this.request();
  }

  setOverlay(overlay: OverlayLayer | undefined): void {
    const gl = this.gl;
    this.overlayInput = overlay;
    if (this.overlay) gl.deleteTexture(this.overlay);
    this.overlay = overlay ? glTexture(gl, overlay.n, overlay.n, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, overlay.rgba, gl.NEAREST) : undefined;
    this.revision.bump();
    this.request();
  }

  setView(view: View, width: number, height: number): void {
    this.view = { view, width, height };
    this.request();
  }

  /** Render3D forest: texture uploads only. `undefined` restores the macro canopy of the material exactly. */
  setForest(field: ForestField | undefined, occupation?: ForestOccupation): void {
    const gl = this.gl,
      cap = mapTextureCap(gl.getParameter(gl.MAX_TEXTURE_SIZE));
    if (field !== this.forestSource) {
      deleteForestTextures(gl, this.forest);
      this.forestSource = field;
      // Light profile: no forest pass, so no forest upload. Low-end GPUs: the field and its banks at most `cap`.
      this.forest = field && !mapGpuLight() ? forestTextures(gl, cappedForest(field, cap)) : undefined;
    }
    if (occupation !== this.occupation?.data) {
      if (this.occupation) gl.deleteTexture(this.occupation.texture);
      this.occupationSource = occupation;
      this.occupation = occupation && { data: occupation, texture: forestTexture(gl, occupation, true) };
    }
    // Holdings are optional detail: left out in the light profile and when larger than the cap (classes cannot be box-filtered).
    const detail = glLandDetailUnit(gl) === undefined || mapGpuLight() || (occupation?.detail?.n ?? 0) > cap ? undefined : occupation?.detail;
    if (detail !== this.landDetail?.data) {
      if (this.landDetail) gl.deleteTexture(this.landDetail.texture);
      this.landDetail = detail && { data: detail, texture: forestTexture(gl, detail, true) };
    }
    this.forestVersion++;
    this.revision.bump();
    this.request();
  }

  /** Reuse the map material for the perspective viewer without changing the 2D camera. */
  captureMap(size = 2048, groundOverlay = false): HTMLCanvasElement {
    if (!this.look) throw new Error('Le terrain est indisponible.');
    return this.captureRegion({ x: 0, y: 0, width: this.look.mapWidth }, size, false, true, undefined, groundOverlay);
  }
  redrawForCapture(): void {
    if (!this.base || !this.look || this.gl.isContextLost()) throw new Error('Le terrain est indisponible.');
    this.capturing = true;
    try {
      this.draw();
    } finally {
      this.capturing = false;
    }
  }

  /** Fallback display (terrain/fallbackGround.ts): present in the caller's animation frame; do not schedule a second
   * draw or wait for compilation. */
  redrawNow(view?: View, width?: number, height?: number, interacting = false, pixelRatio = displayPixelRatio()): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (view && width && height) this.view = { view, width, height };
    const state = this.view;
    if (state)
      this.fallbackGround.present(this.canvas, state.view, state.width, state.height, pixelRatio, interacting, (ratio, renderWidth, renderHeight) => {
        this.view = { ...state, width: renderWidth, height: renderHeight };
        try {
          return this.draw(ratio, pixelRatio);
        } finally {
          this.view = state;
        }
      });
  }

  /** Live ground tile (contract GroundTileRenderer, render/live/groundLayer.ts): every pass of the live redraw (water
   * layer, rivers, painted water, auxiliary pass, map) for the world square `box` at `px`² device pixels, full quality,
   * into this renderer's canvas, to be uploaded in the same task. The material's detail follows the tile density
   * (uPx = metres per tile pixel); details and refinements are drawn at their final opacity. Undefined while a program
   * of the look is still linking: a tile never shows a stand-in variant and never waits for a link. The canvas then
   * holds the tile: the fallback presentation is invalidated (draw), and the fallback display redraws before it reads
   * the canvas. */
  renderWorldTile(box: Rect4, px: number): TexImageSource | undefined {
    const look = this.look,
      size = box.maxX - box.minX;
    if (this.disposed || !look || !this.base || this.gl.isContextLost() || !(size > 0) || px < 1 || !this.lookLinked(look)) return undefined;
    const ratio = liveStyleRatio(),
      previous = this.view,
      details = this.details,
      enhanced = this.enhanced;
    this.view = tileViewState(box, px, ratio);
    this.details = settledDetails(details);
    this.enhanced = enhanced.map(settled);
    this.targets = this.tileTargets;
    // A tile is drawn again only when its content changed: never reuse the previous tile's auxiliary pass or water raster.
    this.tileTargets.auxKey.invalidate();
    this.tileTargets.retained.invalidate();
    this.tileRendering = true;
    let drawn = false;
    try {
      drawn = this.draw(ratio, ratio);
    } finally {
      this.tileRendering = false;
      this.targets = this.liveTargets;
      this.view = previous;
      this.details = details;
      this.enhanced = enhanced;
    }
    return drawn ? this.canvas : undefined;
  }
  /** Changes whenever renderWorldTile would draw other pixels (inputs, a linked program, the style pixel ratio). */
  contentRevision(): number {
    return this.revision.value();
  }

  /** Render a world-space LOD tile with the same material and detail as the map. */
  captureRegion(region: { x: number; y: number; width: number }, size = 512, includeDetails = true, restoreDisplay = true, height?: HeightLayer, groundOverlay = false, alphaOnly?: Uint8Array): HTMLCanvasElement {
    if (!this.base || !this.look || this.gl.isContextLost()) throw new Error('Le terrain est indisponible.');
    const previous = this.view,
      details = this.details,
      look = this.look,
      enhanced = this.enhanced;
    const capturedHeight = height ? this.upload(height, false) : undefined;
    const output = document.createElement('canvas');
    output.width = output.height = size;
    const context = output.getContext('2d');
    if (!context) throw new Error('Impossible de préparer le style 3D.');
    try {
      // Freeze the current regional detail at its final opacity for reproducible tiles.
      this.details = !groundOverlay && includeDetails ? settledDetails(details) : [];
      this.look = captureLook(look, groundOverlay);
      this.enhanced = capturedHeight ? [settled(capturedHeight)] : [];
      this.view = captureViewState(region, size);
      if (groundOverlay) {
        this.captureTarget = rgbaTarget(this.gl, size, size, this.captureTarget);
        this.draw(1, includeDetails ? displayPixelRatio() : 1, this.captureTarget.framebuffer);
        const rgba = new Uint8Array(size * size * 4);
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.captureTarget.framebuffer);
        this.gl.readPixels(0, 0, size, size, this.gl.RGBA, this.gl.UNSIGNED_BYTE, rgba);
        // The framebuffer and river compositor store premultiplied radiance.
        // The centre mask needs alpha only, avoiding RGB conversion and another
        // Canvas readback for its larger world-space bank halo.
        if (alphaOnly) {
          for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) alphaOnly[y * size + x] = rgba[((size - 1 - y) * size + x) * 4 + 3];
        } else {
          const image = context.createImageData(size, size);
          for (let y = 0; y < size; y++)
            for (let x = 0; x < size; x++) {
              const a = (y * size + x) * 4,
                b = ((size - 1 - y) * size + x) * 4,
                alpha = rgba[b + 3];
              for (let c = 0; c < 3; c++) image.data[a + c] = alpha ? Math.min(255, Math.round((rgba[b + c] * 255) / alpha)) : 0;
              image.data[a + 3] = alpha;
            }
          context.putImageData(image, 0, 0);
        }
      } else {
        this.draw(1, includeDetails ? displayPixelRatio() : 1);
        context.drawImage(this.canvas, 0, 0);
      }
    } finally {
      this.view = previous;
      this.details = details;
      this.look = look;
      this.enhanced = enhanced;
      this.release(capturedHeight);
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
      if (restoreDisplay) this.draw();
    }
    return output;
  }

  /** Canonical 1 m water samples with a caller-supplied world-space halo. */
  captureWaterMask(region: { x: number; y: number; width: number }): Uint8Array {
    const n = Math.round(region.width),
      alpha = new Uint8Array(n * n);
    const look = this.look;
    if (look && styleTraits(look.style).waterAlwaysDrawn) this.look = { ...look, layers: { ...look.layers, water: true } };
    try {
      this.captureRegion(region, n, false, false, undefined, true, alpha);
    } finally {
      this.look = look;
    }
    return alpha;
  }

  createSurfaceSampler(): SurfaceSample | undefined {
    if (!this.base || !this.look) return undefined;
    return this.surface.sampler(this.base.layer, this.details[this.details.length - 1]?.layer, this.look);
  }

  /** Height (metres) the renderer shows at a world point, from the finest layer covering it. */
  heightAt(x: number, y: number): number | undefined {
    return heightAt(this.details, this.base, this.look?.floor ?? 0, x, y);
  }

  private request(): void {
    this.fallbackGround.invalidate(this.canvas);
    if (this.disposed || this.frame || this.livePaused) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  /** glUniform* writes of the look block on the current program; textures on their units (lookParams.ts). */
  private paramBindings(): LookBindings {
    const gl = this.gl,
      u = (name: string): WebGLUniformLocation | null => this.programs.uniform(name);
    const textureOf = (texture: LookTexture): WebGLTexture => {
      switch (texture) {
        case 'refined':
          return this.enhanced.at(-1)?.texture ?? this.empty;
        case 'previousRefined':
          return this.enhanced.at(-2)?.texture ?? this.empty;
        case 'coast':
          return this.coastDistance ?? this.empty;
        case 'lake':
          return this.lake ?? this.empty;
        case 'overlay':
          return this.overlay ?? this.empty;
        case 'emptyAux':
          return this.emptyUint();
      }
    };
    return {
      int: (name, v) => gl.uniform1i(u(name), v),
      uint: (name, v) => gl.uniform1ui(u(name), v),
      float: (name, v) => gl.uniform1f(u(name), v),
      vec2: (name, x, y) => gl.uniform2f(u(name), x, y),
      vec3: (name, x, y, z) => gl.uniform3f(u(name), x, y, z),
      vec4: (name, x, y, z, w) => gl.uniform4f(u(name), x, y, z, w),
      floats: (name, size, values) => {
        const location = u(name),
          list = values as Float32List;
        if (size === 1) gl.uniform1fv(location, list);
        else if (size === 2) gl.uniform2fv(location, list);
        else if (size === 3) gl.uniform3fv(location, list);
        else gl.uniform4fv(location, list);
      },
      texture: (_name, unit, texture) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, textureOf(texture));
      },
      sampler: (name, unit) => gl.uniform1i(u(name), unit),
      // Textures 7 forest field, 8 occupation, 12 banks, 13 beach; 10/11 belong to water.
      forest: enabled => bindForest(gl, u, this.forest, this.occupation, this.empty, enabled, 7, 8, 12, 13),
      landDetail: () => bindLandDetail(gl, u, this.landDetail, this.empty),
      // Texture 14: baked shore ring and relief light (CPU, shared with the 3D view), only for the natural looks.
      shoreRing: mode => {
        if (mode >= 2 && this.base) {
          const pixels = shoreRingPixels(this.base.layer, this.look!.lighting.azimuth, this.ringChanged);
          if (this.shoreRing?.layer !== this.base.layer || this.shoreRing.revision !== pixels.revision) {
            if (this.shoreRing) gl.deleteTexture(this.shoreRing.texture);
            const grid = pixels.grid;
            this.shoreRing = { layer: this.base.layer, revision: pixels.revision, texture: shoreRingTexture(gl, pixels), x: grid.x, y: grid.y, width: grid.width };
          }
        }
        gl.activeTexture(gl.TEXTURE14);
        gl.bindTexture(gl.TEXTURE_2D, this.shoreRing?.texture ?? this.empty);
        gl.uniform1i(u('uShoreRing'), 14);
        gl.uniform3f(u('uShoreRingRect'), this.shoreRing?.x ?? 0, this.shoreRing?.y ?? 0, this.shoreRing?.width ?? 1);
      },
      brushes: (enabled, crownDetail) => {
        bindForestBrushes(gl, u, enabled, 9);
        // Optional crown clumps on the same unit: painted brushes and clumps never show together.
        bindCrownClumps(gl, u, crownClumpMode(crownDetail, enabled), 9);
      },
      seasonCalendar: (zone, calendar) => setSeasonCalendarGl(gl, u, zone, calendar),
    };
  }
  private emptyUint(): WebGLTexture {
    return (this.emptyAux ??= emptyUintTexture(this.gl));
  }

  /** Auxiliary pass of the look into the view's aux target, over the base layer, skipped when its inputs did not
   * change; the map program then reads it on unit 15 (uHasAux 0 while the pass is still linking). */
  private renderAux(look: TerrainLook, v: TerrainVariant, state: LookParamsState, separateWater: boolean, framebuffer: WebGLFramebuffer | null): void {
    const gl = this.gl,
      base = this.base!,
      { frame, quality } = state,
      targets = this.targets;
    if (!hasAuxPass(v)) return;
    const main = this.programs.current,
      aux = this.programs.aux(v, this.capturing || framebuffer !== null || look.mesh3d === true);
    if (aux) {
      const key = targets.auxKey.scratch();
      key.length = 0;
      key.push(quality, frame.width, frame.height, frame.origin, frame.px, look.seed, look.climate, look.lighting, look.v2Season, look.v2Calendar, look.layers, look.refinement3d, look.mesh3d, look.style, look.waterLook);
      key.push(this.forestVersion, this.riverCount, this.retainedWater.key, this.lakeN, separateWater, base.layer.width, base.layer.n, this.enhanced.at(-1)?.fadeStart, this.coastDistance ? 1 : 0);
      if (targets.auxKey.changed()) {
        targets.aux = uintTarget(gl, frame.width, frame.height, targets.aux);
        this.programs.current = aux;
        gl.useProgram(aux);
        writeLookParams(this.params, state);
        const p = this.params;
        // The same water layer and base relief as the map pass.
        p.int('uWaterLayer', 10);
        p.int('uUseWaterLayer', separateWater ? 1 : 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, base.texture);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, base.cave ?? this.empty);
        writeFieldParams(p, base, true);
        p.float('uAlpha', 1);
        p.vec4('uQuad', 0, 0, frame.width, frame.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, targets.aux.framebuffer);
        gl.disable(gl.BLEND);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        this.programs.current = main;
        gl.useProgram(main);
        targets.auxKey.store();
      }
    }
    gl.activeTexture(gl.TEXTURE15);
    gl.bindTexture(gl.TEXTURE_2D, aux && targets.aux ? targets.aux.texture : this.emptyUint());
    this.params.int('uAux', 15);
    this.params.int('uHasAux', aux ? 1 : 0);
  }

  private readonly quad = [0, 0, 0, 0];
  /** One height layer of the map pass: the base opaque, a detail cross-faded over it. Returns true while it fades. */
  private drawLayer(layer: GlHeightLayer, base: boolean, frame: RedrawFrame, now: number): boolean {
    const gl = this.gl,
      p = this.params;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, layer.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, layer.cave ?? this.empty);
    writeFieldParams(p, layer, base);
    let fading = false;
    if (base) {
      p.float('uAlpha', 1);
      gl.disable(gl.BLEND);
      p.vec4('uQuad', 0, 0, frame.width, frame.height);
    } else {
      const alpha = fadeProgress(now, layer.fadeStart);
      fading = alpha < 1;
      p.float('uAlpha', 1 - (1 - alpha) ** 2);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      const q = detailQuad(layer.layer, frame, this.quad);
      p.vec4('uQuad', q[0], q[1], q[2], q[3]);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return fading;
  }

  /** One redraw (passes in terrain/redraw.ts) of `this.view` into `framebuffer` (the canvas when null). */
  private draw(pixelRatio = displayPixelRatio(), stylePixelRatio = pixelRatio, framebuffer: WebGLFramebuffer | null = null): boolean {
    this.fallbackGround.invalidate(this.canvas);
    const gl = this.gl,
      look = this.look,
      state = this.view;
    if (this.disposed || !look || !state || !this.base || gl.isContextLost()) return false;
    // World tiles are full quality but never wait for a link (renderWorldTile checks the programs first).
    const quality = displayQualityUniform(!(this.capturing || this.tileRendering || framebuffer !== null || look.mesh3d === true));
    const program = this.terrainProgram(look, this.capturing || framebuffer !== null || look.mesh3d === true);
    if (!program) return false;
    this.programs.current = program;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    const started = performance.now();
    const dpr = pixelRatio,
      frame = redrawFrame(state, dpr);
    if (this.canvas.width !== frame.width || this.canvas.height !== frame.height) {
      this.canvas.width = frame.width;
      this.canvas.height = frame.height;
    }
    gl.viewport(0, 0, frame.width, frame.height);
    const palettes = lookPalettes(look),
      v = this.lookVariant(look),
      p = this.params;
    const params: LookParamsState = {
      look,
      quality,
      frame,
      stylePixelRatio,
      dpr,
      scale: state.view.scale,
      palettes,
      mode: lookMode(look),
      forest: v.forest,
      base: this.base.layer,
      refined: this.enhanced.at(-1),
      previousRefined: this.enhanced.at(-2),
      coastal: !!this.coastDistance,
      sea: this.seaSurface,
      lake: this.lake ? this.lakeMode : 0,
      lakeN: this.lakeN,
      overlay: !!this.overlay,
      city: this.retainedWater.city,
    };
    gl.useProgram(program);
    let animating = writeLookParams(p, params) < 1;
    const now = performance.now();
    const water: GlWaterPass = {
      gl,
      programs: this.programs,
      targets: this.targets,
      look,
      frame,
      stylePixelRatio,
      water: palettes.water,
      painted: paintedWaterLook(look) && !look.groundCapture,
      band: waterBand(look, this.seaSurface, palettes.water),
      waitPainted: this.capturing || look.mesh3d === true,
      empty: this.empty,
      lake: this.lake,
      lakeMode: this.lakeMode,
      lakeN: this.lakeN,
      overlay: this.overlay,
    };
    const rivers = { vao: this.riverVao, count: this.riverCount, regime: this.riverRegime };
    const separateWater = separateWaterLayer(look, v.forest);
    p.int('uWaterLayer', 10);
    p.int('uUseWaterLayer', 0);
    gl.activeTexture(gl.TEXTURE10);
    gl.bindTexture(gl.TEXTURE_2D, this.empty);
    if (separateWater) {
      const target = (this.targets.water = rgbaTarget(gl, frame.width, frame.height, this.targets.water));
      gl.activeTexture(gl.TEXTURE10);
      gl.bindTexture(gl.TEXTURE_2D, target.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.bindTexture(gl.TEXTURE_2D, this.empty);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      writeWaterLayerParams(p);
      this.drawLayer(this.base, true, frame, now);
      renderRivers(water, rivers, target.framebuffer);
      renderRetainedWater(water, this.retainedWater, target.framebuffer);
      gl.useProgram(this.programs.current);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      writeMapParamsAfterWaterLayer(p, look, !!this.overlay);
      gl.activeTexture(gl.TEXTURE10);
      gl.bindTexture(gl.TEXTURE_2D, target.texture);
      p.int('uUseWaterLayer', 1);
    }
    this.renderAux(look, v, params, separateWater, framebuffer);
    this.drawLayer(this.base, true, frame, now);
    for (const detail of this.details) animating = this.drawLayer(detail, false, frame, now) || animating;
    this.details = dropHiddenDetails(this.details, now, this.release);
    if (!separateWater) {
      renderRivers(water, rivers, framebuffer);
      renderRetainedWater(water, this.retainedWater, framebuffer);
    }
    gl.disable(gl.BLEND);
    this.drawMs = performance.now() - started;
    if (animating) this.request();
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.unlistenQuality?.();
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.programs.dispose();
    this.loss.dispose();
    const gl = this.gl;
    if (this.emptyAux) gl.deleteTexture(this.emptyAux);
    this.release(this.base);
    this.details.forEach(this.release);
    this.enhanced.forEach(this.release);
    if (this.lake) gl.deleteTexture(this.lake);
    if (this.overlay) gl.deleteTexture(this.overlay);
    deleteForestTextures(gl, this.forest);
    if (this.occupation) gl.deleteTexture(this.occupation.texture);
    if (this.landDetail) gl.deleteTexture(this.landDetail.texture);
    this.forest = this.occupation = this.landDetail = undefined;
    disposeForestBrushes(gl);
    disposeCrownClumps(gl);
    gl.deleteBuffer(this.riverBuffer);
    gl.deleteVertexArray(this.riverVao);
    if (this.coastDistance) gl.deleteTexture(this.coastDistance);
    this.liveTargets.dispose(gl);
    this.tileTargets.dispose(gl);
    deleteTarget(gl, this.captureTarget);
  }
}
