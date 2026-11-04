import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/v2/settings';
import { normalizeRuntime, runtimeValues, setRuntimeChoice } from '../src/v2/runtimeChoices';

describe('Python selected from the desktop procedural startup', () => {
  it('activates neural Python and preserves it through normalization', () => {
    const settings = defaultSettings();
    settings.generation = 'procedural';
    settings.runtime = { backend: 'native', compute: 'cpu', source: 'procedural' };
    setRuntimeChoice(settings, 'neural', 'python');
    normalizeRuntime(settings);
    expect(settings.generation).toBe('neural');
    expect(settings.runtime).toMatchObject({ backend: 'native', source: 'neural-python', compute: 'auto' });
    expect(runtimeValues(settings).neural).toBe('python');
  });
});
