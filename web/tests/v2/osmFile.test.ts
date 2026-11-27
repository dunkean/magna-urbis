import { expect, it } from 'vitest';
import { clipOsmArea, clipOsmLine } from '../../src/v2/osm/osmCrop';
import { osmFileQuery, osmQueryScript, parseOsmFile } from '../../src/v2/osm/osmFile';
import { fitOsmFile, intersectsOsmBounds } from '../../src/v2/osm/osmFilePreview';
import { osmImportFeatures, osmProjection } from '../../src/v2/osm/osmSources';

it('loads direct Overpass geometry and derives a crop without expanding to the commune boundary', () => {
  const boundary = {
    type: 'relation',
    id: 7,
    tags: { boundary: 'administrative', admin_level: '8', name: 'Test commune' },
    members: [
      {
        type: 'way',
        role: 'outer',
        geometry: [
          { lat: 46, lon: 1 },
          { lat: 48, lon: 3 },
        ],
      },
    ],
  };
  const way = {
    type: 'way',
    id: 8,
    tags: { highway: 'residential' },
    geometry: [
      { lat: 47, lon: 2 },
      { lat: 47.005, lon: 2.005 },
    ],
  };
  const { osm, bounds } = parseOsmFile(JSON.stringify({ elements: [boundary, way], osm3s: { timestamp_osm_base: '2026-11-27T00:00:00Z' } }));
  expect(bounds).toEqual({ south: 47, west: 2, north: 47.005, east: 2.005 });
  expect(osm.osm3s?.timestamp_osm_base).toBe('2026-11-27T00:00:00Z');
  expect(osmImportFeatures(osm, 'Test commune').commune).toEqual(boundary);
  expect(osm.elements).toEqual([way, boundary]);
  const square = fitOsmFile(bounds, 500, 20_000);
  expect(square.size).toBeGreaterThan(500);
  expect(square.size).toBeLessThan(600);
  expect(intersectsOsmBounds(bounds, osmProjection(square).bounds)).toBe(true);
  expect(intersectsOsmBounds(bounds, osmProjection({ ...square, lat: 48 }).bounds)).toBe(false);
});

it('resolves node and member references and honors declared bounds in a wider extract', () => {
  const shape = [
    { lat: 45, lon: 4 },
    { lat: 45, lon: 5 },
    { lat: 46, lon: 5 },
  ];
  const bounds = { minlat: 45.1, minlon: 4.1, maxlat: 45.9, maxlon: 4.9 };
  const nodes = shape.map((coord, id) => ({ type: 'node', id, ...coord }));
  const way = { type: 'way', id: 10, nodes: [0, 1, 2, 0] };
  const relation = { type: 'relation', id: 20, tags: { natural: 'water', type: 'multipolygon' }, members: [{ type: 'way', role: 'outer', ref: 10 }] };
  const parsed = parseOsmFile(JSON.stringify({ bounds, elements: [relation, ...nodes, way] }));
  expect(parsed.bounds).toEqual({ south: 45.1, west: 4.1, north: 45.9, east: 4.9 });
  expect(parsed.osm.elements).toEqual([{ type: 'relation', id: 20, tags: relation.tags, members: [{ type: 'way', role: 'outer', geometry: [...shape, shape[0]] }] }]);
});

it('rejects unfinished Overpass replies and files without geometries', () => {
  expect(() => parseOsmFile('{"elements":[],"remark":"Query timed out"}')).toThrow('Query timed out');
  expect(() => parseOsmFile('{"elements":[{"type":"way","id":1,"tags":{"highway":"primary"},"nodes":[2,3]}]}')).toThrow('No OSM features with geometry');
  expect(() => parseOsmFile('{"type":"FeatureCollection","features":[]}')).toThrow('Expected Overpass JSON or OpenStreetMap XML');
});

it('generates a manual query and a shell script for the current square and feature choices', () => {
  const square = { lat: 43.2, lon: 2.35, size: 1000 };
  const query = osmFileQuery(square, 'A "quoted" town', false);
  expect(query).toContain(osmProjection(square).bbox);
  expect(query).toContain('[timeout:180]');
  expect(query).toContain('["admin_level"="8"]["name"="A \\"quoted\\" town"]');
  expect(query).not.toContain('["building"]');
  const script = osmQueryScript(query);
  expect(script).toContain(`<<'OVERPASS'\n${query}\nOVERPASS\n`);
  expect(script).toContain('${1:-https://overpass.private.coffee/api/interpreter}');
  expect(script).toContain('mv "$result" openstreetmap.json');
});

it('retains lines crossing the full crop and leaves missing reference gaps disconnected', () => {
  expect(
    clipOsmLine(
      [
        { x: -20, y: 50 },
        { x: 140, y: 50 },
      ],
      100,
    ),
  ).toEqual([
    [
      { x: 0, y: 50 },
      { x: 100, y: 50 },
    ],
  ]);
  expect(clipOsmLine([{ x: 10, y: 10 }, { x: 30, y: 30 }, null, { x: 60, y: 60 }, { x: 80, y: 80 }], 100)).toEqual([
    [
      { x: 10, y: 10 },
      { x: 30, y: 30 },
    ],
    [
      { x: 60, y: 60 },
      { x: 80, y: 80 },
    ],
  ]);
});

it('keeps a crop contained by a water polygon and preserves an interior island', () => {
  const box = (low: number, high: number) => [
    { x: low, y: low },
    { x: high, y: low },
    { x: high, y: high },
    { x: low, y: high },
  ];
  const result = clipOsmArea({ outer: box(-100, 200), holes: [box(25, 75)] }, 100);
  expect(result).toHaveLength(1);
  expect(new Set(result[0].outer.map(({ x, y }) => `${x},${y}`))).toEqual(new Set(['0,0', '100,0', '100,100', '0,100']));
  expect(result[0].holes).toHaveLength(1);
  expect(new Set(result[0].holes[0].map(({ x, y }) => `${x},${y}`))).toEqual(new Set(['25,25', '75,25', '75,75', '25,75']));
  expect(clipOsmArea({ outer: box(101, 200), holes: [] }, 100)).toEqual([]);
});
