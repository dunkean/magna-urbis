/** Short city code: a 6-digit root seed, then only what differs from the default city.
 *
 * Grammar (URL-safe). Digits come from cityCodeFormat.ts: lowercase base32 without i, l, o, u. Those letters and
 * uppercase letters mark edit actions. Section delimiters are '-', '_', '!' and ':'.
 *
 *   code     = seed header ["*"] ["-" params] ("_" edit)* ["!" pins] [":" extras]
 *   seed     = 6 digits. Every other draw derives from it (stepSeed: hash of root + stage path + iteration).
 *              The dice on the root is seed + 1 (nextRootSeed), so a root roll adds nothing to the code.
 *   header   = up to 6 positional digits, each an offset from the default (mod 32), trailing zeros trimmed:
 *              climate (CLIMATES, with the biome it brings), relief (RELIEFS), coast mask and island layout (2 digits),
 *              size (SIZE_TABLE), terrain renderer (RENDERERS). The culture of an untouched recipe follows from the seed
 *              and this environment (automaticCulture).
 *   "*"      = the relief or coast of this map was imported or drawn by hand and is not in the code
 *   params   = (id value)+   id = 1 digit for the 31 most changed parameters, else "z" + 2 digits (cityCodeParams.json);
 *              value = level in the parameter's own domain (boolean, choice of N, slider of N steps): 1 digit up to 32, else 2.
 *   edit     = [address] action+                  applied in code order, each on the state left by the previous one
 *   address  = n ("." n)*                         settlement number (settlementNumber), quarter index, rank of the block
 *                                                 in its quarter; empty = region
 *   action   = "u" n                              reroll iteration n of the addressed settlement (every stage), quarter or block
 *            | "i" stage n                        reroll iteration n of one stage (region: GLOBAL_STEPS, settlement: STAGES)
 *            | "o" n                              settlement population; on the region: "o" field n (DEMOGRAPHY_FIELDS)
 *            | "l" params                         parameters of the settlement (options and urban scopes), quarter or block
 *                                                 (their own scope and the culture)
 *            | "K" mode role count …              building counts (layout.programme.counts): mode 1 digit (0 suggest, 1 force),
 *                                                 then pairs of role (2 digits, COUNT_ROLES index) and count (2 digits)
 *            | "~" x y pop culture site           custom place (region.customPlaces): fixed-width position as pins,
 *                                                 population on a 2-digit log scale, culture (2), site type (1, 0 = auto)
 *            | "H" record                         house model of the region (urban.houses.house_config), settlement
 *                                                 (its houses.house_config), quarter or block (houseConfig)
 *            | "P" id record                      lot edit (parcels.overrides.parcels[id]) of the settlement
 *            | "B" id record                      building house model (urban.buildings[`<settlement>/<id>`]); on the
 *                                                 region, a bare saved key
 *            | "Q" id record                      drawn or split quarter edit keyed by its saved quarter id
 *            | "D" id record                      drawn or split block edit keyed by its position or saved block id
 *            | "W" id record                      wall override keyed by its enclosure id
 *                                                 records and ids: cityCodeRecords.ts
 *   pins     = (x y)+                             integer world metres, fixed width = digits of the region size
 *   extras   = mode base64url                     optional names, pin texts and exact road overrides (cityCodeExtras.ts)
 *
 * What the code leaves out is listed in NOT_IN_CODE (cityCodeRecords.ts): use the project export for it.
 * The debug text (cityDebugText) adds a build line and one `#n x=… y=… text` line per pin. */
import defaults from './cityCodeDefaults.json';
import { climateZoneBiome } from '../gen/biomes';
import type { V2Settings } from './contracts';
import { automaticCulture } from './environmentCultures';
import { effectiveTerrainSettings } from './terrainSettings';
import { validateSettings } from './project';
import { adaptedExtent, defaultSettings } from './settings';
import { readGenerationSeed, writeGenerationSeed } from '../../../rust/bridge/generationSeed';
import { applyExternalCity, parseExternalCity } from './externalCity';
import { readSettingPath, writeSettingPath, type ParameterField } from './parameterForm';
import { codeParameters, type CodeParameter } from './cityCodeParams';
import { CODE_BASE, CODE_DIGITS, POPULATION_WIDTH, levelPopulation, populationLevel, digit, digitValue, intWidth, isCodeDigit, levelValue, parameterLevels, readInt, readParamId, valueLevel, valueWidth, writeInt, writeParamId } from './cityCodeFormat';
import { CLIMATE_ZONES, type ClimateZone } from '../../../rust/bridge/terrainClimate';
import { BLOCK_POSITION_KEY, blockPositionKey } from '../../../rust/bridge/urbanBlockEdits';
import { URBAN_SEED_STAGES } from './urbanSeeds';
import { POPULATION_CLASSES } from './regionalPopulation';
import { SITE_ARCHETYPES } from '../gen/options';
import type { SettlementSpec } from '../../../rust/bridge/settlements';
import { COUNTABLE } from './programmeCounts';
import { normalizeProgrammeCounts, type BlockOverride, type ParcelOverride, type QuarterOverride, type WallOverride } from '../../../rust/bridge/urbanConfig';
import { codedRecord, readId, readRecord, writeId, writeRecord } from './cityCodeRecords';
import { applyCityCodeExtras, cityCodeExtras, readExtras, writeExtras } from './cityCodeExtras';
import type { HouseEditConfig } from '../../../rust/bridge/urbanHouseEdits';

