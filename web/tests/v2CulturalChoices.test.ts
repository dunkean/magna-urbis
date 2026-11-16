import { describe, expect, it } from 'vitest';
import { culturalChoice } from '../../rust/bridge/culturalChoices';
import { defaultSettings } from '../src/v2/settings';
import { urbanControlFields } from '../src/v2/urbanControlSchema';

describe('resolved cultural control choices', () => {
  it('resolves every control offering From culture from the native catalogue', () => {
    const expected: Record<string, string> = { tissue: 'grid', fortification: 'wall', preset: 'roman-core/core', operator: 'courtyard', axisAlignment: 'road' };
    const fields = urbanControlFields().filter(f => f.options?.some(o => o.value === 'culture'));
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      const key = field.path.split('.').at(-1)!;
      expect(culturalChoice('roman-core', key, { population: 300 }), field.path).toBe(expected[key]);
    }
  });
  it('uses the chosen zone, recipe and explicit morphology parameters', () => {
    expect(culturalChoice('roman-core', 'preset', { zone: 'middle' })).toBe('roman-core/ring');
    expect(culturalChoice('roman-core', 'operator', { params: { plotOp: 'garden' } })).toBe('garden');
    expect(culturalChoice('japanese-jokamachi', 'fortification')).toBe('none');
  });
  it('opens new maps in Satellite', () => {
    expect(defaultSettings().appearance?.composition?.preset).toBe('satellite');
  });
});
