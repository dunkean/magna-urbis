/**
 * The parts of one 3D terrain view, as Terrain3d assembles them: what the frame loop and the backends receive
 * instead of the whole view.
 */
import type { TerrainBillboards } from './billboards';
import type { TerrainBuildings } from './buildings';
import type { TerrainCameraRig } from './camera';
import type { TerrainCavern } from './cavern';
import type { TerrainForest } from './forest';
import type { UnderdarkFungi } from './fungi';
import type { PatchMeshes } from './meshes';
import type { PatchTree } from './patchTree';
import type { TerrainStatus } from './status';
import type { TerrainSurface } from './surface';
import type { TileMaterials } from './tiles';
import type { NearTrees } from './trees';

export interface TerrainParts {
  readonly status: TerrainStatus;
  readonly surface: TerrainSurface;
  readonly cavern: TerrainCavern;
  readonly rig: TerrainCameraRig;
  readonly buildings: TerrainBuildings;
  readonly forest: TerrainForest;
  readonly tree: PatchTree;
  readonly meshes: PatchMeshes;
  readonly tiles: TileMaterials;
  readonly trees: NearTrees;
  readonly fungi: UnderdarkFungi;
  readonly billboards: TerrainBillboards;
}
