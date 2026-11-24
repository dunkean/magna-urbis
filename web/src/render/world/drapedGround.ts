/**
 * The ground of a tilted frame (contract.ts): the terrain as a displaced grid, draped with the baked tiles of the
 * live ground layer and, over them, with the tiles of the map drape of the frame (`LiveFrame.drape`: water,
 * cartography, town plan). Owned by the ground layer (render/live/groundLayer.ts), which calls `prepare` from its work
 * slices and `draw` for every frame whose camera is tilted, and keeps drawing the top view itself.
 *
 * A frame costs one instanced draw per page of ground tiles it shows and builds nothing: the mesh is one grid, the
 * heights one texture uploaded once per terrain (`prepare`), the towns' shaped ground one more per town content, the
 * drape one texture array, and the only data sent while the camera moves is the list of the squares to draw, a few
 * kilobytes; a frame whose camera and tiles are those of the previous one sends nothing.
 */
import type { LiveFrame } from '../live/contract';
import type { DrapedGroundStats, DrapeTile, DrapeTiles } from './contract';
import { drapeTier } from './footprint';
import type { GroundShape } from './groundShape';
import { GroundShapeTexture } from './groundShapeTexture';
import { createHeightTexture, type TerrainHeights } from './heights';
import { LATTICE, MAX_PATCHES, PatchList, lodEyeHeight, morphStart, patchLevels, patchRatio, selectPatches, shapedPatchLevels, type PatchQuery } from './patches';
import { SQUARE_FLOATS, SQUARE_TRIANGLES, TerrainMesh } from './terrainMesh';
import { tileKey } from './tilePyramid';
import { hazeDistance } from './volumes';
import { CAVE_DUSK, GROUND_LAMPS, caveFogRange, caveGroundLamps, type WorldCave } from './cave';

/** Control heights assumed for a map whose relief is not known: the ground is then draped flat. */
const FLAT_GRID = 1024;
/** Direction of the slope light: from the north-west, the side maps are lit from. */
const LIGHT: readonly [number, number, number] = [-0.485, -0.485, 0.728];
/** Strength of the slope light at full rise: a slope of 30 degrees gains 12 % towards the light and loses 20 % away. */
const SLOPE_LIGHT = 0.5;
/** Haze at the horizon, and the colour beyond the map: the 3D terrain view's. */
const HAZE: readonly [number, number, number] = [0.77, 0.85, 0.88];
/** Pages of baked tiles a frame may show (the ground layer holds at most 32). */
const MAX_PAGES = 64;
/** First of the two texture units of the shaped ground (GroundShapeTexture.bind). */
const SHAPE_UNIT = 3;

