/**
 * The inputs of a TerrainGpu on its device: the height layers (base with its pyramid, regional details, Render3D
 * refinements), lake field, coast distance, overlay, forest field / occupation / holdings, the baked shore ring, the
 * river instances and the retained water. Owns their GPU images and the CPU inputs needed to rebuild them on a new
 * device or to hand them to the TerrainGl of a definitive loss (snapshot, replayInputs). Setters say what changed.
 */
import { riverInstances, RIVER_INSTANCE_FLOATS } from '../riverProfiles';
import { shoreRingPixels } from '../../../../../rust/bridge/terrainForestBeach';
import type { ForestField, ForestOccupation, LandDetail } from '../../../../../rust/bridge/terrainForest';
import { lakeDistances, seaDistanceSurface, type WaterSurface } from '../../../render/terrainWater';
import { mapGpuLight, mapTextureCap } from '../../glContextRecovery';
import { RetainedWaterSource } from '../retainedWater';
import { heightAt, pushLayer, SurfaceSamplerCache } from '../layers';
import { cappedForest } from '../gl/forest';
import { gpuImage, releaseGpuLayer, releaseImage, rgbaImage, uploadGpuLayer, type ForestImages, type GpuHeightLayer, type GpuImage } from './resources';
import type { InputChange } from '../revision';
import type { TerrainRenderer } from '../../terrainRenderer';
import type { ViewState } from '../redraw';
import type { HeightLayer, OverlayLayer, RetainedWaterOptions, SurfaceSample, TerrainLook, WaterLayer } from '../contract';

/** The CPU inputs of a renderer, replayed through the public setters. */
export interface RendererInputs {
  look?: TerrainLook;
  view?: ViewState;
  base?: HeightLayer;
  details: HeightLayer[];
  enhanced: HeightLayer[];
  retainedWater?: { svg: string; width: number; options?: RetainedWaterOptions };
  water?: WaterLayer;
  overlay?: OverlayLayer;
  landBackdrop?: HTMLCanvasElement;
  forest?: ForestField;
  occupation?: ForestOccupation;
}
/** Replays retained inputs through the public setters (look first: setWater reads its map width). */
export function replayInputs(target: TerrainRenderer, inputs: RendererInputs): void {
  if (inputs.look) target.setLook(inputs.look);
  if (inputs.base) target.setBase(inputs.base);
  for (const layer of inputs.details) target.setDetail(layer);
  for (const layer of inputs.enhanced) target.setEnhancedDetail(layer);
  target.setRetainedWater(inputs.retainedWater?.svg, inputs.retainedWater?.width, inputs.retainedWater?.options);
  target.setWater(inputs.water);
  target.setOverlay(inputs.overlay);
  target.setLandBackdrop(inputs.landBackdrop);
  target.setForest(inputs.forest, inputs.occupation);
  if (inputs.view) target.setView(inputs.view.view, inputs.view.width, inputs.view.height);
}

export class GpuInputs {
  base?: GpuHeightLayer;
  details: GpuHeightLayer[] = [];
  enhanced: GpuHeightLayer[] = [];
  lake?: GpuImage;
  lakeMode = 0;
  lakeN = 0;
  overlay?: GpuImage;
  coastDistance?: GpuImage;
  seaSurface?: WaterSurface;
  shoreRing?: { layer: object; revision: number; image: GpuImage; x: number; y: number; width: number };
  forest?: ForestImages;
  occupation?: { data: ForestOccupation; image: GpuImage };
  landDetail?: { data: LandDetail; image: GpuImage };
  riverBuffer?: GPUBuffer;
  riverCount = 0;
  riverRegime = false;
  readonly retainedWater = new RetainedWaterSource();
  /** Bumped by setForest: the auxiliary pass depends on the forest field and the applied occupation. */
  forestVersion = 0;
  readonly empty: GpuImage;
  private readonly surface = new SurfaceSamplerCache();
  private waterInput?: WaterLayer;
  private overlayInput?: OverlayLayer;
  /** The paper map's lit land (setLandBackdrop) and its upload. */
  landBackdrop?: GpuImage;
  private landBackdropInput?: HTMLCanvasElement;
  /** The forest field as given (the uploaded one may be capped, or absent in the light profile). */
  private forestSource?: ForestField;
  private lakeInput?: Float32Array;
  private lakeWidth = 0;

