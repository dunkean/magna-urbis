import { encodeCompact, decodeCompact } from '../ui/recipeCodec';
import defaults from './cityCodeDefaults.json';
import type { V2Settings, V2UrbanControls } from './contracts';
import { validateSettings, validateModifications } from './project';
import { adaptedExtent } from './settings';
import { effectiveTerrainSettings } from './terrainSettings';
import { effectiveRegion } from './regionSettings';
import { urbanEffectiveValues } from './urbanControls';
import { migrateUrbanSeeds } from './urbanSeeds';
import { readGenerationSeed, writeGenerationSeed } from '../../../rust/bridge/generationSeed';

export const CITY_CODE_PREFIX = 'MU3.';
// Frozen MU3 schema. The first three values encode the five essential choices:
// seed, biome/culture/relief packed into one integer, and region extent in metres.
// Optional trailing values are preset deltas, independent draws, and manual edits.
// Changing the tables or this baseline requires a new prefix.
const baseline = defaults.settings as V2Settings;
const schema = ['', 0, baseline.extent, baseline, {}, []];
type RecordValue = Record<string, any>;
const record = (v: unknown): v is RecordValue => !!v && typeof v === 'object' && !Array.isArray(v);
function equal(a: any, b: any): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  return record(a) && record(b) && Object.keys(a).length === Object.keys(b).length
    && Object.keys(a).every(k => Object.hasOwn(b, k) && equal(a[k], b[k]));
}
/** Remove explicit inherited defaults, keeping fields owned by the wire baseline.
 * Null, zero, false, arrays and unknown fields remain distinct from missing values. */
