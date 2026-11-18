/**
 * Names of the district roles and building families of a town, in the UI language. Called by the model (landmark
 * names), the legends and the inspectors; the colours are the look's (render/city/planLook.ts).
 */
import { roleLabel, uiRoleLocale, type RoleLocale } from '../../cityRoles';
import { DISTRICT_NAMES_EN, buildingFamilyName, districtName, districtRoleFromLabel, roleText, specialityName } from '../../cityRolesLocale';
// enclosures hook (cityLotEnclosures.ts)
// walls hook (cityWalls.ts)
import { DISTRICT_COLORS, FAMILY_COLORS } from '../look';

/** `label` is the name in the UI language (`<html lang>`, English by default), read on access; `labelEn` is the English source. */
export const DISTRICT_ROLES: Record<string, { label: string; labelEn: string; color: string }> = Object.fromEntries(
  Object.entries(DISTRICT_COLORS).map(([id, color]) => [
    id,
    {
      get label(): string {
        return districtName(id, uiRoleLocale()) ?? id;
      },
      labelEn: DISTRICT_NAMES_EN[id],
      color,
    },
  ]),
);
/** `label` is the name in the UI language, read on access. */
export const BUILDING_FAMILIES: Record<string, { label: string; color: string }> = Object.fromEntries(
  Object.entries(FAMILY_COLORS).map(([id, color]) => [
    id,
    {
      get label(): string {
        return buildingFamilyName(id, uiRoleLocale());
      },
      color,
    },
  ]),
);
/** Preserve district toponyms in their culture's language. Only the service
 * catalogue's generic French role labels are translated into the UI language. */
export function districtRoleLabel(role: string, label?: string, locale: RoleLocale = uiRoleLocale()): string {
  if (label && (locale === 'fr' || !districtRoleFromLabel(label))) return label;
  const key = role || districtRoleFromLabel(label) || '';
  if (!key) return roleText('District', locale);
  const [head, tail] = key.split(/[.:/]/),
    id = head?.toLowerCase(),
    base = districtName(id, locale) ?? head;
  return tail ? `${base} · ${specialityName(tail, locale)}` : base;
}
/** Name of a landmark role in the UI language (the engine's `label` only without a role); never a raw id tail such as « friday ». */
export const landmarkName = (role?: string, fallback = 'Monument', label?: string, locale: RoleLocale = uiRoleLocale()): string => (role ? roleLabel(role, locale) : (locale === 'fr' ? label : undefined) || roleText(fallback, locale));
