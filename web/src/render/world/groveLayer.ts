import { GROVE_INSTANCE_GLSL, type GroveInstances } from '../city3d/groveInstances';
import type { LiveFrame, LiveLayerStats } from '../live/contract';
import { WORLD_BUILDING_FS } from './buildingsShader';
import { CAVE_DUSK, caveFogRange, type WorldCave } from './cave';
import { GroveBuffers } from './groveBuffers';
import { NIGHT_HAZE, VOLUME_HAZE, ViewVolume, hazeDistance, startVolumeProgram, uniformsOf, volumeDepth, volumeDepthEnd, volumeProgramLinked } from './volumes';
import { VIEW_DEPTH_MAX, getViewDepth } from './viewDepth';

const VS = `#version 300 es
precision highp float;
precision highp int;
${GROVE_INSTANCE_GLSL}
uniform mat4 uProjection;
uniform vec3 uBlock,uEye;
uniform float uRise,uExaggeration;
uniform bool uTop;
out vec3 n,base,facadePosition,grainPosition,houseUv,roofEdge;
out float vDistance;
flat out float materialClass,townGain,houseLayer,planGrainFade,flatCoverDirection;
flat out vec3 extra;
void main(){
  vec3 p=groveLocal(aPoint)+aSeat.xyz;
  float h=p.z-aSeat.w;
  float height=aSeat.w*uExaggeration+max(h,0.)+min(h,0.)*uExaggeration;
  vec3 world=vec3(uBlock.xy+p.xy,height*uRise+uBlock.z);
  n=groveNormal();base=groveColor();
  facadePosition=vec3(p.x,h,p.y);grainPosition=facadePosition;
  vDistance=length(world-uEye);
  materialClass=townGain=houseLayer=planGrainFade=flatCoverDirection=0.;
  houseUv=extra=vec3(0.);roofEdge=vec3(1.);
  gl_Position=uProjection*vec4(world,1.);
  if(uTop)gl_Position.z=clamp(-height*.00001,-.95,.95);
}`;

const UNIFORMS = ['uProjection', 'uBlock', 'uEye', 'uRise', 'uExaggeration', 'uTop', 'uAir', 'uHaze', 'uNight', 'uCave'] as const;

export class WorldGroveLayer {
  private readonly buffers: GroveBuffers;
  private readonly volume = new ViewVolume();
  private readonly fog: [number, number] = [0, 1];
  private program?: WebGLProgram;
  private u?: ReturnType<typeof uniformsOf<(typeof UNIFORMS)[number]>>;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.buffers = new GroveBuffers(gl);
  }

  get bytes(): number {
    return this.buffers.bytes;
  }

  releaseTown(): void {
    this.buffers.set(undefined);
  }

  ready(src: GroveInstances): boolean {
    return !!this.u && this.buffers.matches(src) && !this.buffers.pending;
  }

  work(src: GroveInstances, deadline: number): boolean {
    this.buffers.set(src);
    const gl = this.gl,
      program = (this.program ??= startVolumeProgram(gl, VS, WORLD_BUILDING_FS));
    this.buffers.step(deadline);
    if (!this.u && volumeProgramLinked(gl, program, 'Town grove')) this.u = uniformsOf(gl, program, UNIFORMS);
    return this.buffers.pending || !this.u;
  }

  /** False until the geometry in the current scene is ready to draw. */
  draw(src: GroveInstances, frame: LiveFrame, exaggeration: number, night: number, stats: LiveLayerStats, cave?: WorldCave): boolean {
    const gl = this.gl,
      u = this.u,
      camera = frame.camera;
    if (!u || !this.buffers.matches(src)) return false;
    const [tx, ty, tz] = camera.target,
      rise = camera.rise,
      flat = !camera.tilted;
    const depthSetting = getViewDepth(),
      focal = flat ? frame.view.scale : camera.focal / frame.dpr;
    const haze = cave ? CAVE_DUSK : night ? NIGHT_HAZE : VOLUME_HAZE;
    this.volume.set(camera);
    gl.useProgram(this.program!);
    volumeDepth(gl);
    gl.uniformMatrix4fv(u.uProjection, false, camera.targetViewProjection);
    gl.uniform3f(u.uEye, camera.eye[0] - tx, camera.eye[1] - ty, camera.eye[2] - tz);
    gl.uniform1f(u.uRise, rise);
    gl.uniform1f(u.uExaggeration, exaggeration);
    gl.uniform1i(u.uTop, flat ? 1 : 0);
    gl.uniform2f(u.uAir, hazeDistance(camera), rise);
    gl.uniform3f(u.uHaze, haze[0], haze[1], haze[2]);
    gl.uniform1i(u.uNight, night);
    if (cave) {
      const fog = caveFogRange(cave, camera, exaggeration, this.fog);
      gl.uniform4f(u.uCave, cave.lightsOn ? 1 : 2, cave.lightsOn ? 1.25 - 0.35 * cave.settings.darkness : 0.08, fog[0], fog[1]);
    } else gl.uniform4f(u.uCave, 0, 1, 1e9, 2e9);
    for (const entry of this.buffers.blocks) {
      const {
        bounds: [x0, y0, z0, x1, y1, z1],
        origin,
      } = entry.block;
      // The lowest seat in each 48 m group is exaggerated, and the geometry above it keeps its real height.
      const lo = Math.min(z0, z0 * exaggeration) * rise,
        hi = Math.max(z1, z1 * exaggeration) * rise;
      const x = (x0 + x1) / 2 - tx,
        y = (y0 + y1) / 2 - ty,
        z = (lo + hi) / 2 - tz;
      const radius = Math.hypot(x1 - x0, y1 - y0, hi - lo) / 2;
      if (!this.volume.sees(x, y, z, radius)) continue;
      const depth = this.volume.depth(x, y, z);
      if (!flat && depthSetting < VIEW_DEPTH_MAX && focal * depthSetting < Math.max(1, depth - radius) * 0.12) continue;
      gl.uniform3f(u.uBlock, origin[0] - tx, origin[1] - ty, -tz);
      stats.triangles += this.buffers.draw(entry);
      stats.drawCalls += entry.lobes ? 2 : 1;
    }
    gl.bindVertexArray(null);
    volumeDepthEnd(gl);
    return !this.buffers.pending;
  }

  clear(lost = false): void {
    this.buffers.drop(lost);
    if (this.program && !lost) this.gl.deleteProgram(this.program);
    this.program = this.u = undefined;
  }
}
