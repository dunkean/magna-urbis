/**
 * The modelled trees of the tilted world view (volumes.ts): the satellite looks' near trees of the 3D view (sizes by
 * biome, social classes, giants, stems, crowns: ui/terrain3dTrees.ts), standing on TerrainHeights, drawn after the
 * terrain with depth.
 *
 * Instances are built per block of the map (treesBlocks.ts), once per content, in work slices of 24 m, the blocks a
 * frame wanted nearest first, and kept on the GPU within a byte budget. A frame draws the blocks within the tree
 * distance and in view: one instanced draw each, the lathe coarser with the distance (treesShader.ts) and far blocks
 * thinned to a prefix of their shuffled instances; beyond the distance, the painted crowns of the ground carry the
 * forest. A frame builds and uploads nothing, and allocates nothing.
 */
import type { LiveFrame, LiveLayerStats } from '../live/contract';
import { TREE_STRIDE, treeLimits, type TreeInputs, type TreeLimits } from '../../ui/terrain3dTrees';
import type { TerrainHeights } from './heights';
import { TREES_BLOCK, treeBlockSteps, treeDrawCount, treeInputsKey, treeLathe } from './treesBlocks';
import { SATELLITE_TREES, TREE_LATHES, WORLD_TREE_FS, WORLD_TREE_VS, latheVertices, type TreePalette } from './treesShader';
import { VOLUME_LIGHT, ViewVolume, hazeDistance, linkVolumeProgram, uniformsOf, volumeDepth, volumeDepthEnd, volumesDrawn, type VolumeLayer } from './volumes';

export interface WorldTreesOptions {
  /** The inputs of the near trees of the satellite looks, as the 3D view makes them (ui/view3d/terrain/trees.ts),
   * without `height` (the trees stand on `terrain`); undefined: no modelled trees (another look, or switched off). A
   * new object is compared by content (treeInputsKey) and by its water cover function. */
  inputs(): Omit<TreeInputs, 'height'> | undefined;
  terrain(): TerrainHeights | undefined;
  /** Tree distance (m), the 3D view's slider (clampTreeDistance). */
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
/** Blocks a frame may want or draw: (2 x 1500 m / 96 m + 2)^2. */
const MAX_BLOCKS = 1100;
const UNIFORMS = ['uProjection', 'uBlock', 'uRelief', 'uFade', 'uLathe', 'uCrown', 'uTrunk', 'uRepaintLow', 'uRepaintHigh', 'uRepaint', 'eye', 'treeLight', 'fogDistance', 'uNight'] as const;
type Program = { program: WebGLProgram; u: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null> };
const CROWNS = TREE_LATHES.map(lathe => Int32Array.from({ length: 6 }, (_, i) => lathe.crown[i] ?? 5));
const VERTICES = TREE_LATHES.map(latheVertices);
/** The light in the 3D view's frame (x, up, y south), as the tree fragment shader reads it. */
const LIGHT = [VOLUME_LIGHT[0], VOLUME_LIGHT[2], VOLUME_LIGHT[1]] as const;

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
}
interface Building {
  key: number;
  steps: Generator<void, Float32Array>;
  ms: number;
}

