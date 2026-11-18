/**
 * WebGL2 program creation for the GPU town: at once (the renderer's own canvas) or without blocking (a shared
 * context: compiles and links issued together, polled through KHR_parallel_shader_compile). Used by renderer.ts and
 * by the live town layer for its own programs.
 */
// walls hook (cityWalls.ts)

type Uniforms = Record<string, WebGLUniformLocation | null>;
export interface Program {
  program: WebGLProgram;
  u: Uniforms;
}
/** Non-blocking program creation (shared context): `startProgram` issues the compiles and the link and reads nothing
 * back; `programLinked` polls KHR_parallel_shader_compile (`parallel` false: true at once, the caller then links one
 * program per call); `finishProgram` reads the link status and the uniform locations, once linked. */
export interface PendingProgram {
  program: WebGLProgram;
  shaders: WebGLShader[];
}
export function startProgram(gl: WebGL2RenderingContext, vs: string, fs: string): PendingProgram {
  const program = gl.createProgram()!,
    shaders: WebGLShader[] = [];
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    shaders.push(shader);
  }
  gl.linkProgram(program);
  return { program, shaders };
}
const COMPLETION_STATUS_KHR = 0x91b1;
export const programLinked = (gl: WebGL2RenderingContext, p: PendingProgram, parallel: boolean): boolean => !parallel || !!gl.getProgramParameter(p.program, COMPLETION_STATUS_KHR);
export function finishProgram(gl: WebGL2RenderingContext, p: PendingProgram): Program {
  if (!gl.getProgramParameter(p.program, gl.LINK_STATUS)) throw new Error(`cityGl link: ${gl.getProgramInfoLog(p.program)} ${p.shaders.map(s => gl.getShaderInfoLog(s) ?? '').join(' ')}`);
  for (const s of p.shaders) {
    gl.detachShader(p.program, s);
    gl.deleteShader(s);
  }
  const u: Uniforms = {},
    n = gl.getProgramParameter(p.program, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p.program, i)!;
    u[info.name] = gl.getUniformLocation(p.program, info.name);
  }
  return { program: p.program, u };
}
export function compile(gl: WebGL2RenderingContext, vs: string, fs: string): Program {
  const program = gl.createProgram()!;
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`cityGl shader: ${gl.getShaderInfoLog(shader)}`);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`cityGl link: ${gl.getProgramInfoLog(program)}`);
  const u: Uniforms = {},
    n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(program, i)!;
    u[info.name] = gl.getUniformLocation(program, info.name);
  }
  return { program, u };
}
