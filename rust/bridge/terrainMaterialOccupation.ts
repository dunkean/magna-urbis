/** Physical land cover filters material responses, never numeric class IDs.
 * Reuses the retained occupation texture without changing forest sampling.
 * Holdings come from the land detail raster (web/src/ui/landDetail.ts): crop, row direction, edge distance. */

/** The one sampler a backend without a spare texture unit leaves out: fields then keep their plain material. */
const LAND_DETAIL_SAMPLER = `uniform sampler2D uLandDetail;
vec4 landDetailSample(vec2 uv,float lod){return textureLod(uLandDetail,uv,lod);}`;
const LAND_DETAIL_ABSENT = `vec4 landDetailSample(vec2 uv,float lod){return vec4(0.);}`;
/** For GL contexts limited to 16 texture units (ANGLE on D3D11): every unit is already taken. */
export const withoutLandDetail = (shader: string): string => shader.replace(LAND_DETAIL_SAMPLER, LAND_DETAIL_ABSENT);

export const GROUND_OCCUPATION_GLSL = `
uniform int uHasLandDetail;uniform vec3 uLandDetailRect;uniform float uLandDetailN;
${LAND_DETAIL_SAMPLER}
// Crop ramp of the raster's red channel: neighbours are plausible mixes, so filtered strips stay credible.
vec3 landCropTone(float t,float green){
  vec3 plough=vec3(.36,.29,.21),stubble=vec3(.55,.49,.36),wheat=vec3(.58,.51,.32),barley=vec3(.53,.51,.32),oats=vec3(.40,.45,.25),beans=vec3(.27,.36,.20);
  vec3 c=t<.18?mix(plough,stubble,t/.18):t<.36?mix(stubble,wheat,(t-.18)/.18):t<.52?mix(wheat,barley,(t-.36)/.16):t<.72?mix(barley,oats,(t-.52)/.2):mix(oats,beans,(t-.72)/.28);
  // Winter: autumn-sown cereals stay thin and green over the soil, the rest lies bare.
  vec3 winter=mix(vec3(.34,.28,.21),vec3(.31,.35,.22),groundSmooth(.3,.8,t));
  return mix(winter,c,green);
}
// A holding: mosaic of crops, ridge and furrow, row grain, grass balks. Every band fades before its period reaches two pixels.
vec3 landField(vec2 world,float footprint,float green,vec3 bare,float dry,out vec2 slope,out float rough){
  slope=vec2(0.);rough=.94;
  vec2 uv=(world-uLandDetailRect.xy)/uLandDetailRect.z;
  float cell=uLandDetailRect.z/uLandDetailN;
  vec4 d=landDetailSample(uv,max(log2(max(footprint,.001)/cell),0.));
  if(d.a<=0.)return mix(bare,vec3(.39,.36,.22),.5);
  vec2 c2=d.gb*2.-1.;float a=.5*atan(c2.y,c2.x);
  vec2 along=vec2(cos(a),sin(a)),across=vec2(-along.y,along.x);
  float u=dot(world,across),v=dot(world,along);
  uint salt=uMaterialSeed+977u;
  float patchy=surfaceNoise(vec3(world/70.,0.),salt);
  float soil=surfaceNoise(vec3(world/23.,0.),salt+1u);
  vec3 c=landCropTone(clamp(d.r+patchy*.012,0.,1.),green);
  c*=1.+.035*patchy+.03*soil;
  // Ploughland ridges: broad strips of medieval ploughing, a few metres wide, slightly wandering.
  float wander=surfaceNoise(vec3(v/70.,u/240.,0.),salt+2u)*3.;
  float ridgeKeep=1.-groundSmooth(2.4,5.,footprint);
  if(ridgeKeep>0.){
    float p=(u+wander)*.6283185;
    c*=1.+.035*cos(p)*ridgeKeep;
    slope+=across*(-sin(p)*.08*ridgeKeep);
  }
  float rowKeep=1.-groundSmooth(.35,.95,footprint);
  if(rowKeep>0.){
    float p=(u+wander*.2)*3.3069;
    float row=cos(p);
    // Rows break up where the crop thins; grain runs along them.
    float grain=surfaceNoise(vec3(u*2.4,v*.35,0.),salt+3u);
    c*=1.+rowKeep*(.06*row+.05*grain);
    slope+=across*(-sin(p)*.14*rowKeep);
  }
  float speckKeep=1.-groundSmooth(.25,.7,footprint);
  if(speckKeep>0.)c*=1.+speckKeep*.05*surfaceNoise(vec3(world*1.7,0.),salt+4u);
  // Balks between strips: narrow grass lines, read at full resolution, gone before they alias.
  float keep=1.-groundSmooth(.7,2.6,footprint);
  if(keep>0.){
    float edge=landDetailSample(uv,0.).a*6.;
    float balk=keep*(1.-groundSmooth(.25,1.05,edge+.25*soil));
    vec3 grass=mix(vec3(.33,.31,.21),vec3(.32,.38,.22),green)*(1.+.08*patchy);
    c=mix(c,grass,balk*.7);
    rough=mix(.94,.86,balk);
  }
  c=mix(c,mix(bare,vec3(.57,.49,.31),.55),.9*dry);
  return c;
}
// Grassland keeps the ground's hue and breathes with soil and exposure instead of filling a polygon.
vec3 landGrass(vec2 world,float footprint,float green,vec3 bare,bool grazed){
  uint salt=uMaterialSeed+1013u;
  float broad=surfaceNoise(vec3(world/120.,0.),salt),mid=surfaceNoise(vec3(world/34.,0.),salt+1u);
  vec3 lush=mix(vec3(.36,.38,.24),vec3(.30,.42,.21),green),rank=mix(vec3(.40,.37,.25),vec3(.40,.43,.24),green);
  vec3 c=mix(lush,rank,clamp(.5+.55*broad+.35*mid,0.,1.));
  if(grazed){c=mix(c,mix(vec3(.42,.39,.28),vec3(.42,.44,.27),green),.45);c*=1.+.05*mid;}
  else{
    // Mown swathes in a hay meadow, only where they resolve.
    float keep=1.-groundSmooth(.8,2.2,footprint);
    if(keep>0.)c*=1.+keep*.03*cos(dot(world,vec2(.31,.95))*1.05+2.*broad);
  }
  return mix(bare,c,.62)*(1.+.05*mid);
}
// Rough grazing and heath: bracken, gorse and bare patches that dissolve into the surrounding ground.
vec3 landHeath(vec2 world,float footprint,float green,vec3 bare){
  uint salt=uMaterialSeed+1039u;
  float broad=surfaceNoise(vec3(world/58.,0.),salt),mid=surfaceNoise(vec3(world/15.,0.),salt+1u),fine=surfaceNoise(vec3(world/4.6,0.),salt+2u);
  float t=clamp(.5+.8*broad+.5*mid+.3*fine*(1.-groundSmooth(1.,3.,footprint)),0.,1.);
  vec3 bracken=mix(vec3(.40,.33,.23),vec3(.34,.37,.21),green),gorse=mix(vec3(.28,.30,.20),vec3(.25,.32,.18),green);
  return mix(bare,mix(bracken,gorse,groundSmooth(.35,.75,t)),.5);
}
// Fen: rushes in tussocks around open pools.
vec3 landMarsh(vec2 world,float footprint,vec3 bare,out float rough,out float pool){
  uint salt=uMaterialSeed+1061u;
  float broad=surfaceNoise(vec3(world/41.,0.),salt),mid=surfaceNoise(vec3(world/13.,0.),salt+1u);
  float keep=1.-groundSmooth(.6,1.8,footprint);
  float tussock=keep>0.?surfaceNoise(vec3(world/2.1,0.),salt+2u)*keep:0.;
  pool=groundSmooth(.32,.62,broad+.45*mid);
  vec3 rush=mix(vec3(.30,.34,.20),vec3(.38,.36,.22),clamp(.5+mid,0.,1.))*(1.+.05*tussock);
  vec3 water=vec3(.24,.29,.26);
  rough=mix(.78,.16,pool);
  return mix(mix(bare,rush,.6),water,pool*.55);
}
// Rows of crowned trees on their alley grass, along the plot's own direction.
vec3 landOrchard(vec2 world,float footprint,float green,vec3 bare,out float rough){
  rough=.87;
  vec2 uv=(world-uLandDetailRect.xy)/uLandDetailRect.z;
  vec4 d=landDetailSample(uv,max(log2(max(footprint,.001)/(uLandDetailRect.z/uLandDetailN)),0.));
  vec3 alley=mix(vec3(.36,.37,.24),vec3(.33,.41,.23),green);
  vec3 crown=mix(vec3(.31,.27,.19),vec3(.22,.31,.16),green);
  vec3 mean=mix(alley,crown,.32);
  float keep=1.-groundSmooth(1.2,3.,footprint);
  if(keep<=0.||d.a<=0.)return mix(bare,mean,.7);
  vec2 c2=d.gb*2.-1.;float a=.5*atan(c2.y,c2.x);
  vec2 along=vec2(cos(a),sin(a)),across=vec2(-along.y,along.x);
  vec2 q=vec2(dot(world,along),dot(world,across))/8.;
  vec2 f=fract(q)-.5;
  uint h=groundHash(ivec3(ivec2(floor(q)),877),uMaterialSeed);
  vec2 jitter=(vec2(float(h&255u),float((h>>8u)&255u))/255.-.5)*.22;
  float radius=.26+.08*float((h>>16u)&255u)/255.;
  vec2 light=uGroundCover.xz;light=dot(light,light)>.0001?normalize(light):vec2(1.,0.);
  vec2 sun=vec2(dot(light,along),dot(light,across));
  float r=length(f-jitter);
  float tree=1.-groundSmooth(radius*.8,radius*1.08,r);
  float shadow=(1.-groundSmooth(radius*.7,radius*1.2,length(f-jitter+sun*.2)))*(1.-tree);
  float lit=clamp(.5-dot(f-jitter,sun)/radius*.75,0.,1.);
  vec3 c=mix(alley*(1.-.42*shadow),crown*(.72+.62*lit),tree);
  return mix(bare,mix(mean,c,keep),.85);
}
// Town ground: trodden earth around the houses, grass where nobody walks.
vec3 landTown(vec2 world,float footprint,float green,vec3 bare){
  uint salt=uMaterialSeed+1103u;
  float mid=surfaceNoise(vec3(world/19.,0.),salt),fine=surfaceNoise(vec3(world/5.3,0.),salt+1u);
  vec3 earth=vec3(.46,.40,.31)*(1.+.08*fine),grass=mix(vec3(.38,.36,.25),vec3(.35,.39,.24),green);
  return mix(bare,mix(earth,grass,groundSmooth(-.25,.3,mid+.3*fine)),.72);
}
// Kitchen plots: small beds of different greens and bare soil, with paths.
vec3 landGarden(vec2 world,float footprint,float green,vec3 bare){
  vec3 mean=mix(vec3(.39,.35,.25),vec3(.33,.40,.24),green);
  float keep=1.-groundSmooth(.7,2.,footprint);
  if(keep<=0.)return mix(bare,mean,.7);
  vec2 q=vec2(dot(world,vec2(.894427,.447214))/5.,dot(world,vec2(-.447214,.894427))/3.2);
  uint h=groundHash(ivec3(ivec2(floor(q)),883),uMaterialSeed);
  float t=float(h&255u)/255.;
  vec3 bed=t<.3?vec3(.33,.27,.20):t<.65?vec3(.27,.38,.20):vec3(.36,.44,.25);
  vec2 f=abs(fract(q)-.5);
  float path=groundSmooth(.40,.47,max(f.x,f.y));
  return mix(bare,mix(mean,mix(bed,vec3(.46,.42,.33),path),keep),.8);
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
  if(cls<=5)target=mix(target,mix(bare,vec3(.55,.47,.30),.55),.9*dry);
  // Keep the existing microdetail, slope normal, snow and sun response.
  return vec4(clamp(target*micro,0.,1.),rough);
}
uniform int uPaperMap;
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
  int cls=int(groundOccupation(world).z);
  bool tended=cls==1||cls==4||cls==5||cls==7||cls==8||cls==9;
  float shade=mix(share,near,.5)*(tended?.15:1.);
  // Heath belongs with the woods on the slopes: a soft middle tone, not a hole in them.
  if(cls==6)open=mix(open,vec3(.47,.45,.27),.6);
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
  float wField=0.,wOrchard=0.,wGarden=0.,wTown=0.,wLane=0.,hardShare=0.;
  for(int y=0;y<2;y++)for(int x=0;x<2;x++){
    int cls=int(texelFetch(uOccupation,clamp(base+ivec2(x,y),ivec2(0),top),0).b*255.+.5);
    float weight=(x==0?1.-f.x:f.x)*(y==0?1.-f.y:f.y);
    if(cls==8||cls<1||cls>10)hardShare+=weight;
    else if(cls==1)wField+=weight;
    else if(cls==4)wOrchard+=weight;
    else if(cls==5)wGarden+=weight;
    else if(cls==7)wTown+=weight;
    else if(cls==9)wLane+=weight;
  }
  float tendedShare=wField+wOrchard+wGarden+wTown+wLane;
  vec4 tended=vec4(0.);float fieldShare=0.;vec2 fieldSlope=vec2(0.);float pool;
  if(wField>0.){
    if(uHasLandDetail==1){float rough;vec3 c=landField(world,footprint,green,bare,dry,fieldSlope,rough);tended+=wField*vec4(clamp(c*micro,0.,1.),rough);fieldShare=wField;}
    else tended+=wField*occupationMaterial(1,world,footprint,bare,micro,dry,green,pool);
  }
  if(wOrchard>0.)tended+=wOrchard*occupationMaterial(4,world,footprint,bare,micro,dry*.5,green,pool);
  if(wGarden>0.)tended+=wGarden*occupationMaterial(5,world,footprint,bare,micro,dry*.5,green,pool);
  if(wTown>0.)tended+=wTown*occupationMaterial(7,world,footprint,bare,micro,0.,green,pool);
  if(wLane>0.)tended+=wLane*occupationMaterial(9,world,footprint,bare,micro,0.,green,pool);
  // Wild classes meet along ragged lines: only their lookup wanders.
  float wildShare=1.-tendedShare-hardShare;
  vec4 wild=vec4(0.);float marsh=0.,poolShare=0.;
  if(wildShare>.001){
    uint salt=uMaterialSeed+1091u;
    vec2 wander=vec2(surfaceNoise(vec3(world/43.,0.),salt),surfaceNoise(vec3(world/43.,0.),salt+1u))*16.
      +vec2(surfaceNoise(vec3(world/13.,0.),salt+2u),surfaceNoise(vec3(world/13.,0.),salt+3u))*6.;
    vec2 wgrid=(uv+wander/uOccupationRect.z)*uOccupationN-.5,wf=fract(wgrid);ivec2 wbase=ivec2(floor(wgrid));
    float wMeadow=0.,wPasture=0.,wHeath=0.,wMarsh=0.;
    for(int y=0;y<2;y++)for(int x=0;x<2;x++){
      int cls=int(texelFetch(uOccupation,clamp(wbase+ivec2(x,y),ivec2(0),top),0).b*255.+.5);
      float weight=(x==0?1.-wf.x:wf.x)*(y==0?1.-wf.y:wf.y);
      if(cls==2)wMeadow+=weight;else if(cls==3)wPasture+=weight;else if(cls==6)wHeath+=weight;else if(cls==10)wMarsh+=weight;
    }
    // The lookup wandered onto a plot or a road: this ground is still grass.
    wMeadow+=max(0.,1.-wMeadow-wPasture-wHeath-wMarsh);
    if(wMeadow>0.)wild+=wMeadow*occupationMaterial(2,world,footprint,bare,micro,dry,green,pool);
    if(wPasture>0.)wild+=wPasture*occupationMaterial(3,world,footprint,bare,micro,dry,green,pool);
    if(wHeath>0.)wild+=wHeath*occupationMaterial(6,world,footprint,bare,micro,0.,green,pool);
    if(wMarsh>0.){wild+=wMarsh*occupationMaterial(10,world,footprint,bare,micro,0.,green,pool);poolShare=wMarsh*pool*wildShare;marsh=wMarsh*wildShare;}
  }
  float covered=tendedShare+wildShare;
  vec4 target=tended+wild*wildShare;
  if(covered<=0.)return;
  target/=covered;
  // Wild ground fades into its surroundings; ploughed land keeps a firm edge.
  float edgeWidth=fieldShare>.5*covered?max(footprint,cell*.6):cell*3.;
  float width=min(edgeWidth*(1.+1.5*dry),cell*6.);
  float a=groundSmooth(0.,width,min(o.x,-o.y))*(1.-.3*dry)*(1.-v2GroundSnow)*covered;
  if(a<=0.)return;
  renderGuideOpen=mix(renderGuideOpen,target.rgb,a);
  m.albedo=mix(m.albedo,groundToLinear(target.rgb)*v2FloorModulation,a);
  m.roughness=mix(m.roughness,target.a,a);
  m.normal=normalize(mix(m.normal,v2MacroNormal,a*max(marsh,poolShare)*.6));
  if(fieldShare>0.)m.normal=normalize(m.normal+vec3(-fieldSlope.x,0.,-fieldSlope.y)*a*fieldShare);
}
`;
