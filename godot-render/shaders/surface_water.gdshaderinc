uniform sampler2D water_ripples : filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D water_capillary : filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D water_detail : filter_linear, repeat_disable;
uniform bool water_textured=true;
uniform float water_time_override=-1.0;
void waterMaterial(vec2 world,vec2 dx,vec2 dy,vec4 domain,vec3 view_world,out vec3 color,out vec3 normal,out float roughness){
 vec4 hydro=texture(water_detail,world/40000.0);
 vec2 downstream=hydro.rg*2.0-1.0;downstream/=max(length(downstream),.01);
 float river=1.0-max(domain.g,domain.b);
 float time=water_time_override<0.0?TIME:water_time_override;
 vec2 wind=vec2(.83,.55);vec2 drift=mix(wind*.18,downstream*.85,river);
 vec2 uv0=(world-drift*time)/37.0;vec2 uv1=(vec2(-world.y,world.x)-vec2(-drift.y,drift.x)*time*1.37)/7.13;
 vec4 a=textureGrad(water_ripples,uv0,dx/37.0,dy/37.0);
 vec4 b=textureGrad(water_capillary,uv1,vec2(-dx.y,dx.x)/7.13,vec2(-dy.y,dy.x)/7.13);
 float resolved=1.0-smoothstep(.5,4.0,max(length(dx),length(dy)));
 vec2 slope=((a.rg*2.0-1.0)*.20+vec2(b.g*2.0-1.0,1.0-b.r*2.0)*.07)*resolved;
 normal=normalize(vec3(-slope.x,1.0,-slope.y));
 float depth=mix(hydro.a*50.0,1.5,river);
 float deep=1.0-exp(-depth*.18);
 vec3 shallow=mix(vec3(.065,.19,.15),vec3(.10,.18,.13),river);
 vec3 deep_color=mix(vec3(.018,.065,.078),vec3(.012,.045,.072),domain.b);
 color=mix(shallow,deep_color,deep);
 float fresnel=pow(1.0-clamp(dot(normal,view_world),0.0,1.0),5.0);
 // A restrained sky contribution complements the actual lit specular lobe.
 color=mix(color,vec3(.27,.37,.43),.025+.45*fresnel);
 color*=1.0+(a.b-.5)*.09*resolved;
 float bank=1.0-smoothstep(0.0,65.0,hydro.b*256.0);
 float foam=bank*domain.b*smoothstep(.66,.86,a.b*.65+b.b*.35)*resolved*.45;
 color=mix(color,vec3(.65,.73,.70),foam);
 roughness=mix(.19,.26,river)+foam*.45;
 if(!water_textured){color=mix(vec3(.035,.13,.17),vec3(.025,.085,.12),domain.b);normal=vec3(0,1,0);roughness=.9;}
}
