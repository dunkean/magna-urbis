import type { Surface } from './housesContract';
import type { ArchitectureNeighbor, PlacementBatch, PlacementBatchRequest, PlacementRequest, PlacedBuilding } from './urbanArchitecture';

type Bounds = [number, number, number, number];
const SECTOR = 64;
const BATCH_SIZE = 64;
const MAX_INPUT_BYTES = 24 * 1024 * 1024;
const bounds = (surface: Surface): Bounds => {
  const result: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const shape of surface) for (const p of shape.outer) {
    result[0] = Math.min(result[0], p.x); result[1] = Math.min(result[1], p.y);
    result[2] = Math.max(result[2], p.x); result[3] = Math.max(result[3], p.y);
  }
  return result;
};
const overlaps = (a: Bounds, b: Bounds): boolean => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
function sectorKeys(box: Bounds): string[] | undefined {
  const keys: string[] = [];
  if (!box.every(Number.isFinite) || box[0] > box[2] || box[1] > box[3]) return keys;
  const columns = Math.floor(box[2] / SECTOR) - Math.floor(box[0] / SECTOR) + 1;
  const rows = Math.floor(box[3] / SECTOR) - Math.floor(box[1] / SECTOR) + 1;
  if (columns * rows > 4096) return undefined;
  for (let y = Math.floor(box[1] / SECTOR); y <= Math.floor(box[3] / SECTOR); y++) {
    for (let x = Math.floor(box[0] / SECTOR); x <= Math.floor(box[2] / SECTOR); x++) keys.push(`${x},${y}`);
  }
  return keys;
}

/** Transport batches preserve input order, per-instance seeds and native decisions.
 * Earlier batches remain exact supplied neighbours; this adapter chooses no geometry.
 * Bodies, courts, circulation and structures all participate, as in native place_batch.
 */
export async function placeArchitectureBatches(input: PlacementBatchRequest,
  place: (batch: PlacementBatchRequest) => Promise<PlacementBatch>,
  options: { cancelled?(): boolean; progress?(completed: number, total: number): void } = {},
): Promise<PlacementBatch> {
  const seen = new Set<string>();
  for (const request of input.requests) {
    if (seen.has(request.id)) throw new Error(`Duplicate architecture request: ${request.id}`);
    seen.add(request.id);
  }
  const cells = new Map<string, { box: Bounds; neighbor: ArchitectureNeighbor }[]>();
  const all: { box: Bounds; neighbor: ArchitectureNeighbor }[] = [], wide: typeof all = [];
  const insert = (building: PlacedBuilding): void => {
    const surfaces = [building.footprint, building.courtyards, building.circulation, ...building.structural_features.map(f => f.surface)];
    for (let i = 0; i < surfaces.length; i++) {
      if (!surfaces[i].length) continue;
      const box = bounds(surfaces[i]), height = Math.max(0, ...building.volumes.map(v => v.z_m + v.wall_height_m + v.roof_height_m - building.ground_z_m));
      const entry = { box, neighbor: { id: `${building.id}/occupation/${i}`, footprint: surfaces[i], height_m: height } };
      all.push(entry);
      const keys = sectorKeys(box);
      if (!keys) { wide.push(entry); continue; }
      for (const key of keys) {
        const list = cells.get(key); if (list) list.push(entry); else cells.set(key, [entry]);
      }
    }
  };
  const withNeighbors = (request: PlacementRequest): PlacementRequest => {
    const box = bounds(request.cadastral), local = new Set<ArchitectureNeighbor>();
    const keys = sectorKeys(box);
    for (const entry of keys ? wide : all) if (overlaps(box, entry.box)) local.add(entry.neighbor);
    for (const key of keys ?? []) for (const entry of cells.get(key) ?? []) if (overlaps(box, entry.box)) local.add(entry.neighbor);
    return local.size ? { ...request, neighbors: [...request.neighbors, ...local] } : request;
  };
  let result: PlacementBatch | undefined;
  const materials = new Map<string, NonNullable<PlacementBatch['materials']>[number]>();
  let offset = 0;
  do {
    if (options.cancelled?.()) throw new DOMException('Calcul remplacé', 'AbortError');
    const requests: PlacementRequest[] = [];
    let bytes = 0;
    while (offset + requests.length < input.requests.length && requests.length < BATCH_SIZE) {
      const request = withNeighbors(input.requests[offset + requests.length]);
      const size = new TextEncoder().encode(JSON.stringify(request)).byteLength;
      if (requests.length && bytes + size > MAX_INPUT_BYTES) break;
      if (size > MAX_INPUT_BYTES) throw new Error(`Architecture request ${request.id} exceeds the native transport budget.`);
      requests.push(request); bytes += size;
    }
    let batch: PlacementBatch;
    for (;;) {
      try { batch = await place({ ...input, requests }); break; }
      catch (error) {
        // Placement is a stateless native call. Retrying a smaller prefix has
        // exactly the same seeds and neighbours and commits no failed output.
        if (requests.length < 2 || !/\[output_budget\]|Architecture response exceeds 64 MiB/.test(String(error))) throw error;
        requests.splice(Math.max(1, Math.floor(requests.length / 2)));
        if (options.cancelled?.()) throw new DOMException('Calcul remplacé', 'AbortError');
      }
    }
    if (options.cancelled?.()) throw new DOMException('Calcul remplacé', 'AbortError');
    if (!result) result = { ...batch, buildings: [], refusals: [], open_spaces: [] };
    else if (result.generator_version !== batch.generator_version || result.schema_version !== batch.schema_version) throw new Error('Architecture engine changed during placement.');
    for (const material of batch.materials ?? []) materials.set(material.id, material);
    result.buildings.push(...batch.buildings); result.refusals.push(...batch.refusals); result.open_spaces.push(...batch.open_spaces);
    for (const building of batch.buildings) insert(building);
    offset += requests.length;
    options.progress?.(offset, input.requests.length);
  } while (offset < input.requests.length);
  if (materials.size) result.materials = [...materials.values()];
  return result;
}