export function createWorldTreesLayer(gl: WebGL2RenderingContext, options: WorldTreesOptions): VolumeLayer {
  /** `instances` drawn, `blocks` drawn, `bytes` on the GPU, `built` blocks built so far, `blockMs` build time of the
   * last block, `sliceMs` the longest work slice so far. */
  const stats: LiveLayerStats = { drawCalls: 0, triangles: 0, ms: 0, instances: 0, blocks: 0, bytes: 0, built: 0, blockMs: 0, sliceMs: 0 };
  const volume = new ViewVolume();
  const slots = new Map<number, Slot>();
  const wantKey = new Float64Array(MAX_BLOCKS),
    wantPriority = new Float64Array(MAX_BLOCKS),
    drawn: Slot[] = [],
    drawnKey = new Float64Array(MAX_BLOCKS),
    drawnLathe = new Int8Array(MAX_BLOCKS),
    drawnCount = new Int32Array(MAX_BLOCKS);
  let wanted = 0,
    drawnCountTotal = 0,
    tick = 0,
    bytes = 0;
  let program: Program | undefined;
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

  const upload = (key: number, data: Float32Array): void => {
    const count = data.length / TREE_STRIDE,
      slot: Slot = { count, bytes: data.byteLength, used: tick, low: Infinity, high: -Infinity, top: 0 };
    for (let i = 0; i < data.length; i += TREE_STRIDE) {
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

  const link = (): Program => {
    const linked = linkVolumeProgram(gl, WORLD_TREE_VS, WORLD_TREE_FS, 'World trees');
    return { program: linked, u: uniformsOf(gl, linked, UNIFORMS) };
  };
  const slice = (started: number, pending: boolean): boolean => {
    const ms = performance.now() - started;
    if (ms > stats.sliceMs) stats.sliceMs = ms;
    return pending;
  };

  return {
    name: 'trees',
    tilts: true,
    ready: () => true,
    restExact: frame => !volumesDrawn(frame.camera) || !options.shown() || (!wanted && !building),
    work(budgetMs, frame) {
      const started = performance.now();
      sync();
      if (!inputs) return false;
      if (!program) {
        program = link();
        return slice(started, true);
      }
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
      stats.drawCalls = stats.triangles = stats.instances = stats.blocks = 0;
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
          ex = camera.eye[0],
          ey = camera.eye[1],
          rise = camera.rise,
          drawnPerMetre = relief.exaggeration * rise,
          far = limits.far;
        // An eye higher above the ground than the tree distance sees no modelled tree (the 3D view's rule).
        const lift = camera.eye[2] - relief.heightAt(ex, ey) * rise;
        wanted = 0;
        if (lift <= far) {
          volume.set(camera);
          const last = Math.ceil(relief.width / TREES_BLOCK) - 1,
            bx0 = Math.max(0, Math.floor((ex - far) / TREES_BLOCK)),
            bx1 = Math.min(last, Math.floor((ex + far) / TREES_BLOCK)),
            by0 = Math.max(0, Math.floor((ey - far) / TREES_BLOCK)),
            by1 = Math.min(last, Math.floor((ey + far) / TREES_BLOCK));
          for (let by = by0; by <= by1; by++)
            for (let bx = bx0; bx <= bx1; bx++) {
              const minX = bx * TREES_BLOCK,
                minY = by * TREES_BLOCK,
                near = Math.hypot(Math.max(minX - ex, 0, ex - minX - TREES_BLOCK), Math.max(minY - ey, 0, ey - minY - TREES_BLOCK));
              if (near > far) continue;
              const key = by * 65536 + bx,
                slot = slots.get(key),
                x = minX + TREES_BLOCK / 2 - tx,
                y = minY + TREES_BLOCK / 2 - ty;
              if (!slot) {
                // Not built: wanted, those in view first (the ground under its centre stands for its trees).
                if (wanted < MAX_BLOCKS) {
                  const z = relief.heightAt(x + tx, y + ty) * rise - tz;
                  wantKey[wanted] = key;
                  wantPriority[wanted++] = near + (volume.sees(x, y, z, TREES_BLOCK * 0.71 + 60) ? 0 : 1e6);
                }
                continue;
              }
              if (!slot.count) continue;
              const low = slot.low * drawnPerMetre,
                high = slot.high * drawnPerMetre + slot.top * rise,
                z = (low + high) / 2 - tz;
              if (!volume.sees(x, y, z, Math.hypot(TREES_BLOCK * 0.71, (high - low) / 2))) continue;
              const lathe = treeLathe(near, limits),
                count = treeDrawCount(slot.count, near, limits);
              if (lathe < 0 || !count || drawnCountTotal >= MAX_BLOCKS) continue;
              slot.used = tick;
              drawn[drawnCountTotal] = slot;
              drawnKey[drawnCountTotal] = key;
              drawnLathe[drawnCountTotal] = lathe;
              drawnCount[drawnCountTotal++] = count;
            }
        }
        if (drawnCountTotal) {
          const u = program.u;
          gl.useProgram(program.program);
          volumeDepth(gl);
          gl.uniformMatrix4fv(u.uProjection, false, camera.targetViewProjection);
          gl.uniform2f(u.uRelief, drawnPerMetre, rise);
          gl.uniform4f(u.uFade, ex - tx, ey - ty, limits.near, limits.far);
          gl.uniform3f(u.eye, ex - tx, camera.eye[2] - tz, ey - ty);
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
          for (let lathe = 0; lathe < TREE_LATHES.length; lathe++) {
            let set = false;
            for (let i = 0; i < drawnCountTotal; i++) {
              if (drawnLathe[i] !== lathe) continue;
              if (!set) {
                set = true;
                gl.uniform2i(u.uLathe, TREE_LATHES[lathe].segments, TREE_LATHES[lathe].stem);
                gl.uniform1iv(u.uCrown, CROWNS[lathe]);
              }
              const key = drawnKey[i],
                bx = key % 65536,
                by = Math.floor(key / 65536);
              gl.uniform3f(u.uBlock, bx * TREES_BLOCK - tx, by * TREES_BLOCK - ty, -tz);
              gl.bindVertexArray(drawn[i].vao!);
              gl.drawArraysInstanced(gl.TRIANGLES, 0, VERTICES[lathe], drawnCount[i]);
              stats.drawCalls++;
              stats.instances += drawnCount[i];
              stats.triangles += (drawnCount[i] * VERTICES[lathe]) / 3;
            }
          }
          stats.blocks = drawnCountTotal;
          gl.bindVertexArray(null);
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
      program = undefined;
      drawnCountTotal = 0;
    },
    stats: () => stats,
    dispose() {
      dropAll();
      if (program) gl.deleteProgram(program.program);
      program = undefined;
      source = heights = inputs = undefined;
    },
  };
}