/** Thrown for text that is neither a city code nor a known external city; localised in cityCodeSharing. */
export const UNRECOGNISED_INPUT = 'Not recognised: paste a Magna Urbis code, a watabou city/village link or an Azgaar burg (CSV row or export-script JSON).';
export const INVALID_CODE = 'Incomplete or corrupt code.';
export const SEED_LENGTH = 6;
const DIGIT_CLASS = '[0-9a-hjkmnp-tv-z]';
export const SEED_PATTERN = new RegExp(`^${DIGIT_CLASS}{${SEED_LENGTH}}$`);

export const RENDERERS = ['procedural', 'neural-wasm', 'procedural-phasor', 'neural-python', 'neural'] as const;
/** Surface zones, then the same zones under the Underdark. */
const CLIMATES: readonly string[] = [...CLIMATE_ZONES, ...CLIMATE_ZONES.map(zone => `underdark:${zone}`)];
const ISLAND_MODES = ['island', 'archipelago', 'peninsula', 'random'] as const;
export const RELIEFS = defaults.reliefs;
export const CULTURES = defaults.cultures;
/** Region sizes in km; index 0 is the default. */
export const SIZE_TABLE: readonly ('auto' | number)[] = [6, 'auto', 1, 2, 3, 4, 5, 7, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56, 60, 64, 80, 96, 100, 120, 128, 140, 150, 160, 180, 200];
const COAST_MASKS: Record<string, number> = { none: 0, N: 1, E: 4, S: 16, W: 64, random: 255 };
export const GLOBAL_STEPS = ['settle-sites', 'settle-roads', 'cover-climate', 'relief-noise', 'relief-coast-cut', 'water-hydrology', 'city/*/default', ...URBAN_SEED_STAGES.map(stage => `city/*/${stage}`)];
const STAGES = [...URBAN_SEED_STAGES, 'default'] as const;
/** Regional demography fields: typed totals are exact integers; densities in thousandths. */
export const DEMOGRAPHY_FIELDS = ['population', 'density', 'isolatedDensity', 'isolatedCount', 'followCulture', ...POPULATION_CLASSES.map(c => `counts.${c}`)] as const;
const MILLI = new Set<string>(['density', 'isolatedDensity']);

/** The kept leaves of one edit, in its saved shape (cityCodeRecords.ts). */
type CodeRecord = object;
export type CodeAction =
  | { kind: 'reroll'; n: number }
  | { kind: 'stage'; stage: number; n: number }
  | { kind: 'population'; n: number }
  | { kind: 'demography'; field: number; n: number }
  | { kind: 'params'; params: [number, number][] }
  | { kind: 'place'; x: number; y: number; population: number; culture: number; site: number }
  | { kind: 'counts'; force: boolean; counts: [number, number][] }
  | { kind: 'house'; record: CodeRecord }
  | { kind: 'parcel' | 'building' | 'quarter' | 'block' | 'wall'; id: string; record: CodeRecord };
const RECORD_ACTIONS = { parcel: 'P', building: 'B', quarter: 'Q', block: 'D', wall: 'W' } as const;
const ACTION_BY_MARKER = new Map<string, keyof typeof RECORD_ACTIONS>(Object.entries(RECORD_ACTIONS).map(([kind, marker]) => [marker, kind as keyof typeof RECORD_ACTIONS]));
const SITES = ['auto', ...SITE_ARCHETYPES] as const;
/** Countable building roles, sorted so the index only moves when the catalogue changes. */
export const COUNT_ROLES: readonly string[] = [...COUNTABLE].sort();
/** Settlement number spaces: the places of the automatic plan (`site-<rank>`), then custom places (`place-<k>`). */
const KEY_SPACES = ['site', 'place'] as const;
/** Address of the source block (quarter index, rank in the quarter) in the plan on screen, when available. */
export type BlockAddress = (settlement: string, saved: string) => readonly [number, number] | undefined;
export interface CodeEdit {
  /** Empty = region; settlement number; then quarter index; then the rank of the block in its quarter. */
  path: number[];
  actions: CodeAction[];
}
/** The parsed code, independent of the settings it is applied to. */
export interface CodeModel {
  seed: string;
  /** Header offsets: climate, relief, coast high, coast low, size, renderer. */
  header: number[];
  /** The relief or coast is imported or hand-drawn: it is not in the code. */
  reliefMissing?: boolean;
  params: [number, number][];
  edits: CodeEdit[];
  pins: [number, number][];
  extras?: ReturnType<typeof readExtras>;
}

// ---------------------------------------------------------------- grammar

function parameter(id: number): CodeParameter {
  const found = codeParameters().byId[id];
  if (!found) throw new Error(INVALID_CODE);
  return found;
}
const domain = (field: ParameterField): number => (field.type === 'boolean' ? 2 : field.type === 'select' ? field.options!.length : parameterLevels(field));
const writeParams = (params: readonly [number, number][]): string => params.map(([id, level]) => writeParamId(id) + writeInt(level, valueWidth(domain(parameter(id).field)))).join('');
/** Region size in metres for a header size digit. */
function headerExtent(header: readonly number[]): 'auto' | number {
  const size = SIZE_TABLE[header[4]];
  if (size === undefined) throw new Error(INVALID_CODE);
  return size === 'auto' ? 'auto' : size * 1000;
}
const pinWidth = (extent: 'auto' | number): number => intWidth(extent === 'auto' ? 200000 : extent);

/** Clipping and the lot random stream depend on the parent contour. A child's saved hash
 * cannot tell us which drawn block produced it before regeneration. Protect structural
 * inputs in its town; split lot pieces and their buildings have explicit parent ID prefixes. */
