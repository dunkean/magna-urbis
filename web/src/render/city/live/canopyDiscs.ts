/**
 * The town canopy of the live town layer: instanced discs on the GPU, drawn over the roofs.
 *
 * Owns its program and its buffers; built and driven by townLayer.ts (program link and uploads from `work`, one draw
 * per pass in a frame). Which discs a crown is and which passes paint them are the look's (render/city/canopyLook.ts).
 */
import type { LiveFrame, LiveLayerStats } from '../../live/contract';
import type { CityCanopy } from '../../cityGrove';
import { canopyDiscs, canopyPasses, type CanopyDiscSet } from '../canopyLook';
import { finishProgram, programLinked, startProgram, type PendingProgram, type Program } from '../gl/programs';

// One instance (x, y, r) per crown or lobe, grown by uGrow metres (stroke rims), antialiased over uPad metres (a
// device pixel), premultiplied colour.
const DISC_VS = `#version 300 es
layout(location = 0) in vec3 aDisc;
uniform mat3 uM;
uniform float uGrow, uPad;
out vec2 vLocal;
flat out float vR;
void main() {
  float r = aDisc.z + uGrow;
  vR = r;
  vLocal = (vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0) * (r + uPad);
  vec3 p = uM * vec3(aDisc.xy + vLocal, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
}`;
const DISC_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
flat in float vR;
uniform float uPad;
uniform vec4 uColor;
out vec4 outColor;
void main() {
  float a = clamp(0.5 - (length(vLocal) - vR) / uPad, 0.0, 1.0);
  if (a <= 0.0) discard;
  outColor = uColor * a;
}`;
/** Premultiplied RGBA of '#rrggbb' or 'rgba(r,g,b,a)', times `alpha`. */
function premul(css: string, alpha = 1): [number, number, number, number] {
  const m = /rgba?\((\d+)\D+(\d+)\D+(\d+)(?:\D+([\d.]+))?/.exec(css),
    v = m ? 0 : parseInt(css.slice(1, 7), 16) || 0;
  const rgb = m ? [+m[1], +m[2], +m[3]] : [(v >> 16) & 255, (v >> 8) & 255, v & 255],
    a = (m?.[4] === undefined ? 1 : +m[4]) * alpha;
  return [(rgb[0] / 255) * a, (rgb[1] / 255) * a, (rgb[2] / 255) * a, a];
}

export class CanopyDiscs {
  private program: Program | undefined;
  private pending: PendingProgram | undefined;
  private sets: Record<CanopyDiscSet, { vbo: WebGLBuffer; vao: WebGLVertexArrayObject; count: number }> | undefined;
  /** The canopies the discs were built from (identity per town). */
  private source: readonly CityCanopy[] | undefined;
  private size = 0;
  constructor(private readonly gl: WebGL2RenderingContext) {}
  get linked(): boolean {
    return !!this.program;
  }
  get bytes(): number {
    return this.size;
  }
  /** Issues the program's link, or finishes it once linked (`parallel`: polled; else at once). */
  link(parallel: boolean): void {
    if (this.program) return;
    this.pending ??= startProgram(this.gl, DISC_VS, DISC_FS);
    if (programLinked(this.gl, this.pending, parallel)) {
      this.program = finishProgram(this.gl, this.pending);
      this.pending = undefined;
    }
  }
  /** Uploads the discs when the towns' canopies changed; true when it did. */
  set(list: readonly CityCanopy[]): boolean {
    const gl = this.gl;
    if (this.source && this.source.length === list.length && this.source.every((c, i) => c === list[i])) return false;
    this.deleteSets();
    this.source = list;
    if (!list.some(c => c.trees.length || c.dwellings.length)) return true;
    const discs = canopyDiscs(list),
      sets = {} as NonNullable<CanopyDiscs['sets']>;
    for (const name of Object.keys(discs) as CanopyDiscSet[]) {
      const data = new Float32Array(discs[name]),
        vbo = gl.createBuffer()!,
        vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(0, 1);
      sets[name] = { vbo, vao, count: data.length / 3 };
      this.size += data.byteLength;
    }
    gl.bindVertexArray(null);
    this.sets = sets;
    return true;
  }
  /** The look's passes over the discs. Translucent passes cover each sample once (stencil), as one Canvas fill of
   * their union. */
  draw(frame: LiveFrame, palette: string, mpp: number, stats: LiveLayerStats): void {
    const gl = this.gl,
      d = this.program,
      sets = this.sets;
    if (!sets || !d) return;
    gl.useProgram(d.program);
    gl.uniformMatrix3fv(d.u.uM, false, frame.worldToClip);
    gl.uniform1f(d.u.uPad, 1 / frame.worldToPixel[0]);
    gl.enable(gl.STENCIL_TEST);
    gl.stencilMask(0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
    for (const pass of canopyPasses(palette, mpp)) {
      const p = sets[pass.discs],
        c = premul(pass.color, pass.alpha);
      if (!p.count || !(c[3] > 0)) continue;
      gl.clearStencil(0);
      gl.clear(gl.STENCIL_BUFFER_BIT);
      gl.stencilFunc(gl.EQUAL, 0, 0xff);
      gl.uniform4f(d.u.uColor, c[0], c[1], c[2], c[3]);
      gl.uniform1f(d.u.uGrow, pass.growPx * mpp);
      gl.bindVertexArray(p.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, p.count);
      stats.drawCalls++;
      stats.triangles += 2 * p.count;
    }
    gl.disable(gl.STENCIL_TEST);
    gl.bindVertexArray(null);
  }
  private deleteSets(): void {
    if (this.sets)
      for (const p of Object.values(this.sets)) {
        this.gl.deleteBuffer(p.vbo);
        this.gl.deleteVertexArray(p.vao);
      }
    this.sets = undefined;
    this.size = 0;
  }
  /** Forgets everything; `deleteHandles` false when the context is lost (the handles are dead). */
  drop(deleteHandles: boolean): void {
    if (deleteHandles) {
      this.deleteSets();
      for (const p of [this.program, this.pending]) if (p) this.gl.deleteProgram(p.program);
    }
    this.sets = this.source = this.program = this.pending = undefined;
    this.size = 0;
  }
}
