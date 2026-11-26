import { expect, it, vi } from 'vitest';
import { fakeWorld } from '../scripts/fakeworld';
import { createCanvasRenderer, type CanvasLike } from '../src/render/canvas';
import { CartographyContext } from '../src/render/cartography/context';
import { markDatedDrawing } from '../src/render/gpu/recorder';
import { createMapRecording } from '../src/render/cartography/mapRecording';
import { drawTexture } from '../src/render/cartography/symbols';
import { createOverlayLayer, type OverlayBand } from '../src/render/live/overlayLayer';
import { PALETTES } from '../src/render/styles';
import { GpuResources, RECORDED_TOLERANCE } from '../src/render/gpu/resources';
import { SPRITE_STRIDE } from '../src/render/gpu/contract';
import type { DisplayList } from '../src/render/gpu/contract';
import { boundedList, clipList, cullList } from '../src/render/gpu/listTools';
import { boxOf } from '../src/render/live/overlayTypes';
import type { BrushImages } from '../src/render/brushes';
import { CartographyProducts } from '../src/v2/display/cartographyProducts';
import { resolveAppearance } from '../src/render/appearanceRecipe';
import { presetComposition } from '../src/render/composition';
import { buildScene, type Scene } from '../src/render/scene';
import type { RoadLook } from '../src/render/composition';

