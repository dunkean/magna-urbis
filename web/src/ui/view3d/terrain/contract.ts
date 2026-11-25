/**
 * Types of the 3D terrain view: what owners pass and read (camera, tiles, settings, options), what the backends share
 * (patches, materials, frame geometry, patch draws) and the resources the parts ask a backend for. Re-exported by ui/terrain3d.ts.
 */
import type { ForestTextures } from '../../terrain/gl/forest';
import type { HeightLayer } from '../../terrain/contract';
import { type ForestField, type ForestOccupation, type LandDetail } from '../../../../../rust/bridge/terrainForest';
import { type CavernField, type UnderdarkCavern3d } from '../../../render/underdarkCavern';
import { type SeasonCalendar } from '../../../../../rust/bridge/terrainRenderV2Zones';
import type { ClimateZone } from '../../../../../rust/bridge/terrainClimate';
import { type TerrainLighting } from '../../../render/terrainLighting';
import { type TerrainStitchPiece } from '../../terrain3dStitch';
import type { Building3dScene } from '../../../render/urbanBuildingGeometry';
import { type LakeField } from '../../lakeGeometry';

/** Target and orbit distance in world metres; yaw/pitch in radians. */
export interface Terrain3dCamera {
  x: number;
  y: number;
  distance: number;
  yaw: number;
  pitch: number;
  exaggeration: number;
  /** In walk mode x/y locate the walker; pitch is the downward viewing angle. */
  navigation?: 'orbit' | 'walk' | 'fly';
  /** Absolute physical altitude in free-flight mode, in world metres. */
  flightAltitude?: number;
  /** Capture-only measurements from the actual eye, including terrain clearance. */
  heightAboveTargetMetres?: number;
  altitudeMetres?: number;
  viewAngleDegrees?: number;
  azimuthDegrees?: number;
  verticalFovDegrees?: number;
}

/** Lake levels on cells (`mask` > 0: lake cell), and the continuous shore field the 2D map draws (`field`, over `width` m from
 * the origin): when present, the field alone decides where the lake is, so the flat 3D water and the painted lake share one shore. */
export interface WaterSurface {
  n: number;
  levels: Float32Array;
  mask: Float32Array;
  field?: LakeField;
  width?: number;
}

/** A square material request in the terrain's metre coordinate system. */
export interface Terrain3dTile {
  key: string;
  x: number;
  y: number;
  width: number;
  level: number;
  pixels: number;
  /** Cheap cached map while navigating; exact requests retain the original capture painter. */
  preview?: boolean;
  exact?: boolean;
  prepare?<T>(work: Generator<void, T>): Promise<T>;
}

/** Final signed metre coefficients at cell centres, optionally including a halo. */
export interface Terrain3dTileContent {
  texture: TexImageSource;
  height?: HeightLayer;
  gutter?: number;
  water?: { x: number; y: number; width: number; n: number; alpha: Uint8Array };
  /** Albedo and coverage of physical ground, before lighting; same world extent and gutter. */
  ground?: TexImageSource;
  /** Tint blended over the shaded ground material, with the same world extent and proportional gutter. The material tile's
   * alpha is water cover (it also clears the canopy), so tints cannot travel in it. */
  semantic?: TexImageSource;
}

export interface Terrain3dLookSettings {
  paperMap?: boolean;
  ambience?: 'day' | 'night';
  waterLook?: 'ink' | 'natural';
  waterVisible?: boolean;
  groundCover?: boolean;
  /** Underdark world: the material ground draws the cave floor, rock masses (the layer's cave mask) and cave water, no trees. */
  underdark?: boolean;
  /** Underdark: lantern glow around towns on the cave floor, x, y, radius (m) per town, up to 16. */
  townGlow?: Float32Array;
  /** Physical town clearances for mushroom placement; retained when lamps are off. */
  townSites?: Float32Array;
  /** Underdark: fungal farm lots (underdarkFarmBeds), up to 32. */
  farmBeds?: Float32Array;
  /** Cultivated mushroom clusters in the detailed building appearance. */
  craftedBeds?: boolean;
  /** Underdark 3D display: roof of the section cut, darkness, mushrooms (render/underdarkCavern.ts); defaults when absent. */
  cavern?: UnderdarkCavern3d;
}

export interface Terrain3dGroundSettings extends Terrain3dLookSettings {
  seed: number;
  climate: { temperature: number; precipitation: number };
  sourceCell: number;
  /** V2 climate zone (Render v2 styles); absent keeps the climate-only look. */
  climateZone?: ClimateZone;
  lighting: TerrainLighting;
  displacement: boolean;
  forestBrushes?: boolean;
  renderV2?: number;
  paperMap?: boolean;
  v2Season?: number;
  v2Calendar?: SeasonCalendar;
  waterVisible?: boolean;
  contours?: { step: number; color: string; opacity: number; flat: boolean };
}

export type Terrain3dForestSettings = Pick<Terrain3dGroundSettings, 'seed' | 'climate' | 'lighting'>;

