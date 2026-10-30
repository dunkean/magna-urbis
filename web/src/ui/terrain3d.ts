import { bindForest, deleteForestTextures, forestTexture, forestTextures, RENDER_3D_FOREST_GLSL, type ForestTextures, type HeightLayer } from './terrainGl';
import { shoreRingFor, shoreRingTexture } from '../../../rust/bridge/terrainForestBeach';
import { captureWebGlFrame } from './illustrationDepth';
import { FOREST_PRELUDE_GLSL, type ForestField, type ForestOccupation } from '../../../rust/bridge/terrainForest';
import { bindForestBrushes, disposeForestBrushes } from '../render/forestBrushAtlas';
import { ShaderVariants, specializeShader } from './glVariants';
import { NEURAL_EARTH_MATERIAL_GLSL } from '../../../rust/bridge/terrainMaterial';
import { RENDER_V2_GLSL, renderV2GlacierSources } from '../../../rust/bridge/terrainRenderV2';
import { renderV2ZoneUniform } from '../../../rust/bridge/terrainRenderV2Zones';
import type { ClimateZone } from '../../../rust/bridge/terrainClimate';
import { RENDER_3D_MATERIAL_GLSL } from '../../../rust/bridge/terrainMaterial3d';
import { createGroundDisplacementSampler } from '../../../rust/bridge/terrainGround';
import { terrainLights, type TerrainLighting } from '../render/terrainLighting';
import { gridHeight, raycastGrid, type TerrainPickGrid } from './terrain3dPicking';
import { stitchTerrainPieces, type TerrainStitchedPiece, type TerrainStitchPiece } from './terrain3dStitch';
import { UrbanBuildingPass } from './urbanBuilding3d';
import { reportRenderStats } from '../render/renderMode';
import type { UrbanBuildingAppearance } from '../render/urbanBuildingStyle';
import type { BuildingVector, Building3dVisual, Building3dScene } from '../render/urbanBuildingGeometry';
import { withBuildingOccupation } from './forestOccupation';
import { UrbanBuildingGround } from './urbanBuildingGround';

/** Target and orbit distance in world metres; yaw/pitch in radians. */
export interface Terrain3dCamera {
  x: number; y: number; distance: number; yaw: number; pitch: number; exaggeration: number;
  /** Capture-only measurements from the actual eye, including terrain clearance. */
  heightAboveTargetMetres?: number; altitudeMetres?: number; viewAngleDegrees?: number; azimuthDegrees?: number; verticalFovDegrees?: number;
}

interface WaterSurface { n: number; levels: Float32Array; mask: Float32Array }
/** A square material request in the terrain's metre coordinate system. */
export interface Terrain3dTile { key: string; x: number; y: number; width: number; level: number; pixels: number }
/** Final signed metre coefficients at cell centres, optionally including a halo. */
export interface Terrain3dTileContent {
  texture: TexImageSource; height?: HeightLayer; gutter?: number;
  water?: { x: number; y: number; width: number; n: number; alpha: Uint8Array };
}
export interface Terrain3dGroundSettings {
  seed: number; climate: { temperature: number; precipitation: number }; sourceCell: number;
  /** V2 climate zone (Render v2 styles); absent keeps the climate-only look. */
  climateZone?: ClimateZone;
  lighting: TerrainLighting; displacement: boolean; forestBrushes?: boolean; renderV2?: number; v2Season?: number; waterVisible?: boolean;
  contours?: { step: number; color: string; opacity: number; flat: boolean };
}
export interface Terrain3dOptions {
  /** Compile the small draped-map shader first; procedural ground is compiled
   * only when setGroundMaterial is actually requested. Existing benches opt in. */
  fastMapShader?: boolean;
}
export const TERRAIN_3D_FOV = Math.PI / 3.7;
export const TERRAIN_3D_MAX_SCALE = 8;
export const TERRAIN_GROUND_MAX_SCALE = 128;
type Vec3 = [number, number, number];
const FOV = TERRAIN_3D_FOV;
const GRID = 64, TILE_PIXELS = 512, MAX_LEAVES = 64, MAX_CACHE = 192, CACHE_BYTES = 96 * 1024 * 1024;
const SPLIT_ERROR = 2.4, MERGE_ERROR = 1.7, MORPH_MS = 220, TEXTURE_FADE_MS = 200;
const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
/** Same lighting, texture transitions, fog and tile diagnostics as the map branch
 * of the full material shader, without compiling unused procedural material code. */
export const TERRAIN_3D_MAP_FRAGMENT = `#version 300 es
precision highp float;
in vec2 texcoord;
in vec3 normal;
in vec3 world;
uniform sampler2D material;
uniform sampler2D previousMaterial;
uniform vec4 textureRect;
uniform vec4 previousRect;
uniform float textureBlend;
uniform vec3 eye;
uniform float fogDistance;
uniform int showTileBounds;
out vec4 color;
void main() {
  vec3 base=mix(texture(previousMaterial,previousRect.xy+texcoord*previousRect.zw),texture(material,textureRect.xy+texcoord*textureRect.zw),textureBlend).rgb;
  base*=.89+.11*max(0.,dot(normalize(normal),normalize(vec3(-.4,.8,-.3))));
  float fog=1.-exp(-pow(length(world-eye)/fogDistance,2.)*.11);
  base=mix(base,vec3(.77,.85,.88),min(.62,fog));
  if(showTileBounds==1){
    vec2 edge=min(texcoord,1.-texcoord)/max(fwidth(texcoord),vec2(1e-6));
    float line=1.-smoothstep(.45,1.35,min(edge.x,edge.y));
    base=mix(base,vec3(1.,.55,.12),line*.85);
  }
  color=vec4(base,1.);
}`;
const vertexShader = `#version 300 es
precision highp float;
layout(location=0) in vec3 position;
layout(location=1) in vec2 uv;
layout(location=2) in vec2 gradient;
layout(location=3) in float parentHeight;
layout(location=4) in vec2 parentGradient;
layout(location=5) in vec3 seamCorrection;
uniform mat4 matrix;
uniform float exaggeration;
uniform float morph;
uniform vec3 patchOffset;
uniform vec3 physicalOrigin;
out vec2 texcoord;
out vec3 normal;
out vec3 world;
out vec3 physical;
out vec2 physicalSlope;
void main() {
  float height = mix(parentHeight, position.y, morph) + seamCorrection.x;
  vec2 slope = mix(parentGradient, gradient, morph) + seamCorrection.yz;
  world = vec3(position.x, height * exaggeration, position.z) + patchOffset;
  normal = normalize(vec3(-slope.x * exaggeration, 1., -slope.y * exaggeration));
  physical=vec3(position.x,height,position.z)+physicalOrigin;
  physicalSlope=slope;
  texcoord = uv;
  gl_Position = matrix * vec4(world, 1.);
}`;
const fragmentShader = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D material;
uniform sampler2D previousMaterial;
uniform vec4 textureRect;
uniform vec4 previousRect;
uniform float textureBlend;
uniform vec3 eye;
uniform float fogDistance;
uniform int groundEnabled;
uniform int showTileBounds;
uniform vec3 groundEye;
uniform vec3 groundLight,groundLight2;
uniform float groundStrength;
uniform sampler2D macroField;
uniform vec3 macroRect;
uniform sampler2D uShoreRing;uniform vec3 uShoreRingRect;
uniform int macroN;
uniform vec3 patchRect;
uniform int groundContours; uniform vec3 groundContourColor;
uniform float groundContourStep,groundContourOpacity,groundFlatSlope;
uniform sampler2D canopyWater,previousCanopyWater;
uniform int hasCanopyWater,hasPreviousCanopyWater;
uniform vec3 canopyWaterRect,previousCanopyWaterRect;
in vec2 texcoord;
in vec3 normal;
in vec3 world;
in vec3 physical;
in vec2 physicalSlope;
out vec4 color;
${FOREST_PRELUDE_GLSL}
float forestWaterCoverage(vec2 p){
  vec2 current=(p-canopyWaterRect.xy)/canopyWaterRect.z;
  if(hasCanopyWater==1 && all(greaterThanEqual(current,vec2(0.))) && all(lessThanEqual(current,vec2(1.))))return textureLod(canopyWater,current,0.).r;
  vec2 previous=(p-previousCanopyWaterRect.xy)/previousCanopyWaterRect.z;
  if(hasPreviousCanopyWater==1 && all(greaterThanEqual(previous,vec2(0.))) && all(lessThanEqual(previous,vec2(1.))))return textureLod(previousCanopyWater,previous,0.).r;
  vec2 uv=(p-patchRect.xy)/patchRect.z;
  return mix(textureLod(previousMaterial,previousRect.xy+uv*previousRect.zw,0.).a,
    textureLod(material,textureRect.xy+uv*textureRect.zw,0.).a,textureBlend);
}
${NEURAL_EARTH_MATERIAL_GLSL}
${RENDER_3D_MATERIAL_GLSL}
${RENDER_3D_FOREST_GLSL}
${RENDER_V2_GLSL}
vec4 groundSpline(float t){float u=1.-t;return vec4(u*u*u,3.*t*t*t-6.*t*t+4.,-3.*t*t*t+3.*t*t+3.*t+1.,t*t*t)/6.;}
vec4 groundSplineDerivative(float t){return vec4(-.5*(1.-t)*(1.-t),1.5*t*t-2.*t,-1.5*t*t+t+.5,.5*t*t);}
vec3 groundMacroSurface(vec2 p){
  float cell=macroRect.z/float(macroN);vec2 g=(p-macroRect.xy)/cell-.5,t=fract(g);ivec2 b=ivec2(floor(g))-1;
  vec4 wx=groundSpline(t.x),wy=groundSpline(t.y),dx=groundSplineDerivative(t.x),dy=groundSplineDerivative(t.y);vec3 s=vec3(0.);
  for(int y=0;y<4;y++)for(int x=0;x<4;x++){
    float h=texelFetch(macroField,clamp(b+ivec2(x,y),ivec2(0),ivec2(macroN-1)),0).r;
    s+=h*vec3(wx[x]*wy[y],dx[x]*wy[y]/cell,wx[x]*dy[y]/cell);
  }
  return s;
}
float groundMacroHeight(vec2 p){
  ivec2 q=ivec2((p-macroRect.xy)/macroRect.z*float(macroN));
  return texelFetch(macroField,clamp(q,ivec2(0),ivec2(macroN-1)),0).r;
}
vec3 forestRootSurface(vec2 p){return groundMacroSurface(p);}
float forestRootCell(){return macroRect.z/float(macroN);}

