import { afterEach, describe, expect, it } from 'vitest';
import { CLIMATE_ZONE_VALUES } from '../../rust/bridge/terrainClimate';
import { mapGroundSnow, setMapClimateZone, setMapSeason } from '../src/render/seasonPalette';
import { roofSnowPatches, snowRoofTint, townRoofAltitudes } from '../src/render/roofSnow';
import { roofLight } from '../src/render/cityMassing';

afterEach(() => { setMapSeason(.5, undefined, {}); setMapClimateZone(undefined); });
describe('physical roof snow and relief', () => {
  it('keeps one snow altitude per town and separates neighbouring towns', () => {
    const altitudes = townRoofAltitudes([{ id: 'a', parcel_id: 'layout-one/block-a/parcel-1', ground_z_m: 80 },
      { id: 'b', parcel_id: 'layout-one/block-b/parcel-2', ground_z_m: 120 },
      { id: 'c', parcel_id: 'layout-two/block-a/parcel-1', ground_z_m: 800 }]);
    expect(altitudes.get('a')).toBe(100); expect(altitudes.get('b')).toBe(100); expect(altitudes.get('c')).toBe(800);
  });
  it('keeps a mild lowland winter bare and snow at alpine winter altitude', () => {
    setMapSeason(0, 'temperate', {}); setMapClimateZone('temperate', CLIMATE_ZONE_VALUES.temperate);
    expect(mapGroundSnow(0)).toBe(0);
    setMapClimateZone('alpine', CLIMATE_ZONE_VALUES.alpine);
    expect(mapGroundSnow(900)).toBe(1);
    setMapSeason(.5, 'alpine', {});
    expect(mapGroundSnow(900)).toBe(0);
  });
  it('uses the numerical climate and calendar rather than only the season label', () => {
    setMapSeason(0, 'alpine', { winterCold: 0 });
    setMapClimateZone('alpine', { ...CLIMATE_ZONE_VALUES.alpine, temperature: 23 });
    expect(mapGroundSnow(0)).toBe(0);
    expect(mapGroundSnow(4000)).toBe(1);
  });
  it('covers low pitches, covers steep pitches with one uniform patch, and excludes walls', () => {
    const points = [{ x: 0, y: 0, z: 3 }, { x: 10, y: 0, z: 3 }, { x: 10, y: 6, z: 6 }, { x: 0, y: 6, z: 6 }];
    const low = roofSnowPatches(points, [0, -.2, .98]);
    const steep = roofSnowPatches(points, [0, -.8, .6]);
    expect(low).toHaveLength(1); expect(low[0].weight).toBeGreaterThan(.95);
    expect(steep).toHaveLength(1); expect(steep[0].weight).toBeGreaterThan(.95);
    expect(steep.every(p => p.points.every(v => v.x > 0 && v.x < 10 && v.y > 0 && v.y < 6))).toBe(true);
    expect(roofSnowPatches(points, [0, 1, 0])).toHaveLength(0);
  });
  it('retains strong face separation on low-pitch roofs and cool snow in shade', () => {
    expect(roofLight([-.2, -.2, .959]) - roofLight([.2, .2, .959])).toBeGreaterThan(.5);
    const shade = snowRoofTint([.3, .3, .3], 1, -.4), lit = snowRoofTint([.3, .3, .3], 1, .3);
    expect(lit[0]).toBeGreaterThan(shade[0]); expect(shade[2]).toBeGreaterThan(shade[0]);
    expect(snowRoofTint([.3, .4, .5], 0, -.4)).toEqual([.3, .4, .5]);
  });
});