function exactContours(model: CodeModel): Set<CodeAction> {
  const exact = new Set<CodeAction>();
  const bare = model.edits.find(edit => !edit.path.length)?.actions.filter(action => action.kind === 'building') ?? [];
  for (const edit of model.edits) {
    const contours = edit.actions.filter(action => 'id' in action && ('shape' in action.record || 'parts' in action.record));
    if (!contours.length) continue;
    const childIds = [...bare, ...edit.actions].flatMap(action => (action.kind === 'parcel' || action.kind === 'building' ? [action.id] : []));
    const hasBlock = edit.actions.some(action => action.kind === 'block') || model.edits.some(other => other.path[0] === edit.path[0] && other.path.length === 3);
    const lotParents = new Set<string>();
    for (const id of childIds) {
      for (let slash = id.lastIndexOf('/'); slash > 0; slash = id.lastIndexOf('/', slash - 1)) lotParents.add(id.slice(0, slash));
    }
    for (const action of contours) {
      if ((action.kind === 'quarter' && hasBlock) || ((action.kind === 'quarter' || action.kind === 'block') && childIds.length) || (action.kind === 'parcel' && lotParents.has(action.id))) exact.add(action);
    }
  }
  return exact;
}
export function formatCode(model: CodeModel): string {
  if (!SEED_PATTERN.test(model.seed)) throw new Error('The root seed must be 6 characters of the code alphabet.');
  let code = model.seed + model.header.map(digit).join('').replace(/0+$/, '') + (model.reliefMissing ? '*' : '');
  if (model.params.length) code += '-' + writeParams(model.params);
  const exact = exactContours(model);
  for (const edit of model.edits) {
    code += '_' + edit.path.map(n => writeInt(n)).join('.');
    let previous: number[] = [];
    for (const action of edit.actions)
      if (action.kind === 'house') code += 'H' + writeRecord(action.record);
      else if ('id' in action) {
        const [id, bytes] = writeId(action.id, previous);
        previous = bytes;
        code += RECORD_ACTIONS[action.kind] + id + writeRecord(action.record, exact.has(action));
      } else if (action.kind === 'reroll') code += 'u' + writeInt(action.n);
      else if (action.kind === 'stage') code += 'i' + digit(action.stage) + writeInt(action.n);
      else if (action.kind === 'population') code += 'o' + writeInt(action.n);
      else if (action.kind === 'demography') code += 'o' + digit(action.field) + writeInt(action.n);
      else if (action.kind === 'params') code += 'l' + writeParams(action.params);
      else if (action.kind === 'counts') code += 'K' + digit(Number(action.force)) + action.counts.map(([role, count]) => writeInt(role, 2) + writeInt(count, 2)).join('');
      else {
        const width = pinWidth(headerExtent(model.header));
        code += '~' + writeInt(action.x, width) + writeInt(action.y, width) + writeInt(action.population, POPULATION_WIDTH) + writeInt(action.culture, 2) + digit(action.site);
      }
  }
  if (model.pins.length) {
    const width = pinWidth(headerExtent(model.header));
    code += '!' + model.pins.map(([x, y]) => writeInt(x, width) + writeInt(y, width)).join('');
  }
  if (model.extras) code += ':' + writeExtras(model.extras);
  return code;
}
export function parseCode(code: string): CodeModel {
  const extrasAt = code.indexOf(':');
  const extras = extrasAt < 0 ? undefined : code.slice(extrasAt + 1);
  if (extras !== undefined) code = code.slice(0, extrasAt);
  const seed = code.slice(0, SEED_LENGTH);
  if (!SEED_PATTERN.test(seed)) throw new Error(INVALID_CODE);
  let i = SEED_LENGTH;
  const header: number[] = [];
  while (header.length < 6 && isCodeDigit(code[i])) header.push(digitValue(code[i++]));
  while (header.length < 6) header.push(0);
  const model: CodeModel = { seed, header, params: [], edits: [], pins: [] };
  if (code[i] === '*') {
    i++;
    model.reliefMissing = true;
  }
  const number = (): number => {
    const start = i;
    while (isCodeDigit(code[i])) i++;
    return readInt(code.slice(start, i));
  };
  const fixed = (width: number): number => {
    const text = code.slice(i, i + width);
    if (text.length !== width) throw new Error(INVALID_CODE);
    i += width;
    return readInt(text);
  };
  const params = (): [number, number][] => {
    const out: [number, number][] = [];
    while (isCodeDigit(code[i])) {
      const [id, used] = readParamId(code, i);
      i += used;
      out.push([id, fixed(valueWidth(domain(parameter(id).field)))]);
    }
    if (!out.length) throw new Error(INVALID_CODE);
    return out;
  };
  if (code[i] === '-') {
    i++;
    model.params = params();
  }
  while (code[i] === '_') {
    i++;
    const path: number[] = [];
    if (isCodeDigit(code[i])) {
      path.push(number());
      while (code[i] === '.') {
        i++;
        path.push(number());
      }
    }
    const edit: CodeEdit = { path, actions: [] };
    let previous: number[] = [];
    const record = (): CodeRecord => {
      const [value, next] = readRecord(code, i);
      i = next;
      return value;
    };
    while (code[i] !== undefined && 'uiol~KHPBQDW'.includes(code[i])) {
      const marker = code[i++];
      const kind = ACTION_BY_MARKER.get(marker);
      if (marker === 'H') edit.actions.push({ kind: 'house', record: record() });
      else if (kind) {
        const [id, next, bytes] = readId(code, i, previous);
        i = next;
        previous = bytes;
        edit.actions.push({ kind, id, record: record() });
      } else if (marker === 'u') edit.actions.push({ kind: 'reroll', n: number() });
      else if (marker === 'i') edit.actions.push({ kind: 'stage', stage: fixed(1), n: number() });
      else if (marker === 'o') edit.actions.push(path.length ? { kind: 'population', n: number() } : { kind: 'demography', field: fixed(1), n: number() });
      else if (marker === 'l') edit.actions.push({ kind: 'params', params: params() });
      else if (marker === 'K') {
        const force = fixed(1) === 1,
          counts: [number, number][] = [];
        while (isCodeDigit(code[i])) counts.push([fixed(2), fixed(2)]);
        edit.actions.push({ kind: 'counts', force, counts });
      } else {
        const width = pinWidth(headerExtent(header));
        edit.actions.push({ kind: 'place', x: fixed(width), y: fixed(width), population: fixed(POPULATION_WIDTH), culture: fixed(2), site: fixed(1) });
      }
    }
    if (!edit.actions.length) throw new Error(INVALID_CODE);
    model.edits.push(edit);
  }
  if (code[i] === '!') {
    i++;
    const width = pinWidth(headerExtent(header));
    while (i < code.length) model.pins.push([fixed(width), fixed(width)]);
    if (!model.pins.length) throw new Error(INVALID_CODE);
  }
  if (i !== code.length) throw new Error(INVALID_CODE);
  if (extras !== undefined) model.extras = readExtras(extras);
  return model;
}

