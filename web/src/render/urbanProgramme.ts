import type { Parcel, Partition, UrbanAllocation } from '../../../rust/bridge/urban';
import type { PlacementBatch, PlacementRefusal } from '../../../rust/bridge/urbanArchitecture';
import { buildingSurfacePath } from './urbanBuildings';
import { urbanFunctionColor, URBAN_FUNCTION_LABELS } from './urbanBuildingStyle';

const xml = (text: string): string => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const functionLabel = (name: string): string => ({ market: 'Marché', common: 'Communs', ...URBAN_FUNCTION_LABELS } as Record<string, string>)[name] ?? name;

/** Allocation-only presentation. A missing ID is never guessed from array order
 * or spatial proximity; holes and the retained cadastral boundary stay exact. */
export function programmeSvg(partitions: readonly Partition[] | undefined): string {
  let paths = '';
  for (const partition of partitions ?? []) {
    const parcels = new Map(partition.parcels.filter(p => p.id).map(p => [p.id!, p]));
    for (const allocation of partition.programme?.allocations ?? []) {
      const parcel = parcels.get(allocation.parcelId);
      if (!parcel) continue;
      const color = urbanFunctionColor(allocation.function);
      const title = `${functionLabel(allocation.function)} · ${allocation.culture} · ${allocation.parcelId}${allocation.reasons.length ? ` · ${allocation.reasons.join(' · ')}` : ''}`;
      paths += `<path data-urban-allocation="${xml(allocation.demandId)}" data-parcel-id="${xml(allocation.parcelId)}" data-urban-function="${xml(allocation.function)}" data-urban-culture="${xml(allocation.culture)}" d="${buildingSurfacePath([parcel.shape])}" fill="${color}" fill-opacity=".62" stroke="${color}" stroke-width=".55" vector-effect="non-scaling-stroke"><title>${xml(title)}</title></path>`;
    }
  }
  return paths ? `<g data-urban-programme="" fill-rule="evenodd" stroke-linejoin="round" pointer-events="none">${paths}</g>` : '';
}

/** A refusal has no accepted footprint. Draw only its known cadastral domain,
 * not an invented failed building or a marker that could fall inside a hole. */
export function refusalSvg(partitions: readonly Partition[] | undefined, scene: PlacementBatch | undefined): string {
  if (!scene?.refusals.length) return '';
  const parcels = new Map<string, { parcel: Parcel; allocation?: UrbanAllocation }>();
  for (const partition of partitions ?? []) {
    const allocations = new Map(partition.programme?.allocations.map(a => [a.parcelId, a]));
    for (const parcel of partition.parcels) if (parcel.id) parcels.set(parcel.id, { parcel, allocation: allocations.get(parcel.id) });
  }
  const grouped = new Map<string, PlacementRefusal[]>();
  for (const refusal of scene.refusals) {
    const list = grouped.get(refusal.parcel_id) ?? []; list.push(refusal); grouped.set(refusal.parcel_id, list);
  }
  let paths = '';
  for (const [id, refusals] of grouped) {
    const known = parcels.get(id); if (!known) continue;
    const culture = known.allocation?.culture ?? '', fn = known.allocation?.function ?? '';
    const title = `${id}${fn ? ` · ${functionLabel(fn)}` : ''}${culture ? ` · ${culture}` : ''} · ${refusals.map(r => `${r.code} : ${r.message} (${r.attempts} essais)`).join(' · ')}`;
    paths += `<path data-urban-refusal="${xml(refusals.map(r => r.id).join(' '))}" data-parcel-id="${xml(id)}" data-refusal-code="${xml(refusals.map(r => r.code).join(' '))}" d="${buildingSurfacePath([known.parcel.shape])}" fill="none" stroke="${urbanFunctionColor('refusal')}" stroke-width="1.8" stroke-dasharray="4 2" vector-effect="non-scaling-stroke"><title>${xml(title)}</title></path>`;
  }
  return paths ? `<g data-urban-refusals="" fill-rule="evenodd" stroke-linejoin="round" pointer-events="none">${paths}</g>` : '';
}
