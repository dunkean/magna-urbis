import { CLIMATE_ZONES, type ClimateZone } from './terrainClimate';

/** `uMaterialZone` value: CLIMATE_ZONES index + 1. 0 (also the GLSL default of
 * a program that never sets it) keeps the climate-only Render v2 look. */
export const renderV2ZoneUniform = (zone?: ClimateZone): number => zone ? CLIMATE_ZONES.indexOf(zone) + 1 : 0;

type Tint = readonly [number, number, number];
type Year<T> = readonly [T, T, T, T];
/** The year of a climate zone. Every column runs winter, spring, summer, autumn. */
export interface ZoneSeason {
  /** Colour ratio of herbaceous ground. */
  herb: Year<Tint>;
  /** Fullness of deciduous crowns: 0 bare, 1 in full leaf. */
  leaf: Year<number>;
  /** Minimum sea ice concentration. */
  seaIce: Year<number>;
  /** Water table of low flat ground, as a ratio. */
  wet: Year<number>;
  /** Low-ground snow of the map styles; the material derives its own from temperature. */
  snow: Year<number>;
  /** Rain regime: -1 all in winter, 1 all in summer. */
  rain: number;
  /** Winter cooling added to the annual temperature proxy (°C). */
  cool: number;
  /** Share of conifers that are larches: gold in autumn, bare in winter. */
  larch: number;
  /** Warming of the snow line (°C): maritime springs melt the snow long before the air proxy says so. */
  thaw?: Year<number>;
}
const NO_ICE: Year<number> = [0, 0, 0, 0], STEADY: Year<number> = [1, 1, 1, 1];
export const ZONE_SEASONS: Readonly<Record<ClimateZone, ZoneSeason>> = {
  temperate: { herb: [[.86, .80, .70], [.98, 1.12, .90], [.96, 1.06, .92], [1.06, .96, .78]], leaf: [0, .62, 1, .85], seaIce: NO_ICE, wet: STEADY, snow: [.12, 0, 0, 0], rain: .1, cool: 1, larch: 0, thaw: [0, 5.3, 0, 3] },
  mediterranean: { herb: [[.90, 1.08, .86], [.92, 1.12, .84], [1.18, 1.02, .74], [1.10, .98, .78]], leaf: [.82, .92, 1, .95], seaIce: NO_ICE, wet: STEADY, snow: NO_ICE, rain: -.75, cool: 0, larch: 0 },
  continental: { herb: [[.85, .80, .72], [.96, 1.12, .90], [.97, 1.05, .93], [1.08, .94, .74]], leaf: [0, .55, 1, .80], seaIce: [.55, .10, 0, 0], wet: STEADY, snow: [.85, .05, 0, .05], rain: .25, cool: 6, larch: .1, thaw: [0, 10.5, 0, 4] },
  nordic: { herb: [[.80, .76, .72], [.94, 1.04, .88], [.98, 1.04, .96], [1.08, .94, .76]], leaf: [0, .40, 1, .75], seaIce: [.75, .30, 0, .05], wet: STEADY, snow: [1, .25, 0, .10], rain: 0, cool: 7, larch: .12, thaw: [0, 4.5, 0, 0] },
  alpine: { herb: [[.85, .82, .76], [.98, 1.10, .90], [1, 1.06, .96], [1.07, .95, .78]], leaf: [0, .40, 1, .75], seaIce: NO_ICE, wet: STEADY, snow: [1, .35, 0, .20], rain: .15, cool: 9, larch: .35 },
  arctic: { herb: [[.90, .88, .86], [.92, .92, .84], [.98, 1.02, .88], [1.12, .90, .72]], leaf: [0, .30, 1, .65], seaIce: [.82, .82, .76, .80], wet: STEADY, snow: [1, .80, .05, .55], rain: .2, cool: 6, larch: 0 },
  steppe: { herb: [[.92, .86, .76], [.86, 1.14, .82], [1.06, .98, .84], [1.04, .94, .80]], leaf: [0, .60, 1, .70], seaIce: [.30, 0, 0, 0], wet: STEADY, snow: [.60, 0, 0, .05], rain: .3, cool: 5, larch: 0 },
  desert: { herb: [[.90, .90, .92], [.96, 1.02, .90], [1.08, 1, .88], [1.02, .97, .90]], leaf: [.90, 1, 1, .95], seaIce: NO_ICE, wet: STEADY, snow: NO_ICE, rain: 0, cool: 0, larch: 0 },
  savanna: { herb: [[1.12, 1, .74], [1.04, 1.02, .80], [.72, 1.14, .74], [.92, 1.08, .78]], leaf: [.30, .55, 1, .80], seaIce: NO_ICE, wet: [.2, .6, 1.6, 1.1], snow: NO_ICE, rain: .95, cool: 0, larch: 0 },
  tropical: { herb: [[1.10, 1.02, .82], [1, 1.02, .96], [.92, 1.06, .92], [.96, 1.04, .94]], leaf: [.85, .95, 1, 1], seaIce: NO_ICE, wet: [.7, .9, 1.3, 1.2], snow: NO_ICE, rain: .45, cool: 0, larch: 0 },
  wetland: { herb: [[.92, .84, .70], [.92, 1.14, .90], [.96, 1.07, .92], [1.08, .95, .74]], leaf: [0, .62, 1, .85], seaIce: [.10, 0, 0, 0], wet: [.9, 1.35, .75, 1], snow: [.30, 0, 0, 0], rain: 0, cool: 2, larch: 0, thaw: [0, 5.3, 0, 3] },
};
/** Edits of the zone's year from the appearance panel. An absent field keeps the zone's value. */
export interface SeasonCalendar {
  thawSpring?: number; thawAutumn?: number; /** °C added to the winter low, like the thaws: negative is colder. */ winterCold?: number; rain?: number;
  leafWinter?: number; leafSpring?: number; leafAutumn?: number; larch?: number;
  seaIceWinter?: number; seaIceSpring?: number; seaIceSummer?: number; seaIceAutumn?: number;
  /** Strength of the seasonal colours of herbs and crops: 0 none, 1 the zone's, 2 doubled. */
  greenery?: number;
  /** Amplitude of the drifts that break snow into patches. */
  snowPatches?: number;
}
export type SeasonCalendarKey = keyof SeasonCalendar;
/** Field, labels and range of each calendar control. */
export const SEASON_CALENDAR_FIELDS: readonly { key: SeasonCalendarKey; en: string; fr: string; min: number; max: number; step: number }[] = [
  { key: 'thawSpring', en: 'Spring thaw of the snow line (°C)', fr: 'Dégel de printemps de la limite des neiges (°C)', min: -10, max: 20, step: .5 },
  { key: 'thawAutumn', en: 'Autumn thaw of the snow line (°C)', fr: 'Dégel d’automne de la limite des neiges (°C)', min: -10, max: 20, step: .5 },
  { key: 'winterCold', en: 'Winter temperature shift (°C, negative is colder)', fr: 'Décalage de température hivernale (°C, négatif = plus froid)', min: -20, max: 10, step: .5 },
  { key: 'snowPatches', en: 'Snow patchiness', fr: 'Morcellement de la neige', min: 0, max: 1, step: .05 },
  { key: 'rain', en: 'Rain regime (−1 winter, +1 summer)', fr: 'Régime des pluies (−1 hiver, +1 été)', min: -1, max: 1, step: .05 },
  { key: 'greenery', en: 'Seasonal colour strength', fr: 'Intensité des couleurs de saison', min: 0, max: 2, step: .05 },
  { key: 'leafWinter', en: 'Deciduous leaves in winter', fr: 'Feuillage caduc en hiver', min: 0, max: 1, step: .05 },
  { key: 'leafSpring', en: 'Deciduous leaves in spring', fr: 'Feuillage caduc au printemps', min: 0, max: 1, step: .05 },
  { key: 'leafAutumn', en: 'Deciduous leaves in autumn', fr: 'Feuillage caduc en automne', min: 0, max: 1, step: .05 },
  { key: 'larch', en: 'Larch share of conifers', fr: 'Part de mélèzes parmi les conifères', min: 0, max: 1, step: .05 },
  { key: 'seaIceWinter', en: 'Sea ice in winter', fr: 'Banquise en hiver', min: 0, max: 1, step: .02 },
  { key: 'seaIceSpring', en: 'Sea ice in spring', fr: 'Banquise au printemps', min: 0, max: 1, step: .02 },
  { key: 'seaIceSummer', en: 'Sea ice in summer', fr: 'Banquise en été', min: 0, max: 1, step: .02 },
  { key: 'seaIceAutumn', en: 'Sea ice in autumn', fr: 'Banquise en automne', min: 0, max: 1, step: .02 },
];
const SNOW_PATCHES = .4;
/** The zone's own values, in calendar form. A map without a zone follows the temperate year. */
export function zoneCalendar(zone: ClimateZone = 'temperate'): Required<SeasonCalendar> {
  const z = ZONE_SEASONS[zone], thaw = z.thaw ?? NO_ICE;
  return { thawSpring: thaw[1], thawAutumn: thaw[3], winterCold: -z.cool, rain: z.rain, leafWinter: z.leaf[0], leafSpring: z.leaf[1], leafAutumn: z.leaf[3], larch: z.larch,
    seaIceWinter: z.seaIce[0], seaIceSpring: z.seaIce[1], seaIceSummer: z.seaIce[2], seaIceAutumn: z.seaIce[3], greenery: 1, snowPatches: SNOW_PATCHES };
}
const edited = (calendar?: SeasonCalendar): boolean => !!calendar && Object.values(calendar).some(value => typeof value === 'number' && Number.isFinite(value));
/** The zone's year with the panel's edits applied; herb colours are scaled by the colour strength. */
export function calendarSeason(zone: ClimateZone = 'temperate', calendar?: SeasonCalendar): ZoneSeason {
  const z = ZONE_SEASONS[zone];
  if (!edited(calendar)) return z;
  const c = { ...zoneCalendar(zone), ...Object.fromEntries(Object.entries(calendar!).filter(([, v]) => typeof v === 'number')) } as Required<SeasonCalendar>;
  const herb = z.herb.map(t => t.map(v => 1 + (v - 1) * c.greenery)) as unknown as Year<Tint>;
  return { ...z, herb, leaf: [c.leafWinter, c.leafSpring, 1, c.leafAutumn], seaIce: [c.seaIceWinter, c.seaIceSpring, c.seaIceSummer, c.seaIceAutumn], rain: c.rain, cool: -c.winterCold, larch: c.larch, thaw: [0, c.thawSpring, 0, c.thawAutumn] };
}
/** Uniform values of the calendar; `uV2Calendar` 0 keeps the compiled zone tables. */
export function seasonCalendarUniforms(zone?: ClimateZone, calendar?: SeasonCalendar): { on: number; leaf: number[]; ice: number[]; thaw: number[]; climate: number[]; snow: number[] } {
  const c = { ...zoneCalendar(zone), ...Object.fromEntries(Object.entries(calendar ?? {}).filter(([, v]) => typeof v === 'number')) } as Required<SeasonCalendar>;
  return { on: edited(calendar) ? 1 : 0, leaf: [c.leafWinter, c.leafSpring, 1, c.leafAutumn], ice: [c.seaIceWinter, c.seaIceSpring, c.seaIceSummer, c.seaIceAutumn],
    thaw: [0, c.thawSpring, 0, c.thawAutumn], climate: [c.rain, -c.winterCold, c.larch, c.greenery], snow: [c.snowPatches, 0, 0, 0] };
}
/** Sets the calendar uniforms on a WebGL program; `u` resolves a uniform location. */
export function setSeasonCalendarGl(gl: WebGL2RenderingContext, u: (name: string) => WebGLUniformLocation | null, zone?: ClimateZone, calendar?: SeasonCalendar): void {
  const v = seasonCalendarUniforms(zone, calendar);
  gl.uniform1i(u('uV2Calendar'), v.on); gl.uniform4fv(u('uV2CalLeaf'), v.leaf); gl.uniform4fv(u('uV2CalIce'), v.ice); gl.uniform4fv(u('uV2CalThaw'), v.thaw);
  gl.uniform4fv(u('uV2CalClimate'), v.climate); gl.uniform4fv(u('uV2CalSnow'), v.snow);
}
/** Same for a WebGPU parameter block. */
export function setSeasonCalendarGpu(p: { set(name: string, ...values: number[]): void; setArray(name: string, values: ArrayLike<number>): void }, zone?: ClimateZone, calendar?: SeasonCalendar): void {
  const v = seasonCalendarUniforms(zone, calendar);
  p.set('uV2Calendar', v.on); p.setArray('uV2CalLeaf', v.leaf); p.setArray('uV2CalIce', v.ice); p.setArray('uV2CalThaw', v.thaw); p.setArray('uV2CalClimate', v.climate); p.setArray('uV2CalSnow', v.snow);
}
/** Weights of the four seasons at a point of the annual cycle; they sum to 1. */
export function seasonWeights(season: number): Year<number> {
  const at = (season % 1 + 1) % 1 * 4, i = Math.floor(at) % 4, f = at - Math.floor(at), w = [0, 0, 0, 0];
  w[i] = 1 - f; w[(i + 1) % 4] = f;
  return w as unknown as Year<number>;
}
const glslFloats = (values: readonly number[]): string => values.map(v => Number.isInteger(v) ? `${v}.` : String(v)).join(',');
const zoneTable = (name: string, type: string, rows: readonly string[]): string => `const ${type} ${name}[${rows.length}]=${type}[${rows.length}](${rows.join(',')});`;
const seasonRows = CLIMATE_ZONES.map(zone => ZONE_SEASONS[zone]);
const RENDER_V2_SEASON_GLSL = [
  zoneTable('V2_SEASON_HERB', 'vec3', seasonRows.flatMap(row => row.herb.map(c => `vec3(${glslFloats(c)})`))),
  zoneTable('V2_SEASON_LEAF', 'vec4', seasonRows.map(row => `vec4(${glslFloats(row.leaf)})`)),
  zoneTable('V2_SEASON_ICE', 'vec4', seasonRows.map(row => `vec4(${glslFloats(row.seaIce)})`)),
  zoneTable('V2_SEASON_WET', 'vec4', seasonRows.map(row => `vec4(${glslFloats(row.wet)})`)),
  zoneTable('V2_SEASON_THAW', 'vec4', seasonRows.map(row => `vec4(${glslFloats(row.thaw ?? NO_ICE)})`)),
  // x rain regime, y winter cooling, z larch share.
  zoneTable('V2_SEASON_CLIMATE', 'vec3', seasonRows.map(row => `vec3(${glslFloats([row.rain, row.cool, row.larch])})`)),
].join('\n');

