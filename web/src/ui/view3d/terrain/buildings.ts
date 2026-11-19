/**
 * Town buildings of a 3D terrain view: the building pass of the backend, the scene and appearance it draws, and the
 * footings it carves into the surface. Terrain3d sets the scene and recreates the pass with a new GL context; the frame
 * draws it, picking hits its faces.
 */
import type { UrbanBuildingAppearance } from '../../../render/urbanBuildingStyle';
import type { Building3dScene } from '../../../render/urbanBuildingGeometry';
import type { UrbanBuildingPass } from '../../urbanBuilding3d';
import { UrbanBuildingGround } from '../../urbanBuildingGround';
import { Terrain3dCollisions } from '../../../render/world/terrain3dCollisions';
import type { TerrainSurface } from './surface';

export class TerrainBuildings {
  pass!: UrbanBuildingPass;
  scene?: Building3dScene;
  appearance: UrbanBuildingAppearance = { style: 'geometric', diagnostic: 'none' };
  visible = true;
  walkCollisions = new Terrain3dCollisions();

  constructor(private readonly surface: TerrainSurface) {}

  /** The scene the pass draws: none while hidden. */
  shown(): Building3dScene | undefined {
    return this.visible ? this.scene : undefined;
  }

  /** Records new inputs; returns whether the scene or its visibility changed, in which case the footings are rebuilt.
   * Footprints painted on a map have no foundation to clear: carving their hidden meshes into the terrain creates
   * false, grid-shaped terraces. */
  assign(scene: Building3dScene | undefined, appearance: UrbanBuildingAppearance, visible: boolean): boolean {
    const changed = this.scene !== scene || this.visible !== visible;
    this.scene = scene;
    this.appearance = appearance;
    this.visible = visible;
    if (changed) {
      this.surface.buildingGround = new UrbanBuildingGround(visible ? scene : undefined);
      this.walkCollisions = new Terrain3dCollisions(visible ? scene : undefined);
    }
    return changed;
  }
}
