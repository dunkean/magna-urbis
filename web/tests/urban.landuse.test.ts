import { describe, expect, it } from 'vitest';
import type { UrbanLanduseInput } from '../src/ui/urbanLanduseData';
import { generateUrbanLanduse, urbanLanduseWorld } from '../src/ui/urbanLanduseData';
import { buildForestField } from '../../rust/bridge/terrainForest';
import { intersectionS, mpArea } from '../src/gen/geo/bool';
import type { PolyH } from '../src/gen/types';

const box = (x: number, y: number, w: number, h = w): PolyH => ({
  outer: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], holes: [],
});
function fixture(): UrbanLanduseInput {
  const n = 96, height = new Float32Array(n * n).fill(24), water = new Uint8Array(n * n);
  const waterLevel = height.slice(), riverWidth = new Float32Array(n * n), riverIds = new Int32Array(n * n).fill(-1);
  for (let y = 0; y < n; y++) for (let x = 0; x < 3; x++) {
    const i = y * n + x; water[i] = 3; height[i] = 5; waterLevel[i] = 18; riverWidth[i] = 70; riverIds[i] = 0;
  }
  return { raster: { n, width: 2400, height, water, waterLevel, riverWidth, riverIds }, seed: '42', biome: 'temperate', relief: 'flat',
    city: { key: 'city', center: { x: 1150, y: 1150 }, population: 3000, culture: 'european-organic', radius: 380 }, neighbours: [],
    layouts: [{ key: 'city', center: { x: 1150, y: 1150 }, culture: 'european-organic', warnings: [], blocks: [], streets: [],
      quarters: [{ shape: box(1000, 1000, 350, 550), phase: 0 }, { shape: box(1350, 1250, 450, 300), phase: 0 }] }],
  };
}

