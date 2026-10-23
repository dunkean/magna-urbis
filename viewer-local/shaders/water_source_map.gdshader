shader_type spatial;
// Explicit renderer-only source-map overlay. Source coordinates and measured
// levels remain intact; this material does NOT claim a physical water surface.
// It ignores terrain depth, so bridges/buildings require an explicit map-order
// policy in the scene compositor. Do not use this shader as a physical fallback.
render_mode unshaded, blend_mix, depth_test_disabled, depth_draw_never, cull_disabled;
uniform vec3 linear_tint = vec3(0.028,0.10,0.115);
uniform bool class_enabled = false;
uniform sampler2D class_map : filter_nearest, repeat_disable;
uniform vec2 class_origin_local;
uniform vec2 class_grid_size = vec2(1.0);
uniform float class_spacing = 1.0;
uniform vec3 linear_river_tint = vec3(0.035,0.17,0.20);
uniform vec3 linear_lake_tint = vec3(0.028,0.10,0.115);
uniform vec3 linear_sea_tint = vec3(0.018,0.095,0.125);
uniform bool coverage_enabled = false;
uniform sampler2D coverage_map : filter_linear_mipmap, repeat_disable;
uniform vec2 coverage_origin_local;
uniform float coverage_spacing = 1.0;
uniform vec2 coverage_grid_size = vec2(1.0);
varying vec3 local_position;
vec3 display_color(vec3 linear_color) {
    if(OUTPUT_IS_SRGB) return mix(linear_color*12.92,1.055*pow(max(linear_color,vec3(0.0)),vec3(1.0/2.4))-0.055,step(vec3(0.0031308),linear_color));
    return linear_color;
}
void vertex() { local_position=(MODEL_MATRIX*vec4(VERTEX,1.0)).xyz; }
void fragment() {
    float coverage=1.0;
    vec2 cell=(local_position.xz-coverage_origin_local)/coverage_spacing;
    vec2 dx=dFdx(cell); vec2 dy=dFdy(cell);
    if(coverage_enabled) {
        if(any(lessThan(cell,vec2(-0.5))) || any(greaterThanEqual(cell,coverage_grid_size-0.5))) discard;
        if(max(max(abs(dx.x),abs(dx.y)),max(abs(dy.x),abs(dy.y)))<=1.0) coverage=texelFetch(coverage_map,ivec2(floor(cell+0.5)),0).r;
        else coverage=textureGrad(coverage_map,(cell+0.5)/coverage_grid_size,dx/coverage_grid_size,dy/coverage_grid_size).r;
        if(coverage<=0.001) discard;
    }
    vec3 color=linear_tint;
    if(class_enabled) {
        vec2 coordinate=(local_position.xz-class_origin_local)/class_spacing;
        if(all(greaterThanEqual(coordinate,vec2(-0.5))) && all(lessThan(coordinate,class_grid_size-0.5))) {
            int kind=int(texelFetch(class_map,ivec2(floor(coordinate+0.5)),0).r+0.5);
            if(kind==1) color=linear_river_tint;
            else if(kind==2) color=linear_lake_tint;
            else if(kind==3) color=linear_sea_tint;
        }
    }
    ALBEDO=display_color(color);
    ALPHA=coverage;
}
