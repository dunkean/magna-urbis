/** Physical land cover filters material responses, never numeric class IDs.
 * Reuses the retained occupation texture without changing forest sampling.
 * Holdings come from the land detail raster (web/src/ui/landDetail.ts): crop, row direction, edge distance. */

/** The one sampler a backend without a spare texture unit leaves out: fields then keep their plain material. */
const LAND_DETAIL_SAMPLER = `uniform sampler2D uLandDetail;
vec4 landDetailSample(vec2 uv,float lod){return textureLod(uLandDetail,uv,lod);}`;
const LAND_DETAIL_ABSENT = `vec4 landDetailSample(vec2 uv,float lod){return vec4(0.);}`;
/** For GL contexts limited to 16 texture units (ANGLE on D3D11): every unit is already taken. */
export const withoutLandDetail = (shader: string): string => shader.replace(LAND_DETAIL_SAMPLER, LAND_DETAIL_ABSENT);

export const LAND_DETAIL_GLSL = `
uniform int uHasLandDetail;uniform vec3 uLandDetailRect;uniform float uLandDetailN;
${LAND_DETAIL_SAMPLER}
vec4 orchardDetail(vec2 world){
  if(uHasLandDetail==0)return vec4(0.,1.,.5,1.);
  vec2 uv=(world-uLandDetailRect.xy)/uLandDetailRect.z;
  // Exact texel centres keep categorical parcel directions stable across a crown.
  uv=(clamp(floor(uv*uLandDetailN),vec2(0.),vec2(uLandDetailN-1.))+.5)/uLandDetailN;
  return landDetailSample(uv,0.);
}
// Signed distance (m) of the alpha channel to the nearest strip edge: positive inside a holding, negative outside.
float landDetailDist(float a){return a*12.-6.;}
// Smooth share of the orchard class at this fragment (applyGroundOccupation, before applyForest): the unresolved
// orchard crowns fade with it instead of ending on the class texels. 1 where no occupation pass ran.
float v2OrchardShare=1.;
vec2 orchardRows(vec2 world){vec4 d=orchardDetail(world);vec2 c=d.gb*2.-1.;float a=.5*atan(c.y,c.x);return vec2(cos(a),sin(a));}
`;

