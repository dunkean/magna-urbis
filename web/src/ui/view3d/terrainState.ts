/**
 * Per-view terrain state, owned by Terrain3d and initialized in the original field order.
 * Reads/writes: Owns CPU inputs, camera, caches, GPU handles and scheduling fields. Extracted operations receive this same instance as Terrain3dContext.
 */
import { FramePreparation } from '../framePreparation';
import { type ForestTextures, type HeightLayer } from '../terrainGl';
import { type ForestField, type ForestOccupation, type LandDetail } from '../../../../rust/bridge/terrainForest';
import { ShaderVariants } from '../glVariants';
import { type CavernField } from '../../render/underdarkCavern';
import { type TerrainPickGrid } from '../terrain3dPicking';
import { type TerrainStitchedPiece } from '../terrain3dStitch';
import { UrbanBuildingPass } from '../urbanBuilding3d';
import type { UrbanBuildingAppearance } from '../../render/urbanBuildingStyle';
import type { Building3dScene } from '../../render/urbanBuildingGeometry';
import { UrbanBuildingGround } from '../urbanBuildingGround';
import { UrbanGroundCuts } from '../urbanGroundCuts';
import { TREE_DISTANCE_DEFAULT } from '../terrain3dTrees';
import { type Terrain3dBillboards } from '../terrain3dBillboards';
import { Terrain3dTileContent, Terrain3dForestSettings, WaterSurface, Terrain3dGroundSettings, Terrain3dLookSettings, Terrain3dTile, Patch, Node, Terrain3dCamera, Terrain3dStatus } from './terrainTypes';
import { TERRAIN_3D_MAX_SCALE } from './terrainPolicy';
export abstract class Terrain3dState {
  private gl!: WebGL2RenderingContext;

  private textureAnisotropy?: { parameter: number; value: number };

  private terrainProgram!: WebGLProgram;

  private mapProgram?: WebGLProgram;

  /** Ground material variants (glVariants.ts): settings switches as constants, linked in parallel. */
  private groundVariants!: ShaderVariants;

  /** Last ground variant drawn: it stands in while the settings' own variant links. */
  private lastGround?: WebGLProgram;

  protected useMapShader = false;

  private uniformLocations = new WeakMap<WebGLProgram, Map<string, WebGLUniformLocation | null>>();

  private skyProgram!: WebGLProgram;

  protected buildings!: UrbanBuildingPass;

  protected buildingScene?: Building3dScene;

  protected buildingAppearance: UrbanBuildingAppearance = { style: 'geometric', diagnostic: 'none' };

  protected buildingsVisible = true;

  private buildingGround = new UrbanBuildingGround();

  /** Town moats dug into the ground (urbanGroundCuts.ts). */
  private groundCuts = new UrbanGroundCuts();

  private mergedOccupation?: ForestOccupation;

  private mergedOccupationSource?: ForestOccupation;

  private mergedOccupationScene?: Building3dScene;

  /** Off-thread occupation merges in flight (counted as pending tile work). */
  private occupationMerges = 0;

  private indices!: WebGLBuffer;

  private seams!: WebGLBuffer;

  private clippedIndices = new Map<string, { buffer: WebGLBuffer; count: number }>();

  protected material!: WebGLTexture;

  protected raisedMaterials = new Map<WebGLTexture, WebGLTexture>();

  protected billboardSource?: Terrain3dBillboards;

  protected billboardCount = 0;

  private billboardKey = '';

  private billboardReadyKey = '';

  private billboardDirty = false;

  private billboardProgram?: WebGLProgram;

  private billboardVao?: WebGLVertexArrayObject;

  private billboardBuffer?: WebGLBuffer;

  private billboardAtlas?: { source: HTMLCanvasElement; texture: WebGLTexture };

  protected macroTexture!: WebGLTexture;

  protected caveTexture?: WebGLTexture;

  /** Underdark section cut (refreshCavern). */
  protected cavern?: CavernField;

  private cavernLayer?: HeightLayer;

  private cavernClearance?: number;

  private shoreRing?: { layer: object; revision: number; texture: WebGLTexture };

  /** A cast-shadow bake for a new light azimuth has landed in the shore ring: draw again to upload it. */
  protected readonly ringChanged = (): void => this.request();

  private empty!: WebGLTexture;

  protected waterMasks = new Map<WebGLTexture, { texture: WebGLTexture; rect: readonly [number, number, number]; bytes: number; water?: NonNullable<Terrain3dTileContent['water']> }>();

  /** Satellite near trees (terrain3dTrees.ts): instance count and the eye/heading they were built for. */
  protected treeCount = 0;

  private treeKey = '';

  private treeReadyKey = '';

  /** Whether the displayed stream is a finished one: a later stream then replaces it whole, never by partial blocks. */
  private treeComplete = false;

  /** Area (eye and radius) of the latest tree stream, and the revision of the water masks that touched it since. */
  private treeArea?: { x: number; y: number; r: number };

  private treeWaterRevision = 0;

  /** Near trees on demand (the 3D view's "3D trees" switch). Off, nothing is built or drawn and the painted crowns
   * stay whole; a built stream is kept, so switching back on shows it at once. */
  protected nearTrees = false;

  /** Render distance of the near trees (m): the fade starts at 2/3 of it, the instance cap grows with its square. */
  protected treeDistance = TREE_DISTANCE_DEFAULT;