void main() {
  vec4 projected = mix(texture(previousMaterial, previousRect.xy + texcoord * previousRect.zw),
    texture(material, textureRect.xy + texcoord * textureRect.zw), textureBlend);
  // Cartographic styles retain their projected lighting. Render3D instead
  // evaluates its world-space material here, then composites water and ink.
  vec3 base=projected.rgb;
  if(groundEnabled==1) {
    float footprint=max(.001,max(length(dFdx(physical)),length(dFdy(physical))));
    vec3 s=groundMacroSurface(physical.xz);
    float shore=max(s.x,0.)/max(length(s.yz),.0001);
    float openness=0.;
    if(uRenderV2>0&&s.x>=0.&&s.x<12.&&length(s.yz)<.5){
      vec2 ring=textureLod(uShoreRing,(physical.xz-uShoreRingRect.xy)/uShoreRingRect.z,0.).rg;
      shore=min(shore,ring.x);openness=ring.y;
    }
    GroundMaterial m;
    vec3 macro=earthMaterial(s,physical.xz,max(footprint,1.),0.,shore,openness);
    if(uRenderV2>0)m=v2Ground(s,physical.xz,footprint,0.,groundLight,groundLight2,groundStrength,renderGuideBaseOpen);
    else {
      m=terrainGroundMaterial(s,physical.xz,footprint,macro,uMaterialClimate,uMaterialSeed);
    }
    if(uForest==1)applyForest(m,physical.xz,footprint,groundLight);
    base=uRenderV2>0?v2ShadeGround(m,normalize(groundEye-physical),groundLight,groundLight2,groundStrength):shadeTerrainGround(m,normalize(groundEye-physical),groundLight,groundLight2,groundStrength);
    if(uRenderV2>0)base=v2DisplayShoulder(base);
    float under=uRenderV2>0?1.:1.-forestResolvedCover;
    if(uRenderV2>1)base=v2Diagnostic(s,physical.xz,0.,footprint);
    if(uRenderV2>0)base=v2WaterAt(base,s,physical.xz,footprint,projected.a,s.x<0.?1.:3.,s.x<0.?-s.x:8.*projected.a);
    else base=base*(1.-projected.a*under)+projected.rgb*under;
    if(groundContours==1 && s.x>0.){
      float v=s.x/groundContourStep,dv=max(fwidth(v),1e-6),k=floor(v+.5);
      bool major=mod(k,5.)<.5;
      float line=k<.5?0.:clamp((major?1.25:.7)*.5+.5-abs(v-k)/dv,0.,1.);
      float thin=mix(major?0.:line*.5,min(1.,.8*dv*.7)*.5,smoothstep(.3,.7,dv));
      float index=mix(major?line*.75:0.,min(1.,.2*dv*1.25)*.75,smoothstep(.3,.7,dv*5.));
      float a=(1.-(1.-thin)*(1.-index))*groundContourOpacity;
      a*=smoothstep(.25*groundFlatSlope,.5*groundFlatSlope,length(s.yz));
      base=mix(base,groundContourColor,a);
    }
  } else {
    float light=.89+.11*max(0.,dot(normalize(normal),normalize(vec3(-.4,.8,-.3))));
    base*=light;
  }
  float fog = 1. - exp(-pow(length(world - eye) / fogDistance, 2.) * .11);
  base=mix(base,vec3(.77,.85,.88),min(.62,fog));
  if(showTileBounds==1){
    vec2 edge=min(texcoord,1.-texcoord)/max(fwidth(texcoord),vec2(1e-6));
    float line=1.-smoothstep(.45,1.35,min(edge.x,edge.y));
    base=mix(base,vec3(1.,.55,.12),line*.85);
  }
  color=vec4(base,1.);
}`;
const skyVertex = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2. - 1., .9999, 1.);
}`;
const skyFragment = `#version 300 es
precision highp float;
uniform float height;
out vec4 color;
void main() {
  float t = clamp(gl_FragCoord.y / height, 0., 1.);
  color = vec4(mix(vec3(.89, .92, .91), vec3(.49, .68, .81), pow(t, .8)), 1.);
}`;

function program(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const result = gl.createProgram();
  if (!result) throw new Error('Impossible de créer la vue 3D.');
  for (const [kind, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
    const shader = gl.createShader(kind)!;
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader); gl.deleteShader(shader); gl.deleteProgram(result);
      throw new Error(`Shader terrain 3D : ${message}`);
    }
    gl.attachShader(result, shader); gl.deleteShader(shader);
  }
  gl.linkProgram(result);
  if (!gl.getProgramParameter(result, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(result); gl.deleteProgram(result);
    throw new Error(`Programme terrain 3D : ${message}`);
  }
  return result;
}

function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  }
  return out;
}
function normalize(v: Vec3): Vec3 {
  const scale = 1 / Math.max(1e-12, Math.hypot(...v)); return [v[0] * scale, v[1] * scale, v[2] * scale];
}
function cross(a: Vec3, b: Vec3): Vec3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function lookAt(eye: Vec3, target: Vec3): Float32Array {
  const z = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const x = normalize(cross([0, 1, 0], z)), y = cross(z, x);
  const dot = (v: Vec3): number => -(v[0] * eye[0] + v[1] * eye[1] + v[2] * eye[2]);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, dot(x), dot(y), dot(z), 1]);
}
function perspective(aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(FOV / 2), q = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * q, -1, 0, 0, 2 * far * near * q, 0]);
}

/** Cubic B-spline of cell-centred samples, identical to TerrainGl's surface. */
function spline(data: Float32Array, n: number, u: number, v: number): number {
  const gx = clamp(u, 0, 1) * n - .5, gy = clamp(v, 0, 1) * n - .5;
  const bx = Math.floor(gx), by = Math.floor(gy);
  const weights = (t: number): number[] => [(1 - t) ** 3 / 6, (3 * t ** 3 - 6 * t * t + 4) / 6, (-3 * t ** 3 + 3 * t * t + 3 * t + 1) / 6, t ** 3 / 6];
  const wx = weights(gx - bx), wy = weights(gy - by);
  let height = 0;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    height += data[clamp(by + y - 1, 0, n - 1) * n + clamp(bx + x - 1, 0, n - 1)] * wx[x] * wy[y];
  }
  return height;
}
function lakeHeight(water: WaterSurface, u: number, v: number): number | undefined {
  const { n, mask, levels } = water;
  if (spline(mask, n, u, v) <= 0) return undefined;
  const gx = clamp(u, 0, 1) * n - .5, gy = clamp(v, 0, 1) * n - .5;
  const bx = Math.floor(gx), by = Math.floor(gy);
  const weights = (t: number): number[] => [(1 - t) ** 3 / 6, (3 * t ** 3 - 6 * t * t + 4) / 6, (-3 * t ** 3 + 3 * t * t + 3 * t + 1) / 6, t ** 3 / 6];
  const wx = weights(gx - bx), wy = weights(gy - by);
  let height = 0, weight = 0;
  // Dry controls need not carry a water elevation. Excluding them keeps the
  // lake horizontal right up to its B-spline shore, including old .decor files.
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const i = clamp(by + y - 1, 0, n - 1) * n + clamp(bx + x - 1, 0, n - 1);
    if (mask[i] <= 0 || !Number.isFinite(levels[i])) continue;
    const w = wx[x] * wy[y]; height += levels[i] * w; weight += w;
  }
  return weight > 0 ? height / weight : undefined;
}

interface Patch {
  tile: Terrain3dTile;
  vao?: WebGLVertexArrayObject;
  vertices?: WebGLBuffer;
  texture?: WebGLTexture;
  textureBytes: number;
  textureGutter?: number;
  meshBytes: number;
  heightOrigin: number;
  minHeight: number;
  maxHeight: number;
  used: number;
  status: 'idle' | 'loading' | 'ready' | 'failed';
  heights?: Float32Array;
  /** The exact fine and parent fields uploaded to this mesh. */
  field?: Float32Array;
  seamSnapshot?: Float32Array;
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
}
interface Node { patch: Patch; children?: Node[]; error: number; wantsSplit: boolean; blend: number; updated: number; ready: boolean; visible: boolean; moving: boolean; birth: number; birthUpdated: number }
interface MaterialRef { texture: WebGLTexture; tile?: Terrain3dTile; pixels: number; gutter?:number }
interface PatchMaterial { from: MaterialRef; to: MaterialRef; blend: number; ready: boolean }
interface FrameGeometry { eye: Vec3; targetHeight: number; matrix: Float32Array; focal: number; right: Vec3; up: Vec3; forward: Vec3 }
interface RenderPiece extends TerrainStitchPiece { patch: Patch; morph: number }

/** Quadtree geometry and regional map materials, independent of generation. */
export class Terrain3d {
  private gl: WebGL2RenderingContext;
  private terrainProgram!: WebGLProgram;
  private mapProgram?: WebGLProgram;
  /** Ground material variants (glVariants.ts): settings switches as constants, linked in parallel. */
  private groundVariants!: ShaderVariants;
  /** Last ground variant drawn: it stands in while the settings' own variant links. */
  private lastGround?: WebGLProgram;
  private useMapShader = false;
  private uniformLocations = new WeakMap<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  private skyProgram!: WebGLProgram;
  private buildings!: UrbanBuildingPass;
  private buildingScene?: Building3dScene;
  private buildingAppearance: UrbanBuildingAppearance = { style: 'geometric', diagnostic: 'none' };
  private buildingsVisible = true;
  private buildingGround = new UrbanBuildingGround();
  private mergedOccupation?: ForestOccupation;
  private mergedOccupationSource?: ForestOccupation;
  private mergedOccupationScene?: Building3dScene;
  private indices!: WebGLBuffer;
  private seams!: WebGLBuffer;
  private clippedIndices = new Map<string, { buffer: WebGLBuffer; count: number }>();
  private material!: WebGLTexture;
  private macroTexture!: WebGLTexture;
  private shoreRing?: { layer: object; texture: WebGLTexture };
  private empty!: WebGLTexture;
  private waterMasks = new Map<WebGLTexture, { texture: WebGLTexture; rect: readonly [number, number, number]; bytes: number }>();
  private forestField?: ForestField;
  private forestOccupation?: ForestOccupation;
  private forest?: ForestTextures;
  private occupation?: { data: ForestOccupation; texture: WebGLTexture };
  private indexCount = 0;
  private layer?: HeightLayer;
  private water?: WaterSurface;
  private waterVisible = true;
  private textureSource?: TexImageSource;
  private fallbackPixels = 1;
  private fallbackGutter = 0;
  private groundSettings?: Terrain3dGroundSettings;
  private tileBounds = false;
  private tileLoader?: (tile: Terrain3dTile) => Promise<TexImageSource | Terrain3dTileContent>;
  private requireHeights = false;
  private geometryNeeded: Patch[] = [];
  private heightSampler?: (x: number, y: number, metresPerPixel: number) => number;
  private patches = new Map<string, Patch>();
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
  private clock = 0;
  private heightRange = 0;
  private maxSlope = 0;
  private camera: Terrain3dCamera = { x: 0, y: 0, distance: 1000, yaw: 0, pitch: .8, exaggeration: 1 };
  private active = false;
  private width = 1;
  private height = 1;
  private frame = 0;
  private disposed = false;
  private events = new AbortController();
  private pointers = new Map<number, { x: number; y: number; orbit: boolean }>();
  private gesture?: { x: number; y: number; distance: number };
  private lod = { tiles: 0, ready: 0, pending: 0, level: 0, metresPerTexel: 0, metresPerVertex: 0, maxScale: TERRAIN_3D_MAX_SCALE, scale: 0 };

