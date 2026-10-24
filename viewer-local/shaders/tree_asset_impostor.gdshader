shader_type spatial;
render_mode cull_disabled;
#include "canopy.gdshaderinc"
#include "color_space.gdshaderinc"
uniform sampler2DArray tree_view_colors : filter_linear_mipmap_anisotropic,repeat_disable;
uniform sampler2DArray tree_view_normals : filter_linear_mipmap_anisotropic,repeat_disable;
uniform sampler2D tree_top_mask : filter_linear,repeat_disable;
uniform vec3 tree_camera_world_position;
uniform bool tree_main_top=true;
varying flat int tree_view;
varying flat int tree_class;
varying vec3 tree_world_position;
varying mat3 tree_normal_matrix;
void vertex(){
 vec3 directions[5]=vec3[5](vec3(0,1,0),normalize(vec3(1,1,0)),normalize(vec3(0,1,-1)),normalize(vec3(-1,1,0)),normalize(vec3(0,1,1)));
 vec3 local_camera=(inverse(MODEL_MATRIX)*vec4(tree_camera_world_position,1.0)).xyz-vec3(0,.5,0);
 vec3 direction=normalize(local_camera);tree_view=0;float best=-2.0;
 for(int i=0;i<5;i++){float score=dot(direction,directions[i]);if(score>best){best=score;tree_view=i;}}
 if(tree_main_top)tree_view=0;
 vec3 right=tree_view==0?vec3(1,0,0):normalize(cross(vec3(0,1,0),directions[tree_view]));
 vec3 up=cross(directions[tree_view],right);
 VERTEX=vec3(0,.5,0)+right*VERTEX.x+up*VERTEX.y;
 tree_world_position=(MODEL_MATRIX*vec4(VERTEX,1)).xyz;
 tree_class=int(INSTANCE_CUSTOM.g+.5);tree_normal_matrix=transpose(inverse(mat3(MODEL_MATRIX)));
}
void fragment(){
 vec4 source=texture(tree_view_colors,vec3(UV,float(tree_view)));
 vec4 normal_data=texture(tree_view_normals,vec3(UV,float(tree_view)));
 vec3 local_normal=normal_data.rgb/max(normal_data.a,.00001)*2.0-1.0;
 NORMAL=normalize(mat3(VIEW_MATRIX)*tree_normal_matrix*local_normal);
 ALBEDO=display_color(source.rgb/max(source.a,.00001));ROUGHNESS=.9;SPECULAR=.25;
 float cutout=tree_view==0?step(.5,textureLod(tree_top_mask,UV,0.0).r):step(.5,source.a);
 float footprint=canopy_main_pixel_footprint(tree_world_position.xz,PROJECTION_MATRIX*VIEW_MATRIX,VIEWPORT_SIZE);
 ALPHA=cutout*canopy_geometry_weight*canopy_instance_weight(tree_class,footprint);ALPHA_HASH_SCALE=1.0;
}
