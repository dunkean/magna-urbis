/** Whole-parent native detail: bounded queue, one physical request, atomic
 * installation of every real member. No fake PlacedBuilding or capacity0. */
import type { NativeParentApi, RealizedParent } from '../../../rust/bridge/nativeParentContract';
import type { NativeMemberPlan } from '../../../rust/bridge/nativeAssemblyContract';
import type { PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import type { Point, HouseBatch } from '../../../rust/bridge/housesContract';
import type { CompactBuildingVisual } from '../render/urbanBuildingLod';
import { nativeExteriorGeometry } from '../render/urbanBuildingDetails';
import { projectParentRecords, translateParentVisualRecords, type ParentMemberVisual } from './urbanParentVisual';
import type { NativeParentRead } from './urbanParentNativeRead';
export interface ParentDetailEntry { parentId: string; archiveSha256: string; members: { id: string; visual: CompactBuildingVisual }[];
  geometryBytes: number; vertices: number; diagnostics: string[] }
function sameSurface(a: ParentMemberVisual['footprint'], b: ParentMemberVisual['footprint'], offset: Point): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => { const aa = [p.outer, ...p.holes], bb = [b[i].outer, ...b[i].holes];
    return aa.length === bb.length && aa.every((ring, j) => ring.length === bb[j].length && ring.every((q, k) =>
      Object.is(q.x, offset.x ? bb[j][k].x + offset.x : bb[j][k].x) && Object.is(q.y, offset.y ? bb[j][k].y + offset.y : bb[j][k].y)));
  });
}
export function parentDetailEntry(loaded: NativeParentRead, result: RealizedParent, base: readonly ParentMemberVisual[], offset: Point = { x: 0, y: 0 }): ParentDetailEntry {
  const source = loaded.plan;
  const nativeMembers: { key: string | null; plan: NativeMemberPlan | PlacedBuilding; architecture: HouseBatch }[] = [];
  if (source.kind === 'single' && result.kind === 'single') {
    if (result.building_id !== source.building.id || !Object.is(result.ground_z_m, source.building.ground_z_m)) throw new Error('Native parent detail identity/ground changed.');
    nativeMembers.push({ key: null, plan: source.building, architecture: result.architecture });
  } else if (source.kind === 'assembly' && result.kind === 'assembly') {
    if (result.assembly.id !== source.assembly.id || result.assembly.parcel_id !== source.assembly.parcel_id || result.assembly.members.length !== source.assembly.members.length) throw new Error('Native assembly detail is incomplete.');
    for (const m of source.assembly.members) {
      const realized = result.assembly.members.find(r => r.key === m.key && r.member_id === m.plan.id);
      if (!realized || !Object.is(realized.ground_z_m, m.plan.ground_z_m)) throw new Error('Native assembly detail member is missing or changed.');
      nativeMembers.push({ key: m.key, plan: m.plan, architecture: realized.architecture });
    }
  } else throw new Error('Native detail parent kind changed.');
  let geometryBytes = 0, vertices = 0; const members: ParentDetailEntry['members'] = [], diagnostics: string[] = [];
  // Validate/prepare ALL members before returning anything to a renderer.
  for (const m of nativeMembers) {
    const visual = base.find(b => b.parent_id === loaded.record.id && b.member_id === m.plan.id && b.member_key === m.key);
    if (!visual || visual.archive_sha256 !== loaded.archive.sha256 || !sameSurface(visual.footprint, m.plan.footprint, offset)
      || !sameSurface(visual.roof_footprint, m.plan.roof_footprint, offset)) throw new Error('Native member detail differs from indexed child geometry.');
    const detail = nativeExteriorGeometry(m.plan, m.architecture, Math.max(0, 150000 - vertices));
    geometryBytes += detail.geometryBytes; vertices += detail.vertices; diagnostics.push(...detail.diagnostics);
    if (geometryBytes > 16 * 1024 * 1024 || vertices > 150000) throw new Error('Whole parent detail exceeds bounded cache budget.');
    const volumes = detail.volumes.map(v => ({ z_m: v.z_m, wall_height_m: v.wall_height_m, roof_height_m: v.roof_height_m,
      materials: v.materials, roof_system: v.roof_system, roof_mesh: !offset.x && !offset.y ? v.roof_mesh : { ...v.roof_mesh,
        vertices: v.roof_mesh.vertices.map(p => ({ ...p, x: p.x + offset.x, y: p.y + offset.y })) } }));
    members.push({ id: visual.id, visual: { id: visual.id, function: visual.function, footprint: visual.footprint, roof_footprint: visual.roof_footprint,
      entrance: visual.entrance, ground_z_m: visual.ground_z_m, volumes } });
  }
  return { parentId: loaded.record.id, archiveSha256: loaded.archive.sha256, members, geometryBytes, vertices, diagnostics };
}
let physicalParentDetails = 0;
const waiters = new Set<() => void>();
export function createParentDetailController(api: NativeParentApi, read: (id: string) => Promise<NativeParentRead>, options: {
  offset?: Point; members(): readonly ParentMemberVisual[]; install(value: ParentDetailEntry): void; remove?(value: ParentDetailEntry): void; changed?(): void;
}) {
  const queued: string[] = [], known = new Set<string>(), failed = new Map<string, string>();
  const cache = new Map<string, ParentDetailEntry>(); let disposed = false, suspended = false, inFlight = false, epoch = 0, bytes = 0, vertices = 0;
  async function pump() {
    if (disposed || suspended || inFlight || physicalParentDetails >= 1 || !queued.length) return;
    const id = queued.shift()!, own = epoch; inFlight = true; physicalParentDetails++;
    try {
      const loaded = await read(id); if (disposed || own !== epoch || suspended) { known.delete(id); return; }
      const result = await api.realize(loaded.archive, false); if (disposed || own !== epoch) return;
      const projected = projectParentRecords([{ plan: loaded.plan, archive: loaded.archive, attempt: loaded.record.attempt }]);
      const offset = options.offset ?? { x: 0, y: 0 }, nativeViews = translateParentVisualRecords(projected, offset.x, offset.y).members;
      const current = options.members(), bases = nativeViews.map(m => current.find(v => v.member_id === m.member_id && v.parent_id === m.parent_id) ?? m);
      const entry = parentDetailEntry(loaded, result, bases, offset);
      while (cache.size && (cache.size >= 32 || bytes + entry.geometryBytes > 16 * 1024 * 1024 || vertices + entry.vertices > 150000)) {
        const first = cache.keys().next().value!; const old = cache.get(first)!; cache.delete(first); options.remove?.(old); bytes -= old.geometryBytes; vertices -= old.vertices; known.delete(first);
      }
      if (disposed || own !== epoch) return; cache.set(id, entry); bytes += entry.geometryBytes; vertices += entry.vertices; options.install(entry);
    } catch (error) { if (!disposed && own === epoch) { known.delete(id); failed.set(id, String(error).slice(0, 4000)); while (failed.size > 128) failed.delete(failed.keys().next().value!); } }
    finally { inFlight = false; physicalParentDetails--; if (!disposed) options.changed?.(); for (const waiter of waiters) waiter(); }
  }
  const wake = () => { void pump(); }; waiters.add(wake);
  return {
    suspend() { suspended = true; for (const id of queued) known.delete(id); queued.length = 0; },
    resume() { suspended = false; void pump(); },
    request(id: string) { if (!disposed && !suspended && !known.has(id) && !failed.has(id) && queued.length < 16) { known.add(id); queued.push(id); void pump(); } },
    get(id: string) { return cache.get(id); },
    status(id: string) { return failed.get(id) ?? (cache.has(id) ? 'ready' : known.has(id) ? 'pending' : 'idle'); },
    get stats() { return { inFlight: Number(inFlight), globalInFlight: physicalParentDetails, queued: queued.length, cachedParents: cache.size, bytes, vertices }; },
    dispose() { disposed = true; epoch++; queued.length = 0; known.clear(); for (const entry of cache.values()) options.remove?.(entry); cache.clear(); bytes = vertices = 0; waiters.delete(wake); },
  };
}

export function detailForCurrentMember(entry: ParentDetailEntry, current: ParentMemberVisual): CompactBuildingVisual | undefined {
  if (entry.parentId !== current.parent_id || entry.archiveSha256 !== current.archive_sha256) return;
  const detail = entry.members.find(m => m.id === current.member_id)?.visual;
  if (!detail || !sameSurface(detail.footprint, current.footprint, { x: 0, y: 0 }) || !sameSurface(detail.roof_footprint, current.roof_footprint, { x: 0, y: 0 })) return;
  return { ...detail, footprint: current.footprint, roof_footprint: current.roof_footprint };
}
