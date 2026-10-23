import type { Surface } from './housesContract';
import type { ArchitectureNeighbor, PlacementBatch, PlacementBatchRequest, PlacementRequest, PlacedBuilding } from './urbanArchitecture';
import { registerPlanArchives } from './compactPlanArchive';

export interface ArchitectureBatchProgress {
  /** Input request interval covered by this successful native chunk. */
  start: number;
  completed: number;
  total: number;
}
export interface ArchitectureBatchOptions {
  cancelled?(): boolean;
  progress?(completed: number, total: number): void;
  /** Independent snapshot of this chunk only, including archives/materials.
   * Published once after native success and archival (for planUrbanBuildings),
   * never for a failed transport retry. Awaited for consumer backpressure.
   * The adapter never mutates this snapshot. Consumer mutation cannot affect
   * subsequent generation. A worker receiver must register transferred archives.
   * Empty input retains the native metadata call and publishes its empty chunk.
   */
  onBatch?(delta: PlacementBatch, progress: ArchitectureBatchProgress,
    /** Original sites for this interval, before adding earlier-batch neighbours.
     * Read-only; source geometry is not copied just to expose these references. */
    requests: readonly PlacementRequest[]): void | Promise<void>;
}

/** Completion of an explicit stream, not an empty collected PlacementBatch.
 * Plans, materials and archives belong to the acknowledged chunks/consumer. */
export interface ArchitectureStreamSummary {
  schema_version: PlacementBatch['schema_version'];
  generator_version: PlacementBatch['generator_version'];
  buildings: number;
  refusals: number;
  open_spaces: number;
}
export type ArchitectureStreamOptions = ArchitectureBatchOptions & {
  onBatch: NonNullable<ArchitectureBatchOptions['onBatch']>;
};

/** A revision-bound source must return the next contiguous prefix, with at most
 * `limit` sites whose combined serialized UTF-8 size fits `maxBytes`. It can
 * return [] when the next site does not fit the remaining budget; the adapter
 * then publishes its pending prefix before reading that same offset again.
 * An empty page at the full budget is an error, including an oversized site.
 * Already-resident arrays may return references without respecting maxBytes:
 * they allocate no fetched geometry and the adapter still bounds native chunks.
 */
export interface ArchitectureRequestSource {
  total: number;
  read(offset: number, limit: number, maxBytes: number): Promise<readonly PlacementRequest[]>;
}
export type ArchitectureBatchHeader = Omit<PlacementBatchRequest, 'requests'> & { footprints?: Record<string, Surface> };

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
export async function placeArchitectureBatches(input: PlacementBatchRequest & { footprints?: Record<string, Surface> },
  place: (batch: PlacementBatchRequest) => Promise<PlacementBatch>,
  options: ArchitectureBatchOptions = {},
): Promise<PlacementBatch> {
  const { requests, ...header } = input;
  return placeArchitectureSource(header, arraySource(requests), place, options);
}

function arraySource(requests: PlacementRequest[]): ArchitectureRequestSource {
  const seen = new Set<string>();
  for (const request of requests) {
    if (seen.has(request.id)) throw new Error(`Duplicate architecture request: ${request.id}`);
    seen.add(request.id);
  }
  return { total: requests.length, read: async (offset, limit) => requests.slice(offset, offset + limit) };
}

/** Explicit non-collecting array stream. Only exact occupation surfaces needed
 * by later native batches survive the consumer ACK, never full plans/archives. */
export async function streamArchitectureBatches(input: PlacementBatchRequest & { footprints?: Record<string, Surface> },
  place: (batch: PlacementBatchRequest) => Promise<PlacementBatch>, options: ArchitectureStreamOptions,
): Promise<ArchitectureStreamSummary> {
  const { requests, ...header } = input;
  return streamArchitectureSource(header, arraySource(requests), place, options);
}

/** One placement context across every source page. Starting a separate placement
 * per page would discard previous buildings and permit inter-page collisions. */
export async function placeArchitectureSource(input: ArchitectureBatchHeader,
  source: ArchitectureRequestSource, place: (batch: PlacementBatchRequest) => Promise<PlacementBatch>,
  options: ArchitectureBatchOptions = {},
): Promise<PlacementBatch> {
  return (await runArchitectureSource(input, source, place, options, true)).scene!;
}

/** Future paged sources use this same continuous neighbour/seed/ACK context. */
export async function streamArchitectureSource(input: ArchitectureBatchHeader,
  source: ArchitectureRequestSource, place: (batch: PlacementBatchRequest) => Promise<PlacementBatch>,
  options: ArchitectureStreamOptions,
): Promise<ArchitectureStreamSummary> {
  if (typeof options?.onBatch !== 'function') throw new Error('Architecture streaming requires a batch consumer.');
  return (await runArchitectureSource(input, source, place, options, false)).summary;
}

