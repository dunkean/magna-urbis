/** Trees for the tilted world view. A streamed block uploads one instance buffer, shared by all three indexed
 * silhouettes. Camera motion changes the lengths of its nested instance ranges. Each tree is drawn once.
 * Hidden views retain their cache. New map terrain retires all blocks before the next draw. */
import type { LiveFrame, LiveLayerStats } from '../live/contract';
import { TreeDiagnostics, layerDiagnosticsEnabled } from '../live/layerDiagnostics';
import { TREE_STRIDE, treeLimits, type TreeInputs, type TreeLimits } from '../../ui/terrain3dTrees';
import type { TerrainHeights } from './heights';
import type { GroundShape } from './groundShape';
import type { Building3dScene } from '../urbanBuildingGeometry';
import { treeBuildings, type TreeBuildings } from './treesBuildings';
import { TreeContent, treeSamplesMatch, type TreeSamples } from './treesContent';
import { TREES_BLOCK, TREE_SIZE_M, treeBlockSteps, treeCloseShare, treeDrawShare, treeInputsKey, treeSolidShare, type TreeBlock } from './treesBlocks';
import { bareTreeMesh, bareMiddleMesh, bareDistantMesh } from '../../../../rust/bridge/bareTree';
import { SATELLITE_TREES, TREE_MESHES, WORLD_TREE_FS, WORLD_TREE_VS, type TreePalette } from './treesShader';
import { TREE_MAX_BLOCKS, treeMemoryBudget, treeTriangleBudget } from './treesRange';
import { TreeSelection } from './treeSelection';
import { TreeCoverage } from './treesVisibility';
import { VOLUME_LIGHT, ViewVolume, hazeDistance, startVolumeProgram, volumeProgramLinked, uniformsOf, volumeDepth, volumeDepthEnd, volumesDrawn, type VolumeLayer } from './volumes';

export interface WorldTreesOptions {
  /** The inputs of the near trees of the satellite looks, as the 3D view makes them (ui/view3d/terrain/trees.ts),
   * without `height` (the trees stand on `terrain`); undefined: no modelled trees (another look, or switched off). A
   * publication triggers local content checks in work slices (TreeContent), without dropping installed blocks. */
  inputs(): Omit<TreeInputs, 'height'> | undefined;
  terrain(): TerrainHeights | undefined;
  /** Identity of the published map terrain. Replacing a map retires its entire forest, even while trees are hidden. */
  terrainSource?(): object | undefined;
  /** Published town footprints; indexed once per scene, queried only while building a tree block. */
  buildings?(): Building3dScene | undefined;
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
export interface WorldTreesLayer extends VolumeLayer {
  selection(frame: LiveFrame): TreeSelection | undefined;
  /** This view still owes a streamed block or the end of its on-screen fade. */
  pendingPresentation(): boolean;
}

/** Brought forward before every other wanted block (m): the blocks whose trees stand on a town built since. */
const RETIRED_FIRST = 1e6;
const UNIFORMS = ['uProjection', 'uBlock', 'uRelief', 'uSegments', 'uFacing', 'uTreeUp', 'uTrunk', 'uRepaintLow', 'uRepaintHigh', 'uRepaint', 'eye', 'treeLight', 'fogDistance', 'uNight'] as const;
type Program = { program: WebGLProgram; u: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>; indices: WebGLBuffer; vertices: WebGLBuffer };
const BRANCH_LEVEL = TREE_MESHES.length;
const meshes = [...TREE_MESHES, bareTreeMesh, bareMiddleMesh, bareDistantMesh];
const MESH_VERTICES = Float32Array.from(meshes.flatMap(mesh => mesh.vertices));
const INDICES = Uint16Array.from(
  meshes.flatMap((mesh, i) => {
    const first = meshes.slice(0, i).reduce((n, earlier) => n + earlier.vertices.length / 4, 0);
    return mesh.indices.map(index => first + index);
  }),
);
const INDEX_OFFSETS = meshes.map((_, i) => meshes.slice(0, i).reduce((n, mesh) => n + mesh.indices.length * Uint16Array.BYTES_PER_ELEMENT, 0));
const TRIANGLES = meshes.map(mesh => mesh.indices.length / 3);

/** Horizontal distance from a point to the block whose north-west corner is (minX, minY). */
const gapTo = (minX: number, minY: number, x: number, y: number): number => Math.hypot(Math.max(minX - x, 0, x - minX - TREES_BLOCK), Math.max(minY - y, 0, y - minY - TREES_BLOCK));

interface Slot {
  content: string;
  checked: number;
  /** The footprints its trees keep off (TreeBuildings.blockKey). */
  town: number;
  samples: TreeSamples;
  admitted: number;
  heights: Float32Array;
  ids?: Uint32Array;
  barePrefix?: Uint32Array;
  vao?: WebGLVertexArrayObject;
  buffer?: WebGLBuffer;
  count: number;
  bytes: number;
  used: number;
  /** Ground height range of its trees (m, before exaggeration) and its tallest tree. */
  low: number;
  high: number;
  top: number;
  /** Ground under the block centre, used by the streamer's coarse visibility test. */
  centreHeight: number;
  centreRevision: number;

