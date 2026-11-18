import { describe, expect, it } from 'vitest';
import { MAX_PITCH, clampPitch, createCameraPose, createFrameCamera, frameCamera, groundPoint, isTilted, panOnGround, poseCamera, riseAt, topViewMapping, wrapYaw, zoomAtGround } from '../src/render/world/camera';
import type { FrameCamera, WorldRelief } from '../src/render/world/contract';
import type { View } from '../src/render/view';

const W = 1280,
  H = 720,
  DPR = 1.5,
  PX_W = Math.round(W * DPR),
  PX_H = Math.round(H * DPR);

/** Clip coordinates of a point after the perspective divide, and the CSS pixel it falls on. */
function project(matrix: Float32Array, x: number, y: number, z: number): { ndc: [number, number, number]; css: [number, number]; w: number } {
  const at = (row: number): number => matrix[row] * x + matrix[4 + row] * y + matrix[8 + row] * z + matrix[12 + row];
  const w = at(3),
    ndc: [number, number, number] = [at(0) / w, at(1) / w, at(2) / w];
  return { ndc, css: [((ndc[0] + 1) / 2) * W, ((1 - ndc[1]) / 2) * H], w };
}
function cameraOf(view: View, relief?: WorldRelief): FrameCamera {
  const camera = createFrameCamera();
  frameCamera(camera, view, W, H, PX_W, PX_H, DPR, relief);
  return camera;
}
/** A slope rising to the east with a ridge across it. */
const hills: WorldRelief = { width: 40000, low: 0, high: 1300, heightAt: (x, y) => Math.max(0, Math.min(1300, 200 + x * 0.02 + 300 * Math.sin(y / 900))) };

