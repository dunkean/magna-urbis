import type { BiomeName } from '../../gen/biomes';
import type { CoastOpt, Relief, RiverOpt } from '../../gen/options';
import type { ClimateZone } from '../../../../rust/bridge/terrainClimate';
import type { ExternalCityHints } from './types';
import { coastSide, parseWatabouUrl } from './watabou';
import { FMG_BASE_TO_MU, FMG_POPULATION_SCALE, FMG_URBANIZATION_RATE, fmgBaseOf, fmgBiome, fmgNameBase, pickMuCulture } from './azgaarTables';

/**
 * Azgaar Fantasy Map Generator burg → city hints.
 * Accepts the Burgs overview CSV export (header + first data row; `,`, `;` or tab separated, quoted fields)
 * with or without its header row, one burg object as JSON (`pack.burgs[i]`, or an array whose first burg is used),
 * or the `fmg-burg-v1` object copied by the export script (./fmgExport.ts).
 */
export function parseAzgaarBurg(text: string): ExternalCityHints | null {
  const clean = text.replace(/^\ufeff/, '').trim();
  if (!clean) return null;
  if (clean.startsWith('{') || clean.startsWith('[')) return parseBurgJson(clean);
  return parseBurgCsv(clean);
}

/** What both input formats reduce to before mapping. */
interface BurgFields {
  id: string;
  name?: string;
  /** Inhabitants (people). */
  population?: number;
  cultureName?: string;
  /** FMG name base of the culture: its name, or its index in FMG's default list. */
  cultureBase?: string | number;
  /** Burg type and culture type (Generic, River, Lake, Naval, Nomadic, Hunting, Highland). */
  type?: string;
  cultureType?: string;
  precipitationMm?: number;
  biomeId?: number;
  biomeName?: string;
  /** Measured geography (export script); overrides the watabou link and type keywords. */
  river?: RiverOpt;
  coast?: CoastOpt;
  elevationM?: number;
  temperatureC?: number;
  capital?: boolean;
  port?: boolean;
  citadel?: boolean;
  walls?: boolean;
  plaza?: boolean;
  temple?: boolean;
  shantytown?: boolean;
  link?: string;
  mfcgSeed?: string;
  tags: string[];
}

// ---------- CSV ----------

function splitCsv(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(v => v.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(v => v.trim())) rows.push(row);
  return rows;
}

function pickSeparator(headerLine: string): string {
  const count = (s: string) => headerLine.split(s).length - 1;
  return ['\t', ';', ','].reduce((best, s) => (count(s) > count(best) ? s : best), ',');
}

/** Burgs overview CSV columns of the FMG versions in use, for a data row pasted without its header.
 *  Picked by field count (only the columns read here differ between same-length layouts). */
