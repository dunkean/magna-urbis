import { describe, expect, it } from 'vitest';
import { WALK_EYE_HEIGHT, createCameraPose, createFrameCamera, frameCamera, groundPoint, isFreeEye, isTilted, poseCamera, screenProjection, viewFootprint } from '../src/render/world/camera';
import type { WorldRelief } from '../src/render/world/contract';
import { FLIGHT_SPEED, WALK_FAST, WALK_SPEED, enterFreeEye, leaveFreeEye, lookFreeEye, moveFreeEye, switchFreeEye } from '../src/render/world/navigation';
import { worldToScreen, type View } from '../src/render/view';

const W = 1280,
  H = 720;
/** A slope rising to the east with a ridge across it. */
const hills: WorldRelief = { width: 40000, low: 0, high: 1300, heightAt: (x, y) => Math.max(0, Math.min(1300, 200 + x * 0.02 + 300 * Math.sin(y / 900))) };
const orbit: View = { cx: 15000, cy: 18000, scale: 0.8, pitch: 1, yaw: 0.6 };

describe('walking and flying', () => {
  it('walks at a person height over the ground, along the ground it faces', () => {
    const walker = enterFreeEye(orbit, 'walk', H, hills);
    expect(isFreeEye(walker) && isTilted(walker)).toBe(true);
    expect([walker.cx, walker.cy]).toEqual([orbit.cx, orbit.cy]);
    expect(walker.eye).toBeCloseTo(hills.heightAt(orbit.cx, orbit.cy) + WALK_EYE_HEIGHT, 9);
    // It looks just under the horizon, the way the orbit faced.
    expect(walker.pitch!).toBeGreaterThan(1.4);
    expect(walker.pitch!).toBeLessThan(Math.PI / 2);
    expect(walker.yaw).toBeCloseTo(0.6, 9);
    // One second forward, facing north: 12 m north, the eye still 1.7 m over the ground there.
    const north = moveFreeEye({ ...walker, yaw: 0 }, 'walk', 1, 0, 0, 1, false, hills);
    expect(north.cx).toBeCloseTo(walker.cx, 9);
    expect(walker.cy - north.cy).toBeCloseTo(WALK_SPEED, 9);
    expect(north.eye).toBeCloseTo(hills.heightAt(north.cx, north.cy) + WALK_EYE_HEIGHT, 9);
    // Sideways to the right facing east goes south; Shift runs; a diagonal is no faster than a straight line.
    const right = moveFreeEye({ ...walker, yaw: Math.PI / 2 }, 'walk', 0, 1, 0, 1, true, hills);
    expect(right.cy - walker.cy).toBeCloseTo(WALK_SPEED * WALK_FAST, 9);
    const diagonal = moveFreeEye(walker, 'walk', 1, 1, 0, 1, false, hills);
    expect(Math.hypot(diagonal.cx - walker.cx, diagonal.cy - walker.cy)).toBeCloseTo(WALK_SPEED, 9);
  });

  it('poses a free eye over its place, the relief at full height, out of the ground', () => {
    const view: View = { cx: 15000, cy: 18000, scale: 0.8, pitch: 1.5, yaw: 0, eye: -500 },
      pose = poseCamera(createCameraPose(), view, H, hills),
      ground = hills.heightAt(15000, 18000);
    // An eye given under the ground stands at a walker's height instead.
    expect(pose.free && pose.tilted).toBe(true);
    expect(pose.rise).toBe(1);
    expect(Array.from(pose.eye)).toEqual([15000, 18000, ground + WALK_EYE_HEIGHT]);
    expect(Array.from(pose.target)).toEqual([15000, 18000, ground]);
    expect(pose.clearance).toBeCloseTo(WALK_EYE_HEIGHT, 9);
    // Facing north just under the horizon: the forward axis points north and slightly down.
    expect(pose.forward[1]).toBeLessThan(-0.99);
    expect(pose.forward[2]).toBeLessThan(0);
    // The frame: a near plane under the walker's feet, haze and names scaled by its reach rather than its height.
    const camera = createFrameCamera();
    frameCamera(camera, view, W, H, W, H, 1, hills);
    expect(camera.near).toBeLessThan(WALK_EYE_HEIGHT / 2);
    expect(camera.distance).toBeGreaterThanOrEqual(hills.width);
    expect(camera.rise).toBe(1);
    // A pitch above the horizon is allowed (looking up), within bounds.
    const up = poseCamera(createCameraPose(), { ...view, pitch: 2.5 }, H, hills);
    expect(up.forward[2]).toBeGreaterThan(0);
    expect(poseCamera(createCameraPose(), { ...view, pitch: 9 }, H, hills).pitch).toBeLessThan(Math.PI);
  });

  it('flies along the look, keeps its altitude and never goes into the ground', () => {
    const flyer = enterFreeEye(orbit, 'fly', H, hills),
      at = poseCamera(createCameraPose(), orbit, H, hills);
    // The orbit's own eye, looking where it looked.
    expect(flyer.cx).toBeCloseTo(at.eye[0], 6);
    expect(flyer.cy).toBeCloseTo(at.eye[1], 6);
    expect(flyer.eye).toBeCloseTo(at.eye[2], 6);
    expect(flyer.pitch).toBeCloseTo(1, 9);
    // Level flight: a horizontal look keeps the altitude, up/down keys change it.
    const level = { ...flyer, pitch: Math.PI / 2, yaw: 0 },
      ahead = moveFreeEye(level, 'fly', 1, 0, 0, 1, false, hills);
    expect(level.cy - ahead.cy).toBeCloseTo(FLIGHT_SPEED, 6);
    expect(ahead.eye).toBeCloseTo(level.eye!, 6);
    expect(moveFreeEye(level, 'fly', 0, 0, 1, 1, false, hills).eye! - level.eye!).toBeCloseTo(FLIGHT_SPEED, 6);
    // Diving into the hill stops at a walker's height over it.
    let dive: View = { ...level, pitch: 0.1 };
    for (let i = 0; i < 400; i++) dive = moveFreeEye(dive, 'fly', 1, 0, 0, 1, true, hills);
    expect(dive.eye! - hills.heightAt(dive.cx, dive.cy)).toBeGreaterThanOrEqual(WALK_EYE_HEIGHT - 1e-9);
    // Landing stands on the ground; taking off keeps the eye.
    expect(switchFreeEye(level, 'walk', hills).eye).toBeCloseTo(hills.heightAt(level.cx, level.cy) + WALK_EYE_HEIGHT, 9);
    expect(switchFreeEye(level, 'fly', hills).eye).toBe(level.eye);
  });

  it('looks around with a drag and returns to the orbit on the ground it looks at', () => {
    const walker = enterFreeEye(orbit, 'walk', H, hills);
    const turned = lookFreeEye(walker, 100, 50);
    expect(turned.yaw!).toBeGreaterThan(walker.yaw!);
    expect(turned.pitch!).toBeLessThan(walker.pitch!);
    expect(lookFreeEye(walker, 0, -1e5).pitch!).toBeLessThan(Math.PI);
    expect(lookFreeEye(walker, 0, 1e5).pitch!).toBeGreaterThan(0);
    // Looking down at the ground nearby: the orbit is centred there, at the pitch it had.
    const down = { ...walker, pitch: 0.6 },
      point: [number, number] = [0, 0];
    expect(groundPoint(poseCamera(createCameraPose(), down, H, hills), W / 2, H / 2, W, H, hills, point)).toBe(true);
    const back = leaveFreeEye(down, 1, W, H, hills);
    expect(isFreeEye(back)).toBe(false);
    expect([back.cx, back.cy, back.pitch, back.scale]).toEqual([point[0], point[1], 1, orbit.scale]);
    // Looking above the horizon there is no ground: the orbit is centred where the eye stood.
    const sky = leaveFreeEye({ ...walker, pitch: 2.2 }, 1, W, H, hills);
    expect([sky.cx, sky.cy]).toEqual([walker.cx, walker.cy]);
  });
});

