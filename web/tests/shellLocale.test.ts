import { describe, expect, it } from 'vitest';
import { resolveLocale } from '../src/ui/shellLocale';

describe('interface locale selection', () => {
  it('recognizes language tags and falls back to French', () => {
    expect(resolveLocale('en-US')).toBe('en');
    expect(resolveLocale('zh-Hans-CN')).toBe('zh');
    expect(resolveLocale('pt_BR')).toBe('pt');
    expect(resolveLocale('es-ES')).toBe('es');
    expect(resolveLocale('fr-FR')).toBe('fr');
    expect(resolveLocale('de')).toBe('fr');
    expect(resolveLocale(null)).toBe('fr');
  });
});
