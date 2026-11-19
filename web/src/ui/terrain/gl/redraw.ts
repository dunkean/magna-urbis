/**
 * One WebGL2 ground redraw (passes listed in terrain/redraw.ts) for a request: the live view, a world tile or a
 * capture each pass their own look, view, layers, targets and destination; nothing of the renderer is swapped.
 * Owns the live view's intermediate targets, the empty auxiliary texture and the glUniform* bindings of the look's
 * parameter block (terrain/lookParams.ts). Built by TerrainGl for each context (again after a restore).
 */
import { displayQualityUniform } from '../../../render/displayQuality';
import { setSeasonCalendarGl } from '../../../../../rust/bridge/terrainRenderV2Zones';
import { bindForestBrushes } from '../../../render/forestBrushAtlas';
import { bindCrownClumps, crownClumpMode } from '../../../render/crownClumpAtlas';
import { bindTreeSymbols } from '../../../render/treeSymbols';
import { dropHiddenDetails } from '../layers';
import { hasAuxPass, lookVariant, variantKey, type TerrainVariant } from '../variant';
import { detailQuad, fadeProgress, lookPalettes, paintedWaterLook, redrawFrame, separateWaterLayer, waterBand, type RedrawFrame, type ViewState } from '../redraw';
import { writeFieldParams, writeLookParams, writeMapParamsAfterWaterLayer, writeWaterLayerParams, type LookBindings, type LookParamsState, type LookTexture } from '../lookParams';
import { GlViewTargets, emptyUintTexture, rgbaTarget, uintTarget, type GlHeightLayer } from './resources';
import { renderRetainedWater, renderRivers, type GlWaterPass } from './passes';
import { bindForest, bindLandDetail } from './forest';
import type { GlPrograms } from './programs';
import type { GlInputs } from './inputs';
import type { TerrainLook } from '../contract';

/** What one draw draws, and where. */
export interface GlDrawRequest {
  look: TerrainLook;
  view: ViewState;
  details: GlHeightLayer[];
  enhanced: GlHeightLayer[];
  /** Framebuffer pixel ratio, and the ratio of the CSS-pixel strokes (uDpr). */
  pixelRatio: number;
  stylePixelRatio: number;
  /** The canvas when null. */
  framebuffer: WebGLFramebuffer | null;
  targets: GlViewTargets;
  /** redrawForCapture: the look's own programs, linked now. */
  capturing: boolean;
  /** A live world tile: display quality, never a blocking link. */
  tile: boolean;
}

export interface GlRedrawHooks {
  /** Every draw changes the canvas: the fallback presentation of the previous frame is stale. */
  canvasDrawn(): void;
  alive(): boolean;
  /** A layer is still fading in: draw again next frame. */
  animate(): void;
  /** A cast-shadow bake for a new light azimuth has landed in the shore ring (one function, registered once). */
  shoreRingBaked: () => void;
}

