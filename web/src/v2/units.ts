import { validDistanceUnit, type DistanceUnit } from '../gen/units';
export { convertUnits, displayUnit, distanceValue, formatDistance, unitFactor, unitInputNumber } from '../gen/units';
export type { DistanceUnit, PhysicalUnit } from '../gen/units';
export const UNITS_STORAGE_KEY = 'magna-urbis-v2-units';
let preference: DistanceUnit = 'm';
try { const stored = globalThis.localStorage?.getItem(UNITS_STORAGE_KEY); if (validDistanceUnit(stored)) preference = stored; } catch { /* Optional storage. */ }
const listeners = new Set<() => void>();
export const getDistanceUnit = (): DistanceUnit => preference;
export function setDistanceUnit(next: DistanceUnit): void {
  if (!validDistanceUnit(next)) return;
  preference = next;
  try { globalThis.localStorage?.setItem(UNITS_STORAGE_KEY, next); } catch { /* Optional storage. */ }
  listeners.forEach(listener => listener());
}
export function onUnitsChange(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
