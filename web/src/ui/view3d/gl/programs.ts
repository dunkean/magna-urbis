/**
 * Ground programs of the WebGL2 terrain view: the draped-map shader, the material ground variants (settings switches
 * compiled as constants, linked in parallel by glVariants.ts) with their stand-ins while one links, the sky, and the
 * uniform locations of every program the view draws with.
 */
import { glLandDetailUnit, type ForestTextures } from '../../terrain/gl/forest';
import { ShaderVariants, specializeShader } from '../../glVariants';
import { withoutLandDetail } from '../../../../../rust/bridge/terrainMaterialOccupation';
import { program } from './program';
import { vertexShader, TERRAIN_3D_MAP_FRAGMENT, fragmentShader, skyVertex, skyFragment } from './shaders';
import type { Terrain3dGroundSettings } from '../terrain/contract';
import type { TerrainStatus } from '../terrain/status';

export class GlGroundPrograms {
  /** The program of the ground drawn this frame (map or material variant). */
  terrain!: WebGLProgram;
  map?: WebGLProgram;
  sky!: WebGLProgram;
  private variants?: ShaderVariants;
  /** Last ground variant drawn: it stands in while the settings' own variant links. */
  private lastGround?: WebGLProgram;
  private locations = new WeakMap<WebGLProgram, Map<string, WebGLUniformLocation | null>>();

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly status: TerrainStatus,
  ) {}

  /** A new or restored context: every program and location is created again. */
  reset(request: () => void): void {
    this.locations = new WeakMap();
    this.map = this.lastGround = undefined;
    this.variants?.reset();
    this.variants = new ShaderVariants(this.gl, request);
  }

  createSky(): void {
    this.sky = program(this.gl, skyVertex, skyFragment);
  }

  prepareMap(): void {
    this.map ??= program(this.gl, vertexShader, TERRAIN_3D_MAP_FRAGMENT);
  }

  /** The settings' ground variant once linked; meanwhile the last drawn one, or the variant without
   * ground material (the projected map, quick to compile), stands in. */
  ground(settings: Terrain3dGroundSettings | undefined, forestTextures: ForestTextures | undefined, occupation: boolean): WebGLProgram {
    const gl = this.gl,
      forest = !!forestTextures && !settings?.underdark;
    // The Underdark ground (cave floor, section cut, cave light) is compiled only into the Underdark variant.
    const v = { groundEnabled: +!!settings, uRenderV2: settings?.renderV2 ?? 0, uForest: +forest, uForestBrushes: +!!settings?.forestBrushes, uHasOccupation: +occupation, uHasForestBank: +(forest && !!forestTextures?.bank), uUnderdark: +!!settings?.underdark };
    const variant = (constants: typeof v, wait: boolean) => this.variants!.get(Object.values(constants).join('.'), () => [vertexShader, specializeShader(glLandDetailUnit(gl) === undefined ? withoutLandDetail(fragmentShader) : fragmentShader, constants)], wait);
    const target = variant(v, false);
    this.status.mark('groundVariant', target ? 'ready' : 'pending');
    if (target) return (this.lastGround = target);
    const preview = variant({ groundEnabled: 0, uRenderV2: 0, uForest: 0, uForestBrushes: 0, uHasOccupation: 0, uHasForestBank: 0, uUnderdark: 0 }, true);
    if (!this.lastGround && !preview) throw new Error('Shader terrain 3D indisponible.');
    // A material transition uses the lightweight preview, without an old
    // forest/material variant that may be costly or expect different inputs.
    return settings ? preview! : (this.lastGround ?? preview!);
  }

  /** Uniform locations are constant for one linked program and GL context.
   * Inactive uniforms (null in the map shader) are cached as well. */
  uniform(name: string, shader = this.terrain): WebGLUniformLocation | null {
    let locations = this.locations.get(shader);
    if (!locations) {
      locations = new Map();
      this.locations.set(shader, locations);
    }
    if (!locations.has(name)) locations.set(name, this.gl.getUniformLocation(shader, name));
    return locations.get(name)!;
  }

  dispose(): void {
    const gl = this.gl;
    if (this.map) gl.deleteProgram(this.map);
    this.variants!.reset(true);
    gl.deleteProgram(this.sky);
  }
}
