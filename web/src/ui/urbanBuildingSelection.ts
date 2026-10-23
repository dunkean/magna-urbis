import type { PlacementBatch } from '../../../rust/bridge/urbanArchitecture';
import { buildingSurfacePath } from '../render/urbanBuildings';
interface Selection {
  scene?: PlacementBatch;
  id?: string;
  group?: Element;
  outline?: SVGPathElement;
}
const previous = new WeakMap<Element, Selection>();
/** One native roof outline changes when selection changes; the city SVG stays retained. */
export function updateUrbanBuildingSelection(host: Element, scene?: PlacementBatch, id?: string): void {
  const last = previous.get(host);
  if (last && last.scene === scene && last.id === id
    && (!id || (!last.group || host.contains(last.group)) && last.outline?.parentNode === host)) return;
  last?.group?.classList.remove('urban-building-selected');
  let outline = last?.outline?.parentNode === host ? last.outline : host.querySelector<SVGPathElement>('[data-building-selection]');
  const building = id ? scene?.buildings.find(building => building.id === id) : undefined;
  const group = id && host.querySelector(`[data-urban-building="${CSS.escape(id)}"]`) || undefined;
  // Silhouettes have no per-building element; the outline alone marks the selection.
  if (!building || !group && !host.querySelector('[data-urban-silhouettes]')) { outline?.remove(); previous.set(host, { scene, id }); return; }
  group?.classList.add('urban-building-selected');
  if (!outline) { outline = document.createElementNS('http://www.w3.org/2000/svg', 'path'); outline.dataset.buildingSelection = ''; outline.dataset.urbanBuildings = ''; outline.setAttribute('fill', 'none'); outline.setAttribute('stroke', '#197ea4'); outline.setAttribute('stroke-width', '2'); outline.setAttribute('vector-effect', 'non-scaling-stroke'); outline.style.pointerEvents = 'none'; host.append(outline); }
  outline.setAttribute('d', buildingSurfacePath(building.roof_footprint));
  previous.set(host, { scene, id, group, outline });
}
