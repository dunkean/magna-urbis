// Shared with mesoscale.gd: native context, fixed world bands, full derivatives.
uniform bool terrain_detail_enabled=true;
uniform float terrain_detail_amount=0.0;
uniform float terrain_grid_warp=0.0;
uniform vec2 terrain_grid_focus=vec2(20000);
uniform float terrain_grid_scale=20000.0;
uniform vec4 terrain_grid_domain=vec4(-1,1,-1,1);
uniform uint terrain_detail_seed=1u;
uniform bool meso_ready=false;
uniform sampler2D meso_context : filter_nearest, repeat_disable;
uniform sampler2D meso_profiles : filter_nearest, repeat_disable;
uniform sampler2D meso_structure : filter_linear, repeat_disable;
uniform bool meso_profiles_enabled=true;
uniform bool rock_small_enabled=true;
float gridCoordinate(float t,int axis){
 if(t<=0.0)return 0.0;if(t>=1.0)return 40000.0;
 if(terrain_grid_warp<.001)return t*40000.0;
 float a=axis==0?terrain_grid_domain.x:terrain_grid_domain.z,b=axis==0?terrain_grid_domain.y:terrain_grid_domain.w;
 return terrain_grid_focus[axis]+terrain_grid_scale*sinh(mix(a,b,t));
}
vec4 gridDensity(vec2 world){
 if(terrain_grid_warp<.001)return vec4(vec2(40000.0/height_n),0,0);
 vec2 delta=world-terrain_grid_focus;
 vec2 root=sqrt(vec2(terrain_grid_scale*terrain_grid_scale)+delta*delta);
 vec2 factor=vec2(terrain_grid_domain.y-terrain_grid_domain.x,terrain_grid_domain.w-terrain_grid_domain.z)/height_n;
 return vec4(root*factor,delta/root*factor);
}
uint mesoHashBits(ivec2 cell,uint salt){
 uint h=((uint(cell.x)*374761393u)&2147483647u)^((uint(cell.y)*668265263u)&2147483647u)^(salt&2147483647u);
 h=((h^(h>>13u))*1274126177u)&2147483647u;h=(h^(h>>16u))&2147483647u;
 return h;
}
vec2 mesoGradient(ivec2 cell,uint salt){
 uint h=mesoHashBits(cell,salt);
 return normalize(vec2(float(h&65535u),float((h>>15u)&65535u))/32767.5-1.0);
}
vec3 mesoNoise(vec2 world,float scale,uint salt){
 vec2 p=world/scale;ivec2 cell=ivec2(floor(p));vec2 t=fract(p);
 vec2 u=t*t*t*(t*(t*6.0-15.0)+10.0),du=30.0*t*t*(t-1.0)*(t-1.0)/scale;
 vec2 ga=mesoGradient(cell,salt),gb=mesoGradient(cell+ivec2(1,0),salt),gc=mesoGradient(cell+ivec2(0,1),salt),gd=mesoGradient(cell+ivec2(1,1),salt);
 float a=dot(ga,t),b=dot(gb,t-vec2(1,0)),c=dot(gc,t-vec2(0,1)),d=dot(gd,t-1.0);
 vec2 gradient=mix(mix(ga,gb,u.x),mix(gc,gd,u.x),u.y)/scale+vec2(mix(b-a,d-c,u.y)*du.x,mix(c-a,d-b,u.x)*du.y);
 // Unit gradients imply |interpolated dot| <= sqrt(.5); this gain preserves
 // the strict [-1,1] envelope without square plateaus at lattice corners.
 return vec3(mix(mix(a,b,u.x),mix(c,d,u.x),u.y),gradient)*1.4142135;
}
struct MesoContext{vec4 value;vec4 dx;vec4 dz;};
MesoContext mesoContext(vec2 world){
 vec2 p=world/40000.0*height_n-.5;ivec2 base=ivec2(floor(p));vec2 t=fract(p);ivec2 last=ivec2(int(height_n)-1);
 vec4 a=texelFetch(meso_context,clamp(base,ivec2(0),last),0),b=texelFetch(meso_context,clamp(base+ivec2(1,0),ivec2(0),last),0);
 vec4 c=texelFetch(meso_context,clamp(base+ivec2(0,1),ivec2(0),last),0),d=texelFetch(meso_context,clamp(base+ivec2(1,1),ivec2(0),last),0);
 MesoContext ctx;ctx.value=mix(mix(a,b,t.x),mix(c,d,t.x),t.y);
 ctx.dx=mix(b-a,d-c,t.y)*(height_n/40000.0);ctx.dz=mix(c-a,d-b,t.x)*(height_n/40000.0);return ctx;
}
MesoContext mesoProfiles(vec2 world){
 vec2 p=world/40000.0*height_n-.5;ivec2 base=ivec2(floor(p));vec2 t=fract(p);ivec2 last=ivec2(int(height_n)-1);
 vec4 a=texelFetch(meso_profiles,clamp(base,ivec2(0),last),0),b=texelFetch(meso_profiles,clamp(base+ivec2(1,0),ivec2(0),last),0);
 vec4 c=texelFetch(meso_profiles,clamp(base+ivec2(0,1),ivec2(0),last),0),d=texelFetch(meso_profiles,clamp(base+ivec2(1,1),ivec2(0),last),0);
 MesoContext ctx;ctx.value=mix(mix(a,b,t.x),mix(c,d,t.x),t.y);ctx.dx=mix(b-a,d-c,t.y)*(height_n/40000.0);ctx.dz=mix(c-a,d-b,t.x)*(height_n/40000.0);return ctx;
}
vec3 mesoBedded(vec2 world,float scale,uint salt){
 // Four stationary frames, not a rotation by a fragment-varying angle.
 vec2 p=world/256.0-.5;ivec2 base=ivec2(floor(p));vec2 t=fract(p);
 vec2 u=t*t*t*(t*(t*6.0-15.0)+10.0),du=30.0*t*t*(t-1.0)*(t-1.0)/256.0;
 vec3 result=vec3(0);
 for(int j=0;j<2;j++)for(int i=0;i<2;i++){
   ivec2 cell=base+ivec2(i,j);vec2 anchor=(vec2(cell)+.5)*256.0;
   vec2 field=textureLod(meso_structure,anchor/40000.0,0.0).rg*2.0-1.0;
   float angle=.5*atan(field.y,field.x);vec2 axis=vec2(cos(angle),sin(angle)),across=vec2(-axis.y,axis.x),v=world-anchor;
   vec3 n=mesoNoise(vec2(dot(v,axis)/1.8,dot(v,across)/.9),scale,salt+mesoHashBits(cell,739u));
   float h=(n.x+.12*(n.x*n.x-.125))/1.105;
   vec2 gradient=(1.0+.24*n.x)/1.105*(n.y*axis/1.8+n.z*across/.9);
   float wx=i==0?1.0-u.x:u.x,wz=j==0?1.0-u.y:u.y;
   vec2 dw=vec2((i==0?-du.x:du.x)*wz,(j==0?-du.y:du.y)*wx);
   result+=vec3(h*wx*wz,gradient*wx*wz+h*dw);
 }
 return result;
}
vec3 mesoProfileNoise(vec2 world,float scale,uint salt,MesoContext p){
 vec3 n=mesoNoise(world,scale,salt);
 if(!meso_profiles_enabled)return n;
 if(scale==3.75&&rock_small_enabled){
   // A bounded broad shoulder/cut response, without a new noise octave or
   // narrow threshold that could alias before the mesh resolves it.
   float h=1.4*n.x-.4*n.x*n.x*n.x,d=1.4-1.2*n.x*n.x;
   float rock=p.value.r+p.value.g;vec2 gradient=vec2(p.dx.r+p.dx.g,p.dz.r+p.dz.g);
   return vec3(mix(n.x,h,rock),mix(n.yz,n.yz*d,rock)+(h-n.x)*gradient);
 }
 if(scale!=27.0)return n;
 float massive=(n.x+.25*(n.x*n.x-.125))/1.22;
 float clastic=1.35*n.x-.4*n.x*n.x*n.x;
 vec3 a=vec3(massive,(1.0+.5*n.x)/1.22*n.yz),b=n;
 vec3 c=vec3(clastic,(1.35-1.2*n.x*n.x)*n.yz);
 if(p.value.g>0.0||abs(p.dx.g)+abs(p.dz.g)>0.0)b=mesoBedded(world,scale,salt);
 // Convex profiles retain the strict [-1,1] height envelope. Full spatial
 // derivatives include profile boundaries, frame blends and native amplitudes.
 vec3 result=n+p.value.r*(a-n)+p.value.g*(b-n)+p.value.b*(c-n);
 result.yz+=(a.x-n.x)*vec2(p.dx.r,p.dz.r)+(b.x-n.x)*vec2(p.dx.g,p.dz.g)+(c.x-n.x)*vec2(p.dx.b,p.dz.b);
 return result;
}
vec3 mesoSupportNoise(vec2 world,float scale,uint salt){return mesoProfileNoise(world,scale,salt,mesoProfiles(world));}
vec2 mesoBandFilter(float scale,float spacing){
 float lo=scale/6.0,hi=scale/3.0,t=clamp((spacing-lo)/(hi-lo),0.0,1.0);
 return vec2(1.0-t*t*(3.0-2.0*t),-6.0*t*(1.0-t)/(hi-lo));
}
vec3 mesoBand(vec2 world,float scale,uint salt,float amplitude,vec2 gradient,float spacing,vec2 ds,MesoContext profile){
 vec2 filter=mesoBandFilter(scale,spacing);if(filter.x<=0.0)return vec3(0);
 vec3 noise=mesoProfileNoise(world,scale,terrain_detail_seed+salt,profile);
 return vec3(amplitude*noise.x*filter.x,filter.x*(amplitude*noise.yz+noise.x*gradient)+amplitude*noise.x*filter.y*ds);
}
vec3 mesoSample(vec2 world,vec4 density){
 if(!meso_ready||!terrain_detail_enabled||terrain_detail_amount<=0.0)return vec3(0);
 float spacing=length(density.xy);vec2 ds=density.xy*density.zw/max(spacing,.00001);
 if(spacing>=64.0/3.0)return vec3(0);
 MesoContext ctx=mesoContext(world);if(ctx.value.r+ctx.value.g<=0.0)return vec3(0);
 MesoContext profile=mesoProfiles(world);
 vec2 coarse=vec2(ctx.dx.r,ctx.dz.r),fine=vec2(ctx.dx.g,ctx.dz.g);
 return terrain_detail_amount*(mesoBand(world,64.0,17u,ctx.value.r*.68,coarse*.68,spacing,ds,profile)
  +mesoBand(world,27.0,109u,ctx.value.r*.32,coarse*.32,spacing,ds,profile)
  +mesoBand(world,9.5,271u,ctx.value.g*.72,fine*.72,spacing,ds,profile)
  +mesoBand(world,3.75,577u,ctx.value.g*.28,fine*.28,spacing,ds,profile));
}
