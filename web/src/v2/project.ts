import type { Options, World } from '../gen/types';
import type { V2Settings, V2Project } from './contracts';
import { V2_ENGINE_VERSION } from './cache';
import { CULTURES, SITE_ARCHETYPES } from '../gen/options';
import { normalizeRuntime } from './runtimeChoices';
import { validateTerrainSettings, migrateTerrainClimate, TERRAIN_EXTENT_MIN, TERRAIN_EXTENT_MAX } from './terrainSettings';
import { validateRegionSettings } from './regionSettings';
import { defaultSettings } from './settings';
import { projectJsonChunks } from './projectJson';
import { validateAppearance } from './appearance';
import { NAME_FAMILIES } from '../gen/names/types';

function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function checkEnum(value: unknown, values: readonly unknown[], name: string): void {
  if (value !== undefined && !values.includes(value)) throw new Error(`${name} : valeur inconnue.`);
}
function finite(value: unknown, name: string, lo: number, hi: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < lo || value > hi) throw new Error(`${name} : nombre attendu entre ${lo} et ${hi}.`);
}
function validateOptions(o: unknown, partial = false): asserts o is Options {
  if (!isRecord(o)) throw new Error('Paramètres de génération invalides.');
  if (!partial || o.seed !== undefined) if (typeof o.seed !== 'string' || o.seed.length > 1000) throw new Error('Graine invalide.');
  for (const [key, values] of Object.entries({ size: ['hamlet', 'village', 'town', 'city', 'capital'], relief: ['flat', 'hills', 'valley', 'mountains'],
    coast: ['none', 'N', 'E', 'S', 'W', 'random'], river: ['none', 'stream', 'river', 'major'], style: ['parchment', 'atlas'],
    walls: ['auto', 'yes', 'no', 'none', 'single', 'double'], castle: ['auto', 'yes', 'no'],
    biome: ['temperate', 'forest', 'desert', 'steppe', 'tropical', 'tundra', 'underdark', 'underdark-caverns'] })) {
    if (!partial && ['size', 'relief', 'coast', 'river', 'style', 'walls', 'castle'].includes(key) && o[key] === undefined) throw new Error(`Paramètre manquant : ${key}`);
    checkEnum(o[key], values, key);
  }
  if (!partial || o.population !== undefined) finite(o.population, 'population', 0, 5e6);
  if (!partial || o.roads !== undefined) finite(o.roads, 'routes', 0, 20);
  if (!partial || o.culture !== undefined) if (typeof o.culture !== 'string' || o.culture.length > 200) throw new Error('Culture invalide.');
  if (o.culture !== undefined && !CULTURES.includes(o.culture as string)) throw new Error('Culture inconnue.');
  checkEnum(o.siteType, ['auto', ...SITE_ARCHETYPES], 'type de site');
  checkEnum(o.language, ['auto', ...NAME_FAMILIES], 'langue des noms');
  checkEnum(o.workflow, ['environment', 'automatic', 'list'], 'parcours');
  for (const key of ['moat', 'cathedral', 'palace', 'monasteries', 'port', 'arena', 'activities']) checkEnum(o[key], ['auto', 'yes', 'no'], key);
  for (const key of ['suburbs', 'shantytowns']) checkEnum(o[key], ['auto', 'none', 'some', 'many'], key);
  checkEnum(o.castles, ['auto', '0', '1', '2', '3'], 'châteaux');
  checkEnum(o.lakes, ['auto', 'none', 'some'], 'lacs');
  if (o.mapSize !== undefined) finite(o.mapSize, 'taille', TERRAIN_EXTENT_MIN, TERRAIN_EXTENT_MAX);
  if (o.sprawl !== undefined) finite(o.sprawl, 'étalement', .5, 2);
  if (o.seaLevel !== undefined) finite(o.seaLevel, 'niveau marin', -10, 10);
  if (o.heightScale !== undefined) finite(o.heightScale, 'amplitude heightmap', 0, 20000);
  if (o.importSea !== undefined) finite(o.importSea, 'niveau marin heightmap', -20000, 20000);
  for (const field of ['contours', 'landuse', 'labels', 'legend']) if (o[field] !== undefined && typeof o[field] !== 'boolean') throw new Error(`${field} : booléen attendu.`);
  if (o.importedHeight !== undefined) {
    const image = o.importedHeight;
    if (!isRecord(image)) throw new Error('Heightmap invalide.');
    finite(image.w, 'largeur heightmap', 1, 8192); finite(image.h, 'hauteur heightmap', 1, 8192);
    const elevations = image.elevations;
    if (!Number.isInteger(image.w) || !Number.isInteger(image.h) || Number(image.w) * Number(image.h) > 16777216 ||
      !(image.rgba instanceof Uint8Array || image.rgba instanceof Uint8ClampedArray) ||
      (elevations !== undefined ? !(elevations instanceof Float32Array) || elevations.length !== Number(image.w) * Number(image.h) || !elevations.every(Number.isFinite)
        : image.rgba.length !== Number(image.w) * Number(image.h) * 4))
      throw new Error('Les dimensions de la heightmap ne correspondent pas aux pixels.');
  }
}
export function validateSettings(value: unknown): asserts value is V2Settings {
  if (!isRecord(value)) throw new Error('Projet V2 invalide.');
  validateOptions(value.options);
  if (value.extent !== 'auto') finite(value.extent, 'étendue', TERRAIN_EXTENT_MIN, TERRAIN_EXTENT_MAX);
  if (value.terrain !== undefined) validateTerrainSettings(value.terrain);
  if (value.region !== undefined) validateRegionSettings(value.region);
  finite(value.settlementCount, 'nombre de lieux', 0, 100);
  if (!Number.isInteger(value.settlementCount)) throw new Error('Le nombre de lieux doit être entier.');
  checkEnum(value.generation, ['procedural', 'neural'], 'génération');
  if (value.generation === undefined || !isRecord(value.local) || Object.keys(value.local).length > 2000) throw new Error('Paramètres locaux invalides.');
  for (const [key, options] of Object.entries(value.local)) {
    if (!/^[\w:-]{1,80}$/.test(key)) throw new Error('Clé de lieu invalide.');
    validateOptions(options, true);
  }
  if (value.runtime !== undefined) {
    if (!isRecord(value.runtime)) throw new Error('Configuration du moteur invalide.');
    checkEnum(value.runtime.compute, ['auto', 'cpu', 'gpu'], 'calcul');
    checkEnum(value.runtime.backend, ['typescript', 'rust', 'native'], 'moteur');
    checkEnum(value.runtime.source, ['procedural', 'procedural-phasor', 'neural-wasm', 'neural-python', 'neural'], 'source de relief');
    if (!value.runtime.compute || !value.runtime.backend || !value.runtime.source) throw new Error('Configuration du moteur incomplète.');
    if (value.runtime.resolution !== undefined) finite(value.runtime.resolution, 'résolution moteur', 64, 2048);
    if (value.runtime.erosion !== undefined) finite(value.runtime.erosion, 'érosion moteur', 0, 10);
  }
  if (value.appearance !== undefined) validateAppearance(value.appearance);
  if (value.naming !== undefined) {
    if (!isRecord(value.naming)) throw new Error('Nommage invalide.');
    if (value.naming.title !== undefined && (typeof value.naming.title !== 'string' || value.naming.title.length > 200)) throw new Error('Titre de carte invalide.');
    if (value.naming.places !== undefined) {
      if (!isRecord(value.naming.places) || Object.keys(value.naming.places).length > 2000) throw new Error('Noms des lieux invalides.');
      for (const [key, name] of Object.entries(value.naming.places)) if (!/^[\w:-]{1,80}$/.test(key) || typeof name !== 'string' || name.length > 200) throw new Error('Nom de lieu invalide.');
    }
  }
  if (value.urban !== undefined) {
    if (!isRecord(value.urban)) throw new Error('Moteur urbain invalide.');
    if (value.urban.backend !== undefined) checkEnum(value.urban.backend, ['typescript', 'rust', 'native'], 'moteur urbain');
    const stages = ['layout', 'parcels', 'programme', 'buildings'];
    checkEnum(value.urban.through, stages, 'étape urbaine');
    if (value.urban.local !== undefined) {
      if (!isRecord(value.urban.local)) throw new Error('Contrôles urbains locaux invalides.');
      for (const local of Object.values(value.urban.local)) {
        if (!isRecord(local)) throw new Error('Contrôles urbains locaux invalides.');
        checkEnum(local.through, stages, 'étape urbaine locale');
      }
    }
    if (value.urban.buildings !== undefined && !isRecord(value.urban.buildings)) throw new Error('Contrôles des maisons invalides.');
  }
  checkTree(value, false);
}

