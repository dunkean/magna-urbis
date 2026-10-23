// Renderer-only canopy approximation outside supplied candidate inventory.
// Marginal rank CDF calibrated on deterministic half-cell-jittered world sites.
uniform vec4 canopy_meso_phase=vec4(0.0);
uniform int canopy_meso_seed=0;
const float CANOPY_MESO_CELL_M=16.0;
const float CANOPY_MESO_CDF[65]=float[65](0.000000000, 0.000913620, 0.003904343, 0.008588791, 0.015556335, 0.024280548, 0.034955978, 0.047624588, 0.062076569, 0.078754425, 0.096973419, 0.117370605, 0.139892578, 0.164064407, 0.190311432, 0.218093872, 0.247749329, 0.280389786, 0.313892365, 0.349601746, 0.386760712, 0.425001144, 0.464403152, 0.504203796, 0.544906616, 0.585958481, 0.626909256, 0.666986465, 0.706478119, 0.743839264, 0.780250549, 0.813919067, 0.844816208, 0.873012543, 0.897605896, 0.919767380, 0.938680649, 0.954423904, 0.966909409, 0.976839066, 0.984247208, 0.989885330, 0.993707657, 0.996221542, 0.997850418, 0.998844147, 0.999387741, 0.999696732, 0.999872208, 0.999954224, 0.999990463, 0.999998093, 0.999998093, 1.000000000, 1.000000000, 1.000000000, 1.000000000, 1.000000000, 1.000000000, 1.000000000, 1.000000000, 1.000000000, 1.000000000, 1.000000000, 1.000000000);
float canopy_meso_hash(ivec2 cell,uint salt){
 uvec2 c=uvec2(cell)&uvec2(1048575u);
 uint h=c.x*1664525u+c.y*1013904223u+(uint(canopy_meso_seed)^salt)*374761393u+2246822519u;
 h=(h^(h>>16u))*2246822519u;h=(h^(h>>13u))*3266489917u;h=h^(h>>16u);
 return float(h&16777215u)/16777216.0;
}
float canopy_meso_cover(vec2 world_xz,float footprint_m,float cover){
 cover=clamp(cover,0.0,1.0);if(cover<=0.0||cover>=1.0)return cover;
 vec2 p=world_xz/CANOPY_MESO_CELL_M+canopy_meso_phase.xy;
 ivec2 cell=ivec2(floor(p))+ivec2(canopy_meso_phase.zw);vec2 f=fract(p);
 float distance_sq=4.0;
 for(int z=-1;z<=1;z++)for(int x=-1;x<=1;x++){
  ivec2 c=cell+ivec2(x,z);
  vec2 center=vec2(float(x),float(z))+vec2(.25)+.5*vec2(canopy_meso_hash(c,0x9e3779b9u),canopy_meso_hash(c,0x85ebca6bu));
  vec2 delta=f-center;distance_sq=min(distance_sq,dot(delta,delta));
 }
 float lookup=clamp(sqrt(distance_sq)*(64.0/1.125),0.0,63.99999);
 int index=int(floor(lookup));float rank=mix(CANOPY_MESO_CDF[index],CANOPY_MESO_CDF[index+1],fract(lookup));
 // Rank has a uniform marginal. A symmetric threshold within [0,1] preserves
 // its area mean, unlike thresholding uncalibrated value noise.
 float aa=min(min(cover,1.0-cover),max(.000001,footprint_m/CANOPY_MESO_CELL_M));
 float detail=1.0-smoothstep(CANOPY_MESO_CELL_M*.2,CANOPY_MESO_CELL_M*.8,footprint_m);
 float mask=1.0-smoothstep(cover-aa,cover+aa,rank);
 return mix(cover,mask,detail);
}

