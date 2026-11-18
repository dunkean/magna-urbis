/**
 * The vector rasterizer of the exact outputs: one shared private canvas (an OffscreenCanvas with its own WebGL2
 * context, 4x MSAA) that replays a recorded list and hands back an ImageBitmap. Called through the engine policy
 * (vectorEngine.ts) by the cartography's raster tiles, captures, the 3D drape and the progressive fallback display.
 * Each `rasterize` resizes the canvas to the list, clears it and presents; the error flags follow SampledErrorRead.
 */
import { GpuRasterError, IDENTITY, type DisplayList, type GpuRasterizer, type ImageSource, type Mat } from './displayList';
import { SampledErrorRead } from './glErrors';
import { ListReplayer } from './replay';
import { REPLAY_TOLERANCE } from './resources';

const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|basic render|microsoft warp|software/i;
type Surface = HTMLCanvasElement | OffscreenCanvas;

class TileRasterizer extends ListReplayer implements GpuRasterizer {
  readonly renderer: string;
  readonly software: boolean;
  private contextLost = false;
  private errors = new SampledErrorRead();
  private onLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
  };
  constructor(
    private canvas: Surface,
    gl: WebGL2RenderingContext,
  ) {
    super(gl, REPLAY_TOLERANCE);
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    this.renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    this.software = SOFTWARE_GL.test(this.renderer);
    canvas.addEventListener('webglcontextlost', this.onLost);
  }
  override get lost(): boolean {
    return this.contextLost || super.lost;
  }
  /** The private canvas owns its whole context: nothing foreign to reset. */
  protected resetForeignState(): void {}
  rasterize(list: DisplayList, options?: { post?: Mat }): ImageBitmap {
    if (this.lost) throw new GpuRasterError('Vector WebGL2 context lost or disposed', true);
    const canvas = this.canvas;
    if (!('transferToImageBitmap' in canvas)) throw new GpuRasterError('ImageBitmap rasterization requires OffscreenCanvas');
    this.render(list, options?.post ?? IDENTITY);
    try {
      return canvas.transferToImageBitmap();
    } catch (error) {
      throw new GpuRasterError(`Vector bitmap: ${String(error)}`, this.lost);
    }
  }
  invalidateImage(source: ImageSource): void {
    this.resources.invalidateImage(source);
  }
  override dispose(): void {
    if (this.disposed) return;
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    super.dispose();
  }
  /** Replays `list` on the whole canvas, resized to the list and cleared first. */
  private render(list: DisplayList, post: Mat): void {
    if (this.lost) throw new GpuRasterError('Vector WebGL2 context lost or disposed', true);
    const gl = this.gl,
      start = performance.now(),
      width = list.width,
      height = list.height;
    this.stats = { drawCalls: 0, triangles: 0, ms: 0, clips: 0, ops: 0, synced: false };
    try {
      if (!(width > 0 && height > 0)) throw new GpuRasterError('Vector target must have positive dimensions');
      const canvas = this.canvas;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      this.width = width;
      this.height = height;
      this.resources.epoch++;
      this.setup(null);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      if (list.unsupported) throw new GpuRasterError(`Unsupported vector list: ${list.unsupported}`);
      gl.disable(gl.SCISSOR_TEST);
      this.replayList(list, post);
      if (this.lost) throw new GpuRasterError('Vector WebGL2 context lost during replay', true);
      this.stats.synced = this.errors.check(gl, start, this.lost);
    } catch (error) {
      if (error instanceof GpuRasterError) throw error;
      throw new GpuRasterError(`Vector replay: ${String(error)}`, this.lost);
    } finally {
      gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(true, true, true, true);
      gl.stencilMask(0xff);
      gl.bindVertexArray(null);
      this.stats.ms = performance.now() - start;
    }
  }
}

export function createGpuRasterizer(canvas?: Surface): GpuRasterizer | null {
  let surface = canvas;
  let gl: WebGL2RenderingContext | null;
  try {
    surface ??= typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : typeof document !== 'undefined' ? document.createElement('canvas') : undefined;
    if (!surface) return null;
    gl = surface.getContext('webgl2', { antialias: true, stencil: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false, depth: false }) as WebGL2RenderingContext | null;
  } catch {
    return null;
  }
  if (!surface || !gl || !gl.getContextAttributes()?.stencil) return null;
  return new TileRasterizer(surface, gl);
}

let shared: GpuRasterizer | null = null,
  attempted = false;
/** The one tile rasterizer of the page, recreated after a context loss. */
export function sharedGpuRasterizer(): GpuRasterizer | null {
  if (shared?.lost) {
    shared.dispose();
    shared = null;
    attempted = false;
  }
  if (!attempted) {
    shared = createGpuRasterizer();
    attempted = true;
  }
  return shared;
}
