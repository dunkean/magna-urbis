import { CITY_3D_MATERIAL_GROUNDS } from '../../src/ui/city3d';
import { cityGroundSettings, cityForestInput, cityOverlayLandKinds, cityOverlayLandKey, cityWaterCutsLand, cityCountrysideCanvasOptions, cityCountrysideTextureVisible } from '../../src/render/cityEnvironment';
import { cityNamedSite } from '../../src/render/cityGeneration';
import { cityGlOverlayLayers } from '../../src/render/cityGl';
import { setCityCanopy } from '../../src/render/cityCanopy';
import { FramePreparation, PREPARATION_BUDGET_MS } from '../../src/ui/framePreparation';
import { buildNearTrees, buildNearTreesSteps, type TreeInputs } from '../../src/ui/terrain3dTrees';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolveRustUrbanControls, townRoadStreets, townSiteArchetypes } from '../../src/v2/rustUrban';
import { regionalStreets } from '../../../rust/bridge/urban';
import type { RoadOutput } from '../../../rust/bridge/settlements';
import type { World } from '../../src/gen/types';
import { citySiteArchetypes, cityTownRoads } from '../../src/render/cityGeneration';
import { urbanSeed } from '../../src/v2/urbanSeeds';
import { defaultLayoutConfig, defaultParcelConfig, normalizeLayoutConfig, normalizeParcelConfig } from '../../../rust/bridge/urbanConfig';
import { siteVisualScene, silhouetteScene, type CityPlacementRequest } from '../../src/ui/urbanSilhouettes';
import { projectUrbanSite } from '../../src/ui/urbanSiteStore';
import { applySettlementStyle } from '../../src/ui/urbanSettlementStyles';
import { CITY_DISPLAY_DEFAULTS, DEFAULT_CITY_ARCHITECTURE, cityRegionalStreets } from '../../src/render/cityContract';
import { CITY_DEFAULT_PARCEL_FIT, CITY_RASTER_RESOLUTION, cityRasterSide, parcelFitOf, defaultCityLayoutConfig, CITY_LAYOUT_DEFAULTS } from '../../src/render/cityGeneration';
import { cityBuildingAppearance, cityDrawOptions, city3dPlanOptions } from '../../src/render/cityDrawOptions';
import { resolveAppearance, type AppearanceInput } from '../../src/render/appearanceRecipe';
import type { V2Settings } from '../../src/v2/contracts';
import type { Options } from '../../src/gen/types';
import { city3dScene } from '../../src/render/city3dMeshes';
import { buildingRayDistance, eachBuildingTriangle, type BuildingTriangle } from '../../src/render/urbanBuildingGeometry';
import { PRESET_IDS, presetComposition, validateComposition, withCompositionQuality } from '../../src/render/composition';
import { PRESET_OPTIONS, compositionMessages } from '../../src/ui/compositionControls';
import { passKeys } from '../../src/v2/passes/pass';
import { LiveGround } from '../../src/ui/liveGround';
import { terrain3dPixelRatio, TERRAIN_3D_MOVING_PIXELS, TERRAIN_3D_FRAME_PIXELS } from '../../src/ui/terrain3dResolution';
import { DISPLAY_QUALITIES, displayQualityFor, displayQualityUniform, onDisplayQualityChange, setDisplayQualityPreference, setDisplayAppearanceQuality } from '../../src/render/displayQuality';
import { LiveTileFill } from '../../src/render/liveTileFill';
import { drawFantasyRaster, suspendFantasyRaster, KEEP_NONE, type FantasyRaster } from '../../src/ui/fantasyRaster';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const settings = (seed: string): V2Settings => ({ options: { seed }, local: {}, urban: { backend: 'rust' } } as unknown as V2Settings);

