/**
 * Contract of the world view (render/world/): the map is the world seen from above, and one camera goes from that top
 * view to a tilted perspective of the relief, with no second engine.
 *
 *   camera.ts       the camera: its pose from a view (centre, scale, pitch, yaw), its matrices, the ground point under
 *                   a pixel, pan and zoom on the ground. Pure math: the compositor fills the frame with it, the viewer
 *                   navigates with it.
 *   heights.ts      the relief of a map on the CPU (the camera stands on it, picking reads it) and as a texture.
 *   patches.ts      which squares of the map a frame draws and how finely: a bounded quadtree walk.
 *   footprint.ts    which tier of baked ground tiles a square is draped with.
 *   terrainMesh.ts  the one grid mesh, its program and the instanced draw (terrainShader.ts holds the GLSL).
 *   drapedGround.ts a tilted frame of the ground: selection, tiles, draw. Owned by the live ground layer
 *                   (render/live/groundLayer.ts), which keeps drawing the top view itself.
 *
 * Space: x east and y south in map metres (the 2D map's own), z up in metres as drawn, that is with the vertical
 * exaggeration of the appearance. At pitch 0 and yaw 0 (the top view) the projection is the orthographic mapping of
 * the 2D map and the relief is flat; the relief rises with the pitch (`FrameCamera.rise`), so there is no jump between
 * the two.
 */

/** The relief the camera stands on. */
export interface WorldRelief {
  /** Side of the map in metres. */
  readonly width: number;
  /** Lowest and highest ground of the map, in metres as drawn. */
  readonly low: number;
  readonly high: number;
  /** Height of the ground at a map point, in metres as drawn at full relief; clamped at the map edge. */
  heightAt(x: number, y: number): number;
}

/** The camera of a frame (LiveFrame.camera). Vectors and matrices are reused from frame to frame: read, never kept. */
export interface FrameCamera {
  /** Radians; 0 looks straight down. */
  readonly pitch: number;
  /** Radians, clockwise from north: the compass direction at the top of the screen. */
  readonly yaw: number;
  /** False: the top view. The projection is orthographic and `LiveFrame.worldToClip` / `worldToPixel` say all of it.
   * True: a perspective; a layer that only knows the top view does not draw. */
  readonly tilted: boolean;
  /** Share of the relief the frame shows: 0 in the top view (a flat map), 1 once the camera is tilted enough. */
  readonly rise: number;
  /** (x, y, z) -> clip space, column-major for `uniformMatrix4fv`. In the top view it is `worldToClip` (z ignored). */
  readonly viewProjection: Float32Array;
  /** The same projection for positions given relative to `target`: float32 map coordinates resolve 4 mm on a 40 km
   * map, a pixel at the closest zoom, so a layer subtracts the target on the CPU and draws with this matrix. */
  readonly targetViewProjection: Float32Array;
  /** The ground point at the centre of the view, and the eye: x, y, z. */
  readonly target: Float64Array;
  readonly eye: Float64Array;
  /** Unit vectors of the camera in the world: towards the right of the screen, its top, and into the picture. */
  readonly right: Float64Array;
  readonly up: Float64Array;
  readonly forward: Float64Array;
  /** Device pixels on screen per unit of (offset across the view axis / depth along it). */
  readonly focal: number;
  /** Depths of the near and far planes along the view axis (metres). */
  readonly near: number;
  readonly far: number;
}

/** The baked tile that shows a square of the map, as `DrapeTiles.resolve` fills it. */
export interface DrapeTile {
  /** Index of the texture array page, and the layer in it. */
  page: number;
  layer: number;
  /** The square inside that tile: origin and side in texture coordinates. */
  u0: number;
  v0: number;
  span: number;
}

/** The baked tiles of the live ground layer, as the draped ground reads them. Tier k has 2^k x 2^k tiles over the map. */
export interface DrapeTiles {
  /** Device pixels of a tile side. */
  readonly tilePixels: number;
  /** Side of the map in metres (0: no tile yet). */
  mapSize(): number;
  /** Finest tier the layer bakes at this pixel ratio. */
  finestTier(dpr: number): number;
  /** Changes whenever `resolve` could answer differently (a tile baked, evicted or stale). */
  revision(): number;
  /** A tilted frame is about to name the tiles it shows: the list of the previous one is dropped. */
  begin(): void;
  /** The baked tile that shows the square (tier, ix, iy): that tile, or the matching part of its nearest baked
   * ancestor (never a hole once tier 0 is baked). False when nothing is baked. Marks what it returns as shown and
   * asks for the tile itself when it is missing or stale, `priority` lowest first. */
  resolve(tier: number, ix: number, iy: number, priority: number, out: DrapeTile): boolean;
  pageCount(): number;
  page(index: number): WebGLTexture;
}

/** What the draped ground did in its last frame. */
export interface DrapedGroundStats {
  drawCalls: number;
  triangles: number;
  /** Squares of the map drawn (instances of the grid mesh). */
  patches: number;
  /** Instance lists sent to the GPU since the context was created: one per frame whose camera or tiles changed. */
  uploads: number;
}
