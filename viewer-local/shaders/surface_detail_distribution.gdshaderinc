// Renderer-only arrangement of existing fractions, not observed fine geology.
// Known-CDF material allocation, never an arbitrary RGB/noise multiplier.
uniform bool surface_detail_distribution_enabled=true;
uniform vec4 detail_distribution_phase[3]; // fractional origin.xy, integer-cell origin mod4096.zw
const vec3 DETAIL_DISTRIBUTION_SCALES=vec3(12.0,1.7,0.17);
const vec3 DETAIL_DISTRIBUTION_WEIGHTS=vec3(0.4,0.35,0.25);
float detail_distribution_hash(vec2 cell) {
    uvec2 q=uvec2(cell);
    uint h=q.x*1664525u+q.y*1013904223u+374761393u;
    h=(h^(h>>16u))*2246822519u;
    h=(h^(h>>13u))*3266489917u;h=h^(h>>16u);
    return float(h&0x00ffffffu)/16777216.0;
}
float detail_distribution_rank(vec2 position,vec2 cell_origin) {
    vec2 q=position;
    q.x+=0.22*sin(6.283185307179586*fract(q.y));
    q.y+=0.22*sin(6.283185307179586*fract(q.x));
    q.x+=0.16*sin(6.283185307179586*fract(q.y));
    vec2 cell=mod(floor(q)+cell_origin,vec2(4096.0));
    float subdivision=detail_distribution_hash(cell+vec2(137,91))<.5?1.0:2.0;
    q=fract(q)*subdivision;cell=cell*2.0+floor(q);q=fract(q);
    vec2 centre=vec2(.25)+.5*vec2(detail_distribution_hash(cell),detail_distribution_hash(cell+vec2(72,31)));
    vec2 extent=mix(centre,vec2(1.0)-centre,step(centre,q));
    vec2 relative=abs(q-centre)/extent;
    float radius=max(relative.x,relative.y);
    return radius*radius;
}
float detail_distribution_overlap(float a,float b,float lo,float hi) { return max(0.0,min(hi,b)-max(lo,a)); }
float detail_distribution_interval(float rank,float start,float probability,float half_width) {
    if(probability<=0.0)return 0.0;
    if(probability>=1.0||half_width>=.5)return probability;
    float q=fract(rank-start),h=max(.000001,half_width),lo=q-h,hi=q+h;
    return clamp((detail_distribution_overlap(0.0,probability,lo,hi)+detail_distribution_overlap(1.0,1.0+probability,lo,hi)+detail_distribution_overlap(-1.0,probability-1.0,lo,hi))/(2.0*h),0.0,1.0);
}
vec3 detail_distribution_ranks(vec2 local_position,vec2 separate_layer_phase) {
    // Constant vector indices avoid unsupported OpVectorExtractDynamic in the
    // Godot shader analyser. The same three scalar functions are used on CPU.
    return vec3(
        detail_distribution_rank(local_position/12.0+detail_distribution_phase[0].xy+separate_layer_phase,detail_distribution_phase[0].zw),
        detail_distribution_rank(local_position/1.7+detail_distribution_phase[1].xy+separate_layer_phase,detail_distribution_phase[1].zw),
        detail_distribution_rank(local_position/.17+detail_distribution_phase[2].xy+separate_layer_phase,detail_distribution_phase[2].zw));
}
float detail_distribution_mass(vec3 ranks,float start,float probability,float footprint) {
    // Closed-form unresolved limit, avoiding weighted F32 roundoff of p.
    if(footprint>=3.0)return probability;
    return .4*detail_distribution_interval(ranks.x,start,probability,2.0*footprint/12.0)
        +.35*detail_distribution_interval(ranks.y,start,probability,2.0*footprint/1.7)
        +.25*detail_distribution_interval(ranks.z,start,probability,2.0*footprint/.17);
}
float detail_distribution_gain(vec3 target,vec3 physical_mean,vec3 minimum_color,vec3 maximum_color) {
    // COMMON across every possible local outcome: original parameters only.
    // The existing display gamut is [0,.95]; no realised delta enters this gain.
    vec3 negative=physical_mean-minimum_color,positive=maximum_color-physical_mean;
    vec3 lower=mix(vec3(1.0),target/max(negative,vec3(.00000001)),step(vec3(.00000001),negative));
    vec3 upper=mix(vec3(1.0),(vec3(.95)-target)/max(positive,vec3(.00000001)),step(vec3(.00000001),positive));
    return clamp(min(min(min(lower.x,lower.y),lower.z),min(min(upper.x,upper.y),upper.z)),0.0,1.0);
}