export class GlRedraw {
  /** Intermediate targets of the live view (world tiles keep theirs, GlWorldTiles). */
  readonly liveTargets = new GlViewTargets();
  /** Last frame's GPU submission time, ms (CPU side). */
  drawMs = 0;
  private emptyAux?: WebGLTexture;
  private readonly params: LookBindings;
  /** The request being drawn (the look bindings read its refinements and look). */
  private request?: GlDrawRequest;
  private readonly quad = [0, 0, 0, 0];

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly canvas: HTMLCanvasElement,
    private readonly programs: GlPrograms,
    private readonly inputs: GlInputs,
    private readonly hooks: GlRedrawHooks,
  ) {
    this.params = this.paramBindings();
  }

  lookVariant(look: TerrainLook): TerrainVariant {
    return lookVariant(look, !!this.inputs.forest);
  }
  /** The look's variant once linked; meanwhile the last drawn variant, or the preview, stands in
   * (undefined if none is linked yet). Captures wait for the link. */
  private terrainProgram(look: TerrainLook, wait: boolean, capturing: boolean): WebGLProgram | undefined {
    const v = this.lookVariant(look),
      target = this.programs.map(v, wait);
    // Automated shots (v7 sheets) wait for data-map-variant-ready="1": until then a stand-in variant draws another look.
    const canvas = this.gl.canvas;
    if (typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement) {
      const aux = !hasAuxPass(v) || !!this.programs.aux(v, wait);
      canvas.dataset.mapVariant = variantKey(v);
      canvas.dataset.mapVariantReady = target && aux ? '1' : '0';
    }
    if (target && !capturing) this.programs.prewarm(this.hooks.alive);
    return this.programs.orStandIn(target);
  }

  /** glUniform* writes of the look block on the current program; textures on their units (lookParams.ts). */
  private paramBindings(): LookBindings {
    const gl = this.gl,
      inputs = this.inputs,
      u = (name: string): WebGLUniformLocation | null => this.programs.uniform(name);
    const textureOf = (texture: LookTexture): WebGLTexture => {
      const empty = inputs.empty;
      switch (texture) {
        case 'refined':
          return this.request!.enhanced.at(-1)?.texture ?? empty;
        case 'previousRefined':
          return this.request!.enhanced.at(-2)?.texture ?? empty;
        case 'coast':
          return inputs.coastDistance ?? empty;
        case 'lake':
          return inputs.lake ?? empty;
        case 'overlay':
          return inputs.overlay ?? empty;
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
      forest: enabled => bindForest(gl, u, inputs.forest, inputs.occupation, inputs.empty, enabled, 7, 8, 12, 13),
      landDetail: () => bindLandDetail(gl, u, inputs.landDetail, inputs.empty),
      // Texture 14: baked shore ring and relief light (CPU, shared with the 3D view), only for the natural looks.
      shoreRing: mode => {
        if (mode >= 2) inputs.updateShoreRing(this.request!.look.lighting.azimuth, this.hooks.shoreRingBaked);
        const ring = inputs.shoreRing;
        gl.activeTexture(gl.TEXTURE14);
        gl.bindTexture(gl.TEXTURE_2D, ring?.texture ?? inputs.empty);
        gl.uniform1i(u('uShoreRing'), 14);
        gl.uniform3f(u('uShoreRingRect'), ring?.x ?? 0, ring?.y ?? 0, ring?.width ?? 1);
      },
      landBackdrop: on => {
        const backdrop = on ? inputs.landBackdrop : undefined;
        gl.uniform1i(u('uHasLandBackdrop'), backdrop ? 1 : 0);
        if (!backdrop) return;
        gl.activeTexture(gl.TEXTURE14);
        gl.bindTexture(gl.TEXTURE_2D, backdrop);
        gl.uniform1i(u('uShoreRing'), 14);
      },
      brushes: (enabled, crownDetail, treeSymbols) => {
        // The paper map's tree symbols (mode 0) take the unit of the brushes and clumps (mode 3).
        if (treeSymbols) {
          gl.uniform1i(u('uCrownClumps'), 0);
          bindTreeSymbols(gl, u, treeSymbols, 9);
          return;
        }
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

  /** Auxiliary pass of the look into the request's aux target, over the base layer, skipped when its inputs did not
   * change; the map program then reads it on unit 15 (uHasAux 0 while the pass is still linking). */
  private renderAux(req: GlDrawRequest, v: TerrainVariant, state: LookParamsState, separateWater: boolean, wait: boolean): void {
    const gl = this.gl,
      inputs = this.inputs,
      base = inputs.base!,
      { look, targets, framebuffer } = req,
      { frame, quality } = state;
    if (!hasAuxPass(v)) return;
    const main = this.programs.current,
      aux = this.programs.aux(v, wait);
    if (aux) {
      const key = targets.auxKey.scratch();
      key.length = 0;
      key.push(quality, frame.width, frame.height, frame.origin, frame.px, look.seed, look.climate, look.lighting, look.v2Season, look.v2Calendar, look.layers, look.refinement3d, look.mesh3d, look.style, look.waterLook);
      key.push(inputs.forestVersion, inputs.riverCount, inputs.retainedWater.key, inputs.lakeN, separateWater, base.layer.width, base.layer.n, req.enhanced.at(-1)?.fadeStart, inputs.coastDistance ? 1 : 0);
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
        gl.bindTexture(gl.TEXTURE_2D, base.cave ?? inputs.empty);
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

  /** One height layer of the map pass: the base opaque, a detail cross-faded over it. Returns true while it fades. */
  private drawLayer(layer: GlHeightLayer, base: boolean, frame: RedrawFrame, now: number): boolean {
    const gl = this.gl,
      p = this.params;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, layer.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, layer.cave ?? this.inputs.empty);
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

  /** Draws `req`; false when nothing could be drawn (no base, lost context, no program linked yet). */
  draw(req: GlDrawRequest): boolean {
    if (req.capturing) req = { ...req, look: { ...req.look, displayLight: false } };
    this.hooks.canvasDrawn();
    const gl = this.gl,
      inputs = this.inputs,
      { look, framebuffer } = req,
      base = inputs.base;
    if (!this.hooks.alive() || !base || gl.isContextLost()) return false;
    const exact = req.capturing || framebuffer !== null || look.mesh3d === true,
      wait = req.capturing || framebuffer !== null || look.mesh3d === true;
    // Live world tiles follow display quality; only captures force full. Tiles never wait for a link.
    const quality = displayQualityUniform(!exact);
    const program = this.terrainProgram(look, wait, req.capturing);
    if (!program) return false;
    this.programs.current = program;
    this.request = req;
    try {
      return this.drawWith(req, program, quality, base, wait);
    } finally {
      this.request = undefined;
    }
  }
  private drawWith(req: GlDrawRequest, program: WebGLProgram, quality: number, base: GlHeightLayer, wait: boolean): boolean {
    const gl = this.gl,
      inputs = this.inputs,
      { look, framebuffer, targets } = req;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    const started = performance.now();
    const dpr = req.pixelRatio,
      frame = redrawFrame(req.view, dpr);
    if (this.canvas.width !== frame.width || this.canvas.height !== frame.height) {
      this.canvas.width = frame.width;
      this.canvas.height = frame.height;
    }
    gl.viewport(0, 0, frame.width, frame.height);
    const palettes = lookPalettes(look),
      v = this.lookVariant(look),
      p = this.params;
    const state: LookParamsState = {
      look,
      quality,
      frame,
      stylePixelRatio: req.stylePixelRatio,
      dpr,
      scale: req.view.view.scale,
      palettes,
      mode: v.mode,
      forest: v.forest,
      base: base.layer,
      refined: req.enhanced.at(-1),
      previousRefined: req.enhanced.at(-2),
      coastal: !!inputs.coastDistance,
      sea: inputs.seaSurface,
      lake: inputs.lake ? inputs.lakeMode : 0,
      lakeN: inputs.lakeN,
      overlay: !!inputs.overlay,
      city: inputs.retainedWater.city,
    };
    gl.useProgram(program);
    let animating = writeLookParams(p, state) < 1;
    const now = performance.now();
    const water: GlWaterPass = {
      gl,
      programs: this.programs,
      targets,
      look,
      frame,
      stylePixelRatio: req.stylePixelRatio,
      water: palettes.water,
      painted: quality === 0 && paintedWaterLook(look) && !look.groundCapture,
      band: waterBand(look, inputs.seaSurface, palettes.water),
      waitPainted: req.capturing || look.mesh3d === true,
      empty: inputs.empty,
      lake: inputs.lake,
      lakeMode: inputs.lakeMode,
      lakeN: inputs.lakeN,
      overlay: inputs.overlay,
    };
    const rivers = { vao: inputs.riverVao, count: inputs.riverCount, regime: inputs.riverRegime };
    const separateWater = quality === 0 && separateWaterLayer(look, v.forest);
    p.int('uWaterLayer', 10);
    p.int('uUseWaterLayer', 0);
    gl.activeTexture(gl.TEXTURE10);
    gl.bindTexture(gl.TEXTURE_2D, inputs.empty);
    if (separateWater) {
      const target = (targets.water = rgbaTarget(gl, frame.width, frame.height, targets.water));
      gl.activeTexture(gl.TEXTURE10);
      gl.bindTexture(gl.TEXTURE_2D, target.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.bindTexture(gl.TEXTURE_2D, inputs.empty);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      writeWaterLayerParams(p);
      this.drawLayer(base, true, frame, now);
      renderRivers(water, rivers, target.framebuffer);
      renderRetainedWater(water, inputs.retainedWater, target.framebuffer);
      gl.useProgram(this.programs.current);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      writeMapParamsAfterWaterLayer(p, look, !!inputs.overlay);
      gl.activeTexture(gl.TEXTURE10);
      gl.bindTexture(gl.TEXTURE_2D, target.texture);
      p.int('uUseWaterLayer', 1);
    }
    this.renderAux(req, v, state, separateWater, wait);
    this.drawLayer(base, true, frame, now);
    for (const detail of req.details) animating = this.drawLayer(detail, false, frame, now) || animating;
    // The live view's details: a detail fully faded in hides (and releases) the older ones.
    if (req.details === inputs.details) inputs.details = dropHiddenDetails(inputs.details, now, inputs.release);
    if (!separateWater) {
      renderRivers(water, rivers, framebuffer);
      renderRetainedWater(water, inputs.retainedWater, framebuffer);
    }
    gl.disable(gl.BLEND);
    this.drawMs = performance.now() - started;
    if (animating) this.hooks.animate();
    return true;
  }

  dispose(): void {
    if (this.emptyAux) this.gl.deleteTexture(this.emptyAux);
    this.liveTargets.dispose(this.gl);
  }
}
