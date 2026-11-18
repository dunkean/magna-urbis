/**
 * WebGL2 programs of the 2D ground: the map variants and their auxiliary passes (glVariants.ts ShaderVariants, linked
 * in the background with KHR_parallel_shader_compile), the painted-water composite, and the river and plain composite
 * programs compiled with the context. The look's own variant stands in for nothing: while it links, the last drawn
 * variant (or the preview) draws. Uniform locations are cached per program.
 */
import { ShaderVariants, finishProgram, specializeShader, startProgram } from '../../glVariants';
import { withoutLandDetail } from '../../../../../rust/bridge/terrainMaterialOccupation';
import { RENDER_WATER_FS } from '../../../render/renderWaterShader';
import { COMPOSITE_FS, COMPOSITE_VS, RIVER_FS, RIVER_VS, TERRAIN_FS, TERRAIN_VS } from './shaders';
import { glLandDetailUnit } from './forest';
import { PREVIEW_VARIANT, SATELLITE_VARIANT, hasAuxPass, speculativePrewarmAllowed, variantKey, type TerrainVariant } from '../variant';

const compile = (gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram => finishProgram(gl, startProgram(gl, vs, fs));
/** Holdings take a 17th texture unit: on ANGLE/D3D11 (16 units) the map shader leaves them out. */
let glTerrainFs = TERRAIN_FS;
const terrainFragment = (v: TerrainVariant): string => specializeShader(glTerrainFs, { uMode: v.mode, uRenderV2: v.v2, uForest: +v.forest, uForestBrushes: +v.brushes }, { NATURAL: v.mode >= 2 ? 1 : 0, ...(hasAuxPass(v) ? { AUX_TEXTURE: 1 } : {}) });
const auxKey = (v: TerrainVariant): string => `aux.${variantKey(v)}`;
const auxFragment = (v: TerrainVariant): string => specializeShader(glTerrainFs, { uMode: v.mode, uRenderV2: v.v2, uForest: +v.forest, uForestBrushes: +v.brushes }, { NATURAL: 0, AUX_PASS: 1 });
const WATER_KEY = 'water.composite';

export class GlPrograms {
  private readonly variants: ShaderVariants;
  readonly river: WebGLProgram;
  readonly composite: WebGLProgram;
  /** The map (or auxiliary) program the parameters are written to. */
  current!: WebGLProgram;
  /** Last map variant drawn: it stands in while the look's own variant links. */
  private last?: WebGLProgram;
  /** Painted water of the `render` style (renderWaterShader.ts) and its uniform locations. */
  painted?: { program: WebGLProgram; u: Map<string, WebGLUniformLocation | null> };
  private readonly locations = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  private readonly riverLocations = new Map<string, WebGLUniformLocation | null>();
  private readonly compositeLayer: WebGLUniformLocation | null;
  private prewarmStarted = false;

  /** `poll` runs while a variant links and once more when it is linked. */
  constructor(
    private readonly gl: WebGL2RenderingContext,
    poll: () => void,
  ) {
    glTerrainFs = glLandDetailUnit(gl) !== undefined ? TERRAIN_FS : withoutLandDetail(TERRAIN_FS);
    this.variants = new ShaderVariants(gl, poll);
    this.map(PREVIEW_VARIANT, false); // starts linking the preview
    this.river = compile(gl, RIVER_VS, RIVER_FS);
    this.composite = compile(gl, COMPOSITE_VS, COMPOSITE_FS);
    this.compositeLayer = gl.getUniformLocation(this.composite, 'uLayer');
  }

  uniform(name: string): WebGLUniformLocation | null {
    let cache = this.locations.get(this.current);
    if (!cache) this.locations.set(this.current, (cache = new Map()));
    let location = cache.get(name);
    if (location === undefined) cache.set(name, (location = this.gl.getUniformLocation(this.current, name)));
    return location;
  }
  riverUniform(name: string): WebGLUniformLocation | null {
    let location = this.riverLocations.get(name);
    if (location === undefined) this.riverLocations.set(name, (location = this.gl.getUniformLocation(this.river, name)));
    return location;
  }
  /** The plain composite of the layer on texture unit `unit` (blending set by the caller). */
  drawComposite(unit: number): void {
    const gl = this.gl;
    gl.useProgram(this.composite);
    gl.uniform1i(this.compositeLayer, unit);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  map(v: TerrainVariant, wait: boolean): WebGLProgram | undefined {
    return this.variants.get(variantKey(v), () => [TERRAIN_VS, terrainFragment(v)], wait);
  }
  aux(v: TerrainVariant, wait: boolean): WebGLProgram | undefined {
    return this.variants.get(auxKey(v), () => [TERRAIN_VS, auxFragment(v)], wait);
  }
  /** The painted-water composite once linked. */
  water(wait: boolean): WebGLProgram | undefined {
    const program = this.variants.get(WATER_KEY, () => [COMPOSITE_VS, RENDER_WATER_FS], wait);
    if (program && this.painted?.program !== program) this.painted = { program, u: new Map() };
    return program;
  }
  /** `target` (the look's variant, map()) once linked; meanwhile the last drawn variant, or the preview, stands in
   * (undefined if none is linked yet). */
  orStandIn(target: WebGLProgram | undefined): WebGLProgram | undefined {
    if (target) return (this.last = target);
    return this.last ?? this.map(PREVIEW_VARIANT, false);
  }
  /** Every program of the look's live redraw is linked (no stand-in): the map variant, its auxiliary pass, the
   * painted water when `painted`. */
  linked(v: TerrainVariant, painted: boolean): boolean {
    if (!this.map(v, false)) return false;
    if (hasAuxPass(v) && !this.aux(v, false)) return false;
    return !painted || !!this.water(false);
  }
  /** A program of the look failed to compile. */
  failed(v: TerrainVariant, painted: boolean): boolean {
    return this.variants.hasFailed(variantKey(v)) || (hasAuxPass(v) && this.variants.hasFailed(auxKey(v))) || (painted && this.variants.hasFailed(WATER_KEY));
  }
  /** Once the requested look is drawn, link the Satellite variant (the heaviest look, the usual next choice) while
   * the page is idle. Never before: on ANGLE/D3D11 a link started first delays the requested one by tens of seconds. */
  prewarm(alive: () => boolean): void {
    if (this.prewarmStarted) return;
    this.prewarmStarted = true;
    if (!speculativePrewarmAllowed()) return;
    const start = (): void => {
      if (!alive()) return;
      const variant = SATELLITE_VARIANT;
      this.variants.start(variantKey(variant), () => [TERRAIN_VS, terrainFragment(variant)]);
      this.variants.start(auxKey(variant), () => [TERRAIN_VS, auxFragment(variant)]);
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(start, { timeout: 4000 });
    else setTimeout(start, 1500);
  }
  /** Context lost: the programs are gone with it. */
  lose(): void {
    this.variants.reset();
  }
  dispose(): void {
    this.variants.reset(true);
    this.gl.deleteProgram(this.river);
    this.gl.deleteProgram(this.composite);
    this.painted = undefined; // Owned and deleted by ShaderVariants.
  }
}