export interface Terrain3dOptions {
  /** Ground-level walking and altitude-sensitive orbit controls (V2). */
  navigation?: boolean;
  /** Compile the small draped-map shader first; procedural ground is compiled
   * only when setGroundMaterial is actually requested. Existing benches opt in. */
  fastMapShader?: boolean;
  /** Synchronous city cartography painting shares the frame budget with terrain meshes. */
  tileJobsPerFrame?: number;
  /** Tile jobs in flight at once (default 2). Most of a drape tile now waits on workers, so more can overlap. */
  tileJobsConcurrent?: number;
  /** Off-thread building merge of the forest occupation (V2: the display-preparation worker). Without it, or when it
   * fails, the merge runs synchronously as before; with it, the unmerged occupation shows until the merge lands. */
  mergeOccupation?: (source: ForestOccupation, scene: Building3dScene) => Promise<ForestOccupation | undefined>;
  /** Set by terrain3dRenderer.ts when the view draws into its own canvas laid over the owner's (a backend
   * switch): the owner's element, which keeps receiving the input and carries the status attributes. */
  element?: HTMLElement;
  /** A view being prepared behind the displayed one: no status attributes until showStatus(). */
  silent?: boolean;
}

/** Status attributes of a view (data-renderer, data-terrain-shader, data-ground-variant on its element). */
export type Terrain3dStatus = 'renderer' | 'terrainShader' | 'groundVariant';

export type Vec3 = [number, number, number];

/** Textures and handles below are WebGL objects, or the WebGPU backend's own (terrain3dGpu.ts). */
export interface Patch {
  tile: Terrain3dTile;
  vao?: WebGLVertexArrayObject;
  vertices?: WebGLBuffer;
  texture?: WebGLTexture;
  textureBytes: number;
  textureGutter?: number;
  texturePixels?: number;
  preview?: boolean;
  exact?: boolean;
  meshBytes: number;
  heightOrigin: number;
  minHeight: number;
  maxHeight: number;
  used: number;
  status: 'idle' | 'loading' | 'ready' | 'failed';
  /** Bumped when the tile's texture goes stale: a load started before it is dropped, the old texture stays shown until the new one is ready. */
  revision: number;
  heights?: Float32Array;
  /** The exact fine and parent fields uploaded to this mesh. */
  field?: Float32Array;
  seamSnapshot?: Float32Array;
  /** Vertices of the snapshot that may hold a correction (the stitch's `touched`). */
  seamTouched?: readonly number[];
  /** The last correction compared with the snapshot. */
  seamCompared?: Float32Array;
  parentSeam?: Float32Array;
  textureFadeStart: number;
  textureProgress: number;
  textureUpdated: number;
  materialParent?: MaterialRef;
  hasHeight: boolean;
  coherentReady: boolean;
  pendingHeights?: Float32Array;
  pendingTexture?: WebGLTexture;
  pendingTextureBytes: number;
  pendingTextureGutter?: number;
  pendingTexturePixels?: number;
}

export interface Node {
  patch: Patch;
  children?: Node[];
  error: number;
  wantsSplit: boolean;
  blend: number;
  updated: number;
  ready: boolean;
  visible: boolean;
  moving: boolean;
  birth: number;
  birthUpdated: number;
}

export interface MaterialRef {
  texture: WebGLTexture;
  tile?: Terrain3dTile;
  pixels: number;
  gutter?: number;
}

export interface PatchMaterial {
  from: MaterialRef;
  to: MaterialRef;
  blend: number;
  ready: boolean;
}

export interface FrameGeometry {
  eye: Vec3;
  targetHeight: number;
  matrix: Float32Array;
  focal: number;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
}

export interface RenderPiece extends TerrainStitchPiece {
  patch: Patch;
  morph: number;
  field: Float32Array;
  heightOrigin: number;
}

/** One patch draw of a frame, backend independent: mesh, clip, material blend and seam corrections. */
export interface PatchDraw {
  patch: Patch;
  morph: number;
  clip: Terrain3dTile;
  material: PatchMaterial;
  textureRect: [number, number, number, number];
  previousRect: [number, number, number, number];
  /** Per-vertex seam corrections, skirts included (vertex attribute 5). */
  correction: Float32Array;
}

/** The GPU resources the backend-independent parts create and release: implemented by Terrain3d's backend hooks
 * (WebGL2), overridden by the WebGPU view. Textures and buffers are opaque handles of the backend. */
export interface TerrainResources {
  uploadTexture(source: TexImageSource | Uint8Array): WebGLTexture;
  deleteTexture(texture: WebGLTexture): void;
  uploadWaterMask(water: NonNullable<Terrain3dTileContent['water']>): WebGLTexture;
  uploadMacroField(layer?: HeightLayer): WebGLTexture;
  uploadCavern(field: CavernField): WebGLTexture;
  uploadRoof(mesh: { vertices: Float32Array; indices: Uint32Array } | undefined): void;
  uploadForest(field: ForestField): ForestTextures;
  releaseForest(textures: ForestTextures | undefined): void;
  uploadOccupation(occupation: ForestOccupation): WebGLTexture;
  uploadLandDetail(detail: LandDetail): WebGLTexture;
  uploadMesh(patch: Patch, values: Float32Array): void;
  releaseMesh(patch: Patch): void;
  uploadTrees(values: Float32Array): void;
  uploadFungi(values: Float32Array): void;
  uploadBillboards(values: Float32Array, atlas?: HTMLCanvasElement): void;
}
