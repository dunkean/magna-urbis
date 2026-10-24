shader_type spatial;
render_mode unshaded,cull_disabled;
uniform sampler2D source_albedo : source_color,filter_linear_mipmap,repeat_enable;
uniform sampler2D source_normal : hint_normal,filter_linear_mipmap,repeat_enable;
uniform sampler2D source_roughness : filter_linear_mipmap,repeat_enable;
uniform vec4 source_factor=vec4(1);
uniform vec3 uv_scale=vec3(1);
uniform vec3 uv_offset=vec3(0);
uniform vec4 roughness_channel=vec4(0,1,0,0);
uniform float roughness_factor=1;
uniform float normal_scale=1;
uniform bool source_cutout=false;
uniform int channel=0;
uniform vec3 view_direction;
varying vec3 source_position;
varying vec3 source_n;
varying vec3 source_t;
varying vec3 source_b;
void vertex(){
 source_position=(MODEL_MATRIX*vec4(VERTEX,1)).xyz;
 source_n=normalize(transpose(inverse(mat3(MODEL_MATRIX)))*NORMAL);
 source_t=mat3(MODEL_MATRIX)*TANGENT;source_b=mat3(MODEL_MATRIX)*BINORMAL;
 UV=UV*uv_scale.xy+uv_offset.xy;
}
void fragment(){
 vec4 c=texture(source_albedo,UV)*source_factor;
 if(source_cutout && c.a<.5)discard;
 vec3 n=normalize(source_n);vec3 t=normalize(source_t-n*dot(n,source_t));
 vec3 cross_nt=normalize(cross(n,t));vec3 b=cross_nt*(dot(cross_nt,source_b)<0.0?-1.0:1.0);
 vec2 xy=(texture(source_normal,UV).rg*2.0-1.0)*normal_scale;
 vec3 mapped=normalize(vec3(xy,sqrt(max(.00001,1.0-dot(xy,xy)))));
 n=normalize(t*mapped.x+b*mapped.y+n*mapped.z)*(FRONT_FACING?1.0:-1.0);
 float r=clamp(dot(texture(source_roughness,UV),roughness_channel)*roughness_factor,.04,1.0);
 if(channel==0){ALBEDO=c.rgb;ALPHA=1.0;}
 else if(channel==1){ALBEDO=n*.5+.5;ALPHA=1.0;}
 else if(channel==2){ALBEDO=vec3(dot(source_position-vec3(0,.5,0),view_direction)/1.6+.5,r,.25);ALPHA=1.0;}
 else {ALBEDO=vec3(.25,.5,.75);ALPHA=1.0;}
 // Source cutout is already discarded above. Write data, not alpha blend.
 ALPHA_SCISSOR_THRESHOLD=0.0;
}
