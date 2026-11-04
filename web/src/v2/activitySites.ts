/** Activity sites (Rust `settlements/activities.rs`, catalogue P3) as a native building
 * scene: each building's massing (`urban/massing.rs`, its archetype look) becomes roof
 * faces, so the V2 city map draws mills, quarries and huts with the town-house renderer.
 * Display only: nothing is generated here. */
import type { World } from '../gen/types';
import type { ActivitySite } from '../../../rust/bridge/settlements';
import type { PlacedBuilding, PlacementBatch } from '../../../rust/bridge/urbanArchitecture';
import type { HouseMaterial, MaterialPattern, Surface, Vertex3 } from '../../../rust/bridge/housesContract';
import { buildingRoof, readMassing } from '../render/cityMassing';

const PATTERN: Record<string, MaterialPattern> = {
  tile: 'tile', slate: 'stone', stone: 'stone', thatch: 'thatch', reed: 'thatch', shingle: 'wood', wood: 'wood', bark: 'wood',
  plank: 'wood', earth: 'earth', turf: 'earth', clay: 'earth', mud: 'earth', plaster: 'plain', felt: 'fabric', hide: 'fabric', snow: 'snow',
};
const material = (cover: string): HouseMaterial => ({ id: `activity:${cover}`, label: cover, roles: ['roof'], pattern: PATTERN[cover] ?? 'plain', origin: 'activity', source_ref: null });

type RegionSites = { placement?: { activities?: ActivitySite[] }; roads?: { nodes?: ActivitySite[] } | null };
const siteLists = new WeakMap<object, readonly ActivitySite[]>();
const NONE: readonly ActivitySite[] = [];
/** Activity sites of the retained regional placement, then the network nodes of its roads. */
export function activitySitesOf(world: World | undefined): readonly ActivitySite[] {
  const region = world?.debug?.v2RustRegion as RegionSites | undefined;
  if (!region) return NONE;
  let list = siteLists.get(region);
  if (!list) siteLists.set(region, list = [...region.placement?.activities ?? [], ...region.roads?.nodes ?? []]);
  return list;
}

/** Muted ground palette per installation kind (fill, stroke, open-line width in m). */
const GROUND: Record<string, { fill?: string; stroke: string; width: number; dash?: number[] }> = {
  excavation: { fill: '#857565', stroke: '#5c5045', width: 2 },
  mound: { fill: '#9b9893', stroke: '#76726c', width: 2 },
  water_structure: { fill: '#93a7b3', stroke: '#647d8c', width: 2.5 },
  enclosure: { stroke: '#6d5c42', width: .7 },
  industrial_ground: { fill: '#8e6c4d', stroke: '#6a4f37', width: 1.2 },
  landing: { fill: '#a07d55', stroke: '#6f5338', width: 2 },
  open_surface: { fill: '#cbbb8e', stroke: '#a8976a', width: 1 },
  engineered_path: { stroke: '#a69d8c', width: 3 },
  terrace: { fill: '#aaa673', stroke: '#86824f', width: 1 },
  underground_work: { stroke: '#7b6f61', width: 1.5, dash: [4, 3] },
  crossing: { stroke: '#7b5b3b', width: 1.5 },
};
/** Installations (weirs, quarry faces, heaps, piers, corrals…) as flat ground under the buildings; world-metre transform already set. */
export function drawInstallations(ctx: CanvasRenderingContext2D, sites: readonly ActivitySite[], viewport: { minX: number; minY: number; maxX: number; maxY: number }, mpp: number): number {
  if (mpp > 8) return 0;
  let drawn = 0;
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const site of sites) {
    if (site.x < viewport.minX - 400 || site.x > viewport.maxX + 400 || site.y < viewport.minY - 400 || site.y > viewport.maxY + 400) continue;
    for (const g of site.installations ?? []) {
      if (typeof g !== 'object' || g.points.length < 2) continue;
      const style = GROUND[g.kind] ?? GROUND.industrial_ground;
      ctx.beginPath();
      ctx.moveTo(g.points[0].x, g.points[0].y);
      for (let i = 1; i < g.points.length; i++) ctx.lineTo(g.points[i].x, g.points[i].y);
      ctx.setLineDash(style.dash ? style.dash.map(d => d * Math.max(1, mpp)) : []);
      if (g.closed) {
        ctx.closePath();
        if (style.fill) { ctx.globalAlpha = .85; ctx.fillStyle = style.fill; ctx.fill(); }
        ctx.globalAlpha = 1; ctx.strokeStyle = style.stroke; ctx.lineWidth = Math.max(style.fill ? .5 : style.width, mpp * .8); ctx.stroke();
      } else {
        ctx.globalAlpha = 1; ctx.strokeStyle = style.stroke; ctx.lineWidth = Math.max(style.width, mpp * 1.2); ctx.stroke();
      }
      drawn++;
    }
  }
  ctx.restore();
  return drawn;
}

