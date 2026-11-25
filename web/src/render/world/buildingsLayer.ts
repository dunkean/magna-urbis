/**
 * Building volumes created by worldVolumes and drawn by the live compositor after the draped town, against its terrain depth.
 * Selects block/cell levels by screen size, protecting buildings over DETAILED_PIXELS from budget demotion. Unbuilt levels
 * use their nearest built substitute; hidden volumes leave the town plan on the drape. buildingsCache owns mesh jobs,
 * staged uploads and level eviction; buildingsGrain owns roof marks. Draws build and upload no geometry.
 */
import { roofSeasonKey } from '../seasonPalette';
import type { Building3dScene } from '../urbanBuildingGeometry';
import { showsCraftedHouses, type UrbanBuildingAppearance } from '../urbanBuildingStyle';
import type { LiveFrame, LiveLayerStats } from '../live/contract';
import { BUILDING_STRIDE, type BuildingPaint, type BuildingSeat } from './buildingsMesh';
import { BLOCK_CELL, BLOCK_CELLS, BlockGrouping, YARD_HOUSE, blockHidden, blockLevel, worldPaint, worldSeat, yardBlockLevel, yardRise } from './buildingsBlocks';
import { WORLD_BUILDING_FS, WORLD_BUILDING_VS } from './buildingsShader';
import type { TerrainHeights } from './heights';
import { VOLUME_HAZE, ViewVolume, hazeDistance, startVolumeProgram, volumeProgramLinked, uniformsOf, volumeDepth, volumeDepthEnd, volumesDrawn, type VolumeLayer } from './volumes';
import { CAVE_DUSK, caveFogRange, type WorldCave } from './cave';
import { pickBuilding, type BuildingPick } from './buildingsPick';
import type { Building3dVisual } from '../urbanBuildingGeometry';
import { CoverGrainTexture } from './buildingsGrain';
import { HouseSurfaceTexture, houseSurfaceCount } from '../houseSurfaceTexture';
import { CRAFTED_BLOCK_MARGIN } from '../craftedMassingBounds';
import { BuildingBlockCache, type BuildingLevel as Level, type BuildingSlot as Slot } from './buildingsCache';
import type { VolumeTownLook } from '../city/buildingLook';
import { BuildingDiagnostics, layerDiagnosticsEnabled } from '../live/layerDiagnostics';
import { buildingTriangleBudget, getViewDepth, VIEW_DEPTH_MAX } from './viewDepth';
import { countWork } from '../workCount';

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
  /** The Underdark of the map (cave.ts): the town is lit by its lanterns and dissolves into the cave's darkness. */
  cave?(): WorldCave | undefined;
  /** A fast look: the buildings are drawn as boxes however near (blockLevel). */
  boxed?(): boolean;
  /** The same meshes draw the top view, including far buildings that have no draped plan copy. */
  topView?(): boolean;
  /** GPU memory the block levels may use, in bytes. */
  budgetBytes?: number;
  /** Asks for a frame (a wanted level was built). */
  invalidate(): void;
}

/** The buildings layer, and the building under a pixel of a tilted view (buildingsPick.ts), for the page's picking. */
export interface WorldBuildingsLayer extends VolumeLayer {
  presented(): boolean;
  /** The building first met by the ray from `origin` along `direction` (map metres, z as drawn) before `limit`, among
   * those `accept` takes; undefined before the town is grouped into blocks. CPU only, for a click. */
  pick(origin: ArrayLike<number>, direction: ArrayLike<number>, rise: number, limit: number, accept: (building: Building3dVisual) => boolean): BuildingPick | undefined;
}

/** Buildings spanning this many pixels keep their full volumes whatever the budget (the protected near field). */
const DETAILED_PIXELS = 18;
/** Units (blocks, cells of near blocks) a frame may weigh. */
const MAX_UNITS = 32768;
/** Draws a frame may issue: a block whole, or the runs of its cells that share a level. */
const MAX_DRAWS = 8192;
const CELLS = BLOCK_CELLS * BLOCK_CELLS;
/** Underdark: the fog range of the frame, refilled in place. */
const caveFog: [number, number] = [0, 1];
/** Pixels per metre between which the lot boundaries of the frame rise from the ground, refilled in place. */
const yardSizes: [number, number] = [0, 1];
/** Block caches of other looks kept for a switch back (their GPU levels stay allocated). */
const DORMANT_LOOKS = 2;
const UNIFORMS = ['uProjection', 'uBlock', 'uRise', 'uTop', 'uRoofInkDpr', 'uYard', 'uEye', 'uAir', 'uHaze', 'uNight', 'uCoverGrain', 'uCave', 'uHouseSurface', 'uHouseSurfaceReady'] as const;

