import type { CoastOpt } from '../../gen/options';
import type { ExternalCityHints } from './types';

/** Booleans of watabou URLs: '1' / 'true' or '0' / 'false'; anything else (or absent) stays undefined. */
function flag(params: URLSearchParams, key: string): boolean | undefined {
  const value = params.get(key)?.trim().toLowerCase();
  return value === '1' || value === 'true' ? true : value === '0' || value === 'false' ? false : undefined;
}
function positive(params: URLSearchParams, key: string): number | undefined {
  const value = Number(params.get(key));
  return params.has(key) && Number.isFinite(value) && value > 0 ? value : undefined;
}
/** Seed text: the URL seed, else the remaining parameters, so the same link always gives the same city. */
function seedOf(params: URLSearchParams, prefix: string): string {
  const seed = params.get('seed')?.trim();
  if (seed) return `${prefix}-${seed}`;
  const rest = [...params].filter(([key]) => key !== 'preview').sort(([a], [b]) => a.localeCompare(b));
  return `${prefix}-${new URLSearchParams(rest).toString() || '0'}`;
}
/** MFCG `sea` direction (0 = east, 0.5 = north, 1 = west, 1.5 = south) to the nearest coast side. */
export function coastSide(sea: number): CoastOpt {
  const quadrant = ((Math.round(sea * 2) % 4) + 4) % 4;
  return (['E', 'N', 'W', 'S'] as const)[quadrant];
}
/** Inverse of Azgaar FMG's MFCG size: size = 2.13 · (people / density)^0.385 with its default urban density 10. */
function populationFromSize(size: number): number {
  return Math.round(10 * Math.pow(Math.min(100, Math.max(6, size)) / 2.13, 1 / 0.385));
}

function parseCity(params: URLSearchParams): ExternalCityHints {
  const hints: ExternalCityHints = { source: 'watabou-city', seed: seedOf(params, 'mfcg') };
  const name = params.get('name')?.trim();
  if (name) hints.name = name;
  const population = positive(params, 'population'),
    size = positive(params, 'size');
  if (population !== undefined) hints.population = Math.round(population);
  else if (size !== undefined) hints.population = populationFromSize(size);
  const river = flag(params, 'river');
  if (river !== undefined) hints.river = river ? 'river' : 'none';
  const coast = flag(params, 'coast');
  if (coast !== undefined) {
    const sea = params.has('sea') ? Number(params.get('sea')) : NaN;
    hints.coast = !coast ? 'none' : Number.isFinite(sea) ? coastSide(sea) : 'random';
  }
  const set = <K extends 'walls' | 'citadel' | 'urbanCastle' | 'plaza' | 'temple' | 'shantytown' | 'farms'>(key: K, param: string) => {
    const value = flag(params, param);
    if (value !== undefined) hints[key] = value;
  };
  set('walls', 'walls');
  set('citadel', 'citadel');
  set('urbanCastle', 'urban_castle');
  set('plaza', 'plaza');
  set('temple', 'temple');
  set('shantytown', 'shantytown');
  set('farms', 'farms');
  if (flag(params, 'hub')) hints.roads = 4;
  return hints;
}

function parseVillage(params: URLSearchParams): ExternalCityHints {
  const hints: ExternalCityHints = { source: 'watabou-village', seed: seedOf(params, 'village') };
  const name = params.get('name')?.trim();
  if (name) hints.name = name;
  const pop = positive(params, 'pop');
  if (pop !== undefined) hints.population = Math.round(pop);
  if (params.has('tags')) {
    const tags = new Set(
      (params.get('tags') ?? '')
        .split(',')
        .map(tag => tag.trim().toLowerCase())
        .filter(Boolean),
    );
    // A village without a water tag lies inland, away from rivers.
    hints.river = 'none';
    hints.coast = 'none';
    if (tags.has('estuary')) {
      hints.river = 'river';
      hints.coast = 'random';
    }
    if (tags.has('island') || tags.has('coast')) hints.coast = 'random';
    if (tags.has('confluence')) hints.river = 'major';
    else if (tags.has('river')) hints.river = 'stream';
    if (tags.has('highway')) hints.roads = 4;
    else if (tags.has('dead end')) hints.roads = 1;
    else if (tags.has('isolated')) hints.roads = 0;
    if (tags.has('palisade')) {
      hints.walls = true;
      hints.palisade = true;
    }
    if (tags.has('no square')) hints.plaza = false;
    if (tags.has('sparse')) hints.sprawl = 1.5;
    else if (tags.has('dense')) hints.sprawl = 0.75;
    if (tags.has('uncultivated')) hints.farms = false;
    else if (tags.has('farmland')) hints.farms = true;
  }
  const style = params.get('style')?.trim().toLowerCase();
  if (style === 'sand') hints.biome = 'desert';
  else if (style === 'snow') hints.biome = 'tundra';
  return hints;
}

/** A watabou Medieval Fantasy City Generator or Village Generator link (as Azgaar FMG writes them), else null. */
export function parseWatabouUrl(text: string): ExternalCityHints | null {
  const compact = text.replace(/\s/g, '');
  if (!/^https?:\/\//i.test(compact)) return null;
  let url: URL;
  try {
    url = new URL(compact);
  } catch {
    return null;
  }
  if (url.hostname.toLowerCase() !== 'watabou.github.io') return null;
  const path = url.pathname.toLowerCase();
  if (/^\/(city-generator|city)(\/|$)/.test(path)) return parseCity(url.searchParams);
  if (/^\/village-generator(\/|$)/.test(path)) return parseVillage(url.searchParams);
  return null;
}
