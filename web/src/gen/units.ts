/** Display units only. Generation recipes and geometry always use SI units. */
export type DistanceUnit = 'm' | 'ft' | 'yd';
export type PhysicalUnit = DistanceUnit | 'km' | 'mi' | 'm²' | 'km²' | 'ft²' | 'yd²' | 'mi²';
export const METRES_PER_UNIT = { m: 1, km: 1000, ft: .3048, yd: .9144, mi: 1609.344 } as const;
export const validDistanceUnit = (value: unknown): value is DistanceUnit => value === 'm' || value === 'ft' || value === 'yd';
export function unitFactor(unit: PhysicalUnit): number {
  return unit.endsWith('²') ? METRES_PER_UNIT[unit.slice(0, -1) as keyof typeof METRES_PER_UNIT] ** 2 : METRES_PER_UNIT[unit as keyof typeof METRES_PER_UNIT];
}
export function displayUnit(source: PhysicalUnit, preference: DistanceUnit): PhysicalUnit {
  if (preference === 'm') return source;
  return source === 'km' ? 'mi' : source === 'km²' ? 'mi²' : source === 'm²' ? `${preference}²` : source === 'm' ? preference : source;
}
export function convertUnits(value: number, from: PhysicalUnit, to: PhysicalUnit): number { return value * unitFactor(from) / unitFactor(to); }
export const unitInputNumber = (value: number): number => Number(value.toFixed(6));
export function distanceValue(metres: number, preference: DistanceUnit = 'm', large = false): { value: number; unit: PhysicalUnit } {
  const unit = preference === 'm' ? large || Math.abs(metres) >= 1000 ? 'km' : 'm' : large || Math.abs(metres) >= 1609.344 ? 'mi' : preference;
  return { value: metres / unitFactor(unit), unit };
}
export function formatDistance(metres: number, preference: DistanceUnit = 'm', locale = 'en-GB', large = false): string {
  const { value, unit } = distanceValue(metres, preference, large);
  return `${value.toLocaleString(locale, { maximumFractionDigits: 2 })} ${unit}`;
}
/** A scale is rounded in its displayed unit; the physical length drives the drawing. */
export function distanceScale(pxPerM: number, targetPx: number, preference: DistanceUnit = 'm'): { metres: number; value: number; unit: PhysicalUnit } {
  const available = targetPx * 1.25 / pxPerM;
  const { unit } = distanceValue(available, preference);
  const maximum = available / unitFactor(unit), power = 10 ** Math.floor(Math.log10(maximum));
  const value = ([1, 2, 2.5, 5, 10].filter(n => n * power <= maximum).at(-1) ?? 1) * power;
  return { metres: value * unitFactor(unit), value, unit };
}
