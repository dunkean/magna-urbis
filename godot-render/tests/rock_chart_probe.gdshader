shader_type canvas_item;
render_mode unshaded;
uniform sampler2D height_map : filter_nearest, repeat_disable;
uniform float height_n=16.0;
uniform vec2 probe_anchor=vec2(20000);
uniform vec3 surface_normal=vec3(0,1,0);
uniform vec3 input_micro=vec3(0,0,1);
uniform vec2 probe_size=vec2(48,32);
uniform mat2 probe_warp=mat2(vec2(1,0),vec2(0,1));
uniform int probe_mode=0;
#include "res://shaders/rock_projection.gdshaderinc"
void fragment(){
 vec3 n=normalize(surface_normal),t=normalize(vec3(n.y,-n.x,0)),b=cross(t,n);
 vec2 local=(UV*probe_size-vec2(24.5,16.5))*.05;vec3 point=vec3(probe_anchor.x,1500,probe_anchor.y)+t*local.x+b*local.y;
 RockProjection p;p.height=point.y;p.dh=vec2(t.y,b.y)*.05;
 rockProjectionBasis(n,probe_warp,p.tangent,p.across);p.amount=1.0;p.enabled=true;
 // Warp only the local offset, keeping this test's fixed anchor unchanged.
 vec2 uv=(probe_anchor+probe_warp*(point.xz-probe_anchor))/5.0,dx=probe_warp*t.xz*.01,dy=probe_warp*b.xz*.01;vec3 qx;vec3 qz;
 float amount=rockChart(p,probe_anchor,5.0,uv,dx,dy,qx,qz);
 vec3 micro=rockChartNormal(normalize(input_micro),qx,qz,p);vec2 xy=transpose(probe_warp)*vec2(micro.x,-micro.y);micro=normalize(vec3(xy.x,-xy.y,micro.z));
 vec3 normal=normalize(t*micro.x-b*micro.y+n*micro.z);
 if(probe_mode==0)COLOR=vec4((uv-probe_anchor/5.0)*.25+.5,amount,1);
 else if(probe_mode==1)COLOR=vec4(normal*.5+.5,1);
 else COLOR=vec4(dx*10.0+.5,dy.x*10.0+.5,1);
}
