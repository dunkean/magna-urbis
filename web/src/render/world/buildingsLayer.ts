/**
 * The town's buildings as volumes in the tilted world view (volumes.ts): the same meshes, colours, material grain and
 * levels of detail as the separate 3D view (buildingsMesh.ts), standing on the relief the draped ground shows
 * (TerrainHeights), drawn after it with depth. Where the page gives the top view's town look, the roofs and walls of the
 * buildings that town draws take its colours, slope light and grain marks instead (buildingsMesh.ts `look`), so the
 * town reads the same tilted or not.
 *
 * Built once per scene, appearance and terrain, block by block in work slices (buildingsBlocks.ts): the levels a frame
 * wanted first, nearest first, then the coarsest level of every other block so a turn finds them. A block level is one
 * vertex buffer, its buildings cell by cell. A frame tests the blocks against the view volume and gives each a level by
 * the size its buildings take on screen; a block across levels (a near one) gives each cell its own, drawn as ranges of
 * the level's vertices (runs of cells at one level in one draw). While the frame's triangles pass BUDGET_TRIANGLES, the
 * farthest blocks and cells go one level coarser, round after round (to nothing: the drape's town plan carries them);
 * the near field, buildings over DETAILED_PIXELS, keeps its full volumes. An unbuilt level shows the nearest built one meanwhile. No upload, no allocation, no geometry in a frame.
 * Levels not drawn for a while go when the cache passes its byte budget.
 *
 * Made by the page with the scene the separate 3D view composes for the same town (City3dDisplayScene: towns, farms,
 * stand-in houses, walls, bridges, quays, lot boundaries, groves), its building appearance and the terrain heights.
 */
import { roofSeasonKey } from '../seasonPalette';
import type { Building3dScene } from '../urbanBuildingGeometry';
import type { UrbanBuildingAppearance } from '../urbanBuildingStyle';
import type { LiveFrame, LiveLayerStats } from '../live/contract';
import { BUILDING_STRIDE, type BuildingPaint, type BuildingSeat } from './buildingsMesh';
import { BLOCK_CELL, BLOCK_CELLS, BlockGrouping, blockHidden, blockLevel, blockPart, worldPaint, worldSeat, type BuildingBlock } from './buildingsBlocks';
import { WORLD_BUILDING_FS, WORLD_BUILDING_VS } from './buildingsShader';
import type { TerrainHeights } from './heights';
import { VOLUME_HAZE, ViewVolume, hazeDistance, startVolumeProgram, volumeProgramLinked, uniformsOf, volumeDepth, volumeDepthEnd, volumesDrawn, type VolumeLayer } from './volumes';
import { pickBuilding, type BuildingPick } from './buildingsPick';
import type { Building3dVisual } from '../urbanBuildingGeometry';
import { COVER_GRAINS, COVER_GRAIN_LEVELS, COVER_GRAIN_TILE, coverGrainTiles } from '../buildingMaterials';
import type { VolumeTownLook } from '../city/buildingLook';

export interface WorldBuildingsOptions {
  /** The display scene of the town (what the separate 3D view draws); undefined: no town. Compared by identity: a new
   * object is a new town and starts the blocks again. */
  scene(): Building3dScene | undefined;
  /** The building appearance of the page (style, colours, snow, night). */
  appearance(): UrbanBuildingAppearance;
  /** The look of the top view's town, which the roofs and walls of its buildings take (buildingsMesh.ts); undefined:
   * the volumes' own paint. Compared by identity, with its frame's key. */
  look?(): VolumeTownLook | undefined;
  /** The relief of the map, the draped ground's; undefined: nothing to stand on yet. */
  terrain(): TerrainHeights | undefined;
  /** A fast look: the buildings are drawn as boxes however near (blockLevel). */
  boxed?(): boolean;
  /** GPU memory the block levels may use, in bytes. */
  budgetBytes?: number;
  /** Asks for a frame (a wanted level was built). */
  invalidate(): void;
}

/** The buildings layer, and the building under a pixel of a tilted view (buildingsPick.ts), for the page's picking. */
export interface WorldBuildingsLayer extends VolumeLayer {
  /** The building first met by the ray from `origin` along `direction` (map metres, z as drawn) before `limit`, among
   * those `accept` takes; undefined before the town is grouped into blocks. CPU only, for a click. */
  pick(origin: ArrayLike<number>, direction: ArrayLike<number>, rise: number, limit: number, accept: (building: Building3dVisual) => boolean): BuildingPick | undefined;
}

