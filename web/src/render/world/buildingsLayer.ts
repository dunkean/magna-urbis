/**
 * The town's buildings as volumes in the tilted world view (volumes.ts): the same meshes, colours, material grain and
 * levels of detail as the separate 3D view (buildingsMesh.ts), standing on the relief the draped ground shows
 * (TerrainHeights), drawn after it with depth.
 *
 * Built once per scene, appearance and terrain, block by block in work slices (buildingsBlocks.ts): the blocks a frame
 * saw at the level it wanted first, nearest first, then the overview of every other block so a turn finds them. Each
 * block level is one vertex buffer and one draw. A frame tests the blocks against the view volume, picks each block's
 * level (an unbuilt level shows the nearest built one meanwhile) and draws: no upload, no allocation, no geometry.
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
import { BlockGrouping, blockHidden, blockLevel, blockPart, joinParts, worldPaint, worldSeat, type BuildingBlock } from './buildingsBlocks';
import { WORLD_BUILDING_FS, WORLD_BUILDING_VS } from './buildingsShader';
import type { TerrainHeights } from './heights';
import { VOLUME_HAZE, ViewVolume, hazeDistance, linkVolumeProgram, uniformsOf, volumeDepth, volumeDepthEnd, volumesDrawn, type VolumeLayer } from './volumes';

export interface WorldBuildingsOptions {
  /** The display scene of the town (what the separate 3D view draws); undefined: no town. Compared by identity: a new
   * object is a new town and starts the blocks again. */
  scene(): Building3dScene | undefined;
  /** The building appearance of the page (style, colours, snow, night). */
  appearance(): UrbanBuildingAppearance;
  /** The relief of the map, the draped ground's; undefined: nothing to stand on yet. */
  terrain(): TerrainHeights | undefined;
  /** GPU memory the block levels may use, in bytes. */
  budgetBytes?: number;
  /** Asks for a frame (a wanted level was built). */
  invalidate(): void;
}

/** Buildings meshed between two looks at the clock. */
const BUILD_CHUNK = 8;
/** The separate 3D view's cache budget. */
const BUDGET_BYTES = 96 * 1024 * 1024;
const UNIFORMS = ['uProjection', 'uBlock', 'uRise', 'uEye', 'uAir', 'uHaze', 'uNight'] as const;
type Program = { program: WebGLProgram; u: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null> };

interface Level {
  vao: WebGLVertexArrayObject;
  buffer: WebGLBuffer;
  vertices: number;
  bytes: number;
  /** Draw tick it was last shown in. */
  used: number;
}
interface Slot {
  block: BuildingBlock;
  levels: (Level | undefined)[];
  /** Level wanted and level shown at the last draw that saw the block (-1: none yet). */
  want: number;
  shown: number;
  /** Depth along the view axis at that draw, and its tick. */
  depth: number;
  seen: number;
}