type Program = { program: WebGLProgram; u: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null> };

export function createWorldBuildingsLayer(gl: WebGL2RenderingContext, options: WorldBuildingsOptions): WorldBuildingsLayer {
  const stats: LiveLayerStats = { drawCalls: 0, triangles: 0, ms: 0, bytes: 0 };
  let presentedScene: Building3dScene | undefined,
    missingDraw = false,
    presented = false;
  const diagnostics = layerDiagnosticsEnabled() ? new BuildingDiagnostics(stats) : undefined;
  const volume = new ViewVolume();
  const newCache = (): BuildingBlockCache => new BuildingBlockCache(gl, () => options.budgetBytes, getViewDepth);
  let cache = newCache();
  /** The block caches of other looks of the town on this relief, by appearance key, most recent last: a switch back to
   * a look finds its meshes. The blocks (grouped) depend on the scene only, which a look may keep. */
  const dormant = new Map<string, { scene: Building3dScene; heights: TerrainHeights; grouped: Pick<BlockGrouping, 'blocks' | 'altitudes'>; cache: BuildingBlockCache; detailed: boolean }>();
  let grouped: Pick<BlockGrouping, 'blocks' | 'altitudes'> | undefined;
  const dropDormant = (lost = false): void => {
    for (const held of dormant.values()) {
      if (lost) held.cache.contextLost();
      else held.cache.clear();
    }
    dormant.clear();
  };
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
    dirty = true;
  let program: Program | undefined;
  /** The program the driver is linking (startVolumeProgram), from the first work slice on. */
  let linking: WebGLProgram | undefined;
  let scene: Building3dScene | undefined,
    heights: TerrainHeights | undefined,
    appearanceKey = '',
    night = 0;
  let paint: BuildingPaint | undefined, seat: BuildingSeat | undefined, appearance: UrbanBuildingAppearance | undefined, look: VolumeTownLook | undefined;
  const grain = new CoverGrainTexture(gl);
  let houseSurfaces: HouseSurfaceTexture | undefined;
  let grainFilled = false;
  /** The grouping of a new scene into blocks, while it runs. */
  let grouping: BlockGrouping | undefined;
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
    // Another look of the same town: its meshes (vertex colours) are made again on the same blocks, and the current
    // cache waits for a switch back.
    const sameTown = !dirty && nextScene === scene && nextHeights === heights && !!grouped && !!scene && !!heights;
    if (sameTown && paint && key === appearanceKey) {
      // A new look object with the same frame: the same meshes.
      appearance = nextAppearance;
      look = nextLook;
      paint = worldPaint(scene!, appearance, grouped!.altitudes, look);
      return;
    }
    const leavingDetailed = showsCraftedHouses(appearance) && !showsCraftedHouses(nextAppearance);
    if (leavingDetailed) {
      houseSurfaces?.dispose();
      houseSurfaces = undefined;
      for (const [saved, held] of dormant) if (held.detailed) {
        held.cache.clear();
        dormant.delete(saved);
      }
    }
    if (!leavingDetailed && !dirty && scene && heights && grouped && paint) {
      dormant.delete(appearanceKey);
      dormant.set(appearanceKey, { scene, heights, grouped, cache, detailed: showsCraftedHouses(appearance) });
      if (dormant.size > DORMANT_LOOKS) {
        const [oldest, held] = dormant.entries().next().value!;
        held.cache.clear();
        dormant.delete(oldest);
      }
    } else cache.clear();
    if (dirty) dropDormant();
    dirty = false;
    clearSelection();
    scene = nextScene;
    heights = nextHeights;
    appearanceKey = key;
    appearance = nextAppearance;
    look = nextLook;
    seat = heights && worldSeat(heights, heights.exaggeration);
    // Entries of another relief are stale.
    for (const [k, held] of dormant)
      if (held.heights !== heights) {
        held.cache.clear();
        dormant.delete(k);
      }
    const back = dormant.get(key);
    dormant.delete(key);
    if (back && back.scene !== scene) back.cache.clear();
    const kept = back?.scene === scene ? back : undefined,
      blocks = kept?.grouped ?? (sameTown ? grouped : [...dormant.values()].find(held => held.scene === scene)?.grouped);
    cache = kept?.cache ?? newCache();
    if (scene && heights && blocks) {
      // The same key is the same look (its frame's key); the look object of the new appearance paints the levels still to build.
      grouped = blocks;
      paint = worldPaint(scene, appearance, blocks.altitudes, look);
      if (!kept) cache.setBlocks(blocks.blocks);
      grouping = undefined;
      return;
    }
    grouped = undefined;
    paint = undefined;
    if (scene && heights) countWork('volumes.group');
    grouping = scene && heights ? new BlockGrouping(scene, heights, heights.exaggeration) : undefined;
  };

  /** Work pending is returned independently of the optional slice measurement. */
  const slice = (started: number, pending: boolean): boolean => {
    diagnostics?.slice(started);
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
      for (let step = 1; step < slot.block.levels && !built; step++) built = slot.levels[level + step] ?? slot.levels[level - step];
      if (!built) {
        missingDraw = true;
        return 0;
      }
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
   * spans, the level it gets, and the triangles of that level. */
  const unitSlot: Slot[] = [],
    unitCell = new Int8Array(MAX_UNITS),
    unitPixels = new Float64Array(MAX_UNITS),
    unitLevel = new Int8Array(MAX_UNITS),
    unitCost = new Float64Array(MAX_UNITS),
    order = new Int32Array(MAX_UNITS);
  let unitCount = 0;
  // Scratch arrays hold source blocks (and their buildings) by reference. Release the previous town's selection
  // when replacing a cache, even when a smaller town would never overwrite all its entries.
  const clearSelection = (): void => {
    presented = false;
    visible.length = drawSlot.length = drawLevel.length = unitSlot.length = 0;
    visibleCount = drawTotal = unitCount = 0;
  };
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
    unitLevel[unitCount] = level;
    unitCost[unitCount++] = costOf(slot, level, cell);
  };
  /** The draws of the visible blocks: each block, or each cell of a near block, at the level its size asks for; past
   * the depth's triangle budget, the farthest units go one level coarser, round after round, until the frame fits. A unit whose
   * buildings span DETAILED_PIXELS keeps its full volumes whatever the budget: the near field never coarsens. The frame's
   * triangles. */
  const select = (tx: number, ty: number, focal: number, boxed: boolean | 'overview', keepFar: boolean, flat: boolean, panelRise: number): number => {
    const depthSetting = getViewDepth(),
      budget = buildingTriangleBudget(depthSetting),
      wholeTown = keepFar || depthSetting >= VIEW_DEPTH_MAX;
    unitCount = 0;
    drawTotal = 0;
    diagnostics?.selection();
    for (let v = 0; v < visibleCount; v++) {
      const slot = visible[v],
        b = slot.block,
        hidden = blockHidden(b),
        size = b.width * focal,
        depth = slot.depth,
        radius = visibleRadius[v],
        nearPixels = size / Math.max(1, depth - radius);
      slot.need = 0;
      // Near the zenith the face of a wooden panel projects to less than one pixel even in a close view.
      const near = b.yard ? (slot.yardLevel = yardBlockLevel(b, nearPixels, slot.yardLevel, nearPixels * panelRise, depthSetting)) : blockLevel(b, nearPixels, boxed, depthSetting, keepFar);
      if (near === hidden) continue;
      diagnostics?.block();
      // One level over the block (all yards): one unit. Otherwise each cell at its own.
      if (flat || b.yard || near === blockLevel(b, size / Math.max(1, depth + radius), boxed, depthSetting, keepFar)) {
        addUnit(slot, -1, b.yard ? nearPixels * YARD_HOUSE : nearPixels, near);
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
          level = blockLevel(b, pixels, boxed, depthSetting, keepFar);
        if (level !== hidden) addUnit(slot, c, pixels, level);
      }
    }
    let triangles = 0;
    for (let i = 0; i < unitCount; i++) triangles += unitCost[i];
    if (triangles > budget) {
      // Farthest (smallest on screen) first.
      for (let i = 0; i < unitCount; i++) order[i] = i;
      order.subarray(0, unitCount).sort((p, q) => unitPixels[p] - unitPixels[q]);
      for (let round = 0; round < 4 && triangles > budget; round++)
        for (let k = 0; k < unitCount && triangles > budget; k++) {
          const i = order[k],
            slot = unitSlot[i];
          // Lot boundaries leave with the distance alone, sunk into the ground; a busy frame only thins their mesh.
          const coarsest = blockHidden(slot.block) - (wholeTown || slot.block.yard ? 1 : 0);
          if (unitPixels[i] >= DETAILED_PIXELS || unitLevel[i] >= coarsest) continue;
          const level = unitLevel[i] + 1,
            cost = costOf(slot, level, unitCell[i]);
          triangles += cost - unitCost[i];
          unitCost[i] = cost;
          unitLevel[i] = level;
          diagnostics?.demoted();
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
    get tiltOnly() {
      return !options.topView?.();
    },
    presented: () => presented && presentedScene === options.scene(),
    ready: () => true,
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
        if (grainFilled && (frame?.camera.tilted || options.topView?.())) options.invalidate();
      }
      if (grouping) {
        if (!grouping.step(deadline)) return slice(started, true);
        paint = worldPaint(scene!, appearance!, grouping.altitudes, look);
        cache.setBlocks(grouping.blocks);
        grouped = grouping;
        grouping = undefined;
        return slice(started, true);
      }
      if (!cache.slots.length || !paint) return slice(started, false);
      if (!linked) return slice(started, true);
      if (!warmed) {
        warm();
        return slice(started, true);
      }
      const more = cache.work(deadline, tick, paint, seat!, () => {
        if (frame?.camera.tilted || options.topView?.()) options.invalidate();
      });
      if (showsCraftedHouses(appearance) && (houseSurfaces?.ready ?? 0) < houseSurfaceCount()) {
        houseSurfaces ??= new HouseSurfaceTexture(gl);
        const before = houseSurfaces.ready;
        const caughtUp = houseSurfaces.step();
        if (houseSurfaces.ready > before) options.invalidate();
        return slice(started, more || !caughtUp);
      }
      return slice(started, more);
    },
    draw(frame: LiveFrame) {
      const started = performance.now(),
        camera = frame.camera,
        keepFar = !!options.topView?.(),
        flat = !camera.tilted,
        drawn = keepFar || volumesDrawn(camera);
      if (keepFar && (dirty || scene !== options.scene() || heights !== options.terrain() || look !== options.look?.())) sync();
      missingDraw = false;
      tick++;
      stats.drawCalls = stats.triangles = 0;
      diagnostics?.frame();
      visibleCount = 0;
      if (drawn && program) {
        volume.set(camera);
        const tx = camera.target[0],
          ty = camera.target[1],
          tz = camera.target[2],
          rise = camera.rise,
          focal = flat ? frame.view.scale : camera.focal / frame.dpr,
          roof = appearance?.roof,
          detailed = showsCraftedHouses(appearance),
          boxed = roof === 'minimal' || (options.boxed?.() ? (roof === 'flat' || roof === 'v1' || roof === 'crafted' ? 'overview' : true) : false),
          depthSetting = getViewDepth();
        for (let s = 0; s < cache.slots.length && visibleCount < visibleZ.length; s++) {
          const slot = cache.slots[s],
            b = slot.block;
          // The flat town already draws antialiased fence strokes, including the gate jambs.
          if (flat && b.yard) continue;
          const low = b.low * rise,
            high = b.high * rise;
          const x = (b.minX + b.maxX) / 2 - tx,
            y = (b.minY + b.maxY) / 2 - ty,
            z = (low + high) / 2 - tz,
            radius = Math.hypot(b.maxX - b.minX, b.maxY - b.minY, high - low) / 2 + (detailed && !b.yard ? CRAFTED_BLOCK_MARGIN * Math.hypot(1,rise) : 0);
          if (!volume.sees(x, y, z, radius)) continue;
          const depth = flat ? 1 : volume.depth(x, y, z);
          // The depth preference extends the subpixel cutoff; maximum depth retains every visible building block.
          if (!keepFar && depthSetting < VIEW_DEPTH_MAX && depth > radius && (radius * focal * depthSetting) / depth < 0.35) continue;
          slot.depth = depth;
          slot.seen = tick;
          visibleZ[visibleCount] = z;
          visibleHalf[visibleCount] = (high - low) / 2;
          visibleRadius[visibleCount] = flat ? 0 : radius;
          visible[visibleCount++] = slot;
        }
        // The levels by screen size, the far end coarser while the frame passes its triangle budget.
        select(tx, ty, focal, boxed, keepFar, flat, rise * Math.abs(camera.up[2]));
        if (drawTotal) {
          const u = program.u;
          gl.useProgram(program.program);
          volumeDepth(gl);
          gl.uniformMatrix4fv(u.uProjection, false, camera.targetViewProjection);
          gl.uniform1f(u.uRise, rise);
          gl.uniform1i(u.uTop, flat ? 1 : 0);
          gl.uniform1f(u.uRoofInkDpr, roof === 'v1' ? frame.dpr : 0);
          yardRise(depthSetting, yardSizes);
          gl.uniform3f(u.uYard, focal, yardSizes[0], yardSizes[1]);
          gl.uniform3f(u.uEye, camera.eye[0] - tx, camera.eye[1] - ty, camera.eye[2] - tz);
          gl.uniform2f(u.uAir, hazeDistance(camera), rise);
          const cave = flat ? undefined : options.cave?.();
          if (cave) {
            const fog = caveFogRange(cave, camera, heights?.exaggeration ?? 1, caveFog);
            gl.uniform3f(u.uHaze, CAVE_DUSK[0], CAVE_DUSK[1], CAVE_DUSK[2]);
            gl.uniform4f(u.uCave, cave.lightsOn ? 1 : 2, cave.lightsOn ? 1.25 - 0.35 * cave.settings.darkness : 0.08, fog[0], fog[1]);
          } else {
            gl.uniform3f(u.uHaze, VOLUME_HAZE[0], VOLUME_HAZE[1], VOLUME_HAZE[2]);
            gl.uniform4f(u.uCave, 0, 1, 1e9, 2e9);
          }
          gl.uniform1i(u.uNight, night);
          if (detailed) {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, houseSurfaces?.texture ?? null);
            gl.uniform1i(u.uHouseSurface, 1);
          }
          gl.uniform1f(u.uHouseSurfaceReady, detailed ? (houseSurfaces?.ready ?? 0) : 0);
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
            const level = drawLevel[i];
            gl.bindVertexArray(level.vao);
            if (level.indexBytes) gl.drawElements(gl.TRIANGLES, drawCount[i], level.indexBytes === 2 ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT, drawFirst[i] * level.indexBytes);
            else gl.drawArrays(gl.TRIANGLES, drawFirst[i], drawCount[i]);
            stats.drawCalls++;
            stats.triangles += drawCount[i] / 3;
          }
          gl.bindVertexArray(null);
          if (detailed) {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
          }
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
          volumeDepthEnd(gl);
        }
      }
      presented = drawn && !grouping && !missingDraw && (!scene || !!program);
      presentedScene = scene;
      stats.bytes = cache.bytes;
      stats.ms = performance.now() - started;
    },
    invalidate() {
      dirty = true;
    },
    pick(origin, direction, rise, limit, accept) {
      return heights && cache.slots.length ? pickBuilding(cache.blocks, origin, direction, rise, heights, heights.exaggeration, limit, accept, showsCraftedHouses(appearance)) : undefined;
    },
    contextLost() {
      // Every handle is dead: forget them without deleting.
      cache.contextLost();
      dropDormant(true);
      program = linking = undefined;
      clearSelection();
      warmed = false;
      grain.lost();
      houseSurfaces?.lost();
      grainFilled = false;
    },
    stats: () => stats,
    dispose() {
      cache.clear();
      dropDormant();
      clearSelection();
      if (program) gl.deleteProgram(program.program);
      if (linking) gl.deleteProgram(linking);
      program = linking = undefined;
      scene = heights = undefined;
      grouping = grouped = undefined;
      paint = seat = look = undefined;
      grain.dispose();
      houseSurfaces?.dispose();
      grainFilled = false;
    },
  };
}
