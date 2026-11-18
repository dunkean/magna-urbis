/**
 * Compiles and links one WebGL2 program (the ground variants link through glVariants.ts instead).
 */
export function program(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const result = gl.createProgram();
  if (!result) throw new Error('Impossible de créer la vue 3D.');
  for (const [kind, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(kind)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      gl.deleteProgram(result);
      throw new Error(`Shader terrain 3D : ${message}`);
    }
    gl.attachShader(result, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(result);
  if (!gl.getProgramParameter(result, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(result);
    gl.deleteProgram(result);
    throw new Error(`Programme terrain 3D : ${message}`);
  }
  return result;
}
