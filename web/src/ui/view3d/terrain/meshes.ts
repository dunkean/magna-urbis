/**
 * Patch meshes of a 3D terrain view: the height grid of each tile (sampled from the surface, or decoded from a tile's own
 * height layer), the mesh with its parent's surface for the geometric morph and its skirts, and the cooperative jobs
 * that build them nearest first. The frame loop asks for the meshes the tree needs; tile loads install decoded heights.
 */
import { createGroundDisplacementSampler } from '../../../../../rust/bridge/terrainGround';
import type { HeightLayer } from '../../terrain/contract';
import { GRID, clamp, HEIGHT_GRIDS } from './policy';
import { gridEdgeVertex } from './patchIndices';
import { spline, lakeHeight, type TerrainSurface } from './surface';
import type { TerrainViewContext } from './context';
import type { Node, Patch, Terrain3dTile, TerrainResources } from './contract';
import type { TerrainCameraRig } from './camera';
import type { PatchTree } from './patchTree';

/** Floats of a vertex: position (3), texture coordinates (2), slope (2), height and slope of the parent (3), and the
 * squeeze of the roads on steep slopes (4, render/steepRoads.ts). */
const VERTEX = 14;
/** One patch mesh, rebuilt then copied by the upload (skirts included). */
const meshValues = new Float32Array(((GRID + 1) * (GRID + 1) + 4 * (GRID + 1)) * VERTEX);

const parentValue = new Float64Array(3);

function addParentVertex(heights: Float32Array, seam: Float32Array | undefined, step: number, x: number, y: number, weight: number, out: Float64Array): void {
  const side = GRID + 1,
    x0 = Math.max(0, x - 1),
    x1 = Math.min(GRID, x + 1),
    y0 = Math.max(0, y - 1),
    y1 = Math.min(GRID, y + 1),
    i = y * side + x;
  out[0] += heights[i] * weight;
  out[1] += ((heights[y * side + x1] - heights[y * side + x0]) / ((x1 - x0) * step)) * weight;
  out[2] += ((heights[y1 * side + x] - heights[y0 * side + x]) / ((y1 - y0) * step)) * weight;
  if (seam) {
    const at = i * 3;
    out[0] += seam[at] * weight;
    out[1] += seam[at + 1] * weight;
    out[2] += seam[at + 2] * weight;
  }
}

/** Height and gradient of the parent's triangles at a world point, as the GPU interpolates them. */
function parentSample(tile: Terrain3dTile, heights: Float32Array, seam: Float32Array | undefined, x: number, y: number, out: Float64Array): void {
  const step = tile.width / GRID,
    gx = clamp((x - tile.x) / step, 0, GRID),
    gy = clamp((y - tile.y) / step, 0, GRID);
  const ix = Math.min(GRID - 1, Math.floor(gx)),
    iy = Math.min(GRID - 1, Math.floor(gy)),
    tx = gx - ix,
    ty = gy - iy;
  out[0] = out[1] = out[2] = 0;
  if (tx + ty <= 1) {
    addParentVertex(heights, seam, step, ix, iy, 1 - tx - ty, out);
    addParentVertex(heights, seam, step, ix + 1, iy, tx, out);
    addParentVertex(heights, seam, step, ix, iy + 1, ty, out);
  } else {
    addParentVertex(heights, seam, step, ix + 1, iy, 1 - ty, out);
    addParentVertex(heights, seam, step, ix, iy + 1, 1 - tx, out);
    addParentVertex(heights, seam, step, ix + 1, iy + 1, tx + ty - 1, out);
  }
}

export class PatchMeshes {
  /** Patches whose mesh the current tree needs, in build order (tile loads with heights follow it too). */
  needed: Patch[] = [];
  /** Mesh builds queued in the preparation. */
  jobs = new Map<Patch, Promise<void>>();
  /** Sampled grids by tile key (17 KB each): they outlive the textures that evict their patch, and a
   * revisited tile costs no sampling. Every input of surface() clears them through clearPatches. */
  private heightGrids = new Map<string, Float32Array>();

  constructor(
    private readonly context: TerrainViewContext,
    private readonly surface: TerrainSurface,
    private readonly tree: PatchTree,
    private readonly rig: TerrainCameraRig,
    private readonly resources: TerrainResources,
    private readonly releaseMaterial: (texture: WebGLTexture) => void,
    private readonly requireHeights: () => boolean,
  ) {}

  /** The surface changed: queued builds are dropped with the preparation, cached grids forgotten. */
  clear(): void {
    this.jobs.clear();
    this.needed = [];
    this.heightGrids.clear();
  }

