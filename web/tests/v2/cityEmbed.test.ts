import { cityEmbedBounds, cityEmbedSettings } from '../../src/v2/cityEmbedGeneration';
import { describe, expect, it } from 'vitest';
import { cityEmbedHints, cityEmbedEditorUrl, cityEmbedSource, cityEmbedView } from '../../src/v2/cityEmbedInput';
import type { World } from '../../src/gen/types';
import { worldToScreen } from '../../src/render/view';
import { decodeCityCode } from '../../src/v2/cityCode';
import { cityEmbedPopulationUrl, randomCityEmbedUrl } from '../../src/v2/cityEmbedDemo';
import { cityEmbedSummary, cityEmbedText } from '../../src/v2/cityEmbedMessages';

const read = (url: URL) => cityEmbedHints(cityEmbedSource(url));

describe('city iframe contract', () => {
  it('registers French UI copy and preserves the requested language in navigation', () => {
    expect(cityEmbedText('City preview', 'fr')).toBe('Aperçu de la ville');
    expect(cityEmbedText('Open in Magna Urbis ↗', 'fr')).toBe('Ouvrir dans Magna Urbis ↗');
    expect(cityEmbedText('🎲 Randomize city', 'fr')).toBe('🎲 Tout changer');
    const url = new URL('https://example.org/sub/embed.html?preview=1&name=Harbour&population=2500&lang=fr');
    expect(new URL(cityEmbedEditorUrl(url)).searchParams.get('lang')).toBe('fr');
    expect(randomCityEmbedUrl(url, () => 0.3).searchParams.get('lang')).toBe('fr');
    expect(cityEmbedSummary(read(url), 'Imported culture')).toContain('Imported culture');
  });

  it('applies a population change to the effective source without changing the burg seed', () => {
    const flat = new URL('https://example.org/sub/embed.html?preview=1&lang=fr&profile=local&name=Harbour&seed=42&coast=1&sea=0&population=2500');
    const flatEdit = cityEmbedPopulationUrl(flat, 6500);
    expect(read(flatEdit)).toMatchObject({ name: 'Harbour', seed: 'mfcg-42', population: 6500, coast: 'E' });
    expect(flat.searchParams.get('population')).toBe('2500');
    expect(flatEdit.searchParams.get('profile')).toBe('local');
    expect(flatEdit.searchParams.get('lang')).toBe('fr');

    const unseeded = new URL('https://example.org/embed.html?preview=1&name=Harbour&size=24');
    const unseededEdit = cityEmbedPopulationUrl(unseeded, 600);
    expect(read(unseededEdit)).toMatchObject({ seed: read(unseeded).seed, population: 600 });

    const rich = new URL(flat.href);
    const burg = { format: 'fmg-burg-v1', i: 42, name: 'Skarholm', mfcgSeed: '12340042', population: 2500, walls: true, coast: { water: 'ocean', sea: 0.5 } };
    rich.hash = new URLSearchParams({ burg: JSON.stringify(burg), lang: 'fr' }).toString();
    const richEdit = cityEmbedPopulationUrl(rich, 7500);
    expect(read(richEdit)).toMatchObject({ name: 'Skarholm', seed: 'mfcg-12340042', population: 7500, walls: true, coast: 'N' });
    expect(new URLSearchParams(richEdit.hash.slice(1)).get('lang')).toBe('fr');
    expect(JSON.parse(new URLSearchParams(new URL(cityEmbedEditorUrl(richEdit)).hash.slice(1)).get('city')!)).toEqual({ ...burg, population: 7500 });
  });

  it('randomizes the actual city inputs and replaces a rich payload', () => {
    const old = new URL('https://example.org/sub/embed.html?preview=1&cultureBase=English&population=2500&seed=old#burg=old-payload');
    const next = randomCityEmbedUrl(old, () => 0.3);
    expect(next.pathname).toBe('/sub/embed.html');
    expect(next.hash).toBe('');
    expect(next.searchParams.get('cultureBase')).toBe('Chinese');
    expect(next.searchParams.get('seed')).not.toBe('old');
    expect(read(next)).toMatchObject({ river: 'river', language: 'chinese' });
    expect(read(next).population).not.toBe(2500);
    expect(next.searchParams.get('demo')).toBe('1');
  });

  it('imports flat FMG parameters and keeps the original constraints in the studio link', () => {
    const url = new URL('https://example.org/sub/embed.html?preview=1&name=Harbour&population=3200&seed=12340007&coast=1&sea=0.5&river=1&walls=1&port=1&cultureBase=German&temperature=8&precipitation=900');
    expect(read(url)).toMatchObject({ name: 'Harbour', seed: 'mfcg-12340007', population: 3200, coast: 'N', river: 'river', walls: true, port: true, language: 'german' });
    const editor = new URL(cityEmbedEditorUrl(url));
    expect(editor.pathname).toBe('/sub/v2.html');
    expect(editor.searchParams.has('preview')).toBe(false);
    const full = decodeCityCode(editor.href).settings;
    expect(full.options).toMatchObject({ population: 3200, coast: 'N', river: 'river', walls: 'single', port: 'yes', language: 'german' });
    expect(full.region?.placement?.list?.[0].name).toBe('Harbour');
    expect(full.terrain?.climateValues).toMatchObject({ temperature: 8, precipitation: 900 });
  });

  it('preserves the source payload and coast direction, including zero east', () => {
    const data = { format: 'fmg-burg-v1', i: 7, name: 'Skarholm', population: 2500, mfcgSeed: 'map0007', river: false, coast: { water: 'ocean', sea: 0 }, culture: { base: 'Nordic', type: 'Generic' } };
    const url = new URL('https://example.org/embed.html?preview=1&population=1');
    url.hash = new URLSearchParams({ burg: JSON.stringify(data) }).toString();
    expect(read(url)).toMatchObject({ population: 2500, river: 'none', coast: 'E', language: 'norse' });
    expect(cityEmbedSettings(read(url), false)).toMatchObject({ runtime: { backend: 'rust', compute: 'cpu' }, urban: { backend: 'rust', architecture: 'silhouette', through: 'buildings' } });
    expect(cityEmbedSettings(read(url), true)).toMatchObject({ runtime: { backend: 'native' }, urban: { backend: 'native' } });
    expect(new URLSearchParams(new URL(cityEmbedEditorUrl(url)).hash.slice(1)).get('city')).toBe(JSON.stringify(data));
  });

  it('shows invalid payload errors rather than generating an unrelated default city', () => {
    expect(() => read(new URL('https://example.org/embed.html#burg=bad'))).toThrow('Invalid city payload.');
    expect(() => read(new URL('https://example.org/embed.html?preview=1'))).toThrow('No city data');
    expect(() => read(new URL('https://example.org/embed.html#burg=%7B%22format%22:%22unknown%22%7D'))).toThrow('fmg-burg-v1');
    expect(() => read(new URL('https://example.org/embed.html#burg=' + 'x'.repeat(65537)))).toThrow('too large');
  });

  it('frames built geometry without fitting distant blocks or approaches or stretching the map', () => {
    const city = {
      mapSize: 8000,
      urban: {
        buildings: [
          {
            poly: [
              { x: 400, y: 400 },
              { x: 600, y: 500 },
            ],
          },
        ],
        blocks: [[{ x: 7500, y: 7500 }]],
        streets: [{ path: [{ x: 8000, y: 8000 }] }],
      },
    } as unknown as World;
    const bounds = cityEmbedBounds(city);
    expect(bounds.maxX).toBeLessThan(650);
    for (const [width, height] of [
      [620, 320],
      [190, 600],
    ]) {
      const view = cityEmbedView(bounds, width, height);
      expect(view.cx).toBe(500);
      expect(view.cy).toBe(450);
      const [cx, cy] = worldToScreen(view, width, height, 500, 450);
      const [x, y] = worldToScreen(view, width, height, 510, 460);
      expect(x - cx).toBeCloseTo(y - cy);
    }
    expect(cityEmbedView(bounds, 0, 0).scale).toBeGreaterThan(0);
  });
});
