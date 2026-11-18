/**
 * The Underdark section cut of a 3D terrain view: the cavern field (roof, walls, openness) built from the height layer,
 * its texture, the roof mesh, and the cave lighting uniforms both backends and the building pass read. Terrain3d
 * refreshes it when the layer or the ground settings change; the surface clamps rock to its roof.
 */
import { cavernReveal, cavernRoofMesh, UNDERDARK_CAVERN_DEFAULTS, cavernField, cavernUniform, type CavernField, type UnderdarkCavern3d } from '../../../render/underdarkCavern';
import type { HeightLayer } from '../../terrain/contract';
import type { TerrainViewContext } from './context';
import type { Terrain3dCamera, TerrainResources } from './contract';

export class TerrainCavern {
  /** The section cut (roof field), absent outside the Underdark. */
  field?: CavernField;
  /** Its texels (render/underdarkCavern.ts), read by the ground shader's rim, occlusion and section cut. */
  texture?: WebGLTexture;
  /** Bumped on every rebuild: the mushroom stream depends on it. */
  revision = 0;
  /** Index count of the roof mesh (the lid of the section model, cut away around the focus). */
  roofCount = 0;
  private layer?: HeightLayer;
  private clearance?: number;

  constructor(
    private readonly context: TerrainViewContext,
    private readonly resources: TerrainResources,
    private readonly camera: () => Terrain3dCamera,
    /** Clears the patches: the roof clamps the mesh heights. */
    private readonly clearPatches: () => void,
  ) {}

  /** The section cut (roof field) and its texels, rebuilt when the layer or the roof clearance changes.
   * The roof clamps the mesh height (surface()), so every rock mass stops at the roof of its chamber. */
  refresh(layer: HeightLayer | undefined, force = false): void {
    const settings = this.context.ground;
    const clearance = settings?.underdark && layer?.cave ? (settings.cavern ?? UNDERDARK_CAVERN_DEFAULTS).roof : undefined;
    if (!force && layer === this.layer && clearance === this.clearance) return;
    const had = !!this.field;
    this.layer = layer;
    this.clearance = clearance;
    this.field = layer && clearance !== undefined ? cavernField(layer, clearance) : undefined;
    if (this.texture) this.resources.deleteTexture(this.texture);
    this.texture = this.field ? this.resources.uploadCavern(this.field) : undefined;
    this.revision++;
    const roof = this.field ? cavernRoofMesh(this.field) : undefined;
    this.roofCount = roof?.indices.length ?? 0;
    this.resources.uploadRoof(roof);
    if (had || this.field) {
      this.clearPatches();
      this.context.request();
    }
  }

  /** A restored WebGL context comes back empty: the texture is gone with it. */
  forgetTexture(): void {
    this.texture = undefined;
  }

  /** Underdark display parameters, defaulted. */
  settings(): UnderdarkCavern3d {
    return this.context.ground?.cavern ?? UNDERDARK_CAVERN_DEFAULTS;
  }

  /** `uCavern` of the ground shader: roof base, darkness, cave fog start and end (render/underdarkCavern.ts). */
  parameters(): [number, number, number, number] {
    const c = this.camera();
    return cavernUniform(this.field, this.settings(), c.distance, c.exaggeration);
  }

  /** uTownGlow (vec4 × 16) and its count, as the ground shader reads them. */
  townGlowUniform(): { values: Float32Array; count: number } {
    const g = this.context.ground?.townSites ?? this.context.ground?.townGlow ?? new Float32Array(0),
      values = new Float32Array(64),
      count = Math.min(16, (g.length / 3) | 0);
    for (let k = 0; k < count; k++) values.set(g.subarray(k * 3, k * 3 + 3), k * 4);
    return { values, count };
  }

  /** uReveal: the cutaway around the orbit target; none while walking or flying (the vault stays overhead). */
  roofReveal(): [number, number, number, number] {
    const c = this.camera();
    return c.navigation === 'walk' || c.navigation === 'fly' ? [c.x, c.y, 0, 1] : cavernReveal(c.x, c.y, c.distance, c.exaggeration);
  }

  /** Whether the cave roof is drawn this frame. */
  roofShown(): boolean {
    return !!this.roofCount && !!this.field && !!this.context.ground?.underdark && !this.context.ground.paperMap && !this.context.useMapShader;
  }
}
