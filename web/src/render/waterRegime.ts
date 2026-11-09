/** Seasonal regime of inland water, shared by every style (display only; the river network is untouched).
 *
 * Dry climates: only the largest flows stay perennial; smaller courses become intermittent, then ephemeral beds
 * (wadis) that dry out in the dry season, and lakes draw down to a pale exposed shore. Cold climates: rivers and lakes
 * freeze in winter and thaw in spring. Wet climates and seasons: rivers carry a sediment plume into the sea.
 * The zone calendar (terrainRenderV2Zones.ts) drives everything: its rain regime places the dry season, its low-ground
 * snow places the freeze. Ink styles draw the regime as symbols (vectorWaterRender.ts); the material styles get it
 * encoded in the river segment colour (`regimeRgb`) and read it in their water shaders (WATER_REGIME_GLSL). */
import { CLIMATE_ZONES, type ClimateZone } from '../../../rust/bridge/terrainClimate';
import { ZONE_SEASONS, calendarSeason, seasonWeights, type SeasonCalendar } from '../../../rust/bridge/terrainRenderV2Zones';

export interface WaterSeason { zone?: ClimateZone; season?: number; calendar?: SeasonCalendar }

/** Share of the courses that lose their flow in an average year: 1 desert (only exotic trunks keep water). */
const ARIDITY: Partial<Record<ClimateZone, number>> = { desert: 1, savanna: .72, steppe: .5, mediterranean: .3 };
/** Sediment load reaching the sea in the wet season: warm weathered basins carry the most. */
const SEDIMENT: Partial<Record<ClimateZone, number>> = { tropical: 1, savanna: 1, wetland: .7, temperate: .45, continental: .45, mediterranean: .35, steppe: .3, nordic: .2, alpine: .25, arctic: .1, desert: .1 };

export interface WaterClimate {
  aridity: number;
  /** Rain of the moment relative to the yearly mean: 0 deep dry season, 1 mean, 2 peak of the rains. */
  rain: number;
  /** Freshwater ice cover of small still water, 0–1. */
  ice: number;
  /** Sediment plume at river mouths, 0–1. */
  sediment: number;
  /** Lake draw-down of the season, 0–1 (1: about 80 m of exposed shore). */
  drop: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, v: number): number => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
/** Freeze of still fresh water from the zone's low-ground snow (a lake ices over before its banks stay white). */
const freezeOf = (snow: number): number => smooth(.15, .7, snow);
/** Lake draw-down: the dry season of a dry climate exposes the shore. Shared with WATER_FRESH_ICE_GLSL. */
const dropOf = (aridity: number, rain: number): number => aridity * clamp01(1 - .8 * rain);

export function waterClimate(s: WaterSeason): WaterClimate {
  if (!s.zone) return { aridity: 0, rain: 1, ice: 0, sediment: 0, drop: 0 };
  const year = calendarSeason(s.zone, s.calendar), w = seasonWeights(s.season ?? .5);
  const snow = year.snow.reduce((sum, v, i) => sum + v * w[i], 0);
  const aridity = ARIDITY[s.zone] ?? 0, rain = Math.max(0, 1 + year.rain * (w[2] - w[0])), ice = freezeOf(snow);
  return { aridity, rain, ice, sediment: (SEDIMENT[s.zone] ?? 0) * clamp01(rain - .9 * aridity) * (1 - ice), drop: dropOf(aridity, rain) };
}
/** True when the regime changes anything on the map. */
export const waterRegimeActive = (c: WaterClimate): boolean => c.aridity > 0 || c.ice > 0 || c.sediment > .05;

/** State of a river vertex of relative size `q` (0 smallest drawn stream, 1 the map's trunk) and channel slope. */
export interface RiverState { dry: number; ice: number; foam: number }
export function riverState(c: WaterClimate, q: number, slope: number): RiverState {
  let dry = 0;
  if (c.aridity > 0) {
    // The perennial threshold rises with aridity; the season shifts it (wet season: more courses run).
    const t = .85 * c.aridity, shifted = q + .35 * (c.rain - 1) * Math.min(1, c.aridity * 1.6);
    dry = 1 - smooth(t - .18, t + .12, shifted);
    // A desert never runs fully: even the courses that carry water show their bars.
    dry = Math.max(dry, .12 * c.aridity * (1 - q));
  }
  // Trunks freeze last: they keep a little open water in a partial freeze.
  const ice = c.ice >= .999 ? 1 : clamp01(c.ice * (1.15 - .35 * q));
  // Whitewater on steep reaches of running water; channel slope in m/m.
  const foam = (1 - dry) * (1 - ice) * smooth(.012, .05, slope);
  return { dry, ice, foam };
}

/** Segment colour of the material styles: r running water (1 − dry), g open water (1 − ice), b whitewater below .5 and
 * a sediment plume above (.5 + plume / 2, plume capsules only). Capsules blend with MAX, so where a dry or frozen
 * tributary overlaps a running trunk the running water wins. */
export const regimeRgb = (s: RiverState): [number, number, number] => [1 - s.dry, 1 - s.ice, .5 * s.foam];
export const plumeRgb = (plume: number): [number, number, number] => [1, 1, .5 + .5 * clamp01(plume)];

/** Symbol class of the ink styles. */
export type RiverSymbol = 'water' | 'intermittent' | 'dry' | 'ice';
export function riverSymbol(s: RiverState): RiverSymbol {
  if (s.ice >= .55) return 'ice';
  if (s.dry >= .85) return 'dry';
  if (s.dry >= .4) return 'intermittent';
  return 'water';
}

