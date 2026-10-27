import { afterEach, describe, expect, it, vi } from 'vitest';
import { translateRecipeError } from '../src/ui/recipeLocale';

afterEach(() => vi.unstubAllGlobals());

describe('recipe error translation', () => {
  it.each([
    ['fr', 'Code incomplet, corrompu ou trop volumineux.'],
    ['en', 'Code is incomplete, corrupted or too large.'],
    ['zh', '代码不完整、已损坏或过大。'],
    ['es', 'El código está incompleto, dañado o es demasiado grande.'],
    ['pt', 'O código está incompleto, corrompido ou é grande demais.'],
  ])('translates a corrupt code in %s without hiding unknown errors', (locale, expected) => {
    vi.stubGlobal('localStorage', { getItem: () => locale });
    vi.stubGlobal('navigator', { language: 'en' });
    expect(translateRecipeError('Code incomplet, corrompu ou trop volumineux.')).toBe(expected);
    expect(translateRecipeError('unexpected underlying error')).toBe('unexpected underlying error');
  });
});
