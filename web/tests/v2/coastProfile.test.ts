import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../src/v2/settings';
import { effectiveTerrainSettings, validateTerrainSettings } from '../../src/v2/terrainSettings';
import { coastTraceMode, lineFromStroke } from '../../src/v2/coastTrace';
import { proceduralSignatures } from '../../../rust/bridge/terrainCheckpoints';
import { DEFAULT_COAST_PROFILE } from '../../../rust/bridge/terrainCoastProfile';

describe('coastal controls', () => {
  it('exposes only the median width and variability of coastal smoothing', () => {
    expect(effectiveTerrainSettings(defaultSettings(), 4000).coastProfile).toEqual({ width: 250, variability: 0.5 });
  });
  it('keeps the trace and merges partial coastal controls at the execution boundary', () => {
    const s = defaultSettings();
    const trace = { version: 1 as const, lines: [lineFromStroke([0.25, 0.1, 0.3, 0.5, 0.25, 0.9])!] };
    s.terrain = { coastMask: 0, coastTrace: trace, coastProfile: { width: 800 } };
    const effective = effectiveTerrainSettings(s, 8000);
    expect(effective.coastProfile).toEqual({ ...DEFAULT_COAST_PROFILE, width: 800 });
    expect(effective.islandMode).toBe(coastTraceMode(trace));
    expect(s.terrain.coastTrace).toBe(trace);
    expect(() => validateTerrainSettings({ coastProfile: effective.coastProfile })).not.toThrow();
  });
  it('invalidates coastal checkpoints and downstream water when any control changes', () => {
    const s = effectiveTerrainSettings(defaultSettings(), 8000);
    s.coastMask = 4;
    const before = proceduralSignatures(s);
    for (const profile of [
      { ...s.coastProfile, width: 800 },
      { ...s.coastProfile, variability: 0.8 },
    ]) {
      const after = proceduralSignatures({ ...s, coastProfile: profile });
      expect(after.get('initialize')).toBe(before.get('initialize'));
      for (const stage of ['coastCut', 'coasts', 'hydrology'] as const) expect(after.get(stage)).not.toBe(before.get(stage));
    }
  });
  it('rejects nonfinite, out-of-range and misspelled profile settings', () => {
    for (const profile of [{ width: NaN }, { width: -1 }, { width: 10001 }, { variability: NaN }, { variability: -0.1 }, { variability: 1.1 }, { cliffs: 0 }, { detail: 1 }, { relief: 1 }, { smoothing: 1 }, []]) {
      expect(() => validateTerrainSettings({ coastProfile: profile })).toThrow();
    }
  });
});
