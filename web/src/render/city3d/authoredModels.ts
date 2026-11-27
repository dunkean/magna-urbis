import marketHall from '../../../../contributions/models/market-hall.json';
import type { ArchitectureVolume, PlacedBuilding } from '../../../../rust/bridge/urbanArchitecture';
import type { OverviewVolume } from '../urbanBuildingGeometry';
import { CITY3D_MATERIALS } from './materials';
import { orientedBox, ringArea } from './roofGeometry';

interface ModelMesh {
  vertices: number[][];
  triangles: (number | string)[][];
}

interface RoleModel {
  schema: string;
  id: string;
  label: string;
  culture: string;
  role: string;
  units: string;
  footprintM: number[];
  heightM: number;
  attribution: { author: string; license: string; source: string };
  materials: Record<string, string>;
  near: ModelMesh;
  overview: ModelMesh;
}

const MODELS = [marketHall] satisfies RoleModel[];
const EPSILON = 1e-6;
const MIN_SCALE = 0.65;
const MAX_SCALE = 1.75;
const MATERIAL_IDS = new Set(CITY3D_MATERIALS.map(material => material.id));

function faceNormal(a: readonly number[], b: readonly number[], c: readonly number[]): [number, number, number] {
  const ux = b[0] - a[0],
    uy = b[1] - a[1],
    uz = b[2] - a[2],
    vx = c[0] - a[0],
    vy = c[1] - a[1],
    vz = c[2] - a[2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

/** Validate bundled geometry once. Invalid assets keep the normal silhouette and report a specific authoring error in tests. */
export function roleModelIssue(model: RoleModel): string | undefined {
  if (!model || model.schema !== 'magna-role-model-1' || model.units !== 'm') return 'Expected magna-role-model-1 in metres.';
  if (!/^[a-z0-9-]+$/.test(model.id) || ![model.id, model.label, model.culture, model.role].every(value => typeof value === 'string' && value.trim())) return 'The model needs an id, label, culture and role.';
  if (![model.attribution?.author, model.attribution?.license, model.attribution?.source].every(value => typeof value === 'string' && value.trim())) return 'Provide author, license and source attribution.';
  if (!Array.isArray(model.footprintM)) return 'Provide a metric footprint.';
  if (!model.materials || typeof model.materials !== 'object' || Array.isArray(model.materials)) return 'Provide named materials.';
  const [width, depth] = model.footprintM,
    height = model.heightM;
  if (model.footprintM.length !== 2 || ![width, depth, height].every(value => Number.isFinite(value) && value > 0) || width < depth) return 'Expected width >= depth > 0 and height > 0.';

  for (const [level, mesh, triangleLimit] of [
    ['near', model.near, 128],
    ['overview', model.overview, 48],
  ] as const) {
    if (!Array.isArray(mesh?.vertices) || !Array.isArray(mesh?.triangles)) return `${level}: provide vertices and triangles.`;
    if (!mesh.triangles.length || mesh.triangles.length > triangleLimit) return `${level}: expected up to ${triangleLimit} triangles.`;
    if (mesh.vertices.length > 3 * mesh.triangles.length) return `${level}: remove unused vertices.`;
    const limits = [
      [-width * 0.5, width * 0.5],
      [-depth * 0.5, depth * 0.5],
      [0, height],
    ];
    for (const vertex of mesh.vertices) {
      if (!Array.isArray(vertex) || vertex.length !== 3 || vertex.some((value, axis) => !Number.isFinite(value) || value < limits[axis][0] - EPSILON || value > limits[axis][1] + EPSILON)) return `${level}: a vertex lies outside the footprint or height.`;
    }
    const used = new Set<number>();
    for (const triangle of mesh.triangles) {
      if (!Array.isArray(triangle) || triangle.length !== 4) return `${level}: expected three indices and a named city3d material.`;
      const [a, b, c, material] = triangle;
      if (typeof a !== 'number' || typeof b !== 'number' || typeof c !== 'number' || ![a, b, c].every(index => Number.isInteger(index) && mesh.vertices[index])) return `${level}: bad triangle index.`;
      const paint = typeof material === 'string' && Object.hasOwn(model.materials, material) && model.materials[material];
      if (typeof paint !== 'string' || !/^(?:[^@]+)(?:@[0-9a-f]{6})?$/.test(paint) || !MATERIAL_IDS.has(paint.split('@')[0])) return `${level}: expected three indices and a named city3d material.`;
      if (Math.hypot(...faceNormal(mesh.vertices[a], mesh.vertices[b], mesh.vertices[c])) <= EPSILON) return `${level}: degenerate triangle.`;
      used.add(a).add(b).add(c);
    }
    if (used.size !== mesh.vertices.length) return `${level}: remove unused vertices.`;
    for (const [axis, [min, max]] of limits.entries()) {
      if (!mesh.vertices.some(vertex => Math.abs(vertex[axis] - min) <= EPSILON) || !mesh.vertices.some(vertex => Math.abs(vertex[axis] - max) <= EPSILON)) return `${level}: span the declared footprint and height.`;
    }
  }
  if (model.overview.triangles.length >= model.near.triangles.length) return 'Overview must use fewer triangles than near.';
}

const modelById = new Map<string, RoleModel>();
const modelsByRole = new Map<string, Map<string, RoleModel>>();
const issues: string[] = [];
for (const [index, model] of MODELS.entries()) {
  const issue = roleModelIssue(model);
  if (issue) {
    issues.push(`${model?.id ?? index}: ${issue}`);
    continue;
  }
  if (modelById.has(model.id)) {
    issues.push(`Duplicate role model id: ${model.id}`);
    continue;
  }
  let byCulture = modelsByRole.get(model.role);
  if (!byCulture) modelsByRole.set(model.role, (byCulture = new Map()));
  if (byCulture.has(model.culture)) {
    issues.push(`Duplicate role model for ${model.culture} / ${model.role}`);
    continue;
  }
  byCulture.set(model.culture, model);
  modelById.set(model.id, model);
}
export const ROLE_MODEL_CATALOGUE_ISSUES: readonly string[] = issues;

// The fixed preview compares the model with the original procedural exterior for the same role.
const proceduralExteriors = new WeakSet<PlacedBuilding>();
export const keepProceduralPreview = (building: PlacedBuilding): void => {
  proceduralExteriors.add(building);
};
/** Both the normal display pass and the fixed renderer fixture use this catalogue. */
export const roleModelById = (id: string): RoleModel | undefined => modelById.get(id);

function fitRoleModel(model: RoleModel, volume: ArchitectureVolume, entrance: PlacedBuilding['entrance']): OverviewVolume | undefined {
  const [level] = volume.levels,
    shape = level?.footprint[0],
    source = volume as OverviewVolume;
  if (source.role === 'minor' || source.stiltHeight_m || source.displayTree || volume.envelope !== 'walled' || volume.levels.length !== 1 || level.footprint.length !== 1 || shape.holes.length || shape.outer.length !== 4) return;
  const box = orientedBox(shape.outer);
  if (!box || Math.abs(ringArea(shape.outer)) < box.area * (1 - EPSILON)) return;
  const [width, depth] = model.footprintM,
    sx = (2 * box.half) / width,
    sy = (2 * box.halfWidth) / depth,
    sz = (volume.z_m + volume.wall_height_m + volume.roof_height_m - level.z_m) / model.heightM;
  if (![sx, sy, sz].every(scale => scale >= MIN_SCALE && scale <= MAX_SCALE)) return;

  const { center, axis } = box,
    towardsEntrance = -(entrance.x - center.x) * axis.y + (entrance.y - center.y) * axis.x,
    // The chosen long edge faces the entrance. In a tie, use a canonical axis instead of ring order.
    sign = towardsEntrance < -EPSILON || (Math.abs(towardsEntrance) <= EPSILON && (axis.x < -EPSILON || (Math.abs(axis.x) <= EPSILON && axis.y < 0))) ? -1 : 1,
    ux = sign * axis.x,
    uy = sign * axis.y;
  const mesh: ArchitectureVolume['roof_mesh'] = { vertices: [], faces: [] };
  for (const lod of [model.near, model.overview]) {
    const start = mesh.vertices.length;
    for (const [x, y, z] of lod.vertices) mesh.vertices.push({ x: center.x + ux * x * sx - uy * y * sy, y: center.y + uy * x * sx + ux * y * sy, z: level.z_m + z * sz });
    for (const [a, b, c, material] of lod.triangles) {
      const indices = [a, b, c] as [number, number, number],
        [nx, ny, nz] = faceNormal(lod.vertices[indices[0]], lod.vertices[indices[1]], lod.vertices[indices[2]]),
        x = nx / sx,
        y = ny / sy,
        z = nz / sz,
        length = Math.hypot(x, y, z);
      mesh.faces.push({ vertices: indices.map(index => start + index), normal: [(ux * x - uy * y) / length, (uy * x + ux * y) / length, z / length], material: model.materials[material as string], kind: Math.abs(z / length) < 0.05 ? 'gable' : 'pan' });
    }
  }
  return {
    ...volume,
    roof_mesh: mesh,
    authoredExterior: {
      model: model.id,
      near: [0, model.near.triangles.length],
      overview: [model.near.triangles.length, mesh.faces.length],
      // A fresh slot identity lets authored faces keep their own paint in the massing renderer.
      materials: { ...volume.materials },
    },
  };
}

/** Replace the first compatible solid body of an opted-in silhouette, retaining its exact footprint, seats and levels. */
export function withRoleModel(building: PlacedBuilding, display: PlacedBuilding): PlacedBuilding {
  const programme = (building as PlacedBuilding & { programme?: { role?: string } }).programme;
  const model = programme?.role && modelsByRole.get(programme.role)?.get(building.culture.culture);
  if (!model || proceduralExteriors.has(building)) return display;
  for (let index = 0; index < display.volumes.length; index++) {
    const fit = fitRoleModel(model, display.volumes[index], building.entrance);
    if (!fit) continue;
    const volumes = display.volumes.slice();
    volumes[index] = fit;
    return { ...display, volumes };
  }
  return display;
}