  constructor(private canvas: HTMLCanvasElement, private onChange: () => void, private onRender?: () => void, private options: Terrain3dOptions = {}) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, depth: true, stencil: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('La vue 3D nécessite WebGL2.');
    this.gl = gl; this.initialize(); canvas.style.touchAction = 'none'; this.interactions();
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); cancelAnimationFrame(this.frame); this.frame = 0;
      ++this.epoch; this.patches.clear(); this.root = undefined;
    }, { signal: this.events.signal });
    canvas.addEventListener('webglcontextrestored', () => {
      if (this.disposed) return;
      this.initialize();
      if (this.textureSource) this.setTexture(this.textureSource);
      this.request();
    }, { signal: this.events.signal });
  }

  private initialize(): void {
    const gl = this.gl;
    this.uniformLocations = new WeakMap();
    this.clippedIndices.clear();
    this.mapProgram = this.lastGround = undefined;
    this.groundVariants?.reset(); this.groundVariants = new ShaderVariants(gl, () => this.request());
    this.selectTerrainProgram(!!this.groundSettings);
    this.skyProgram = program(gl, skyVertex, skyFragment);
    this.buildings?.dispose(); this.buildings = new UrbanBuildingPass(gl, () => this.request());
    this.buildings.setScene(this.buildingsVisible ? this.buildingScene : undefined, this.buildingAppearance);
    const side = GRID + 1, surfaceVertices = side * side, count = GRID * GRID * 6 + GRID * 4 * 6;
    const indices = new Uint16Array(count);
    let at = 0;
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      const a = y * side + x, b = a + 1, c = a + side, d = c + 1;
      indices.set([a, c, b, b, c, d], at); at += 6;
    }
    for (let edge = 0; edge < 4; edge++) for (let i = 0; i < GRID; i++) {
      const a = this.edgeVertex(edge, i), b = this.edgeVertex(edge, i + 1);
      const sa = surfaceVertices + edge * side + i, sb = sa + 1;
      indices.set([a, sa, b, b, sa, sb], at); at += 6;
    }
    this.indices = gl.createBuffer()!; this.indexCount = count;
    gl.bindVertexArray(null); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indices); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    this.seams = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.seams); gl.bufferData(gl.ARRAY_BUFFER, (surfaceVertices + 4 * side) * 3 * 4, gl.DYNAMIC_DRAW);
    this.material = this.uploadTexture(new Uint8Array([203, 211, 182, 255]));
    this.macroTexture=this.uploadMacroField(this.layer);
    this.shoreRing = undefined;
    this.empty = this.uploadMacroField();
    // A restored context comes back empty: re-upload the retained forest rasters.
    this.forest = this.occupation = undefined;
    this.setForest(this.forestField, this.forestOccupation);
  }
  private selectTerrainProgram(procedural: boolean): void {
    this.useMapShader = !!this.options.fastMapShader && !procedural;
    if (this.useMapShader) this.mapProgram ??= program(this.gl, vertexShader, TERRAIN_3D_MAP_FRAGMENT);
    this.canvas.dataset.terrainShader = this.useMapShader ? 'map' : 'procedural';
  }
  getShaderProfile(): 'map' | 'procedural' { return this.useMapShader ? 'map' : 'procedural'; }
  /** The settings' ground variant once linked; meanwhile the last drawn one, or the variant without
   * ground material (the projected map, quick to compile), stands in. */
  private groundShader(settings: Terrain3dGroundSettings | undefined): WebGLProgram {
    const forest = !!settings && !!this.forest;
    const v = { groundEnabled: +!!settings, uRenderV2: settings?.renderV2 ?? 0, uForest: +forest, uForestBrushes: +!!settings?.forestBrushes,
      uHasOccupation: +(forest && !!this.occupation), uHasForestBank: +(forest && !!this.forest?.bank) };
    const variant = (constants: typeof v, wait: boolean) => this.groundVariants.get(Object.values(constants).join('.'), () => [vertexShader, specializeShader(fragmentShader, constants)], wait);
    const target = variant(v, false);
    if (target) return this.lastGround = target;
    const preview = variant({ groundEnabled: 0, uRenderV2: 0, uForest: 0, uForestBrushes: 0, uHasOccupation: 0, uHasForestBank: 0 }, true);
    if (!this.lastGround && !preview) throw new Error('Shader terrain 3D indisponible.');
    return this.lastGround ?? preview!;
  }
  /** Uniform locations are constant for one linked program and GL context.
   * Inactive uniforms (null in the map shader) are cached as well. */
  private uniform(name: string, shader = this.terrainProgram): WebGLUniformLocation | null {
    let locations = this.uniformLocations.get(shader);
    if (!locations) { locations = new Map(); this.uniformLocations.set(shader, locations); }
    if (!locations.has(name)) locations.set(name, this.gl.getUniformLocation(shader, name));
    return locations.get(name)!;
  }
  private uploadMacroField(layer?:HeightLayer):WebGLTexture {
    const gl=this.gl,texture=gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.R32F,layer?.n??1,layer?.n??1,0,gl.RED,gl.FLOAT,layer?.data??new Float32Array(1));
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    return texture;
  }
  private edgeVertex(edge: number, i: number): number {
    const side = GRID + 1;
    return edge === 0 ? i : edge === 1 ? GRID * side + i : edge === 2 ? i * side : i * side + GRID;
  }
  private rectangleIndices(tile: Terrain3dTile, clip: Terrain3dTile): { buffer: WebGLBuffer; count: number } {
    if (clip === tile || (clip.x === tile.x && clip.y === tile.y && clip.width === tile.width)) return { buffer: this.indices, count: this.indexCount };
    const step = tile.width / GRID, side = GRID + 1;
    const x0 = clamp(Math.round((clip.x - tile.x) / step), 0, GRID), y0 = clamp(Math.round((clip.y - tile.y) / step), 0, GRID);
    const x1 = clamp(Math.round((clip.x + clip.width - tile.x) / step), x0, GRID), y1 = clamp(Math.round((clip.y + clip.width - tile.y) / step), y0, GRID);
    const key = `${x0}/${y0}/${x1}/${y1}`, cached = this.clippedIndices.get(key);
    if (cached) { this.clippedIndices.delete(key); this.clippedIndices.set(key, cached); return cached; }
    const indices: number[] = [], count = side * side;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const a = y * side + x, b = a + 1, c = a + side, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
    // Keep only real source-boundary skirts. Interior fallback boundaries are
    // actual triangle edges, welded to their neighbours by the geometry pass.
    for (let edge = 0; edge < 4; edge++) {
      if (!(edge === 0 ? y0 === 0 : edge === 1 ? y1 === GRID : edge === 2 ? x0 === 0 : x1 === GRID)) continue;
      const first = edge < 2 ? x0 : y0, last = edge < 2 ? x1 : y1;
      for (let i = first; i < last; i++) {
        const a = this.edgeVertex(edge, i), b = this.edgeVertex(edge, i + 1), sa = count + edge * side + i, sb = sa + 1;
        indices.push(a, sa, b, b, sa, sb);
      }
    }
    const gl = this.gl, buffer = gl.createBuffer()!;
    gl.bindVertexArray(null); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    const result = { buffer, count: indices.length }; this.clippedIndices.set(key, result);
    if (this.clippedIndices.size > 64) {
      const oldest = this.clippedIndices.keys().next().value!;
      gl.deleteBuffer(this.clippedIndices.get(oldest)!.buffer); this.clippedIndices.delete(oldest);
    }
    return result;
  }
  private uploadTexture(source: TexImageSource | Uint8Array): WebGLTexture {
    const gl = this.gl, texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
    if (source instanceof Uint8Array) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    else {
      // A duplicated one-texel border gives every mip a continuous edge; UVs
      // address the inner world rectangle rather than the added gutter.
      const dimensions = source as { width?: number; naturalWidth?: number; videoWidth?: number; height?: number; naturalHeight?: number; videoHeight?: number };
      const width = dimensions.videoWidth || dimensions.naturalWidth || dimensions.width || 1;
      const height = dimensions.videoHeight || dimensions.naturalHeight || dimensions.height || width;
      let drawable = source as CanvasImageSource;
      if (typeof ImageData !== 'undefined' && source instanceof ImageData) {
        const bitmap = document.createElement('canvas'); bitmap.width = width; bitmap.height = height;
        bitmap.getContext('2d')!.putImageData(source, 0, 0); drawable = bitmap;
      }
      const padded = document.createElement('canvas'); padded.width = width + 2; padded.height = height + 2;
      const context = padded.getContext('2d')!;
      context.drawImage(drawable, 1, 1, width, height);
      context.drawImage(drawable, 0, 0, width, 1, 1, 0, width, 1);
      context.drawImage(drawable, 0, height - 1, width, 1, 1, height + 1, width, 1);
      context.drawImage(padded, 1, 0, 1, height + 2, 0, 0, 1, height + 2);
      context.drawImage(padded, width, 0, 1, height + 2, width + 1, 0, 1, height + 2);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, padded);
    }
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    const anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
    if (anisotropy) gl.texParameterf(gl.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    return texture;
  }

  setSurface(layer: HeightLayer, water?: WaterSurface, waterVisible = true): void {
    if (this.layer?.data === layer.data && this.layer.n === layer.n && this.layer.width === layer.width && this.layer.x === layer.x
      && this.layer.y === layer.y && this.water?.mask === water?.mask && this.water?.levels === water?.levels
      && this.water?.n === water?.n && this.waterVisible === waterVisible) return;
    this.layer = layer; this.water = water; this.waterVisible = waterVisible;
    this.gl.deleteTexture(this.macroTexture);this.macroTexture=this.uploadMacroField(layer);
    let low = Infinity, high = -Infinity, slope = 0;
    const cell = layer.width / layer.n;
    for (let i = 0; i < layer.data.length; i++) {
      const value = layer.data[i]; low = Math.min(low, value); high = Math.max(high, value);
      if (i % layer.n + 1 < layer.n) slope = Math.max(slope, Math.abs(layer.data[i + 1] - value) / cell);
      if (i + layer.n < layer.data.length) slope = Math.max(slope, Math.abs(layer.data[i + layer.n] - value) / cell);
    }
    this.maxSlope = slope * Math.SQRT2;
    this.heightRange = Math.max(0, high - low); this.clearPatches(); this.limitCamera(); this.request();
  }
  setHeightSampler(sample: ((x: number, y: number, metresPerPixel: number) => number) | undefined): void {
    if (sample === this.heightSampler) return;
    this.heightSampler = sample; this.clearPatches(); this.request();
  }
  setGroundMaterial(settings: Terrain3dGroundSettings | undefined): void {
    const previous = this.groundSettings;
    // Compile before committing the switch: a failed optional material keeps
    // the current renderer and retained geometry usable.
    this.selectTerrainProgram(!!settings);
    this.groundSettings = settings;
    if(settings?.renderV2 && !previous?.renderV2 && !this.textureSource){
      this.gl.deleteTexture(this.material);this.material=this.uploadTexture(new Uint8Array([0,0,0,0]));
    }
    if (previous?.displacement !== settings?.displacement || previous?.seed !== settings?.seed
      || previous?.sourceCell !== settings?.sourceCell
      || previous?.climate.temperature !== settings?.climate.temperature
      || previous?.climate.precipitation !== settings?.climate.precipitation) this.clearPatches();
    this.limitCamera();
    this.request();
  }
  setRenderV2Season(season:number):void { if(this.groundSettings?.renderV2){this.groundSettings={...this.groundSettings,v2Season:season};this.request();} }
  setTileBoundaries(visible: boolean): void { this.tileBounds = visible; this.request(); }
  /** Presentation consumes the same immutable native scene as the map. */
  setBuildings(scene: Building3dScene | undefined, appearance: UrbanBuildingAppearance, visible = true): void {
    const changed = this.buildingScene !== scene;
    this.buildingScene = scene; this.buildingAppearance = appearance; this.buildingsVisible = visible;
    if (changed) { this.buildingGround = new UrbanBuildingGround(scene); this.clearPatches(); this.setForest(this.forestField, this.forestOccupation); }
    this.buildings.setScene(visible ? scene : undefined, appearance); this.request();
  }
  /** Swap a few buildings of the current scene (native exteriors in or out):
   * only their sectors rebuild; relief, patches and forest stay untouched. */
  replaceBuildings(changes: readonly Building3dVisual[]): string[] {
    if (!this.buildingsVisible || !changes.length) return [];
    const missing = this.buildings.replaceBuildings(changes); this.request(); return missing;
  }
  /** Render3D forest: texture uploads only, no mesh or material tile rebuild. */
  setForest(field: ForestField | undefined, occupation?: ForestOccupation): void {
    const gl = this.gl;
    occupation = field ? occupation : undefined;
    this.forestField = field; this.forestOccupation = occupation;
    if (this.mergedOccupationSource !== occupation || this.mergedOccupationScene !== this.buildingScene) {
      this.mergedOccupationSource = occupation; this.mergedOccupationScene = this.buildingScene;
      this.mergedOccupation = withBuildingOccupation(occupation, this.buildingScene);
    }
    occupation = field ? this.mergedOccupation : undefined;
    if (field !== this.forest?.field) {
      deleteForestTextures(gl, this.forest);
      this.forest = field && forestTextures(gl, field);
    }
    if (occupation !== this.occupation?.data) {
      if (this.occupation) gl.deleteTexture(this.occupation.texture);
      this.occupation = occupation && { data: occupation, texture: forestTexture(gl, occupation, false) };
    }
    this.request();
  }
  setTileLoader(loader: ((tile: Terrain3dTile) => Promise<TexImageSource | Terrain3dTileContent>) | undefined, requireHeights = false): void {
    if (this.requireHeights !== requireHeights) { this.requireHeights = requireHeights; this.clearPatches(); }
    this.tileLoader = loader; this.invalidateTiles();
  }
  invalidateTiles(): void {
    ++this.epoch;
    for (const patch of this.patches.values()) {
      if (patch.texture) this.releaseMaterial(patch.texture);
      if (patch.pendingTexture) this.releaseMaterial(patch.pendingTexture);
      patch.texture = undefined; patch.textureBytes = 0; patch.status = 'idle'; patch.textureFadeStart = 0; patch.textureProgress = 0; patch.materialParent = undefined;
      patch.pendingTexture = undefined; patch.pendingTextureBytes = 0; patch.pendingHeights = undefined;
    }
    this.request();
  }
  getLodInfo(): typeof this.lod { return { ...this.lod, pending: this.jobs.size }; }

  private clearPatches(): void {
    ++this.epoch;
    for (const patch of this.patches.values()) this.releasePatch(patch);
    this.patches.clear(); this.root = undefined; this.desired = []; this.protected.clear(); this.splits.clear();
    this.displayedGrids = [];
    this.displayedPieces = [];
    this.stitchUpdated = 0;
  }
  private surface(x: number, y: number, metresPerPixel: number, detail = true): number {
    const layer = this.layer; if (!layer) return 0;
    const u = (x - layer.x) / layer.width, v = (y - layer.y) / layer.width;
    // The mountain field is canonical. Only the optional centimetre ground
    // residual is filtered to the mesh footprint to avoid geometric aliasing.
    const footprint = this.groundSettings?.displacement ? metresPerPixel : 0;
    let height = detail && this.heightSampler ? this.heightSampler(x, y, footprint) : spline(layer.data, layer.n, u, v);
    if (!Number.isFinite(height)) height = spline(layer.data, layer.n, u, v);
    height = this.buildingGround.constrain(x, y, height);
    if (this.waterVisible) {
      height = Math.max(0, height);
      const lake = this.water && lakeHeight(this.water, u, v);
      if (lake !== undefined) height = lake;
    }
    return Number.isFinite(height) ? height : 0;
  }
  heightAt(x: number, y: number): number | undefined {
    if (!this.layer) return undefined;
    return this.surface(x, y, 0);
  }
  /** Select the nearest actual building face using its physical native geometry. */
  pickBuilding(x: number, y: number): string | undefined {
    if (!this.layer || !this.active || !this.buildingScene || !this.buildingsVisible) return undefined;
    const frame = this.frameGeometry(), c = this.camera;
    const u = (x - this.width / 2) / frame.focal, v = (this.height / 2 - y) / frame.focal;
    const ray: Vec3 = [0, 1, 2].map(i => frame.forward[i] + u * frame.right[i] + v * frame.up[i]) as Vec3;
    const origin: BuildingVector = [c.x + frame.eye[0], c.y + frame.eye[2], (frame.targetHeight + frame.eye[1]) / c.exaggeration];
    const direction: BuildingVector = [ray[0], ray[2], ray[1] / c.exaggeration];
    const { distance: nearest, id } = this.buildings.pick(origin, direction);
    // Ground occludes buildings behind hills, just as the depth buffer does.
    const glOrigin: Vec3 = [origin[0], origin[2] * c.exaggeration, origin[1]];
    let ground = Infinity;
    for (const grid of this.displayedGrids) { const hit = raycastGrid(grid, glOrigin, ray); if (hit !== null) ground = Math.min(ground, hit); }
    return nearest <= ground + .01 ? id : undefined;
  }
  /** Pick the nearest visible terrain triangle in CSS pixels, including LOD morphs and refined heights. */
  screenToWorld(x: number, y: number): [number, number] | null {
    if (!this.layer || !this.active) return null;
    const frame = this.frameGeometry(), c = this.camera;
    const u = (x - this.width / 2) / frame.focal, v = (this.height / 2 - y) / frame.focal;
    const direction: Vec3 = [0, 1, 2].map(i => frame.forward[i] + u * frame.right[i] + v * frame.up[i]) as Vec3;
    const origin: Vec3 = [c.x + frame.eye[0], frame.targetHeight + frame.eye[1], c.y + frame.eye[2]];
    let nearest = Infinity;
    for (const grid of this.displayedGrids) {
      const hit = raycastGrid(grid, origin, direction);
      if (hit !== null) nearest = Math.min(nearest, hit);
    }
    return Number.isFinite(nearest) ? [origin[0] + direction[0] * nearest, origin[2] + direction[2] * nearest] : null;
  }
  worldToScreen(x: number, y: number): [number, number] | null {
    if (!this.layer || !this.active) return null;
    let height: number | null = null;
    for (const grid of this.displayedGrids) {
      height = gridHeight(grid, x, y);
      if (height !== null) break;
    }
    if (height === null) return null;
    const frame = this.frameGeometry(), c = this.camera;
    const relative: Vec3 = [x - c.x - frame.eye[0], height - frame.targetHeight - frame.eye[1], y - c.y - frame.eye[2]];
    const dot = (axis: Vec3): number => relative[0] * axis[0] + relative[1] * axis[1] + relative[2] * axis[2];
    const depth = dot(frame.forward);
    return depth > 0 ? [this.width / 2 + frame.focal * dot(frame.right) / depth, this.height / 2 - frame.focal * dot(frame.up) / depth] : null;
  }
  private patch(level: number, ix: number, iy: number): Patch {
    const layer = this.layer!, key = `${level}/${ix}/${iy}`;
    let patch = this.patches.get(key);
    if (!patch) {
      const width = layer.width / 2 ** level, x = layer.x + ix * width, y = layer.y + iy * width;
      const centre = this.surface(x + width / 2, y + width / 2, width / TILE_PIXELS, false);
      let low = centre, high = centre;
      for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const height = this.surface(x + u * width, y + v * width, width / TILE_PIXELS, false);
        low = Math.min(low, height); high = Math.max(high, height);
      }
      // Keep selection bounds independent of whether a mesh has been built or
      // evicted. Changing them during preparation makes adjacent LODs oscillate.
      const padding = Math.min(this.heightRange, this.maxSlope * width * .6 + this.heightRange * .003);
      low -= padding; high += padding;
      patch = { tile: { key, x, y, width, level, pixels: TILE_PIXELS }, textureBytes: 0, meshBytes: 0,
        heightOrigin: centre, minHeight: low, maxHeight: high, used: this.clock, status: 'idle', textureFadeStart: 0, textureProgress: 0, textureUpdated: 0,
        hasHeight: false, coherentReady: false, pendingTextureBytes: 0 };
      this.patches.set(key, patch);
    }
    patch.used = this.clock; return patch;
  }
  private frameGeometry(): FrameGeometry {
    const c = this.camera, targetHeight = this.heightAt(c.x, c.y)! * c.exaggeration;
    const eye: Vec3 = [Math.sin(c.yaw) * Math.cos(c.pitch) * c.distance, Math.sin(c.pitch) * c.distance, Math.cos(c.yaw) * Math.cos(c.pitch) * c.distance];
    const ex = c.x + eye[0], ey = c.y + eye[2];
    const clearance = Math.max(.15, c.distance * .0015);
    const ground = this.heightAt(ex, ey)! * c.exaggeration - targetHeight;
    eye[1] = Math.max(eye[1], ground + clearance);
    const forward = normalize([-eye[0], -eye[1], -eye[2]]), right = normalize(cross(forward, [0, 1, 0])), up = cross(right, forward);
    const view = lookAt(eye, [0, 0, 0]);
    const far = Math.max(c.distance * 4, this.layer!.width * 2 + this.heightRange * c.exaggeration * 2);
    const matrix = multiply(perspective(this.width / this.height, Math.max(.02, c.distance * .0002), far), view);
    return { eye, targetHeight, matrix, focal: this.height / (2 * Math.tan(FOV / 2)), right, up, forward };
  }
  private nodeError(patch: Patch, frame: FrameGeometry): number {
    const tile = patch.tile, c = this.camera;
    const x = tile.x + tile.width / 2 - c.x, y = (patch.minHeight + patch.maxHeight) / 2 * c.exaggeration - frame.targetHeight;
    const z = tile.y + tile.width / 2 - c.y;
    const relative: Vec3 = [x - frame.eye[0], y - frame.eye[1], z - frame.eye[2]];
    const dot = (v: Vec3): number => relative[0] * v[0] + relative[1] * v[1] + relative[2] * v[2];
    const half = tile.width / 2, vertical = (patch.maxHeight - patch.minHeight) * c.exaggeration / 2;
    const extent = (plane: Vec3): number => Math.abs(plane[0]) * half + Math.abs(plane[1]) * vertical + Math.abs(plane[2]) * half;
    const tan = Math.tan(FOV / 2);
    const outside = (axis: Vec3, tangent: number, sign: number): boolean => {
      const plane: Vec3 = [axis[0] * sign - frame.forward[0] * tangent, axis[1] * sign - frame.forward[1] * tangent, axis[2] * sign - frame.forward[2] * tangent];
      return dot(plane) > extent(plane);
    };
    // AABB/plane support tests avoid the very loose overlapping spheres that
    // consume the leaf budget around a quadtree junction at close zoom.
    if (dot(frame.forward) + extent(frame.forward) <= .02
      || outside(frame.right, tan * this.width / this.height, 1) || outside(frame.right, tan * this.width / this.height, -1)
      || outside(frame.up, tan, 1) || outside(frame.up, tan, -1)) return -1;
    const ex = c.x + frame.eye[0], ey = c.y + frame.eye[2];
    const dx = Math.max(tile.x - ex, 0, ex - tile.x - tile.width), dz = Math.max(tile.y - ey, 0, ey - tile.y - tile.width);
    const eyeHeight = frame.targetHeight + frame.eye[1];
    const dy = Math.max(patch.minHeight * c.exaggeration - eyeHeight, 0, eyeHeight - patch.maxHeight * c.exaggeration);
    const distance = Math.max(c.distance * .12, Math.hypot(dx, dz, dy));
    return tile.width / GRID * frame.focal / distance;
  }
  private select(frame: FrameGeometry): void {
    ++this.clock;
    const maxLevel = Math.max(0, Math.ceil(Math.log2(this.layer!.width / (TILE_PIXELS / (this.maxScale() * this.dpr())))),
      Math.ceil(Math.log2(this.layer!.width / (GRID * 2 / this.maxScale()))));
    const make = (patch: Patch, error: number): Node => ({ patch, error, wantsSplit: false, blend: 0, updated: this.now, ready: false, visible: true, moving: false, birth: 1, birthUpdated: 0 });
    const rootPatch = this.patch(0, 0, 0), wanted = make(rootPatch, this.nodeError(rootPatch, frame));
    const leaves: Node[] = [wanted], splits = new Set<string>();
    while (leaves.length < MAX_LEAVES - 3) {
      let candidate: Node | undefined, priority = 0;
      for (const node of leaves) {
        const threshold = this.splits.has(node.patch.tile.key) ? MERGE_ERROR : SPLIT_ERROR;
        const score = node.error / threshold;
        if (score > 1 && node.patch.tile.level < maxLevel && score > priority) { candidate = node; priority = score; }
      }
      if (!candidate) break;
      const tile = candidate.patch.tile, [ix, iy] = tile.key.split('/').slice(1).map(Number), children: Node[] = [];
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
        const patch = this.patch(tile.level + 1, ix * 2 + x, iy * 2 + y), error = this.nodeError(patch, frame);
        if (error >= 0) children.push(make(patch, error));
      }
      if (!children.length) { candidate.error = 0; continue; }
      candidate.children = children; candidate.wantsSplit = true; splits.add(tile.key);
      leaves.splice(leaves.indexOf(candidate), 1, ...children);
    }
    const close = (node: Node): void => {
      node.wantsSplit = false; node.error = this.nodeError(node.patch, frame); node.visible = node.error >= 0;
      node.children?.forEach(close);
    };
    const reconcile = (next: Node, previous?: Node): Node => {
      if (!previous || previous.patch !== next.patch) return next;
      if (!previous.visible) { previous.birth = 0; previous.birthUpdated = 0; }
      previous.error = next.error; previous.visible = true; previous.wantsSplit = !!next.children;
      if (next.children) {
        const old = new Map(previous.children?.map(child => [child.patch.tile.key, child]));
        previous.children = next.children.map(child => {
          const oldChild = old.get(child.patch.tile.key), result = reconcile(child, oldChild);
          if (result !== oldChild && previous.blend > 0) { result.birth = 0; result.birthUpdated = 0; }
          return result;
        });
      } else previous.children?.forEach(close);
      return previous;
    };
    this.root = reconcile(wanted, this.root); this.splits = splits;
    this.desired = leaves.filter(node => node.error >= 0).map(node => node.patch);
    this.desired.sort((a, b) => Math.hypot(a.tile.x + a.tile.width / 2 - this.camera.x, a.tile.y + a.tile.width / 2 - this.camera.y)
      - Math.hypot(b.tile.x + b.tile.width / 2 - this.camera.x, b.tile.y + b.tile.width / 2 - this.camera.y));
    this.protected = new Set(this.desired.map(p => p.tile.key)); this.protected.add(rootPatch.tile.key);
  }
  private grid(patch: Patch): Float32Array {
    if (patch.heights) return patch.heights;
    const side = GRID + 1, heights = new Float32Array(side * side), step = patch.tile.width / GRID;
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
      heights[y * side + x] = this.surface(patch.tile.x + x * step, patch.tile.y + y * step, step);
    }
    patch.heights = heights; return heights;
  }
  private decodedGrid(tile: Terrain3dTile, layer: HeightLayer): Float32Array {
    if (layer.n < 2 || layer.data.length !== layer.n * layer.n || !(layer.width > 0)
      || tile.x < layer.x || tile.y < layer.y || tile.x + tile.width > layer.x + layer.width + 1e-5
      || tile.y + tile.width > layer.y + layer.width + 1e-5) throw new Error('Grille de relief 3D incomplète.');
    const side = GRID + 1, heights = new Float32Array(side * side), step = tile.width / GRID, base = this.layer!;
    const baseSample = (wx: number, wy: number): number => spline(layer.data, layer.n, (wx - layer.x) / layer.width, (wy - layer.y) / layer.width);
    const settings = this.groundSettings;
    const sample = settings?.displacement ? createGroundDisplacementSampler(baseSample, {
      seed: settings.seed, climate: [settings.climate.temperature, settings.climate.precipitation], sourceCell: settings.sourceCell,
      macroSampler: (wx, wy) => spline(base.data, base.n, (wx - base.x) / base.width, (wy - base.y) / base.width),
    }) : baseSample;
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
      const wx = tile.x + x * step, wy = tile.y + y * step;
      let height = sample(wx, wy, step);
      if (!Number.isFinite(height)) throw new Error('Altitude 3D non finie.');
      height = this.buildingGround.constrain(wx, wy, height);
      if (this.waterVisible) {
        height = Math.max(0, height);
        const lake = this.water && lakeHeight(this.water, (wx - base.x) / base.width, (wy - base.y) / base.width);
        if (lake !== undefined) height = lake;
      }
      heights[y * side + x] = height;
    }
    return heights;
  }
  private installHeights(patch: Patch, heights: Float32Array): void {
    const tile = patch.tile;
    for (const candidate of this.patches.values()) {
      const child = candidate.tile;
      if (child.level < tile.level || child.x < tile.x || child.y < tile.y
        || child.x + child.width > tile.x + tile.width + 1e-5 || child.y + child.width > tile.y + tile.width + 1e-5) continue;
      if (candidate.vao) this.gl.deleteVertexArray(candidate.vao);
      if (candidate.vertices) this.gl.deleteBuffer(candidate.vertices);
      candidate.vao = undefined; candidate.vertices = undefined; candidate.meshBytes = 0;
      candidate.field = undefined; candidate.seamSnapshot = undefined; candidate.parentSeam = undefined;
    }
    patch.heights = heights; patch.hasHeight = true; patch.pendingHeights = undefined;
    if (patch.pendingTexture) {
      if (patch.texture) this.releaseMaterial(patch.texture);
      patch.texture = patch.pendingTexture; patch.textureBytes = patch.pendingTextureBytes;
      patch.textureGutter=patch.pendingTextureGutter;
      patch.pendingTexture = undefined; patch.pendingTextureBytes = 0; patch.textureFadeStart = 0;
      patch.textureProgress = 0; patch.materialParent = undefined;
      patch.coherentReady = true;
    }
  }
  private containsLivePatch(patch: Patch): boolean {
    const visit = (node: Node): boolean => node.visible && (node.patch === patch || !!node.children?.some(visit));
    return !!this.root && visit(this.root);
  }
  private gradient(heights: Float32Array, x: number, y: number, step: number): [number, number] {
    const side = GRID + 1, x0 = Math.max(0, x - 1), x1 = Math.min(GRID, x + 1), y0 = Math.max(0, y - 1), y1 = Math.min(GRID, y + 1);
    return [(heights[y * side + x1] - heights[y * side + x0]) / ((x1 - x0) * step),
      (heights[y1 * side + x] - heights[y0 * side + x]) / ((y1 - y0) * step)];
  }
  private parentSample(parent: Patch, x: number, y: number, stitched = false): [number, number, number] {
    const heights = this.grid(parent), tile = parent.tile, step = tile.width / GRID, side = GRID + 1;
    const gx = clamp((x - tile.x) / step, 0, GRID), gy = clamp((y - tile.y) / step, 0, GRID);
    const ix = Math.min(GRID - 1, Math.floor(gx)), iy = Math.min(GRID - 1, Math.floor(gy)), tx = gx - ix, ty = gy - iy;
    const points = tx + ty <= 1 ? [[ix, iy, 1 - tx - ty], [ix + 1, iy, tx], [ix, iy + 1, ty]]
      : [[ix + 1, iy, 1 - ty], [ix, iy + 1, 1 - tx], [ix + 1, iy + 1, tx + ty - 1]];
    let height = 0, dx = 0, dy = 0;
    for (const [px, py, weight] of points) {
      const gradient = this.gradient(heights, px, py, step);
      height += heights[py * side + px] * weight; dx += gradient[0] * weight; dy += gradient[1] * weight;
      if (stitched && parent.seamSnapshot) {
        const at = (py * side + px) * 3;
        height += parent.seamSnapshot[at] * weight; dx += parent.seamSnapshot[at + 1] * weight; dy += parent.seamSnapshot[at + 2] * weight;
      }
    }
    return [height, dx, dy];
  }
  private buildMesh(patch: Patch): void {
    const gl = this.gl, tile = patch.tile, side = GRID + 1, count = side * side;
    const heights = this.grid(patch), values = new Float32Array((count + 4 * side) * 10), field = new Float32Array(count * 6);
    const step = tile.width / GRID, [level, ix, iy] = tile.key.split('/').map(Number);
    const parent = level ? this.patch(level - 1, Math.floor(ix / 2), Math.floor(iy / 2)) : patch;
    patch.parentSeam = parent === patch ? undefined : parent.seamSnapshot;
    const skirt = Math.max(.05, tile.width * .12);
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
      const i = y * side + x, at = i * 10;
      const x0 = Math.max(0, x - 1), x1 = Math.min(GRID, x + 1), y0 = Math.max(0, y - 1), y1 = Math.min(GRID, y + 1);
      values[at] = x * step; values[at + 1] = heights[i] - patch.heightOrigin; values[at + 2] = y * step;
      values[at + 3] = x / GRID; values[at + 4] = y / GRID;
      values[at + 5] = (heights[y * side + x1] - heights[y * side + x0]) / ((x1 - x0) * step);
      values[at + 6] = (heights[y1 * side + x] - heights[y0 * side + x]) / ((y1 - y0) * step);
      const coarse = this.parentSample(parent, tile.x + x * step, tile.y + y * step, parent !== patch);
      values[at + 7] = coarse[0] - patch.heightOrigin; values[at + 8] = coarse[1]; values[at + 9] = coarse[2];
      field.set([values[at + 1], values[at + 5], values[at + 6], values[at + 7], values[at + 8], values[at + 9]], i * 6);
    }
    for (let edge = 0; edge < 4; edge++) for (let i = 0; i < side; i++) {
      const from = this.edgeVertex(edge, i) * 10, to = (count + edge * side + i) * 10;
      values.set(values.subarray(from, from + 10), to); values[to + 1] -= skirt; values[to + 7] -= skirt;
    }
    patch.vao = gl.createVertexArray()!; patch.vertices = gl.createBuffer()!;
    gl.bindVertexArray(patch.vao); gl.bindBuffer(gl.ARRAY_BUFFER, patch.vertices); gl.bufferData(gl.ARRAY_BUFFER, values, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 40, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 40, 20);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 40, 28);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 2, gl.FLOAT, false, 40, 32);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indices); gl.bindVertexArray(null);
    patch.field = field; patch.meshBytes = values.byteLength + field.byteLength;
  }
  private prepareMeshes(): boolean {
    if (!this.root) return false;
    const queue: Patch[] = [], visit = (node: Node, incomingFull = true): void => {
      // Once children cover a node, its coarse mesh is no longer needed.
      // The LRU may evict it without causing a rebuild on every later frame.
      if (!node.visible) return;
      if (!node.patch.vao && (!incomingFull || !node.wantsSplit || node.blend < 1 || !node.children?.every(child => this.covered(child)))) queue.push(node.patch);
      // Prepare direct children while a branch opens. Deeper ancestors only
      // become relevant once that incoming morph has reached its exact endpoint.
      if (incomingFull && node.wantsSplit) node.children?.forEach(child => visit(child, node.blend >= 1));
    };
    visit(this.root);
    queue.sort((a, b) => a.tile.level - b.tile.level || Math.hypot(a.tile.x - this.camera.x, a.tile.y - this.camera.y) - Math.hypot(b.tile.x - this.camera.x, b.tile.y - this.camera.y));
    this.geometryNeeded = queue;
    const available = queue.filter(patch => {
      const [level, ix, iy] = patch.tile.key.split('/').map(Number);
      if (!this.requireHeights || level === 0) return true;
      return patch.hasHeight && (level === 1 || this.patch(level - 1, Math.floor(ix / 2), Math.floor(iy / 2)).hasHeight);
    });
    const start = performance.now(); let built = 0;
    for (const patch of available) {
      if (built && performance.now() - start > 7) break;
      this.buildMesh(patch); ++built;
    }
    return built < available.length;
  }
  private loadTiles(): void {
    if (!this.tileLoader || !this.active || this.gl.isContextLost()) return;
    const queue = this.requireHeights ? [...new Set([...this.geometryNeeded, ...this.desired])] : this.desired;
    for (const patch of queue) {
      if (this.jobs.size >= 2) break;
      if (patch.tile.level === 0 || patch.status !== 'idle') continue;
      const job = {}, epoch = this.epoch, loader = this.tileLoader;
      patch.status = 'loading'; this.jobs.add(job);
      void Promise.resolve().then(() => loader({ ...patch.tile })).then(result => {
        const content = typeof result === 'object' && result !== null && 'texture' in result ? result as Terrain3dTileContent : { texture: result as TexImageSource };
        const source = content.texture;
        if (epoch !== this.epoch || this.disposed || this.gl.isContextLost() || this.patches.get(patch.tile.key) !== patch) {
          if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) source.close();
          return;
        }
        if (this.requireHeights && !content.height) throw new Error('Tuile de relief 3D sans grille d’altitude.');
        let deferred = false;
        if (content.height) {
          const heights = this.decodedGrid(patch.tile, content.height);
          const unchanged = patch.hasHeight && patch.heights?.every((value, i) => Math.abs(value - heights[i]) < .0001);
          if (!unchanged) {
            if (patch.heights && this.containsLivePatch(patch)) { patch.pendingHeights = heights; deferred = true; }
            else this.installHeights(patch, heights);
          }
        }
        const gutter=Math.max(0,Math.min(8,Math.round(content.gutter??0)));
        const texture = this.uploadTexture(source);
        let textureBytes = (TILE_PIXELS+2*gutter+2)**2*4*4/3;
        if(content.water){
          const water=content.water,gl=this.gl,mask=gl.createTexture()!;
          gl.bindTexture(gl.TEXTURE_2D,mask);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
          gl.texImage2D(gl.TEXTURE_2D,0,gl.R8,water.n,water.n,0,gl.RED,gl.UNSIGNED_BYTE,water.alpha);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
          this.waterMasks.set(texture,{texture:mask,rect:[water.x,water.y,water.width],bytes:water.alpha.byteLength});
          textureBytes+=water.alpha.byteLength;
        }
        if (deferred) { patch.pendingTexture = texture; patch.pendingTextureBytes = textureBytes;patch.pendingTextureGutter=gutter; }
        else {
          if (patch.texture) this.releaseMaterial(patch.texture);
          patch.texture = texture; patch.textureBytes = textureBytes; patch.textureFadeStart = 0; patch.textureProgress = 0;
          patch.textureGutter=gutter;
        }
        patch.status = 'ready';
        if (patch.hasHeight && patch.texture) patch.coherentReady = true;
        if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) source.close();
      }).catch(error => {
        if (epoch !== this.epoch || this.disposed) return;
        if ((error as { name?: string })?.name === 'AbortError') { patch.status = 'idle'; return; }
        patch.status = 'failed'; console.warn(`Terrain 3D tile ${patch.tile.key}:`, error);
      }).finally(() => {
        this.jobs.delete(job);
        // A new frame selects the current view before requesting more work.
        // In particular, a cancelled generation must not spin a promise loop.
        if (!this.disposed) this.request();
      });
    }
  }
  private closestTexture(patch: Patch): { texture: WebGLTexture; rect: [number, number, number, number]; texel: number; ready: boolean } {
    const tile = patch.tile, layer = this.layer!;
    let [level, ix, iy] = tile.key.split('/').map(Number);
    while (level >= 0) {
      const parent = this.patches.get(`${level}/${ix}/${iy}`);
      if (parent?.texture) {
        parent.used = this.clock; this.protected.add(parent.tile.key);
        const width = parent.tile.width;
        return { texture: parent.texture, rect: [(tile.x - parent.tile.x) / width, (tile.y - parent.tile.y) / width, tile.width / width, tile.width / width], texel: width / TILE_PIXELS, ready: parent === patch };
      }
      --level; ix = Math.floor(ix / 2); iy = Math.floor(iy / 2);
    }
    return { texture: this.material, rect: [(tile.x - layer.x) / layer.width, (tile.y - layer.y) / layer.width, tile.width / layer.width, tile.width / layer.width], texel: layer.width / this.fallbackPixels, ready: !this.tileLoader || tile.level === 0 };
  }
  private covered(node: Node): boolean {
    return !node.visible || !!node.patch.vao && (!this.requireHeights || node.patch.tile.level === 0 || node.patch.hasHeight && node.patch.coherentReady)
      || !!node.children?.length && node.children.every(child => this.covered(child));
  }
  private protectMaterial(ref: MaterialRef): void {
    if (!ref.tile) return;
    const owner = this.patches.get(ref.tile.key);
    if (owner?.texture === ref.texture) { this.protected.add(ref.tile.key); owner.used = this.clock; }
  }
  private materialFor(patch: Patch, geometryBlend = 1, depth = 0): PatchMaterial {
    if (patch.materialParent) {
      const ref = patch.materialParent;
      const retained = ref.tile ? this.patches.get(ref.tile.key)?.texture === ref.texture : this.material === ref.texture;
      // A completed, no-longer-drawn branch may outlive an ancestor's cached
      // material. It must never bind that deleted texture when merging later.
      if (!retained) patch.materialParent = undefined;
    }
    const own: MaterialRef | undefined = patch.texture ? { texture: patch.texture, tile: patch.tile, pixels: TILE_PIXELS,gutter:patch.textureGutter } : undefined;
    const progress = patch.textureProgress;
    if (own && progress >= 1 && geometryBlend >= 1) {
      patch.materialParent = undefined; this.protectMaterial(own);
      return { from: own, to: own, blend: 1, ready: true };
    }
    let fallback: PatchMaterial;
    if (patch.materialParent) {
      const ref = patch.materialParent; this.protectMaterial(ref); fallback = { from: ref, to: ref, blend: 1, ready: true };
    } else {
      const [level, x, y] = patch.tile.key.split('/').map(Number);
      let parent: Patch | undefined, ix = x, iy = y;
      for (let l = level - 1; l >= 0; l--) {
        ix = Math.floor(ix / 2); iy = Math.floor(iy / 2);
        const candidate = this.patches.get(`${l}/${ix}/${iy}`);
        if (candidate?.texture) { parent = candidate; break; }
      }
      if (parent && depth < 32) fallback = this.materialFor(parent, 1, depth + 1);
      else {
        const base = { texture: this.material, pixels: this.fallbackPixels,gutter:this.fallbackGutter };
        fallback = { from: base, to: base, blend: 1, ready: !this.tileLoader || level === 0 };
      }
    }
    if (!own || fallback.blend < 1) return fallback;
    if (!patch.textureFadeStart) { patch.textureFadeStart = this.now; patch.textureUpdated = this.now; }
    patch.materialParent ??= fallback.to;
    const t = patch.textureProgress = Math.min(1, patch.textureProgress + Math.min(50, Math.max(0, this.now - patch.textureUpdated)) / TEXTURE_FADE_MS);
    patch.textureUpdated = this.now;
    const blend = t * t * (3 - 2 * t) * geometryBlend;
    if (t < 1) this.animating = true;
    this.protectMaterial(own); this.protectMaterial(patch.materialParent);
    return { from: patch.materialParent, to: own, blend, ready: true };
  }
  private textureRect(ref: MaterialRef, tile: Terrain3dTile): [number, number, number, number] {
    const source = ref.tile ?? this.layer!, pixels = ref.pixels,gutter=1+(ref.gutter??0),total=pixels+2*gutter;
    const x = (tile.x - source.x) / source.width, y = (tile.y - source.y) / source.width, size = tile.width / source.width;
    return [(gutter+x*pixels)/total,(gutter+y*pixels)/total,size*pixels/total,size*pixels/total];
  }
  private advanceMorphs(node: Node, incomingFull = true): void {
    if (!node.visible) { node.blend = 0; node.children = undefined; node.updated = this.now; node.moving = false; return; }
    const replacingHeights = node.children?.some(child => !!child.patch.pendingHeights);
    const allowed = incomingFull && node.wantsSplit && !replacingHeights;
    // Opening children must start on the exact parent surface shown in the
    // preceding frame, including its joined boundary. Refresh only while they
    // are still hidden; changing their parent endpoint mid-morph would pop.
    if (allowed && node.blend === 0 && node.patch.seamSnapshot) {
      for (const child of node.children ?? []) if (child.patch.vao && child.patch.parentSeam !== node.patch.seamSnapshot) {
        this.gl.deleteVertexArray(child.patch.vao); this.gl.deleteBuffer(child.patch.vertices!);
        this.buildMesh(child.patch);
      }
    }
    for (const child of node.children ?? []) {
      if (!allowed) child.wantsSplit = false;
      this.advanceMorphs(child, allowed && node.blend >= 1 && child.birth >= 1);
    }
    const childrenReady = !!node.children?.length && node.children.every(child => this.covered(child));
    const raw = clamp((node.error - 2.15) / (3.6 - 2.15), 0, 1);
    let target = allowed && childrenReady && !replacingHeights ? raw * raw * (3 - 2 * raw) : 0;
    const descendantsOpen = node.children?.some(child => child.blend > 0);
    if (target < node.blend && (descendantsOpen || !node.patch.vao || this.materialFor(node.patch).blend < 1)) target = node.blend;
    if (childrenReady && !node.ready) { node.ready = true; node.updated = this.now; }
    let dt = this.now - node.updated;
    if (dt > 100 && !node.moving) dt = 0;
    node.updated = this.now;
    const delta = Math.min(50, Math.max(0, dt)) / MORPH_MS;
    if (Math.abs(target - node.blend) <= .001) { node.blend = target; node.moving = false; }
    else {
      node.blend += clamp(target - node.blend, -delta, delta); node.moving = true; this.animating = true;
    }
    if (node.blend === 0 && replacingHeights && !descendantsOpen) {
      for (const child of node.children ?? []) if (child.patch.pendingHeights) this.installHeights(child.patch, child.patch.pendingHeights);
      node.ready = false; node.updated = this.now; this.animating = true;
    }
    if (node.children && !node.wantsSplit && node.blend === 0 && !descendantsOpen) node.children = undefined;
    if (node.children && node.blend < 1) this.protected.add(node.patch.tile.key);
  }
  private collectPieces(node: Node, pieces: RenderPiece[], incomingMorph = 1, ancestor?: { patch: Patch; morph: number }): void {
    if (!node.visible) return;
    if (node.patch.vao && incomingMorph > 0 && node.birth < 1) {
      if (!node.birthUpdated) node.birthUpdated = this.now;
      node.birth = Math.min(1, node.birth + Math.min(50, this.now - node.birthUpdated) / MORPH_MS);
      node.birthUpdated = this.now; this.animating ||= node.birth < 1;
    }
    const morph = incomingMorph * node.birth;
    const fallback = node.patch.vao ? { patch: node.patch, morph } : ancestor;
    if (node.children?.length && node.blend > 0) {
      // A new visible quadrant may still be loading. Keep all ready siblings
      // and clip the nearest coarse mesh to that quadrant alone; falling back
      // the entire ancestor for one missing child is a one-frame global pop.
      node.children.forEach(child => this.collectPieces(child, pieces, node.blend, fallback)); return;
    }
    const selected = node.patch.vao ? { patch: node.patch, morph } : fallback;
    if (!selected?.patch.field) return;
    const { patch, morph: amount } = selected, tile = patch.tile, field = patch.field!;
    pieces.push({ ...tile, patch, morph: amount, clip: node.patch.tile, cells: GRID,
      key: `${tile.key}:${node.patch.tile.key}`, vertex: (x, y) => {
        const at = (y * (GRID + 1) + x) * 6;
        return [patch.heightOrigin + field[at + 3] + (field[at] - field[at + 3]) * amount,
          field[at + 4] + (field[at + 1] - field[at + 4]) * amount,
          field[at + 5] + (field[at + 2] - field[at + 5]) * amount];
      } });
  }
  private renderPatch(patch: Patch, frame: FrameGeometry, drawn: Patch[], incomingMorph: number, clip: Terrain3dTile, stitched: TerrainStitchedPiece): void {
    if (!patch.vao) return;
    const gl = this.gl, material = this.materialFor(patch, incomingMorph), c = this.camera;
    this.protected.add(patch.tile.key); patch.used = this.clock; drawn.push(patch);
    const tile = patch.tile;
    this.displayedGrids.push({ ...tile, clip, cells: GRID, height: (x, y) => {
      return stitched.vertex(x, y)[0] * c.exaggeration;
    } });
    gl.uniform3f(this.uniform('patchOffset'), patch.tile.x - c.x, patch.heightOrigin * c.exaggeration - frame.targetHeight, patch.tile.y - c.y);
    gl.uniform3f(this.uniform('physicalOrigin'),patch.tile.x,patch.heightOrigin,patch.tile.y);
    gl.uniform3f(this.uniform('patchRect'),patch.tile.x,patch.tile.y,patch.tile.width);
    gl.uniform1f(this.uniform('morph'), incomingMorph);
    gl.uniform4fv(this.uniform('textureRect'), this.textureRect(material.to, patch.tile));
    gl.uniform4fv(this.uniform('previousRect'), this.textureRect(material.from, patch.tile));
    gl.uniform1f(this.uniform('textureBlend'), material.blend);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, material.to.texture);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, material.from.texture);
    for(const [ref,prefix,unit] of [[material.to,'',6],[material.from,'previous',7]] as const){
      const mask=this.waterMasks.get(ref.texture),name=prefix?'previousCanopyWater':'canopyWater';
      gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,mask?.texture??this.empty);
      gl.uniform1i(this.uniform(name),unit);
      gl.uniform1i(this.uniform(prefix?'hasPreviousCanopyWater':'hasCanopyWater'),mask?1:0);
      gl.uniform3f(this.uniform(`${name}Rect`),mask?.rect[0]??0,mask?.rect[1]??0,mask?.rect[2]??1);
    }
    const side = GRID + 1, count = side * side, correction = new Float32Array((count + 4 * side) * 3);
    correction.set(stitched.correction);
    for (let edge = 0; edge < 4; edge++) for (let i = 0; i < side; i++) {
      const from = this.edgeVertex(edge, i) * 3;
      correction.set(correction.subarray(from, from + 3), (count + edge * side + i) * 3);
    }
    const geometry = this.rectangleIndices(tile, clip);
    gl.bindVertexArray(patch.vao); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.buffer); gl.bindBuffer(gl.ARRAY_BUFFER, this.seams); gl.bufferSubData(gl.ARRAY_BUFFER, 0, correction);
    gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 3, gl.FLOAT, false, 12, 0);
    gl.drawElements(gl.TRIANGLES, geometry.count, gl.UNSIGNED_SHORT, 0);
  }
  private releaseMaterial(texture: WebGLTexture): void {
    const mask=this.waterMasks.get(texture);
    if(mask){this.gl.deleteTexture(mask.texture);this.waterMasks.delete(texture);}
    this.gl.deleteTexture(texture);
  }
  private releasePatch(patch: Patch, preserveMesh = false): void {
    if (!preserveMesh && patch.vao) this.gl.deleteVertexArray(patch.vao);
    if (!preserveMesh && patch.vertices) this.gl.deleteBuffer(patch.vertices);
    if (patch.texture) this.releaseMaterial(patch.texture);
    if (patch.pendingTexture) this.releaseMaterial(patch.pendingTexture);
  }
  private trim(): void {
    let bytes = 0;
    for (const patch of this.patches.values()) bytes += patch.textureBytes + patch.pendingTextureBytes + patch.meshBytes;
    const current = new Set<string>(), retain = (node: Node): void => { current.add(node.patch.tile.key); node.children?.forEach(retain); };
    if (this.root) retain(this.root);
    const old = [...this.patches.values()].filter(patch => !this.protected.has(patch.tile.key) && patch.status !== 'loading').sort((a, b) => a.used - b.used);
    for (const patch of old) {
      if (bytes <= CACHE_BYTES && this.patches.size <= MAX_CACHE) break;
      const keepMesh = current.has(patch.tile.key);
      bytes -= patch.textureBytes + patch.pendingTextureBytes + (keepMesh ? 0 : patch.meshBytes); this.releasePatch(patch, keepMesh);
      if (current.has(patch.tile.key)) {
        // Current ancestors remain available for an aligned, immediate parent
        // fallback. Their textures can still be evicted independently.
        patch.texture = undefined;
        patch.textureBytes = 0; patch.status = 'idle'; patch.textureFadeStart = 0; patch.textureProgress = 0; patch.materialParent = undefined;
        patch.pendingTexture = undefined; patch.pendingTextureBytes = 0;
      } else this.patches.delete(patch.tile.key);
    }
  }

  setTexture(source: TexImageSource): void {
    this.textureSource = source;
    const dimensions = source as { width?: number; naturalWidth?: number; videoWidth?: number };
    this.fallbackPixels = dimensions.videoWidth || dimensions.naturalWidth || dimensions.width || 1;
    if (this.gl.isContextLost()) return;
    this.gl.deleteTexture(this.material); this.material = this.uploadTexture(source); this.request();
  }
  setCamera(camera: Terrain3dCamera): void { this.camera = { ...camera }; this.limitCamera(); this.request(); }
  getCamera(): Terrain3dCamera { return { ...this.camera }; }
  /** Draw and read in the same task: no permanent drawing-buffer retention. */
  capture(): Promise<Blob> {
    if (!this.active || !this.layer || this.gl.isContextLost()) return Promise.reject(new Error('Ouvrez la vue 3D avant de la capturer.'));
    this.draw();
    return new Promise((resolve, reject) => this.canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Capture 3D indisponible.')), 'image/png'));
  }
  async captureIllustration(): Promise<{ image: Blob; depth: Blob; camera: Terrain3dCamera }> {
    if (!this.active || !this.layer || this.gl.isContextLost()) throw new Error('Ouvrez la vue 3D avant de la capturer.');
    this.draw();
    const camera = this.getCamera(), geometry = this.frameGeometry();
    camera.heightAboveTargetMetres = geometry.eye[1];
    camera.viewAngleDegrees = Math.atan2(geometry.eye[1], Math.hypot(geometry.eye[0], geometry.eye[2])) * 180 / Math.PI;
    // Map north is decreasing world y; yaw=0 puts the eye south of the target.
    camera.azimuthDegrees = ((-camera.yaw * 180 / Math.PI) % 360 + 360) % 360;
    camera.verticalFovDegrees = FOV * 180 / Math.PI;
    if (camera.exaggeration === 1) camera.altitudeMetres = geometry.targetHeight + geometry.eye[1];
    const far = Math.max(camera.distance * 4, this.layer.width * 2 + this.heightRange * camera.exaggeration * 2);
    const frame = captureWebGlFrame(this.gl, Math.max(.02, camera.distance * .0002), far);
    this.request();
    const encode = (canvas: HTMLCanvasElement): Promise<Blob> => new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Capture 3D indisponible.')), 'image/png'));
    const [image, depth] = await Promise.all([encode(frame.color), encode(frame.depth)]);
    return { image, depth, camera };
  }
  setActive(active: boolean): void {
    this.active = active;
    if (active) this.request();
    else { cancelAnimationFrame(this.frame); this.frame = 0; this.pointers.clear(); this.gesture = undefined; this.canvas.classList.remove('drag'); }
  }
  resize(width: number, height: number): void {
    this.width = Math.max(1, width); this.height = Math.max(1, height); this.limitCamera(); this.request();
  }
  fit(x?: number, y?: number, visibleWidth?: number): void {
    if (!this.layer) return;
    const layer = this.layer, span = visibleWidth ?? layer.width;
    this.camera = { ...this.camera, x: x ?? layer.x + layer.width / 2, y: y ?? layer.y + layer.width / 2,
      distance: Math.max(span, this.heightRange * this.camera.exaggeration) / (2 * Math.tan(FOV / 2)) * Math.max(1, this.height / this.width) * 1.18, yaw: 0, pitch: .88 };
    this.changed();
  }
  zoom(factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0) return;
    this.camera.distance /= factor; this.changed();
  }
  north(): void { this.camera.yaw = 0; this.changed(); }
  private dpr(): number { return Math.min(2, window.devicePixelRatio || 1); }
  private maxScale(): number { return this.groundSettings ? TERRAIN_GROUND_MAX_SCALE : TERRAIN_3D_MAX_SCALE; }
  private limitCamera(): void {
    const width = this.layer?.width ?? 1000, c = this.camera;
    c.x = clamp(Number.isFinite(c.x) ? c.x : width / 2, this.layer?.x ?? 0, (this.layer?.x ?? 0) + width);
    c.y = clamp(Number.isFinite(c.y) ? c.y : width / 2, this.layer?.y ?? 0, (this.layer?.y ?? 0) + width);
    const minimumDistance = this.height / (2 * Math.tan(FOV / 2) * this.maxScale());
    c.distance = clamp(Number.isFinite(c.distance) ? c.distance : width, minimumDistance, Math.max(width * 5, minimumDistance));
    c.pitch = clamp(Number.isFinite(c.pitch) ? c.pitch : .8, .14, 1.48);
    c.yaw = Number.isFinite(c.yaw) ? ((c.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI : 0;
    c.exaggeration = clamp(Number.isFinite(c.exaggeration) ? c.exaggeration : 1, 1, 5);
  }
  private changed(): void { this.limitCamera(); this.request(); this.onChange(); }
  private request(): void {
    if (!this.active || this.frame || this.disposed || this.gl.isContextLost()) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
  }
  private draw(): void {
    const gl = this.gl;
    if (!this.layer || !this.active || gl.isContextLost()) return;
    const dpr = this.dpr(), w = Math.max(1, Math.round(this.width * dpr)), h = Math.max(1, Math.round(this.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.now = performance.now(); this.animating = false;
    const frame = this.frameGeometry(); this.select(frame); const preparing = this.prepareMeshes(); this.loadTiles();
    if (this.root) this.advanceMorphs(this.root);
    gl.viewport(0, 0, w, h); gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.bindVertexArray(null);
    gl.useProgram(this.skyProgram); gl.uniform1f(this.uniform('height', this.skyProgram), h); gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.terrainProgram = this.useMapShader ? this.mapProgram! : this.groundShader(this.groundSettings);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.useProgram(this.terrainProgram);
    gl.uniformMatrix4fv(this.uniform('matrix'), false, frame.matrix);
    gl.uniform1f(this.uniform('exaggeration'), this.camera.exaggeration);
    gl.uniform3fv(this.uniform('eye'), frame.eye);
    gl.uniform1f(this.uniform('fogDistance'), Math.max(this.camera.distance * 2, 100));
    const settings=this.groundSettings;
    gl.uniform1i(this.uniform('groundEnabled'),settings?1:0);
    gl.uniform1i(this.uniform('showTileBounds'),this.tileBounds?1:0);
    if(settings){
      const lights=terrainLights(settings.lighting);
      gl.uniform1i(this.uniform('uRenderV2'),settings.renderV2??0);gl.uniform1i(this.uniform('uV2WaterVisible'),settings.waterVisible===false?0:1);gl.uniform4fv(this.uniform('uV2GlacierSources[0]'),renderV2GlacierSources(this.layer,settings.climate));gl.uniform1f(this.uniform('uV2Season'),settings.v2Season??.5);gl.uniform1i(this.uniform('uMaterialZone'),renderV2ZoneUniform(settings.climateZone));
      gl.uniform1ui(this.uniform('uMaterialSeed'),settings.seed>>>0);
      gl.uniform2f(this.uniform('uMaterialClimate'),settings.climate.temperature,settings.climate.precipitation);
      gl.uniform3f(this.uniform('groundEye'),this.camera.x+frame.eye[0],(frame.targetHeight+frame.eye[1])/this.camera.exaggeration,this.camera.y+frame.eye[2]);
      gl.uniform3f(this.uniform('groundLight'),lights.primary[0],lights.primary[2],lights.primary[1]);
      gl.uniform3f(this.uniform('groundLight2'),lights.secondary[0],lights.secondary[2],lights.secondary[1]);
      gl.uniform1f(this.uniform('groundStrength'),settings.lighting.enabled?settings.lighting.strength:0);
      gl.uniform3f(this.uniform('macroRect'),this.layer.x,this.layer.y,this.layer.width);
      gl.uniform1i(this.uniform('macroN'),this.layer.n);
      gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.macroTexture);
      gl.uniform1i(this.uniform('macroField'),2);
      if((settings.renderV2??0)>0&&this.shoreRing?.layer!==this.layer){
        if(this.shoreRing)gl.deleteTexture(this.shoreRing.texture);
        this.shoreRing={layer:this.layer,texture:shoreRingTexture(gl,shoreRingFor(this.layer))};
      }
      const ring=this.layer&&(settings.renderV2??0)>0?shoreRingFor(this.layer):undefined;
      gl.activeTexture(gl.TEXTURE10);gl.bindTexture(gl.TEXTURE_2D,this.shoreRing?.texture??this.empty);
      gl.uniform1i(this.uniform('uShoreRing'),10);gl.uniform3f(this.uniform('uShoreRingRect'),ring?.x??0,ring?.y??0,ring?.width??1);
      const contours=settings.contours;
      gl.uniform1i(this.uniform('groundContours'),contours?1:0);
      gl.uniform1f(this.uniform('groundContourStep'),contours?.step??1);
      gl.uniform1f(this.uniform('groundContourOpacity'),contours?.opacity??0);
      gl.uniform1f(this.uniform('groundFlatSlope'),contours?.flat ? .004 : .012);
      if(contours){const value=contours.color.replace('#','');gl.uniform3f(this.uniform('groundContourColor'),parseInt(value.slice(0,2),16)/255,parseInt(value.slice(2,4),16)/255,parseInt(value.slice(4,6),16)/255);}
    }
    // Textures 3 forest field, 4 occupation, 8 bank envelope.
    bindForest(gl, name => this.uniform(name), this.forest, this.occupation, this.empty, !!settings, 3, 4, 8, 9);
    bindForestBrushes(gl, name => this.uniform(name), !!settings?.forestBrushes, 5);
    gl.activeTexture(gl.TEXTURE0); gl.uniform1i(this.uniform('material'), 0);
    gl.uniform1i(this.uniform('previousMaterial'), 1);
    const drawn: Patch[] = [];
    this.displayedGrids = [];
    const pieces: RenderPiece[] = [];
    if (this.root) this.collectPieces(this.root, pieces);
    this.displayedPieces = stitchTerrainPieces(pieces, this.displayedPieces, this.now - this.stitchUpdated);
    this.stitchUpdated = this.now;
    this.animating ||= this.displayedPieces.some(piece => piece.releasing);
    for (const stitched of this.displayedPieces) {
      const source = stitched.source as RenderPiece, patch = source.patch;
      if (source.morph === 1 && source.clip === patch.tile) {
        const old = patch.seamSnapshot, next = stitched.correction;
        if (!old || next.some((value, i) => Math.abs(value - old[i]) > 1e-7)) patch.seamSnapshot = next;
      }
      this.renderPatch(patch, frame, drawn, source.morph, source.clip as Terrain3dTile, stitched);
    }
    gl.bindVertexArray(null);
    let finest = this.layer.width, texel = this.layer.width / this.fallbackPixels, ready = 0, level = 0;
    const buildingPreparing = this.buildings.draw({ matrix: frame.matrix, cameraX: this.camera.x, cameraY: this.camera.y, targetHeight: frame.targetHeight,
      exaggeration: this.camera.exaggeration, focal: frame.focal, distance: this.camera.distance });
    reportRenderStats({ buildings3d: this.buildings.lastDraw });
    for (const patch of drawn) {
      const material = this.closestTexture(patch);
      finest = Math.min(finest, patch.tile.width / GRID); texel = Math.min(texel, material.texel);
      level = Math.max(level, patch.tile.level); if (material.ready) ++ready;
    }
    this.lod = { tiles: drawn.length, ready, pending: this.jobs.size, level, metresPerTexel: texel, metresPerVertex: finest,
      maxScale: this.maxScale(), scale: frame.focal / this.camera.distance };
    this.trim();
    this.onRender?.();
    if (preparing || buildingPreparing || this.animating) this.request();
  }
  private pan(dx: number, dy: number): void {
    const c = this.camera, metres = 2 * c.distance * Math.tan(FOV / 2) / this.height;
    const vertical = dy * metres / Math.max(.25, Math.sin(c.pitch)), horizontal = dx * metres;
    c.x -= horizontal * Math.cos(c.yaw) + vertical * Math.sin(c.yaw);
    c.y += horizontal * Math.sin(c.yaw) - vertical * Math.cos(c.yaw);
  }
  private touchGesture(): { x: number; y: number; distance: number } | undefined {
    if (this.pointers.size !== 2) return undefined;
    const [a, b] = [...this.pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
  }
  private interactions(): void {
    const canvas = this.canvas, signal = this.events.signal;
    canvas.addEventListener('contextmenu', event => { if (this.active) event.preventDefault(); }, { signal });
    canvas.addEventListener('pointerdown', event => {
      if (!this.active || (event.button !== 0 && event.button !== 2)) return;
      event.preventDefault(); event.stopPropagation(); canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(event.pointerId); this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, orbit: event.button === 2 || event.shiftKey });
      this.gesture = this.touchGesture(); canvas.classList.add('drag');
    }, { signal });
    canvas.addEventListener('pointermove', event => {
      if (!this.active) return;
      const previous = this.pointers.get(event.pointerId); if (!previous) return;
      event.preventDefault(); event.stopPropagation();
      const dx = event.clientX - previous.x, dy = event.clientY - previous.y;
      this.pointers.set(event.pointerId, { ...previous, x: event.clientX, y: event.clientY });
      const gesture = this.touchGesture();
      if (gesture && this.gesture) {
        this.pan(gesture.x - this.gesture.x, gesture.y - this.gesture.y);
        if (gesture.distance > 0 && this.gesture.distance > 0) this.camera.distance *= this.gesture.distance / gesture.distance;
      } else if (this.pointers.size === 1) {
        if (previous.orbit || event.shiftKey) { this.camera.yaw -= dx * .006; this.camera.pitch += dy * .005; }
        else this.pan(dx, dy);
      }
      this.gesture = gesture; this.changed();
    }, { signal });
    const up = (event: PointerEvent): void => {
      this.pointers.delete(event.pointerId); this.gesture = this.touchGesture();
      if (!this.pointers.size) canvas.classList.remove('drag');
    };
    canvas.addEventListener('pointerup', up, { signal }); canvas.addEventListener('pointercancel', up, { signal }); canvas.addEventListener('lostpointercapture', up, { signal });
    canvas.addEventListener('wheel', event => {
      if (!this.active) return;
      event.preventDefault(); event.stopPropagation();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.height : 1);
      this.zoom(Math.exp(-clamp(delta, -1000, 1000) * .0015));
    }, { passive: false, signal });
    canvas.addEventListener('dblclick', event => {
      if (!this.active) return; event.preventDefault(); event.stopPropagation(); this.zoom(event.shiftKey ? .5 : 2);
    }, { signal });
    canvas.addEventListener('keydown', event => {
      if (!this.active || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (event.shiftKey) {
        if (event.key === 'ArrowLeft') this.camera.yaw -= .08;
        else if (event.key === 'ArrowRight') this.camera.yaw += .08;
        else if (event.key === 'ArrowUp') this.camera.pitch += .06;
        else this.camera.pitch -= .06;
      } else {
        this.pan(event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0,
          event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0);
      }
      this.changed();
    }, { signal });
  }

  dispose(): void {
    this.disposed = true; this.active = false; cancelAnimationFrame(this.frame); this.events.abort(); this.clearPatches();
    const gl = this.gl;
    this.buildings.dispose(); this.buildingScene = undefined;
    this.buildingGround = new UrbanBuildingGround(); this.mergedOccupation = this.mergedOccupationSource = undefined; this.mergedOccupationScene = undefined;
    gl.deleteBuffer(this.indices); gl.deleteBuffer(this.seams); gl.deleteTexture(this.material);gl.deleteTexture(this.macroTexture); gl.deleteTexture(this.empty);if(this.shoreRing)gl.deleteTexture(this.shoreRing.texture);
    if (this.mapProgram) gl.deleteProgram(this.mapProgram); this.groundVariants.reset(true); gl.deleteProgram(this.skyProgram);
    for (const geometry of this.clippedIndices.values()) gl.deleteBuffer(geometry.buffer);
    this.clippedIndices.clear();
    deleteForestTextures(gl, this.forest);
    if (this.occupation) gl.deleteTexture(this.occupation.texture);
    this.forest = this.occupation = this.forestField = this.forestOccupation = undefined;
    disposeForestBrushes(gl);
    this.textureSource = undefined; this.layer = undefined; this.water = undefined; this.heightSampler = undefined; this.tileLoader = undefined; this.pointers.clear();
  }
}
