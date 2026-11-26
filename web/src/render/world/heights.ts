/**
 * The relief of a map for the world view (contract.ts): the control grid of the terrain (n x n heights at cell
 * centres over the map square, the grid the 2D ground renderer shades) read as its cubic B-spline surface.
 *
 * On the CPU the camera stands on it and picking reads it (`heightAt`); on the GPU the terrain mesh displaces its
 * vertices with the same spline of the same grid (`createHeightTexture`, terrainShader.ts), so the eye, the picked
 * point and the drawn ground agree, and the geometry is the surface whose shading the baked ground tiles carry. The
 * towns' shaped ground (groundShape.ts) is added to it on both sides.
 *
 * Built by the composed view (v2/display/composedView.ts), once per terrain and vertical exaggeration.
 */
import type { WorldRelief } from './contract';
import type { GroundShape } from './groundShape';
import { shoreOffset } from '../shoreDetail';

const wx = new Float64Array(4),
  wy = new Float64Array(4),
  dx = new Float64Array(4),
  dy = new Float64Array(4);
/** Derivatives of the spline weights (per cell). */
function splineSlopes(t: number, out: Float64Array): void {
  out[0] = -0.5 * (1 - t) ** 2;
  out[1] = 1.5 * t * t - 2 * t;
  out[2] = -1.5 * t * t + t + 0.5;
  out[3] = 0.5 * t * t;
}
/** Weights of the four control points around a position `t` (0..1) past the second one. */
function splineWeights(t: number, out: Float64Array): void {
  const cube = t * t * t;
  out[0] = (1 - t) ** 3 / 6;
  out[1] = (3 * cube - 6 * t * t + 4) / 6;
  out[2] = (-3 * cube + 3 * t * t + 3 * t + 1) / 6;
  out[3] = cube / 6;
}

export class TerrainHeights implements WorldRelief {
  readonly low: number;
  readonly high: number;
  /** WorldRelief.solidAt: set by the owner of an Underdark relief (v2/display/composedView.ts). */
  solidAt?: (x: number, y: number) => boolean;
  /** The ground shaped for the towns of the map, set whole by its maker (v2/display/worldVolumes.ts) for each town content. */
  shape?: GroundShape;

  constructor(
    /** Control heights in metres, row by row from the north-west corner. */
    readonly data: Float32Array,
    readonly n: number,
    /** Side of the map in metres. */
    readonly width: number,
    /** Lowest ground drawn, in metres: the sea level where water covers what lies below; -Infinity to draw it all. */
    readonly floor: number,
    /** Vertical exaggeration of the appearance. */
    readonly exaggeration: number,
    /** A coastal map: the relief carries the fractal shore detail of the drawn coastline (render/shoreDetail.ts). */
    readonly shore = false,
  ) {
    let low = Infinity,
      high = -Infinity;
    for (let i = 0; i < data.length; i++) {
      const value = data[i];
      if (value < low) low = value;
      if (value > high) high = value;
    }
    // The spline stays within the range of its control points.
    this.low = (Number.isFinite(low) ? Math.max(low, floor) : 0) * exaggeration;
    this.high = (Number.isFinite(high) ? Math.max(high, floor) : 0) * exaggeration;
  }

  heightAt(x: number, y: number): number {
    const natural = this.naturalAt(x, y);
    return this.shape ? natural + this.shape.drawnAt(x, y) * this.exaggeration : natural;
  }
  groundAt(x: number, y: number): number {
    const natural = this.naturalAt(x, y);
    return this.shape ? natural + this.shape.groundAt(x, y) * this.exaggeration : natural;
  }
  /** The relief of the terrain alone, no ground shaped. */
  naturalAt(x: number, y: number): number {
    return this.naturalMetresAt(x, y) * this.exaggeration;
  }
  /** Natural elevation before vertical exaggeration. */
  naturalMetresAt(x: number, y: number): number {
    const n = this.n,
      data = this.data,
      gx = Math.max(0, Math.min(1, x / this.width)) * n - 0.5,
      gy = Math.max(0, Math.min(1, y / this.width)) * n - 0.5;
    const bx = Math.floor(gx),
      by = Math.floor(gy);
    splineWeights(gx - bx, wx);
    splineWeights(gy - by, wy);
    let height = 0;
    for (let j = 0; j < 4; j++) {
      const row = Math.max(0, Math.min(n - 1, by + j - 1)) * n;
      let sum = 0;
      for (let i = 0; i < 4; i++) sum += data[row + Math.max(0, Math.min(n - 1, bx + i - 1))] * wx[i];
      height += sum * wy[j];
    }
    if (this.shore) {
      // The gradient from the same sixteen controls, for the offset that vanishes 1.5 cells off the zero line.
      splineSlopes(gx - bx, dx);
      splineSlopes(gy - by, dy);
      let sx = 0,
        sy = 0;
      for (let j = 0; j < 4; j++) {
        const row = Math.max(0, Math.min(n - 1, by + j - 1)) * n;
        for (let i = 0; i < 4; i++) {
          const h = data[row + Math.max(0, Math.min(n - 1, bx + i - 1))];
          sx += h * dx[i] * wy[j];
          sy += h * wx[i] * dy[j];
        }
      }
      const cell = this.width / n;
      height += shoreOffset(x, y, height, Math.hypot(sx, sy) / cell, cell);
    }
    return Math.max(height, this.floor);
  }
}

/** The control grid as an R32F texture read with `texelFetch`. R32F rather than R16F: half floats step by 1 to 2 m
 * above 1000 m, which shows as terraces at close zoom; and no filtering is needed, since the shader evaluates the
 * spline from the sixteen texels around a vertex (R32F is not filterable in WebGL2 without an extension). */
export function createHeightTexture(gl: WebGL2RenderingContext, heights: TerrainHeights): WebGLTexture {
  const texture = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
  gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, heights.n, heights.n);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, heights.n, heights.n, gl.RED, gl.FLOAT, heights.data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
}