  /** Tree streams queued in `preparation`: the view's readiness does not wait for them (trees stream in after). */
  private treeJobs = 0;

  private treeProgram?: WebGLProgram;

  /** Underdark mushrooms (terrain3dFungi.ts): instance count, stream key, jobs in flight, revision of the cavern field. */
  protected fungusCount = 0;

  protected fungusTiers: [number, number, number] = [0, 0, 0];

  private fungusKey = '';

  private fungusJobs = 0;

  private cavernRevision = 0;

  private fungusProgram?: WebGLProgram;

  private fungusVao?: WebGLVertexArrayObject;

  private fungusBuffer?: WebGLBuffer;

  private treeVao?: WebGLVertexArrayObject;

  private treeBuffer?: WebGLBuffer;

  /** Semantic tile of a material tile: follows it through parent fallbacks and fades. */
  protected semanticTiles = new Map<WebGLTexture, { texture: WebGLTexture; pixels: number; gutter: number; atlas?: boolean; semantic: boolean }>();

  protected forestField?: ForestField;

  protected forestOccupation?: ForestOccupation;

  protected forestSettings?: Terrain3dForestSettings;

  protected forest?: ForestTextures;

  protected occupation?: { data: ForestOccupation; texture: WebGLTexture };

  protected landDetail?: { data: LandDetail; texture: WebGLTexture };

  private indexCount = 0;

  protected layer?: HeightLayer;

  private water?: WaterSurface;

  private waterVisible = true;

  private textureSource?: TexImageSource;

  private fallbackPixels = 1;

  private fallbackGutter = 0;

  protected groundSettings?: Terrain3dGroundSettings;

  protected lookSettings: Terrain3dLookSettings = {};

  protected tileBounds = false;

  private tileLoader?: (tile: Terrain3dTile) => Promise<TexImageSource | Terrain3dTileContent>;

  private requireHeights = false;

  private geometryNeeded: Patch[] = [];

  private preparation = new FramePreparation();

  private meshJobs = new Map<Patch, Promise<void>>();

  private heightSampler?: (x: number, y: number, metresPerPixel: number) => number;

  private patches = new Map<string, Patch>();

  /** Sampled grids by tile key (17 KB each): they outlive the textures that evict their patch, and a
   * revisited tile costs no sampling. Every input of surface() clears them through clearPatches. */
  private heightGrids = new Map<string, Float32Array>();

  private root?: Node;

  private splits = new Set<string>();

  private animating = false;

  private now = 0;

  private desired: Patch[] = [];

  private displayedGrids: TerrainPickGrid[] = [];

  private displayedPieces: TerrainStitchedPiece[] = [];

  private stitchUpdated = 0;

  private protected = new Set<string>();

  private jobs = new Set<object>();

  private epoch = 0;

  /** Texture invalidations wait for the next frame, so several async completions coalesce into one pass. */
  private staleTiles: 'all' | ({ minX: number; minY: number; maxX: number; maxY: number } | string)[] | undefined;

  private clock = 0;

  private heightRange = 0;

  private maxSlope = 0;

  protected maxFramebufferDimension = 8192;

  protected camera: Terrain3dCamera = { x: 0, y: 0, distance: 1000, yaw: 0, pitch: 0.8, exaggeration: 1 };

  private active = false;

  private width = 1;

  private height = 1;

  private frame = 0;

  private cameraMovedAt = -Infinity;

  private settleTimer?: ReturnType<typeof setTimeout>;

  private fullQualityCapture = false;

  private captureMode = false;

  protected frameQuality = 0;

  private unlistenQuality?: () => void;

  protected frameInteracting = false;

  private msaa?: { width: number; height: number; framebuffer: WebGLFramebuffer; color: WebGLRenderbuffer; depth: WebGLRenderbuffer; checked?: boolean };

  /** The drawing buffer refused the MSAA resolve (ANGLE Vulkan: alpha:false back buffer is not RGBA8): draw to it directly. */
  private msaaUnsupported = false;

  protected disposed = false;

  private events = new AbortController();

  private pointers = new Map<number, { x: number; y: number; orbit: boolean }>();

  private gesture?: { x: number; y: number; distance: number };

  private walkKeys = new Set<string>();

  private walkFrame = 0;

  private walkTime = 0;

  private orbitBeforeWalk?: Pick<Terrain3dCamera, 'distance' | 'pitch'>;

  private lod = { tiles: 0, ready: 0, pending: 0, level: 0, metresPerTexel: 0, metresPerVertex: 0, maxScale: TERRAIN_3D_MAX_SCALE, scale: 0 };

  /** The owner's element: input, focus and status attributes (the canvas itself unless options.element). */
  protected element!: HTMLElement;

  private status: Partial<Record<Terrain3dStatus, string>> = {};

  private silent = false;

  private treeStreams = 0;

  /** A framing view chosen before the towns were known; replaced by the first town once they arrive, if untouched. */
  private townFrame?: { x: number; y: number; distance: number; pitch: number };

  /** The roof of the cave (the lid of the section model, cut away around the focus): one mesh, drawn once a frame. */
  protected roofCount = 0;

  private roofProgram?: WebGLProgram;

  private roofVao?: WebGLVertexArrayObject;

  private roofBuffers?: [WebGLBuffer, WebGLBuffer];
  protected abstract request(): void;
}
