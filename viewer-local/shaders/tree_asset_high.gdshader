shader_type spatial;
render_mode cull_disabled;
#include "canopy.gdshaderinc"
#include "forest_oblique.gdshaderinc"
#include "color_space.gdshaderinc"
uniform sampler2D tree_albedo : source_color,filter_linear_mipmap_anisotropic,repeat_enable;
uniform sampler2D tree_normal : hint_normal,filter_linear_mipmap_anisotropic,repeat_enable;
uniform sampler2D tree_roughness : filter_linear_mipmap_anisotropic,repeat_enable;
uniform sampler2D tree_top_mask : filter_linear,repeat_disable;
uniform vec3 tree_uv_scale=vec3(1.0);
uniform vec3 tree_uv_offset=vec3(0.0);
uniform vec4 tree_roughness_channel=vec4(0,1,0,0);
uniform vec4 tree_albedo_factor=vec4(1.0);
uniform float tree_roughness_factor=1.0;
uniform float tree_normal_scale=1.0;
uniform bool tree_cutout=false;
uniform bool tree_main_top=true;
varying vec3 tree_world_position;
varying vec3 tree_local_position;
varying flat int tree_class;
varying vec3 tree_n;
varying vec3 tree_t;
varying vec3 tree_b;
void vertex(){
 tree_local_position=VERTEX;
 tree_world_position=(MODEL_MATRIX*vec4(VERTEX,1.0)).xyz;
 tree_class=int(INSTANCE_CUSTOM.g+.5);
 tree_n=normalize(transpose(inverse(mat3(MODEL_MATRIX)))*NORMAL);
 tree_t=normalize(mat3(MODEL_MATRIX)*TANGENT);
 tree_b=normalize(mat3(MODEL_MATRIX)*BINORMAL);
 UV=UV*tree_uv_scale.xy+tree_uv_offset.xy;
}
void fragment(){
 vec4 source=texture(tree_albedo,UV)*tree_albedo_factor;
 float cutout=tree_cutout?step(.5,source.a):1.0;
 // TOP shares the exact footprint stencil with C/counts and the optical quad.
 // Oblique retains the actual asset silhouette; top-footprint C/V is approximate.
 if(tree_main_top)cutout*=step(.5,textureLod(tree_top_mask,(tree_local_position.xz+vec2(1.1))/2.2,0.0).r);
 vec3 n=normalize(tree_n);vec3 t=normalize(tree_t-n*dot(n,tree_t));vec3 cross_nt=normalize(cross(n,t));vec3 b=cross_nt*(dot(cross_nt,tree_b)<0.0?-1.0:1.0);
 vec2 xy=(texture(tree_normal,UV).rg*2.0-1.0)*tree_normal_scale;
 vec3 mapped=normalize(vec3(xy,sqrt(max(.00001,1.0-dot(xy,xy)))));
 NORMAL=normalize(mat3(VIEW_MATRIX)*(t*mapped.x+b*mapped.y+n*mapped.z))*(FRONT_FACING?1.0:-1.0);
 ALBEDO=display_color(source.rgb);
 ROUGHNESS=clamp(dot(texture(tree_roughness,UV),tree_roughness_channel)*tree_roughness_factor,.04,1.0);SPECULAR=.25;
 float footprint=canopy_main_pixel_footprint(tree_world_position.xz,PROJECTION_MATRIX*VIEW_MATRIX,VIEWPORT_SIZE);
 if(forest_oblique_full_enabled){
  if(cutout<.5 || forest_oblique_selector(FRAGCOORD.xy)<.5)discard;
  ALPHA=1.0;ALPHA_SCISSOR_THRESHOLD=.5;
 }else{ALPHA=cutout*canopy_geometry_weight*canopy_instance_weight(tree_class,footprint);ALPHA_HASH_SCALE=1.0;}
}