// ---------------------------------------------------------------- settings mapping

/** Settlement keys: 'main' = 0, `${space}-${j}` = 1 + j·spaces + space index (KEY_SPACES). */
export function settlementNumber(key: string): number | undefined {
  if (key === 'main') return 0;
  const match = /^([a-z]+)-(\d+)$/.exec(key),
    index = match ? KEY_SPACES.indexOf(match[1] as never) : -1;
  return match && index >= 0 ? 1 + Number(match[2]) * KEY_SPACES.length + index : undefined;
}
export function settlementKey(n: number): string {
  return n === 0 ? 'main' : `${KEY_SPACES[(n - 1) % KEY_SPACES.length]}-${Math.floor((n - 1) / KEY_SPACES.length)}`;
}
const offset = (index: number, base: number, size = CODE_BASE) => (((index - base) % size) + size) % size;
const indexOrThrow = (list: readonly unknown[], value: unknown, what: string): number => {
  const index = list.indexOf(value);
  if (index < 0) throw new Error(`Unknown ${what}: ${String(value)}`);
  return index;
};
function nearestSize(extent: 'auto' | number): number {
  if (extent === 'auto') return SIZE_TABLE.indexOf('auto');
  let best = 0;
  SIZE_TABLE.forEach((size, i) => {
    if (size !== 'auto' && Math.abs(size * 1000 - extent) < Math.abs((SIZE_TABLE[best] as number) * 1000 - extent)) best = i;
  });
  return best;
}
/** The levels of a field are those of its control: both ways go through the control's units (`toInput`, `fromInput`). */
function fieldLevel(field: ParameterField, value: unknown): number | undefined {
  if (field.type === 'boolean') return typeof value === 'boolean' ? Number(value) : undefined;
  const shown = field.toInput ? field.toInput(value) : value;
  if (field.type === 'select') {
    const index = field.options!.findIndex(option => option.value === shown);
    return index < 0 ? undefined : index;
  }
  return typeof shown === 'number' && Number.isFinite(shown) ? valueLevel(field, shown) : undefined;
}
function fieldValue(field: ParameterField, level: number): unknown {
  if (field.type === 'boolean') return level === 1;
  if (field.type === 'select') {
    const option = field.options![level];
    if (!option) throw new Error(INVALID_CODE);
    return field.fromInput ? field.fromInput(option.value) : option.value;
  }
  if (level >= parameterLevels(field)) throw new Error(INVALID_CODE);
  const value = levelValue(field, level);
  return field.fromInput ? field.fromInput(value) : value;
}
type Roots<T> = Partial<Record<CodeParameter['scope'], T>>;
/** The parameters of the given roots that differ from the base. */
function readParams(roots: Roots<unknown>, base: Roots<unknown> = {}): [number, number][] {
  const out: [number, number][] = [];
  for (const parameter of codeParameters().byId) {
    if (!parameter || roots[parameter.scope] === undefined) continue;
    const value = readSettingPath(roots[parameter.scope], parameter.path);
    if (value === undefined || value === null || JSON.stringify(value) === JSON.stringify(readSettingPath(base[parameter.scope] ?? {}, parameter.path))) continue;
    const level = fieldLevel(parameter.field, value);
    if (level !== undefined) out.push([parameter.id, level]);
  }
  return out;
}
function applyParams(roots: Roots<() => object>, params: readonly [number, number][]): void {
  for (const [id, level] of params) {
    const found = parameter(id),
      root = roots[found.scope];
    if (!root) throw new Error(INVALID_CODE);
    writeSettingPath(root(), found.path, fieldValue(found.field, level));
  }
}

/** The settings a code is read against. */
export const codeBaseline = (): V2Settings => defaultSettings();
const cultureAt = (index: number): string => {
  if (CULTURES[index] === undefined) throw new Error(INVALID_CODE);
  return CULTURES[index];
};
const CULTURE_ID = () => codeParameters().byKey.get('options.culture')!.id;