export function createWorldBuildingsLayer(gl: WebGL2RenderingContext, options: WorldBuildingsOptions): VolumeLayer {
  /** `blocks` drawn, `bytes` on the GPU, `sliceMs` the longest work slice so far. */
  const stats: LiveLayerStats = { drawCalls: 0, triangles: 0, ms: 0, blocks: 0, bytes: 0, sliceMs: 0 };
  const volume = new ViewVolume();
  let slots: Slot[] = [];
  const visible: Slot[] = [];
  let visibleCount = 0,
    tick = 0,
    bytes = 0,
    missing = false,
    dirty = true;
  let program: Program | undefined;
  let scene: Building3dScene | undefined,
    heights: TerrainHeights | undefined,
    appearanceKey = '',
    night = 0;
  let paint: BuildingPaint | undefined, seat: BuildingSeat | undefined, appearance: UrbanBuildingAppearance | undefined;
  /** The grouping of a new scene into blocks, while it runs. */
  let grouping: BlockGrouping | undefined;
  /** The block level being built, part by part. */
  let pending: { slot: Slot; level: number; next: number; parts: Float32Array[] } | undefined;

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
    visibleCount = 0;
  };

  /** The inputs of the page: a new scene, appearance or terrain starts the blocks again (grouped in later slices). */
  const sync = (): void => {
    const nextScene = options.scene(),
      nextHeights = options.terrain(),
      look = options.appearance(),
      key = JSON.stringify({ ...look, ambience: undefined, lightsOn: undefined }) + roofSeasonKey();
    const isNight = look.ambience === 'night';
    night = isNight ? ((look.lightsOn ?? isNight) ? 1 : 2) : 0;
    if (!dirty && nextScene === scene && nextHeights === heights && key === appearanceKey) return;
    dirty = false;
    dropAll();
    pending = undefined;
    paint = undefined;
    scene = nextScene;
    heights = nextHeights;
    appearanceKey = key;
    appearance = look;
    grouping = scene && heights ? new BlockGrouping(scene, heights, heights.exaggeration) : undefined;
    seat = heights && worldSeat(heights, heights.exaggeration);
  };

  /** Uploads a block level built from its parts. */
  const upload = (slot: Slot, index: number, data: Float32Array): void => {
    const vertices = data.length / BUILDING_STRIDE,
      block = slot.block;
    // The exact height range of what the block draws, for the view volume test.
    for (let i = 0; i < data.length; i += BUILDING_STRIDE) {
      const z = data[i + 9] + data[i + 1];
      if (z < block.low) block.low = z;
      if (z > block.high) block.high = z;
    }
    const vao = gl.createVertexArray()!,
      buffer = gl.createBuffer()!,
      stride = BUILDING_STRIDE * 4;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
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
    slot.levels[index] = { vao, buffer, vertices, bytes: data.byteLength, used: tick };
    bytes += data.byteLength;
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
    }
  };

  /** Ends a work slice: notes its length. */
  const slice = (started: number, pending: boolean): boolean => {
    const ms = performance.now() - started;
    if (ms > stats.sliceMs) stats.sliceMs = ms;
    return pending;
  };

  const link = (): Program => {
    const linked = linkVolumeProgram(gl, WORLD_BUILDING_VS, WORLD_BUILDING_FS, 'World buildings');
    return { program: linked, u: uniformsOf(gl, linked, UNIFORMS) };
  };

  return {
    name: 'buildings',
    tilts: true,
    ready: () => true,
    restExact: frame => !volumesDrawn(frame.camera) || !missing,
    work(budgetMs, frame) {
      // Each step below is bounded: the grouping and the meshes go a chunk at a time, a program link is one step.
      const started = performance.now(),
        deadline = started + budgetMs;
      sync();
      if (grouping) {
        if (!grouping.step(deadline)) return slice(started, true);
        paint = worldPaint(scene!, appearance!, grouping.altitudes);
        slots = grouping.blocks.map(block => ({ block, levels: new Array<Level | undefined>(block.levels).fill(undefined), want: block.levels - 1, shown: -1, depth: Infinity, seen: -1 }));
        grouping = undefined;
        return slice(started, true);
      }
      if (!slots.length || !paint) return slice(started, false);
      if (!program) {
        program = link();
        return slice(started, true);
      }
      let built = false;
      for (;;) {
        if (!pending) {
          // The level the last frame wanted for the nearest block that lacks it; else the overview of a block that
          // has nothing yet (built in the background, before the first tilt and while the view rests).
          let next: Slot | undefined;
          for (const slot of slots) if (slot.seen === tick && slot.want < slot.block.levels && !slot.levels[slot.want] && (!next || slot.depth < next.depth)) next = slot;
          if (next) pending = { slot: next, level: next.want, next: 0, parts: [] };
          else {
            const bare = slots.find(slot => !slot.levels.some(Boolean));
            if (bare) pending = { slot: bare, level: bare.block.levels - 1, next: 0, parts: [] };
          }
          if (!pending) break;
        }
        const job = pending,
          count = job.slot.block.buildings.length;
        do {
          const to = Math.min(count, job.next + BUILD_CHUNK);
          job.parts.push(blockPart(job.slot.block, job.level, paint, seat!, job.next, to));
          job.next = to;
        } while (job.next < count && performance.now() < deadline);
        if (job.next >= count) {
          upload(job.slot, job.level, joinParts(job.parts));
          pending = undefined;
          built = true;
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
          focal = camera.focal / frame.dpr;
        for (let s = 0; s < slots.length; s++) {
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
          const want = blockLevel(b, (b.width * focal) / Math.max(1, depth - radius), slot.shown >= 0 ? slot.shown : slot.want);
          slot.want = want;
          // Under a pixel: the drape shows the town plan.
          if (want === blockHidden(b)) {
            slot.shown = want;
            continue;
          }
          slot.depth = depth;
          slot.seen = tick;
          let index = want;
          if (!slot.levels[want]) {
            missing = true;
            // Meanwhile the nearest level built, coarser first.
            index = -1;
            for (let step = 1; step < b.levels && index < 0; step++) {
              if (slot.levels[want + step]) index = want + step;
              else if (slot.levels[want - step]) index = want - step;
            }
            if (index < 0) continue;
          }
          slot.shown = index;
          slot.levels[index]!.used = tick;
          visible[visibleCount++] = slot;
        }
        if (visibleCount) {
          const u = program.u;
          gl.useProgram(program.program);
          volumeDepth(gl);
          gl.uniformMatrix4fv(u.uProjection, false, camera.targetViewProjection);
          gl.uniform1f(u.uRise, rise);
          gl.uniform3f(u.uEye, camera.eye[0] - tx, camera.eye[1] - ty, camera.eye[2] - tz);
          gl.uniform2f(u.uAir, hazeDistance(camera), rise);
          gl.uniform3f(u.uHaze, VOLUME_HAZE[0], VOLUME_HAZE[1], VOLUME_HAZE[2]);
          gl.uniform1i(u.uNight, night);
          for (let i = 0; i < visibleCount; i++) {
            const slot = visible[i],
              level = slot.levels[slot.shown]!;
            gl.uniform3f(u.uBlock, slot.block.origin[0] - tx, slot.block.origin[1] - ty, -tz);
            gl.bindVertexArray(level.vao);
            gl.drawArrays(gl.TRIANGLES, 0, level.vertices);
            stats.drawCalls++;
            stats.triangles += level.vertices / 3;
          }
          stats.blocks = visibleCount;
          gl.bindVertexArray(null);
          volumeDepthEnd(gl);
        }
      }
      stats.bytes = bytes;
      stats.ms = performance.now() - started;
    },
    invalidate() {
      dirty = true;
    },
    contextLost() {
      // Every handle is dead: forget them without deleting.
      for (const slot of slots) slot.levels.fill(undefined);
      bytes = 0;
      program = undefined;
      pending = undefined;
      visibleCount = 0;
    },
    stats: () => stats,
    dispose() {
      dropAll();
      if (program) gl.deleteProgram(program.program);
      program = undefined;
      scene = heights = undefined;
    },
  };
}