describe('Urban Bench countryside on retained plans', () => {
  it('keeps the natural cover when its Render3D display is disabled and retains open grazing land', () => {
    const input = fixture(), r = input.raster;
    input.forest = {input:{seed:42,climate:[18,1000],height:{x:0,y:0,width:r.width,n:r.n,data:r.height},water:r.water},settings:{enabled:true,density:1,clearings:.45}};
    const a = generateUrbanLanduse(input);
    input.forest.settings.enabled = false;
    expect(generateUrbanLanduse(input).landuse).toEqual(a.landuse);
    expect(a.landuse!.areas.some(a => ['pasture','meadow','commons'].includes(a.kind))).toBe(true);
  });
  it('keeps the same agricultural geometry with and without a cached forest field', () => {
    const input = fixture(), r = input.raster, n = r.n * 2;
    const height = Float32Array.from({length:n*n}, (_, i) => 30 + 20 * Math.sin((i % n) / 8));
    const source = { seed:42, climate:[18,1000] as const, height:{x:0,y:0,width:r.width,n,data:height} };
    const settings = {enabled:true,density:1,clearings:.45};
    input.forest = {input:source,settings};
    const cold = generateUrbanLanduse(input);
    input.forest = {field:buildForestField(source, settings),settings};
    expect(generateUrbanLanduse(input).landuse).toEqual(cold.landuse);
  });
  it('reserves an adjacent native town by its actual plan rather than a projected disc', () => {
    const input = fixture();
    input.neighbours = [{key:'town',center:{x:500,y:1600},radius:250,population:500,culture:'european-organic'}];
    input.layouts!.push({key:'town',center:{x:500,y:1600},culture:'european-organic',blocks:[],streets:[],warnings:[],quarters:[{phase:0,shape:box(480,1580,40)}]});
    const scene = generateUrbanLanduse(input);
    const cover = scene.landuse!.areas.map(a => ({outer:a.poly,holes:a.holes??[]}));
    expect(mpArea(intersectionS(cover,box(620,1540,80)))).toBeGreaterThan(500);
    expect(mpArea(intersectionS(cover,box(480,1580,40)))).toBeLessThan(.01);
  });
  it('uses retained forest controls and never restores woodland when Render3D has none', () => {
    const input = fixture(), r = input.raster;
    input.biome = 'forest';
    input.forest = { input: { seed: 42, climate: [12, 850],
      height: {x:0,y:0,width:r.width,n:r.n,data:r.height}, water:r.water },
      settings: {enabled:true,density:0,clearings:.45} };
    expect(generateUrbanLanduse(input).landuse!.areas.some(a => a.kind === 'forest')).toBe(false);
    input.city = undefined; input.layouts = undefined;
    expect(generateUrbanLanduse(input).landuse!.areas.some(a => a.kind === 'forest')).toBe(false);
  });

  it('reserves the real quarters without houses, keeps compact holdings and source buffers deterministic', () => {
    const input = fixture(), before = structuredClone(input);
    const a = generateUrbanLanduse(input), b = generateUrbanLanduse(input);
    expect(a.landuse).toEqual(b.landuse);
    expect(input).toEqual(before);
    expect(a.landuse!.farmsteads).toEqual([]);
    expect(a.landuse!.areas.some(area => area.kind === 'field' && area.fieldLayout === 'parcel')).toBe(true);
    const quarters = input.layouts![0].quarters.map(q => q.shape);
    for (const area of a.landuse!.areas) {
      expect(mpArea(intersectionS([{ outer: area.poly, holes: area.holes ?? [] }], quarters))).toBeLessThan(0.01);
      for (const strip of area.strips ?? []) expect(mpArea(intersectionS(strip, quarters))).toBeLessThan(0.01);
      for (const point of area.poly) {
        expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
        expect(point.x).toBeGreaterThan(75);
      }
    }
  });

  it('uses the retained water surface and excludes cavern rock from irrigation sources', () => {
    const input = fixture();
    input.raster.water[30 * 96 + 50] = 4;
    input.raster.waterLevel[30 * 96 + 50] = 100;
    const world = urbanLanduseWorld(input), fields = world.site!.fields;
    expect(fields.hab[30 * 96 + 4]).toBeCloseTo(6);
    expect(fields.dWater[30 * 96 + 50]).toBeGreaterThan(1000);
    expect(world.terrain.height.data).toBe(input.raster.height);
    expect(world.site!.center).toEqual(input.city!.center);
  });

  it('lets countryside occupy retained open-fringe reserves while protecting built blocks', () => {
    const input = fixture(), free = box(1020, 1100, 300, 450);
    input.layouts![0].blocks = [{ shape: free, quarter: 0, kind: 'reserve', axis: { x: 1, y: 0 }, zone: 'edge' }];
    const scene = generateUrbanLanduse(input);
    const cover = scene.landuse!.areas.map(a => ({ outer: a.poly, holes: a.holes ?? [] }));
    expect(mpArea(intersectionS(cover, free))).toBeGreaterThan(1000);
    expect(mpArea(intersectionS(cover, box(1400, 1300, 300, 150)))).toBeLessThan(0.01);
  });

  it('produces natural cover when the city is removed', () => {
    const input = fixture(); input.city = undefined; input.layouts = undefined;
    const scene = generateUrbanLanduse(input);
    expect(scene.landuse!.areas.length).toBeGreaterThan(0);
    expect(scene.landuse!.areas.some(a => ['field', 'garden', 'orchard'].includes(a.kind))).toBe(false);
    expect(scene.landuse!.reserve).toEqual([]);
  });

  it('keeps dry cavern walls out of natural marsh classification', () => {
    const input = fixture(); input.city = undefined; input.layouts = undefined; input.biome = 'underdark';
    input.raster.water.fill(0);
    for (let y = 30; y < 60; y++) for (let x = 30; x < 60; x++) input.raster.water[y * 96 + x] = 4;
    const scene = generateUrbanLanduse(input);
    expect(scene.landuse!.areas.length).toBeGreaterThan(0);
    expect(scene.landuse!.areas.every(a => a.kind === 'commons')).toBe(true);
  });
  it('retains supplied site geography and known programme context', () => {
    const input = fixture();
    input.city = { ...input.city!, archetype: 'valley', offers: { valley: 0.8 }, resources: ['ore'],
      profile: { intent: 'settlement', functions: { artisan: 1 }, resources: ['ore'], mode: 'inspired', period: 'medieval', lore: [], navigableAccess: false } };
    const world = urbanLanduseWorld(input);
    expect(world.site!.archetype).toBe('valley');
    expect(world.site!.offers).toEqual({ valley: 0.8 });
    expect(generateUrbanLanduse(input).context).toMatchObject({ archetype: 'valley', resources: ['ore'], profile: { intent: 'settlement', functions: { artisan: 1 } } });
  });

  it('keeps modern functional reservations protected while allowing countryside in open reserves', () => {
    const input = fixture(), layout = input.layouts![0];
    const open = box(1020, 1100, 120, 250), functional = box(1160, 1100, 120, 250);
    layout.blocks = [open, functional].map(shape => ({ shape, quarter: 0, kind: 'reserve', axis: { x: 1, y: 0 }, zone: 'edge' }));
    layout.structure = { version: 1, mechanism: 'accessibility', family: 'compact', reserve: [], allocated: layout.quarters.map(q => q.shape),
      centers: [], districts: [], history: [], metrics: { targetArea: 0, allocatedArea: 0, streetArea: 0, reservedArea: 0, grossDensity: 0,
        plannedPopulation: 3000, shortfallArea: 0, components: 1, accessAdded: 0 } };
    layout.programme = { version: 1, population: 3000, context: { intent: 'settlement', functions: { commerce: 1 }, resources: [], period: '', mode: 'inspired', navigableAccess: false, lore: [] },
      cultures: [], demands: [], allocations: [], adjacency: [], environment: [], reconciliationPasses: 0, warnings: [],
      reservations: [{ id: 'market', demandId: 'market', block: 1, shape: functional, street: 0, frontage: 120 }] };
    const scene = generateUrbanLanduse(input);
    const cover = scene.landuse!.areas.map(a => ({ outer: a.poly, holes: a.holes ?? [] }));
    expect(mpArea(intersectionS(cover, open))).toBeGreaterThan(1000);
    expect(mpArea(intersectionS(cover, functional))).toBeLessThan(0.01);
  });

  it('keeps rural farmsteads outside retained urban land when agricultural use is explicit', () => {
    const input = fixture();
    input.layouts![0].streets = [{ path: [{ x: 150, y: 1150 }, { x: 2200, y: 1150 }], widths: [4, 4], rank: 1, role: 'regional' }];
    input.city!.profile = { intent: 'settlement', functions: { agricultural: 1 }, resources: ['grain'], mode: 'inspired', period: '', lore: [], navigableAccess: false };
    const scene = generateUrbanLanduse(input), quarters = input.layouts![0].quarters.map(q => q.shape);
    expect(scene.landuse!.farmsteads.length).toBeGreaterThan(0);
    for (const farm of scene.landuse!.farmsteads) for (const footprint of farm.buildings) {
      expect(mpArea(intersectionS(footprint, quarters))).toBeLessThan(0.01);
    }
  });

  it('keeps Reddit options off byte-identical and adds admissible smallholdings by the town roads', () => {
    const input = fixture();
    input.layouts![0].streets = [{ path: Array.from({length:41},(_,i)=>({x:150+i*50,y:1150})), widths: Array(41).fill(4), rank:1,role:'regional' }];
    input.city!.profile = { intent:'settlement',functions:{agricultural:1},resources:['grain'],mode:'inspired',period:'',lore:[],navigableAccess:false };
    const baseline = generateUrbanLanduse(input).landuse!;
    input.ruralOptions = { streetAlignedHomes:false,denserSmallholdings:false };
    expect(JSON.stringify(generateUrbanLanduse(input).landuse)).toBe(JSON.stringify(baseline));
    input.ruralOptions = { streetAlignedHomes:true,denserSmallholdings:true };
    const dense = generateUrbanLanduse(input).landuse!;
    expect(dense.farmsteads.length).toBeGreaterThan(baseline.farmsteads.length);
    expect(dense.farmsteads.some(f=>f.size==='cottage')).toBe(true);
    for (const f of dense.farmsteads) {
      expect(mpArea(intersectionS(f.lot!,input.layouts![0].quarters.map(q=>q.shape)))).toBeLessThan(.01);
      expect(f.drive.length).toBeGreaterThanOrEqual(2);
    }
  });

});
