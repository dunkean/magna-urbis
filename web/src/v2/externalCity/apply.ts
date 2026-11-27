import defaults from '../cityCodeDefaults.json';
import type { V2Settings } from '../contracts';
import { validateSettings } from '../project';
import { sizeForPop } from '../../gen/options';
import { TOPONYM_PROFILES } from '../../gen/names/profiles';
import { writeGenerationSeed } from '../../../../rust/bridge/generationSeed';
import { CLIMATE_ZONES, CLIMATE_ZONE_VALUES, type ClimateValues } from '../../../../rust/bridge/terrainClimate';
import { climateZoneBiome, isUnderdarkBiome, type BiomeName } from '../../gen/biomes';
import type { ExternalCityHints } from './types';
import { fmgCoastTrace } from './fmgCoast';
import { applyFmgNetwork } from './fmgNetworkRecipe';

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
/** Map width for one imported town, kept tight around it: 3 km at 2,500 inhabitants, about 4 km at
 * 5,000, 6 km at 12,000, 11.5 km at 50,000; rounded to 500 m within 1.5–40 km. */
export const importExtent = (population: number): number => clamp(Math.round((3000 * Math.pow(population / 2500, 0.45)) / 500) * 500, 1500, 40000);

/** Turns external city hints into V2 settings: a modified clone of `base`, validated. Absent hints keep `base`. */
export function applyExternalCity(hints: ExternalCityHints, base: V2Settings): V2Settings {
  const settings = structuredClone(base);
  const o = settings.options;
  o.seed = writeGenerationSeed({ base: hints.seed, variations: {} });
  if (hints.population !== undefined && Number.isFinite(hints.population) && hints.population > 0) {
    o.population = Math.round(clamp(hints.population, 1, 5e6));
    o.size = sizeForPop(o.population);
  }
  if (hints.river) o.river = hints.river;
  if (hints.coast) o.coast = hints.coast;
  if (hints.biome && defaults.biomes.includes(hints.biome)) o.biome = hints.biome;
  if (hints.climateZone && (CLIMATE_ZONES as readonly string[]).includes(hints.climateZone)) {
    // As the V2 climate control: the zone, plus custom values when the source gives temperature or rain.
    const zone = hints.climateZone;
    settings.terrain ??= {};
    settings.terrain.climate = zone;
    delete settings.terrain.climateValues;
    const values: Partial<ClimateValues> = {};
    if (hints.temperature !== undefined && Number.isFinite(hints.temperature)) values.temperature = Math.round(clamp(hints.temperature, -30, 40) * 10) / 10;
    if (hints.precipitation !== undefined && Number.isFinite(hints.precipitation)) values.precipitation = Math.round(clamp(hints.precipitation, 0, 6000));
    if (Object.keys(values).length) settings.terrain.climateValues = { ...CLIMATE_ZONE_VALUES[zone], ...values };
    // The zone brings its classic biome unless the source names one.
    if (!(hints.biome && defaults.biomes.includes(hints.biome)) && !isUnderdarkBiome(String(o.biome))) o.biome = (climateZoneBiome[zone] ?? 'temperate') as BiomeName as typeof o.biome;
  }
  if (hints.culture && defaults.cultures.includes(hints.culture)) o.culture = hints.culture;
  if (hints.language && TOPONYM_PROFILES.some(p => p.id === hints.language)) o.language = hints.language;
  if (hints.sprawl !== undefined && Number.isFinite(hints.sprawl)) o.sprawl = clamp(hints.sprawl, 0.5, 2);
  if (hints.walls !== undefined) o.walls = hints.walls ? 'single' : 'none';
  if (hints.walls !== false && hints.palisade) o.wallStyle = 'palisade';
  if (hints.citadel || hints.urbanCastle) o.castle = 'yes';
  else if (hints.citadel === false) o.castle = 'no';
  // Only positive landmark flags force a building; a missing one in the source stays automatic.
  if (hints.temple) o.cathedral = 'yes';
  if (hints.capital) o.palace = 'yes';
  if (hints.port) o.port = 'yes';
  if (hints.shantytown !== undefined) o.shantytowns = hints.shantytown ? 'some' : 'none';
  // Magna Urbis reads 0 road exits as automatic, so an isolated source town keeps the automatic exits.
  if (hints.roads !== undefined && Number.isFinite(hints.roads)) o.roads = Math.round(clamp(hints.roads, 0, 20));
  if (hints.relief && defaults.reliefs.includes(hints.relief)) {
    if (hints.relief !== o.relief) {
      settings.terrain ??= {};
      settings.terrain.relief = hints.relief as NonNullable<V2Settings['terrain']>['relief'];
    } else if (settings.terrain) delete settings.terrain.relief;
  }
  const name = hints.name?.trim().slice(0, 200);
  if (name) {
    settings.naming ??= {};
    settings.naming.places = { ...settings.naming.places, main: name };
  }
  // Only the imported town for now: a one-place list fixes its population (the automatic plan would
  // derive the places from the map area), with no farmsteads or isolated buildings around it.
  const population = o.population > 0 ? o.population : 2500;
  const extent = settings.extent = importExtent(population);
  const coastTrace = hints.shore && fmgCoastTrace(hints.shore);
  if (coastTrace) settings.terrain = { ...settings.terrain, coastTrace, coastMask: 0, coastProfile: { ...settings.terrain?.coastProfile, variability: 0 } };
  settings.region = {
    ...settings.region,
    placement: { ...settings.region?.placement, mode: 'list', farmDensity: 0, remotePlaces: 0, list: [{
      key: 'main', name: name ?? '', population, culture: o.culture, siteType: coastTrace && hints.port ? 'harbor' : 'auto', sitePrefs: {},
      ...(coastTrace ? { position: { x: extent / 2, y: extent / 2 } } : {}),
    }] },
    // An imported culture is the source's choice: the environment must not re-pick it.
    demography: { ...settings.region?.demography, isolatedCount: 0, ...(hints.culture && o.culture === hints.culture ? { followCulture: false } : {}) },
  };
  if (hints.network) applyFmgNetwork(settings, hints.network, extent);
  // The receiver's engine choice is not part of the source: start on Automatic.
  if (settings.runtime) settings.runtime.autoBackend = true;
  validateSettings(settings);
  return settings;
}
