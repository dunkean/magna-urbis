import { afterEach, expect, it, vi } from 'vitest';
import { ContourInk } from '../src/v2/display/contours';
import { createContourInk, type ContourInkSource } from '../src/render/live/contourInk';
import { cityContourPaths, cityContourPathsPending } from '../src/render/cityContours';
import { effectiveTerrainSettings } from '../src/v2/terrainSettings';
import type { MapState } from '../src/v2/display/mapState';

vi.mock('../src/render/live/contourInk', () => ({ createContourInk: vi.fn() }));
vi.mock('../src/render/contourRaster', () => {
  const plates = new WeakMap<object, object>();
  return {
    contourRaster: (paths: object, worldSize: number) => {
      let plate = plates.get(paths);
      if (!plate) {
        plate = { canvas: { width: 8192, height: 8192 }, worldSize, metresPerTexel: worldSize / 8192 };
        plates.set(paths, plate);
      }
      return plate;
    },
  };
});
vi.mock('../src/render/composition', () => ({ contourDrawOf: () => ({ detail: 'fixed', sparse: false, opacity: 1 }) }));
vi.mock('../../rust/bridge/fantasyTerrain', () => ({ isFantasyStyle: () => false }));
vi.mock('../src/v2/terrainSettings', () => ({ effectiveTerrainSettings: vi.fn(() => ({ relief: 'hills' })) }));
vi.mock('../src/render/terrainStyle', () => ({ terrainStyle: () => ({ palette: { contour: '#987654', contourOpacity: 0.4, contourThinW: 1, contourIndexW: 1.6 } }) }));
vi.mock('../src/render/cityContours', () => ({ cityContourPaths: vi.fn(), cityContourPathsPending: vi.fn(), cityContoursPending: () => 1 }));
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

it('does not record the nonzero-interval placeholder while the fixed terrain set is still in its worker', () => {
  vi.useFakeTimers();
  const map = {
    resolved: { composition: { recipe: { ground: { look: 'atlas' } } }, ground: { style: 'atlas', contours: true }, palette: {} },
    native: { width: 6000, caveMask: new Uint8Array() },
    world: { mapSize: 6000 },
    exportLayers: {},
    layers: () => ({ relief: true }),
  } as unknown as MapState;
  let source!: () => ContourInkSource | null | undefined;
  vi.mocked(createContourInk).mockImplementation((_gl, read) => {
    source = read;
    return undefined;
  });
  const contours = new ContourInk(map, vi.fn());
  contours.createLiveInk({} as WebGL2RenderingContext);
  vi.mocked(cityContourPaths).mockReturnValue({ step: 5, thin: '', index: '' });
  vi.mocked(cityContourPathsPending).mockReturnValue(true);
  expect(source()).toBeNull();
  vi.mocked(cityContourPathsPending).mockReturnValue(false);
  vi.mocked(cityContourPaths).mockReturnValue({ step: 5, thin: 'M0.00,0.00L10.00,20.00', index: 'M20.00,30.00L40.00,50.00' });
  const retained = source()!;
  expect(retained.list.ops).toHaveLength(1);
  expect(retained.list.ops[0].type).toBe('sprites');
  expect(source()!.list).toBe(retained.list);
  expect(source()).toBe(retained);
  for (let i = 0; i < 20; i++) contours.contourLook();
  expect(effectiveTerrainSettings).toHaveBeenCalledTimes(1);
  map.townContent = 1;
  contours.contourLook();
  expect(effectiveTerrainSettings).toHaveBeenCalledTimes(2);
  expect(source()).not.toBe(retained);
  expect(source()!.list).toBe(retained.list);
  map.exportLayers.terrain = false;
  map.townContent++;
  expect(source()).toBeUndefined();
  map.exportLayers.terrain = true;
  map.townContent++;
  expect(source()!.list).toBe(retained.list);
  // Appearance.apply bumps townContent before replacing the resolved inputs: an intervening lookup must not
  // cache the previous look under the incoming revision and serve atlas geometry/ink to topographic.
  map.townContent++;
  source();
  const beforeSwitch = source()!;
  const r = map.resolved!;
  map.resolved = { ...r, composition: { ...r.composition, recipe: { ...r.composition.recipe, ground: { ...r.composition.recipe.ground, variant: 'topographic' } } } };
  vi.mocked(cityContourPaths).mockReturnValue({ step: 2.5, thin: 'M5.00,5.00L15.00,25.00', index: 'M25.00,35.00L45.00,55.00' });
  expect(source()!.list).not.toBe(beforeSwitch.list);
  expect(vi.mocked(cityContourPaths).mock.lastCall?.[3]).toBe(true);
  const calls = vi.mocked(effectiveTerrainSettings).mock.calls.length;
  map.settings = {} as NonNullable<MapState['settings']>;
  contours.contourLook();
  expect(effectiveTerrainSettings).toHaveBeenCalledTimes(calls + 1);
});
