/**
 * Raised illustration stamps of a 3D terrain view (illustrated mountains and woods standing up from the drape): the
 * stamps given by the owner, the instance stream built from them (all of them, or those near the eye at light display
 * quality) and its upload. The backend draws the instances; the drape fades its painted stamps by the same blend.
 */
import { displayQualityFor } from '../../../render/displayQuality';
import { terrain3dRaisedBlend, type Terrain3dBillboard, type Terrain3dBillboards } from '../../terrain3dBillboards';
import { BILLBOARD_LIGHT_RADIUS } from './policy';
import type { TerrainViewContext } from './context';
import type { FrameGeometry, TerrainResources } from './contract';
import type { TerrainCameraRig } from './camera';
import type { TerrainSurface } from './surface';

export class TerrainBillboards {
  source?: Terrain3dBillboards;
  /** Instances uploaded. */
  count = 0;
  /** The stream must be rebuilt (stamps, relief or display quality changed). */
  dirty = false;
  private key = '';
  private readyKey = '';

  constructor(
    private readonly context: TerrainViewContext,
    private readonly resources: TerrainResources,
    private readonly surface: TerrainSurface,
    private readonly rig: TerrainCameraRig,
    /** Whether the backend can draw the uploaded instances (program linked, pipeline created). */
    readonly ready: () => boolean,
  ) {}

  /** Also accepted by setTexture so the renderer host mirrors this input during backend replacement. */
  set(stamps: readonly Terrain3dBillboard[] | undefined, atlas?: HTMLCanvasElement): void {
    if (this.source?.stamps === stamps && this.source?.atlas === atlas) return;
    this.source = stamps && atlas ? { stamps, atlas } : undefined;
    this.dirty = true;
    this.context.request();
  }

  prepare(): void {
    const context = this.context,
      light = displayQualityFor(!context.fullQualityCapture && !context.captureMode) === 'light' && context.look.paperMap;
    const frame = this.rig.frameGeometry(),
      x = this.rig.camera.x + frame.eye[0],
      y = this.rig.camera.y + frame.eye[2];
    const key = light ? `${Math.round(x / 80)}|${Math.round(y / 80)}|light` : 'full';
    if (!this.dirty && key === this.key && (!context.fullQualityCapture || this.readyKey === key)) return;
    this.dirty = false;
    this.key = key;
    const source = this.source,
      surface = this.surface;
    const work = (function* (): Generator<void, Float32Array> {
      const values: number[] = [];
      if (source)
        for (let i = 0; i < source.stamps.length; i++) {
          if (i % 64 === 0) yield;
          const stamp = source.stamps[i];
          if (light && Math.hypot(stamp.x - x, stamp.y - y) > BILLBOARD_LIGHT_RADIUS) continue;
          const [u, v, w, h] = stamp.rect,
            aw = source.atlas.width,
            ah = source.atlas.height;
          values.push(stamp.x, stamp.y, surface.heightAt(stamp.x, stamp.y) ?? 0, stamp.width, (1 + u * aw) / (aw + 2), (1 + v * ah) / (ah + 2), (w * aw) / (aw + 2), (h * ah) / (ah + 2), stamp.height, stamp.flip ? -1 : 1, stamp.opacity, 0);
        }
      return new Float32Array(values);
    })();
    const install = (values: Float32Array): void => {
      this.count = values.length / 12;
      this.readyKey = key;
      this.resources.uploadBillboards(values, source?.atlas);
    };
    if (context.fullQualityCapture) {
      let step = work.next();
      while (!step.done) step = work.next();
      install(step.value);
      return;
    }
    const epoch = context.epoch;
    void context.preparation
      .run(work, () => !context.captureMode && !context.disposed && epoch === context.epoch && this.key === key && this.source === source, 1e14)
      .then(values => {
        install(values);
        context.request();
      })
      .catch(error => {
        if (error?.name !== 'AbortError') console.warn('Terrain billboard preparation:', error);
      });
  }

  /** How far the stamps stand up: none seen from above, full at a grazing view. */
  raisedBlend(frame: FrameGeometry): number {
    return this.count && this.ready() ? terrain3dRaisedBlend(Math.max(0, -frame.forward[1])) : 0;
  }
}