const glslFloat = (v: number): string => (Math.round(v * 1000) / 1000).toFixed(3);
/** Freshwater ice per zone and season (winter, spring, summer, autumn) for the material shaders. */
const FRESH_ICE_ROWS = CLIMATE_ZONES.map(zone => ZONE_SEASONS[zone].snow.map(freezeOf));
const zoneFloats = (values: Partial<Record<ClimateZone, number>>): string => `float[${CLIMATE_ZONES.length}](${CLIMATE_ZONES.map(z => glslFloat(values[z] ?? 0)).join(',')})`;
/** Humic (tea-coloured) lake and bog water of the boreal zones; milky glacial flour of the alpine lakes. */
const TEA: Partial<Record<ClimateZone, number>> = { nordic: .65, wetland: .55, continental: .3, arctic: .25 };
const GLACIAL: Partial<Record<ClimateZone, number>> = { alpine: 1, arctic: .2 };

/** Inland water climate of the zone and season in the Render v2 map shader (after the zone tables: uMaterialZone, uV2Season). */
export const WATER_FRESH_ICE_GLSL = `
const vec4 V2_FRESH_ICE[${FRESH_ICE_ROWS.length}]=vec4[${FRESH_ICE_ROWS.length}](${FRESH_ICE_ROWS.map(r => `vec4(${r.map(glslFloat).join(',')})`).join(',')});
const float V2_WATER_ARIDITY[${CLIMATE_ZONES.length}]=${zoneFloats(ARIDITY)};
const float V2_WATER_TEA[${CLIMATE_ZONES.length}]=${zoneFloats(TEA)};
const float V2_WATER_GLACIAL[${CLIMATE_ZONES.length}]=${zoneFloats(GLACIAL)};
const float V2_WATER_SEDIMENT[${CLIMATE_ZONES.length}]=${zoneFloats(SEDIMENT)};
int waterZone(){return clamp(uMaterialZone-1,0,${CLIMATE_ZONES.length - 1});}
float waterFreshIce(){return uMaterialZone>0?dot(V2_FRESH_ICE[waterZone()],v2SeasonWeights()):0.;}
// Lake draw-down of the dry season (dropOf in waterRegime.ts), 0-1.
float waterLakeDrop(){
  if(uMaterialZone<=0)return 0.;
  vec4 w=v2SeasonWeights();float rain=max(0.,1.+v2SeasonClimate().x*(w.z-w.x));
  return V2_WATER_ARIDITY[waterZone()]*clamp(1.-.8*rain,0.,1.);
}
float waterTea(){return uMaterialZone>0?V2_WATER_TEA[waterZone()]:0.;}
float waterGlacial(){return uMaterialZone>0?V2_WATER_GLACIAL[waterZone()]:0.;}
float waterSediment(){
  if(uMaterialZone<=0)return 0.;
  vec4 w=v2SeasonWeights();float rain=max(0.,1.+v2SeasonClimate().x*(w.z-w.x));
  return V2_WATER_SEDIMENT[waterZone()]*clamp(rain-.9*V2_WATER_ARIDITY[waterZone()],0.,1.)*(1.-waterFreshIce());
}
`;
/** Painting of the regime (dry bed, pools, ice, exposed shore) shared by the material water compositors. */
export const WATER_REGIME_GLSL = `
float waterRegimeHash(vec2 p){p=fract(p*vec2(127.1,311.7));p+=dot(p,p+19.19);return fract(p.x*p.y);}
float waterRegimeNoise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);return mix(mix(waterRegimeHash(i),waterRegimeHash(i+vec2(1.,0.)),u.x),mix(waterRegimeHash(i+vec2(0.,1.)),waterRegimeHash(i+vec2(1.,1.)),u.x),u.y);}
// Frozen fresh water, following the water's own outline: a continuous pale blue-grey sheet, a darker grey-blue bank
// line so the course reads as a river first, faint streaks along the flow (along: unit flow direction, or zero) and,
// on lakes, a few thin cracks. edge: 1 at the bank, 0 a few pixels inside.
vec3 waterIceColor(vec2 world,float edge,float cracks,vec2 along){
  float n=waterRegimeNoise(world/140.)*.6+waterRegimeNoise(world/37.)*.4;
  float crack=cracks*(1.-smoothstep(.0,.02,abs(waterRegimeNoise(world/260.+3.1)-.5)));
  vec2 flow=vec2(dot(world,along),dot(world,vec2(-along.y,along.x)));
  float streak=dot(along,along)>.5?waterRegimeNoise(vec2(flow.x/160.,flow.y/7.)):.5;
  // Darker and bluer than snow, so a frozen course still reads in a white winter landscape.
  vec3 ice=mix(vec3(.58,.68,.76),vec3(.72,.80,.86),n*.6+streak*.4)*(1.-.12*crack);
  return mix(ice,vec3(.33,.43,.52),edge*.9);
}
// A dry course is one flat silt band with a slightly darker bank, without surface texture.
vec3 waterDryBed(vec2 world,float centre){
  return mix(vec3(.69,.57,.40),vec3(.80,.70,.53),smoothstep(0.,.35,centre));
}
// Draw-down changes the amount of open water uniformly, never into mottled pools.
float waterDryPools(vec2 world,float dry,float centre){
  return 1.-smoothstep(.15,.55,dry);
}
// Exposed lake shore of the dry season: pale cracked mud and salt-whitened silt.
vec3 waterExposedShore(vec2 world){
  float n=waterRegimeNoise(world/48.)*.6+waterRegimeNoise(world/11.)*.4;
  return mix(vec3(.66,.60,.50),vec3(.84,.80,.71),n);
}
`;