vi.mock('../src/render/live/overlayLayer', () => ({ createOverlayLayer: vi.fn(() => ({ dispose() {} })) }));
function regionWorld() {
  const world = fakeWorld({ mapSize: 512, buildings: 0, streets: 0, landAreas: 0 });
  world.urban = undefined;
  world.terrain.rivers = [];
  world.options.landuse = true;
  world.roads = [
    {
      path: [
        { x: 10, y: 60 },
        { x: 240, y: 60 },
      ],
      kind: 'major',
      width: 5,
    },
  ];
  return world;
}
it('keeps the V2 overlay renderer and scene through a change of road colours', async () => {
  const scenes = new Map<string, Scene>();
  const get = (key: string, build: () => Scene) => {
    const held = scenes.get(key);
    if (held) return held;
    const scene = build();
    scenes.set(key, scene);
    return scene;
  };
  const resolve = (road: string) => resolveAppearance({ style: 'parchment', composition: presetComposition('parchment'), colors: { road } }, { mapStyle: 'parchment' }, { nativeCities: true }, 'view2d');
  const map = { world: regionWorld(), scene: { capabilities: { nativeCities: true }, revisions: { terrain: 1, names: 1 } }, resolved: resolve('#113355'), exportLayers: {}, shared: { cache: { get } }, stats: { cartographyUpdate: '' }, passes: { reset: vi.fn() } };
  vi.stubGlobal('document', { createElement: () => createMapRecording(256, 256) });
  try {
    const products = new CartographyProducts(map as never, { ground: { gpuActive: false } } as never);
    await products.cartographyPass();
    const renderer = products.renderer!,
      scene = renderer.scene,
      overlay = products.overlay;
    expect(renderer.palette.roadFill).toBe('#113355');
    map.resolved = resolve('#aa4422');
    await products.cartographyPass();
    expect(products.renderer).toBe(renderer);
    expect(products.overlay).toBe(overlay);
    expect(renderer.scene).toBe(scene);
    expect(renderer.palette.roadFill).toBe('#aa4422');
    expect(map.stats.cartographyUpdate).toBe('retained');
    expect(scenes.size).toBe(1);
    products.dispose();
  } finally {
    vi.unstubAllGlobals();
  }
});
it('reuses road recordings outside an edit and redraws intersecting bands with the new geometry', () => {
  const world = regionWorld();
  const farRoad = {
    ...world.roads![0],
    path: [
      { x: 310, y: 360 },
      { x: 485, y: 360 },
    ],
  };
  world.roads = [...world.roads!, farRoad];
  const first = { minX: 0, minY: 0, maxX: 160, maxY: 100 },
    second = { minX: 284, minY: 300, maxX: 508, maxY: 408 };
  const make = (source: typeof world) => {
    const draw = vi.fn();
    const renderer = createCanvasRenderer(createMapRecording(512, 512), source, 'parchment', {
      palette: () => PALETTES.parchment,
      transparentBackground: true,
      terrain: () => null,
      mask: { water: false },
      createCanvas: () => null,
      invalidate() {},
      semantic: { draw, look: () => 'roads', key: () => 'roads', arrivals: () => 0, provisional: () => 0 },
    });
    renderer.createLiveLayer({} as WebGL2RenderingContext);
    const host = vi.mocked(createOverlayLayer).mock.calls.at(-1)![1];
    const plan = (rect: typeof first) => ({ key: 'map', rect, bands: [rect], scale: 1, dpr: 1 });
    const record = (rect: typeof first) => host.record(plan(rect), rect, false)!;
    const drape = (rect: typeof first) => {
      const steps = host.recordSteps!(plan(rect), rect, false, true);
      let step = steps.next();
      while (!step.done) step = steps.next();
      return step.value!;
    };
    return { renderer, record, drape, draw };
  };
  const strokes = (band: OverlayBand) => {
    const box = boxOf(band);
    return clipList(cullList(band.list, box), box)
      .ops.filter(op => op.type === 'stroke')
      .map(op => [op.width, op.transform, op.paths.map(path => path.geometry(1).points)]);
  };
  const base = make(world);
  base.record(first);
  const old = strokes(base.record(second));
  const pendingDrape = base.drape(second);
  const changed = {
    ...world,
    roads: [
      world.roads[0],
      {
        ...farRoad,
        path: [
          { x: 310, y: 358 },
          { x: 482, y: 391 },
        ],
      },
    ],
  };
  const nextScene = buildScene(changed, undefined, { mask: { water: false } });
  const reference = make(changed);
  try {
    expect(base.renderer.update(changed, { ...nextScene, dirty: [second] })).toBe(true);
    // Baking can finish after an edit invalidates a recording that has not entered the cache yet.
    expect(pendingDrape.retainDrape).toBeTypeOf('function');
    const box = boxOf(pendingDrape);
    pendingDrape.retainDrape!(boundedList(clipList(cullList(pendingDrape.list, box), box)));
    const nextDrape = base.drape(second);
    expect(nextDrape.replayed).toBeFalsy();
    expect(strokes(nextDrape)).toEqual(strokes(reference.drape(second)));
    const before = base.draw.mock.calls.length;
    const clean = base.record(first);
    expect(clean.replayed).toBe(true);
    expect(base.draw).toHaveBeenCalledTimes(before);
    expect(strokes(clean)).toEqual(strokes(reference.record(first)));
    const dirty = base.record(second);
    expect(dirty.replayed).toBeFalsy();
    expect(base.draw).toHaveBeenCalledTimes(before + 1);
    expect(strokes(dirty)).not.toEqual(old);
    expect(strokes(dirty)).toEqual(strokes(reference.record(second)));
    // The paint of a road centred just outside the band can still enter its frame.
    expect(base.renderer.update(changed, { ...nextScene, dirty: [{ ...first, minY: 102, maxY: 104 }] })).toBe(true);
    expect(base.record(first).replayed).toBeFalsy();
    expect(base.record(second).replayed).toBe(true);
    expect(base.renderer.update(changed, nextScene)).toBe(true);
    expect(base.record(second).replayed).toBeFalsy();
  } finally {
    base.renderer.dispose();
    reference.renderer.dispose();
  }
});
it('rebinds a live band to new road ink in place and records a different road style just once', () => {
  const world = regionWorld(),
    palette = () => PALETTES.parchment;
  let roadLook: RoadLook = 'ink',
    materialColor: string | undefined;
  let dated = false;
  const draw = vi.fn((ctx: CanvasRenderingContext2D) => {
      if (dated) markDatedDrawing(ctx);
    }),
    sceneDeps = { draw, look: () => 'roads', key: () => (dated ? 'dated' : 'roads'), arrivals: () => 0, provisional: () => 0 };
  const renderer = createCanvasRenderer(createMapRecording(256, 256), world, 'parchment', {
    palette,
    transparentBackground: true,
    terrain: () => null,
    mask: { water: false },
    createCanvas: () => null,
    invalidate: () => {},
    semantic: sceneDeps,
    roadStyle: () => ({ look: roadLook, emphasis: 1, night: false, colors: materialColor ? { road: materialColor } : undefined }),
  });
  renderer.createLiveLayer({} as WebGL2RenderingContext);
  const host = vi.mocked(createOverlayLayer).mock.calls.at(-1)![1];
  const rect = { minX: 0, minY: 0, maxX: 256, maxY: 128 },
    plan = { key: 'map', rect, scale: 1, dpr: 1, bands: [rect] };
  const record = () => {
    const list = host.record(plan, rect, false)?.list;
    expect(list?.unsupported).toBeUndefined();
    const op = list && [...list.ops].reverse().find(op => op.type === 'stroke' && op.paint.kind === 'color' && op.paint.slot);
    if (op?.type !== 'stroke' || op.paint.kind !== 'color') throw new Error('Missing slotted road stroke');
    return { paths: op.paths, widths: list!.ops.filter(op => op.type === 'stroke').map(op => op.width), paint: op.paint };
  };
  const first = record(),
    calls = draw.mock.calls.length,
    scene = renderer.scene;
  expect(calls).toBeGreaterThan(0);
  renderer.setLook({ palette, colors: { road: '#aabbcc' } });
  const second = record();
  expect(renderer.scene).toBe(scene);
  expect(draw).toHaveBeenCalledTimes(calls);
  expect(second.paths).toBe(first.paths);
  expect(second.paint.rgba).not.toEqual(first.paint.rgba);
  expect(second.paint.slot?.css).toBe('#aabbcc');
  roadLook = 'wash';
  const wash = record();
  expect(draw).toHaveBeenCalledTimes(calls + 1);
  expect(wash.widths).not.toEqual(second.widths);
  roadLook = 'ink';
  expect(record().paths).toBe(first.paths);
  expect(draw).toHaveBeenCalledTimes(calls + 1);
  dated = true;
  const datedBand = record();
  const before = draw.mock.calls.length;
  renderer.setLook({ palette, colors: { road: '#334455' } });
  const recoloured = record();
  expect(draw).toHaveBeenCalledTimes(before + 1);
  expect(recoloured.paths).toBe(datedBand.paths);
  expect(recoloured.paint.slot?.css).toBe('#334455');
  roadLook = 'rendered';
  materialColor = '#334455';
  const material = record();
  materialColor = '#229944';
  renderer.setLook({ palette, colors: { road: materialColor } });
  const changedBed = record();
  expect(changedBed.paint.slot?.css).toBe(materialColor);
  expect(changedBed.paths).toBe(material.paths);
  dated = false;
  // A material verge is a real bitmap even with an explicitly coloured bed.
  vi.stubGlobal('DOMMatrix', class {});
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}
      getContext() {
        return { createImageData: () => ({ data: new Uint8ClampedArray(this.width * this.height * 4) }), putImageData() {} };
      }
    },
  );
  try {
    plan.scale = 2;
    const textured = host.record(plan, rect, false)!,
      calls = draw.mock.calls.length;
    const verge = textured.list.ops.find(op => op.type === 'stroke' && op.paint.kind === 'pattern');
    expect(verge).toBeDefined();
    materialColor = '#bb7733';
    renderer.setLook({ palette, colors: { road: materialColor } });
    const rebound = host.record(plan, rect, false)!;
    expect(rebound.replayed).toBe(true);
    expect(draw).toHaveBeenCalledTimes(calls);
    expect(rebound.list.ops[textured.list.ops.indexOf(verge!)]).toBe(verge);
    expect(record().paint.slot?.css).toBe(materialColor);
    materialColor = undefined;
    renderer.setLook({ palette, colors: {} });
    expect(host.record(plan, rect, false)?.replayed).toBeFalsy();
    expect(draw).toHaveBeenCalledTimes(calls + 1);
  } finally {
    vi.unstubAllGlobals();
  }
  renderer.dispose();
});

