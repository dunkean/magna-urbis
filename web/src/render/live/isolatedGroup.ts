/**
 * The isolated group of the compositor: one multisampled target (RGBA8 + depth24/stencil8) at the size of the frame,
 * shared by the `isolated` layers (contract.ts). A layer draws into it, cleared and transparent; the compositor
 * resolves it into a texture and composites that over the frame with the layer's opacity.
 *
 * Whether the group is complete is a synchronous query (the page waits for the graphics process to drain its queue):
 * it is asked once per sample count, since completeness depends on the formats and the samples, not on the size.
 */
interface GroupTarget {
  /** Multisampled framebuffer the layer draws into. */
  readonly fbo: WebGLFramebuffer;
  /** Framebuffer of `texture`, the resolved colour. */
  readonly resolve: WebGLFramebuffer;
  readonly texture: WebGLTexture;
}
interface Group extends GroupTarget {
  color: WebGLRenderbuffer;
  depth: WebGLRenderbuffer;
  width: number;
  height: number;
  samples: number;
}

interface IsolatedGroup {
  /** The group at this size and sample count, allocated again when they changed. False: it cannot be made (isolated
   * layers then show their stand-in: drawn straight on the canvas their blending would be wrong). */
  ensure(width: number, height: number, samples: number): boolean;
  /** The target of the last successful `ensure`. */
  readonly target: GroupTarget | undefined;
  /** The group was found incomplete in this context. */
  readonly failed: boolean;
  /** Asks the completeness of these sample counts on a small group, once each, then frees it: at set-up, while the
   * graphics queue is still short, so that a frame never asks. */
  probe(sampleCounts: readonly number[]): void;
  drop(): void;
  /** Every handle is dead; the next context is asked again. */
  contextLost(): void;
}

export function createIsolatedGroup(gl: WebGL2RenderingContext): IsolatedGroup {
  let group: Group | undefined,
    failed = false;
  /** Sample counts whose group was found complete. */
  const checked = new Set<number>();
  const drop = (): void => {
    if (!group) return;
    gl.deleteFramebuffer(group.fbo);
    gl.deleteFramebuffer(group.resolve);
    gl.deleteRenderbuffer(group.color);
    gl.deleteRenderbuffer(group.depth);
    gl.deleteTexture(group.texture);
    group = undefined;
  };
  const ensure = (width: number, height: number, samples: number): boolean => {
    if (group && group.width === width && group.height === height && group.samples === samples) return true;
    if (failed) return false;
    drop();
    const fbo = gl.createFramebuffer(),
      resolve = gl.createFramebuffer(),
      color = gl.createRenderbuffer(),
      depth = gl.createRenderbuffer(),
      texture = gl.createTexture();
    if (!fbo || !resolve || !color || !depth || !texture) return false;
    gl.bindRenderbuffer(gl.RENDERBUFFER, color);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, width, height);
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH24_STENCIL8, width, height);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, depth);
    const known = checked.has(samples);
    let complete = known || gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, resolve);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    complete &&= known || gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    if (complete) checked.add(samples);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    group = { fbo, color, depth, resolve, texture, width, height, samples };
    if (!complete && !gl.isContextLost()) {
      console.warn('Live compositor: the isolated group is incomplete; isolated layers fall back to their stand-in.');
      drop();
      failed = true;
      return false;
    }
    return true;
  };
  return {
    ensure,
    get target() {
      return group;
    },
    get failed() {
      return failed;
    },
    probe(sampleCounts) {
      for (const samples of sampleCounts) if (!failed && !checked.has(samples)) ensure(4, 4, samples);
      drop();
    },
    drop,
    contextLost() {
      group = undefined;
      failed = false;
    },
  };
}
