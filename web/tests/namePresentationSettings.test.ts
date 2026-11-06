import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/v2/settings';
import { parseProject, serializeProject, validateSettings } from '../src/v2/project';

describe('place-name presentation settings', () => {
  it('persists both modes and every supported display language', () => {
    for (const mode of ['cultural', 'localized'] as const) for (const displayLanguage of ['fr', 'en', 'ja', 'ar', 'es', 'pt', 'zh'] as const) {
      const settings = defaultSettings();
      settings.naming = { mode, displayLanguage, title: 'Tsing Tao', places: { main: 'Tsing Tao' } };
      expect(parseProject(serializeProject(settings)).settings.naming).toEqual(settings.naming);
    }
  });
  it('rejects unsupported presentation modes and languages on import', () => {
    const settings = defaultSettings();
    expect(() => validateSettings({ ...settings, naming: { mode: 'replace-proper-names' } })).toThrow();
    expect(() => validateSettings({ ...settings, naming: { displayLanguage: 'invalid' } })).toThrow();
  });
});
