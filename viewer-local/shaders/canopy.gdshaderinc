// canopy-r1. RGB and coverage are linear. Counts have NO mipmaps.
uniform bool canopy_enabled = false;
uniform sampler2D canopy_coverage : filter_linear_mipmap, repeat_disable;
uniform sampler2D canopy_counts : filter_nearest, repeat_disable;
uniform vec2 canopy_origin;
uniform vec2 canopy_grid_size = vec2(2.0);
uniform float canopy_spacing_m = 1.0;
uniform vec4 canopy_bounds;
uniform float canopy_fallback_blend_m = 16.0;
uniform vec3 canopy_linear_albedo = vec3(0.055,0.105,0.036);
// One common horizontal reference plane, in the current rebased frame. Both
// representations project the same world-XZ point onto this plane each pixel.
uniform float canopy_reference_y = 0.0;
uniform float canopy_footprint_override_m = 0.0; // diagnostics only

float canopy_radius_for_class(int cls) {
    if(cls==0) return 2.5;
    if(cls==1) return 4.0;
    if(cls==2) return 5.5;
    return 7.0;
}
float canopy_instance_weight(int cls,float footprint_m) {
    return smoothstep(1.25,3.0,2.0*canopy_radius_for_class(cls)/max(footprint_m,0.00001));
}
float canopy_pixel_footprint(vec2 world_xz,mat4 view_projection,vec2 viewport_size) {
    if(canopy_footprint_override_m>0.0) return canopy_footprint_override_m;
    vec4 point=view_projection*vec4(world_xz.x,canopy_reference_y,world_xz.y,1.0);
    vec4 east=view_projection*vec4(world_xz.x+1.0,canopy_reference_y,world_xz.y,1.0);
    vec4 south=view_projection*vec4(world_xz.x,canopy_reference_y,world_xz.y+1.0,1.0);
    if(point.w<=0.0 || east.w<=0.0 || south.w<=0.0) return 1000000.0;
    vec2 ndc=point.xy/point.w;
    float east_pixels=length((east.xy/east.w-ndc)*viewport_size*0.5);
    float south_pixels=length((south.xy/south.w-ndc)*viewport_size*0.5);
    return 1.0/max(min(east_pixels,south_pixels),0.000001);
}
float canopy_visible_at(ivec2 texel,float footprint_m) {
    vec4 counts=texelFetch(canopy_counts,texel,0);
    float transmittance=1.0;
    for(int b=0;b<4;b++) if(counts[b]>0.0) transmittance*=pow(max(0.0,1.0-canopy_instance_weight(b,footprint_m)),counts[b]);
    return 1.0-transmittance;
}
// Exact identity at each filtered query: V+(1-V)*G=C. Budgeted-out and
// culled candidates remain in C, so a geometry cap never clears the forest.
float surface_canopy_residual(vec2 world_xz,float footprint_m,float mean_cover) {
    if(!canopy_enabled) return clamp(mean_cover,0.0,1.0);
    vec2 uv=((world_xz-canopy_origin)/canopy_spacing_m+vec2(0.5))/canopy_grid_size;
    float edge=min(min(world_xz.x-canopy_bounds.x,canopy_bounds.z-world_xz.x),min(world_xz.y-canopy_bounds.y,canopy_bounds.w-world_xz.y));
    float local=smoothstep(0.0,max(canopy_fallback_blend_m,0.00001),edge);
    float lod=max(0.0,log2(max(footprint_m/canopy_spacing_m,1.0)));
    float total=mix(clamp(mean_cover,0.0,1.0),textureLod(canopy_coverage,uv,lod).r,local);
    vec2 grid=clamp(uv*canopy_grid_size-vec2(0.5),vec2(0.0),canopy_grid_size-vec2(1.001));
    ivec2 cell=ivec2(floor(grid)); vec2 f=fract(grid);
    // Interpolate TRANSMITTANCES, never counts: pow(E[count]) creates area.
    float visible=mix(mix(canopy_visible_at(cell,footprint_m),canopy_visible_at(cell+ivec2(1,0),footprint_m),f.x),
        mix(canopy_visible_at(cell+ivec2(0,1),footprint_m),canopy_visible_at(cell+ivec2(1,1),footprint_m),f.x),f.y);
    // Selection keeps entire selected crowns inside the full-confidence atlas
    // interior. Consequently no geometry exists in the analytic-mean halo.
    visible=min(total,visible*local);
    return visible>=0.999999 ? 0.0 : clamp((total-visible)/(1.0-visible),0.0,1.0);
}
