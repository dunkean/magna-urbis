shader_type spatial;
render_mode cull_disabled;
#include "color_space.gdshaderinc"
uniform sampler2D baseColor_texture : source_color, filter_linear_mipmap_anisotropic, repeat_disable;
uniform sampler2D normal_texture : hint_normal, filter_linear_mipmap_anisotropic, repeat_disable;
uniform sampler2D arm_texture : filter_linear_mipmap_anisotropic, repeat_disable;
uniform sampler2D alpha_texture : filter_linear_mipmap_anisotropic, repeat_disable;
uniform vec3 source_mean_linear=vec3(1.0);
uniform mat4 main_camera_view;
uniform mat4 main_camera_projection;
uniform vec2 main_viewport_size=vec2(1.0);
varying vec3 instance_linear_albedo;
varying float projected_size;
varying vec3 world_normal;
varying vec3 world_tangent;
varying vec3 world_binormal;
void vertex(){
    instance_linear_albedo=COLOR.rgb;
    // Shadow passes use the same main-camera fade as the visible blade.
    vec4 centre_view=main_camera_view*MODEL_MATRIX*vec4(0.0,0.0,0.0,1.0);
    float denominator=main_camera_projection[3][3]>0.5?1.0:max(0.001,-centre_view.z);
    projected_size=INSTANCE_CUSTOM.r*abs(main_camera_projection[1][1])*main_viewport_size.y/(2.0*denominator);
    world_normal=normalize(transpose(inverse(mat3(MODEL_MATRIX)))*NORMAL);
    world_tangent=normalize(mat3(MODEL_MATRIX)*TANGENT);
    world_binormal=normalize(mat3(MODEL_MATRIX)*BINORMAL);
}
void fragment(){
    vec3 n=normalize(world_normal);
    vec3 t=normalize(world_tangent-n*dot(n,world_tangent));
    vec3 b=normalize(world_binormal-n*dot(n,world_binormal));
    vec3 mapped=texture(normal_texture,UV).xyz*2.0-1.0;
    vec3 normal_world=normalize(t*mapped.x+b*mapped.y+n*mapped.z);
    NORMAL=normalize(mat3(VIEW_MATRIX)*normal_world)*(FRONT_FACING?1.0:-1.0);
    vec3 detail=texture(baseColor_texture,UV).rgb/max(source_mean_linear,vec3(.0001));
    ALBEDO=display_color(clamp(detail*instance_linear_albedo,vec3(0.0),vec3(1.0)));
    vec3 arm=texture(arm_texture,UV).rgb;
    AO=arm.r;ROUGHNESS=arm.g;METALLIC=0.0;SPECULAR=.25;
    ALPHA=texture(alpha_texture,UV).r*smoothstep(1.25,3.0,projected_size);
    ALPHA_HASH_SCALE=1.0;
}
