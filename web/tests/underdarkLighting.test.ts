import { describe, expect, it } from 'vitest';
import { underdarkLightsOn, settlementLightsOn, underdarkLightingLook, underdarkSceneLook } from '../src/render/underdarkLighting';
import { cityGroundSettings } from '../src/render/cityEnvironment';
import { resolveAppearance } from '../src/render/appearanceRecipe';
import { presetComposition } from '../src/render/composition';
import { caveUniform, type BuildingFrame } from '../src/ui/urbanBuilding3d';

describe('Underdark inhabited-period lighting', () => {
  it('uses day for lights on underground and night for surface lamps', () => {
    expect(underdarkLightsOn('day')).toBe(true);
    expect(underdarkLightsOn('night')).toBe(false);
    expect(settlementLightsOn('day', true)).toBe(true);
    expect(settlementLightsOn('night', true)).toBe(false);
    expect(settlementLightsOn('day')).toBe(false);
    expect(settlementLightsOn('night')).toBe(true);
  });

  it('passes townGlow to 2D and 3D renderers only while lamps are on, retaining physical beds and town sites', () => {
    const towns = [{ center: { x: 100, y: 200 }, radius: 100 }];
    const on = underdarkSceneLook('underdark', 'day', towns);
    const off = underdarkSceneLook('underdark', 'night', towns);
    expect(on.townGlow).toEqual(new Float32Array([100, 200, 160]));
    expect(off.townGlow).toBeUndefined();
    expect(off.townSites).toEqual(on.townSites);
    expect(off.farmBeds).toEqual(on.farmBeds);
    expect(off.farmBeds?.some(x => x !== 0)).toBe(true);
    expect(underdarkLightingLook(off, 'day').townGlow).toEqual(on.townGlow);

    for (const ambience of ['day', 'night'] as const) {
      const composition = presetComposition('satellite'); composition.effects.ambience = ambience;
      const resolved = resolveAppearance({ style: 'parchment', composition }, { mapStyle: 'parchment' }, { nativeCities: true }, 'view3d', { biome: 'underdark' });
      const look = cityGroundSettings(resolved, 'render3d', { seed: 'cave', climate: { temperature: 12, precipitation: 800 },
        sourceCell: 4, relief: 'cavern', ...underdarkSceneLook('underdark', ambience, towns) });
      expect(look?.underdark).toBe(true);
      expect(look?.townGlow).toEqual(ambience === 'day' ? on.townGlow : undefined);
      expect(look?.farmBeds).toEqual(on.farmBeds);
      expect(look?.townSites).toEqual(on.townSites);
    }
  });

  it('keeps a dark cave and its fog when the existing building uniforms switch lamps off', () => {
    const frame = { cave: { light: .7, fog: [100, 300], eye: [0, 0, 0] } } as BuildingFrame;
    expect(caveUniform(frame, true)).toEqual([1, .7, 100, 300]);
    expect(caveUniform(frame, false)).toEqual([2, .08, 100, 300]);
    expect(caveUniform({} as BuildingFrame, false)).toEqual([0, 1, 1e9, 2e9]);
  });
});
