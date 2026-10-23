import { RENDER_V2_ENVIRONMENT_GLSL, RENDER_V2_CANOPY_MEAN_GLSL } from './terrainRenderV2Environment';

/** Shared environmental appearance. The local adapter has one annual climate,
 * so the north-hemisphere seasonal amplitude below is a declared proxy. */
export const RENDER_V2_GLSL = `${RENDER_V2_ENVIRONMENT_GLSL}
${RENDER_V2_CANOPY_MEAN_GLSL}
GroundMaterial v2MeanOpen,v2MeanLitter,v2MeanCrown;
vec3 v2MeanWeights=vec3(1.,0.,0.);
float forestBeachCoverage(vec2 world){
  vec3 s=forestRootSurface(world);
  if(s.x<0.||s.x>=12.||length(s.yz)>=.5)return 0.;
  float r=max(300.,2.*forestRootCell()),shore=max(s.x,0.)/max(length(s.yz),.0001),openness=0.;
  for(int i=0;i<12;i++){
    vec2 d=vec2(cos(float(i)*.523598776),sin(float(i)*.523598776));
    if(forestRootSurface(world+d*r).x<0.){shore=min(shore,r);openness+=1./12.;}
    if(forestRootSurface(world+d*r*.5).x<0.)shore=min(shore,r*.5);
  }
  if(openness<=.15)return 0.;
  return surfaceRootBeach(s,world,shore,openness);
}
float v2FlatSedimentExposure(float herbs,float shore,float openness){
  // Existing retained shore proxy, qualified by actual nearby seawater.
  // Keep coastal bars/islets bare; recolonize progressively inland.
  float coastal=(1.-groundSmooth(160.,400.,shore))*groundSmooth(0.,.15,openness);
  return 1.-herbs*(1.-coastal);
}
uniform vec4 uV2GlacierSources[8];
float v2GlacierProximity(vec2 world){float source=0.;for(int i=0;i<8;i++)source=max(source,uV2GlacierSources[i].z*(1.-sstep(0.,80000.,distance(world,uV2GlacierSources[i].xy))));return source;}
V2Env v2Local(vec3 s,vec2 world,float tpi,float footprint){
  float annual=uMaterialClimate.x-.0065*max(s.x,0.);
  // Same continental growing-season proxy as the canonical forest field.
  float amplitude=6.+.5*max(0.,10.-uMaterialClimate.x);
  float rain=uMaterialClimate.y;
  float arid=1.-sstep(.35,1.,rain/max(120.,20.*uMaterialClimate.x+280.));
  float bank=uForest==1?forestBankCover(world,max(1.,footprint)):0.;
  V2Env e=v2Evaluate(vec3(world,0.),s.x,s.yz,tpi,annual+amplitude,annual-amplitude,rain*.5,rain*.5,.15+.50*arid,bank,uV2Season,footprint,uMaterialSeed);
  if(uForest==1){vec4 f=forestField(world,0.);e.woody=f.r;e.height=f.g*50.;e.needle=f.b;e.leaf=mix(e.leaf,1.,e.needle);}
  if(uHasOccupation==1){vec2 uv=(world-uOccupationRect.xy)/uOccupationRect.z;if(all(greaterThanEqual(uv,vec2(0.)))&&all(lessThanEqual(uv,vec2(1.)))){int cls=int(textureLod(uOccupation,uv,0.).b*255.+.5);if(cls==8){e.woody=0.;e.grass=0.;}}}
  float water=forestWaterCoverage(world);e.woody*=1.-water;e.grass*=1.-water;
  // Preserve the retained physical beach footprint at every detail level.
  // Its 0.8 factor belongs to legacy colour blending, not vegetation cover.
  float beach=clamp(renderGuideBeach/.8,0.,1.);
  e.woody*=1.-beach;e.grass*=1.-beach;e.rock*=1.-beach;
  return e;
}
GroundMaterial v2Ground(vec3 s,vec2 world,float footprint,float tpi,vec3 light,vec3 light2,float strength,vec3 macroOpen){
  float macroWoods=renderGuideWoods*(1.-clamp(renderGuideBeach/.8,0.,1.));
  V2Env e=v2Appearance(v2Local(s,world,tpi,footprint),footprint);v2Foliage=e.leaf;v2GroundSnow=e.snow;
  // Retained macro canopy is the occupation/gallery fallback. Natural stands
  // below use population-weighted open, litter and intrinsic crown responses.
  float woods=(uForest==1?macroWoods:e.woody)*e.leaf;
  // One retained material mean at every footprint. Resolution reveals only
  // surface detail; it must not replace the soil with another palette.
  vec3 opened=v2GroundTint(macroOpen,e);
  // A low alluvial plain is not necessarily exposed sediment. Potential
  // herbaceous cover recolonizes it; the physical beach remains separate.
  opened=mix(opened,renderGuideSediment*.9,renderGuideFlats*v2FlatSedimentExposure(e.grass,renderGuideShore,renderGuideOpenness));
  opened=mix(opened,vec3(.88,.91,.91),e.snow);
  opened=mix(opened,renderGuideSediment,clamp(renderGuideBeach/.8,0.,1.)*(1.-e.snow));
  V2Env canopyPhase=e;canopyPhase.snow=0.;
  V2Env leafOn=canopyPhase;leafOn.leaf=1.;
  // Retain Render's canopy mean. V2 supplies the seasonal change rather than
  // a second absolute palette with a different exposure in the same biome.
  vec3 closed=renderGuideBaseClosed*v2Canopy(canopyPhase)/max(v2Canopy(leafOn),vec3(.02));
  // Integrate the intrinsic normals/AO of unresolved crowns. The guide for
  // actual resolved crowns below retains its original material, not this mean.
  vec3 meanClosed=closed*mix(vec3(1.),v2CanopyMeanRatio(closed,e.needle,light,light2,strength),1.-e.snow);
  closed=mix(closed,vec3(.72,.79,.77),e.snow*.62);
  meanClosed=mix(meanClosed,vec3(.72,.79,.77),e.snow*.62);
  // Legacy sediment is composed after the unresolved canopy. Resolved crowns
  // above those flats retain their own material when applyForest reveals them.
  v2MacroCanopy=mix(meanClosed,renderGuideSediment*.9,renderGuideFlats*(1.-e.snow));
  // Shared analytic micro-normal bands. Herbaceous sward has very low height;
  // no scaled tree crowns are used as grass blades.
  GroundMaterial m;
  vec4 detail=groundField(vec3(world.x,0.,world.y),uMaterialSeed,footprint);
  float gain=mix(.02+.43*e.rock+.07*(1.-e.grass),.008,e.snow);
  m.normal=normalize(vec3(-s.y-detail.y*gain,1.,-s.z-detail.w*gain));
  float sward=clamp(detail.x*4.,-1.,1.)*.025*e.grass*(1.-e.snow)*groundVisibility(.32,footprint);
  float form=clamp(detail.x*10.,-1.,1.);
  v2FloorModulation=1.+form*mix(mix(.04,.06,e.rock),.006,e.snow)+sward;
  v2MacroNormal=normalize(vec3(-s.y,1.,-s.z));
  m.albedo=mix(forestFloorAlbedo(opened),groundToLinear(v2MacroCanopy),woods);
  m.roughness=clamp(pow(pow(mix(.88,.54,e.rock),4.)+gain*gain*groundSlopeVariance(footprint),.25),.4,.98);
  m.occlusion=clamp(1.-.10*max(-detail.x*12.,0.)*e.rock,.8,1.);
  v2MeanEnabled=0.;v2ForestReveal=0.;
  v2MeanOpen=m;v2MeanOpen.albedo=forestFloorAlbedo(opened);
  v2MeanLitter=v2MeanOpen;v2MeanCrown=v2MeanOpen;v2MeanWeights=vec3(1.,0.,0.);
  vec2 forestUv=(world-uForestRect.xy)/uForestRect.z;
  // Natural stands use the population raster. Occupation and narrow bank
  // galleries retain their existing explicit contracts.
  if(uForest==1&&uHasOccupation==0&&forestBankCover(world,max(1.,footprint))<.001&&all(greaterThanEqual(forestUv,vec2(0.)))&&all(lessThanEqual(forestUv,vec2(1.)))){
    float cell=uForestRect.z/float(textureSize(uForestField,0).x);
    // The progressive population profile supplies gradual stand edges; its
    // mean needs only the physical pixel footprint, not an extra blur mip.
    vec4 f=forestField(world,max(log2(max(footprint,.02)/cell),0.));
    ForestStand st;st.p=world;st.cover=f.r;st.height=f.g*50.;st.needle=f.b;st.tone=f.a;
    float T=uMaterialClimate.x,humid=uMaterialClimate.y/max(20.*T+280.,120.);
    st.trop=groundSmooth(13.,19.,T-6.);st.dry=1.-groundSmooth(.8,2.,humid);
    st.kappa=mix(.25,.78,groundSmooth(.9,1.8,humid))*mix(.55,1.,groundSmooth(3.,10.,st.height))*mix(1.,.6,st.needle)*(1.-.6*st.trop);
    st.open=-1e3;st.forced=-1e3;st.allow=0.;st.hedge=0.;
    float d=forestDensity(st.cover,st.kappa),share=st.cover/max(d,1e-3);
    float available=(1.-clamp(renderGuideBeach/.8,0.,1.))*(1.-forestWaterCoverage(world));
    float canopy=st.cover*e.leaf*available;share*=available;
    v2MeanWeights=vec3(1.-share,max(share-canopy,0.),canopy);
    v2MeanLitter.albedo=forestFloorAlbedo(forestFloor(opened,st,1.-groundSmooth(8.,16.,T+6.)));
    v2MeanLitter.occlusion*=.72;
    vec3 bareGuide=renderGuideBaseClosed*v2Canopy(canopyPhase)/max(v2Canopy(leafOn),vec3(.02));
    vec3 crownBare=forestCrownColor(st,bareGuide,st.needle,vec2(0.),0.);
    vec3 crownSnow=forestCrownColor(st,vec3(.72,.79,.77),st.needle,vec2(0.),0.);
    vec3 crownMean=crownBare*mix(vec3(1.),v2CanopyMeanRatio(crownBare,st.needle,light,light2,strength),1.-e.snow);
    v2MeanCrown.albedo=groundToLinear(mix(crownMean,crownSnow,e.snow*.62));
    v2MeanCrown.normal=v2MacroNormal;v2MeanCrown.roughness=.9;v2MeanCrown.occlusion=1.;
    v2MeanEnabled=1.;
  }
  renderGuideColor=groundToDisplay(m.albedo);renderGuideOpen=opened;renderGuideClosed=closed;renderGuideWoods=woods;
  return m;
}
vec3 v2ShadeGround(GroundMaterial resolved,vec3 view,vec3 light,vec3 light2,float strength){
  vec3 nearColor=shadeTerrainGround(resolved,view,light,light2,strength);
  if(v2MeanEnabled<.5)return nearColor;
  vec3 openResponse=groundToLinear(shadeTerrainGround(v2MeanOpen,view,light,light2,strength));
  vec3 litterResponse=groundToLinear(shadeTerrainGround(v2MeanLitter,view,light,light2,strength));
  vec3 crownResponse=groundToLinear(shadeTerrainGround(v2MeanCrown,view,light,light2,strength));
  vec3 meanResponse=openResponse*v2MeanWeights.x+litterResponse*v2MeanWeights.y+crownResponse*v2MeanWeights.z;
  return groundToDisplay(mix(meanResponse,groundToLinear(nearColor),v2ForestReveal));
}
vec3 v2WaterAt(vec3 rgb,vec3 s,vec2 world,float footprint,float cover,float kind,float depth){
  if(uV2WaterVisible==0||cover<=0.)return rgb;
  V2Env e=v2Local(s,world,0.,footprint);
  // Regional map has no calving/current model. Only a perennial-cold land
  // source near a shoreline enables this local coastal iceberg proxy.
  float amplitude=6.+.5*max(0.,10.-uMaterialClimate.x);
  e.glacier=kind<1.5?v2GlacierProximity(world):0.;
  vec3 water=v2Water(depth,kind,cover,e,vec3(world,0.),footprint,uMaterialSeed);
  if(uRenderV2==5)water=mix(vec3(.08,.17,.24),vec3(.85,.94,1.),v2Ice(depth,kind,e,vec3(world,0.),footprint,uMaterialSeed).x);
  if(uRenderV2==4)water=vec3(0.,0.,.13);
  return mix(rgb,water,cover);
}
vec3 v2Diagnostic(vec3 s,vec2 world,float tpi,float fp){return v2Color(v2Appearance(v2Local(s,world,tpi,fp),fp),float(uRenderV2-1));}
`;

