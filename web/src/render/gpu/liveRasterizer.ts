/**
 * The vector rasterizer bound to the live compositor's WebGL2 context (render/live/contract.ts), used by the overlay
 * layer (render/live/overlayLayer.ts). It never resizes a canvas, never clears colour and never presents: it draws
 * into the framebuffer it is given and leaves its own state behind for the caller to restore (`resetLiveState`).
 *
 * The per-frame rule of the live layers holds here: `warm` and `prepare`, called from the layer's `work`, make every
 * program, buffer and texture a replay needs; `replayLive` creates nothing (what it still had to make is counted in
 * `liveTally().late`) and never reads the context (errors: IdleErrorRead). `bake` rasterizes the area prefix of a band
 * once into a mipmapped texture, drawn by later frames as one quad.
 */
import { GpuRasterError, IDENTITY, type BakedPrefix, type ClipNode, type DisplayList, type LiveBakeOptions, type LivePart, type LiveRasterizer, type Mat } from './contract';
import { IdleErrorRead } from './glErrors';
import { Program } from './program';
import { ListReplayer } from './replay';
import { RECORDED_TOLERANCE } from './resources';
import { SHADERS, type ProgramKind } from './shaders';
import { compose } from './transforms';

/** Texels of margin around a baked band, so linear filtering at the band seams reads real content. */
const BAKE_GUTTER = 2;
/** Largest side of a baked band texture, whatever the card allows. */
const BAKE_MAX_SIDE = 8192;

class LiveListRasterizer extends ListReplayer implements LiveRasterizer {
  /** Every program is linked and checked (`warm`). */
  private warmed = false;
  private parallel: { readonly COMPLETION_STATUS_KHR: number } | null | undefined;
  private errors = new IdleErrorRead();
  /** The multisampled scratch target of the bakes, the framebuffer that resolves it, the bytes baked. */
  private bakeFbo: WebGLFramebuffer | null = null;
  private bakeColor: WebGLRenderbuffer | null = null;
  private bakeStencil: WebGLRenderbuffer | null = null;
  private resolveFbo: WebGLFramebuffer | null = null;
  private bakeW = 0;
  private bakeH = 0;
  private bakeSamples = 0;
  private bakedBytes = 0;
  private bakeLimit = 0;
  private bakeMaxSamples = 0;
  /** Sample counts whose target was found complete (see bakeTarget). */
  private bakeChecked = new Set<number>();