describe('world camera', () => {
  it('is the 2D mapping of the map in the top view', () => {
    const view: View = { cx: 12345.6, cy: 23456.7, scale: 0.37 },
      camera = cameraOf(view);
    // The mapping the compositor has always given its layers.
    const s = view.scale * DPR,
      tx = PX_W / 2 - view.cx * s,
      ty = PX_H / 2 - view.cy * s;
    const worldToClip = new Float32Array(9),
      worldToPixel = [0, 0, 0, 0];
    topViewMapping(view, PX_W, PX_H, DPR, worldToClip, worldToPixel);
    expect(Array.from(worldToClip)).toEqual(Array.from(new Float32Array([(2 * s) / PX_W, 0, 0, 0, (-2 * s) / PX_H, 0, (2 * tx) / PX_W - 1, 1 - (2 * ty) / PX_H, 1])));
    expect(worldToPixel).toEqual([s, s, tx, ty]);
    expect(camera.tilted).toBe(false);
    expect(camera.rise).toBe(0);
    // The 4x4 is that same mapping, whatever the height.
    expect(Array.from(camera.viewProjection)).toEqual([worldToClip[0], 0, 0, 0, 0, worldToClip[4], 0, 0, 0, 0, 0, 0, worldToClip[6], worldToClip[7], 0, 1]);
    for (const [x, y, z] of [
      [12000, 23000, 0],
      [13000, 24000, 850],
    ]) {
      const { ndc } = project(camera.viewProjection, x, y, z);
      expect(ndc[0]).toBeCloseTo(worldToClip[0] * x + worldToClip[6], 5);
      expect(ndc[1]).toBeCloseTo(worldToClip[4] * y + worldToClip[7], 5);
    }
    // A view that carries a zero pitch and yaw is the top view too.
    expect(isTilted({ ...view, pitch: 0, yaw: 0 })).toBe(false);
    expect(Array.from(cameraOf({ ...view, pitch: 0, yaw: 0 }).viewProjection)).toEqual(Array.from(camera.viewProjection));
  });

  it('meets the top view without a jump: a hair of tilt draws the flat map where the 2D mapping does', () => {
    const view: View = { cx: 20000, cy: 20000, scale: 0.05, pitch: 1e-5 },
      camera = cameraOf(view, hills),
      flat = cameraOf({ cx: view.cx, cy: view.cy, scale: view.scale });
    expect(camera.tilted).toBe(true);
    expect(camera.rise).toBeLessThan(1e-8);
    for (const [x, y] of [
      [20000, 20000],
      [9000, 14000],
      [31000, 26500],
    ]) {
      const tiltedAt = project(camera.viewProjection, x, y, hills.heightAt(x, y) * camera.rise).css,
        flatAt = project(flat.viewProjection, x, y, 0).css;
      expect(Math.hypot(tiltedAt[0] - flatAt[0], tiltedAt[1] - flatAt[1])).toBeLessThan(0.05);
    }
  });

  it('keeps the target at the centre and its scale at every pitch and yaw', () => {
    for (const [pitch, yaw] of [
      [0.4, 0],
      [1.1, 0.7],
      [MAX_PITCH, -2.4],
    ]) {
      const view: View = { cx: 18000, cy: 22000, scale: 0.8, pitch, yaw },
        camera = cameraOf(view, hills),
        [tx, ty, tz] = camera.target;
      expect(tz).toBeCloseTo(hills.heightAt(tx, ty) * camera.rise, 6);
      const centre = project(camera.viewProjection, tx, ty, tz);
      expect(centre.css[0]).toBeCloseTo(W / 2, 2);
      expect(centre.css[1]).toBeCloseTo(H / 2, 2);
      // A metre across the view axis at the target is `scale` CSS pixels.
      const beside = project(camera.viewProjection, tx + camera.right[0], ty + camera.right[1], tz);
      expect(beside.css[0] - centre.css[0]).toBeCloseTo(view.scale, 3);
      // The matrix relative to the target is the same projection.
      const relative = project(camera.targetViewProjection, 300, -200, 40),
        absolute = project(camera.viewProjection, tx + 300, ty - 200, tz + 40);
      expect(relative.ndc[0]).toBeCloseTo(absolute.ndc[0], 3);
      expect(relative.ndc[1]).toBeCloseTo(absolute.ndc[1], 3);
      // Yaw is the compass direction at the top of the screen.
      const ahead = project(camera.viewProjection, tx + Math.sin(yaw) * 5, ty - Math.cos(yaw) * 5, tz);
      expect(ahead.css[1]).toBeLessThan(centre.css[1]);
      expect(ahead.css[0]).toBeCloseTo(centre.css[0], 2);
      expect(centre.ndc[2]).toBeGreaterThan(-1);
      expect(centre.ndc[2]).toBeLessThan(1);
    }
  });

  it('keeps the eye above the ground', () => {
    // A cliff south of the target: the eye of a steep tilt looking north would be inside it.
    const cliff: WorldRelief = { width: 4000, low: 0, high: 900, heightAt: (_x, y) => (y > 2040 ? 900 : 0) };
    const pose = poseCamera(createCameraPose(), { cx: 2000, cy: 2000, scale: 4, pitch: MAX_PITCH }, H, cliff);
    expect(pose.eye[1]).toBeGreaterThan(2040);
    expect(pose.eye[2]).toBeGreaterThan(900);
    // Still aimed at the target.
    const along = [pose.target[0] - pose.eye[0], pose.target[1] - pose.eye[1], pose.target[2] - pose.eye[2]],
      length = Math.hypot(...along);
    for (let i = 0; i < 3; i++) expect(pose.forward[i]).toBeCloseTo(along[i] / length, 9);
    expect(pose.distance).toBeCloseTo(length, 9);
  });

  it('finds the ground point under a pixel, on the plane and on the terrain', () => {
    const view: View = { cx: 20000, cy: 20000, scale: 0.3, pitch: 1, yaw: 0.5 },
      out: [number, number] = [0, 0];
    // The plane through the target.
    const pose = poseCamera(createCameraPose(), view, H),
      flat = cameraOf(view);
    for (const [sx, sy] of [
      [W / 2, H / 2],
      [200, 600],
      [1100, 420],
    ]) {
      expect(groundPoint(pose, sx, sy, W, H, undefined, out)).toBe(true);
      const back = project(flat.viewProjection, out[0], out[1], 0).css;
      expect(back[0]).toBeCloseTo(sx, 1);
      expect(back[1]).toBeCloseTo(sy, 1);
    }
    expect(out).not.toEqual([view.cx, view.cy]);
    // Above the horizon there is no ground.
    expect(groundPoint(pose, W / 2, -4000, W, H, undefined, out)).toBe(false);
    // The terrain: the point found, at its height, is under the pixel.
    const onHills = poseCamera(createCameraPose(), view, H, hills),
      camera = cameraOf(view, hills);
    for (const [sx, sy] of [
      [W / 2, H / 2],
      [300, 650],
      [900, 300],
    ]) {
      expect(groundPoint(onHills, sx, sy, W, H, hills, out)).toBe(true);
      const back = project(camera.viewProjection, out[0], out[1], hills.heightAt(out[0], out[1]) * camera.rise).css;
      expect(Math.hypot(back[0] - sx, back[1] - sy)).toBeLessThan(1.5);
    }
  });

  it('pans and zooms a tilted view on the ground', () => {
    const view: View = { cx: 20000, cy: 20000, scale: 0.3, pitch: 0.9, yaw: -0.8 },
      a: [number, number] = [0, 0],
      b: [number, number] = [0, 0];
    const pose = createCameraPose();
    groundPoint(poseCamera(pose, view, H), 500, 500, W, H, undefined, a);
    const moved = panOnGround(view, 500, 500, 560, 470, W, H);
    expect(moved.pitch).toBe(view.pitch);
    expect(moved.yaw).toBe(view.yaw);
    groundPoint(poseCamera(pose, moved, H), 560, 470, W, H, undefined, b);
    expect(b[0]).toBeCloseTo(a[0], 6);
    expect(b[1]).toBeCloseTo(a[1], 6);
    // The ground under the cursor stays under it through a zoom.
    const closer = zoomAtGround(view, 1.5, 500, 500, W, H);
    expect(closer.scale).toBeCloseTo(view.scale * 1.5, 12);
    groundPoint(poseCamera(pose, closer, H), 500, 500, W, H, undefined, b);
    expect(b[0]).toBeCloseTo(a[0], 6);
    expect(b[1]).toBeCloseTo(a[1], 6);
    // A cursor at the horizon neither throws the map away nor loses the zoom.
    const far = zoomAtGround(view, 2, W / 2, -4000, W, H);
    expect(far).toEqual({ ...view, scale: view.scale * 2 });
  });

  it('bounds the pitch, wraps the yaw and raises the relief with the pitch', () => {
    expect(clampPitch(-1)).toBe(0);
    expect(clampPitch(3)).toBe(MAX_PITCH);
    expect(clampPitch(undefined)).toBe(0);
    expect(clampPitch(NaN)).toBe(0);
    expect(wrapYaw(Math.PI * 2.5)).toBeCloseTo(Math.PI / 2, 12);
    expect(wrapYaw(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2, 12);
    expect(wrapYaw(undefined)).toBe(0);
    expect(isTilted({ cx: 0, cy: 0, scale: 1 })).toBe(false);
    expect(isTilted({ cx: 0, cy: 0, scale: 1, yaw: 0.3 })).toBe(true);
    expect(riseAt(0)).toBe(0);
    expect(riseAt(0.1)).toBeGreaterThan(0);
    expect(riseAt(0.1)).toBeLessThan(1);
    expect(riseAt(0.3)).toBe(1);
    expect(riseAt(MAX_PITCH)).toBe(1);
  });
});
