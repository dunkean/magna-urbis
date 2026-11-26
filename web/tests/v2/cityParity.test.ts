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
import type { Farmstead, World } from '../../src/gen/types';
import { fakeWorld } from '../../scripts/fakeworld';
import { buildScene } from '../../src/render/scene';
import { city3dFarmSources } from '../../src/render/city3d/display';
import { citySiteArchetypes, cityFixedSites, cityTownRoads } from '../../src/render/cityGeneration';
import { urbanSeed } from '../../src/v2/urbanSeeds';
import { defaultLayoutConfig, defaultParcelConfig, normalizeLayoutConfig, normalizeParcelConfig } from '../../../rust/bridge/urbanConfig';
import { siteVisualScene, silhouetteScene, type CityPlacementRequest } from '../../src/ui/urbanSilhouettes';
import { projectUrbanSite } from '../../src/ui/urbanSiteStore';
import { applySettlementStyle } from '../../src/ui/urbanSettlementStyles';
import { CITY_DISPLAY_DEFAULTS, DEFAULT_CITY_ARCHITECTURE, cityRegionalStreets } from '../../src/render/cityContract';
import { CITY_DEFAULT_PARCEL_FIT, CITY_RASTER_RESOLUTION, cityRasterSide, parcelFitOf, defaultCityLayoutConfig, CITY_LAYOUT_DEFAULTS } from '../../src/render/cityGeneration';
import { cityBuildingAppearance, cityDrawOptions, city3dPlanOptions, volumeTownBuildings } from '../../src/render/cityDrawOptions';
import { ROOF_MODES } from '../../src/render/roofMode';
import { URBAN_PHYSICAL_LAYERS, URBAN_PLAN_LAYERS, resolveAppearance, type AppearanceInput } from '../../src/render/appearanceRecipe';
import type { V2Settings } from '../../src/v2/contracts';
import type { Options } from '../../src/gen/types';
import { CITY3D_PLINTH_M, city3dScene } from '../../src/render/city3dMeshes';
import { pieceShadow, pieceShadows, pieceVolumes, planRoof, volumeRoof, type MassingPiece } from '../../src/render/cityMassing';
import { buildingRayDistance, eachBuildingTriangle, type BuildingTriangle } from '../../src/render/urbanBuildingGeometry';
import { PRESET_IDS, isHiddenPreset, styleAvailableOnPage, presetComposition, validateComposition, withCompositionQuality, resolveComposition, townPlanSwitches, DEFAULT_CROWN_DETAIL } from '../../src/render/composition';
import { crownClumpMode } from '../../src/render/crownClumpAtlas';
import { styleTraits } from '../../src/render/terrainStyle';
import { PRESET_OPTIONS, RENDER_COMPOSITION_ROWS, RENDER_SECTION_FIELDS, compositionMessages, renderControlFields } from '../../src/ui/compositionControls';
import { passKeys } from '../../src/v2/passes/pass';
import { FallbackGround } from '../../src/ui/terrain/fallbackGround';
import { terrain3dPixelRatio, TERRAIN_3D_MOVING_PIXELS, TERRAIN_3D_FRAME_PIXELS } from '../../src/ui/terrain3dResolution';
import { DISPLAY_QUALITIES, displayQualityFor, displayQualityUniform, onDisplayQualityChange, setDisplayQualityPreference, setDisplayAppearanceQuality } from '../../src/render/displayQuality';
import { StepwisePaint } from '../../src/render/stepwisePaint';
import { drawFantasyRaster, suspendFantasyRaster, KEEP_NONE, type FantasyRaster } from '../../src/ui/fantasyRaster';
import { STRUCTURE_ROLES } from '../../src/render/groundBlend';
import { streetColors } from '../../src/render/cityGlStyle';
import { CROSSINGS } from '../../src/render/city/look';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const settings = (seed: string): V2Settings => ({ options: { seed }, local: {}, urban: { backend: 'rust' } }) as unknown as V2Settings;

it('shares the farm plan, enclosure gate and platform level across overhead and tilted views', () => {
  const rect = (x: number, y: number, width: number, depth: number) => [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + depth },
    { x, y: y + depth },
  ];
  const platform = rect(20, 20, 30, 30);
  const [a, b, c, d] = platform;
  const enclosure = [{ x: 28, y: 20 }, a, d, c, b, { x: 42, y: 20 }];
  const house = rect(28, 28, 6, 8);
  const silo = Array.from({ length: 12 }, (_, k) => ({ x: 41 + 2.5 * Math.cos((k * Math.PI) / 6), y: 34 + 2.5 * Math.sin((k * Math.PI) / 6) }));
  const farm: Farmstead = {
    pos: { x: 35, y: 35 },
    angle: 0,
    drive: [],
    yard: platform,
    plots: [{ kind: 'platform', poly: platform, heightM: 1.5 }],
    enclosure: 'bank',
    walls: [enclosure],
    buildings: [house, silo],
    parts: [
      { poly: house, use: 'house', arch: 'farmhouse', roof: 'gable' },
      { poly: silo, use: 'silo', arch: 'grain-farm-silo', roof: 'conical', material: 'steel', storeys: 3 },
    ],
  };
  const world = fakeWorld({ mapSize: 250, clusters: 1, buildings: 0, streets: 0, landAreas: 0 });
  world.roads = [];
  world.landuse = { areas: [], reserve: [], farmsteads: [farm] };
  const plan = buildScene(world);
  expect(plan.poly.get('farm-buildings')?.polys).toEqual([house, silo]);
  expect(plan.poly.get('farm-platforms')?.polys).toEqual([platform]);
  expect(plan.lines.find(line => line.name === 'farm-banks')).toMatchObject({ kind: 'bank', lines: [enclosure] });

  const natural = (x: number) => 10 + x / 10;
  const sources = city3dFarmSources([farm], [], natural);
  const tilted = city3dScene({ schema_version: '1', generator_version: 'silhouette', buildings: sources, refusals: [], open_spaces: [] }, { heightAt: natural, ground: { at: natural, cut: true } }).buildings;
  const earth = tilted.find(part => part.variant_id === 'platform')!;
  const top = earth.volumes[0].z_m + earth.volumes[0].wall_height_m;
  expect(earth.footprint[0].outer).toEqual(platform);
  expect(top).toBeCloseTo(16.5);
  const tower = tilted.find(part => part.variant_id === 'silo')!;
  expect(tower.footprint[0].outer).toEqual(silo);
  expect(tower.volumes[0].wall_height_m).toBeGreaterThan(8);
  expect([tower, tilted.find(part => part.variant_id === 'house')!].map(part => part.ground_z_m)).toEqual([top, top]);
  const banks = tilted.filter(part => part.variant_id === 'bank');
  expect(banks.length).toBeGreaterThan(0);
  expect(banks.every(part => part.ground_z_m === top && part.volumes[0].wall_height_m < 1)).toBe(true);
  expect(
    banks
      .flatMap(part => part.footprint[0].outer)
      .filter(p => p.y < 21)
      .every(p => p.x <= 28 || p.x >= 42),
  ).toBe(true);
});