  constructor(gl: WebGL2RenderingContext) {
    super(gl, RECORDED_TOLERANCE);
  }
  /** A shared context: state the private one never leaves its default, and that the winding stencil depends on. */
  protected resetForeignState(): void {
    const gl = this.gl;
    gl.frontFace(gl.CCW);
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    gl.disable(gl.POLYGON_OFFSET_FILL);
  }
  override bytes(): number {
    return super.bytes() + this.bakedBytes;
  }
  override dispose(): void {
    if (this.disposed) return;
    this.errors.cancel();
    this.releaseBakeScratch();
    this.gl.deleteFramebuffer(this.resolveFbo);
    this.resolveFbo = null;
    super.dispose();
  }
  liveTally(): { readonly fan: number; readonly stroke: number; readonly sprite: number; readonly late: number } {
    return this.tally;
  }
  warm(): boolean {
    if (this.warmed) return true;
    if (this.lost) return false;
    const gl = this.gl;
    if (!this.vao) {
      this.vao = gl.createVertexArray();
      if (!this.vao) throw new GpuRasterError('Cannot allocate vector vertex array');
    }
    if (this.parallel === undefined) this.parallel = gl.getExtension('KHR_parallel_shader_compile');
    let done = true;
    for (const kind of Object.keys(SHADERS) as ProgramKind[]) {
      if (kind === 'contour' || kind === 'pen') continue; // Prepared only for lists that contain the corresponding mask.
      let p = this.programs.get(kind);
      if (!p) {
        p = Program.start(gl, kind);
        this.programs.set(kind, p);
        // Without the extension the check waits for the link: one program per call.
        if (!this.parallel) {
          p.settle(null);
          return false;
        }
      }
      // With it, every program was started in the first call and compiles in the driver's threads; poll.
      if (!p.settle(this.parallel)) done = false;
    }
    this.warmed = done;
    return done;
  }
  /** Uploads what `list` needs (geometry, stroke instances, sprite instances, textures) without drawing, so the first
   * replay of a freshly recorded list, a frame, uploads nothing. `post` sets the flattening tolerance as the replay will. */
  prepare(list: DisplayList, post: Mat = IDENTITY): void {
    for (const _ of this.prepareSteps(list, post)) {
      /* Synchronous callers. */
    }
  }
  *prepareSteps(list: DisplayList, post: Mat = IDENTITY): Generator<void> {
    if (this.lost || list.unsupported) return;
    const resources = this.resources,
      clips = new Set<ClipNode>();
    for (const op of list.ops) {
      for (let n = op.clip; n && !clips.has(n); n = n.parent) {
        clips.add(n);
        const m = compose(post, n.transform);
        resources.fanOf(resources.geometry(n.path, m, n.transform));
        yield;
      }
      if (op.type === 'sprites') {
        const mask = op.tint ? 'pen' : op.contourTint ? 'contour' : undefined;
        if (mask && !this.programs.has(mask)) {
          const program = Program.start(this.gl, mask);
          program.settle(null);
          this.programs.set(mask, program);
          yield;
        }
        resources.texture(op.source, op.smoothing);
        resources.uploadSprites(op);
        yield;
        continue;
      }
      if (op.type === 'clear') continue;
      const m = compose(post, op.transform);
      if (op.type === 'fill') {
        for (const path of op.paths) {
          resources.fanOf(resources.geometry(path, m, op.transform));
          yield;
        }
        if (op.paint.kind === 'pattern') resources.texture(op.paint.source, op.paint.smoothing);
      } else {
        for (const path of op.paths) {
          resources.strokeSlices(resources.geometry(path, m, op.transform), op);
          yield;
        }
        if (op.paint.kind === 'pattern') resources.texture(op.paint.source, op.paint.smoothing);
      }
    }
  }
  get maxBakeSize(): number {
    if (!this.bakeLimit) this.bakeLimit = Math.max(1, Math.min(BAKE_MAX_SIDE, Number(this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE)) || 0, Number(this.gl.getParameter(this.gl.MAX_RENDERBUFFER_SIZE)) || 0));
    return this.bakeLimit;
  }
  releaseBakeScratch(): void {
    const gl = this.gl;
    gl.deleteFramebuffer(this.bakeFbo);
    gl.deleteRenderbuffer(this.bakeColor);
    gl.deleteRenderbuffer(this.bakeStencil);
    this.bakeFbo = null;
    this.bakeColor = this.bakeStencil = null;
    this.bakeW = this.bakeH = 0;
  }
  /** The multisampled scratch target, at least `w` x `h`, with `wanted` samples (as many as the context allows).
   * False when the context cannot make it. */
  private bakeTarget(w: number, h: number, wanted: number): boolean {
    const gl = this.gl;
    this.bakeMaxSamples ||= Number(gl.getParameter(gl.MAX_SAMPLES)) || 1;
    const samples = Math.max(1, Math.min(wanted, this.bakeMaxSamples));
    if (this.bakeFbo && this.bakeW >= w && this.bakeH >= h && this.bakeSamples === samples) return true;
    this.releaseBakeScratch();
    this.bakeSamples = samples;
    const fbo = gl.createFramebuffer(),
      color = gl.createRenderbuffer(),
      stencil = gl.createRenderbuffer();
    this.resolveFbo ??= gl.createFramebuffer();
    let complete = false;
    if (fbo && color && stencil && this.resolveFbo) {
      gl.bindRenderbuffer(gl.RENDERBUFFER, color);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h);
      gl.bindRenderbuffer(gl.RENDERBUFFER, stencil);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH24_STENCIL8, w, h);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, stencil);
      // A synchronous query: the page waits until the graphics process has run everything queued before it (ground
      // tile bakes included), measured at 50 to 500 ms. Completeness depends on the formats and the sample count,
      // not on the size: asked once per sample count, never again when the target grows or alternates between the
      // moving and the rest sample counts.
      complete = this.bakeChecked.has(samples) || gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      if (complete) this.bakeChecked.add(samples);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    if (!complete) {
      gl.deleteFramebuffer(fbo);
      gl.deleteRenderbuffer(color);
      gl.deleteRenderbuffer(stencil);
      return false;
    }
    this.bakeFbo = fbo;
    this.bakeColor = color;
    this.bakeStencil = stencil;
    this.bakeW = w;
    this.bakeH = h;
    return true;
  }
  bake(list: DisplayList, density: number, options?: LiveBakeOptions): BakedPrefix | null {
    const steps = this.bakeSteps(list, density, options, false);
    let step = steps.next();
    while (!step.done) step = steps.next();
    return step.value;
  }
  *bakeSteps(list: DisplayList, density: number, options?: LiveBakeOptions, sliced = true): Generator<void, BakedPrefix | null> {
    if (this.lost || list.unsupported || !(density > 0)) return null;
    const gl = this.gl,
      g = BAKE_GUTTER,
      start = performance.now(),
      under = options?.under;
    const w = Math.ceil(list.width * density) + 2 * g,
      h = Math.ceil(list.height * density) + 2 * g;
    if (w > this.maxBakeSize || h > this.maxBakeSize || !this.bakeTarget(w, h, options?.samples ?? 4)) return null;
    this.stats = { drawCalls: 0, triangles: 0, ms: 0, clips: 0, ops: 0, synced: false };
    let texture: WebGLTexture | null = null;
    try {
      this.width = w;
      this.height = h;
      this.resources.epoch++;
      this.setup(this.bakeFbo);
      // The scratch target may be larger than this band: the scissor bounds every clear of the replay.
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, 0, w, h);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      const post: Mat = [density, 0, 0, density, g, g];
      // An earlier bake of the same band under the ops (texel on texel when the densities are equal).
      if (under) this.drawBaked(under, post);
      if (options?.between) {
        options.between(this.bakeFbo!, w, h, post);
        // The ink uses its own retained rasterizer in this context. Restore ours without clearing the colour.
        this.setup(this.bakeFbo);
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(0, 0, w, h);
      }
      // Colour samples stay in the same target between slices. Resolving intermediate textures would change
      // antialiasing where translucent operations overlap. Restore GL state after every yield (shared context).
      if (!sliced) this.replayList(list, post);
      else {
        let continuing = false;
        for (const op of list.ops) {
          this.width = w;
          this.height = h;
          this.setup(this.bakeFbo);
          gl.enable(gl.SCISSOR_TEST);
          gl.scissor(0, 0, w, h);
          this.replayList({ ...list, ops: [op] }, post, continuing);
          continuing = true;
          yield;
        }
      }
      texture = gl.createTexture();
      if (!texture) throw new GpuRasterError('Cannot allocate the baked vector texture');
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(w, h))) + 1, gl.RGBA8, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.resolveFbo);
      gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.bakeFbo);
      // The resolve obeys the scissor test and the colour mask.
      gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(true, true, true, true);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
      gl.generateMipmap(gl.TEXTURE_2D);
      const bytes = Math.ceil((w * h * 4 * 4) / 3);
      this.bakedBytes += bytes;
      return { texture, width: w, height: h, box: [-g / density, -g / density, (w - g) / density, (h - g) / density], bytes };
    } catch (error) {
      if (texture) gl.deleteTexture(texture);
      if (error instanceof GpuRasterError) throw error;
      throw new GpuRasterError(`Vector bake: ${String(error)}`, this.lost);
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(true, true, true, true);
      gl.stencilMask(0xff);
      gl.bindVertexArray(null);
      this.stats.ms = performance.now() - start;
    }
  }
  releaseBaked(baked: BakedPrefix): void {
    this.bakedBytes = Math.max(0, this.bakedBytes - baked.bytes);
    if (!this.lost) this.gl.deleteTexture(baked.texture);
  }
  /** A baked texture as one quad: uBox is its rectangle in recorded pixels, `post` the replay matrix of its band. */
  private drawBaked(baked: BakedPrefix, post: Mat): void {
    const gl = this.gl,
      p = this.program('baked');
    gl.uniformMatrix3fv(p.u('uMatrix'), false, this.mat3(post));
    gl.uniform4f(p.u('uBox'), baked.box[0], baked.box[1], baked.box[2], baked.box[3]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, baked.texture);
    gl.uniform1i(p.u('uImage'), 0);
    gl.colorMask(true, true, true, true);
    gl.stencilMask(0);
    gl.stencilFunc(gl.ALWAYS, 0, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.stats.drawCalls++;
    this.stats.triangles += 2;
  }
  replayLive(parts: readonly LivePart[], target: WebGLFramebuffer | null, width: number, height: number): void {
    if (this.lost) throw new GpuRasterError('Vector WebGL2 context lost or disposed', true);
    const gl = this.gl,
      start = performance.now(),
      stats = this.stats,
      tally = this.tally,
      resources = this.resources;
    stats.drawCalls = stats.triangles = stats.ms = stats.clips = stats.ops = 0;
    stats.synced = false;
    tally.fan = tally.stroke = tally.sprite = tally.late = 0;
    resources.late = 0;
    resources.counting = true;
    try {
      this.errors.throwFound(this.lost);
      if (!(width > 0 && height > 0)) throw new GpuRasterError('Vector target must have positive dimensions');
      this.width = width;
      this.height = height;
      resources.epoch++;
      this.setup(target);
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i],
          scissor = part.scissor;
        const x0 = Math.max(0, Math.round(scissor[0])),
          y0 = Math.max(0, Math.round(scissor[1]));
        const x1 = Math.min(width, Math.round(scissor[2])),
          y1 = Math.min(height, Math.round(scissor[3]));
        if (!(x1 > x0 && y1 > y0)) continue;
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(x0, height - y1, x1 - x0, y1 - y0);
        if (part.baked) this.drawBaked(part.baked, part.post);
        this.replayList(part.list, part.post);
      }
      // Never read in a frame: the flags of the shared context wait for the idle timer.
      this.errors.schedule(gl, () => this.lost);
    } catch (error) {
      if (error instanceof GpuRasterError) throw error;
      throw new GpuRasterError(`Vector replay: ${String(error)}`, this.lost);
    } finally {
      gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(true, true, true, true);
      gl.stencilMask(0xff);
      gl.bindVertexArray(null);
      resources.counting = false;
      tally.late = resources.late;
      stats.ms = performance.now() - start;
    }
  }
  dropContext(): void {
    this.errors.cancel();
    this.warmed = false;
    this.bakeChecked.clear();
    // Every handle died with the context: forget them without a GL call.
    this.resources.drop();
    this.programs.clear();
    this.bound = null;
    this.vao = null;
    this.bakeFbo = this.resolveFbo = null;
    this.bakeColor = this.bakeStencil = null;
    this.bakeW = this.bakeH = 0;
    this.bakedBytes = 0;
  }
}

/** A rasterizer for the live compositor's context. Null when the context cannot be used. */
export function createLiveRasterizer(gl: WebGL2RenderingContext): LiveRasterizer | null {
  try {
    return gl.isContextLost() ? null : new LiveListRasterizer(gl);
  } catch {
    return null;
  }
}
