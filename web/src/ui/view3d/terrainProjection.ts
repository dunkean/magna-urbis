/**
 * Terrain/building picking and screen/label projection, called through Terrain3d by city overlays.
 * Reads/writes: Reads camera geometry, displayed grids and building faces from the supplied context; returns hits/projectors without mutating view state.
 */
import { gridHeight, raycastGrid } from '../terrain3dPicking';
import type { BuildingVector } from '../../render/urbanBuildingGeometry';
import { Vec3 } from './terrainTypes';
import type { Terrain3dContext } from './terrainContext';

/** Select the nearest actual building face using its physical native geometry. */
export function pickBuilding(context: Terrain3dContext, x: number, y: number): string | undefined {
  if (!context.layer || !context.active || !context.buildingScene || !context.buildingsVisible) return undefined;
  const frame = context.frameGeometry(),
    c = context.camera;
  const u = (x - context.width / 2) / frame.focal,
    v = (context.height / 2 - y) / frame.focal;
  const ray: Vec3 = [0, 1, 2].map(i => frame.forward[i] + u * frame.right[i] + v * frame.up[i]) as Vec3;
  const origin: BuildingVector = [c.x + frame.eye[0], c.y + frame.eye[2], (frame.targetHeight + frame.eye[1]) / c.exaggeration];
  const direction: BuildingVector = [ray[0], ray[2], ray[1] / c.exaggeration];
  const { distance: nearest, id } = context.buildings.pick(origin, direction);
  // Ground occludes buildings behind hills, just as the depth buffer does.
  const glOrigin: Vec3 = [origin[0], origin[2] * c.exaggeration, origin[1]];
  let ground = Infinity;
  for (const grid of context.displayedGrids) {
    const hit = raycastGrid(grid, glOrigin, ray);
    if (hit !== null) ground = Math.min(ground, hit);
  }
  return nearest <= ground + 0.01 ? id : undefined;
}

/** Pick the nearest visible terrain triangle in CSS pixels, including LOD morphs and refined heights. */
export function screenToWorld(context: Terrain3dContext, x: number, y: number): [number, number] | null {
  if (!context.layer || !context.active) return null;
  const frame = context.frameGeometry(),
    c = context.camera;
  const u = (x - context.width / 2) / frame.focal,
    v = (context.height / 2 - y) / frame.focal;
  const direction: Vec3 = [0, 1, 2].map(i => frame.forward[i] + u * frame.right[i] + v * frame.up[i]) as Vec3;
  const origin: Vec3 = [c.x + frame.eye[0], frame.targetHeight + frame.eye[1], c.y + frame.eye[2]];
  let nearest = Infinity;
  for (const grid of context.displayedGrids) {
    const hit = raycastGrid(grid, origin, direction);
    if (hit !== null) nearest = Math.min(nearest, hit);
  }
  return Number.isFinite(nearest) ? [origin[0] + direction[0] * nearest, origin[2] + direction[2] * nearest] : null;
}

export function worldToScreen(context: Terrain3dContext, x: number, y: number): [number, number] | null {
  if (!context.layer || !context.active) return null;
  let height: number | null = null;
  for (const grid of context.displayedGrids) {
    height = gridHeight(grid, x, y);
    if (height !== null) break;
  }
  if (height === null) return null;
  const frame = context.frameGeometry(),
    c = context.camera;
  const relative: Vec3 = [x - c.x - frame.eye[0], height - frame.targetHeight - frame.eye[1], y - c.y - frame.eye[2]];
  const dot = (axis: Vec3): number => relative[0] * axis[0] + relative[1] * axis[1] + relative[2] * axis[2];
  const depth = dot(frame.forward);
  return depth > 0 ? [context.width / 2 + (frame.focal * dot(frame.right)) / depth, context.height / 2 - (frame.focal * dot(frame.up)) / depth] : null;
}

/** One camera basis per text update; canonical terrain heights also reject anchors behind hills. */
export function labelProjector(context: Terrain3dContext): { scale: number; project(x: number, y: number): [number, number] | null } | undefined {
  if (!context.layer || !context.active) return undefined;
  const frame = context.frameGeometry(),
    c = context.camera,
    width = context.width,
    height = context.height,
    layer = context.layer;
  const ex = c.x + frame.eye[0],
    ey = c.y + frame.eye[2],
    ez = frame.targetHeight + frame.eye[1];
  const far = Math.max(c.distance * 4, context.layer.width * 2 + context.heightRange * c.exaggeration * 2);
  return {
    scale: frame.focal / Math.max(1, c.distance),
    project: (x, y) => {
      const z = (context.heightAt(x, y) ?? 0) * c.exaggeration + 0.6;
      const dx = x - ex,
        dy = z - ez,
        dz = y - ey;
      const dot = (axis: Vec3): number => dx * axis[0] + dy * axis[1] + dz * axis[2];
      const depth = dot(frame.forward);
      if (depth <= 0.02 || depth > far) return null;
      const sx = width / 2 + (frame.focal * dot(frame.right)) / depth,
        sy = height / 2 - (frame.focal * dot(frame.up)) / depth;
      if (sx < 0 || sy < 0 || sx > width || sy > height) return null;
      for (let i = 1; i < 24; i++) {
        const f = i / 24,
          x = ex + dx * f,
          y = ey + dz * f;
        if (x < layer.x || y < layer.y || x > layer.x + layer.width || y > layer.y + layer.width) continue;
        const ground = context.surface(x, y, 0, false) * c.exaggeration;
        if (ground > ez + dy * f + 0.8) return null;
      }
      return [sx, sy];
    },
  };
}