const FMG_CSV_LAYOUTS: readonly (readonly string[])[] = [
  // Current FMG (TypeScript), 34 and 32 columns.
  ['Id', 'Burg', 'Province', 'Province Full Name', 'State', 'State Full Name', 'Culture', 'Religion', 'Group', 'Type', 'Population',
    'Market', 'Product', 'Wealth', 'Prosperity', 'Balance', 'Adjustments', 'X', 'Y', 'Latitude', 'Longitude', 'Elevation',
    'Temperature', 'Temperature likeness', 'Capital', 'Port', 'Citadel', 'Walls', 'Plaza', 'Temple', 'Shanty Town', 'Emblem', 'Preview link', 'Tags'],
  ['Id', 'Burg', 'Province', 'Province Full Name', 'State', 'State Full Name', 'Culture', 'Religion', 'Group', 'Type', 'Population',
    'Market', 'Product', 'Wealth', 'Treasury', 'X', 'Y', 'Latitude', 'Longitude', 'Elevation',
    'Temperature', 'Temperature likeness', 'Capital', 'Port', 'Citadel', 'Walls', 'Plaza', 'Temple', 'Shanty Town', 'Emblem', 'Preview link', 'Tags'],
  // Classic FMG (azgaar.github.io), 26 and 25 columns ("City Generator Link" in older builds).
  ['Id', 'Burg', 'Province', 'Province Full Name', 'State', 'State Full Name', 'Culture', 'Religion', 'Group', 'Population', 'X', 'Y',
    'Latitude', 'Longitude', 'Elevation', 'Temperature', 'Temperature likeness', 'Capital', 'Port', 'Citadel', 'Walls', 'Plaza', 'Temple',
    'Shanty Town', 'Emblem', 'Preview link'],
  ['Id', 'Burg', 'Province', 'Province Full Name', 'State', 'State Full Name', 'Culture', 'Religion', 'Population', 'X', 'Y',
    'Latitude', 'Longitude', 'Elevation', 'Temperature', 'Temperature likeness', 'Capital', 'Port', 'Citadel', 'Walls', 'Plaza', 'Temple',
    'Shanty Town', 'Emblem', 'Preview link'],
  // Older classic builds, 21 and 20 columns.
  ['Id', 'Burg', 'Province', 'Province Full Name', 'State', 'State Full Name', 'Culture', 'Religion', 'Population', 'X', 'Y',
    'Latitude', 'Longitude', 'Elevation', 'Capital', 'Port', 'Citadel', 'Walls', 'Plaza', 'Temple', 'Shanty Town'],
  ['Id', 'Burg', 'Province', 'Province Full Name', 'State', 'State Full Name', 'Culture', 'Religion', 'Population',
    'Latitude', 'Longitude', 'Elevation', 'Capital', 'Port', 'Citadel', 'Walls', 'Plaza', 'Temple', 'Shanty Town'],
];

function parseBurgCsv(text: string): ExternalCityHints | null {
  const firstLine = text.split(/\r?\n/).find(line => line.trim()) ?? '';
  const rows = splitCsv(text, pickSeparator(firstLine));
  if (!rows.length) return null;
  const isHeader = (cells: string[]) => {
    const names = cells.map(h => h.trim().toLowerCase());
    return names.includes('id') && names.some(h => h === 'burg' || h.startsWith('burg ('));
  };
  let header: string[];
  let row: string[];
  if (isHeader(rows[0])) {
    if (rows.length < 2) return null;
    header = rows[0].map(h => h.trim().toLowerCase());
    row = rows[1];
  } else {
    // A data row without its header: FMG's column order; the Id comes first. Builds append columns
    // (economy, tags…), so a layout is anchored on its temperature field ("22°C") rather than on the
    // field count; layouts without temperature (old builds) still need the exact count.
    row = rows[0];
    if (!/^\d+$/.test(row[0]?.trim() ?? '')) return null;
    const temperatureAt = row.findIndex(cell => /^-?\d+(?:\.\d+)?\s*°/.test(cell.trim()));
    const layout = FMG_CSV_LAYOUTS.find(columns => columns.length <= row.length && temperatureAt >= 0 && columns.indexOf('Temperature') === temperatureAt)
      ?? FMG_CSV_LAYOUTS.find(columns => columns.length === row.length);
    if (!layout) return null;
    header = layout.map(h => h.toLowerCase());
  }
  const col = (name: string) => header.findIndex(h => h === name || h.startsWith(`${name} (`));
  const idIdx = col('id');
  const burgIdx = col('burg');
  if (idIdx < 0 || burgIdx < 0) return null;
  const get = (name: string): string | undefined => {
    const i = col(name);
    const v = i >= 0 ? row[i]?.trim() : undefined;
    return v ? v : undefined;
  };
  const flag = (name: string): boolean | undefined => {
    if (col(name) < 0) return undefined;
    const v = get(name)?.toLowerCase();
    return v !== undefined && v !== '0' && v !== 'false' && v !== 'no';
  };
  const elevationHeader = header[col('elevation')] ?? '';
  const elevationUnit = /\(([^)]*)\)/.exec(elevationHeader)?.[1];
  const elevation = get('elevation');
  const temperature = get('temperature');
  return toHints({
    id: get('id') ?? '0',
    name: get('burg'),
    population: number(get('population')),
    cultureName: get('culture'),
    type: get('type'),
    elevationM: elevation === undefined ? undefined : elevationToMeters(elevation, elevationUnit),
    temperatureC: temperature === undefined ? undefined : temperatureToCelsius(temperature),
    capital: flag('capital'),
    port: flag('port'),
    citadel: flag('citadel'),
    walls: flag('walls'),
    plaza: flag('plaza'),
    temple: flag('temple'),
    shantytown: flag('shanty town'),
    link: get('preview link'),
    tags: (get('tags') ?? '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean),
  });
}

