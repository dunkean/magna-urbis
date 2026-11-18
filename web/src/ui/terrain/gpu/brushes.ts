/**
 * The brush binding of the WebGPU map program (render/forestBrushAtlas.ts and render/crownClumpAtlas.ts on WebGL2):
 * a 1×1 placeholder until a brush look first needs the full painted-brush array; without brushes, the optional crown
 * clumps take the same binding, uploaded on first use.
 */
import { unzlibSync } from 'fflate';
import atlas from '../../../render/assets/fantasy/forest-brushes.json';
import { CROWN_CLUMP_LAYERS, CROWN_CLUMP_SIZE, crownClumpLevels, crownClumpMode, type CrownDetail } from '../../../render/crownClumpAtlas';
import { boxMips } from '../../boxMips';
import { gpuArrayImage, releaseImage, type GpuImage } from './resources';

export class GpuBrushAtlas {
  private brushes: { image: GpuImage; full: boolean };
  private clumps?: GpuImage;
  constructor(private readonly device: GPUDevice) {
    this.brushes = { image: gpuArrayImage(device, 1, 1, 1, [new Uint8Array([255, 128])]), full: false };
  }
  /** The view of the binding before the look's brushes are known. */
  get placeholder(): GPUTextureView {
    return this.brushes.image.view;
  }
  /** uCrownClumps of the last bind(). */
  crownClumps = 0;
  /** The view to bind for the look (sets crownClumps). */
  bind(enabled: boolean, crownDetail: CrownDetail | undefined): GPUTextureView {
    if (enabled && !this.brushes.full) {
      const pixels = unzlibSync(Uint8Array.from(atob(atlas.zlib), c => c.charCodeAt(0)));
      const layers = atlas.families.length * atlas.variants,
        levels = boxMips(pixels, atlas.size, atlas.size, 2, layers);
      releaseImage(this.brushes.image);
      this.brushes = {
        image: gpuArrayImage(
          this.device,
          atlas.size,
          layers,
          levels.length,
          levels.map(l => l.data),
        ),
        full: true,
      };
    }
    const mode = (this.crownClumps = crownClumpMode(crownDetail, enabled));
    if (mode === 0) return this.brushes.image.view;
    const chain = crownClumpLevels();
    this.clumps ??= gpuArrayImage(this.device, CROWN_CLUMP_SIZE, CROWN_CLUMP_LAYERS, chain.length, chain, 'rgba8unorm');
    return this.clumps.view;
  }
  dispose(): void {
    releaseImage(this.brushes.image);
    releaseImage(this.clumps);
  }
}
