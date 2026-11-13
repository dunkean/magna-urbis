import { WATER_FRESH_ICE_GLSL } from '../../web/src/render/waterRegime';

/** City water uses the map's optical depth and climate, retaining v2 ice and shores. */
export const CITY_WATER_3D_GLSL = `${WATER_FRESH_ICE_GLSL}
float cityWaterDepth(vec2 world,float footprint,float cover){
  if(uQuality>0){
    // The retained mask and its screen-space ramp approximate distance to the bank.
    float ramp=max(length(vec2(dFdx(cover),dFdy(cover))),.001);
    return clamp(.07*max(footprint,.001)*cover/ramp,.4,6.)*cover;
  }
  // Fixed world-space radii and a haloed mask give adjacent LOD tiles the same depth.
  float bank=128.;
  for(int i=0;i<8;i++){
    float turn=float(i)*.7853982;vec2 direction=vec2(cos(turn),sin(turn));float previous=0.;
    for(int k=0;k<7;k++){
      float r=2.*exp2(float(k));
      if(displayWaterCover(world+direction*r)<.5){
        float lo=previous,hi=r;
        for(int j=0;j<3;j++){float mid=(lo+hi)*.5;if(displayWaterCover(world+direction*mid)<.5)hi=mid;else lo=mid;}
        bank=min(bank,(lo+hi)*.5);break;
      }
      previous=r;
    }
  }
  return clamp(.07*bank,.4,6.)*cover;
}
vec3 cityWaterAt(vec3 base,vec3 surface,vec2 world,float footprint,float cover){
  // Sea (as v2WaterAt) and inland water share one v2Local and one v2WaterColor call: the shader compilers inline
  // each call whole, and two copies of both made the 3D ground the slowest shader to compile.
  bool sea=surface.x<0.;
  if(sea&&(uV2WaterVisible==0||cover<=0.))return base;
  float depth=-surface.x;if(!sea)depth=cityWaterDepth(world,footprint,cover);
  vec3 water=v2WaterColor(v2Local(surface,world,0.,footprint),world,footprint,cover,sea?1.:3.,depth);
  if(!sea){
    water=mix(water,water*vec3(.86,.70,.48),waterTea());
    water=mix(water,vec3(.38,.62,.62),.45*waterGlacial());
    water=mix(water,vec3(.45,.38,.25),.275*waterSediment());
  }
  return mix(base,water,cover);
}
`;
