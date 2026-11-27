import { expect, it } from 'vitest';
import manifest from '../../../contributions/urban-cultures.json';
import { SettlementTerrain } from '../../../rust/pkg/wasm/magna_urbis_wasm.js';
import { loadCoreWasm } from '../../../rust/bridge/wasmRuntime';
import { defaultParcelConfig } from '../../../rust/bridge/urbanConfig';
import type { Layout, Partition, UrbanSite } from '../../../rust/bridge/urban';
import { defaultCityLayoutConfig } from '../../src/render/cityGeneration';
import { readMassing } from '../../src/render/cityMassing';
import { silhouetteScene, type CityBuilding, type CityPlacementRequest } from '../../src/ui/urbanSilhouettes';
import { codeBaseline, decodeCityCode, encodeCityCode } from '../../src/v2/cityCode';
import { urbanCultureChoices } from '../../src/v2/urbanControlSchema';

const pilot = manifest.find(entry => entry.id === 'copper-bastide')!;

it('offers and saves the contributed culture through the V2 controls', () => {
  expect(urbanCultureChoices()).toContainEqual({ value: pilot.id, label: pilot.label });
  const settings = codeBaseline();
  settings.options.culture = pilot.id;
  expect(decodeCityCode(encodeCityCode(settings)).settings.options.culture).toBe(pilot.id);
});

it('generates deterministic Copper Bastide buildings through the procedural WASM city stages', async () => {
  await loadCoreWasm();
  const width = 2400,
    n = 64,
    length = n * n,
    height = new Float32Array(length).fill(30),
    terrain = new SettlementTerrain(width, n, height, new Uint8Array(length), height, new Float32Array(length), new Int32Array(length).fill(-1));
  terrain.set_urban_geometry(
    JSON.stringify({
      land: [
        [
          { x: 0, y: 0 },
          { x: width, y: 0 },
          { x: width, y: width },
          { x: 0, y: width },
        ],
      ],
    }),
  );
  const seed = 'copper-bastide-pilot';
  const config = defaultCityLayoutConfig();
  config.houseComplexity = 'complex';
  config.footprint.budget = 'radius';
  const generate = (culture: string) => {
    const site: UrbanSite & { name: string } = { key: 'main', name: 'Copper Bastide Pilot', culture, population: 1800, center: { x: 1200, y: 1200 }, radius: 240 };
    const layouts = terrain.urban_quarters(seed, JSON.stringify([site]), JSON.stringify(config), '[]');
    const partitions = terrain.urban_parcels(seed, layouts, JSON.stringify(defaultParcelConfig()));
    const requests = JSON.parse(terrain.urban_building_sites(seed, layouts, partitions)) as CityPlacementRequest[];
    const scene = silhouetteScene(requests);
    const buildings: CityBuilding[] = scene.buildings;
    const homes = buildings.filter(b => b.culture.culture === culture && b.programme?.role?.startsWith('dwelling'));
    return { layout: (JSON.parse(layouts) as Layout[])[0], partition: (JSON.parse(partitions) as Partition[])[0], homes };
  };
  try {
    const baseline = generate(pilot.base);
    const variant = generate(pilot.id);
    const tints = (run: ReturnType<typeof generate>) => run.homes.flatMap(home => readMassing(home.programme, home.footprint, home.id)?.flatMap(piece => piece.tint ?? []) ?? []);
    expect(variant.layout.culture).toBe(pilot.id);
    expect(variant.layout.streets.length).toBeGreaterThan(0);
    expect(variant.partition.parcels.length).toBeGreaterThan(0);
    expect(baseline.homes.length).toBeGreaterThan(0);
    expect(variant.homes.length).toBeGreaterThan(0);
    expect(variant.homes[0].culture.pack).toBe(baseline.homes[0].culture.pack);
    expect(tints(baseline)).toEqual([]);
    const variantTints = tints(variant);
    expect(variantTints.length).toBeGreaterThan(0);
    const palette = new Set([...Object.keys(pilot.style.palette.homes), ...Object.keys(pilot.style.palette.special ?? {})]);
    expect(variantTints.every(color => palette.has(color))).toBe(true);
    expect(tints(generate(pilot.id))).toEqual(tints(variant));
  } finally {
    terrain.free();
  }
});
