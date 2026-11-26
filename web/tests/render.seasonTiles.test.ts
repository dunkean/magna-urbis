import { afterEach, expect, it, vi } from 'vitest';
import { fakeWorld, mockCanvas } from '../scripts/fakeworld';
import { CartographyContext } from '../src/render/cartography/context';
import type { CanvasLike, LandBackdrop } from '../src/render/cartography/contract';
import { createExactTiles } from '../src/render/cartography/exactTiles';
import { createMapRecording } from '../src/render/cartography/mapRecording';
import { seasonRecording } from '../src/render/cartography/seasonRecording';
import { setMapInk } from '../src/render/gpu/recorder';
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
