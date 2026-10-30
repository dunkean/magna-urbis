import { describe, expect, it, vi } from 'vitest';
import type { ArchitectureVolume, PlacementBatch, PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import type { Shape } from '../../rust/bridge/urban';
import { defaultLayoutConfig, defaultParcelConfig } from '../../rust/bridge/urbanConfig';
import type { WorkshopState } from '../src/ui/testbenchUrban';
import type { Decor } from '../src/ui/decor';
import { encodeDecor, decodeDecor, encodeDecorAsync, decodeDecorAsync } from '../src/ui/decor';
import { cropCityDecor, terrainFromDecor } from '../src/ui/benchTerrainTransfer';
import { applyWorkshopPopulation, appliedWorkshopSnapshot, buildingSettings, cityWorkshopState, mergeCityWorkshop, mergeWorkshopCities, translateWorkshopState, workshopSettings } from '../src/ui/urbanSnapshot';
import { portableRecipe } from '../src/ui/recipeSharing';
import { captureDecor, captureDecorData } from '../src/ui/decorCapture';
import type { TerrainSettings } from '../../rust/bridge/terrain';
import { urbanOptionSync } from '../src/ui/urbanOptionSync';

const box = (x: number, y: number, width = 20): Shape => ({ outer: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + width }, { x, y: y + width }], holes: [] });
function building(id: string, x: number): PlacedBuilding {
  const footprint = [box(x, 600)], roof = { domain: footprint, arms: [{ origin: { x, y: 600 }, axis: [1, 0], domain: footprint }], support_z_m: 32 };
  return { id: `${id}/building`, parcel_id: id, function: 'domestic', culture: { culture: 'european-organic', pack: 'EUR-MED', mode: 'historical_inspired', borrowing: null },
    recipe_id: 'EUR-MED-B01', variant_id: 'default', transform: { origin: { x, y: 600 }, orientation_deg: 15 }, ground_z_m: 30,
    footprint, roof_footprint: [box(x - 1, 599, 22)], courtyards: [box(x + 5, 605, 4)], circulation: [box(x + 1, 601, 2)], entrance: { x, y: 610 }, access_id: 'street',
    volumes: [{ id: 'body', footprint, levels: [{ index: 0, footprint, z_m: 30, height_m: 3 }], z_m: 30, wall_height_m: 3, roof_height_m: 2,
      roof_system: 'RF-GABLE', roof_pitch_deg: 35, overhang_m: 0.25, roof_spec: {} as ArchitectureVolume['roof_spec'],
      materials: { frame: 'stone', infill: 'stone', coating: 'lime', cladding: '', base: 'stone', roof_frame: 'timber' }, role: 'dwelling', envelope: 'walled',
      foundation: { footprint, z_min_m: 29.5, z_max_m: 30 },
      roof_mesh: { groups: [{ id: 'roof', rf: 'RF-GABLE', body_id: 'body', feature_id: null, room_id: null, level: 0, domain: footprint }], vertices: [{ x, y: 600, z: 33 }, { x: x + 10, y: 610, z: 35 }], faces: [{ vertices: [0, 1], normal: [0, 1, 0] } as ArchitectureVolume['roof_mesh']['faces'][number]] } }],
    structural_foundations: [{ footprint, z_min_m: 29, z_max_m: 30 }],
    structural_features: [{ id: 'gallery', kind: 'gallery', surface: footprint, z_m: 32, height_m: 1, material: 'timber', vertices3d: [{ x, y: 600, z: 33 }], roof: roof as PlacedBuilding['structural_features'][number]['roof'] }],
    useful_area_m2: 280, domestic_units: 1, simplification: 'recipe_volumes', diagnostics: [],
    resolved: { localPlan: { origin: { x: 1, y: 2 }, axis: { x: 1, y: 0 }, points: [{ x: 5, y: 7 }] }, seed: 'native-plan' } };
}
function state(): WorkshopState {
  const scene: PlacementBatch = { schema_version: '1', generator_version: 'fixture', buildings: [building('city/a', 500), building('other/b', 1600)],
    refusals: [{ id: 'refusal', parcel_id: 'city/refused', code: 'example', message: 'diagnostic', attempts: 1 }], open_spaces: [{ id: 'common', parcel_id: 'city/common', surface: [box(550, 650, 10)] }] };
  return { layoutConfig: defaultLayoutConfig(), parcelConfig: defaultParcelConfig(), quarterSeed: 'quarters', parcelSeed: 'parcels',
    layouts: ['city', 'other'].map((key, i) => ({ key, culture: 'european-organic', center: { x: 500 + i * 1100, y: 600 }, quarters: [{ shape: box(500 + i * 1100, 600, 80), phase: 0 }],
      streets: [], blocks: [{ shape: box(500 + i * 1100, 600, 80), quarter: 0, kind: 'block', axis: { x: 1, y: 0 } }], warnings: [] })),
    partitions: ['city', 'other'].map((key, i) => ({ key, warnings: [], parcels: [
      { id: key === 'city' ? 'city/a' : 'other/b', shape: box(500 + i * 1100, 600), block: 0, use: 'plot' as const, front: null, axis: { x: 1, y: 0 }, rank: 1 },
      ...(key === 'city' ? ['common', 'refused'].map((id, index) => ({ id: `city/${id}`, shape: box(550, 620 + index * 30, 10), block: 0, use: 'plot' as const, front: null, axis: { x: 1, y: 0 }, rank: 1 })) : []),
    ] })),
    buildingState: { seed: 'buildings', visible: true, appearance: { style: 'cartographic', diagnostic: 'none' }, projection: true, settings: { floors: 2, typology: 'row' },
      camera: { x: 550, y: 650, distance: 200, yaw: 0.3, pitch: 0.8, exaggeration: 1 }, scene } };
}
function decor(): Decor {
  const urban = state(), n = 32, width = 3200, height = new Float32Array(n * n).fill(30);
  return { raster: { width, n, height, water: new Uint8Array(n * n), waterLevel: height.slice(), riverWidth: new Float32Array(n * n), riverIds: new Int32Array(n * n).fill(-1) },
    meta: { format: 'magna-decor', version: 1, id: 'applied-city', label: 'fixture', tags: {}, seed: 'terrain', width, query: 'seed=terrain', created: '',
      settlements: [{ key: 'city', name: 'City', center: { x: 540, y: 640 }, radius: 100, population: 300, culture: 'european-organic' }] as Decor['meta']['settlements'],
      roads: null, roadConfig: null, waterSvg: '', stats: { land: 1, minHeight: 30, maxHeight: 30, riverKm: 0, roadKm: 0 }, pipeline: { stage: 'settlements', urban } } };
}

