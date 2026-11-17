/** Winter state of the Render v2 satellite ground: one source for snow on land, ice on rivers and lakes,
 * and sea ice, so the land and its water freeze and thaw together.
 * Emitted in RENDER_V2_GLSL after the relief module and before the ground module.
 *
 * The source is the climatic snow of level open ground at an altitude (`v2WinterClimate`): the law of `v2Local`
 * without exposure, relief or noise, so it is one value along a contour and one value per map at sea level.
 * - Land: `v2Local` bends it by the relief and the drift patterns, then thresholds it (`v2GroundSnow`).
 * - Fresh water: `v2WinterFresh` (set by `v2Local`) is the freeze at the water's own altitude; `v2FreshIce` paints it.
 * - Sea: the calendar sets concentration; coastal snow decides whether it is shore-fast or drifting. */
export const RENDER_V2_WINTER_GLSL = `
// Temperature follows the sun by about a month: spring is colder than autumn.
const float V2_SEASON_LAG=.08;
// Set by v2Local for its fragment. v2WinterFresh: freeze of fresh water at the fragment's altitude (0 open, 1 frozen
// across). v2WinterThin: share of the snow cover that is a thin dusting the ground shows through (resolved zooms only).
float v2WinterFresh=0.,v2WinterThin=0.;
// Climatic snow of level open ground at an altitude, before its cover threshold (0 to 1). perennial: 1 with the
// snow that outlasts the summer (land, sea ice), 0 for the cold of the season alone (fresh water: a summer stream
// runs open between perennial snow fields).
float v2WinterClimate(float altitude,float perennial){
  float annual=uMaterialClimate.x-.0065*max(altitude,0.),amplitude=6.+.5*max(0.,10.-uMaterialClimate.x);
  vec3 year=vec3(0.);float thaw=0.;
  if(v2Zoned()){year=v2SeasonClimate();thaw=v2SeasonThaw();}
  float warmest=annual+amplitude,coldest=annual-amplitude-year.y;
  float phase=.5-.5*cos(6.283185307*fract(uV2Season+1.-V2_SEASON_LAG));
  float supply=clamp(uMaterialClimate.y/max(120.,10.*(warmest+coldest)+280.),0.,5.);
  // Fresh water (perennial 0) only freezes in the cold half of the year: near the snow line the land of a summer
  // map is drawn bare by its exposure, and a frozen torrent beside it would contradict it.
  float seasonal=v2Snow(mix(coldest,warmest,phase)+thaw,supply,0.,0.)*(1.-(1.-perennial)*sstep(.5,.8,phase));
  return max(seasonal,perennial*v2PerennialSnow(warmest,supply,0.));
}
// Snow cover of level ground for a climatic snow value: the far threshold of v2Local.
float v2WinterCover(float snow){return sstep(.325,.575,snow);}
// Fresh water starts to freeze once the level ground of its altitude is almost wholly covered (v2WinterCover .9),
// and is frozen across when that ground lies deep in snow: ice never borders bare land.
float v2WinterFreeze(float snow){return sstep(.52,.80,snow);}
// Width (m) of the border ice grown from each bank at a freeze level: small courses close first, a large river
// keeps an open channel until the cold is deep; past .97 every course is closed.
float v2WinterShelf(float freeze){return 2.+90.*freeze*freeze+600.*sstep(.85,1.,freeze);}
// Sea ice concentration belongs to the calendar, independently of snow on land. Coastal thaw breaks the sheet
// into drifting floes; it must not reduce concentration and then discard that pack again at the offshore limit.
// x concentration, y looseness (0 fast sheet at the shore, 1 drifting floes only).
vec2 v2WinterSeaIce(float potential){
  float coast=v2WinterCover(v2WinterClimate(0.,1.));
  return vec2(potential,(1.-coast)*(1.-sstep(.82,1.,potential)));
}
// Offshore limit of the pack's progress (0 fast sheet, about .3 close pack with hairline leads, 1 open water).
// Every nonzero concentration retains some offshore pack. Increasing it closes the leads continuously, reaching
// the existing arctic winter's close pack at .82; there is no threshold below which the whole offshore pack vanishes.
float v2WinterPackLimit(float concentration){return mix(1.,.3,clamp(concentration/.82,0.,1.));}
// Ice sheet of fresh water, following the water's own outline (rgb colour, a cover of the water).
// freeze: v2WinterFresh. channel: 1 where a river fragment lies further than v2WinterShelf from every bank.
// still: 1 inside a lake; shore: lake only, 1 at the shore fading to 0 inside. edge: 1 on the bank line.
// A river grows border ice from its banks inward. A lake is one sheet whose shore opens first while it thaws.
vec4 v2FreshIce(vec2 world,float fp,float freeze,float channel,float still,float shore,float edge){
  float closed=step(.97,freeze);
  float river=max(closed,(1.-channel)*sstep(0.,.08,freeze));
  float lake=max(closed,sstep(-.05,.05,freeze-.92*shore));
  float tone=0.;
  if(uQuality==0)tone=v2Pattern(vec3(world,0.),150.,fp,uMaterialSeed+771u);
  // Bare ice is a blue-grey darker than snow; a deep freeze carries wind-blown snow and pales toward the land's
  // white without reaching it, and the bank keeps a darker line: a frozen course still reads in a white landscape.
  vec3 ice=mix(vec3(.62,.71,.78),vec3(.83,.87,.90),clamp(.35+.18*tone+.45*freeze,0.,1.));
  ice=mix(ice,vec3(.36,.46,.55),.85*edge*mix(1.,closed,still));
  return vec4(ice,mix(river,lake,still));
}
`;