describe('shared live tile filling', () => {
  it('bounds slices and discards the density left by navigation', () => {
    const frames = new Map<number, FrameRequestCallback>(); let id = 0, clock = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
    vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
    const fill = new LiveTileFill(() => clock), built: string[] = [], invalidate = vi.fn(), failed = vi.fn();
    const flush = (): void => { const [frame, callback] = frames.entries().next().value!; frames.delete(frame); callback(clock); };
    function* work(level: string): Generator<boolean, void> {
      for (let i = 0; i < 5; i++) { built.push(`${level}:${i}`); clock += 5; yield true; }
    }
    try {
      fill.start('old', () => work('old'), invalidate, failed);
      expect(built).toEqual([]);
      flush(); expect(built).toEqual(['old:0', 'old:1']);
      fill.suspend(); expect(frames.size).toBe(0);
      fill.start('rest', () => work('rest'), invalidate, failed);
      while (frames.size) flush();
      expect(built).toEqual(['old:0', 'old:1', 'rest:0', 'rest:1', 'rest:2', 'rest:3', 'rest:4']);
      expect(failed).not.toHaveBeenCalled();
    } finally { fill.suspend(); vi.unstubAllGlobals(); }
  });
  it('releases a partially painted tile without repainting it', () => {
    let callback: FrameRequestCallback | undefined, clock = 0, released = false;
    vi.stubGlobal('requestAnimationFrame', (next: FrameRequestCallback) => { callback = next; return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => { callback = undefined; });
    const fill = new LiveTileFill(() => clock), invalidate = vi.fn();
    function* work(): Generator<boolean, void> {
      try { clock += 10; yield false; throw new Error('Stale tile resumed'); }
      finally { released = true; }
    }
    try {
      fill.start('partial', work, invalidate, vi.fn());
      callback!(clock); expect(invalidate).not.toHaveBeenCalled();
      fill.suspend(); expect(released).toBe(true); expect(callback).toBeUndefined();
    } finally { fill.suspend(); vi.unstubAllGlobals(); }
  });
  it('draws the Illustrated wash without visiting stamps or planning vegetation', () => {
    const drawImage = vi.fn(), restore = vi.fn();
    const ctx = { save() {}, restore, beginPath() {}, rect() {}, clip() {}, drawImage } as unknown as CanvasRenderingContext2D;
    const raster = { painting: { frame: { x: 0, y: 0, width: 100 }, get stamps() { throw new Error('Wash visited stamps'); } }, wash: {}, fields: [] } as unknown as FantasyRaster;
    drawFantasyRaster(ctx, raster, { minX: 0, minY: 0, maxX: 100, maxY: 100 }, .1, KEEP_NONE);
    expect(drawImage).toHaveBeenCalledOnce(); expect(restore).toHaveBeenCalledOnce();
  });
  it('fills close Illustrated tiles centre first and cancels an unfinished stamp batch', () => {
    const frames = new Map<number, FrameRequestCallback>(); let id = 0, clock = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
    vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const targets: TileCanvas[] = [], transforms: number[][] = [];
    class TileCanvas {
      constructor(public width: number, public height: number) { targets.push(this); }
      getContext() { return { imageSmoothingQuality: '', setTransform: (...args: number[]) => transforms.push(args), beginPath() {}, rect() {}, clip() {}, drawImage() { clock += 10; } }; }
    }
    vi.stubGlobal('OffscreenCanvas', TileCanvas); vi.stubGlobal('HTMLCanvasElement', class {});
    const ctx = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, setTransform() {}, drawImage: vi.fn(), getTransform: () => ({ a: 8, b: 0, c: 0, d: 8, e: 0, f: 0 }) } as unknown as CanvasRenderingContext2D;
    const stamp = { x: 48, y: 48, width: 20, brush: 0, flip: false, opacity: 1 };
    const raster = { painting: { frame: { x: 0, y: 0, width: 1000 }, stamps: [stamp], library: { offsets: [0], variants: 1, frames: [{ family: 'pines', rect: [0, 0, 10, 10] }] } }, images: new Map([['pines', {}]]), heights: new Float32Array([20]), up: 20, down: 1, half: 10, fields: [], tiles: new Map(), onTiles: vi.fn() } as unknown as FantasyRaster;
    try {
      drawFantasyRaster(ctx, raster, { minX: 0, minY: 0, maxX: 96, maxY: 96 }, 8, undefined, false, false, true, true);
      expect(targets).toHaveLength(0); expect(ctx.drawImage).not.toHaveBeenCalled();
      const [frame, callback] = frames.entries().next().value!; frames.delete(frame); callback(clock);
      expect(targets).toHaveLength(1); expect(transforms[0]).toEqual([8, 0, 0, 8, -254, -254]);
      expect(raster.onTiles).not.toHaveBeenCalled();
      suspendFantasyRaster(raster); expect(targets[0].width).toBe(0); expect(frames.size).toBe(0);
    } finally { suspendFantasyRaster(raster); now.mockRestore(); vi.unstubAllGlobals(); }
  });
  it('finishes exact Illustrated captures, including missing fine vegetation, synchronously', () => {
    const fine = vi.fn(() => [{ x: 100, y: 100, width: 4, height: 4, brush: 0, flip: false, opacity: 1 }]);
    const raster = { painting: { stamps: [], fine, treeWidth: 4, library: { offsets: [0], variants: 1, frames: [{ family: 'pines', aspect: 1, rect: [0, 0, 10, 10] }] } }, images: new Map([['pines', {}]]), heights: new Float32Array(), up: 0, down: 0, half: 0, tiles: new Map(), fields: [] } as unknown as FantasyRaster;
    const ctx = { save() {}, restore() {}, drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
    drawFantasyRaster(ctx, raster, { minX: 99, minY: 99, maxX: 101, maxY: 101 }, 1, undefined, false, true, false);
    expect(fine).toHaveBeenCalledOnce(); expect(ctx.drawImage).toHaveBeenCalledOnce(); expect(raster.tiles.size).toBe(1);
  });
});

describe('V2 and City Bench stay in sync', () => {
  it('budgets shared 3D preparation by frame, prioritises near work and cancels stale inputs', async () => {
    const frames = new Map<number, FrameRequestCallback>(); let serial = 0, time = 0;
    vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => { frames.set(++serial, frame); return serial; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    vi.spyOn(performance, 'now').mockImplementation(() => time);
    const queue = new FramePreparation(), order: string[] = [];
    function* work(name: string): Generator<void, number> {
      for (let i = 0; i < 20; i++) { order.push(name); time++; yield; }
      return 20;
    }
    const advance = (): void => {
      const [id, frame] = frames.entries().next().value!; frames.delete(id); frame(time);
    };
    try {
      const far = queue.run(work('far'), () => true, 2), near = queue.run(work('near'), () => true, 1);
      advance();
      // No input yet: the rested (idle) budget applies.
      expect(order.length).toBe(PREPARATION_BUDGET_MS.idle); expect(order.slice(0, 20)).toEqual(Array(20).fill('near'));
      while (frames.size) advance();
      expect(await near).toBe(20); expect(await far).toBe(20);
      const count = order.length;
      const stale = expect(queue.run(work('stale'), () => false)).rejects.toMatchObject({ name: 'AbortError' });
      advance(); await stale; expect(order.length).toBe(count);
      const cancelled = expect(queue.run(work('cancelled'), () => true)).rejects.toMatchObject({ name: 'AbortError' });
      queue.clear(); await cancelled; expect(frames.size).toBe(0);
    } finally { queue.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
  });

  it('keeps the exact near-tree stream when placement is split across frames', () => {
    const rgba = new Uint8Array(8 * 8 * 4);
    for (let i = 0; i < 64; i++) rgba.set([220, 150, 40, 255], i * 4);
    const inputs = { field: { n: 8, rgba, x: 0, y: 0, width: 160, key: 'parity' },
      seed: 7, climate: { temperature: 12, precipitation: 900 }, renderV2: 1, zone: 1, season: .5,
      water: (x: number) => x < 40 ? 1 : 0, height: () => 20 } as TreeInputs;
    const view = { x: 80, y: 80, forwardX: 0, forwardY: 1 }, steps = buildNearTreesSteps(inputs, view);
    let step = steps.next(), yields = 0;
    while (!step.done) { yields++; step = steps.next(); }
    expect(yields).toBeGreaterThan(100);
    expect(step.value.length).toBeGreaterThan(0);
    expect(step.value).toEqual(buildNearTrees(inputs, view));
    for (let i = 0; i < step.value.length; i += 12) expect(step.value[i]).toBeGreaterThanOrEqual(40);
  });

  it('reuses the live ground during a pan, refreshes borders cheaply, and restores exact density at rest', () => {
    const canvas = { style: {} } as HTMLCanvasElement, ground = new LiveGround(), ratios: number[] = [];
    const render = (ratio: number): boolean => { ratios.push(ratio); return true; };
    const view = { cx: 0, cy: 0, scale: 1 };
    ground.present(canvas, view, 1000, 800, 2, false, render);
    for (let x = 1; x <= 60; x++) ground.present(canvas, { ...view, cx: x }, 1000, 800, 2, true, render);
    expect(ratios).toEqual([2]);
    ground.present(canvas, { ...view, cx: 500 }, 1000, 800, 2, true, render);
    expect(ratios).toEqual([2, 1.1]);
    ground.present(canvas, { ...view, cx: 500 }, 1000, 800, 2, false, render);
    expect(ratios).toEqual([2, 1.1, 2]);
    ground.invalidate(canvas); // A capture or a changed terrain/look invalidates the retained frame.
    expect(canvas.style.transform).toBe(''); expect(canvas.style.width).toBe('1000px');
    ground.present(canvas, { ...view, cx: 501 }, 1000, 800, 2, true, render);
    expect(ratios).toEqual([2, 1.1, 2, 1.1]);
  });
  it('shares the 3D motion budget while the normal/capture budget stays full', () => {
    const pixels = (moving: boolean): number => {
      const ratio = terrain3dPixelRatio(1600, 1000, 2, 8192, moving);
      return Math.floor(1600 * ratio) * Math.floor(1000 * ratio);
    };
    expect(pixels(true)).toBeLessThanOrEqual(TERRAIN_3D_MOVING_PIXELS);
    expect(pixels(false)).toBeLessThanOrEqual(TERRAIN_3D_FRAME_PIXELS);
    expect(pixels(false) / pixels(true)).toBeGreaterThan(3);
  });
  it('shares browser display choices while captures always retain full quality', () => {
    expect(DISPLAY_QUALITIES).toEqual(['auto', 'full', 'light']);
    const uniforms: number[][] = [];
    const unlisten = onDisplayQualityChange(() => uniforms.push([displayQualityUniform(true), displayQualityUniform(false)]));
    try {
      setDisplayQualityPreference('light');
      expect([displayQualityFor(true), displayQualityFor(false)]).toEqual(['light', 'full']);
      setDisplayQualityPreference('full');
      expect([displayQualityFor(true), displayQualityFor(false)]).toEqual(['full', 'full']);
      expect(uniforms).toEqual([[1, 0], [0, 0]]);
    } finally { unlisten(); setDisplayQualityPreference('auto'); }
  });
  it('lists light presets beside their full versions and changes only their quality', () => {
    expect(PRESET_OPTIONS.map(o => o.value)).toEqual([...PRESET_IDS, 'custom']);
    for (const base of ['satellite', 'parchment'] as const) {
      const full = presetComposition(base), light = presetComposition(`${base}-light`);
      expect(() => validateComposition(light)).not.toThrow();
      expect(light).toEqual({ ...full, preset: `${base}-light`, quality: 'light' });
      expect(compositionMessages[PRESET_OPTIONS.find(o => o.value === `${base}-light`)!.label].fr).toContain('léger');
      const customized = { ...full, effects: { ...full.effects, season: .8 } };
      expect(withCompositionQuality(withCompositionQuality(customized, 'light'), 'full')).toEqual(customized);
      const appearance = { style: 'parchment' as const, composition: light };
      const live = resolveAppearance(appearance, { mapStyle: 'parchment' }, { nativeCities: true }, 'view2d');
      expect(live.quality).toBe('light');
      expect(resolveAppearance(appearance, { mapStyle: 'parchment' }, { nativeCities: true }, 'export').quality).toBe('full');
      try {
        setDisplayQualityPreference('full'); setDisplayAppearanceQuality(live.quality);
        expect([displayQualityUniform(true), displayQualityUniform(false)]).toEqual([1, 0]);
      } finally { setDisplayAppearanceQuality('full'); setDisplayQualityPreference('auto'); }
    }
  });
  it('maps runtime demotion to the light preset and remembers an explicit full-quality return', async () => {
    vi.resetModules();
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key), setItem: (key: string, value: string) => stored.set(key, value) });
    vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: vi.fn() });
    vi.stubGlobal('navigator', { hardwareConcurrency: 16, deviceMemory: 16 });
    vi.stubGlobal('document', { hidden: false });
    vi.stubGlobal('requestAnimationFrame', undefined);
    const quality = await import('../../src/render/displayQuality');
    let recipe = presetComposition('satellite'); recipe.effects.season = .8;
    const original = structuredClone(recipe);
    const unlisten = quality.onDisplayQualityChange(change => {
      if (change.reason === 'auto') { recipe = withCompositionQuality(recipe, 'light'); quality.setDisplayAppearanceQuality(recipe.quality!); }
    });
    try {
      quality.initializeDisplayQuality();
      for (let time = 1000; time <= 2100; time += 50) { quality.noteDisplayNavigation(time); quality.noteDisplayFrame(time); }
      expect(recipe).toEqual({ ...original, preset: 'satellite-light', quality: 'light' });
      expect([quality.displayQualityFor(true), quality.displayQualityFor(false)]).toEqual(['light', 'full']);
      recipe = withCompositionQuality(recipe, 'full'); quality.setDisplayAppearanceQuality('full'); quality.setDisplayQualityPreference('full');
      expect(recipe).toEqual(original);
      expect(stored.get(quality.DISPLAY_QUALITY_STORAGE_KEY)).toBe('full');
      quality.noteDisplayFrame(2200); expect(quality.getDisplayQuality()).toBe('full');
    } finally { unlisten(); quality.setDisplayQualityPreference('full'); vi.unstubAllGlobals(); }
  });
  it('keeps the URL quality override above the selected preset and captures above both', async () => {
    for (const override of ['full', 'light'] as const) {
      vi.resetModules(); vi.stubGlobal('location', { search: `?quality=${override}` });
      const quality = await import('../../src/render/displayQuality');
      try {
        quality.setDisplayAppearanceQuality(override === 'full' ? 'light' : 'full');
        expect([quality.displayQualityFor(true), quality.displayQualityFor(false)]).toEqual([override, 'full']);
      } finally { vi.unstubAllGlobals(); }
    }
  });
  for (const culture of ['west', 'medina', 'mongol']) {
    it(`resolves the same layout, parcel and house defaults (${culture})`, () => {
      const v2 = resolveRustUrbanControls(settings('s1'), 'a', { culture, sprawl: 1, walls: 'auto', suburbs: 'auto', population: 3000 } as unknown as Options);
      // Bench: defaults, then the "culture" settlement style with the site culture (what a fresh bench applies to a place).
      const style = applySettlementStyle('culture', normalizeLayoutConfig(defaultCityLayoutConfig()), culture);
      const benchLayout = normalizeLayoutConfig(style.layout);
      const benchParcels = normalizeParcelConfig({ ...defaultParcelConfig(), culture });
      expect(v2.layout).toEqual(benchLayout);
      expect(v2.parcels).toEqual(benchParcels);
      // The bench panel sends parcel_fit explicitly, the V2 leaves it to the engine; both mean the same.
      expect(parcelFitOf(v2.houses)).toBe(CITY_DEFAULT_PARCEL_FIT);
      expect(v2.houses.culture).toBeUndefined();
    });
  }

  it('sends the same regional roads and site archetype to the town generator on both pages', () => {
    const road = { a: 0, b: 1, class: 'highway', surface: 'paved', width: 8, length: 300,
      path: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }, { x: 300, y: 0 }],
      crossings: [{ kind: 'bridge', path: [{ x: 120, y: 0 }, { x: 180, y: 0 }] }] };
    const output = { segments: [road, { ...road, class: 'main', crossings: [] }] } as unknown as RoadOutput;
    const placed = { key: 'main', siteType: 'auto', archetype: 'bridge', center: { x: 0, y: 0 }, radius: 100 };
    const world = { roads: [{ path: road.path, width: 8, kind: 'major' }], settlements: [{ key: 'main', archetype: 'bridge' }],
      debug: { v2RustRegion: { placement: { settlements: [placed] }, roads: output } } } as unknown as World;
    const v2 = townRoadStreets(world), bench = regionalStreets(output);
    expect(v2).toEqual(bench);
    expect(v2.map(s => [s.rank, s.role])).toEqual([[0, 'regional'], [0, 'bridge'], [0, 'regional'], [1, 'regional']]);
    expect(townRoadStreets(world)).toBe(v2); // stable identity: no rebuilt bridges or ground tiles on refresh
    expect(cityTownRoads).toBe(regionalStreets);
    // City Bench: the requested site type, else the placed archetype; the V2 reads the same native placement record.
    expect(townSiteArchetypes(world, 'main')).toEqual(citySiteArchetypes([placed]));
    expect(citySiteArchetypes([placed])).toEqual({ main: 'bridge' });
    expect(citySiteArchetypes([{ ...placed, siteType: 'hilltop' }])).toEqual({ main: 'hilltop' });
    expect(townSiteArchetypes(world, 'main', { main: 'harbor' })).toEqual({ main: 'harbor' });
    const benchSource = read('../../src/ui/terrainUrban.ts');
    expect(benchSource).toContain('message.layoutConfig.siteArchetypes = citySiteArchetypes(selected);');
    expect(benchSource).toContain('message.roads = cityTownRoads(roads);');
    expect(read('../../src/v2/urban3d.ts')).toContain('roads = townRoadStreets(world);');
  });

  it('draws every stage from the one general seed when no variation is set', () => {
    const s = settings('abc');
    for (const stage of ['composition', 'streets', 'parcels', 'programme', 'buildings', 'houses'] as const) expect(urbanSeed(s, 'a', stage)).toBe(urbanSeed(s, 'a'));
  });

  it('shares the architecture default, the raster resolution and the display defaults', () => {
    expect(DEFAULT_CITY_ARCHITECTURE).toBe('silhouette');
    const bench = read('../../src/ui/terrainUrban.ts'), v2 = read('../../src/v2/rustUrban.ts');
    expect(bench).toMatch(/let architectureMode: UrbanSceneMode = DEFAULT_CITY_ARCHITECTURE;/);
    expect(bench).toContain('CITY_DISPLAY_DEFAULTS');
    expect(bench).not.toMatch(/settlementRaster\([^)]*, 1024\)/);
    expect(CITY_RASTER_RESOLUTION).toBe(1024);
    expect(v2).toContain('cityArchitectureOf');
    expect(CITY_DISPLAY_DEFAULTS.view).toBe('buildings');
    expect(CITY_DISPLAY_DEFAULTS.palette).toBe('parchment');
  });

  it('builds the same silhouette scene on both paths', () => {
    const ring = (x: number, y: number, s: number) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
    const base = { culture: { pack: 'EUR-MED', mode: 'historical_inspired' }, terrain: { ground_z_m: 3 }, accesses: [] };
    const requests = [
      { ...base, id: 'h1', parcel_id: 'p1', function: 'residential', buildable: [{ outer: ring(0, 0, 10), holes: [] }] },
      { ...base, id: 'o1', parcel_id: 'p2', function: 'open_space', buildable: [{ outer: ring(20, 0, 8), holes: [] }] },
      { ...base, id: 'm1', parcel_id: 'p3', function: 'open_space', buildable: [{ outer: ring(40, 0, 8), holes: [] }], preview: [{ outer: ring(41, 1, 5), holes: [] }], programme: { households: 2, massing: {} } },
    ] as unknown as CityPlacementRequest[];
    const v2 = silhouetteScene(requests), bench = siteVisualScene(requests.map(projectUrbanSite));
    expect(v2).toEqual(bench);
    expect(v2.buildings.map(b => b.id)).toEqual(['h1', 'm1']);
    expect(v2.open_spaces.map(o => o.id)).toEqual(['o1']);
    // Both pages import the same scene builder.
    expect(read('../../src/v2/rustUrban.ts')).toContain("from '../ui/urbanSilhouettes'");
    expect(read('../../src/ui/urbanSceneWorker.ts')).toContain("from './urbanSilhouettes'");
  });

  it('gives the same drawCity options to both pages for one resolved appearance', () => {
    for (const style of ['parchment', 'parchment-light', 'satellite', 'satellite-light'] as const) {
      const r = resolveAppearance({ style: 'parchment', composition: presetComposition(style) }, { mapStyle: 'parchment' }, { nativeCities: true }, 'view2d');
      const frame = { viewport: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, mpp: 1, dpr: 1 };
      const v2 = cityDrawOptions({ appearance: r, city: r.city, frame, lod: 'near', layers: r.city.layers, labelsAllowed: true, buildingAppearance: cityBuildingAppearance(r), page: { buildingsVisible: true } });
      const bench = cityDrawOptions({ appearance: r, city: { ...r.city }, view: r.city.view, frame: { ...frame }, lod: 'near', layers: { ...r.city.layers }, labelsAllowed: true, buildingAppearance: cityBuildingAppearance(r, { nightInk: undefined }), page: { buildingsVisible: true } });
      const { beforeBuildings: benchBefore, ...benchOptions } = bench, { beforeBuildings: v2Before, ...v2Options } = v2;
      expect(benchOptions).toEqual(v2Options);
      expect(benchBefore).toBeTypeOf('function'); expect(v2Before).toBeTypeOf('function');
      expect(v2.colors).toBe(v2.appearance.colors);
      expect(v2.groundBlend).toBe(r.city.groundBlend === 'blended');
      expect(v2.roadEmphasis).toBe(r.composition.networks.roads.emphasis);
    }
  });

  it('stands lot fences with the buildings, not with the parcel diagram, in 2D and 3D', () => {
    for (const style of PRESET_IDS) for (const target of ['view2d', 'view3d'] as const) {
      const r = resolveAppearance({ style: 'parchment', composition: presetComposition(style) }, { mapStyle: 'parchment' }, { nativeCities: true }, target);
      expect(r.city.layers.lotEnclosures, `${style} ${target}`).toBe(r.composition.buildings.visible);
      expect(city3dPlanOptions(r).layers.lotEnclosures, `${style} ${target} 3D`).toBe(r.composition.buildings.visible);
    }
    const hidden = presetComposition('parchment'); hidden.buildings.visible = false;
    expect(resolveAppearance({ style: 'parchment', composition: hidden }, { mapStyle: 'parchment' }, { nativeCities: true }, 'view2d').city.layers.lotEnclosures).toBe(false);
    // Both draw paths gate the fences on lotEnclosures alone (parcelOverlay is the parcel diagram).
    expect(read('../../src/render/cityCanvas.ts')).toContain('if (layers.lotEnclosures !== false) drawLotEnclosures(');
    expect(read('../../src/ui/city3d.ts')).toContain('yardsShown = yardLayers?.lotEnclosures !== false;');
  });

  it('builds the drawCity options of both pages with the shared function only', () => {
    const bench = read('../../src/ui/terrainUrban.ts'), v2 = read('../../src/v2/nativeCityMap.ts');
    for (const page of [bench, v2]) {
      expect(page).toContain('cityDrawOptions({');
      expect(page).toContain('cityBuildingAppearance(');
    }
    // The 3D ground tile (drawGround) is a separate, footprint-only call.
    expect(bench).toContain('drawCity(ctx, cityPlan, cityDrawOptions(');
    expect(v2).toContain('drawCity(ctx, entry.plan, cityDrawOptions(');
  });

  it('uses the one raster side rule in both pages', () => {
    expect(cityRasterSide({ mapSize: 30000, gridSide: 512, nativeSide: 2048 })).toBe(512);
    expect(cityRasterSide({ mapSize: 60000, gridSide: 512, nativeSide: 2048 })).toBe(1024);
    expect(cityRasterSide({ mapSize: 60000, gridSide: 512, nativeSide: 8 })).toBe(16);
    expect(cityRasterSide({ mapSize: 60000, gridSide: 1024, nativeSide: 2048 })).toBe(1024);
    expect(read('../../src/v2/rustUrban.ts')).toContain('cityRasterSide(');
    const bench = read('../../src/ui/terrainUrban.ts');
    expect(bench).toContain('citySettlementRaster(');
    expect(bench).not.toMatch(/settlementRaster\([^)]*CITY_RASTER_RESOLUTION/);
  });
  it('shares the reviewed full-sheet layout defaults and preserves explicit overrides', () => {
    expect(CITY_LAYOUT_DEFAULTS).toEqual({ naturalCampApproaches: true, streetFrontage: true, alignEnclosedGrid: true,
      hideUnusedQuarters: true, organicBranchVariation: .5, ribbonWidthVariation: .5 });
    const current = settings('review');
    current.urban!.layout = { streetFrontage: false, organicBranchVariation: 0 };
    const layout = resolveRustUrbanControls(current, 'a', { culture: 'west' } as Options).layout;
    expect(layout.streetFrontage).toBe(false); expect(layout.organicBranchVariation).toBe(0);
    expect(layout.naturalCampApproaches).toBe(true); expect(layout.ribbonWidthVariation).toBe(.5);
    for (const file of ['../../src/v2/rustUrban.ts', '../../src/v2/urbanControls.ts', '../../src/ui/terrainUrban.ts'])
      expect(read(file)).toContain('defaultCityLayoutConfig as defaultLayoutConfig');
  });

  it('shares canopy/night finishing, native house LOD and the 3D ground-plan options', () => {
    const v2 = read('../../src/v2/nativeCityMap.ts'), bench = read('../../src/ui/terrainUrban.ts');
    for (const page of [v2, bench]) expect(page).toContain('finishCityFrame(ctx,');
    expect(v2).not.toContain('HOUSE_LOD');
    for (const page of [read('../../src/v2/urban3d.ts'), read('../../src/ui/citybench.ts')]) expect(page).toContain('getPlanOptions: () => city3dPlanOptions(');
    const composition = presetComposition('parchment'); composition.effects.ambience = 'night';
    const r = resolveAppearance({ style: 'parchment', composition, unifiedDefaults: true }, {} as never, { nativeCities: true }, 'view3d');
    const options = city3dPlanOptions(r);
    const hiddenRoads = { ...r, composition: { ...r.composition, networks: { ...r.composition.networks, roads: { ...r.composition.networks.roads, visible: false } } } };
    expect(cityRegionalStreets(hiddenRoads, [])).toBe(cityRegionalStreets(hiddenRoads, []));
    expect(options.night).toBe(true); expect(options.roadEmphasis).toBe(r.composition.networks.roads.emphasis);
    expect(cityBuildingAppearance(r).nightInk).toBe(true);
    expect(options.buildingsVisible).toBe(r.composition.buildings.visible && r.composition.buildings.meshes === 'none');
  });

  it('keeps the massing and its 3D facade windows on the shared silhouette path', () => {
    const outer = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 8 }, { x: 0, y: 8 }];
    const request = { id: 'house', parcel_id: 'lot', function: 'domestic', culture: { culture: 'west', pack: 'EUR-MED', mode: 'historical_inspired' },
      terrain: { ground_z_m: 0 }, accesses: [], preview: [{ outer, holes: [] }], buildable: [{ outer, holes: [] }],
      programme: { households: 3, massing: [{ floors: 2, eave_m: 6, rise_m: 2, roof: 'gable', ridges: [[0, 4, 12, 4]], cover: 'tile', wall: 'brick' }] } } as unknown as CityPlacementRequest;
    const v2 = silhouetteScene([request]), bench = siteVisualScene([projectUrbanSite(request, 0)]);
    expect(city3dScene(v2)).toEqual(city3dScene(bench));
    expect(city3dScene(v2).buildings[0].volumes.flatMap(v => v.roof_mesh.faces).filter(f => f.material.includes('wall:opening')).length).toBeGreaterThan(1);
  });

  it('replaces the compact roof once and tiles a concave native pan without crossing its notch', () => {
    const outer = [[8, 0], [8, 2], [2, 2], [2, 8], [0, 8], [0, 0]].map(([x, y]) => ({ x, y }));
    const request = { id: 'concave', parcel_id: 'lot', function: 'domestic', culture: { culture: 'european-organic' },
      terrain: { ground_z_m: 0 }, accesses: [], preview: [{ outer, holes: [] }], buildable: [{ outer, holes: [] }],
      programme: { massing: [{ floors: 1, eave_m: 3, rise_m: 2, roof: 'hip', ridges: [], cover: 'tile', wall: 'brick' }] } } as unknown as CityPlacementRequest;
    const source = silhouetteScene([request]), compact = city3dScene(source).buildings[0], volume = compact.volumes[0];
    const detail = { ...compact, recipe_id: 'native', volumes: [{ ...volume, roof_mesh: {
      vertices: outer.map(p => ({ ...p, z: 3 + .2 * p.x })),
      faces: [{ vertices: outer.map((_, i) => i), normal: [-.2, 0, 1] as [number, number, number], material: volume.materials.cladding, kind: 'pan' as const }],
    } }] };
    const scene = city3dScene(source, { details: new Map([[detail.id, detail]]) });
    expect(scene.buildings).toEqual([detail]);
    expect(scene.kinds).toEqual({ silhouette: 0, compact: 0, detailed: 1 });
    for (const overview of [false, true]) {
      const roofs: BuildingTriangle[] = [];
      eachBuildingTriangle(detail, t => { if (t.surface === 'roof') roofs.push(t); }, overview);
      const area = roofs.reduce((s, { points: [a, b, c] }) => s + Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2, 0);
      expect(area).toBeCloseTo(28, 8);
      expect(roofs.every(t => buildingRayDistance([4, 4, 100], [0, 0, -1], t.points) === null)).toBe(true);
    }
  });

  it('keeps a shallow oppidum roof on the wall top through its overhang', () => {
    const ring = Array.from({ length: 16 }, (_, i) => [4 * Math.cos(i * Math.PI / 8), 4 * Math.sin(i * Math.PI / 8)]);
    const outer = ring.map(([x, y]) => ({ x, y }));
    const request = { id: 'roundhouse', parcel_id: 'lot', function: 'domestic', culture: { culture: 'celtic-oppidum' },
      terrain: { ground_z_m: 0 }, accesses: [], preview: [{ outer, holes: [] }], buildable: [{ outer, holes: [] }],
      programme: { massing: [{ floors: 1, eave_m: 2.2, rise_m: .3, roof: 'cone', ridges: [], cover: 'thatch', wall: 'wattle',
        volumes: [{ ring, eave_m: 2.2, rise_m: .3, roof: 'cone', ridges: [], overhang_m: .65 }] }] } } as unknown as CityPlacementRequest;
    const source = silhouetteScene([request]), b = city3dScene(source).buildings[0], v = b.volumes[0];
    expect(city3dScene(siteVisualScene([projectUrbanSite(request, 0)]))).toEqual(city3dScene(source));
    const cover = v.roof_mesh.faces.filter(f => f.material.includes('cover:'));
    expect(Math.min(...cover.flatMap(f => f.vertices.map(i => v.roof_mesh.vertices[i].z)))).toBeCloseTo(v.z_m + v.wall_height_m, 8);
    for (const p of outer) expect(cover.some(f => f.vertices.some(i => {
      const q = v.roof_mesh.vertices[i]; return Math.hypot(p.x - q.x, p.y - q.y) < 1e-8 && Math.abs(q.z - 2.2) < 1e-8;
    }))).toBe(true);
    expect(Math.max(...v.roof_mesh.vertices.map(p => Math.hypot(p.x, p.y)))).toBeGreaterThan(4.5);
  });

  it('raises stepped terrace rings and keeps exactly one roof above each tier', () => {
    const square = (r: number) => [[-r, -r], [r, -r], [r, r], [-r, r]].map(([x, y]) => ({ x, y }));
    const preview = [12, 9, 6].map(r => ({ outer: square(r), holes: [square(r - 3).reverse()] }));
    preview.push({ outer: square(3), holes: [] });
    const request = { id: 'pyramid', parcel_id: 'lot', function: 'religious', culture: { culture: 'maya' },
      terrain: { ground_z_m: 0 }, accesses: [], preview, buildable: preview,
      programme: { landmark: true, role: 'worship.pyramid-precinct', massing: preview.map((_, i) => ({
        floors: 1, eave_m: (i + 1) * 3, rise_m: 0, roof: 'flat', ridges: [], cover: 'stone', wall: 'stone', openings: 'none',
      })) } } as unknown as CityPlacementRequest;
    const source = silhouetteScene([request]), b = city3dScene(source).buildings[0];
    expect(city3dScene(siteVisualScene([projectUrbanSite(request, 0)]))).toEqual(city3dScene(source));
    for (const overview of [false, true]) {
      const roofs: BuildingTriangle[] = [];
      eachBuildingTriangle(b, t => { if (t.surface === 'roof') roofs.push(t); }, overview);
      for (const [x, height] of [[10.3, 3], [7.3, 6], [4.3, 9], [1.3, 12]]) {
        const hits = roofs.map(t => buildingRayDistance([x, .7, 100], [0, 0, -1], t.points)).filter(d => d !== null);
        expect(hits).toHaveLength(1);
        expect(hits[0]).toBeCloseTo(100 - height, 8);
      }
    }
  });

  it('invalidates forest occupation with the city once, without a second city-pass upload', () => {
    const r = resolveAppearance({ style: 'render3d' as never, composition: presetComposition('satellite') }, {} as never, { nativeCities: true }, 'view2d');
    const input = { r, revisions: { terrain: 1, roads: 1, landuse: 1, settlements: 1, names: 1, cities: { a: 1 } }, layers: {}, mode: 'gpu' as const, effective: '', forestEffective: '', worldSig: '' };
    expect(passKeys({ ...input, revisions: { ...input.revisions, cities: { a: 2 } } }).forest).not.toBe(passKeys(input).forest);
    const renderer = read('../../src/v2/benchRenderer.ts');
    expect(renderer.slice(renderer.indexOf('private async cityPass()'), renderer.indexOf('/** Capture/export only'))).not.toContain('this.forestPass()');
    expect(read('../../src/ui/city3d.ts')).toContain('options.getBackgroundImage?.()');
    expect(renderer).toContain('this.backgroundImage ??= this.gpu!.captureMap(1024)');
  });

});


