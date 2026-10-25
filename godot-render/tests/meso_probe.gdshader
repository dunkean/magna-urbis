shader_type canvas_item;
render_mode unshaded;
uniform float height_n=1334.0;
uniform vec2 probe_origin=vec2(21000,20000);
uniform vec2 probe_size=vec2(48,16);
uniform float probe_step=.75;
uniform bool probe_filtered=true;
#include "res://shaders/terrain_detail.gdshaderinc"
void fragment(){
 vec2 world=probe_origin+(UV*probe_size-.5)*probe_step;
 vec3 m=mesoSample(world,probe_filtered?gridDensity(world):vec4(0));
 COLOR=vec4((m.x+4.0)/8.0,(m.y+1.0)/2.0,(m.z+1.0)/2.0,1);
}
