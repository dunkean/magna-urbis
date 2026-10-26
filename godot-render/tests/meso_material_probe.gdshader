shader_type canvas_item;
render_mode unshaded;
uniform float height_n=1334.0;
uniform vec2 probe_origin=vec2(21000,20000);
uniform vec2 probe_size=vec2(32,16);
uniform float probe_footprint=1.0;
uniform int probe_mode=0;
uniform float probe_step=.75;
uniform sampler2D ground_weights : filter_nearest, repeat_disable;
uniform sampler2D ground_structure : filter_linear, repeat_disable;
#include "res://shaders/terrain_detail.gdshaderinc"
#include "res://shaders/meso_material.gdshaderinc"
void fragment(){
 vec2 world=probe_origin+(UV*probe_size-.5)*probe_step;
 MesoSurface m=mesoSurface(world,probe_footprint,true);
 if(probe_mode==0)COLOR=vec4((m.physical_slope+1.0)/2.0,.5,1);
 else if(probe_mode==1)COLOR=vec4(m.warp+.5,m.jacobian[0].x/2.0,1);
 else if(probe_mode==2)COLOR=vec4(m.jacobian[1].x+.5,m.jacobian[1].y/2.0,m.jacobian[0].y+.5,1);
 else{vec3 f=mesoFractures(world);COLOR=vec4(f.x*4.0+.5,f.y/2.0+.5,f.z/2.0+.5,1);}
}
