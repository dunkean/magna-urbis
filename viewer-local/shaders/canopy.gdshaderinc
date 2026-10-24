// canopy-r4. RGB and coverage are linear. Counts have NO mipmaps.
#include "res://shaders/canopy_meso.gdshaderinc"
uniform bool canopy_enabled = false;
uniform float canopy_exact_weight=0.0;
uniform float canopy_geometry_weight=0.0;
// A shadow pass has a different VIEW/PROJECTION. LOD always uses the main camera.
uniform bool canopy_main_camera_enabled=false;
uniform mat4 canopy_main_camera_vp;
uniform vec2 canopy_main_viewport_size=vec2(1.0);
uniform sampler2D canopy_coverage : filter_linear_mipmap, repeat_disable;
uniform bool canopy_normals_enabled=false;
uniform sampler2D canopy_normals : filter_linear_mipmap, repeat_disable;
uniform sampler2D canopy_colors : filter_linear_mipmap, repeat_disable;
uniform sampler2D canopy_counts : filter_nearest, repeat_disable;
uniform vec2 canopy_origin;
uniform vec2 canopy_grid_size = vec2(2.0);
uniform float canopy_spacing_m = 1.0;
uniform vec4 canopy_bounds;
uniform float canopy_fallback_blend_m = 16.0;
// Renderer-only approximate shadow transfer for painted crowns, not source geometry.
uniform bool canopy_shadow_use_total=true;
// Whole-view transfer to native solar shadow maps; no local page-edge blend.
uniform float canopy_native_shadow_weight=0.0;
uniform vec2 canopy_shadow_offset=vec2(4.7,-8.5);
uniform vec3 canopy_shadow_transmittance=vec3(.25,.34,.50);
uniform float canopy_shadow_angular_diameter_degrees=0.0;
uniform float canopy_shadow_reference_height_m=9.80388349514563;
uniform float canopy_shadow_reconstruction_texels=0.0;
uniform vec3 canopy_linear_albedo = vec3(0.055,0.105,0.036);
// One common horizontal reference plane, in the current rebased frame. Both
// representations project the same world-XZ point onto this plane each pixel.
uniform float canopy_reference_y = 0.0;
uniform float canopy_footprint_override_m = 0.0; // diagnostics only

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
float canopy_main_pixel_footprint(vec2 p,mat4 fallback_projection,vec2 fallback_size) {
    return canopy_pixel_footprint(p,canopy_main_camera_enabled?canopy_main_camera_vp:fallback_projection,canopy_main_camera_enabled?canopy_main_viewport_size:fallback_size);
}
float canopy_visible_at(ivec2 texel,float footprint_m) {
    vec4 counts=texelFetch(canopy_counts,texel,0);
    float transmittance=1.0;
    for(int b=0;b<4;b++) if(counts[b]>0.0) transmittance*=pow(max(0.0,1.0-canopy_geometry_weight*canopy_instance_weight(b,footprint_m)),counts[b]);
    return 1.0-transmittance;
}
// Filter per-texel transmittance with the SAME dyadic kernel as coverage.
// Counts themselves are never mipmapped or averaged before pow(). The atlas
// uses power-of-two dimensions and a world-aligned dyadic origin.
float canopy_visible_mip_at(ivec2 cell,int level,float footprint_m) {
    cell=clamp(cell,ivec2(0),textureSize(canopy_coverage,level)-ivec2(1));
    if(level==0)return canopy_visible_at(clamp(cell,ivec2(0),ivec2(canopy_grid_size)-ivec2(1)),footprint_m);
    int side=1<<level;
    float visible=0.0;
    for(int z=0;z<8;z++){
      if(z>=side)break;
      for(int x=0;x<8;x++){
        if(x>=side)break;
        visible+=canopy_visible_at(clamp(cell*side+ivec2(x,z),ivec2(0),ivec2(canopy_grid_size)-ivec2(1)),footprint_m);
    }
    }
    return visible/float(side*side);
}
float canopy_visible_mip(vec2 uv,int level,float footprint_m) {
    vec2 size=vec2(textureSize(canopy_coverage,level));
    vec2 grid=clamp(uv*size-vec2(.5),vec2(0),max(vec2(0),size-vec2(1)));
    ivec2 cell=ivec2(floor(grid));vec2 f=fract(grid);
    return mix(mix(canopy_visible_mip_at(cell,level,footprint_m),canopy_visible_mip_at(cell+ivec2(1,0),level,footprint_m),f.x),
               mix(canopy_visible_mip_at(cell+ivec2(0,1),level,footprint_m),canopy_visible_mip_at(cell+ivec2(1,1),level,footprint_m),f.x),f.y);
}
float surface_canopy_selected_visibility(vec2 world_xz,float footprint_m) {
    if(!canopy_enabled || canopy_geometry_weight<=0.0 || canopy_instance_weight(3,footprint_m)<=0.0)return 0.0;
    vec2 uv=((world_xz-canopy_origin)/canopy_spacing_m+vec2(.5))/canopy_grid_size;
    int maximum=min(3,int(floor(log2(min(canopy_grid_size.x,canopy_grid_size.y)))));
    float lod=clamp(log2(max(footprint_m/canopy_spacing_m,1.0)),0.0,float(maximum));
    int low=int(floor(lod));int high=min(low+1,maximum);
    return mix(canopy_visible_mip(uv,low,footprint_m),canopy_visible_mip(uv,high,footprint_m),fract(lod));
}
float canopy_coverage_mip(vec2 uv,int level) {
    vec2 size=vec2(textureSize(canopy_coverage,level));
    vec2 grid=clamp(uv*size-vec2(.5),vec2(0),max(vec2(0),size-vec2(1)));
    ivec2 cell=ivec2(floor(grid));vec2 f=fract(grid);
    ivec2 upper=ivec2(size)-ivec2(1);
    return mix(mix(texelFetch(canopy_coverage,cell,level).r,texelFetch(canopy_coverage,min(cell+ivec2(1,0),upper),level).r,f.x),
               mix(texelFetch(canopy_coverage,min(cell+ivec2(0,1),upper),level).r,texelFetch(canopy_coverage,min(cell+ivec2(1,1),upper),level).r,f.x),f.y);
}
float canopy_coverage_filtered(vec2 uv,float lod) {
    int maximum=int(floor(log2(min(canopy_grid_size.x,canopy_grid_size.y))));
    lod=clamp(lod,0.0,float(maximum));int low=int(floor(lod));
    return mix(canopy_coverage_mip(uv,low),canopy_coverage_mip(uv,min(low+1,maximum)),fract(lod));
}
// Exact identity at each filtered query: V+(1-V)*G=C. Budgeted-out and
// culled candidates remain in C, so a geometry cap never clears the forest.
float surface_canopy_target(vec2 world_xz,float footprint_m,float mean_cover) {
    float meso=canopy_meso_cover(world_xz,footprint_m,mean_cover);
    if(!canopy_enabled) return meso;
    vec2 uv=((world_xz-canopy_origin)/canopy_spacing_m+vec2(0.5))/canopy_grid_size;
    float local=clamp(canopy_exact_weight,0.0,1.0);
    float lod=max(0.0,log2(max(footprint_m/canopy_spacing_m,1.0)));
    float exact=canopy_coverage_filtered(uv,lod);
    return mix(meso,exact,local);
}
float surface_canopy_residual(vec2 world_xz,float footprint_m,float mean_cover) {
    float total=surface_canopy_target(world_xz,footprint_m,mean_cover);
    if(!canopy_enabled)return total;
    float visible=surface_canopy_selected_visibility(world_xz,footprint_m);
    // A single viewport phase forbids geometry until the entire view is exact.
    // Complete-page inventory and identical filtering make visible <= total.
    // The host certificate disables geometry globally if footprint/activeSpacing
    // exceeds the common kernel. Do not hide a broken certificate by clamping V.
    return visible>=0.999999 ? 0.0 : (total-visible)/(1.0-visible);
}
float surface_canopy_shadow_target(vec2 p,float footprint,float cover){
    float diameter=2.0*clamp(canopy_shadow_reference_height_m,0.0,32.0)*tan(radians(clamp(canopy_shadow_angular_diameter_degrees,0.0,2.0))*.5);
    // Reconstruction bandwidth is not a physical solar angle or a visibility
    // change. Keep a coarsely rasterized shadow from exposing source texel steps.
    float reconstruction=canopy_enabled?clamp(canopy_shadow_reconstruction_texels,0.0,2.0)*canopy_spacing_m:0.0;
    return surface_canopy_target(p,max(max(footprint,min(diameter,1.0)),reconstruction),cover);
}
vec3 surface_canopy_color(vec2 p,float footprint){
    if(!canopy_asset_enabled || !canopy_enabled)return canopy_linear_albedo;
    vec2 uv=((p-canopy_origin)/canopy_spacing_m+vec2(.5))/canopy_grid_size;
    float lod=max(0.0,log2(max(footprint/canopy_spacing_m,1.0)));
    vec4 c=textureLod(canopy_colors,uv,lod);
    return mix(canopy_linear_albedo,c.a>.00001?c.rgb/c.a:canopy_linear_albedo,clamp(canopy_exact_weight,0.0,1.0));
}

vec3 surface_canopy_normal(vec2 p,float footprint,float mean_cover) {
    vec3 approximate=canopy_meso_normal(p,footprint,mean_cover);
    if(!canopy_enabled || !canopy_normals_enabled)return approximate;
    float local=clamp(canopy_exact_weight,0.0,1.0);
    vec2 uv=((p-canopy_origin)/canopy_spacing_m+vec2(.5))/canopy_grid_size;
    float lod=max(0.0,log2(max(footprint/canopy_spacing_m,1.0)));
    vec4 n=textureLod(canopy_normals,uv,lod);
    vec3 exact=n.a>.00001?normalize(n.rgb/n.a*2.0-1.0):vec3(0,1,0);
    return normalize(mix(approximate,exact,local));
}
