/** Public iframe input adapter, used by cityEmbed and contract tests to reuse the studio's city import and recipe validation. */
import { parseAzgaarBurg } from './externalCity/azgaar';
import { applyExternalCity } from './externalCity/apply';
import { defaultSettings } from './settings';
import { presetComposition } from '../render/composition';
import { validateSettings } from './project';
import type { V2Settings } from './contracts';
import type { World, Vec2 } from '../gen/types';
import type { View } from '../render/view';

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

export function cityEmbedSettings(url: URL): V2Settings {
  const hints = parseAzgaarBurg(cityEmbedSource(url));
  if (!hints) throw new Error('Invalid city payload.');
  const settings = applyExternalCity(hints, defaultSettings());
  // A single procedural town, CPU/WASM, no hardware probe, neural models, erosion pass or house plans.
  // These are ordinary V2 recipe settings. The full editor receives the original source constraints.
  settings.generation = 'procedural';
  delete settings.decor;
  settings.local = {};
  settings.terrain = { ...settings.terrain, resolution: 128, erosion: 0, generationCompute: 'cpu', forest: { ...settings.terrain?.forest, enabled: false } };
  settings.region = { ...settings.region, resolution: 128, autoBuildPopulation: 0 };
  settings.runtime = { backend: 'rust', autoBackend: false, source: 'procedural', compute: 'cpu' };
  settings.urban = { backend: 'rust', architecture: 'silhouette', through: 'buildings' };
  settings.appearance = { style: 'parchment', composition: presetComposition('minimal') };
  validateSettings(settings);
  return settings;
}

export function cityEmbedEditorUrl(source: URL): string {
  const editor = new URL('./v2.html', source);
  const language = source.searchParams.get('lang');
  if (language) editor.searchParams.set('lang', language);
  editor.hash = new URLSearchParams({ city: cityEmbedSource(source) }).toString();
  return editor.href;
}

/** Frame the actual city rather than the full terrain extent. Roads outside it do not shrink the town. */
export function cityEmbedView(world: World, width: number, height: number): View {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const include = (points: readonly Vec2[]) => {
    for (const p of points)
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
  };
  const urban = world.settlements?.find(place => place.main || place.key === 'main')?.urban ?? world.urban;
  for (const block of urban?.blocks ?? []) include(block);
  for (const building of urban?.buildings ?? []) include(building.poly);
  for (const landmark of urban?.landmarks ?? []) include(landmark.poly);
  for (const wall of urban?.walls ?? []) include(wall.path);
  if (!Number.isFinite(minX)) {
    const place = world.settlements?.find(place => place.main || place.key === 'main');
    const center = place?.core ?? place?.center ?? { x: world.mapSize / 2, y: world.mapSize / 2 };
    const span = Math.min(world.mapSize, 1500);
    minX = center.x - span / 2;
    maxX = center.x + span / 2;
    minY = center.y - span / 2;
    maxY = center.y + span / 2;
  }
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, scale: Math.min(Math.max(1, width) / Math.max(250, maxX - minX), Math.max(1, height) / Math.max(250, maxY - minY)) * 0.86 };
}
