/** Versioned CITY parent stream. Single means a genuine legacy native plan,
 * not a one-body inventory or an architectural grammar. Archives are authority. */
import type { ArchitectureProgramme, PlacementBatch, PlacementBatchRequest, PlacedBuilding } from './urbanArchitecture';
import type { HouseBatch, Surface } from './housesContract';
import type { AssemblyAttemptReport, RetainedNativeAssembly, RealizedNativeAssembly } from './nativeAssemblyContract';
export const NATIVE_PARENT_CAPABILITY = 'houses.native-parent-batch-1';
export const NATIVE_PARENT_SCHEMA = 'native-parent-batch-1';
export const NATIVE_PARENT_ARCHIVE = 'native-parent-archive-1';
export type NativeParentPlan = { kind: 'single'; programme: ArchitectureProgramme | null; building: PlacedBuilding }
  | { kind: 'assembly'; assembly: RetainedNativeAssembly };
export interface NativeParentArchive { format: typeof NATIVE_PARENT_ARCHIVE; sha256: string; payload: unknown }
export interface NativeParentRecord { plan: NativeParentPlan; archive: NativeParentArchive; attempt: AssemblyAttemptReport | null }
export interface ParentMemberCounts { admitted_parents: number; single_parents: number; assembly_parents: number; physical_members: number }
export interface NativeParentCounts extends ParentMemberCounts { requests: number; refusals: number; open_spaces: number }
export interface PriorParentOccupation { land_parts: Surface[]; roof_parts: Surface[] }
export interface NativeParentRequest { schema_version: typeof NATIVE_PARENT_SCHEMA;
  batch: PlacementBatchRequest & { footprints?: Record<string, Surface> }; prior_occupation: PriorParentOccupation }
export interface NativeParentBatch { schema_version: typeof NATIVE_PARENT_SCHEMA; generator_version: string;
  parents: NativeParentRecord[]; refusals: PlacementBatch['refusals']; open_spaces: PlacementBatch['open_spaces'];
  materials: NonNullable<PlacementBatch['materials']>; counts: NativeParentCounts }
export interface UnpackedParentBatch { schema_version: typeof NATIVE_PARENT_SCHEMA; plans: NativeParentPlan[]; counts: ParentMemberCounts }
export type RealizedParent = { kind: 'single'; building_id: string; ground_z_m: number; architecture: HouseBatch }
  | { kind: 'assembly'; assembly: RealizedNativeAssembly };
export interface NativeParentApi {
  /** Fresh capability list parent+pair+Std and coherent pair getter, before source reads. */
  require(): Promise<void>;
  plan(input: NativeParentRequest): Promise<NativeParentBatch>;
  unpack(archive: NativeParentArchive): Promise<NativeParentPlan>;
  unpackBatch(archives: NativeParentArchive[]): Promise<UnpackedParentBatch>;
  realize(archive: NativeParentArchive, interiors?: boolean): Promise<RealizedParent>;
}
export const parentIdentity = (plan: NativeParentPlan): { id: string; parcel_id: string } =>
  plan.kind === 'single' ? plan.building : plan.assembly;
export function parentCounts(plans: readonly NativeParentPlan[]): ParentMemberCounts {
  return { admitted_parents: plans.length, single_parents: plans.filter(p => p.kind === 'single').length,
    assembly_parents: plans.filter(p => p.kind === 'assembly').length,
    physical_members: plans.reduce((n, p) => n + (p.kind === 'single' ? 1 : p.assembly.members.length), 0) };
}
export function validateParentCounts(counts: ParentMemberCounts, plans: readonly NativeParentPlan[]): void {
  const actual = parentCounts(plans);
  for (const key of Object.keys(actual) as (keyof ParentMemberCounts)[])
    if (!Number.isSafeInteger(counts?.[key]) || counts[key] !== actual[key]) throw new Error(`Native parent count mismatch: ${key}.`);
}
export function validateParentBatch(batch: NativeParentBatch, requests?: readonly { id: string; parcel_id: string }[]): void {
  if (batch?.schema_version !== NATIVE_PARENT_SCHEMA || typeof batch.generator_version !== 'string' || !batch.generator_version
    || !Array.isArray(batch.parents) || batch.parents.length > 64 || !Array.isArray(batch.refusals)
    || !Array.isArray(batch.open_spaces) || !Array.isArray(batch.materials)) throw new Error('Invalid native parent batch.');
  const ids = new Set<string>(), memberIds = new Set<string>();
  for (const record of batch.parents) {
    if (record?.plan?.kind !== 'single' && record?.plan?.kind !== 'assembly') throw new Error('Unknown native parent kind.');
    const p = parentIdentity(record.plan);
    if (typeof p.id !== 'string' || !p.id || typeof p.parcel_id !== 'string' || ids.has(p.id)) throw new Error('Invalid/duplicate native parent identity.');
    ids.add(p.id);
    if (record.archive?.format !== NATIVE_PARENT_ARCHIVE || !/^[a-f0-9]{64}$/.test(record.archive.sha256)
      || !record.archive.payload || typeof record.archive.payload !== 'object') throw new Error('Missing native authoritative parent archive.');
    const members = record.plan.kind === 'single' ? [record.plan.building] : record.plan.assembly.members.map(m => m.plan);
    if (record.plan.kind === 'assembly' && (record.plan.assembly.capability !== 'native-assembly-pair-1' || members.length !== 2))
      throw new Error('Unsupported native assembly member contract.');
    for (const member of members) {
      if (!member.id || memberIds.has(member.id) || member.parcel_id !== p.parcel_id) throw new Error('Invalid/duplicate native member identity.');
      memberIds.add(member.id);
    }
  }
  validateParentCounts(batch.counts, batch.parents.map(p => p.plan));
  const c = batch.counts;
  if (![c.requests, c.refusals, c.open_spaces].every(n => Number.isSafeInteger(n) && n >= 0)
    || c.requests > 64 || c.refusals !== batch.refusals.length || c.open_spaces !== batch.open_spaces.length
    || c.admitted_parents + c.refusals + c.open_spaces !== c.requests) throw new Error('Native parent request accounting mismatch.');
  const issues = [...batch.parents.map(r => parentIdentity(r.plan)), ...batch.refusals, ...batch.open_spaces];
  const seen = new Set<string>();
  for (const issue of issues) {
    if (!issue.id || seen.has(issue.id)) throw new Error('Duplicate/missing native request outcome.');
    seen.add(issue.id);
    if (requests && !requests.some(r => r.id === issue.id && r.parcel_id === issue.parcel_id)) throw new Error('Native parent issue does not match source request.');
  }
  if (requests && (requests.length !== c.requests || seen.size !== requests.length)) throw new Error('Incomplete native parent request coverage.');
}
