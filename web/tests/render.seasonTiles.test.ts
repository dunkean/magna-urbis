import { afterEach, expect, it, vi } from 'vitest';
import { fakeWorld, mockCanvas } from '../scripts/fakeworld';
import { CartographyContext } from '../src/render/cartography/context';
import type { CanvasLike, LandBackdrop } from '../src/render/cartography/contract';
import { createExactTiles } from '../src/render/cartography/exactTiles';
import { createMapRecording } from '../src/render/cartography/mapRecording';
import { seasonRecording } from '../src/render/cartography/seasonRecording';
import { recordTreeSprites } from '../src/render/cartography/woods';
import { TileIndex, boxesOf } from '../src/render/tileindex';
import type { TextureLayer } from '../src/render/scene';
import { BandLook } from '../src/render/cartography/bandRecording';
import { urbanFrame } from '../src/render/cartography/urban/frame';
import { drawVector } from '../src/render/cartography/vector';
import type { VectorFrame } from '../src/render/cartography/frame';
import { selectLod } from '../src/render/lod';
import { RecordingContext, setMapInk } from '../src/render/gpu/recorder';
import type { DisplayList, GpuRasterizer } from '../src/render/gpu/contract';
import { applySeason, mapLandSeason, seasonPaint, setMapClimateZone, setMapSeason } from '../src/render/seasonPalette';
import { PALETTES } from '../src/render/styles';
import * as engine from '../src/render/vectorEngine';

afterEach(() => {
  vi.restoreAllMocks();
  setMapSeason(0.5, undefined, {});
  setMapClimateZone(undefined);
});

function fixture(withLand: boolean, cpu = false) {
  const world = fakeWorld({ mapSize: 1024, buildings: 0, streets: 0, landAreas: 0 });
  world.urban = undefined;
  world.roads = [];
  const summer = { width: 64, height: 64 } as HTMLCanvasElement,
    heights = { width: 4, height: 4 } as ImageData;
  const backdrop: LandBackdrop = { summer, canvas: vi.fn(() => summer), uniforms: () => ({ heights, maxHeight: 2500, ...mapLandSeason() }) };
  const season = (date: number) => {
    setMapSeason(date, 'nordic', {});
    return applySeason(PALETTES.parchment, seasonPaint(date, 'nordic'));
  };
  let pal = season(0.5);
  const c = new CartographyContext(mockCanvas(32, 32).canvas as unknown as CanvasLike, world, 'parchment', {
    dpr: 1,
    palette: () => pal,
    terrain: () => (withLand ? backdrop : null),
    createCanvas: (w, h) => (cpu ? (mockCanvas(w, h).canvas as unknown as CanvasLike) : null),
    mask: { water: false },
    transparentBackground: true,
  });
  c.overlays.cartouche = c.overlays.legend = c.overlays.labels = false;
  return {
    c,
    backdrop,
    date: (d: number) => {
      pal = season(d);
      c.syncPalette();
    },
  };
}

