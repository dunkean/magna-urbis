/**
 * The inputs of a TerrainGl on its WebGL2 context: the height layers (base with its pyramid, regional details,
 * Render3D refinements), lake field, coast distance, overlay, forest field / occupation / holdings, the baked shore
 * ring, the river instances and the retained water. Owns their GL objects and the CPU inputs needed to replay them on
 * a restored context. Setters say what changed; the renderer bumps its content revision and redraws.
 */
import { riverInstances, RIVER_INSTANCE_FLOATS } from '../riverProfiles';
import { shoreRingPixels, shoreRingTexture } from '../../../../../rust/bridge/terrainForestBeach';
import type { ForestField, ForestOccupation, LandDetail } from '../../../../../rust/bridge/terrainForest';
import { lakeTextureData, seaDistanceSurface, type WaterSurface } from '../../../render/terrainWater';
import { mapGpuLight, mapTextureCap } from '../../glContextRecovery';
import { RetainedWaterSource } from '../retainedWater';
import { heightAt, pushLayer, SurfaceSamplerCache } from '../layers';
import type { InputChange } from '../revision';
import { glTexture, releaseHeightLayer, uploadHeightLayer, type GlHeightLayer } from './resources';
import { cappedForest, deleteForestTextures, forestTexture, forestTextures, glLandDetailUnit, OCCUPATION_PAD, occupationPatch, occupationWorldRects, patchForestTexture, type ForestTextures } from './forest';
import type { Rect4 } from '../../../render/view';
import { landBackdropTexture } from '../../../render/treeSymbols';
import type { HeightLayer, OverlayLayer, RetainedWaterOptions, SurfaceSample, TerrainLook, WaterLayer } from '../contract';

export class GlInputs {
  base?: GlHeightLayer;
  details: GlHeightLayer[] = [];
  enhanced: GlHeightLayer[] = [];
  lake?: WebGLTexture;
  lakeMode = 0;
  lakeN = 0;
  overlay?: WebGLTexture;
  coastDistance?: WebGLTexture;
  seaSurface?: WaterSurface;
  shoreRing?: { layer: object; revision: number; texture: WebGLTexture; x: number; y: number; width: number };
  /** Canonical Render3D forest field and applied occupation, sampled by world coordinates. */
  forest?: ForestTextures;
  occupation?: { data: ForestOccupation; texture: WebGLTexture };
  landDetail?: { data: LandDetail; texture: WebGLTexture };
  readonly riverBuffer: WebGLBuffer;
  readonly riverVao: WebGLVertexArrayObject;
  riverCount = 0;
  riverRegime = false;
  riverEstuaries = false;
  /** Parsed once; kept across a context restore (CPU only). */
  retainedWater = new RetainedWaterSource();
  /** Bumped by setForest: the auxiliary pass depends on the forest field and the applied occupation. */
  forestVersion = 0;
  /** The world boxes the last setForest changed (a local edit's occupation); undefined: the whole map. */
  forestRegion?: readonly Rect4[];
  readonly empty: WebGLTexture;
  private readonly surface = new SurfaceSamplerCache();
  private waterInput?: WaterLayer;
  private overlayInput?: OverlayLayer;
  /** The paper map's lit land and its upload (setLandBackdrop). */
  landBackdrop?: WebGLTexture;
  private landBackdropInput?: TexImageSource;
  private forestSource?: ForestField;
  private occupationSource?: ForestOccupation;
  private lakeInput?: Float32Array;
  private lakeWidth = 0;
  readonly release = (layer: GlHeightLayer | undefined): void => releaseHeightLayer(this.gl, layer);

