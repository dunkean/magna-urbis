// Renderer-only arrangement of existing fractions, not observed fine geology.
// Known-CDF material allocation, never an arbitrary RGB/noise multiplier.
uniform bool surface_detail_distribution_enabled=true;
uniform vec4 detail_distribution_phase[3]; // fractional origin.xy, integer-cell origin mod4096.zw
const vec3 DETAIL_DISTRIBUTION_SCALES=vec3(12.0,1.7,0.17);
const vec3 DETAIL_DISTRIBUTION_WEIGHTS=vec3(0.4,0.35,0.25);
uint detail_distribution_hash(vec2 cell,uint salt) {
    uvec2 q=uvec2(mod(cell,vec2(4096.0)));
    uint h=q.x*1664525u+q.y*1013904223u+374761393u+salt*668265263u;
    h=(h^(h>>16u))*2246822519u;
    h=(h^(h>>13u))*3266489917u;return h^(h>>16u);
}
float detail_distribution_gaussian(vec2 cell,uint band) {
    // Half-uint sample avoids log(0). Float32 rounding is a declared numerical
    // approximation of the independent Gaussian seed-ensemble model.
    float u=(float(detail_distribution_hash(cell,band*2u+11u))+.5)/4294967296.0;
    float v=(float(detail_distribution_hash(cell,band*2u+12u))+.5)/4294967296.0;
    return sqrt(max(0.0,-2.0*log(u)))*cos(6.283185307179586*v);
}
float detail_distribution_normal_cdf(float value) {
    float a=abs(value),t=1.0/(1.0+.2316419*a);
    float tail=.3989422804014327*exp(-.5*a*a)*t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
    return clamp(value>=0.0?1.0-tail:tail,0.0,1.0);
}
float detail_distribution_rank(vec2 position,vec2 cell_origin,uint band) {
    vec2 cell=floor(position)+cell_origin,f=fract(position);f=f*f*(vec2(3.0)-2.0*f);
    vec4 weights=vec4((1.0-f.x)*(1.0-f.y),f.x*(1.0-f.y),(1.0-f.x)*f.y,f.x*f.y);
    vec4 samples=vec4(detail_distribution_gaussian(cell,band),detail_distribution_gaussian(cell+vec2(1,0),band),detail_distribution_gaussian(cell+vec2(0,1),band),detail_distribution_gaussian(cell+vec2(1,1),band));
    // Positive interpolation is still Gaussian. Correct its variance BEFORE
    // Phi; a plain interpolated value-noise CDF would vary with grid phase.
    return detail_distribution_normal_cdf(dot(weights,samples)/sqrt(dot(weights,weights)));
}
float detail_distribution_overlap(float a,float b,float lo,float hi) { return max(0.0,min(hi,b)-max(lo,a)); }
float detail_distribution_interval(float rank,float start,float probability,float half_width) {
    if(probability<=0.0)return 0.0;
    if(probability>=1.0||half_width>=.5)return probability;
    float q=fract(rank-start),h=max(.000001,half_width),lo=q-h,hi=q+h;
    return clamp((detail_distribution_overlap(0.0,probability,lo,hi)+detail_distribution_overlap(1.0,1.0+probability,lo,hi)+detail_distribution_overlap(-1.0,probability-1.0,lo,hi))/(2.0*h),0.0,1.0);
}
vec3 detail_distribution_ranks(vec2 local_position,vec2 separate_layer_phase,float footprint) {
    // Constant vector indices avoid unsupported OpVectorExtractDynamic in the
    // Godot shader analyser. The same three scalar functions are used on CPU.
    return vec3(
        2.0*footprint/12.0>=.5?0.0:detail_distribution_rank(local_position/12.0+detail_distribution_phase[0].xy+separate_layer_phase,detail_distribution_phase[0].zw,0u),
        2.0*footprint/1.7>=.5?0.0:detail_distribution_rank(local_position/1.7+detail_distribution_phase[1].xy+separate_layer_phase,detail_distribution_phase[1].zw,1u),
        2.0*footprint/.17>=.5?0.0:detail_distribution_rank(local_position/.17+detail_distribution_phase[2].xy+separate_layer_phase,detail_distribution_phase[2].zw,2u));
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
void detail_distribution_cubic(float f,out float weights[4]) {
    weights[0]=(1.0-f)*(1.0-f)*(1.0-f)/6.0;
    weights[1]=(3.0*f*f*f-6.0*f*f+4.0)/6.0;
    weights[2]=(-3.0*f*f*f+3.0*f*f+3.0*f+1.0)/6.0;
    weights[3]=f*f*f/6.0;
}
float detail_distribution_c2(vec2 position,vec2 cell_origin,uint field) {
    vec2 cell=floor(position)+cell_origin;
    float wx[4];float wz[4];detail_distribution_cubic(fract(position.x),wx);detail_distribution_cubic(fract(position.y),wz);
    float value=0.0,variance=0.0;
    for(int j=0;j<4;j++)for(int i=0;i<4;i++) {
        float weight=wx[i]*wz[j];
        value+=weight*detail_distribution_gaussian(cell+vec2(float(i-1),float(j-1)),field);
        variance+=weight*weight;
    }
    return detail_distribution_normal_cdf(value/sqrt(variance));
}
// Independent hard races avoid the contour ribbons produced by assigning all
// recipes consecutive intervals of ONE rank. No softmax or RGB randomness.
void detail_distribution_race(vec2 local_position,vec2 separate_layer_phase,float footprint,float probability[8],int channels[8],out float mass[8]) {
    float total=0.0;int active=0;
    for(int i=0;i<8;i++){mass[i]=probability[i];total+=probability[i];if(probability[i]>0.0)active++;}
    float uncovered=max(0.0,1.0-total);if(uncovered>0.0)active++;
    if(footprint>=3.0||active<=1)return; // exact original fractions/target horizon
    for(int i=0;i<8;i++)mass[i]=0.0;
    float scales[3];scales[0]=12.0;scales[1]=1.7;scales[2]=.17;
    float bands[3];bands[0]=.4;bands[1]=.35;bands[2]=.25;
    for(int b=0;b<3;b++) {
        float scale=scales[b],closure=smoothstep(scale*.125,scale*.25,footprint);
        for(int i=0;i<8;i++)mass[i]+=bands[b]*closure*probability[i];
        if(closure>=1.0)continue;
        // Positive spatial quadrature: each sample has the SAME categorical
        // expectation. Its uncertainty is not an exact pixel-area certificate.
        for(int tap=0;tap<4;tap++) {
            vec2 offset=vec2(tap%2==0?-.25:.25,tap<2?-.25:.25)*footprint;
            vec2 position=(local_position+offset)/scale+detail_distribution_phase[b].xy+separate_layer_phase;
            int winner=-1;float best=3.402823e38;
            for(int i=0;i<9;i++) {
                float p=uncovered;int channel=64;
                if(i<8){p=probability[i];channel=channels[i];}
                if(p<=0.0)continue;
                float rank=detail_distribution_c2(position,detail_distribution_phase[b].zw,uint(b+3*(channel+17)));
                float score=-log(max(.0000001,rank))/p;
                if(score<best){best=score;winner=i;}
            }
            if(winner>=0&&winner<8)mass[winner]+=bands[b]*(1.0-closure)*.25;
        }
    }
}
