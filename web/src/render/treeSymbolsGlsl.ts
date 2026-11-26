/**
 * GLSL of the paper map's tree symbols (treeSymbols.ts): a leaf module, read by the WGSL generator with the ground shaders.
 */
/** Side of a symbol layer (texels) and the layers: TREE_SYMBOL_KINDS variants of each species, in the order of canopy.ts
 * TREE_SPECIES (broadleaf, conifer, bare, palm). */
export const TREE_SYMBOL_SIZE = 128,
  TREE_SYMBOL_KINDS = 16,
  TREE_SYMBOL_LAYERS = 4 * TREE_SYMBOL_KINDS;
/** Keep the engraved crowns legible as individual marks instead of a nearly solid canopy. */
export const TREE_SYMBOL_DENSITY = 0.5,
  TREE_SYMBOL_LIGHT_DENSITY = 0.3;
/** Drawn reach of a symbol from its centre, as a share of its sprite half-side (`ext`, 10 glyph units): the engraved
 * crown (about 6.5 units) and its cast shadow (1.3 units, canopy.ts paintEngraved). A symbol is rooted only that far
 * inside the forest land of the occupation, so its whole crown lies on the woods: the overlay keeps its copy of the land
 * outside them (treeSymbols.ts punchWoods) and the ink water above the ground; a crown overhanging either was cut along
 * a straight land-use edge or covered by the river band. */
export const TREE_SYMBOL_REACH = 0.8,
  /** Largest sprite half-side (m): `ext` = 10 r with r at most 1.2. */
  TREE_SYMBOL_EXT_MAX = 12;
/**
 * Map program, mode 0 with the paper tree variant (uForestBrushes 1): `treeWash` multiplies the wash of the woods into
 * the ground colour (the shade they cast on the open land around is the overlay's), `treeSymbols` returns the premultiplied symbols of the
 * fragment. Needs FOREST_GLSL (groundOccupation, forestClearingAt, forestPatchThreshold, forestGlade, forestU8) and
 * GROUND_FIELD_GLSL (groundHash).
 *
 * Distances are the occupation's: signed metres to forest land, encoded over 8 texels (32 m on a 6 km map, 210 m on a
 * 40 km map), so the wash levels of the overlay (8, 20, 36 and 56 m in) are pressed into that range on small maps;
 * each level fades in over a band around its depth, the steps of the overlay read as rings once the trees thin out.
 *
 * The atlas holds the summer symbols; the date of the map is uniforms: `uTreeSeason` (share of the deciduous trees in
 * leaf, turned foliage, snow on the crowns, spring green) and `uTreeSpecies` (conifers, palms, larches among conifers).
 */