const scenes = new WeakMap<readonly ActivitySite[], PlacementBatch>();
/** One scene for every activity building, or undefined when there is none. */
export function activityScene(world: World | undefined): PlacementBatch | undefined {
  const sites = activitySitesOf(world);
  if (!sites.length) return undefined;
  const cached = scenes.get(sites);
  if (cached) return cached;
  const buildings: PlacedBuilding[] = [], covers = new Set<string>();
  for (const site of sites) site.buildings.forEach((b, k) => {
    const footprint: Surface = [{ outer: b.ring, holes: [] }];
    const massing = readMassing({ massing: b.massing }, footprint);
    if (!massing) return;
    const vertices: Vertex3[] = [], faces: { vertices: number[]; normal: [number, number, number]; material: string; kind: string }[] = [];
    let top = 0;
    for (const face of buildingRoof(footprint, massing)) {
      const start = vertices.length;
      for (const p of face.points) { vertices.push({ x: p.x, y: p.y, z: site.ground + p.z }); top = Math.max(top, p.z); }
      faces.push({ vertices: face.points.map((_, i) => start + i), normal: face.normal, material: `activity:${face.cover}`, kind: 'roof' });
      covers.add(face.cover);
    }
    const cover = `activity:${massing[0].cover}`, eave = massing[0].eave_m, id = `${site.id}/${k}`;
    covers.add(massing[0].cover);
    const slots = { frame: cover, infill: cover, coating: cover, cladding: cover, base: cover, roof_frame: cover };
    const [a, c] = [b.ring[0], b.ring[1]];
    buildings.push({
      id, parcel_id: site.id, function: 'workshop', culture: { culture: site.culture, pack: '', mode: 'inspired', borrowing: null },
      recipe_id: `activity:${b.archetype}`, variant_id: b.look, transform: { origin: { x: site.x, y: site.y }, orientation_deg: Math.atan2(c.y - a.y, c.x - a.x) * 180 / Math.PI },
      ground_z_m: site.ground, footprint, roof_footprint: footprint, courtyards: [], circulation: [], entrance: { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 }, access_id: '',
      volumes: [{ id: `${id}/v`, footprint, levels: [], z_m: site.ground, wall_height_m: eave, roof_height_m: Math.max(0, top - eave), roof_system: massing[0].roof.toUpperCase(),
        roof_pitch_deg: 0, overhang_m: 0, materials: slots, role: 'main', roof_mesh: { vertices, faces }, foundation: { footprint, z_min_m: site.ground, z_max_m: site.ground } }],
      useful_area_m2: 0, domestic_units: 0, structural_features: [], simplification: 'recipe_volumes', diagnostics: [], resolved: null,
      programme: { massing: b.massing, archetype: b.archetype, activity: site.template, parent: site.parent },
    } as unknown as PlacedBuilding);
  });
  const scene: PlacementBatch = { schema_version: '1', generator_version: 'activity-sites-1', materials: [...covers].map(material), buildings, refusals: [], open_spaces: [] };
  scenes.set(sites, scene);
  return scene;
}
