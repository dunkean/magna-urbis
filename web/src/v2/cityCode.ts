/** Short city code: a 6-digit root seed, then only what differs from the default city.
 *
 * Grammar (URL-safe). Digits come from cityCodeFormat.ts: lowercase base32 without i, l, o, u; those four letters are
 * the edit actions, and '-', '_', '!' open the sections, so every character has a single reading.
 *
 *   code     = seed header ["-" params] ("_" edit)* ["!" pins]       sections appear only when not empty
 *   seed     = 6 digits. Every other draw derives from it (stepSeed: hash of root + stage path + iteration).
 *              Rolling the dice on the root draws a new seed; there is no root iteration.
 *   header   = up to 6 positional digits, each an offset from the default (mod 32), trailing zeros trimmed:
 *              size (SIZE_TABLE), biome (BIOMES), relief (RELIEFS), coast mask (2 digits), terrain renderer (RENDERERS).
 *   params   = (id value)+   id = 1 digit for the 31 most changed parameters, else "z" + 2 digits (cityCodeParams.json);
 *              value = level in the parameter's own domain (boolean, choice of N, slider of N steps): 1 digit up to 32, else 2.
 *   edit     = [address] action+                  applied in code order, each on the state left by the previous one
 *   address  = n ("." n)*                         settlement number (settlementNumber), then quarter index; empty = region
 *   action   = "u" n                              reroll iteration n of the addressed settlement (every stage) or quarter
 *            | "i" stage n                        reroll iteration n of one stage (region: GLOBAL_STEPS, settlement: STAGES)
 *            | "o" n                              settlement population; on the region: "o" field n (DEMOGRAPHY_FIELDS)
 *            | "l" params                         parameters of the settlement (options and urban scopes; quarter: culture)
 *            | "K" mode role count …              building counts (layout.programme.counts): mode 1 digit (0 suggest, 1 force),
 *                                                 then pairs of role (2 digits, COUNT_ROLES index) and count (2 digits)
 *            | "~" x y pop culture site           custom place (region.customPlaces): fixed-width position as pins,
 *                                                 population on a 2-digit log scale, culture (2), site type (1, 0 = auto)
 *   pins     = (x y)+                             integer world metres, fixed width = digits of the region size
 *
 * Pin texts, toponyms, drawn coasts, painted relief and other manual edits are not in the code: use the project export.
 * The debug text (cityDebugText) adds a build line and one `#n x=… y=… text` line per pin; pasting it restores pin texts. */
import defaults from './cityCodeDefaults.json';
import type { V2Settings } from './contracts';
import { validateSettings } from './project';
import { adaptedExtent, defaultSettings } from './settings';
import { readGenerationSeed, writeGenerationSeed } from '../../../rust/bridge/generationSeed';
import { applyExternalCity, parseExternalCity } from './externalCity';
import { readSettingPath, writeSettingPath, type ParameterField } from './parameterForm';
import { codeParameters, type CodeParameter } from './cityCodeParams';
import { CODE_BASE, CODE_DIGITS, POPULATION_WIDTH, levelPopulation, populationLevel, digit, digitValue, intWidth, isCodeDigit, levelValue, parameterLevels, readInt, readParamId, valueLevel, valueWidth, writeInt, writeParamId } from './cityCodeFormat';
import { URBAN_SEED_STAGES } from './urbanSeeds';
import { POPULATION_CLASSES } from './regionalPopulation';
import { SITE_ARCHETYPES } from '../gen/options';
import type { SettlementSpec } from '../../../rust/bridge/settlements';
import { COUNTABLE } from './programmeCounts';
import { normalizeProgrammeCounts } from '../../../rust/bridge/urbanConfig';

/** Thrown for text that is neither a city code nor a known external city; localised in cityCodeSharing. */
export const UNRECOGNISED_INPUT = 'Not recognised: paste a Magna Urbis code, a watabou city/village link or an Azgaar burg (CSV row or export-script JSON).';
export const INVALID_CODE = 'Incomplete or corrupt code.';
export const SEED_LENGTH = 6;
const DIGIT_CLASS = '[0-9a-hjkmnp-tv-z]';
export const SEED_PATTERN = new RegExp(`^${DIGIT_CLASS}{${SEED_LENGTH}}$`);

