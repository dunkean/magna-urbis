/** Camera-dependent coverage of modelled trees. treesLayer uses it before selection and work; the terrain's painted
 * crowns take over when the visible ground around the target outgrows the modelled radius. No geometry changes. */
import type { LiveFrame } from '../live/contract';
import { clampTreeDistance } from '../../ui/terrain3dTrees';
import { createCameraPose, groundHit } from './camera';
import type { WorldRelief } from './contract';

const smooth = (x: number): number => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

export class TreeCoverage {
  private readonly pose = createCameraPose();
  private readonly hit: [number, number] = [0, 0];
  /** The distant horizon is deliberately excluded: it always has painted crowns. These eight rays bound the ground
   * neighbourhood around the target (80% of the viewport width, 60% of its height), including its foreground. */
  opacity(frame: LiveFrame, relief: WorldRelief, radius: number): number {
    radius = clampTreeDistance(radius);
    const camera = frame.camera,
      pose = this.pose;
    pose.eye.set(camera.eye);
    pose.target.set(camera.target);
    pose.right.set(camera.right);
    pose.up.set(camera.up);
    pose.forward.set(camera.forward);
    pose.focal = camera.focal / frame.dpr;
    pose.rise = camera.rise;
    pose.distance = camera.distance;
    pose.plane = camera.target[2];
    pose.free = Number.isFinite(frame.view.eye);
    pose.clearance = camera.eye[2] - relief.heightAt(camera.eye[0], camera.eye[1]) * camera.rise;
    // This term already guarantees full coverage. Avoid eight terrain marches in a low orbit or on foot.
    if (pose.clearance <= 0.35 * radius) return 1;
    let extent = 0;
    for (let y = -1; y <= 1; y++)
      for (let x = -1; x <= 1; x++) {
        if (!x && !y) continue;
        const depth = groundHit(pose, frame.cssW * (0.5 + 0.4 * x), frame.cssH * (0.5 + 0.3 * y), frame.cssW, frame.cssH, relief, this.hit);
        if (!Number.isFinite(depth)) continue;
        // A ray off the map sees no forest. Clamp to the map edge, as TerrainHeights does for its height samples.
        const hx = Math.max(0, Math.min(relief.width, this.hit[0])),
          hy = Math.max(0, Math.min(relief.width, this.hit[1]));
        extent = Math.max(extent, Math.hypot(hx - camera.target[0], hy - camera.target[1]));
      }
    // Grazing rays can reach the horizon while the eye is among nearby trees. Keep that local forest visible;
    // the layer's per-tree distance fade still limits its range. A distant ray must never hide the whole layer.
    const targetCoverage = 1 - smooth((extent / radius - 0.85) / 0.3),
      eyeCoverage = 1 - smooth((pose.clearance / radius - 0.35) / 0.3);
    return Math.max(targetCoverage, eyeCoverage);
  }
}
