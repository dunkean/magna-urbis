/**
 * The modelled trees of the tilted world view (volumes.ts): the satellite looks' near trees of the 3D view (sizes by
 * biome, social classes, giants, stems, crowns: ui/terrain3dTrees.ts), standing on TerrainHeights, drawn after the
 * terrain with depth.
 *
 * Instances are built per block of the map (treesBlocks.ts), once per content, in work slices of 24 m, the blocks a
 * frame wanted nearest the eye first (only blocks in view: what lies behind or under the eye is never built), and kept
 * on the GPU within a byte budget. A frame draws the blocks in view within the tree distance, horizontally, of the
 * target (the ground point at the centre of the view) or of the eye's ground point: one instanced draw each, the
 * lathe coarser and the block thinned as its trees get smaller on screen (treesBlocks.ts), nothing under a pixel and a
 * half; beyond, the painted crowns of the ground carry the forest. No rule measures the eye's distance (the eye moves
 * away and down as an orbit tilts at a fixed scale), so a tilt or a turn adds or removes trees at the far end only,
 * never around the target or in front of the eye. A frame builds and uploads nothing, and allocates nothing.
 */
import type { LiveFrame, LiveLayerStats } from '../live/contract';
import { TREE_STRIDE, treeLimits, type TreeInputs, type TreeLimits } from '../../ui/terrain3dTrees';
import type { TerrainHeights } from './heights';
import { TREES_BLOCK, TREE_CELLS, TREE_SIZE_M, treeBlockSteps, treeDrawCount, treeInputsKey, treeLevel, type TreeBlock } from './treesBlocks';
import { SATELLITE_TREES, TREE_LATHES, WORLD_TREE_FS, WORLD_TREE_VS, latheVertices, type TreePalette } from './treesShader';
import { VOLUME_LIGHT, ViewVolume, hazeDistance, startVolumeProgram, volumeProgramLinked, uniformsOf, volumeDepth, volumeDepthEnd, volumesDrawn, type VolumeLayer } from './volumes';

export interface WorldTreesOptions {
  /** The inputs of the near trees of the satellite looks, as the 3D view makes them (ui/view3d/terrain/trees.ts),
   * without `height` (the trees stand on `terrain`); undefined: no modelled trees (another look, or switched off). A
   * new object is compared by content (treeInputsKey) and by its water cover function. */
  inputs(): Omit<TreeInputs, 'height'> | undefined;
  terrain(): TerrainHeights | undefined;
  /** Tree distance (m), the 3D view's slider (clampTreeDistance): a horizontal radius around the target. */
  distance(): number;
  /** The "3D trees" switch: off, nothing is drawn or built, and the blocks already built are kept for the next time. */
  shown(): boolean;
  /** Night ambience: the trees take the night tint. */
  night?(): boolean;
  /** The colours of the look (SATELLITE_TREES when absent): uniforms, so a change of look rebuilds no block. */
  palette?(): TreePalette;
  /** GPU memory the blocks may use, in bytes. */
  budgetBytes?: number;
  /** Asks for a frame (a wanted block was built). */
  invalidate(): void;
}

const BUDGET_BYTES = 32 * 1024 * 1024;
/** Blocks a frame may want: the two discs of the tree distance (target, eye ground point) at 1500 m. */
const MAX_BLOCKS = 2048;
/** Draws a frame may issue: a block whole, or the runs of its cells that share a level (near blocks). */
const MAX_DRAWS = 8192;
/** Triangles a frame of trees may take at the default tree distance (600 m); the budget grows with the area of the
 * distance (the owner: the far sight at its maximum may cost about 2 M, never the view). */
const BUDGET_TRIANGLES = 250000,
  BUDGET_MAX = 2000000;
