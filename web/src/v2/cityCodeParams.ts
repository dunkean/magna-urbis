/** Stable parameter IDs of the short city code (cityCode.ts).
 * cityCodeParams.json lists the parameter keys in ID order: an ID is the key's index. The first SHORT_IDS keys are the
 * most changed (FREQUENT) and take a one-digit ID. Append new keys, never reorder.
 * A key is `options.<path>` / `terrain.<path>` / `region.<path>` (V2Settings paths, `options.` also per settlement),
 * `urban.<path>` (urban controls, global or per settlement) or `quarter.<path>` / `block.<path>` (the overrides of one
 * quarter or block; their culture is `options.culture`). Every eligible schema field must be listed
 * (web/tests/v2/cityCode.test.ts): bounded numbers, booleans and choices of at most MAX_LEVELS options. */
import ids from './cityCodeParams.json';
import type { ParameterField } from './parameterForm';
import { allTerrainFields, terrainProceduralStageFields } from './terrainControlSchema';
import { regionControlFields } from './regionControls';
import { urbanControlFields, urbanField } from './urbanControlSchema';
import { MAX_LEVELS, MAX_PARAMETERS, parameterLevels } from './cityCodeFormat';
import { WALL_STYLES } from '../gen/options';
import { CLIMATE_ZONES } from '../../../rust/bridge/terrainClimate';
import defaults from './cityCodeDefaults.json';

export interface CodeParameter {
  id: number;
  key: string;
  /** Root of `path`: V2Settings (settings), a Partial<Options> (options), urban controls (urban) or a quarter's or
   * block's overrides. */
  scope: 'settings' | 'options' | 'urban' | 'quarter' | 'block';
  path: string;
  field: ParameterField;
}
const tri = ['auto', 'yes', 'no'];
const optionChoice = (path: string, values: readonly string[]): ParameterField => ({ path, label: path, type: 'select', options: values.map(value => ({ value, label: value })) });
/** Options fields edited in the main panel and in the settlement inspector (settings.local[key]). */
const optionFields: ParameterField[] = [
  optionChoice('culture', defaults.cultures),
  optionChoice('size', ['hamlet', 'village', 'town', 'city', 'metropolis']),
  optionChoice('river', ['none', 'stream', 'river', 'major']),
  optionChoice('walls', ['auto', 'yes', 'no', 'none', 'single', 'double']),
  optionChoice('wallStyle', WALL_STYLES),
  optionChoice('castles', ['auto', '0', '1', '2', '3']),
  // castle, cathedral and palace are now per-town building counts (layout.programme.counts, cityCode "K").
  ...['moat', 'monasteries', 'port', 'arena', 'activities'].map(key => optionChoice(key, tri)),
  optionChoice('suburbs', ['auto', 'none', 'some', 'many']),
  optionChoice('shantytowns', ['auto', 'none', 'some', 'many']),
  { path: 'seaLevel', label: 'seaLevel', type: 'number', min: -1, max: 1 },
  { path: 'sprawl', label: 'sprawl', type: 'number', min: 0.25, max: 4 },
];
const deleted: ParameterField = { path: 'deleted', label: 'deleted', type: 'boolean' };
/** What the inspector sets on one quarter or block as parameters. House models and drawn subdivisions have edit records. */
const subdivisionFields = (): Record<'quarter' | 'block', readonly ParameterField[]> => ({
  quarter: [
    urbanField('tissue', 'culture', 'quarter'),
    urbanField('zone', '', 'quarter'),
    urbanField('density', 1, 'quarter'),
    urbanField('role', '', 'quarter'),
    { ...urbanField('wealth', 0.5, 'quarter'), max: 1 },
    { ...urbanField('culture', '', 'house'), path: 'buildingCulture' },
    deleted,
  ],
  block: [urbanField('density', 1, 'block'), urbanField('operator', 'culture', 'block'), urbanField('role', '', 'parcel'), deleted],
});
/** Display-only biome repainting the kept relief (displayBiome.ts); absent = the generation biome. */
const settingFields: ParameterField[] = [{ ...optionChoice('appearance.biome', CLIMATE_ZONES) }];
/** The most changed parameters, given one-digit IDs (in this order) when the ID list is rebuilt. */
export const FREQUENT = [
  'options.culture',
  'options.size',
  'options.river',
  'options.walls',
  'options.wallStyle',
  'options.port',
  'options.suburbs',
  'options.seaLevel',
  'options.sprawl',
  'appearance.biome',
  'terrain.erosion',
  'terrain.mountainMix',
  'region.placement.density',
  'region.placement.farmDensity',
  'region.roads.density',
];
/** Header-owned or non-generation paths. `options.biome` follows the header's climate: written only when it differs. */
const excluded = new Set(['options.relief', 'options.coast', 'options.seed', 'terrain.relief', 'terrain.climate', 'terrain.coastMask', 'terrain.islandMode']);
/** The house model travels whole, as a record with its catalogue choices (cityCodeRecords.ts, action "H"). */
const HOUSE_MODEL = 'urban.houses.house_config.';
export function eligible(field: ParameterField): boolean {
  if (field.type === 'boolean') return true;
  if (field.type === 'select') return !!field.options && field.options.length >= 2 && field.options.length <= MAX_LEVELS;
  return field.type === 'number' && parameterLevels(field) > 0;
}
/** Every eligible field, keyed as in cityCodeParams.json. */
export function candidateParameters(): { key: string; scope: CodeParameter['scope']; path: string; field: ParameterField }[] {
  const out = new Map<string, { key: string; scope: CodeParameter['scope']; path: string; field: ParameterField }>();
  const add = (key: string, scope: CodeParameter['scope'], path: string, field: ParameterField) => {
    if (!excluded.has(key) && !key.startsWith('runtime.') && !key.startsWith(HOUSE_MODEL) && eligible(field) && !out.has(key)) out.set(key, { key, scope, path, field });
  };
  for (const field of optionFields) add(`options.${field.path}`, 'options', field.path, field);
  for (const field of settingFields) add(field.path, 'settings', field.path, field);
  for (const field of [...allTerrainFields, ...terrainProceduralStageFields]) add(field.path, 'settings', field.path, field);
  for (const field of regionControlFields) add(`region.${field.path}`, 'settings', `region.${field.path}`, field);
  for (const field of urbanControlFields()) add(`urban.${field.path}`, 'urban', field.path, field);
  const subdivisions = subdivisionFields();
  for (const scope of ['quarter', 'block'] as const) for (const field of subdivisions[scope]) add(`${scope}.${field.path}`, scope, field.path, field);
  const list = [...out.values()],
    rank = (key: string) => (FREQUENT.includes(key) ? FREQUENT.indexOf(key) : FREQUENT.length);
  return list.sort((a, b) => rank(a.key) - rank(b.key));
}
let registry: { byId: CodeParameter[]; byKey: Map<string, CodeParameter> } | undefined;
export function codeParameters(): { byId: CodeParameter[]; byKey: Map<string, CodeParameter> } {
  if (registry) return registry;
  const candidates = new Map(candidateParameters().map(c => [c.key, c]));
  const byId: CodeParameter[] = [],
    byKey = new Map<string, CodeParameter>();
  (ids as string[]).forEach((key, id) => {
    const candidate = candidates.get(key);
    if (!candidate) return; // A retired field keeps its ID reserved.
    const parameter = { id, ...candidate };
    byId[id] = parameter;
    byKey.set(key, parameter);
  });
  return (registry = { byId, byKey });
}
if ((ids as string[]).length > MAX_PARAMETERS) throw new Error('Too many code parameters.');
export const listedParameterKeys = (): readonly string[] => ids as string[];