/** The header of a recipe, as offsets from the default recipe. */
function headerOf(settings: V2Settings, base: V2Settings): number[] {
  const zone = effectiveTerrainSettings(settings, adaptedExtent(settings)).climateZone ?? 'temperate',
    climate = settings.options.biome === 'underdark' ? `underdark:${zone}` : zone;
  const coast = (settings.terrain?.coastMask ?? COAST_MASKS[settings.options.coast] ?? 0) + 256 * Math.max(0, ISLAND_MODES.indexOf((settings.terrain?.islandMode ?? 'island') as never)),
    coastOffset = offset(coast, COAST_MASKS[base.options.coast], CODE_BASE * CODE_BASE);
  return [
    indexOrThrow(CLIMATES, climate, 'climate'),
    offset(indexOrThrow(RELIEFS, settings.terrain?.relief ?? settings.options.relief, 'relief'), RELIEFS.indexOf(base.options.relief)),
    Math.floor(coastOffset / CODE_BASE),
    coastOffset % CODE_BASE,
    nearestSize(settings.extent),
    indexOrThrow(RENDERERS, settings.runtime?.source ?? 'procedural', 'renderer'),
  ];
}
const pick = <T>(list: readonly T[], digitOffset: number, baseIndex: number): T => {
  const value = list[(baseIndex + digitOffset) % CODE_BASE];
  if (value === undefined) throw new Error(INVALID_CODE);
  return value;
};
/** The default recipe in the environment of a header: what the parameters of a code are read against. The biome follows
 * the climate; the culture, when nobody chose one, the seed and the environment. */
function headerSettings(seed: string, header: readonly number[]): V2Settings {
  const settings = codeBaseline(),
    terrain = (settings.terrain ??= {}),
    options = settings.options;
  const [climate, relief, coastHigh, coastLow, , renderer] = header;
  options.seed = seed;
  settings.extent = headerExtent(header);
  if (climate) {
    const name = pick(CLIMATES, climate, 0),
      zone = name.replace('underdark:', '') as ClimateZone;
    terrain.climate = zone;
    options.biome = (name === zone ? climateZoneBiome[zone] : 'underdark') as typeof options.biome;
  }
  if (relief) terrain.relief = pick(RELIEFS, relief, RELIEFS.indexOf(options.relief)) as NonNullable<V2Settings['terrain']>['relief'];
  if (coastHigh || coastLow) {
    const coast = (COAST_MASKS[options.coast] + coastHigh * CODE_BASE + coastLow) % (CODE_BASE * CODE_BASE);
    terrain.coastMask = coast & 255;
    terrain.islandMode = ISLAND_MODES[coast >> 8];
  }
  const source = pick(RENDERERS, renderer, 0);
  settings.runtime = { ...settings.runtime!, source };
  settings.generation = source.startsWith('neural') ? 'neural' : 'procedural';
  options.culture = automaticCulture(settings);
  return settings;
}
/** An imported or hand-drawn relief or coast: the code says it misses ("*"), the heightmap or project export goes with it. */
const reliefNotInCode = (settings: V2Settings): boolean => !!(settings.options.importedHeight || settings.decor || settings.terrain?.sketch || settings.terrain?.zones || settings.terrain?.modification || settings.terrain?.coastTrace || settings.terrain?.importedRiver);
const structural = (edit: QuarterOverride | BlockOverride): boolean => !!(edit.shape || edit.parts || edit.deletedParts?.length);
const SPLIT_KEY = /^(.*)\/(\d+)$/;
const QUARTER_KEY = /^\d+(?:\/\d+)?$/;
const BLOCK_KEY = /^block:(?:[0-9a-f]{16}|\d+\.\d+)(?:\/\d+)?$/;

