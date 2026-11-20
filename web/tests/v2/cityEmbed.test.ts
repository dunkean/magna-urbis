import { describe, expect, it } from 'vitest';
import { cityEmbedSettings, cityEmbedEditorUrl, cityEmbedView } from '../../src/v2/cityEmbedInput';
import { decodeCityCode } from '../../src/v2/cityCode';
import type { World } from '../../src/gen/types';
import { randomCityEmbedUrl } from '../../src/v2/cityEmbedDemo';
import { cityEmbedMessages, cityEmbedSummary } from '../../src/v2/cityEmbedMessages';
import { registerMessages, translate } from '../../src/v2/i18n';

describe('city iframe contract', () => {
  it('registers French UI copy and preserves the requested language in navigation', () => {
    registerMessages(cityEmbedMessages);
    expect(translate('Generating city…', 'fr')).toBe('Génération de la ville…');
    expect(translate('🎲 Randomize city', 'fr')).toBe('🎲 Tout changer');
    expect(translate('City payload is too large.', 'fr')).toBe('Les données de la ville sont trop volumineuses.');
    const url = new URL('https://example.org/sub/embed.html?preview=1&name=Harbour&population=2500&lang=fr');
    expect(new URL(cityEmbedEditorUrl(url)).searchParams.get('lang')).toBe('fr');
    expect(randomCityEmbedUrl(url, () => 0.3).searchParams.get('lang')).toBe('fr');
    expect(cityEmbedSummary(cityEmbedSettings(url).options, 'Imported culture')).toContain('Imported culture');
  });
  it('randomizes the actual city inputs and replaces a rich payload instead of leaving it in precedence', () => {
    const old = new URL('https://example.org/sub/embed.html?preview=1&cultureBase=English&population=2500&seed=old#burg=old-payload');
    const next = randomCityEmbedUrl(old, () => 0.3);
    expect(next.pathname).toBe('/sub/embed.html');
    expect(next.hash).toBe('');
    expect(next.searchParams.get('cultureBase')).toBe('Chinese');
    expect(next.searchParams.get('seed')).not.toBe('old');
    const settings = cityEmbedSettings(next);
    expect(settings.options.population).not.toBe(2500);
    expect(settings.options.river).toBe('river');
    expect(settings.options.language).toBe('chinese');
    expect(next.searchParams.get('demo')).toBe('1');
  });
  it('imports flat FMG parameters and keeps the source constraints in the editor link', () => {
    const url = new URL('https://example.org/sub/embed.html?preview=1&name=Harbour&population=3200&seed=12340007&coast=1&sea=0.5&river=1&walls=1&port=1&cultureBase=German&temperature=8&precipitation=900');
    const settings = cityEmbedSettings(url);
    expect(settings.options).toMatchObject({ population: 3200, coast: 'N', river: 'river', walls: 'single', port: 'yes', language: 'german' });
    expect(settings.terrain).toMatchObject({ resolution: 128, erosion: 0, climateValues: { temperature: 8, precipitation: 900 } });
    expect(settings.runtime).toMatchObject({ backend: 'rust', autoBackend: false, compute: 'cpu', source: 'procedural' });
    expect(settings.region?.placement?.list).toHaveLength(1);
    const editor = new URL(cityEmbedEditorUrl(url));
    expect(editor.pathname).toBe('/sub/v2.html');
    const full = decodeCityCode(editor.href).settings;
    expect(full.options).toMatchObject({ population: 3200, coast: 'N', river: 'river', walls: 'single', port: 'yes', language: 'german' });
    expect(full.region?.placement?.list?.[0].name).toBe('Harbour');
  });

  it('preserves rich exporter context', () => {
    const data = { format: 'fmg-burg-v1', i: 7, name: 'Skarholm', population: 2500, mfcgSeed: 'map0007', river: false, coast: null, elevation: 100, temperature: 5, precipitation: 800, culture: { base: 'Nordic', type: 'Generic' }, biome: { id: 9, name: 'Taiga' } };
    const url = new URL('https://example.org/embed.html?preview=1&population=1');
    url.hash = new URLSearchParams({ burg: JSON.stringify(data) }).toString();
    const settings = cityEmbedSettings(url);
    expect(settings.options).toMatchObject({ population: 2500, river: 'none', coast: 'none', language: 'norse' });
    expect(settings.naming?.places?.main).toBe('Skarholm');
    expect(settings.terrain?.climateValues).toMatchObject({ precipitation: 800 });
  });

  it('shows invalid payload errors rather than generating an unrelated default city', () => {
    expect(() => cityEmbedSettings(new URL('https://example.org/embed.html#burg=bad'))).toThrow('Invalid city payload.');
    expect(() => cityEmbedSettings(new URL('https://example.org/embed.html?preview=1'))).toThrow('No city data');
    expect(() => cityEmbedSettings(new URL('https://example.org/embed.html#burg=%7B%22format%22:%22unknown%22%7D'))).toThrow('fmg-burg-v1');
    expect(() => cityEmbedSettings(new URL('https://example.org/embed.html#burg=' + 'x'.repeat(65537)))).toThrow('too large');
  });

  it('fits the city, independent of terrain extent and distant regional roads', () => {
    const world = {
      mapSize: 40000,
      urban: {
        blocks: [
          [
            { x: 1000, y: 2000 },
            { x: 2000, y: 3000 },
          ],
        ],
      },
    } as unknown as World;
    expect(cityEmbedView(world, 400, 320)).toEqual({ cx: 1500, cy: 2500, scale: 0.2752 });
    expect(cityEmbedView({ mapSize: 6000 } as World, 0, 0).scale).toBeGreaterThan(0);
  });
});
