shader_type spatial;
render_mode cull_disabled;
#include "forest_oblique.gdshaderinc"
#include "forest_alpha_hash.gdshaderinc"
#include "color_space.gdshaderinc"
uniform sampler2DArray physical_view_colors : filter_linear_mipmap_anisotropic,repeat_disable;
uniform sampler2DArray physical_view_normal_roughness : filter_linear_mipmap_anisotropic,repeat_disable;
uniform sampler2DArray physical_view_depth : filter_linear_mipmap_anisotropic,repeat_disable;
uniform vec3 tree_camera_world_position;
uniform bool tree_depth_enabled=true;
uniform float physical_view_spans[33];
uniform vec2 physical_view_offsets[33];
varying flat int tree_view;
varying vec3 local_position;
varying vec3 local_view;
varying mat4 tree_model;
varying flat uint tree_alpha_seed;
vec3 direction_at(int index){
 if(index==32)return vec3(0,1,0);
 float elevation=radians(-30.0+float(index/8)*30.0);
 float yaw=float(index%8)*6.28318530718/8.0;
 return vec3(cos(yaw)*cos(elevation),sin(elevation),sin(yaw)*cos(elevation));
}
void vertex(){
 vec3 look=normalize((inverse(MODEL_MATRIX)*vec4(tree_camera_world_position,1)).xyz-vec3(0,.5,0));
 tree_view=0;float best=-2.0;
 for(int i=0;i<33;i++){float score=dot(look,direction_at(i));if(score>best){best=score;tree_view=i;}}
 local_view=direction_at(tree_view);
 vec3 right=tree_view==32?vec3(1,0,0):normalize(cross(vec3(0,1,0),local_view));
 vec3 up=cross(local_view,right);
 VERTEX=vec3(0,.5,0)+right*(VERTEX.x*physical_view_spans[tree_view]+physical_view_offsets[tree_view].x)+up*(VERTEX.y*physical_view_spans[tree_view]+physical_view_offsets[tree_view].y);
 local_position=VERTEX;tree_model=MODEL_MATRIX;
 tree_alpha_seed=floatBitsToUint(INSTANCE_CUSTOM.b);
}
void fragment(){
 vec4 color=texture(physical_view_colors,vec3(UV,float(tree_view)));
 vec4 nr=texture(physical_view_normal_roughness,vec3(UV,float(tree_view)));
 vec2 depth=texture(physical_view_depth,vec3(UV,float(tree_view))).rg;
 vec3 normal=nr.rgb/max(color.a,.00001)*2.0-1.0;
 NORMAL=normalize(mat3(VIEW_MATRIX)*transpose(inverse(mat3(tree_model)))*normal);
 ALBEDO=display_color(color.rgb/max(color.a,.00001));
 ROUGHNESS=clamp(depth.g/max(color.a,.00001),.04,1.0);SPECULAR=.25;
 // Source alpha is linear and mip-filtered. Hashing preserves sub-.5 coverage,
 // unlike a fixed alpha scissor that would erase unresolved foliage.
 vec3 point=local_position+local_view*((depth.r/max(color.a,.00001)-.5)*1.6);
 if(forest_oblique_selector(FRAGCOORD.xy)<.5 || color.a<=0.0 || color.a<forest_alpha_threshold(point,local_position,tree_alpha_seed))discard;
 ALPHA=1.0;ALPHA_SCISSOR_THRESHOLD=.5;
 vec4 clip=PROJECTION_MATRIX*VIEW_MATRIX*tree_model*vec4(point,1);
 DEPTH=tree_depth_enabled?clip.z/clip.w:FRAGCOORD.z;
}
