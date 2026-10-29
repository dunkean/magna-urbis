import { describe, expect, it } from 'vitest';
import type { Layout, Partition, Shape } from '../../rust/bridge/urban';
import { buildMapLabels, nativeLandmarkLabels, type MapAnnotations, type RpgPin } from '../src/render/mapLabels';
import { labelsSvg } from '../src/render/svgLabels';
import { PALETTES } from '../src/render/styles';
import { renderSvg } from '../src/render/svg';
import { readRpgPins, shareRpgPins } from '../src/ui/cityRpgPins';
import { decodeSituation, encodeSituation } from '../src/ui/citySituation';
import { fakeWorld } from '../scripts/fakeworld';

const square = (x: number, y: number): Shape => ({ outer: [{ x, y }, { x: x + 40, y }, { x: x + 40, y: y + 40 }, { x, y: y + 40 }], holes: [] });
const pin: RpgPin = { id: 'inn-1', kind: 'inn', text: 'Auberge <du pont> & fils', x: 420.125, y: 650.75 };
function fixture() {
  const layout = { key: 'town', enclosures: [{ kind: 'wall', path: [], gates: [{ x: 1300, y: 800 }] }],
    programme: { allocations: [], demands: [{ id: 'keep', role: 'defence.keep' }, { id: 'unmet', role: 'worship.cathedral' }],
      reservations: [{ id: 'keep-site', demandId: 'keep', shape: square(900, 500) }] } } as unknown as Layout;
  const partition = { key: 'town', parcels: [
    { id: 'cathedral', use: 'compound', shape: square(750, 1000) },
    { id: 'market', use: 'market', shape: square(1100, 1150) },
    { id: 'house', use: 'plot', shape: square(300, 300) },
  ], programme: { ...layout.programme, allocations: [
    { parcelId: 'cathedral', demandId: 'cathedral', role: 'worship.cathedral', landmark: true, label: 'Cathédrale du fleuve' },
    { parcelId: 'house', demandId: 'domestic', role: 'dwelling.row' },
  ] } } as unknown as Partition;
  const world = Object.assign(fakeWorld({ mapSize: 1600, buildings: 0, streets: 0, landAreas: 0 }), {
    names: undefined, mapAnnotations: { enabled: true, pins: [pin], landmarks: nativeLandmarkLabels([layout], [partition]) } as MapAnnotations,
  });
  world.options.labels = true;
  return { layout, partition, world };
}

describe('RPG map annotations', () => {
  it('labels actual programme features and gates, preserving native names and ignoring unmet demands and ordinary dwellings', () => {
    const { layout, partition } = fixture(), labels = nativeLandmarkLabels([layout], [partition]);
    expect(labels.map(l => l.text)).toEqual(['Porte', 'Cathédrale du fleuve', 'Marché', 'Donjon']);
    expect(labels.find(l => l.text === 'Donjon')).toMatchObject({ x: 920, y: 520, kind: 'castle' });
    expect(nativeLandmarkLabels([layout])).toHaveLength(2);
    layout.programme!.reservations.push({ ...layout.programme!.reservations[0], id: 'bad', shape: square(NaN, 0) });
    expect(nativeLandmarkLabels([layout])).toHaveLength(2);
  });

  it('exports annotations without world.names, escapes text, and leaves the off SVG byte-identical', () => {
    const { world } = fixture(), pal = PALETTES.atlas;
    expect(buildMapLabels(world, 'atlas', pal)).toHaveLength(5);
    expect(labelsSvg(world, pal)).toContain('Auberge &lt;du pont&gt; &amp; fils');
    expect(labelsSvg(world, pal)).toContain('Cathédrale du fleuve');
    world.mapAnnotations.pins!.push({ ...pin, id: 'blank', text: '  ' });
    expect(() => labelsSvg(world, pal)).not.toThrow();
    world.mapAnnotations.enabled = false;
    const options = { raster: false, contours: false, legend: false, cartouche: false };
    const off = renderSvg(world, options);
    const { mapAnnotations, ...original } = world;
    expect(off).toBe(renderSvg(original, options));
    expect(labelsSvg(world, pal)).toBe('');
  });

  it('keeps existing name candidates available when the canvas toggles its label overlay', () => {
    const world = fakeWorld({ mapSize: 1600, buildings: 0, streets: 0, landAreas: 0 });
    world.options.labels = false;
    world.names = { family: 'french', town: 'Ville', entries: [{ id: 'town', kind: 'town', text: 'Ville', rank: 0, anchor: { x: 800, y: 800 } }] };
    const original = buildMapLabels(world, 'atlas', PALETTES.atlas);
    expect(original.map(l => l.text)).toEqual(['Ville']);
    expect(buildMapLabels({ ...world, mapAnnotations: { enabled: false, pins: [pin] } }, 'atlas', PALETTES.atlas)).toEqual(original);
  });

  it('gives the global labels switch precedence over enabled RPG pins and landmarks', () => {
    const { world } = fixture(); world.options.labels = false;
    expect(buildMapLabels(world, 'atlas', PALETTES.atlas)).toEqual([]);
    expect(labelsSvg(world, PALETTES.atlas)).toBe('');
    expect(renderSvg(world, { labels: false, raster: false, contours: false, legend: false, cartouche: false })).not.toContain('Auberge');
  });

  it('keeps RPG annotations in the share query and MU1, separate from bug pins, including when hidden', async () => {
    const q = new URLSearchParams('artifact=city-13-temperate-valley-s&labels=0');
    expect(readRpgPins(q)).toEqual({ enabled: false, pins: [] });
    shareRpgPins(q, { enabled: true, pins: [pin] });
    const pins = [{ x: 100, y: 200, note: 'Road bug' }];
    const code = await encodeSituation({ v: 1, q: q.toString(), pins });
    const restored = await decodeSituation(code);
    expect(restored.pins).toEqual(pins);
    expect(readRpgPins(new URLSearchParams(restored.q))).toEqual({ enabled: true, pins: [pin] });
    expect(new URLSearchParams(restored.q).get('labels')).toBe('0');
    shareRpgPins(q, { enabled: false, pins: [pin] });
    expect(readRpgPins(q)).toEqual({ enabled: false, pins: [pin] });
    const empty = new URLSearchParams('artifact=old'); shareRpgPins(empty, { enabled: false, pins: [] });
    expect(empty.toString()).toBe('artifact=old');
  });

  it('ignores malformed pin payloads without interpreting bug pins as map annotations', () => {
    expect(readRpgPins(new URLSearchParams({ rpgPins: '{' })).pins).toEqual([]);
    const q = new URLSearchParams({ rpgPins: JSON.stringify([pin, { x: 1, y: 2, note: 'bug' }, { ...pin, kind: 'constructor' }]) });
    expect(readRpgPins(q).pins).toEqual([pin]);
  });
});
