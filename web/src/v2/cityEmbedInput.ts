import { parseAzgaarBurg } from './externalCity/azgaar';
import type { ExternalCityHints } from './externalCity/types';
import type { Rect4, View } from '../render/view';

/** Public embed input: the existing export JSON or FMG's flat city parameters. */
export function cityEmbedSource(url: URL): string {
  const fragment = new URLSearchParams(url.hash.slice(1));
  const burg = fragment.get('burg');
  if (burg !== null) {
    if (burg.length > 65536) throw new Error('City payload is too large.');
    let data: unknown;
    try {
      data = JSON.parse(burg);
    } catch {
      throw new Error('Invalid city payload.');
    }
    if (!data || typeof data !== 'object' || !('format' in data) || data.format !== 'fmg-burg-v1') throw new Error('Expected an fmg-burg-v1 city payload.');
    return burg;
  } else {
    const p = url.searchParams;
    if (!['name', 'seed', 'population', 'size'].some(key => p.has(key))) throw new Error('No city data supplied.');
    // Let the shared importer interpret Watabou flags, size and sea direction. Additional FMG context
    // uses the same units and culture mapping as our console export (population is already people).
    const n = (key: string) => (p.has(key) && p.get(key) !== '' && Number.isFinite(Number(p.get(key))) ? Number(p.get(key)) : undefined);
    const flag = (key: string) => (/^(1|true)$/i.test(p.get(key) ?? '') ? true : /^(0|false)$/i.test(p.get(key) ?? '') ? false : undefined);
    const watabou = new URL('https://watabou.github.io/city-generator/');
    watabou.search = p.toString();
    watabou.searchParams.delete('lang');
    return JSON.stringify({
      format: 'fmg-burg-v1',
      i: p.get('id') ?? 0,
      mfcg: watabou.href,
      capital: flag('capital'),
      port: flag('port'),
      elevation: n('elevation'),
      temperature: n('temperature'),
      precipitation: n('precipitation'),
      culture: { name: p.get('culture'), base: p.get('cultureBase'), type: p.get('cultureType') },
      biome: { id: n('biomeId'), name: p.get('biome') },
    });
  }
}

export function cityEmbedHints(source: string): ExternalCityHints {
  const hints = parseAzgaarBurg(source);
  if (!hints) throw new Error('Invalid city payload.');
  return hints;
}

export function cityEmbedEditorUrl(url: URL, source = cityEmbedSource(url)): string {
  const editor = new URL('./v2.html', url);
  const language = url.searchParams.get('lang');
  if (language) editor.searchParams.set('lang', language);
  editor.hash = new URLSearchParams({ city: source }).toString();
  return editor.href;
}

/** Use the dry town's bounds. Water and external approaches can extend beyond the frame. */
export function cityEmbedView({ minX, minY, maxX, maxY }: Rect4, width: number, height: number): View {
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, scale: Math.min(Math.max(1, width) / Math.max(80, maxX - minX), Math.max(1, height) / Math.max(80, maxY - minY)) * 0.87 };
}
