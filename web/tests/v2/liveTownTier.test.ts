import { describe, expect, it, vi } from 'vitest';
import type { LiveFrame } from '../../src/render/live/contract';
import type { LiveCityTowns } from '../../src/render/city/live/contract';
import type { CityBuildings, CityScene } from '../../src/render/city/model/contract';
import { resolveAppearance } from '../../src/render/appearanceRecipe';
import { presetComposition } from '../../src/render/composition';
import { createLiveCityLayer } from '../../src/render/city/live/townLayer';

// The GPU town renderer and the layer's GL extras as fakes: the test counts what the layer builds, not pixels.
const renderer = vi.hoisted(() => {
  const fake = {
    programsLinked: true,
    ready: false,
    packing: false,
    pendingUpload: false,
    programsStep: () => false,
    step: () => false,
    upload: () => {},
    stats: () => ({ gpuBytes: 0 }),
    setScene: vi.fn(async () => {
      fake.ready = true;
    }),
    setBuildings: vi.fn(async () => {}),
    setYards: () => {},
    *prepareSteps() {},
    check: () => '',
    prepare: () => {},
    draw: () => ({ drawCalls: 0, triangles: 0, instances: 0 }),
    dispose: () => {},
  };
  return fake;
});
vi.mock('../../src/render/city/gl/renderer', () => ({ createCityGlRendererOn: () => renderer }));
vi.mock('../../src/render/city/live/farRasters', () => ({
  FarRasters: class {
    linked = true;
    ready = false;
    bytes = 0;
    count = 0;
    link() {}
    drop() {}
    draw() {}
    work() {
      return false;
    }
  },
}));
vi.mock('../../src/render/city/live/canopyDiscs', () => ({
  CanopyDiscs: class {
    linked = true;
    bytes = 0;
    link() {}
    drop() {}
    draw() {}
    set() {
      return false;
    }
  },
}));
vi.mock('../../src/render/city/live/nightLamps', () => ({
  NightLamps: class {
    ready() {
      return true;
    }
    step() {
      return false;
    }
    drop() {}
    paint() {}
  },
}));
vi.mock('../../src/render/world/buildingsGrain', () => ({
  CoverGrainTexture: class {
    texture = undefined;
    step() {
      return true;
    }
    dispose() {}
    lost() {}
  },
}));
vi.mock('../../src/render/cityGlGrain', () => ({ grainMeansReady: () => true, grainMeansStep: () => false }));

/** A WebGL2 context that records nothing and answers every query. */
const gl = new Proxy({} as WebGL2RenderingContext, {
  get: (target, name) => {
    const t = target as unknown as Record<string | symbol, unknown>;
    if (!(name in t)) t[name] = name === 'isContextLost' ? () => false : String(name).startsWith('create') ? () => ({}) : () => undefined;
    return t[name];
  },
});

describe('live town layer across styles', () => {
  it('builds the plan once and the flat buildings once, whatever the styles switched to and back', async () => {
    const plan = { layouts: [], blocks: [], parcels: [], streets: [], extent: { minX: 0, minY: 0, maxX: 100, maxY: 100 } } as unknown as CityScene,
      buildings = { items: [] } as unknown as CityBuildings;
    const sceneSteps = vi.fn(function* (planOnly?: boolean) {
      yield;
      return planOnly ? { plan } : { plan, buildings };
    });
    const towns: LiveCityTowns = { sceneSteps, layers: a => a.city.layers, farTowns: () => [], houses: () => [], enclosures: () => [], canopies: () => [], refused: () => new Set(), sites: () => false, housePlans: () => false };
    // Satellite stands the buildings as volumes (the layer draws the plan only), the topographic map draws them flat.
    const looks = (['satellite', 'topographic'] as const).map(style => ({ volumes: style === 'satellite', appearance: resolveAppearance({ style: 'parchment', composition: presetComposition(style) }, { mapStyle: 'parchment' }, { nativeCities: true }, 'view2d') }));
    let shown = looks[0];
    const layer = createLiveCityLayer(gl, { appearance: () => shown.appearance, visibility: () => undefined, volumeBuildings: () => shown.volumes, invalidate: () => {} }, towns);
    const frame = { view: { cx: 50, cy: 50, scale: 1 }, width: 64, height: 64, dpr: 1, worldToPixel: [1, 1, 0, 0], camera: { tilted: false }, moving: false, quality: 'full', target: null } as unknown as LiveFrame;
    const settle = async () => {
      for (let i = 0; i < 64 && layer.work!(Infinity, frame); i++) await new Promise(resolve => setTimeout(resolve, 0));
    };
    await settle();
    for (const style of [1, 0, 1, 0, 1]) {
      shown = looks[style];
      // What composedView.syncLayers does on another building tier: the same layer, told.
      layer.invalidate!();
      await settle();
    }
    expect(sceneSteps.mock.calls.map(call => call[0])).toEqual([true, false]);
    expect(renderer.setScene).toHaveBeenCalledTimes(1);
    expect(renderer.setBuildings).toHaveBeenCalledTimes(1);
    expect(renderer.setBuildings).toHaveBeenCalledWith(buildings);
    layer.dispose();
  });
});
