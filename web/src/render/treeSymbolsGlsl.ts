/**
 * GLSL of the paper map's tree symbols (treeSymbols.ts): a leaf module, read by the WGSL generator with the ground shaders.
 */
/** Side of a symbol layer (texels) and the layers: TREE_SYMBOL_KINDS broadleaf variants, then as many conifers. */
export const TREE_SYMBOL_SIZE = 128,
  TREE_SYMBOL_KINDS = 16,
  TREE_SYMBOL_LAYERS = 2 * TREE_SYMBOL_KINDS;
/**
 * Map program, mode 0 with the paper tree variant (uForestBrushes 1): `treeWash` multiplies the wash of the woods into
 * the ground colour (the shade they cast on the open land around is the overlay's), `treeSymbols` returns the premultiplied symbols of the
 * fragment. Needs FOREST_GLSL (groundOccupation, forestClearingAt, forestPatchThreshold, forestGlade, forestU8) and
 * GROUND_FIELD_GLSL (groundHash).
 *
 * Distances are the occupation's: signed metres to forest land, encoded over 8 texels (32 m on a 6 km map, 210 m on a
 * 40 km map), so the wash levels of the overlay (8, 20, 36 and 56 m in) are pressed into that range on small maps;
 * each level fades in over a band around its depth, the steps of the overlay read as rings once the trees thin out.
 */
export const TREE_SYMBOLS_GLSL = `
uniform vec4 uTreeWash;uniform float uTreeConifer;uniform int uHasLandBackdrop;
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
vec4 treeSymbols(vec2 world){
  if(uHasOccupation==0)return vec4(0.);
  // From .3 CSS pixels per metre, as the overlay's woods (lod.ts NEAR_SCALE).
  float vis=1.-smoothstep(1./.32,1./.25,uPx*uDpr);
  bool light=uQuality>0;const float s=6.;
  // Nothing reaches a fragment farther than 2.15 cells from the woods.
  if(vis<=0.||groundOccupation(world).y<-2.2*s)return vec4(0.);
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
    // Light quality keeps a nested half of the symbols: drop the others before any texture read.
    if(forestU8(h2,0u)>(light?.5:.95))continue;
    vec3 o=groundOccupation(c);
    if(o.y<=0.||treeSymbolBarred(int(o.z))||forestClearingAt(c)>=0.)continue;
    // Stands thin toward the edge and open in the glades of the satellite stand mosaic.
    if(forestPatchThreshold(c).x>=mix(.78,.95,smoothstep(0.,24.,o.y)))continue;
    bool needle=uTreeConifer>0.&&forestU8(h2,8u)<clamp(uTreeConifer+.9*forestGlade(c).x,0.,1.);
    vec2 uv=d/(2.*ext)+.5;if((h2&1u)==1u)uv.x=1.-uv.x;
    float layer=(needle?${TREE_SYMBOL_KINDS}.:0.)+floor(forestU8(h2,16u)*${TREE_SYMBOL_KINDS}.);
    vec4 t=textureLod(uForestBrushAtlas,vec3(uv,layer),max(0.,log2(${TREE_SYMBOL_SIZE}.*uPx/(2.*ext)))+(light?1.:0.));
    acc=t+acc*(1.-t.a);
  }
  return acc*vis;
}
`;
