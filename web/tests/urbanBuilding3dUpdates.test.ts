import { expect, it, vi } from 'vitest';
import reference from '../../rust/fixtures/houses/batch-reference.json';
import type { HouseBatch, Point, Surface } from '../../rust/bridge/housesContract';
import type { ArchitectureVolume, PlacementBatch, PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import { nativeExteriorDetail, UrbanBuildingDetailController } from '../src/render/urbanBuildingDetails';
import { compactBuilding } from '../src/render/city3dMeshes';
import { UrbanBuildingLodRenderer } from '../src/render/urbanBuildingLod';
import { eachBuildingTriangle } from '../src/render/urbanBuildingGeometry';
import { UrbanBuildingPass } from '../src/ui/urbanBuilding3d';
import { projectNativeBuildingRecords } from '../src/ui/urbanBuildingProjection';
import { city3dProjectionScene } from '../src/render/city3dMeshes';

const native = reference as unknown as HouseBatch, unit = native.units[0];
it('keeps six-digit palette colours on walls and roofs in flat/textured batches and preserves uses', () => {
  const source = plan('palette', 1000), slots = { frame: 'city3d:wall:stone@ccaa88', infill: 'city3d:wall:stone@ccaa88', coating: 'city3d:wall:stone@ccaa88', cladding: 'city3d:cover:slate@776655', base: 'city3d:wall:stone@ccaa88', roof_frame: 'city3d:wall:stone@ccaa88' };
  source.volumes = source.volumes.map(v => ({ ...v, materials: slots, levels: v.levels.map(l => ({ ...l, materials: slots })) }));
  const scene = batch([compactBuilding(source)]), { gl } = mockGl(), pass = new UrbanBuildingPass(gl), state = pass as unknown as Internals;
  const colors = () => state.sectors.flatMap(s => (s.cached as { batches: { color: number[]; palette?: number[][] }[] }).batches.flatMap(b => b.palette ?? [b.color]));
  for (const textured of [false, true]) {
    pass.setScene(scene, { style: 'cartographic', diagnostic: 'none', textured });
    for (const sector of state.sectors) state.prepare(sector, false);
    expect(colors()).toContainEqual([0xcc / 255, 0xaa / 255, 0x88 / 255]);
    expect(colors()).toContainEqual([0x77 / 255, 0x66 / 255, 0x55 / 255]);
  }
  pass.setScene(scene, { style: 'cartographic', diagnostic: 'uses' });
  for (const sector of state.sectors) state.prepare(sector, false);
  expect(colors().every(c => JSON.stringify(c) === JSON.stringify([0xcb / 255, 0xaa / 255, 0x77 / 255]))).toBe(true);
  pass.dispose();
});
function plan(id: string, x: number): PlacedBuilding {
  const map = (p: Point) => ({ x: x + p.x, y: 1000 + p.y });
  const surface = (value: Surface): Surface => value.map(p => ({ outer: p.outer.map(map), holes: p.holes.map(h => h.map(map)) }));
  const footprint = surface(unit.partition.occupied), ground = 120;
  return { id, parcel_id: `parcel-${id}`, function: 'domestic', culture: { culture: 'european-organic', pack: 'EUR-MED', mode: 'historical_inspired', borrowing: null },
    recipe_id: unit.recipe_id, variant_id: unit.variant_id, transform: { origin: { x, y: 1000 }, orientation_deg: 0 }, ground_z_m: ground,
    footprint, roof_footprint: footprint, courtyards: surface(unit.partition.courtyards), circulation: [], entrance: map({ x: 0, y: 0 }), access_id: 'front',
    volumes: unit.bodies.map(body => ({ ...body, footprint: surface(body.footprint), z_m: ground, wall_height_m: 3, roof_height_m: 3,
      levels: body.levels.map(level => ({ ...level, footprint: surface(level.footprint), z_m: ground + level.z_m })), materials: body.levels[0].materials,
      foundation: { footprint: surface(body.footprint), z_min_m: ground, z_max_m: ground }, roof_mesh: { vertices: [], faces: [], edges: [], groups: [] } })) as ArchitectureVolume[],
    useful_area_m2: 0, domestic_units: 0, structural_features: [], simplification: 'architectural_plan', diagnostics: [], resolved: { retained: id },
    cartographic: { height_m: 6, ridges: [], validation: 'plan_only' } };
}
const batch = (buildings: PlacedBuilding[]): PlacementBatch => ({ schema_version: '1', generator_version: 'detail-update-test', buildings, refusals: [], open_spaces: [] });
const exterior = (source: PlacedBuilding) => nativeExteriorDetail(source, { ...native, units: [{ ...unit, transform: source.transform }] }).building;
const triangles = (b: PlacedBuilding) => { const out: unknown[] = []; eachBuildingTriangle(b, face => out.push(face.points), false); return out; };
interface Sector { entries: { building: PlacedBuilding }[]; cached?: unknown }
interface Internals { sectors: Sector[]; prepare(sector: Sector, overview: boolean): void; release(sector: Sector): void }
function mockGl() {
  const uploaded: number[][] = [];
  const methods = new Map<PropertyKey, unknown>();
  const gl = new Proxy({}, { get(_target, name) {
    if (!methods.has(name)) methods.set(name,
      name === 'getShaderParameter' || name === 'getProgramParameter' ? vi.fn(() => true)
        : String(name).startsWith('create') ? vi.fn(() => ({}))
          : name === 'bufferData' ? vi.fn((_target, values: Float32Array) => uploaded.push([...values])) : vi.fn());
    return methods.get(name);
  } }) as WebGL2RenderingContext;
  return { gl, uploaded };
}

it('installs real native exterior triangles and restores compact geometry, invalidating only touched sectors', () => {
  const sources = [plan('first', 1000), plan('same-sector', 1012), plan('untouched', 2000)];
  const compact = sources.map(compactBuilding), scene = batch([...compact]);
  const { gl, uploaded } = mockGl(), pass = new UrbanBuildingPass(gl), state = pass as unknown as Internals;
  pass.setScene(scene, { style: 'cartographic', diagnostic: 'none' });
  expect(state.sectors).toHaveLength(2);
  for (const sector of state.sectors) state.prepare(sector, false);
  const touched = state.sectors.find(s => s.entries.some(e => e.building.id === sources[0].id))!;
  const untouched = state.sectors.find(s => s !== touched)!;
  const untouchedCache = untouched.cached;
  const release = vi.spyOn(state, 'release');
  const details = sources.slice(0, 2).map(exterior);
  for (let i = 0; i < details.length; i++) {
    // Real producer compatibility in both directions, not fabricated clones.
    expect(details[i].footprint).toBe(compact[i].footprint);
    expect(details[i].roof_footprint).toBe(compact[i].roof_footprint);
    expect(details[i].resolved).toBe(compact[i].resolved);
    expect(details[i].volumes[0].foundation).toBe(compact[i].volumes[0].foundation);
    expect(triangles(details[i])).not.toEqual(triangles(compact[i]));
    scene.buildings[i] = details[i]; // city3d updates its display before publishing.
  }
  // This is the causal no-op that made the first caller-only fix insufficient.
  pass.setScene(scene, { style: 'cartographic', diagnostic: 'none' });
  expect(touched.entries[0].building).toBe(compact[0]);
  expect(pass.replaceBuildings(details)).toEqual([]);
  expect(release).toHaveBeenCalledTimes(1);
  expect(release).toHaveBeenCalledWith(touched);
  expect(touched.cached).toBeUndefined(); expect(untouched.cached).toBe(untouchedCache);
  expect(touched.entries[0].building).toBe(details[0]);
  expect(triangles(touched.entries[0].building)).toEqual(triangles(details[0]));
  const firstNativeUpload = uploaded.length; state.prepare(touched, false);
  const nativeUploads = uploaded.slice(firstNativeUpload);
  expect(nativeUploads.length).toBeGreaterThan(0);

  const restored = compactBuilding(sources[0]); scene.buildings[0] = restored;
  release.mockClear(); expect(pass.replaceBuildings([restored])).toEqual([]);
  expect(release).toHaveBeenCalledTimes(1); expect(untouched.cached).toBe(untouchedCache);
  expect(touched.entries[0].building).toBe(restored);
  expect(triangles(touched.entries[0].building)).toEqual(triangles(compact[0]));
  const firstRestoredUpload = uploaded.length; state.prepare(touched, false);
  expect(uploaded.slice(firstRestoredUpload)).not.toEqual(nativeUploads);
  pass.dispose();
});

it('discards an in-flight exterior after a same-ID same-pose source replacement', async () => {
  const old = plan('edited', 1000), edited = plan('edited', 1000);
  // Deliberately change retained geometry while leaving recipe/variant/pose.
  edited.footprint = edited.footprint.map(p => ({ ...p, outer: p.outer.map((v, i) => i ? v : { ...v, x: v.x + .25 }) }));
  const before = batch([old]), after = batch([edited]);
  const renderer = new UrbanBuildingLodRenderer(before, { raster: false });
  const jobs: { source: PlacedBuilding; resolve(value: HouseBatch): void; reject(error: Error): void }[] = [];
  const controller = new UrbanBuildingDetailController({ scene: before, renderer, maxConcurrency: 1,
    realize: source => new Promise((resolve, reject) => jobs.push({ source, resolve, reject })) });
  const flush = () => new Promise<void>(done => setImmediate(done));
  const view = { viewport: { minX: 990, minY: 990, maxX: 1040, maxY: 1040 }, metresPerPixel: 10, selectedId: old.id };
  try {
    controller.update(view); await flush(); expect(jobs).toHaveLength(1);
    renderer.replaceScene(after); controller.replaceScene(after); controller.update(view); await flush();
    expect(jobs).toHaveLength(1); // The physical call still occupies its slot.
    jobs[0].resolve({ ...native, units: [{ ...unit, transform: old.transform }] }); await flush();
    expect(controller.getDetail(old.id)).toBeUndefined();
    expect(controller.stats.responsesDiscarded).toBe(1);
    expect(jobs).toHaveLength(2); expect(jobs[1].source).toBe(edited);
    expect(renderer.getBuilding(old.id)).toBe(edited);
    jobs[1].reject(new Error('No second native realization needed for stale-response proof.')); await flush();
    expect(controller.stats.globalInFlight).toBe(0);
  } finally { controller.dispose(); }
});

it('renders and picks the cold projection, swaps a real native exterior, then restores the exact projection', () => {
  const source=plan('cold-3d',1000), projected=projectNativeBuildingRecords([source]);
  const display=city3dProjectionScene(projected), dto=projected.buildings[0];
  const {gl,uploaded}=mockGl(), pass=new UrbanBuildingPass(gl), state=pass as unknown as Internals;
  pass.setScene(display,{style:'cartographic',diagnostic:'none'});
  const sector=state.sectors[0];state.prepare(sector,false);
  const proxyUploads=uploaded.slice();expect(proxyUploads.length).toBeGreaterThan(0);
  // The draw and pick paths enumerate the same proxy triangles at the same Z.
  const proxyFaces: Parameters<Parameters<typeof eachBuildingTriangle>[1]>[0][]=[];
  eachBuildingTriangle(dto,t=>proxyFaces.push(t));
  const roof=proxyFaces.find(t=>t.surface==='roof')!, x=roof.points.reduce((n,p)=>n+p[0],0)/3, y=roof.points.reduce((n,p)=>n+p[1],0)/3;
  Object.assign(sector,{shown:true,overview:false});
  expect(pass.pick([x,y,source.ground_z_m+50],[0,0,-1]).id).toBe(source.id);
  const detail=exterior(source);
  // Actual producer output rebinds contours only after controller validation.
  const bound={...detail,footprint:dto.footprint,roof_footprint:dto.roof_footprint};
  expect(pass.replaceBuildings([bound])).toEqual([]);state.prepare(sector,false);
  expect(uploaded.slice(proxyUploads.length)).not.toEqual(proxyUploads);
  expect(pass.replaceBuildings([dto])).toEqual([]);state.prepare(sector,false);
  expect('resolved' in dto).toBe(false);expect('volumes' in dto).toBe(false);
  expect(pass.replaceBuildings([{...bound,id:'missing'}])).toEqual(['missing']);
  pass.dispose();
});
