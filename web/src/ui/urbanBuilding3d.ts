import type { UrbanBuildingAppearance } from '../render/urbanBuildingStyle';
import { isBuildingProjection, isYardMesh, yardLod, buildingRayDistance, eachBuildingTriangle, type BuildingVector, type Building3dVisual, type Building3dScene } from '../render/urbanBuildingGeometry';
import { loadMaterialImages, uploadMaterialArrays, MATERIALS, type MaterialImages } from '../render/buildingMaterials';
import { buildingFeatureLod, buildingFeatureMetresPerPixel, hasBuildingFeatureLod, sameBuildingFeatureLod, type BuildingFeatureLod } from '../render/urbanBuildingFeatureLod';
import { roofSeasonKey } from '../render/seasonPalette';
import { townRoofAltitudes } from '../render/roofSnow';
import { buildingBatches, buildingBounds, type BuildingBounds, type Vec3 } from '../render/world/buildingsMesh';
import { BUILDING_GRAIN_GLSL, BUILDING_NIGHT_GLSL } from '../render/world/buildingsShader';

type Bounds = BuildingBounds;
export interface BuildingFrame {
  matrix: Float32Array;
  cameraX: number;
  cameraY: number;
  targetHeight: number;
  exaggeration: number;
  focal: number;
  distance: number;
  /** Underdark 3D (render/underdarkCavern.ts): the town lantern light level, the cave fog start and end (m), and the eye (x, y, height above the ground). */
  cave?: { light: number; fog: [number, number]; eye: [number, number, number] };
}
/** `stride`: floats per vertex, 10: position, normal, uv in tiles + material layer (textured) or colour, then the
 * vertex's ground: the display exaggeration lifts a building's base with the relief, never its own height. */
export interface Batch {
  color: Vec3;
  tint: Vec3;
  recolored: boolean;
  values: number[];
  buffer?: WebGLBuffer;
  vao?: WebGLVertexArrayObject;
  /** Snow overlays need their own depth bias in both backends. */ snow?: boolean;
  /** WebGPU backend's vertex buffer. */ gpu?: GPUBuffer;
  count: number;
  stride: number;
  /** Untextured batches carry the colour per vertex (one batch, one draw per sector). */ vcolor?: boolean;
  /** Distinct vertex colours of a vcolor batch (inspection). */ palette?: Vec3[];
}
interface Entry {
  building: Building3dVisual;
  bounds: Bounds;
}
/** `yard`: lot boundaries only, in a sector of their own: they change level far earlier than buildings and for a fraction of the cost. */
export interface Sector {
  origin: [number, number];
  entries: Entry[];
  bounds: Bounds;
  width: number;
  featureLodEligible: boolean;
  overview: boolean;
  shown: boolean;
  yard?: boolean;
  cached?: { overview: boolean; featureLod?: BuildingFeatureLod; yardLevel?: number; batches: Batch[]; used: number };
}
const SECTOR = 256,
  MAX_CACHE_BYTES = 96 * 1024 * 1024;
const vertexColor = `#version 300 es
precision highp float;
layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
layout(location=2) in vec3 albedo;
uniform mat4 matrix;
uniform vec3 offset;
uniform float exaggeration;
uniform vec2 sectorOrigin;
layout(location=4) in float groundIn;
out vec3 n; out vec3 base; out vec3 facadePosition; out vec3 grainPosition; flat out float materialClass;
void main(){float k=position.y>groundIn+.01?1.:exaggeration;n=normalize(vec3(normal.x,normal.y/k,normal.z));base=albedo;facadePosition=vec3(position.x+sectorOrigin.x,groundIn<1e10?position.y-groundIn:-10000.,position.z+sectorOrigin.y);
  // The normal's length carries the material class (1 + class / 32); sector-local metres keep the grain's hashes exact.
  materialClass=floor((length(normal)-1.)*32.+.5);grainPosition=vec3(position.x,groundIn<1e10?position.y-groundIn:position.y,position.z);
  gl_Position=matrix*vec4(vec3(position.x,position.y+groundIn*(exaggeration-1.),position.z)+offset,1.);}`;
