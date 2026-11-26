/**
 * Satellite near trees of a 3D terrain view: the instance stream around the eye (terrain3dTrees.ts builds it), when it
 * is rebuilt, how partial streams grow outward, and the uniforms through which the painted canopy gives way to the
 * modelled trees. The owner's "3D trees" switch and distance slider set it; the backend uploads and draws the instances.
 */
import { renderV2ZoneUniform } from '../../../../../rust/bridge/terrainRenderV2Zones';
import { DEFAULT_TERRAIN_LIGHTING, terrainLights } from '../../../render/terrainLighting';
import { buildNearTrees, buildNearTreesSteps, clampTreeDistance, TREE_BLOCK, TREE_DISTANCE_DEFAULT, TREE_STRIDE, treeLimits, type TreeInputs } from '../../terrain3dTrees';
import type { TerrainViewContext } from './context';
import type { FrameGeometry, TerrainResources } from './contract';
import type { TerrainCameraRig } from './camera';
import type { TerrainForest } from './forest';
import type { TerrainSurface } from './surface';

import { treeIdImage, TREE_PLAN_ANGLE, TREE_VOLUME_BLOCK, type TreeIdImage } from '../../../../../rust/bridge/treeOwnership';

export class NearTrees {
  /** Admitted crown IDs and their root blocks, read on the unused brush atlas binding. */
  owners?: TreeIdImage;
  /** Near trees on demand (the 3D view's "3D trees" switch). Off, nothing is built or drawn and the painted crowns
   * stay whole; a built stream is kept, so switching back on shows it at once. */
  enabled = false;
  /** Render distance (m): the fade starts at 2/3 of it, the instance cap grows with its square. */
  distance = TREE_DISTANCE_DEFAULT;
  /** Instances uploaded. */
  count = 0;
  /** Streams queued in the preparation: the view's readiness does not wait for them (trees stream in after). */
  jobs = 0;
  private projected = true;
  private key = '';
  private readyKey = '';
  /** Whether the displayed stream is a finished one: a later stream then replaces it whole, never by partial blocks. */
  private complete = false;
  /** Area (eye and radius) of the latest stream, and the revision of the water masks that touched it since. */
  private area?: { x: number; y: number; r: number };
  private waterRevision = 0;
  private streams = 0;

  constructor(
    private readonly context: TerrainViewContext,
    private readonly resources: TerrainResources,
    private readonly surface: TerrainSurface,
    private readonly rig: TerrainCameraRig,
    private readonly forest: TerrainForest,
    /** Displayed water cover at a point (the drape tiles' water masks). */
    private readonly waterAt: (x: number, y: number) => number,
  ) {}

  /** The surface changed: the next frame starts a new stream. */
  reset(): void {
    this.key = '';
    this.readyKey = '';
  }

  /** Inputs of the satellite near trees, or undefined when the view paints its forest only. */
  private inputs(): TreeInputs | undefined {
    const g = this.context.ground,
      field = this.forest.field;
    if (!g || !field || this.context.useMapShader || !((g.renderV2 ?? 0) > 0) || g.forestBrushes) return undefined; // satellite-2 (paperMap) shares the satellite near trees
    return {
      field,
      occupation: this.forest.occupation?.data,
      seed: g.seed >>> 0,
      climate: g.climate,
      renderV2: g.renderV2 ?? 0,
      zone: renderV2ZoneUniform(g.climateZone),
      season: g.v2Season ?? 0.5,
      crownSnow: g.v2Calendar?.crownSnow,
      climateZone: g.climateZone,
      calendar: g.v2Calendar,
      height: (x, y) => this.surface.heightAt(x, y),
      water: (x, y) => this.waterAt(x, y),
    };
  }

  /** A tile water mask came or went: the trees are rebuilt only when it overlaps their area (waterAt reads it there). */
  waterMaskChanged(x: number, y: number, width: number): void {
    const a = this.area;
    if (!a) return;
    const dx = Math.max(x - a.x, 0, a.x - x - width),
      dy = Math.max(y - a.y, 0, a.y - y - width);
    if (dx * dx + dy * dy <= a.r * a.r) ++this.waterRevision;
  }

