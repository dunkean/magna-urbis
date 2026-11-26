/**
 * The replay core of the WebGL2 vector rasterizers (design: web/out/vector-gpu-2026-11-12/DESIGN.md section 2): the
 * ops of a recorded display list (displayList.ts) drawn into the framebuffer in force, in order.
 * - Fills: stencil-then-cover. Triangle fans write the winding into the stencil (INVERT for evenodd, INCR/DECR_WRAP for
 *   nonzero), a cover quad over the bounds paints where the stencil says inside and resets it.
 * - Strokes: segment, disc and join instances extruded in the vertex shader; a translucent stroke draws once per
 *   path through the stencil; sub-pixel strokes are modulated hairlines.
 * - Clips: bit 7 of the stencil holds the current clip chain.
 * - Composites: premultiplied source-over, destination-out, destination-in, multiply in two passes.
 *
 * Two subclasses own a context each and differ only in what this class leaves to them: tileRasterizer.ts (a private
 * canvas: exact tiles, captures, the 3D drape) and liveRasterizer.ts (the live compositor's context).
 */
import { GpuRasterError, IDENTITY, SPRITE_STRIDE, type ClipNode, type Composite, type DisplayList, type FillRule, type Mat, type Paint, type RecordedPath, type SpriteOp, type Stripe, type StrokeOp, type ReplayStats } from './contract';
import { DISC_STRIDE, JOIN_STRIDE, SEGMENT_STRIDE } from './tessellate';
import { compose, intersect, inverse, overlaps, scale, transformedBox, union, type Box } from './transforms';
import { GpuResources, type GeometryData, type Slice, type StrokeSlices, type ToleranceRule } from './resources';
import { Program } from './program';
import type { ProgramKind } from './shaders';

export const emptyStats = (): ReplayStats => ({ drawCalls: 0, triangles: 0, ms: 0, clips: 0, ops: 0, synced: false });

/**
 * A stripe seen from the device pixels of `m` (user -> device): across = gx X + gy Y + k in user units, k reduced modulo
 * the period in double precision (world coordinates far from the origin keep their phase in float32), and the pixel
 * footprint |g| in user units. Null when `m` cannot be inverted or the period is not positive.
 */
export function stripeOfDevice(s: Stripe, m: Mat): readonly [gx: number, gy: number, k: number, footprint: number] | null {
  const inv = inverse(m);
  if (!inv || !(s.period > 0)) return null;
  const gx = s.nx * inv[0] + s.ny * inv[1],
    gy = s.nx * inv[2] + s.ny * inv[3],
    k = s.nx * inv[4] + s.ny * inv[5] - s.offset;
  return [gx, gy, k - Math.floor(k / s.period) * s.period, Math.max(1e-9, Math.hypot(gx, gy))];
}

export abstract class ListReplayer {
  protected resources: GpuResources;
  protected programs = new Map<ProgramKind, Program>();
  protected vao: WebGLVertexArrayObject | null = null;
  protected disposed = false;
  protected width = 1;
  protected height = 1;
  protected stats: ReplayStats = emptyStats();
  /** Triangles of the last live replay by what drew them: fill and clip fans, stroke instances, sprites
   * (the rest of `stats.triangles` is cover quads). Tells which ops carry a heavy frame. */
  protected tally = { fan: 0, stroke: 0, sprite: 0, late: 0 };
  /** The program in use and scratch arrays for uniforms: no allocation and no redundant program switch per draw. */
  protected bound: Program | null = null;
  private mat3Scratch = new Float32Array(9);
  private dashScratch = new Float32Array(16);
  private clipBox: Box = [0, 0, 1, 1];
  private currentClip: ClipNode | null | undefined;
  private post: Mat = IDENTITY;
  /** Batch breaks per path list (see fills and strokes). */
  private fillRuns = new WeakMap<readonly RecordedPath[], Uint8Array>();
  private strokeRuns = new WeakMap<readonly RecordedPath[], Uint8Array>();

  constructor(
    protected gl: WebGL2RenderingContext,
    tolerance: ToleranceRule,
  ) {
    this.resources = new GpuResources(gl, tolerance);
  }

