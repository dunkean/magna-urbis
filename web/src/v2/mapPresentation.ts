import type { World } from '../gen/types';
import type { V2Settings } from './contracts';
import { getLanguage } from './i18n';
import { getDistanceUnit } from './units';
import { presentMapNames } from './mapNaming';

/** Display preferences are independent from saved generation inputs and cultural names. */
export function mapPresentation(world: World, settings?: V2Settings): World {
  const displayed = presentMapNames(world, getLanguage(), settings?.naming?.mode ?? 'localized');
  return { ...displayed, options: { ...displayed.options, distanceUnit: getDistanceUnit() } };
}
