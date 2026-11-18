/**
 * The far rasters of the satellite towns in the live town layer: each town's far raster (cityFarRaster.ts) as a
 * texture, drawn over the buildings with the look's fade.
 *
 * Owns its program, quad and textures; built and driven by townLayer.ts (program link, raster builds and uploads from
 * `work`, one quad per town in view in a frame).
 */
import type { LiveFrame, LiveLayerStats } from '../../live/contract';
import type { CityBuildings, CityPalette, CityScene } from '../model/contract';
import { farTownRaster, heldFarTownRaster, type FarRaster } from '../../cityFarRaster';
import { finishProgram, programLinked, startProgram, type PendingProgram, type Program } from '../gl/programs';

// The raster's world rectangle through the frame's world-to-clip matrix, premultiplied texels times the fade
// (drawFarTown: drawImage with globalAlpha over the buildings).
const FAR_VS = `#version 300 es
uniform mat3 uM;
uniform vec4 uRect;
out vec2 vUv;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vUv = c;
  vec3 p = uM * vec3(mix(uRect.xy, uRect.zw, c), 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
}`;
const FAR_FS = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
uniform float uAlpha;
in vec2 vUv;
out vec4 outColor;
void main() { outColor = texture(uTex, vUv) * uAlpha; }`;
interface FarTexture {
  raster: FarRaster;
  texture: WebGLTexture;
  rect: [number, number, number, number];
  bytes: number;
}
/** A town drawn as a far raster, with the whole town's buildings (the raster's key). */
interface FarTown {
  plan: CityScene;
  buildings: CityBuildings;
}

export class FarRasters {
  private program: Program | undefined;
  private pending: PendingProgram | undefined;
  private vao: WebGLVertexArrayObject | undefined;
  private readonly textures = new Map<CityBuildings, FarTexture>();
  private size = 0;
  /** Every far town has its raster on the GPU (for the current look). */
  ready = false;
  constructor(private readonly gl: WebGL2RenderingContext) {}
  get linked(): boolean {
    return !!this.program;
  }
  get bytes(): number {
    return this.size;
  }
  get count(): number {
    return this.textures.size;
  }
  /** Issues the program's link, or finishes it once linked (`parallel`: polled; else at once). */
  link(parallel: boolean): void {
    if (this.program) return;
    this.pending ??= startProgram(this.gl, FAR_VS, FAR_FS);
    if (programLinked(this.gl, this.pending, parallel)) {
      this.program = finishProgram(this.gl, this.pending);
      this.pending = undefined;
      this.vao = this.gl.createVertexArray()!;
    }
  }
  /** Uploads a town's far raster (finest level, mipmapped by the GPU) as premultiplied RGBA. */
  private upload(key: CityBuildings, raster: FarRaster): void {
    const gl = this.gl,
      old = this.textures.get(key),
      texture = old?.texture ?? gl.createTexture()!,
      image = raster.levels[0];
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image as TexImageSource);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    const size = Math.round((raster.w * raster.h * 4 * 4) / 3);
    this.size += size - (old?.bytes ?? 0);
    this.textures.set(key, { raster, texture, bytes: size, rect: [raster.x0, raster.y0, raster.x0 + raster.w * raster.cell, raster.y0 + raster.h * raster.cell] });
  }
  /** One step: re-uploads a raster drawFarTown replaced, builds a missing one unless the view moves (a pass over the
   * town's buildings, as the first Canvas far frame does). True when it did something. */
  work(towns: readonly FarTown[], look: { palette: CityPalette; night: boolean; custom?: string }, moving: boolean): boolean {
    let missing = false;
    for (const town of towns) {
      if (!town.buildings.items.length) continue;
      const held = this.textures.get(town.buildings);
      let raster = heldFarTownRaster(town.buildings);
      if (!raster && !moving) raster = farTownRaster(town.plan, town.buildings, look);
      if (!raster) {
        missing = true;
        continue;
      }
      if (held?.raster !== raster) {
        this.upload(town.buildings, raster);
        return true;
      }
    }
    this.ready = !missing;
    return false;
  }
  /** The rasters in view (all of them for a warm-up) at `alpha`. */
  draw(frame: LiveFrame, alpha: number, warmup: boolean, stats: LiveLayerStats): void {
    const gl = this.gl,
      p = this.program;
    if (!(alpha > 0) || !p || !this.vao || !this.textures.size) return;
    const r = frame.rect;
    gl.useProgram(p.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniformMatrix3fv(p.u.uM, false, frame.worldToClip);
    gl.uniform1f(p.u.uAlpha, Math.min(1, alpha));
    gl.uniform1i(p.u.uTex, 0);
    for (const t of this.textures.values()) {
      const [x0, y0, x1, y1] = t.rect;
      if (!warmup && (x0 > r.maxX || x1 < r.minX || y0 > r.maxY || y1 < r.minY)) continue;
      gl.bindTexture(gl.TEXTURE_2D, t.texture);
      gl.uniform4f(p.u.uRect, x0, y0, x1, y1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      stats.drawCalls++;
      stats.triangles += 2;
    }
    gl.bindVertexArray(null);
  }
  /** Forgets everything; `deleteHandles` false when the context is lost (the handles are dead). */
  drop(deleteHandles: boolean): void {
    if (deleteHandles) {
      for (const t of this.textures.values()) this.gl.deleteTexture(t.texture);
      for (const p of [this.program, this.pending]) if (p) this.gl.deleteProgram(p.program);
      if (this.vao) this.gl.deleteVertexArray(this.vao);
    }
    this.textures.clear();
    this.program = this.pending = this.vao = undefined;
    this.ready = false;
    this.size = 0;
  }
}
