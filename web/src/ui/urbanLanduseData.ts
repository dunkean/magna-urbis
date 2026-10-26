import type { Layout } from '../../../rust/bridge/urban';
import { regionalOutsideUrban } from '../../../rust/bridge/urbanNetwork';
import type { RoadOutput, RoadSite, SettlementRaster } from '../../../rust/bridge/settlements';
import { Rng } from '../gen/core/rng';
import { createGrid, slopeGrid, blurGrid, visitSegmentCells } from '../gen/core/grid';
import { distanceField } from '../gen/core/field';
import { differenceS, unionS } from '../gen/geo/bool';
import { dijkstra } from '../gen/site/site';
import { DEFAULTS, SITE_ARCHETYPES, classOfPop, sizeForPop } from '../gen/options';
import type { Relief, SiteArchetype } from '../gen/options';
import type { BiomeName } from '../gen/biomes';
import type { PolyH, SiteFields, TerrainLayer, World } from '../gen/types';
import { generateRural } from '../gen/landuse/rural';
import { generateNaturalCover } from '../gen/landuse/natural';
import { buildForestField, type ForestField, type ForestFieldInput, type ForestSettings } from '../../../rust/bridge/terrainForest';
import { CLIMATE_VALUES } from '../../../rust/bridge/terrainClimate';
import { seedHash } from '../../../rust/bridge/terrainAdjust';

export interface UrbanLanduseSite extends RoadSite {
  archetype?: string; siteType?: string; offers?: Partial<Record<SiteArchetype, number>>;
  resources?: string[]; profile?: import('../../../rust/bridge/urbanConfig').ProgrammeContext;
}
/** Temporary compatibility input; the retained Rust terrain and plans remain authoritative. */
export interface UrbanLanduseInput {
  raster: SettlementRaster;
  seed: string;
  biome: BiomeName;
  relief: Relief;
  city?: UrbanLanduseSite;
  neighbours: UrbanLanduseSite[];
  roads?: RoadOutput;
  /** undefined: urban generation disabled; []: an actual empty plan. */
  layouts?: Layout[];
  /** Same unoccupied terrain, climate and controls as Render3D, before rural clearings. */
  forest?: { input?: ForestFieldInput; settings: ForestSettings; field?: ForestField; key?: string };
}
export type UrbanLanduseScene = Pick<World, 'seed' | 'options' | 'mapSize' | 'landuse' | 'stats'> & {
  /** Retained known programme inputs; rural cover currently consumes site geography and culture. */
  context?: { archetype: SiteArchetype; offers: Partial<Record<SiteArchetype, number>>; resources: string[]; profile?: import('../../../rust/bridge/urbanConfig').ProgrammeContext };
};
function siteArchetype(site: UrbanLanduseSite): SiteArchetype {
  const value = site.archetype ?? site.siteType;
  return SITE_ARCHETYPES.includes(value as SiteArchetype) ? value as SiteArchetype : 'plain';
}
export interface UrbanLanduseRequest { id: number; input: UrbanLanduseInput }
export type UrbanLanduseResponse = { id: number; scene: UrbanLanduseScene } | { id: number; error: string };

/** Display adapter only. The caller supplies the retained relief bitmap to the renderer. */
export function urbanLanduseRenderWorld(scene: UrbanLanduseScene, r: SettlementRaster): World {
  const height = { w: r.n, h: r.n, cell: r.width / r.n, data: r.height };
  const empty = createGrid(r.n, r.n, height.cell);
  return { ...scene, options: { ...scene.options, landuse: true, contours: false, labels: false, legend: false },
    terrain: { height, slope: empty, flow: empty, water: r.water, seaLevel: 0, seaFraction: 0,
      coastline: [], lakes: [], rivers: [], receiver: new Int32Array(0), filled: r.height, downSide: 'S', seaSide: null } };
}

function extent(site: RoadSite): PolyH {
  return { outer: Array.from({ length: 48 }, (_, i) => {
    const angle = i * Math.PI / 24;
    return { x: site.center.x + site.radius * Math.cos(angle), y: site.center.y + site.radius * Math.sin(angle) };
  }), holes: [] };
}

function ruralFootprint(layout: Layout): PolyH[] {
  const open = unionS(layout.blocks.filter((b, i) => b.kind === 'reserve'
    && !layout.programme?.reservations.some(reserve => reserve.block === i)).map(b => b.shape));
  return differenceS(layout.structure && layout.structure.mechanism !== 'legacy'
    ? layout.structure.allocated : unionS(layout.quarters.map(q => q.shape)), open);
}

