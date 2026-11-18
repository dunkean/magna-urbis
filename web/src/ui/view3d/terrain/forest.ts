/**
 * Forest inputs of a 3D terrain view: the forest field, the land occupation merged with the town's buildings (off the
 * main thread when the owner gives a worker), the land detail, and their textures. Terrain3d sets them; the ground
 * shader binds the textures, the near trees and mushrooms read the occupation.
 */
import type { ForestField, ForestOccupation, LandDetail } from '../../../../../rust/bridge/terrainForest';
import { DEFAULT_TERRAIN_LIGHTING } from '../../../render/terrainLighting';
import type { Building3dScene } from '../../../render/urbanBuildingGeometry';
import { occupationMergeSlot, withBuildingOccupation } from '../../forestOccupation';
import type { ForestTextures } from '../../terrain/gl/forest';
import type { TerrainViewContext } from './context';
import type { Terrain3dForestSettings, TerrainResources } from './contract';

export class TerrainForest {
  settings?: Terrain3dForestSettings;
  /** The inputs as given (retained for a backend switch and a restored context). */
  field?: ForestField;
  source?: ForestOccupation;
  /** Uploaded rasters: field, applied (merged) occupation and land detail. */
  textures?: ForestTextures;
  occupation?: { data: ForestOccupation; texture: WebGLTexture };
  landDetail?: { data: LandDetail; texture: WebGLTexture };
  /** Off-thread occupation merges in flight (counted as pending tile work). */
  merges = 0;
  private merged?: ForestOccupation;
  private mergedSource?: ForestOccupation;
  private mergedScene?: Building3dScene;

  constructor(
    private readonly context: TerrainViewContext,
    private readonly resources: TerrainResources,
    private readonly buildingScene: () => Building3dScene | undefined,
    /** Selects the ground program again when the forest appears or goes (the map shader has none). */
    private readonly selectProgram: (procedural: boolean) => void,
  ) {}

  /** Render3D forest: texture uploads only, no mesh or material tile rebuild. */
  set(field: ForestField | undefined, occupation: ForestOccupation | undefined, settings: Terrain3dForestSettings | undefined): void {
    this.settings = settings ?? { seed: 0, climate: { temperature: 18, precipitation: 1000 }, lighting: DEFAULT_TERRAIN_LIGHTING };
    this.field = field;
    this.source = occupation;
    if (this.mergedSource !== occupation || this.mergedScene !== this.buildingScene()) {
      const source = occupation,
        scene = this.buildingScene(),
        merge = this.context.options.mergeOccupation;
      this.mergedSource = source;
      this.mergedScene = scene;
      const buildings = scene?.occupationBuildings ?? scene?.buildings;
      if (!merge || !source || !scene || !buildings?.length || occupationMergeSlot(source, scene).value) this.merged = withBuildingOccupation(source, scene);
      else {
        // The merge of a whole town took ~0.5 s on the page at opening (an average machine: seconds): off-thread now.
        this.merged = source;
        this.merges++;
        const current = (): boolean => !this.context.disposed && this.mergedSource === source && this.mergedScene === scene;
        void merge(source, scene)
          .catch(() => (current() ? withBuildingOccupation(source, scene) : undefined))
          .then(result => {
            if (current() && result) {
              this.merged = result;
              this.set(this.field, this.source, this.settings);
            }
          })
          .finally(() => {
            this.merges--;
            this.context.request();
          });
      }
    }
    occupation = this.merged;
    if (field !== this.textures?.field) {
      const hadForest = !!this.textures;
      this.resources.releaseForest(this.textures);
      this.textures = field && this.resources.uploadForest(field);
      if (hadForest !== !!field) this.selectProgram(!!this.context.ground || !!field);
    }
    if (occupation !== this.occupation?.data) {
      if (this.occupation) this.resources.deleteTexture(this.occupation.texture);
      this.occupation = occupation && { data: occupation, texture: this.resources.uploadOccupation(occupation) };
    }
    if (occupation?.detail !== this.landDetail?.data) {
      if (this.landDetail) this.resources.deleteTexture(this.landDetail.texture);
      this.landDetail = occupation?.detail && { data: occupation.detail, texture: this.resources.uploadLandDetail(occupation.detail) };
    }
    this.context.request();
  }

  /** The same inputs again (the buildings changed: the occupation merges them anew). */
  refresh(): void {
    this.set(this.field, this.source, this.settings);
  }

  /** A restored WebGL context comes back empty: re-upload the retained rasters. */
  reupload(): void {
    this.textures = this.occupation = undefined;
    this.set(this.field, this.source, this.settings);
  }

  /** The view is disposed (its textures are released by the backend). */
  clear(): void {
    this.merged = this.mergedSource = undefined;
    this.mergedScene = undefined;
  }

  forget(): void {
    this.textures = this.occupation = this.field = this.source = undefined;
  }
}