  constructor(private readonly device: GPUDevice) {
    this.empty = gpuImage(device, 1, 1, 'r8unorm', new Uint8Array(1), 1);
  }
  /** The CPU inputs (with the renderer's look and view). */
  snapshot(look: TerrainLook | undefined, view: ViewState | undefined): RendererInputs {
    return {
      look,
      view,
      base: this.base?.layer,
      details: this.details.map(d => d.layer),
      enhanced: this.enhanced.map(d => d.layer),
      retainedWater: this.retainedWater.input,
      water: this.waterInput,
      overlay: this.overlayInput,
      landBackdrop: this.landBackdropInput,
      forest: this.forestSource,
      occupation: this.occupation?.data,
    };
  }
  upload(layer: HeightLayer, pyramid: boolean): GpuHeightLayer {
    return uploadGpuLayer(this.device, layer, pyramid);
  }

  /** The whole map's control grid; drops detail layers. */
  setBase(layer: HeightLayer): InputChange {
    this.enhanced.forEach(releaseGpuLayer);
    this.enhanced = [];
    releaseGpuLayer(this.base);
    this.details.forEach(releaseGpuLayer);
    this.details = [];
    this.base = this.upload(layer, true);
    releaseImage(this.coastDistance);
    this.coastDistance = undefined;
    this.seaSurface = layer.waterSurface ?? seaDistanceSurface({ height: layer.data, resolution: layer.n, width: layer.width, x: layer.x, y: layer.y });
    if (!layer.cave?.length) {
      const surface = this.seaSurface;
      this.coastDistance = gpuImage(this.device, surface.n, surface.n, 'r32float', surface.distance, 4);
    }
    return 'content';
  }
  /** A finer square region drawn over the base, cross-faded in; keeps at most two. */
  setDetail(layer: HeightLayer | undefined): InputChange {
    if (!layer) {
      this.details.forEach(releaseGpuLayer);
      this.details = [];
      return 'content';
    }
    const next = this.upload(layer, false);
    next.alpha = 0;
    next.fadeStart = performance.now();
    pushLayer(this.details, next, releaseGpuLayer);
    return 'content';
  }
  /** Explicit Render3D refinement only; ordinary 2D layers never consume it. */
  setEnhancedDetail(layer: HeightLayer | undefined): InputChange {
    if (!layer) {
      const had = this.enhanced.length > 0;
      this.enhanced.forEach(releaseGpuLayer);
      this.enhanced = [];
      return had ? 'content' : 'redraw';
    }
    if (this.enhanced.at(-1)?.layer === layer) return 'none';
    const next = this.upload(layer, false);
    next.fadeStart = performance.now();
    pushLayer(this.enhanced, next, releaseGpuLayer);
    return 'content';
  }
  setRetainedWater(svg: string | undefined, width: number, options?: RetainedWaterOptions): InputChange {
    return this.retainedWater.set(svg, width, options) ? 'content' : 'none';
  }
  /** `mapWidth`: the look's (lake distances are in its metres); the base's width without a look. */
  setWater(water: WaterLayer | undefined, mapWidth: number | undefined): InputChange {
    this.waterInput = water;
    const width = mapWidth ?? this.base?.layer.width ?? 0;
    if (water?.lake !== this.lakeInput || (water?.lake && (this.lakeN !== water.n || this.lakeWidth !== width))) {
      releaseImage(this.lake);
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
        this.lake = gpuImage(this.device, water.n, water.n, 'rg32float', values, 8);
        this.lakeN = water.n;
      }
    }
    this.lakeMode = water?.shore === 'exact' ? 2 : 1;
    const rivers = riverInstances(water?.rivers ?? new Float32Array(), !!water?.regime);
    this.riverCount = rivers.length / RIVER_INSTANCE_FLOATS;
    this.riverRegime = !!water?.regime;
    if (rivers.byteLength) {
      if (!this.riverBuffer || this.riverBuffer.size < rivers.byteLength) {
        this.riverBuffer?.destroy();
        this.riverBuffer = this.device.createBuffer({ label: 'rivers', size: Math.ceil(rivers.byteLength / 4) * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      }
      this.device.queue.writeBuffer(this.riverBuffer, 0, rivers as Float32Array<ArrayBuffer>);
    }
    return 'content';
  }
  setOverlay(overlay: OverlayLayer | undefined): InputChange {
    this.overlayInput = overlay;
    releaseImage(this.overlay);
    this.overlay = overlay ? gpuImage(this.device, overlay.n, overlay.n, 'rgba8unorm', overlay.rgba, 4) : undefined;
    return 'content';
  }
  /** The paper map's lit land (render/treeSymbols.ts), a whole-map square image with mipmaps; undefined drops it. */
  setLandBackdrop(image: HTMLCanvasElement | undefined): InputChange {
    if (image === this.landBackdropInput) return 'none';
    this.landBackdropInput = image;
    releaseImage(this.landBackdrop);
    const pixels = image?.getContext('2d')?.getImageData(0, 0, image.width, image.height).data;
    this.landBackdrop = image && pixels ? rgbaImage(this.device, { n: image.width, rgba: new Uint8Array(pixels.buffer) }, true) : undefined;
    return 'content';
  }
  /** Render3D forest: texture uploads only. `undefined` restores the macro canopy of the material exactly. */
  setForest(field: ForestField | undefined, occupation?: ForestOccupation): InputChange {
    const device = this.device,
      cap = mapTextureCap(device.limits.maxTextureDimension2D);
    if (field !== this.forestSource) {
      this.releaseForest();
      this.forestSource = field;
      // Light profile: no forest pass, no upload. Low-end GPUs: field and banks at most `cap` (as on WebGL2).
      const shown = field && !mapGpuLight() ? cappedForest(field, cap) : undefined;
      this.forest = shown && {
        field: shown,
        texture: rgbaImage(device, shown, true),
        bank: shown.bank ? rgbaImage(device, { n: shown.n, rgba: shown.bank }, true) : undefined,
        beach: shown.beach ? gpuImage(device, shown.beach.n, shown.beach.n, 'r8unorm', shown.beach.data, 1) : undefined,
      };
    }
    if (occupation !== this.occupation?.data) {
      releaseImage(this.occupation?.image);
      this.occupation = occupation && { data: occupation, image: rgbaImage(device, occupation, true) };
    }
    const detail = mapGpuLight() || (occupation?.detail?.n ?? 0) > cap ? undefined : occupation?.detail;
    if (detail !== this.landDetail?.data) {
      releaseImage(this.landDetail?.image);
      this.landDetail = detail && { data: detail, image: rgbaImage(device, detail, true) };
    }
    this.forestVersion++;
    return 'content';
  }
  private releaseForest(): void {
    if (!this.forest) return;
    releaseImage(this.forest.texture);
    releaseImage(this.forest.bank);
    releaseImage(this.forest.beach);
    this.forest = undefined;
  }
  /** Shore ring and relief light (rgba16float: shore distance, openness, sky occlusion, horizon tangent toward the
   * light), uploaded again when a bake for the light azimuth landed; `baked` runs when a later bake lands. */
  updateShoreRing(azimuth: number, baked: () => void): void {
    if (!this.base) return;
    const pixels = shoreRingPixels(this.base.layer, azimuth, baked);
    if (this.shoreRing?.layer !== this.base.layer || this.shoreRing.revision !== pixels.revision) {
      releaseImage(this.shoreRing?.image);
      const grid = pixels.grid;
      this.shoreRing = { layer: this.base.layer, revision: pixels.revision, image: gpuImage(this.device, grid.n, grid.n, 'rgba16float', pixels.half, 8), x: grid.x, y: grid.y, width: grid.width };
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
    releaseGpuLayer(this.base);
    this.details.forEach(releaseGpuLayer);
    this.enhanced.forEach(releaseGpuLayer);
    for (const image of [this.lake, this.overlay, this.landBackdrop, this.coastDistance, this.shoreRing?.image, this.occupation?.image, this.landDetail?.image, this.empty]) releaseImage(image);
    this.releaseForest();
    this.riverBuffer?.destroy();
  }
}
