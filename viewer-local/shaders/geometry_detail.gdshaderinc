uniform bool geometry_detail_enabled = false;
// G is already conditioned by canonical soil/water/occupation AND edge confidence.
// B is a categorical catalogue INDEX (never a geology unit ID).
uniform sampler2D geometry_detail_map : filter_nearest, repeat_disable;
uniform vec2 detail_origin;
uniform vec2 detail_grid_size = vec2(2.0);
uniform float detail_spacing_m = 1.0;
uniform vec4 detail_rock_colors[64]; // linear RGB, alpha1=valid; no source_color.
uniform int detail_bedrock_recipe = -1;

void surface_geometry_detail(vec2 world_xz, vec3 fallback_color, out float exposure, out vec3 rock_color, out float slope, out float confidence) {
    exposure=0.0; rock_color=fallback_color; slope=0.0; confidence=0.0;
    if(!geometry_detail_enabled || detail_bedrock_recipe<0 || detail_spacing_m<=0.0) return;
    vec2 grid=(world_xz-detail_origin)/detail_spacing_m;
    if(any(lessThan(grid,vec2(0.0))) || any(greaterThan(grid,detail_grid_size-vec2(1.0)))) return;
    grid=clamp(grid,vec2(0.0),detail_grid_size-vec2(1.00001));
    ivec2 cell=ivec2(floor(grid)); vec2 f=fract(grid);
    vec4 weights=vec4((1.0-f.x)*(1.0-f.y),f.x*(1.0-f.y),(1.0-f.x)*f.y,f.x*f.y);
    vec4 samples[4];
    samples[0]=texelFetch(geometry_detail_map,cell,0);
    samples[1]=texelFetch(geometry_detail_map,cell+ivec2(1,0),0);
    samples[2]=texelFetch(geometry_detail_map,cell+ivec2(0,1),0);
    samples[3]=texelFetch(geometry_detail_map,cell+ivec2(1,1),0);
    vec3 sum=vec3(0.0);
    for(int i=0;i<4;i++) {
        float weight=weights[i];
        float effective=clamp(samples[i].g,0.0,1.0);
        int unit=int(round(samples[i].b));
        vec4 color=detail_rock_colors[clamp(unit,0,63)];
        vec3 unit_color=unit>=0 && unit<64 && color.a>0.5 ? color.rgb : fallback_color;
        exposure+=weight*effective;
        sum+=unit_color*(weight*effective);
        slope+=samples[i].r*weight;
        confidence+=clamp(samples[i].a,0.0,1.0)*weight;
    }
    if(exposure>0.00001) rock_color=sum/exposure;
}