export const GROUND_OCCUPATION_GLSL = `
// The original six-crop ramp (plough, stubble, wheat, barley, oats, beans): the town ground takes its packed earth
// from it.
vec3 landCropTone(float t,float green){
  vec3 plough=vec3(.36,.29,.21),stubble=vec3(.55,.49,.36),wheat=vec3(.58,.51,.32),barley=vec3(.53,.51,.32),oats=vec3(.40,.45,.25),beans=vec3(.27,.36,.20);
  vec3 c=t<.18?mix(plough,stubble,t/.18):t<.36?mix(stubble,wheat,(t-.18)/.18):t<.52?mix(wheat,barley,(t-.36)/.16):t<.72?mix(barley,oats,(t-.52)/.2):mix(oats,beans,(t-.72)/.28);
  // Winter: autumn-sown cereals stay thin and green over the soil, the rest lies bare.
  vec3 winter=mix(vec3(.31,.25,.19),vec3(.25,.35,.19),groundSmooth(.3,.8,t));
  return mix(winter,c,green);
}
// Field ramp of the land detail's red channel (web/src/ui/landDetail.ts CROP_TONES): freshly turned soil 0, plough
// .07, grey-brown fallow .14, stubble .21, wheat .32, barley .43, rapeseed .53, sunflower .61, rye .70, oats .79,
// clover .89, beans 1. Hue runs one way along it (browns, straw, gold, yellows, grey-green, greens), so a filtered
// limit between two holdings is a mix of their two tones. Rapeseed and sunflower are laid over it by landField
// (landYellowCrop, landYellowShare); underneath, the ramp runs straight from barley to rye.
vec3 landFieldTone(float t,float green){
  // Ripe wheat pales to a straw beige in late summer before the reaping.
  float ph=fract(uV2Season),ripe=groundSmooth(.42,.5,ph)*(1.-groundSmooth(.62,.68,ph));
  vec3 turned=vec3(.31,.25,.19),plough=vec3(.39,.32,.24),fallow=vec3(.44,.40,.31),stubble=vec3(.55,.49,.36);
  vec3 wheat=mix(vec3(.58,.51,.32),vec3(.60,.54,.37),ripe),barley=vec3(.53,.51,.32);
  vec3 rye=vec3(.45,.47,.34),oats=vec3(.40,.45,.25),clover=vec3(.33,.44,.22),beans=vec3(.31,.39,.21);
  vec3 c=t<.07?mix(turned,plough,t/.07):t<.14?mix(plough,fallow,(t-.07)/.07):t<.21?mix(fallow,stubble,(t-.14)/.07):t<.32?mix(stubble,wheat,(t-.21)/.11)
    :t<.43?mix(wheat,barley,(t-.32)/.11):t<.7?mix(barley,rye,(t-.43)/.27):t<.79?mix(rye,oats,(t-.7)/.09):t<.89?mix(oats,clover,(t-.79)/.1):mix(clover,beans,(t-.89)/.11);
  // Winter: autumn-sown cereals, rye and clover stay thin and green over the soil, the rest lies bare.
  vec3 winter=mix(vec3(.31,.25,.19),vec3(.25,.35,.19),groundSmooth(.3,.8,t));
  return mix(winter,c,green);
}
// The same ramp on dry farmland, as satellite images of it show: turned or fallow strips take the local soil (darker
// when ploughed), stubble and ripe cereals are paler than the dry grass around them, irrigated crops stay green.
// The wet season greens the sown cereals. Holdings keep their mosaic where one straw wash over every crop would hide them.
vec3 landFieldDryTone(float t,float green,vec3 bare){
  vec3 turned=mix(bare,vec3(.40,.31,.22),.55),fallow=mix(bare,vec3(.58,.50,.37),.45),stubble=vec3(.66,.59,.42),irrigated=mix(vec3(.33,.38,.20),vec3(.25,.37,.17),green);
  vec3 c=mix(mix(mix(turned,fallow,groundSmooth(.03,.17,t)),stubble,groundSmooth(.17,.3,t)),irrigated,groundSmooth(.7,.8,t));
  vec3 winter=mix(turned,vec3(.31,.37,.20),groundSmooth(.3,.8,t));
  return mix(winter,c,green);
}
// Share of rapeseed and sunflower around their ramp positions.
float landYellowShare(float t){return groundSmooth(.45,.52,t)*(1.-groundSmooth(.62,.69,t));}
// Rapeseed and sunflower over the year: green before their flowers, then in season a soft greenish yellow (rapeseed,
// late spring) or a dull olive yellow (sunflower, high summer), a small step from the pale stubble as aerial
// photographs show them, then ripening and stubble. t picks one or the other.
vec3 landYellowCrop(float t){
  float ph=fract(uV2Season);
  vec3 rape=mix(vec3(.28,.32,.20),vec3(.33,.42,.21),groundSmooth(.12,.22,ph));
  rape=mix(rape,vec3(.58,.57,.31),groundSmooth(.28,.32,ph));
  rape=mix(rape,vec3(.47,.46,.29),groundSmooth(.40,.45,ph));
  rape=mix(rape,vec3(.55,.49,.36),groundSmooth(.58,.63,ph));
  rape=mix(rape,vec3(.28,.32,.20),groundSmooth(.78,.88,ph));
  vec3 sun=mix(vec3(.35,.29,.21),vec3(.35,.42,.23),groundSmooth(.3,.4,ph));
  sun=mix(sun,vec3(.53,.50,.31),groundSmooth(.45,.5,ph));
  sun=mix(sun,vec3(.37,.33,.24),groundSmooth(.6,.66,ph));
  sun=mix(sun,vec3(.42,.36,.27),groundSmooth(.76,.84,ph));
  return mix(rape,sun,groundSmooth(.555,.585,t));
}
// Near a strip edge, close up: the point a little inside the fragment's own holding (land detail uv), along the
// gradient of the filtered edge distance (alpha), which points away from the nearest edge. Crop bytes and directions
// change on the texel grid, the distance follows the true polygon edge: read there, two holdings meet along the
// smooth zero line of the distance instead of a blurred staircase of texels. The gradient comes from three reads on
// a symmetric stencil half a texel wide; where it is too weak to trust (on the edge itself, at junctions, in strips
// narrower than two texels) and from afar, uv is kept. The distance is signed: at the outer limit of the fields it
// crosses zero linearly and the lookup holds right up to the edge. edge returns the distance (m) at uv, 0 outside.
vec2 landDetailInside(vec2 uv,float footprint,out float edge){
  float cell=uLandDetailRect.z/uLandDetailN,r=.5/uLandDetailN;
  float sd=landDetailDist(landDetailSample(uv,0.).a);
  edge=max(sd,0.);
  if(footprint<cell*2.&&abs(sd)<cell*1.2){
    float a0=landDetailSample(uv+vec2(0.,r),0.).a,a1=landDetailSample(uv+vec2(-.8660254,-.5)*r,0.).a,a2=landDetailSample(uv+vec2(.8660254,-.5)*r,0.).a;
    // Least squares on the stencil: g = 2/(3r) sum a_i d_i, here in metres of distance per metre.
    vec2 g=(a0*vec2(0.,1.)+a1*vec2(-.8660254,-.5)+a2*vec2(.8660254,-.5))*12.*2./(3.*cell*.5);
    float s=length(g);
    if(s>.5)uv+=g/s*(cell*1.2-sd)/uLandDetailRect.z;
  }
  return uv;
}
// Crop byte and edge distance of the holding of this fragment, written by landField for its snow share; -1 outside.
float landFieldCrop=-1.,landFieldEdge=6.;
// A holding: mosaic of crops, faint plough ridges on some turned holdings, row grain, grass balks. Every band fades
// before its period reaches two pixels. Each holding carries its own mottle (amplitude and pattern from its byte), so
// neighbouring fields never share one marbling, and nothing periodic spans a field beyond the rows close up.
vec3 landField(vec2 world,float footprint,float green,vec3 bare,float dry,out vec2 slope,out float rough){
  slope=vec2(0.);rough=.94;
  vec2 uv=(world-uLandDetailRect.xy)/uLandDetailRect.z;
  float cell=uLandDetailRect.z/uLandDetailN;
  float edge,lod=max(log2(max(footprint,.001)/cell),0.);
  landFieldCrop=-1.;
  vec4 d=landDetailSample(landDetailInside(uv,footprint,edge),lod);
  if(d.a<=0.)return mix(bare,vec3(.39,.36,.22),.5);
  landFieldCrop=d.r;landFieldEdge=edge;
  vec2 c2=d.gb*2.-1.;float a=.5*atan(c2.y,c2.x);
  vec2 along=vec2(cos(a),sin(a)),across=vec2(-along.y,along.x);
  float u=dot(world,across),v=dot(world,along);
  uint salt=uMaterialSeed+977u;
  // The holding's byte moves its mottle into its own slice of the noise, smoothly, so a filtered limit stays soft.
  float patchy=surfaceNoise(vec3(world/70.,d.r*23.),salt);
  float soil=surfaceNoise(vec3(world/23.,d.r*23.),salt+1u);
  float crop=clamp(d.r+patchy*.012,0.,1.);
  vec3 c=mix(landFieldTone(crop,green),landFieldDryTone(crop,green,bare),dry);
  c=mix(c,landYellowCrop(crop),landYellowShare(crop));
  // Mottle: marked on some holdings, absent on others.
  float mottle=groundSmooth(.25,.9,.5+.5*sin(d.r*157.+1.3));
  c*=1.+mottle*(.025*patchy+.02*soil);
  // Ploughland ridges: straight along the strip, faint, on part of the turned and fallow holdings only.
  float ridgeKeep=(1.-groundSmooth(2.4,5.,footprint))*(1.-groundSmooth(.16,.24,crop))*groundSmooth(.35,.75,.5+.5*sin(d.r*97.+.4));
  if(ridgeKeep>0.){
    float p=u*.6283185;
    c*=1.+.018*cos(p)*ridgeKeep;
    slope+=across*(-sin(p)*.04*ridgeKeep);
  }
  float rowKeep=1.-groundSmooth(.35,.95,footprint);
  if(rowKeep>0.){
    float wander=surfaceNoise(vec3(v/70.,u/240.,0.),salt+2u)*3.;
    float p=(u+wander*.2)*3.3069;
    float row=cos(p);
    // Rows break up where the crop thins; grain runs along them.
    float grain=surfaceNoise(vec3(u*2.4,v*.35,0.),salt+3u);
    c*=1.+rowKeep*(.06*row+.05*grain);
    slope+=across*(-sin(p)*.14*rowKeep);
  }
  float speckKeep=1.-groundSmooth(.25,.7,footprint);
  if(speckKeep>0.)c*=1.+speckKeep*.05*surfaceNoise(vec3(world*1.7,0.),salt+4u);
  // A limit is a change of crop, not a drawn outline. Along part of it (the holding's own 70 m mottle decides where)
  // a narrow, faint grass balk, read at full resolution and gone before it aliases.
  float keep=1.-groundSmooth(.7,2.6,footprint);
  if(keep>0.){
    float balk=keep*groundSmooth(-.15,.35,patchy)*(1.-groundSmooth(.12,.55,edge+.15*soil));
    vec3 grass=mix(vec3(.33,.31,.21),vec3(.32,.38,.22),green)*(1.+.08*patchy);
    c=mix(c,grass,balk*.45);
    rough=mix(.94,.86,balk);
  }
  // From afar a faint darker seam (ditch, headland) where the crops on either side differ (the holding's byte against
  // the wider mean around it), on part of the limit only; none between two holdings of one tone.
  float limit=(1.-groundSmooth(0.,max(footprint*.8,1.2),edge))*groundSmooth(.7,2.6,footprint)*(1.-groundSmooth(14.,40.,footprint));
  if(limit>0.){
    float contrast=groundSmooth(.04,.15,abs(landDetailSample(uv,lod+1.5).r-d.r));
    c*=1.-.1*limit*contrast*groundSmooth(-.3,.3,soil+.5*patchy);
  }
  return c;
}
// Grassland keeps the ground's hue and breathes with soil and exposure instead of filling a polygon.
vec3 landGrass(vec2 world,float footprint,float green,vec3 bare,bool grazed){
  uint salt=uMaterialSeed+1013u;
  float broad=surfaceNoise(vec3(world/120.,0.),salt),mid=surfaceNoise(vec3(world/34.,0.),salt+1u);
  vec3 lush=mix(vec3(.36,.38,.24),vec3(.30,.42,.21),green),rank=mix(vec3(.40,.37,.25),vec3(.40,.43,.24),green);
  // Two sward communities split along a ragged line, a few percent apart; from afar their even mix, with no blobs.
  float ragged=.12+.05*footprint;
  float community=(1.-groundSmooth(4.,14.,footprint))*(groundSmooth(-ragged,ragged,broad+.6*mid)-.5);
  vec3 c=mix(lush,rank,.5+community);
  if(grazed){c=mix(c,mix(vec3(.42,.39,.28),vec3(.42,.44,.27),green),.45);c*=1.+.03*community;}
  else{
    // Mown swathes in a hay meadow, only where they resolve.
    float keep=1.-groundSmooth(.8,2.2,footprint);
    if(keep>0.)c*=1.+keep*.03*cos(dot(world,vec2(.31,.95))*1.05+2.*broad);
  }
  return mix(bare,c,.62)*(1.+.035*community);
}
// Rough grazing and heath: bracken, gorse and bare patches that dissolve into the surrounding ground.
vec3 landHeath(vec2 world,float footprint,float green,vec3 bare){
  uint salt=uMaterialSeed+1039u;
  float broad=surfaceNoise(vec3(world/58.,0.),salt),mid=surfaceNoise(vec3(world/15.,0.),salt+1u),fine=surfaceNoise(vec3(world/4.6,0.),salt+2u);
  float t=clamp(.5+.8*broad+.5*mid+.3*fine*(1.-groundSmooth(1.,3.,footprint)),0.,1.);
  vec3 bracken=mix(vec3(.40,.33,.23),vec3(.34,.37,.21),green),gorse=mix(vec3(.28,.30,.20),vec3(.25,.32,.18),green);
  return mix(bare,mix(bracken,gorse,groundSmooth(.35,.75,t)),.5);
}
// Fen: reed and sedge mats with ragged edges, hummocks up close, open pools with a crisp shore and thin
// meandering channels (the zero line of the broad field, about a pixel wide until it fades). From afar the same
// share of water as the resolved pools.
vec3 landMarsh(vec2 world,float footprint,vec3 bare,out float rough,out float pool){
  uint salt=uMaterialSeed+1061u;
  float broad=surfaceNoise(vec3(world/41.,0.),salt),mid=surfaceNoise(vec3(world/13.,0.),salt+1u);
  float keep=1.-groundSmooth(.6,1.8,footprint),seen=1.-groundSmooth(5.,12.,footprint),ragged=clamp(.06*footprint,.04,.5);
  float tussock=keep>0.?surfaceNoise(vec3(world/2.1,0.),salt+2u)*keep:0.;
  float channel=broad-.3*mid,thread=exp2(-1100./max(footprint*footprint,1.)*channel*channel)*(1.-groundSmooth(2.5,6.,footprint));
  pool=mix(.33,max(groundSmooth(.47-ragged,.47+ragged,broad+.45*mid+.1*tussock),.85*thread),seen);
  float sedge=mix(.5,groundSmooth(-ragged,ragged,mid-.4*broad+.3*tussock),seen);
  vec3 rush=mix(vec3(.30,.34,.20),vec3(.38,.36,.22),sedge)*(1.+.09*(groundSmooth(.1,.4,tussock)-.4*keep));
  vec3 water=vec3(.24,.29,.26);
  rough=mix(.78,.16,pool);
  return mix(mix(bare,rush,.6),water,pool*.55);
}
// Ground contains the pale alleys only; all trees use the forest crown/instance path.
vec3 landOrchard(vec2 world,float footprint,float green,vec3 bare,out float rough){
  rough=.87;
  return mix(bare,mix(vec3(.45,.43,.27),vec3(.42,.50,.27),green),.85);
}
// Town ground shares the fields' seasonal earth and lighting. Worn paths separate pale yard patches;
// the natural floor contributes its lightness and its soil hue, so wetland/tropical greens cannot tint the packed earth.
vec3 landTown(vec2 world,float footprint,float green,vec3 bare){
  uint salt=uMaterialSeed+1103u;
  float mid=surfaceNoise(vec3(world/19.,0.),salt),fine=surfaceNoise(vec3(world/5.3,0.),salt+1u)*(1.-groundSmooth(1.,3.,footprint));
  vec3 luminance=vec3(.2126,.7152,.0722);
  vec3 earth=mix(landCropTone(.3,green),vec3(.56,.50,.38),.25);
  // Packed earth takes part of the hue of the local soil (sand, laterite, grey loam) with its green excess removed,
  // at its own lightness: the town sits in the colours of its country and the sward still cannot tint it.
  vec3 soil=vec3(bare.r,min(bare.g,mix(bare.r,bare.b,.35)),bare.b);
  earth=mix(earth,soil*(dot(earth,luminance)/max(dot(soil,luminance),.001)),.4)*(1.+.08*fine);
  // Yard grass follows the season: straw in winter, a dull green in summer.
  vec3 grass=mix(vec3(.45,.42,.30),vec3(.41,.44,.28),green);
  vec3 yard=mix(earth,grass,.6*groundSmooth(-.1,.5,mid+.3*fine));
  return yard*mix(1.,dot(bare,luminance)/max(dot(yard,luminance),.001),.24);
}
// Garden beds in the tones of the fields beside them: dug soil, soft young greens, beans and dark leaves, leeks and
// cabbages, oats-like greens, old straw, a pale ripening crop.
const vec3 GARDEN_BEDS[8]=vec3[8](vec3(.34,.28,.21),vec3(.37,.42,.25),vec3(.28,.36,.21),vec3(.32,.37,.26),vec3(.40,.45,.25),vec3(.50,.45,.33),vec3(.48,.46,.31),vec3(.27,.36,.20));
// Medieval kitchen and market gardens: each plot is its own composition, framed by its own direction and identity
// (a hash of the land detail's red, green and blue bytes: crop tone and direction of its longest side; alpha: distance
// to its limit), so neighbouring plots never share a lattice. Bands of blocks cut at their own places, a main path and
// cross paths of trodden earth, beds of several widths and orientations, weedy and freshly dug blocks, a hut with its
// dung heap, a small tree, a hedge or a wattle fence at the limit. Muted tones; every element fades into the plot's
// mean tone before it aliases.
vec3 landGarden(vec2 world,float footprint,float green,vec3 bare){
  vec3 mean=mix(vec3(.39,.35,.25),vec3(.33,.40,.24),green);
  float keep=1.-groundSmooth(.9,2.6,footprint);
  if(keep<=0.)return mix(bare,mean,.75);
  // The plot's frame is read inside its own plot (landDetailInside), so two plots meet along their true limit.
  vec4 d=orchardDetail(world);float edge=6.;
  if(uHasLandDetail==1){vec2 luv=(world-uLandDetailRect.xy)/uLandDetailRect.z;d=orchardDetail(world+(landDetailInside(luv,footprint,edge)-luv)*uLandDetailRect.z);}
  int id=int(d.r*255.+.5)+int(d.g*255.+.5)*256+int(d.b*255.+.5)*65536;
  vec2 c2=d.gb*2.-1.;float a=.5*atan(c2.y,c2.x);
  vec2 along=vec2(cos(a),sin(a)),across=vec2(-along.y,along.x);
  uint h=groundHash(ivec3(id,17,887),uMaterialSeed);
  vec4 r=vec4(uvec4(h,h>>8,h>>16,h>>24)&255u)/255.;
  float fw=max(footprint,.04);
  float n=surfaceNoise(vec3(world/2.7,0.),uMaterialSeed+1123u);
  // The plot's own frame: origin, band width, block length.
  vec2 q=vec2(dot(world,along),dot(world,across))+r.xy*vec2(53.,37.);
  float bandW=4.5+5.5*r.z,band=floor(q.y/bandW),fy=q.y-band*bandW;
  uint hb=groundHash(ivec3(int(band),id,889),uMaterialSeed);
  // Each band of blocks is cut at its own places: bricks, not a lattice.
  float len=(6.+8.*r.w)*(.65+.7*float(hb&255u)/255.),x=q.x+float((hb>>8)&255u)/255.*len;
  float block=floor(x/len),fx=x-block*len;
  uint hk=groundHash(ivec3(int(block),int(band),id+891),uMaterialSeed);
  float kind=float(hk&255u)/255.,k2=float((hk>>8)&255u)/255.,k3=float((hk>>16)&255u)/255.;
  // Beds: the block's crop, softly varied bed by bed, lengthwise or crosswise, with dark furrows; rows close up.
  float bedKeep=1.-groundSmooth(.3,.75,footprint);
  float w=k2<.6?fy:fx,width=1.1+.8*k3,bed=floor(w/width),fb=w-bed*width;
  uint hbed=groundHash(ivec3(int(bed),int(block)*64+int(band),id+893),uMaterialSeed);
  int ci=int(hk>>24)&7,bi=int(hbed&7u);
  vec3 soil=mix(bare,GARDEN_BEDS[0],.6);
  vec3 crop=mix(GARDEN_BEDS[ci],GARDEN_BEDS[bi],.4*bedKeep);
  // Out of season most beds lie dug; leeks and cabbages stay.
  float live=mix(ci==2||ci==3?.7:.25,1.,green);
  vec3 g=mix(soil,crop,live);
  float furrow=(1.-groundSmooth(.15-fw*.5,.15+fw*.5,min(fb,width-fb)))*min(1.,.3/fw)*bedKeep;
  g=mix(g,soil*.88,.6*furrow);
  float rowKeep=1.-groundSmooth(.06,.16,footprint);
  if(rowKeep>0.)g*=1.+rowKeep*.06*cos(w*17.95);
  vec3 grass=mix(vec3(.40,.40,.26),vec3(.34,.40,.23),green);
  if(kind<.66)g*=1.;
  else if(kind<.78)g=grass*(1.+.1*n);
  else if(kind<.9)g=mix(bare,vec3(.31,.25,.19),.6)*(1.+.1*n*bedKeep);
  else if(kind<.94){
    // A hut, thatched or timber-dark, with its dung heap beside it, in a corner of the block.
    float shed=(1.-groundSmooth(2.6,2.6+fw,fx))*(1.-groundSmooth(2.2,2.2+fw,fy))*groundSmooth(.3,.3+fw,fx)*groundSmooth(.3,.3+fw,fy);
    float heap=groundSmooth(2.9,2.9+fw,fx)*(1.-groundSmooth(4.1,4.1+fw,fx))*(1.-groundSmooth(1.4,1.4+fw,fy))*groundSmooth(.3,.3+fw,fy);
    g=mix(g,(r.z<.5?vec3(.27,.23,.19):vec3(.40,.34,.25))*(1.+.08*n),shed);
    g=mix(g,vec3(.27,.21,.16)*(1.+.15*n),heap);
  }else if(kind<.97){
    // A small tree over grass.
    float radius=min(1.4+.8*k3,min(len,bandW)*.45);
    float crown=1.-groundSmooth(radius-.3-fw*.5,radius+fw*.5,length(vec2(fx-len*.5,fy-bandW*.5))+.25*n);
    g=mix(grass,vec3(.21,.28,.16)*(1.+.15*n),crown);
  }else g=mix(GARDEN_BEDS[5],soil,.25);
  // Paths of trodden earth: lengthwise between bands, one in three the plot's main path (wider), crosswise between blocks.
  float dy=min(fy,bandW-fy),line=fy<bandW*.5?band:band+1.;
  float pathW=mod(line+floor(r.x*3.),3.)<.5?1.:.5;
  float lane=(1.-groundSmooth(pathW*.5-fw*.5,pathW*.5+fw*.5,dy+.06*n))*min(1.,pathW/fw);
  float crosswise=(1.-groundSmooth(.2-fw*.5,.2+fw*.5,min(fx,len-fx)+.05*n))*min(1.,.4/fw);
  vec3 trodden=mix(bare,vec3(.43,.38,.29),.6);
  g=mix(g,trodden,.85*max(lane,crosswise));
  // The limit: a hedge, or a wattle fence with a trodden headland inside it.
  if(r.x<.55){
    float hedge=1.-groundSmooth(.9-fw*.5,.9+fw*.5,edge+.2*n);
    g=mix(g,vec3(.22,.28,.16)*(1.+.12*n),hedge);
  }else{
    float headland=(1.-groundSmooth(.9-fw*.5,.9+fw*.5,edge))*min(1.,.6/fw);
    float wattle=(1.-groundSmooth(.25-fw*.5,.25+fw*.5,edge+.05*n))*min(1.,.2/fw);
    g=mix(mix(g,trodden,.7*headland),vec3(.31,.26,.19),wattle);
  }
  g*=1.+.04*n;
  return mix(bare,mix(mean,g,keep),.75);
}
vec4 occupationMaterial(int cls,vec2 world,float footprint,vec3 bare,vec3 micro,float dry,float green,out float pool){
  vec3 target=bare;float rough=.9;pool=0.;
  if(cls==1)target=mix(mix(vec3(.39,.32,.19),vec3(.38,.43,.20),green),bare,.34);
  else if(cls==2){target=landGrass(world,footprint,green,bare,false);rough=.84;}
  else if(cls==3){target=landGrass(world,footprint,green,bare,true);rough=.87;}
  else if(cls==4)target=landOrchard(world,footprint,green,bare,rough);
  else if(cls==5){target=landGarden(world,footprint,green,bare);rough=.86;}
  else if(cls==10)target=landMarsh(world,footprint,bare,rough,pool);
  else if(cls==6)target=landHeath(world,footprint,green,bare);
  else if(cls==7)target=landTown(world,footprint,green,bare);
  else {target=mix(bare,vec3(.45,.40,.31),.55);rough=.91;}
  // Dry climates bleach the grass and the plots toward straw; fields take their dry crop ramp instead (landField).
  if(cls==1)target=mix(target,landFieldDryTone(.32,green,bare),dry);
  else if(cls<=5)target=mix(target,mix(bare,vec3(.55,.47,.30),.55),.9*dry);
  // Keep the existing microdetail, slope normal, snow and sun response.
  return vec4(clamp(target*micro,0.,1.),rough);
}
uniform int uPaperMap;
// Class shares of this fragment, written by applyGroundOccupation from its bilinear class weights (commons through the
// same wandered lookup as the satellite heath): a nearest class gate here drew the commons and the tended/wild shade
// limit as whole occupation texels, a staircase the satellite render does not have.
float paperCommonsShare=0.,paperTendedShare=0.;
// The ink and wash map: the physical materials of the satellite render, before light, repainted on paper tones.
void applyPaperMap(inout GroundMaterial m,vec2 world,float footprint){
  if(uPaperMap==0)return;
  vec3 c=groundToDisplay(m.albedo);
  float l=dot(c,vec3(.30,.59,.11));
  // Woods are dark and green: plough and rock stay on the paper side.
  float wood=(1.-groundSmooth(.19,.31,l))*(1.-groundSmooth(.0,.07,c.r-c.g));
  vec3 open=mix(vec3(.60,.55,.38),vec3(.80,.74,.57),groundSmooth(.25,.6,l));
  open*=mix(vec3(1.),clamp(c/max(l,.05),vec3(.75),vec3(1.25)),.25);
  vec3 forest=mix(vec3(.16,.18,.05),vec3(.31,.33,.12),groundSmooth(.06,.30,l));
  // Share of woods around this point, from the blurred occupation: a wash that crosses the edge in both directions,
  // so neither clearings nor the limit of the woods on a slope read as a cut-out.
  vec2 uv=(world-uOccupationRect.xy)/uOccupationRect.z;
  float share=uHasOccupation==1?groundSmooth(.40,.74,textureLod(uOccupation,uv,5.).g):0.;
  float near=uHasOccupation==1?groundSmooth(.40,.74,textureLod(uOccupation,uv,3.5).g):0.;
  float shade=mix(share,near,.5)*(1.-.85*paperTendedShare);
  // Heath belongs with the woods on the slopes: a soft middle tone, not a hole in them.
  open=mix(open,vec3(.47,.45,.27),.6*paperCommonsShare);
  open=mix(open,vec3(.33,.34,.16),shade*.9);
  forest=mix(mix(forest,vec3(.40,.39,.20),.75),forest,groundSmooth(.15,.9,share));
  vec3 p=mix(open,forest,wood);
  // Paper fibre, fixed to the sheet scale.
  p*=1.+.022*surfaceNoise(vec3(world/max(footprint*2.3,.4),0.),uMaterialSeed+1151u);
  m.albedo=groundToLinear(p);
}
// Sea and lakes of the map: pale washed water with a darker line along the shore.
vec3 paperWater(float kind,float shore){
  vec3 edge=vec3(.37,.48,.49),sea=vec3(.74,.80,.78);
  if(kind>1.5)return mix(edge,sea,.25);
  return mix(sea,edge,.8*shore);
}
void applyGroundOccupation(inout GroundMaterial m,vec2 world,float footprint){
  paperCommonsShare=0.;paperTendedShare=0.;v2OrchardShare=1.;landFieldCrop=-1.;
  if(uRenderV2!=1||uHasOccupation==0)return;
  vec3 o=groundOccupation(world);
  float cell=uOccupationRect.z/uOccupationN;
  float humid=uMaterialClimate.y/max(20.*uMaterialClimate.x+280.,120.);
  float dry=(1.-groundSmooth(.8,2.,humid))*(1.-clamp(v2ZoneWet,0.,1.));
  float phase=clamp(uV2Season,0.,1.),green=.5+.5*sin(phase*6.2831853-1.5707963);
  vec3 micro=clamp(surfaceMicroTone,vec3(.35),vec3(1.65)),bare=renderGuideOpen/micro;
  vec2 uv=(world-uOccupationRect.xy)/uOccupationRect.z;
  vec2 grid=uv*uOccupationN-.5,f=fract(grid);ivec2 base=ivec2(floor(grid));
  ivec2 top=ivec2(int(uOccupationN)-1);
  // A nearest class gate cut the filtered signed edge back to whole texels: blend categorical responses, not IDs.
  // The loops only sum class weights. Each material is then evaluated once: inlined in the loops, they multiplied
  // the shader eightfold and D3D compilers took minutes on the 3D ground.
  float wField=0.,wOrchard=0.,wGarden=0.,wTown=0.,wLane=0.,wBuilt=0.,hardShare=0.;
  for(int y=0;y<2;y++)for(int x=0;x<2;x++){
    int cls=int(texelFetch(uOccupation,clamp(base+ivec2(x,y),ivec2(0),top),0).b*255.+.5);
    float weight=(x==0?1.-f.x:f.x)*(y==0?1.-f.y:f.y);
    // Class 11 clearings are wild ground: the lookup below gives them grass.
    if(cls==8||cls<1||cls>11){hardShare+=weight;if(cls==8){paperTendedShare+=weight;wBuilt+=weight;}}
    else if(cls==1)wField+=weight;
    else if(cls==4)wOrchard+=weight;
    else if(cls==5)wGarden+=weight;
    else if(cls==7)wTown+=weight;
    else if(cls==9)wLane+=weight;
  }
  // Close up, the fields, orchards and gardens of the land detail meet the other land along their true polygon: its
  // signed edge distance gives their joint share instead of the bilinear weights of the coarser class raster, which
  // drew the limit as rounded texel steps. Only where the class neighbourhood holds no town, lane or building ground,
  // which the detail does not know; between two detailed classes the class weights stay.
  float detailed=wField+wOrchard+wGarden;
  if(uHasLandDetail==1&&detailed>0.&&detailed<1.&&wTown+wLane+wBuilt<.001){
    float dcell=uLandDetailRect.z/uLandDetailN,near=1.-groundSmooth(dcell,dcell*2.,footprint);
    if(near>0.){
      float sd=landDetailDist(landDetailSample((world-uLandDetailRect.xy)/uLandDetailRect.z,0.).a),w=.5*max(footprint,.25);
      float share=mix(detailed,groundSmooth(-w,w,sd),near),rest=1.-detailed;
      hardShare*=rest>.001?(1.-share)/rest:0.;
      float k=share/detailed;wField*=k;wOrchard*=k;wGarden*=k;
    }
  }
  // Unresolved orchard crowns end where the orchard share falls to a half, as the class itself does, with no step.
  v2OrchardShare=clamp(2.*wOrchard-1.,0.,1.);
  float tendedShare=wField+wOrchard+wGarden+wTown+wLane;
  paperTendedShare+=tendedShare;
  vec4 tended=vec4(0.);float fieldShare=0.;vec2 fieldSlope=vec2(0.);
  if(wField>0.&&uHasLandDetail==1){float rough;vec3 c=landField(world,footprint,green,bare,dry,fieldSlope,rough);tended+=wField*vec4(clamp(c*micro,0.,1.),rough);fieldShare=wField;}
  // Wild classes meet along ragged lines: only their lookup wanders.
  float wildShare=1.-tendedShare-hardShare;
  float wMeadow=0.,wPasture=0.,wHeath=0.,wMarsh=0.;
  if(wildShare>.001){
    uint salt=uMaterialSeed+1091u;
    vec2 wander=vec2(surfaceNoise(vec3(world/43.,0.),salt),surfaceNoise(vec3(world/43.,0.),salt+1u))*16.
      +vec2(surfaceNoise(vec3(world/13.,0.),salt+2u),surfaceNoise(vec3(world/13.,0.),salt+3u))*6.;
    vec2 wgrid=(uv+wander/uOccupationRect.z)*uOccupationN-.5,wf=fract(wgrid);ivec2 wbase=ivec2(floor(wgrid));
    for(int y=0;y<2;y++)for(int x=0;x<2;x++){
      int cls=int(texelFetch(uOccupation,clamp(wbase+ivec2(x,y),ivec2(0),top),0).b*255.+.5);
      float weight=(x==0?1.-wf.x:wf.x)*(y==0?1.-wf.y:wf.y);
      if(cls==2)wMeadow+=weight;else if(cls==3)wPasture+=weight;else if(cls==6)wHeath+=weight;else if(cls==10)wMarsh+=weight;
    }
    // The lookup wandered onto a plot or a road: this ground is still grass.
    wMeadow+=max(0.,1.-wMeadow-wPasture-wHeath-wMarsh);
    paperCommonsShare=wHeath*wildShare;
  }
  // Every class material from one loop, in the order of the former separate calls (tended field, orchard, garden,
  // town, lane; wild meadow, pasture, heath, marsh): the shader compilers inline each call, and nine inlined
  // occupationMaterial calls were about a third of the satellite ground shader, tens of seconds of D3D compilation.
  vec4 wild=vec4(0.);float marsh=0.,poolShare=0.;
  for(int i=0;i<9;i++){
    int cls;float w,d;
    if(i==0){cls=1;w=uHasLandDetail==1?0.:wField;d=dry;}
    else if(i==1){cls=4;w=wOrchard;d=dry*.5;}
    else if(i==2){cls=5;w=wGarden;d=dry*.5;}
    else if(i==3){cls=7;w=wTown;d=0.;}
    else if(i==4){cls=9;w=wLane;d=0.;}
    else if(i==5){cls=2;w=wMeadow;d=dry;}
    else if(i==6){cls=3;w=wPasture;d=dry;}
    else if(i==7){cls=6;w=wHeath;d=0.;}
    else{cls=10;w=wMarsh;d=0.;}
    if(w<=0.)continue;
    float pool;vec4 c=w*occupationMaterial(cls,world,footprint,bare,micro,d,green,pool);
    if(i<5)tended+=c;
    else{wild+=c;if(cls==10){poolShare=w*pool*wildShare;marsh=w*wildShare;}}
  }
  float covered=tendedShare+wildShare;
  vec4 target=tended+wild*wildShare;
  if(covered<=0.)return;
  target/=covered;
  // Wild ground fades into its surroundings; ploughed land keeps a firm edge.
  float edgeWidth=fieldShare>.5*covered?max(footprint,cell*.6):cell*3.;
  float width=min(edgeWidth*(1.+1.5*dry),cell*6.);
  // Dry wild ground lets the bare earth through; tended land (fields, plots, town) keeps its full cover.
  // Partial snow follows the land: each holding takes its own share of the local (relief-driven) cover, from its crop
  // byte as landField read it (inside its own holding close up, so the share changes along the true limit); holding
  // limits hold a little less; thin snow lets the strips show through. Full cover and bare ground are unchanged.
  // The share is a smooth function of the byte: a filtered limit or a far view blends it instead of sparkling.
  float snow=v2GroundSnow;
  if(fieldShare>0.&&landFieldCrop>=0.&&snow>0.&&snow<1.){
    float h=.5+.5*sin(landFieldCrop*211.+.7);
    float limit=1.-groundSmooth(0.,max(footprint*.8,1.5),landFieldEdge);
    float own=clamp(snow+(h-.5)*2.8*snow*(1.-snow),0.,1.)*(1.-.3*limit);
    snow=mix(snow,own,fieldShare/covered);
  }
  // Town ground is trodden: about a third of its packed earth shows through a full snow cover.
  float a=groundSmooth(0.,width,min(o.x,-o.y))*(1.-.3*dry*wildShare/covered)*(1.-snow*(1.-.35*wTown/max(covered,.001)))*covered;
  // A holding whiter than the local mean takes its extra snow over its own cover.
  float extra=max(snow-v2GroundSnow,0.)*covered;
  if(a<=0.&&extra<=0.)return;
  renderGuideOpen=mix(renderGuideOpen,target.rgb,a);
  m.albedo=mix(m.albedo,groundToLinear(target.rgb)*v2FloorModulation,a);
  m.roughness=mix(m.roughness,target.a,a);
  m.normal=normalize(mix(m.normal,v2MacroNormal,a*max(marsh,poolShare)*.6));
  if(fieldShare>0.)m.normal=normalize(m.normal+vec3(-fieldSlope.x,0.,-fieldSlope.y)*a*fieldShare);
  if(extra>0.){m.albedo=mix(m.albedo,groundToLinear(vec3(.88,.91,.91))*v2FloorModulation,extra);renderGuideOpen=mix(renderGuideOpen,vec3(.88,.91,.91),extra);}
}
`;
