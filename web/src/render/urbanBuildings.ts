import type { Surface, RoofEdge, RoofGroup } from '../../../rust/bridge/housesContract';
import type { PlacementBatch, PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import { houseMaterialPatterns, renderHouseExteriorSvg, type HouseExterior, PAPER, xml, surfacePath } from '../../../rust/bridge/houseRender';
import { buildingPaint, URBAN_FUNCTION_LABELS, type UrbanBuildingAppearance } from './urbanBuildingStyle';

export const buildingSurfacePath = surfacePath;
export function buildingHeight(building: PlacedBuilding): number {
  return Math.max(0, ...building.volumes.map(v => v.z_m + v.wall_height_m + v.roof_height_m - building.ground_z_m));
}
const exteriors = new WeakMap<PlacedBuilding, HouseExterior>();
/** Adapt actual exterior records, never fabricate a detailed HouseUnit. */
export function buildingExterior(building: PlacedBuilding): HouseExterior {
  const cached = exteriors.get(building); if (cached) return cached;
  const transform=building.transform ?? {origin:{x:0,y:0},orientation_deg:0}, angle=transform.orientation_deg*Math.PI/180, c=Math.cos(angle), s=Math.sin(angle);
  const localPoint=<T extends {x:number;y:number}>(p:T):T=>{const x=p.x-transform.origin.x,y=p.y-transform.origin.y;return {...p,x:x*c+y*s,y:-x*s+y*c};};
  const localSurface=(surface:Surface):Surface=>surface.map(p=>({outer:p.outer.map(localPoint),holes:p.holes.map(r=>r.map(localPoint))}));
  const vertices: HouseExterior['roofs']['vertices'] = [], faces: HouseExterior['roofs']['faces'] = [], edges: RoofEdge[] = [], groups: RoofGroup[] = [];
  building.volumes.forEach((volume, vi) => {
    const mesh = volume.roof_mesh; if (!mesh) return;
    const vertexOffset = vertices.length, faceOffset = faces.length;
    vertices.push(...mesh.vertices.map(localPoint));
    for (const face of mesh.faces) faces.push({...face, normal:[face.normal[0]*c+face.normal[1]*s,-face.normal[0]*s+face.normal[1]*c,face.normal[2]], vertices: face.vertices.map(i => i + vertexOffset), roof_group: `${vi}:${face.roof_group || 'exterior'}`});
    for (const edge of mesh.edges ?? []) edges.push({...edge, vertices: edge.vertices.map(i => i + vertexOffset) as [number, number], faces: edge.faces.map(i => i === null ? null : i + faceOffset) as [number | null, number | null]});
    for (const group of mesh.groups?.length ? mesh.groups : [{id: 'exterior', rf: volume.roof_system, body_id: volume.id, level: 0, domain: volume.footprint}]) groups.push({...group, domain:localSurface(group.domain), id: `${vi}:${group.id}`});
  });
  const features=(building.structural_features??[]).map(f=>({...f,surface:localSurface(f.surface),vertices3d:f.vertices3d.map(localPoint),roof:f.roof?{...f.roof,domain:localSurface(f.roof.domain),arms:f.roof.arms.map(a=>({...a,origin:localPoint(a.origin),domain:localSurface(a.domain),axis:[a.axis[0]*c+a.axis[1]*s,-a.axis[0]*s+a.axis[1]*c] as [number,number]}))}:null}));
  const exterior = {roofs: {vertices, faces, edges, groups}, features};
  exteriors.set(building, exterior); return exterior;
}
export function urbanBuildingsSvg(scene: PlacementBatch | undefined, appearance: UrbanBuildingAppearance, selected?: string): string {
  if (!scene) return '';
  const prefix = 'urban-houses', catalogue = {materials: scene.materials ?? []};
  let svg = `<defs>${houseMaterialPatterns(prefix)}</defs><g data-urban-buildings="" stroke-linejoin="round" fill-rule="evenodd">`;
  for (const b of scene.buildings) {
    svg += `<g data-urban-building="${xml(b.id)}" data-parcel-id="${xml(b.parcel_id)}" tabindex="0" role="button" aria-label="${xml(`${URBAN_FUNCTION_LABELS[b.function]} · ${b.recipe_id}`)}"><title>${xml(`${URBAN_FUNCTION_LABELS[b.function]} · ${b.recipe_id} · ${buildingHeight(b).toFixed(1)} m · ${b.culture.culture}`)}</title>`;
    svg += `<path d="${surfacePath(b.courtyards)}" fill="${PAPER}" stroke="#a69b7e" stroke-width=".1"/><path d="${surfacePath(b.circulation)}" fill="#e5dbc1"/>`;
    const t=b.transform ?? {origin:{x:0,y:0},orientation_deg:0};
    svg += `<g transform="translate(${t.origin.x} ${t.origin.y}) rotate(${t.orientation_deg})">${renderHouseExteriorSvg(buildingExterior(b), catalogue, prefix, t.orientation_deg, b.ground_z_m)}</g>`;
    if (appearance.diagnostic === 'uses' || appearance.diagnostic === 'height') {
      const paint = buildingPaint(b.volumes[0]?.materials, b.function, buildingHeight(b), appearance, undefined, catalogue);
      svg += `<path d="${surfacePath(b.roof_footprint)}" fill="${paint.roof}" opacity=".65"/>`;
    }
    if (b.id === selected) svg += `<path d="${surfacePath(b.roof_footprint)}" fill="none" stroke="#197ea4" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
    if (appearance.diagnostic === 'access') svg += `<circle cx="${b.entrance.x}" cy="${b.entrance.y}" r="1.1" fill="#147e67" stroke="white" stroke-width=".3"/>`;
    svg += '</g>';
  }
  return svg + '</g>';
}

/** Raster exports consume the same SVG exterior painter, including its actual
 * material motifs and edge policy. No parallel Canvas roof renderer. */
export async function drawUrbanBuildings(ctx: CanvasRenderingContext2D, scene: PlacementBatch | undefined, appearance: UrbanBuildingAppearance, metresPerPixel = 1): Promise<void> {
  if (!scene?.buildings.length) return;
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for (const building of scene.buildings) {
    for (const p of [...building.volumes.flatMap(v=>v.roof_mesh?.vertices??[]),...building.structural_features.flatMap(f=>f.surface.flatMap(s=>s.outer))]) {x0=Math.min(x0,p.x);y0=Math.min(y0,p.y);x1=Math.max(x1,p.x);y1=Math.max(y1,p.y);}
  }
  if (![x0,y0,x1,y1].every(Number.isFinite)) return;
  const pad=2*metresPerPixel, width=x1-x0+2*pad,height=y1-y0+2*pad;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(1,Math.ceil(width/metresPerPixel))}" height="${Math.max(1,Math.ceil(height/metresPerPixel))}" viewBox="${x0-pad} ${y0-pad} ${width} ${height}">${urbanBuildingsSvg(scene,appearance)}</svg>`;
  const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
  try {const image=new Image();image.src=url;await image.decode();ctx.drawImage(image,x0-pad,y0-pad,width,height);} finally {URL.revokeObjectURL(url);}
}
