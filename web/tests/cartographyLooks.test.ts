import { expect, it, vi } from 'vitest';
import { fakeWorld } from '../scripts/fakeworld';
import { createCanvasRenderer, type CanvasLike } from '../src/render/canvas';
import { CartographyContext } from '../src/render/cartography/context';
import { markDatedDrawing } from '../src/render/gpu/recorder';
import { createMapRecording } from '../src/render/cartography/mapRecording';
import { drawTexture } from '../src/render/cartography/symbols';
import { createOverlayLayer } from '../src/render/live/overlayLayer';
import { PALETTES } from '../src/render/styles';
import { GpuResources, RECORDED_TOLERANCE } from '../src/render/gpu/resources';
import { SPRITE_STRIDE } from '../src/render/gpu/contract';
import type { DisplayList } from '../src/render/gpu/contract';
import { boundedList } from '../src/render/gpu/listTools';
import { CartographyProducts } from '../src/v2/display/cartographyProducts';
import { resolveAppearance } from '../src/render/appearanceRecipe';
import { presetComposition } from '../src/render/composition';
import type { Scene } from '../src/render/scene';
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
  renderer.dispose();
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
