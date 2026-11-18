/**
 * Volumes of the world view: what stands on the terrain of a tilted frame, the town's buildings (buildingsLayer.ts) and
 * the modelled trees (treesLayer.ts). This file holds what both share: the layer they are, how they fade in with the
 * relief, which world blocks a frame sees, and the program link.
 *
 * How a volume layer meets the compositor (render/live/contract.ts, owned by the world stream). It is a LiveLayer that
 * takes the camera (`tilts`), drawn after the ground and the draped layers and before the names, NOT isolated: it draws
 * straight into `frame.target` (the canvas), with depth test and depth writes against the depth the draped ground left
 * there in the same frame. In the top view it draws nothing and is ready, so the 2D map is unchanged.
 *
 * Cost by construction: everything a frame draws is in GPU buffers built in work slices (one per world block and level
 * of detail); a frame walks the blocks (a sphere test each), sets a few uniforms and issues one draw per visible block.
 * No upload, no allocation, no geometry in a frame.
 */
import type { LiveLayer } from '../live/contract';
import type { FrameCamera } from './contract';

/** The names the compositor gives the volume layers: in LIVE_LAYER_ORDER after 'city', before 'text'. */
export type VolumeLayerName = 'buildings' | 'trees';
/** A LiveLayer whose name is a volume layer's; assignable to LiveLayer once LiveLayerName includes these names. */
export interface VolumeLayer extends Omit<LiveLayer, 'name' | 'isolated' | 'tilts'> {
  readonly name: VolumeLayerName;
  readonly tilts: true;
}

/** Share of the volumes shown at a rise of the relief (FrameCamera.rise): they rise with it, from nothing in the top
 * view, so the top view and a hair of tilt look the same. Below the first step of the dither nothing is drawn. */
export const volumesShown = (camera: FrameCamera): number => (camera.tilted && camera.rise >= 1 / 32 ? camera.rise : 0);

/** Screen-door fade: a 4x4 ordered dither hides the pixels whose threshold is not under the share shown. Opaque
 * volumes need no sorting and keep writing depth; only the programs of a rising frame carry the discard. */
export const VOLUME_FADE_GLSL = `
bool volumeHidden(float shown){
  const float B[16]=float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
  ivec2 p=ivec2(gl_FragCoord.xy)&3;
  return (B[p.x+p.y*4]+.5)/16.>shown;
}`;

/** Light of the draped ground's slopes (drapedGround.ts): from the north-west, x east, y south, z up. */
export const VOLUME_LIGHT: readonly [number, number, number] = [-0.485, -0.485, 0.728];
/** Haze of the draped ground (drapedGround.ts): its colour, and its distance for a camera, as that file sets them. */
export const VOLUME_HAZE: readonly [number, number, number] = [0.77, 0.85, 0.88];
export const hazeDistance = (camera: FrameCamera): number => Math.max(2 * Math.hypot(camera.eye[0] - camera.target[0], camera.eye[1] - camera.target[1], camera.eye[2] - camera.target[2]), 100);

/** The six planes of a frame's view volume, for positions relative to the target (FrameCamera.targetViewProjection).
 * Refilled in place per frame. */
export class ViewVolume {
  private readonly planes = new Float64Array(24);
  private readonly m = new Float64Array(16);

  set(camera: FrameCamera): void {
    const m = this.m,
      p = this.planes;
    for (let i = 0; i < 16; i++) m[i] = camera.targetViewProjection[i];
    // Rows of the column-major matrix: clip = (r0, r1, r2, r3) . (x, y, z, 1); a plane is r3 +/- r0, r1, r2.
    for (let k = 0; k < 6; k++) {
      const row = k >> 1,
        sign = k & 1 ? -1 : 1;
      let a = m[3] + sign * m[row],
        b = m[7] + sign * m[4 + row],
        c = m[11] + sign * m[8 + row],
        d = m[15] + sign * m[12 + row];
      const length = Math.hypot(a, b, c) || 1;
      a /= length;
      b /= length;
      c /= length;
      d /= length;
      p[k * 4] = a;
      p[k * 4 + 1] = b;
      p[k * 4 + 2] = c;
      p[k * 4 + 3] = d;
    }
  }
  /** A sphere (centre relative to the target) is at least partly inside. */
  sees(x: number, y: number, z: number, radius: number): boolean {
    const p = this.planes;
    for (let k = 0; k < 24; k += 4) if (p[k] * x + p[k + 1] * y + p[k + 2] * z + p[k + 3] < -radius) return false;
    return true;
  }
  /** Depth of a point along the view axis (clip w). */
  depth(x: number, y: number, z: number): number {
    const m = this.m;
    return m[3] * x + m[7] * y + m[11] * z + m[15];
  }
}

export function linkVolumeProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string, label: string): WebGLProgram {
  const program = gl.createProgram()!;
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`${label} program: ${gl.getProgramInfoLog(program)}`);
  return program;
}

/** Uniform locations of a program by name. */
export function uniformsOf<N extends string>(gl: WebGL2RenderingContext, program: WebGLProgram, names: readonly N[]): Record<N, WebGLUniformLocation | null> {
  const out = {} as Record<N, WebGLUniformLocation | null>;
  for (const name of names) out[name] = gl.getUniformLocation(program, name);
  return out;
}