const fragmentColor = `#version 300 es
precision highp float;
in vec3 n; in vec3 base; in vec3 facadePosition; in vec3 grainPosition; flat in float materialClass;
out vec4 color;
${BUILDING_NIGHT_GLSL}
${BUILDING_GRAIN_GLSL}
void main(){vec3 N=normalize(n);float fp=length(fwidth(grainPosition));
  // Class 32 marks a lit window (no grain of its own).
  bool lit=materialClass>31.5;float cls=lit?0.:materialClass;
  float light=buildingLight(N);color=vec4(buildingCave(buildingNight(materialGrain(base,cls,N,grainPosition,fp)*light*baseOcclusion(n,facadePosition),facadePosition,lit),facadePosition,lit,N),1.);}`;

/** Textured variant: per-vertex uv (metres on the face: walls along the face and down, roofs along the ridge and down
 * the slope) and material layer; albedo + normal map arrays; same lighting model. Layer < 0 keeps the flat colour. */
const texVertex = `#version 300 es
precision highp float;
layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
layout(location=2) in vec2 uvIn;
layout(location=3) in float layerIn;
uniform mat4 matrix;
uniform vec3 offset;
uniform float exaggeration;
uniform vec2 sectorOrigin;
layout(location=4) in float groundIn;
out vec3 n; out vec3 wp; out vec2 uv; flat out float layer; out vec3 facadePosition; flat out float litWindow;
void main(){float k=position.y>groundIn+.01?1.:exaggeration;n=normalize(vec3(normal.x,normal.y/k,normal.z));litWindow=length(normal)>1.5?1.:0.;vec3 p=vec3(position.x,position.y+groundIn*(exaggeration-1.),position.z)+offset;wp=p;uv=uvIn;layer=layerIn;facadePosition=vec3(position.x+sectorOrigin.x,groundIn<1e10?position.y-groundIn:-10000.,position.z+sectorOrigin.y);gl_Position=matrix*vec4(p,1.);}`;
const texFragment = `#version 300 es
precision highp float;
in vec3 n; in vec3 wp; in vec2 uv; flat in float layer; in vec3 facadePosition; flat in float litWindow;
uniform vec3 material;
uniform vec3 tint;
uniform int recolored;
uniform int useTex;
uniform float softFrom;
uniform highp sampler2DArray albedoTex;
uniform highp sampler2DArray normalTex;
out vec4 color;
${BUILDING_NIGHT_GLSL}
void main(){
  vec3 N=normalize(n), dp1=dFdx(wp), dp2=dFdy(wp);
  if(dot(N,normalize(cross(dp1,dp2)))<0.) N=-N;
  vec2 duv1=dFdx(uv), duv2=dFdy(uv);
  float l=max(layer,0.);
  vec3 albedo=texture(albedoTex,vec3(uv,l)).rgb, tn=texture(normalTex,vec3(uv,l)).xyz*2.-1.;
  if(useTex==2&&layer>=0.){
    // Natural: a second sample, rotated and rescaled, fades in over the first so the tile never repeats on a grid;
    // roads and places (layers from softFrom) keep half their contrast; the mip mean takes over with distance.
    vec2 uv2=vec2(uv.x*.8660254-uv.y*.5,uv.x*.5+uv.y*.8660254)*1.37+vec2(.37,.61);
    float w=.5+.5*sin(dot(uv,vec2(.9,.55)))*sin(dot(uv,vec2(-.52,.95))+1.7);
    vec3 a2=texture(albedoTex,vec3(uv2,l)).rgb, n2=texture(normalTex,vec3(uv2,l)).xyz*2.-1.;
    n2.xy=vec2(.8660254*n2.x+.5*n2.y,-.5*n2.x+.8660254*n2.y);
    float soft=layer>=softFrom?.5:.85;
    albedo=mix(textureLod(albedoTex,vec3(uv,l),8.).rgb,mix(albedo,a2,w),soft);
    tn=normalize(vec3(mix(tn.xy,n2.xy,w)*soft,mix(tn.z,n2.z,w)));
  }
  vec3 base=material;
  if(useTex>=1&&layer>=0.){
    vec3 dp2perp=cross(dp2,N), dp1perp=cross(N,dp1);
    vec3 T=dp2perp*duv1.x+dp1perp*duv2.x, B=dp2perp*duv1.y+dp1perp*duv2.y;
    float invmax=inversesqrt(max(max(dot(T,T),dot(B,B)),1e-20));
    base=recolored==1?clamp(mix(material,albedo*tint,.65),0.,1.):albedo*tint;
    N=normalize(mat3(T*invmax,-B*invmax,N)*normalize(tn));
  }
  float light=buildingLight(N);color=vec4(buildingCave(buildingNight(base*light*baseOcclusion(n,facadePosition),facadePosition,litWindow>.5),facadePosition,litWindow>.5,N),1.);
}`;
/** First material layer that keeps half its contrast in the natural texture mode (roads, places; not the stone wall layer). */
export const SOFT_LAYER_FROM = Math.min(
  ...Object.entries(MATERIALS.road)
    .filter(([k]) => k !== 'wall')
    .map(([, v]) => v),
);
/** GLSL sources translated to WGSL for the WebGPU backend (web/scripts/wgsl_shaders_3d.ts). */
export const BUILDING_3D_GLSL = { colorVertex: vertexColor, colorFragment: fragmentColor, texVertex, texFragment };
function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [kind, source] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const shader = gl.createShader(kind)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const reason = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      gl.deleteProgram(p);
      throw new Error(`Bâtiments 3D : ${reason}`);
    }
    gl.attachShader(p, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const reason = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(`Bâtiments 3D : ${reason}`);
  }
  return p;
}
function rayBox(origin: Vec3, direction: Vec3, box: Bounds, maximum: number): boolean {
  let near = 0,
    far = maximum;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(direction[i]) < 1e-12) {
      if (origin[i] < box[i] || origin[i] > box[i + 3]) return false;
      continue;
    }
    const a = (box[i] - origin[i]) / direction[i],
      b = (box[i + 3] - origin[i]) / direction[i];
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
    if (far < near) return false;
  }
  return true;
}