it('rebinds the sampled field motif on a clipped drape row and keeps its original extent and draw order', () => {
  vi.stubGlobal(
    'DOMMatrix',
    class {
      scale(a: number) {
        return { a, d: a };
      }
    },
  );
  try {
    // Trace the atlas sample, crop and destination of every native motif stamp. The tint uses a single RGBA texel.
    const createCanvas = (width: number, height: number) => {
      const tile = { width, height, sample: [120, 96, 80, 255], stamps: [] as number[][] };
      const ctx = {
        globalAlpha: 1,
        drawImage(image: typeof tile, ...args: number[]) {
          if (args.length === 8) tile.stamps.push([...image.sample, this.globalAlpha, ...args]);
        },
        getImageData: () => ({ data: new Uint8ClampedArray(tile.sample) }),
        putImageData(data: ImageData) {
          tile.sample = Array.from(data.data);
        },
      };
      return Object.assign(tile, { getContext: () => ctx });
    };
    const brushes = { terrain: {}, vegetation: {}, sources: {} } as BrushImages;
    const world = regionWorld();
    world.landuse!.areas = [
      {
        kind: 'field',
        poly: [
          { x: 5, y: 5 },
          { x: 180, y: 5 },
          { x: 180, y: 140 },
          { x: 5, y: 140 },
        ],
      },
    ];
    const palette = () => PALETTES.engraving;
    const make = (forest: string) => {
      const draw = vi.fn();
      const renderer = createCanvasRenderer(createMapRecording(256, 256), world, 'engraving', {
        palette,
        brushes,
        colors: { forest },
        transparentBackground: true,
        terrain: () => null,
        mask: { water: false },
        createCanvas: (w, h) => createCanvas(w, h) as unknown as CanvasLike,
        invalidate() {},
        semantic: { draw, look: () => '', key: () => '', arrivals: () => 0, provisional: () => 0 },
      });
      renderer.createLiveLayer({} as WebGL2RenderingContext);
      const host = vi.mocked(createOverlayLayer).mock.calls.at(-1)![1];
      const record = (height: number, drape = true, width = 256) => {
        const rect = { minX: 0, minY: 0, maxX: width, maxY: width },
          band = { ...rect, maxY: height };
        const steps = host.recordSteps!({ key: 'test', scale: 1, dpr: 1, rect, bands: [band] }, band, false, drape);
        let next = steps.next();
        while (!next.done) next = steps.next();
        const made = next.value!;
        if (made.retainDrape) {
          const box = boxOf(made),
            prepared = boundedList(clipList(cullList(made.list, box), box));
          made.retainDrape(prepared);
          return { ...made, list: prepared };
        }
        return made;
      };
      return { renderer, draw, record };
    };
    const first = make('#779944'),
      cold = first.record(48);
    const motif = (list: DisplayList) => {
      const op = list.ops.find(op => op.type === 'fill' && op.paint.kind === 'pattern');
      if (op?.type !== 'fill' || op.paint.kind !== 'pattern') throw Error('Missing field pattern');
      return { op, paint: op.paint, tile: op.paint.source as unknown as ReturnType<typeof createCanvas> };
    };
    const old = motif(cold.list),
      originalStamps = structuredClone(old.tile.stamps);
    expect(originalStamps.length).toBeGreaterThan(0);
    first.renderer.setLook({ palette, colors: { forest: '#bb1177' } });
    const replay = first.record(16),
      changed = motif(replay.list);
    expect(first.draw).toHaveBeenCalledTimes(1);
    expect(replay.replayed).toBe(true);
    expect(replay.rect).toEqual(cold.rect);
    expect(replay.h).toBe(48);
    expect(changed.op.paths).toBe(old.op.paths);
    expect(changed.op.clip).toBe(old.op.clip);
    expect(changed.paint.transform).toBe(old.paint.transform);
    expect(changed.paint.source).not.toBe(old.paint.source);
    expect(changed.tile.stamps).not.toEqual(originalStamps);
    expect(old.tile.stamps).toEqual(originalStamps);
    const reference = make('#bb1177'),
      fresh = reference.record(48);
    expect(changed.tile.stamps).toEqual(motif(fresh.list).tile.stamps);
    expect(replay.list.ops.map(op => op.type)).toEqual(fresh.list.ops.map(op => op.type));
    // Different tile clips, top-view bands and newly selected atlases all take their own recording.
    expect(first.record(48, true, 512).replayed).toBeFalsy();
    expect(first.record(48, false).replayed).toBeFalsy();
    first.renderer.setLook({ palette, brushes: { ...brushes, terrain: {} as CanvasImageSource } });
    expect(first.record(48).replayed).toBeFalsy();
    first.renderer.setLook({ palette, fullLanduse: () => false });
    const transferred = first.record(48);
    expect(transferred.replayed).toBeFalsy();
    expect(transferred.list.ops.some(op => op.type === 'fill' && op.paint.kind === 'pattern')).toBe(false);
    first.renderer.dispose();
    reference.renderer.dispose();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('reuses y-sorted world-space pen instances across pan, zoom and pigment changes, including GPU uploads', () => {
  const world = regionWorld();
  world.landuse!.areas = [
    {
      kind: 'meadow',
      poly: [
        { x: 2, y: 2 },
        { x: 255, y: 2 },
        { x: 255, y: 124 },
        { x: 2, y: 124 },
      ],
    },
  ];
  const createCanvas = (width: number, height: number) => ({ width, height, getContext: () => ({ createImageData: () => ({ data: new Uint8ClampedArray(width * height * 4) }), putImageData() {} }) }) as unknown as CanvasLike;
  let pal = PALETTES.parchment;
  const c = new CartographyContext(createMapRecording(512, 256), world, 'parchment', { palette: () => pal, createCanvas });
  const layer = c.scene.textures.find(t => t.kind === 'meadow')!,
    rect = { minX: 0, minY: 0, maxX: 256, maxY: 128 };
  const record = (scale: number, tx: number) => {
    c.syncPalette();
    const target = createMapRecording(512, 256),
      ctx = target.getContext('2d')!;
    ctx.setTransform(scale, 0, 0, scale, tx, 0);
    drawTexture(c, ctx, layer, rect, 3, w => w);
    const list: DisplayList = boundedList(target.finish());
    expect(list.unsupported).toBeUndefined();
    return list.ops.filter(op => op.type === 'sprites');
  };
  const a = record(1, 0);
  pal = { ...pal, grass: '#ff00ff' };
  const b = record(2, -32);
  expect(a).toHaveLength(2);
  expect(b).toHaveLength(2);
  const gl = { createBuffer: () => ({}), bindBuffer: vi.fn(), bufferData: vi.fn() };
  const gpu = new GpuResources(gl as unknown as WebGL2RenderingContext, RECORDED_TOLERANCE);
  a.forEach((op, i) => {
    expect(op.count).toBeGreaterThan(0);
    expect(op.clip?.path).toBe(b[i].clip?.path);
    expect(b[i].instances).toBe(op.instances);
    expect(b[i].source).toBe(op.source);
    expect(b[i].transform).toEqual([2, 0, 0, 2, -32, 0]);
    expect(b[i].tint?.[0].css).not.toBe(op.tint?.[0].css);
    let last = -Infinity;
    for (let j = 0; j < op.instances.length; j += SPRITE_STRIDE) {
      const y = op.instances[j + 5] + op.instances[j + 7] / 2;
      expect(y).toBeGreaterThanOrEqual(last);
      last = y;
    }
    gpu.uploadSprites(op);
    gpu.uploadSprites(b[i]);
  });
  expect(gl.bufferData).toHaveBeenCalledTimes(2);
});
