uniform sampler2D water_ripples : filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D water_capillary : filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D water_detail : filter_linear, repeat_disable;
uniform sampler2D water_shoreline : filter_nearest, repeat_disable;
uniform sampler2D water_reference_dry : source_color, filter_linear_mipmap, repeat_disable;
uniform sampler2D water_reference_wet : source_color, filter_linear_mipmap, repeat_disable;
uniform bool water_textured=true;
uniform bool water_shore_smooth=true;
uniform bool water_shore_ready=false;
uniform float water_time_override=-1.0;
vec2 shoreDecode(vec4 packed){
 return (vec2(dot(round(packed.rg*255.0),vec2(256,1)),dot(round(packed.ba*255.0),vec2(256,1)))-32768.0)/32.0;
}
vec2 shoreDistance(vec2 world,float footprint){
 if(!water_shore_ready)return vec2(1023.0);
 vec2 p=world/40000.0*height_n-.5;ivec2 base=ivec2(floor(p)),last=ivec2(int(height_n)-1);
 vec2 nearest=shoreDecode(texelFetch(water_shoreline,clamp(ivec2(round(p)),ivec2(0),last),0));
 if(min(abs(nearest.x),abs(nearest.y))>120.0+footprint)return nearest;
 vec4 wx=weights(fract(p.x)),wz=weights(fract(p.y));vec2 result=vec2(0);
 for(int j=0;j<4;j++)for(int i=0;i<4;i++)result+=shoreDecode(texelFetch(water_shoreline,clamp(base+ivec2(i-1,j-1),ivec2(0),last),0))*wx[i]*wz[j];
 return result;
}
vec2 standingWater(vec2 distance_m,float footprint){
 float aa=max(.5,footprint*.65);
 return vec2(1.0)-smoothstep(vec2(-aa),vec2(aa),distance_m);
}
vec3 waterBand(vec2 world,float scale,uint salt,float amplitude,float footprint,vec2 axis,float time,float speed){
 float filter=1.0-smoothstep(scale/5.0,scale/2.0,footprint);if(filter<=0.0)return vec3(0);
 vec2 across=vec2(-axis.y,axis.x),v=world-axis*time*speed;
 vec3 n=mesoNoise(vec2(dot(v,axis),dot(v,across)/2.7),scale,terrain_detail_seed+salt);
 return vec3(n.x,amplitude*(n.y*axis+n.z*across/2.7))*filter;
}
vec3 waterFlow(vec2 world,float footprint,float time){
 // Downstream velocity is constant within each stationary frame. Blending
 // actual heights (with weight derivatives) prevents TIME*grad(flow) shear.
 vec2 p=world/64.0-.5;ivec2 base=ivec2(floor(p));vec2 t=fract(p);
 vec2 u=t*t*t*(t*(t*6.0-15.0)+10.0),du=30.0*t*t*(t-1.0)*(t-1.0)/64.0;
 vec3 result=vec3(0);
 for(int j=0;j<2;j++)for(int i=0;i<2;i++){
   ivec2 cell=base+ivec2(i,j);vec2 anchor=(vec2(cell)+.5)*64.0;
   vec2 flow=textureLod(water_detail,anchor/40000.0,0.0).rg*2.0-1.0;flow=length(flow)>.01?normalize(flow):vec2(0,1);
   vec2 v=world-anchor;uint salt=mesoHashBits(cell,6121u);
   vec3 a=waterBand(v,13.0,6073u+salt,.16,footprint,flow,time,.85);
   vec3 b=waterBand(v,2.7,6091u+salt,.06,footprint,flow,time,.85);
   vec3 c=waterBand(v,.60,6113u+salt,.015,footprint,flow,time,.85);
   float h=.16*a.x+.06*b.x+.015*c.x;
   float wx=i==0?1.0-u.x:u.x,wz=j==0?1.0-u.y:u.y;vec2 dw=vec2((i==0?-du.x:du.x)*wz,(j==0?-du.y:du.y)*wx);
   result+=vec3(h*wx*wz,(a.yz+b.yz+c.yz)*wx*wz+h*dw);
 }
 return result;
}
void waterMaterial(vec2 world,vec2 dx,vec2 dy,vec4 domain,vec2 shore,vec3 view_world,out vec3 color,out vec3 normal,out float roughness){
 vec4 hydro=texture(water_detail,world/40000.0);
 float river=1.0-step(.001,max(domain.g,domain.b));
 float time=water_time_override<0.0?TIME:water_time_override;
 float footprint=sqrt(dot(dx,dx)+dot(dy,dy));
 vec2 wind=normalize(vec2(.83,.55)),crosswind=normalize(vec2(.96,-.28));
 // Nonperiodic world spectra; filter by the shortest wavelength in each band.
 vec3 a=vec3(0),b=vec3(0),c=vec3(0),d=vec3(0),e=vec3(0);
 if(water_textured){
   if(river>.5){vec3 flow=waterFlow(world,footprint,time);c=vec3(flow.x/.16,flow.yz);}
   else{
     a=waterBand(world,233.0,6011u,.60,footprint,wind,time,.8);
     b=waterBand(world,61.0,6043u,.45,footprint,crosswind,time,.55);
     c=waterBand(world,13.0,6073u,.16,footprint,wind,time,.36);
     d=waterBand(world,2.7,6091u,.06,footprint,crosswind,time,.22);
     e=waterBand(world,.60,6113u,.015,footprint,wind,time,.15);
   }
 }
 vec2 slope=(a.yz+b.yz)*mix(1.0,.2,river)+(c.yz+d.yz+e.yz)*mix(1.0,.65,river);
 normal=normalize(vec3(-slope.x,1.0,-slope.y));
 float depth=mix(hydro.a*50.0,1.5,river);
 float deep=1.0-exp(-depth*.18);
 vec3 shallow=mix(vec3(.065,.19,.15),vec3(.10,.18,.13),river);
 vec3 deep_color=mix(vec3(.018,.065,.078),vec3(.012,.045,.072),domain.b);
 color=mix(shallow,deep_color,deep);
 float fresnel=pow(1.0-clamp(dot(normal,view_world),0.0,1.0),5.0);
 // A restrained sky contribution complements the actual lit specular lobe.
 color=mix(color,vec3(.27,.37,.43),.025+.45*fresnel);
 color*=1.0+clamp(.018*a.x+.025*b.x+.02*c.x,-.035,.035);
 float bank=1.0-smoothstep(0.0,35.0,max(-shore.x,0.0));
 float foam=bank*domain.b*smoothstep(.05,.45,.6*c.x+.4*d.x)*.22;
 color=mix(color,vec3(.65,.73,.70),foam);
 roughness=mix(.19,.26,river)+foam*.35+.025*smoothstep(.12,.3,footprint);
 if(!water_textured){color=mix(vec3(.035,.13,.17),vec3(.025,.085,.12),domain.b);normal=vec3(0,1,0);roughness=.9;}
}