/** Native instances, with lazy material/sector buffers and a roof overview LOD.
 * Off-screen sectors require no roof traversal or GPU buffers. Plan (x,y),
 * altitude z become GL (x,z,y), before display exaggeration. */
/** `uCave` of the building shaders: off, or on with the lantern light level and the fog range (m). */
export const caveUniform = (frame: BuildingFrame, lightsOn = true): [number, number, number, number] => (frame.cave ? [lightsOn ? 1 : 2, lightsOn ? frame.cave.light : 0.08, frame.cave.fog[0], frame.cave.fog[1]] : [0, 1, 1e9, 2e9]);
export class UrbanBuildingPass {
  protected night = false;
  protected lightsOn = false;
  protected sectors: Sector[] = [];
  private colorProgram?: WebGLProgram;
  /** Draw calls and sectors of the last draw (render stats). */
  lastDraw = { drawCalls: 0, sectors: 0, triangles: 0 };
  private texProgram?: WebGLProgram;
  private textures?: { albedo: WebGLTexture; normal: WebGLTexture };
  protected texturesRequested = false;
  private source?: Building3dScene;
  private appearance: UrbanBuildingAppearance = { style: 'cartographic', diagnostic: 'none' };
  private appearanceKey = '';
  private snowAltitudes = new Map<string, number>();
  private tick = 0;
  /** Building id → its sector, for targeted replacements. */
  private index = new Map<string, Sector>();
  /** `onTexturesReady`: asks the host for a frame once the material atlases are on the GPU. */
  /** `gl` is undefined for the WebGPU backend (terrain3dGpu.ts), which overrides the GPU hooks. */
  constructor(
    private gl: WebGL2RenderingContext | undefined,
    protected onTexturesReady?: () => void,
  ) {}

