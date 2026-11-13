import type { V2Settings } from './contracts';
import { presetComposition } from '../render/composition';

/** Local apparent solar time: noon puts the sun on the meridian, independent of the device timezone. */
export interface SceneClock { date: string; time: string; latitude: number }
export const DEFAULT_SCENE: SceneClock = { date: '2026-07-01', time: '14:00', latitude: 45 };
const DAY = 86400000, RAD = Math.PI / 180;
export function validateSceneClock(value: unknown): asserts value is SceneClock {
  const s = value as SceneClock;
  if (!s || typeof s !== 'object' || typeof s.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.date)
    || s.date < '0001-01-01' || s.date > '9998-12-31' || !Number.isFinite(Date.parse(s.date)) || new Date(s.date).toISOString().slice(0, 10) !== s.date
    || typeof s.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time)
    || typeof s.latitude !== 'number' || !Number.isFinite(s.latitude) || Math.abs(s.latitude) > 90)
    throw new Error('Invalid scene date, solar time or latitude.');
}

/** NOAA fractional-year declination and spherical solar coordinates.
 * https://gml.noaa.gov/grad/solcalc/solareqns.PDF
 * Time is already solar time; no longitude, timezone or daylight-saving offset is applied. */
export function sceneSun(scene: SceneClock): { season: number; azimuth: number; altitude: number; ambience: 'day' | 'night' } {
  validateSceneClock(scene);
  const date = new Date(scene.date), year = date.getUTCFullYear();
  const start = Date.parse(`${String(year).padStart(4, '0')}-01-01`), days = (Date.parse(`${String(year + 1).padStart(4, '0')}-01-01`) - start) / DAY;
  const day = (date.getTime() - start) / DAY, [h, m] = scene.time.split(':').map(Number), hour = h + m / 60;
  const g = 2 * Math.PI / days * (day + (hour - 12) / 24);
  const decl = .006918 - .399912 * Math.cos(g) + .070257 * Math.sin(g) - .006758 * Math.cos(2*g)
    + .000907 * Math.sin(2*g) - .002697 * Math.cos(3*g) + .00148 * Math.sin(3*g);
  const lat = scene.latitude * RAD, angle = (hour - 12) * 15 * RAD;
  const altitude = Math.asin(Math.max(-1, Math.min(1, Math.sin(lat)*Math.sin(decl) + Math.cos(lat)*Math.cos(decl)*Math.cos(angle)))) / RAD;
  const azimuth = (Math.atan2(Math.sin(angle), Math.cos(angle)*Math.sin(lat) - Math.tan(decl)*Math.cos(lat)) / RAD + 180 + 360) % 360;
  return { season: (day / days + (scene.latitude < 0 ? .5 : 0)) % 1, azimuth, altitude, ambience: altitude > 0 ? 'day' : 'night' };
}

/** Only the display recipe changes. Night disables direct solar shading; existing render ranges start at 5°. */
export function applySceneClock(settings: V2Settings, scene: SceneClock): void {
  const sun = sceneSun(scene);
  settings.scene = { ...scene };
  settings.appearance ??= { style: settings.options.style };
  const composition = settings.appearance.composition ??= presetComposition(settings.options.style === 'atlas' ? 'atlas' : 'parchment');
  Object.assign(composition.effects, { season: sun.season, ambience: sun.ambience });
  Object.assign(composition.effects.lighting, { azimuth: sun.azimuth, elevation: Math.max(5, sun.altitude), enabled: sun.altitude > 0 });
}
