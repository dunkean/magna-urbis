import type { Surface, RoofEdge, RoofGroup } from '../../../rust/bridge/housesContract';
import type { PlacementBatch, PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import { houseMaterialPatterns, renderHouseExteriorSvg, type HouseExterior, PAPER, xml, surfacePath } from '../../../rust/bridge/houseRender';
import { buildingPaint, URBAN_FUNCTION_LABELS, type UrbanBuildingAppearance } from './urbanBuildingStyle';
import { UrbanBuildingLodRenderer, buildingRoofRidges, type BuildingLod, type BuildingViewport } from './urbanBuildingLod';

export const buildingSurfacePath = surfacePath;
export function buildingHeight(building: PlacedBuilding): number {
  return building.cartographic?.height_m ?? building.volumes.reduce((height, v) => Math.max(height, v.z_m + v.wall_height_m + v.roof_height_m - building.ground_z_m), 0);
}
export interface UrbanBuildingsSvgOptions {
  viewport?: BuildingViewport;
  /** Omit to preserve the existing exact native exterior export. */
  metresPerPixel?: number;
}
export interface UrbanBuildingsDrawOptions {
  viewport?: BuildingViewport;
  selectedId?: string;
  /** Explicit safety limits; exports never silently reduce requested resolution. */
  maxPixels?: number;
  maxSidePixels?: number;
}
const exportRenderers = new WeakMap<PlacementBatch, UrbanBuildingLodRenderer>();
function exportRenderer(scene: PlacementBatch): UrbanBuildingLodRenderer {
  let renderer = exportRenderers.get(scene);
  if (!renderer) { renderer = new UrbanBuildingLodRenderer(scene, {raster: false, hysteresis: 0}); exportRenderers.set(scene, renderer); }
  return renderer;
}
function roofSurface(building: PlacedBuilding): Surface { return building.roof_footprint.length ? building.roof_footprint : building.footprint; }
/** Cheap metric extent, including compact plans. Never reads detailed roof meshes. */
export function urbanBuildingsBounds(scene: PlacementBatch): BuildingViewport | undefined {
  const box = {minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity};
  const include = (surface: Surface): void => {
    for (const polygon of surface) for (const p of polygon.outer) if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
      box.minX = Math.min(box.minX, p.x); box.minY = Math.min(box.minY, p.y);
      box.maxX = Math.max(box.maxX, p.x); box.maxY = Math.max(box.maxY, p.y);
    }
  };
  for (const b of scene.buildings) {
    include(roofSurface(b));
    for (const feature of b.structural_features ?? []) include(feature.surface);
  }
  return Number.isFinite(box.minX) ? box : undefined;
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
export function urbanBuildingsSvg(scene: PlacementBatch | undefined, appearance: UrbanBuildingAppearance, selected?: string, options: UrbanBuildingsSvgOptions = {}): string {
  if (!scene) return '';
  let visible: {building: PlacedBuilding; lod: BuildingLod}[];
  if (options.viewport || options.metresPerPixel !== undefined) {
    const viewport = options.viewport ?? urbanBuildingsBounds(scene); if (!viewport) return '';
    visible = exportRenderer(scene).query(viewport, options.metresPerPixel ?? 1, appearance).visible.map(entry => ({
      building: entry.building, lod: options.metresPerPixel === undefined && appearance.style !== 'silhouette' ? 'facets' : entry.lod,
    }));
  } else visible = scene.buildings.map(building => ({building, lod: appearance.style === 'silhouette' ? 'silhouette' : 'facets'}));
  if (appearance.style === 'silhouette') return clipSvg(silhouettesSvg(visible.map(entry => entry.building), scene, appearance, selected), options.viewport);
  const prefix = 'urban-houses', catalogue = {materials: scene.materials ?? []};
  let svg = `<defs>${houseMaterialPatterns(prefix)}</defs><g data-urban-buildings="" stroke-linejoin="round" fill-rule="evenodd">`;
  for (const {building: b, lod} of visible) {
    svg += `<g data-urban-building="${xml(b.id)}" data-parcel-id="${xml(b.parcel_id)}" tabindex="0" role="button" aria-label="${xml(`${URBAN_FUNCTION_LABELS[b.function]} · ${b.recipe_id}`)}"><title>${xml(`${URBAN_FUNCTION_LABELS[b.function]} · ${b.recipe_id} · ${buildingHeight(b).toFixed(1)} m · ${b.culture.culture}`)}</title>`;
    // Short-circuit before touching native meshes at small projected sizes.
    const detailed = lod === 'facets' && !b.cartographic && b.volumes.some(volume => volume.roof_mesh?.faces.length);
    if (detailed) {
      svg += `<path d="${surfacePath(b.courtyards)}" fill="${PAPER}" stroke="#a69b7e" stroke-width=".1"/><path d="${surfacePath(b.circulation)}" fill="#e5dbc1"/>`;
      const t=b.transform ?? {origin:{x:0,y:0},orientation_deg:0};
      svg += `<g transform="translate(${t.origin.x} ${t.origin.y}) rotate(${t.orientation_deg})">${renderHouseExteriorSvg(buildingExterior(b), catalogue, prefix, t.orientation_deg, b.ground_z_m, appearance.diagnostic === 'none' ? { roof: appearance.colors?.building, edge: appearance.colors?.buildingEdge } : undefined)}</g>`;
    } else {
      const paint = buildingPaint(b.volumes[0]?.materials, b.function, buildingHeight(b), appearance, undefined, catalogue);
      svg += `<path data-building-lod="${lod === 'silhouette' ? 'silhouette' : 'cartographic'}" d="${surfacePath(roofSurface(b))}" fill="${paint.roof}" stroke="none"/>`;
      if (lod !== 'silhouette') for (const line of buildingRoofRidges(b)) {
        if (options.metresPerPixel && Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y) / options.metresPerPixel < 1.5) continue;
        svg += `<path data-roof-line="${line.kind}" d="M${line.a.x},${line.a.y}L${line.b.x},${line.b.y}" fill="none" stroke="${appearance.colors?.buildingEdge ?? (line.kind === 'valley' ? '#736e53' : '#393a31')}" stroke-width=".8" vector-effect="non-scaling-stroke"/>`;
      }
    }
    if (detailed && (appearance.diagnostic === 'uses' || appearance.diagnostic === 'height')) {
      const paint = buildingPaint(b.volumes[0]?.materials, b.function, buildingHeight(b), appearance, undefined, catalogue);
      svg += `<path d="${surfacePath(roofSurface(b))}" fill="${paint.roof}" opacity=".65"/>`;
    }
    if (b.id === selected) svg += selectionSvg(b);
    if (appearance.diagnostic === 'access') svg += `<circle cx="${b.entrance.x}" cy="${b.entrance.y}" r="1.1" fill="#147e67" stroke="white" stroke-width=".3"/>`;
    svg += '</g>';
  }
  return clipSvg(svg + '</g>', options.viewport);
}

