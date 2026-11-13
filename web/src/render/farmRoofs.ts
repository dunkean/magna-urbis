/** Farmsteads and other isolated buildings of the land use (`world.landuse.farmsteads`, Rust `landuse/farms`) as city
 * buildings, so a natural ground paints them with the roof and wall code of the towns (cityCanvas `drawRoofedBuildings`
 * and `drawPlanRoofs`: massing faces, capped pan light, grain by cover and culture, weathering, snow, cast shadow).
 * Display only: each farm building's plan, roof kind, storeys and material become one massing piece, by the rules
 * the town massing uses for the same catalogue words (Rust `urban/massing.rs`, `material_style` and `tradition`).
 * Shared by every page that draws the vector map (V2, City Bench, sheets). */
import type { FarmBuilding, Farmstead, Polygon, World } from '../gen/types';
import type { PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import { sampleGrid } from '../gen/core/grid';
import { roofGrain } from './buildingMaterials';
import { buildCityBuildings, drawRoofedBuildings, type Box, type CityBuildings, type CityPalette } from './cityCanvas';
import type { MassingPiece, MassingRoof } from './cityMassing';
import { farmBuildingRidge } from './farms';

const DWELLING = /house|dwell|cottage|hall|lodge|manor/;
/** Cover and wall a catalogue material asks for (undefined: keep the roof kind's cover, a plastered wall). */
function materialLook(material: string | undefined, pitched: boolean): [string | undefined, string | undefined] {
  switch (material) {
    case 'timber': return [undefined, 'timber'];
    case 'wood': return [pitched ? 'shingle' : undefined, 'wood'];
    case 'cedar-plank': return ['shingle', 'wood'];
    case 'brick': return [undefined, 'brick'];
    case 'stone': case 'granite': case 'marble': return [undefined, 'stone'];
    case 'dark-stone': case 'rock': return ['stone', 'stone'];
    case 'coral-stone': return ['plaster', 'coral'];
    case 'mud': case 'adobe': case 'earth': case 'rammed-earth': return ['earth', 'earth'];
    case 'thatch': return ['thatch', 'wood'];
    case 'reed': case 'wattle': return ['reed', 'wattle'];
    case 'bamboo': return ['bamboo', 'bamboo'];
    case 'palm': return ['palm', 'wood'];
    case 'turf': return ['turf', 'earth'];
    case 'hide': return ['hide', 'hide'];
    case 'felt': case 'fabric': return ['felt', 'hide'];
    case 'bark': case 'living-wood': return ['bark', 'wood'];
    case 'snow': return ['snow', 'plaster'];
    default: return [undefined, undefined];
  }
}
const area = (p: Polygon): number => { let s = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += p[j].x * p[i].y - p[i].x * p[j].y; return Math.abs(s) / 2; };
/** Pitch (degrees) a cover is laid at: steep thatch, low turf and plank roofs, low half-round tiles. */
const pitchOf = (cover: string, culture: string): number => cover === 'thatch' || cover === 'reed' || cover === 'palm' ? 45 : cover === 'turf' || cover === 'shingle' || cover === 'bark' ? 32
  : cover === 'slate' ? 40 : cover === 'tile' && roofGrain('tile', false, culture) !== 'tile' ? 24 : 38;

/** Massing piece of one farm building. */
function farmPiece(b: FarmBuilding, culture: string, tone: number): MassingPiece {
  const kind = b.roof, pitchedWood = kind === 'gable';
  const [roof, base]: [MassingRoof, string] = kind === 'gable' ? ['gable', b.material === 'stone' && roofGrain('tile', false, culture) === 'tile' ? 'slate' : 'tile']
    : kind === 'hip' || kind === 'tiled-hip' || kind === 'pagoda' ? ['hip', 'tile'] : kind === 'dome' ? ['dome', 'plaster'] : kind === 'barrel' ? ['barrel', 'plaster']
    : kind === 'thatch-round' || kind === 'conical' ? ['cone', 'thatch'] : kind === 'pyramidal' ? ['pyramid', 'tile'] : ['flat', 'earth'];
  const [matCover, matWall] = materialLook(b.material, pitchedWood), cover = matCover ?? base, wall = matWall ?? 'plaster';
  const floors = Math.max(1, Math.round(b.storeys ?? 1)), eave = kind === 'none' ? 1.2 : .4 + 2.7 * floors, side = Math.sqrt(area(b.poly));
  const line = roof === 'gable' || roof === 'hip' || roof === 'barrel' ? farmBuildingRidge(b) : null;
  let half = side / 2;
  if (b.poly.length === 4) half = Math.min(Math.hypot(b.poly[1].x - b.poly[0].x, b.poly[1].y - b.poly[0].y), Math.hypot(b.poly[2].x - b.poly[1].x, b.poly[2].y - b.poly[1].y)) / 2;
  const rise = roof === 'flat' ? 0 : roof === 'dome' || roof === 'barrel' ? half : Math.min(7, Math.tan(pitchOf(cover, culture) * Math.PI / 180) * half);
  // A pitched roof without a ridge line (a plan that is not a quad, a square hip) rises to its centre.
  const shown: MassingRoof = (roof === 'gable' || roof === 'barrel') && !line ? 'hip' : roof;
  return { floors, eave_m: eave, rise_m: rise, roof: shown, ridges: line ? [[line[0].x, line[0].y, line[1].x, line[1].y]] : [], cover, wall, tone };
}

/** The farm buildings of the land use as placed buildings carrying their massing. `altitude` gives the ground
 * height (m) that decides their snow. */
export function farmPlacedBuildings(farmsteads: readonly Farmstead[], altitude: (x: number, y: number) => number): PlacedBuilding[] {
  const out: PlacedBuilding[] = [];
  farmsteads.forEach((f, fi) => {
    const culture = f.culture ?? '', ground = altitude(f.pos.x, f.pos.y);
    const parts: FarmBuilding[] = f.parts?.length ? f.parts : f.buildings.map(poly => ({ poly, use: 'house', arch: '', roof: 'gable' as const }));
    parts.forEach((b, bi) => {
      if (b.poly.length < 3) return;
      const footprint = [{ outer: b.poly, holes: [] }], tone = ((Math.imul(fi * 31 + bi + 1, 0x9e3779b1) >>> 8) & 0xffff) / 0xffff;
      out.push({ id: `farm:${fi}:${bi}`, parcel_id: `farm:${fi}`, function: DWELLING.test(b.use) ? 'domestic' : 'warehouse', culture: { culture }, ground_z_m: Number.isFinite(ground) ? ground : 0,
        footprint, roof_footprint: footprint, programme: { massing: [farmPiece(b, culture, tone)] } } as unknown as PlacedBuilding);
    });
  });
  return out;
}

const retained = new WeakMap<readonly Farmstead[], CityBuildings>();
/** City buildings of a world's farmsteads, built once per farmstead list; every one keeps its own snow altitude
 * (an isolated building is not averaged with a town). `Path`: class of the retained paths. */
export function farmCityBuildings(world: World, Path?: new () => Path2D): CityBuildings | undefined {
  const farmsteads = world.landuse?.farmsteads;
  if (!farmsteads?.length) return undefined;
  let buildings = retained.get(farmsteads);
  if (!buildings) {
    const height = world.terrain?.height;
    buildings = buildCityBuildings({ buildings: farmPlacedBuildings(farmsteads, (x, y) => height ? sampleGrid(height, x, y) : 0) });
    for (const item of buildings.items) item.snowAltitude = item.building.ground_z_m;
    buildings.pathClass = Path;
    retained.set(farmsteads, buildings);
  }
  return buildings;
}

/** Paints the farm buildings in view as town buildings are painted; `ctx` is in world coordinates. Returns how many. */
export function drawFarmRoofs(ctx: CanvasRenderingContext2D, world: World, o: { viewport: Box; mpp: number; dpr: number; palette: CityPalette; night?: boolean; Path?: new () => Path2D }): number {
  const buildings = farmCityBuildings(world, o.Path);
  return buildings ? drawRoofedBuildings(ctx, buildings, { viewport: o.viewport, mpp: o.mpp, dpr: o.dpr, palette: o.palette, night: o.night,
    appearance: { style: 'cartographic', diagnostic: 'none', ambience: o.night ? 'night' : 'day' } }) : 0;
}