describe('shared live tile filling', () => {
  it('bounds slices and discards the density left by navigation', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let id = 0,
      clock = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
    const fill = new StepwisePaint(() => clock),
      built: string[] = [],
      invalidate = vi.fn(),
      failed = vi.fn();
    const flush = (): void => {
      const [frame, callback] = frames.entries().next().value!;
      frames.delete(frame);
      callback(clock);
    };
    function* work(level: string): Generator<boolean, void> {
      for (let i = 0; i < 5; i++) {
        built.push(`${level}:${i}`);
        clock += 5;
        yield true;
      }
    }
    try {
      fill.start('old', () => work('old'), invalidate, failed);
      expect(built).toEqual([]);
      flush();
      expect(built).toEqual(['old:0', 'old:1']);
      fill.suspend();
      expect(frames.size).toBe(0);
      fill.start('rest', () => work('rest'), invalidate, failed);
      while (frames.size) flush();
      expect(built).toEqual(['old:0', 'old:1', 'rest:0', 'rest:1', 'rest:2', 'rest:3', 'rest:4']);
      expect(failed).not.toHaveBeenCalled();
    } finally {
      fill.suspend();
      vi.unstubAllGlobals();
    }
  });
  it('releases a partially painted tile without repainting it', () => {
    let callback: FrameRequestCallback | undefined,
      clock = 0,
      released = false;
    vi.stubGlobal('requestAnimationFrame', (next: FrameRequestCallback) => {
      callback = next;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {
      callback = undefined;
    });
    const fill = new StepwisePaint(() => clock),
      invalidate = vi.fn();
    function* work(): Generator<boolean, void> {
      try {
        clock += 10;
        yield false;
        throw new Error('Stale tile resumed');
      } finally {
        released = true;
      }
    }
    try {
      fill.start('partial', work, invalidate, vi.fn());
      callback!(clock);
      expect(invalidate).not.toHaveBeenCalled();
      fill.suspend();
      expect(released).toBe(true);
      expect(callback).toBeUndefined();
    } finally {
      fill.suspend();
      vi.unstubAllGlobals();
    }
  });
  it('draws the Illustrated wash without visiting stamps or planning vegetation', () => {
    const drawImage = vi.fn(),
      restore = vi.fn();
    const ctx = { save() {}, restore, beginPath() {}, rect() {}, clip() {}, drawImage } as unknown as CanvasRenderingContext2D;
    const raster = {
      painting: {
        frame: { x: 0, y: 0, width: 100 },
        get stamps() {
          throw new Error('Wash visited stamps');
        },
      },
      wash: {},
      fields: [],
    } as unknown as FantasyRaster;
    drawFantasyRaster(ctx, raster, { minX: 0, minY: 0, maxX: 100, maxY: 100 }, 0.1, KEEP_NONE);
    expect(drawImage).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledOnce();
  });
  it('fills close Illustrated tiles centre first and cancels an unfinished stamp batch', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let id = 0,
      clock = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const targets: TileCanvas[] = [],
      transforms: number[][] = [];
    class TileCanvas {
      constructor(
        public width: number,
        public height: number,
      ) {
        targets.push(this);
      }
      getContext() {
        return {
          imageSmoothingQuality: '',
          setTransform: (...args: number[]) => transforms.push(args),
          beginPath() {},
          rect() {},
          clip() {},
          drawImage() {
            clock += 10;
          },
        };
      }
    }
    vi.stubGlobal('OffscreenCanvas', TileCanvas);
    vi.stubGlobal('HTMLCanvasElement', class {});
    const ctx = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, setTransform() {}, drawImage: vi.fn(), getTransform: () => ({ a: 8, b: 0, c: 0, d: 8, e: 0, f: 0 }) } as unknown as CanvasRenderingContext2D;
    const stamp = { x: 48, y: 48, width: 20, brush: 0, flip: false, opacity: 1 };
    const raster = {
      painting: { frame: { x: 0, y: 0, width: 1000 }, stamps: [stamp], library: { offsets: [0], variants: 1, frames: [{ family: 'pines', rect: [0, 0, 10, 10] }] } },
      images: new Map([['pines', {}]]),
      heights: new Float32Array([20]),
      up: 20,
      down: 1,
      half: 10,
      fields: [],
      tiles: new Map(),
      onTiles: vi.fn(),
    } as unknown as FantasyRaster;
    try {
      drawFantasyRaster(ctx, raster, { minX: 0, minY: 0, maxX: 96, maxY: 96 }, 8, undefined, false, false, true, true);
      expect(targets).toHaveLength(0);
      expect(ctx.drawImage).not.toHaveBeenCalled();
      const [frame, callback] = frames.entries().next().value!;
      frames.delete(frame);
      callback(clock);
      expect(targets).toHaveLength(1);
      expect(transforms[0]).toEqual([8, 0, 0, 8, -254, -254]);
      expect(raster.onTiles).not.toHaveBeenCalled();
      suspendFantasyRaster(raster);
      expect(targets[0].width).toBe(0);
      expect(frames.size).toBe(0);
    } finally {
      suspendFantasyRaster(raster);
      now.mockRestore();
      vi.unstubAllGlobals();
    }
  });
  it('finishes exact Illustrated captures, including missing fine vegetation, synchronously', () => {
    const fine = vi.fn(() => [{ x: 100, y: 100, width: 4, height: 4, brush: 0, flip: false, opacity: 1 }]);
    const raster = {
      painting: { stamps: [], fine, treeWidth: 4, library: { offsets: [0], variants: 1, frames: [{ family: 'pines', aspect: 1, rect: [0, 0, 10, 10] }] } },
      images: new Map([['pines', {}]]),
      heights: new Float32Array(),
      up: 0,
      down: 0,
      half: 0,
      tiles: new Map(),
      fields: [],
    } as unknown as FantasyRaster;
    const ctx = { save() {}, restore() {}, drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
    drawFantasyRaster(ctx, raster, { minX: 99, minY: 99, maxX: 101, maxY: 101 }, 1, undefined, false, true, false);
    expect(fine).toHaveBeenCalledOnce();
    expect(ctx.drawImage).toHaveBeenCalledOnce();
    expect(raster.tiles.size).toBe(1);
  });
});