  /** Rebuilds the near-tree instances once the eye has moved about 40 m or turned, or the inputs changed. The ground
   * LOD is not an input: tree heights read the canonical surface (heightAt), whose changes clear the patches and key. */
  prepare(frame: FrameGeometry): void {
    const sine = Math.hypot(frame.forward[0], frame.forward[2]);
    const camera = this.rig.camera;
    // Walking/flying can resolve nearby trees even with a distant look target.
    const depth = camera.navigation === 'walk' || camera.navigation === 'fly' ? 1 : Math.max(1, camera.distance);
    const pixels = (15 * camera.exaggeration * frame.focal * sine) / depth;
    this.projected = frame.forward[1] >= 0 || (sine > Math.sin(TREE_PLAN_ANGLE) && pixels >= (this.projected ? 2 : 4));
    if (this.projected) this.update(frame);
    // Test probe (forest flicker): drawn tree count and stream starts per frame, when a page installs the array.
    const trace = (globalThis as { magnaTreeTrace?: number[][] }).magnaTreeTrace;
    trace?.push([performance.now(), this.shown() ? this.count : 0, this.streams]);
  }

  private update(frame: FrameGeometry): void {
    // Hidden trees keep their stream and key: switching them back on reuses it until the eye moves.
    if (!this.enabled) return;
    const context = this.context,
      inputs = this.inputs(),
      c = this.rig.camera;
    if (!inputs) {
      this.count = 0;
      this.key = '';
      this.complete = false;
      return;
    }
    const x = c.x + frame.eye[0],
      y = c.y + frame.eye[2],
      fl = Math.hypot(frame.forward[0], frame.forward[2]) || 1;
    const lift = (frame.targetHeight + frame.eye[1]) / c.exaggeration - (this.surface.heightAt(x, y) ?? 0);
    const key =
      lift > treeLimits(this.distance).far
        ? 'high'
        : [
            this.distance,
            Math.round(x / 40),
            Math.round(y / 40),
            Math.round(c.yaw / 0.25),
            inputs.field.key,
            inputs.occupation?.key,
            inputs.occupation?.detail?.key,
            this.waterRevision,
            inputs.season,
            inputs.crownSnow,
            inputs.seed,
            inputs.climateZone,
            JSON.stringify(inputs.calendar ?? {}),
          ].join('|');
    if (key === this.key && (!context.fullQualityCapture || this.readyKey === key)) return;
    // One live stream at a time: a stream in flight finishes and is shown, then the latest key starts (restarting on
    // every 40 m or tile change never finished a stream while the camera moved).
    if (key !== 'high' && !context.fullQualityCapture && this.jobs > 0) return;
    this.key = key;
    if (key === 'high') {
      this.count = 0;
      this.readyKey = key;
      this.complete = false;
      return;
    }
    const view = { x, y, forwardX: frame.forward[0] / fl, forwardY: frame.forward[2] / fl, distance: this.distance, inView: this.inView(frame) };
    // Key cells are 40 m: masks within this radius of the stream's eye can reach a tree of this stream or the next.
    this.area = { x, y, r: treeLimits(this.distance).far + 60 };
    const ids: number[] = [];
    inputs.emittedId = id => ids.push(id);
    const upload = (values: Float32Array): void => {
      this.owners = treeIdImage(this.count, insert => {
        for (let i = 0; i < this.count; i++) {
          const offset = i * TREE_STRIDE;
          const block = Math.floor(values[offset + 1] / TREE_VOLUME_BLOCK) * 65536 + Math.floor(values[offset] / TREE_VOLUME_BLOCK);
          insert(ids[i], block);
        }
      });
      this.resources.uploadTrees(values);
    };
    const install = (values: Float32Array): void => {
      this.count = values.length / TREE_STRIDE;
      this.readyKey = key;
      this.complete = true;
      (globalThis as { magnaNearTrees?: number }).magnaNearTrees = this.count;
      if (this.count) upload(values);
    };
    // Capture uses the exact stream immediately, independent of a live queue's progress.
    if (context.fullQualityCapture) {
      install(buildNearTrees(inputs, view));
      return;
    }
    const epoch = context.epoch,
      current = (): boolean => !context.captureMode && !context.disposed && epoch === context.epoch && this.key !== 'high' && this.key !== '';
    // Nearest blocks first: while no finished stream is shown, a partial stream replaces a smaller one, so trees grow
    // outward from the eye. A finished stream stays drawn whole until its replacement is finished (no blocks dropped).
    const partial = (values: Float32Array): void => {
      if (!current() || this.complete || values.length / TREE_STRIDE <= this.count) return;
      this.count = values.length / TREE_STRIDE;
      if (this.count) {
        upload(values);
        context.request();
      }
    };
    this.jobs++;
    this.streams++;
    void context.preparation
      .run(buildNearTreesSteps(inputs, view, partial), current, 1e15)
      .then(values => {
        install(values);
        context.request();
      })
      .catch(error => {
        if (error?.name !== 'AbortError') console.warn('Terrain tree preparation:', error);
      })
      .finally(() => {
        this.jobs--;
      });
  }

