import { CLIMATE_ZONES, type ClimateZone } from './terrainClimate';

/** `uMaterialZone` value: CLIMATE_ZONES index + 1. 0 (also the GLSL default of
 * a program that never sets it) keeps the climate-only Render v2 look. */
export const renderV2ZoneUniform = (zone?: ClimateZone): number => zone ? CLIMATE_ZONES.indexOf(zone) + 1 : 0;

/** Per-zone appearance table of the Render v2 series, indexed by CLIMATE_ZONES.
 * Climate values (temperature, rain) still drive every physical field; a zone
 * only reweights what those values cannot tell apart: cover classes, substrate
 * colour, stand composition and the water table of low flat ground. */
export const RENDER_V2_ZONE_GLSL = `
uniform int uMaterialZone;
// x canopy cover scale, y needle-leaf target, z its weight, w low-flat water table.
const vec4 V2_ZONE_FOREST[11]=vec4[11](
  vec4(1.,.12,.45,.25),vec4(.62,.30,.45,0.),vec4(1.,.55,.55,.15),vec4(1.,.92,.75,.45),
  vec4(1.,.88,.70,.05),vec4(.12,.75,.60,.45),vec4(.22,.20,.50,.08),vec4(.55,0.,1.,0.),
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
vec4 v2ZoneForest(vec4 f){
  if(!v2Zoned())return f;
  vec4 z=V2_ZONE_FOREST[v2Zone()];
  return vec4(clamp(f.r*z.x,0.,1.),f.g,mix(f.b,z.y,z.z),f.a);
}
`;