const treeBudget = (far: number): number => Math.min(BUDGET_MAX, BUDGET_TRIANGLES * (far / 600) ** 2);
/** Past this coarsening every tree on screen is an impostor (60 px / 2 px): only then does the budget thin. */
const MAX_COARSER = 30;
/** Radius of the `inner` statistic around the target (m): a sweep of the pitch at a fixed target and scale counts it. */
const INNER_METRES = 300;
/** Side of a cell of a block (m). */
const CELL = TREES_BLOCK / TREE_CELLS;
const UNIFORMS = ['uProjection', 'uBlock', 'uRelief', 'uFade', 'uLathe', 'uCrown', 'uFacing', 'uTrunk', 'uRepaintLow', 'uRepaintHigh', 'uRepaint', 'eye', 'treeLight', 'fogDistance', 'uNight'] as const;
type Program = { program: WebGLProgram; u: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null> };
const CROWNS = TREE_LATHES.map(lathe => Int32Array.from({ length: 6 }, (_, i) => lathe.crown[i] ?? 5));
const VERTICES = TREE_LATHES.map(latheVertices);
/** The light in the 3D view's frame (x, up, y south), as the tree fragment shader reads it. */
const LIGHT = [VOLUME_LIGHT[0], VOLUME_LIGHT[2], VOLUME_LIGHT[1]] as const;

/** Horizontal distance from a point to the block whose north-west corner is (minX, minY). */
const gapTo = (minX: number, minY: number, x: number, y: number): number => Math.hypot(Math.max(minX - x, 0, x - minX - TREES_BLOCK), Math.max(minY - y, 0, y - minY - TREES_BLOCK));

interface Slot {
  vao?: WebGLVertexArrayObject;
  buffer?: WebGLBuffer;
  count: number;
  bytes: number;
  used: number;
  /** Ground height range of its trees (m, before exaggeration) and its tallest tree. */
  low: number;
  high: number;
  top: number;
  /** First instance of each cell (TreeBlock.cells). */
  cells: Int32Array;
}
interface Building {
  key: number;
  steps: Generator<void, TreeBlock>;
  ms: number;
}