/** Plan-masse footprints, grouped by fill: a few paths whatever the size of the city. */
function silhouettesSvg(buildings: PlacedBuilding[], scene: PlacementBatch, appearance: UrbanBuildingAppearance, selected?: string): string {
  const groups = new Map<string, string[]>();
  for (const b of buildings) {
    const fill = appearance.diagnostic === 'uses' || appearance.diagnostic === 'height' ? buildingPaint(b.volumes[0]?.materials, b.function, buildingHeight(b), appearance, undefined, {materials: scene.materials ?? []}).roof : appearance.colors?.building ?? '#5a4b3c';
    let list = groups.get(fill); if (!list) groups.set(fill, list = []);
    list.push(nonzeroSurfacePath(roofSurface(b)));
  }
  let svg = '<g data-urban-buildings="" data-urban-silhouettes="" fill-rule="nonzero">';
  for (const [fill, paths] of groups) svg += `<path d="${paths.join(' ')}" fill="${fill}" stroke="none"/>`;
  if (appearance.diagnostic === 'access') for (const b of buildings) svg += `<circle cx="${b.entrance.x}" cy="${b.entrance.y}" r="1.1" fill="#147e67" stroke="white" stroke-width=".3"/>`;
  const chosen = selected ? buildings.find(b => b.id === selected) : undefined;
  if (chosen) svg += selectionSvg(chosen);
  return svg + '</g>';
}

