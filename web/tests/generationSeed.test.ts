import { describe, expect, it } from 'vitest';
import { readGenerationSeed, rerollSeed, seedRoot, seedSubset, setStepSeed, stepSeed } from '../../rust/bridge/generationSeed';
import { defaultSettings } from '../src/v2/settings';
import { terrainCacheKey } from '../src/v2/engine';
import { effectiveTerrainSettings } from '../src/v2/terrainSettings';
import { proceduralSignatures } from '../../rust/bridge/terrainCheckpoints';
import { cityStageValidityKeys, settlementStageValidityKeys } from '../src/v2/stageValidity';

describe('one general seed for the complete pipeline variation', () => {
  it('encodes independent choices, Unicode seeds and deterministic repeated draws in the seed string alone', () => {
    const base = 'Vallée 🌲', a = rerollSeed(base, ['relief-detail']), b = rerollSeed(a, ['city/main/streets']);
    expect(seedRoot(b)).toBe(base); expect(stepSeed(b, 'relief-detail')).toBe(stepSeed(a, 'relief-detail'));
    expect(stepSeed(b, 'city/main/streets')).not.toBe(base); expect(stepSeed(b, 'settle-sites')).toBe(base);
    expect(rerollSeed(a, ['city/main/streets'])).toBe(b);
    expect(readGenerationSeed(b).variations).toEqual({ 'relief-detail': 1, 'city/main/streets': 1 });
    expect(seedSubset(b, key => key.startsWith('city/'))).toBe(rerollSeed(base, ['city/main/streets']));
    expect(stepSeed(setStepSeed(b, 'city/main/streets', 'exact-choice'), 'city/main/streets')).toBe('exact-choice');
  });
  it('keeps terrain and placement keys exact when choosing a different internal street draw', () => {
    const settings = defaultSettings(), before = terrainCacheKey(settings), sites = settlementStageValidityKeys(settings);
    const scope = JSON.stringify(['selection', ['main']]), city = cityStageValidityKeys(settings, undefined, scope);
    settings.options.seed = rerollSeed(settings.options.seed, ['city/main/streets']);
    expect(terrainCacheKey(settings)).toBe(before); expect(settlementStageValidityKeys(settings)).toEqual(sites);
    const next = cityStageValidityKeys(settings, undefined, scope);
    expect(next.get('city-composition')).toBe(city.get('city-composition'));
    expect(next.get('city-roads')).not.toBe(city.get('city-roads'));
  });
  it('invalidates only terrain stages downstream of a changed stochastic choice', () => {
    const settings = defaultSettings(); settings.terrain = { procedural: { preset: 'classic' } }; settings.runtime!.source = 'procedural';
    const original = proceduralSignatures(effectiveTerrainSettings(settings, 2400));
    settings.options.seed = rerollSeed(settings.options.seed, ['relief-detail']);
    const detail = proceduralSignatures(effectiveTerrainSettings(settings, 2400));
    expect(detail.get('initialize')).toBe(original.get('initialize'));
    expect(detail.get('reconstruct')).toBe(original.get('reconstruct'));
    expect(detail.get('ridged')).not.toBe(original.get('ridged'));
    settings.options.seed = rerollSeed(seedRoot(settings.options.seed), ['water-hydrology']);
    const water = proceduralSignatures(effectiveTerrainSettings(settings, 2400));
    expect(water.get('normalize')).toBe(original.get('normalize')); expect(water.get('hydrology')).not.toBe(original.get('hydrology'));
  });
});
