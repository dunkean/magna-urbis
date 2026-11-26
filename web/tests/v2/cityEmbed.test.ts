import { describe, expect, it } from 'vitest';
import { cityEmbedHints, cityEmbedEditorUrl, cityEmbedSource, cityEmbedView } from '../../src/v2/cityEmbedInput';
import { detailCityPreview, generateCityPreview } from '../../src/v2/cityPreviewPlan';
import { bbox, polygonCentroid, polygonContains } from '../../src/gen/core/geom';
import { decodeCityCode } from '../../src/v2/cityCode';
import { randomCityEmbedUrl } from '../../src/v2/cityEmbedDemo';
import { cityEmbedSummary, cityEmbedText } from '../../src/v2/cityEmbedMessages';

const read = (url: URL) => cityEmbedHints(cityEmbedSource(url));

describe('city iframe contract', () => {
  it('registers French UI copy and preserves the requested language in navigation', () => {
    expect(cityEmbedText('Schematic preview', 'fr')).toBe('Aperçu schématique');
    expect(cityEmbedText('Open in Magna Urbis ↗', 'fr')).toBe('Ouvrir dans Magna Urbis ↗');
    expect(cityEmbedText('🎲 Randomize city', 'fr')).toBe('🎲 Tout changer');
    const url = new URL('https://example.org/sub/embed.html?preview=1&name=Harbour&population=2500&lang=fr');
    expect(new URL(cityEmbedEditorUrl(url)).searchParams.get('lang')).toBe('fr');
    expect(randomCityEmbedUrl(url, () => 0.3).searchParams.get('lang')).toBe('fr');
    expect(cityEmbedSummary(read(url), 'Imported culture')).toContain('Imported culture');
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

  it('preserves the source payload and the side of a lake shore, including zero east', () => {
    const data = {
      format: 'fmg-burg-v1',
      i: 7,
      name: 'Skarholm',
      population: 2500,
      mfcgSeed: 'map0007',
      river: false,
      coast: { water: 'lake', sea: 0 },
      elevation: 100,
      temperature: 5,
      precipitation: 800,
      culture: { base: 'Nordic', type: 'Generic' },
      biome: { id: 9, name: 'Taiga' },
    };
    const url = new URL('https://example.org/embed.html?preview=1&population=1');
    url.hash = new URLSearchParams({ burg: JSON.stringify(data) }).toString();
    expect(read(url)).toMatchObject({ population: 2500, river: 'none', coast: 'none', lakeShore: 'E', language: 'norse' });
    const draft = generateCityPreview(read(url));
    expect(draft.plan.water).toHaveLength(1);
    expect(bbox(draft.plan.water[0]).maxX).toBeGreaterThan(draft.plan.bounds.maxX);
    expect(new URLSearchParams(new URL(cityEmbedEditorUrl(url)).hash.slice(1)).get('city')).toBe(JSON.stringify(data));
  });

  it('shows invalid payload errors rather than generating an unrelated default city', () => {
    expect(() => read(new URL('https://example.org/embed.html#burg=bad'))).toThrow('Invalid city payload.');
    expect(() => read(new URL('https://example.org/embed.html?preview=1'))).toThrow('No city data');
    expect(() => read(new URL('https://example.org/embed.html#burg=%7B%22format%22:%22unknown%22%7D'))).toThrow('fmg-burg-v1');
    expect(() => read(new URL('https://example.org/embed.html#burg=' + 'x'.repeat(65537)))).toThrow('too large');
  });

  it('fits the dry town bounds and handles a very small iframe', () => {
    const bounds = { minX: -100, minY: -40, maxX: 100, maxY: 60 };
    expect(cityEmbedView(bounds, 400, 320)).toEqual({ cx: 0, cy: 10, scale: 1.52 });
    expect(cityEmbedView(bounds, 0, 0).scale).toBeGreaterThan(0);
  });
});

describe('two-stage schematic city plan', () => {
  it('keeps the plan, bridges and roads fixed as it adds detail on dry land', () => {
    const hints = read(new URL('https://example.org/embed.html?name=Port&population=10000&seed=12340012&river=1&coast=1&sea=0.5&port=1&walls=1'));
    const draft = generateCityPreview(hints);
    const first = structuredClone(draft.plan);
    expect(first.water).toHaveLength(2);
    expect(first.bridges).toHaveLength(1);
    expect(first.docks.length).toBeGreaterThan(0);
    expect(first.walls.length).toBeGreaterThan(0);
    expect(first.gates.length).toBeGreaterThan(0);
    const detail = detailCityPreview(draft);
    expect(detail.roofs.length).toBeGreaterThan(70);
    expect(detail.lanes.length).toBeGreaterThan(0);
    expect(draft.plan).toEqual(first);
    expect(generateCityPreview(hints).plan).toEqual(first);
    expect(detailCityPreview(generateCityPreview(hints))).toEqual(detail);
    for (const roof of detail.roofs) {
      expect(first.water.some(water => polygonContains(water, polygonCentroid(roof)))).toBe(false);
    }
  });

  it('keeps dwellings in small camps with requested landmarks', () => {
    const hints = read(new URL('https://example.org/embed.html?name=Karak+Ordu&population=100&seed=3521165402&cultureBase=Mongolian&cultureType=Nomadic&coast=0&river=0&temple=1&citadel=1&plaza=1'));
    const draft = generateCityPreview(hints);
    expect(draft.plan.blocks.length).toBeGreaterThan(0);
    expect(draft.plan.walls).toEqual([]);
    expect(draft.plan.water).toEqual([]);
    expect(detailCityPreview(draft).roofs.length).toBeGreaterThan(0);
  });
});
