/**
 * The GPU town (WebGL2): public types of render/city/gl — the options of a frame, the renderer on its own canvas
 * (`CityGlRenderer`: City Bench and the V2's exact output of the drawn plans) and on a context it does not own
 * (`CityGlSharedRenderer`: the live compositor's town layer), their statistics.
 */
import type { Point } from '../../../../../rust/bridge/urban';
import type { Box, CityBuildings, CityLayers, CityLod, CityPalette, CityPick, CityScene, CityView } from '../model/contract';
import { type CityGlLiveLook } from './styleTables';
import type { RoofMode } from '../../roofMode';
import type { YardBoundary } from '../../cityLotEnclosures';
// walls hook (cityWalls.ts)

export interface CityGlDrawOptions {
  smoothRoofs?: boolean;
  roof?: RoofMode;
  viewport: Box;
  metresPerPixel: number;
  view: CityView;
  /** Level of detail; chosen from metresPerPixel (with hysteresis) when omitted. */
  lod?: CityLod;
  palette?: CityPalette;
  layers?: Partial<CityLayers>;
  /** Building id or parcel id to outline. */
  selectedId?: string;
  selectedParcel?: number;
  /** Flat footprint rendering skips roof faces, textures and shadows at every zoom. */
  buildingStyle?: 'geometric' | 'cartographic' | 'silhouette';
  buildingsVisible?: boolean;
  diagnostic?: 'none' | 'uses' | string;
  refusedParcels?: ReadonlySet<string>;
  /** Clear colour (straight RGBA 0–1); transparent by default so the map shows through. */
  clear?: [number, number, number, number];
  /** Bridge parapets, kerbs and deck joints; enabled by default at every LOD. */
  bridgeDeck?: boolean;
  /** Painted building silhouettes (tints, ground shadows, edges). Default: Render background. */
  paintedBuildings?: boolean;
  /** Blended ground and streets (groundBlend.ts). Default: the shared setting. */
  groundBlend?: boolean;
  /** Textured materials: roofs, streets and plazas sample the PBR albedo atlas in world metres. */
  textured?: boolean;
  /** Custom display colours (road, roadEdge, track, building, buildingEdge). */
  colors?: import('../../customColors').RenderColors;
  /** The drawn rivers under the plan, in the terrain renderer's layout (`riverSegments`: x0, y0, x1, y1, w0, w1
   * and a colour per segment, map metres, full widths). Where they run, the town ground (blocks, parcels) and
   * its streets are not drawn: the river shows above them. Bridges and fords (crossing strokes), quays and
   * landings, walls and buildings are drawn as before, above the water. */
  water?: Float32Array;
  /** Shared context (live compositor): the framebuffer and its size in device pixels. The draw binds it, sets every
   * state it relies on and clears nothing; without it the draw clears and fills the renderer's own canvas. */
  target?: { framebuffer: WebGLFramebuffer | null; width: number; height: number };
  /** Live look (render/live/cityLayer.ts): the GL stand-in of the looks only Canvas 2D paints exactly (natural roads and
   * roof pans, hidden snow patches, the cast shadow tint of the Canvas path); no render background. */
  live?: CityGlLiveLook;
}
export interface CityGlFrame {
  lod: CityLod;
  drawCalls: number;
  instances: number;
  triangles: number;
  cpuMs: number;
}
export interface CityGlBuildStats {
  packMs: number;
  triangulateMs: number;
  assembleMs: number;
  uploadMs: number;
  workers: number;
  totalMs: number;
}
export interface CityGlStats {
  plan?: { vertices: number; triangles: number; edges: number; features: number };
  buildings?: { vertices: number; triangles: number; edges: number; features: number };
  streets: number;
  walls: number;
  towers: number;
  gpuBytes: number;
  build?: CityGlBuildStats;
  buildingsBuild?: CityGlBuildStats;
  frame?: CityGlFrame;
  renderer: string;
}
export interface CityGlPick extends CityPick {
  id?: string;
  kind?: 'building' | 'parcel' | 'block';
}
export interface CityGlSetOptions {
  /** Triangulation workers (0 = on this thread). Default: up to 4. */ workers?: number;
}
export interface CityGlRenderer {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly gl: WebGL2RenderingContext;
  /** A retained plan is uploaded and the physical context is usable. */
  readonly ready: boolean;
  setScene(scene: CityScene, buildings?: CityBuildings, options?: CityGlSetOptions): Promise<CityGlBuildStats>;
  setBuildings(buildings: CityBuildings | undefined, options?: CityGlSetOptions): Promise<CityGlBuildStats>;
  draw(options: CityGlDrawOptions): CityGlFrame;
  pick(point: Point, options?: Pick<CityGlDrawOptions, 'view' | 'lod' | 'metresPerPixel' | 'buildingsVisible'>): CityGlPick;
  /** Drawing-buffer size; defaults to the canvas CSS size × devicePixelRatio. */
  resize(width?: number, height?: number): void;
  stats(): CityGlStats;
  dispose(): void;
}
/** A cityGl renderer bound to a context it does not own (createCityGlRendererOn): no canvas, no resize, no context
 * events (the owner disposes it when the context is lost). Meshes are built by setScene / setBuildings and uploaded by
 * `upload`, which the owner calls between frames; colour tables are built by `prepare`, so a draw only binds them. */
export interface CityGlSharedRenderer extends Omit<CityGlRenderer, 'canvas' | 'resize'> {
  /** Uploads the meshes built since the last call (scene first, then buildings); true when it uploaded something. */
  upload(): boolean;
  /** Built meshes wait for `upload`. */
  readonly pendingUpload: boolean;
  /** Links the programs without blocking (KHR_parallel_shader_compile, polled; else one program per call); true while
   * some remain. Nothing draws, uploads or reports `ready` before they are all linked. */
  programsStep(): boolean;
  readonly programsLinked: boolean;
  /** What a draw with these options would have to create on the GPU first ('' when nothing: the draw only binds and
   * draws). The owner shows a stand-in and prepares the state in its work instead. */
  check(options: CityGlDrawOptions): string;
  /** `prepare` in resumable steps: the colour tables not kept yet are computed a slice at a time (a pass over every
   * block, parcel, building, pan and street), then the state is completed at once. Run it to its end before drawing
   * that state, or the draw computes what is missing. */
  prepareSteps(options: CityGlDrawOptions): Generator<void, void>;
  /** Lot enclosures of the live look (each list a town's `scene.lotEnclosures`), relative to the uploaded scene; set
   * again after each new scene. Drawn when `layers.lotEnclosures` is not false, from the mid level, as drawLotEnclosures. */
  setYards(lists: readonly (readonly YardBoundary[] | undefined)[]): void;
  /** setScene / setBuildings pack their polygons in slices (never in one long task): `step` advances them for about
   * `budgetMs` and returns true while packing remains. Triangulation then runs on the workers as before. */
  step(budgetMs: number): boolean;
  readonly packing: boolean;
  /** Builds and uploads what a draw with these options needs (colour tables, street strokes, water), without drawing. */
  prepare(options: CityGlDrawOptions): void;
}
export interface CityGlCreateOptions {
  /** Accept a software WebGL (default false: throws, so the host falls back to Canvas 2D). */
  allowSoftware?: boolean;
  /** Multisampled default framebuffer (default true). */
  antialias?: boolean;
  /** Ask the host to repaint after context changes or an accepted GPU import. */
  onInvalidate?: () => void;
}
