// Same physical response law as web/src/surface/groundResponse.ts. Regional
// evidence remains coarse; this is parameter reconstruction, never colour blur
// or new observed soil/geology. All coordinates use the fixed canonical frame.
uniform bool ground_response_enabled=false;
uniform sampler2D ground_response_soil : filter_nearest, repeat_disable;
uniform sampler2D ground_response_processes : filter_nearest, repeat_disable;
uniform sampler2D ground_response_codes : filter_nearest, repeat_disable;
uniform vec4 ground_response_unit_colors[64];
uniform int ground_response_color_roles[32]; // 0 recipe,1 substrate,2 transported source
uniform vec4 ground_response_recipe_ids0; // alluvial,gravity,wind,coastal
uniform vec4 ground_response_recipe_ids1; // mineral,organic,arid,crop

float ground_response_smooth(float a,float b,float value) {
    float t=clamp((value-a)/(b-a),0.0,1.0);return t*t*(3.0-2.0*t);
}
vec3 ground_response_color(int id,vec3 bed,vec3 transported) {
    int role=ground_response_color_roles[id];
    return role==2?transported:role==1?bed:palette[id].rgb;
}
bool ground_response_sample(vec2 uv,out ivec2 pair,out float blend,out vec3 mean) {
    if(!ground_response_enabled)return false;
    ivec2 size=textureSize(ground_response_soil,0);
    vec2 grid=clamp(uv*vec2(size)-vec2(0.5),vec2(0.0),vec2(size)-vec2(1.0));
    ivec2 nearest=ivec2(floor(grid+vec2(0.5)));
    if(all(equal(grid,vec2(nearest)))) {
        // Preserve stored knot ids and sRGB8 mean exactly. No synthetic detail
        // is inferred from quantisation rounding at the original samples.
        vec4 old=texelFetch(surface_ids,nearest,0);
        pair=ivec2(int(old.r+0.5),int(old.g+0.5));blend=old.b;
        mean=texelFetch(surface_average,nearest,0).rgb;return true;
    }
    ivec2 cell=min(size-ivec2(2),ivec2(floor(grid)));vec2 f=grid-vec2(cell);
    vec4 spatial=vec4((1.0-f.x)*(1.0-f.y),f.x*(1.0-f.y),(1.0-f.x)*f.y,f.x*f.y);
    vec4 soil=vec4(0.0);vec4 processes=vec4(0.0);float aridity=0.0;
    for(int c=0;c<4;c++) {
        ivec2 offset=ivec2(c%2,c/2);ivec2 p=cell+offset;
        soil+=texelFetch(ground_response_soil,p,0)*spatial[c];
        processes+=texelFetch(ground_response_processes,p,0)*spatial[c];
        aridity+=texelFetch(ground_response_codes,p,0).r*spatial[c];
    }
    vec4 codes=texelFetch(ground_response_codes,nearest,0);
    if(codes.b<0.0) {
        int crop=int(ground_response_recipe_ids1.w+0.5);
        vec3 crop_bed=ground_response_unit_colors[clamp(int(-codes.b-1.0+0.5),0,63)].rgb;
        vec3 crop_source=ground_response_unit_colors[clamp(int(codes.a+0.5),0,63)].rgb;
        pair=ivec2(crop);blend=0.0;mean=ground_response_color(crop,crop_bed,crop_source);return true;
    }
    vec3 bed=ground_response_unit_colors[clamp(int(codes.b+0.5),0,63)].rgb;
    vec3 transported=ground_response_unit_colors[clamp(int(codes.a+0.5),0,63)].rgb;
    float rock=clamp((soil.r-0.08)/0.75,0.0,1.0);
    float process_sum=((0.0+processes.r)+processes.g)+processes.b+processes.a;
    float process_scale=max(1.0,process_sum),soil_rest=(1.0-rock)*(1.0-min(1.0,process_sum));
    float dry=clamp((0.65-aridity)/0.4,0.0,1.0);
    float humus=ground_response_smooth(0.72,0.88,soil.a)*(1.0-ground_response_smooth(0.08,0.16,soil.g))*ground_response_smooth(0.02,0.16,soil.b);
    float soil_weight=soil_rest*(1.0-dry);
    int ids[8];float amounts[8];
    ids[0]=int(codes.g+0.5);ids[1]=int(ground_response_recipe_ids1.x+0.5);ids[2]=int(ground_response_recipe_ids1.y+0.5);ids[3]=int(ground_response_recipe_ids1.z+0.5);
    amounts[0]=rock;amounts[1]=soil_weight*(1.0-humus);amounts[2]=soil_weight*humus;amounts[3]=soil_rest*dry;
    for(int c=0;c<4;c++){ids[c+4]=int(ground_response_recipe_ids0[c]+0.5);amounts[c+4]=processes[c]/process_scale*(1.0-rock);}
    float total=0.0;for(int i=0;i<8;i++)total+=amounts[i];
    mean=vec3(0.0);for(int i=0;i<8;i++)mean+=ground_response_color(ids[i],bed,transported)*amounts[i]/total;
    // Combine duplicate ids in the original insertion/addition order, then the
    // same descending weight/ascending id top2 rule as dominantMaterialPair.
    for(int i=0;i<8;i++)for(int j=0;j<i;j++)if(ids[j]==ids[i]){amounts[j]+=amounts[i];amounts[i]=0.0;break;}
    int first=-1;int second=-1;
    for(int i=0;i<8;i++) {
        if(amounts[i]<=0.0)continue;
        if(first<0){first=i;continue;}
        if(amounts[i]>amounts[first]||(amounts[i]==amounts[first]&&ids[i]<ids[first])){second=first;first=i;}
        else if(second<0)second=i;
        else if(amounts[i]>amounts[second]||(amounts[i]==amounts[second]&&ids[i]<ids[second]))second=i;
    }
    if(first<0){pair=ivec2(0);blend=0.0;return true;}
    pair=ivec2(ids[first],ids[second<0?first:second]);
    float secondary=second<0?0.0:amounts[second];blend=secondary/(amounts[first]+secondary);return true;
}
