/** Transactional edits of authoritative native placement requests. This module
 * indexes existing occupation; it does not generate, deform or intersect houses.
 */
import type { HouseMaterial, Surface } from './housesContract';
import type {
  ArchitectureNeighbor, PlacementBatch, PlacementBatchRequest, PlacementBatchSettings,
  PlacementRefusal, PlacementRequest, PlacedBuilding,
} from './urbanArchitecture';
import { ARCHITECTURE_PLAN_HOUSE_GENERATORS } from './urbanArchitecture';
import { COMPACT_PLAN_ARCHIVE_FORMAT, isArchivedPlan, registerPlanArchives, resolveArchivedPlan } from './compactPlanArchive';

export interface ArchitectureEditResult {
  scene: PlacementBatch;
  applied: boolean;
  changedIds: string[];
  refusals: PlacementRefusal[];
}
type Bounds = [number, number, number, number];
type Occupation = { box: Bounds; neighbor: ArchitectureNeighbor };
const CELL_SIZE = 64, MAX_CELLS = 4096;
const emptyBounds = (): Bounds => [Infinity, Infinity, -Infinity, -Infinity];
function extend(box: Bounds, x: number, y: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Architecture edit contains non-finite spatial bounds.');
  box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y);
  box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y);
}
function extendSurface(box: Bounds, surface: Surface): void {
  for (const polygon of surface) for (const point of polygon.outer) extend(box, point.x, point.y);
}
const overlaps = (a: Bounds, b: Bounds) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
function cellsFor(box: Bounds): string[] | undefined {
  if (box[0] > box[2] || box[1] > box[3]) return [];
  const [x0, y0, x1, y1] = box.map(value => Math.floor(value / CELL_SIZE));
  if (![x0, y0, x1, y1].every(Number.isSafeInteger) || (x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS) return undefined;
  const keys: string[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) keys.push(`${x},${y}`);
  return keys;
}

/** One index per edit; ordinary local queries inspect only intersecting cells.
 * Extremely wide entries/queries have a bounded-allocation fallback.
 */
function occupationIndex(buildings: PlacedBuilding[], selected: Set<string>) {
  const cells = new Map<string, Occupation[]>(), all: Occupation[] = [], wide: Occupation[] = [];
  for (const building of buildings) {
    if (selected.has(building.id)) continue;
    let height = 0;
    for (const volume of building.volumes) height = Math.max(height, volume.z_m + volume.wall_height_m + volume.roof_height_m - building.ground_z_m);
    for (const feature of building.structural_features) height = Math.max(height, feature.z_m + feature.height_m - building.ground_z_m);
    const surfaces = [building.footprint, building.courtyards, building.circulation,
      ...building.structural_features.map(feature => feature.surface),
      ...(building.structural_foundations ?? []).map(foundation => foundation.footprint)];
    for (const [index, surface] of surfaces.entries()) {
      if (!surface.length) continue;
      const box = emptyBounds(); extendSurface(box, surface);
      const entry = { box, neighbor: { id: `${building.id}/occupation/${index}`, footprint: surface, height_m: height } };
      all.push(entry);
      const keys = cellsFor(box);
      if (!keys) { wide.push(entry); continue; }
      for (const key of keys) {
        const list = cells.get(key);
        if (list) list.push(entry); else cells.set(key, [entry]);
      }
    }
  }
  return (request: PlacementRequest): PlacementRequest => {
    const box = emptyBounds();
    for (const surface of [request.cadastral, request.buildable, request.roof_domain ?? []]) extendSurface(box, surface);
    for (const access of request.accesses) for (const point of access.segment) {
      const halfWidth = Math.max(0, access.width_m / 2);
      extend(box, point.x - halfWidth, point.y - halfWidth); extend(box, point.x + halfWidth, point.y + halfWidth);
    }
    const local = new Map<string, ArchitectureNeighbor>();
    for (const neighbor of request.neighbors) {
      const owner = neighbor.id.replace(/\/occupation\/\d+$/, '');
      if (!selected.has(neighbor.id) && !selected.has(owner)) local.set(neighbor.id, neighbor);
    }
    const keys = cellsFor(box);
    const add = (entry: Occupation) => { if (overlaps(box, entry.box)) local.set(entry.neighbor.id, entry.neighbor); };
    for (const entry of keys ? wide : all) add(entry);
    for (const key of keys ?? []) for (const entry of cells.get(key) ?? []) add(entry);
    return { ...request, neighbors: [...local.values()] };
  };
}

function replaceSelected<T extends { id: string }>(previous: T[], replacements: T[], selected: Set<string>, order: string[]): T[] {
  const next = new Map(replacements.map(value => [value.id, value]));
  const result: T[] = [];
  for (const value of previous) {
    if (!selected.has(value.id)) result.push(value);
    else if (next.has(value.id)) { result.push(next.get(value.id)!); next.delete(value.id); }
  }
  for (const id of order) if (next.has(id)) result.push(next.get(id)!);
  return result;
}
const materialKey = (material: HouseMaterial) => JSON.stringify([
  material.label, material.roles, material.pattern, material.origin, material.source_ref,
]);

/** Atomically replace selected stable IDs through native generation. Caller
 * errors and native/network exceptions throw; no scene has been changed. Native
 * refusals or incompatible/incomplete results return the exact previous scene.
 */
export async function editArchitectureScene(
  previous: PlacementBatch,
  requests: PlacementRequest[],
  generate: (input: PlacementBatchRequest) => Promise<PlacementBatch>,
  settings?: PlacementBatchSettings,
): Promise<ArchitectureEditResult> {
  const selected = new Set<string>();
  for (const request of requests) {
    if (!request.id || selected.has(request.id)) throw new Error(`Invalid or duplicate architecture edit request: ${request.id}`);
    selected.add(request.id);
  }
  if (!requests.length) return { scene: previous, applied: false, changedIds: [], refusals: [] };
  const known = new Set<string>();
  let outside = false;
  for (const values of [previous.buildings, previous.open_spaces, previous.refusals]) for (const value of values) {
    if (!value.id || known.has(value.id)) throw new Error(`Invalid or duplicate previous architecture result: ${value.id}`);
    known.add(value.id); outside ||= !selected.has(value.id);
  }
  const refuse = (code: string, message: string, request = requests[0]): ArchitectureEditResult => ({
    scene: previous, applied: false, changedIds: [],
    refusals: [{ id: request.id, parcel_id: request.parcel_id, code, message, attempts: 0 }],
  });
  if (previous.schema_version !== '1') return refuse('edit_incompatible_schema', 'The previous scene uses an incompatible architecture schema.');
  const withNeighbors = occupationIndex(previous.buildings, selected);
  // Clone only selected inputs and relevant occupied surfaces, never the city.
  // This also protects the old scene against callback/default-setting mutation.
  const input: PlacementBatchRequest = structuredClone({ schema_version: '1', requests: requests.map(withNeighbors), ...(settings ? { settings } : {}) });
  const generated = await generate(input);
  if (generated.schema_version !== previous.schema_version || !generated.generator_version
    || (outside && generated.generator_version !== previous.generator_version)) {
    return refuse('edit_incompatible_generator', 'Changing architecture generator requires replacing the whole scene.');
  }
  const requested = new Map(requests.map(request => [request.id, request])), received = new Set<string>();
  for (const [kind, values] of [['building', generated.buildings], ['open_space', generated.open_spaces], ['refusal', generated.refusals]] as const) {
    for (const value of values) {
      const request = requested.get(value.id);
      if (!request || received.has(value.id)) return refuse('edit_invalid_result_id', `Native edit returned an unexpected or duplicate result ID: ${value.id}.`, request);
      received.add(value.id);
      if (value.parcel_id !== request.parcel_id) return refuse('edit_invalid_parcel', `Native edit changed the parcel ID of ${value.id}.`, request);
      if (kind !== 'refusal' && (kind === 'open_space') !== (request.function === 'open_space')) {
        return refuse('edit_invalid_result_kind', `Native edit returned the wrong building/open-space result for ${value.id}.`, request);
      }
    }
  }
  const refusals = [...generated.refusals];
  for (const request of requests) if (!received.has(request.id)) refusals.push({
    id: request.id, parcel_id: request.parcel_id, code: 'edit_missing_result', message: `Native edit returned no result for ${request.id}.`, attempts: 0,
  });
  if (refusals.length) return { scene: previous, applied: false, changedIds: [], refusals };
  // Validate only the selected native response. Do not relabel its opaque
  // records, decode the retained city, or turn old archives into current plans.
  for (const building of generated.buildings) {
    if (building.simplification !== 'architectural_plan') continue;
    const expected = Object.hasOwn(ARCHITECTURE_PLAN_HOUSE_GENERATORS, generated.generator_version)
      ? ARCHITECTURE_PLAN_HOUSE_GENERATORS[generated.generator_version] : undefined;
    if (!expected) return refuse('edit_unknown_plan_generator',
      `No retained-plan version contract is known for ${generated.generator_version}.`, requested.get(building.id));
    let resolved: unknown;
    try {
      resolved = await resolveArchivedPlan(building, generated);
    } catch (error) {
      return refuse('edit_invalid_archive', `Cannot validate retained plan ${building.id}: ${String(error)}`, requested.get(building.id));
    }
    if (!resolved || typeof resolved !== 'object' || !('format' in resolved) || resolved.format !== 'compact-plan-1'
      || !('generator_version' in resolved) || resolved.generator_version !== expected) {
      return refuse('edit_incompatible_plan_version',
        `Building ${building.id} must retain an original ${expected} compact plan for ${generated.generator_version}.`, requested.get(building.id));
    }
  }
  const modes = new Set(generated.buildings.map(building => building.simplification));
  for (const building of previous.buildings) if (!selected.has(building.id)) modes.add(building.simplification);
  if (modes.size > 1) return refuse('edit_incompatible_mode', 'A selected edit cannot mix compact architectural plans with detailed recipe volumes.');

  const order = requests.map(request => request.id);
  const buildings = replaceSelected(previous.buildings, generated.buildings, selected, order);
  const archives: Record<string, string> = {};
  for (const building of buildings) {
    const resolved = building.resolved;
    if (!isArchivedPlan(resolved)) {
      if (resolved && typeof resolved === 'object' && 'format' in resolved && resolved.format === COMPACT_PLAN_ARCHIVE_FORMAT) {
        return refuse('edit_invalid_archive', `Building ${building.id} has an invalid retained-plan reference.`);
      }
      continue;
    }
    const oldSource = previous.plan_archives?.[resolved.archive_id], newSource = generated.plan_archives?.[resolved.archive_id];
    if (oldSource !== undefined && newSource !== undefined && oldSource !== newSource) return refuse('edit_archive_conflict', 'Native edit conflicts with an existing retained-plan archive.');
    const source = newSource ?? oldSource;
    if (typeof source !== 'string') return refuse('edit_missing_archive', `Building ${building.id} has no retained-plan archive.`);
    archives[resolved.archive_id] = source;
  }
  const materials = new Map((previous.materials ?? []).map(material => [material.id, material]));
  for (const material of generated.materials ?? []) {
    const current = materials.get(material.id);
    if (outside && current && materialKey(current) !== materialKey(material)) return refuse('edit_material_conflict', `Native edit changes the shared material ${material.id}.`);
    if (!current || !outside) materials.set(material.id, material);
  }
  const scene: PlacementBatch = {
    ...previous, generator_version: generated.generator_version, buildings,
    open_spaces: replaceSelected(previous.open_spaces, generated.open_spaces, selected, order),
    refusals: previous.refusals.filter(refusal => !selected.has(refusal.id)),
  };
  delete scene.plan_archives;
  if (Object.keys(archives).length) scene.plan_archives = archives;
  if (materials.size) scene.materials = [...materials.values()];
  registerPlanArchives(scene);
  return { scene, applied: true, changedIds: order, refusals: [] };
}
