/** Small retained scene for UI regression, with no native service or generation. */
import { mkdir, writeFile } from 'node:fs/promises';
import { defaultSettings } from '../src/v2/settings';
import { serializeProject } from '../src/v2/project';
import type { World } from '../src/gen/types';
const settings = defaultSettings();
settings.extent = 1000;
settings.region = { autoBuildPopulation: 0, placement: { mode: 'counts', counts: { city: 1, town: 2, village: 3, hamlet: 4, farmstead: 5 } } };
settings.appearance = { renderer: 'classic', style: 'parchment' };
settings.runtime = { backend: 'rust', compute: 'cpu', source: 'procedural' };
const square = (x: number, y: number, size: number) => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];
const grid = (value: number) => ({ w: 20, h: 20, cell: 50, data: new Float32Array(400).fill(value) });
const footprint = square(200, 200, 200),
  parcel = square(240, 240, 80),
  house = square(260, 260, 30);
const urban = {
  footprint: [footprint],
  footprintH: [{ outer: footprint, holes: [] }],
  streets: [],
  blocks: [],
  parcels: [
    { poly: parcel, use: 'housing', block: 0, nativeId: 'parcel-1' },
    { poly: square(330, 240, 60), use: 'housing', block: 0, nativeId: 'parcel-2' },
  ],
  buildings: [{ poly: house, kind: 'house', storeys: 2, roof: 'gable', nativeRequestId: 'house-1', nativeParcelId: 'parcel-1' }],
  landmarks: [],
  squares: [],
  archetype: 'plain',
  population: 2500,
  morphology: 'organic',
  phases: [],
  quarters: [{ poly: { outer: footprint, holes: [] }, phase: 0, zone: 'core', streetSpace: [], nativeId: '0' }],
  blockInfo: [],
  masses: [],
  backLand: [],
};
const world = {
  seed: settings.options.seed,
  mapSize: 1000,
  options: settings.options,
  stats: {},
  urban,
  terrain: { height: grid(20), slope: grid(0), flow: grid(1), seaLevel: 0, seaFraction: 0, coastline: [], lakes: [], water: new Uint8Array(400), receiver: new Int32Array(400).fill(-1), filled: new Float32Array(400).fill(20), downSide: 'S', seaSide: null, rivers: [] },
  settlements: [
    { key: 'main', main: true, name: 'Test City', population: 2500, cls: 'town', culture: 'european-organic', archetype: 'plain', center: { x: 300, y: 300 }, radius: 120, extent: footprint, region: footprint },
    { key: 'village', name: 'Test Village', population: 80, cls: 'village', culture: 'european-organic', archetype: 'plain', center: { x: 700, y: 700 }, radius: 30, extent: square(670, 670, 60), region: square(650, 650, 100) },
  ],
  roads: [],
  debug: {
    v2RustRegion: {
      placement: {
        activities: [
          {
            id: 'mill-1',
            template: 'watermill',
            parent: 'main',
            kind: 'mill',
            resource: 'grain',
            culture: 'european-organic',
            x: 600,
            y: 400,
            ground: 20,
            residents: 0,
            buildings: [],
            installations: [],
            access: { x: 600, y: 400 },
            accessClass: 'track',
            mode: 'attached_external',
            anchor: 'river',
            seasonMask: 15,
          },
        ],
      },
    },
  },
  names: { family: 'english', town: 'Test City', entries: [] },
} as unknown as World;
await mkdir('out/workbench-layout', { recursive: true });
await writeFile('out/workbench-layout/fixture.json', serializeProject(settings, world));
