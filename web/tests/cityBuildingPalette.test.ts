import { describe, expect, it } from 'vitest';
import { buildCityBuildings, type CityPalette } from '../src/render/cityCanvas';
import { buildingColors, DEFAULT_LAYERS, roofMaterialTable, type CityGlStyleState } from '../src/render/cityGlStyle';
import type { PlacementBatch } from '../../rust/bridge/urbanArchitecture';

const shape = { outer: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 10 }, { x: 0, y: 10 }], holes: [] };
function buildings(culture: string, tone: number) {
  return buildCityBuildings({ buildings: [{ id: 'lot', parcel_id: 'parcel', function: 'domestic', culture: { culture }, footprint: [shape], roof_footprint: [],
    programme: { massing: [{ floors: 1, eave_m: 3, rise_m: 0, roof: 'flat', wall: 'plaster', cover: 'earth', tone }] } }] } as unknown as PlacementBatch);
}
const state = (palette: CityPalette): CityGlStyleState => ({ view: 'buildings', lod: 'close', palette, layers: DEFAULT_LAYERS, buildingsVisible: true, diagnostic: 'none' });

describe('city plan palette', () => {
  it('retains native culture and resolved wall, cover and tone on the plan and roof faces', () => {
    const b = buildings('medina', 0.73);
    expect(b.items[0].material).toEqual({ culture: 'medina', wall: 'plaster', cover: 'earth', tone: 0.73 });
    expect(b.roofs?.cover[0]).toBe('earth'); expect(b.roofs?.wall?.[0]).toBe('plaster'); expect(b.roofs?.tone[0]).toBeCloseTo(0.73);
  });

  it('shows culture and independent lot tone on roofs in every palette without id jitter', () => {
    for (const palette of ['parchment', 'ink', 'terrain', 'atlas', 'growth'] as const) {
      const a = buildings('medina', 0.15), b = buildings('japanese-jokamachi', 0.15), c = buildings('medina', 0.85), s = state(palette);
      const roof = (v: typeof a) => Array.from(buildingColors(v, s).fill.slice(4, 7));
      expect(roof(a), palette).not.toEqual(roof(b)); expect(roof(a), palette).not.toEqual(roof(c));
      a.items[0].id = 'another-id'; expect(roof(a), palette).toEqual(roof(buildings('medina', 0.15)));
    }
  });

  it('preserves neighbouring roof shade differences on parchment, with stable face colours', () => {
    for (const culture of ['european-organic', 'medina', 'hanseatic', 'japanese-jokamachi', 'sahel']) {
      const roofs = Array.from({ length: 16 }, (_, i) => {
        const colors = buildingColors(buildings(culture, i / 15), state('parchment')).fill;
        return colors[4] * 0.3 + colors[5] * 0.59 + colors[6] * 0.11;
      });
      expect(Math.max(...roofs) - Math.min(...roofs), culture).toBeGreaterThan(25);
      expect(new Set(roofs).size, culture).toBeGreaterThanOrEqual(12);
    }
  });

  it('keeps role/use diagnostics independent of culture and disables texture for ink maps', () => {
    const a = buildings('medina', 0.15), b = buildings('japanese-jokamachi', 0.85);
    for (const s of [{ ...state('terrain'), view: 'roles' as const }, { ...state('terrain'), diagnostic: 'uses' }]) {
      expect(buildingColors(a, s).fill).toEqual(buildingColors(b, s).fill);
      expect(roofMaterialTable(a, s).every(v => v === 0)).toBe(true);
    }
    for (const palette of ['ink', 'parchment'] as const) expect(roofMaterialTable(a, state(palette)).every(v => v === 0)).toBe(true);
  });
});