describe('V2 and City Bench stay in sync', () => {
  it('exposes Minimal only where the independent shared painter is wired', () => {
    expect(styleAvailableOnPage('minimal', 'v2')).toBe(true);
    expect(styleAvailableOnPage('minimal', 'bench')).toBe(false);
    for (const preset of PRESET_IDS.filter(id => id !== 'minimal')) expect(styleAvailableOnPage(preset, 'bench')).toBe(true);
    expect(read('../../src/ui/benchRenderSettings.ts')).toContain('styleAvailableOnPage(');
    expect(read('../../src/ui/benchComposition.ts')).toContain('styleAvailableOnPage(');
    expect(read('../../src/v2/minimalRenderer.ts')).toContain("from '../render/minimalMap'");
    const client = read('../../src/v2/client.ts');
    expect(client).toContain("minimalAppearance?.path === 'minimal'");
    expect(client).toContain("this.resolve(settings, world, true).path !== 'minimal'");
  });

  it('budgets shared 3D preparation by frame, prioritises near work and cancels stale inputs', async () => {
    const frames = new Map<number, FrameRequestCallback>();
    let serial = 0,
      time = 0;
    vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => {
      frames.set(++serial, frame);
      return serial;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    vi.spyOn(performance, 'now').mockImplementation(() => time);
    const queue = new FramePreparation(),
      order: string[] = [];
    function* work(name: string): Generator<void, number> {
      for (let i = 0; i < 20; i++) {
        order.push(name);
        time++;
        yield;
      }
      return 20;
    }
    const advance = (): void => {
      const [id, frame] = frames.entries().next().value!;
      frames.delete(id);
      frame(time);
    };
    try {
      const far = queue.run(work('far'), () => true, 2),
        near = queue.run(work('near'), () => true, 1);
      advance();
      // No input yet: the rested (idle) budget applies.
      expect(order.length).toBe(PREPARATION_BUDGET_MS.idle);
      expect(order.slice(0, 20)).toEqual(Array(20).fill('near'));
      while (frames.size) advance();
      expect(await near).toBe(20);
      expect(await far).toBe(20);
      const count = order.length;
      const stale = expect(queue.run(work('stale'), () => false)).rejects.toMatchObject({ name: 'AbortError' });
      advance();
      await stale;
      expect(order.length).toBe(count);
      const cancelled = expect(queue.run(work('cancelled'), () => true)).rejects.toMatchObject({ name: 'AbortError' });
      queue.clear();
      await cancelled;
      expect(frames.size).toBe(0);
    } finally {
      queue.clear();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  it('keeps the exact near-tree stream when placement is split across frames', () => {
    const rgba = new Uint8Array(8 * 8 * 4);
    for (let i = 0; i < 64; i++) rgba.set([220, 150, 40, 255], i * 4);
    const inputs = { field: { n: 8, rgba, x: 0, y: 0, width: 160, key: 'parity' }, seed: 7, climate: { temperature: 12, precipitation: 900 }, renderV2: 1, zone: 1, season: 0.5, water: (x: number) => (x < 40 ? 1 : 0), height: () => 20 } as TreeInputs;
    const view = { x: 80, y: 80, forwardX: 0, forwardY: 1 },
      steps = buildNearTreesSteps(inputs, view);
    let step = steps.next(),
      yields = 0;
    while (!step.done) {
      yields++;
      step = steps.next();
    }
    expect(yields).toBeGreaterThan(100);
    expect(step.value.length).toBeGreaterThan(0);
    expect(step.value).toEqual(buildNearTrees(inputs, view));
    for (let i = 0; i < step.value.length; i += 12) expect(step.value[i]).toBeGreaterThanOrEqual(40);
  });

  it('moves the fallback ground painted at rest while the view moves, and paints it again at rest', () => {
    const canvas = { style: {} } as HTMLCanvasElement,
      ground = new FallbackGround();
    let paints = 0;
    const paint = (): boolean => {
      paints++;
      return true;
    };
    const view = { cx: 0, cy: 0, scale: 1 };
    ground.present(canvas, view, 1000, 800, 2, false, paint);
    // However far the view moves, the picture follows it by a transform: no paint until the view rests.
    for (let x = 1; x <= 600; x += 10) ground.present(canvas, { ...view, cx: x }, 1000, 800, 2, true, paint);
    ground.present(canvas, { cx: 591, cy: 0, scale: 0.25 }, 1000, 800, 2, true, paint);
    expect(paints).toBe(1);
    expect(canvas.style.transform).toBe('translate(-147.75px,0px) scale(0.25)');
    ground.present(canvas, { ...view, cx: 500 }, 1000, 800, 2, false, paint);
    expect(paints).toBe(2);
    expect(canvas.style.transform).toBe('');
    ground.invalidate(canvas); // A capture, a world tile or a changed input invalidates the picture.
    ground.present(canvas, { ...view, cx: 501 }, 1000, 800, 2, true, paint);
    expect(paints).toBe(3);
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
      expect(uniforms).toEqual([
        [1, 0],
        [0, 0],
      ]);
    } finally {
      unlisten();
      setDisplayQualityPreference('auto');
    }
  });
  it('lists light presets beside their full versions and changes only their quality', () => {
    expect(PRESET_OPTIONS.map(o => o.value)).toEqual([...PRESET_IDS.filter(id => !isHiddenPreset(id)), 'custom']);
    for (const base of ['satellite', 'parchment'] as const) {
      const full = presetComposition(base),
        light = presetComposition(`${base}-light`);
      expect(() => validateComposition(light)).not.toThrow();
      expect(light).toEqual({ ...full, preset: `${base}-light`, quality: 'light' });
      expect(compositionMessages[PRESET_OPTIONS.find(o => o.value === `${base}-light`)!.label].fr).toContain('Rapide');
      const customized = { ...full, effects: { ...full.effects, season: 0.8 } };
      expect(withCompositionQuality(withCompositionQuality(customized, 'light'), 'full')).toEqual(customized);
      const appearance = { style: 'parchment' as const, composition: light };
      const live = resolveAppearance(appearance, { mapStyle: 'parchment' }, { nativeCities: true }, 'view2d');
      expect(live.quality).toBe('light');
      expect(resolveAppearance(appearance, { mapStyle: 'parchment' }, { nativeCities: true }, 'export').quality).toBe('full');
      try {
        setDisplayQualityPreference('full');
        setDisplayAppearanceQuality(live.quality);
        expect([displayQualityUniform(true), displayQualityUniform(false)]).toEqual([1, 0]);
      } finally {
        setDisplayAppearanceQuality('full');
        setDisplayQualityPreference('auto');
      }
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
    let recipe = presetComposition('satellite');
    recipe.effects.season = 0.8;
    const original = structuredClone(recipe);
    const unlisten = quality.onDisplayQualityChange(change => {
      if (change.reason === 'auto') {
        recipe = withCompositionQuality(recipe, 'light');
        quality.setDisplayAppearanceQuality(recipe.quality!);
      }
    });
    try {
      quality.initializeDisplayQuality();
      for (let time = 1000; time <= 2100; time += 50) {
        quality.noteDisplayNavigation(time);
        quality.noteDisplayFrame(time);
      }
      expect(recipe).toEqual({ ...original, preset: 'satellite-light', quality: 'light' });
      expect([quality.displayQualityFor(true), quality.displayQualityFor(false)]).toEqual(['light', 'full']);
      recipe = withCompositionQuality(recipe, 'full');
      quality.setDisplayAppearanceQuality('full');
      quality.setDisplayQualityPreference('full');
      expect(recipe).toEqual(original);
      expect(stored.get(quality.DISPLAY_QUALITY_STORAGE_KEY)).toBe('full');
      quality.noteDisplayFrame(2200);
      expect(quality.getDisplayQuality()).toBe('full');
    } finally {
      unlisten();
      quality.setDisplayQualityPreference('full');
      vi.unstubAllGlobals();
    }
  });
  it('keeps the URL quality override above the selected preset and captures above both', async () => {
    for (const override of ['full', 'light'] as const) {
      vi.resetModules();
      vi.stubGlobal('location', { search: `?quality=${override}` });
      const quality = await import('../../src/render/displayQuality');
      try {
        quality.setDisplayAppearanceQuality(override === 'full' ? 'light' : 'full');
        expect([quality.displayQualityFor(true), quality.displayQualityFor(false)]).toEqual([override, 'full']);
      } finally {
        vi.unstubAllGlobals();
      }
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
      expect(v2.layout.zoneDensity).toBe('phases');
      expect(v2.parcels).toEqual(benchParcels);
      // The bench panel sends parcel_fit explicitly, the V2 leaves it to the engine; both mean the same.
      expect(parcelFitOf(v2.houses)).toBe(CITY_DEFAULT_PARCEL_FIT);
      expect(v2.houses.culture).toBeUndefined();
    });
  }

  it('sends the same requested building counts to the programme on both pages', () => {
    const current = settings('counts');
    const programme = { counts: { 'worship.parish': 4, 'defence.keep': 0, 'Bad key': 2, 'commerce.market': 99 }, countMode: 'force' };
    current.urban!.local = { a: { layout: { programme } as never } };
    const v2 = resolveRustUrbanControls(current, 'a', { culture: 'west', sprawl: 1, walls: 'auto', suburbs: 'auto', population: 3000 } as unknown as Options).layout;
    const style = applySettlementStyle('culture', normalizeLayoutConfig(defaultCityLayoutConfig()), 'west');
    const bench = normalizeLayoutConfig({ ...style.layout, programme: { ...style.layout.programme, ...programme } as never });
    expect(v2.programme).toEqual(bench.programme);
    expect(v2.programme.counts).toEqual({ 'commerce.market': 64, 'defence.keep': 0, 'worship.parish': 4 });
    expect(v2.programme.countMode).toBe('force');
    // The old castle, cathedral and palace options no longer reach the native layout.
    const old = resolveRustUrbanControls(settings('counts'), 'a', { culture: 'west', castle: 'yes', cathedral: 'yes', palace: 'yes' } as unknown as Options).layout;
    expect(old.monument).toBe(defaultLayoutConfig().monument);
  });
  it('sends the same regional roads and site archetype to the town generator on both pages', () => {
    const road = {
      a: 0,
      b: 1,
      class: 'highway',
      surface: 'paved',
      width: 8,
      length: 300,
      path: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 200, y: 0 },
        { x: 300, y: 0 },
      ],
      crossings: [
        {
          kind: 'bridge',
          path: [
            { x: 120, y: 0 },
            { x: 180, y: 0 },
          ],
        },
      ],
    };
    const output = { segments: [road, { ...road, class: 'main', crossings: [] }] } as unknown as RoadOutput;
    const placed = { key: 'main', siteType: 'auto', archetype: 'bridge', center: { x: 0, y: 0 }, radius: 100 };
    const world = { roads: [{ path: road.path, width: 8, kind: 'major' }], settlements: [{ key: 'main', archetype: 'bridge' }], debug: { v2RustRegion: { placement: { settlements: [placed] }, roads: output } } } as unknown as World;
    const v2 = townRoadStreets(world),
      bench = regionalStreets(output);
    expect(v2).toEqual(bench);
    expect(v2.map(s => [s.rank, s.role])).toEqual([
      [0, 'regional'],
      [0, 'bridge'],
      [0, 'regional'],
      [1, 'regional'],
    ]);
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
    expect(read('../../src/v2/display/worldVolumes.ts')).toContain('cityRegionalStreets(r, townRoadStreets(world))');
  });

  it('carries manual foundations into both city consumers', () => {
    expect(cityFixedSites([{ key: 'main', fixed: true }, { key: 'auto' }])).toEqual(['main']);
    expect(
      cityFixedSites([
        { key: 'main', position: { x: 120, y: 340 } },
        { key: 'auto', position: null },
      ]),
    ).toEqual(['main']);
    expect(cityFixedSites([{ key: 'main', scores: { manual: true } }])).toEqual(['main']);
    const saved = { ...defaultLayoutConfig(), fixedSites: ['main'] };
    expect(normalizeLayoutConfig(saved).fixedSites).toEqual(['main']);
    expect(read('../../src/ui/terrainUrban.ts')).toContain('message.layoutConfig.fixedSites = cityFixedSites(selected);');
    expect(read('../../src/v2/rustUrban.ts')).toContain('fixedSites: cityFixedSites([place])');
  });

  it('draws every stage from the one general seed when no variation is set', () => {
    const s = settings('abc');
    for (const stage of ['composition', 'streets', 'parcels', 'programme', 'buildings', 'houses'] as const) expect(urbanSeed(s, 'a', stage)).toBe(urbanSeed(s, 'a'));
  });

  it('shares the architecture default, the raster resolution and the display defaults', () => {
    expect(DEFAULT_CITY_ARCHITECTURE).toBe('silhouette');
    const bench = read('../../src/ui/terrainUrban.ts'),
      v2 = read('../../src/v2/rustUrban.ts');
    expect(bench).toMatch(/let architectureMode: UrbanSceneMode = DEFAULT_CITY_ARCHITECTURE;/);
    expect(bench).toContain('CITY_DISPLAY_DEFAULTS');
    expect(bench).not.toMatch(/settlementRaster\([^)]*, 1024\)/);
    expect(CITY_RASTER_RESOLUTION).toBe(1024);
    expect(v2).toContain('cityArchitectureOf');
    expect(CITY_DISPLAY_DEFAULTS.view).toBe('buildings');
    expect(CITY_DISPLAY_DEFAULTS.palette).toBe('parchment');
  });

  it('shares the hillside ground choices (levelled lots, built terraces) and their defaults on both pages', () => {
    expect(CITY_DISPLAY_DEFAULTS.groundShaping).toBe(true);
    expect(CITY_DISPLAY_DEFAULTS.terraces).toBe(true);
    const view3d = (city?: AppearanceInput['city']) => resolveAppearance({ style: 'parchment', city }, { mapStyle: 'parchment' }, { nativeCities: true }, 'view3d').city;
    expect([view3d().groundShaping, view3d().terraces]).toEqual([true, true]);
    const off = view3d({ groundShaping: false, terraces: false });
    expect([off.groundShaping, off.terraces]).toEqual([false, false]);
    // One Advanced field each, from the shared field list both pages' panels are built from, with its French label.
    for (const path of ['city.groundShaping', 'city.terraces']) {
      const field = renderControlFields.find(f => f.path === `appearance.${path}`);
      expect(field?.type).toBe('boolean');
      expect(compositionMessages[field!.label]?.fr).toBeTruthy();
      expect(RENDER_SECTION_FIELDS.relief).toContain(path);
    }
    // City Bench's 3D view and the V2's tilted map read the choices from the same appearance, and seat every structure on
    // the shaped ground (groundAt).
    const bench = read('../../src/ui/citybench.ts'),
      v2 = read('../../src/v2/display/worldVolumes.ts'),
      buildings = read('../../src/ui/view3d/cityBuildings.ts'),
      ground = read('../../src/ui/view3d/cityGround.ts');
    expect(bench).toContain('groundShaping: r.city.groundShaping,');
    expect(bench).toContain('terraces: r.city.terraces,');
    expect(bench).toContain("'groundShaping', 'terraces'] as const) setBenchAppearanceField");
    expect(v2).toContain('const levelled = r.city.groundShaping && !r.underdark,');
    expect(v2).toContain('city3dBuildingsSteps(source, { heightAt, ground, terraces: r.city.terraces }');
    expect(v2).toContain('heights.groundAt(x, y)');
    expect(buildings).toContain('t.setGroundShape(');
    expect(buildings).toContain('terraces: cityContext.builtTerraces');
    expect(ground).toContain('city3dSurfaceSamplers(d.raster, (x, y) => t.groundAt(x, y))');
  });

  it('builds the same silhouette scene on both paths', () => {
    const ring = (x: number, y: number, s: number) => [
      { x, y },
      { x: x + s, y },
      { x: x + s, y: y + s },
      { x, y: y + s },
    ];
    const base = { culture: { pack: 'EUR-MED', mode: 'historical_inspired' }, terrain: { ground_z_m: 3 }, accesses: [] };
    const requests = [
      { ...base, id: 'h1', parcel_id: 'p1', function: 'residential', buildable: [{ outer: ring(0, 0, 10), holes: [] }] },
      { ...base, id: 'o1', parcel_id: 'p2', function: 'open_space', buildable: [{ outer: ring(20, 0, 8), holes: [] }] },
      { ...base, id: 'm1', parcel_id: 'p3', function: 'open_space', buildable: [{ outer: ring(40, 0, 8), holes: [] }], preview: [{ outer: ring(41, 1, 5), holes: [] }], programme: { households: 2, massing: {} } },
    ] as unknown as CityPlacementRequest[];
    const v2 = silhouetteScene(requests),
      bench = siteVisualScene(requests.map(projectUrbanSite));
    expect(v2).toEqual(bench);
    expect(v2.buildings.map(b => b.id)).toEqual(['h1', 'm1']);
    expect(v2.open_spaces.map(o => o.id)).toEqual(['o1']);
    // Both pages import the same scene builder.
    expect(read('../../src/v2/rustUrban.ts')).toContain("from '../ui/urbanSilhouettes'");
    expect(read('../../src/ui/urbanSceneWorker.ts')).toContain("from './urbanSilhouettes'");
  });

  it('resolves each map look’s roads and water once for 2D, 3D and both pages', () => {
    for (const style of PRESET_IDS) {
      const c = presetComposition(style),
        satellite = style.startsWith('satellite'),
        roadLook = satellite ? 'rendered' : style.startsWith('parchment') ? 'wash' : 'ink',
        retained = { ...c, preset: 'custom' as const, networks: { roads: { ...c.networks.roads, visible: false, look: 'natural', surface: 'plan' }, water: { ...c.networks.water, visible: false, look: 'wash' } } };
      expect(() => validateComposition(retained)).not.toThrow();
      for (const target of ['view2d', 'view3d', 'export'] as const) {
        const r = resolveAppearance({ style: 'parchment', composition: retained }, { mapStyle: 'parchment' }, { nativeCities: true }, target);
        expect(r.composition.networks.roads, `${style} ${target}`).toMatchObject({ look: roadLook, visible: false });
        expect(r.composition.networks.water, `${style} ${target}`).toMatchObject({ look: satellite ? 'natural' : 'ink', visible: true });
        expect(r.ground.layers.water).toBe(true);
        const frame = { viewport: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, mpp: 1, dpr: 1 };
        expect(cityDrawOptions({ appearance: r, city: r.city, frame, lod: 'near', layers: r.city.layers, labelsAllowed: true, buildingAppearance: cityBuildingAppearance(r), page: { buildingsVisible: true } }).roadLook).toBe(r.composition.networks.roads.look);
        expect(city3dPlanOptions(r).roadLook).toBe(r.composition.networks.roads.look);
      }
    }
    // Both hosts bind their retained terrain and select the same soil for the rendered road painter.
    expect(read('../../src/render/roadStyle.ts')).toContain('roadSoilOf(zone, biome)');
    for (const file of ['../../src/v2/display/appearance.ts', '../../src/ui/citybench.ts']) {
      expect(read(file)).toContain('mapRoadTones(r,');
      expect(read(file)).toContain('setRoadGround(');
    }
    expect(read('../../src/ui/terrainRoads.ts')).toContain('strokeNaturalRoad(ctx');
    expect(read('../../src/render/cartography/roads.ts')).toContain('strokeNaturalRoad(ctx');
  });

  it('gives the same drawCity options to both pages for one resolved appearance', () => {
    for (const style of ['parchment', 'parchment-light', 'satellite', 'satellite-light'] as const) {
      const r = resolveAppearance({ style: 'parchment', composition: presetComposition(style) }, { mapStyle: 'parchment' }, { nativeCities: true }, 'view2d');
      const frame = { viewport: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, mpp: 1, dpr: 1 };
      const v2 = cityDrawOptions({ appearance: r, city: r.city, frame, lod: 'near', layers: r.city.layers, labelsAllowed: true, buildingAppearance: cityBuildingAppearance(r), page: { buildingsVisible: true } });
      const bench = cityDrawOptions({
        appearance: r,
        city: { ...r.city },
        view: r.city.view,
        frame: { ...frame },
        lod: 'near',
        layers: { ...r.city.layers },
        labelsAllowed: true,
        buildingAppearance: cityBuildingAppearance(r, { nightInk: undefined }),
        page: { buildingsVisible: true },
      });
      const { beforeBuildings: benchBefore, ...benchOptions } = bench,
        { beforeBuildings: v2Before, ...v2Options } = v2;
      expect(benchOptions).toEqual(v2Options);
      expect(benchBefore).toBeTypeOf('function');
      expect(v2Before).toBeTypeOf('function');
      expect(v2.colors).toBe(v2.appearance.colors);
      expect(v2.groundBlend).toBe(r.city.groundBlend === 'blended');
      expect(v2.roadEmphasis).toBe(r.composition.networks.roads.emphasis);
    }
  });

  it('uses the same unoutlined roof appearance for volume recipes in plan, tilt and export', () => {
    for (const style of ['satellite', 'satellite-light', 'satellite-2', 'parchment', 'atlas', 'cadastre', 'topographic', 'white', 'minimal'] as const) {
      const smooth = !['cadastre', 'topographic', 'white', 'minimal'].includes(style);
      for (const target of ['view2d', 'view3d', 'export'] as const) {
        const r = resolveAppearance({ style: 'parchment', composition: presetComposition(style) }, { mapStyle: 'parchment' }, { nativeCities: true }, target);
        expect(cityBuildingAppearance(r).smoothRoofs, `${style} ${target}`).toBe(smooth);
      }
    }
  });

  it('shares the roof choice across map and 3D hosts and invalidates the city appearance', () => {
    expect(ROOF_MODES).toContain('crafted');
    for (const target of ['view2d', 'view3d', 'export'] as const) {
      const keys = new Set<string>();
      for (const roof of ROOF_MODES) {
        const composition = presetComposition('satellite');
        composition.buildings.roof = roof;
        const r = resolveAppearance({ style: 'parchment', composition }, { mapStyle: 'parchment' }, { nativeCities: true }, target);
        expect(cityBuildingAppearance(r).roof).toBe(roof);
        expect(volumeTownBuildings(r), `${roof} keeps GPU volume ownership`).toBe(true);
        expect(cityBuildingAppearance(r).smoothRoofs).toBe(roof !== 'v1');
        expect(city3dPlanOptions(r).appearance.roof).toBe(roof);
        keys.add(r.keys.city);
      }
      expect(keys.size).toBe(ROOF_MODES.length);
    }
  });

  it('keeps fallback farm and placeholder roofs synchronized with the live roof choice', () => {
    const appearance = (roof: (typeof ROOF_MODES)[number]) => {
      const composition = presetComposition('satellite');
      composition.buildings.roof = roof;
      return resolveAppearance({ style: 'parchment', composition }, { mapStyle: 'parchment' }, { nativeCities: true }, 'view2d');
    };
    let current = appearance('v2');
    const countryside = cityCountrysideCanvasOptions(current, 4000, () => current);
    for (const roof of ROOF_MODES) {
      current = appearance(roof);
      expect(countryside.buildingRoofs()).toEqual({ roof, smoothRoofs: roof !== 'v1' });
    }
  });

  it('stands lot fences with the buildings, not with the parcel diagram, in 2D and 3D', () => {
    for (const style of PRESET_IDS)
      for (const target of ['view2d', 'view3d'] as const) {
        const r = resolveAppearance({ style: 'parchment', composition: presetComposition(style) }, { mapStyle: 'parchment' }, { nativeCities: true }, target);
        const fences = r.composition.recipe.ground.look !== 'atlas' && r.composition.recipe.ground.look !== 'white' && r.composition.buildings.visible;
        expect(r.city.layers.lotEnclosures, `${style} ${target}`).toBe(fences);
        expect(city3dPlanOptions(r).layers.lotEnclosures, `${style} ${target} 3D`).toBe(fences);
      }
    const hidden = presetComposition('parchment');
    hidden.buildings.visible = false;
    expect(resolveAppearance({ style: 'parchment', composition: hidden }, { mapStyle: 'parchment' }, { nativeCities: true }, 'view2d').city.layers.lotEnclosures).toBe(false);
    // Both draw paths gate the fences on lotEnclosures alone (parcelOverlay is the parcel diagram).
    expect(read('../../src/render/city/canvas/town.ts')).toContain('if (layers.lotEnclosures !== false) drawLotEnclosures(');
    expect(read('../../src/ui/view3d/cityBuildings.ts')).toContain('yardsShown = !flat && yardLayers?.lotEnclosures !== false;');
  });

  it('keeps Satellite towns free of abstract plan graphics even with retained plan overrides', () => {
    for (const style of ['satellite', 'satellite-light', 'satellite-2'] as const)
      for (const target of ['view2d', 'view3d', 'export'] as const) {
        const base = presetComposition(style);
        const composition = { ...base, buildings: { ...base.buildings, parcels: true, blocks: true, districts: true } };
        const r = resolveAppearance({ style: 'parchment', composition, city: { plan: true, layers: { fronts: true, domains: true } } }, { mapStyle: 'parchment' }, { nativeCities: true }, target);
        const on = resolveAppearance({ style: 'parchment', composition }, { mapStyle: 'parchment' }, { nativeCities: true }, target);
        // Abstract plan graphics off: outlines (planLines), block and lot washes, quarters, domains, tints, diagrams.
        for (const layer of URBAN_PLAN_LAYERS) expect(r.city.layers[layer], `${style} ${target} ${layer}`).toBe(false);
        // Real objects unchanged: streets, walls, fences/hedges/gates with their yards, gardens and squares as ground, waterways.
        for (const layer of URBAN_PHYSICAL_LAYERS) expect(r.city.layers[layer], `${style} ${target} ${layer}`).toBe(on.city.layers[layer]);
        expect(r.city.layers, `${style} ${target}`).toMatchObject({ planLines: false, streets: true, enclosures: true, lotEnclosures: true });
        // The map overlay's dashed site reserve outline follows the same policy.
        expect(cityCountrysideCanvasOptions(r, 4000).urbanPlan(), `${style} ${target}`).toBe(false);
        expect(r.keys.cartography, `${style} ${target}`).toBe(on.keys.cartography);
        expect(city3dPlanOptions(r).layers.streets, `${target} 3D`).toBe(true);
        expect(cityBuildingAppearance(r), `${style} ${target}`).toEqual(cityBuildingAppearance(resolveAppearance({ style: 'parchment', composition }, { mapStyle: 'parchment' }, { nativeCities: true }, target)));
      }
    // No page gates streets, regional roads or a whole plan scene on the abstract plan policy.
    expect(read('../../src/v2/nativeCityMap.ts')).not.toMatch(/city\.plan \?/);
    const city3d = read('../../src/ui/view3d/cityDrape.ts');
    expect(city3d).not.toMatch(/planOverlay && !tile\.preview|planOverlay \? cityPlan\(\)/);
    expect(city3d).toContain('withoutUrbanPlan(requestedLayers)');
    expect(read('../../src/ui/terrainUrban.ts')).toContain('withoutUrbanPlan(cityLook().layers)');
    expect(read('../../src/render/cartography/structures.ts')).toContain('c.world.site && deps.urbanPlan?.() !== false) drawSiteMarker(');
    expect(read('../../src/v2/display/cartographyProducts.ts')).toContain('urbanPlan: () => !!this.map.resolved && cityOverlayPlanMarks(this.map.resolved),');
    // Dashed refused-lot outlines are plan lines in both draw paths.
    expect(read('../../src/render/city/canvas/town.ts')).toContain('layers.planLines !== false && o.refusedParcels?.size');
    expect(read('../../src/render/city/gl/styleTables.ts')).toContain("layers.planLines !== false && atLeast(lod, 'near') && s.refusedParcels?.size");
  });

  it('shows the town plan switches as city layers on both pages, without touching roads or houses', () => {
    // Both pages mount the switches from the shared buildings rows and resolve them with the shared resolver.
    expect(RENDER_COMPOSITION_ROWS.buildings).toEqual(expect.arrayContaining(['composition.buildings.districts', 'composition.buildings.blocks', 'composition.buildings.parcels']));
    expect(read('../../src/ui/benchRenderSettings.ts')).toContain('mountCompositionSection(level, key, mountIn, text)');
    const base = presetComposition('parchment'),
      at = (buildings: object) => resolveAppearance({ style: 'parchment', composition: { ...base, buildings: { ...base.buildings, ...buildings } } }, { mapStyle: 'parchment' }, { nativeCities: true }, 'view2d');
    const plain = at({});
    expect(plain.city.layers).toMatchObject({ quarters: false, blocks: true, parcels: false, parcelOverlay: false });
    const inspected = at({ districts: true, blocks: false, parcels: true, visible: false });
    expect(inspected.city.layers).toMatchObject({ quarters: true, blocks: false, parcels: true, parcelOverlay: true, streets: true });
    expect(inspected.composition.buildings).toMatchObject({ districts: true, blocks: false, parcels: true, visible: false });
    expect(inspected.keys.roads).toBe(plain.keys.roads);
    // Plan-less grounds offer no switch; Minimal has no lots.
    for (const look of ['satellite', 'satellite-2', 'atlas'] as const) expect(townPlanSwitches(look), look).toEqual([]);
    expect(townPlanSwitches('minimal')).toEqual(['districts', 'blocks']);
  });

  it('builds the drawCity options of both pages with the shared function only', () => {
    const bench = read('../../src/ui/terrainUrban.ts'),
      v2 = read('../../src/v2/nativeCityMap.ts');
    for (const page of [bench, v2]) {
      expect(page).toContain('cityDrawOptions({');
      expect(page).toContain('cityBuildingAppearance(');
    }
    // The 3D ground tile (drawGround) is a separate, footprint-only call.
    expect(bench).toMatch(/drawCity\(\s*ctx,\s*cityPlan,\s*cityDrawOptions\(/);
    // The V2 paints at once (drawCity) or, for its live town layer, in steps (drawCitySteps): one set of options for both.
    expect(v2).toContain('const options = cityDrawOptions({');
    expect(v2).toContain('drawCity(ctx, entry.plan, options)');
    expect(v2).toContain('drawCitySteps(ctx, entry.plan, options)');
  });

  it('passes the coastal swell option of the resolved water to the ground renderer on both pages', () => {
    expect(read('../../src/v2/display/groundProducts.ts')).toContain('coastWaves: r.composition.networks.water.waves');
    expect(read('../../src/ui/citybench.ts')).toContain('coastWaves: c.networks.water.waves');
  });

  it('passes the crown detail option of the resolved vegetation to the ground renderer on both pages', () => {
    expect(read('../../src/v2/display/groundProducts.ts')).toContain('crownDetail: r.composition.vegetation.crownDetail');
    expect(read('../../src/ui/citybench.ts')).toContain('crownDetail: c.vegetation.crownDetail');
  });

  it('resolves the crown detail to off by default, keeps it across presets, and keeps the three values', () => {
    expect(DEFAULT_CROWN_DETAIL).toBe('plain');
    const caps = { nativeCities: true, parcels: true, ruralLanduse: true, urbanLanduse: true, buildings: true };
    for (const preset of ['satellite', 'parchment', 'satellite-light'] as const) {
      const recipe = presetComposition(preset);
      expect(recipe.vegetation.crownDetail).toBeUndefined();
      expect(resolveComposition(recipe, styleTraits(recipe.ground.variant), 'view2d', caps).vegetation.crownDetail).toBe('plain');
    }
    for (const crownDetail of ['plain', 'clumps', 'clumps-fine'] as const) {
      const chosen = { ...presetComposition('satellite'), vegetation: { ...presetComposition('satellite').vegetation, crownDetail } };
      expect(resolveComposition(chosen, styleTraits(chosen.ground.variant), 'view2d', caps).vegetation.crownDetail).toBe(crownDetail);
    }
    // Painted brushes take the shared sampler: no clumps under them.
    expect(crownClumpMode('clumps-fine', true)).toBe(0);
    expect([crownClumpMode('plain', false), crownClumpMode('clumps', false), crownClumpMode('clumps-fine', false), crownClumpMode(undefined, false)]).toEqual([0, 1, 2, 0]);
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
    expect(CITY_LAYOUT_DEFAULTS).toEqual({ naturalCampApproaches: true, streetFrontage: true, alignEnclosedGrid: true, hideUnusedQuarters: true, organicBranchVariation: 0.5, ribbonWidthVariation: 0.5 });
    const current = settings('review');
    current.urban!.layout = { streetFrontage: false, organicBranchVariation: 0 };
    const layout = resolveRustUrbanControls(current, 'a', { culture: 'west' } as Options).layout;
    expect(layout.streetFrontage).toBe(false);
    expect(layout.organicBranchVariation).toBe(0);
    expect(layout.naturalCampApproaches).toBe(true);
    expect(layout.ribbonWidthVariation).toBe(0.5);
    for (const file of ['../../src/v2/rustUrban.ts', '../../src/v2/urbanControls.ts', '../../src/ui/terrainUrban.ts']) expect(read(file)).toContain('defaultCityLayoutConfig as defaultLayoutConfig');
  });

  it('shares canopy/night finishing, native house LOD and the 3D ground-plan options', () => {
    const v2 = read('../../src/v2/nativeCityMap.ts'),
      bench = read('../../src/ui/terrainUrban.ts');
    for (const page of [v2, bench]) expect(page).toContain('finishCityFrame(ctx,');
    expect(v2).not.toContain('HOUSE_LOD');
    expect(read('../../src/ui/citybench.ts')).toContain('getPlanOptions: () => city3dPlanOptions(');
    expect(read('../../src/v2/display/worldVolumes.ts')).toContain('const plan = city3dPlanOptions(r)');
    const composition = presetComposition('parchment');
    composition.effects.ambience = 'night';
    const r = resolveAppearance({ style: 'parchment', composition, unifiedDefaults: true }, {} as never, { nativeCities: true }, 'view3d');
    const options = city3dPlanOptions(r);
    const hiddenRoads = { ...r, composition: { ...r.composition, networks: { ...r.composition.networks, roads: { ...r.composition.networks.roads, visible: false } } } };
    expect(cityRegionalStreets(hiddenRoads, [])).toBe(cityRegionalStreets(hiddenRoads, []));
    expect(options.night).toBe(true);
    expect(options.roadEmphasis).toBe(r.composition.networks.roads.emphasis);
    expect(cityBuildingAppearance(r).nightInk).toBe(true);
    expect(options.buildingsVisible).toBe(r.composition.buildings.visible && r.composition.buildings.meshes === 'none');
  });

  it('draws the Underdark ornaments from one shared derivation in 2D and 3D', () => {
    expect(read('../../src/render/cityDrawOptions.ts')).toContain('drawUnderdarkOrnaments(ctx, underdarkOrnaments(scene.layouts, buildings)');
    expect(read('../../src/ui/view3d/cityBuildings.ts')).toContain('city3dUnderdarkOrnaments(underdarkOrnaments(layouts, scene?.buildings)');
  });

  it('draws stepped streets as 3D flights over a plain ground strip on both pages', () => {
    expect(read('../../src/ui/citybench.ts')).toContain('mountCity3d(');
    expect(read('../../src/v2/display/worldVolumes.ts')).toContain('city3dStairs(layouts, heightAt, street => stairStreetColor(street, stairPaint))');
    expect(read('../../src/ui/view3d/cityBuildings.ts')).toContain('city3dStairs(layouts ?? [], cityContext.heightAt, street => stairStreetColor(street, stairPaint))');
    expect(read('../../src/ui/view3d/cityDrape.ts').match(/stairMeshes: ?true/g)).toHaveLength(2);
  });

  it('keeps the massing and its 3D facade windows on the shared silhouette path', () => {
    const outer = [
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 12, y: 8 },
      { x: 0, y: 8 },
    ];
    const request = {
      id: 'house',
      parcel_id: 'lot',
      function: 'domestic',
      culture: { culture: 'west', pack: 'EUR-MED', mode: 'historical_inspired' },
      terrain: { ground_z_m: 0 },
      accesses: [],
      preview: [{ outer, holes: [] }],
      buildable: [{ outer, holes: [] }],
      programme: { households: 3, massing: [{ floors: 2, eave_m: 6, rise_m: 2, roof: 'gable', ridges: [[0, 4, 12, 4]], cover: 'tile', wall: 'brick' }] },
    } as unknown as CityPlacementRequest;
    const v2 = silhouetteScene([request]),
      bench = siteVisualScene([projectUrbanSite(request, 0)]);
    expect(city3dScene(v2)).toEqual(city3dScene(bench));
    expect(
      city3dScene(v2)
        .buildings[0].volumes.flatMap(v => v.roof_mesh.faces)
        .filter(f => f.material.includes('wall:opening')).length,
    ).toBeGreaterThan(1);
  });

  it('seats hillside pieces on their own ground and draws their terrace alike on both pages', () => {
    const rect = (x0: number, y0: number, x1: number, y1: number) => [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ];
    const home = rect(20, 0, 30, 10),
      barn = rect(0, 0, 8, 8),
      heightAt = (x: number): number => 50 + 0.3 * x;
    const piece = (footing?: object) => ({ floors: 1, eave_m: 3, rise_m: 2, roof: 'hip', ridges: [], cover: 'slate', wall: 'stone', ...(footing ? { footing } : {}) });
    const terrace = {
      way: 'terrace',
      base_z_m: 59,
      low_z_m: 56,
      drop_m: 3,
      terrace: {
        ring: [
          [18.5, 0],
          [30, 0],
          [30, 10],
          [18.5, 10],
        ],
        wall_m: 3.45,
      },
    };
    const preview = [
      { outer: home, holes: [] },
      { outer: barn, holes: [] },
    ];
    const request = { id: 'farm', parcel_id: 'lot', function: 'domestic', culture: { culture: 'inca' }, terrain: { ground_z_m: 0 }, accesses: [], preview, buildable: preview, programme: { massing: [piece(terrace), piece()] } } as unknown as CityPlacementRequest;
    const v2 = city3dScene(silhouetteScene([request]), { heightAt });
    expect(v2).toEqual(city3dScene(siteVisualScene([projectUrbanSite(request, 0)]), { heightAt }));
    const b = v2.buildings[0];
    expect(b.volumes.map(v => v.z_m)).toEqual([heightAt(20) + CITY3D_PLINTH_M, heightAt(0) + CITY3D_PLINTH_M]);
    expect(b.structural_foundations?.map(f => f.z_max_m)).toEqual([heightAt(20) + CITY3D_PLINTH_M]);
  });

  it('replaces the compact roof once and tiles a concave native pan without crossing its notch', () => {
    const outer = [
      [8, 0],
      [8, 2],
      [2, 2],
      [2, 8],
      [0, 8],
      [0, 0],
    ].map(([x, y]) => ({ x, y }));
    const request = {
      id: 'concave',
      parcel_id: 'lot',
      function: 'domestic',
      culture: { culture: 'european-organic' },
      terrain: { ground_z_m: 0 },
      accesses: [],
      preview: [{ outer, holes: [] }],
      buildable: [{ outer, holes: [] }],
      programme: { massing: [{ floors: 1, eave_m: 3, rise_m: 2, roof: 'hip', ridges: [], cover: 'tile', wall: 'brick' }] },
    } as unknown as CityPlacementRequest;
    const source = silhouetteScene([request]),
      compact = city3dScene(source).buildings[0],
      volume = compact.volumes[0];
    const detail = {
      ...compact,
      recipe_id: 'native',
      volumes: [{ ...volume, roof_mesh: { vertices: outer.map(p => ({ ...p, z: 3 + 0.2 * p.x })), faces: [{ vertices: outer.map((_, i) => i), normal: [-0.2, 0, 1] as [number, number, number], material: volume.materials.cladding, kind: 'pan' as const }] } }],
    };
    const scene = city3dScene(source, { details: new Map([[detail.id, detail]]) });
    expect(scene.buildings).toEqual([detail]);
    expect(scene.kinds).toEqual({ silhouette: 0, compact: 0, detailed: 1 });
    for (const overview of [false, true]) {
      const roofs: BuildingTriangle[] = [];
      eachBuildingTriangle(
        detail,
        t => {
          if (t.surface === 'roof') roofs.push(t);
        },
        overview,
      );
      const area = roofs.reduce((s, { points: [a, b, c] }) => s + Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2, 0);
      expect(area).toBeCloseTo(28, 8);
      expect(roofs.every(t => buildingRayDistance([4, 4, 100], [0, 0, -1], t.points) === null)).toBe(true);
    }
  });

  it('keeps a shallow oppidum roof on the wall top through its overhang', () => {
    const ring = Array.from({ length: 16 }, (_, i) => [4 * Math.cos((i * Math.PI) / 8), 4 * Math.sin((i * Math.PI) / 8)]);
    const outer = ring.map(([x, y]) => ({ x, y }));
    const request = {
      id: 'roundhouse',
      parcel_id: 'lot',
      function: 'domestic',
      culture: { culture: 'celtic-oppidum' },
      terrain: { ground_z_m: 0 },
      accesses: [],
      preview: [{ outer, holes: [] }],
      buildable: [{ outer, holes: [] }],
      programme: { massing: [{ floors: 1, eave_m: 2.2, rise_m: 0.3, roof: 'cone', ridges: [], cover: 'thatch', wall: 'wattle', volumes: [{ ring, eave_m: 2.2, rise_m: 0.3, roof: 'cone', ridges: [], overhang_m: 0.65 }] }] },
    } as unknown as CityPlacementRequest;
    const source = silhouetteScene([request]),
      b = city3dScene(source).buildings[0],
      v = b.volumes[0];
    expect(city3dScene(siteVisualScene([projectUrbanSite(request, 0)]))).toEqual(city3dScene(source));
    const cover = v.roof_mesh.faces.filter(f => f.material.includes('cover:'));
    expect(Math.min(...cover.flatMap(f => f.vertices.map(i => v.roof_mesh.vertices[i].z)))).toBeCloseTo(v.z_m + v.wall_height_m, 8);
    for (const p of outer)
      expect(
        cover.some(f =>
          f.vertices.some(i => {
            const q = v.roof_mesh.vertices[i];
            return Math.hypot(p.x - q.x, p.y - q.y) < 1e-8 && Math.abs(q.z - 2.2) < 1e-8;
          }),
        ),
      ).toBe(true);
    expect(Math.max(...v.roof_mesh.vertices.map(p => Math.hypot(p.x, p.y)))).toBeGreaterThan(4.5);
  });

  it('raises stepped terrace rings and keeps exactly one roof above each tier', () => {
    const square = (r: number) =>
      [
        [-r, -r],
        [r, -r],
        [r, r],
        [-r, r],
      ].map(([x, y]) => ({ x, y }));
    const preview = [12, 9, 6].map(r => ({ outer: square(r), holes: [square(r - 3).reverse()] }));
    preview.push({ outer: square(3), holes: [] });
    const request = {
      id: 'pyramid',
      parcel_id: 'lot',
      function: 'religious',
      culture: { culture: 'maya' },
      terrain: { ground_z_m: 0 },
      accesses: [],
      preview,
      buildable: preview,
      programme: { landmark: true, role: 'worship.pyramid-precinct', massing: preview.map((_, i) => ({ floors: 1, eave_m: (i + 1) * 3, rise_m: 0, roof: 'flat', ridges: [], cover: 'stone', wall: 'stone', openings: 'none' })) },
    } as unknown as CityPlacementRequest;
    const source = silhouetteScene([request]),
      b = city3dScene(source).buildings[0];
    expect(city3dScene(siteVisualScene([projectUrbanSite(request, 0)]))).toEqual(city3dScene(source));
    for (const overview of [false, true]) {
      const roofs: BuildingTriangle[] = [];
      eachBuildingTriangle(
        b,
        t => {
          if (t.surface === 'roof') roofs.push(t);
        },
        overview,
      );
      for (const [x, height] of [
        [10.3, 3],
        [7.3, 6],
        [4.3, 9],
        [1.3, 12],
      ]) {
        const hits = roofs.map(t => buildingRayDistance([x, 0.7, 100], [0, 0, -1], t.points)).filter(d => d !== null);
        expect(hits).toHaveLength(1);
        expect(hits[0]).toBeCloseTo(100 - height, 8);
      }
    }
  });

  it('draws explicit roof pans exactly as sent, in plan and in 3D, on both pages', () => {
    const outer = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 6 },
        { x: 0, y: 6 },
      ],
      shape = { outer, holes: [] },
      ring = outer.map(p => [p.x, p.y]);
    // Gambrel: four pans whose eaves run 0.4 m outside the walls, one gable end on each short wall.
    const pans = [
      [-0.4, -0.4, 3.8, 10.4, -0.4, 3.8, 10.4, 1.5, 5.5, -0.4, 1.5, 5.5],
      [-0.4, 1.5, 5.5, 10.4, 1.5, 5.5, 10.4, 3, 6.2, -0.4, 3, 6.2],
      [-0.4, 3, 6.2, 10.4, 3, 6.2, 10.4, 4.5, 5.5, -0.4, 4.5, 5.5],
      [-0.4, 4.5, 5.5, 10.4, 4.5, 5.5, 10.4, 6.4, 3.8, -0.4, 6.4, 3.8],
    ];
    const gables = [
      [0, 0, 4, 0, 6, 4, 0, 3, 6.2],
      [10, 0, 4, 10, 6, 4, 10, 3, 6.2],
    ];
    const piece = (volume: Record<string, unknown>): MassingPiece =>
      ({ floors: 2, eave_m: 4, rise_m: 2.2, roof: 'gable', ridges: [[0, 3, 10, 3]], cover: 'tile', wall: 'brick', volumes: [{ ring, floors: 2, eave_m: 4, rise_m: 2.2, roof: 'gable', roof_form: 'gambrel', ridges: [[0, 3, 10, 3]], ...volume }] }) as unknown as MassingPiece;
    const flat = (faces: { points: { x: number; y: number; z: number }[] }[]): number[][] => faces.map(f => f.points.flatMap(p => [p.x, p.y, p.z]));
    const massing = piece({ pans, gables }),
      [volume] = pieceVolumes(shape, massing);
    expect(volume.roof_form).toBe('gambrel');
    expect(flat(volumeRoof(volume, 0, 0))).toEqual(pans);
    expect(flat(planRoof([shape], [massing]))).toEqual(pans);
    // Horizontal pans stay plain faces (no slab rim, no clipping); an empty list is a hidden roof; malformed pans are ignored.
    const slab = [[0, 0, 4, 10, 0, 4, 10, 6, 4, 0, 6, 4]],
      level = planRoof([shape], [piece({ roof: 'flat', rise_m: 0, parapet_m: 0.9, pans: slab })]);
    expect(flat(level)).toEqual(slab);
    expect(level.some(f => f.flat)).toBe(false);
    expect(planRoof([shape], [piece({ pans: [] })])).toEqual([]);
    expect(planRoof([shape], [piece({ pans: [[0, 0, 4, 10, 0]] })])).toEqual(planRoof([shape], [piece({})]));
    // The ground shadow of a convex volume with pans is the plain sweep of its ring.
    const area = (s: { outer: { x: number; y: number }[] }): number =>
      Math.abs(
        s.outer.reduce((a, p, i) => {
          const n = s.outer[(i + 1) % s.outer.length];
          return a + p.x * n.y - n.x * p.y;
        }, 0),
      ) / 2;
    const [shadow] = pieceShadows(shape, massing);
    expect(area(shadow)).toBeCloseTo(area(pieceShadow(shape, 6.2)!), 8);
    const request = {
      id: 'gambrel',
      parcel_id: 'lot',
      function: 'domestic',
      culture: { culture: 'west', pack: 'EUR-MED', mode: 'historical_inspired' },
      terrain: { ground_z_m: 0 },
      accesses: [],
      preview: [shape],
      buildable: [shape],
      programme: { households: 2, massing: [massing] },
    } as unknown as CityPlacementRequest;
    const v2 = city3dScene(silhouetteScene([request])),
      bench = city3dScene(siteVisualScene([projectUrbanSite(request, 0)]));
    expect(v2).toEqual(bench);
    const mesh = v2.buildings[0].volumes[0].roof_mesh,
      points = (f: { vertices: number[] }): number[] => f.vertices.flatMap(i => [mesh.vertices[i].x, mesh.vertices[i].y, mesh.vertices[i].z]);
    expect(mesh.faces.filter(f => f.material.includes('cover:')).map(points)).toEqual(pans);
    const ends = mesh.faces.filter(f => f.kind === 'gable' && f.material.includes('wall:brick'));
    expect(ends.map(points)).toEqual(gables);
    expect(ends.map(f => Math.round(f.normal[0]))).toEqual([-1, 1]);
    expect(mesh.faces.filter(f => f.material.includes('wall:opening')).length).toBeGreaterThan(1);
  });

  it('starts raised walls at their base, paints them above their support and keeps small volumes plain', () => {
    const rect = (x0: number, y0: number, x1: number, y1: number): number[][] => [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
    const outer = rect(0, 0, 12, 8).map(([x, y]) => ({ x, y })),
      shape = { outer, holes: [] };
    // A lantern standing on the flat main roof (listed first), the main body, and a porch.
    const piece = (minor: boolean): MassingPiece =>
      ({
        floors: 2,
        eave_m: 6,
        rise_m: 0,
        roof: 'flat',
        ridges: [],
        cover: 'tile',
        wall: 'brick',
        volumes: [
          { ring: rect(3, 2, 9, 6), floors: 1, base_m: 6, eave_m: 9, rise_m: 1.5, roof: 'pyramid', ridges: [] },
          { ring: rect(0, 0, 12, 8), floors: 2, eave_m: 6, rise_m: 0, roof: 'flat', ridges: [] },
          { ring: rect(12, 2, 16, 6), floors: 1, eave_m: 2.5, rise_m: 0.5, roof: 'shed', ridges: [], ...(minor ? { minor: true } : {}), pans: [[12, 2, 3, 16, 2, 2.5, 16, 6, 2.5, 12, 6, 3]] },
        ],
      }) as unknown as MassingPiece;
    const scene = (minor: boolean) => {
      const request = {
        id: 'lantern',
        parcel_id: 'lot',
        function: 'domestic',
        culture: { culture: 'west', pack: 'EUR-MED', mode: 'historical_inspired' },
        terrain: { ground_z_m: 0 },
        accesses: [],
        preview: [shape],
        buildable: [shape],
        programme: { households: 2, massing: [piece(minor)] },
      } as unknown as CityPlacementRequest;
      const v2 = city3dScene(silhouetteScene([request]));
      expect(v2).toEqual(city3dScene(siteVisualScene([projectUrbanSite(request, 0)])));
      return v2.buildings[0];
    };
    const b = scene(true),
      [lantern, , porch] = b.volumes;
    const openings = (v: typeof lantern) => v.roof_mesh.faces.filter(f => /wall:(?:opening|lit)/.test(f.material));
    expect([lantern.z_m, lantern.wall_height_m, lantern.levels[0].z_m, lantern.levels[0].height_m]).toEqual([6, 3, 6, 3]);
    expect(lantern.foundation?.footprint).toEqual([]);
    expect(openings(lantern).length).toBeGreaterThan(0);
    expect(Math.min(...openings(lantern).flatMap(f => f.vertices.map(i => lantern.roof_mesh.vertices[i].z)))).toBeCloseTo(7, 8);
    expect(openings(porch)).toHaveLength(0);
    expect(openings(scene(false).volumes[2]).length).toBeGreaterThan(0);
    // The overview drops the porch; the detailed mesh (and picking, which shares it) keeps it.
    for (const overview of [false, true]) {
      const walls: BuildingTriangle[] = [],
        beside: BuildingTriangle[] = [];
      eachBuildingTriangle(
        b,
        t => {
          if (t.points.every(p => p[0] > 12.01)) beside.push(t);
          if (t.surface === 'wall' && t.points.every(p => p[0] >= 3 && p[0] <= 9 && p[1] >= 2 && p[1] <= 6)) walls.push(t);
        },
        overview,
      );
      expect(beside.length > 0).toBe(!overview);
      expect(Math.min(...walls.flatMap(t => t.points.map(p => p[2])))).toBe(6);
    }
    const faces = planRoof([shape], [piece(true)]);
    expect(Math.max(...faces.map((f, i) => (f.vol === 1 ? i : -1)))).toBeLessThan(faces.findIndex(f => f.vol === 0));
    expect(faces.filter(f => f.minor).map(f => f.vol)).toEqual([2]);
    expect(pieceShadows(shape, piece(true))).toHaveLength(2);
  });

  it('invalidates forest occupation with the city once, without a second city-pass upload', () => {
    const r = resolveAppearance({ style: 'render3d' as never, composition: presetComposition('satellite') }, {} as never, { nativeCities: true }, 'view2d');
    const input = { r, revisions: { terrain: 1, roads: 1, landuse: 1, settlements: 1, names: 1, cities: { a: 1 } }, layers: {}, mode: 'gpu' as const, effective: '', forestEffective: '', worldSig: '' };
    expect(passKeys({ ...input, revisions: { ...input.revisions, cities: { a: 2 } } }).forest).not.toBe(passKeys(input).forest);
    const town = read('../../src/v2/display/townProducts.ts');
    expect(town.slice(town.indexOf('async cityPass()'))).not.toContain('forestPass()');
    expect(read('../../src/ui/view3d/cityGround.ts')).toContain('options.getBackgroundImage?.()');
    const ground = read('../../src/v2/display/groundProducts.ts');
    expect(ground).toContain('patchBackgroundCapture(image,');
    expect(ground).toContain('this.backgroundImage ??= gpu.captureMap(1024)');
  });
});

describe('retained city environment parity', () => {
  it('shares Underdark lamps between 2D and 3D without changing the selected period or rebuilding the terrain', () => {
    for (const preset of ['satellite', 'parchment'] as const) {
      const resolve = (ambience: 'day' | 'night', target: 'view2d' | 'view3d') => {
        const composition = presetComposition(preset);
        composition.effects.ambience = ambience;
        return resolveAppearance({ style: 'parchment', composition }, { mapStyle: 'parchment' }, { nativeCities: true }, target, { biome: 'underdark' });
      };
      const on = resolve('day', 'view2d'),
        off = resolve('night', 'view2d');
      expect(on.composition.ambience).toBe('day');
      expect(off.composition.ambience).toBe('night');
      expect(on.ground.style).toBe(off.ground.style);
      for (const key of ['terrainBase', 'forest', 'cartography', 'water'] as const) expect(on.keys[key]).toBe(off.keys[key]);
      for (const ambience of ['day', 'night'] as const) {
        const building = cityBuildingAppearance(resolve(ambience, 'view2d'));
        expect(building.ambience).toBe('night');
        expect(building.lightsOn).toBe(ambience === 'day');
        expect(city3dPlanOptions(resolve(ambience, 'view3d')).appearance.lightsOn).toBe(building.lightsOn);
      }
    }
    for (const file of ['../../src/v2/display/groundProducts.ts', '../../src/v2/urban3d.ts', '../../src/ui/citybench.ts']) expect(read(file)).toContain('...underdarkSceneLook(');
  });

  it('keeps water independent from streets and retains the decor vectors', () => {
    const parchment = resolveAppearance({ style: 'parchment', composition: presetComposition('parchment') }, {} as never, { nativeCities: true }, 'view2d');
    expect(cityWaterCutsLand(parchment)).toBe(true);
    const layers = { ...CITY_DISPLAY_DEFAULTS.layers, streets: false, waterways: true };
    expect(cityGlOverlayLayers(layers).waterways).toBe(true);
    expect(cityGlOverlayLayers({ ...layers, streets: true, waterways: false }).waterways).toBe(false);
    expect(read('../../src/v2/decorTerrain.ts')).toContain('v2Decor: decor');
    expect(read('../../src/v2/display/waterProducts.ts')).toContain('decorWaterSvg(decor,');
    expect(read('../../src/ui/citybench.ts')).toContain('decorWater3d(decor,');
    expect(read('../../src/v2/display/waterProducts.ts')).toContain('retainedDecorOf(this.map.world!.terrain)');
  });

  it('shares countryside generation, physical forest inputs and vector layer ownership', () => {
    expect(read('../../src/v2/engine.ts')).toContain('await generateUrbanLanduse({');
    expect(read('../../src/ui/urbanLanduse.ts')).toContain('urbanLanduseData');
    for (const file of ['../../src/v2/displayForest.ts', '../../src/ui/citybench.ts']) {
      expect(read(file)).toContain('cityForestInput(');
      expect(read(file)).toContain('forestRetainedRiverSegments(');
    }
    // The V2 display: the cartography products own the overlay, the water products the cut of the land use.
    for (const source of [read('../../src/v2/display/cartographyProducts.ts') + read('../../src/v2/display/waterProducts.ts'), read('../../src/ui/urbanLanduse.ts')]) {
      expect(source).toContain('cityOverlayLandKinds(');
      expect(source).toContain('cityOverlayLandKey(');
      expect(source).toContain('cityWaterCutsLand(');
      expect(source).toContain('cityCountrysideCanvasOptions(');
    }
    for (const source of [read('../../src/v2/display/composedView.ts'), read('../../src/ui/urbanLanduse.ts')]) expect(source).toContain('liveLookPixelRatio(');
    expect(cityCountrysideTextureVisible('forest', 0.607)).toBe(true);
    expect(cityCountrysideTextureVisible('orchard', 0.767)).toBe(true);
    expect(cityCountrysideTextureVisible('field', 0.607)).toBe(false);
    expect(read('../../src/render/cartography/symbols.ts')).toContain('cityCountrysideTextureVisible(tl.kind, sc)');
    const height = { x: 0, y: 0, width: 100, n: 2, data: new Float32Array(4) },
      water = new Uint8Array(4);
    const source = cityForestInput('decor', { temperature: 12, precipitation: 800 }, height, water);
    expect(source.height).toBe(height);
    expect(source.water).toBe(water);
    expect(source.climate).toEqual([12, 800]);
    for (const preset of ['parchment', 'satellite', 'satellite-2'] as const) {
      const r = resolveAppearance({ style: 'parchment', composition: presetComposition(preset) }, {} as never, { nativeCities: true }, 'view2d');
      const draw = cityCountrysideCanvasOptions(r, 4000);
      expect(draw.raster).toBe(true);
      expect(draw.furrowReferenceSize).toBe(4000);
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
    const a = cityGroundSettings(r, 'parchment-render', source),
      b = cityGroundSettings(r, 'parchment-render', { ...source });
    expect(a).toEqual(b);
    expect(a?.paperMap).toBe(true);
    expect(a?.groundCover).toBe(r.composition.vegetation.procedural);
    expect(cityGroundSettings(r, 'map', source)).toBeUndefined();
  });

  it('clears canopy ground in the shared under-building hook before page painting', () => {
    const r = resolveAppearance({ style: 'parchment', composition: presetComposition('parchment') }, {} as never, { nativeCities: true }, 'view2d');
    const image = {} as HTMLCanvasElement,
      events: string[] = [];
    setCityCanopy(() => image);
    const ctx = {
      save() {},
      restore() {},
      drawImage() {
        events.push('clear');
      },
    } as unknown as CanvasRenderingContext2D;
    try {
      for (const page of ['v2', 'bench']) {
        const options = cityDrawOptions({
          appearance: r,
          city: r.city,
          frame: { viewport: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, mpp: 1, dpr: 1 },
          lod: 'near',
          layers: r.city.layers,
          labelsAllowed: true,
          buildingAppearance: cityBuildingAppearance(r),
          page: {
            buildingsVisible: true,
            beforeBuildings() {
              events.push(page);
            },
          },
        });
        options.beforeBuildings?.(ctx);
      }
      expect(events).toEqual(r.composition.vegetation.procedural ? ['clear', 'v2', 'clear', 'bench'] : ['v2', 'bench']);
    } finally {
      setCityCanopy(undefined);
    }
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
  it('shares grove seating and the instance templates between V2 and City Bench', () => {
    expect(read('../../src/v2/display/worldVolumes.ts')).toContain('city3dCanopySteps(cityCanopy(layouts, source?.buildings), heightAt)');
    expect(read('../../src/ui/view3d/cityBuildings.ts')).toContain('city3dCanopy(cityCanopy(layouts, canopySource), cityContext.heightAt)');
    expect(read('../../src/render/cityGrove.ts')).toContain('const steps = city3dCanopySteps(canopy, heightAt)');
  });
  it('draws the 3D sea of City Bench at the 2D coast (render/seaCover.ts)', async () => {
    const { paintSeaCover } = await import('../../src/render/seaCover');
    // A straight coast: height = x - 3.5 (cells), so the spline's zero line lies at x = 3.5, halfway between points 3 and 4.
    const n = 8,
      height = Array.from({ length: n * n }, (_, i) => (i % n) - 3.5),
      pixels = new Uint8ClampedArray(n * n * 4);
    paintSeaCover(pixels, height, [1, 2, 3, 255]);
    const alpha = Array.from({ length: n }, (_, x) => pixels[(4 * n + x) * 4 + 3]);
    // Full sea a cell inside, nothing a cell inland; the tile painter's 102/255 threshold falls on the zero line.
    expect(alpha.slice(0, 3)).toEqual([255, 255, 255]);
    expect(alpha.slice(5)).toEqual([0, 0, 0]);
    const edge = 3 + (alpha[3] - 102) / (alpha[3] - alpha[4]);
    expect(Math.abs(edge - 3.5)).toBeLessThan(0.02);
    expect([...pixels.subarray(4 * n * 4, 4 * n * 4 + 3)]).toEqual([1, 2, 3]);
    // The 2D land cover keeps the same zero line: refinement never turns spline land into sea or back.
    expect(read('../../src/ui/terrain/gl/shaders.ts')).toContain('s.x = shoreH > 0.0 ? max(s.x, min(shoreH, 0.05)) : min(s.x, shoreH);');
    // City Bench paints the sea of its 3D view from the decor heights; the V2's tilted map drapes the 2D ground itself.
    expect(read('../../src/ui/view3d/cityWater.ts')).toContain('paintSeaCover(');
  });
});

describe('street ends', () => {
  it('draws street ends from the joined streets of the shared scene on both 2D engines, square everywhere', () => {
    const canvas = read('../../src/render/city/canvas/town.ts'),
      gl = read('../../src/render/cityGlBuild.ts');
    expect(read('../../src/render/city/model/scene.ts')).toContain('joined: joined[si]');
    expect(canvas).toContain('linePath(s.joined.stroke)');
    expect(canvas).toContain('path: x.s.joined.path, widths: x.s.joined.pathWidths');
    expect(gl).toContain('putPolyline(w, s.joined.stroke');
    // The strokes of a street are decided by its look: none of them asks for a round cap.
    const look = read('../../src/render/city/streetLook.ts');
    expect(look.slice(look.indexOf('export function streetLook('))).not.toMatch(/add\(.*, 'round'[,)]/);
  });
});

describe('causeways are ordinary raised roads', () => {
  it('paints a causeway with the street paint of its rank on natural grounds and joins it to the street surface', () => {
    expect(STRUCTURE_ROLES.has('causeway')).toBe(false);
    expect(STRUCTURE_ROLES.has('bridge')).toBe(true);
    const path = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    const scene = {
      layouts: [],
      streets: [
        { role: 'causeway', rank: 1, street: { path } },
        { role: 'street', rank: 1, street: { path } },
        { role: 'bridge', rank: 1, street: { path } },
      ],
    } as any;
    const { inner, outer } = streetColors(scene, 'terrain', true);
    expect([...inner.slice(0, 4)]).toEqual([...inner.slice(4, 8)]);
    expect([...outer.slice(0, 4)]).toEqual([...outer.slice(4, 8)]);
    expect([...inner.slice(8, 12)]).not.toEqual([...inner.slice(4, 8)]);
    // One set for both town renderers (city/streetLook.ts): neither keeps a copy.
    expect(CROSSINGS.has('bridge')).toBe(true);
    expect(CROSSINGS.has('causeway')).toBe(false);
    for (const file of ['../../src/render/city/canvas/town.ts', '../../src/render/cityGlBuild.ts']) expect(read(file)).not.toContain('const CROSSINGS');
  });
});

describe('defensive vegetation parity', () => {
  it('uses the shared fortification polygons in V2 and City Bench, including worker preparation', () => {
    for (const path of ['../../src/v2/displayForest.ts', '../../src/ui/citybench.ts']) {
      const source = read(path);
      expect(source).toContain("import { fortificationClearings } from '../render/forestClearance'");
      expect(source).toMatch(/forestOccupation\([^;]+fortificationClearings/);
    }
    expect(read('../../src/v2/occupation.worker.ts')).toContain('data.input.clearings');
  });
});
