shader_type spatial;
render_mode cull_disabled;
uniform sampler2DArray solar_data : filter_linear,repeat_disable;
uniform float solar_weight=0.0;
uniform bool solar_depth_enabled=true;
varying vec3 solar_plane_position;
varying vec3 solar_depth_axis;
varying flat float solar_view;
varying flat float stable_seed;
void vertex(){
 solar_plane_position=(MODEL_MATRIX*vec4(VERTEX,1.0)).xyz;
 solar_depth_axis=mat3(MODEL_MATRIX)*vec3(0,0,1);
 solar_view=INSTANCE_CUSTOM.r;stable_seed=INSTANCE_CUSTOM.g;
}
void fragment(){
 vec2 d=textureLod(solar_data,vec3(UV,solar_view),0.0).rg;
 // One global viewport transfer; no page-edge spatial fade or camera LOD cap.
 float h=fract(sin(dot(floor(UV*1024.0),vec2(12.9898,78.233))+stable_seed*6.2831853)*43758.5453);
 ALPHA=step(.5,d.g)*step(h,solar_weight)*step(.000001,solar_weight);ALPHA_SCISSOR_THRESHOLD=.5;
 vec3 point=solar_plane_position+solar_depth_axis*((d.r-.5)*1.6);
 vec4 clip=PROJECTION_MATRIX*VIEW_MATRIX*vec4(point,1.0);
 // Godot Forward+ Vulkan depth is [0,1], including its directional shadow pass.
 // Always assign DEPTH: a conditional output otherwise has undefined branches.
 DEPTH=solar_depth_enabled?clip.z/clip.w:FRAGCOORD.z;
 ALBEDO=vec3(1.0);ROUGHNESS=1.0;
}