it('reuses tree sprite geometry with the current seasonal atlas until the look changes', () => {
  const world = fakeWorld({ mapSize: 64, buildings: 0, streets: 0, landAreas: 0 });
  const canvas = (w: number, h: number) => {
    const surface = mockCanvas(w, h).canvas as unknown as CanvasLike;
    surface.getContext('2d')!.createLinearGradient = () => ({ addColorStop() {} });
    return surface;
  };
  let palette = applySeason(PALETTES.parchment, seasonPaint(0.5, 'nordic'));
  const c = new CartographyContext(canvas(64, 64), world, 'parchment', { vegetation: 'canopy', palette: () => palette, createCanvas: canvas });
  const poly = [{ x: 0, y: 0 }, { x: 64, y: 0 }, { x: 64, y: 64 }, { x: 0, y: 64 }];
  const layer: TextureLayer = { kind: 'orchard', areas: [{ kind: 'orchard', poly }], index: new TileIndex(64, 64, boxesOf([poly]), 'overlap') };
  const record = () => {
    const target = createMapRecording(64, 64);
    const ctx = target.getContext('2d');
    if (!(ctx instanceof RecordingContext)) throw Error('Expected recording context');
    expect(recordTreeSprites(c, ctx, layer, { minX: 0, minY: 0, maxX: 64, maxY: 64 }, 1)).toBe(true);
    const [op] = target.finish().ops;
    if (op?.type !== 'sprites') throw Error('Expected tree sprites');
    return { source: op.source, geometry: [...c.treeSprites.get(layer)!.values()][0].data };
  };
  const summer = record();
  expect(summer.geometry.length).toBeGreaterThan(0);
  palette = applySeason(PALETTES.parchment, seasonPaint(0, 'nordic'));
  c.syncPalette();
  const winter = record();
  expect(winter.geometry).toBe(summer.geometry);
  expect(winter.source).not.toBe(summer.source);
  expect(winter.source).toBe(c.canopy!.spriteImage('orchard', 1, false));

  c.syncPalette(true);
  expect(record().geometry).not.toBe(winter.geometry);
});

it('rebinds cropped summer relief and furrow pigments without moving the old drawing to the new date', () => {
  const { c, backdrop, date } = fixture(true);
  const canvas = createMapRecording(80, 80),
    ctx = canvas.getContext('2d')!;
  c.drawTerrain(ctx, c.getTerrain()!, 5, 6, 32, 33, 10, 12, 64, 66);
  setMapInk(ctx, 'fillStyle', c.ink('furrow'));
  ctx.fillRect(5, 5, 20, 20);
  const list = canvas.finish(),
    retained = seasonRecording(c, list)!;
  expect(retained.pixelsMatch()).toBe(true);
  const [land, field] = list.ops;
  if (land.type !== 'sprites' || field.type !== 'fill' || field.paint.kind !== 'color') throw Error('Expected backdrop and field');
  const oldTint = [...land.landTint!.tint],
    oldInk = [...field.paint.rgba];
  date(0);
  expect(retained.pixelsMatch()).toBe(false);
  const replay = retained.replay()!,
    winter = replay.list;
  const [snow, frozen] = winter.ops;
  if (snow.type !== 'sprites' || frozen.type !== 'fill' || frozen.paint.kind !== 'color') throw Error('Missing winter drawing');
  expect(snow.source).toBe(backdrop.summer);
  expect(snow.landTint!.heights).toBe(land.landTint!.heights);
  expect(snow.instances).toBe(land.instances);
  expect(frozen.paths).toBe(field.paths);
  expect(snow.landTint!.tint).toEqual(mapLandSeason().tint);
  expect(snow.landTint!.tint).not.toEqual(oldTint);
  expect([...frozen.paint.rgba]).not.toEqual(oldInk);
  expect([...field.paint.rgba]).toEqual(oldInk);
  expect(land.landTint!.tint).toEqual(oldTint);
  expect(replay.pixelsMatch()).toBe(true);
  expect(seasonRecording(c, { ...winter, bakedSeason: true })).toBeUndefined();
  expect(backdrop.canvas).not.toHaveBeenCalled();
});

