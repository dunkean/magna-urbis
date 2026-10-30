import { buildingPaint, type UrbanBuildingAppearance } from '../render/urbanBuildingStyle';
import { building3dHeight, isBuildingProjection, buildingRayDistance, eachBuildingTriangle, type BuildingVector, type Building3dVisual, type Building3dScene } from '../render/urbanBuildingGeometry';
import { layerExtent, loadMaterialImages, uploadMaterialArrays, coverLayer, wallLayer, MATERIALS, type MaterialImages } from '../render/buildingMaterials';
import { buildingFeatureLod, buildingFeatureMetresPerPixel, hasBuildingFeatureLod, sameBuildingFeatureLod, type BuildingFeatureLod } from '../render/urbanBuildingFeatureLod';
import { buildingTint } from '../render/buildingPalette';

type Vec3 = [number, number, number];
type Bounds = [number, number, number, number, number, number];
export interface BuildingFrame { matrix: Float32Array; cameraX: number; cameraY: number; targetHeight: number; exaggeration: number; focal: number; distance: number }
/** `stride`: floats per vertex, 6 (position, normal) or 9 (+ uv in tiles, material layer) for textured materials. */
export interface Batch { color: Vec3; tint: Vec3; recolored: boolean; values: number[]; buffer?: WebGLBuffer; vao?: WebGLVertexArrayObject; /** WebGPU backend's vertex buffer. */ gpu?: GPUBuffer; count: number; stride: number; /** Untextured batches carry the colour per vertex (one batch, one draw per sector). */ vcolor?: boolean; /** Distinct vertex colours of a vcolor batch (inspection). */ palette?: Vec3[] }
interface Entry { building: Building3dVisual; bounds: Bounds }
export interface Sector { origin: [number, number]; entries: Entry[]; bounds: Bounds; width: number; featureLodEligible: boolean; overview: boolean; shown: boolean; cached?: { overview: boolean; featureLod?: BuildingFeatureLod; batches: Batch[]; used: number } }
const SECTOR = 256, MAX_CACHE_BYTES = 96 * 1024 * 1024;
const vertexColor = `#version 300 es
precision highp float;
layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
layout(location=2) in vec3 albedo;
uniform mat4 matrix;
uniform vec3 offset;
uniform float exaggeration;
out vec3 n; out vec3 base;
void main(){n=normalize(vec3(normal.x,normal.y/exaggeration,normal.z));base=albedo;gl_Position=matrix*vec4(vec3(position.x,position.y*exaggeration,position.z)+offset,1.);}`;
const fragmentColor = `#version 300 es
precision highp float;
in vec3 n; in vec3 base;
out vec4 color;
void main(){float light=.55+.45*abs(dot(normalize(n),normalize(vec3(-.4,.85,.3))));color=vec4(base*light,1.);}`;

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
out vec3 n; out vec3 wp; out vec2 uv; flat out float layer;
void main(){n=normalize(vec3(normal.x,normal.y/exaggeration,normal.z));vec3 p=vec3(position.x,position.y*exaggeration,position.z)+offset;wp=p;uv=uvIn;layer=layerIn;gl_Position=matrix*vec4(p,1.);}`;
const texFragment = `#version 300 es
precision highp float;
in vec3 n; in vec3 wp; in vec2 uv; flat in float layer;
uniform vec3 material;
uniform vec3 tint;
uniform int recolored;
uniform int useTex;
uniform highp sampler2DArray albedoTex;
uniform highp sampler2DArray normalTex;
out vec4 color;
void main(){
  vec3 N=normalize(n), dp1=dFdx(wp), dp2=dFdy(wp);
  if(dot(N,normalize(cross(dp1,dp2)))<0.) N=-N;
  vec2 duv1=dFdx(uv), duv2=dFdy(uv);
  float l=max(layer,0.);
  vec3 albedo=texture(albedoTex,vec3(uv,l)).rgb, tn=texture(normalTex,vec3(uv,l)).xyz*2.-1.;
  vec3 base=material;
  if(useTex==1&&layer>=0.){
    vec3 dp2perp=cross(dp2,N), dp1perp=cross(N,dp1);
    vec3 T=dp2perp*duv1.x+dp1perp*duv2.x, B=dp2perp*duv1.y+dp1perp*duv2.y;
    float invmax=inversesqrt(max(max(dot(T,T),dot(B,B)),1e-20));
    base=recolored==1?clamp(mix(material,albedo*tint,.65),0.,1.):albedo*tint;
    N=normalize(mat3(T*invmax,-B*invmax,N)*normalize(tn));
  }
  float light=.55+.45*abs(dot(N,normalize(vec3(-.4,.85,.3))));color=vec4(base*light,1.);
}`;
/** GLSL sources translated to WGSL for the WebGPU backend (web/scripts/wgsl_shaders_3d.ts). */
export const BUILDING_3D_GLSL = { colorVertex: vertexColor, colorFragment: fragmentColor, texVertex, texFragment };
function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [kind, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const shader = gl.createShader(kind)!; gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const reason = gl.getShaderInfoLog(shader); gl.deleteShader(shader); gl.deleteProgram(p); throw new Error(`Bâtiments 3D : ${reason}`); }
    gl.attachShader(p, shader); gl.deleteShader(shader);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { const reason = gl.getProgramInfoLog(p); gl.deleteProgram(p); throw new Error(`Bâtiments 3D : ${reason}`); }
  return p;
}
function rgb(color: string): Vec3 {
  if (color.startsWith('rgb')) return color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => v / 255) as Vec3;
  return [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255) as Vec3;
}
function bounds(building: Building3dVisual): Bounds {
  const box: Bounds = [Infinity, Infinity, building.ground_z_m, -Infinity, -Infinity, building.ground_z_m + building3dHeight(building)];
  const features = isBuildingProjection(building) ? [] : building.structural_features;
  for (const surface of [building.footprint, building.roof_footprint, ...features.map(f => f.surface)]) for (const shape of surface) for (const p of shape.outer) {
    box[0] = Math.min(box[0], p.x); box[1] = Math.min(box[1], p.y); box[3] = Math.max(box[3], p.x); box[4] = Math.max(box[4], p.y);
  }
  if (!isBuildingProjection(building)) for (const foundation of [...building.volumes.map(v => v.foundation), ...(building.structural_foundations ?? [])]) if (foundation) box[2] = Math.min(box[2], foundation.z_min_m);
  for (const feature of features) { box[2] = Math.min(box[2], feature.z_m); box[5] = Math.max(box[5], feature.z_m + feature.height_m); }
  for (const feature of features) for (const p of feature.vertices3d) {
    const point = [p.x, p.y, p.z]; for (let i = 0; i < 3; i++) { box[i] = Math.min(box[i], point[i]); box[i + 3] = Math.max(box[i + 3], point[i]); }
  }
  return box;
}
function rayBox(origin: Vec3, direction: Vec3, box: Bounds, maximum: number): boolean {
  let near = 0, far = maximum;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(direction[i]) < 1e-12) { if (origin[i] < box[i] || origin[i] > box[i + 3]) return false; continue; }
    const a = (box[i] - origin[i]) / direction[i], b = (box[i + 3] - origin[i]) / direction[i];
    near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b)); if (far < near) return false;
  }
  return true;
}

/** Material layer of a display material id `city3d:<cover|wall|road>:<key>` (city3dMeshes.ts); -1 for any other material. */
function materialLayer(id: string | undefined): number {
  const m = /^city3d:(cover|wall|road):(.+)$/.exec(id ?? ''); if (!m) return -1;
  return m[1] === 'cover' ? coverLayer(m[2]) : m[1] === 'wall' ? wallLayer(m[2]) : MATERIALS.road[m[2]] ?? -1;
}
/** Texture coordinates (in tiles) of a point of a face, in world metres: vertical faces along the face and down (image upright),
 * pitched faces u along the ridge and v down the slope (stretched by the slope), flat faces on the plan. */
function faceUv(p: readonly number[], normal: readonly number[], layer: number): [number, number] {
  if (layer < 0) return [0, 0];
  const e = layerExtent(layer), nx = normal[0], ny = normal[1], nz = Math.abs(normal[2]), h = Math.hypot(nx, ny);
  if (nz < 0.3 && h > 1e-6) return [(p[0] * -ny + p[1] * nx) / h / e, -p[2] / e];
  if (h < 0.02) return [p[0] / e, p[1] / e];
  const dx = nx / h, dy = ny / h;
  return [(-p[0] * dy + p[1] * dx) / e, (p[0] * dx + p[1] * dy) / Math.max(nz, 0.2) / e];
}

/** Native instances, with lazy material/sector buffers and a roof overview LOD.
 * Off-screen sectors require no roof traversal or GPU buffers. Plan (x,y),
 * altitude z become GL (x,z,y), before display exaggeration. */
export class UrbanBuildingPass {
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
  private tick = 0;
  /** Building id → its sector, for targeted replacements. */
  private index = new Map<string, Sector>();
  /** `onTexturesReady`: asks the host for a frame once the material atlases are on the GPU. */
  /** `gl` is undefined for the WebGPU backend (terrain3dGpu.ts), which overrides the GPU hooks. */
  constructor(private gl: WebGL2RenderingContext | undefined, protected onTexturesReady?: () => void) {}

  setScene(scene: Building3dScene | undefined, appearance: UrbanBuildingAppearance): void {
    const key = JSON.stringify(appearance);
    if (this.source === scene && this.appearanceKey === key) return;
    this.clear(); this.source = scene; this.appearance = { ...appearance }; this.appearanceKey = key;
    const sectors = new Map<string, Sector>();
    for (const building of scene?.buildings ?? []) {
      const box = bounds(building);
      const p = isBuildingProjection(building) ? { x: (box[0] + box[3]) / 2, y: (box[1] + box[4]) / 2 } : building.transform.origin;
      const origin: [number, number] = [Math.floor(p.x / SECTOR) * SECTOR, Math.floor(p.y / SECTOR) * SECTOR], key = String(origin);
      let sector = sectors.get(key);
      if (!sector) { sector = { origin, entries: [], bounds: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], width: 0, featureLodEligible: false, overview: false, shown: false }; sectors.set(key, sector); }
      sector.entries.push({ building, bounds: box });
      sector.featureLodEligible ||= !isBuildingProjection(building) && hasBuildingFeatureLod(building.structural_features);
      sector.width += Math.max(1, Math.min(box[3] - box[0], box[4] - box[1]));
      for (let i = 0; i < 3; i++) { sector.bounds[i] = Math.min(sector.bounds[i], box[i]); sector.bounds[i + 3] = Math.max(sector.bounds[i + 3], box[i + 3]); }
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
    const touched = new Set<Sector>(), missing: string[] = [];
    for (const building of changes) {
      const sector = this.index.get(building.id), entry = sector?.entries.find(e => e.building.id === building.id);
      if (!sector || !entry) { missing.push(building.id); continue; }
      entry.building = building; entry.bounds = bounds(building); touched.add(sector);
    }
    for (const sector of touched) {
      sector.bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; sector.width = 0; sector.featureLodEligible = false;
      for (const { building, bounds: box } of sector.entries) {
        sector.featureLodEligible ||= !isBuildingProjection(building) && hasBuildingFeatureLod(building.structural_features);
        sector.width += Math.max(1, Math.min(box[3] - box[0], box[4] - box[1]));
        for (let i = 0; i < 3; i++) { sector.bounds[i] = Math.min(sector.bounds[i], box[i]); sector.bounds[i + 3] = Math.max(sector.bounds[i + 3], box[i + 3]); }
      }
      sector.width /= sector.entries.length; this.release(sector);
    }
    return missing;
  }
  /** The buildings replaceBuildings put in place of the scene's own (to replay them on another pass). */
  replacedBuildings(): Building3dVisual[] {
    const original = new Map(this.source?.buildings.map(b => [b.id, b]));
    return this.sectors.flatMap(sector => sector.entries.filter(e => e.building !== original.get(e.building.id)).map(e => e.building));
  }
  private prepare(sector: Sector, overview: boolean, featureLod?: BuildingFeatureLod): void {
    this.release(sector);
    const groups = new Map<string, Batch>(), textured = !!this.appearance.textured, stride = 9;
    for (const { building } of sector.entries) {
      const colors = new Map<string, Vec3>(), culture = building.culture?.culture ?? '';
      let h = 2166136261; for (let i = 0; i < building.id.length; i++) h = Math.imul(h ^ building.id.charCodeAt(i), 16777619);
      const tone = Math.round((h >>> 0) / 0xffffffff * 15) / 15;
      const programme = (building as unknown as { programme?: { role?: string; landmark?: boolean } }).programme;
      const role = `${programme?.role ?? ''}${programme?.landmark ? ' monument' : ''}`;
      eachBuildingTriangle(building, face => {
        const raw = face.material ?? (face.surface === 'roof' ? face.materials.cladding : face.materials.coating), tm = /@([0-9a-f]{6}|[0-9a-f]{3})$/.exec(raw ?? '');
        const id = tm ? raw.slice(0, tm.index) : raw;
        const paint = buildingPaint(face.materials, building.function, building3dHeight(building), this.appearance, id, {materials: this.source?.materials ?? []});
        const layer = textured ? materialLayer(id ?? (face.surface === 'roof' ? face.materials.cladding : face.materials.coating)) : -1;
        const base = face.surface === 'roof' ? paint.roof : paint.wall, key = `${raw}|${face.surface}`;
        let c = colors.get(key);
        if (!c) {
          c = rgb(base);
          if (this.appearance.diagnostic === 'none') {
            if (tm?.[1].length === 6) c = rgb(`#${tm[1]}`);
            else if (tm) c = c.map((v, i) => Math.min(1, v * parseInt(tm[1][i], 16) / 8)) as Vec3;
            else if (culture && !building.id.startsWith('city3d-')) {
              const material = (s: string): string => /(?:^|[:/_-])(timber|wood|brick|stone|earth|plaster|bamboo|wattle|hide|coral|tile|slate|thatch|reed|palm|shingle|bark|turf|felt|snow|metal|lead)(?:$|[:/_-])/.exec(s)?.[1] ?? '';
              const w = material(face.materials.coating || face.materials.infill), r = material(face.materials.cladding);
              const p = buildingTint(culture, w, r, tone, role + (/tower|minaret|stone/.test(id) ? ' monument' : ''));
              c = face.surface === 'roof' ? p.roof : p.wall;
            }
          }
          if (face.surface === 'roof' && this.appearance.diagnostic === 'none' && this.appearance.colors?.building) c = rgb(this.appearance.colors.building);
          colors.set(key, c);
        }
        const recolored = this.appearance.diagnostic === 'none' && (!!this.appearance.colors?.building && face.surface === 'roof' || tm?.[1].length === 6 || !!culture && !building.id.startsWith('city3d-'));
        const color = textured ? `${c.join(',')}|${layer}|${recolored}` : 'vertex-colour', mean = MATERIALS.layers[layer]?.mean_rgb;
        const tint = mean && recolored ? c.map((v, i) => v / Math.max(0.04, mean[i] / 255)) as Vec3
          : tm?.[1].length === 3 ? [...tm[1]].map(v => parseInt(v, 16) / 8) as Vec3 : [1, 1, 1] as Vec3;
        let batch = groups.get(color); if (!batch) { batch = { color: textured ? c : [1, 1, 1], tint, recolored, values: [], count: 0, stride: 9, vcolor: !textured, palette: [] }; groups.set(color, batch); }
        if (batch.palette && !batch.palette.some(q => q[0] === c[0] && q[1] === c[1] && q[2] === c[2])) batch.palette.push(c);
        for (const p of face.points) {
          batch.values.push(p[0] - sector.origin[0], p[2], p[1] - sector.origin[1], face.normal[0], face.normal[2], face.normal[1]);
          if (textured) { const [u, v] = faceUv(p, face.normal, layer); batch.values.push(u, v, layer); } else batch.values.push(c[0], c[1], c[2]);
        }
      }, overview, featureLod);
    }
    const batches: Batch[] = [];
    for (const batch of groups.values()) {
      if (!batch.values.length) continue;
      this.upload(batch, new Float32Array(batch.values));
      batch.count = batch.values.length / batch.stride; batch.values = []; batches.push(batch);
    }
    sector.cached = { overview, featureLod, batches, used: this.tick };
  }
  /** Vertex buffer of a batch (9 floats per vertex). */
  protected upload(batch: Batch, values: Float32Array): void {
    const gl = this.gl!;
    batch.vao = gl.createVertexArray()!; batch.buffer = gl.createBuffer()!;
    gl.bindVertexArray(batch.vao); gl.bindBuffer(gl.ARRAY_BUFFER, batch.buffer); gl.bufferData(gl.ARRAY_BUFFER, values, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, batch.stride * 4, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, batch.stride * 4, 12);
    if (batch.vcolor) { gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 36, 24); }
    else { gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 36, 24); gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 36, 32); }
    gl.bindVertexArray(null);
  }
  /** Material atlases on the GPU (textured appearance). */
  protected uploadTextures(images: MaterialImages): void { this.textures = uploadMaterialArrays(this.gl!, images, false); }
  draw(frame: BuildingFrame): boolean {
    const started = performance.now(); let pending = false, prepared = 0;
    if (!this.sectors.length) return false;
    ++this.tick;
    // Textured materials: the atlases load once (the flat colours show until they arrive).
    const wantTex = !!this.appearance.textured;
    if (wantTex && !this.texturesRequested) {
      this.texturesRequested = true;
      loadMaterialImages().then(images => { if (!this.sectors.length) return; this.uploadTextures(images); this.onTexturesReady?.(); }, e => { this.texturesRequested = false; console.warn('Matières texturées indisponibles', e); });
    }
    const stats = { drawCalls: 0, sectors: 0, triangles: 0 }, shown: Sector[] = [];
    for (const sector of this.sectors) {
      sector.shown = false;
      const b = sector.bounds, point = [(b[0] + b[3]) / 2 - frame.cameraX, (b[2] + b[5]) / 2 * frame.exaggeration - frame.targetHeight, (b[1] + b[4]) / 2 - frame.cameraY];
      const radius = Math.hypot(b[3] - b[0], (b[5] - b[2]) * frame.exaggeration, b[4] - b[1]) / 2;
      const m = frame.matrix, depth = m[3] * point[0] + m[7] * point[1] + m[11] * point[2] + m[15];
      if (depth > radius && radius * frame.focal / depth < .35) continue;
      let outside = false;
      for (const axis of [0, 1, 2]) for (const sign of [-1, 1]) {
        const plane = [m[3] + sign * m[axis], m[7] + sign * m[4 + axis], m[11] + sign * m[8 + axis], m[15] + sign * m[12 + axis]];
        if (plane[0] * point[0] + plane[1] * point[1] + plane[2] * point[2] + plane[3] < -radius * Math.hypot(plane[0], plane[1], plane[2])) outside = true;
      }
      if (outside) continue;
      const pixels = sector.width * frame.focal / Math.max(1, depth - radius), overview = sector.cached?.overview ? pixels < 10 : pixels < 7;
      const featureMpp = overview && sector.featureLodEligible ? buildingFeatureMetresPerPixel(m, point, radius, frame.focal) : undefined;
      const featureLod = featureMpp === undefined ? undefined : buildingFeatureLod(featureMpp, frame.exaggeration, sector.cached?.featureLod);
      if (!sector.cached || sector.cached.overview !== overview || !sameBuildingFeatureLod(sector.cached.featureLod, featureLod)) {
        if (prepared && performance.now() - started > 8) { pending = true; if (!sector.cached) continue; }
        else { this.prepare(sector, overview, featureLod); ++prepared; }
      }
      sector.shown = true; sector.overview = sector.cached!.overview; sector.cached!.used = this.tick;
      for (const batch of sector.cached!.batches) { stats.drawCalls++; stats.triangles += batch.count / 3; }
      stats.sectors++; shown.push(sector);
    }
    this.render(frame, shown, wantTex);
    this.lastDraw = stats;
    let bytes = this.sectors.reduce((total, sector) => total + (sector.cached?.batches.reduce((n, batch) => n + batch.count * batch.stride * 4, 0) ?? 0), 0);
    if (bytes > MAX_CACHE_BYTES) for (const sector of this.sectors.filter(s => s.cached && !s.shown).sort((a, b) => a.cached!.used - b.cached!.used)) {
      bytes -= sector.cached!.batches.reduce((n, batch) => n + batch.count * batch.stride * 4, 0); this.release(sector); if (bytes <= MAX_CACHE_BYTES) break;
    }
    return pending;
  }
  /** Draws the batches of the shown sectors (flat or textured program). */
  protected render(frame: BuildingFrame, shown: readonly Sector[], textured: boolean): void {
    const gl = this.gl!;
    const texProgram = textured ? (this.texProgram ??= program(gl, texVertex, texFragment)) : undefined;
    const p = texProgram ?? (this.colorProgram ??= program(gl, vertexColor, fragmentColor)); gl.useProgram(p);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    if (texProgram) {
      gl.uniform1i(gl.getUniformLocation(p, 'useTex'), this.textures ? 1 : 0);
      gl.uniform1i(gl.getUniformLocation(p, 'albedoTex'), 10); gl.uniform1i(gl.getUniformLocation(p, 'normalTex'), 11);
      gl.activeTexture(gl.TEXTURE0 + 10); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textures?.albedo ?? null);
      gl.activeTexture(gl.TEXTURE0 + 11); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textures?.normal ?? null);
      gl.activeTexture(gl.TEXTURE0);
    }
    gl.uniformMatrix4fv(gl.getUniformLocation(p, 'matrix'), false, frame.matrix); gl.uniform1f(gl.getUniformLocation(p, 'exaggeration'), frame.exaggeration);
    for (const sector of shown) {
      gl.uniform3f(gl.getUniformLocation(p, 'offset'), sector.origin[0] - frame.cameraX, -frame.targetHeight, sector.origin[1] - frame.cameraY);
      for (const batch of sector.cached!.batches) {
        if (texProgram) {
          gl.uniform3fv(gl.getUniformLocation(p, 'material'), batch.color); gl.uniform3fv(gl.getUniformLocation(p, 'tint'), batch.tint);
          gl.uniform1i(gl.getUniformLocation(p, 'recolored'), batch.recolored ? 1 : 0);
        }
        gl.bindVertexArray(batch.vao!); gl.drawArrays(gl.TRIANGLES, 0, batch.count);
      }
    }
    gl.bindVertexArray(null);
  }
  pick(origin: BuildingVector, direction: BuildingVector): { id?: string; distance: number } {
    let distance = Infinity, id: string | undefined;
    for (const sector of this.sectors) if (sector.shown && rayBox(origin, direction, sector.bounds, distance)) for (const entry of sector.entries) {
      if (!rayBox(origin, direction, entry.bounds, distance)) continue;
      eachBuildingTriangle(entry.building, face => { const hit = buildingRayDistance(origin, direction, face.points); if (hit !== null && hit < distance) { distance = hit; id = entry.building.id; } }, sector.overview, sector.cached?.featureLod);
    }
    return { id, distance };
  }
  private release(sector: Sector): void { for (const batch of sector.cached?.batches ?? []) this.releaseBatch(batch); sector.cached = undefined; }
  protected releaseBatch(batch: Batch): void { this.gl!.deleteBuffer(batch.buffer!); this.gl!.deleteVertexArray(batch.vao!); }
  private clear(): void { for (const sector of this.sectors) this.release(sector); this.sectors = []; this.index.clear(); }
  dispose(): void { this.clear(); this.disposeBackend(); this.source = undefined; }
  protected disposeBackend(): void {
    const gl = this.gl!;
    if (this.colorProgram) gl.deleteProgram(this.colorProgram); if (this.texProgram) gl.deleteProgram(this.texProgram); if (this.textures) { gl.deleteTexture(this.textures.albedo); gl.deleteTexture(this.textures.normal); }
  }
}