  private *grid(patch: Patch): Generator<void, Float32Array> {
    if (patch.heights) return patch.heights;
    const key = patch.tile.key,
      known = this.heightGrids.get(key);
    if (known) {
      this.heightGrids.delete(key);
      this.heightGrids.set(key, known);
      return (patch.heights = known);
    }
    const side = GRID + 1,
      heights = new Float32Array(side * side),
      step = patch.tile.width / GRID;
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) heights[y * side + x] = this.surface.surface(patch.tile.x + x * step, patch.tile.y + y * step, step);
      yield;
    }
    this.heightGrids.set(key, heights);
    if (this.heightGrids.size > HEIGHT_GRIDS) this.heightGrids.delete(this.heightGrids.keys().next().value!);
    patch.heights = heights;
    return heights;
  }

  /** The grid of a tile from its own height layer, with the same detail, levelled lots, footings, cuts and lakes as the surface. */
  *decodedGrid(tile: Terrain3dTile, layer: HeightLayer): Generator<void, Float32Array> {
    if (layer.n < 2 || layer.data.length !== layer.n * layer.n || !(layer.width > 0) || tile.x < layer.x || tile.y < layer.y || tile.x + tile.width > layer.x + layer.width + 1e-5 || tile.y + tile.width > layer.y + layer.width + 1e-5)
      throw new Error('Grille de relief 3D incomplète.');
    const side = GRID + 1,
      heights = new Float32Array(side * side),
      step = tile.width / GRID,
      surface = this.surface,
      base = surface.layer!;
    const baseSample = (wx: number, wy: number): number => spline(layer.data, layer.n, (wx - layer.x) / layer.width, (wy - layer.y) / layer.width);
    const settings = this.context.ground;
    const sample = settings?.displacement
      ? createGroundDisplacementSampler(baseSample, {
          seed: settings.seed,
          climate: [settings.climate.temperature, settings.climate.precipitation],
          sourceCell: settings.sourceCell,
          macroSampler: (wx, wy) => spline(base.data, base.n, (wx - base.x) / base.width, (wy - base.y) / base.width),
        })
      : baseSample;
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const wx = tile.x + x * step,
          wy = tile.y + y * step;
        let height = sample(wx, wy, step);
        if (!Number.isFinite(height)) throw new Error('Altitude 3D non finie.');
        if (surface.groundShape) height = surface.groundShape.shape(wx, wy, height);
        height = surface.buildingGround.constrain(wx, wy, height);
        height = surface.groundCuts.lower(wx, wy, height);
        if (surface.waterVisible) {
          height = Math.max(0, height);
          const lake = surface.water && lakeHeight(surface.water, (wx - base.x) / base.width, (wy - base.y) / base.width);
          if (lake !== undefined) height = lake;
        }
        heights[y * side + x] = height;
      }
      yield;
    }
    return heights;
  }

  /** Installs a tile's decoded heights: the meshes it and its descendants carry are rebuilt, a pending texture swaps in. */
  installHeights(patch: Patch, heights: Float32Array): void {
    const tile = patch.tile;
    for (const candidate of this.tree.patches.values()) {
      const child = candidate.tile;
      if (child.level < tile.level || child.x < tile.x || child.y < tile.y || child.x + child.width > tile.x + tile.width + 1e-5 || child.y + child.width > tile.y + tile.width + 1e-5) continue;
      this.resources.releaseMesh(candidate);
      candidate.vao = undefined;
      candidate.vertices = undefined;
      candidate.meshBytes = 0;
      candidate.field = undefined;
      candidate.seamSnapshot = candidate.seamTouched = undefined;
      candidate.parentSeam = undefined;
    }
    patch.heights = heights;
    patch.hasHeight = true;
    patch.pendingHeights = undefined;
    if (patch.pendingTexture) {
      if (patch.texture) this.releaseMaterial(patch.texture);
      patch.texture = patch.pendingTexture;
      patch.textureBytes = patch.pendingTextureBytes;
      patch.textureGutter = patch.pendingTextureGutter;
      patch.texturePixels = patch.pendingTexturePixels;
      patch.pendingTexture = undefined;
      patch.pendingTextureBytes = 0;
      patch.textureFadeStart = 0;
      patch.textureProgress = 0;
      patch.materialParent = undefined;
      patch.coherentReady = true;
    }
  }

  private *buildMesh(patch: Patch): Generator<void, void> {
    const tile = patch.tile,
      side = GRID + 1,
      count = side * side;
    const heights = yield* this.grid(patch);
    const values = new Float32Array(meshValues.length),
      field = new Float32Array(count * 6),
      squeeze = this.surface.roadSqueeze,
      squeezed = new Float32Array(4);
    const step = tile.width / GRID,
      [level, ix, iy] = tile.key.split('/').map(Number);
    const parent = level ? this.tree.patch(level - 1, Math.floor(ix / 2), Math.floor(iy / 2)) : patch;
    const seam = parent === patch ? undefined : parent.seamSnapshot,
      parentHeights = yield* this.grid(parent);
    const skirt = Math.max(0.05, tile.width * 0.12);
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const i = y * side + x,
          at = i * VERTEX;
        const x0 = Math.max(0, x - 1),
          x1 = Math.min(GRID, x + 1),
          y0 = Math.max(0, y - 1),
          y1 = Math.min(GRID, y + 1);
        values[at] = x * step;
        values[at + 1] = heights[i] - patch.heightOrigin;
        values[at + 2] = y * step;
        values[at + 3] = x / GRID;
        values[at + 4] = y / GRID;
        values[at + 5] = (heights[y * side + x1] - heights[y * side + x0]) / ((x1 - x0) * step);
        values[at + 6] = (heights[y1 * side + x] - heights[y0 * side + x]) / ((y1 - y0) * step);
        parentSample(parent.tile, parentHeights, seam, tile.x + x * step, tile.y + y * step, parentValue);
        values[at + 7] = parentValue[0] - patch.heightOrigin;
        values[at + 8] = parentValue[1];
        values[at + 9] = parentValue[2];
        if (squeeze?.at(tile.x + x * step, tile.y + y * step, squeezed)) values.set(squeezed, at + 10);
        const out = i * 6;
        field[out] = values[at + 1];
        field[out + 1] = values[at + 5];
        field[out + 2] = values[at + 6];
        field[out + 3] = values[at + 7];
        field[out + 4] = values[at + 8];
        field[out + 5] = values[at + 9];
      }
      yield;
    }
    for (let edge = 0; edge < 4; edge++)
      for (let i = 0; i < side; i++) {
        const from = gridEdgeVertex(edge, i) * VERTEX,
          to = (count + edge * side + i) * VERTEX;
        for (let k = 0; k < VERTEX; k++) values[to + k] = values[from + k];
        values[to + 1] -= skirt;
        values[to + 7] -= skirt;
      }
    // Inputs can change while a row is suspended; never publish a stale mesh.
    if (patch.heights !== heights || parent.heights !== parentHeights || (parent !== patch && parent.seamSnapshot !== seam)) return;
    if (patch.vao) this.resources.releaseMesh(patch);
    this.resources.uploadMesh(patch, values);
    patch.parentSeam = seam;
    patch.field = field;
    patch.meshBytes = values.byteLength + field.byteLength;
  }

  /** Queues the meshes the current tree needs; returns whether any is being prepared. */
  prepare(): boolean {
    const root = this.tree.root;
    if (!root) return false;
    const queue: Patch[] = [],
      visit = (node: Node, incomingFull = true, parent?: Node): void => {
        // Once children cover a node, its coarse mesh is no longer needed.
        // The LRU may evict it without causing a rebuild on every later frame.
        if (!node.visible) return;
        const refreshSeam = parent?.blend === 0 && parent.patch.seamSnapshot && node.patch.parentSeam !== parent.patch.seamSnapshot;
        if ((!node.patch.vao || refreshSeam) && (!incomingFull || !node.wantsSplit || node.blend < 1 || !node.children?.every(child => this.tree.covered(child)))) queue.push(node.patch);
        // Prepare direct children while a branch opens. Deeper ancestors only
        // become relevant once that incoming morph has reached its exact endpoint.
        if (incomingFull && node.wantsSplit) node.children?.forEach(child => visit(child, node.blend >= 1, node));
      };
    visit(root);
    const c = this.rig.camera,
      context = this.context;
    queue.sort((a, b) => a.tile.level - b.tile.level || Math.hypot(a.tile.x - c.x, a.tile.y - c.y) - Math.hypot(b.tile.x - c.x, b.tile.y - c.y));
    this.needed = queue;
    const available = queue.filter(patch => {
      const [level, ix, iy] = patch.tile.key.split('/').map(Number);
      if (!this.requireHeights() || level === 0) return true;
      return patch.hasHeight && (level === 1 || this.tree.patch(level - 1, Math.floor(ix / 2), Math.floor(iy / 2)).hasHeight);
    });
    const epoch = context.epoch;
    for (const patch of available) {
      if (this.jobs.has(patch)) continue;
      const priority = () => patch.tile.level * 1e9 + Math.hypot(patch.tile.x + patch.tile.width / 2 - this.rig.camera.x, patch.tile.y + patch.tile.width / 2 - this.rig.camera.y);
      const work = context.preparation.run(this.buildMesh(patch), () => epoch === context.epoch && context.active && !context.disposed && this.tree.patches.get(patch.tile.key) === patch && this.needed.includes(patch), priority);
      this.jobs.set(patch, work);
      void work
        .catch(error => {
          if (error?.name !== 'AbortError') console.warn('Terrain mesh preparation:', error);
        })
        .finally(() => {
          if (this.jobs.get(patch) === work) this.jobs.delete(patch);
          context.request();
        });
    }
    return available.length > 0;
  }
}