export const renderV2Number = (style: string): number => ({ 'render-v2': 1, 'render-v2-substrate': 2, 'render-v2-moisture': 3, 'render-v2-vegetation': 4, 'render-v2-snow': 5 }[style] ?? 0);

interface V2SourceLayer { x:number; y:number; width:number; n:number; data:Float32Array }
const glacierCache=new WeakMap<Float32Array,Map<string,Float32Array>>();
/** At most eight geographic bins of perennial-cold coastal source cells.
 * Stable source-grid proxy; no scanning or terrain sampling in fragment shaders. */
export function renderV2GlacierSources(layer:V2SourceLayer,climate:{temperature:number;precipitation:number}):Float32Array {
  const key=[layer.x,layer.y,layer.width,layer.n,climate.temperature,climate.precipitation].join('/');
  let cache=glacierCache.get(layer.data);if(!cache)glacierCache.set(layer.data,cache=new Map());
  const prior=cache.get(key);if(prior)return prior;
  const result=new Float32Array(32),sum=new Float64Array(24),n=layer.n;
  const amplitude=6+.5*Math.max(0,10-climate.temperature),step=Math.max(1,Math.floor(n/256));
  if(climate.precipitation>80)for(let y=0;y<n;y+=step)for(let x=0;x<n;x+=step){
    const h=layer.data[y*n+x];if(h<=20||climate.temperature+amplitude-.0065*h>=-1)continue;
    let coast=false;for(const [dx,dy] of [[-4,0],[4,0],[0,-4],[0,4]]){const xx=x+dx*step,yy=y+dy*step;if(xx>=0&&yy>=0&&xx<n&&yy<n&&layer.data[yy*n+xx]<0)coast=true;}
    if(!coast)continue;const bin=Math.min(3,Math.floor(x/n*4))+4*Math.min(1,Math.floor(y/n*2));
    sum[bin*3]+=layer.x+(x+.5)*layer.width/n;sum[bin*3+1]+=layer.y+(y+.5)*layer.width/n;sum[bin*3+2]++;
  }
  for(let i=0;i<8;i++)if(sum[i*3+2]){result[i*4]=sum[i*3]/sum[i*3+2];result[i*4+1]=sum[i*3+1]/sum[i*3+2];result[i*4+2]=1;}
  cache.set(key,result);return result;
}
