import { describe, expect, it } from 'vitest';
import { defaultHouseConfig, encodeHouseReplay } from '../../rust/bridge/houses';
import { readUrbanHouseModel, urbanHouseModelCode } from '../src/ui/urbanHouseModel';

const view = { mode: 'roof' as const, level: 0, graph: false, dimensions: false };
describe('existing Houses models applied to an urban batch', () => {
  it('accepts the same replay code and links, preserving every configuration override', () => {
    const config = defaultHouseConfig(); config.recipe = 'EUR-MED-B04'; config.seed = 'modèle de ferme';
    config.overrides.roof = 'RF-GABLE'; config.overrides.floors = 2; config.size = 0.8;
    const code = encodeHouseReplay(config, view, 'houses-test');
    for (const text of [code, `replay=${code}`, `http://localhost:5173/housebench.html?houses=v1&replay=${code}`, `http://localhost:5173/rustbench.html#houses?houses=v1&replay=${code}`]) {
      const decoded = readUrbanHouseModel(text); expect(decoded).toEqual(config); expect(decoded).not.toBe(config);
    }
    expect(readUrbanHouseModel(urbanHouseModelCode(config))).toEqual(config);
  });
  it('clears only on an explicit empty applied input and requires explicit applied Fantasy for free presets and rejects invalid replay sources', () => {
    expect(readUrbanHouseModel('  ')).toBeUndefined();
    expect(() => readUrbanHouseModel('bad replay')).toThrow();
    expect(() => readUrbanHouseModel('http://localhost/housebench.html')).toThrow(/code replay/);
    const config = defaultHouseConfig();
    config.workshop = { preset_id: 'free', footprint: null, roof: null, width_m: null, depth_m: null, roof_frame: null, base: null, support: null };
    expect(() => readUrbanHouseModel(encodeHouseReplay(config, view, 'houses-test'), 'fantasy')).toThrow(/house_config_workshop_mode/);
    config.mode = 'fantasy_mix'; config.workshop.width_m = 13.7; config.workshop.depth_m = 17.4;
    const code = encodeHouseReplay(config, view, 'houses-test');
    expect(() => readUrbanHouseModel(code, 'inspired')).toThrow(/programme Fantasy/);
    expect(() => readUrbanHouseModel(code)).toThrow(/programme Fantasy/);
    expect(readUrbanHouseModel(code, 'fantasy')).toEqual(config);
  });
});