export class DrapedGround {
  readonly stats: DrapedGroundStats = { drawCalls: 0, triangles: 0, patches: 0, uploads: 0, otherTier: 0, drapeOtherTier: 0 };
  private mesh?: TerrainMesh;
  /** The height texture and the grid it holds; `flat` stands in for a map without relief. */
  private heightTexture?: WebGLTexture;
  private uploaded?: Float32Array;
  private flat?: WebGLTexture;
  private readonly shape: GroundShapeTexture;
  private readonly patches = new PatchList();
  private readonly query: PatchQuery = { mapSize: 1, levels: 1, ratio: 3, low: 0, high: 0, tanX: 1, tanY: 1 };
  private readonly tile: DrapeTile = { page: 0, layer: 0, u0: 0, v0: 0, span: 1 };
  private readonly drapeTile: DrapeTile = { page: 0, layer: 0, u0: 0, v0: 0, span: 1 };
  /** The squares in the buffer name tiles of the map drape. */
  private draped = false;
  /** The squares in selection order with their pages, then grouped by page as the instance buffer holds them. */
  private readonly found = new Float32Array(MAX_PATCHES * SQUARE_FLOATS);
  private readonly pageOf = new Uint8Array(MAX_PATCHES);
  private readonly squares = new Float32Array(MAX_PATCHES * SQUARE_FLOATS);
  /** Per draw call: page, first instance, count. */
  private readonly ranges = new Int32Array(MAX_PAGES * 3);
  private draws = 0;
  private count = 0;
  /** Anchor of the cell grids of the squares in the buffer, relative to their target (m). */
  private anchorX = 0;
  private anchorY = 0;
  /** What the squares in the buffer were selected for: a frame with the same values draws them again as they are. */
  private readonly selectedFor = new Float64Array(16 + 3 + 7).fill(NaN);
  private selectedHeights?: TerrainHeights;
  private selectedShape?: GroundShape;
  /** Tier of the tiles each square of the last selection showed, by square key (footprint.ts drapeTier `previous`);
   * the two maps swap at each selection. */
  private tierOf = new Map<number, number>();
  private tierBefore = new Map<number, number>();
  /** Underdark: the fog range and the lanterns of the frame, refilled in place. */
  private readonly fog: [number, number] = [0, 1];
  private readonly lamps = new Float32Array(GROUND_LAMPS * 4);

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly tiles: DrapeTiles,
  ) {
    this.shape = new GroundShapeTexture(gl);
  }

  /** Between frames: the program and the mesh, and the heights of the map when they changed (once per terrain). */
  prepare(heights: TerrainHeights | undefined): void {
    const gl = this.gl;
    this.mesh ??= new TerrainMesh(gl);
    if (!this.flat) {
      this.flat = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.flat);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, 1, 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    this.shape.prepare(heights?.shape);
    if (heights?.data === this.uploaded) return;
    if (this.heightTexture) gl.deleteTexture(this.heightTexture);
    this.heightTexture = heights && createHeightTexture(gl, heights);
    this.uploaded = heights?.data;
  }

  /** The frame was selected for these very values: its squares are in the instance buffer. */
  private selected(frame: LiveFrame, heights: TerrainHeights | undefined): boolean {
    const key = this.selectedFor,
      camera = frame.camera;
    let same = this.selectedHeights === heights && this.selectedShape === heights?.shape;
    const note = (index: number, value: number): void => {
      if (key[index] !== value) {
        key[index] = value;
        same = false;
      }
    };
    for (let i = 0; i < 16; i++) note(i, camera.targetViewProjection[i]);
    for (let i = 0; i < 3; i++) note(16 + i, camera.target[i]);
    note(19, frame.width);
    note(20, frame.height);
    note(21, frame.dpr);
    note(22, frame.quality === 'light' ? 1 : 0);
    note(23, this.tiles.revision());
    note(24, this.tiles.mapSize());
    note(25, frame.drape ? frame.drape.revision() : -1);
    this.selectedHeights = heights;
    this.selectedShape = heights?.shape;
    return same;
  }

  /** Chooses the squares of the frame and the tile of each, and sends them to the GPU grouped by tile page. */
  private select(frame: LiveFrame, heights: TerrainHeights | undefined): void {
    const camera = frame.camera,
      tiles = this.tiles,
      query = this.query,
      mapSize = tiles.mapSize();
    query.mapSize = mapSize;
    const shape = heights?.shape,
      levels = patchLevels(heights?.n ?? FLAT_GRID);
    // A shaped ground takes a finer mesh near the eye; its squares keep the tiles the natural ground asks for.
    query.levels = shape ? shapedPatchLevels(levels, mapSize) : levels;
    query.ratio = patchRatio(camera.focal / frame.dpr, frame.quality);
    query.low = heights ? (heights.low + (shape?.low ?? 0) * heights.exaggeration) * camera.rise : 0;
    query.high = heights ? (heights.high + (shape?.high ?? 0) * heights.exaggeration) * camera.rise : 0;
    query.tanX = frame.width / (2 * camera.focal);
    query.tanY = frame.height / (2 * camera.focal);
    const list = this.patches;
    selectPatches(list, camera, query);
    // Cells are counted from an anchor near the target, a whole number of cells of every level: the positions of a
    // square are small numbers there, and two squares that share a vertex compute the same bits for it.
    const coarsest = mapSize / (2 * LATTICE),
      anchorX = Math.round(camera.target[0] / coarsest),
      anchorY = Math.round(camera.target[1] / coarsest);
    this.anchorX = anchorX * coarsest - camera.target[0];
    this.anchorY = anchorY * coarsest - camera.target[1];
    const finest = tiles.finestTier(frame.dpr),
      tile = this.tile,
      drapeTile = this.drapeTile,
      found = this.found,
      pageOf = this.pageOf;
    // The map drape, when it holds tiles of this map in the ground's tiling: a square then names the same tile in both.
    const drape = frame.drape && frame.drape.pageCount() > 0 && frame.drape.mapSize() === mapSize && frame.drape.tilePixels === tiles.tilePixels ? frame.drape : undefined;
    this.draped = !!drape;
    let count = 0,
      otherTier = 0,
      drapeOtherTier = 0;
    tiles.begin();
    drape?.begin();
    // The tier of each square in the last selection (or of its parent, for a square that has just split).
    const previous = this.tierOf,
      current = (this.tierOf = this.tierBefore);
    this.tierBefore = previous;
    current.clear();
    for (let i = 0; i < list.count; i++) {
      const tier = list.tier[i],
        ix = list.ix[i],
        iy = list.iy[i],
        finer = 2 ** (tier - 1),
        key = tileKey(tier, ix, iy);
      const shown = drapeTier(camera.focal, list.depth[i], mapSize, tiles.tilePixels, Math.min(tier, levels), finest, previous.get(key) ?? (tier > 0 ? (previous.get(tileKey(tier - 1, ix >> 1, iy >> 1)) ?? -1) : -1));
      current.set(key, shown);
      if (!tiles.resolve(tier, ix, iy, shown, list.centreOffset[i], tile) || tile.page >= MAX_PAGES) continue;
      // The part of the wanted tile under the square: another span means another tier stands in.
      const span = 2 ** (shown - tier),
        o = count * SQUARE_FLOATS;
      if (tile.span !== span) otherTier++;
      found[o] = ix * LATTICE - anchorX * finer;
      found[o + 1] = iy * LATTICE - anchorY * finer;
      found[o + 2] = coarsest / finer;
      found[o + 3] = tile.layer;
      found[o + 4] = tile.u0;
      found[o + 5] = tile.v0;
      found[o + 6] = tile.span;
      if (drape?.resolve(tier, ix, iy, shown, list.centreOffset[i], drapeTile)) {
        found[o + 7] = drapeTile.u0;
        found[o + 8] = drapeTile.v0;
        found[o + 9] = drapeTile.span;
        found[o + 10] = drapeTile.layer;
        if (drapeTile.span !== span) drapeOtherTier++;
      } else {
        found[o + 10] = -1;
        drapeOtherTier++;
      }
      pageOf[count++] = tile.page;
    }
    this.stats.otherTier = otherTier;
    this.stats.drapeOtherTier = drapeOtherTier;
    const squares = this.squares,
      ranges = this.ranges,
      pages = Math.min(MAX_PAGES, tiles.pageCount());
    let used = 0,
      draws = 0;
    for (let page = 0; page < pages && used < count; page++) {
      const first = used;
      for (let i = 0; i < count; i++) {
        if (pageOf[i] !== page) continue;
        for (let c = 0; c < SQUARE_FLOATS; c++) squares[used * SQUARE_FLOATS + c] = found[i * SQUARE_FLOATS + c];
        used++;
      }
      if (used === first) continue;
      ranges[draws * 3] = page;
      ranges[draws * 3 + 1] = first;
      ranges[draws * 3 + 2] = used - first;
      draws++;
    }
    this.count = used;
    this.draws = draws;
    this.mesh!.setSquares(squares, used);
    this.stats.uploads++;
  }

  /** Draws the ground of a tilted frame over `paper`, the colour around the map (0..1 components); in the Underdark
   * (`cave`) under no sky, in the cave's own light. */
  draw(frame: LiveFrame, heights: TerrainHeights | undefined, paper: readonly [number, number, number], cave?: WorldCave): void {
    const gl = this.gl,
      camera = frame.camera,
      stats = this.stats;
    // Normally done by a work slice; a first tilted frame that comes before it prepares here, once.
    if (!this.mesh || !this.flat || heights?.data !== this.uploaded || heights?.shape !== this.shape.current) this.prepare(heights);
    const mesh = this.mesh!,
      rise = camera.rise;
    if (!this.selected(frame, heights)) this.select(frame, heights);
    // Beyond the map and above the horizon: the paper in the top view, the haze once the relief stands (the darkness
    // of the cave in the Underdark).
    const air = cave && heights ? CAVE_DUSK : HAZE;
    gl.clearColor(paper[0] + (air[0] - paper[0]) * rise, paper[1] + (air[1] - paper[1]) * rise, paper[2] + (air[2] - paper[2]) * rise, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    stats.drawCalls = this.draws;
    stats.patches = this.count;
    stats.triangles = this.count * SQUARE_TRIANGLES;
    if (!this.draws) return;
    const u = mesh.uniforms,
      eyeX = camera.eye[0] - camera.target[0],
      eyeY = camera.eye[1] - camera.target[1],
      eyeZ = camera.eye[2] - camera.target[2];
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    mesh.bind();
    gl.uniformMatrix4fv(u.uProjection, false, camera.targetViewProjection);
    gl.uniform2f(u.uAnchor, this.anchorX, this.anchorY);
    gl.uniform3f(u.uTarget, camera.target[0], camera.target[1], camera.target[2]);
    gl.uniform3f(u.uEye, eyeX, eyeY, eyeZ);
    gl.uniform3f(u.uLevel, this.query.ratio * 2 * LATTICE, morphStart(this.query.ratio), lodEyeHeight(camera));
    if (heights) gl.uniform4f(u.uGrid, heights.n / heights.width, heights.n, Math.max(heights.floor, -1e30), heights.exaggeration * rise);
    else gl.uniform4f(u.uGrid, 1, 1, 0, 0);
    gl.uniform3f(u.uLight, LIGHT[0], LIGHT[1], LIGHT[2]);
    gl.uniform3f(u.uAir, SLOPE_LIGHT * rise, hazeDistance(camera), rise);
    gl.uniform3f(u.uHaze, air[0], air[1], air[2]);
    if (cave && heights) {
      const fog = caveFogRange(cave, camera, heights.exaggeration, this.fog);
      gl.uniform4f(u.uCave, rise, fog[0], fog[1], cave.settings.darkness);
      gl.uniform1i(u.uCaveLampCount, caveGroundLamps(cave, camera, this.lamps));
      gl.uniform4fv(u.uCaveLamps, this.lamps);
    } else {
      gl.uniform4f(u.uCave, 0, 0, 1, 0);
      gl.uniform1i(u.uCaveLampCount, 0);
    }
    gl.uniform1i(u.uTiles, 0);
    gl.uniform1i(u.uHeights, 1);
    gl.uniform1i(u.uDrape, 2);
    gl.uniform1i(u.uShape, SHAPE_UNIT);
    gl.uniform1i(u.uShapeIndex, SHAPE_UNIT + 1);
    gl.uniform1i(u.uShapeSide, this.shape.side);
    this.shape.bind(SHAPE_UNIT);
    const ranges = this.ranges,
      drape = this.draped && frame.drape && frame.drape.pageCount() > 0 ? frame.drape.page(0) : undefined;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, (heights && this.heightTexture) || this.flat!);
    // Without a drape no square reads it (its layer is negative): a page of ground tiles keeps the sampler complete.
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, drape ?? this.tiles.page(ranges[0]));
    gl.activeTexture(gl.TEXTURE0);
    for (let d = 0; d < this.draws; d++) {
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tiles.page(ranges[d * 3]));
      mesh.drawSquares(ranges[d * 3 + 1], ranges[d * 3 + 2]);
    }
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    this.shape.bind(SHAPE_UNIT, false);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    mesh.unbind();
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
  }

  /** Every GL handle is dead; the next `prepare` builds them again. */
  contextLost(): void {
    this.mesh = undefined;
    this.shape.contextLost();
    this.heightTexture = undefined;
    this.flat = undefined;
    this.uploaded = undefined;
    this.selectedFor.fill(NaN);
    this.count = this.draws = 0;
  }

  dispose(): void {
    const gl = this.gl;
    this.mesh?.dispose();
    this.shape.dispose();
    if (this.heightTexture) gl.deleteTexture(this.heightTexture);
    if (this.flat) gl.deleteTexture(this.flat);
    this.contextLost();
  }
}
