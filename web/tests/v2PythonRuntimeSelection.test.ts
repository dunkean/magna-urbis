import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../src/v2/settings';
import { normalizeRuntime, runtimeValues, setRuntimeChoice } from '../src/v2/runtimeChoices';

afterEach(() => vi.unstubAllGlobals());

describe('Python selected from the desktop procedural startup', () => {
  it('activates neural Python and preserves it through normalization', () => {
    // The web profile now forces Rust in the browser; native + Python are desktop/local-profile choices.
    vi.stubGlobal('window', { location: { hostname: 'localhost', protocol: 'http:', search: '?profile=local' } });
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
