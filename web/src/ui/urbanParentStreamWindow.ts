/** Provisional children from the SAME durably staged run, NEVER applied state.
 * Bounded viewport sample; moving elsewhere may remain partial until final CAS. */
import { PARENT_VISUAL_VERSION, projectParentRecords, type ParentVisualRecords } from './urbanParentVisual';
import type { NativeParentBatch } from '../../../rust/bridge/nativeParentContract';
import { parentBoundsOverlap, surfaceBounds, type ParentBounds } from '../../../rust/bridge/nativeParentOccupation';
import { coldVisualVertices } from './urbanColdVisualWindow';
export function createParentStreamWindow() {
  let value: ParentVisualRecords = { version: PARENT_VISUAL_VERSION, members: [], parents: [], contexts: [], materials: [] };
  return { get records() { return value; },
    append(batch: NativeParentBatch, bounds: ParentBounds) {
      const projected = projectParentRecords(batch.parents, batch.materials);
      let vertices = 0;
      const members: ParentVisualRecords['members'] = [], contexts: ParentVisualRecords['contexts'] = [];
      // Linear bounded admission, no repeated traversal/shift of a whole window.
      for (const m of [...value.members, ...projected.members].reverse()) {
        if (members.length >= 2048 || !parentBoundsOverlap(bounds, surfaceBounds(m.roof_footprint.length ? m.roof_footprint : m.footprint))) continue;
        const n = coldVisualVertices(m); if (vertices + n > 200000) continue; vertices += n; members.push(m);
      }
      for (const c of [...value.contexts, ...projected.contexts].reverse()) {
        if (contexts.length >= 4096 || !parentBoundsOverlap(bounds, surfaceBounds(c.surface))) continue;
        const n = coldVisualVertices(c); if (vertices + n > 200000) continue; vertices += n; contexts.push(c);
      }
      members.reverse(); contexts.reverse();
      const ids = new Set([...members.map(m => m.parent_id), ...contexts.map(c => c.parent_id)]);
      const parents = [...value.parents, ...projected.parents].filter(p => ids.has(p.id)).slice(-2048);
      const material = new Map([...value.materials, ...projected.materials].map(m => [m.id, m]));
      value = { version: PARENT_VISUAL_VERSION, members, contexts, parents, materials: [...material.values()] }; return value;
    }, clear() { value = { version: PARENT_VISUAL_VERSION, members: [], parents: [], contexts: [], materials: [] }; },
  };
}
