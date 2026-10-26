shader_type canvas_item;
render_mode unshaded;
uniform float height_n=1334.0;
uniform vec2 probe_origin=vec2(21000,20000);
uniform vec2 probe_size=vec2(128,32);
uniform float probe_step=.25;
uniform float probe_footprint=.1;
uniform float probe_time=0.0;
uniform int probe_mode=0;
vec4 weights(float t){float u=1.0-t;return vec4(u*u*u,3.0*t*t*t-6.0*t*t+4.0,-3.0*t*t*t+3.0*t*t+3.0*t+1.0,t*t*t)/6.0;}
#include "res://shaders/terrain_detail.gdshaderinc"
#include "res://shaders/surface_water.gdshaderinc"
void fragment(){
 vec2 world=probe_origin+(UV*probe_size-.5)*probe_step;
 if(probe_mode==0)COLOR=vec4(shoreDistance(world,probe_footprint)/256.0+.5,.5,1);
 else if(probe_mode==1){vec3 f=waterBand(world,13.0,6073u,.16,probe_footprint,normalize(vec2(.83,.55)),probe_time,.36);COLOR=vec4(f.x*.5+.5,f.yz*.5+.5,1);}
 else if(probe_mode==2){vec3 f=waterFlow(world,probe_footprint,probe_time);COLOR=vec4(f.x+.5,f.yz+.5,1);}
 else if(probe_mode==3){vec3 c;vec3 n;float r;waterMaterial(world,vec2(probe_footprint,0),vec2(0,probe_footprint),vec4(0,0,1,1),vec2(-200,1000),vec3(0,1,0),c,n,r);COLOR=vec4(c,1);}
 else COLOR=vec4(textureLod(water_reference_dry,world/40000.0,0.0).rgb,1);
}
