import type { V2Settings } from './contracts';
import { cultureEra } from '../gen/options';

/** UI suggestions only: explicit recipes and the generation engines keep their own contract. */
export function settlementEnvironment(settings: V2Settings): string {
  return [settings.extent, settings.terrain?.relief ?? settings.options.relief,
    settings.terrain?.climateZone ?? settings.terrain?.climate ?? settings.options.biome].join('|');
}
export function recommendedCounts(settings: V2Settings, density = 1): Record<string, number> {
  const relief = settings.terrain?.relief ?? settings.options.relief;
  const climate = String(settings.terrain?.climateZone ?? settings.terrain?.climate ?? settings.options.biome ?? 'temperate');
  const area = (typeof settings.extent === 'number' ? settings.extent : 10000) ** 2 / 1e6;
  const terrain = /high-mountains|volcano|canyon/.test(relief) ? .16 : /mountains/.test(relief) ? .35 : /hills|plateau/.test(relief) ? .7 : 1;
  const habitat = /desert|arctic|tundra/.test(climate) ? .2 : /steppe|subarctic/.test(climate) ? .5 : /tropical/.test(climate) ? .75 : 1;
  const budget = area * terrain * habitat * Math.max(0, density);
  return Object.fromEntries(Object.entries({ city: .002, town: .012, village: .06, hamlet: .1, farmstead: .14 })
    .map(([key, rate]) => [key, Math.min(1000, Math.round(budget * rate))]));
}
export function recommendedCulture(settings: V2Settings): string | undefined {
  const current = settings.options.culture;
  // Automatic medieval suggestions never replace modern, ancient or fantasy scenarios.
  if (cultureEra(current) || /roman|egyptian|nubian|mesopotamian|indus|elven|dwarven|goblin|giant|merfolk|lizard|underdark/.test(current)) return;
  const relief = settings.terrain?.relief ?? settings.options.relief;
  const climate = String(settings.terrain?.climateZone ?? settings.terrain?.climate ?? settings.options.biome ?? 'temperate');
  if (/desert/.test(climate)) return /mountain|plateau/.test(relief) ? 'persian' : 'medina';
  if (/arctic|tundra/.test(climate)) return 'norse-ringfort';
  if (/mountain/.test(relief)) return 'caucasian-highland';
  if (/tropical/.test(climate)) return 'javanese-courts';
  if (/steppe/.test(climate)) return 'mongol-ordu';
  return 'european-organic';
}
