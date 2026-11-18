/** Seasonal regime of inland water, shared by every style (display only; the river network is untouched).
 *
 * Dry climates: only the largest flows stay perennial; smaller courses become intermittent, then ephemeral beds
 * (wadis) that dry out in the dry season, and lakes draw down to a pale exposed shore. Cold climates: rivers and lakes
 * freeze in winter and thaw in spring. Wet climates and seasons: rivers carry a sediment plume into the sea.
 * The zone calendar (terrainRenderV2Zones.ts) drives everything: its rain regime places the dry season, its low-ground
 * snow places the freeze. Ink styles draw the regime as symbols (vectorWaterRender.ts); the material styles get it
 * encoded in the river segment colour (`regimeRgb`) and read it in their water shaders (WATER_REGIME_GLSL).
 * The satellite material is the exception for ice: it freezes its water in the shader, from the snow of the land at
 * the water's altitude (terrainRenderV2Winter.ts), so its regime carries no ice (`WaterSeason.landIce`). */
import { CLIMATE_ZONES, type ClimateZone } from '../../../rust/bridge/terrainClimate';
import { calendarSeason, seasonWeights, type SeasonCalendar } from '../../../rust/bridge/terrainRenderV2Zones';

export interface WaterSeason {
  zone?: ClimateZone;
  season?: number;
  calendar?: SeasonCalendar;
  /** The ground material freezes its own water from its land snow (satellite): the regime then carries no ice. */
  landIce?: boolean;
}

/** Share of the courses that lose their flow in an average year: 1 desert (only exotic trunks keep water). */
const ARIDITY: Partial<Record<ClimateZone, number>> = { desert: 1, savanna: 0.72, steppe: 0.5, mediterranean: 0.3 };
/** Sediment load reaching the sea in the wet season: warm weathered basins carry the most. */
const SEDIMENT: Partial<Record<ClimateZone, number>> = { tropical: 1, savanna: 1, wetland: 0.7, temperate: 0.45, continental: 0.45, mediterranean: 0.35, steppe: 0.3, nordic: 0.2, alpine: 0.25, arctic: 0.1, desert: 0.1 };

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
const smooth = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Freeze of still fresh water from the zone's low-ground snow (a lake ices over before its banks stay white). */
const freezeOf = (snow: number): number => smooth(0.15, 0.7, snow);
/** Lake draw-down: the dry season of a dry climate exposes the shore. Shared with WATER_FRESH_ICE_GLSL. */
const dropOf = (aridity: number, rain: number): number => aridity * clamp01(1 - 0.8 * rain);

export function waterClimate(s: WaterSeason): WaterClimate {
  if (!s.zone) return { aridity: 0, rain: 1, ice: 0, sediment: 0, drop: 0 };
  const year = calendarSeason(s.zone, s.calendar),
    w = seasonWeights(s.season ?? 0.5);
  const snow = year.snow.reduce((sum, v, i) => sum + v * w[i], 0);
  const aridity = ARIDITY[s.zone] ?? 0,
    rain = Math.max(0, 1 + year.rain * (w[2] - w[0])),
    frozen = freezeOf(snow);
  // The sediment load keeps its winter low either way; only the ice decision leaves the regime with `landIce`.
  return { aridity, rain, ice: s.landIce ? 0 : frozen, sediment: (SEDIMENT[s.zone] ?? 0) * clamp01(rain - 0.9 * aridity) * (1 - frozen), drop: dropOf(aridity, rain) };
}
/** True when the regime changes anything on the map. */
export const waterRegimeActive = (c: WaterClimate): boolean => c.aridity > 0 || c.ice > 0 || c.sediment > 0.05;

/** Seconds in a mean year. */
const YEAR_S = 31_557_600;
/** Mean annual discharge (m³/s) of a course vertex: its runoff-weighted catchment `area` (m², counted in units of the
 * sea-level runoff: the `area` the water budget carries per vertex) times the sea-level runoff `r0` (mm/yr,
 * `VectorWater.runoff.r0`). A desert trunk of 123 km² under 1.4 mm/yr carries 5.5 L/s. */
export const meanDischarge = (area: number, r0: number): number => (Math.max(0, area) * Math.max(0, r0) * 1e-3) / YEAR_S;
/** Discharge scale of the regime (m³/s, log): size 0 at 10 L/s (a brook), 1 at 10 m³/s (a river that crosses a
 * desert). The zone's aridity then sets the perennial threshold on it (`riverState`): about 8 m³/s in a desert,
 * 0.4 m³/s in a steppe, 0.13 m³/s in a mediterranean zone; humid zones (aridity 0) keep every course running. */
const REGIME_LOW = 0.01,
  REGIME_HIGH = 10;
