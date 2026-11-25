/**
 * The street lamps of the towns in the map drape of a tilted night view: their pools of light on the ground, added
 * over the dark map once per baked tile. Placed as the top view places them (cityNight.ts nightLamps).
 *
 * Owns its program and its buffer; built and driven by townLayer.ts (link and upload from `work`, one instanced draw
 * per tile). A frame pays nothing: the drape tile it samples holds the light.
 */
import { nightLamps } from '../../cityNight';
import type { CityScene } from '../model/contract';
import type { DrapeCanvas } from '../../world/contract';
import { finishProgram, programLinked, startProgram, type PendingProgram, type Program } from '../gl/programs';

// One instance (x, y, reach m, strength) per lamp. A reach under uFloor is widened to it, the light of the lamp spread
// over the wider disc, so the far tiers keep a faint warm town instead of sparkling or burning out.
const LAMP_VS = `#version 300 es
layout(location = 0) in vec4 aLamp;
uniform vec4 uRect;
uniform float uFloor;
out vec2 vLocal;
flat out float vStrength;
void main() {
  float reach = max(aLamp.z, uFloor), spread = aLamp.z / reach;
  vLocal = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  vStrength = aLamp.w * min(1.0, 1.6 * spread * spread);
  vec2 at = (aLamp.xy + vLocal * reach - uRect.xy) / (uRect.zw - uRect.xy);
  gl_Position = vec4(at.x * 2.0 - 1.0, 1.0 - at.y * 2.0, 0.0, 1.0);
}`;
// The falloff of the top view's lamps. No alpha: the light adds to the ground under the drape.
const LAMP_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
flat in float vStrength;
out vec4 outColor;
void main() {
  float light = vStrength * pow(max(0.0, 1.0 - length(vLocal)), 1.6);
  outColor = vec4(vec3(1.0, 0.66, 0.27) * light, 0.0);
}`;

export class NightLamps {
  private program: Program | undefined;
  private pending: PendingProgram | undefined;
  private lamps: { vbo: WebGLBuffer; vao: WebGLVertexArrayObject; count: number } | undefined;
  private source: CityScene | undefined;
  constructor(private readonly gl: WebGL2RenderingContext) {}
  /** The lamps of this plan are ready to draw. */
  ready(plan: CityScene | undefined): boolean {
    return !!plan && this.source === plan;
  }
  /** One step of the link and the upload for a plan; true once its lamps are ready. */
  step(plan: CityScene, parallel: boolean): boolean {
    const gl = this.gl;
    if (!this.program) {
      this.pending ??= startProgram(gl, LAMP_VS, LAMP_FS);
      if (!programLinked(gl, this.pending, parallel)) return false;
      this.program = finishProgram(gl, this.pending);
      this.pending = undefined;
    }
    this.deleteLamps();
    this.source = plan;
    const data = nightLamps(plan);
    if (!data.length) return true;
    const vbo = gl.createBuffer()!,
      vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.bindVertexArray(null);
    this.lamps = { vbo, vao, count: data.length / 4 };
    return true;
  }
  /** The light of the lamps over a drape tile. */
  paint(tile: DrapeCanvas): void {
    const gl = this.gl,
      d = this.program,
      lamps = this.lamps;
    if (!d || !lamps || !tile.group()) return;
    gl.useProgram(d.program);
    gl.uniform4f(d.u.uRect, tile.rect.minX, tile.rect.minY, tile.rect.maxX, tile.rect.maxY);
    gl.uniform1f(d.u.uFloor, 5 / tile.scale);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(lamps.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, lamps.count);
    gl.bindVertexArray(null);
    tile.putGroup(1);
  }
  private deleteLamps(): void {
    if (this.lamps) {
      this.gl.deleteBuffer(this.lamps.vbo);
      this.gl.deleteVertexArray(this.lamps.vao);
    }
    this.lamps = this.source = undefined;
  }
  /** Forgets everything; `deleteHandles` false when the context is lost (the handles are dead). */
  drop(deleteHandles: boolean): void {
    if (deleteHandles) {
      this.deleteLamps();
      for (const p of [this.program, this.pending]) if (p) this.gl.deleteProgram(p.program);
    }
    this.lamps = this.source = this.program = this.pending = undefined;
  }
}