export const RENDERERS = ['procedural', 'neural-wasm', 'procedural-phasor', 'neural-python', 'neural'] as const;
export const BIOMES = defaults.biomes;
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

export type CodeAction = { kind: 'reroll'; n: number } | { kind: 'stage'; stage: number; n: number } | { kind: 'population'; n: number } | { kind: 'demography'; field: number; n: number } | { kind: 'params'; params: [number, number][] } | { kind: 'place'; x: number; y: number; population: number; culture: number; site: number } | { kind: 'counts'; force: boolean; counts: [number, number][] };
const SITES = ['auto', ...SITE_ARCHETYPES] as const;
/** Countable building roles, sorted so the index only moves when the catalogue changes. */
export const COUNT_ROLES: readonly string[] = [...COUNTABLE].sort();
/** Settlement number spaces: the automatic population classes, then custom places (`place-<k>`). */
const KEY_CLASSES = [...POPULATION_CLASSES, 'place'] as const;
export interface CodeEdit {
  /** Empty = region; settlement number; then quarter index. */
  path: number[];
  actions: CodeAction[];
}
/** The parsed code, independent of the settings it is applied to. */
export interface CodeModel {
  seed: string;
  /** Header offsets: size, biome, relief, coast high, coast low, renderer. */
  header: number[];
  params: [number, number][];
  edits: CodeEdit[];
  pins: [number, number][];
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
  const size = SIZE_TABLE[header[0]];
  if (size === undefined) throw new Error(INVALID_CODE);
  return size === 'auto' ? 'auto' : size * 1000;
}
const pinWidth = (extent: 'auto' | number): number => intWidth(extent === 'auto' ? 200000 : extent);
export function formatCode(model: CodeModel): string {
  if (!SEED_PATTERN.test(model.seed)) throw new Error('The root seed must be 6 characters of the code alphabet.');
  let code = model.seed + model.header.map(digit).join('').replace(/0+$/, '');
  if (model.params.length) code += '-' + writeParams(model.params);
  for (const edit of model.edits) {
    code += '_' + edit.path.map(n => writeInt(n)).join('.');
    for (const action of edit.actions)
      if (action.kind === 'reroll') code += 'u' + writeInt(action.n);
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
  return code;
}
export function parseCode(code: string): CodeModel {
  const seed = code.slice(0, SEED_LENGTH);
  if (!SEED_PATTERN.test(seed)) throw new Error(INVALID_CODE);
  let i = SEED_LENGTH;
  const header: number[] = [];
  while (header.length < 6 && isCodeDigit(code[i])) header.push(digitValue(code[i++]));
  while (header.length < 6) header.push(0);
  const model: CodeModel = { seed, header, params: [], edits: [], pins: [] };
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
    while (code[i] !== undefined && 'uiol~K'.includes(code[i])) {
      const marker = code[i++];
      if (marker === 'u') edit.actions.push({ kind: 'reroll', n: number() });
      else if (marker === 'i') edit.actions.push({ kind: 'stage', stage: fixed(1), n: number() });
      else if (marker === 'o') edit.actions.push(path.length ? { kind: 'population', n: number() } : { kind: 'demography', field: fixed(1), n: number() });
      else if (marker === 'l') edit.actions.push({ kind: 'params', params: params() });
      else if (marker === 'K') {
        const force = fixed(1) === 1,
          counts: [number, number][] = [];
        while (isCodeDigit(code[i])) counts.push([fixed(2), fixed(2)]);
        edit.actions.push({ kind: 'counts', force, counts });
      }
      else {
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
  return model;
}

// ---------------------------------------------------------------- settings mapping

/** Settlement keys: 'main' = 0, `${class}-${j}` = 1 + j·classes + class index (KEY_CLASSES, custom places last). */
export function settlementNumber(key: string): number | undefined {
  if (key === 'main') return 0;
  const match = /^([a-z]+)-(\d+)$/.exec(key),
    index = match ? KEY_CLASSES.indexOf(match[1] as never) : -1;
  return match && index >= 0 ? 1 + Number(match[2]) * KEY_CLASSES.length + index : undefined;
}
export function settlementKey(n: number): string {
  return n === 0 ? 'main' : `${KEY_CLASSES[(n - 1) % KEY_CLASSES.length]}-${Math.floor((n - 1) / KEY_CLASSES.length)}`;
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
function fieldLevel(field: ParameterField, value: unknown): number | undefined {
  if (field.type === 'boolean') return typeof value === 'boolean' ? Number(value) : undefined;
  if (field.type === 'select') {
    const shown = field.toInput ? field.toInput(value) : value;
    const index = field.options!.findIndex(option => option.value === shown);
    return index < 0 ? undefined : index;
  }
  return typeof value === 'number' && Number.isFinite(value) ? valueLevel(field, value) : undefined;
}
function fieldValue(field: ParameterField, level: number): unknown {
  if (field.type === 'boolean') return level === 1;
  if (field.type === 'select') {
    const option = field.options![level];
    if (!option) throw new Error(INVALID_CODE);
    return field.fromInput ? field.fromInput(option.value) : option.value;
  }
  if (level >= parameterLevels(field)) throw new Error(INVALID_CODE);
  return levelValue(field, level);
}
type Roots = Record<CodeParameter['scope'], unknown>;
function readParams(roots: Roots, scopes: readonly CodeParameter['scope'][], base: Roots): [number, number][] {
  const out: [number, number][] = [];
  for (const parameter of codeParameters().byId) {
    if (!parameter || !scopes.includes(parameter.scope)) continue;
    const value = readSettingPath(roots[parameter.scope], parameter.path);
    if (value === undefined || value === null || JSON.stringify(value) === JSON.stringify(readSettingPath(base[parameter.scope], parameter.path))) continue;
    const level = fieldLevel(parameter.field, value);
    if (level !== undefined) out.push([parameter.id, level]);
  }
  return out;
}
function applyParams(roots: Record<CodeParameter['scope'], () => object>, params: readonly [number, number][]): void {
  for (const [id, level] of params) {
    const found = parameter(id);
    writeSettingPath(roots[found.scope](), found.path, fieldValue(found.field, level));
  }
}

/** The settings a code is read against. */
export const codeBaseline = (): V2Settings => defaultSettings();
const CULTURE_ID = () => codeParameters().byKey.get('options.culture')!.id;

export function cityCodeModel(settings: V2Settings): CodeModel {
  if (settings.options.importedHeight) throw new Error('An imported heightmap requires a complete project.');
  if (settings.decor) throw new Error('A saved decor requires a complete project.');
  const base = codeBaseline();
  const seed = readGenerationSeed(settings.options.seed);
  if (!SEED_PATTERN.test(seed.base)) throw new Error('The root seed must be 6 characters of the code alphabet.');
  const coast = settings.terrain?.coastMask ?? COAST_MASKS[settings.options.coast] ?? 0,
    coastOffset = offset(coast, COAST_MASKS[base.options.coast], 256);
  const header = [
    offset(nearestSize(settings.extent), 0),
    offset(indexOrThrow(BIOMES, settings.options.biome ?? 'temperate', 'biome'), BIOMES.indexOf(base.options.biome!)),
    offset(indexOrThrow(RELIEFS, settings.terrain?.relief ?? settings.options.relief, 'relief'), RELIEFS.indexOf(base.options.relief)),
    Math.floor(coastOffset / CODE_BASE),
    coastOffset % CODE_BASE,
    offset(indexOrThrow(RENDERERS, settings.runtime?.source ?? 'procedural', 'renderer'), 0),
  ];
  const model: CodeModel = { seed: seed.base, header, params: [], edits: [], pins: [] };
  model.params = readParams({ settings, options: settings.options, urban: { ...settings.urban, local: undefined, buildings: undefined } }, ['settings', 'options', 'urban'], { settings: base, options: base.options, urban: base.urban ?? {} });

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
  if (region.length) model.edits.push({ path: [], actions: region });

  // Settlements, then their quarters.
  const numbers = new Set<number>(stages.keys());
  const keyOf = new Map<number, string>();
  const extentMetres = adaptedExtent({ ...settings, extent: headerExtent(header) }),
    maxCoordinate = Math.min(extentMetres - 1, Math.pow(CODE_BASE, pinWidth(headerExtent(header))) - 1);
  const coordinate = (v: number) => Math.min(maxCoordinate, Math.max(0, Math.round(v)));
  const places = new Map<number, CodeAction>();
  for (const place of settings.region?.customPlaces ?? []) {
    const n = settlementNumber(place.key);
    if (n === undefined || !place.position) continue;
    places.set(n, { kind: 'place', x: coordinate(place.position.x), y: coordinate(place.position.y), population: populationLevel(place.population), culture: indexOrThrow(CULTURES, place.culture, 'culture'), site: Math.max(0, SITES.indexOf((place.siteType ?? 'auto') as never)) });
    numbers.add(n);
    keyOf.set(n, place.key);
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
    const params = readParams({ settings: {}, options: local, urban: { ...urban, local: undefined } }, ['options', 'urban'], { settings: {}, options: {}, urban: {} });
    if (params.length) actions.push({ kind: 'params', params });
    const programme = urban.layout?.programme as { counts?: unknown; countMode?: string } | undefined,
      counts = Object.entries(normalizeProgrammeCounts(programme?.counts)).filter(([role]) => COUNT_ROLES.includes(role));
    if (counts.length || programme?.countMode === 'force')
      actions.push({ kind: 'counts', force: programme?.countMode === 'force', counts: counts.map(([role, count]) => [COUNT_ROLES.indexOf(role), count] as [number, number]).sort((a, b) => a[0] - b[0]) });
    if (actions.length) model.edits.push({ path: [n], actions });
    const quarters = Object.entries(urban.layout?.overrides?.quarters ?? {}).filter(([q]) => /^\d+$/.test(q)).sort((a, b) => Number(a[0]) - Number(b[0]));
    for (const [q, override] of quarters) {
      const quarter: CodeAction[] = [];
      if (override.salt) quarter.push({ kind: 'reroll', n: override.salt });
      if (override.culture) quarter.push({ kind: 'params', params: [[CULTURE_ID(), indexOrThrow(CULTURES, override.culture, 'culture')]] });
      if (quarter.length) model.edits.push({ path: [n, Number(q)], actions: quarter });
    }
  }
  model.pins = (settings.pins ?? []).map(pin => [coordinate(pin.x), coordinate(pin.y)]);
  return model;
}
/** The short code of a recipe. Manual edits (mods) stay in the project file. */
export function encodeCityCode(settings: V2Settings): string {
  return formatCode(cityCodeModel(settings));
}
export function settingsFromModel(model: CodeModel): V2Settings {
  const settings = codeBaseline(),
    base = codeBaseline();
  const pick = <T>(list: readonly T[], digitOffset: number, baseIndex: number): T => {
    const value = list[(baseIndex + digitOffset) % CODE_BASE];
    if (value === undefined) throw new Error(INVALID_CODE);
    return value;
  };
  const [, biome, relief, coastHigh, coastLow, renderer] = model.header;
  settings.extent = headerExtent(model.header);
  settings.options.biome = pick(BIOMES, biome, BIOMES.indexOf(base.options.biome!)) as typeof settings.options.biome;
  const reliefValue = pick(RELIEFS, relief, RELIEFS.indexOf(base.options.relief));
  if (reliefValue !== settings.options.relief) (settings.terrain ??= {}).relief = reliefValue as NonNullable<V2Settings['terrain']>['relief'];
  const coast = (COAST_MASKS[base.options.coast] + coastHigh * CODE_BASE + coastLow) & 255;
  if (coast !== COAST_MASKS[base.options.coast]) (settings.terrain ??= {}).coastMask = coast;
  const source = pick(RENDERERS, renderer, 0);
  settings.runtime = { ...settings.runtime!, source };
  settings.generation = source.startsWith('neural') ? 'neural' : 'procedural';
  const urbanRoot = () => (settings.urban ??= { backend: settings.runtime?.backend ?? 'rust' });
  const noScope = (): object => {
    throw new Error(INVALID_CODE);
  };
  applyParams({ settings: () => settings, options: () => settings.options, urban: urbanRoot }, model.params);
  const variations: Record<string, number> = {};
  for (const edit of model.edits) {
    const [n, q, ...deeper] = edit.path;
    if (deeper.length) throw new Error('Block-level edits are not supported yet.');
    const key = n === undefined ? '' : settlementKey(n);
    const local = () => (settings.local[key] ??= {});
    const urban = () => ((urbanRoot().local ??= {})[key] ??= {});
    const quarter = () => {
      const layout = (urban().layout ??= {} as never) as { overrides?: { quarters?: Record<string, { salt?: number; culture?: string }> } };
      return (((layout.overrides ??= {}).quarters ??= {})[String(q)] ??= {});
    };
    for (const action of edit.actions) {
      if (n === undefined) {
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
        else if (action.kind === 'params') applyParams({ settings: noScope, options: local, urban }, action.params);
        else if (action.kind === 'counts') {
          const programme = ((urban().layout ??= {} as never) as { programme?: Record<string, unknown> }).programme ??= {};
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
          const spec: SettlementSpec = { key, name: '', population: levelPopulation(action.population), culture: pick(CULTURES, action.culture, 0) as string, siteType: pick(SITES, action.site, 0), sitePrefs: {}, position: { x: action.x, y: action.y } };
          settings.region.customPlaces = [...custom, spec];
        } else throw new Error(INVALID_CODE);
      } else if (action.kind === 'reroll') quarter().salt = action.n;
      else if (action.kind === 'params' && action.params.every(([id]) => id === CULTURE_ID())) for (const [, level] of action.params) quarter().culture = pick(CULTURES, level, 0) as string;
      else throw new Error(INVALID_CODE);
    }
  }
  settings.options.seed = writeGenerationSeed({ base: model.seed, variations });
  if (model.pins.length) settings.pins = model.pins.map(([x, y]) => ({ x, y }));
  validateSettings(settings);
  return settings;
}

// ---------------------------------------------------------------- input and sharing

export interface DecodedCityCode {
  settings: V2Settings;
  mods: unknown[];
}
const CODE_SHAPE = new RegExp(`^${DIGIT_CLASS}{${SEED_LENGTH}}${DIGIT_CLASS}{0,6}(?:-${DIGIT_CLASS}+)?(?:_[0-9a-zK.~]+)*(?:!${DIGIT_CLASS}+)?$`);
/** Pin lines of the debug text: `#<n> x=<m> y=<m> <text>`. */
const PIN_LINE = /^#(\d+)\s+x=(-?\d+)\s+y=(-?\d+)(?:\s+(.*))?$/;
/** Plain text for a bug report: the code, the build and page, then one line per pin with its text. */
export function cityDebugText(settings: V2Settings, build: string): string {
  const code = encodeCityCode(settings);
  return [code, `${build} · page v2`, ...(settings.pins ?? []).map((pin, i) => `#${i + 1} x=${Math.round(pin.x)} y=${Math.round(pin.y)}${pin.text ? ` ${pin.text}` : ''}`)].join('\n');
}
export function decodeCityCode(text: string): DecodedCityCode {
  const lines = text.trim().split(/\r?\n/);
  // A debug block: the first line is the code; pin lines give back the texts by order.
  const first = cityCodeFromInput(lines[0]);
  const input = lines.length > 1 && CODE_SHAPE.test(first) ? first : cityCodeFromInput(text);
  if (!CODE_SHAPE.test(input)) {
    // A watabou city / village link or an Azgaar burg becomes a fresh recipe on the default baseline.
    const hints = parseExternalCity(input);
    if (hints) return { settings: applyExternalCity(hints, codeBaseline()), mods: [] };
    throw new Error(UNRECOGNISED_INPUT);
  }
  let settings: V2Settings;
  try {
    settings = settingsFromModel(parseCode(input));
  } catch (e) {
    throw e instanceof Error && e.message === 'Block-level edits are not supported yet.' ? e : new Error(INVALID_CODE);
  }
  for (const line of lines.slice(1)) {
    const match = PIN_LINE.exec(line.trim()),
      pin = match ? settings.pins?.[Number(match[1]) - 1] : undefined;
    if (pin && match?.[4]?.trim()) pin.text = match[4].trim();
  }
  return { settings, mods: [] };
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
/** A random root seed (the root "roll dice"). */
export function randomRootSeed(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(SEED_LENGTH)), n => CODE_DIGITS[n % CODE_BASE]).join('');
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
