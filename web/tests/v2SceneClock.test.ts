import { describe, expect, it } from 'vitest';
import { applySceneClock, sceneSun, validateSceneClock } from '../src/v2/sceneClock';
import { defaultSettings } from '../src/v2/settings';
import { parseProject, serializeProject } from '../src/v2/project';
import { writeAppearanceControl } from '../src/v2/renderControls';
import { terrainCacheKey } from '../src/v2/engine';

describe('scene calendar and solar lighting', () => {
  it('puts the northern sun south at noon, east in the morning and west in the afternoon', () => {
    const scene = { date: '2026-06-21', time: '12:00', latitude: 45 };
    expect(sceneSun(scene).azimuth).toBeCloseTo(180, 3);
    expect(sceneSun(scene).altitude).toBeCloseTo(68.5, 0);
    expect(sceneSun({ ...scene, time: '08:00' }).azimuth).toBeLessThan(180);
    expect(sceneSun({ ...scene, time: '16:00' }).azimuth).toBeGreaterThan(180);
  });
  it('handles night and polar day without invalid lighting values', () => {
    expect(sceneSun({ date: '2026-06-21', time: '00:00', latitude: 45 }).ambience).toBe('night');
    expect(sceneSun({ date: '2026-06-21', time: '00:00', latitude: 80 }).ambience).toBe('day');
    expect(sceneSun({ date: '2026-12-21', time: '12:00', latitude: 80 }).ambience).toBe('night');
    for (const latitude of [-90, 0, 90]) expect(Number.isFinite(sceneSun({ date: '2024-02-29', time: '12:00', latitude }).azimuth)).toBe(true);
  });
  it('reverses the annual cycle in the southern hemisphere', () => {
    const scene = { date: '2026-07-01', time: '12:00', latitude: 45 };
    expect(sceneSun(scene).season).toBeCloseTo(.5, 1);
    expect((sceneSun({ ...scene, latitude: -45 }).season + 1) % 1).toBeCloseTo(.996, 2);
  });
  it('supports historical years without the JavaScript short-year date shortcut', () => {
    const sun = sceneSun({ date: '0001-07-01', time: '12:00', latitude: 45 });
    expect(sun.season).toBeCloseTo(.5, 1);
    expect(sun.altitude).toBeGreaterThan(65);
  });
  it('validates dates including leap days and rejects incomplete or impossible input', () => {
    expect(() => validateSceneClock({ date: '2024-02-29', time: '23:59', latitude: -90 })).not.toThrow();
    for (const patch of [{ date: '2026-02-29' }, { date: '2026-13-01' }, { date: '0000-01-01' }, { time: '24:00' }, { time: '' }, { latitude: 91 }, { latitude: NaN }])
      expect(() => validateSceneClock({ date: '2026-01-01', time: '12:00', latitude: 45, ...patch })).toThrow();
  });
  it('round trips the clock and disables solar shadows at night without changing terrain generation', () => {
    const settings = defaultSettings(), before = terrainCacheKey(settings);
    const scene = { date: '2026-12-21', time: '00:00', latitude: 45 };
    applySceneClock(settings, scene);
    const loaded = parseProject(serializeProject(settings)).settings;
    expect(loaded.scene).toEqual(scene);
    expect(loaded.appearance?.composition?.effects).toMatchObject({ ambience: 'night', lighting: { enabled: false, elevation: 5 } });
    expect(terrainCacheKey(settings)).toBe(before);
  });
  it('keeps clock lighting across style changes and returns to manual mode on a direct light edit', () => {
    const settings = defaultSettings(); applySceneClock(settings, { date: '2026-12-21', time: '12:00', latitude: 45 });
    const light = { ...settings.appearance!.composition!.effects.lighting };
    writeAppearanceControl(settings, 'appearance.composition.preset', 'atlas');
    expect(settings.appearance?.composition?.effects.lighting).toMatchObject({ azimuth: light.azimuth, elevation: light.elevation, enabled: light.enabled });
    expect(settings.scene).toBeDefined();
    writeAppearanceControl(settings, 'appearance.composition.effects.lighting.azimuth', 270);
    expect(settings.scene).toBeUndefined();
    expect(settings.appearance?.composition?.effects.lighting.azimuth).toBe(270);
  });
  it('keeps old projects in manual mode and rejects invalid persisted clocks', () => {
    expect(parseProject(serializeProject(defaultSettings())).settings.scene).toBeUndefined();
    const settings = defaultSettings(); settings.scene = { date: '2026-02-30', time: '12:00', latitude: 45 };
    expect(() => serializeProject(settings)).toThrow();
  });
});
