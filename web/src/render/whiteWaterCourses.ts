/** The river courses of a vector water network as the satellite ground draws them, for the white water marks
 * (whiteWater.ts): drawn points, widths and water levels of every main river line, one source object per network. */
import { riverGeometry } from '../ui/vectorWaterRender';
import { channelWidth } from '../ui/riverVectors';
import type { VectorWater } from '../ui/vectorWater';
import { riverState, waterClimate, type WaterSeason } from './waterRegime';
import type { WhiteWaterCourse, WhiteWaterSource } from './whiteWater';

/** Courses of the main rivers. A course that joins no other stream ends in the sea or a lake, unless it leaves the map.
 * With a season, the seasonal regime's dryness per vertex (same size measure as the drawn regime) dries the foam. */
export function vectorWhiteWaterCourses(water: VectorWater, riverAreaKm2: number, season?: WaterSeason): WhiteWaterCourse[] {
  const network = water.rivers;
  if (!network) return [];
  const h = water.hydro, edge = 2 * h.width / h.n;
  const climate = season?.zone ? waterClimate({ ...season, landIce: true }) : undefined;
  const scale = water.widthScale ?? network.widthScale ?? 1, threshold = riverAreaKm2 * 1e6;
  let top = threshold;
  for (const l of network.rivers) top = Math.max(top, l.area[l.area.length - 1] ?? 0);
  const w0 = channelWidth(threshold, scale), span = Math.log(Math.max(w0 * 1.5, channelWidth(top, scale)) / w0);
  return network.rivers.map((line, i) => {
    const geo = riverGeometry(water, line, 0, riverAreaKm2), m = geo.widths.length - 1;
    const x = geo.points[2 * m], y = geo.points[2 * m + 1];
    const leaves = x < edge || y < edge || x > h.width - edge || y > h.width - edge;
    const wet = climate && climate.aridity > 0
      ? geo.widths.map(w => 1 - riverState(climate, Math.max(0, Math.min(1, Math.log(Math.max(w, w0 * .3) / w0) / span))).dry) : undefined;
    return { id: line.id ?? i, points: geo.points, level: geo.level, width: geo.widths, wet, mouth: !(line.joins !== undefined && line.joins >= 0) && !leaves };
  });
}

const sources = new WeakMap<VectorWater, Map<string, WhiteWaterSource>>();
/** One stable source per network, river threshold and season: setting it again keeps the built marks. */
export function vectorWhiteWater(water: VectorWater, riverAreaKm2: number, season?: WaterSeason): WhiteWaterSource {
  let bySetting = sources.get(water);
  if (!bySetting) sources.set(water, bySetting = new Map());
  const key = JSON.stringify([riverAreaKm2, season ?? null]);
  let found = bySetting.get(key);
  if (!found) bySetting.set(key, found = { courses: () => vectorWhiteWaterCourses(water, riverAreaKm2, season) });
  return found;
}