  /** The river instance buffer and its layout, and the 1×1 empty texture. */
  constructor(private readonly gl: WebGL2RenderingContext) {
    this.riverBuffer = gl.createBuffer()!;
    this.riverVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.riverVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.riverBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 4 * RIVER_INSTANCE_FLOATS, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 4 * RIVER_INSTANCE_FLOATS, 16);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 4 * RIVER_INSTANCE_FLOATS, 24);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 4 * RIVER_INSTANCE_FLOATS, 36);
    gl.vertexAttribDivisor(3, 1);
    gl.bindVertexArray(null);
    this.empty = glTexture(gl, 1, 1, gl.R8, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(1), gl.NEAREST);
  }
  /** On a restored context: the CPU inputs of the lost one uploaded again (layers, water, overlay, forest); the parsed retained water is kept. */
  replay(lost: GlInputs, mapWidth: number | undefined): void {
    if (lost.base) this.setBase(lost.base.layer);
    for (const d of lost.details) this.setDetail(d.layer);
    for (const d of lost.enhanced) this.setEnhancedDetail(d.layer);
    this.setWater(lost.waterInput, mapWidth);
    this.setOverlay(lost.overlayInput);
    this.setLandBackdrop(lost.landBackdropInput);
    this.setForest(lost.forestSource, lost.occupationSource);
    this.retainedWater = lost.retainedWater;
  }
  upload(layer: HeightLayer, pyramid: boolean): GlHeightLayer {
    return uploadHeightLayer(this.gl, layer, pyramid);
  }

  /** The whole map's control grid; drops detail layers. */
  setBase(layer: HeightLayer): InputChange {
    const gl = this.gl;
    this.enhanced.forEach(this.release);
    this.enhanced = [];
    this.release(this.base);
    this.details.forEach(this.release);
    this.details = [];
    this.base = this.upload(layer, true);
    if (this.coastDistance) gl.deleteTexture(this.coastDistance);
    this.coastDistance = undefined;
    this.seaSurface = layer.waterSurface ?? seaDistanceSurface({ height: layer.data, resolution: layer.n, width: layer.width, x: layer.x, y: layer.y });
    if (!layer.cave?.length) {
      const surface = this.seaSurface;
      // Portable FP32 storage with explicit bilinear sampling; no 8-bit distance
      // quantization and no dependency on optional float linear filtering.
      this.coastDistance = glTexture(gl, surface.n, surface.n, gl.R32F, gl.RED, gl.FLOAT, surface.distance, gl.NEAREST);
    }
    return 'content';
  }
  /** A finer square region drawn over the base, cross-faded in; keeps at most two. */
  setDetail(layer: HeightLayer | undefined): InputChange {
    if (!layer) {
      this.details.forEach(this.release);
      this.details = [];
      return 'content';
    }
    const next = this.upload(layer, false);
    next.alpha = 0;
    next.fadeStart = performance.now();
    pushLayer(this.details, next, this.release);
    return 'content';
  }
  /** Explicit Render3D refinement only; ordinary 2D layers never consume it. */
  setEnhancedDetail(layer: HeightLayer | undefined): InputChange {
    if (!layer) {
      const had = this.enhanced.length > 0;
      this.enhanced.forEach(this.release);
      this.enhanced = [];
      return had ? 'content' : 'redraw';
    }
    if (this.enhanced.at(-1)?.layer === layer) return 'none';
    const next = this.upload(layer, false);
    next.fadeStart = performance.now();
    pushLayer(this.enhanced, next, this.release);
    return 'content';
  }
  setRetainedWater(svg: string | undefined, width: number, options?: RetainedWaterOptions): InputChange {
    return this.retainedWater.set(svg, width, options) ? 'content' : 'none';
  }
  /** `mapWidth`: the look's (lake distances are in its metres); the base's width without a look. */
  setWater(water: WaterLayer | undefined, mapWidth: number | undefined): InputChange {
    const gl = this.gl;
    this.waterInput = water;
    const width = mapWidth ?? this.base?.layer.width ?? 0;
    if (water?.lake !== this.lakeInput || (water?.lake && (this.lakeN !== water.n || this.lakeWidth !== width))) {
      if (this.lake) gl.deleteTexture(this.lake);
      this.lake = undefined;
      this.lakeInput = water?.lake;
      this.lakeWidth = width;
      if (water?.lake) {
        const values = lakeTextureData(water.lake, water.n, width);
        if (values) this.lake = glTexture(gl, water.n, water.n, gl.RG32F, gl.RG, gl.FLOAT, values, gl.NEAREST);
        this.lakeN = water.n;
      }
    }
    this.lakeMode = water?.shore === 'exact' ? 2 : 1;
    const rivers = riverInstances(water?.rivers ?? new Float32Array(), !!water?.regime);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.riverBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, rivers.byteLength ? rivers : new Float32Array(RIVER_INSTANCE_FLOATS), gl.STATIC_DRAW);
    this.riverCount = rivers.length / RIVER_INSTANCE_FLOATS;
    this.riverRegime = !!water?.regime;
    this.riverEstuaries = !!water?.estuaries;
    return 'content';
  }
  setOverlay(overlay: OverlayLayer | undefined): InputChange {
    const gl = this.gl;
    this.overlayInput = overlay;
    if (this.overlay) gl.deleteTexture(this.overlay);
    this.overlay = overlay ? glTexture(gl, overlay.n, overlay.n, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, overlay.rgba, gl.NEAREST) : undefined;
    return 'content';
  }
  /** The paper map's lit land (render/treeSymbols.ts), a whole-map image with mipmaps; undefined drops it. */
  setLandBackdrop(image: TexImageSource | undefined): InputChange {
    const gl = this.gl;
    if (image === this.landBackdropInput) return 'none';
    this.landBackdropInput = image;
    if (this.landBackdrop) gl.deleteTexture(this.landBackdrop);
    this.landBackdrop = image ? landBackdropTexture(gl, image) : undefined;
    return 'content';
  }
  /** Render3D forest: texture uploads only. `undefined` restores the macro canopy of the material exactly. */
  setForest(field: ForestField | undefined, occupation?: ForestOccupation): InputChange {
    const gl = this.gl,
      cap = mapTextureCap(gl.getParameter(gl.MAX_TEXTURE_SIZE));
    // A local edit's occupation (ForestOccupation.dirty) over the one on the GPU: only its changed texels go up, and
    // only the world tiles over them are baked again (forestRegion).
    let region: Rect4[] | undefined = field === this.forestSource ? [] : undefined;
    if (field !== this.forestSource) {
      deleteForestTextures(gl, this.forest);
      this.forestSource = field;
      // Light profile: no forest pass, so no forest upload. Low-end GPUs: the field and its banks at most `cap`.
      this.forest = field && !mapGpuLight() ? forestTextures(gl, cappedForest(field, cap)) : undefined;
    }
    if (occupation !== this.occupation?.data) {
      const patch = occupation && this.occupation && occupationPatch(this.occupation.data, occupation);
      this.occupationSource = occupation;
      if (patch && this.occupation && occupation) {
        if (patch.length) patchForestTexture(gl, this.occupation.texture, occupation, patch);
        this.occupation.data = occupation;
        region?.push(...occupationWorldRects(occupation, patch, OCCUPATION_PAD));
      } else {
        if (this.occupation) gl.deleteTexture(this.occupation.texture);
        this.occupation = occupation && { data: occupation, texture: forestTexture(gl, occupation, true) };
        region = undefined;
      }
    }
    // Holdings are optional detail: left out in the light profile and when larger than the cap (classes cannot be box-filtered).
    const detail = glLandDetailUnit(gl) === undefined || mapGpuLight() || (occupation?.detail?.n ?? 0) > cap ? undefined : occupation?.detail;
    if (detail !== this.landDetail?.data) {
      if (this.landDetail) gl.deleteTexture(this.landDetail.texture);
      this.landDetail = detail && { data: detail, texture: forestTexture(gl, detail, true) };
      region = undefined;
    }
    this.forestRegion = region;
    if (region && !region.length) return 'none';
    this.forestVersion++;
    return 'content';
  }
  /** The baked shore ring and relief light of the base (CPU, shared with the 3D view), uploaded again when a bake for
   * the light azimuth landed; `baked` runs when a later bake lands. */
  updateShoreRing(azimuth: number, baked: () => void): void {
    if (!this.base) return;
    const pixels = shoreRingPixels(this.base.layer, azimuth, baked);
    if (this.shoreRing?.layer !== this.base.layer || this.shoreRing.revision !== pixels.revision) {
      if (this.shoreRing) this.gl.deleteTexture(this.shoreRing.texture);
      const grid = pixels.grid;
      this.shoreRing = { layer: this.base.layer, revision: pixels.revision, texture: shoreRingTexture(this.gl, pixels), x: grid.x, y: grid.y, width: grid.width };
    }
  }

  createSurfaceSampler(look: TerrainLook): SurfaceSample | undefined {
    if (!this.base) return undefined;
    return this.surface.sampler(this.base.layer, this.details[this.details.length - 1]?.layer, look);
  }
  heightAt(x: number, y: number, floor: number): number | undefined {
    return heightAt(this.details, this.base, floor, x, y);
  }

  dispose(): void {
    const gl = this.gl;
    this.release(this.base);
    this.details.forEach(this.release);
    this.enhanced.forEach(this.release);
    if (this.lake) gl.deleteTexture(this.lake);
    if (this.overlay) gl.deleteTexture(this.overlay);
    if (this.landBackdrop) gl.deleteTexture(this.landBackdrop);
    deleteForestTextures(gl, this.forest);
    if (this.occupation) gl.deleteTexture(this.occupation.texture);
    if (this.landDetail) gl.deleteTexture(this.landDetail.texture);
    this.forest = this.occupation = this.landDetail = undefined;
    gl.deleteBuffer(this.riverBuffer);
    gl.deleteVertexArray(this.riverVao);
    if (this.coastDistance) gl.deleteTexture(this.coastDistance);
  }
}
