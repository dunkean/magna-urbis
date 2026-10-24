shader_type spatial;
render_mode unshaded,cull_disabled;
uniform sampler2D source_albedo : source_color,filter_linear_mipmap,repeat_enable;
uniform vec4 source_factor=vec4(1.0);
uniform vec3 uv_scale=vec3(1.0);
uniform vec3 uv_offset=vec3(0.0);
uniform bool source_cutout=false;
uniform vec3 to_sun;
varying vec3 source_position;
void vertex(){source_position=(MODEL_MATRIX*vec4(VERTEX,1.0)).xyz;UV=UV*uv_scale.xy+uv_offset.xy;}
void fragment(){
 float a=source_cutout?texture(source_albedo,UV).a*source_factor.a:1.0;
 // Same source alpha threshold as the real leaf material; no TOP C stencil.
 ALPHA=a;ALPHA_SCISSOR_THRESHOLD=.5;
 float d=dot(source_position-vec3(0,.5,0),to_sun);
 // RGB are data, not beauty. B=.25 calibrates readback transfer explicitly.
 ALBEDO=vec3(d/1.6+.5,1.0,.25);
}
