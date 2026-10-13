import type { Layout } from '../../../rust/bridge/urban';
import { regionalOutsideUrban } from '../../../rust/bridge/urbanNetwork';
import type { RoadOutput, RoadSite, SettlementRaster } from '../../../rust/bridge/settlements';
import { Rng } from '../gen/core/rng';
import { createGrid, slopeGrid, blurGrid, visitSegmentCells } from '../gen/core/grid';
import { distanceField } from '../gen/core/field';
import { differenceS, unionS } from '../gen/geo/bool';
import { dijkstra } from '../gen/site/site';
import { DEFAULTS, classOfPop, sizeForPop } from '../gen/options';
import type { Relief } from '../gen/options';
import type { BiomeName } from '../gen/biomes';
import type { PolyH, SiteFields, TerrainLayer, World } from '../gen/types';
import { generateRural } from '../gen/landuse/rural';
import { generateNaturalCover } from '../gen/landuse/natural';

/** Temporary compatibility input; the retained Rust terrain and plans remain authoritative. */
export interface UrbanLanduseInput {
  raster: SettlementRaster;
  seed: string;
  biome: BiomeName;
  relief: Relief;
  city?: RoadSite;
  neighbours: RoadSite[];
  roads?: RoadOutput;
  /** undefined: urban generation disabled; []: an actual empty plan. */
  layouts?: Layout[];
}
export type UrbanLanduseScene = Pick<World, 'seed' | 'options' | 'mapSize' | 'landuse' | 'stats'>;
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
  world.site = { center: city.center, archetype: 'plain', offers: {}, reserveRadius: city.radius,
    cost: { w: n, h: n, cell, data: cost }, fields };
  world.settlements = input.neighbours.filter(s => s.key !== city.key).map((s, i) => ({
    ...s, index: i + 1, cls: classOfPop(s.population), archetype: 'plain', extent: extent(s).outer, region: [], detail: 'lazy',
  }));
  return world;
}

export function generateUrbanLanduse(input: UrbanLanduseInput): UrbanLanduseScene {
  const start = performance.now(), world = urbanLanduseWorld(input), root = new Rng('magna-urbis:' + input.seed);
  if (input.city) {
    const footprint = input.layouts === undefined ? [extent(input.city)]
      : unionS(input.layouts.flatMap(layout => layout.structure && layout.structure.mechanism !== 'legacy'
        ? layout.structure.allocated
        : differenceS(unionS(layout.quarters.map(q => q.shape)), unionS(layout.blocks.filter(b => b.kind === 'reserve').map(b => b.shape)))));
    const generated = generateRural(world, root, undefined, undefined,
      { footprint, population: input.city.population, farmsteads: false });
    world.landuse = generated.layer; world.stats = generated.stats;
  } else {
    world.landuse = generateNaturalCover(world.terrain, input.biome, root);
  }
  world.stats.ms = Math.round(performance.now() - start);
  world.stats.areas = world.landuse.areas.length;
  const { seed, options, mapSize, landuse, stats } = world;
  return { seed, options, mapSize, landuse, stats };
}