it('rebinds density coverage and warm town paving to their current inks, keeping both sets of geometry', () => {
  vi.stubGlobal(
    'ImageData',
    class {
      constructor(readonly data: Uint8ClampedArray) {}
    },
  );
  vi.stubGlobal(
    'DOMMatrix',
    class {
      rotate() {
        return this;
      }
      scale(a: number) {
        return { a, b: 0, c: 0, d: a, e: 0, f: 0 };
      }
    },
  );
  try {
    const pixels = new WeakMap<object, number[]>();
    const traces = new WeakMap<object, ReturnType<typeof mockCanvas>['log']>();
    let pal = { ...PALETTES.engraving, ink: '#123456', urban: { ...PALETTES.engraving.urban, placeInk: '#567812' } };
    const world = fakeWorld({ buildings: 0, streets: 0, landAreas: 0 });
    const c = new CartographyContext(createMapRecording(4, 4), world, 'engraving', {
      palette: () => pal,
      terrain: () => null,
      createCanvas: (width, height) => {
        const { canvas, log } = mockCanvas(width, height);
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        ctx.putImageData = (data: ImageData) => {
          pixels.set(canvas, [...data.data]);
        };
        traces.set(canvas, log);
        return canvas as unknown as CanvasLike;
      },
    });
    c.scene.density = { w: 2, h: 1, cov: new Float32Array([0, 1]), max: 1, cell: 1 };
    c.getTerrain();
    const paving = (ctx: CanvasRenderingContext2D) => urbanFrame(c, { ctx, sc: 1, lod: selectLod(1), dpr: 1 } as VectorFrame).pave!;
    paving(createMapRecording(4, 4).getContext('2d')!);
    const record = () => {
      const look = new BandLook(c.pal),
        base = c.pal,
        canvas = createMapRecording(4, 4);
      c.pal = look.palette;
      try {
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(c.getDensity()!, 0, 0, 4, 4);
        ctx.fillStyle = paving(ctx);
        ctx.fillRect(0, 0, 2, 2);
      } finally {
        c.pal = base;
      }
      return { list: canvas.finish(), look };
    };
    const cold = record(),
      retained = seasonRecording(c, cold.list, cold.look)!;
    const original = cold.list.ops[0];
    if (original.type !== 'sprites') throw Error('Missing density image');
    expect(pixels.get(original.source)).toEqual([18, 52, 86, 0, 18, 52, 86, 128]);
    pal = { ...pal, paper: '#cccccc' };
    c.syncPalette();
    expect(retained.pixelsMatch()).toBe(true);
    expect(c.getDensity()).toBe(original.source);
    pal = { ...pal, ink: '#ab1357', urban: { ...pal.urban, placeInk: '#ef3412' } };
    c.syncPalette();
    expect(retained.pixelsMatch()).toBe(false);
    const rebound = retained.replay()!,
      op = rebound.list.ops[0];
    if (op.type !== 'sprites') throw Error('Missing rebound density');
    expect(op.instances).toBe(original.instances);
    expect(op.source).toBe(c.getDensity());
    expect(op.source).not.toBe(original.source);
    expect(pixels.get(op.source)).toEqual([171, 19, 87, 0, 171, 19, 87, 128]);
    const oldPave = cold.list.ops[1],
      newPave = rebound.list.ops[1];
    if (oldPave.type !== 'fill' || newPave.type !== 'fill' || oldPave.paint.kind !== 'pattern' || newPave.paint.kind !== 'pattern') throw Error('Missing town paving');
    expect(newPave.paths).toBe(oldPave.paths);
    expect(newPave.paint).toEqual({ ...oldPave.paint, source: newPave.paint.source });
    expect(traces.get(oldPave.paint.source)?.fills).toEqual([{ style: '#567812', alpha: 0.55, path: undefined }]);
    expect(traces.get(newPave.paint.source)?.fills).toEqual([{ style: '#ef3412', alpha: 0.55, path: undefined }]);
    expect(rebound.pixelsMatch()).toBe(true);
    c.scene.density = { ...c.scene.density, cov: new Float32Array([1, 0]) };
    expect(rebound.pixelsMatch()).toBe(false);
    expect(retained.replay()).toBeUndefined();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('recolours camp mud in a retained map recording and in native Canvas', () => {
  vi.stubGlobal(
    'DOMMatrix',
    class {
      private angle = 0;
      rotate(degrees: number) {
        this.angle = (degrees * Math.PI) / 180;
        return this;
      }
      scale(a: number) {
        const c = Math.cos(this.angle) * a, s = Math.sin(this.angle) * a;
        return { a: c, b: s, c: -s, d: c, e: 0, f: 0 };
      }
    },
  );
  try {
    const world = fakeWorld({ mapSize: 128, buildings: 0, streets: 0, landAreas: 0 });
    world.roads = [];
    world.terrain.rivers = [];
    const urban = world.urban!;
    urban.walls = [];
    urban.renderHints = { towerShape: 'round', openGround: true };
    urban.landmarks = [{ kind: 'mud', poly: [{ x: 24, y: 24 }, { x: 104, y: 24 }, { x: 104, y: 104 }, { x: 24, y: 104 }] }];
    let pal = { ...PALETTES.engraving, trackFill: '#804020', farmYard: '#c0a080' };
    const traces = new WeakMap<CanvasImageSource, unknown[]>();
    const nativePatterns: { source: CanvasImageSource }[] = [];
    const native = mockCanvas(128, 128);
    const nativeContext = native.canvas.getContext('2d') as CanvasRenderingContext2D;
    nativeContext.createPattern = source => {
      const pattern = { source, setTransform() {} };
      nativePatterns.push(pattern);
      return pattern;
    };
    const c = new CartographyContext(native.canvas as unknown as CanvasLike, world, 'engraving', {
      palette: () => pal,
      terrain: () => null,
      mask: { water: false },
      transparentBackground: true,
      createCanvas: (width, height) => {
        const { canvas } = mockCanvas(width, height);
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        const trace: unknown[] = [];
        for (const op of ['beginPath', 'moveTo', 'lineTo', 'arc'] as const) {
          Object.defineProperty(ctx, op, { value: (...args: number[]) => trace.push([op, ...args]), configurable: true });
        }
        ctx.stroke = () => trace.push(['stroke', ctx.strokeStyle, ctx.globalAlpha, ctx.lineWidth, ctx.lineCap]);
        ctx.fill = () => trace.push(['fill', ctx.fillStyle, ctx.globalAlpha]);
        traces.set(canvas as unknown as CanvasImageSource, trace);
        return canvas as unknown as CanvasLike;
      },
    });
    const view = { cx: 64, cy: 64, scale: 1 };
    const record = () => {
      const canvas = createMapRecording(128, 128);
      const look = new BandLook(c.pal);
      const palette = c.pal;
      c.pal = look.palette;
      try {
        drawVector(c, view, canvas, 'map');
        return { list: canvas.finish(), look };
      } finally {
        c.pal = palette;
      }
    };
    const mud = (list: DisplayList) => {
      const pattern = list.ops.find(op => op.type === 'fill' && op.paint.kind === 'pattern');
      const base = list.ops.find(op => op.type === 'fill' && op.paint.kind === 'color' && op.paint.slot?.css === c.ink('mudFill').css);
      if (pattern?.type !== 'fill' || pattern.paint.kind !== 'pattern' || base?.type !== 'fill' || base.paint.kind !== 'color') throw Error('Missing camp mud');
      return { pattern, paint: pattern.paint, base, basePaint: base.paint };
    };
    record(); // The band records with the mud bitmap already cached.
    const old = record();
    const retained = seasonRecording(c, old.list, old.look)!;
    const first = mud(old.list);
    const firstTrace = traces.get(first.paint.source)!;
    expect(firstTrace).toContainEqual(['stroke', '#603018', 0.55, 0.35 * 14, 'round']);
    expect(firstTrace).toContainEqual(['fill', '#603018', 0.55]);
    expect(first.base.alpha).toBe(0.75);
    expect(first.basePaint.slot?.css).toBe('#a87c5c');

    pal = { ...pal, trackFill: '#4080c0' };
    c.syncPalette();
    expect(retained.pixelsMatch()).toBe(false);
    const replay = retained.replay()!;
    const changed = mud(replay.list);
    expect(replay.pixelsMatch()).toBe(true);
    expect(changed.base.paths).toBe(first.base.paths);
    expect(changed.base.alpha).toBe(first.base.alpha);
    expect(changed.basePaint.slot?.css).toBe('#8f9498');
    expect(changed.pattern.paths).toBe(first.pattern.paths);
    expect(changed.paint.transform).toBe(first.paint.transform);
    expect(changed.paint.source).not.toBe(first.paint.source);
    const changedTrace = traces.get(changed.paint.source)!;
    expect(changedTrace).toEqual(firstTrace.map(op => Array.isArray(op) && (op[0] === 'fill' || op[0] === 'stroke') ? [op[0], '#306090', ...op.slice(2)] : op));

    drawVector(c, view, c.canvas, 'map');
    const painted = native.log.fills.find(({ style }) => nativePatterns.includes(style as { source: CanvasImageSource }));
    expect(painted?.alpha).toBe(1);
    expect(traces.get((painted?.style as { source: CanvasImageSource }).source)).toEqual(changedTrace);
    expect(native.log.fills.some(({ style, alpha }) => style === '#8f9498' && alpha === 0.75)).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('rejects independent drape reuse for an unknown pattern and an externally painted erase mask', () => {
  const { c } = fixture(false);
  c.getTerrain();
  const source = { width: 8, height: 8 } as HTMLCanvasElement;
  const make = (erase: boolean) => {
    const canvas = createMapRecording(8, 8),
      ctx = canvas.getContext('2d')!;
    if (erase) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(source, 0, 0);
    } else {
      ctx.fillStyle = ctx.createPattern(source, 'repeat')!;
      ctx.fillRect(0, 0, 8, 8);
    }
    return seasonRecording(c, canvas.finish(), new BandLook(c.pal));
  };
  expect(make(true)?.drapeCompatible).toBe(false);
  expect(make(false)?.drapeCompatible).toBe(false);
});

it('preserves unchanged exact tiles across dates and replays, then caches, a tile with new snow', () => {
  const rasterize = vi.fn((_list: DisplayList) => ({ close: vi.fn() }) as unknown as ImageBitmap);
  vi.spyOn(engine, 'getVectorEngine').mockReturnValue('gpu');
  vi.spyOn(engine, 'vectorRasterizer').mockReturnValue({ rasterize, lastStats: () => ({ synced: false }) } as unknown as GpuRasterizer);
  const view = { cx: 256, cy: 256, scale: 1 };
  for (const withLand of [false, true]) {
    const { c, date } = fixture(withLand);
    const tiles = createExactTiles(c);
    rasterize.mockClear();
    expect(tiles.draw(view).rasterBuilt).toBe(1);
    const first = rasterize.mock.calls[0][0];
    date(0);
    const winter = tiles.draw(view);
    expect(winter.rasterBuilt).toBe(withLand ? 1 : 0);
    if (withLand) {
      const land = first.ops.find(op => op.type === 'sprites' && op.landTint);
      const snow = rasterize.mock.lastCall![0].ops.find(op => op.type === 'sprites' && op.landTint);
      if (land?.type !== 'sprites' || snow?.type !== 'sprites') throw Error('Missing seasonal terrain');
      expect(snow.instances).toBe(land.instances);
      expect(snow.landTint!.tint).not.toEqual(land.landTint!.tint);
    }
    expect(tiles.draw(view).rasterHits).toBe(1);
    expect(rasterize).toHaveBeenCalledTimes(withLand ? 2 : 1);
    tiles.rasterCache.clear();
  }
});

it('reuses native Canvas pixels across a date change only when their drawn inputs still match', () => {
  vi.spyOn(engine, 'getVectorEngine').mockReturnValue('cpu');
  for (const withLand of [false, true]) {
    const { c, backdrop, date } = fixture(withLand, true),
      tiles = createExactTiles(c),
      view = { cx: 256, cy: 256, scale: 1 };
    expect(tiles.draw(view).rasterBuilt).toBe(1);
    date(0);
    expect(tiles.draw(view).rasterBuilt).toBe(withLand ? 1 : 0);
    expect(tiles.draw(view).rasterHits).toBe(1);
    expect(backdrop.canvas).toHaveBeenCalledTimes(withLand ? 2 : 0);
    tiles.rasterCache.clear();
  }
});