async function runArchitectureSource(input: ArchitectureBatchHeader,
  source: ArchitectureRequestSource, place: (batch: PlacementBatchRequest) => Promise<PlacementBatch>,
  options: ArchitectureBatchOptions, collect: boolean,
): Promise<{ scene?: PlacementBatch; summary: ArchitectureStreamSummary }> {
  const total = source.total;
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('Invalid architecture source length.');
  const seen = new Set<string>(), pending: PlacementRequest[] = [];
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
  let summary: ArchitectureStreamSummary | undefined;
  const materials = collect ? new Map<string, NonNullable<PlacementBatch['materials']>[number]>() : undefined;
  let offset = 0;
  do {
    if (options.cancelled?.()) throw new DOMException('Calcul remplacé', 'AbortError');
    // Budget retained pages before fetching another one, not only once 64 sites
    // have accumulated. Measure each enriched candidate once in this placement
    // context; a successful chunk changes neighbours, so leftovers are measured
    // again next iteration. Stop at the first overflowing candidate even when an
    // already-resident array supplied many more references in its single page.
    const prepared: { request: PlacementRequest; size: number }[] = [];
    let bufferedBytes = 0;
    const preparePending = (): void => {
      while (prepared.length < pending.length && bufferedBytes < MAX_INPUT_BYTES) {
        const request = withNeighbors(pending[prepared.length]);
        const size = new TextEncoder().encode(JSON.stringify(request)).byteLength;
        prepared.push({ request, size }); bufferedBytes += size;
      }
    };
    preparePending();
    while (pending.length < BATCH_SIZE && offset + pending.length < total && bufferedBytes < MAX_INPUT_BYTES) {
      const limit = Math.min(BATCH_SIZE - pending.length, total - offset - pending.length);
      const page = await source.read(offset + pending.length, limit, MAX_INPUT_BYTES - bufferedBytes);
      if (options.cancelled?.()) throw new DOMException('Calcul remplacé', 'AbortError');
      if (!Array.isArray(page) || page.length > limit) throw new Error('Invalid or empty architecture source page.');
      if (!page.length) {
        if (pending.length) break;
        throw new Error('Invalid or empty architecture source page.');
      }
      for (const request of page) {
        if (seen.has(request.id)) throw new Error(`Duplicate architecture request: ${request.id}`);
        seen.add(request.id); pending.push(request);
      }
      preparePending();
    }
    const requests: PlacementRequest[] = [];
    let bytes = 0;
    for (const { request, size } of prepared) {
      if (requests.length && bytes + size > MAX_INPUT_BYTES) break;
      if (size > MAX_INPUT_BYTES) throw new Error(`Architecture request ${request.id} exceeds the native transport budget.`);
      requests.push(request); bytes += size;
    }
    let batch: PlacementBatch;
    for (;;) {
      try {
        const chunk = { ...input, requests };
        if (input.footprints) chunk.footprints = Object.fromEntries(requests.filter(r => input.footprints![r.id]).map(r => [r.id, input.footprints![r.id]]));
        const payloadBytes = new TextEncoder().encode(JSON.stringify(chunk)).byteLength;
        if (payloadBytes > MAX_INPUT_BYTES) {
          if (requests.length < 2) throw new Error(`Architecture request ${requests[0]?.id ?? ''} including its imposed footprint exceeds the native transport budget.`);
          requests.splice(Math.max(1, Math.floor(requests.length / 2))); continue;
        }
        batch = await place(chunk); break;
      }
      catch (error) {
        // Placement is a stateless native call. Retrying a smaller prefix has
        // exactly the same seeds and neighbours and commits no failed output.
        if (requests.length < 2 || !/\[output_budget\]|Architecture response exceeds 64 MiB/.test(String(error))) throw error;
        requests.splice(Math.max(1, Math.floor(requests.length / 2)));
        if (options.cancelled?.()) throw new DOMException('Calcul remplacé', 'AbortError');
      }
    }
    if (options.cancelled?.()) throw new DOMException('Calcul remplacé', 'AbortError');
    if (!summary) summary = { schema_version: batch.schema_version, generator_version: batch.generator_version,
      buildings: 0, refusals: 0, open_spaces: 0 };
    else if (summary.generator_version !== batch.generator_version || summary.schema_version !== batch.schema_version) throw new Error('Architecture engine changed during placement.');
    summary.buildings += batch.buildings.length; summary.refusals += batch.refusals.length; summary.open_spaces += batch.open_spaces.length;
    if (collect) {
      if (!result) result = { ...batch, buildings: [], refusals: [], open_spaces: [],
        ...(batch.plan_archives ? { plan_archives: { ...batch.plan_archives } } : {}) };
      for (const material of batch.materials ?? []) materials!.set(material.id, material);
      if (batch.plan_archives) Object.assign(result.plan_archives ??= {}, batch.plan_archives);
      result.buildings.push(...batch.buildings); result.refusals.push(...batch.refusals); result.open_spaces.push(...batch.open_spaces);
    }
    for (const building of batch.buildings) insert(building);
    const start = offset;
    offset += requests.length;
    const originals = pending.splice(0, requests.length);
    if (options.onBatch) {
      // Copy at most this transport chunk, not the growing scene. In particular
      // a UI consumer cannot mutate occupation used by subsequent native calls.
      const delta = structuredClone(batch);
      // Weak archive associations are keyed by resolved references, never by
      // occupation surfaces. No strong scene/archive table exists in this core.
      registerPlanArchives(delta);
      await options.onBatch(delta, { start, completed: offset, total }, originals);
      // Includes the final chunk: superseded work must not commit a stale scene.
      if (options.cancelled?.()) throw new DOMException('Calcul remplacé', 'AbortError');
    }
    options.progress?.(offset, total);
    if (options.cancelled?.()) throw new DOMException('Calcul remplacé', 'AbortError');
  } while (offset < total);
  if (materials?.size) result!.materials = [...materials.values()];
  return { scene: result, summary: summary! };
}
