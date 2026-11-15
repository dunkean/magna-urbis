import { describe, expect, it } from 'vitest';
import { TARGET_LANGUAGES, collectEnglishSources, loadFeatureModules, missingTranslations } from './localeCoverageHelper';

describe('V2 locale coverage', () => {
  it('has a translation in every non-English-source language for every English string the V2 can show', async () => {
    const modules = await loadFeatureModules();
    const sources = collectEnglishSources();
    expect(sources.all.length).toBeGreaterThan(500);
    for (const language of TARGET_LANGUAGES) {
      expect(missingTranslations(language, sources.all), `${language} (skipped modules: ${JSON.stringify(modules.skipped)})`).toEqual([]);
    }
  });
});