/** Adapt cell-centred metres and water levels, without generating or relocating anything. */
export function urbanLanduseWorld(input: UrbanLanduseInput): World {
  const { raster: r, city } = input, n = r.n, cell = r.width / n, count = n * n;
  const height = { w: n, h: n, cell, data: r.height };
  const slope = slopeGrid(height);
  const wet = new Uint8Array(count), sea = new Uint8Array(count), riverMask = new Uint8Array(count);
  const wide = new Uint8Array(count), bridgeZone = new Uint8Array(count);
  let seaCount = 0, waterCount = 0;
  for (let i = 0; i < count; i++) {
    // Native value 4 is cavern rock, not a water source for irrigation.
    if (r.water[i] > 0 && r.water[i] < 4) { wet[i] = 1; waterCount++; }
    if (r.water[i] === 1) { sea[i] = 1; seaCount++; }
    if (r.water[i] === 3) { riverMask[i] = r.riverWidth[i] >= 4.5 ? 1 : 2; wide[i] = r.riverWidth[i] > 3.7 ? 1 : 0; }
  }
  const terrain: TerrainLayer = {
    height, slope, water: r.water, flow: createGrid(n, n, cell), seaLevel: 0, seaFraction: seaCount / count,
    coastline: [], lakes: [], rivers: [], receiver: new Int32Array(count).fill(-1), filled: r.height,
    downSide: 'S', seaSide: null,
  };
  const world: World = {
    seed: input.seed, mapSize: r.width, terrain, stats: {},
    options: { ...DEFAULTS, seed: input.seed, biome: input.biome, relief: input.relief, mapSize: r.width,
      culture: city?.culture ?? DEFAULTS.culture, size: sizeForPop(city?.population ?? 0), population: city?.population ?? 0 },
  };
  if (!city) return world;
  // Regional geometry is authoritative outside towns; the retained native graph
  // replaces it inside. This also keeps old approaches out of rural cost fields.
  world.roads = regionalOutsideUrban(input.roads, input.layouts ?? []).map(road => ({ path: road.path, width: road.widths[0] ?? 3,
    kind: road.rank < 2 ? 'major' : road.rank === 2 ? 'minor' : 'track' }));
  // Urban streets also guide field access; retain each segment's physical width.
  for (const layout of input.layouts ?? []) for (const street of layout.streets) {
    if (['boundary', 'wall-lane', 'private', 'collective'].includes(street.role)) continue;
    for (let i = 1; i < street.path.length; i++) {
      const width = ((street.widths[i - 1] ?? 3) + (street.widths[i] ?? street.widths[i - 1] ?? 3)) / 2;
      if (width > 0) world.roads.push({ path: [street.path[i - 1], street.path[i]], width, kind: 'minor' });
    }
  }
  for (const road of world.roads) for (let i = 1; i < road.path.length; i++) {
    visitSegmentCells(height, road.path[i - 1], road.path[i], index => { bridgeZone[index] = 1; });
  }
  const waterDistance = distanceField(wet, n, n, cell, r.waterLevel);
  const hab = Float32Array.from(r.height, (h, i) => waterCount ? h - waterDistance.val![i] : 99);
  const fields: SiteFields = {
    dWater: waterDistance.dist, dSea: distanceField(sea, n, n, cell).dist,
    dMain: distanceField(Uint8Array.from(riverMask, v => v === 1 ? 1 : 0), n, n, cell).dist,
    hab, slopeS: blurGrid(slope, Math.max(1, Math.round(100 / cell)), 2).data, riverMask, bridgeZone, wide,
  };
  const pass = (i: number): number => r.water[i] === 0 ? 1 : r.water[i] === 4 ? 0
    : bridgeZone[i] ? 3 : r.water[i] === 3 && !wide[i] ? 2 : 0;
  const index = Math.max(0, Math.min(n - 1, Math.floor(city.center.y / cell))) * n
    + Math.max(0, Math.min(n - 1, Math.floor(city.center.x / cell)));
  const cost = dijkstra(n, n, index, (from, to, d) => {
    const pt = pass(to);
    if (!pt) return Infinity;
    const grade = pt >= 2 || pass(from) >= 2 ? 0 : Math.abs(r.height[to] - r.height[from]) / (d * cell);
    return d * cell * (1 + 100 * grade * grade) * (pt === 1 ? 1 : pt === 2 ? 4 : 3);
  });
  world.site = { center: city.center, archetype: siteArchetype(city), offers: { ...city.offers }, reserveRadius: city.radius,
    cost: { w: n, h: n, cell, data: cost }, fields };
  world.settlements = input.neighbours.filter(s => s.key !== city.key).map((s, i) => ({
    ...s, index: i + 1, cls: classOfPop(s.population), archetype: siteArchetype(s), extent: extent(s).outer, region: [], detail: 'lazy',
  }));
  return world;
}

