// Object-local hashed alpha, independent of render origin/scene serial. The CDF
// of a weighted sum of two uniforms preserves coverage across dyadic LODs.
// Method: hashed alpha testing, as in Godot's scene_forward_aa_inc.glsl (MIT).
uint forest_mix_bits(uint x){x^=x>>16u;x*=0x7feb352du;x^=x>>15u;x*=0x846ca68bu;return x^(x>>16u);}
float forest_lattice_hash(vec3 cell,uint seed){
 uvec3 p=uvec3(ivec3(cell));
 uint h=forest_mix_bits(seed^p.x);h=forest_mix_bits(h^p.y*0x9e3779b9u);h=forest_mix_bits(h^p.z*0x85ebca6bu);
 return float(h>>8u)*(1.0/16777216.0);
}
float forest_alpha_threshold(vec3 point,vec3 plane_point,uint seed){
 float footprint=max(length(dFdx(plane_point)),length(dFdy(plane_point)));
 float lod=clamp(log2(1.0/max(footprint,.000001)),-16.0,20.0);
 float lower=exp2(floor(lod));float fraction=fract(lod);
 float a=forest_lattice_hash(floor(point*lower),seed);
 float b=forest_lattice_hash(floor(point*lower*2.0),seed^0xa511e9b3u);
 float value=mix(a,b,fraction);float m=min(fraction,1.0-fraction);
 if(m<.000001)return value;
 float denominator=2.0*m*(1.0-m);
 if(value<m)return value*value/denominator;
 if(value>1.0-m)return 1.0-(1.0-value)*(1.0-value)/denominator;
 return (value-.5*m)/(1.0-m);
}