/** Buildings meshed between two looks at the clock. */
const BUILD_CHUNK = 8;
/** The separate 3D view's cache budget. */
const BUDGET_BYTES = 96 * 1024 * 1024;
/** Triangles a frame of buildings may take: past it, the farthest blocks and cells go coarser, round after round. */
const BUDGET_TRIANGLES = 300000;
/** Buildings spanning this many pixels keep their full volumes whatever the budget (the near field; blockLevel's
 * detailed threshold). */
const DETAILED_PIXELS = 18;
/** Units (blocks, cells of near blocks) a frame may weigh. */
const MAX_UNITS = 32768;
/** Draws a frame may issue: a block whole, or the runs of its cells that share a level. */
const MAX_DRAWS = 8192;
const CELLS = BLOCK_CELLS * BLOCK_CELLS;
const UNIFORMS = ['uProjection', 'uBlock', 'uRise', 'uEye', 'uAir', 'uHaze', 'uNight', 'uCoverGrain'] as const;

/** The top view's roof grain tiles as one texture (COVER_GRAIN_GLSL): a layer per family of COVER_GRAINS, their halved
 * copies as its mips, premultiplied. Filled one family per work slice (a few milliseconds each the first time the
 * tiles are drawn); an unfilled layer is transparent, so a roof shows no marks until its family is there. */
class CoverGrainTexture {
  texture?: WebGLTexture;
  private filled = 0;
  constructor(private readonly gl: WebGL2RenderingContext) {}
  /** Fills the next family; true once every family is in. */
  step(): boolean {
    const gl = this.gl;
    if (this.filled >= COVER_GRAINS.length) return true;
    if (!this.texture) {
      this.texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, COVER_GRAIN_LEVELS, gl.RGBA8, COVER_GRAIN_TILE, COVER_GRAIN_TILE, COVER_GRAINS.length);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    } else gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    const tiles = coverGrainTiles(COVER_GRAINS[this.filled]);
    if (tiles) {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      for (let level = 0; level < Math.min(tiles.length, COVER_GRAIN_LEVELS); level++) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, level, 0, 0, this.filled, tiles[level].width, tiles[level].height, 1, gl.RGBA, gl.UNSIGNED_BYTE, tiles[level]);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    }
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    this.filled++;
    return this.filled >= COVER_GRAINS.length;
  }
  /** The context was lost: the handle is dead. */
  lost(): void {
    this.texture = undefined;
    this.filled = 0;
  }
  dispose(): void {
    if (this.texture) this.gl.deleteTexture(this.texture);
    this.lost();
  }
}
type Program = { program: WebGLProgram; u: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null> };

interface Level {
  vao: WebGLVertexArrayObject;
  buffer: WebGLBuffer;
  vertices: number;
  /** First vertex of each cell, and the end. */
  cellFirst: Int32Array;
  bytes: number;
  /** Draw tick it was last shown in. */
  used: number;
}
interface Slot {
  block: BuildingBlock;
  levels: (Level | undefined)[];
  /** The levels the last frame that saw the block wanted (bit per level). */
  need: number;
  /** Depth along the view axis at that draw, and its tick. */
  depth: number;
  seen: number;
}