// ---------- JSON ----------

function parseBurgJson(text: string): ExternalCityHints | null {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return null; }
  if (isFmgExport(data)) return parseFmgExport(data);
  const burg = Array.isArray(data) ? data.find(isBurg) : data;
  if (!isBurg(burg)) return null;
  const on = (v: unknown) => typeof v === 'number' ? v > 0 : v === true;
  const cultureName = typeof burg.culture === 'string' ? burg.culture
    : typeof burg.cultureName === 'string' ? burg.cultureName : undefined;
  return toHints({
    id: String(burg.i),
    name: typeof burg.name === 'string' ? burg.name : undefined,
    population: typeof burg.population === 'number' ? burg.population * FMG_POPULATION_SCALE * FMG_URBANIZATION_RATE : undefined,
    cultureName,
    type: typeof burg.type === 'string' ? burg.type : undefined,
    capital: on(burg.capital),
    port: on(burg.port),
    citadel: on(burg.citadel),
    walls: on(burg.walls),
    plaza: on(burg.plaza),
    temple: on(burg.temple),
    shantytown: on(burg.shanty),
    link: typeof burg.link === 'string' && burg.link ? burg.link : undefined,
    mfcgSeed: typeof burg.MFCG === 'string' || typeof burg.MFCG === 'number' ? String(burg.MFCG) : undefined,
    tags: Array.isArray(burg.tags) ? burg.tags.filter((t): t is string => typeof t === 'string').map(t => t.trim().toLowerCase()) : [],
  });
}

type Json = Record<string, unknown>;
const isFmgExport = (value: unknown): value is Json =>
  !!value && typeof value === 'object' && (value as Json).format === 'fmg-burg-v1';
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? v as Json : {});
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

/** The export script's object: population in people, elevation m, temperature °C, precipitation mm. */
function parseFmgExport(d: Json): ExternalCityHints {
  const culture = obj(d.culture), biome = obj(d.biome);
  const coast = d.coast === null ? null : obj(d.coast);
  const sea = num(coast?.sea);
  return toHints({
    id: String(d.i ?? '0'),
    name: str(d.name),
    population: num(d.population),
    cultureName: str(culture.name),
    cultureBase: typeof culture.base === 'number' ? culture.base : str(culture.base),
    cultureType: str(culture.type),
    type: str(d.type),
    elevationM: num(d.elevation),
    temperatureC: num(d.temperature),
    precipitationMm: num(d.precipitation),
    biomeId: num(biome.id),
    biomeName: str(biome.name),
    river: typeof d.river === 'boolean' ? (d.river ? (d.confluence === true ? 'major' : 'river') : 'none') : undefined,
    // A lake shore is not a sea coast.
    coast: coast === null ? 'none' : coast.water === 'ocean' ? (sea !== undefined ? coastSide(sea) : 'random')
      : coast.water === 'lake' ? 'none' : undefined,
    capital: bool(d.capital),
    port: bool(d.port),
    citadel: bool(d.citadel),
    walls: bool(d.walls),
    plaza: bool(d.plaza),
    temple: bool(d.temple),
    shantytown: bool(d.shanty),
    link: str(d.mfcg),
    mfcgSeed: str(d.mfcgSeed),
    tags: [],
  });
}