  /** Base instance currently bound in the VAO. */
  first: number;
  radius: number;
}
interface Building {
  key: number;
  content: string;
  steps: Generator<void, TreeBlock>;
}

export function createWorldTreesLayer(gl: WebGL2RenderingContext, options: WorldTreesOptions): WorldTreesLayer {
  const stats: LiveLayerStats = { drawCalls: 0, triangles: 0, ms: 0, instances: 0, bytes: 0 };
  const diagnostics = layerDiagnosticsEnabled() ? new TreeDiagnostics(stats) : undefined;
  const volume = new ViewVolume();
  const coverage = new TreeCoverage();
  const selected = new TreeSelection();
  let preparedAt = NaN;
  const slots = new Map<number, Slot>();
  const wantKey = new Float64Array(TREE_MAX_BLOCKS),
    wantPriority = new Float64Array(TREE_MAX_BLOCKS);
  // Counts are nested prefixes of one stable order: close trees, all solid trees, then all visible trees.
  const visible: Slot[] = [],
    visibleKey = new Float64Array(TREE_MAX_BLOCKS),
    visibleAll = new Int32Array(TREE_MAX_BLOCKS),
    visibleSolid = new Int32Array(TREE_MAX_BLOCKS),
    visibleClose = new Int32Array(TREE_MAX_BLOCKS),
    depths = new Float64Array(TREE_MAX_BLOCKS);
  const nearest: number[] = [];
  let visibleCount = 0;
  let wanted = 0,
    tick = 0,
    bytes = 0,
    presentationPending = false;
  let program: Program | undefined;
  /** The program the driver is linking (startVolumeProgram), from the first work slice on. */
  let linking: WebGLProgram | undefined;
  let source: Omit<TreeInputs, 'height'> | undefined,
    sourceKey = '',
    heights: TerrainHeights | undefined,
    shape: GroundShape | undefined,
    inputs: TreeInputs | undefined;
  let building: Building | undefined;
  let scene: Building3dScene | undefined, buildings: TreeBuildings | undefined;
  let revision = 0,
    reliefRevision = 0,
    content: TreeContent | undefined;
  let terrainSource: object | undefined;
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
    wanted = visibleCount = 0;
    visible.length = 0;
    presentationPending = false;
  };

  /** A new publication checks local content in work slices. Installed blocks remain visible until replaced, except those
   * whose footprints changed: their trees would stand on the new town until a slice reaches them. */
  const sync = (): void => {
    const next = options.inputs(),
      nextHeights = options.terrain(),
      nextShape = nextHeights?.shape,
      nextScene = options.buildings?.(),
      nextSource = options.terrainSource?.();
    if (nextSource !== terrainSource) {
      dropAll();
      terrainSource = nextSource;
    }
    const key = next ? treeInputsKey(next) : '';
    const reliefChanged = nextHeights !== heights || nextShape !== shape;
    if (next === source && key === sourceKey && !reliefChanged && nextScene === scene) return;
    building = undefined;
    revision++;
    if (reliefChanged) reliefRevision++;
    source = next;
    sourceKey = key;
    heights = nextHeights;
    shape = nextShape;
    scene = nextScene;
    buildings = treeBuildings(scene);
    options.invalidate();
    if (!next || !nextHeights) {
      inputs = undefined;
      return;
    }
    // Instance heights are stored in metres. Capture the shaped ground published for this build.
    inputs = { ...next, height: (x, y) => nextHeights.naturalMetresAt(x, y) + (nextShape?.drawnAt(x, y) ?? 0) };
    content = new TreeContent(inputs, buildings);
  };

