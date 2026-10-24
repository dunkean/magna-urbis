/** Disposable visual children of real archived parents. This is NEVER a native
 * Single/assembly input, never a household/surface capacity approximation. */
import type { NativeParentRecord, NativeParentPlan } from '../../../rust/bridge/nativeParentContract';
import { parentIdentity } from '../../../rust/bridge/nativeParentContract';
import type { ArchitectureProgramme, ArchitectureCulture, PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import type { NativeMemberPlan, AssemblyProgrammeOutcome } from '../../../rust/bridge/nativeAssemblyContract';
import type { HouseMaterial, Surface, Point } from '../../../rust/bridge/housesContract';
import type { CompactBuildingVisual } from '../render/urbanBuildingLod';
import { retainedProgrammeOutcome, type RetainedProgrammeOutcome } from '../render/programmeOutcome';
export const PARENT_VISUAL_VERSION = 'native-parent-visual-1';
export interface ParentMemberVisual extends CompactBuildingVisual {
  projection: typeof PARENT_VISUAL_VERSION; nativeRealization: false;
  parent_id: string; member_id: string; member_key: string | null; parcel_id: string;
  recipe_id: string; variant_id: string; culture: ArchitectureCulture; archive_sha256: string;
  body_count: number; listed_level_count: number;
  programme?: never; programme_outcome?: never; useful_area_m2?: never; domestic_units?: never; resolved?: never;
}
export interface ParentContextVisual { parent_id: string; key: string; native_id: string | null;
  kind: 'legacy_circulation' | 'member_feature' | 'branch' | 'native_passage' | 'shared_context';
  surface: Surface; material?: string }
export interface ParentVisualSummary { id: string; parcel_id: string; native_kind: NativeParentPlan['kind']; archive_sha256: string;
  programme: ArchitectureProgramme | null; programme_outcome: RetainedProgrammeOutcome | null;
  assembly_outcome: Omit<AssemblyProgrammeOutcome, 'planes'> | null;
  /** Inventory counts only, never morphology/grammar or residential households. */
  assembly_attempt: { reason: string; errors: string[] } | null;
  member_count: number; body_count: number; listed_level_count: number }
export interface ParentVisualRecords { version: typeof PARENT_VISUAL_VERSION; members: ParentMemberVisual[];
  parents: ParentVisualSummary[]; contexts: ParentContextVisual[]; materials: HouseMaterial[] }
function memberVisual(parentId: string, key: string | null, p: NativeMemberPlan | PlacedBuilding, archiveSha: string): ParentMemberVisual {
  const cartographic = p.cartographic, height = cartographic?.height_m ?? p.volumes.reduce((n, v) => Math.max(n, v.z_m + v.wall_height_m + v.roof_height_m - p.ground_z_m), 0);
  if (![height, p.ground_z_m].every(Number.isFinite)) throw new Error('Invalid native member cartography.');
  const materials = p.volumes[0]?.materials;
  return { projection: PARENT_VISUAL_VERSION, nativeRealization: false, id: p.id, member_id: p.id, parent_id: parentId,
    member_key: key, parcel_id: p.parcel_id, archive_sha256: archiveSha, recipe_id: p.recipe_id, variant_id: p.variant_id,
    culture: { ...p.culture }, function: p.function, footprint: p.footprint, roof_footprint: p.roof_footprint, entrance: { ...p.entrance },
    ground_z_m: p.ground_z_m, height_m: height, body_count: p.volumes.length, listed_level_count: p.volumes.reduce((n, v) => n + v.levels.length, 0),
    ...(cartographic ? { cartographic: { height_m: cartographic.height_m, ridges: cartographic.ridges, ...(cartographic.roof_system ? { roof_system: cartographic.roof_system } : {}) } } : {}),
    ...(materials ? { materials: { ...materials } } : {}) };
}
export function projectParentRecords(records: readonly NativeParentRecord[], catalogue: readonly HouseMaterial[] = []): ParentVisualRecords {
  const members: ParentMemberVisual[] = [], parents: ParentVisualSummary[] = [], contexts: ParentContextVisual[] = [];
  for (const record of records) {
    const p = record.plan, identity = parentIdentity(p), first = members.length;
    const addContext = (key: string, kind: ParentContextVisual['kind'], surface: Surface, native_id: string | null, material?: string) => {
      if (surface.length) contexts.push({ parent_id: identity.id, key, kind, surface, native_id, ...(material ? { material } : {}) });
    };
    const addMember = (key: string | null, member: NativeMemberPlan | PlacedBuilding) => {
      members.push(memberVisual(identity.id, key, member, record.archive.sha256));
      member.structural_features.forEach((f, i) => addContext(`${key ?? 'legacy'}:feature:${i}`, 'member_feature', f.surface, f.id, f.material));
    };
    if (p.kind === 'single') { addMember(null, p.building); addContext('legacy:circulation', 'legacy_circulation', p.building.circulation, p.building.access_id); }
    else {
      p.assembly.members.forEach(m => addMember(m.key, m.plan));
      p.assembly.circulation.branches.forEach((branch, i) => {
        addContext(`branch:${i}`, 'branch', branch.path, branch.id);
        addContext(`native-passage:${i}`, 'native_passage', branch.native_passage, branch.id);
      });
      p.assembly.shared_context.forEach((f, i) => addContext(`shared-context:${i}`, 'shared_context', f.surface, f.id, f.material));
    }
    const own = members.slice(first);
    const assemblyOutcome = p.kind === 'assembly' ? (({ planes: _planes, ...reported }) => reported)(p.assembly.outcome) : null;
    parents.push({ id: identity.id, parcel_id: identity.parcel_id, native_kind: p.kind, archive_sha256: record.archive.sha256,
      programme: p.kind === 'single' ? p.programme : p.assembly.programme,
      programme_outcome: p.kind === 'single' ? retainedProgrammeOutcome(p.building.programme_outcome) : null,
      assembly_outcome: assemblyOutcome, assembly_attempt: record.attempt ? { reason: record.attempt.reason, errors: [...record.attempt.errors] } : null, member_count: own.length,
      body_count: own.reduce((n, v) => n + v.body_count, 0), listed_level_count: own.reduce((n, v) => n + v.listed_level_count, 0) });
  }
  // Preserve native material metadata for auxiliary bodies/facets too; the
  // first cartographic body slots are not an inventory of detailed materials.
  const materials = catalogue.map(m => ({ ...m, roles: [...m.roles] }));
  return { version: PARENT_VISUAL_VERSION, members, parents, contexts, materials };
}

export function translateParentVisualRecords(data: ParentVisualRecords, dx: number, dy: number): ParentVisualRecords {
  if (!dx && !dy) return data;
  const point = (p: Point) => ({ x: p.x + dx, y: p.y + dy });
  const surface = (s: Surface) => s.map(p => ({ outer: p.outer.map(point), holes: p.holes.map(h => h.map(point)) }));
  return { ...data, members: data.members.map(m => ({ ...m, footprint: surface(m.footprint), roof_footprint: surface(m.roof_footprint),
    ...(m.entrance ? { entrance: point(m.entrance) } : {}), ...(m.cartographic ? { cartographic: { ...m.cartographic,
      ridges: m.cartographic.ridges.map(([a, b]) => [point(a), point(b)] as const) } } : {}) })), contexts: data.contexts.map(c => ({ ...c, surface: surface(c.surface) })) };
}