  /** Whether a tree block (side TREE_BLOCK, from its ground to the tallest crown) meets the frame's view, with a margin
   * for small turns: a clip-space outcode test of its eight corners, conservative (never drops a visible block). */
  private inView(frame: FrameGeometry): (x: number, y: number) => boolean {
    const c = this.rig.camera,
      m = frame.matrix,
      half = TREE_BLOCK / 2,
      margin = 1.2;
    return (x, y) => {
      const ground = (this.surface.heightAt(x, y) ?? 0) * c.exaggeration - frame.targetHeight;
      let codes = 0x1f;
      for (let k = 0; k < 8; k++) {
        const lx = x - c.x + (k & 1 ? half : -half),
          lz = y - c.y + (k & 2 ? half : -half),
          ly = ground + (k & 4 ? 50 : -8) * c.exaggeration;
        const px = m[0] * lx + m[4] * ly + m[8] * lz + m[12],
          py = m[1] * lx + m[5] * ly + m[9] * lz + m[13],
          w = (m[3] * lx + m[7] * ly + m[11] * lz + m[15]) * margin;
        codes &= (px < -w ? 1 : 0) | (px > w ? 2 : 0) | (py < -w ? 4 : 0) | (py > w ? 8 : 0) | (w <= 0 ? 16 : 0);
        if (!codes) return true;
      }
      return false;
    };
  }

  /** uForestTrees of the ground shader: eye xy and the fade radii, w = 0 without trees. */
  forestTreesUniform(frame: FrameGeometry): [number, number, number, number] {
    const limits = treeLimits(this.distance);
    return [this.rig.camera.x + frame.eye[0], this.rig.camera.y + frame.eye[2], limits.near, this.shown() ? limits.far : 0];
  }

  /** Whether near trees are drawn this frame. */
  shown(): boolean {
    return this.enabled && this.projected && this.count > 0;
  }

  /** The 3D view's "3D trees" switch: built lazily on first use, then only hidden or shown. */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.context.request();
  }

  /** The 3D view's "tree distance" slider (m): only the tree layer is rebuilt, around the eye, nearest trees first. */
  setDistance(metres: number): void {
    const distance = clampTreeDistance(metres);
    if (this.distance === distance) return;
    this.distance = distance;
    this.context.request();
  }

  /** Primary light direction of the trees, in the ground's axes. */
  light(): [number, number, number] {
    const lights = terrainLights((this.context.ground ?? this.forest.settings)?.lighting ?? DEFAULT_TERRAIN_LIGHTING);
    return [lights.primary[0], lights.primary[2], lights.primary[1]];
  }
}
