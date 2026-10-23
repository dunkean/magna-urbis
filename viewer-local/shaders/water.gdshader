shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_disabled;
// All colour uniforms are explicitly LINEAR. Compatibility emits sRGB ALBEDO.
uniform vec3 tint = vec3(0.035, 0.17, 0.20); // Legacy explicit-linear fallback.
uniform vec3 linear_tint = vec3(-1.0);
uniform int presentation_mode = 0; // 0 aerial, 1 cartographic flat shared style.
uniform vec2 wave_phase = vec2(0.0);
uniform bool coverage_enabled = false;
uniform sampler2D coverage_map : filter_linear_mipmap, repeat_disable;
uniform vec2 coverage_origin_local;
uniform float coverage_spacing = 1.0;
uniform vec2 coverage_grid_size = vec2(1.0);
uniform bool bed_clip_enabled = false;
uniform sampler2D bed_map : filter_nearest, repeat_disable;
uniform vec2 bed_origin_local;
uniform float bed_spacing = 1.0;
uniform vec2 bed_grid_size = vec2(1.0);
uniform vec4 bed_bounds_local = vec4(0.0);
uniform bool bed_cubic = false;
uniform float render_origin_y = 0.0;
varying vec3 local_position;
float bed_at(ivec2 p) {
    return texelFetch(bed_map, clamp(p, ivec2(0), ivec2(bed_grid_size)-1), 0).r;
}
vec4 bspline(float t) {
    float a=1.0-t;
    return vec4(a*a*a,3.0*t*t*t-6.0*t*t+4.0,-3.0*t*t*t+3.0*t*t+3.0*t+1.0,t*t*t)/6.0;
}
float resolved_bed(vec2 position) {
    vec2 uv=(position-bed_origin_local)/bed_spacing;
    if(!bed_cubic) uv=clamp(uv,vec2(0.0),bed_grid_size-1.0);
    ivec2 p=ivec2(floor(uv)); vec2 f=fract(uv);
    if(!bed_cubic) return mix(mix(bed_at(p),bed_at(p+ivec2(1,0)),f.x),mix(bed_at(p+ivec2(0,1)),bed_at(p+ivec2(1)),f.x),f.y);
    vec4 wx=bspline(f.x); vec4 wz=bspline(f.y); float value=0.0;
    for(int j=0;j<4;j++) for(int i=0;i<4;i++) value+=bed_at(p+ivec2(i-1,j-1))*wx[i]*wz[j];
    return value;
}
vec3 display_color(vec3 linear_color) {
    if(OUTPUT_IS_SRGB) return mix(linear_color*12.92,1.055*pow(max(linear_color,vec3(0.0)),vec3(1.0/2.4))-0.055,step(vec3(0.0031308),linear_color));
    return linear_color;
}
void vertex() { local_position=(MODEL_MATRIX*vec4(VERTEX,1.0)).xyz; }
void fragment() {
    float coverage=1.0;
    vec2 cell=(local_position.xz-coverage_origin_local)/coverage_spacing;
    // Derivatives precede every data-dependent discard and branch.
    vec2 cell_dx=dFdx(cell); vec2 cell_dy=dFdy(cell);
    float pixel_footprint=max(length(dFdx(local_position.xz)),length(dFdy(local_position.xz)));
    if(coverage_enabled) {
        if(any(lessThan(cell,vec2(-0.5))) || any(greaterThanEqual(cell,coverage_grid_size-0.5))) discard;
        // Near: exact categorical cells. Far: linear area mips, never any-wet.
        vec2 footprint=max(abs(cell_dx),abs(cell_dy));
        if(max(footprint.x,footprint.y)<=1.0) coverage=texelFetch(coverage_map,ivec2(floor(cell+0.5)),0).r;
        else coverage=textureGrad(coverage_map,(cell+0.5)/coverage_grid_size,cell_dx/coverage_grid_size,cell_dy/coverage_grid_size).r;
        if(coverage<=0.001) discard;
    }
    if(bed_clip_enabled && all(greaterThanEqual(local_position.xz,bed_bounds_local.xy)) && all(lessThanEqual(local_position.xz,bed_bounds_local.zw))) {
        if(local_position.y+render_origin_y-resolved_bed(local_position.xz)<0.001) discard;
    }
    float wave=sin(local_position.x*0.32+wave_phase.x)*sin(local_position.z*0.27+wave_phase.y)*0.018*(1.0-smoothstep(4.9,9.8,pixel_footprint));
    vec3 water_color=linear_tint.x>=0.0?linear_tint:tint;
    ALPHA=coverage;
    if(presentation_mode==1) {
        ALBEDO=vec3(0.0); EMISSION=display_color(water_color);
        ROUGHNESS=1.0; METALLIC=0.0; SPECULAR=0.0;
    } else {
        ALBEDO=display_color(max(water_color+vec3(wave),vec3(0.0)));
        ROUGHNESS=0.16; METALLIC=0.05; SPECULAR=0.65;
    }
    #if CURRENT_RENDERER == RENDERER_COMPATIBILITY
    DEPTH=FRAGCOORD.z-0.0000003;
    #else
    DEPTH=FRAGCOORD.z+0.0000003;
    #endif
}
