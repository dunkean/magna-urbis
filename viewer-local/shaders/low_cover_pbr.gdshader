shader_type spatial;
render_mode cull_disabled;
// Existing registered ground-cover PBR on authored leaves/twigs, not a botanical scan.
#include "res://shaders/color_space.gdshaderinc"
#include "res://shaders/normal_frame.gdshaderinc"
uniform sampler2DArray pbr_albedo_height : filter_linear_mipmap_anisotropic,repeat_enable;
uniform sampler2DArray pbr_normal_rough : hint_normal,filter_linear_mipmap_anisotropic,repeat_enable;
uniform vec4 layer_mean[32];
uniform int clast_layer=0;
uniform float clast_scale_m=3.0;
uniform vec3 clast_phase;
uniform vec4 clast_lattice_xz;
uniform vec4 clast_lattice_zy;
uniform vec4 clast_lattice_xy;
uniform mat4 main_camera_view;
uniform mat4 main_camera_projection;
uniform vec2 main_viewport_size=vec2(1.0);
#include "res://shaders/pbr_stochastic.gdshaderinc"
varying vec3 clast_physical_position;
varying vec3 source_mean;
varying vec3 world_normal;
varying vec3 world_tangent;
varying vec3 world_binormal;
varying float projected_size;
void vertex(){
    // Anchored physical metres without adding/subtracting a large translation.
    clast_physical_position=mat3(MODEL_MATRIX)*VERTEX;
    source_mean=COLOR.rgb;
    world_normal=transpose(inverse(mat3(MODEL_MATRIX)))*NORMAL;
    world_tangent=mat3(MODEL_MATRIX)*TANGENT;
    world_binormal=mat3(MODEL_MATRIX)*BINORMAL;
    // Same alpha decision in main/shadow passes, independent of light matrices.
    vec4 centre=main_camera_view*MODEL_MATRIX*vec4(0,0,0,1);
    float denominator=main_camera_projection[3][3]>.5?1.0:max(.001,-centre.z);
    projected_size=INSTANCE_CUSTOM.r*abs(main_camera_projection[1][1])*main_viewport_size.y/(2.0*denominator);
}
void fragment(){
    vec3 n=normalize(world_normal);
    vec3 t=normalize(world_tangent-n*dot(n,world_tangent));
    vec3 crossed=normalize(cross(n,t));vec3 b=crossed*(dot(crossed,world_binormal)<0.0?-1.0:1.0);
    vec3 p=clast_physical_position/max(clast_scale_m,.25);
    vec3 dx=dFdx(p);vec3 dy=dFdy(p);
    vec4 ay;vec4 ny;vec4 ax;vec4 nx;vec4 az;vec4 nz;
    sample_pbr(p.xz,dx.xz,dy.xz,clast_layer,clast_phase.xz,clast_lattice_xz,ay,ny);
    sample_pbr(vec2(p.z,-p.y),vec2(dx.z,-dx.y),vec2(dy.z,-dy.y),clast_layer,clast_phase.zy,clast_lattice_zy,ax,nx);
    sample_pbr(vec2(p.x,-p.y),vec2(dx.x,-dx.y),vec2(dy.x,-dy.y),clast_layer,clast_phase.xy,clast_lattice_xy,az,nz);
    vec3 weights=pow(abs(n),vec3(6));weights/=max(dot(weights,vec3(1)),.00001);
    vec3 residual=ay.rgb*weights.y+ax.rgb*weights.x+az.rgb*weights.z;
    vec3 mean=clamp(source_mean,vec3(0),vec3(1));vec3 registered_mean=layer_mean[clast_layer].rgb;
    // Derived range bound, not a fitted tint. It keeps zero-mean texture residuals
    // inside[0,1] around the canonical source-rock RGB without clamp bias.
    vec3 amplitude=min(mean/max(registered_mean,vec3(.00001)),(vec3(1)-mean)/max(vec3(1)-registered_mean,vec3(.00001)));
    ALBEDO=display_color(clamp(mean+residual*amplitude,vec3(0),vec3(1)));
    vec3 n0=ny.xyz*2.0-1.0;vec3 n1=nx.xyz*2.0-1.0;vec3 n2=nz.xyz*2.0-1.0;
    vec3 perturb=vec3(n0.x,(n0.z-1.0)*sign(n.y),-n0.y)*weights.y
      +vec3((n1.z-1.0)*sign(n.x),n1.y,n1.x)*weights.x
      +vec3(n2.x,n2.y,(n2.z-1.0)*sign(n.z))*weights.z;
    vec3 tangent_normal=normalize(vec3(dot(perturb,t),dot(perturb,b),1.0+dot(perturb,n)));
    NORMAL=normalize(mat3(VIEW_MATRIX)*(t*tangent_normal.x+b*tangent_normal.y+n*tangent_normal.z))*(FRONT_FACING?1.0:-1.0);
    ROUGHNESS=ny.a*weights.y+nx.a*weights.x+nz.a*weights.z;SPECULAR=.25;
    ALPHA=smoothstep(1.25,3.0,projected_size);ALPHA_HASH_SCALE=1.0;
}
