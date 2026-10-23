import { buildingPaint, type UrbanBuildingAppearance } from '../render/urbanBuildingStyle';
import { building3dHeight, isBuildingProjection, buildingRayDistance, eachBuildingTriangle, type BuildingVector, type Building3dVisual, type Building3dScene } from '../render/urbanBuildingGeometry';
import { buildingFeatureLod, buildingFeatureMetresPerPixel, hasBuildingFeatureLod, sameBuildingFeatureLod, type BuildingFeatureLod } from '../render/urbanBuildingFeatureLod';

type Vec3 = [number, number, number];
type Bounds = [number, number, number, number, number, number];
interface BuildingFrame { matrix: Float32Array; cameraX: number; cameraY: number; targetHeight: number; exaggeration: number; focal: number; distance: number }
interface Batch { color: Vec3; values: number[]; buffer?: WebGLBuffer; vao?: WebGLVertexArrayObject; count: number }
interface Entry { building: Building3dVisual; bounds: Bounds }
interface Sector { origin: [number, number]; entries: Entry[]; bounds: Bounds; width: number; featureLodEligible: boolean; overview: boolean; shown: boolean; cached?: { overview: boolean; featureLod?: BuildingFeatureLod; batches: Batch[]; used: number } }
const SECTOR = 256, MAX_CACHE_BYTES = 96 * 1024 * 1024;
const vertex = `#version 300 es
precision highp float;
layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
uniform mat4 matrix;
uniform vec3 offset;
uniform float exaggeration;
out vec3 n;
void main(){n=normalize(vec3(normal.x,normal.y/exaggeration,normal.z));gl_Position=matrix*vec4(vec3(position.x,position.y*exaggeration,position.z)+offset,1.);}`;
const fragment = `#version 300 es
precision highp float;
in vec3 n;
uniform vec3 material;
out vec4 color;
void main(){float light=.55+.45*abs(dot(normalize(n),normalize(vec3(-.4,.85,.3))));color=vec4(material*light,1.);}`;

function program(gl: WebGL2RenderingContext): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [kind, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
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

/** Native instances, with lazy material/sector buffers and a roof overview LOD.
 * Off-screen sectors require no roof traversal or GPU buffers. Plan (x,y),
 * altitude z become GL (x,z,y), before display exaggeration. */
export class UrbanBuildingPass {
  private sectors: Sector[] = [];
  private program: WebGLProgram;
  private source?: Building3dScene;
  private appearance: UrbanBuildingAppearance = { style: 'cartographic', diagnostic: 'none' };
  private appearanceKey = '';
  private tick = 0;
  /** Building id → its sector, for targeted replacements. */
  private index = new Map<string, Sector>();
  constructor(private gl: WebGL2RenderingContext) { this.program = program(gl); }

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
  private prepare(sector: Sector, overview: boolean, featureLod?: BuildingFeatureLod): void {
    this.release(sector);
    const groups = new Map<string, Batch>();
    for (const { building } of sector.entries) eachBuildingTriangle(building, face => {
      const paint = buildingPaint(face.materials, building.function, building3dHeight(building), this.appearance, face.material, {materials: this.source?.materials ?? []});
      const color = face.surface === 'roof' ? paint.roof : paint.wall;
      let batch = groups.get(color); if (!batch) { batch = { color: rgb(color), values: [], count: 0 }; groups.set(color, batch); }
      for (const p of face.points) batch.values.push(p[0] - sector.origin[0], p[2], p[1] - sector.origin[1], face.normal[0], face.normal[2], face.normal[1]);
    }, overview, featureLod);
    const gl = this.gl, batches: Batch[] = [];
    for (const batch of groups.values()) {
      if (!batch.values.length) continue;
      batch.vao = gl.createVertexArray()!; batch.buffer = gl.createBuffer()!;
      gl.bindVertexArray(batch.vao); gl.bindBuffer(gl.ARRAY_BUFFER, batch.buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(batch.values), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
      batch.count = batch.values.length / 6; batch.values = []; batches.push(batch);
    }
    sector.cached = { overview, featureLod, batches, used: this.tick }; gl.bindVertexArray(null);
  }
  draw(frame: BuildingFrame): boolean {
    const gl = this.gl, p = this.program, started = performance.now(); let pending = false, prepared = 0;
    if (!this.sectors.length) return false;
    ++this.tick; gl.useProgram(p); gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.uniformMatrix4fv(gl.getUniformLocation(p, 'matrix'), false, frame.matrix); gl.uniform1f(gl.getUniformLocation(p, 'exaggeration'), frame.exaggeration);
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
      gl.uniform3f(gl.getUniformLocation(p, 'offset'), sector.origin[0] - frame.cameraX, -frame.targetHeight, sector.origin[1] - frame.cameraY);
      for (const batch of sector.cached!.batches) {
        gl.uniform3fv(gl.getUniformLocation(p, 'material'), batch.color); gl.bindVertexArray(batch.vao!); gl.drawArrays(gl.TRIANGLES, 0, batch.count);
      }
    }
    gl.bindVertexArray(null);
    let bytes = this.sectors.reduce((total, sector) => total + (sector.cached?.batches.reduce((n, batch) => n + batch.count * 24, 0) ?? 0), 0);
    if (bytes > MAX_CACHE_BYTES) for (const sector of this.sectors.filter(s => s.cached && !s.shown).sort((a, b) => a.cached!.used - b.cached!.used)) {
      bytes -= sector.cached!.batches.reduce((n, batch) => n + batch.count * 24, 0); this.release(sector); if (bytes <= MAX_CACHE_BYTES) break;
    }
    return pending;
  }
  pick(origin: BuildingVector, direction: BuildingVector): { id?: string; distance: number } {
    let distance = Infinity, id: string | undefined;
    for (const sector of this.sectors) if (sector.shown && rayBox(origin, direction, sector.bounds, distance)) for (const entry of sector.entries) {
      if (!rayBox(origin, direction, entry.bounds, distance)) continue;
      eachBuildingTriangle(entry.building, face => { const hit = buildingRayDistance(origin, direction, face.points); if (hit !== null && hit < distance) { distance = hit; id = entry.building.id; } }, sector.overview, sector.cached?.featureLod);
    }
    return { id, distance };
  }
  private release(sector: Sector): void { for (const batch of sector.cached?.batches ?? []) { this.gl.deleteBuffer(batch.buffer!); this.gl.deleteVertexArray(batch.vao!); } sector.cached = undefined; }
  private clear(): void { for (const sector of this.sectors) this.release(sector); this.sectors = []; this.index.clear(); }
  dispose(): void { this.clear(); this.gl.deleteProgram(this.program); this.source = undefined; }
}
