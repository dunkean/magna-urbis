/**
 * Volumes of the world view: what stands on the terrain of a tilted frame, the town's buildings (buildingsLayer.ts) and
 * the modelled trees (treesLayer.ts). This file holds what both share: the layer they are, how they rise with the
 * relief, which world blocks a frame sees, and the program link (started early, polled, never waited for).
 *
 * How a volume layer meets the compositor (render/live/contract.ts). It is a LiveLayer that
 * takes the camera (`tilts`), drawn after the ground and the draped layers and before the names, NOT isolated: it draws
 * straight into `frame.target` (the canvas), with depth test and depth writes against the depth the draped ground left
 * there in the same frame. In the top view it draws nothing and is ready, so the 2D map is unchanged.
 *
 * Cost by construction: everything a frame draws is in GPU buffers built in work slices (one per world block and level
 * of detail); a frame walks the blocks (a sphere test each), sets a few uniforms and issues draws for visible blocks or contiguous cells at one level.
 * No upload or geometry building in a frame.
 */
import type { LiveLayer } from '../live/contract';
import type { FrameCamera } from './contract';
import { getViewDepth } from './viewDepth';

/** The names the compositor gives the volume layers: in LIVE_LAYER_ORDER after 'city', before 'text'. 'cave' is the
 * Underdark's roof and mushrooms (caveLayer.ts). */
export type VolumeLayerName = 'buildings' | 'trees' | 'cave';
/** The compositor layer contract restricted to world volumes. */
export interface VolumeLayer extends Omit<LiveLayer, 'name' | 'isolated' | 'tilts'> {
  readonly name: VolumeLayerName;
  readonly tilts: true;
}

/** Volumes are drawn in every tilted frame and in no top view (the 2D town and the painted crowns show them there).
 * They are never faded: their heights rise with the relief (FrameCamera.rise), so at a pitch near 0, or in a turned
 * top view, they lie flat on the flat terrain as roofs and crowns seen from above, and grow as the camera tilts. */
export const volumesDrawn = (camera: FrameCamera): boolean => camera.tilted;

/** Depth state of a volume layer. LEQUAL and a pull towards the eye: at a rise near 0 a roof lies on the terrain and
 * on its own footing; equal depths go to what is drawn last (the roof after the walls and footings of its building,
 * the volumes after the terrain). */
export function volumeDepth(gl: WebGL2RenderingContext): void {
  gl.disable(gl.BLEND);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.depthMask(true);
  gl.disable(gl.CULL_FACE);
  gl.enable(gl.POLYGON_OFFSET_FILL);
  gl.polygonOffset(-1, -2);
}
/** Back to the shared state (render/live/contract.ts resetLiveState) for what volumeDepth changed. */
export function volumeDepthEnd(gl: WebGL2RenderingContext): void {
  gl.disable(gl.POLYGON_OFFSET_FILL);
  gl.depthFunc(gl.LESS);
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
}

/** Light of the draped ground's slopes (drapedGround.ts): from the north-west, x east, y south, z up. */
export const VOLUME_LIGHT: readonly [number, number, number] = [-0.485, -0.485, 0.728];
/** Haze of the draped ground (drapedGround.ts): its colour, and its distance for a camera, as that file sets them. */
export const VOLUME_HAZE: readonly [number, number, number] = [0.77, 0.85, 0.88];
export const hazeDistance = (camera: FrameCamera): number => Math.max(2 * camera.distance, 100) * getViewDepth();

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

/** KHR_parallel_shader_compile's COMPLETION_STATUS_KHR. */
const COMPLETION_STATUS = 0x91b1;

/** Starts the compile and link of a volume program and returns at once: with KHR_parallel_shader_compile the driver
 * links it in its own threads while the layer polls `volumeProgramLinked` in its work slices (reading LINK_STATUS
 * before completion would wait for the whole link on the main thread: 250 ms measured for the buildings). */
export function startVolumeProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  gl.getExtension('KHR_parallel_shader_compile');
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
  return program;
}
/** The program started by `startVolumeProgram` is linked (false while the driver still links it: ask again in a later
 * slice). Without the extension the status read waits for the link, once. Throws when the link failed. */
export function volumeProgramLinked(gl: WebGL2RenderingContext, program: WebGLProgram, label: string): boolean {
  if (gl.getExtension('KHR_parallel_shader_compile') && !gl.getProgramParameter(program, COMPLETION_STATUS)) return false;
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`${label} program: ${gl.getProgramInfoLog(program)}`);
  return true;
}

/** Uniform locations of a program by name. */
export function uniformsOf<N extends string>(gl: WebGL2RenderingContext, program: WebGLProgram, names: readonly N[]): Record<N, WebGLUniformLocation | null> {
  const out = {} as Record<N, WebGLUniformLocation | null>;
  for (const name of names) out[name] = gl.getUniformLocation(program, name);
  return out;
}