export const TREE_SYMBOLS_GLSL = `
uniform vec4 uTreeWash;uniform vec4 uTreeSeason;uniform vec4 uTreeSpecies;uniform int uHasLandBackdrop;
// The date on the lit land (seasonPalette.ts mapLandSeason): the tint of the open ground with the calendar's low-ground
// snow in a, and the snow terms of the date at sea level (date and warm-season temperatures, supply divisor, precipitation).
uniform vec4 uLandTint;uniform vec4 uLandSnow;
float landSnowHash(ivec2 p,uint salt){uvec2 q=uvec2(p);uint h=(q.x*374761393u)^(q.y*668265263u)^salt;h=(h^(h>>13u))*1274126177u;h^=h>>16u;return float(h>>8u)/16777216.;}
float landSnowOctave(vec2 q,uint salt){
  vec2 i=floor(q),u=q-i;u=u*u*(3.-2.*u);ivec2 c=ivec2(i);
  return mix(mix(landSnowHash(c,salt),landSnowHash(c+ivec2(1,0),salt),u.x),mix(landSnowHash(c+ivec2(0,1),salt),landSnowHash(c+ivec2(1,1),salt),u.x),u.y);
}
// Smooth ramp from a to b, also downwards (a > b).
float landRamp(float a,float b,float x){float t=clamp((x-a)/(b-a),0.,1.);return t*t*(3.-2.*t);}
// The summer sheet of the lit land at the date of the map, as the overlay's canvas copy lays it (v1Landscape.ts
// seasonLand): the tint of the open ground, then the snow of the altitude h, ragged near its line.
vec3 landSeason(vec3 lit,vec2 world,float h){
  vec2 g=(world/uMapW*512.-.5)/14.;
  float ragged=min(max(0.,max(h,0.)+260.*(.65*landSnowOctave(g,0x2f6b1d35u)+.35*landSnowOctave(g*3.1,0x7c15a4e9u)-.5)),max(uMaxH,1.));
  float lapse=.0065*ragged;
  float supply=landRamp(.12,.7,uLandSnow.w/max(120.,uLandSnow.z-20.*lapse));
  float cover=max(uLandTint.a,landRamp(.405,.465,max(landRamp(2.,-5.,uLandSnow.x-lapse),landRamp(2.5,-2.5,uLandSnow.y-lapse))*supply));
  // .86: LAND_SNOW_ALPHA (seasonPalette.ts).
  return mix(lit*uLandTint.rgb,vec3(246.,247.,243.)/255.,.86*cover);
}
// Occupation classes that root no tree symbol: orchards, gardens, construction, lanes, road corridors, covered ways.
bool treeSymbolBarred(int cls){return cls==4||cls==5||cls==8||cls==9||cls==11||cls==12;}
vec3 treeWash(vec3 color,vec2 world){
  if(uHasOccupation==0)return color;
  vec3 o=groundOccupation(world);int cls=int(o.z);
  vec3 F=uTreeWash.rgb;float A=uTreeWash.a;
  float inside=clamp(o.y/uPx+.5,0.,1.);
  if(inside>0.&&cls!=4&&forestClearingAt(world)<0.){
    vec3 m=mix(vec3(1.),F,A*(uQuality>0?1.:.18));
    if(uQuality==0){
      float k=min(1.,7.5*uOccupationRect.z/uOccupationN/84.);
      m*=mix(vec3(1.),F,A*.2*smoothstep(4.*k,12.*k,o.y));
      m*=mix(vec3(1.),F,A*.24*smoothstep(10.*k,30.*k,o.y));
      m*=mix(vec3(1.),F,A*.32*smoothstep(18.*k,54.*k,o.y));
      m*=mix(vec3(1.),F,A*.46*smoothstep(28.*k,84.*k,o.y));
    }
    color*=mix(vec3(1.),m,inside);
  }

  return color;
}
// A symbol at the date of the map: the turned or spring foliage of a deciduous crown (its wash, not its ink) and the
// snow on the side lit from the upper left. pick: its place in the stand.
vec4 treeSymbolSeason(vec4 t,vec2 lit,float turns,float pick,float bareTree){
  if(t.a<=0.)return t;
  vec3 c=t.rgb/t.a;const vec3 luma=vec3(.2126,.7152,.0722);float l=dot(c,luma),wash=smoothstep(.2,.46,l);
  vec3 hue=pick<.34?vec3(.83,.64,.24):pick<.68?vec3(.80,.48,.18):pick<.9?vec3(.66,.30,.17):vec3(.55,.58,.36);
  c=mix(c,hue*min(1.35,1.12*l/dot(hue,luma)),wash*turns*(.75+.25*fract(pick*7.3)));
  c=mix(c,c*vec3(1.06,1.1,.82),wash*uTreeSeason.w*(1.-bareTree)*.6);
  float cap=uTreeSeason.z*smoothstep(-.55,.45,-.5*(lit.x+lit.y))*mix(.85*mix(.35,1.,wash),.45,bareTree);
  return vec4(mix(c,vec3(.965,.969,.953),cap)*t.a,t.a);
}
vec4 treeSymbols(vec2 world){
  if(uHasOccupation==0)return vec4(0.);
  // From .3 CSS pixels per metre, as the overlay's woods (lod.ts NEAR_SCALE).
  float vis=1.-smoothstep(1./.32,1./.25,uPx*uDpr);
  bool light=uQuality>0;const float s=6.;
  // Every crown lies inside the woods: only the transparent margin of a sprite reaches past their edge.
  if(vis<=0.||groundOccupation(world).y<-${((1 - TREE_SYMBOL_REACH) * TREE_SYMBOL_EXT_MAX).toFixed(1)})return vec4(0.);
  ivec2 cell=ivec2(floor(world/s));vec4 acc=vec4(0.);uint seed=uMaterialSeed^0x51ed270bu;
  for(int j=-2;j<=2;j++)for(int i=-2;i<=2;i++){
    ivec2 k=cell+ivec2(i,j);
    uint h=groundHash(ivec3(k,1201),seed);
    vec2 c=(vec2(k)+.15+.7*vec2(forestU8(h,0u),forestU8(h,8u)))*s;
    // Crown sizes of the overlay's woods (canopy.ts canopyMarks), held inside the searched cells.
    float u=forestU8(h,16u),r=min(u>.94?1.35+(u-.94)*4.:.72+.55*u*u,1.2),ext=10.*r;
    vec2 d=world-c;
    if(abs(d.x)>=ext||abs(d.y)>=ext)continue;
    uint h2=groundHash(ivec3(k,1202),seed);
    // Both tiers keep the same nested seeded stand; rejected marks cost no texture read.
    if(forestU8(h2,0u)>(light?${TREE_SYMBOL_LIGHT_DENSITY}:${TREE_SYMBOL_DENSITY}))continue;
    // Rooted only where the whole crown lies on forest land: never cut by the land-use edge of the overlay, never under
    // the river band, the roads or the clearings, whose ground the forest distance already leaves out.
    vec3 o=groundOccupation(c);
    if(o.y<${TREE_SYMBOL_REACH}*ext||treeSymbolBarred(int(o.z))||forestClearingAt(c)>=0.)continue;
    // Stands thin toward the edge and open in the glades of the satellite stand mosaic.
    if(forestPatchThreshold(c).x>=mix(.78,.95,smoothstep(0.,24.,o.y)))continue;
    bool needle=uTreeSpecies.x>0.&&forestU8(h2,8u)<clamp(uTreeSpecies.x+.9*forestGlade(c).x,0.,1.);
    float pick=forestU8(h2,24u);
    bool palm=!needle&&pick<uTreeSpecies.y,larch=needle&&pick<uTreeSpecies.z,sheds=larch||(!needle&&!palm);
    bool bare=sheds&&forestU8(h,24u)>=uTreeSeason.x;
    vec2 uv=d/(2.*ext)+.5;if((h2&1u)==1u)uv.x=1.-uv.x;
    float kind=bare?2.:needle?1.:palm?3.:0.;
    float layer=kind*${TREE_SYMBOL_KINDS}.+floor(forestU8(h2,16u)*${TREE_SYMBOL_KINDS}.);
    vec4 t=textureLod(uForestBrushAtlas,vec3(uv,layer),max(0.,log2(${TREE_SYMBOL_SIZE}.*uPx/(2.*ext)))+(light?1.:0.));
    // Larches turn gold.
    t=treeSymbolSeason(t,d/ext,sheds&&!bare?uTreeSeason.y:0.,larch?.1:pick,bare?1.:0.);
    acc=t+acc*(1.-t.a);
  }
  return acc*vis;
}
`;
