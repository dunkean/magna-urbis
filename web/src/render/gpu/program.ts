/**
 * One linked WebGL2 program of the vector rasterizer (sources: shaders.ts), with its uniform locations.
 *
 * Two ways to make one:
 * - `Program.link`: compiled, linked and checked at once (the tile rasterizer, and a program a replay needs before
 *   `warm` made it). Each check waits for the graphics process.
 * - `Program.start`: compile and link are only started; nothing is read back, so nothing waits. `settle` checks the
 *   result later and reads every active uniform location once, from the live layer's `work` (liveRasterizer.ts
 *   `warm`): a frame then never asks the context anything (each query waits for the graphics process).
 */
import { GpuRasterError } from './displayList';
import { SHADERS, type ProgramKind } from './shaders';

export class Program {
  /** The uViewport this program holds (uniforms belong to the program: set again only when the target size changes). */
  viewW = -1;
  viewH = -1;
  private locations = new Map<string, WebGLUniformLocation | null>();
  /** Every active uniform location is known (`settle`): `u` never asks the context again. */
  private resolved = false;

  private constructor(
    private gl: WebGL2RenderingContext,
    readonly handle: WebGLProgram,
    /** A started program keeps its shaders until its link is checked (`settle`). */
    private unchecked: { vertex: WebGLShader; fragment: WebGLShader } | null,
  ) {}

  /** Compiled, linked and checked now. */
  static link(gl: WebGL2RenderingContext, kind: ProgramKind): Program {
    const [vs, fs] = SHADERS[kind];
    const compile = (type: number, source: string): WebGLShader => {
      const s = gl.createShader(type);
      if (!s) throw new GpuRasterError('Cannot allocate vector shader');
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const error = gl.getShaderInfoLog(s);
        gl.deleteShader(s);
        throw new GpuRasterError(`Vector shader: ${error}`);
      }
      return s;
    };
    const vertex = compile(gl.VERTEX_SHADER, vs);
    let fragment: WebGLShader | null = null,
      handle: WebGLProgram | null = null;
    try {
      fragment = compile(gl.FRAGMENT_SHADER, fs);
      handle = gl.createProgram();
      if (!handle) throw new GpuRasterError('Cannot allocate vector program');
      gl.attachShader(handle, vertex);
      gl.attachShader(handle, fragment);
      gl.linkProgram(handle);
      if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) throw new GpuRasterError(`Vector link: ${gl.getProgramInfoLog(handle)}`);
      return new Program(gl, handle, null);
    } catch (error) {
      if (handle) gl.deleteProgram(handle);
      throw error;
    } finally {
      gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
    }
  }

  /** Compile and link started, nothing read back: `settle` checks it later. */
  static start(gl: WebGL2RenderingContext, kind: ProgramKind): Program {
    const [vs, fs] = SHADERS[kind];
    const vertex = gl.createShader(gl.VERTEX_SHADER),
      fragment = gl.createShader(gl.FRAGMENT_SHADER),
      handle = gl.createProgram();
    if (!vertex || !fragment || !handle) {
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.deleteProgram(handle);
      throw new GpuRasterError('Cannot allocate vector program');
    }
    gl.shaderSource(vertex, vs);
    gl.compileShader(vertex);
    gl.shaderSource(fragment, fs);
    gl.compileShader(fragment);
    gl.attachShader(handle, vertex);
    gl.attachShader(handle, fragment);
    gl.linkProgram(handle);
    return new Program(gl, handle, { vertex, fragment });
  }

  /** False while a started program is not checked yet. */
  get ready(): boolean {
    return !this.unchecked;
  }
  /** A started program: true once it is linked, checked and all its uniform locations are read. With `parallel`
   * (KHR_parallel_shader_compile) it answers false, without waiting, while the driver still works; without, the
   * check waits for the link. Throws when the program failed. */
  settle(parallel: { readonly COMPLETION_STATUS_KHR: number } | null): boolean {
    const held = this.unchecked,
      gl = this.gl;
    if (!held) return true;
    if (parallel && !gl.getProgramParameter(this.handle, parallel.COMPLETION_STATUS_KHR)) return false;
    this.unchecked = null;
    const linked = !!gl.getProgramParameter(this.handle, gl.LINK_STATUS);
    const log = linked ? '' : gl.getProgramInfoLog(this.handle) || gl.getShaderInfoLog(held.vertex) || gl.getShaderInfoLog(held.fragment) || 'unknown';
    gl.deleteShader(held.vertex);
    gl.deleteShader(held.fragment);
    if (!linked) {
      gl.deleteProgram(this.handle);
      throw new GpuRasterError(`Vector link: ${log}`);
    }
    // All the locations now, in `work`: a frame never asks for one (each query waits for the graphics process).
    const count = Number(gl.getProgramParameter(this.handle, gl.ACTIVE_UNIFORMS)) || 0;
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(this.handle, i);
      if (info) this.locations.set(info.name, gl.getUniformLocation(this.handle, info.name));
    }
    this.resolved = true;
    return true;
  }
  u(name: string): WebGLUniformLocation | null {
    // Resolved: an unknown name is a uniform the compiler removed (no location), as the query would answer.
    if (this.resolved) return this.locations.get(name) ?? null;
    if (!this.locations.has(name)) this.locations.set(name, this.gl.getUniformLocation(this.handle, name));
    return this.locations.get(name) ?? null;
  }
}