function nonzeroSurfacePath(surface: Surface): string {
  const orient = (ring: Surface[number]['outer'], hole: boolean): Surface[number]['outer'] => {
    let area = 0;
    for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; area += a.x * b.y - a.y * b.x; }
    return (area < 0) !== hole ? [...ring].reverse() : ring;
  };
  return surfacePath(surface.map(p => ({outer: orient(p.outer, false), holes: p.holes.map(h => orient(h, true))})));
}
function selectionSvg(building: PlacedBuilding): string {
  return `<path d="${surfacePath(roofSurface(building))}" fill="none" stroke="#197ea4" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
}
function clipSvg(svg: string, viewport?: BuildingViewport): string {
  if (!viewport) return svg;
  return `<defs><clipPath id="urban-houses-export-viewport"><rect x="${viewport.minX}" y="${viewport.minY}" width="${viewport.maxX - viewport.minX}" height="${viewport.maxY - viewport.minY}"/></clipPath></defs><g clip-path="url(#urban-houses-export-viewport)">${svg}</g>`;
}

/** Complete Canvas export using the same native/compact LOD renderer. Raster tile
 * caching is disabled here so an export never contains an unfinished tile frame.
 * The caller owns the canvas and its world-to-pixel transform; no giant temporary
 * SVG Image or hidden canvas is allocated. Exact vector exteriors remain available
 * through urbanBuildingsSvg() without a metresPerPixel option. */
export async function drawUrbanBuildings(ctx: CanvasRenderingContext2D, scene: PlacementBatch | undefined, appearance: UrbanBuildingAppearance, metresPerPixel = 1, options: UrbanBuildingsDrawOptions = {}): Promise<void> {
  if (!scene?.buildings.length) return;
  if (!(metresPerPixel > 0) || !Number.isFinite(metresPerPixel)) throw new Error('metresPerPixel must be finite and positive.');
  const rawBounds = options.viewport ?? urbanBuildingsBounds(scene); if (!rawBounds) return;
  const pad = options.viewport ? 0 : 2 * metresPerPixel;
  const viewport = {minX: rawBounds.minX - pad, minY: rawBounds.minY - pad, maxX: rawBounds.maxX + pad, maxY: rawBounds.maxY + pad};
  if (!Object.values(viewport).every(Number.isFinite) || viewport.maxX < viewport.minX || viewport.maxY < viewport.minY) throw new Error('Building export viewport must contain finite, ordered bounds.');
  const width = Math.max(1, Math.ceil((viewport.maxX - viewport.minX) / metresPerPixel));
  const height = Math.max(1, Math.ceil((viewport.maxY - viewport.minY) / metresPerPixel));
  const maxPixels = options.maxPixels ?? 32 * 1024 * 1024, maxSide = options.maxSidePixels ?? 16_384;
  if (!(maxPixels > 0) || !Number.isFinite(maxPixels) || !(maxSide > 0) || !Number.isFinite(maxSide)) throw new Error('Building export pixel limits must be finite and positive.');
  if (width > maxSide || height > maxSide || width * height > maxPixels) throw new Error(`Building export requires ${width} × ${height} pixels; limits are ${maxSide} per side and ${maxPixels} total. Supply a smaller viewport or explicitly raise the export limits.`);
  exportRenderer(scene).draw(ctx, {viewport, metresPerPixel, appearance, selectedId: options.selectedId});
}
