import { parseAzgaarBurg } from './externalCity/azgaar';
import type { ExternalCityHints } from './externalCity/types';
import type { Rect4, View } from '../render/view';
import { applyExternalCity } from './externalCity/apply';
import { defaultSettings } from './settings';
import { presetComposition } from '../render/composition';
import type { V2Settings } from './contracts';
import type { Vec2, World } from '../gen/types';
import { polygonArea } from '../gen/core/geom';

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

export function cityEmbedHints(source: string): ExternalCityHints {
  const hints = parseAzgaarBurg(source);
  if (!hints) throw new Error('Invalid city payload.');
  return hints;
}

export function cityEmbedSettings(hints: ExternalCityHints, local: boolean): V2Settings {
  const settings = applyExternalCity(hints, defaultSettings());
  const backend = local ? 'native' : 'rust';
  settings.generation = 'procedural';
  delete settings.decor;
  settings.local = {};
  settings.terrain = { ...settings.terrain, resolution: 128, relief: 'flat', erosion: 0, generationCompute: local ? undefined : 'cpu', forest: { ...settings.terrain?.forest, enabled: false } };
  if (hints.river === 'none') settings.terrain.hydrology = { ...settings.terrain.hydrology, enabled: false };
  settings.region = { ...settings.region, resolution: 128, autoBuildPopulation: 0 };
  const site = settings.region.placement?.list?.[0];
  if (site && hints.port && hints.coast && hints.coast !== 'none') site.siteType = 'harbor';
  settings.runtime = { backend, autoBackend: false, source: 'procedural', compute: 'cpu' };
  settings.urban = { backend, architecture: 'silhouette', through: 'buildings' };
  settings.appearance = { style: 'parchment', composition: presetComposition('minimal') };
  return settings;
}

/** Fit the visible urban fabric. Country tracks and isolated lots may lie far from the built town. */
export function cityEmbedBounds(world: World): Rect4 {
  const place = world.settlements?.find(town => town.main || town.key === 'main');
  const urban = place?.urban ?? world.urban;
  const buildings = urban?.buildings ?? [];
  const enclosure = (urban?.walls ?? []).filter(wall => wall.closed && wall.path.length >= 3).reduce<Vec2[] | undefined>((best, wall) => (!best || Math.abs(polygonArea(wall.path)) > Math.abs(polygonArea(best)) ? wall.path : best), undefined);
  const points: Vec2[] = [];
  if (enclosure) points.push(...enclosure);
  else if (buildings.length) {
    for (const building of buildings) for (const point of building.poly) points.push(point);
  } else for (const block of urban?.blocks ?? []) for (const point of block) points.push(point);
  const x = points
    .map(p => p.x)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const y = points
    .map(p => p.y)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!x.length || !y.length) {
    const center = place?.core ?? place?.center ?? world.site?.center ?? { x: world.mapSize / 2, y: world.mapSize / 2 };
    const half = Math.min(world.mapSize, 1250) / 2;
    return { minX: center.x - half, minY: center.y - half, maxX: center.x + half, maxY: center.y + half };
  }
  // Trim sparse outliers before fitting. The margin still leaves room for town walls and the near fringe.
  const extent = (values: number[]) => {
    const trim = !enclosure && buildings.length >= 30 ? Math.floor(values.length * 0.025) : 0;
    const min = values[trim],
      max = values[values.length - 1 - trim];
    const margin = Math.max(18, (max - min) * 0.12);
    return [min - margin, max + margin] as const;
  };
  const [minX, maxX] = extent(x);
  const [minY, maxY] = extent(y);
  return { minX, minY, maxX, maxY };
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