export function cityCodeModel(settings: V2Settings, blockAddress?: BlockAddress): CodeModel {
  const seed = readGenerationSeed(settings.options.seed);
  if (!SEED_PATTERN.test(seed.base)) throw new Error('The root seed must be 6 characters of the code alphabet.');
  const header = headerOf(settings, codeBaseline()),
    base = headerSettings(seed.base, header);
  const model: CodeModel = { seed: seed.base, header, params: [], edits: [], pins: [], ...(reliefNotInCode(settings) ? { reliefMissing: true } : {}) };
  model.params = readParams({ settings, options: settings.options, urban: { ...settings.urban, local: undefined, buildings: undefined } }, { settings: base, options: base.options, urban: base.urban ?? {} });

  // Region: demography and stage rerolls.
  const region: CodeAction[] = [];
  DEMOGRAPHY_FIELDS.forEach((field, index) => {
    const value = readSettingPath(settings.region?.demography, field);
    if (typeof value === 'boolean') region.push({ kind: 'demography', field: index, n: Number(value) });
    else if (typeof value === 'number' && Number.isFinite(value)) region.push({ kind: 'demography', field: index, n: Math.max(0, Math.round(MILLI.has(field) ? value * 1000 : value)) });
  });
  const stages = new Map<number, Map<number, number>>();
  for (const [key, value] of Object.entries(seed.variations)) {
    if (typeof value !== 'number' || value <= 0) continue; // A typed seed text is not shareable: the code stores iterations only.
    const step = GLOBAL_STEPS.indexOf(key);
    if (step >= 0) {
      region.push({ kind: 'stage', stage: step, n: value });
      continue;
    }
    const match = /^city\/([^/]+)\/([^/]+)$/.exec(key),
      n = match ? settlementNumber(match[1]) : undefined,
      stage = match ? STAGES.indexOf(match[2] as never) : -1;
    if (n !== undefined && stage >= 0) (stages.get(n) ?? stages.set(n, new Map()).get(n)!).set(stage, value);
  }
  const stageOrder = (a: CodeAction) => (a.kind === 'stage' ? a.stage : -1);
  region.sort((a, b) => stageOrder(a) - stageOrder(b));
  const regionHouse = codedRecord((settings.urban?.houses as { house_config?: object } | undefined)?.house_config);
  if (regionHouse) region.push({ kind: 'house', record: regionHouse });
  // House models by building: `<settlement>/<id>` keys go to their settlement, bare ids stay on the region.
  const buildings = new Map<number, [string, CodeRecord][]>();
  for (const [saved, edit] of Object.entries(settings.urban?.buildings ?? {}).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const record = codedRecord(edit);
    if (!record) continue;
    const slash = saved.indexOf('/'),
      n = slash > 0 ? settlementNumber(saved.slice(0, slash)) : undefined;
    if (n !== undefined && settlementKey(n) === saved.slice(0, slash)) (buildings.get(n) ?? buildings.set(n, []).get(n)!).push([saved.slice(slash + 1), record]);
    else region.push({ kind: 'building', id: saved, record });
  }
  if (region.length) model.edits.push({ path: [], actions: region });

  // Settlements, then their quarters.
  const numbers = new Set<number>([...stages.keys(), ...buildings.keys()]);
  const keyOf = new Map<number, string>();
  const extentMetres = adaptedExtent({ ...settings, extent: headerExtent(header) }),
    maxCoordinate = Math.min(extentMetres - 1, Math.pow(CODE_BASE, pinWidth(headerExtent(header))) - 1);
  const coordinate = (v: number) => Math.min(maxCoordinate, Math.max(0, Math.round(v)));
  const places = new Map<number, CodeAction>();
  const namedPlaces: [string, string][] = [];
  for (const place of settings.region?.customPlaces ?? []) {
    const n = settlementNumber(place.key);
    if (n === undefined || !place.position) continue;
    places.set(n, { kind: 'place', x: coordinate(place.position.x), y: coordinate(place.position.y), population: populationLevel(place.population), culture: indexOrThrow(CULTURES, place.culture, 'culture'), site: Math.max(0, SITES.indexOf((place.siteType ?? 'auto') as never)) });
    numbers.add(n);
    keyOf.set(n, place.key);
    if (place.name && settlementKey(n) === place.key) namedPlaces.push([place.key, place.name]);
  }
  for (const key of new Set([...Object.keys(settings.local), ...Object.keys(settings.urban?.local ?? {})])) {
    const n = settlementNumber(key);
    if (n === undefined) continue;
    numbers.add(n);
    keyOf.set(n, key);
  }
  for (const n of [...numbers].sort((a, b) => a - b)) {
    const key = keyOf.get(n) ?? settlementKey(n),
      local = settings.local[key] ?? {},
      urban = settings.urban?.local?.[key] ?? {};
    const actions: CodeAction[] = places.has(n) ? [places.get(n)!] : [];
    const own = new Map(stages.get(n) ?? []);
    // A whole-settlement reroll moves every stage together: write it once as the settlement's iteration.
    const common = Math.min(...URBAN_SEED_STAGES.map((_, i) => own.get(i) ?? 0));
    if (common > 0) actions.push({ kind: 'reroll', n: common });
    for (const [stage, value] of [...own].sort((a, b) => a[0] - b[0])) if (value - (stage < URBAN_SEED_STAGES.length ? common : 0) > 0) actions.push({ kind: 'stage', stage, n: value - (stage < URBAN_SEED_STAGES.length ? common : 0) });
    if (local.population !== undefined) actions.push({ kind: 'population', n: Math.max(0, Math.round(local.population)) });
    const params = readParams({ options: local, urban: { ...urban, local: undefined } });
    if (params.length) actions.push({ kind: 'params', params });
    const programme = urban.layout?.programme as { counts?: unknown; countMode?: string } | undefined,
      counts = Object.entries(normalizeProgrammeCounts(programme?.counts)).filter(([role]) => COUNT_ROLES.includes(role));
    if (counts.length || programme?.countMode === 'force') actions.push({ kind: 'counts', force: programme?.countMode === 'force', counts: counts.map(([role, count]) => [COUNT_ROLES.indexOf(role), count] as [number, number]).sort((a, b) => a[0] - b[0]) });
    const house = codedRecord((urban.houses as { house_config?: object } | undefined)?.house_config);
    if (house) actions.push({ kind: 'house', record: house });
    // Lots and buildings in id order, so a building follows its lot and lots of one block follow each other: each id
    // is written after the bytes it shares with the previous one.
    const byId: Extract<CodeAction, { id: string }>[] = (buildings.get(n) ?? []).map(([id, record]) => ({ kind: 'building', id, record }));
    for (const [id, edit] of Object.entries(urban.parcels?.overrides?.parcels ?? {})) {
      const record = codedRecord(edit);
      if (record) byId.push({ kind: 'parcel', id, record });
    }
    for (const [id, override] of Object.entries(urban.layout?.overrides?.walls ?? {})) {
      const record = codedRecord(override);
      if (record) byId.push({ kind: 'wall', id, record });
    }
    const subdivisions: CodeEdit[] = [];
    const subdivision = (path: number[], scope: 'quarter' | 'block', override: { salt?: number; culture?: string; houseConfig?: object }) => {
      const own: CodeAction[] = [];
      if (override.salt) own.push({ kind: 'reroll', n: override.salt });
      const choices = readParams(scope === 'quarter' ? { quarter: override } : { block: override });
      if (override.culture) choices.unshift([CULTURE_ID(), indexOrThrow(CULTURES, override.culture, 'culture')]);
      if (choices.length) own.push({ kind: 'params', params: choices });
      const houseModel = codedRecord(override.houseConfig);
      if (houseModel) own.push({ kind: 'house', record: houseModel });
      if (own.length) subdivisions.push({ path, actions: own });
    };
    const quarters = Object.entries(urban.layout?.overrides?.quarters ?? {})
      .filter(([q]) => QUARTER_KEY.test(q))
      .sort((a, b) => Number(a[0]) - Number(b[0]));
    for (const [id, override] of quarters) {
      if (id.includes('/') || structural(override)) {
        const record = codedRecord(override);
        if (record) byId.push({ kind: 'quarter', id, record });
      } else subdivision([n, Number(id)], 'quarter', override);
    }
    const blocks = Object.entries(urban.parcels?.overrides?.blocks ?? {}).flatMap(([saved, override]) => {
      const split = SPLIT_KEY.exec(saved),
        source = split?.[1] ?? saved,
        position = BLOCK_POSITION_KEY.exec(source),
        address = position ? ([Number(position[1]), Number(position[2])] as const) : blockAddress?.(key, source);
      if (split || structural(override)) {
        const id = address ? blockPositionKey(...address) + (split ? `/${split[2]}` : '') : saved;
        const record = codedRecord(override);
        if (record && BLOCK_KEY.test(id)) byId.push({ kind: 'block', id, record });
        return [];
      }
      return address ? [{ address, override }] : [];
    });
    blocks.sort((a, b) => a.address[0] - b.address[0] || a.address[1] - b.address[1]);
    for (const { address, override } of blocks) subdivision([n, ...address], 'block', override);
    actions.push(...byId.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.kind < b.kind ? -1 : 1)));
    if (actions.length) model.edits.push({ path: [n], actions });
    model.edits.push(...subdivisions);
  }
  model.pins = (settings.pins ?? []).map(pin => [coordinate(pin.x), coordinate(pin.y)]);
  const extras = cityCodeExtras(settings, namedPlaces);
  if (extras) model.extras = extras;
  return model;
}
/** The short code of a recipe. Snapshot-only edits stay in the project file. */
export function encodeCityCode(settings: V2Settings, blockAddress?: BlockAddress): string {
  return formatCode(cityCodeModel(settings, blockAddress));
}
export function settingsFromModel(model: CodeModel): V2Settings {
  const settings = headerSettings(model.seed, model.header);
  const urbanRoot = () => (settings.urban ??= { backend: settings.runtime?.backend ?? 'rust' });
  applyParams({ settings: () => settings, options: () => settings.options, urban: urbanRoot }, model.params);
  const variations: Record<string, number> = {};
  for (const edit of model.edits) {
    const [n, q, b, ...deeper] = edit.path;
    if (deeper.length) throw new Error(INVALID_CODE);
    const key = n === undefined ? '' : settlementKey(n);
    const local = () => (settings.local[key] ??= {});
    const urban = () => ((urbanRoot().local ??= {})[key] ??= {});
    /** The overrides of the addressed quarter or block, created when first written. */
    const subdivision = (): { salt?: number; culture?: string; houseConfig?: object } => {
      if (b === undefined) return ((((urban().layout ??= {}).overrides ??= {}).quarters ??= {})[String(q)] ??= {});
      return ((((urban().parcels ??= {}).overrides ??= {}).blocks ??= {})[blockPositionKey(q, b)] ??= {});
    };
    /** The house model of the region (no key) or of a settlement. */
    const houseModel = (record: CodeRecord) => {
      const root = (n === undefined ? urbanRoot() : urban()) as { houses?: { house_config?: object } };
      (root.houses ??= {}).house_config = record;
    };
    for (const action of edit.actions) {
      if ('id' in action && action.id === '__proto__') throw new Error(INVALID_CODE);
      if (action.kind === 'building' && q === undefined) (urbanRoot().buildings ??= {})[n === undefined ? action.id : `${key}/${action.id}`] = action.record as HouseEditConfig;
      else if (action.kind === 'house' && q === undefined) houseModel(action.record);
      else if (action.kind === 'house') subdivision().houseConfig = action.record;
      else if (action.kind === 'parcel' && n !== undefined && q === undefined) (((urban().parcels ??= {}).overrides ??= {}).parcels ??= {})[action.id] = action.record as ParcelOverride;
      else if (action.kind === 'quarter' && n !== undefined && q === undefined && QUARTER_KEY.test(action.id)) (((urban().layout ??= {}).overrides ??= {}).quarters ??= {})[action.id] = action.record as QuarterOverride;
      else if (action.kind === 'block' && n !== undefined && q === undefined && BLOCK_KEY.test(action.id)) (((urban().parcels ??= {}).overrides ??= {}).blocks ??= {})[action.id] = action.record as BlockOverride;
      else if (action.kind === 'wall' && n !== undefined && q === undefined) (((urban().layout ??= {}).overrides ??= {}).walls ??= {})[action.id] = action.record as WallOverride;
      else if (n === undefined) {
        if (action.kind === 'demography') {
          const field = DEMOGRAPHY_FIELDS[action.field];
          if (!field) throw new Error(INVALID_CODE);
          writeSettingPath(((settings.region ??= {}).demography ??= {}), field, field === 'followCulture' ? action.n === 1 : MILLI.has(field) ? action.n / 1000 : action.n);
        } else if (action.kind === 'stage' && GLOBAL_STEPS[action.stage]) variations[GLOBAL_STEPS[action.stage]] = action.n;
        else throw new Error(INVALID_CODE);
      } else if (q === undefined) {
        if (action.kind === 'reroll') for (const stage of URBAN_SEED_STAGES) variations[`city/${key}/${stage}`] = action.n;
        else if (action.kind === 'stage' && STAGES[action.stage]) variations[`city/${key}/${STAGES[action.stage]}`] = (STAGES[action.stage] === 'default' ? 0 : (variations[`city/${key}/${STAGES[action.stage]}`] ?? 0)) + action.n;
        else if (action.kind === 'population') local().population = action.n;
        else if (action.kind === 'params') applyParams({ options: local, urban }, action.params);
        else if (action.kind === 'counts') {
          const programme = (((urban().layout ??= {} as never) as { programme?: Record<string, unknown> }).programme ??= {});
          const counts: Record<string, number> = {};
          for (const [role, count] of action.counts) {
            if (!COUNT_ROLES[role]) throw new Error(INVALID_CODE);
            counts[COUNT_ROLES[role]] = count;
          }
          programme.counts = normalizeProgrammeCounts(counts);
          if (action.force) programme.countMode = 'force';
          else delete programme.countMode;
        } else if (action.kind === 'place') {
          const custom = ((settings.region ??= {}).customPlaces ??= []).filter(place => place.key !== key);
          const spec: SettlementSpec = { key, name: '', population: levelPopulation(action.population), culture: cultureAt(action.culture), siteType: pick(SITES, action.site, 0), sitePrefs: {}, position: { x: action.x, y: action.y } };
          settings.region.customPlaces = [...custom, spec];
        } else throw new Error(INVALID_CODE);
      } else if (action.kind === 'reroll') subdivision().salt = action.n;
      else if (action.kind === 'params') {
        for (const choice of action.params) {
          if (choice[0] !== CULTURE_ID()) applyParams(b === undefined ? { quarter: subdivision } : { block: subdivision }, [choice]);
          else subdivision().culture = cultureAt(choice[1]);
        }
      } else throw new Error(INVALID_CODE);
    }
  }
  settings.options.seed = writeGenerationSeed({ base: model.seed, variations });
  if (model.pins.length) settings.pins = model.pins.map(([x, y]) => ({ x, y }));
  if (model.extras) applyCityCodeExtras(settings, model.extras);
  validateSettings(settings);
  return settings;
}

