import { describe, expect, it } from 'vitest';
import { coreOperations, proceduralSignatures, TerrainFieldCheckpoints } from '../../rust/bridge/terrainCheckpoints';
import { validateProceduralRecipe } from '../../rust/bridge/terrainGenerationRecipe';
import { stageLed, terrainStageValidityKeys } from '../src/v2/stageValidity';
import { stagesForAction, stagesOf, stageForProgress } from '../src/v2/stageRegistry';
import { defaultSettings } from '../src/v2/settings';
import type { TerrainSettings } from '../../rust/bridge/terrain';

const base: TerrainSettings = { source: 'procedural', seed: 'resume', width: 5000, motifSize: 3000, relief: 'mountains', erosion: 1, mountainMix: .5, resolution: 128, procedural: { biome: true, wind: { iterations: 2, transport: .2 } }, coastMask: 255 };
describe('retained relief dependencies', () => {
  it('keeps regional erosion for changes to the surface, wind, coast finishing and output resolution', () => {
    const before = proceduralSignatures(base);
    for (const patch of [{ procedural: { ...base.procedural, surfaceN: 128 } }, { erosionTuning: { surfaceIterations: 20 } },
      { procedural: { ...base.procedural, wind: { iterations: 5, transport: .2 } } }, { procedural: { ...base.procedural, coastIterations: 4 } }, { resolution: 512 }]) {
      const after = proceduralSignatures({ ...base, ...patch });
      for (const stage of ['initialize', 'regional', 'regionalFinish', 'reconstruct', 'amplitude', 'ridged'] as const) expect(after.get(stage), stage).toBe(before.get(stage));
    }
    const wind = proceduralSignatures({ ...base, procedural: { ...base.procedural, wind: { iterations: 5, transport: .2 } } });
    expect(wind.get('posterior')).toBe(before.get('posterior')); expect(wind.get('wind')).not.toBe(before.get('wind'));
    expect(proceduralSignatures({ ...base, seed: 'new' }).get('initialize')).not.toBe(before.get('initialize'));
    const compact={...base,procedural:{...base.procedural,preset:'compact' as const}};
    expect(proceduralSignatures({...compact,phasor:{quality:'detailed'}}).get('initialize')).not.toBe(proceduralSignatures(compact).get('initialize'));
    expect(proceduralSignatures({...compact,phasor:{intensity:.5}}).get('initialize')).toBe(proceduralSignatures(compact).get('initialize'));
  });
  it('invalidates from the moved or modified coastal cut, preserving the unchanged prefix', () => {
    expect(coreOperations(base).slice(0, 3)).toEqual(['initialize', 'coastCut', 'regional']);
    const moved = { ...base, procedural: { ...base.procedural, coastAfter: 'surface' as const } };
    expect(coreOperations(moved).slice(-3)).toEqual(['surface', 'coastCut', 'normalize']);
    expect(proceduralSignatures(moved).get('initialize')).toBe(proceduralSignatures(base).get('initialize'));
    expect(proceduralSignatures(moved).get('regional')).not.toBe(proceduralSignatures(base).get('regional'));
    const rows = stagesOf('region', 'surface').map(s => s.id);
    expect(rows.indexOf('relief-coast-cut')).toBe(rows.indexOf('relief-surface') + 1);
    expect(stagesForAction('terrain', undefined, 'relief-regional', 'surface')).not.toContain('relief-coast-cut');
    expect(stageForProgress('pipeline:coastCut:cached')).toBe('relief-coast-cut');
    expect(() => validateProceduralRecipe({ coastAfter: 'surface' })).not.toThrow();
    expect(() => validateProceduralRecipe({ coastAfter: 'prepare' } as never)).toThrow();
  });
  it('keeps checkpoint fields independent from the renderer and each new execution', () => {
    const cache = new TerrainFieldCheckpoints(), source = Float32Array.of(1, 2, 3, 4);
    cache.put('wind', 'a', source); source[0] = 100;
    const first = cache.get('wind', 'a')!; expect(first[0]).toBe(1); first[1] = 200;
    expect(cache.get('wind', 'a')![1]).toBe(2); expect(cache.get('wind', 'b')).toBeUndefined();
    cache.put('wind', 'b', source); expect(cache.get('wind', 'a')).toBeUndefined();
  });
  it('tracks shared erosion controls even when an earlier consumer is disabled', () => {
    const disabled={...base,procedural:{...base.procedural,enabled:{regional:false,surface:false}}};
    const before=proceduralSignatures(disabled);
    const thermal=proceduralSignatures({...disabled,procedural:{...disabled.procedural,regionalThermal:false}});
    expect(thermal.get('regional')).toBe(before.get('regional'));
    expect(thermal.get('regionalFinish')).not.toBe(before.get('regionalFinish'));
    const coast=proceduralSignatures({...disabled,erosionTuning:{surfaceIncision:2}});
    expect(coast.get('surface')).toBe(before.get('surface'));
    expect(coast.get('coasts')).not.toBe(before.get('coasts'));
  });
  it('drives the three LED states from recipe identity, including edits outside the row', () => {
    expect(stageLed(false, false, 'a', 'a')).toBe('disabled');
    expect(stageLed(true, false, undefined, 'a')).toBe('pending');
    expect(stageLed(true, false, 'a', 'a')).toBe('valid');
    expect(stageLed(true, false, 'a', 'b')).toBe('pending');
    expect(stageLed(true, true, 'a', 'a')).toBe('running');
    const settings = defaultSettings(); settings.runtime = { ...settings.runtime!, source: 'procedural' }; settings.terrain = { procedural: { wind: { iterations: 2, transport: .2 } } };
    const before = terrainStageValidityKeys(settings); settings.terrain.procedural!.wind!.iterations = 4;
    const wind = terrainStageValidityKeys(settings);
    expect(wind.get('relief-regional')).toBe(before.get('relief-regional'));
    expect(wind.get('relief-aeolian')).not.toBe(before.get('relief-aeolian'));
    settings.options.seed += '-changed';
    expect(terrainStageValidityKeys(settings).get('relief-regional')).not.toBe(before.get('relief-regional'));
  });
});