describe('screen projection and footprint', () => {
  it('projects ground points onto the pixels they are picked at', () => {
    for (const view of [orbit, { ...orbit, pitch: 0.3, yaw: -2 }, enterFreeEye(orbit, 'walk', H, hills), { ...enterFreeEye(orbit, 'fly', H, hills), pitch: 0.9 }]) {
      const pose = poseCamera(createCameraPose(), view, H, hills),
        projection = screenProjection(view, W, H, hills),
        point: [number, number] = [0, 0],
        pixel: [number, number] = [0, 0];
      expect(projection.tilted).toBe(true);
      for (const [sx, sy] of [
        [W / 2, H / 2],
        [100, H - 50],
        [W - 200, H * 0.7],
      ]) {
        if (!groundPoint(pose, sx, sy, W, H, hills, point)) continue;
        expect(projection.project(point[0], point[1], pixel)).toBe(true);
        expect(Math.hypot(pixel[0] - sx, pixel[1] - sy)).toBeLessThan(0.5);
      }
    }
    // The top view is the 2D mapping.
    const top: View = { cx: 1000, cy: 2000, scale: 0.5 },
      pixel: [number, number] = [0, 0];
    expect(screenProjection(top, W, H, hills).project(1100, 1900, pixel)).toBe(true);
    expect(pixel).toEqual(worldToScreen(top, W, H, 1100, 1900));
    // Behind the eye: no pixel.
    const walker = { ...enterFreeEye(orbit, 'walk', H, hills), yaw: 0 };
    expect(screenProjection(walker, W, H, hills).project(walker.cx, walker.cy + 500, pixel)).toBe(false);
  });

  it('outlines what a tilted view sees, cut towards the horizon', () => {
    const out = new Float64Array(8),
      near = { cx: 20000, cy: 20000, scale: 1, pitch: 0.2, yaw: 0 };
    viewFootprint(near, W, H, undefined, out);
    // Nearly the top view: about the screen rectangle, the far edge (top) a little wider than the near one.
    expect(out[2] - out[0]).toBeGreaterThan(out[4] - out[6]);
    expect(out[4] - out[6]).toBeGreaterThan(W * 0.85);
    expect(out[5] - out[1]).toBeGreaterThan(H * 0.8);
    // At the steepest tilt the top corners stop within reach instead of the horizon.
    viewFootprint({ ...near, pitch: 1.22 }, W, H, undefined, out);
    const distance = poseCamera(createCameraPose(), { ...near, pitch: 1.22 }, H).distance;
    for (let i = 0; i < 4; i++) expect(Math.hypot(out[i * 2] - near.cx, out[i * 2 + 1] - near.cy)).toBeLessThan(distance * 9);
    expect(out[1]).toBeLessThan(near.cy - H);
  });
});
