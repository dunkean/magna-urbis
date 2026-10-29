/** Exact child cartography of a bounded native parent window. No Single DTO,
 * synthetic capacity, source archive, or native realization input is created. */
import type { Surface, HouseMaterial } from '../../../rust/bridge/housesContract';
import type { ParentMemberVisual } from './urbanParentVisual';
import type { ParentWindowSnapshot } from './urbanParentColdWindow';
export interface ParentMember3dVisual extends Omit<ParentMemberVisual, 'projection'> {
  projection: 'native-parent-member-3d-1'; height_m: number; ground_z_m: number;
  volumes?: never;
  occupation_surfaces: readonly Surface[];
  ground_constraints: readonly { footprint: Surface; height_m: number }[];
}
export interface Parent3dScene { projection: 'native-parent-window-3d-1'; buildings: readonly ParentMember3dVisual[];
  materials: HouseMaterial[]; complete: boolean; reason: string; parents: number }
export function parent3dWindow(snapshot?: ParentWindowSnapshot): Parent3dScene {
  if (!snapshot) return { projection: 'native-parent-window-3d-1', buildings: [], materials: [], complete: false, reason: 'pending', parents: 0 };
  const contexts = new Map<string, Surface[]>();
  for (const c of snapshot.contexts) { const parts = contexts.get(c.parent_id) ?? []; parts.push(c.surface); contexts.set(c.parent_id, parts); }
  const buildings: ParentMember3dVisual[] = snapshot.members.map(m => {
    if (!Number.isFinite(m.height_m) || !Number.isFinite(m.ground_z_m)) throw new Error('Invalid native member height.');
    const { volumes: _displayVolumes, ...cartography } = m;
    return { ...cartography, projection: 'native-parent-member-3d-1', height_m: m.height_m!, ground_z_m: m.ground_z_m!,
      occupation_surfaces: [m.footprint, ...(contexts.get(m.parent_id) ?? [])],
      ground_constraints: [{ footprint: m.footprint, height_m: m.ground_z_m! }] };
  });
  return { projection: 'native-parent-window-3d-1', buildings, materials: snapshot.materials,
    complete: snapshot.complete, reason: snapshot.reason, parents: snapshot.parents.length };
}