function isBurg(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return typeof v.i === 'number' && typeof v.name === 'string' && (typeof v.cell === 'number' || typeof v.population === 'number');
}

// ---------- units ----------

function number(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const n = Number.parseFloat(text.replace(/[\s,\u00a0\u202f]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/** FMG heights: `m`, `ft`, `f` (fathom); any custom unit is counted in feet (units.ts getHeightUnitRatio). */
function elevationToMeters(text: string, headerUnit?: string): number | undefined {
  const match = /^(-?[\d.,\s]+)\s*([a-z]*)/i.exec(text.trim());
  if (!match) return undefined;
  const value = number(match[1]);
  if (value === undefined) return undefined;
  const unit = (match[2] || headerUnit || 'm').trim().toLowerCase();
  if (unit === 'm') return value;
  if (unit === 'f') return value / 0.5468;
  return value / 3.281;
}

/** FMG temperature strings: `12°C`, `54°F`, `285K`, `°R`, `°De`, `°N`, `°Ré`, `°Rø` (units.ts convertTemperature). */
function temperatureToCelsius(text: string): number | undefined {
  const match = /^(-?[\d.]+)\s*(.*)$/.exec(text.trim());
  if (!match) return undefined;
  const v = Number.parseFloat(match[1]);
  if (!Number.isFinite(v)) return undefined;
  switch (match[2].trim()) {
    case '°F': return (v - 32) * 5 / 9;
    case 'K': return v - 273.15;
    case '°R': return v * 5 / 9 - 273.15;
    case '°De': return 100 - v * 2 / 3;
    case '°N': return v * 100 / 33;
    case '°Ré': return v * 5 / 4;
    case '°Rø': return (v - 7.5) * 40 / 21;
    default: return v;
  }
}

// ---------- mapping ----------

const slug = (text: string): string =>
  text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** FMG heights use exponent 2: 30 → 144 m, 50 → 1024 m, 60 (Highland type) → 1764 m. */
function reliefFor(elevationM: number | undefined, highland: boolean, river: boolean): Relief | undefined {
  let relief: Relief | undefined;
  if (elevationM !== undefined) relief = elevationM < 250 ? 'flat' : elevationM < 1000 ? 'hills' : 'mountains';
  else if (highland) relief = 'mountains';
  // A river town in the mountains sits in a valley.
  return relief === 'mountains' && river ? 'valley' : relief;
}

function biomeFor(temperatureC: number | undefined, wet: boolean): BiomeName | undefined {
  if (temperatureC === undefined) return undefined;
  if (temperatureC <= 0) return 'tundra';
  if (temperatureC >= 25) return wet ? 'tropical' : 'desert';
  return undefined;
}

/** Climate zone from the town's own annual mean (°C) and, when known, its rain (mm). */
function zoneFromClimate(t: number, rain: number | undefined, wet: boolean): ClimateZone {
  if (t <= -1) return 'arctic';
  if (t < 4) return 'nordic';
  if (t < 8) return 'continental';
  if (rain !== undefined && rain < 250) return t >= 18 ? 'desert' : 'steppe';
  if (rain !== undefined && rain < 500) return t >= 22 ? 'savanna' : 'steppe';
  if (t < 14) return 'temperate';
  if (t < 22) return 'mediterranean';
  if (rain !== undefined) return rain >= 1500 ? 'tropical' : 'savanna';
  return t >= 25 ? (wet ? 'tropical' : 'desert') : 'mediterranean';
}

/** FMG biome first (refined by temperature and rain), else temperature and rain alone; high towns get the alpine zone. */
function climateFor(b: BurgFields, wet: boolean): { biome?: BiomeName; zone?: ClimateZone } {
  const t = b.temperatureC, rain = b.precipitationMm;
  const fmg = b.biomeId !== undefined || b.biomeName ? fmgBiome(b.biomeId, b.biomeName) : undefined;
  let biome = fmg?.biome, zone = fmg?.zone;
  if (fmg?.name === 'Grassland' && rain !== undefined && rain >= 700) { biome = 'temperate'; zone = 'temperate'; }
  if (zone === 'temperate' && t !== undefined) zone = t < 6 ? 'continental' : t >= 15 && (rain ?? 1000) < 900 ? 'mediterranean' : zone;
  if (zone === 'wetland' && t !== undefined && t >= 22) biome = 'tropical';
  if (!zone && t !== undefined) zone = zoneFromClimate(t, rain, wet);
  if (!fmg) biome = biomeFor(t, wet);
  if (zone && ['temperate', 'continental', 'mediterranean'].includes(zone) && (b.elevationM ?? 0) >= 1500) zone = 'alpine';
  return { biome, zone };
}

function toHints(b: BurgFields): ExternalCityHints {
  const base = b.link ? parseWatabouUrl(b.link) : null;
  const keywords = new Set([b.type, b.cultureType, ...b.tags].filter((k): k is string => !!k).map(k => k.toLowerCase()));
  const seed = base?.seed
    ?? (b.mfcgSeed ? `mfcg-${b.mfcgSeed}` : ['fmg', slug(b.id), slug(b.name ?? '')].filter(Boolean).join('-'));
  const hints: ExternalCityHints = { ...base, source: 'azgaar-burg', seed };
  if (b.name) hints.name = b.name;
  if (b.population !== undefined && b.population > 0) hints.population = Math.round(b.population);
  for (const k of ['capital', 'port', 'citadel', 'walls', 'plaza', 'temple', 'shantytown'] as const) {
    if (b[k] !== undefined) hints[k] = b[k];
  }
  if (b.river) hints.river = b.river;
  if (b.coast) hints.coast = b.coast;
  // Culture type (Naval, River, Nomadic, Hunting, Highland) where the geography leaves a choice.
  if (keywords.has('naval')) {
    if (hints.coast === undefined) hints.coast = 'random';
    else if (hints.coast !== 'none' && hints.port === undefined) hints.port = true;
  }
  if (hints.port && hints.coast === undefined) hints.coast = 'random';
  if (hints.river === undefined && keywords.has('river')) hints.river = 'river' satisfies RiverOpt;
  if (keywords.has('nomadic') && hints.sprawl === undefined) hints.sprawl = 1.5;
  if (keywords.has('hunting') && hints.sprawl === undefined) hints.sprawl = 1.3;
  const river = hints.river !== undefined && hints.river !== 'none';
  const relief = reliefFor(b.elevationM, keywords.has('highland'), river);
  if (relief) hints.relief = relief;
  const wet = !!hints.port || river || (hints.coast !== undefined && hints.coast !== 'none');
  const climate = climateFor(b, wet);
  if (climate.biome) hints.biome = climate.biome;
  if (climate.zone) hints.climateZone = climate.zone;
  if (b.temperatureC !== undefined) {
    // FMG lowers temperature by 6.5 °C per km; Magna Urbis climate values are sea-level means.
    hints.temperature = Math.round((b.temperatureC + 6.5 * Math.max(0, b.elevationM ?? 0) / 1000) * 10) / 10;
  }
  if (b.precipitationMm !== undefined && b.precipitationMm >= 0) hints.precipitation = Math.round(b.precipitationMm);
  const nameBase = (b.cultureBase !== undefined ? fmgBaseOf(b.cultureBase) : undefined)
    ?? (b.cultureName ? fmgNameBase(b.cultureName) : undefined);
  // Several MU cultures can fit one name base: the culture type narrows them, the town's seed draws one.
  const culture = pickMuCulture(nameBase, b.cultureType ?? b.type, seed);
  if (culture) hints.culture = culture;
  const language = nameBase ? FMG_BASE_TO_MU[nameBase].language : undefined;
  if (language) hints.language = language;
  return hints;
}
