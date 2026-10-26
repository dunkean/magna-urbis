#include "res://shaders/color_space.gdshaderinc"
#include "res://shaders/normal_frame.gdshaderinc"
#include "res://shaders/canopy.gdshaderinc"
#include "res://shaders/geometry_detail.gdshaderinc"
// SurfaceWorld data. Values are linear; categorical texture uses nearest filtering.
uniform sampler2D surface_ids : filter_nearest, repeat_disable;
uniform bool surface_layers_explicit = false;
uniform bool show_ground = true;
uniform bool show_low_cover = true;
uniform bool show_trees = true;
uniform sampler2D low_cover_ids : filter_nearest, repeat_disable;
// Premultiplied linear RGB, coverage alpha. Mips must preserve that convention.
uniform sampler2D low_cover_average : filter_linear_mipmap, repeat_disable;
uniform sampler2D low_cover_state : filter_linear_mipmap, repeat_disable;
uniform sampler2D surface_state : filter_linear_mipmap, repeat_disable;
uniform sampler2D surface_bedrock : filter_nearest, repeat_disable;
uniform sampler2D surface_average : filter_linear_mipmap, repeat_disable;
uniform vec2 source_origin;
uniform vec2 source_extent;
uniform vec2 material_phase[32];
uniform float material_phase_y[32];
uniform vec4 material_lattice_xz[32];
uniform vec4 material_lattice_zy[32];
uniform vec4 material_lattice_xy[32];
uniform vec4 noise_phase_16;
uniform vec4 noise_phase_9;
uniform vec4 layer_mean[32];
uniform vec4 palette[32];
uniform float material_scales[32];
uniform int material_layers[32];
// RGB is linear half-float; alpha is normalized physical height. Mips are linear too.
uniform sampler2DArray pbr_albedo_height : filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2DArray pbr_normal_rough : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform int diagnostic = 0;
uniform float micro_strength = 0.55;
uniform vec4 candidate_bounds = vec4(-1e8,-1e8,1e8,1e8);
uniform float source_spacing_m = 15.0;
uniform vec2 source_grid_size;
uniform int presentation_mode = 0;
uniform vec4 map_palette[32];
uniform float map_relief_shade = 0.0;
#include "res://shaders/ground_response.gdshaderinc"


#include "res://shaders/pbr_stochastic.gdshaderinc"

void sample_surface_material(vec3 p, vec3 dx, vec3 dy, vec3 normal, vec3 tangent, vec3 binormal, int id, out vec4 ah, out vec4 nr) {
    float scale=max(material_scales[id],0.25);
    int layer=material_layers[id];
    vec2 phase=material_phase[id];
    float yphase=material_phase_y[id];
    vec2 uv=p.xz/scale;
    sample_pbr(uv,dx.xz/scale,dy.xz/scale,layer,phase,material_lattice_xz[id],ah,nr);
    if(abs(normal.y)<0.9999) {
        vec2 uv_x=vec2(p.z,-p.y)/scale;
        vec2 uv_z=vec2(p.x,-p.y)/scale;
        vec4 ax; vec4 nx; vec4 az; vec4 nz;
        sample_pbr(uv_x,vec2(dx.z,-dx.y)/scale,vec2(dy.z,-dy.y)/scale,layer,vec2(phase.y,yphase),material_lattice_zy[id],ax,nx);
        sample_pbr(uv_z,vec2(dx.x,-dx.y)/scale,vec2(dy.x,-dy.y)/scale,layer,vec2(phase.x,yphase),material_lattice_xy[id],az,nz);
        vec3 weights=pow(abs(normal),vec3(6.0));
        weights/=max(dot(weights,vec3(1.0)),0.0001);
        vec3 n0=nr.xyz*2.0-1.0;
        vec3 n1=nx.xyz*2.0-1.0;
        vec3 n2=nz.xyz*2.0-1.0;
        vec3 perturb=vec3(n0.x,n0.z-1.0,-n0.y)*weights.y
            +vec3((n1.z-1.0)*sign(normal.x),n1.y,n1.x)*weights.x
            +vec3(n2.x,n2.y,(n2.z-1.0)*sign(normal.z))*weights.z;
        vec3 tangent_normal=normalize(vec3(dot(perturb,tangent),dot(perturb,binormal),1.0+dot(perturb,normal)));
        float rough=nr.a*weights.y+nx.a*weights.x+nz.a*weights.z;
        nr=vec4(tangent_normal*0.5+0.5,rough);
        ah=ah*weights.y+ax*weights.x+az*weights.z;
    }
}

// Exact union of validated source/parent domains, in render-local metres.
uniform int source_coverage_count = 0;
uniform vec4 source_coverage_rects[7];

bool surface_source_contains(vec2 position) {
    bool covered=false;
    for(int i=0;i<7;i++) {
        if(i>=source_coverage_count) break;
        vec4 bounds=source_coverage_rects[i];
        covered=covered || (all(greaterThanEqual(position,bounds.xy)) && all(lessThanEqual(position,bounds.zw)));
    }
    return covered;
}
