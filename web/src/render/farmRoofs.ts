/** Farmsteads and other isolated buildings of the land use (`world.landuse.farmsteads`, Rust `landuse/farms`) as city
 * buildings, so a natural ground paints them with the roof and wall code of the towns (cityCanvas `drawRoofedBuildings`
 * and `drawPlanRoofs`: massing faces, capped pan light, grain by cover and culture, weathering, snow, cast shadow).
 * Display only: a farm building is drawn from the massing the engine sends with it (`parts[j].massing`); without
 * one, its plan, roof kind, storeys and material become one massing piece, by the rules the town massing uses for
 * the same catalogue words (Rust `urban/massing.rs`, `material_style` and `tradition`).
 * Shared by every page that draws the vector map (V2, City Bench, sheets). */
import type { FarmBuilding, Farmstead, Polygon, Settlement, World } from '../gen/types';
import { placeholderUrban } from '../gen/settlements/merge';
import type { PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import { sampleGrid } from '../gen/core/grid';
import { roofGrain } from './buildingMaterials';
import { buildCityBuildings, drawRoofedBuildings, type Box, type CityBuildings, type CityPalette } from './cityCanvas';
import { readMassing, type MassingPiece, type MassingRoof } from './cityMassing';
import { farmBuildingRidge } from './farms';
import { groundAt } from './groundTone';
import { mapGroundSnow } from './seasonPalette';

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
      // The engine's own massing of the building when it sends one piece the town painter can read (the same check
      // as for a town building: one piece per plan, eave height, roof kind); else the piece derived from the part.
      const sent = Array.isArray(b.massing) && readMassing({ massing: b.massing }, footprint) ? b.massing : undefined;
      // The farm's culture goes with every building: its roof grain (tile variant, thatch, shingles) and its palette
      // are those of a village of that culture.
      // A silhouette record like a town building's (no volumes of its own): the 2D plan reads its massing, the 3D
      // scene raises its volumes from the same massing on the terrain under its footprint (city3dMeshes.ts).
      const [a, c] = [b.poly[0], b.poly[1]];
      out.push({ id: `farm:${fi}:${bi}`, parcel_id: `farm:${fi}`, function: DWELLING.test(b.use) ? 'domestic' : 'warehouse',
        culture: { culture, pack: '', mode: 'historical_inspired', borrowing: null }, recipe_id: 'silhouette', variant_id: b.use,
        transform: { origin: { x: f.pos.x, y: f.pos.y }, orientation_deg: Math.atan2(c.y - a.y, c.x - a.x) * 180 / Math.PI },
        ground_z_m: Number.isFinite(ground) ? ground : 0, footprint, roof_footprint: footprint, courtyards: [], circulation: [], entrance: { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 }, access_id: '',
        volumes: [], useful_area_m2: 0, domestic_units: 0, structural_features: [], simplification: 'recipe_volumes', diagnostics: [], resolved: null,
        programme: { massing: sent ?? [farmPiece(b, culture, tone)] } } as unknown as PlacedBuilding);
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

// ---------------------------------------------------------------- places whose plan is not generated yet
/** Rural house of each culture: roof kind / cover / wall, the dominant tradition of its catalogue tissues (Rust
 * `urban/catalogue.json` presets and `forms/styles.json` traditions). Only for the stand-in houses of a place that
 * waits for its real plan; an unlisted culture builds a plastered, tiled gable. */
const RURAL_HOUSE: Record<string, string> = Object.fromEntries(`european-organic:gable/tile/timber bastide:gable/tile/stone medina:flat/earth/earth chinese:hip/tile/brick
japanese-jokamachi:gable/shingle/wood indian-temple:hip/tile/brick roman-core:hip/tile/brick elven:dome/bark/wood dwarven:flat/stone/stone necropolis:hip/tile/stone
russian-kremlin:gable/shingle/wood aztec:flat/earth/earth inca:gable/slate/stone byzantine-greek:hip/tile/stone venetian-lagoon:hip/tile/brick persian:flat/earth/earth
ottoman:hip/tile/wood sahel:flat/earth/earth hanseatic:gable/tile/brick korean:hip/tile/wood wizard-city:hip/tile/stone gnomish:pyramid/tile/brick stilt-town:cone/palm/bamboo
barbarian:gable/thatch/wood barbarian-celtic:cone/reed/wattle barbarian-norse:gable/turf/earth norse-ringfort:gable/tile/timber maya:cone/palm/wattle khmer:gable/bamboo/bamboo
celtic-oppidum:cone/reed/wattle orcish:tent/hide/hide halfling:dome/turf/earth kraal:cone/thatch/wattle native-iroquoian:barrel/bark/wood native-pueblo:flat/earth/earth
native-plains:tent/hide/hide nomad-camp:tent/felt/hide swahili-stone-town:flat/plaster/coral drow-enclave:flat/stone/stone duergar-hold:flat/stone/stone myconid-colony:dome/turf/wattle
egyptian-planned:flat/earth/earth nubian-fortified:dome/earth/earth mesopotamian:flat/earth/earth levantine-tell:flat/earth/earth oasis-caravan:flat/earth/earth ksar-oasis:flat/earth/earth
yoruba:hip/thatch/earth himalayan-terraces:flat/earth/stone newar:hip/tile/brick indus-planned:flat/earth/brick javanese-courts:pyramid/tile/wood mississippian:hip/thatch/earth
al-andalus:hip/tile/plaster italian-comune:hip/tile/brick flemish-cloth-town:gable/tile/brick rynek-town:gable/tile/brick slavic-gord:gable/thatch/wood caucasian-highland:flat/earth/stone
ethiopian-highland:cone/thatch/wood great-zimbabwe:cone/thatch/earth hausa-kano:flat/earth/earth hadhrami-tower:flat/earth/earth rajput-fort:flat/plaster/stone
dravidian-temple:flat/plaster/stone bagan:hip/tile/wood vietnamese-citadel:hip/tile/wood tibetan-monastery:flat/earth/stone mongol-ordu:tent/felt/hide maori-pa:gable/thatch/wood
pnw-plank-village:gable/shingle/wood inuit-camp:dome/snow/plaster siberian-camp:tent/hide/hide guarani-village:gable/palm/wood budj-bim:cone/thatch/stone lizardfolk-swamp:cone/thatch/stone
merfolk-tidal:dome/stone/stone giant-hold:gable/stone/stone goblin-warren:cone/reed/wattle american-grid:gable/shingle/wood`.split(/\s+/).map(entry => entry.split(':') as [string, string]));

/** A place whose detail is still to come: the stand-in cluster of the map (`placeholderUrban`) as buildings of its
 * culture, and the earth lanes its houses line. Round-house cultures get round houses on the same spots. */
interface StandIn { buildings: PlacedBuilding[]; lanes: { x: number; y: number }[][] }
const standIns = new WeakMap<Settlement, StandIn>();
const isLazy = (s: Settlement): boolean => !s.main && !s.urban && s.detail === 'lazy';
function standIn(world: World, s: Settlement): StandIn {
  let held = standIns.get(s);
  if (held) return held;
  const height = world.terrain.height, urban = placeholderUrban(s, { data: world.terrain.water, n: height.w, cell: height.cell });
  const [roof, cover, wall] = (RURAL_HOUSE[s.culture] ?? 'gable/tile/plaster').split('/') as [MassingRoof, string, string];
  const round = roof === 'cone' || roof === 'dome' || roof === 'tent', buildings: PlacedBuilding[] = [], feet: { angle: number; reach: number }[] = [];
  urban.buildings.forEach((b, bi) => {
    const c = centreOf(b.poly), u = unit(bi, s.key.length, 0x77), tone = unit(bi, s.population | 0, 0x3d);
    const long = Math.hypot(b.poly[1].x - b.poly[0].x, b.poly[1].y - b.poly[0].y), short = Math.hypot(b.poly[2].x - b.poly[1].x, b.poly[2].y - b.poly[1].y);
    // Round houses: an octagon as wide as the stand-in is deep.
    const poly: Polygon = round ? Array.from({ length: 8 }, (_, k) => ({ x: c.x + Math.cos(k * Math.PI / 4) * short * .6, y: c.y + Math.sin(k * Math.PI / 4) * short * .6 })) : b.poly;
    // One storey; a few two-storey houses where the culture builds in tile, slate or shingle on masonry or timber.
    const floors = !round && roof !== 'flat' && u < .25 && /^(tile|slate|shingle)$/.test(cover) ? 2 : 1, half = (round ? short * .6 : Math.min(long, short) / 2);
    const rise = roof === 'flat' ? 0 : roof === 'dome' || roof === 'barrel' ? half : roof === 'tent' ? half * .8 : Math.min(6, Math.tan(pitchOf(cover, s.culture) * Math.PI / 180) * half);
    const line = roof === 'gable' || roof === 'hip' || roof === 'barrel' ? farmBuildingRidge({ poly, use: 'house', arch: '', roof: roof === 'hip' ? 'hip' : 'gable' }) : null;
    const piece: MassingPiece = { floors, eave_m: .4 + 2.6 * floors, rise_m: rise, roof: (roof === 'gable' || roof === 'barrel') && !line ? 'hip' : roof,
      ridges: line ? [[line[0].x, line[0].y, line[1].x, line[1].y]] : [], cover, wall, tone };
    const footprint = [{ outer: poly, holes: [] }], ground = sampleGrid(height, c.x, c.y);
    buildings.push({ id: `place:${s.key}:${bi}`, parcel_id: `place:${s.key}`, function: 'domestic', culture: { culture: s.culture, pack: '', mode: 'historical_inspired', borrowing: null },
      recipe_id: 'silhouette', variant_id: 'house', transform: { origin: { x: s.center.x, y: s.center.y }, orientation_deg: (b.orientation ?? 0) * 180 / Math.PI },
      ground_z_m: Number.isFinite(ground) ? ground : 0, footprint, roof_footprint: footprint, courtyards: [], circulation: [], entrance: c, access_id: '',
      volumes: [], useful_area_m2: 0, domestic_units: 0, structural_features: [], simplification: 'recipe_volumes', diagnostics: [], resolved: null,
      programme: { massing: [piece] } } as unknown as PlacedBuilding);
    // Foot of the house on its lane: the line through the centre of the place along the house.
    const a = b.orientation ?? 0, t = (c.x - s.center.x) * Math.cos(a) + (c.y - s.center.y) * Math.sin(a);
    feet.push({ angle: t < 0 ? a + Math.PI : a, reach: Math.abs(t) });
  });
  // Houses whose feet point the same way from the centre share a lane, which runs a little past the last of them.
  const turn = (a: number): number => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), lanes: StandIn['lanes'] = [];
  const sorted = feet.map(f => ({ ...f, angle: turn(f.angle) })).sort((p, q) => p.angle - q.angle);
  for (let i = 0; i < sorted.length;) {
    let j = i, reach = 0, sx = 0, sy = 0;
    while (j < sorted.length && (j === i || sorted[j].angle - sorted[j - 1].angle < .3)) { reach = Math.max(reach, sorted[j].reach); sx += Math.cos(sorted[j].angle); sy += Math.sin(sorted[j].angle); j++; }
    const a = Math.atan2(sy, sx);
    lanes.push([{ x: s.center.x, y: s.center.y }, { x: s.center.x + Math.cos(a) * (reach + 7), y: s.center.y + Math.sin(a) * (reach + 7) }]);
    i = j;
  }
  standIns.set(s, held = { buildings, lanes });
  return held;
}
const standInLists = new WeakMap<readonly Settlement[], { key: string; list: PlacedBuilding[] }>();
/** The stand-in houses of every place still waiting for its plan, as placed buildings (the 3D view raises them like
 * town silhouettes). The same list object as long as the same places wait. */