export function createWorldBuildingsLayer(gl: WebGL2RenderingContext, options: WorldBuildingsOptions): WorldBuildingsLayer {
  /** `blocks` drawn, `bytes` on the GPU, `sliceMs` the longest work slice so far, `demoted` the units the budget made coarser. */
  const stats: LiveLayerStats = { drawCalls: 0, triangles: 0, ms: 0, blocks: 0, bytes: 0, sliceMs: 0, demoted: 0 };
  const volume = new ViewVolume();
  let slots: Slot[] = [];
  /** The blocks of the slots, for picking. */
  let blocks: BuildingBlock[] = [];
  // The blocks in view of a frame: slot, height centre and half range, radius.
  const visible: Slot[] = [],
    visibleZ = new Float64Array(16384),
    visibleHalf = new Float64Array(16384),
    visibleRadius = new Float64Array(16384);
  // The draws of a frame: slot, level, first vertex, vertices.
  const drawSlot: Slot[] = [],
    drawLevel: Level[] = [],
    drawFirst = new Int32Array(MAX_DRAWS),
    drawCount = new Int32Array(MAX_DRAWS);
  let drawTotal = 0;
  /** A 1 x 1 target the program is drawn into once, with nothing visible, so the driver's first draw of it (ANGLE builds
   * its executable there) happens in a work slice, not in a frame. */
  let warmed = false;
  let visibleCount = 0,
    tick = 0,
    bytes = 0,
    missing = false,
    dirty = true,
    /** A level was evicted since the blocks were made: the overviews of the whole town do not fit the budget. */
    spilled = false;
  let program: Program | undefined;
  /** The program the driver is linking (startVolumeProgram), from the first work slice on. */
  let linking: WebGLProgram | undefined;
  let scene: Building3dScene | undefined,
    heights: TerrainHeights | undefined,
    appearanceKey = '',
    night = 0;
  let paint: BuildingPaint | undefined, seat: BuildingSeat | undefined, appearance: UrbanBuildingAppearance | undefined, look: VolumeTownLook | undefined;
  const grain = new CoverGrainTexture(gl);
  let grainFilled = false;
  /** The grouping of a new scene into blocks, while it runs. */
  let grouping: BlockGrouping | undefined;
  /** The block level being built, part by part: parts never straddle a cell, so each cell's first vertex is known. */
  /** Then its buffer is allocated and the parts copied into it a few at a time (`uploaded` parts so far): a dense block's
   * detailed level holds megabytes, which one join and one upload kept the main thread on for tens of milliseconds. */
  let pending: { slot: Slot; level: number; next: number; parts: Float32Array[]; vertices: number; cell: number; cellFirst: Int32Array; uploaded: number; buffer?: WebGLBuffer } | undefined;
  const startJob = (slot: Slot, level: number): typeof pending => ({ slot, level, next: 0, parts: [], vertices: 0, cell: 0, cellFirst: new Int32Array(CELLS + 1), uploaded: 0 });

  const dropLevel = (slot: Slot, index: number): void => {
    const level = slot.levels[index];
    if (!level) return;
    gl.deleteBuffer(level.buffer);
    gl.deleteVertexArray(level.vao);
    bytes -= level.bytes;
    slot.levels[index] = undefined;
  };
  const dropAll = (): void => {
    for (const slot of slots) for (let i = 0; i < slot.levels.length; i++) dropLevel(slot, i);
    slots = [];
    blocks = [];
    visibleCount = 0;
    spilled = false;
  };

  /** The inputs of the page: a new scene, appearance or terrain starts the blocks again (grouped in later slices). */
  const sync = (): void => {
    const nextScene = options.scene(),
      nextHeights = options.terrain(),
      nextAppearance = options.appearance(),
      nextLook = options.look?.(),
      key = JSON.stringify({ ...nextAppearance, ambience: undefined, lightsOn: undefined }) + roofSeasonKey() + (nextLook ? '|' + nextLook.frame.key : '');
    const isNight = nextAppearance.ambience === 'night';
    night = isNight ? ((nextAppearance.lightsOn ?? isNight) ? 1 : 2) : 0;
    if (!dirty && nextScene === scene && nextHeights === heights && key === appearanceKey && nextLook === look) return;
    dirty = false;
    dropAll();
    if (pending?.buffer) gl.deleteBuffer(pending.buffer);
    pending = undefined;
    paint = undefined;
    scene = nextScene;
    heights = nextHeights;
    appearanceKey = key;
    appearance = nextAppearance;
    look = nextLook;
    grouping = scene && heights ? new BlockGrouping(scene, heights, heights.exaggeration) : undefined;
    seat = heights && worldSeat(heights, heights.exaggeration);
  };

  /** Copies the parts of a finished job into its buffer until `deadline`; once all are in, the level is installed.
   * True when the level is installed. */
  const uploadStep = (job: NonNullable<typeof pending>, deadline: number): boolean => {
    const stride = BUILDING_STRIDE * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, job.buffer ?? null);
    if (!job.buffer) {
      job.buffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, job.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, Math.max(4, job.vertices * stride), gl.STATIC_DRAW);
    }
    let offset = 0;
    for (let i = 0; i < job.uploaded; i++) offset += job.parts[i].byteLength;
    while (job.uploaded < job.parts.length) {
      const part = job.parts[job.uploaded++];
      if (part.length) gl.bufferSubData(gl.ARRAY_BUFFER, offset, part);
      offset += part.byteLength;
      if (performance.now() >= deadline) break;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    if (job.uploaded < job.parts.length) return false;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, job.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 36);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    job.slot.levels[job.level] = { vao, buffer: job.buffer, vertices: job.vertices, cellFirst: job.cellFirst, bytes: job.vertices * stride, used: tick };
    bytes += job.vertices * stride;
    return true;
  };
  /** The exact height range of what a part draws, for the view volume test. */
  const reach = (block: BuildingBlock, part: Float32Array): void => {
    for (let i = 0; i < part.length; i += BUILDING_STRIDE) {
      const z = part[i + 9] + part[i + 1];
      if (z < block.low) block.low = z;
      if (z > block.high) block.high = z;
    }
  };

  /** Over budget: the levels drawn least recently go, never one of the last frame. */
  const evict = (): void => {
    const budget = options.budgetBytes ?? BUDGET_BYTES;
    while (bytes > budget) {
      let oldest: Slot | undefined,
        oldestIndex = -1,
        used = tick;
      for (const slot of slots)
        for (let i = 0; i < slot.levels.length; i++) {
          const level = slot.levels[i];
          if (level && level.used < used) {
            used = level.used;
            oldest = slot;
            oldestIndex = i;
          }
        }
      if (!oldest) return;
      dropLevel(oldest, oldestIndex);
      spilled = true;
    }
  };

  /** Ends a work slice: notes its length. */
  const slice = (started: number, pending: boolean): boolean => {
    const ms = performance.now() - started;
    if (ms > stats.sliceMs) stats.sliceMs = ms;
    return pending;
  };

  /** The program once the driver has linked it: started in the first work slice, whatever the view (the map shows,
   * nothing tilts yet), polled in the next ones; false while it links. */
  const link = (): boolean => {
    if (program) return true;
    linking ??= startVolumeProgram(gl, WORLD_BUILDING_VS, WORLD_BUILDING_FS);
    if (!volumeProgramLinked(gl, linking, 'World buildings')) return false;
    program = { program: linking, u: uniformsOf(gl, linking, UNIFORMS) };
    linking = undefined;
    return true;
  };

  /** Adds a draw of the cell `cell` (-1: the whole block) of a slot at a level, or of the nearest level built meanwhile;
   * extends the previous draw when contiguous. The triangles it adds. */
  const addDraw = (slot: Slot, level: number, cell: number): number => {
    slot.need |= 1 << level;
    let built = slot.levels[level];
    if (!built) {
      missing = true;
      for (let step = 1; step < slot.block.levels && !built; step++) built = slot.levels[level + step] ?? slot.levels[level - step];
      if (!built) return 0;
    }
    built.used = tick;
    const first = cell < 0 ? 0 : built.cellFirst[cell],
      count = cell < 0 ? built.vertices : built.cellFirst[cell + 1] - first;
    if (!count) return 0;
    const last = drawTotal - 1;
    if (last >= 0 && drawSlot[last] === slot && drawLevel[last] === built && drawFirst[last] + drawCount[last] === first) drawCount[last] += count;
    else {
      if (drawTotal >= MAX_DRAWS) return 0;
      drawSlot[drawTotal] = slot;
      drawLevel[drawTotal] = built;
      drawFirst[drawTotal] = first;
      drawCount[drawTotal++] = count;
    }
    return count / 3;
  };
  /** The units of a frame (a whole block, or a cell of a near block): slot, cell (-1: whole), pixels its mean building
   * spans, the level its size asks for and the level it gets, and the triangles of that level. */
  const unitSlot: Slot[] = [],
    unitCell = new Int8Array(MAX_UNITS),
    unitPixels = new Float64Array(MAX_UNITS),
    unitWanted = new Int8Array(MAX_UNITS),
    unitLevel = new Int8Array(MAX_UNITS),
    unitCost = new Float64Array(MAX_UNITS),
    order = new Int32Array(MAX_UNITS);
  let unitCount = 0;
  /** Triangles a unit draws at a level: the level built, or the nearest built one shown meanwhile; 0 hidden. */
  const costOf = (slot: Slot, level: number, cell: number): number => {
    if (level >= slot.block.levels) return 0;
    let built = slot.levels[level];
    for (let step = 1; step < slot.block.levels && !built; step++) built = slot.levels[level + step] ?? slot.levels[level - step];
    if (!built) return 0;
    return (cell < 0 ? built.vertices : built.cellFirst[cell + 1] - built.cellFirst[cell]) / 3;
  };
  const addUnit = (slot: Slot, cell: number, pixels: number, level: number): void => {
    if (unitCount >= MAX_UNITS) return;
    unitSlot[unitCount] = slot;
    unitCell[unitCount] = cell;
    unitPixels[unitCount] = pixels;
    unitWanted[unitCount] = unitLevel[unitCount] = level;
    unitCost[unitCount++] = costOf(slot, level, cell);
  };
  /** The draws of the visible blocks: each block, or each cell of a near block, at the level its size asks for; past
   * BUDGET_TRIANGLES, the farthest units go one level coarser, round after round, until the frame fits. A unit whose
   * buildings span DETAILED_PIXELS keeps its full volumes whatever the budget: the near field never coarsens. The frame's
   * triangles. */
  const select = (tx: number, ty: number, focal: number, boxed: boolean): number => {
    unitCount = 0;
    drawTotal = 0;
    missing = false;
    stats.blocks = stats.demoted = 0;
    for (let v = 0; v < visibleCount; v++) {
      const slot = visible[v],
        b = slot.block,
        hidden = blockHidden(b),
        size = b.width * focal,
        depth = slot.depth,
        radius = visibleRadius[v],
        nearPixels = size / Math.max(1, depth - radius),
        near = blockLevel(b, nearPixels, boxed);
      slot.need = 0;
      if (near === hidden) continue;
      stats.blocks++;
      // One level over the block (all yards): one unit. Otherwise each cell at its own.
      if (b.yard || near === blockLevel(b, size / Math.max(1, depth + radius), boxed)) {
        addUnit(slot, -1, nearPixels, near);
        continue;
      }
      const z = visibleZ[v],
        cellRadius = Math.hypot(BLOCK_CELL * 0.71, visibleHalf[v]);
      for (let c = 0; c < CELLS; c++) {
        if (b.cells[c + 1] === b.cells[c]) continue;
        const cx = b.origin[0] + ((c % BLOCK_CELLS) + 0.5) * BLOCK_CELL - tx,
          cy = b.origin[1] + (Math.floor(c / BLOCK_CELLS) + 0.5) * BLOCK_CELL - ty;
        if (!volume.sees(cx, cy, z, cellRadius)) continue;
        const pixels = size / Math.max(1, volume.depth(cx, cy, z) - cellRadius),
          level = blockLevel(b, pixels, boxed);
        if (level !== hidden) addUnit(slot, c, pixels, level);
      }
    }
    let triangles = 0;
    for (let i = 0; i < unitCount; i++) triangles += unitCost[i];
    if (triangles > BUDGET_TRIANGLES) {
      // Farthest (smallest on screen) first.
      for (let i = 0; i < unitCount; i++) order[i] = i;
      order.subarray(0, unitCount).sort((p, q) => unitPixels[p] - unitPixels[q]);
      for (let round = 0; round < 4 && triangles > BUDGET_TRIANGLES; round++)
        for (let k = 0; k < unitCount && triangles > BUDGET_TRIANGLES; k++) {
          const i = order[k],
            slot = unitSlot[i];
          if (unitPixels[i] >= DETAILED_PIXELS || unitLevel[i] >= blockHidden(slot.block)) continue;
          const level = unitLevel[i] + 1,
            cost = costOf(slot, level, unitCell[i]);
          triangles += cost - unitCost[i];
          unitCost[i] = cost;
          unitLevel[i] = level;
          stats.demoted++;
        }
    }
    // In block and cell order, so the runs of one level of a block merge into one draw.
    let drawn = 0;
    for (let i = 0; i < unitCount; i++) if (unitLevel[i] < blockHidden(unitSlot[i].block)) drawn += addDraw(unitSlot[i], unitLevel[i], unitCell[i]);
    return drawn;
  };
  /** Draws the program once into a 1 x 1 target, with nothing on it (three equal vertices). */
  const warm = (): void => {
    warmed = true;
    const target = gl.createFramebuffer(),
      color = gl.createRenderbuffer(),
      depth = gl.createRenderbuffer(),
      vao = gl.createVertexArray(),
      buffer = gl.createBuffer();
    if (!target || !color || !depth || !vao || !buffer || !program) return;
    gl.bindRenderbuffer(gl.RENDERBUFFER, color);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, 1, 1);
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, 1, 1);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.viewport(0, 0, 1, 1);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(3 * BUILDING_STRIDE), gl.STATIC_DRAW);
    const stride = BUILDING_STRIDE * 4;
    for (const [location, size, offset] of [
      [0, 3, 0],
      [1, 3, 12],
      [2, 3, 24],
      [4, 1, 36],
    ]) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
    }
    gl.useProgram(program.program);
    volumeDepth(gl);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, grain.texture ?? null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    volumeDepthEnd(gl);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(target);
    gl.deleteRenderbuffer(color);
    gl.deleteRenderbuffer(depth);
    gl.deleteVertexArray(vao);
    gl.deleteBuffer(buffer);
  };

  return {
    name: 'buildings',
    tilts: true,
    tiltOnly: true,
    ready: () => true,
    restExact: frame => !volumesDrawn(frame.camera) || !missing,
    work(budgetMs, frame) {
      // Each step below is bounded: the grouping and the meshes go a chunk at a time, the link is polled.
      const started = performance.now(),
        deadline = started + budgetMs;
      sync();
      // The link runs in the driver's threads while the town is grouped and meshed; polled once per slice.
      const linked = link();
      // The top view's grain tiles, one family per slice, while the town takes its look.
      if (look && !grainFilled) {
        grainFilled = grain.step();
        if (grainFilled && frame?.camera.tilted) options.invalidate();
      }
      if (grouping) {
        if (!grouping.step(deadline)) return slice(started, true);
        paint = worldPaint(scene!, appearance!, grouping.altitudes, look);
        blocks = grouping.blocks;
        slots = grouping.blocks.map(block => ({ block, levels: new Array<Level | undefined>(block.levels).fill(undefined), need: 0, depth: Infinity, seen: -1 }));
        grouping = undefined;
        return slice(started, true);
      }
      if (!slots.length || !paint) return slice(started, false);
      if (!linked) return slice(started, true);
      if (!warmed) {
        warm();
        return slice(started, true);
      }
      let built = false;
      for (;;) {
        if (!pending) {
          // The level the last frame wanted for the nearest block that lacks it; else the overview of a block that
          // has nothing yet (built in the background, before the first tilt and while the view rests).
          let next: Slot | undefined,
            level = 0;
          for (const slot of slots) {
            if (slot.seen !== tick || (next && slot.depth >= next.depth)) continue;
            // The finest level it lacks among those the frame wanted.
            for (let l = 0; l < slot.block.levels; l++)
              if (slot.need & (1 << l) && !slot.levels[l]) {
                next = slot;
                level = l;
                break;
              }
          }
          if (next) pending = startJob(next, level);
          else if (!spilled) {
            // Not once the budget has spilled: an overview built then evicts another, which is bare again, without end.
            const bare = slots.find(slot => !slot.levels.some(Boolean));
            if (bare) pending = startJob(bare, bare.block.levels - 1);
          }
          if (!pending) break;
        }
        const job = pending!,
          cells = job.slot.block.cells,
          count = job.slot.block.buildings.length;
        while (job.next < count) {
          while (job.cell < CELLS && job.next >= cells[job.cell + 1]) job.cellFirst[++job.cell] = job.vertices;
          const to = Math.min(count, job.next + BUILD_CHUNK, job.cell < CELLS ? cells[job.cell + 1] : count),
            part = blockPart(job.slot.block, job.level, paint, seat!, job.next, to);
          reach(job.slot.block, part);
          job.parts.push(part);
          job.vertices += part.length / BUILDING_STRIDE;
          job.next = to;
          if (performance.now() >= deadline) break;
        }
        if (job.next >= count) {
          while (job.cell < CELLS) job.cellFirst[++job.cell] = job.vertices;
        }
        if (job.next >= count && performance.now() < deadline && uploadStep(job, deadline)) {
          pending = undefined;
          // A frame is due only for a block the last frame saw; an overview built ahead shows nothing new.
          built ||= job.slot.seen === tick;
        }
        if (performance.now() >= deadline) {
          if (built && frame?.camera.tilted) options.invalidate();
          return slice(started, true);
        }
      }
      if (built && frame?.camera.tilted) options.invalidate();
      evict();
      return slice(started, false);
    },
    draw(frame: LiveFrame) {
      const started = performance.now(),
        camera = frame.camera,
        drawn = volumesDrawn(camera);
      tick++;
      stats.drawCalls = stats.triangles = stats.blocks = 0;
      visibleCount = 0;
      missing = false;
      if (drawn && program) {
        volume.set(camera);
        const tx = camera.target[0],
          ty = camera.target[1],
          tz = camera.target[2],
          rise = camera.rise,
          focal = camera.focal / frame.dpr,
          boxed = options.boxed?.() ?? false;
        for (let s = 0; s < slots.length && visibleCount < visibleZ.length; s++) {
          const slot = slots[s],
            b = slot.block,
            low = b.low * rise,
            high = b.high * rise;
          const x = (b.minX + b.maxX) / 2 - tx,
            y = (b.minY + b.maxY) / 2 - ty,
            z = (low + high) / 2 - tz,
            radius = Math.hypot(b.maxX - b.minX, b.maxY - b.minY, high - low) / 2;
          if (!volume.sees(x, y, z, radius)) continue;
          const depth = volume.depth(x, y, z);
          // Under about a third of a pixel: nothing to see (the 3D view's rule).
          if (depth > radius && (radius * focal) / depth < 0.35) continue;
          slot.depth = depth;
          slot.seen = tick;
          visibleZ[visibleCount] = z;
          visibleHalf[visibleCount] = (high - low) / 2;
          visibleRadius[visibleCount] = radius;
          visible[visibleCount++] = slot;
        }
        // The levels by screen size, the far end coarser while the frame passes its triangle budget.
        select(tx, ty, focal, boxed);
        if (drawTotal) {
          const u = program.u;
          gl.useProgram(program.program);
          volumeDepth(gl);
          gl.uniformMatrix4fv(u.uProjection, false, camera.targetViewProjection);
          gl.uniform1f(u.uRise, rise);
          gl.uniform3f(u.uEye, camera.eye[0] - tx, camera.eye[1] - ty, camera.eye[2] - tz);
          gl.uniform2f(u.uAir, hazeDistance(camera), rise);
          gl.uniform3f(u.uHaze, VOLUME_HAZE[0], VOLUME_HAZE[1], VOLUME_HAZE[2]);
          gl.uniform1i(u.uNight, night);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D_ARRAY, grain.texture ?? null);
          gl.uniform1i(u.uCoverGrain, 0);
          let block: Slot | undefined;
          for (let i = 0; i < drawTotal; i++) {
            const slot = drawSlot[i];
            if (slot !== block) {
              block = slot;
              gl.uniform3f(u.uBlock, slot.block.origin[0] - tx, slot.block.origin[1] - ty, -tz);
            }
            gl.bindVertexArray(drawLevel[i].vao);
            gl.drawArrays(gl.TRIANGLES, drawFirst[i], drawCount[i]);
            stats.drawCalls++;
            stats.triangles += drawCount[i] / 3;
          }
          gl.bindVertexArray(null);
          gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
          volumeDepthEnd(gl);
        }
      }
      stats.bytes = bytes;
      stats.ms = performance.now() - started;
    },
    invalidate() {
      dirty = true;
    },
    pick(origin, direction, rise, limit, accept) {
      return heights && slots.length ? pickBuilding(blocks, origin, direction, rise, heights, heights.exaggeration, limit, accept) : undefined;
    },
    contextLost() {
      // Every handle is dead: forget them without deleting.
      for (const slot of slots) slot.levels.fill(undefined);
      bytes = 0;
      program = linking = undefined;
      pending = undefined; // its buffer died with the context
      visibleCount = drawTotal = 0;
      warmed = false;
      grain.lost();
      grainFilled = false;
    },
    stats: () => stats,
    dispose() {
      dropAll();
      if (pending?.buffer) gl.deleteBuffer(pending.buffer);
      pending = undefined;
      if (program) gl.deleteProgram(program.program);
      if (linking) gl.deleteProgram(linking);
      program = linking = undefined;
      scene = heights = undefined;
      grain.dispose();
      grainFilled = false;
    },
  };
}