// ---------------------------------------------------------------- input and sharing

export interface DecodedCityCode {
  settings: V2Settings;
  mods: unknown[];
  /** The shared map has an imported or hand-drawn relief that the code does not carry. */
  reliefMissing?: boolean;
}
const CODE_SHAPE = new RegExp(`^${DIGIT_CLASS}{${SEED_LENGTH}}${DIGIT_CLASS}{0,6}\\*?(?:-${DIGIT_CLASS}+)?(?:_[0-9a-zKHPBQDWX.~]+)*(?:!${DIGIT_CLASS}+)?(?::[A-Za-z0-9_-]+)?$`);
/** Pin lines of the debug text: `#<n> x=<m> y=<m> <text>`. */
const PIN_LINE = /^#(\d+)\s+x=(-?\d+)\s+y=(-?\d+)(?:\s+(.*))?$/;
/** Plain text for a bug report: the code, the build and page, then one line per pin with its text. */
export function cityDebugText(settings: V2Settings, build: string, blockAddress?: BlockAddress): string {
  const code = encodeCityCode(settings, blockAddress);
  return [code, `${build} · page v2`, ...(settings.pins ?? []).map((pin, i) => `#${i + 1} x=${Math.round(pin.x)} y=${Math.round(pin.y)}${pin.text ? ` ${pin.text}` : ''}`)].join('\n');
}
export function decodeCityCode(text: string): DecodedCityCode {
  const lines = text.trim().split(/\r?\n/);
  // Older debug blocks may contain pin texts only in their human-readable lines.
  const first = cityCodeFromInput(lines[0]);
  const input = lines.length > 1 && CODE_SHAPE.test(first) ? first : cityCodeFromInput(text);
  if (!CODE_SHAPE.test(input)) {
    // A watabou city / village link or an Azgaar burg becomes a fresh recipe on the default baseline.
    const hints = parseExternalCity(input);
    if (hints) return { settings: applyExternalCity(hints, codeBaseline()), mods: [] };
    throw new Error(UNRECOGNISED_INPUT);
  }
  let settings: V2Settings, model: CodeModel;
  try {
    model = parseCode(input);
    settings = settingsFromModel(model);
  } catch {
    throw new Error(INVALID_CODE);
  }
  if (!model.extras?.pins)
    for (const line of lines.slice(1)) {
      const match = PIN_LINE.exec(line.trim()),
        pin = match ? settings.pins?.[Number(match[1]) - 1] : undefined;
      if (pin && match?.[4]?.trim()) pin.text = match[4].trim();
    }
  return { settings, mods: [], ...(model.reliefMissing ? { reliefMissing: true } : {}) };
}
/** Accept a copied code or a share URL. Other payloads (an Azgaar CSV row or JSON) are returned trimmed for the external-city parsers. */
export function cityCodeFromInput(text: string): string {
  text = text.trim();
  const compact = text.replace(/\s/g, '');
  if (CODE_SHAPE.test(compact)) return compact;
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(compact)) return text;
  try {
    const shared = new URLSearchParams(new URL(compact).hash.slice(1)).get('city');
    return shared === null ? compact : cityCodeFromInput(shared);
  } catch {
    return compact;
  }
}
export function cityCodeUrl(code: string, base: string): string {
  const url = new URL(base);
  url.hash = new URLSearchParams({ city: code }).toString();
  return url.href;
}
/** The root "roll dice": the next seed. The generator hashes the seed, so neighbouring seeds share nothing. */
export function nextRootSeed(seed: string): string {
  const root = rootSeedFromText(seed);
  return writeInt((readInt(root) + 1) % Math.pow(CODE_BASE, SEED_LENGTH), SEED_LENGTH);
}
/** Normalise typed text to a root seed: Crockford reading (i, l → 1; o → 0; u → v), other characters dropped,
 * padded from a stable hash of the text when shorter than 6. */
export function rootSeedFromText(text: string): string {
  const digits = [...text.toLowerCase()]
    .map(c => ({ i: '1', l: '1', o: '0', u: 'v' })[c] ?? c)
    .filter(isCodeDigit)
    .join('');
  if (digits.length >= SEED_LENGTH) return digits.slice(0, SEED_LENGTH);
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  let out = digits;
  while (out.length < SEED_LENGTH) {
    out += CODE_DIGITS[(hash >>> 0) % CODE_BASE];
    hash = Math.imul(hash ^ out.length, 16777619);
  }
  return out;
}