export function createWorldTreesLayer(gl: WebGL2RenderingContext, options: WorldTreesOptions): VolumeLayer {
  /** `instances` drawn, `inner` of them in blocks wholly within 300 m of the target (a pitch or yaw
   * sweep at a fixed target and scale keeps it while those blocks stay on screen), `front` of them in view within the
   * tree distance of the eye's ground point (the trees in front of a low camera), `blocks` drawn, `bytes` on the
   * GPU, `built` blocks built so far, `blockMs` build time of the last block, `sliceMs` the longest work slice. */
  const stats: LiveLayerStats = { drawCalls: 0, triangles: 0, ms: 0, instances: 0, inner: 0, front: 0, coarser: 1, thinner: 1, blocks: 0, bytes: 0, built: 0, blockMs: 0, sliceMs: 0 };
  const volume = new ViewVolume();
  const slots = new Map<number, Slot>();
  const wantKey = new Float64Array(MAX_BLOCKS),
    wantPriority = new Float64Array(MAX_BLOCKS),
    // The draws of a frame: slot, block key, level, first instance, instances.
    drawn: Slot[] = [],
    drawnKey = new Float64Array(MAX_DRAWS),
    drawnLathe = new Int8Array(MAX_DRAWS),
    drawnFirst = new Int32Array(MAX_DRAWS),
    drawnCount = new Int32Array(MAX_DRAWS);
  // The built blocks in view of a frame: slot, key, height centre and half range, depth, radius.
  const visible: Slot[] = [],
    visibleKey = new Float64Array(MAX_BLOCKS),
    visibleZ = new Float64Array(MAX_BLOCKS),
    visibleHalf = new Float64Array(MAX_BLOCKS),
    visibleDepth = new Float64Array(MAX_BLOCKS),
    visibleRadius = new Float64Array(MAX_BLOCKS);
  let visibleCount = 0;
  let lastWhole = false;
  let wanted = 0,
    drawnCountTotal = 0,
    tick = 0,
    bytes = 0;
  let program: Program | undefined;
  /** The program the driver is linking (startVolumeProgram), from the first work slice on. */
  let linking: WebGLProgram | undefined;
  let source: Omit<TreeInputs, 'height'> | undefined,
    sourceKey = '',
    heights: TerrainHeights | undefined,
    inputs: TreeInputs | undefined;
  let building: Building | undefined;
  let distance = NaN,
    limits: TreeLimits = treeLimits(600);

  const drop = (slot: Slot): void => {
    if (slot.buffer) gl.deleteBuffer(slot.buffer);
    if (slot.vao) gl.deleteVertexArray(slot.vao);
    bytes -= slot.bytes;
  };
  const dropAll = (): void => {
    for (const slot of slots.values()) drop(slot);
    slots.clear();
    building = undefined;
    wanted = drawnCountTotal = 0;
  };

  /** The inputs of the page: other trees or another terrain start the blocks again. */
  const sync = (): void => {
    const next = options.inputs(),
      nextHeights = options.terrain();
    const key = next ? treeInputsKey(next) : '';
    if (key === sourceKey && next?.water === source?.water && nextHeights === heights) return;
    dropAll();
    source = next;
    sourceKey = key;
    heights = nextHeights;
    if (!next || !nextHeights) {
      inputs = undefined;
      return;
    }
    const relief = nextHeights,
      unit = relief.exaggeration > 0 ? 1 / relief.exaggeration : 1;
    // The builder wants the ground in metres (0 and below: the sea, no tree); TerrainHeights gives it as drawn.
    inputs = { ...next, height: (x, y) => relief.heightAt(x, y) * unit };
  };

  const upload = (key: number, block: TreeBlock): void => {
    const data = block.data,
      count = block.count,
      slot: Slot = { count, bytes: data.byteLength, used: tick, low: Infinity, high: -Infinity, top: 0, cells: block.cells };
    for (let i = 0; i < count * TREE_STRIDE; i += TREE_STRIDE) {
      slot.low = Math.min(slot.low, data[i + 2]);
      slot.high = Math.max(slot.high, data[i + 2]);
      slot.top = Math.max(slot.top, data[i + 4]);
    }
    if (count) {
      slot.vao = gl.createVertexArray()!;
      slot.buffer = gl.createBuffer()!;
      gl.bindVertexArray(slot.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, slot.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      for (let i = 0; i < 3; i++) {
        gl.enableVertexAttribArray(i);
        gl.vertexAttribPointer(i, 4, gl.FLOAT, false, TREE_STRIDE * 4, i * 16);
        gl.vertexAttribDivisor(i, 1);
      }
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      bytes += data.byteLength;
    } else slot.bytes = 0;
    slots.set(key, slot);
  };

  /** Over budget: the blocks drawn least recently go, never one of the last frame. */
  const evict = (): void => {
    const budget = options.budgetBytes ?? BUDGET_BYTES;
    while (bytes > budget) {
      let oldest = -1,
        used = tick;
      for (const [key, slot] of slots)
        if (slot.bytes && slot.used < used) {
          used = slot.used;
          oldest = key;
        }
      if (oldest < 0) return;
      drop(slots.get(oldest)!);
      slots.delete(oldest);
    }
  };

  /** The program once the driver has linked it: started in the first work slice, whatever the view (the map shows,
   * nothing tilts yet), polled in the next ones; false while it links. */
  const link = (): boolean => {
    if (program) return true;
    linking ??= startVolumeProgram(gl, WORLD_TREE_VS, WORLD_TREE_FS);
    if (!volumeProgramLinked(gl, linking, 'World trees')) return false;
    program = { program: linking, u: uniformsOf(gl, linking, UNIFORMS) };
    linking = undefined;
    return true;
  };
  /** The draws of the visible blocks with the levels of a tree `coarser` times smaller on screen than it is and the
   * thinning of one `thinner` times smaller; the frame's triangles. */
  const select = (at: { tx: number; ty: number; gx: number; gy: number; far: number; inner: number; focal: number; closest: number }, coarser: number, thinner: number): number => {
    drawnCountTotal = 0;
    lastWhole = false;
    stats.inner = stats.front = stats.blocks = 0;
    let triangles = 0;
    const size = TREE_SIZE_M * at.focal;
    for (let b = 0; b < visibleCount; b++) {
      const slot = visible[b],
        key = visibleKey[b],
        minX = (key % 65536) * TREES_BLOCK,
        minY = Math.floor(key / 65536) * TREES_BLOCK,
        depth = visibleDepth[b],
        radius = visibleRadius[b],
        // The size on screen of a tree at the block's nearest and farthest points.
        nearPixels = size / Math.max(depth - radius, at.closest),
        farPixels = size / Math.max(depth + radius, at.closest),
        level = treeLevel(nearPixels, coarser);
      if (level < 0) continue;
      const before = drawnCountTotal;
      // One level over the block: one draw, thinned evenly from its block-shuffled copy.
      if (level === treeLevel(farPixels, coarser)) addDraw(slot, key, level, slot.count, treeDrawCount(slot.count, size / thinner / Math.max(depth, at.closest)));
      else {
        // A block across levels (a near one): each cell at its own level and thinning, runs of whole cells at one
        // level drawn together.
        const z = visibleZ[b],
          cellRadius = Math.hypot(CELL * 0.71, visibleHalf[b]);
        for (let c = 0; c < TREE_CELLS * TREE_CELLS; c++) {
          const first = slot.cells[c],
            all = slot.cells[c + 1] - first;
          if (!all) continue;
          const cx = minX + ((c % TREE_CELLS) + 0.5) * CELL - at.tx,
            cy = minY + (Math.floor(c / TREE_CELLS) + 0.5) * CELL - at.ty;
          if (!volume.sees(cx, cy, z, cellRadius)) continue;
          const pixels = size / Math.max(volume.depth(cx, cy, z) - cellRadius, at.closest),
            cellLevel = treeLevel(pixels, coarser);
          if (cellLevel >= 0) addDraw(slot, key, cellLevel, first, treeDrawCount(all, pixels / thinner), all);
        }
      }
      let count = 0;
      for (let i = before; i < drawnCountTotal; i++) {
        count += drawnCount[i];
        triangles += (drawnCount[i] * VERTICES[drawnLathe[i]]) / 3;
      }
      if (Math.hypot(Math.max(at.tx - minX, minX + TREES_BLOCK - at.tx), Math.max(at.ty - minY, minY + TREES_BLOCK - at.ty)) <= at.inner) stats.inner += count;
      if (gapTo(minX, minY, at.gx, at.gy) <= at.far) stats.front += count;
      stats.blocks++;
    }
    return triangles;
  };
  /** Adds a draw of `count` instances from `first`, or extends the previous one when it is the same block and level
   * and both cover their cells whole (`all`: instances of the cell, when the draw is one). */
  const addDraw = (slot: Slot, key: number, level: number, first: number, count: number, all = count): void => {
    if (!count) return;
    const last = drawnCountTotal - 1,
      whole = count === all;
    if (whole && lastWhole && last >= 0 && drawn[last] === slot && drawnLathe[last] === level && drawnFirst[last] + drawnCount[last] === first) {
      drawnCount[last] += count;
      return;
    }
    if (drawnCountTotal >= MAX_DRAWS) return;
    drawn[drawnCountTotal] = slot;
    drawnKey[drawnCountTotal] = key;
    drawnLathe[drawnCountTotal] = level;
    drawnFirst[drawnCountTotal] = first;
    drawnCount[drawnCountTotal++] = count;
    lastWhole = whole;
  };
  const slice = (started: number, pending: boolean): boolean => {
    const ms = performance.now() - started;
    if (ms > stats.sliceMs) stats.sliceMs = ms;
    return pending;
  };

  return {
    name: 'trees',
    tilts: true,
    tiltOnly: true,
    ready: () => true,
    restExact: frame => !volumesDrawn(frame.camera) || !options.shown() || (!wanted && !building),
    work(budgetMs, frame) {
      const started = performance.now();
      sync();
      // Started whether or not the trees show: the link runs in the driver's threads, polled once per slice.
      const linked = link();
      if (!inputs) return !linked;
      if (!linked) return slice(started, true);
      for (;;) {
        if (!building) {
          // The nearest block the last frame wanted that is not built yet.
          let best = -1;
          for (let i = 0; i < wanted; i++) if (!slots.has(wantKey[i]) && (best < 0 || wantPriority[i] < wantPriority[best])) best = i;
          if (best < 0) {
            wanted = 0;
            break;
          }
          const key = wantKey[best];
          building = { key, steps: treeBlockSteps(inputs, key % 65536, Math.floor(key / 65536)), ms: 0 };
          wantKey[best] = wantKey[wanted - 1];
          wantPriority[best] = wantPriority[wanted - 1];
          wanted--;
        }
        if (performance.now() - started > budgetMs) return slice(started, true);
        const unit = performance.now(),
          step = building.steps.next();
        building.ms += performance.now() - unit;
        if (step.done) {
          upload(building.key, step.value);
          stats.blockMs = building.ms;
          stats.built++;
          building = undefined;
          if (frame?.camera.tilted) options.invalidate();
        }
      }
      evict();
      return slice(started, false);
    },
    draw(frame: LiveFrame) {
      const started = performance.now(),
        camera = frame.camera,
        standing = volumesDrawn(camera) && options.shown();
      tick++;
      stats.drawCalls = stats.triangles = stats.instances = stats.inner = stats.front = stats.blocks = 0;
      drawnCountTotal = 0;
      const relief = heights;
      if (standing && relief && inputs && program) {
        if (options.distance() !== distance) {
          distance = options.distance();
          limits = treeLimits(distance);
        }
        const tx = camera.target[0],
          ty = camera.target[1],
          tz = camera.target[2],
          // The eye's ground point: the trees in front of it are the ones the user stands among when the camera is low.
          gx = camera.eye[0],
          gy = camera.eye[1],
          rise = camera.rise,
          drawnPerMetre = relief.exaggeration * rise,
          far = limits.far,
          inner = INNER_METRES,
          // CSS pixels per metre at a depth of one metre, and the closest depth a block is measured at.
          focal = camera.focal / frame.dpr,
          closest = Math.max(camera.near, 0.5);
        wanted = 0;
        visibleCount = 0;
        volume.set(camera);
        const last = Math.ceil(relief.width / TREES_BLOCK) - 1,
          bx0 = Math.max(0, Math.floor((Math.min(tx, gx) - far) / TREES_BLOCK)),
          bx1 = Math.min(last, Math.floor((Math.max(tx, gx) + far) / TREES_BLOCK)),
          by0 = Math.max(0, Math.floor((Math.min(ty, gy) - far) / TREES_BLOCK)),
          by1 = Math.min(last, Math.floor((Math.max(ty, gy) + far) / TREES_BLOCK));
        for (let by = by0; by <= by1; by++)
          for (let bx = bx0; bx <= bx1; bx++) {
            const minX = bx * TREES_BLOCK,
              minY = by * TREES_BLOCK;
            // Within the tree distance of the target or of the eye's ground point, horizontally.
            if (Math.min(gapTo(minX, minY, tx, ty), gapTo(minX, minY, gx, gy)) > far) continue;
            const key = by * 65536 + bx,
              slot = slots.get(key),
              x = minX + TREES_BLOCK / 2 - tx,
              y = minY + TREES_BLOCK / 2 - ty;
            if (!slot) {
              // Not built: wanted only in view (the ground under its centre and the tallest trees stand for its
              // trees), nearest to the eye first; what lies behind or under the eye is neither built nor kept.
              const z = relief.heightAt(x + tx, y + ty) * rise - tz;
              if (wanted < MAX_BLOCKS && volume.sees(x, y, z, Math.hypot(TREES_BLOCK * 0.71, 60 * rise))) {
                wantKey[wanted] = key;
                wantPriority[wanted++] = volume.depth(x, y, z);
              }
              continue;
            }
            if (!slot.count || visibleCount >= MAX_BLOCKS) continue;
            const low = slot.low * drawnPerMetre,
              high = slot.high * drawnPerMetre + slot.top * rise,
              z = (low + high) / 2 - tz,
              radius = Math.hypot(TREES_BLOCK * 0.71, (high - low) / 2);
            if (!volume.sees(x, y, z, radius)) continue;
            slot.used = tick;
            visible[visibleCount] = slot;
            visibleKey[visibleCount] = key;
            visibleZ[visibleCount] = z;
            visibleHalf[visibleCount] = (high - low) / 2;
            visibleDepth[visibleCount] = volume.depth(x, y, z);
            visibleRadius[visibleCount++] = radius;
          }
        // The levels by screen size; while the frame's triangles pass the budget of the tree distance, coarser levels
        // all together (every tree stays), and only once every tree is an impostor, fewer trees: the cost follows the
        // distance setting, never the view, and the trees around the target and in front of the eye stay.
        const budget = treeBudget(far),
          selection = { tx, ty, gx, gy, far, inner, focal, closest };
        let coarser = 1,
          thinner = 1,
          previous = Infinity;
        for (let pass = 0; pass < 16; pass++) {
          const triangles = select(selection, coarser, thinner);
          if (triangles <= budget) break;
          // Coarser levels until they gain nothing more (every tree an impostor), then fewer trees.
          if (coarser < MAX_COARSER && triangles < previous * 0.97) coarser = Math.min(MAX_COARSER, coarser * Math.max(1.15, Math.sqrt(triangles / budget)));
          else {
            coarser = MAX_COARSER;
            thinner *= Math.max(1.2, triangles / budget);
          }
          previous = triangles;
        }
        stats.coarser = coarser;
        stats.thinner = thinner;
        if (drawnCountTotal) {
          const u = program.u;
          gl.useProgram(program.program);
          volumeDepth(gl);
          gl.uniformMatrix4fv(u.uProjection, false, camera.targetViewProjection);
          gl.uniform2f(u.uRelief, drawnPerMetre, rise);
          // Trees grow out of the ground between near and far, horizontally from the nearer of the target and the
          // eye's ground point.
          gl.uniform4f(u.uFade, gx - tx, gy - ty, limits.near, limits.far);
          gl.uniform3f(u.eye, camera.eye[0] - tx, camera.eye[2] - tz, camera.eye[1] - ty);
          gl.uniform3f(u.treeLight, LIGHT[0], LIGHT[1], LIGHT[2]);
          gl.uniform1f(u.fogDistance, hazeDistance(camera));
          gl.uniform1i(u.uNight, options.night?.() ? 1 : 0);
          const palette = options.palette?.() ?? SATELLITE_TREES,
            repaint = palette.repaint;
          gl.uniform3f(u.uTrunk, palette.trunk[0], palette.trunk[1], palette.trunk[2]);
          gl.uniform1i(u.uRepaint, repaint ? 1 : 0);
          if (repaint) {
            gl.uniform4f(u.uRepaintLow, repaint.low[0], repaint.low[1], repaint.low[2], repaint.from);
            gl.uniform4f(u.uRepaintHigh, repaint.high[0], repaint.high[1], repaint.high[2], repaint.to);
          }
          // Impostors face the eye: the direction towards it (3D view's frame) and the screen's right on the ground.
          gl.uniform4f(u.uFacing, -camera.forward[0], -camera.forward[2], -camera.forward[1], camera.yaw);
          for (let lathe = 0; lathe < TREE_LATHES.length; lathe++) {
            let set = false;
            for (let i = 0; i < drawnCountTotal; i++) {
              if (drawnLathe[i] !== lathe) continue;
              if (!set) {
                set = true;
                gl.uniform3i(u.uLathe, TREE_LATHES[lathe].segments, TREE_LATHES[lathe].stem, TREE_LATHES[lathe].impostor ? 1 : 0);
                gl.uniform1iv(u.uCrown, CROWNS[lathe]);
              }
              const key = drawnKey[i],
                bx = key % 65536,
                by = Math.floor(key / 65536),
                slot = drawn[i],
                offset = drawnFirst[i] * TREE_STRIDE * 4;
              gl.uniform3f(u.uBlock, bx * TREES_BLOCK - tx, by * TREES_BLOCK - ty, -tz);
              // WebGL2 has no base instance: a range of the block's buffer is drawn from its attribute offsets.
              gl.bindVertexArray(slot.vao!);
              gl.bindBuffer(gl.ARRAY_BUFFER, slot.buffer!);
              for (let a = 0; a < 3; a++) gl.vertexAttribPointer(a, 4, gl.FLOAT, false, TREE_STRIDE * 4, offset + a * 16);
              gl.drawArraysInstanced(gl.TRIANGLES, 0, VERTICES[lathe], drawnCount[i]);
              stats.drawCalls++;
              stats.instances += drawnCount[i];
              stats.triangles += (drawnCount[i] * VERTICES[lathe]) / 3;
            }
          }
          gl.bindVertexArray(null);
          gl.bindBuffer(gl.ARRAY_BUFFER, null);
          volumeDepthEnd(gl);
        }
      } else wanted = 0;
      stats.bytes = bytes;
      stats.ms = performance.now() - started;
    },
    invalidate() {
      sourceKey = '\0';
    },
    contextLost() {
      // Every handle is dead: forget them without deleting (the block being built goes on).
      slots.clear();
      bytes = 0;
      program = linking = undefined;
      drawnCountTotal = 0;
    },
    stats: () => stats,
    dispose() {
      dropAll();
      if (program) gl.deleteProgram(program.program);
      if (linking) gl.deleteProgram(linking);
      program = linking = undefined;
      source = heights = inputs = undefined;
    },
  };
}