  setScene(scene: Building3dScene | undefined, appearance: UrbanBuildingAppearance): void {
    this.night = appearance.ambience === 'night';
    this.lightsOn = appearance.lightsOn ?? this.night;
    appearance = { ...appearance, ambience: undefined, lightsOn: undefined };
    const key = JSON.stringify(appearance) + roofSeasonKey();
    if (this.source === scene && this.appearanceKey === key) return;
    this.clear();
    this.source = scene;
    this.appearance = { ...appearance };
    this.appearanceKey = key;
    this.snowAltitudes = townRoofAltitudes(scene?.buildings ?? []);
    const sectors = new Map<string, Sector>();
    for (const building of scene?.buildings ?? []) {
      const box = buildingBounds(building);
      const p = isBuildingProjection(building) ? { x: (box[0] + box[3]) / 2, y: (box[1] + box[4]) / 2 } : building.transform.origin;
      const yard = isYardMesh(building),
        origin: [number, number] = [Math.floor(p.x / SECTOR) * SECTOR, Math.floor(p.y / SECTOR) * SECTOR],
        key = `${origin}${yard ? '/yard' : ''}`;
      let sector = sectors.get(key);
      if (!sector) {
        sector = { origin, entries: [], bounds: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], width: 0, featureLodEligible: false, overview: false, shown: false, yard };
        sectors.set(key, sector);
      }
      sector.entries.push({ building, bounds: box });
      sector.featureLodEligible ||= !isBuildingProjection(building) && hasBuildingFeatureLod(building.structural_features);
      sector.width += yard ? 1 : Math.max(1, Math.min(box[3] - box[0], box[4] - box[1])); // a yard sector's `pixels` are pixels per metre
      for (let i = 0; i < 3; i++) {
        sector.bounds[i] = Math.min(sector.bounds[i], box[i]);
        sector.bounds[i + 3] = Math.max(sector.bounds[i + 3], box[i + 3]);
      }
    }
    this.sectors = [...sectors.values()];
    for (const sector of this.sectors) sector.width /= sector.entries.length;
    this.index = new Map(this.sectors.flatMap(sector => sector.entries.map(e => [e.building.id, sector] as const)));
  }
  /** Replace a few buildings of the current scene in place (native exteriors
   * swapped for compact plans and back): only the touched sectors recompute
   * their bounds and drop their GPU cache; the others keep their buffers.
   * Returns the ids it could not place (not in the scene). */
  replaceBuildings(changes: readonly Building3dVisual[]): string[] {
    const touched = new Set<Sector>(),
      missing: string[] = [];
    for (const building of changes) {
      const sector = this.index.get(building.id),
        entry = sector?.entries.find(e => e.building.id === building.id);
      if (!sector || !entry) {
        missing.push(building.id);
        continue;
      }
      entry.building = building;
      entry.bounds = buildingBounds(building);
      touched.add(sector);
    }
    for (const sector of touched) {
      sector.bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      sector.width = 0;
      sector.featureLodEligible = false;
      for (const { building, bounds: box } of sector.entries) {
        sector.featureLodEligible ||= !isBuildingProjection(building) && hasBuildingFeatureLod(building.structural_features);
        sector.width += Math.max(1, Math.min(box[3] - box[0], box[4] - box[1]));
        for (let i = 0; i < 3; i++) {
          sector.bounds[i] = Math.min(sector.bounds[i], box[i]);
          sector.bounds[i + 3] = Math.max(sector.bounds[i + 3], box[i + 3]);
        }
      }
      sector.width /= sector.entries.length;
      this.release(sector);
    }
    return missing;
  }
  /** The buildings replaceBuildings put in place of the scene's own (to replay them on another pass). */
  replacedBuildings(): Building3dVisual[] {
    const original = new Map(this.source?.buildings.map(b => [b.id, b]));
    return this.sectors.flatMap(sector => sector.entries.filter(e => e.building !== original.get(e.building.id)).map(e => e.building));
  }
  private prepare(sector: Sector, overview: boolean, featureLod?: BuildingFeatureLod, yardLevel?: number): void {
    this.release(sector);
    const paint = { appearance: this.appearance, materials: this.source?.materials ?? [], snowAltitudes: this.snowAltitudes };
    const batches: Batch[] = [];
    for (const built of buildingBatches(
      sector.entries.map(e => e.building),
      sector.origin,
      paint,
      overview,
      featureLod,
      yardLevel,
    )) {
      const batch: Batch = { color: built.color, tint: built.tint, recolored: built.recolored, values: [], count: 0, stride: built.stride, vcolor: built.vcolor, palette: built.palette };
      this.upload(batch, built.data);
      batch.count = built.data.length / batch.stride;
      batches.push(batch);
    }
    batches.sort((a, b) => Number(a.snow) - Number(b.snow));
    sector.cached = { overview, featureLod, yardLevel, batches, used: this.tick };
  }
  /** Vertex buffer of a batch (10 floats per vertex). */
  protected upload(batch: Batch, values: Float32Array): void {
    const gl = this.gl!;
    batch.vao = gl.createVertexArray()!;
    batch.buffer = gl.createBuffer()!;
    gl.bindVertexArray(batch.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, batch.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, values, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, batch.stride * 4, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, batch.stride * 4, 12);
    if (batch.vcolor) {
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 40, 24);
    } else {
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 40, 24);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 40, 32);
    }
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 40, 36);
    gl.bindVertexArray(null);
  }
  /** Material atlases on the GPU (textured appearance). */
  protected uploadTextures(images: MaterialImages): void {
    this.textures = uploadMaterialArrays(this.gl!, images, false);
  }
  draw(frame: BuildingFrame): boolean {
    const started = performance.now();
    let pending = false,
      prepared = 0;
    if (!this.sectors.length) return false;
    ++this.tick;
    // Textured materials: the atlases load once (the flat colours show until they arrive).
    const wantTex = !!this.appearance.textured;
    if (wantTex && !this.texturesRequested) {
      this.texturesRequested = true;
      loadMaterialImages().then(
        images => {
          if (!this.sectors.length) return;
          this.uploadTextures(images);
          this.onTexturesReady?.();
        },
        e => {
          this.texturesRequested = false;
          console.warn('Matières texturées indisponibles', e);
        },
      );
    }
    const stats = { drawCalls: 0, sectors: 0, triangles: 0 },
      shown: Sector[] = [];
    for (const sector of this.sectors) {
      sector.shown = false;
      const b = sector.bounds,
        point = [(b[0] + b[3]) / 2 - frame.cameraX, ((b[2] + b[5]) / 2) * frame.exaggeration - frame.targetHeight, (b[1] + b[4]) / 2 - frame.cameraY];
      const radius = Math.hypot(b[3] - b[0], (b[5] - b[2]) * frame.exaggeration, b[4] - b[1]) / 2;
      const m = frame.matrix,
        depth = m[3] * point[0] + m[7] * point[1] + m[11] * point[2] + m[15];
      if (depth > radius && (radius * frame.focal) / depth < 0.35) continue;
      let outside = false;
      for (const axis of [0, 1, 2])
        for (const sign of [-1, 1]) {
          const plane = [m[3] + sign * m[axis], m[7] + sign * m[4 + axis], m[11] + sign * m[8 + axis], m[15] + sign * m[12 + axis]];
          if (plane[0] * point[0] + plane[1] * point[1] + plane[2] * point[2] + plane[3] < -radius * Math.hypot(plane[0], plane[1], plane[2])) outside = true;
        }
      if (outside) continue;
      const pixels = (sector.width * frame.focal) / Math.max(1, depth - radius),
        yardLevel = sector.yard ? yardLod(pixels, sector.cached?.yardLevel) : undefined;
      const overview = yardLevel !== undefined ? yardLevel > 0 : sector.cached?.overview ? pixels < 10 : pixels < 7;
      const featureMpp = overview && sector.featureLodEligible ? buildingFeatureMetresPerPixel(m, point, radius, frame.focal) : undefined;
      const featureLod = featureMpp === undefined ? undefined : buildingFeatureLod(featureMpp, frame.exaggeration, sector.cached?.featureLod);
      if (!sector.cached || sector.cached.overview !== overview || sector.cached.yardLevel !== yardLevel || !sameBuildingFeatureLod(sector.cached.featureLod, featureLod)) {
        if (prepared && performance.now() - started > 8) {
          pending = true;
          if (!sector.cached) continue;
        } else {
          this.prepare(sector, overview, featureLod, yardLevel);
          ++prepared;
        }
      }
      sector.shown = true;
      sector.overview = sector.cached!.overview;
      sector.cached!.used = this.tick;
      for (const batch of sector.cached!.batches) {
        stats.drawCalls++;
        stats.triangles += batch.count / 3;
      }
      stats.sectors++;
      shown.push(sector);
    }
    this.render(frame, shown, wantTex);
    this.lastDraw = stats;
    let bytes = this.sectors.reduce((total, sector) => total + (sector.cached?.batches.reduce((n, batch) => n + batch.count * batch.stride * 4, 0) ?? 0), 0);
    if (bytes > MAX_CACHE_BYTES)
      for (const sector of this.sectors.filter(s => s.cached && !s.shown).sort((a, b) => a.cached!.used - b.cached!.used)) {
        bytes -= sector.cached!.batches.reduce((n, batch) => n + batch.count * batch.stride * 4, 0);
        this.release(sector);
        if (bytes <= MAX_CACHE_BYTES) break;
      }
    return pending;
  }
  /** Draws the batches of the shown sectors (flat or textured program). */
  protected render(frame: BuildingFrame, shown: readonly Sector[], textured: boolean): void {
    const gl = this.gl!;
    const texProgram = textured ? (this.texProgram ??= program(gl, texVertex, texFragment)) : undefined;
    const p = texProgram ?? (this.colorProgram ??= program(gl, vertexColor, fragmentColor));
    gl.useProgram(p);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    if (texProgram) {
      gl.uniform1i(gl.getUniformLocation(p, 'useTex'), this.textures ? 2 : 0);
      gl.uniform1f(gl.getUniformLocation(p, 'softFrom'), SOFT_LAYER_FROM);
      gl.uniform1i(gl.getUniformLocation(p, 'albedoTex'), 10);
      gl.uniform1i(gl.getUniformLocation(p, 'normalTex'), 11);
      gl.activeTexture(gl.TEXTURE0 + 10);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textures?.albedo ?? null);
      gl.activeTexture(gl.TEXTURE0 + 11);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textures?.normal ?? null);
      gl.activeTexture(gl.TEXTURE0);
    }
    gl.uniformMatrix4fv(gl.getUniformLocation(p, 'matrix'), false, frame.matrix);
    gl.uniform1f(gl.getUniformLocation(p, 'exaggeration'), frame.exaggeration);
    gl.uniform1i(gl.getUniformLocation(p, 'uNight'), frame.cave || !this.night ? 0 : this.lightsOn ? 1 : 2);
    gl.uniform4fv(gl.getUniformLocation(p, 'uCave'), caveUniform(frame, this.lightsOn));
    gl.uniform3fv(gl.getUniformLocation(p, 'uCaveEye'), frame.cave?.eye ?? [0, 0, 0]);
    for (const sector of shown) {
      gl.uniform3f(gl.getUniformLocation(p, 'offset'), sector.origin[0] - frame.cameraX, -frame.targetHeight, sector.origin[1] - frame.cameraY);
      gl.uniform2f(gl.getUniformLocation(p, 'sectorOrigin'), sector.origin[0], sector.origin[1]);
      for (const batch of sector.cached!.batches) {
        // Centimetres of physical separation are below depth precision in a
        // town-wide view. Bias only snow; never lift the roof or its walls.
        if (batch.snow) {
          gl.enable(gl.POLYGON_OFFSET_FILL);
          gl.polygonOffset(-1, -2);
        } else gl.disable(gl.POLYGON_OFFSET_FILL);
        if (texProgram) {
          gl.uniform3fv(gl.getUniformLocation(p, 'material'), batch.color);
          gl.uniform3fv(gl.getUniformLocation(p, 'tint'), batch.tint);
          gl.uniform1i(gl.getUniformLocation(p, 'recolored'), batch.recolored ? 1 : 0);
        }
        gl.bindVertexArray(batch.vao!);
        gl.drawArrays(gl.TRIANGLES, 0, batch.count);
      }
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindVertexArray(null);
  }
  pick(origin: BuildingVector, direction: BuildingVector): { id?: string; distance: number } {
    let distance = Infinity,
      id: string | undefined;
    for (const sector of this.sectors)
      if (sector.shown && rayBox(origin, direction, sector.bounds, distance))
        for (const entry of sector.entries) {
          if (!rayBox(origin, direction, entry.bounds, distance)) continue;
          eachBuildingTriangle(
            entry.building,
            face => {
              const hit = buildingRayDistance(origin, direction, face.points);
              if (hit !== null && hit < distance) {
                distance = hit;
                id = entry.building.id;
              }
            },
            sector.overview,
            sector.cached?.featureLod,
            sector.cached?.yardLevel,
          );
        }
    return { id, distance };
  }
  private release(sector: Sector): void {
    for (const batch of sector.cached?.batches ?? []) this.releaseBatch(batch);
    sector.cached = undefined;
  }
  protected releaseBatch(batch: Batch): void {
    this.gl!.deleteBuffer(batch.buffer!);
    this.gl!.deleteVertexArray(batch.vao!);
  }
  private clear(): void {
    for (const sector of this.sectors) this.release(sector);
    this.sectors = [];
    this.index.clear();
  }
  dispose(): void {
    this.clear();
    this.disposeBackend();
    this.source = undefined;
  }
  protected disposeBackend(): void {
    const gl = this.gl!;
    if (this.colorProgram) gl.deleteProgram(this.colorProgram);
    if (this.texProgram) gl.deleteProgram(this.texProgram);
    if (this.textures) {
      gl.deleteTexture(this.textures.albedo);
      gl.deleteTexture(this.textures.normal);
    }
  }
}
