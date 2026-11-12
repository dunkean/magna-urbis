import type { World } from '../gen/types';
import type { V2Settings } from './contracts';
import { getLanguage } from './i18n';
import { getDistanceUnit } from './units';
import { presentMapNames } from './mapNaming';
import { presentName } from '../gen/names/displayNames';
import type { NamePresentation } from '../gen/names/types';

export function namePresentation(settings?:V2Settings):NamePresentation {
  const language=settings?.naming?.mapLanguage;
  return {mode:settings?.naming?.mode??'localized',language:language&&language!=='ui'?language:getLanguage(),script:settings?.naming?.script};
}
/** Inspectors use exactly the same names as the map, without treating them as UI translation keys. */
export function settlementDisplayName(world:World,key:string,settings?:V2Settings):string|undefined {
  const entry=world.names?.entries.find(e=>e.id===`settlement:${key}`);
  return entry?.parts ? presentName(entry.parts,namePresentation(settings)) : entry?.text ?? world.settlements?.find(s=>s.key===key)?.name;
}

/** Display preferences are independent from saved generation inputs and cultural names. */
export function mapPresentation(world: World, settings?: V2Settings): World {
  const language=settings?.naming?.mapLanguage;
  const displayed = presentMapNames(world, language && language!=='ui' ? language : getLanguage(), settings?.naming?.mode ?? 'localized',settings?.naming?.script);
  return { ...displayed, options: { ...displayed.options, distanceUnit: getDistanceUnit() } };
}