/** Per-zone appearance table of the Render v2 series, indexed by CLIMATE_ZONES.
 * Climate values (temperature, rain) still drive every physical field; a zone
 * only reweights what those values cannot tell apart: cover classes, substrate
 * colour, stand composition and the water table of low flat ground. */
export const RENDER_V2_ZONE_GLSL = `
uniform int uMaterialZone;
// x canopy cover scale, y needle-leaf target, z its weight, w low-flat water table.
const vec4 V2_ZONE_FOREST[11]=vec4[11](
  vec4(1.,.12,.45,.25),vec4(.62,.30,.45,0.),vec4(1.,.55,.55,.15),vec4(1.,.92,.75,.45),
  vec4(1.,.90,.85,.05),vec4(.05,.98,.95,.45),vec4(.22,.20,.50,.08),vec4(.12,0.,1.,0.),
  vec4(.42,0.,1.,.10),vec4(1.,0.,1.,.55),vec4(.55,.08,.70,1.));
// x rock exposure, y sand, z organic soil, w herbaceous cover scale.
const vec4 V2_ZONE_SOIL[11]=vec4[11](
  vec4(0.,0.,.05,1.),vec4(.35,0.,-.10,.75),vec4(0.,0.,.05,1.),vec4(.60,0.,.12,.95),
  vec4(.30,0.,0.,1.),vec4(.45,0.,.15,.90),vec4(0.,.06,0.,1.),vec4(.25,.55,-.20,.12),
  vec4(0.,.10,0.,1.),vec4(0.,0.,.10,1.),vec4(-.40,0.,.45,1.));
// Herbaceous colour (rgb, display) and its blend over the climate meadow.
const vec4 V2_ZONE_SWARD[11]=vec4[11](
  vec4(.29,.39,.17,.35),vec4(.50,.50,.36,.60),vec4(.33,.40,.20,.30),vec4(.30,.36,.21,.40),
  vec4(.33,.45,.19,.45),vec4(.44,.44,.33,.60),vec4(.58,.56,.34,.65),vec4(.66,.60,.46,.70),
  vec4(.72,.61,.33,.80),vec4(.22,.37,.14,.45),vec4(.31,.38,.20,.45));
// Bare substrate colour (rgb) and its blend over the climate soil/rock.
const vec4 V2_ZONE_BARE[11]=vec4[11](
  vec4(.42,.36,.27,.20),vec4(.78,.75,.66,.72),vec4(.40,.35,.27,.20),vec4(.52,.50,.48,.55),
  vec4(.60,.60,.58,.55),vec4(.34,.33,.31,.55),vec4(.58,.52,.40,.40),vec4(.77,.69,.55,.82),
  vec4(.67,.46,.31,.50),vec4(.52,.34,.23,.40),vec4(.23,.21,.15,.50));
// Canopy tint ratio (rgb) and scattered scrub/grove speckle on open land.
const vec4 V2_ZONE_CANOPY[11]=vec4[11](
  vec4(1.,1.,1.,.10),vec4(1.06,1.03,.86,.55),vec4(.97,1.,1.,.05),vec4(.86,.95,1.02,.10),
  vec4(.90,.97,1.,.05),vec4(1.05,1.,.90,.15),vec4(1.05,1.03,.86,.20),vec4(1.,1.06,.86,0.),
  vec4(1.10,1.05,.76,.60),vec4(.86,1.10,.86,.10),vec4(1.,1.02,.90,.20));
// Wet low-ground class colour (wet meadow, bog, paddy, reed bed) and the
// treeline lowering (°C of warm season) that opens an alpine/tundra belt.
const vec4 V2_ZONE_WET[11]=vec4[11](
  vec4(.27,.38,.18,0.),vec4(.40,.42,.28,0.),vec4(.28,.36,.20,.5),vec4(.36,.33,.22,1.),
  vec4(.30,.40,.20,3.5),vec4(.42,.40,.27,2.),vec4(.42,.46,.27,0.),vec4(.30,.40,.20,0.),
  vec4(.36,.42,.22,0.),vec4(.36,.56,.24,0.),vec4(.30,.29,.18,0.));
bool v2Zoned(){return uMaterialZone>0&&uRenderV2>0;}
int v2Zone(){return clamp(uMaterialZone-1,0,10);}
${RENDER_V2_SEASON_GLSL}
// Calendar edited in the appearance panel; uV2Calendar 0 keeps the zone tables.
uniform int uV2Calendar;
uniform vec4 uV2CalLeaf;
uniform vec4 uV2CalIce;
uniform vec4 uV2CalThaw;
// x rain regime, y winter cold, z larch share, w seasonal colour strength.
uniform vec4 uV2CalClimate;
// x snow patchiness.
uniform vec4 uV2CalSnow;
// A map without a zone follows the temperate year.
int v2SeasonZone(){return uMaterialZone>0?clamp(uMaterialZone-1,0,10):0;}
vec4 v2SeasonWeights(){
  float at=fract(uV2Season)*4.;
  return max(vec4(0.),1.-min(abs(vec4(at)-vec4(0.,1.,2.,3.)),abs(vec4(at)-vec4(4.,5.,6.,7.))));
}
vec3 v2SeasonHerb(){
  int z=v2SeasonZone()*4;vec4 w=v2SeasonWeights();
  vec3 herb=V2_SEASON_HERB[z]*w.x+V2_SEASON_HERB[z+1]*w.y+V2_SEASON_HERB[z+2]*w.z+V2_SEASON_HERB[z+3]*w.w;
  return uV2Calendar==1?mix(vec3(1.),herb,uV2CalClimate.w):herb;
}
float v2SeasonLeaf(){return dot(uV2Calendar==1?uV2CalLeaf:V2_SEASON_LEAF[v2SeasonZone()],v2SeasonWeights());}
float v2SeasonSeaIce(){return dot(uV2Calendar==1?uV2CalIce:V2_SEASON_ICE[v2SeasonZone()],v2SeasonWeights());}
float v2SeasonSnowPatches(){return uV2Calendar==1?uV2CalSnow.x:.4;}
float v2SeasonWet(){return dot(V2_SEASON_WET[v2SeasonZone()],v2SeasonWeights());}
float v2SeasonThaw(){return dot(uV2Calendar==1?uV2CalThaw:V2_SEASON_THAW[v2SeasonZone()],v2SeasonWeights());}
vec3 v2SeasonClimate(){return uV2Calendar==1?uV2CalClimate.xyz:V2_SEASON_CLIMATE[v2SeasonZone()];}
vec4 v2ZoneForest(vec4 f){
  if(!v2Zoned())return f;
  vec4 z=V2_ZONE_FOREST[v2Zone()];
  // Arctic woody cover is low, wind-pruned spruce, including trees retained in town reserves.
  float stature=v2Zone()==5?.35:1.;
  return vec4(clamp(f.r*z.x,0.,1.),f.g*stature,mix(f.b,z.y,z.z),f.a);
}
`;