export function placeholderPlacedBuildings(world: World | undefined): PlacedBuilding[] | undefined {
  const settlements = world?.settlements, lazy = settlements?.filter(isLazy);
  if (!world || !settlements || !lazy?.length) return undefined;
  const key = lazy.map(s => s.key).join('|');
  let held = standInLists.get(settlements);
  if (!held || held.key !== key) standInLists.set(settlements, held = { key, list: lazy.flatMap(s => standIn(world, s).buildings) });
  return held.list;
}
const standInPlans = new WeakMap<Settlement, { Path: unknown; buildings: CityBuildings; lanes: Path2D }>();
/** Paints, on a natural ground, the places still waiting for their plan: earth lanes (`lane` strokes one with the
 * natural road look) and their houses through the roof painter of the towns. `ctx` is in world coordinates. */
export function drawPlaceholderRoofs(ctx: CanvasRenderingContext2D, world: World,
  o: { viewport: Box; mpp: number; dpr: number; palette: CityPalette; night?: boolean; Path?: new () => Path2D; lane(path: Path2D): void }): number {
  const Path = o.Path ?? Path2D, v = o.viewport;
  let drawn = 0;
  for (const s of world.settlements ?? []) {
    if (!isLazy(s)) continue;
    const margin = (s.radius ?? 120) + 40;
    if (s.center.x < v.minX - margin || s.center.x > v.maxX + margin || s.center.y < v.minY - margin || s.center.y > v.maxY + margin) continue;
    let plan = standInPlans.get(s);
    if (!plan || plan.Path !== Path) {
      const source = standIn(world, s), buildings = buildCityBuildings({ buildings: source.buildings }), lanes = new Path();
      for (const item of buildings.items) item.snowAltitude = item.building.ground_z_m;
      buildings.pathClass = o.Path;
      for (const lane of source.lanes) { lanes.moveTo(lane[0].x, lane[0].y); lanes.lineTo(lane[1].x, lane[1].y); }
      standInPlans.set(s, plan = { Path, buildings, lanes });
    }
    o.lane(plan.lanes);
    drawn += drawRoofedBuildings(ctx, plan.buildings, { viewport: v, mpp: o.mpp, dpr: o.dpr, palette: o.palette, night: o.night,
      appearance: { style: 'cartographic', diagnostic: 'none', ambience: o.night ? 'night' : 'day' } });
  }
  return drawn;
}