  get lost(): boolean {
    return this.disposed || this.gl.isContextLost();
  }
  bytes(): number {
    return this.resources.bytes();
  }
  lastStats(): ReplayStats {
    return { ...this.stats };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.bound = null;
    this.resources.dispose();
    for (const p of this.programs.values()) this.gl.deleteProgram(p.handle);
    this.programs.clear();
    this.gl.deleteVertexArray(this.vao);
    this.vao = null;
  }

  /** The fixed sheet has only baked quads left. Release the last clip and VAO bindings too. */
  releasePreparedLists(): void {
    this.resources.dispose();
    this.currentClip = undefined;
    this.fillRuns = new WeakMap();
    this.strokeRuns = new WeakMap();
    this.gl.deleteVertexArray(this.vao);
    this.vao = this.gl.createVertexArray();
  }

  /** State of the context this instance does not own that the winding stencil depends on (reset in `setup`). */
  protected abstract resetForeignState(): void;

  protected program(kind: ProgramKind): Program {
    let p = this.programs.get(kind);
    if (!p) {
      p = Program.link(this.gl, kind);
      this.programs.set(kind, p);
      this.resources.noteLate();
    }
    // A started program used before `warm` said it was ready (it should not be): wait for it here.
    else if (!p.ready) {
      p.settle(null);
      this.resources.noteLate();
    }
    // `bound` is forgotten at the start of every replay (another user of the context may have switched programs).
    if (this.bound !== p) {
      this.gl.useProgram(p.handle);
      this.bound = p;
    }
    if (p.viewW !== this.width || p.viewH !== this.height) {
      this.gl.uniform2f(p.u('uViewport'), this.width, this.height);
      p.viewW = this.width;
      p.viewH = this.height;
    }
    return p;
  }
  /** `m` as a column-major 3x3 in a scratch array (uniformMatrix3fv copies it at once). */
  protected mat3(m: Mat): Float32Array {
    const a = this.mat3Scratch;
    a[0] = m[0];
    a[1] = m[1];
    a[2] = 0;
    a[3] = m[2];
    a[4] = m[3];
    a[5] = 0;
    a[6] = m[4];
    a[7] = m[5];
    a[8] = 1;
    return a;
  }
  private matrices(p: Program, m: Mat): void {
    this.gl.uniformMatrix3fv(p.u('uMatrix'), false, this.mat3(m));
    this.gl.uniformMatrix3fv(p.u('uInverse'), false, this.mat3(inverse(m) ?? IDENTITY));
  }
  private paint(p: Program, paint: Paint, alpha: number, m: Mat): void {
    const gl = this.gl;
    gl.uniform1f(p.u('uAlpha'), alpha);
    gl.uniform1i(p.u('uPattern'), paint.kind === 'pattern' ? 1 : paint.kind === 'stripes' ? 2 : 0);
    if (paint.kind !== 'pattern') {
      const c = paint.rgba;
      gl.uniform4f(p.u('uColor'), c[0], c[1], c[2], c[3]);
      if (paint.kind === 'stripes') this.stripe(p, paint.stripe, m);
      return;
    }
    const inv = inverse(paint.transform);
    if (!inv) {
      gl.uniform1i(p.u('uPattern'), 0);
      gl.uniform4f(p.u('uColor'), 0, 0, 0, 0);
      return;
    }
    const rx = paint.repeat === 'repeat' || paint.repeat === 'repeat-x',
      ry = paint.repeat === 'repeat' || paint.repeat === 'repeat-y';
    const t = this.resources.texture(paint.source, paint.smoothing, rx, ry);
    if (!t) {
      gl.uniform1i(p.u('uPattern'), 0);
      gl.uniform4f(p.u('uColor'), 0, 0, 0, 0);
      return;
    }
    gl.uniform1i(p.u('uImage'), 0);
    gl.uniform2f(p.u('uImageSize'), t.width, t.height);
    gl.uniform2i(p.u('uRepeat'), rx ? 1 : 0, ry ? 1 : 0);
    gl.uniformMatrix3fv(p.u('uPatternInverse'), false, this.mat3(inv));
  }
  /** Two uniforms per stripe op (stripeOfDevice), nothing uploaded per frame; a degenerate stripe covers nothing. */
  private stripe(p: Program, s: Stripe, m: Mat): void {
    const gl = this.gl,
      d = stripeOfDevice(s, m);
    gl.uniform4f(p.u('uStripe'), d ? d[0] : 0, d ? d[1] : 0, d ? s.period : 1, d ? d[2] : 0.5);
    gl.uniform2f(p.u('uStripeLine'), d ? s.width / 2 : 0, d ? d[3] : 1);
  }
  private attributes(buffer: WebGLBuffer, start: number, stride: number, sizes: readonly number[]): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    let offset = start;
    for (let i = 0; i < 4; i++) {
      if (i < sizes.length) {
        gl.enableVertexAttribArray(i);
        gl.vertexAttribPointer(i, sizes[i], gl.FLOAT, false, stride * 4, offset);
        gl.vertexAttribDivisor(i, 1);
        offset += sizes[i] * 4;
      } else {
        gl.disableVertexAttribArray(i);
        gl.vertexAttribDivisor(i, 0);
      }
    }
  }
  private quad(box: Box, p: Program): void {
    const x0 = Math.max(0, Math.floor(box[0])),
      y0 = Math.max(0, Math.floor(box[1])),
      x1 = Math.min(this.width, Math.ceil(box[2])),
      y1 = Math.min(this.height, Math.ceil(box[3]));
    if (!(x1 > x0 && y1 > y0)) return;
    this.gl.uniform1i(p.u('uRectMode'), 0);
    this.gl.uniform4f(p.u('uBox'), x0, y0, x1, y1);
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
    this.stats.drawCalls++;
    this.stats.triangles += 2;
  }
  private get viewport(): Box {
    return [0, 0, this.width, this.height];
  }
  private reset(box: Box): void {
    const gl = this.gl,
      p = this.program('clear');
    gl.colorMask(false, false, false, false);
    gl.stencilMask(0x7f);
    gl.stencilFunc(gl.ALWAYS, 0, 0xff);
    gl.stencilOp(gl.ZERO, gl.ZERO, gl.ZERO);
    this.quad(box, p);
    gl.colorMask(true, true, true, true);
  }
  private windingState(rule: FillRule): void {
    const gl = this.gl;
    gl.colorMask(false, false, false, false);
    gl.stencilFunc(gl.EQUAL, 0x80, 0x80);
    gl.stencilMask(rule === 'evenodd' ? 1 : 0x7f);
    if (rule === 'evenodd') gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
    else {
      gl.stencilOpSeparate(gl.FRONT, gl.KEEP, gl.KEEP, gl.INCR_WRAP);
      gl.stencilOpSeparate(gl.BACK, gl.KEEP, gl.KEEP, gl.DECR_WRAP);
    }
  }
  private fan(entry: GeometryData, m: Mat): void {
    const slice = this.resources.fanOf(entry);
    if (!slice) return;
    this.fanSlice(slice, m, slice.floats);
  }
  private fanSlice(slice: Slice, m: Mat, floats: number): void {
    const gl = this.gl,
      p = this.program('fan');
    this.matrices(p, m);
    gl.bindBuffer(gl.ARRAY_BUFFER, slice.page.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, slice.offset);
    gl.vertexAttribDivisor(0, 0);
    for (let i = 1; i < 4; i++) {
      gl.disableVertexAttribArray(i);
      gl.vertexAttribDivisor(i, 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, floats / 2);
    this.stats.drawCalls++;
    this.stats.triangles += floats / 6;
    this.tally.fan += floats / 6;
  }
  private clip(node: ClipNode | null): void {
    if (node === this.currentClip) return;
    const gl = this.gl,
      chain: ClipNode[] = [];
    this.stats.clips++;
    // A clip pushed on the current one (save, clip) intersects in place; anything else rebuilds from the root.
    if (node && this.currentClip !== undefined && node.parent === this.currentClip) chain.push(node);
    else {
      gl.stencilMask(0xff);
      gl.clearStencil(0x80);
      gl.clear(gl.STENCIL_BUFFER_BIT);
      this.clipBox = this.viewport;
      for (let n = node; n; n = n.parent) chain.push(n);
      chain.reverse();
    }
    for (const n of chain) {
      const m = compose(this.post, n.transform),
        pathBox = intersect(transformedBox(n.path.bounds(), m, 1), this.viewport);
      this.windingState(n.rule);
      this.fan(this.resources.geometry(n.path, m, n.transform), m);
      const p = this.program('clear');
      // Compare against the old clip and zero winding; REPLACE uses the same reference 0x80,
      // so ZERO (equivalent to REPLACE ref 0) clears just bit 7 on matching samples. Bit 7 is only set inside clipBox.
      gl.stencilFunc(gl.EQUAL, 0x80, n.rule === 'evenodd' ? 0x81 : 0xff);
      gl.stencilMask(0x80);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.ZERO);
      this.quad(this.clipBox, p);
      // Winding was only written inside the old clip and the path bounds.
      this.reset(intersect(pathBox, this.clipBox));
      this.clipBox = intersect(this.clipBox, pathBox);
    }
    gl.colorMask(true, true, true, true);
    this.currentClip = node;
  }
  private blend(composite: Composite, pass = 0): void {
    const gl = this.gl;
    if (composite === 'multiply') {
      if (!pass) gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      else gl.blendFuncSeparate(gl.ONE_MINUS_DST_ALPHA, gl.ONE, gl.ONE_MINUS_DST_ALPHA, gl.ONE);
    } else if (composite === 'destination-out') gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    else if (composite === 'destination-in') gl.blendFunc(gl.ZERO, gl.SRC_ALPHA);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
  /** Cover a retained coverage stencil; both multiply passes see precisely the same samples. */
  private cover(box: Box, m: Mat, paint: Paint, alpha: number, composite: Composite, rule: FillRule | 'stroke'): void {
    const gl = this.gl,
      p = this.program('cover');
    this.matrices(p, m);
    this.paint(p, paint, alpha, m);
    gl.colorMask(true, true, true, true);
    gl.stencilMask(0);
    if (rule === 'stroke') gl.stencilFunc(gl.EQUAL, 0x81, 0xff);
    else gl.stencilFunc(gl.LESS, 0x80, rule === 'evenodd' ? 0x81 : 0xff);
    const finish = (): void => {
      gl.stencilMask(0x7f);
      gl.stencilOp(gl.ZERO, gl.ZERO, gl.ZERO);
    };
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    if (composite !== 'multiply' && composite !== 'destination-in') finish();
    this.blend(composite);
    this.quad(box, p);
    if (composite === 'multiply') {
      finish();
      this.blend(composite, 1);
      this.quad(box, p);
    }
    if (composite === 'destination-in') {
      // Canvas destination-in also clears the clipped destination outside source coverage.
      const clear = this.program('clear');
      gl.stencilFunc(gl.EQUAL, 0x80, rule === 'evenodd' ? 0x81 : 0xff);
      gl.blendFunc(gl.ZERO, gl.ZERO);
      this.quad(this.viewport, clear);
      this.reset(box);
    }
  }
  private fills(paths: readonly RecordedPath[], rule: FillRule, m: Mat, paint: Paint, alpha: number, composite: Composite, recorded: Mat = m): void {
    const pinned = this.resources.pinned;
    let run: RecordedPath[] = [],
      boxes: Box[] = [],
      box: Box = [Infinity, Infinity, -Infinity, -Infinity];
    const flush = (): void => {
      if (!run.length) return;
      this.windingState(rule);
      let first: Slice | null = null,
        floats = 0;
      const held: GeometryData[] = [];
      const draw = (): void => {
        if (first) this.fanSlice(first, m, floats);
        for (const entry of held) pinned.delete(entry);
        held.length = 0;
        first = null;
        floats = 0;
      };
      try {
        for (const path of run) {
          const entry = this.resources.geometry(path, m, recorded),
            slice = this.resources.fanOf(entry);
          if (!slice) continue;
          if (first && (first.page !== slice.page || first.offset + floats * 4 !== slice.offset)) draw();
          pinned.add(entry);
          held.push(entry);
          first ??= slice;
          floats += slice.floats;
          if (floats * 4 >= 4 * 1024 * 1024) draw();
        }
        draw();
      } finally {
        for (const entry of held) pinned.delete(entry);
      }
      this.cover(box, m, paint, alpha, composite, rule);
      run = [];
      boxes = [];
      box = [Infinity, Infinity, -Infinity, -Infinity];
    };
    // Run breaks depend only on which bounds overlap, invariant under the view (scale and translation): computed once per op.
    const known = this.fillRuns.get(paths),
      breaks = known ?? new Uint8Array(paths.length);
    for (let i = 0; i < paths.length; i++) {
      const b = transformedBox(paths[i].bounds(), m, 1);
      // destination-in affects the whole clip per path, even for disjoint or empty paths.
      if (!known && run.length && (composite === 'destination-in' || boxes.some(other => overlaps(other, b)))) breaks[i] = 1;
      if (breaks[i]) flush();
      run.push(paths[i]);
      if (!known) boxes.push(b);
      box = union(box, b);
    }
    if (!known) this.fillRuns.set(paths, breaks);
    flush();
  }
  private strokeInstances(meshes: readonly StrokeSlices[], op: StrokeOp, m: Mat, alpha: number, deviceWidth: number, hair = false): void {
    const gl = this.gl,
      p = this.program('stroke');
    this.matrices(p, m);
    this.paint(p, op.paint, alpha, m);
    gl.uniform1f(p.u('uWidth'), deviceWidth);
    gl.uniform1f(p.u('uMiterLimit'), op.miterLimit);
    gl.uniform1i(p.u('uCap'), hair || op.cap === 'butt' ? 0 : op.cap === 'round' ? 1 : 2);
    if (op.dash.length > 16) throw new GpuRasterError('GPU strokes support at most sixteen dash entries');
    const dash = this.dashScratch;
    let total = 0;
    for (let i = 0; i < 16; i++) {
      const v = i < op.dash.length ? op.dash[i] : 0;
      dash[i] = v;
      total += v;
    }
    gl.uniform1fv(p.u('uDash[0]'), dash);
    gl.uniform1i(p.u('uDashCount'), total > 0 ? op.dash.length : 0);
    gl.uniform1f(p.u('uDashTotal'), total);
    gl.uniform1f(p.u('uDashOffset'), op.dashOffset);
    // One instanced draw per run of contiguous arena slices (consecutive uploads usually are).
    const draw = (kind: 0 | 1 | 2, stride: number, sizes: readonly number[]): void => {
      let first: Slice | null = null,
        count = 0;
      const emit = (): void => {
        if (!first || !count) return;
        this.attributes(first.page.buffer, first.offset, stride, sizes);
        gl.uniform1i(p.u('uKind'), kind);
        gl.drawArraysInstanced(kind === 2 ? gl.TRIANGLES : gl.TRIANGLE_STRIP, 0, kind === 2 ? 6 : 4, count);
        this.stats.drawCalls++;
        this.stats.triangles += count * 2;
        this.tally.stroke += count * 2;
        first = null;
        count = 0;
      };
      for (const slices of meshes) {
        const slice = slices[kind];
        if (!slice) continue;
        const n = slice.floats / stride;
        if (first && first.page === slice.page && first.offset + count * stride * 4 === slice.offset) count += n;
        else {
          emit();
          first = slice;
          count = n;
        }
      }
      emit();
    };
    draw(0, SEGMENT_STRIDE, [4, 2]);
    if (hair) return; // hairlines have neither caps nor joins
    draw(1, DISC_STRIDE, [4]);
    draw(2, JOIN_STRIDE, [4, 4]);
  }
  private strokes(op: StrokeOp, m: Mat): void {
    const gl = this.gl,
      pinned = this.resources.pinned,
      s = scale(m),
      width = op.width * s;
    if (!(op.width > 0) || !(s > 0)) {
      if (op.composite === 'destination-in') this.cover([0, 0, 0, 0], m, op.paint, 0, op.composite, 'stroke');
      return;
    }
    // Sub-pixel strokes follow Skia's modulated hairlines (Chrome's Canvas): 1 px wide, alpha x width, every segment
    // blended on its own, so dense parallel lines (field strips) accumulate instead of drawing once per path.
    const hair = width < 1 && (op.composite === 'source-over' || op.composite === 'destination-out');
    const deviceWidth = hair ? 1 : Math.max(1, width),
      alpha = op.alpha * Math.min(1, width);
    const direct = hair || (op.composite === 'source-over' && op.paint.kind === 'color' && !op.paint.slot && op.paint.rgba[3] === 1 && alpha === 1 && op.dash.length === 0);
    const pad = (deviceWidth * Math.max(1, op.join === 'miter' ? op.miterLimit : 1)) / 2 + 1;
    // Paths with pairwise disjoint bounds stroke together (one draw per instance kind, one cover): the draw-once
    // stencil then matches per-path Canvas strokes. Opaque direct strokes always batch.
    let meshes: StrokeSlices[] = [],
      boxes: Box[] = [],
      box: Box = [Infinity, Infinity, -Infinity, -Infinity];
    // Entries of the pending run stay pinned: a later upload must not evict slices this run is about to draw.
    const held: GeometryData[] = [];
    const flush = (): void => {
      if (!meshes.length) return;
      gl.stencilFunc(gl.EQUAL, 0x80, direct ? 0x80 : 0xff);
      gl.stencilMask(direct ? 0 : 0x7f);
      gl.stencilOp(gl.KEEP, gl.KEEP, direct ? gl.KEEP : gl.INCR);
      gl.colorMask(direct, direct, direct, direct);
      this.blend(op.composite);
      this.strokeInstances(meshes, op, m, alpha, deviceWidth, hair);
      if (!direct) this.cover(box, m, op.paint, alpha, op.composite, 'stroke');
      meshes = [];
      boxes = [];
      box = [Infinity, Infinity, -Infinity, -Infinity];
      for (const entry of held) pinned.delete(entry);
      held.length = 0;
    };
    const known = direct ? undefined : this.strokeRuns.get(op.paths),
      breaks = !direct && !known ? new Uint8Array(op.paths.length) : undefined;
    const key = `${op.cap}/${op.join}`;
    let index = 0;
    try {
      for (const path of op.paths) {
        const entry = this.resources.geometry(path, m, op.transform);
        // Direct strokes draw each fragment as it arrives. They need neither a coverage rectangle
        // nor overlap checks. For stencil strokes only the first replay needs the individual boxes.
        if (!direct) {
          const b = transformedBox(entry.geometry.bbox, m, pad);
          if (known?.[index]) flush();
          else if (breaks && boxes.some(other => overlaps(other, b))) {
            breaks[index] = 1;
            flush();
          }
          if (breaks) boxes.push(b);
          box = union(box, b);
        }
        index++;
        const slices = this.resources.strokeSlices(entry, op, key);
        pinned.add(entry);
        held.push(entry);
        meshes.push(slices);
      }
      flush();
      if (breaks) this.strokeRuns.set(op.paths, breaks);
    } finally {
      for (const entry of held) pinned.delete(entry);
    }
  }
  private sprites(op: SpriteOp): void {
    if (!op.count) return;
    const gl = this.gl,
      p = this.program(op.landTint ? 'land' : op.tint ? 'pen' : op.contourTint ? 'contour' : 'sprite'),
      t = this.resources.texture(op.source, op.smoothing);
    if (!t) return;
    // World instance buffers survive a new recording transform. Ordinary image batches already include that transform.
    gl.bindBuffer(gl.ARRAY_BUFFER, this.resources.spriteBuffer(op));
    gl.uniform1i(p.u('uImage'), 0);
    gl.uniform2f(p.u('uImageSize'), t.width, t.height);
    gl.uniformMatrix3fv(p.u('uPost'), false, this.mat3(op.transform ? compose(this.post, op.transform) : this.post));
    gl.uniform1i(p.u('uFull'), op.composite === 'destination-in' ? 1 : 0);
    if (op.landTint) {
      const { heights, maxHeight, tint, snow } = op.landTint;
      this.resources.texture(heights, true, false, false, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(p.u('uHeight'), 1);
      gl.uniform1f(p.u('uMaxH'), maxHeight);
      gl.uniform4f(p.u('uLandTint'), ...tint);
      gl.uniform4f(p.u('uLandSnow'), ...snow);
    } else if (op.tint) {
      gl.uniform4fv(p.u('uInk'), op.tint[0].rgba);
      gl.uniform4fv(p.u('uWash'), op.tint[1].rgba);
    } else if (op.contourTint) {
      const [r, g, b, a] = op.contourTint.rgba;
      gl.uniform4f(p.u('uContourTint'), r, g, b, a);
    }
    const bind = (first: number): void => {
      const sizes = [4, 4, 4, 3];
      let offset = first * SPRITE_STRIDE * 4;
      for (let i = 0; i < 4; i++) {
        gl.enableVertexAttribArray(i);
        gl.vertexAttribPointer(i, sizes[i], gl.FLOAT, false, SPRITE_STRIDE * 4, offset);
        gl.vertexAttribDivisor(i, 1);
        offset += sizes[i] * 4;
      }
    };
    const draw = (count: number): void => {
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      this.stats.drawCalls++;
      this.stats.triangles += count * 2;
      this.tally.sprite += count * 2;
    };
    gl.colorMask(true, true, true, true);
    if (op.composite !== 'multiply') {
      gl.stencilMask(0);
      gl.stencilFunc(gl.EQUAL, 0x80, 0x80);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      this.blend(op.composite);
      bind(0);
      draw(op.count);
    } else {
      // Sequential instances preserve Canvas ordering when translucent sprites overlap.
      // Mark once in pass 1 and consume the marker in pass 2, without an extra coverage draw.
      for (let i = 0; i < op.count; i++) {
        bind(i);
        gl.stencilMask(0x7f);
        gl.stencilFunc(gl.EQUAL, 0x80, 0xff);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
        this.blend('multiply');
        draw(1);
        gl.stencilFunc(gl.EQUAL, 0x81, 0xff);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.DECR);
        this.blend('multiply', 1);
        draw(1);
      }
    }
  }
  private clear(x: number, y: number, w: number, h: number, m: Mat): void {
    const gl = this.gl,
      p = this.program('clear');
    this.matrices(p, m);
    gl.uniform1i(p.u('uRectMode'), 1);
    gl.uniform4f(p.u('uRect'), x, y, w, h);
    gl.stencilMask(0);
    gl.stencilFunc(gl.EQUAL, 0x80, 0x80);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    gl.colorMask(true, true, true, true);
    gl.blendFunc(gl.ZERO, gl.ZERO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.stats.drawCalls++;
    this.stats.triangles += 2;
  }
  /** The state every replay starts from, on `target` (null: the default framebuffer), with `width` x `height` already set. */
  protected setup(target: WebGLFramebuffer | null): void {
    const gl = this.gl;
    if (!this.vao) {
      this.vao = gl.createVertexArray();
      if (!this.vao) throw new GpuRasterError('Cannot allocate vector vertex array');
      this.resources.noteLate();
    }
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.enable(gl.STENCIL_TEST);
    gl.colorMask(true, true, true, true);
    gl.stencilMask(0xff);
    gl.clearColor(0, 0, 0, 0);
    gl.clearStencil(0x80);
    this.bound = null;
    this.resetForeignState();
  }
  /** The ops of one list under `post`, inside the scissor in force. */
  protected replayList(list: DisplayList, post: Mat, continuing = false): void {
    // Each part starts from the full clip (the stencil clear of the first clip change respects the scissor).
    this.post = post;
    if (!continuing) {
      this.currentClip = undefined;
      this.clipBox = this.viewport;
    }
    this.stats.ops += list.ops.length;
    for (const op of list.ops) {
      this.clip(op.clip);
      if (op.type === 'sprites') this.sprites(op);
      else {
        const m = compose(post, op.transform);
        if (op.type === 'clear') this.clear(op.x, op.y, op.w, op.h, m);
        else if (op.type === 'fill') this.fills(op.paths, op.rule, m, op.paint, op.alpha, op.composite, op.transform);
        else this.strokes(op, m);
      }
    }
  }
}
