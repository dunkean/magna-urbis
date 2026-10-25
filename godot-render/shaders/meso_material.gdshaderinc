// Evaluate once per fragment; shared by all four cells and all PBR channels.
uniform bool meso_material_enabled=true;
struct MesoSurface{
 vec2 physical_slope;vec2 grain_slope;float signal;float grain;float cavity;float cover_mod;float unresolved_roughness;
 vec2 warp;mat2 jacobian;
};
vec3 mesoSurfaceBand(vec2 world,float scale,uint salt,float amplitude,vec2 gradient,float pixel_spacing){
 vec2 pf=mesoBandFilter(scale,pixel_spacing*(2.0/3.0));if(pf.x<=0.0)return vec3(0);
 vec3 n=mesoSupportNoise(world,scale,terrain_detail_seed+salt);
 vec2 g=amplitude*n.yz+n.x*gradient;
 return vec3(n.x*pf.x,pf.x*g);
}
// Four fixed world patches: local rock axes never rotate coordinates as the
// fragment moves. Blend derivatives keep height and normals continuous.
vec3 mesoFractures(vec2 world){
 vec2 p=world/48.0-.5;ivec2 base=ivec2(floor(p));vec2 t=fract(p);
 vec2 u=t*t*t*(t*(t*6.0-15.0)+10.0),du=30.0*t*t*(t-1.0)*(t-1.0)/48.0;
 vec3 result=vec3(0);
 for(int j=0;j<2;j++)for(int i=0;i<2;i++){
   ivec2 cell=base+ivec2(i,j);vec2 anchor=(vec2(cell)+.5)*48.0;
   vec2 field=textureLod(ground_structure,anchor/40000.0,0.0).rg*2.0-1.0;
   float angle=.5*atan(field.y,field.x);vec2 axis=vec2(cos(angle),sin(angle)),cross_axis=vec2(-axis.y,axis.x),v=world-anchor;
   uint salt=4111u+uint(cell.x)*92821u+uint(cell.y)*68917u;
   vec3 n=mesoNoise(vec2(dot(v,axis)/12.0,dot(v,cross_axis)/3.0),1.0,terrain_detail_seed+salt);
   float h=-.06*exp(-n.x*n.x/.04);vec2 gradient=h*(-2.0*n.x/.04)*(n.y*axis/12.0+n.z*cross_axis/3.0);
   float wx=i==0?1.0-u.x:u.x,wz=j==0?1.0-u.y:u.y;
   vec2 dw=vec2((i==0?-du.x:du.x)*wz,(j==0?-du.y:du.y)*wx);
   result+=vec3(h*wx*wz,gradient*wx*wz+h*dw);
 }
 return result;
}
vec3 mesoRockBudget(vec2 world){
 vec2 p=world/40000.0*height_n-.5;ivec2 cell=ivec2(floor(p)),last=ivec2(int(height_n)-1);vec2 t=fract(p);
 vec2 ab=texelFetch(ground_weights,clamp(cell,ivec2(0),last),0).rg,bb=texelFetch(ground_weights,clamp(cell+ivec2(1,0),ivec2(0),last),0).rg;
 vec2 cb=texelFetch(ground_weights,clamp(cell+ivec2(0,1),ivec2(0),last),0).rg,db=texelFetch(ground_weights,clamp(cell+ivec2(1,1),ivec2(0),last),0).rg;
 float a=ab.x+ab.y,b=bb.x+bb.y,c=cb.x+cb.y,d=db.x+db.y;
 return vec3(mix(mix(a,b,t.x),mix(c,d,t.x),t.y),mix(b-a,d-c,t.y)*height_n/40000.0,mix(c-a,d-b,t.x)*height_n/40000.0);
}
MesoSurface mesoSurface(vec2 world,float footprint,bool covered){
 MesoSurface m;m.physical_slope=vec2(0);m.grain_slope=vec2(0);m.signal=0.0;m.grain=0.0;m.cavity=0.0;m.cover_mod=1.0;m.unresolved_roughness=0.0;m.warp=vec2(0);m.jacobian=mat2(vec2(1,0),vec2(0,1));
 if(!meso_ready||!meso_material_enabled||footprint>=24.0)return m;
 MesoContext c=mesoContext(world);if(!covered){c.value.a=0.0;c.dx.a=0.0;c.dz.a=0.0;}
 vec2 cg=vec2(c.dx.r,c.dz.r),fg=vec2(c.dx.g,c.dz.g);
 vec3 a=mesoSurfaceBand(world,64.0,17u,c.value.r*.68,cg*.68,footprint);
 vec3 b=mesoSurfaceBand(world,27.0,109u,c.value.r*.32,cg*.32,footprint);
 vec3 d=mesoSurfaceBand(world,9.5,271u,c.value.g*.72,fg*.72,footprint);
 vec3 e=mesoSurfaceBand(world,3.75,577u,c.value.g*.28,fg*.28,footprint);
 m.physical_slope=a.yz+b.yz+d.yz+e.yz;
 // Medium-scale mineral response follows the same shapes as displacement;
 // micro photographs keep their own detail without a second unrelated mask.
 m.signal=.65*(.68*a.x+.32*b.x)+.35*(.72*d.x+.28*e.x);
 if(meso_profiles_enabled){
   MesoContext profile=mesoProfiles(world);float mineral=profile.value.r+profile.value.g+profile.value.b;
   m.signal=mix(m.signal,.35*a.x+.65*b.x,mineral*.65);
   m.unresolved_roughness=.025*mineral*b.x;
 }
 float f6=mesoBandFilter(6.0,footprint*(2.0/3.0)).x,f2=mesoBandFilter(1.75,footprint*(2.0/3.0)).x;
 vec3 tufts=vec3(0),grain=vec3(0);
 if(f6>0.0)tufts=mesoNoise(world,6.0,terrain_detail_seed+991u)*f6;
 if(f2>0.0)grain=mesoNoise(world,1.75,terrain_detail_seed+1597u)*f2;
 // Small material height features: smooth tuft/clast caps and their gradients.
 float positive=max(tufts.x,0.0),cap=positive*positive;
 float amplitude=.055*c.value.a+.08*c.value.b;
 vec2 amp_gradient=.055*vec2(c.dx.a,c.dz.a)+.08*vec2(c.dx.b,c.dz.b);
 m.grain_slope=amplitude*2.0*positive*tufts.yz+cap*amp_gradient;
 m.grain_slope+=.025*(c.value.a+c.value.b)*grain.yz+.025*grain.x*vec2(c.dx.a+c.dx.b,c.dz.a+c.dz.b);
 m.grain=.65*tufts.x+.35*grain.x;
 m.cavity=clamp(max(-tufts.x,0.0)*c.value.b,0.0,1.0);
 m.cover_mod=clamp(.86+.33*tufts.x+.13*m.signal,.45,1.0);
 m.unresolved_roughness+=.018*c.value.a*(1.0-f6)+.025*c.value.b*(1.0-f2);
 // Gaussian cuts are narrower than their 3m carrier; fade by crack width,
 // not carrier spacing, before they can become subpixel lines.
 float fracture_filter=mesoBandFilter(.75,footprint*(2.0/3.0)).x;
 if(fracture_filter>0.0){
   vec3 rock=mesoRockBudget(world);float t=clamp((rock.x-.10)/.30,0.0,1.0),gate=t*t*(3.0-2.0*t),dg=6.0*t*(1.0-t)/.30;
   if(gate>0.0){
     vec3 fracture=mesoFractures(world)*fracture_filter;
     m.grain_slope+=fracture.yz*rock.x*gate+fracture.x*(gate+rock.x*dg)*rock.yz;
     m.cavity+=clamp(-fracture.x/.06,0.0,1.0)*rock.x*gate;
   }
 }
 // Fixed world warp, never faded by camera. Exact Jacobian feeds all texture
 // derivatives and normal vectors, so their features remain registered.
 vec3 wx=mesoNoise(world,11.0,terrain_detail_seed+2179u),wz=mesoNoise(world,17.0,terrain_detail_seed+3253u);
 m.warp=.28*vec2(wx.x,wz.x);
 m.jacobian=mat2(vec2(1.0+.28*wx.y,.28*wz.y),vec2(.28*wx.z,1.0+.28*wz.z));
 float activity=1.0-smoothstep(8.0,24.0,footprint);
 m.physical_slope*=activity;m.grain_slope*=activity;m.signal*=activity;m.grain*=activity;m.cavity*=activity;
 m.cover_mod=mix(1.0,m.cover_mod,activity);m.unresolved_roughness*=activity;
 return m;
}