  const upload = (key: number, block: TreeBlock, signature: string): void => {
    const previous = slots.get(key);
    const relief = heights!;
    const data = block.data,
      count = block.count,
      centreHeight = relief.heightAt(((key % 65536) + 0.5) * TREES_BLOCK, (Math.floor(key / 65536) + 0.5) * TREES_BLOCK),
      slot: Slot = {
        content: signature,
        checked: revision,
        town: buildings?.blockKey(key % 65536, Math.floor(key / 65536)) ?? 0,
        samples: block.samples,
        ids: block.ids,
        count,
        bytes: data.byteLength,
        used: tick,
        low: Infinity,
        high: -Infinity,
        top: 0,
        centreHeight,
        centreRevision: reliefRevision,
        radius: 0,
        admitted: 0,
        heights: new Float32Array(count),
        first: 0,
      };
    for (let i = 0; i < count * TREE_STRIDE; i += TREE_STRIDE) {
      slot.heights[i / TREE_STRIDE] = data[i + 4];
      slot.low = Math.min(slot.low, data[i + 2]);
      slot.high = Math.max(slot.high, data[i + 2]);
      slot.top = Math.max(slot.top, data[i + 4]);
      slot.radius = Math.max(slot.radius, data[i + 3]);
    }
    if (count) {
      slot.vao = gl.createVertexArray()!;
      slot.buffer = gl.createBuffer()!;
      gl.bindVertexArray(slot.vao);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, program!.indices);
      gl.bindBuffer(gl.ARRAY_BUFFER, program!.vertices);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, slot.buffer);
      // A stable partition keeps each original LOD range selectable with two instance ranges.
      let ordered = data;
      let bareCount = 0;
      for (let i = 11; i < data.length; i += TREE_STRIDE) if (data[i] > 0.5) bareCount++;
      if (bareCount) {
        const prefix = new Uint32Array(count + 1);
        ordered = new Float32Array(data.length);
        let leafy = 0,
          bare = count - bareCount;
        for (let i = 0; i < count; i++) {
          const start = i * TREE_STRIDE,
            leafless = data[start + 11] > 0.5;
          prefix[i + 1] = prefix[i] + Number(leafless);
          const to = leafless ? bare++ : leafy++;
          ordered.set(data.subarray(start, start + TREE_STRIDE), to * TREE_STRIDE);
        }
        slot.barePrefix = prefix;
        slot.bytes += prefix.byteLength;
      }
      gl.bufferData(gl.ARRAY_BUFFER, ordered, gl.STATIC_DRAW);
      for (let i = 0; i < 3; i++) {
        gl.enableVertexAttribArray(i);
        gl.vertexAttribPointer(i, 4, gl.FLOAT, false, TREE_STRIDE * 4, i * 16);
        gl.vertexAttribDivisor(i, 1);
      }
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      bytes += slot.bytes;
    } else slot.bytes = 0;
    if (previous) drop(previous);
    slots.set(key, slot);
  };

  /** Over budget: the blocks drawn least recently go, never one of the last frame. */
  const evict = (deadline: number): boolean => {
    const budget = options.budgetBytes ?? treeMemoryBudget(distance);
    if (bytes <= budget) return false;
    // Large ranges can retain thousands of blocks. Order once instead of scanning the whole cache for every
    // eviction; lowering the distance must not turn reclamation into a quadratic, unbounded work slice.
    const stale = [...slots].filter(([, slot]) => slot.bytes && slot.used < tick).sort((a, b) => a[1].used - b[1].used);
    for (const [key, slot] of stale) {
      if (bytes <= budget) return false;
      if (performance.now() >= deadline) return true;
      drop(slot);
      slots.delete(key);
    }
    return false;
  };

  /** The program once the driver has linked it: started in the first visible work slice and polled in later ones;
   * false while it links. Hidden trees do not compile a program or build blocks. */
  const link = (): boolean => {
    if (program) return true;
    linking ??= startVolumeProgram(gl, WORLD_TREE_VS, WORLD_TREE_FS);
    if (!volumeProgramLinked(gl, linking, 'World trees')) return false;
    const indices = gl.createBuffer()!,
      vertices = gl.createBuffer()!;
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    gl.bufferData(gl.ARRAY_BUFFER, MESH_VERTICES, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, INDICES, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    program = { program: linking, u: uniformsOf(gl, linking, UNIFORMS), indices, vertices };
    linking = undefined;
    options.invalidate();
    return true;
  };
  const slice = (started: number, pending: boolean): boolean => {
    diagnostics?.slice(started);
    return pending;
  };

  function prepare(frame: LiveFrame): TreeSelection | undefined {
    if (frame.now !== undefined && frame.now === preparedAt) return visibleCount ? selected : undefined;
    preparedAt = frame.now;
    selected.begin();
    visibleCount = 0;
    const camera = frame.camera,
      standing = volumesDrawn(camera) && options.shown();
    tick++;
    diagnostics?.selection();
    if (standing) sync();
    const relief = heights;
    const opacity = standing && relief ? coverage.opacity(frame, relief, options.distance()) : 0;
    stats.opacity = opacity;
    presentationPending = opacity > 0 && !!inputs && !program;
    if (opacity > 0 && relief && inputs && program) {
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
        // CSS pixels per metre at a depth of one metre, and the closest depth a block is measured at.
        focal = camera.focal / frame.dpr,
        closest = Math.max(camera.near, 0.5),
        streamRadius = Math.hypot(TREES_BLOCK * 0.71 + 16, 80 * rise);
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
            centreX = minX + TREES_BLOCK / 2,
            centreY = minY + TREES_BLOCK / 2,
            x = centreX - tx,
            y = centreY - ty,
            z = (slot?.centreRevision === reliefRevision ? slot.centreHeight : relief.heightAt(centreX, centreY)) * rise - tz;
          if (!volume.sees(x, y, z, streamRadius)) continue;
          const depth = volume.depth(x, y, z),
            pixels = (TREE_SIZE_M * focal) / Math.max(depth, closest),
            density = treeDrawShare(pixels),
            solidShare = treeSolidShare(pixels),
            closeShare = treeCloseShare(pixels);
          if (!density) continue;
          let retired = false;
          if (!slot || slot.checked !== revision) {
            retired = !!slot && !!buildings && slot.town !== buildings.blockKey(bx, by);
            if (wanted < TREE_MAX_BLOCKS) {
              wantKey[wanted] = key;
              wantPriority[wanted++] = retired ? depth - RETIRED_FIRST : depth;
            }
            if (!slot) continue;
          }
          // Keep the same candidates in memory even if their finely bounded
          // geometry is just off screen, so work cannot evict and rebuild it.
          slot.used = tick;
          if (retired) continue;
          if (!slot.count || visibleCount >= TREE_MAX_BLOCKS) continue;
          const low = slot.low * drawnPerMetre,
            high = slot.high * drawnPerMetre + slot.top * rise,
            centre = (low + high) / 2 - tz,
            radius = Math.hypot(TREES_BLOCK * 0.71 + slot.radius * 1.25, (high - low) / 2);
          if (!volume.sees(x, y, centre, radius)) continue;
          // Screen displacement of the tree top with respect to its root, in CSS pixels.
          const parallax = (focal * rise * Math.abs(Math.sin(camera.pitch)) * opacity) / Math.max(depth, closest);
          let lowIndex = 0,
            highIndex = slot.count;
          while (lowIndex < highIndex) {
            const mid = (lowIndex + highIndex) >>> 1;
            if (slot.heights[mid] * parallax >= (mid < slot.admitted ? 2 : 4)) lowIndex = mid + 1;
            else highIndex = mid;
          }
          const all = lowIndex;
          if (!all) {
            slot.admitted = 0;
            continue;
          }
          visible[visibleCount] = slot;
          visibleKey[visibleCount] = key;
          visibleAll[visibleCount] = all;
          visibleSolid[visibleCount] = Math.round(all * solidShare);
          visibleClose[visibleCount] = Math.round(all * closeShare);
          depths[visibleCount] = depth;
          nearest[visibleCount] = visibleCount;
          visibleCount++;
        }
      visible.length = visibleCount;
      presentationPending = wanted > 0;
      nearest.length = visibleCount;
      nearest.sort((a, b) => depths[a] - depths[b] || visibleKey[a] - visibleKey[b]);
      const budget = treeTriangleBudget(far);
      let remaining = budget;
      for (const i of nearest) {
        const slot = visible[i],
          all = visibleAll[i];
        const cost = (n: number, lod: number) => {
          const bare = slot.barePrefix?.[n] ?? 0;
          return (n - bare) * TRIANGLES[lod] + bare * TRIANGLES[BRANCH_LEVEL + lod];
        };
        const cheap = cost(all, 2);
        // Buy whole foreground stands. Under pressure, shorten the range and spend
        // remaining detail on the largest silhouettes of the nearest admitted stands.
        if (cheap > remaining) {
          remaining = 0;
          visibleAll[i] = slot.admitted = 0;
          continue;
        }
        slot.admitted = all;
        const solid = visibleSolid[i],
          close = visibleClose[i];
        const extra = cost(solid, 1) - cost(solid, 2) + cost(close, 0) - cost(close, 1);
        const allowance = Math.min(remaining - cheap, budget * 0.065);
        let lo = 0,
          hi = solid;
        if (extra > allowance)
          while (lo < hi) {
            const n = Math.ceil((lo + hi) / 2),
              c = Math.floor((n * close) / Math.max(1, solid));
            const upgraded = cost(n, 1) - cost(n, 2) + cost(c, 0) - cost(c, 1);
            if (upgraded <= allowance) lo = n;
            else hi = n - 1;
          }
        const n = extra <= allowance ? solid : lo,
          c = Math.floor((n * close) / Math.max(1, solid));
        visibleSolid[i] = n;
        visibleClose[i] = c;
        remaining -= cheap + cost(n, 1) - cost(n, 2) + cost(c, 0) - cost(c, 1);
        if (slot.ids) selected.select(visibleKey[i], slot.ids, all);
      }
    } else wanted = 0;
    selected.end();
    return visibleCount ? selected : undefined;
  }

  return {
    name: 'trees',
    tilts: true,
    tiltOnly: true,
    selection: prepare,
    ready: () => true,
    pendingPresentation: () => presentationPending && options.shown(),
    work(budgetMs, frame) {
      const started = performance.now();
      const terrain = options.terrain();
      // Keep both the installed blocks and any partially built block while hidden. Even a stale wanted list must
      // not build after the camera zooms out or the switch turns off, before the next draw clears that list.
      if (!options.shown() || !frame || !volumesDrawn(frame.camera) || !terrain || coverage.opacity(frame, terrain, options.distance()) === 0) return false;
      sync();
      const linked = link();
      if (!inputs) return !linked;
      if (!linked) return slice(started, true);
      for (;;) {
        if (performance.now() - started > budgetMs) return slice(started, true);
        if (!building) {
          // The nearest block the last frame wanted that is not built yet.
          let best = -1;
          for (let i = 0; i < wanted; i++) if (slots.get(wantKey[i])?.checked !== revision && (best < 0 || wantPriority[i] < wantPriority[best] || (wantPriority[i] === wantPriority[best] && wantKey[i] < wantKey[best]))) best = i;
          if (best < 0) {
            wanted = 0;
            break;
          }
          const key = wantKey[best];
          wantKey[best] = wantKey[wanted - 1];
          wantPriority[best] = wantPriority[wanted - 1];
          wanted--;
          const bx = key % 65536,
            by = Math.floor(key / 65536),
            signature = content!.key(bx, by),
            slot = slots.get(key);
          if (slot && slot.content === signature && treeSamplesMatch(slot.samples, inputs)) {
            slot.checked = revision;
            if (slot.centreRevision !== reliefRevision) {
              slot.centreRevision = reliefRevision;
              slot.centreHeight = heights!.heightAt((bx + 0.5) * TREES_BLOCK, (by + 0.5) * TREES_BLOCK);
            }
            stats.reused = (stats.reused ?? 0) + 1;
            continue;
          }
          building = { key, content: signature, steps: treeBlockSteps(inputs, bx, by, buildings) };
          diagnostics?.startBlock();
        }
        if (performance.now() - started > budgetMs) return slice(started, true);
        const step = diagnostics ? diagnostics.step(building.steps) : building.steps.next();
        if (step.done) {
          upload(building.key, step.value, building.content);
          diagnostics?.built();
          building = undefined;
          if (frame?.camera.tilted) options.invalidate();
        }
      }
      return slice(started, evict(started + budgetMs));
    },
    draw(frame: LiveFrame) {
      const started = performance.now();
      prepare(frame);
      stats.drawCalls = stats.triangles = stats.instances = 0;
      const camera = frame.camera,
        relief = heights;
      if (relief && program) {
        const tx = camera.target[0],
          ty = camera.target[1],
          tz = camera.target[2],
          rise = camera.rise,
          drawnPerMetre = relief.exaggeration * rise,
          far = limits.far;
        if (visibleCount) {
          const u = program.u;
          gl.useProgram(program.program);
          volumeDepth(gl);
          gl.uniformMatrix4fv(u.uProjection, false, camera.targetViewProjection);
          gl.uniform2f(u.uRelief, drawnPerMetre, rise);
          gl.uniform3f(u.eye, camera.eye[0] - tx, camera.eye[1] - ty, camera.eye[2] - tz);
          gl.uniform3f(u.treeLight, VOLUME_LIGHT[0], VOLUME_LIGHT[1], VOLUME_LIGHT[2]);
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
          gl.uniform3f(u.uTreeUp, camera.up[0], camera.up[1], camera.up[2]);
          gl.uniform3f(u.uFacing, camera.right[0], camera.right[1], -camera.forward[2]);
          let previousLevel = -1,
            leastDensity = 1;
          const draw = (slot: Slot, level: number, first: number, count: number) => {
            if (!count) return;
            const mesh = meshes[level];
            if (level !== previousLevel) {
              gl.uniform1i(u.uSegments, mesh.segments);
              previousLevel = level;
            }
            if (slot.first !== first) {
              gl.bindBuffer(gl.ARRAY_BUFFER, slot.buffer!);
              for (let a = 0; a < 3; a++) gl.vertexAttribPointer(a, 4, gl.FLOAT, false, TREE_STRIDE * 4, first * TREE_STRIDE * 4 + a * 16);
              slot.first = first;
            }
            gl.drawElementsInstanced(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, INDEX_OFFSETS[level], count);
            stats.drawCalls++;
            stats.instances += count;
            stats.triangles += count * TRIANGLES[level];
          };
          for (let i = 0; i < visibleCount; i++) {
            const slot = visible[i],
              key = visibleKey[i],
              minX = (key % 65536) * TREES_BLOCK,
              minY = Math.floor(key / 65536) * TREES_BLOCK;
            const all = visibleAll[i],
              solid = visibleSolid[i],
              close = visibleClose[i];
            if (diagnostics) leastDensity = Math.min(leastDensity, all / Math.max(slot.count, 1));
            if (!all) continue;
            gl.uniform4f(u.uBlock, minX - tx, minY - ty, -tz, 1);
            gl.bindVertexArray(slot.vao!);
            let first = 0;
            for (let level = 0; level < TREE_MESHES.length; level++) {
              const end = level === 0 ? close : level === 1 ? solid : all;
              const prefix = slot.barePrefix;
              if (prefix) {
                const lo = prefix[first],
                  hi = prefix[end];
                draw(slot, level, first - lo, end - first - (hi - lo));
                draw(slot, BRANCH_LEVEL + level, slot.count - prefix[slot.count] + lo, hi - lo);
              } else draw(slot, level, first, end - first);
              first = end;
            }
            if (diagnostics) {
              visibleAll[i] = all;
              diagnostics.block(visibleAll, i, i + 1, minX, minY, TREES_BLOCK, tx, ty, camera.eye[0], camera.eye[1], far);
            }
          }
          diagnostics?.levels(1, 1 / Math.max(0.01, leastDensity));
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
      visibleCount = 0;
      visible.length = 0;
      presentationPending = false;
    },
    stats: () => stats,
    dispose() {
      dropAll();
      if (program) {
        gl.deleteBuffer(program.indices);
        gl.deleteBuffer(program.vertices);
        gl.deleteProgram(program.program);
      }
      if (linking) gl.deleteProgram(linking);
      program = linking = undefined;
      source = heights = inputs = undefined;
      shape = undefined;
    },
  };
}