export const dischargeSize = (discharge: number): number => (discharge > 0 ? clamp01(Math.log(discharge / REGIME_LOW) / Math.log(REGIME_HIGH / REGIME_LOW)) : 0);
/** Runoff (mm/yr) at which the mean flow fills the bed the floods shaped. The beds are sized from the catchment alone
 * (`channelWidth`); the water inside takes `threadShare` of that width: hydraulic geometry, width as the square root of
 * the discharge. Every humid preset runs at 210 mm/yr (continental) or more: their courses stay full, as before. */
export const BANKFULL_RUNOFF = 200;
/** Share of the bed width the running water fills under the sea-level runoff `r0` (mm/yr): 1 in humid climates,
 * 0.70 mediterranean (97 mm), 0.50 steppe (50 mm), 0.25 savanna (12 mm), 0.08 desert (1.4 mm). */
export const threadShare = (r0: number): number => Math.min(1, Math.sqrt(Math.max(0, r0) / BANKFULL_RUNOFF));

/** State of a river vertex of size `q` (0 a brook of 10 L/s or less, 1 a river of 10 m³/s: `dischargeSize`). A river
 * is calm water whatever its slope: the regime carries dryness and ice only. */
export interface RiverState {
  dry: number;
  ice: number;
}
export function riverState(c: WaterClimate, q: number): RiverState {
  let dry = 0;
  if (c.aridity > 0) {
    // The perennial threshold rises with aridity; the season shifts it (wet season: more courses run).
    const t = 0.85 * c.aridity,
      shifted = q + 0.35 * (c.rain - 1) * Math.min(1, c.aridity * 1.6);
    dry = 1 - smooth(t - 0.18, t + 0.12, shifted);
    // A desert never runs fully: even the courses that carry water show their bars.
    dry = Math.max(dry, 0.12 * c.aridity * (1 - q));
  }
  // A river is frozen or open as a whole, by the same rule as lakes (ice >= .5): never by section size, which painted
  // white patches on some reaches of a course only.
  return { dry, ice: c.ice >= 0.5 ? 1 : 0 };
}

/** Segment colour of the material styles: r running water (1 − dry), g open water (1 − ice), b 0 on a river and a
 * sediment plume above .5 (.5 + plume / 2, plume capsules only). Capsules blend with MAX, so where a dry or frozen
 * tributary overlaps a running trunk the running water wins. */
export const regimeRgb = (s: RiverState): [number, number, number] => [1 - s.dry, 1 - s.ice, 0];
export const plumeRgb = (plume: number): [number, number, number] => [1, 1, 0.5 + 0.5 * clamp01(plume)];

/** Symbol class of the ink styles. */
export type RiverSymbol = 'water' | 'intermittent' | 'dry' | 'ice';
export function riverSymbol(s: RiverState): RiverSymbol {
  if (s.ice >= 0.55) return 'ice';
  if (s.dry >= 0.85) return 'dry';
  if (s.dry >= 0.4) return 'intermittent';
  return 'water';
}

const glslFloat = (v: number): string => (Math.round(v * 1000) / 1000).toFixed(3);
const zoneFloats = (values: Partial<Record<ClimateZone, number>>): string => `float[${CLIMATE_ZONES.length}](${CLIMATE_ZONES.map(z => glslFloat(values[z] ?? 0)).join(',')})`;
/** Humic (tea-coloured) lake and bog water of the boreal zones; milky glacial flour of the alpine lakes. */
const TEA: Partial<Record<ClimateZone, number>> = { nordic: 0.65, wetland: 0.55, continental: 0.3, arctic: 0.25 };
const GLACIAL: Partial<Record<ClimateZone, number>> = { alpine: 1, arctic: 0.2 };

/** Inland water climate of the zone and season in the Render v2 shaders (after RENDER_V2_GLSL: uMaterialZone, the
 * season functions and v2WinterFresh). Fresh ice is not here: the winter module derives it from the land's snow. */
export const WATER_FRESH_ICE_GLSL = `
const float V2_WATER_ARIDITY[${CLIMATE_ZONES.length}]=${zoneFloats(ARIDITY)};
const float V2_WATER_TEA[${CLIMATE_ZONES.length}]=${zoneFloats(TEA)};
const float V2_WATER_GLACIAL[${CLIMATE_ZONES.length}]=${zoneFloats(GLACIAL)};
const float V2_WATER_SEDIMENT[${CLIMATE_ZONES.length}]=${zoneFloats(SEDIMENT)};
int waterZone(){return clamp(uMaterialZone-1,0,${CLIMATE_ZONES.length - 1});}
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
  return V2_WATER_SEDIMENT[waterZone()]*clamp(rain-.9*V2_WATER_ARIDITY[waterZone()],0.,1.)*(1.-v2WinterFresh);
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
