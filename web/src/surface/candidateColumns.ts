import type { SurfaceCandidate } from './model';
import { SURFACE_MAX_CANDIDATES } from './limits';

export const CANDIDATE_COLUMN_FORMAT = 'surface-candidate-columns' as const;
export const CANDIDATE_COLUMN_VERSION = 1 as const;
export const CANDIDATE_FAMILIES: readonly SurfaceCandidate['family'][] = ['tree', 'shrub', 'boulder', 'grass', 'debris'];
const MAX_COUNT = SURFACE_MAX_CANDIDATES, MAX_IDS_JSON_BYTES = 8 * 1024 ** 2;
const MAX_F32_RANK = 1 - 2 ** -24;
export interface CandidateColumns {
  format: typeof CANDIDATE_COLUMN_FORMAT; version: typeof CANDIDATE_COLUMN_VERSION; count: number;
  ids: string[]; families: SurfaceCandidate['family'][]; family: Uint8Array;
  /** Interleaved canonical x, altitude y, z, in float64 metres. */
  positions: Float64Array;
  size: Float32Array; orientation: Float32Array; rank: Float32Array; variant: Uint8Array;
  /** Physical metres; NaN means the optional source crown radius was absent. */
  crownRadiusM: Float32Array;
  precision: { positions: 'float64-metres'; size: 'float32-metres'; orientation: 'float32-radians'; rank: 'float32-[0,1)' };
}
const precision: CandidateColumns['precision'] = { positions: 'float64-metres', size: 'float32-metres', orientation: 'float32-radians', rank: 'float32-[0,1)' };
function fail(message: string): never { throw new Error(`Invalid candidate columns: ${message}`); }
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
function f32(value: number, label: string): number {
  const result = Math.fround(value);
  if (!Number.isFinite(result)) fail(`${label} overflows float32`);
  return result;
}
function checkIds(ids: unknown, count: number): asserts ids is string[] {
  if (!Array.isArray(ids) || ids.length !== count) fail('id count');
  const unique = new Set<string>();
  for (const id of ids) {
    if (typeof id !== 'string' || !id.length || unique.has(id)) fail('ids must be nonempty unique strings');
    unique.add(id);
  }
  // IDs stay strings for neutral consumers. Bound their manifest contribution;
  // the substantially larger numeric payload is always out-of-line typed data.
  if (new TextEncoder().encode(JSON.stringify(ids)).byteLength > MAX_IDS_JSON_BYTES) fail('id manifest exceeds 8 MiB budget');
}
export function packCandidateColumns(candidates: readonly SurfaceCandidate[]): CandidateColumns {
  const count = candidates.length;
  if (!Number.isInteger(count) || count > MAX_COUNT) fail('candidate count exceeds budget');
  const result: CandidateColumns = { format: CANDIDATE_COLUMN_FORMAT, version: CANDIDATE_COLUMN_VERSION, count,
    ids: candidates.map(c => c.stableId), families: [...CANDIDATE_FAMILIES], family: new Uint8Array(count), positions: new Float64Array(count * 3),
    size: new Float32Array(count), orientation: new Float32Array(count), rank: new Float32Array(count), variant: new Uint8Array(count),
    crownRadiusM: new Float32Array(count).fill(NaN), precision: { ...precision } };
  checkIds(result.ids, count);
  for (let i = 0; i < count; i++) {
    const c = candidates[i], family = CANDIDATE_FAMILIES.indexOf(c.family);
    if (family < 0 || ![c.x, c.y, c.z, c.size, c.orientation, c.rank].every(finite) || c.size <= 0
      || c.rank < 0 || c.rank >= 1 || !Number.isInteger(c.variant) || c.variant < 0 || c.variant > 255) fail(`record ${i}`);
    result.family[i] = family; result.positions.set([c.x, c.y, c.z], i * 3);
    result.size[i] = f32(c.size, 'size'); result.orientation[i] = f32(c.orientation, 'orientation');
    if (!(result.size[i] > 0)) fail('size underflows float32');
    result.rank[i] = Math.min(MAX_F32_RANK, Math.fround(c.rank)); result.variant[i] = c.variant;
    if (c.crownRadiusM !== undefined) {
      if (!finite(c.crownRadiusM) || c.crownRadiusM <= 0) fail('crown radius');
      result.crownRadiusM[i] = f32(c.crownRadiusM, 'crown radius');
      if (!(result.crownRadiusM[i] > 0)) fail('crown radius underflows float32');
    }
  }
  return result;
}

export function validateCandidateColumns(value: unknown): asserts value is CandidateColumns {
  if (!value || typeof value !== 'object') fail('expected object');
  const c = value as CandidateColumns, n = c.count;
  if (c.format !== CANDIDATE_COLUMN_FORMAT || c.version !== CANDIDATE_COLUMN_VERSION || !Number.isInteger(n) || n < 0 || n > MAX_COUNT) fail('format, version or count');
  checkIds(c.ids, n);
  if (!Array.isArray(c.families) || !c.families.length || c.families.length > 256 || new Set(c.families).size !== c.families.length
    || c.families.some(f => !CANDIDATE_FAMILIES.includes(f))) fail('family table');
  if (!(c.family instanceof Uint8Array) || c.family.length !== n || !(c.positions instanceof Float64Array) || c.positions.length !== n * 3
    || !(c.size instanceof Float32Array) || c.size.length !== n || !(c.orientation instanceof Float32Array) || c.orientation.length !== n
    || !(c.rank instanceof Float32Array) || c.rank.length !== n || !(c.variant instanceof Uint8Array) || c.variant.length !== n
    || !(c.crownRadiusM instanceof Float32Array) || c.crownRadiusM.length !== n) fail('column types or lengths');
  if (!c.precision || Object.entries(precision).some(([key, value]) => c.precision[key as keyof typeof precision] !== value)) fail('precision declaration');
  for (let i = 0; i < n; i++) {
    if (c.family[i] >= c.families.length || ![c.positions[i * 3], c.positions[i * 3 + 1], c.positions[i * 3 + 2], c.size[i], c.orientation[i], c.rank[i]].every(Number.isFinite)
      || c.size[i] <= 0 || c.rank[i] < 0 || c.rank[i] >= 1 || !Number.isNaN(c.crownRadiusM[i]) && (!Number.isFinite(c.crownRadiusM[i]) || c.crownRadiusM[i] <= 0)) fail(`column value ${i}`);
  }
}
export function unpackCandidateColumns(value: unknown): SurfaceCandidate[] {
  validateCandidateColumns(value);
  const result: SurfaceCandidate[] = [];
  for (let i = 0; i < value.count; i++) result.push({ stableId: value.ids[i], family: value.families[value.family[i]],
    x: value.positions[i * 3], y: value.positions[i * 3 + 1], z: value.positions[i * 3 + 2], size: value.size[i], orientation: value.orientation[i],
    rank: value.rank[i], variant: value.variant[i], ...(Number.isNaN(value.crownRadiusM[i]) ? {} : { crownRadiusM: value.crownRadiusM[i] }) });
  return result;
}
