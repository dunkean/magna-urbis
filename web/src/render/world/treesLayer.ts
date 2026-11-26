/** Trees for the tilted world view. A streamed block uploads one instance buffer, shared by all three indexed
 * silhouettes. Camera motion changes the lengths of its nested instance ranges. Each tree is drawn once.
 * Hidden views retain their cache. New map terrain retires all blocks before the next draw. */
import type { LiveFrame, LiveLayerStats } from '../live/contract';
import { TreeDiagnostics, layerDiagnosticsEnabled } from '../live/layerDiagnostics';
import { TREE_STRIDE, treeBiomeKey, treeLimits, type TreeInputs, type TreeLimits } from '../../ui/terrain3dTrees';
import type { TerrainHeights } from './heights';
import { TREE_PAINT_PAGES, type TreePaintPage, type TreePaintSource } from './treePaint';
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
  /** The inputs of the near trees of the satellite looks (ui/terrain3dTrees.ts TreeInputs, made by v2/display/worldVolumes.ts),
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
  paint?(): TreePaintSource | undefined;
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
  drawn?: number;
  data: Float32Array;
  cells?: Uint32Array;
  roots: Uint32Array;
  paintBuffer?: WebGLBuffer;
  paintSource?: TreePaintSource;
  paintRevision: number;
  paintPages: TreePaintPage[];
  eligible: number;
  viewRevision: number;
  wasVisible: Uint8Array;
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
  /** The frame time, eye and target the selection was prepared for (prepare); NaN time: prepare again. */
  const preparedFor = new Float64Array(7).fill(NaN);
  const slots = new Map<number, Slot>();
  // On a biome change only the currently drawn stands can bridge the rebuild.
  const replacingBiome = new Set<number>();
  let biome = '', lastDraw = -1;
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
  let viewRevision = 0;
  const lastPose = new Float64Array(27).fill(NaN);
  let packed = new Float32Array(0), paintCoords = new Float32Array(0);
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
    if (slot.paintBuffer) gl.deleteBuffer(slot.paintBuffer);
    if (slot.vao) gl.deleteVertexArray(slot.vao);
    bytes -= slot.bytes;
  };
  const dropAll = (): void => {
    for (const slot of slots.values()) drop(slot);
    slots.clear();
    replacingBiome.clear();
    building = undefined;
    wanted = visibleCount = 0;
    visible.length = 0;
    presentationPending = false;
    preparedFor[0] = NaN;
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
    if (next) {
      const nextBiome = treeBiomeKey(next);
      if (biome && nextBiome !== biome) {
        for (const [block, slot] of slots) {
          if (slot.drawn === lastDraw) replacingBiome.add(block);
          else {
            drop(slot);
            slots.delete(block);
            replacingBiome.delete(block);
          }
        }
      }
      biome = nextBiome;
    }
    building = undefined;
    preparedFor[0] = NaN;
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
        data,
        cells: block.ids,
        roots: Uint32Array.from({ length: count }, (_, i) => i),
        eligible: count,
        paintRevision: -1,
        paintPages: [],
        viewRevision: -1,
        wasVisible: new Uint8Array(count),
        first: 0,
      };
    for (let i = 0; i < count * TREE_STRIDE; i += TREE_STRIDE) {
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
      gl.bufferData(gl.ARRAY_BUFFER, ordered, gl.DYNAMIC_DRAW);
      for (let i = 0; i < 3; i++) {
        gl.enableVertexAttribArray(i);
        gl.vertexAttribPointer(i, 4, gl.FLOAT, false, TREE_STRIDE * 4, i * 16);
        gl.vertexAttribDivisor(i, 1);
      }
      if (options.paint && block.ids) {
        slot.paintBuffer = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, slot.paintBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, count * 16, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(4);
        gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 16, 0);
        gl.vertexAttribDivisor(4, 1);
        slot.bytes += count * 16;
      }
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      bytes += slot.bytes;
    } else slot.bytes = 0;
    if (previous) drop(previous);
    slots.set(key, slot);
    replacingBiome.delete(key);
    preparedFor[0] = NaN;
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
    gl.useProgram(linking);
    for (let i = 0; i < TREE_PAINT_PAGES; i++) {
      gl.uniform1i(gl.getUniformLocation(linking, 'uPaint' + i), i * 2);
      gl.uniform1i(gl.getUniformLocation(linking, 'uKeys' + i), i * 2 + 1);
    }
    linking = undefined;
    preparedFor[0] = NaN;
    options.invalidate();
    return true;
  };
  const slice = (started: number, pending: boolean): boolean => {
    diagnostics?.slice(started);
    return pending;
  };

  /** Shared by the ground layer and the tree draw of one frame: the same time and camera reuse it. A work slice that
   * links the program, uploads a block or takes a new publication forgets it, so the next call prepares again. */
  function prepare(frame: LiveFrame): TreeSelection | undefined {
    const camera = frame.camera,
      eye = camera.eye,
      target = camera.target;
    if (frame.now === preparedFor[0] && eye[0] === preparedFor[1] && eye[1] === preparedFor[2] && eye[2] === preparedFor[3] && target[0] === preparedFor[4] && target[1] === preparedFor[5] && target[2] === preparedFor[6]) return visibleCount ? selected : undefined;
    selected.begin();
    visibleCount = 0;
    const standing = volumesDrawn(camera) && options.shown();
    tick++;
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
      const pose = [...camera.targetViewProjection, tx, ty, tz, gx, gy, drawnPerMetre, rise, focal, opacity, far, camera.pitch];
      if (pose.some((v, i) => v !== lastPose[i])) {
        lastPose.set(pose);
        viewRevision++;
      }
      const reliefPixels = focal * rise * Math.abs(Math.sin(camera.pitch)) * opacity;

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
          // Cull individual roots at the curved range boundary and the frustum sides. Only upload
          // when the membership changes; static camera frames reuse the same GPU ranges and owner IDs.
          if (slot.viewRevision !== viewRevision) {
            slot.viewRevision = viewRevision;
            let kept = 0, changed = false;
            for (let root = 0; root < slot.count; root++) {
              const j = root * TREE_STRIDE, data = slot.data;
              const rx = minX - tx + data[j], ry = minY - ty + data[j + 1];
              const rz = data[j + 2] * drawnPerMetre - tz, h = data[j + 4] * rise, r = data[j + 3];
              const range = far * (.88 + .12 * data[j + 7] / (2 * Math.PI));
              const dx = rx + tx - gx, dy = ry + ty - gy;
              const pixelHeight = data[j + 4] * reliefPixels / Math.max(closest, volume.depth(rx, ry, rz + .5 * h));
              const show = pixelHeight >= (slot.wasVisible[root] ? 2 : 4) &&
                Math.min(rx * rx + ry * ry, dx * dx + dy * dy) <= range * range &&
                volume.sees(rx, ry, rz + .5 * h, r + .5 * h);
              slot.wasVisible[root] = Number(show);
              if (!show) continue;
              if (slot.roots[kept] !== root) changed = true;
              slot.roots[kept++] = root;
            }
            if (changed || kept !== slot.eligible) {
              slot.eligible = kept;
              slot.paintRevision = -1;
              if (slot.cells) slot.ids = Uint32Array.from(slot.roots.subarray(0, kept), root => slot.cells![root]);
              const prefix = slot.barePrefix;
              if (prefix) for (let j = 0; j < kept; j++) prefix[j + 1] = prefix[j] + Number(slot.data[slot.roots[j] * TREE_STRIDE + 11] > .5);
              const floats = kept * TREE_STRIDE;
              if (packed.length < floats) packed = new Float32Array(floats);
              let leafy = 0, bare = kept - (prefix?.[kept] ?? 0);
              for (let j = 0; j < kept; j++) {
                const start = slot.roots[j] * TREE_STRIDE;
                const to = slot.data[start + 11] > .5 ? bare++ : leafy++;
                packed.set(slot.data.subarray(start, start + TREE_STRIDE), to * TREE_STRIDE);
              }
              if (kept) {
                gl.bindBuffer(gl.ARRAY_BUFFER, slot.buffer!);
                gl.bufferSubData(gl.ARRAY_BUFFER, 0, packed.subarray(0, floats));
              }
            }
          }
          const all = slot.eligible;
          if (!all) continue;
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
      // Buy a silhouette throughout the visible range before spending triangles on close detail.
      // In an exceptionally dense stand reserve some distant coverage as well as a full foreground.
      const baseBudget = Math.floor(budget * .75);
      const nearBudget = baseBudget * .65, tail = baseBudget - nearBudget;
      const cumulative = (cost: number) => {
        if (cost <= nearBudget) return cost;
        const extra = cost - nearBudget;
        return Math.floor(nearBudget + tail * extra / (tail + extra));
      };
      let passed = 0, detailLeft = budget - baseBudget;
      for (const i of nearest) {
        const slot = visible[i];
        let all = visibleAll[i];
        const cost = (n: number, lod: number) => {
          const bare = slot.barePrefix?.[n] ?? 0;
          return (n - bare) * TRIANGLES[lod] + bare * TRIANGLES[BRANCH_LEVEL + lod];
        };
        const cheap = cost(all, 2);
        const quota = cumulative(passed + cheap) - cumulative(passed);
        passed += cheap;
        if (quota < cheap) {
          let low = 0, high = all;
          while (low < high) {
            const mid = (low + high + 1) >>> 1;
            if (cost(mid, 2) <= quota) low = mid;
            else high = mid - 1;
          }
          visibleAll[i] = all = low;
        }
        if (!all) continue;
        slot.drawn = tick;
        const solid = Math.min(all, visibleSolid[i]), close = Math.min(solid, visibleClose[i]);
        const extra = cost(solid, 1) - cost(solid, 2) + cost(close, 0) - cost(close, 1);
        const allowance = Math.min(detailLeft, budget * 0.065);
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
        detailLeft -= cost(n, 1) - cost(n, 2) + cost(c, 0) - cost(c, 1);
        if (slot.ids) selected.select(visibleKey[i], slot.ids, all);
      }
    } else wanted = 0;
    for (const key of replacingBiome) {
      const slot = slots.get(key);
      if (slot && slot.checked !== revision && slot.drawn === tick) continue;
      if (slot && slot.checked !== revision) {
        drop(slot);
        slots.delete(key);
      }
      replacingBiome.delete(key);
    }
    lastDraw = tick;
    selected.end();
    preparedFor[0] = frame.now;
    for (let i = 0; i < 3; i++) {
      preparedFor[1 + i] = eye[i];
      preparedFor[4 + i] = target[i];
    }
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
      diagnostics?.selection();
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
              if (slot.paintBuffer) {
                gl.bindBuffer(gl.ARRAY_BUFFER, slot.paintBuffer);
                gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 16, first * 16);
              }
              slot.first = first;
            }
            gl.drawElementsInstanced(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, INDEX_OFFSETS[level], count);
            stats.drawCalls++;
            stats.instances += count;
            stats.triangles += count * TRIANGLES[level];
          };
          const paint = options.paint?.(), revision = paint?.revision();
          const bound: TreePaintPage[] = [];
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
            if (paint && slot.paintBuffer && slot.cells) {
              if (paint !== slot.paintSource || slot.paintRevision !== revision) {
                slot.paintPages.length = 0;
                const size = slot.eligible * 4;
                if (paintCoords.length < size) paintCoords = new Float32Array(size);
                let leafy = 0, bare = slot.eligible - (slot.barePrefix?.[slot.eligible] ?? 0);
                const parity = ((key & 1) * 8 + ((Math.floor(key / 65536) & 1) * 16) + 1) << 16;
                for (let j = 0; j < slot.eligible; j++) {
                  const root = slot.roots[j], at = root * TREE_STRIDE;
                  const leafless = slot.data[at + 11] > .5, dst = (leafless ? bare++ : leafy++) * 4;
                  const found = !leafless && paint.locate(minX + slot.data[at], minY + slot.data[at + 1], slot.data[at + 3], slot.paintPages, paintCoords, dst);
                  paintCoords[dst + 3] = found ? slot.cells[root] + parity : 0;
                }
                gl.bindBuffer(gl.ARRAY_BUFFER, slot.paintBuffer);
                gl.bufferSubData(gl.ARRAY_BUFFER, 0, paintCoords.subarray(0, size));
                slot.paintSource = paint;
                slot.paintRevision = revision!;
              }
              for (let j = 0; j < slot.paintPages.length; j++) {
                const page = slot.paintPages[j];
                if (bound[j]?.colour === page.colour && bound[j]?.crowns === page.crowns) continue;
                gl.activeTexture(gl.TEXTURE0 + 2*j);
                gl.bindTexture(gl.TEXTURE_2D_ARRAY, page.colour);
                gl.activeTexture(gl.TEXTURE0 + 2*j + 1);
                gl.bindTexture(gl.TEXTURE_2D_ARRAY, page.crowns);
                bound[j] = page;
              }
            }
            let first = 0;
            for (let level = 0; level < TREE_MESHES.length; level++) {
              const end = level === 0 ? close : level === 1 ? solid : all;
              const prefix = slot.barePrefix;
              if (prefix) {
                const lo = prefix[first],
                  hi = prefix[end];
                draw(slot, level, first - lo, end - first - (hi - lo));
                draw(slot, BRANCH_LEVEL + level, slot.eligible - prefix[slot.eligible] + lo, hi - lo);
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
          gl.activeTexture(gl.TEXTURE0);
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
      preparedFor[0] = NaN;
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