export function generateUrbanLanduse(input: UrbanLanduseInput): UrbanLanduseScene {
  const start = performance.now();
  input = ruralResolution(input);
  const world = urbanLanduseWorld(input), root = new Rng('magna-urbis:' + input.seed);
  const r = input.raster;
  const forestInput = input.forest?.input ?? {
    seed: seedHash(input.seed), climate: [CLIMATE_VALUES.temperate.temperature, CLIMATE_VALUES.temperate.precipitation],
    height: { x: 0, y: 0, width: r.width, n: r.n, data: r.height }, water: r.water,
  } satisfies ForestFieldInput;
  const retained = input.forest?.field;
  const forest = input.biome === 'underdark' || input.biome === 'underdark-caverns' ? undefined : retained ?? buildForestField(forestInput,
    input.forest && { ...input.forest.settings, enabled: true });
  if (forest && (Math.abs(forest.x) > .001 || Math.abs(forest.y) > .001 || Math.abs(forest.width - r.width) > .001)) {
    throw new Error('Le couvert forestier et le terrain doivent partager la même emprise.');
  }
  const naturalForest = forest && Float32Array.from(r.height, (_, i) => {
    const x = Math.min(forest.n - 1, Math.floor(((i % r.n) + .5) / r.n * forest.n));
    const y = Math.min(forest.n - 1, Math.floor((Math.floor(i / r.n) + .5) / r.n * forest.n));
    // Box average when the cartographic raster is coarser than the control field.
    const x0 = Math.floor(i % r.n / r.n * forest.n), y0 = Math.floor(Math.floor(i / r.n) / r.n * forest.n);
    const x1 = Math.max(x0 + 1, Math.floor(((i % r.n) + 1) / r.n * forest.n));
    const y1 = Math.max(y0 + 1, Math.floor((Math.floor(i / r.n) + 1) / r.n * forest.n));
    if (forest.n <= r.n) return forest.rgba[(y * forest.n + x) * 4] / 255;
    let sum = 0;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) sum += forest.rgba[(yy * forest.n + xx) * 4];
    return sum / ((x1 - x0) * (y1 - y0) * 255);
  });
  const profile = input.city?.profile ?? input.layouts?.find(layout => layout.key === input.city?.key)?.programme?.context;
  if (input.city) {
    const settlementFootprints = input.layouts && Object.fromEntries(input.layouts.map(layout => [layout.key, ruralFootprint(layout)]));
    const footprint = input.layouts === undefined ? [extent(input.city)]
      : unionS(Object.values(settlementFootprints!).flat());
    const generated = generateRural(world, root, undefined, undefined,
      { footprint, population: input.city.population,
        // Existing TS rural buildings remain opt-in through an explicit agricultural
        // role; the retained urban footprint excludes their lots without cropping roofs.
        farmsteads: profile?.role === 'agricultural', naturalForest, settlementFootprints });
    world.landuse = generated.layer; world.stats = generated.stats;
  } else {
    world.landuse = generateNaturalCover(world.terrain, input.biome, root, naturalForest);
  }
  world.stats.ms = Math.round(performance.now() - start);
  world.stats.rasterCellMeters = input.raster.width / input.raster.n;
  world.stats.areas = world.landuse.areas.length;
  const { seed, options, mapSize, landuse, stats } = world;
  return { seed, options, mapSize, landuse, stats, context: input.city && {
    archetype: siteArchetype(input.city), offers: { ...input.city.offers },
    resources: [...(input.city.resources ?? profile?.resources ?? [])], profile,
  } };
}

/** Settlement placement tolerates coarse cells; small agricultural holdings do
 * not. Refine the display adapter only, with a bounded 1024² working grid.
 * Heights remain an interpolation of retained samples, water keeps its native
 * classification and the source arrays are never modified. */
function ruralResolution(input: UrbanLanduseInput): UrbanLanduseInput {
  const r = input.raster, n = Math.min(1024, Math.ceil(r.width / 20));
  if (n <= r.n) return input;
  const height = new Float32Array(n * n), water = new Uint8Array(n * n), waterLevel = new Float32Array(n * n);
  const riverWidth = new Float32Array(n * n), riverIds = new Int32Array(n * n);
  // Agricultural geometry always uses the retained placement raster. Reusing a
  // previously displayed forest field must not change the height source.
  const source = { n: r.n, width: r.width, data: r.height };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, sx = Math.max(0, Math.min(source.n - 1, (x + .5) / n * source.n - .5));
    const sy = Math.max(0, Math.min(source.n - 1, (y + .5) / n * source.n - .5));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(source.n - 1, x0 + 1), y1 = Math.min(source.n - 1, y0 + 1);
    const tx = sx - x0, ty = sy - y0;
    height[i] = (source.data[y0 * source.n + x0] * (1 - tx) + source.data[y0 * source.n + x1] * tx) * (1 - ty)
      + (source.data[y1 * source.n + x0] * (1 - tx) + source.data[y1 * source.n + x1] * tx) * ty;
    const j = Math.min(r.n - 1, Math.floor((y + .5) / n * r.n)) * r.n + Math.min(r.n - 1, Math.floor((x + .5) / n * r.n));
    water[i] = r.water[j]; waterLevel[i] = r.waterLevel[j]; riverWidth[i] = r.riverWidth[j]; riverIds[i] = r.riverIds[j];
  }
  return { ...input, raster: { ...r, n, height, water, waterLevel, riverWidth, riverIds } };
}
