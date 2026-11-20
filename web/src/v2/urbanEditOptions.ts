import servicesJson from '../../../rust/crates/core/src/urban/services.json';
import admissionJson from '../../../rust/crates/houses/data/urban-admission.json';
import { urbanRoleChoices } from './urbanRoleNames';
import { translate } from './i18n';
import type { ParameterChoice } from '../ui/parameterForm';
import { polygonArea as signedRingArea, type Vec2 } from '../gen/core/geom';

type Service = { role: string; function: string; area: number[]; requires?: string };
const services = servicesJson as unknown as { cultures: Record<string, string>; families: Record<string, Service[]>; cultureServices: Record<string, Service[]>; rural: Service[]; harbour: Service[] };
type Source = {
  modes: string[];
  urban_roles?: string[];
  urban_role?: string;
  culture_id?: string;
  pack_id: string;
  eras?: string[];
  nominal_width_m?: number[];
  nominal_depth_m?: number[];
  sources?: { nominal_width_m: number[]; nominal_depth_m: number[]; temporal?: { eras?: string[] }; inspired_only?: boolean }[];
};
const sources = [...admissionJson.functional_programmes.programmes, ...admissionJson.functional_choices.rules] as unknown as Source[];
/** Storeys a forced use may stack on its lot: the catalogue areas are useful floor areas, not land. */
const USEFUL_FLOORS = 3;
export interface UrbanEditContext {
  culture: string;
  area?: number;
  architecture?: string;
  pack?: string;
  mode?: string;
  period?: string;
  navigableAccess?: boolean;
  /** The lot's current use (the engine already placed it there): always offered, never shown disabled. */
  current?: string;
  /** Used when `culture` is not a declared culture (e.g. the 'site' sentinel). */
  fallbackCulture?: string;
}
export const CULTURE_GROUP = 'This culture',
  OTHER_GROUP = 'Other cultures',
  LARGE_NOTE = 'large for this lot';
/** Smallest useful floor area each role declares anywhere (cultures, rural, harbour). */
const minimumArea = new Map<string, number>();
for (const entry of [...Object.values(services.families).flat(), ...Object.values(services.cultureServices).flat(), ...services.rural, ...services.harbour]) {
  const area = entry.area[0];
  if (Number.isFinite(area)) minimumArea.set(entry.role, Math.min(minimumArea.get(entry.role) ?? Infinity, area));
}
/** Every building type, chosen freely: housing and a garden first, then the types declared for the lot's
 * culture, then those of other cultures; each group lists the types that fit first. A type larger than the
 * lot stays selectable and carries a note; the native programme accepts any role as a forced lot use and
 * reports a lot it cannot build (see `forcedUseRefusal`). */
export function compatibleBuildingTypes(context: UrbanEditContext): ParameterChoice[] {
  const all = urbanRoleChoices();
  const culture = services.cultures[context.culture] || services.cultureServices[context.culture] ? context.culture : (context.fallbackCulture ?? context.culture);
  const own = [...(services.families[services.cultures[culture]] ?? []), ...(services.cultureServices[culture] ?? []), ...services.rural, ...(context.navigableAccess ? services.harbour : [])].filter(entry => entry.requires !== 'navigable' || context.navigableAccess);
  const declared = new Set(own.map(entry => entry.role));
  // The culture's own declaration sizes its types; other types use their smallest declaration.
  const ownArea = new Map<string, number>();
  for (const entry of own) if (Number.isFinite(entry.area[0])) ownArea.set(entry.role, Math.min(ownArea.get(entry.role) ?? Infinity, entry.area[0]));
  const mode = context.mode === 'strict' ? 'historical_strict' : context.mode === 'fantasy' ? 'fantasy_mix' : context.mode === 'inspired' || !context.mode ? 'historical_inspired' : context.mode;
  const period = context.period,
    area = Number.isFinite(context.area) ? context.area! : undefined;
  const large = (role: string): boolean => {
    if (area === undefined) return false;
    // A service's area is its useful floor area: a lot carries it on up to USEFUL_FLOORS storeys.
    if (area * USEFUL_FLOORS < (ownArea.get(role) ?? minimumArea.get(role) ?? 0)) return true;
    if (context.architecture !== 'compact' && context.architecture !== 'detailed') return false;
    const candidates = sources.filter(
      source =>
        (source.urban_role === role || source.urban_roles?.includes(role)) &&
        (source.culture_id ? source.culture_id === culture : source.pack_id === context.pack) &&
        source.modes.includes(mode) &&
        (!period || period === 'any' || !source.eras?.length || source.eras.includes(period)),
    );
    return (
      candidates.length > 0 &&
      !candidates.some(source =>
        (source.sources ?? [source]).some(candidate => {
          const width = candidate.nominal_width_m?.[0],
            depth = candidate.nominal_depth_m?.[0];
          return width !== undefined && depth !== undefined && width > 0 && depth > 0 && width * depth <= area;
        }),
      )
    );
  };
  const first = ['dwelling', 'open.garden'];
  const rest = all.filter(choice => !first.includes(choice.value)).map(choice => ({ ...choice, large: large(choice.value), own: declared.has(choice.value) }));
  const group = (own: boolean, name: string): ParameterChoice[] =>
    rest
      .filter(choice => choice.own === own)
      .sort((a, b) => Number(a.large) - Number(b.large))
      .map(({ value, label, large }) => ({ value, label, group: name, ...(large ? { note: LARGE_NOTE } : {}) }));
  return [...all.filter(choice => first.includes(choice.value)), ...group(true, CULTURE_GROUP), ...group(false, OTHER_GROUP)];
}
/** The native outcome of a forced use: a lot left open for its size, slope or a missing model, worded for the person. */
export function forcedUseRefusal(cause: string | undefined, role: string): string | undefined {
  if (!cause) return undefined;
  const label = translate(urbanRoleChoices().find(choice => choice.value === role)?.label ?? role);
  const template =
    cause === 'pente'
      ? 'This lot is too steep for {type}. Choose a flatter lot or another type.'
      : cause === 'source_absente'
        ? 'No building model exists for {type} with this architecture. Choose another type or the City volumes architecture.'
        : 'This lot is too small for {type}. Enlarge it by merging it with a neighbour.';
  return translate(template).replace('{type}', label);
}

export function polygonArea(shape: { outer: readonly Vec2[]; holes?: readonly (readonly Vec2[])[] }): number {
  return Math.max(0, Math.abs(signedRingArea(shape.outer)) - (shape.holes ?? []).reduce((sum, hole) => sum + Math.abs(signedRingArea(hole)), 0));
}
