/** Program variants for the large map shaders. On Windows, Chrome and Edge run WebGL on ANGLE/D3D11,
 * whose HLSL compiler (FXC) inlines every call and unrolls constant-bound loops: the full map shader
 * took minutes and froze the page. A variant fixes the look's switches as constants, so FXC only sees
 * the code that look uses, keeps loops as loops, and links in parallel (KHR_parallel_shader_compile). */

/** Starts compiling and linking without reading any status, so the link can run off the main thread. */
export function startProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram()!;
  for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source); gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  return program;
}
/** Waits for the link (blocking) and reports the shader logs on failure. */
export function finishProgram(gl: WebGL2RenderingContext, program: WebGLProgram): WebGLProgram {
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  const shaders = (gl.getAttachedShaders(program) ?? []).map(shader => gl.getShaderInfoLog(shader)).filter(Boolean).join('\n');
  throw new Error(`Programme : ${shaders || gl.getProgramInfoLog(program)}`);
}

/** `uniform int NAME;` declarations become constants and `defines` are prepended. Constant-bound loops
 * get a uniform zero in their bound so FXC keeps them as loops; a loop writing an indexed array element
 * on its line stays unrollable, since FXC refuses that loop dynamic. */
export function specializeShader(source: string, constants: Record<string, number>, defines: Record<string, number> = {}): string {
  const swap = (fs: string, from: string, to: string): string => {
    if (fs.split(from).length !== 2) throw new Error(`Shader variant: ${from} not found once`);
    return fs.replace(from, to);
  };
  const head = Object.entries(defines).map(([name, value]) => `#define ${name} ${value}\n`).join('');
  let fs = swap(source, '#version 300 es\n', `#version 300 es\n${head}uniform highp int uLoopZero;\n`);   // never set: always 0
  for (const [name, value] of Object.entries(constants)) fs = swap(fs, `uniform int ${name};`, `const int ${name}=${value};`);
  return fs.replace(/(for\s*\(\s*int\s+\w+\s*=\s*-?\d+\s*;\s*\w+\s*<=?\s*)(\d+)\s*;/g, (loop: string, start: string, bound: string, at: number, all: string) =>
    /\]\s*=[^=]/.test(all.slice(at, all.indexOf('\n', at))) ? loop : `${start}${bound}+uLoopZero;`);
}

/** Linked programs by variant key. `get` returns a variant once linked, or undefined while it links
 * in parallel (a redraw is then polled) or after it failed (logged once). */
export class ShaderVariants {
  private programs = new Map<string, WebGLProgram>();
  private linked = new Set<WebGLProgram>();
  private failed = new Set<string>();
  private parallel: { COMPLETION_STATUS_KHR: number } | null;
  private poll = 0;
  constructor(private gl: WebGL2RenderingContext, private redraw: () => void) {
    this.parallel = gl.getExtension('KHR_parallel_shader_compile');
  }
  get(key: string, sources: () => [string, string], wait = false): WebGLProgram | undefined {
    if (this.failed.has(key)) return undefined;
    let program = this.programs.get(key);
    if (!program) this.programs.set(key, program = startProgram(this.gl, ...sources()));
    if (this.linked.has(program)) return program;
    if (!wait && this.parallel && !this.gl.getProgramParameter(program, this.parallel.COMPLETION_STATUS_KHR)) {
      if (!this.poll) this.poll = window.setTimeout(() => { this.poll = 0; this.redraw(); }, 100);
      return undefined;
    }
    try { finishProgram(this.gl, program); }
    catch (error) { this.failed.add(key); console.error(`Shader variant ${key}:`, error); return undefined; }
    this.linked.add(program);
    return program;
  }
  /** Forgets every program (after a context loss, or on dispose with `deleted`). */
  reset(deleted = false): void {
    clearTimeout(this.poll); this.poll = 0;
    if (deleted) for (const program of this.programs.values()) this.gl.deleteProgram(program);
    this.programs.clear(); this.linked.clear(); this.failed.clear();
  }
}
