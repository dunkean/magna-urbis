import type { V2Settings } from './contracts';
import type { World } from '../gen/types';
import { nativeCityRecords } from './nativeProducts';
import { runtimeValues } from './runtimeChoices';

export interface ExecutionRow { process: string; configured: string; actual?: string }
const engineName = (engine: string) => engine === 'native' ? 'Rust · native service' : engine === 'typescript' ? 'TypeScript · classic' : 'Rust · in the browser';
/** Evidence comes from retained products, never from currently available hardware or the next recipe. */
export function executionOverview(settings: V2Settings, world?: World, renderPath?: string): ExecutionRow[] {
  const v = runtimeValues(settings), stats = world?.stats;
  const cities = Object.values(nativeCityRecords(world) ?? {});
  const cityPaths = [...new Set(cities.map(city => city.backend))];
  const urban = cityPaths.length ? cityPaths.join(' / ') : world?.urban || world?.settlements?.some(place => place.urban) ? 'typescript-cpu' : undefined;
  const actual = (key: string): string | undefined => stats?.[key] === undefined ? undefined : String(stats[key]);
  return [
    { process: 'Terrain generation', configured: `${engineName(v.engine)} · ${v.generationCompute || v.compute}`, actual: actual('generationBackend') ?? actual('backend') },
    { process: 'Water & rivers', configured: settings.terrain?.hydrology?.enabled === false && v.engine !== 'typescript' ? 'Disabled' : `${v.engine === 'typescript' ? engineName(v.engine) : settings.terrain?.hydrology?.engine === 'vector' ? 'Vector water' : engineName(v.engine)} · ${v.engine === 'typescript' ? 'CPU' : v.hydrology}`, actual: actual('hydrologyBackend') ?? (actual('backend') === 'typescript-cpu' ? 'typescript-cpu' : undefined) },
    { process: 'City construction', configured: `${engineName(v.urban || v.engine)} · CPU`, actual: urban },
    { process: 'Map rendering', configured: 'Independent of generation', actual: renderPath },
  ];
}
