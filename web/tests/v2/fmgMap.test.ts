import { gzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { dragFmgCrop, fmgBurgsInCrop, parseFmgMap, readFmgMapFile } from '../../src/v2/fmg/fmgMap';
import { fmgCropExtent, fmgCropSettings } from '../../src/v2/fmg/fmgRegion';
import { validateSettings } from '../../src/v2/project';
import { effectiveRegion } from '../../src/v2/regionSettings';

function save(options: string, lineEnding = '\r\n', heights = '8,25,8,45'): string {
  const points = [
    [25, 25],
    [75, 25],
    [25, 75],
    [75, 75],
  ];
  const burgs = [
    0,
    { i: 2, x: 65, y: 25, name: 'Vík', population: 1.5, culture: 1 },
    { i: 7, x: 75, y: 66, name: 'Eastwatch', population: 3, culture: 1 },
    { i: 9, x: 65, y: 65, name: 'Ruins', population: 1, removed: true },
    { i: 11, x: 45, y: 45, name: 'Outside', population: 9 },
  ];
  return [
    '1.154.0|File can be loaded in azgaar.github.io/Fantasy-Map-Generator|2026-10-10|400|100|100|123',
    options,
    '{}',
    '[]',
    '[]',
    '<svg id="map">\r\n<script>throw new Error("Do not parse the SVG");</script>\r\n</svg>',
    JSON.stringify({ spacing: 50, cellsX: 2, cellsY: 2, points, boundary: [], features: [] }),
    heights,
    '0,0,0,0',
    '0,0,0,0',
    '0,0,0,0',
    '0,0,0,0',
    '[]',
    '[{"i":1,"name":"Nordic","base":4,"type":"Naval"}]',
    '[]',
    JSON.stringify(burgs),
  ].join(lineEnding);
}
const modern = JSON.stringify({ lore: { name: 'Northern Shores' }, units: { distance: { unit: 'km', scale: 1.5 }, height: { exponent: 2 }, population: { scale: 500, urbanization: { rate: 2 } } } });
const classic = 'mi|2|square|ft|1.8|°F|||||||2000|1.5';

describe('Azgaar .map region import', () => {
  it('reads the geometry with multiline SVG and converts source distance, populations and elevations', () => {
    const map = parseFmgMap('\ufeff' + save(modern));
    expect(map).toMatchObject({
      width: 100,
      height: 100,
      seed: '400',
      name: 'Northern Shores',
      metresPerPixel: 1500,
      burgs: [expect.objectContaining({ name: 'Vík', population: 1500 }), expect.objectContaining({ name: 'Eastwatch', population: 3000 }), expect.objectContaining({ name: 'Outside', population: 9000 })],
    });
    expect(map.elevationAt(25, 25)).toBe(-75);
    expect(map.elevationAt(75, 25)).toBe(49);
    expect(map.elevationAt(75, 75)).toBe(729);
    expect(map.elevationAt(49, 25)).toBeLessThan(0);
    expect(map.elevationAt(51, 25)).toBeGreaterThan(0);
  });

  it('reads classic units, LF line endings, legacy base64 and compressed saves', async () => {
    const source = save(classic, '\n');
    const encoded = btoa(encodeURIComponent(source));
    const compressed = gzipSync(new TextEncoder().encode(source));
    for (const map of [parseFmgMap(source), parseFmgMap(encoded), await readFmgMapFile(new Blob([new Uint8Array(compressed)]))]) {
      expect(map.metresPerPixel).toBeCloseTo(3218.688);
      expect(map.burgs[0].population).toBe(4500);
      expect(map.elevationAt(75, 25)).toBeCloseTo(7 ** 1.8);
    }
  });

  it('limits the drag to a square inside the map and keeps only burgs inside it', () => {
    const map = parseFmgMap(save(modern));
    const crop = dragFmgCrop(map, [100, 80], [40, 20]);
    expect(crop).toEqual({ x: 40, y: 20, side: 60 });
    expect(fmgBurgsInCrop(map, { x: 50, y: 30, side: 50 }).map(burg => burg.id)).toEqual([7]);
    expect(dragFmgCrop(map, [70, 95], [12, 100])).toEqual({ x: 65, y: 95, side: 5 });
  });

  it('loads a valid regional recipe with correctly scaled coordinates and elevations', () => {
    const map = parseFmgMap(save(modern));
    const crop = { x: 50, y: 20, side: 50 };
    const settings = fmgCropSettings(map, crop, 'Coastlands.map');
    expect(() => validateSettings(settings)).not.toThrow();
    expect(settings.extent).toBe(75000);
    expect(settings.naming?.title).toBe('Northern Shores');
    expect(settings.terrain?.sketch).toMatchObject({ processing: 'surface' });
    const { list } = effectiveRegion(settings).placement;
    expect(list).toMatchObject([
      { key: 'main', name: 'Eastwatch', population: 3000, position: { x: 37500, y: 69000 } },
      { key: 'fmg:2', name: 'Vík', population: 1500, position: { x: 22500, y: 7500 } },
    ]);
  });

  it('keeps empty terrain selections empty and reports normalized width', () => {
    const map = parseFmgMap(save(modern));
    expect(fmgCropExtent(map, { x: 0, y: 0, side: 100 })).toEqual({ width: 100000, original: 150000, resized: true });
    const settings = fmgCropSettings(map, { x: 0, y: 0, side: 10 }, 'Coastlands.map');
    expect(() => validateSettings(settings)).not.toThrow();
    expect(effectiveRegion(settings).placement.list).toEqual([]);
  });

  it('requires valid physical records and allows a user-defined width for custom FMG distance units', () => {
    expect(() => parseFmgMap('{"grid":42}')).toThrow('Azgaar .map');
    expect(() => parseFmgMap(save(modern, '\r\n', '9,35'))).toThrow('Azgaar .map');
    expect(() => parseFmgMap(save(modern, '\r\n', '9,,10,10'))).toThrow('Azgaar .map');
    const map = parseFmgMap(save(classic.replace(/^[a-z]+/, 'paces')));
    expect(map.metresPerPixel).toBeUndefined();
    expect(fmgCropExtent(map, { x: 0, y: 0, side: 10 }, 2200).width).toBe(2200);
  });
});