describe('retained city environment parity', () => {
  it('keeps water independent from streets and retains the decor vectors', () => {
    const parchment = resolveAppearance({ style: 'parchment', composition: presetComposition('parchment') }, {} as never, { nativeCities: true }, 'view2d');
    expect(cityWaterCutsLand(parchment)).toBe(true);
    const layers = { ...CITY_DISPLAY_DEFAULTS.layers, streets: false, waterways: true };
    expect(cityGlOverlayLayers(layers).waterways).toBe(true);
    expect(cityGlOverlayLayers({ ...layers, streets: true, waterways: false }).waterways).toBe(false);
    expect(read('../../src/v2/decorTerrain.ts')).toContain('v2Decor: decor');
    expect(read('../../src/v2/benchRenderer.ts')).toContain('decorWaterSvg(decor,');
    expect(read('../../src/ui/citybench.ts')).toContain('decorWaterSvg(decor,');
    expect(read('../../src/v2/urban3d.ts')).toContain('retainedDecorOf(world.terrain)');
  });

  it('shares countryside generation, physical forest inputs and vector layer ownership', () => {
    expect(read('../../src/v2/engine.ts')).toContain('await generateUrbanLanduse({');
    expect(read('../../src/ui/urbanLanduse.ts')).toContain('urbanLanduseData');
    for (const file of ['../../src/v2/displayForest.ts', '../../src/ui/citybench.ts']) {
      expect(read(file)).toContain('cityForestInput(');
      expect(read(file)).toContain('forestRetainedRiverSegments(');
    }
    for (const file of ['../../src/v2/benchRenderer.ts', '../../src/ui/urbanLanduse.ts']) {
      expect(read(file)).toContain('cityOverlayLandKinds('); expect(read(file)).toContain('cityOverlayLandKey('); expect(read(file)).toContain('cityWaterCutsLand('); expect(read(file)).toContain('cityCountrysideCanvasOptions(');
    }
    expect(cityCountrysideTextureVisible('forest', .607)).toBe(true);
    expect(cityCountrysideTextureVisible('orchard', .767)).toBe(true);
    expect(cityCountrysideTextureVisible('field', .607)).toBe(false);
    expect(read('../../src/render/canvas.ts')).toContain('cityCountrysideTextureVisible(tl.kind, sc)');
    const height = { x: 0, y: 0, width: 100, n: 2, data: new Float32Array(4) }, water = new Uint8Array(4);
    const source = cityForestInput('decor', { temperature: 12, precipitation: 800 }, height, water);
    expect(source.height).toBe(height); expect(source.water).toBe(water); expect(source.climate).toEqual([12, 800]);
    for (const preset of ['parchment', 'satellite', 'satellite-2'] as const) {
      const r = resolveAppearance({ style: 'parchment', composition: presetComposition(preset) }, {} as never, { nativeCities: true }, 'view2d');
      const draw = cityCountrysideCanvasOptions(r, 4000);
      expect(draw.raster).toBe(true); expect(draw.furrowReferenceSize).toBe(4000);
      const mask = cityOverlayLandKinds(r);
      if (r.ground.traits.family === 'material') expect(mask !== true && mask('field')).toBe(false);
    }
  });

  it('uses V2 material settings on both pages, including satellite paper and ground cover', () => {
    for (const file of ['../../src/v2/urban3d.ts', '../../src/ui/citybench.ts']) expect(read(file)).toContain('return cityGroundSettings(');
    expect(CITY_3D_MATERIAL_GROUNDS).toContain('parchment-render');
    for (const file of ['../../src/ui/city3d.ts', '../../src/v2/appearance.ts', '../../src/render/appearanceRecipe.ts']) expect(read(file)).toContain('cityGroundModes');
    const r = resolveAppearance({ style: 'parchment', composition: presetComposition('satellite-2') }, {} as never, { nativeCities: true }, 'view3d');
    const source = { seed: 'decor', climate: { temperature: 12, precipitation: 800 }, climateZone: 'temperate' as const, sourceCell: 4, relief: 'flat' };
    const a = cityGroundSettings(r, 'parchment-render', source), b = cityGroundSettings(r, 'parchment-render', { ...source });
    expect(a).toEqual(b); expect(a?.paperMap).toBe(true); expect(a?.groundCover).toBe(r.composition.vegetation.procedural);
    expect(cityGroundSettings(r, 'map', source)).toBeUndefined();
  });

  it('clears canopy ground in the shared under-building hook before page painting', () => {
    const r = resolveAppearance({ style: 'parchment', composition: presetComposition('parchment') }, {} as never, { nativeCities: true }, 'view2d');
    const image = {} as HTMLCanvasElement, events: string[] = [];
    setCityCanopy(() => image);
    const ctx = { save() {}, restore() {}, drawImage() { events.push('clear'); } } as unknown as CanvasRenderingContext2D;
    try {
      for (const page of ['v2', 'bench']) {
        const options = cityDrawOptions({ appearance: r, city: r.city, frame: { viewport: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, mpp: 1, dpr: 1 },
          lod: 'near', layers: r.city.layers, labelsAllowed: true, buildingAppearance: cityBuildingAppearance(r), page: { buildingsVisible: true, beforeBuildings() { events.push(page); } } });
        options.beforeBuildings?.(ctx);
      }
      expect(events).toEqual(r.composition.vegetation.procedural ? ['clear', 'v2', 'clear', 'bench'] : ['v2', 'bench']);
    } finally { setCityCanopy(undefined); }
    expect(read('../../src/ui/terrainUrban.ts')).not.toContain('clearCityGroundUnderCanopy(');
  });

  it('shares cultural naming input and shoots V2 with the decor seed without changing framing', () => {
    expect(read('../../src/v2/testHook.ts')).toContain("name: original?.name ?? ''");
    const site = { key: 'main', name: '', culture: 'european-organic' };
    expect(cityNamedSite(site, 'decor')).toEqual(cityNamedSite({ ...site }, 'decor'));
    expect(cityNamedSite(site, 'decor').name.length).toBeGreaterThan(0);
    expect(cityNamedSite({ ...site, name: 'Town' }, 'decor').name).toBe('Town');
    for (const file of ['../../src/v2/rustUrban.ts', '../../src/ui/terrainUrban.ts']) expect(read(file)).toContain('cityNamedSite(');
    // Review sheets are local artifacts, absent in a clean source checkout.
    if (existsSync(new URL('../../out/planches-styles-v7/v2drive.mjs', import.meta.url))) {
      const driver = read('../../out/planches-styles-v7/v2drive.mjs');
      expect(driver).toContain('const seed = process.env.SEED ?? meta.seed;');
      expect(driver).toContain("p.evaluate(hideOverlays, '.map-area')");
    }
  });
});