describe('applied urban scene transfers', () => {
  it('keeps cold data in applied snapshots, omits local references from links and composes city translations', () => {
    const input = state(); input.layouts = input.layouts!.filter(l => l.key === 'city'); input.partitions = input.partitions!.filter(p => p.key === 'city');
    input.buildingState = { ...input.buildingState!, scene: undefined, cold: {
      store: { format: 'urban-building-chunks-1', sceneId: 'cold-city', fingerprint: 'a'.repeat(64), sourceFingerprint: 'b'.repeat(64) },
      counts: { schema_version: '1', generator_version: 'architectural-plans-2', buildings: 6, refusals: 3, open_spaces: 0 }, cityKey: 'city', offset: { x: 10, y: 20 },
    } };
    expect(buildingSettings(input.buildingState)).not.toHaveProperty('cold');
    expect(buildingSettings(input.buildingState)!.generated).toBe(true);
    expect(appliedWorkshopSnapshot(input).buildingState!.cold).toBe(input.buildingState.cold);
    const moved = translateWorkshopState(input, -30, 45);
    expect(moved.buildingState!.cold!.offset).toEqual({ x: -20, y: 65 });
    expect(moved.buildingState!.cold!.store).toBe(input.buildingState.cold!.store);
    expect(input.buildingState.cold!.offset).toEqual({ x: 10, y: 20 });
    const merged = mergeCityWorkshop(input, { ...input, buildingState: undefined }, 'city', 0, 0);
    expect(merged.buildingState!.cold).toBeUndefined(); expect(merged.buildingState!.scene).toBeUndefined();
  });
  it('rejects mixed scene versions without changing retained plans, and permits a complete replacement', () => {
    const original = state(), scene = original.buildingState!.scene!;
    scene.generator_version = 'architectural-plans-1';
    const first = `plan-archive-${'d'.repeat(64)}`, second = `plan-archive-${'e'.repeat(64)}`, fresh = `plan-archive-${'f'.repeat(64)}`;
    scene.plan_archives = { [first]: 'old city bytes', [second]: 'old other bytes' };
    scene.buildings.forEach((b, index) => { b.resolved = { format: 'compact-plan-archive-1', archive_id: index ? second : first, index: 0 }; });
    const before = structuredClone(original), incoming = cityWorkshopState(structuredClone(original), 'city'), next = incoming.buildingState!.scene!;
    next.generator_version = 'architectural-plans-2';
    next.plan_archives = { [fresh]: 'new city bytes' };
    next.buildings[0].resolved = { format: 'compact-plan-archive-1', archive_id: fresh, index: 0 };
    expect(() => mergeCityWorkshop(original, incoming, 'city', 0, 0)).toThrow(/versions incompatibles/);
    expect(original).toEqual(before);
    next.generator_version = scene.generator_version;
    // Simulate an incompatible persisted payload outside the current TS schema.
    next.schema_version = '2' as PlacementBatch['schema_version'];
    expect(() => mergeCityWorkshop(original, incoming, 'city', 0, 0)).toThrow(/versions incompatibles/);
    next.generator_version = 'architectural-plans-2'; next.schema_version = '1';
    const replaced = mergeCityWorkshop(cityWorkshopState(original, 'city'), incoming, 'city', 0, 0).buildingState!.scene!;
    expect(replaced.generator_version).toBe('architectural-plans-2');
    expect(replaced.plan_archives).toEqual({ [fresh]: 'new city bytes' });
    expect(replaced.buildings[0]).toBe(next.buildings[0]);
    expect(replaced.buildings[0].resolved).toBe(next.buildings[0].resolved);
    // A whole multi-city reply must not fail at an intermediate one-city merge.
    const all = structuredClone(original);
    all.buildingState!.scene = { ...next, buildings: [next.buildings[0], { ...building('other/b', 1600), resolved: { format: 'compact-plan-archive-1', archive_id: fresh, index: 1 } }] };
    const combined = mergeWorkshopCities(original, all).buildingState!.scene!;
    expect(combined.generator_version).toBe('architectural-plans-2');
    expect(combined.buildings.map(b => b.parcel_id)).toEqual(['city/a', 'other/b']);
    expect(combined.plan_archives).toEqual({ [fresh]: 'new city bytes' });
    expect(original).toEqual(before);
  });
  it('keeps the version of nonempty retained results when a newer empty city removes its old results', () => {
    const original = state(), scene = original.buildingState!.scene!, incoming = cityWorkshopState(original, 'city');
    scene.generator_version = 'architectural-plans-1';
    const archive = `plan-archive-${'a'.repeat(64)}`;
    scene.buildings[1].resolved = { format: 'compact-plan-archive-1', archive_id: archive, index: 0 };
    scene.plan_archives = { [archive]: 'unchanged old bytes' };
    incoming.buildingState!.scene = { schema_version: '1', generator_version: 'architectural-plans-2', buildings: [], refusals: [], open_spaces: [], plan_archives: {} };
    const merged = mergeCityWorkshop(original, incoming, 'city', 0, 0).buildingState!.scene!;
    expect(merged.generator_version).toBe('architectural-plans-1');
    expect(merged.buildings).toEqual([scene.buildings[1]]);
    expect(merged.buildings[0]).toBe(scene.buildings[1]);
    expect(merged.plan_archives).toEqual(scene.plan_archives);
    // Refusals and declared open spaces are results too, not empty metadata.
    for (const kind of ['refusals', 'open_spaces'] as const) {
      const remaining = state(), old = remaining.buildingState!.scene!;
      old.generator_version = 'architectural-plans-1'; old.buildings = [];
      old.refusals = kind === 'refusals' ? [{ id: 'old', parcel_id: 'other/b', code: 'plan_refused', message: 'old result', attempts: 1 }] : [];
      old.open_spaces = kind === 'open_spaces' ? [{ id: 'old', parcel_id: 'other/b', surface: [box(1600, 600)] }] : [];
      const next = cityWorkshopState(state(), 'city'); next.buildingState!.scene!.generator_version = 'architectural-plans-2';
      expect(() => mergeCityWorkshop(remaining, next, 'city', 0, 0)).toThrow(/versions incompatibles/);
    }
  });
  it('keeps only referenced compact archives when splitting/merging cities and moves cartographic ridges', () => {
    const original = state(), scene = original.buildingState!.scene!;
    const first = `plan-archive-${'a'.repeat(64)}`, second = `plan-archive-${'b'.repeat(64)}`, stale = `plan-archive-${'c'.repeat(64)}`;
    scene.plan_archives = { [first]: 'first', [second]: 'second', [stale]: 'unused' };
    scene.buildings.forEach((b, index) => { b.resolved = { format: 'compact-plan-archive-1', archive_id: index ? second : first, index: 0 }; });
    scene.buildings[0].cartographic = { height_m: 5, validation: 'plan_only', ridges: [[{x: 500,y: 600},{x: 510,y: 600}]] };
    const city = cityWorkshopState(original, 'city');
    expect(city.buildingState!.scene!.plan_archives).toEqual({ [first]: 'first' });
    const moved = translateWorkshopState(city, 100, 200);
    expect(moved.buildingState!.scene!.buildings[0].cartographic!.ridges).toEqual([[{x: 600,y: 800},{x: 610,y: 800}]]);
    const merged = mergeCityWorkshop(original, moved, 'city', -100, -200).buildingState!.scene!;
    expect(merged.plan_archives).toEqual({ [first]: 'first', [second]: 'second' });
    expect(merged.buildings.find(b => b.parcel_id === 'city/a')!.cartographic).toEqual(scene.buildings[0].cartographic);
    expect(scene.plan_archives[stale]).toBe('unused');
  });
  it('edits only the applied target population in city metadata and retains all other cities', () => {
    const sites = [{ key: 'city', population: 300 }, { key: 'other', population: 600 }];
    const applied = { ...state(), population: 300_000, siteKey: 'city' };
    expect(applyWorkshopPopulation(sites, applied)).toEqual([{ key: 'city', population: 300_000 }, sites[1]]);
    expect(sites[0].population).toBe(300);
    expect(applyWorkshopPopulation(sites, { ...applied, siteKey: undefined })).toBe(sites);
    expect(applyWorkshopPopulation(sites, { ...applied, population: undefined })).toBe(sites);
    expect(workshopSettings(applied)).toMatchObject({ population: 300_000, siteKey: 'city' });
    expect(cityWorkshopState(applied, 'other').population).toBeUndefined();
    expect(cityWorkshopState(applied, 'city').population).toBe(300_000);
  });
  it('translates every physical surface and mesh while keeping native local plans, vectors and heights exact', () => {
    const original = state(), moved = translateWorkshopState(original, 100, 200), b = moved.buildingState!.scene!.buildings[0];
    expect(b.transform.origin).toEqual({ x: 600, y: 800 });
    expect(b.roof_footprint[0].outer[0]).toEqual({ x: 599, y: 799 });
    expect(b.volumes[0].roof_mesh.vertices[0]).toEqual({ x: 600, y: 800, z: 33 });
    expect(b.volumes[0].foundation.footprint[0].outer[0]).toEqual({ x: 600, y: 800 });
    expect(b.structural_features[0].roof!.arms[0].origin).toEqual({ x: 600, y: 800 });
    expect(b.structural_features[0].roof!.arms[0].axis).toEqual([1, 0]);
    expect(b.resolved).toBe(original.buildingState!.scene!.buildings[0].resolved);
    expect(b.structural_foundations![0].footprint[0].outer[0]).toEqual({ x: 600, y: 800 });
    expect(b.volumes[0].roof_mesh.groups![0].domain[0].outer[0]).toEqual({ x: 600, y: 800 });
    expect(b.ground_z_m).toBe(30); expect(b.volumes[0].roof_mesh.faces[0].normal).toEqual([0, 1, 0]);
    expect(moved.layouts![0].blocks[0].axis).toEqual({ x: 1, y: 0 });
    expect(translateWorkshopState(moved, -100, -200)).toEqual(original);
  });
  it('crops a city with its exact scene and merges it back without changing the other city', () => {
    const source = decor(), cropped = cropCityDecor(source, 'city'), crop = cropped.meta.pipeline!.crop!, local = cropped.meta.pipeline!.urban!;
    expect(local.buildingState!.scene!.buildings.map(b => b.parcel_id)).toEqual(['city/a']);
    expect(cropped.raster.n).toBeGreaterThanOrEqual(16);
    expect(local.buildingState!.scene!.buildings[0].entrance).toEqual({ x: 500 - crop.x, y: 610 - crop.y });
    const merged = mergeCityWorkshop(source.meta.pipeline!.urban, local, 'city', crop.x, crop.y);
    expect(merged.buildingState!.scene!.buildings.find(b => b.parcel_id === 'city/a')).toEqual(source.meta.pipeline!.urban!.buildingState!.scene!.buildings[0]);
    expect(merged.buildingState!.scene!.buildings.find(b => b.parcel_id === 'other/b')).toEqual(source.meta.pipeline!.urban!.buildingState!.scene!.buildings[1]);
    expect(decodeDecor(encodeDecor(cropped)).meta.pipeline!.urban).toEqual(local);
  });
  it('removes an invalidated city scene but preserves unrelated buildings and keeps URLs as settings only', () => {
    const original = state(), selected = cityWorkshopState(original, 'city'); selected.buildingState!.scene = undefined;
    const merged = mergeCityWorkshop(original, selected, 'city', 0, 0);
    expect(merged.buildingState!.scene!.buildings.map(b => b.parcel_id)).toEqual(['other/b']);
    const settings = workshopSettings(original), serialized = JSON.stringify(settings);
    expect(settings.buildingState).toMatchObject({ seed: 'buildings', generated: true, projection: true, settings: { floors: 2, typology: 'row' } });
    expect(serialized).not.toMatch(/resolved|volumes|parcel_id|"scene"/);
    expect(buildingSettings(original.buildingState)!.camera).toEqual(original.buildingState!.camera);
  });
  it('retains other city parcels and buildings when the returned city contains quarters only', () => {
    const original = state(), incoming = cityWorkshopState(original, 'city');
    incoming.partitions = undefined; incoming.buildingState = undefined;
    const merged = mergeCityWorkshop(original, incoming, 'city', 0, 0);
    expect(merged.partitions).toEqual(original.partitions!.filter(p => p.key === 'other'));
    expect(merged.buildingState!.scene!.buildings.map(b => b.parcel_id)).toEqual(['other/b']);
    expect(merged.layouts!.map(l => l.key).sort()).toEqual(['city', 'other']);
  });
  it('keeps unrelated city settings and object identities during a targeted local replacement', () => {
    const original = state();
    original.citySettings = Object.fromEntries(['city', 'other'].map((key, index) => [key, { layoutConfig: { ...defaultLayoutConfig(), density: 1 + index }, parcelConfig: defaultParcelConfig(), quarterSeed: key, parcelSeed: key, building: { seed: key, settings: { floors: index + 1 }, generated: true } }]));
    const selected = cityWorkshopState(original, 'other');
    expect(selected.layoutConfig.density).toBe(2); expect(selected.buildingState!.settings!.floors).toBe(2);
    const incoming = cityWorkshopState(original, 'city'); incoming.partitions = undefined; incoming.buildingState = undefined;
    const merged = mergeCityWorkshop(original, incoming, 'city', 0, 0);
    expect(merged.layouts!.find(layout => layout.key === 'other')).toBe(original.layouts![1]);
    expect(merged.partitions![0]).toBe(original.partitions![1]);
    expect(merged.buildingState!.scene!.buildings[0]).toBe(original.buildingState!.scene!.buildings[1]);
    expect(merged.citySettings!.other).toBe(original.citySettings.other);
  });
  it('splits a multi-city reply without duplicating identities and retains it when a third city changes', () => {
    const original = state(), updated = structuredClone(original);
    updated.buildingState!.scene!.buildings.forEach(b => { b.variant_id = 'updated'; });
    const merged = mergeWorkshopCities(original, updated);
    expect(merged.buildingState!.scene!.buildings.map(b => b.id).sort()).toEqual(['city/a/building', 'other/b/building']);
    expect(merged.buildingState!.scene!.refusals).toHaveLength(1);
    expect(merged.buildingState!.scene!.open_spaces).toHaveLength(1);
    const third = cityWorkshopState(state(), 'other');
    third.layouts = [{ ...third.layouts![0], key: 'third' }];
    third.partitions = [{ ...third.partitions![0], key: 'third', parcels: [{ ...third.partitions![0].parcels[0], id: 'third/c' }] }];
    third.buildingState!.scene = { ...third.buildingState!.scene!, buildings: [building('third/c', 2400)], refusals: [], open_spaces: [] };
    const final = mergeWorkshopCities(merged, third);
    expect(final.buildingState!.scene!.buildings.map(b => b.id).sort()).toEqual(['city/a/building', 'other/b/building', 'third/c/building']);
    expect(final.buildingState!.scene!.buildings.filter(b => b.variant_id === 'updated')).toHaveLength(2);
    expect(final.layouts!.map(l => l.key).sort()).toEqual(['city', 'other', 'third']);
  });
  it('detaches shared settings without traversing any detailed scene data', () => {
    const original = state();
    Object.defineProperty(original.buildingState!.scene!.buildings[0], 'resolved', { enumerable: true, get: () => { throw new Error('Detailed scene must not be cloned for option publication'); } });
    const settings = structuredClone(workshopSettings(original));
    expect(settings.buildingState!.settings).toEqual({ floors: 2, typology: 'row' });
    expect(settings.buildingState).not.toHaveProperty('scene');
  });
  it('captures immutable geometry by reference and detaches all editable settings before export', () => {
    const original = state(); original.citySettings = { city: { layoutConfig: original.layoutConfig, parcelConfig: original.parcelConfig, quarterSeed: 'q', parcelSeed: 'p', building: { seed: 'b', settings: { floors: 2 } } } };
    Object.defineProperty(original.buildingState!.scene!.buildings[0], 'resolved', { enumerable: true, get: () => { throw new Error('A safe snapshot must not copy native plans'); } });
    const snapshot = appliedWorkshopSnapshot(original);
    expect(snapshot.layouts![0]).toBe(original.layouts![0]); expect(snapshot.partitions![0]).toBe(original.partitions![0]);
    expect(snapshot.buildingState!.scene).toBe(original.buildingState!.scene);
    snapshot.layoutConfig.programme.intent = 'isolated-mill'; snapshot.buildingState!.settings!.floors = 4;
    snapshot.citySettings!.city.building!.settings!.floors = 3;
    snapshot.layouts!.pop(); snapshot.partitions!.pop();
    expect(original.layouts).toHaveLength(2); expect(original.partitions).toHaveLength(2);
    expect(original.layoutConfig.programme.intent).toBe('settlement'); expect(original.buildingState!.settings!.floors).toBe(2);
    expect(original.citySettings.city.building!.settings!.floors).toBe(2);
  });
  it('keeps isolated fixtures from replacing a different applied city', () => {
    const original = state(), isolated = cityWorkshopState(original, 'city');
    isolated.layouts![0] = { ...isolated.layouts![0], key: 'isolated-fixture' };
    expect(() => mergeCityWorkshop(original, isolated, 'city', 0, 0)).toThrow(/ville sélectionnée/);
  });
  it('retains applied urban output in a fresh terrain capture as well as retained decor files', () => {
    const source = decor(), terrain = terrainFromDecor(source);
    const captured = captureDecor(terrain, { seed: 'terrain', width: terrain.width, relief: 'flat' } as TerrainSettings,
      { settlements: source.meta.settlements, warnings: [], requested: 1, usableKm2: 1, ms: 0 }, undefined, null,
      { query: 'seed=terrain', pipeline: source.meta.pipeline });
    expect(decodeDecor(captured.bytes).meta.pipeline!.urban).toEqual(source.meta.pipeline!.urban);
  });
  it('keeps the portable bytes identical with worker compression and preserves retained rasters', async () => {
    const source = decor(), height = source.raster.height.slice(), settings = { seed: 'terrain', width: source.raster.width, relief: 'flat' } as TerrainSettings;
    const retained = captureDecorData(terrainFromDecor(source), settings,
      { settlements: source.meta.settlements, warnings: [], requested: 1, usableKm2: 1, ms: 0 }, undefined, null,
      { query: 'seed=terrain', pipeline: source.meta.pipeline });
    const sync = encodeDecor(retained), asynchronous = await encodeDecorAsync(retained);
    expect(asynchronous).toEqual(sync);
    expect(await decodeDecorAsync(asynchronous)).toEqual(decodeDecor(sync));
    expect(retained.meta.pipeline!.urban).toEqual(source.meta.pipeline!.urban);
    expect(source.raster.height).toEqual(height);
    expect(retained.raster.height.byteLength).toBeGreaterThan(0);
  });
  it('synchronizes building settings without broadcasting the scene or crop-local camera', () => {
    const output: string[] = [], received: WorkshopState[] = [];
    let listener: (event: { key: string; newValue: string }) => void = () => {};
    vi.stubGlobal('window', { addEventListener: (_: string, callback: typeof listener) => { listener = callback; } });
    vi.stubGlobal('localStorage', { setItem: (_: string, value: string) => output.push(value) });
    try {
      const publish = urbanOptionSync(() => 'same-city', settings => received.push(settings));
      publish(state());
      const message = JSON.parse(output[0]);
      expect(message.state.buildingState.settings).toEqual({ floors: 2, typology: 'row' });
      expect(message.state.buildingState).not.toHaveProperty('scene');
      expect(message.state.buildingState).not.toHaveProperty('camera');
      const incoming = state(); incoming.buildingState!.seed = 'new-seed';
      listener({ key: 'magna-urban-options', newValue: JSON.stringify({ identity: 'same-city', state: incoming }) });
      expect(received[0].buildingState).toMatchObject({ seed: 'new-seed', settings: { floors: 2 } });
      expect(received[0].buildingState).not.toHaveProperty('scene');
    } finally { vi.unstubAllGlobals(); }
  });
  it('portable Urban recipes preserve the applied scene instead of losing the workshop input', async () => {
    const input = decor(), recipe = await portableRecipe('urban', 'artifact=applied-city&workshop=procedural-case', input);
    expect(decodeDecor(recipe.decor!).meta.pipeline!.urban).toEqual(input.meta.pipeline!.urban);
    expect(new URLSearchParams(recipe.query).has('workshop')).toBe(false);
    const procedural = await portableRecipe('urban', 'workshop=procedural-case');
    expect(new URLSearchParams(procedural.query).get('workshop')).toBe('procedural-case');
    const regional = await portableRecipe('settlements', 'artifact=applied-city', input);
    const retained = decodeDecor(regional.decor!);
    expect(retained.meta.pipeline!.urban).toEqual(input.meta.pipeline!.urban);
    expect(retained.meta.settlements).toEqual(input.meta.settlements);
    expect(retained.meta.roads).toEqual(input.meta.roads);
  });
  it('embeds an applied city even on regenerable terrain, while plain settlements keep procedural replay', async () => {
    const input = decor();
    input.meta.regeneration = { query: 'seed=terrain&width=3200', crops: [] };
    const applied = await portableRecipe('settlements', 'artifact=applied-city', input);
    expect(applied.terrain).toBeUndefined();
    expect(decodeDecor(applied.decor!).meta.pipeline!.urban).toEqual(input.meta.pipeline!.urban);
    const plain = { ...input, meta: { ...input.meta, pipeline: undefined } };
    const procedural = await portableRecipe('settlements', 'artifact=applied-city', plain);
    expect(procedural.decor).toBeUndefined();
    expect(procedural.terrain).toBeDefined();
    expect(procedural.terrain!.meta.settlements).toEqual([]);
  });
});
