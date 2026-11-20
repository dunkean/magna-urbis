import { expect, it } from 'vitest';
import type { PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import styles from '../../rust/crates/core/src/urban/forms/styles.json';
import { roofFrame } from '../src/render/city/buildingLook';
import { buildCityBuildings } from '../src/render/city/model/buildings';
import { silhouetteBuilding } from '../src/render/city3d/silhouette';
import { BlockGrouping, blockLevel, blockPart, worldPaint, worldSeat } from '../src/render/world/buildingsBlocks';
import { BUILDING_STRIDE } from '../src/render/world/buildingsMesh';

it('keeps the shaded roof pans of a Newar house in the world overview', () => {
  const tradition = styles.cultures.newar.traits.tradition;
  const footprint = [
    {
      outer: [
        { x: 96, y: 90 },
        { x: 104, y: 90 },
        { x: 104, y: 110 },
        { x: 96, y: 110 },
      ],
      holes: [],
    },
  ];
  const eave = 3 * tradition.storeys[0];
  const source = {
    id: 'newar-house',
    parcel_id: 'p1',
    recipe_id: 'silhouette',
    ground_z_m: 0,
    footprint,
    roof_footprint: footprint,
    culture: { culture: 'newar' },
    function: 'domestic',
    volumes: [],
    structural_features: [],
    programme: { role: 'house', massing: [{ floors: tradition.storeys[0], eave_m: eave, rise_m: 4 * Math.tan((tradition.pitch * Math.PI) / 180), roof: tradition.roof, ridges: [[100, 94, 100, 106]], cover: tradition.cover, wall: tradition.wall, openings: 'door' }] },
  } as unknown as PlacedBuilding;
  const scene = { buildings: [silhouetteBuilding(source)] };
  const town = buildCityBuildings({ buildings: [source] });
  const relief = { width: 256, low: 0, high: 0, heightAt: () => 0 };
  const grouping = new BlockGrouping(scene, relief, 1);
  expect(grouping.step(Infinity)).toBe(true);
  const block = grouping.blocks[0];
  const paint = worldPaint(scene, { style: 'cartographic', diagnostic: 'none', smoothRoofs: true }, grouping.altitudes, { frame: roofFrame({ palette: 'terrain', mpp: 1, dpr: 1, diagnostic: 'none' }), item: id => town.items[town.byId.get(id)!] });
  const seat = worldSeat(relief, 1);
  const vertices = (pixels: number) => blockPart(block, blockLevel(block, pixels), paint, seat, 0, block.buildings.length);
  const roofColors = (data: Float32Array) => {
    const pans = new Map<string, number>();
    for (let i = 0; i < data.length; i += BUILDING_STRIDE) {
      const nx = data[i + 3],
        up = data[i + 4],
        ny = data[i + 5];
      const length = Math.hypot(nx, up, ny);
      if (data[i + 1] < eave || up / length < 0.1) continue;
      const direction = [nx, ny].map(v => Math.round((v / length) * 100)).join(',');
      pans.set(direction, Math.abs(data[i + 6]));
    }
    return pans;
  };
  const detailed = vertices(12),
    overview = vertices(8);
  const pans = roofColors(overview);
  expect(pans).toEqual(roofColors(detailed));
  expect(pans.size).toBe(4);
  expect(Math.max(...pans.values()) - Math.min(...pans.values())).toBeGreaterThan(0.03);
  expect(overview.length).toBeLessThan(detailed.length);
  expect([...roofColors(vertices(4)).keys()]).toEqual(['0,0']);
});