function sparse(value: RecordValue, inherited: RecordValue, owned: RecordValue = {}): RecordValue {
  const result: RecordValue = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    if (!Object.hasOwn(owned, key) && Object.hasOwn(inherited, key) && equal(item, inherited[key])) continue;
    if (record(item) && record(inherited[key])) {
      const child = sparse(item, inherited[key], record(owned[key]) ? owned[key] : {});
      if (Object.keys(child).length || Object.hasOwn(owned, key)) result[key] = child;
    } else result[key] = item;
  }
  return result;
}
function selectors(controls: V2UrbanControls, inherited: RecordValue): V2UrbanControls {
  const result: RecordValue = {};
  for (const stage of ['layout', 'parcels'] as const) if (controls[stage]) {
    const selected = Object.fromEntries(Object.entries(controls[stage]!).filter(([key, value]) => ['culture', 'preset', 'recipe'].includes(key) && !equal(value, inherited[stage]?.[key])));
    if (Object.keys(selected).length) result[stage] = selected;
  }
  return result;
}
function compactUrban(settings: V2Settings): void {
  const urban = settings.urban;
  if (!urban) return;
  const selected = selectors(urban, urbanEffectiveValues({ ...settings, urban: undefined }));
  const inherited = urbanEffectiveValues({ ...settings, urban: selected });
  inherited.backend = settings.runtime?.backend ?? 'rust';
  const compact = sparse(urban, inherited, selected) as typeof urban;
  for (const [key, local] of Object.entries(urban.local ?? {})) {
    const chosen = selectors(local, urbanEffectiveValues({ ...settings, urban: { ...urban, local: undefined } }, { kind: 'settlement', key }));
    const localSettings = { ...settings, urban: { ...urban, local: { ...urban.local, [key]: chosen } } };
    const values = sparse(local, urbanEffectiveValues(localSettings, { kind: 'settlement', key }), chosen);
    if (Object.keys(values).length) (compact.local ??= {})[key] = values;
    else if (compact.local) delete compact.local[key];
  }
  if (compact.local && !Object.keys(compact.local).length) delete compact.local;
  if (compact.buildings && !Object.keys(compact.buildings).length) delete compact.buildings;
  if (Object.keys(compact).length) settings.urban = compact;
  else delete settings.urban;
}
function portableSettings(input: V2Settings): V2Settings {
  if (input.options.importedHeight) throw new Error('Une heightmap importée nécessite un projet complet.');
  validateSettings(input);
  const settings = structuredClone(input);
  migrateUrbanSeeds(settings);
  if (settings.runtime) {
    delete settings.runtime.localServer; delete settings.runtime.pythonServer;
    // Native and browser Rust run the same recipe; connections belong to the receiver.
    if (settings.runtime.backend === 'native') settings.runtime.backend = 'rust';
    if (settings.runtime.source === 'neural') settings.runtime.source = 'neural-wasm';
  }
  if (settings.urban?.backend === 'native') settings.urban.backend = 'rust';
  const t = settings.terrain;
  if (t) {
    const presetDefaults = effectiveTerrainSettings({ ...settings, terrain: baseline.terrain }, adaptedExtent(settings));
    const owned: RecordValue = structuredClone(baseline.terrain ?? {});
    if (t.climate !== undefined && t.climate !== presetDefaults.climateZone) owned.climate = t.climate;
    if (t.procedural?.preset && t.procedural.preset !== (presetDefaults.procedural?.preset ?? 'classic')) owned.procedural = { preset: t.procedural.preset };
    const inherited = effectiveTerrainSettings({ ...settings, terrain: { ...baseline.terrain,
      ...(t.climate ? { climate: t.climate } : {}),
      ...(t.procedural?.preset ? { procedural: { preset: t.procedural.preset } } : {}),
    } }, adaptedExtent(settings));
    inherited.procedural = { preset: 'classic', biome: true, coastAfter: 'initialize', ...inherited.procedural };
    settings.terrain = sparse(t, inherited, owned) as typeof t;
  }
  if (settings.region) {
    const compact = sparse(settings.region, effectiveRegion({ ...settings, region: undefined }));
    if (Object.keys(compact).length) settings.region = compact;
    else delete settings.region;
  }
  compactUrban(settings);
  for (const [key, options] of Object.entries(settings.local)) if (!Object.values(options).some(v => v !== undefined)) delete settings.local[key];
  return settings;
}
function jsonValue(value: any): any {
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) throw new Error('Les données calculées nécessitent un projet complet.');
  if (Array.isArray(value)) return value.map(item => item === undefined ? null : jsonValue(item));
  if (!record(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, jsonValue(item)]));
}
/** A portable generation recipe, without calculated terrain or building geometry. */
export function encodeCityCode(input: V2Settings, mods: unknown[] = []): string {
  validateModifications(mods);
  const settings = portableSettings(input);
  const seed = readGenerationSeed(settings.options.seed);
  const biome = defaults.biomes.indexOf(settings.options.biome ?? 'temperate');
  const culture = defaults.cultures.indexOf(settings.options.culture);
  const relief = defaults.reliefs.indexOf(settings.terrain?.relief ?? settings.options.relief);
  if (biome < 0 || culture < 0 || relief < 0 || culture > 255) throw new Error('Préréglage inconnu.');
  const choices = biome | (culture << 3) | (relief << 11);
  const extent = settings.extent === 'auto' ? 0 : settings.extent;
  settings.options.seed = baseline.options.seed;
  if (settings.options.biome !== undefined) settings.options.biome = baseline.options.biome;
  settings.options.culture = baseline.options.culture;
  if (settings.terrain) delete settings.terrain.relief;
  settings.extent = baseline.extent;
  const numericSeed = Number(seed.base);
  const root = Number.isSafeInteger(numericSeed) && String(numericSeed) === seed.base ? numericSeed : seed.base;
  const values: unknown[] = [root, choices, extent, jsonValue(settings), seed.variations, jsonValue(mods)];
  while (values.length > 3 && equal(values.at(-1), schema[values.length - 1])) values.pop();
  return encodeCompact(values, schema, CITY_CODE_PREFIX);
}
export function decodeCityCode(text: string): { settings: V2Settings; mods: unknown[] } {
  const values = decodeCompact(cityCodeFromInput(text), schema, CITY_CODE_PREFIX);
  try {
    if (!Array.isArray(values) || values.length < 3 || values.length > 6) throw new Error();
    const [root, choices, extent, saved = baseline, variations = {}, mods = []] = values;
    if (typeof root !== 'string' && !(typeof root === 'number' && Number.isSafeInteger(root))) throw new Error();
    if (!Number.isInteger(choices) || choices < 0 || choices > 32767) throw new Error();
    const biome = defaults.biomes[choices & 7], culture = defaults.cultures[(choices >>> 3) & 255], relief = defaults.reliefs[choices >>> 11];
    if (!biome || !culture || !relief || !record(saved) || !record(saved.options) || !record(variations)) throw new Error();
    const entries = Object.entries(variations);
    if (entries.length > 2000 || entries.some(([key, value]) => key.length > 160 || ['__proto__', 'constructor', 'prototype'].includes(key)
      || !(typeof value === 'string' && value.length <= 4096 || Number.isInteger(value) && value >= 0 && value <= 0xffffffff))) throw new Error();
    const settings = structuredClone(saved) as V2Settings;
    settings.options.seed = writeGenerationSeed({ base: String(root), variations });
    if (Object.hasOwn(settings.options, 'biome')) settings.options.biome = biome as typeof settings.options.biome;
    settings.options.culture = culture;
    if (relief !== settings.options.relief) { settings.terrain ??= {}; settings.terrain.relief = relief as NonNullable<V2Settings['terrain']>['relief']; }
    settings.extent = extent === 0 ? 'auto' : extent;
    validateSettings(settings); validateModifications(mods);
    return { settings, mods };
  } catch { throw new Error('Code incomplet, corrompu ou trop volumineux.'); }
}
/** Accept a copied code or a share URL, including line-wrapped clipboard text. */
export function cityCodeFromInput(text: string): string {
  text = text.trim();
  if (!text.startsWith(CITY_CODE_PREFIX)) try {
    const url = new URL(text);
    text = new URLSearchParams(url.hash.slice(1)).get('city') ?? text;
  } catch { /* A pasted code is not a URL. */ }
  return text.replace(/\s/g, '');
}
export function cityCodeUrl(code: string, base: string): string {
  const url = new URL(base);
  url.hash = new URLSearchParams({ city: code }).toString();
  return url.href;
}