// ---------------------------------------------------------------- the lot around the buildings (natural grounds)
/** The pieces of a farm lot as a photograph shows them, for natural grounds: no plan tint, no outline. Yard and pens
 * are beaten earth that fades at its edge, the garden a muted plot in the tones of the ground with its bed rows (the
 * market gardens of the ground material, `landGarden`), the orchard the grass it stands on under small crowns with a
 * lit side and a short shadow, the pond dark inland water inside an irregular wet bank. Everything takes the tone
 * of the map ground at the farm and goes under the snow with it. Paths are built once per farm. */
type Rgb3 = readonly [number, number, number];
interface LotPaths { yard: Path2D; core: Path2D; pens: Path2D; garden: Path2D; rows: Path2D; bank: Path2D; pond: Path2D; shadows: Path2D; crowns: Path2D; lights: Path2D; box: Box }
const lots = new WeakMap<Farmstead, { Path: unknown; paths: LotPaths }>();
const unit = (a: number, b: number, salt: number): number => { let h = Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca6b) ^ salt; h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); return ((h ^ (h >>> 13)) >>> 8 & 0xffff) / 0xffff; };
const centreOf = (p: Polygon): { x: number; y: number } => ({ x: p.reduce((s, q) => s + q.x, 0) / p.length, y: p.reduce((s, q) => s + q.y, 0) / p.length });
const ringTo = (path: Path2D, p: Polygon, k = 1): void => {
  if (p.length < 3) return;
  const c = centreOf(p);
  p.forEach((q, i) => { const x = c.x + (q.x - c.x) * k, y = c.y + (q.y - c.y) * k; if (i) path.lineTo(x, y); else path.moveTo(x, y); });
  path.closePath();
};
/** A soft closed outline through the plot's corners moved in or out by up to `wobble` of their distance to its middle. */
function blobTo(path: Path2D, p: Polygon, k: number, wobble: number, seed: number): void {
  if (p.length < 3) return;
  const c = centreOf(p), v = p.map((q, i) => { const s = k * (1 + wobble * (unit(seed, i, 0x51) - .5)); return { x: c.x + (q.x - c.x) * s, y: c.y + (q.y - c.y) * s }; });
  const mid = (i: number): { x: number; y: number } => { const a = v[i], b = v[(i + 1) % v.length]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
  const start = mid(v.length - 1); path.moveTo(start.x, start.y);
  v.forEach((q, i) => { const m = mid(i); path.quadraticCurveTo(q.x, q.y, m.x, m.y); });
  path.closePath();
}
/** Bed rows of a garden plot: lines along its longest side, 1.2 m apart, cut at the plot's edge. */
function rowsTo(path: Path2D, p: Polygon): void {
  if (p.length < 3) return;
  let ux = 1, uy = 0, best = 0;
  p.forEach((a, i) => { const b = p[(i + 1) % p.length], l = Math.hypot(b.x - a.x, b.y - a.y); if (l > best) { best = l; ux = (b.x - a.x) / l; uy = (b.y - a.y) / l; } });
  const across = (q: { x: number; y: number }): number => -q.x * uy + q.y * ux, along = (q: { x: number; y: number }): number => q.x * ux + q.y * uy;
  const lo = Math.min(...p.map(across)), hi = Math.max(...p.map(across));
  for (let d = lo + .6; d < hi; d += 1.2) {
    let t0 = Infinity, t1 = -Infinity;
    p.forEach((a, i) => {
      const b = p[(i + 1) % p.length], da = across(a) - d, db = across(b) - d;
      if ((da > 0) === (db > 0)) return;
      const t = da / (da - db), s = along(a) + (along(b) - along(a)) * t;
      t0 = Math.min(t0, s); t1 = Math.max(t1, s);
    });
    if (t1 - t0 > .8) { path.moveTo(ux * (t0 + .3) - uy * d, uy * (t0 + .3) + ux * d); path.lineTo(ux * (t1 - .3) - uy * d, uy * (t1 - .3) + ux * d); }
  }
}
function lotPaths(f: Farmstead, fi: number, Path: new () => Path2D): LotPaths {
  const held = lots.get(f);
  if (held && held.Path === Path) return held.paths;
  const paths: LotPaths = { yard: new Path(), core: new Path(), pens: new Path(), garden: new Path(), rows: new Path(), bank: new Path(), pond: new Path(), shadows: new Path(), crowns: new Path(), lights: new Path(),
    box: { minX: f.pos.x, minY: f.pos.y, maxX: f.pos.x, maxY: f.pos.y } };
  const grow = (p: Polygon): void => { for (const q of p) { const b = paths.box; if (q.x < b.minX) b.minX = q.x; if (q.y < b.minY) b.minY = q.y; if (q.x > b.maxX) b.maxX = q.x; if (q.y > b.maxY) b.maxY = q.y; } };
  ringTo(paths.yard, f.yard); ringTo(paths.core, f.yard, .78); grow(f.yard);
  (f.plots ?? []).forEach((plot, pi) => {
    grow(plot.poly);
    if (plot.kind === 'pen' || plot.kind === 'threshing-floor') ringTo(paths.pens, plot.poly);
    else if (plot.kind === 'garden' && f.cultivation !== 'fungal') { ringTo(paths.garden, plot.poly, .97); rowsTo(paths.rows, plot.poly); }
    else if (plot.kind === 'pond') { blobTo(paths.bank, plot.poly, 1.14, .16, fi * 97 + pi); blobTo(paths.pond, plot.poly, 1, .16, fi * 97 + pi); }
  });
  (f.trees ?? []).forEach((t, ti) => {
    // Neither a grid nor one size: each tree stands a little off its mark.
    const r = 1.7 + 1.2 * unit(fi, ti, 1), x = t.x + 1.2 * (unit(fi, ti, 2) - .5), y = t.y + 1.2 * (unit(fi, ti, 3) - .5);
    const disc = (path: Path2D, cx: number, cy: number, radius: number): void => { path.moveTo(cx + radius, cy); path.arc(cx, cy, radius, 0, Math.PI * 2); };
    disc(paths.shadows, x + r * .55, y + r * .45, r * .95); disc(paths.crowns, x, y, r); disc(paths.lights, x - r * .28, y - r * .3, r * .55);
    grow([{ x: x - 2 * r, y: y - 2 * r }, { x: x + 2 * r, y: y + 2 * r }]);
  });
  lots.set(f, { Path, paths });
  return paths;
}
const blend = (a: Rgb3, b: Rgb3, t: number): Rgb3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const paintOf = (c: Rgb3, alpha: number, dim: number): string => `rgba(${Math.round(c[0] * dim)},${Math.round(c[1] * dim)},${Math.round(c[2] * dim)},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
const SNOW: Rgb3 = [226, 231, 234];

/** Paints the lot pieces of the farms in view on a natural ground: `part` 'ground' (yard, pens, garden, pond) before
 * the walls, 'trees' after them. `ctx` is in world coordinates, `mpp` the metres of one pixel. */
export function drawFarmLots(ctx: CanvasRenderingContext2D, world: World, o: { part: 'ground' | 'trees'; viewport: Box; mpp: number; night?: boolean; Path?: new () => Path2D }): void {
  const height = world.terrain?.height;
  drawFarmLotPieces(ctx, world.landuse?.farmsteads, { ...o, altitude: height ? (x, y) => sampleGrid(height, x, y) : undefined });
}
/** The same pieces from a farmstead list (the ground tiles of the 3D view); `altitude` gives the ground height (m)
 * that decides their snow. */
export function drawFarmLotPieces(ctx: CanvasRenderingContext2D, farmsteads: readonly Farmstead[] | undefined,
  o: { part: 'ground' | 'trees'; viewport: Box; mpp: number; night?: boolean; Path?: new () => Path2D; altitude?: (x: number, y: number) => number }): void {
  if (!farmsteads?.length) return;
  const Path = o.Path ?? Path2D, dim = o.night ? .35 : 1, v = o.viewport;
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.setLineDash([]); ctx.globalAlpha = 1;
  farmsteads.forEach((f, fi) => {
    if (f.pos.x < v.minX - 150 || f.pos.x > v.maxX + 150 || f.pos.y < v.minY - 150 || f.pos.y > v.maxY + 150) return;
    const p = lotPaths(f, fi, Path), b = p.box;
    if (b.minX > v.maxX || b.maxX < v.minX || b.minY > v.maxY || b.maxY < v.minY) return;
    const sample = groundAt(f.pos.x, f.pos.y, 2), ground: Rgb3 = sample ? [sample[0], sample[1], sample[2]] : [98, 104, 64];
    const altitude = o.altitude ? o.altitude(f.pos.x, f.pos.y) : 0, snow = o.night ? 0 : mapGroundSnow(Number.isFinite(altitude) ? altitude : 0), bare = 1 - .92 * snow;
    if (o.part === 'trees') {
      ctx.fillStyle = paintOf(snow > .3 ? [22, 38, 70] : [12, 18, 10], .3, 1); ctx.fill(p.shadows);
      ctx.fillStyle = paintOf(blend(blend([60, 82, 46], ground, .25), SNOW, .55 * snow), 1, dim); ctx.fill(p.crowns);
      ctx.fillStyle = paintOf(blend([112, 130, 76], SNOW, .7 * snow), .5, dim); ctx.fill(p.lights);
      return;
    }
    // Beaten earth: a wash that is strongest in the middle of the yard and fades past its edge.
    const earth = blend(ground, [152, 134, 102], .55);
    ctx.strokeStyle = paintOf(earth, .12 * bare, dim); ctx.lineWidth = 1.8; ctx.stroke(p.yard);
    ctx.fillStyle = paintOf(earth, .22 * bare, dim); ctx.fill(p.yard); ctx.fill(p.core); ctx.fill(p.pens);
    ctx.strokeStyle = paintOf([62, 50, 38], .28 * bare, dim); ctx.lineWidth = Math.max(.2, .6 * o.mpp); ctx.stroke(p.pens);
    // Garden: dug soil and low greens close to the ground's own tone; bed rows only where they resolve.
    ctx.fillStyle = paintOf(blend(ground, [92, 94, 62], .6), .7 * bare, dim); ctx.fill(p.garden);
    const rows = Math.max(0, Math.min(1, (.55 - o.mpp) / .2));
    if (rows > 0) { ctx.strokeStyle = paintOf([70, 57, 41], .42 * rows * bare, dim); ctx.lineWidth = .45; ctx.stroke(p.rows); }
    // Pond: a wet bank without outline, then the dark water of the map's rivers and lakes (ice under snow).
    ctx.fillStyle = paintOf(blend(blend(ground, [50, 52, 40], .6), SNOW, .7 * snow), .55, dim); ctx.fill(p.bank);
    ctx.fillStyle = paintOf(blend([39, 71, 74], [198, 208, 214], .85 * snow), 1, dim); ctx.fill(p.pond);
  });
  ctx.restore();
}
