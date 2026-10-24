// Renderer-only canopy approximation outside supplied candidate inventory.
// Marginal rank CDF calibrated on deterministic full-cell-jittered world sites.
#include "res://shaders/canopy_lod.gdshaderinc"
uniform vec4 canopy_meso_phase=vec4(0.0);
uniform int canopy_meso_seed=0;
uniform bool canopy_asset_enabled=false;
uniform sampler2D canopy_optical_lut : filter_linear, repeat_disable;
float canopy_optical_mean(float envelope_cover){
 return canopy_asset_enabled?textureLod(canopy_optical_lut,vec2((clamp(envelope_cover,0.0,1.0)*256.0+.5)/257.0,.5),0.0).r:envelope_cover;
}
const float CANOPY_MESO_CELL_M=16.0;
const float CANOPY_MESO_CDF[65]=float[65](0.000000000, 0.001787186, 0.007123947, 0.015642166, 0.027740479, 0.042984009, 0.062061310, 0.084333420, 0.109577179, 0.137813568, 0.169153214, 0.203155518, 0.239603043, 0.278257370, 0.319181442, 0.361764908, 0.405628204, 0.450138092, 0.495178223, 0.540449142, 0.583829880, 0.627262115, 0.669685364, 0.709945679, 0.748413086, 0.783838272, 0.816434860, 0.846004486, 0.873222351, 0.896793365, 0.917478561, 0.934982300, 0.949651718, 0.961904526, 0.971836090, 0.979625702, 0.985696793, 0.990203857, 0.993701935, 0.996088028, 0.997552872, 0.998659134, 0.999273300, 0.999637604, 0.999811172, 0.999916077, 0.999952316, 0.999980927, 0.999986649, 0.999996185, 0.999998093, 1.000000000, 1.000000000, 1.000000000, 1.000000000, 1.000000000, 1.000000000, 1.000000000, 1.000000000, 1.000000000, 1.000000000, 1.000000000, 1.000000000, 1.000000000, 1.000000000);
float canopy_meso_hash(ivec2 cell,uint salt){
 uvec2 c=uvec2(cell)&uvec2(1048575u);
 uint h=c.x*1664525u+c.y*1013904223u+(uint(canopy_meso_seed)^salt)*374761393u+2246822519u;
 h=(h^(h>>16u))*2246822519u;h=(h^(h>>13u))*3266489917u;h=h^(h>>16u);
 return float(h&16777215u)/16777216.0;
}
float canopy_meso_cover(vec2 world_xz,float footprint_m,float cover){
 cover=canopy_optical_mean(cover);
 cover=clamp(cover,0.0,1.0);if(cover<=0.0||cover>=1.0)return cover;
 float detail=canopy_reference_visible_weight(footprint_m);
 if(detail<=0.0)return cover;
 vec2 p=world_xz/CANOPY_MESO_CELL_M+canopy_meso_phase.xy;
 ivec2 cell=ivec2(floor(p))+ivec2(canopy_meso_phase.zw);vec2 f=fract(p);
 float distance_sq=4.0;
 for(int z=-2;z<=2;z++)for(int x=-2;x<=2;x++){
  ivec2 c=cell+ivec2(x,z);
  vec2 center=vec2(float(x),float(z))+vec2(canopy_meso_hash(c,0x9e3779b9u),canopy_meso_hash(c,0x85ebca6bu));
  vec2 delta=f-center;distance_sq=min(distance_sq,dot(delta,delta));
 }
 float lookup=clamp(sqrt(distance_sq)*(64.0/1.5),0.0,63.99999);
 int index=int(floor(lookup));float rank=mix(CANOPY_MESO_CDF[index],CANOPY_MESO_CDF[index+1],fract(lookup));
 // Rank has a uniform marginal. A symmetric threshold within [0,1] preserves
 // its area mean, unlike thresholding uncalibrated value noise.
 float aa=min(min(cover,1.0-cover),max(.000001,footprint_m/CANOPY_MESO_CELL_M));
 float mask=1.0-smoothstep(cover-aa,cover+aa,rank);
 return mix(cover,mask,detail);
}
vec3 canopy_meso_normal(vec2 world_xz,float footprint_m,float cover){
 cover=canopy_optical_mean(cover);
 cover=clamp(cover,0.000001,.999999);
 float detail=canopy_reference_visible_weight(footprint_m);
 if(detail<=0.0)return vec3(0,1,0);
 vec2 p=world_xz/CANOPY_MESO_CELL_M+canopy_meso_phase.xy;
 ivec2 cell=ivec2(floor(p))+ivec2(canopy_meso_phase.zw);vec2 f=fract(p);vec2 nearest=vec2(0.0);float best=4.0;
 for(int z=-2;z<=2;z++)for(int x=-2;x<=2;x++){
  ivec2 c=cell+ivec2(x,z);vec2 center=vec2(float(x),float(z))+vec2(canopy_meso_hash(c,0x9e3779b9u),canopy_meso_hash(c,0x85ebca6bu));vec2 delta=f-center;
  float d=dot(delta,delta);if(d<best){best=d;nearest=delta;}
 }
 float radius=.000001;
 for(int i=0;i<64;i++)if(cover>=CANOPY_MESO_CDF[i] && cover<=CANOPY_MESO_CDF[i+1]){
  radius=(float(i)+(cover-CANOPY_MESO_CDF[i])/max(CANOPY_MESO_CDF[i+1]-CANOPY_MESO_CDF[i],.000001))*(1.5/64.0);break;
 }
 vec2 radial=nearest/max(radius,.000001);float height=sqrt(max(.001,1.0-dot(radial,radial)));
 vec3 normal=normalize(vec3(radial.x,height*1.272727273,radial.y));
 return normalize(mix(vec3(0,1,0),normal,detail));
}

