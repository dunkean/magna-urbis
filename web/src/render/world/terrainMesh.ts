/**
 * The GPU side of the terrain of the world view (contract.ts): the one grid mesh every square of the map is drawn
 * with, the program that displaces and drapes it (terrainShader.ts), and the list of squares of a frame as instances.
 * Built once per context by the draped ground (drapedGround.ts), which fills the instances and the uniforms.
 */
import { LATTICE, MAX_PATCHES } from './patches';
import { TERRAIN_FS, TERRAIN_VS } from './terrainShader';

/** Floats of an instance: aSquare (4), aTile (3), aDrape (4), one of padding. */
export const SQUARE_FLOATS = 12;
const INDICES = LATTICE * LATTICE * 6;
export const SQUARE_TRIANGLES = LATTICE * LATTICE * 2;

const UNIFORMS = ['uProjection', 'uAnchor', 'uTarget', 'uEye', 'uLevel', 'uGrid', 'uHeights', 'uTiles', 'uDrape', 'uShape', 'uShapeIndex', 'uShapeSide', 'uLight', 'uAir', 'uHaze', 'uCave', 'uCaveLamps', 'uCaveLampCount'] as const;
type UniformName = (typeof UNIFORMS)[number];

function link(gl: WebGL2RenderingContext): WebGLProgram {
  const program = gl.createProgram()!;
  for (const [type, source] of [
    [gl.VERTEX_SHADER, TERRAIN_VS],
    [gl.FRAGMENT_SHADER, TERRAIN_FS],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`World terrain program: ${gl.getProgramInfoLog(program)}`);
  return program;
}

export class TerrainMesh {
  readonly program: WebGLProgram;
  readonly uniforms = {} as Record<UniformName, WebGLUniformLocation | null>;
  private readonly vao: WebGLVertexArrayObject;
  private readonly lattice: WebGLBuffer;
  private readonly indices: WebGLBuffer;
  private readonly instances: WebGLBuffer;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.program = link(gl);
    for (const name of UNIFORMS) this.uniforms[name] = gl.getUniformLocation(this.program, name);
    const side = LATTICE + 1,
      points = new Float32Array(side * side * 2),
      triangles = new Uint16Array(INDICES);
    for (let j = 0; j < side; j++)
      for (let i = 0; i < side; i++) {
        points[(j * side + i) * 2] = i;
        points[(j * side + i) * 2 + 1] = j;
      }
    let at = 0;
    for (let j = 0; j < LATTICE; j++)
      for (let i = 0; i < LATTICE; i++) {
        const a = j * side + i,
          b = a + side;
        triangles[at++] = a;
        triangles[at++] = b;
        triangles[at++] = b + 1;
        triangles[at++] = a;
        triangles[at++] = b + 1;
        triangles[at++] = a + 1;
      }
    this.vao = gl.createVertexArray()!;
    this.lattice = gl.createBuffer()!;
    this.indices = gl.createBuffer()!;
    this.instances = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lattice);
    gl.bufferData(gl.ARRAY_BUFFER, points, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, triangles, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_PATCHES * SQUARE_FLOATS * 4, gl.DYNAMIC_DRAW);
    for (const location of [1, 2, 3]) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribDivisor(location, 1);
    }
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  /** Replaces the squares of the frame: `count` instances of SQUARE_FLOATS floats. */
  setSquares(data: Float32Array, count: number): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * SQUARE_FLOATS);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  /** Before `drawSquares`: the program and the mesh; the caller sets the uniforms and the textures. */
  bind(): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
  }
  /** One draw call: `count` squares from the instance `first`. */
  drawSquares(first: number, count: number): void {
    const gl = this.gl,
      stride = SQUARE_FLOATS * 4;
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, first * stride);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, first * stride + 16);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, first * stride + 28);
    gl.drawElementsInstanced(gl.TRIANGLES, INDICES, gl.UNSIGNED_SHORT, 0, count);
  }
  unbind(): void {
    const gl = this.gl;
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.useProgram(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.lattice);
    gl.deleteBuffer(this.indices);
    gl.deleteBuffer(this.instances);
  }
}
