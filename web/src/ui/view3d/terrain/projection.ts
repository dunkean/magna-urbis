/**
 * Picking and projection of a 3D terrain view: the building or ground point under a pixel (against the patches as
 * drawn last frame) and the screen position of world points, for the owners' overlays (labels, selection, text).
 */
import { gridHeight, raycastGrid, type TerrainPickGrid } from '../../terrain3dPicking';
import type { BuildingVector } from '../../../render/urbanBuildingGeometry';
import type { TerrainViewContext } from './context';
import type { FrameGeometry, Terrain3dCamera, Vec3 } from './contract';
import type { TerrainBuildings } from './buildings';
import type { TerrainSurface } from './surface';

export type LabelProjector = { scale: number; project(x: number, y: number): [number, number] | null };

export class TerrainProjection {
  constructor(
    private readonly context: Pick<TerrainViewContext, 'active' | 'width' | 'height'>,
    private readonly surface: Pick<TerrainSurface, 'layer' | 'heightRange' | 'heightAt' | 'surface'>,
    private readonly rig: { readonly camera: Terrain3dCamera; frameGeometry(): FrameGeometry },
    /** Grids of the patches drawn last frame (the frame loop's). */
    private readonly grids: () => readonly TerrainPickGrid[],
    private readonly buildings?: TerrainBuildings,
  ) {}

  /** Select the nearest actual building face using its physical native geometry. */
  pickBuilding(x: number, y: number): string | undefined {
    const buildings = this.buildings;
    if (!this.surface.layer || !this.context.active || !buildings?.scene || !buildings.visible) return undefined;
    const frame = this.rig.frameGeometry(),
      c = this.rig.camera;
    const u = (x - this.context.width / 2) / frame.focal,
      v = (this.context.height / 2 - y) / frame.focal;
    const ray: Vec3 = [0, 1, 2].map(i => frame.forward[i] + u * frame.right[i] + v * frame.up[i]) as Vec3;
    const origin: BuildingVector = [c.x + frame.eye[0], c.y + frame.eye[2], (frame.targetHeight + frame.eye[1]) / c.exaggeration];
    const direction: BuildingVector = [ray[0], ray[2], ray[1] / c.exaggeration];
    const { distance: nearest, id } = buildings.pass.pick(origin, direction);
    // Ground occludes buildings behind hills, just as the depth buffer does.
    const glOrigin: Vec3 = [origin[0], origin[2] * c.exaggeration, origin[1]];
    let ground = Infinity;
    for (const grid of this.grids()) {
      const hit = raycastGrid(grid, glOrigin, ray);
      if (hit !== null) ground = Math.min(ground, hit);
    }
    return nearest <= ground + 0.01 ? id : undefined;
  }

  /** Pick the nearest visible terrain triangle in CSS pixels, including LOD morphs and refined heights. */
  screenToWorld(x: number, y: number): [number, number] | null {
    if (!this.surface.layer || !this.context.active) return null;
    const frame = this.rig.frameGeometry(),
      c = this.rig.camera;
    const u = (x - this.context.width / 2) / frame.focal,
      v = (this.context.height / 2 - y) / frame.focal;
    const direction: Vec3 = [0, 1, 2].map(i => frame.forward[i] + u * frame.right[i] + v * frame.up[i]) as Vec3;
    const origin: Vec3 = [c.x + frame.eye[0], frame.targetHeight + frame.eye[1], c.y + frame.eye[2]];
    let nearest = Infinity;
    for (const grid of this.grids()) {
      const hit = raycastGrid(grid, origin, direction);
      if (hit !== null) nearest = Math.min(nearest, hit);
    }
    return Number.isFinite(nearest) ? [origin[0] + direction[0] * nearest, origin[2] + direction[2] * nearest] : null;
  }

  worldToScreen(x: number, y: number): [number, number] | null {
    if (!this.surface.layer || !this.context.active) return null;
    let height: number | null = null;
    for (const grid of this.grids()) {
      height = gridHeight(grid, x, y);
      if (height !== null) break;
    }
    if (height === null) return null;
    const frame = this.rig.frameGeometry(),
      c = this.rig.camera;
    const relative: Vec3 = [x - c.x - frame.eye[0], height - frame.targetHeight - frame.eye[1], y - c.y - frame.eye[2]];
    const dot = (axis: Vec3): number => relative[0] * axis[0] + relative[1] * axis[1] + relative[2] * axis[2];
    const depth = dot(frame.forward);
    return depth > 0 ? [this.context.width / 2 + (frame.focal * dot(frame.right)) / depth, this.context.height / 2 - (frame.focal * dot(frame.up)) / depth] : null;
  }

  /** One camera basis per text update; canonical terrain heights also reject anchors behind hills. */
  labelProjector(): LabelProjector | undefined {
    const layer = this.surface.layer;
    if (!layer || !this.context.active) return undefined;
    const frame = this.rig.frameGeometry(),
      c = this.rig.camera,
      surface = this.surface,
      width = this.context.width,
      height = this.context.height;
    const ex = c.x + frame.eye[0],
      ey = c.y + frame.eye[2],
      ez = frame.targetHeight + frame.eye[1];
    const far = Math.max(c.distance * 4, layer.width * 2 + surface.heightRange * c.exaggeration * 2);
    return {
      scale: frame.focal / Math.max(1, c.distance),
      project: (x, y) => {
        const z = (surface.heightAt(x, y) ?? 0) * c.exaggeration + 0.6;
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
          const ground = surface.surface(x, y, 0, false) * c.exaggeration;
          if (ground > ez + dy * f + 0.8) return null;
        }
        return [sx, sy];
      },
    };
  }
}
