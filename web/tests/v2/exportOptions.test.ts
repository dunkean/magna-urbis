import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import type { World } from '../../src/gen/types';
import type { TreeInputs } from '../../src/ui/terrain3dTrees';
import { exportTreeParts } from '../../src/v2/exportTrees';
import { mapMetadata } from '../../src/v2/exportMetadata';
import { encodeMapMesh, mapGlb } from '../../src/v2/meshFormats';
import type { MapMesh } from '../../src/v2/mapMesh';

const box = (x: number, y: number) => [
  { x, y },
  { x: x + 4, y },
  { x: x + 4, y: y + 4 },
  { x, y: y + 4 },
];
const area = { x: 0, y: 0, width: 80, height: 60 };

describe('export options', () => {
  it('joins edited names to the actual buildings, roads and rivers in the exported area', async () => {
    const house = { id: 'home/8', function: 'dwelling', footprint: [{ outer: box(5, 3), holes: [] }] };
    const remoteHouse = { id: 'home/9', function: 'dwelling', footprint: [{ outer: box(95, 3), holes: [] }] };
    const buildingId = 'urban:main:building:home%2F8';
    const world = {
      debug: { v2RustCities: { main: { layouts: [{ key: 'main', quarters: [] }], scene: { buildings: [house, remoteHouse] } } } },
      roads: [
        {
          id: 'r1',
          kind: 'track',
          path: [
            { x: -1, y: 2 },
            { x: 5, y: 2 },
          ],
        },
      ],
      terrain: {
        rivers: [
          {
            id: 7,
            cls: 'stream',
            path: [
              { x: 1, y: 6 },
              { x: 5, y: 1 },
            ],
          },
        ],
        lakes: [],
        coastline: [],
      },
      names: {
        town: 'Rive',
        entries: [
          { id: buildingId, text: 'Maison des Tilleuls' },
          { id: 'road-label', entityKey: 'road:r1', text: 'Chemin des Vignes' },
          { id: 'river-label', entityKey: 'river:7', text: 'Le Petit Roux' },
        ],
      },
    } as unknown as World;
    const metadata = mapMetadata(world, area, {});
    expect(metadata.features).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'building', name: 'Maison des Tilleuls', type: 'dwelling', sourceId: 'home/8' }),
        expect.objectContaining({ kind: 'road', name: 'Chemin des Vignes', type: 'track' }),
        expect.objectContaining({ kind: 'river', name: 'Le Petit Roux', type: 'stream' }),
      ]),
    );
    expect(metadata.features.some(f => f.sourceId === 'home/9')).toBe(false);
    expect(mapMetadata(world, area, { roads: false, water: false }).features.map(f => f.kind)).toEqual(['building']);
    const features = [{ sourceId: 'home/8', firstTriangle: 0, triangleCount: 1 }];
    const scene: MapMesh = {
      width: 80,
      depth: 60,
      lowestPoint: 0,
      highestPoint: 3,
      origin: { x: 0, y: 0 },
      metadata,
      parts: [{ name: 'Buildings', color: '#ffffff', positions: new Float32Array([1, 0, 1, 3, 0, 1, 2, 3, 1]), normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), featureRanges: features }],
    };
    const glb = mapGlb(scene);
    const json = JSON.parse(strFromU8(glb.subarray(20, 20 + new DataView(glb.buffer).getUint32(12, true))));
    expect(json.scenes[0].extras.map).toEqual(JSON.parse(JSON.stringify(metadata)));
    expect(json.meshes[0].primitives[0].extras.features).toEqual(features);
    const zip = unzipSync((await encodeMapMesh(scene, 'obj', 'test')).bytes);
    expect(JSON.parse(strFromU8(zip['map-metadata.json'])).objects[0].features).toEqual(features);
  });

  it('turns retained forest crowns into finite triangles and omits them over water', () => {
    const rgba = new Uint8Array(16 * 16 * 4);
    for (let i = 0; i < rgba.length; i += 4) rgba.set([220, 110, 30, 140], i);
    const base: TreeInputs = { field: { x: 0, y: 0, width: 160, n: 16, rgba, key: 'test' }, seed: 27, climate: { temperature: 10, precipitation: 900 }, renderV2: 1, zone: 0, season: 0.5, height: () => 5, water: () => 0 };
    const collect = (inputs: TreeInputs) => {
      const job = exportTreeParts(inputs, area);
      let part = job.next();
      while (!part.done) part = job.next();
      return part.value;
    };
    const parts = collect(base);
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.every(p => p.name === 'Trees' && p.positions.every(Number.isFinite) && p.positions.length === p.normals.length)).toBe(true);
    expect(collect({ ...base, water: () => 1 })).toEqual([]);
  });
});
