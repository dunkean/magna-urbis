/** Display children of a validated NATIVE group. Never a PlacedBuilding, never
 * a realization input. Parent programme/outcome is not copied onto members. */
import type { CompactBuildingVisual, BuildingViewport } from '../render/urbanBuildingLod';
import type { NativeMemberPlan, RetainedNativeAssembly } from '../../../rust/bridge/nativeAssemblyContract';
import { buildingSurfaceContains } from '../render/urbanBuildingLod';
import type { Point } from '../../../rust/bridge/housesContract';
export interface NativeAssemblyMemberVisual extends CompactBuildingVisual {
  projection: 'native-assembly-member-visual-1'; nativeRealization: false;
  parent_id: string; member_key: string; member_id: string;
  programme?: never; programme_outcome?: never; useful_area_m2?: never; domestic_units?: never; resolved?: never;
}
export type NativeAssemblySelection = { kind: 'parent'; parent_id: string }
  | { kind: 'member'; parent_id: string; member_key: string; member_id: string };
export function projectNativeAssemblyMember(parentId: string, key: string, plan: NativeMemberPlan): NativeAssemblyMemberVisual {
  return Object.freeze({ projection: 'native-assembly-member-visual-1', nativeRealization: false,
    id: plan.id, parent_id: parentId, member_key: key, member_id: plan.id, function: plan.function,
    footprint: plan.footprint, roof_footprint: plan.roof_footprint, entrance: plan.entrance,
    ground_z_m: plan.ground_z_m, height_m: plan.cartographic.height_m, cartographic: plan.cartographic,
    ...(plan.volumes[0] ? { materials: plan.volumes[0].materials } : {}) });
}
export function nativeAssemblyWindow(native: RetainedNativeAssembly) {
  const members = native.members.map(member => projectNativeAssemblyMember(native.id, member.key, member.plan));
  const bounds: BuildingViewport = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const surface of [...members.flatMap(member => [member.footprint, member.roof_footprint]), ...native.circulation.branches.map(branch => branch.path)])
    for (const shape of surface) for (const ring of [shape.outer, ...shape.holes]) for (const p of ring) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error('Nonfinite assembly visual.');
      bounds.minX = Math.min(bounds.minX, p.x); bounds.minY = Math.min(bounds.minY, p.y);
      bounds.maxX = Math.max(bounds.maxX, p.x); bounds.maxY = Math.max(bounds.maxY, p.y);
    }
  if (!Object.values(bounds).every(Number.isFinite)) throw new Error('Assembly has no native display geometry.');
  return { parent_id: native.id, counts: { parents: 1, members: members.length, bodies: native.members.reduce((n, m) => n + m.plan.volumes.length, 0) },
    scene: { buildings: members }, bounds,
    pick(point: Point): NativeAssemblySelection {
      for (let i = members.length - 1; i >= 0; i--) if (buildingSurfaceContains(members[i].roof_footprint.length ? members[i].roof_footprint : members[i].footprint, point))
        return { kind: 'member', parent_id: native.id, member_key: members[i].member_key, member_id: members[i].member_id };
      return { kind: 'parent', parent_id: native.id };
    } };
}
