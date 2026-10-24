// Renderer-only arrangement of existing fractions, not observed fine geology.
// Known-CDF material allocation, never an arbitrary RGB/noise multiplier.
uniform bool surface_detail_distribution_enabled=true;
uniform vec2 detail_distribution_phase[3];
const vec3 DETAIL_DISTRIBUTION_SCALES=vec3(12.0,1.7,0.17);
const vec3 DETAIL_DISTRIBUTION_WEIGHTS=vec3(0.4,0.35,0.25);
float detail_distribution_rank(vec2 position) {
    vec2 q=fract(position);
    q.x=fract(q.x+0.22*sin(6.283185307179586*q.y));
    q.y=fract(q.y+0.22*sin(6.283185307179586*q.x));
    q.x=fract(q.x+0.16*sin(6.283185307179586*q.y));
    float r=length(q-vec2(.5));float r2=r*r;
    if(r>=0.7071067811865476)return 1.0;
    if(r<=.5)return 3.141592653589793*r2;
    return clamp(3.141592653589793*r2-4.0*(r2*acos(.5/r)-.5*sqrt(max(0.0,r2-.25))),0.0,1.0);
}
float detail_distribution_overlap(float a,float b,float lo,float hi) { return max(0.0,min(hi,b)-max(lo,a)); }
float detail_distribution_interval(float rank,float start,float probability,float half_width) {
    if(probability<=0.0)return 0.0;
    if(probability>=1.0||half_width>=.5)return probability;
    float q=fract(rank-start),h=max(.000001,half_width),lo=q-h,hi=q+h;
    return clamp((detail_distribution_overlap(0.0,probability,lo,hi)+detail_distribution_overlap(1.0,1.0+probability,lo,hi)+detail_distribution_overlap(-1.0,probability-1.0,lo,hi))/(2.0*h),0.0,1.0);
}
vec3 detail_distribution_ranks(vec2 local_position,vec2 separate_layer_phase) {
    vec3 ranks;
    for(int i=0;i<3;i++)ranks[i]=detail_distribution_rank(local_position/DETAIL_DISTRIBUTION_SCALES[i]+detail_distribution_phase[i]+separate_layer_phase);
    return ranks;
}
float detail_distribution_mass(vec3 ranks,float start,float probability,float footprint) {
    float result=0.0;
    for(int i=0;i<3;i++)result+=DETAIL_DISTRIBUTION_WEIGHTS[i]*detail_distribution_interval(ranks[i],start,probability,footprint/DETAIL_DISTRIBUTION_SCALES[i]);
    return result;
}