/** Bound nesting and reject non-finite parameters before any geometry is computed. */
function checkTree(root: unknown, allowNonFinite: boolean): void {
  const pending: [unknown, number][] = [[root, 0]];
  let nodes = 0;
  while (pending.length) {
    const [value, depth] = pending.pop()!;
    if (++nodes > 4e6 || depth > 50) throw new Error('Structure du projet trop complexe.');
    if (typeof value === 'number' && !Number.isFinite(value) && !allowNonFinite) throw new Error('Paramètre numérique non fini.');
    if (!value || typeof value !== 'object') continue;
    if (ArrayBuffer.isView(value)) continue;
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Champ de projet interdit.');
      const child = (value as Record<string, unknown>)[key];
      if (child && typeof child === 'object') pending.push([child, depth + 1]);
      else {
        if (++nodes > 4e6 || depth + 1 > 50) throw new Error('Structure du projet trop complexe.');
        if (typeof child === 'number' && !Number.isFinite(child) && !allowNonFinite) throw new Error('Paramètre numérique non fini.');
      }
    }
  }
}

const arrayTypes = { Float32Array, Float64Array, Int8Array, Int16Array, Int32Array, Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array };
/** Numeric raster elements need no JSON reviver call; only objects can contain our tags. */
function reviveProject(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) if (value[i] && typeof value[i] === 'object') value[i] = reviveProject(value[i]);
    return value;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('Champ de projet interdit.');
    if (record[key] && typeof record[key] === 'object') record[key] = reviveProject(record[key]);
  }
  if (!('$mu' in record)) return record;
  if (record.$mu === 'number' && ['Infinity', '-Infinity', 'NaN'].includes(String(record.value))) return Number(record.value);
  const type = Object.hasOwn(arrayTypes, String(record.$mu)) ? arrayTypes[record.$mu as keyof typeof arrayTypes] : undefined;
  if (!type || !Array.isArray(record.data) || record.data.length > 67108864) throw new Error('Tableau numérique du projet invalide.');
  for (let i = 0; i < record.data.length; i++) if (typeof record.data[i] !== 'number') throw new Error('Tableau numérique du projet invalide.');
  return new type(record.data);
}
export function validateWorld(world: unknown): asserts world is World {
  if (!isRecord(world) || !isRecord(world.terrain) || !isRecord(world.stats)) throw new Error('Carte du projet invalide.');
  validateOptions(world.options);
  finite(world.mapSize, 'taille de carte', TERRAIN_EXTENT_MIN, TERRAIN_EXTENT_MAX);
  if (typeof world.seed !== 'string') throw new Error('Graine de carte invalide.');
  const terrain = world.terrain;
  const grid = terrain.height;
  if (!isRecord(grid)) throw new Error('Grille d’altitude absente.');
  finite(grid.w, 'largeur de grille', 1, 4096); finite(grid.h, 'hauteur de grille', 1, 4096);
  if (!Number.isInteger(grid.w) || !Number.isInteger(grid.h)) throw new Error('Dimensions de grille invalides.');
  const length = Number(grid.w) * Number(grid.h);
  for (const key of ['height', 'slope', 'flow']) {
    const field = terrain[key];
    if (!isRecord(field) || field.w !== grid.w || field.h !== grid.h || !(field.data instanceof Float32Array) || field.data.length !== length)
      throw new Error(`Grille ${key} incompatible.`);
    finite(field.cell, `résolution ${key}`, .001, TERRAIN_EXTENT_MAX);
    if (!field.data.every(Number.isFinite)) throw new Error(`Grille ${key} non finie.`);
  }
  for (const [key, type] of [['water', Uint8Array], ['receiver', Int32Array], ['filled', Float32Array]] as const)
    if (!(terrain[key] instanceof type) || (terrain[key] as Uint8Array).length !== length) throw new Error(`Champ ${key} incompatible.`);
  if (!(terrain.filled as Float32Array).every(Number.isFinite) || !(terrain.receiver as Int32Array).every(n => n >= -1 && n < length)) throw new Error('Drainage de la carte invalide.');
  if (!Array.isArray(terrain.rivers) || !Array.isArray(terrain.lakes) || !Array.isArray(terrain.coastline)) throw new Error('Couches d’eau absentes.');
  if (!(terrain.water as Uint8Array).every(n => n <= 4)) throw new Error('Masque d’eau invalide.');
  function geometry(value: unknown): void {
    if (Array.isArray(value)) { for (const child of value) if (child && typeof child === 'object') geometry(child); return; }
    if (!isRecord(value) || ArrayBuffer.isView(value)) return;
    if ('x' in value || 'y' in value) {
      finite(value.x, 'coordonnée x', -1e7, 1e7); finite(value.y, 'coordonnée y', -1e7, 1e7);
    }
    for (const key in value) if (Object.hasOwn(value, key) && value[key] && typeof value[key] === 'object') geometry(value[key]);
  }
  checkTree(world, true);
  geometry(world);
}
export function serializeProject(settings: V2Settings, world?: World, mods: unknown[] = []): string {
  return serializeProjectChunks(settings, world, mods).join('');
}
/** Blob exports consume chunks directly, without another complete UTF-16 project string. */
export function serializeProjectChunks(settings: V2Settings, world?: World, mods: unknown[] = []): string[] {
  validateSettings(settings);
  if (world) validateWorld(world);
  const project: V2Project = { format: 'magna-urbis-v2', version: 1, engine: V2_ENGINE_VERSION, settings, ...(world ? { world } : {}), mods };
  return projectJsonChunks(project);
}
export function parseProject(text: string): V2Project {
  if (text.length > 256 * 1024 * 1024) throw new Error('Projet trop volumineux (256 Mio maximum).');
  return parsedProject(reviveProject(JSON.parse(text)));
}
/** Read the discriminator once, including whitespace and escaped JSON keys/values. */
export function parseProjectInput(text:string):V2Project{
  if(text.length>256*1024*1024)throw new Error('Projet trop volumineux (256 Mio maximum).');
  const value:unknown=JSON.parse(text);
  if(isRecord(value)&&value.format==='magna-urbis-v2-seed'){
    if(value.version!==1||typeof value.seed!=='string'||value.seed.length>1000)throw new Error('Graine V2 invalide.');
    const settings=defaultSettings();settings.options.seed=value.seed;
    return {format:'magna-urbis-v2',version:1,engine:V2_ENGINE_VERSION,settings,mods:[]};
  }
  return parsedProject(reviveProject(value));
}
function parsedProject(project:unknown):V2Project{
  if (!isRecord(project) || project.format !== 'magna-urbis-v2' || project.version !== 1 || typeof project.engine !== 'string') throw new Error('Format de projet V2 inconnu.');
  validateSettings(project.settings);
  migrateTerrainClimate((project.settings as { terrain?: { climate?: unknown } }).terrain);
  // Hand-edited or older recipes reach the engine with one coherent backend combination.
  if ((project.settings as V2Settings).runtime) normalizeRuntime(project.settings as V2Settings);
  if (project.world !== undefined) validateWorld(project.world);
  if (!Array.isArray(project.mods) || project.mods.length > 100000) throw new Error('Historique de modifications invalide.');
  checkTree(project.mods, false);
  return project as unknown as V2Project;
}
