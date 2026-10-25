shader_type spatial;
render_mode cull_disabled;
uniform sampler2D height_map : filter_nearest, repeat_disable;
uniform sampler2D map_image : source_color, filter_linear_mipmap_anisotropic, repeat_disable;
uniform sampler2D info_image : source_color, filter_nearest, repeat_disable;
uniform sampler2D info_image_linear : source_color, filter_linear_mipmap_anisotropic, repeat_disable;
uniform bool info_smooth=false;
uniform float info_opacity=0.0;
uniform float height_n=1024.0;
uniform int ground_view=0;
uniform int ground_state=0;
uniform bool ground_stochastic=true;
uniform bool ground_auto_snow=true;
uniform bool original_cover_enabled=true;
uniform sampler2D montane_forest : filter_linear_mipmap, repeat_disable;
uniform bool ground_macro_reference=true;
uniform bool terrain_height_probe=false;
uniform bool terrain_normal_probe=false;
uniform bool forest_coverage_probe=false;
uniform bool water_domain_probe=false;
uniform bool rock_normal_probe=false;
uniform sampler2D forest_placement : filter_linear_mipmap, repeat_disable;
uniform sampler2D original_height_map : filter_nearest, repeat_disable;
uniform sampler2D original_cover : filter_linear_mipmap, repeat_disable;
uniform sampler2D original_color : filter_linear_mipmap, repeat_disable;
uniform sampler2D original_open : filter_linear_mipmap, repeat_disable;
uniform sampler2D original_closed : filter_linear_mipmap, repeat_disable;
uniform vec3 original_light=vec3(-.5,.70710678,-.5);
uniform sampler2D ground_indices : filter_nearest, repeat_disable;
uniform sampler2D ground_weights : filter_nearest, repeat_disable;
uniform sampler2D ground_indices_extra : filter_nearest, repeat_disable;
uniform sampler2D ground_weights_extra : filter_nearest, repeat_disable;
uniform sampler2D render_snow : filter_linear_mipmap, repeat_disable;
uniform sampler2D cover_indices : filter_nearest, repeat_disable;
uniform sampler2D cover_weights : filter_nearest, repeat_disable;
uniform sampler2D ground_attributes : filter_linear, repeat_disable;
uniform sampler2D ground_structure : filter_linear, repeat_disable;
uniform sampler2D ground_water : filter_linear, repeat_disable;
uniform sampler2D river_footprint : filter_linear_mipmap, repeat_disable;
uniform sampler2D ground_palette : filter_nearest, repeat_disable;
uniform sampler2DArray ground_colors : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2DArray ground_normals : filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2DArray ground_heights : filter_linear_mipmap, repeat_enable;
varying vec3 ground_position;
varying vec3 ground_geometric_normal;
varying vec2 ground_macro_slope;
varying vec2 ground_detail_slope;
vec4 weights(float t){float u=1.0-t;return vec4(u*u*u,3.0*t*t*t-6.0*t*t+4.0,-3.0*t*t*t+3.0*t*t+3.0*t+1.0,t*t*t)/6.0;}
vec4 gradient_weights(float t){float u=1.0-t;return vec4(-.5*u*u,1.5*t*t-2.0*t,-1.5*t*t+t+.5,.5*t*t);}
vec3 forestRootSurface(vec2 world){
 vec2 p=world/40000.0*height_n-.5;vec2 base=floor(p);vec4 wx=weights(fract(p.x)),wy=weights(fract(p.y));
 vec4 gx=gradient_weights(fract(p.x)),gy=gradient_weights(fract(p.y));vec3 h=vec3(0);
 for(int j=0;j<4;j++)for(int i=0;i<4;i++){
  float sample_height=textureLod(original_height_map,(base+vec2(float(i)-1.0,float(j)-1.0)+.5)/height_n,0.0).r;
  h+=sample_height*vec3(wx[i]*wy[j],gx[i]*wy[j]*height_n/40000.0,wx[i]*gy[j]*height_n/40000.0);
 }
 return h;
}
float forestWaterCoverage(vec2 world){vec2 uv=world/40000.0;vec4 water=textureLod(ground_water,uv,0.0);return max(max(water.g,water.b),textureLod(river_footprint,uv,0.0).a);}
#include "res://shaders/original_forest.gdshaderinc"
#include "res://shaders/terrain_detail.gdshaderinc"
#include "res://shaders/meso_material.gdshaderinc"
#include "res://shaders/surface_water.gdshaderinc"
#include "res://shaders/rock_projection.gdshaderinc"
// Complement uses the original crown palette, never a rocky/snowy closed guide.
vec3 montanePalette(){
 float humid=uMaterialClimate.y/max(20.0*uMaterialClimate.x+280.0,120.0);
 float dry=1.0-groundSmooth(.8,2.0,humid);
 return mix(vec3(.15,.25,.16),vec3(.20,.24,.15),dry);
}
float montaneResolvedReveal(vec2 world,float footprint){
 // Match the pinned forest's statistical-to-crown blend. Add the expected
 // canopy only to its unresolved reference branch, never to openGround.
 float reveal=forestReveal(footprint),cell=uForestRect.z/float(textureSize(uForestField,0).x);
 float lod=max(log2(footprint/cell),0.0);vec4 f=forestField(world,lod+2.0*(1.0-reveal));
 float dry=1.0-groundSmooth(.8,2.0,uMaterialClimate.y/max(20.0*uMaterialClimate.x+280.0,120.0));
 float height=f.g*50.0,radius=mix((.24*height+1.0)*(1.0+.45*dry),.14*height+.9,f.b);
 float crown=groundSmooth(.9,2.0,radius/footprint);
 return reveal*mix(.06,1.0,crown*crown);
}
void vertex(){
 UV=vec2(gridCoordinate(UV.x,0),gridCoordinate(UV.y,1))/40000.0;
 VERTEX.xz=UV*40000.0-20000.0;
 vec2 p=UV*height_n-0.5;vec2 base=floor(p);vec4 wx=weights(fract(p.x));vec4 wy=weights(fract(p.y));float h=0.0;
 vec4 gx=gradient_weights(fract(p.x));vec4 gy=gradient_weights(fract(p.y));vec2 gradient=vec2(0);
 for(int j=0;j<4;j++)for(int i=0;i<4;i++){
   float sample_height=textureLod(height_map,(base+vec2(float(i)-1.0,float(j)-1.0)+0.5)/height_n,0.0).r;
   h+=sample_height*wx[i]*wy[j];gradient+=sample_height*vec2(gx[i]*wy[j],wx[i]*gy[j])*height_n/40000.0;
 }
 vec3 detail=mesoSample(UV*40000.0,gridDensity(UV*40000.0));
 ground_macro_slope=gradient;ground_detail_slope=detail.yz;
 VERTEX.y=max(0.0,h+detail.x);gradient+=detail.yz;ground_position=(MODEL_MATRIX*vec4(VERTEX,1.0)).xyz;
 ground_geometric_normal=normalize(mat3(MODEL_MATRIX)*vec3(-gradient.x,1,-gradient.y));
}

// Triangular-lattice stochastic patches, following the technique described in
// RENDER_REVIEW 3.1 / RENDER_SURFACE_DESIGN 7.2. This is a mean-centred variance
// correction, not Heitz's full histogram-preserving transform.
uint patch_hash(uint h){h=(h^(h>>16u))*2246822519u;h=(h^(h>>13u))*3266489917u;return h^(h>>16u);}
vec3 patch_random(ivec2 cell,int type_id,float seed){
 uint h=patch_hash(uint(cell.x)*1597334677u+uint(cell.y)*3812015801u+uint(type_id+1)*2798796415u+uint(seed*65535.0));
 uint k=patch_hash(h+1013904223u);uint j=patch_hash(k+1664525u);
 return vec3(float(h&65535u),float(k&65535u),float(j&65535u))/65535.0;
}
void source_patch(int type_id,vec4 params,vec2 uv,vec2 dx,vec2 dy,ivec2 patch,float seed,float direction,RockProjection projection,out vec3 color,out vec3 normal,out float roughness){
 vec3 random=patch_random(patch,type_id,seed);
 if(params.z>.5&&type_id!=16&&type_id!=84&&(ground_stochastic||(projection.enabled&&rock_projection_enabled&&type_id<22))){
   // Sample the axis at the patch anchor, so the modulo-pi branch cannot
   // flip one photograph halfway through a patch. Neighbour patches blend.
   vec2 anchor=vec2(float(patch.x)+.5*float(patch.y),.866025404*float(patch.y))*1.4*params.y;
   vec2 axis=textureLod(ground_structure,anchor/40000.0,0.0).rg*2.0-1.0;
   direction=atan(axis.y,axis.x)*.5;
 }
 float angle=params.z>.5?direction+(random.x-.5)*.10:random.x*6.2831853;
 if(!ground_stochastic)angle=params.z>.5?direction:floor(seed*4.0)*1.5707963;
 mat2 rotation=mat2(vec2(cos(angle),sin(angle)),vec2(-sin(angle),cos(angle)));
 vec2 offset=ground_stochastic?random.yz:vec2(seed,seed*.731);
 vec3 chart_x=vec3(1,0,0),chart_z=vec3(0,0,1);
 if(projection.enabled&&rock_projection_enabled&&type_id<22&&projection.amount>0.0){
   vec2 anchor=vec2(float(patch.x)+.5*float(patch.y),.866025404*float(patch.y))*1.4*params.y;
   rockChart(projection,anchor,params.y,uv,dx,dy,chart_x,chart_z);
 }
 vec2 at=rotation*uv+offset;
 vec2 gx=rotation*dx;vec2 gy=rotation*dy;
 vec4 nr=textureGrad(ground_normals,vec3(at,params.x),gx,gy);
 float height=textureGrad(ground_heights,vec3(at,params.x),gx,gy).r;
 vec3 source_mean=texelFetch(ground_palette,ivec2(type_id,3),0).gba;
 vec3 mean=texelFetch(ground_palette,ivec2(type_id,1),0).rgb;
 vec3 gain=texelFetch(ground_palette,ivec2(type_id,2),0).rgb;
 color=mean+(textureGrad(ground_colors,vec3(at,params.x),gx,gy).rgb-source_mean)*gain;
 normal=normalize(nr.rgb*2.0-1.0);normal.xy=transpose(rotation)*normal.xy;
 if(projection.enabled&&rock_projection_enabled&&type_id<22)normal=rockChartNormal(normal,chart_x,chart_z,projection);
 roughness=clamp(nr.a+(height-.5)*.04,.08,1.0);
 if(type_id<22&&rock_detail_enabled){color*=1.0+.028*(height-.5)*projection.amount;roughness=clamp(roughness+.045*(height-.5)*projection.amount,.08,1.0);}
}

// Linear source means and PBR detail share the same resolved palette.
void ground_sample_projected(int type_id,vec2 metres,vec2 dx,vec2 dy,RockProjection projection,out vec3 color,out vec3 normal,out float roughness){
 vec4 params=texelFetch(ground_palette,ivec2(type_id,0),0);
 vec3 mean=texelFetch(ground_palette,ivec2(type_id,1),0).rgb;
 float footprint=max(length(dx),length(dy));
 if(projection.enabled&&rock_projection_enabled&&type_id<22)footprint=mix(footprint,sqrt(max(dot(dx,dx)+projection.dh.x*projection.dh.x,dot(dy,dy)+projection.dh.y*projection.dh.y)),projection.amount);
 float detail=1.0-smoothstep(params.y*.12,params.y*.65,footprint);
 normal=vec3(0.0,0.0,1.0);roughness=.85;color=mean;
 if(ground_view==2){color=.15+.7*fract(sin(vec3(float(type_id)+1.0)*vec3(12.9898,78.233,35.425))*43758.5453);return;}
 if(detail>.001){
   vec2 uv=metres/params.y;
   float offset=texelFetch(ground_palette,ivec2(type_id,3),0).r;
   float angle=0.0;
   if(params.z>.5){
     vec2 direction=textureLod(ground_structure,metres/40000.0,0.0).rg*2.0-1.0;
     angle=(type_id==16||type_id==84)?1.2217305:atan(direction.y,direction.x)*.5;
   }
   vec2 grid=mat2(vec2(1.0,0.0),vec2(-.577350269,1.154700538))*(uv/1.4);
   ivec2 base=ivec2(floor(grid));vec2 f=fract(grid);
   ivec2 a;ivec2 b;ivec2 c;vec3 w;
   if(f.x+f.y<1.0){a=base;b=base+ivec2(1,0);c=base+ivec2(0,1);w=vec3(1.0-f.x-f.y,f.x,f.y);}
   else{a=base+ivec2(1,1);b=base+ivec2(0,1);c=base+ivec2(1,0);w=vec3(f.x+f.y-1.0,1.0-f.x,1.0-f.y);}
   w=w*w;w/=max(dot(w,vec3(1.0)),.00001);
   if(!ground_stochastic)w=vec3(1,0,0);
   vec3 sample_color=vec3(0);vec3 sample_normal=vec3(0);float sample_roughness=0.0;
   for(int patch=0;patch<3;patch++){
     if(w[patch]>.0001){
       vec3 pc;vec3 pn;float pr;
       source_patch(type_id,params,uv,dx/params.y,dy/params.y,patch==0?a:(patch==1?b:c),offset,angle,projection,pc,pn,pr);
       sample_color+=pc*w[patch];sample_normal+=pn*w[patch];sample_roughness+=pr*w[patch];
     }
   }
   float contrast=min(1.4,inversesqrt(dot(w,w)));
   sample_color=clamp(mean+(sample_color-mean)*contrast,vec3(0),vec3(1));
   color=mix(mean,sample_color,detail);
   float normal_gain=params.w;
   if(type_id<22&&rock_detail_enabled){sample_normal.xy*=mix(1.0,min(1.25,contrast),projection.amount);normal_gain=mix(normal_gain,min(.75,normal_gain*1.35),projection.amount);}
   normal=normalize(mix(vec3(0,0,1),normalize(sample_normal),normal_gain*detail));
   roughness=mix(.85,sample_roughness,detail);
 }
}
void ground_sample(int type_id,vec2 metres,vec2 dx,vec2 dy,out vec3 color,out vec3 normal,out float roughness){
 RockProjection p;p.height=ground_position.y;p.dh=vec2(0);
 p.tangent=vec3(1,0,0);p.across=vec3(0,0,1);p.amount=0.0;p.enabled=false;
 ground_sample_projected(type_id,metres,dx,dy,p,color,normal,roughness);
}
float matrixCoverAt(ivec2 cell,float cover_mod){
 vec4 c=texelFetch(cover_weights,cell,0);vec4 p=texelFetch(forest_placement,cell,0);
 return ground_view==3||c.r*p.r+c.g+c.b<.00001?0.0:c.a*p.g*cover_mod;
}
void ground_cell(ivec2 cell,float cell_weight,vec2 metres,vec2 dx,vec2 dy,float cover_mod,RockProjection projection,inout vec3 color,inout vec3 normal,inout float roughness){
 ivec2 valid=clamp(cell,ivec2(0),ivec2(int(height_n)-1));
 ivec4 ids=ivec4(round(texelFetch(ground_indices,valid,0)*255.0));vec4 shares=texelFetch(ground_weights,valid,0);
 ivec4 extra_ids=ivec4(round(texelFetch(ground_indices_extra,valid,0)*255.0));vec4 extra_shares=texelFetch(ground_weights_extra,valid,0);
 float soil_cover=matrixCoverAt(valid,cover_mod);
 // Cell recipes are fixed fields; their four responses are interpolated by
 // the existing material weights. A weak rock trace does not justify chart
 // reads under a whole meadow/forest, and the gate has no pixel-varying UV.
 projection.amount=smoothstep(.35,.65,shares.r+shares.g);
 for(int k=0;k<6;k++){
   float w=(k<4?shares[k]:extra_shares[k-4])*cell_weight*(k<3?1.0:1.0-soil_cover);
   int id=k<4?ids[k]:extra_ids[k-4];
   if(w>.0001){vec3 c;vec3 n;float r;ground_sample_projected(id,metres,dx,dy,projection,c,n,r);color+=c*w;normal+=n*w;roughness+=r*w;}
 }
}
void cover_cell(ivec2 cell,float cell_weight,vec2 metres,vec2 dx,vec2 dy,float cover_mod,inout vec3 color,inout vec3 normal,inout float roughness,inout float coverage){
 ivec2 valid=clamp(cell,ivec2(0),ivec2(int(height_n)-1));
 ivec3 ids=ivec3(round(texelFetch(cover_indices,valid,0).rgb*255.0));vec4 shares=texelFetch(cover_weights,valid,0);
 vec4 policy=texelFetch(forest_placement,valid,0);
 vec4 support=texelFetch(ground_weights,valid,0);vec4 support_extra=texelFetch(ground_weights_extra,valid,0);
 float amount=matrixCoverAt(valid,cover_mod)*(support.a+support_extra.r+support_extra.g);
 vec3 contexts=shares.rgb*vec3(policy.r,1.0,1.0);contexts/=max(dot(contexts,vec3(1)),.00001);
 coverage+=amount*cell_weight;
 for(int k=0;k<3;k++){
   float w=contexts[k]*amount*cell_weight;
   if(w>.0001){
     vec3 c;vec3 n;float r;ground_sample(ids[k],metres,dx,dy,c,n,r);
     if(ground_view!=2&&ids[k]>=58){
       vec3 mean=texelFetch(ground_palette,ivec2(ids[k],1),0).rgb;
       vec3 target=groundToLinear(texture(original_open,ground_position.xz/40000.0).rgb);
       c=clamp(target+(c-mean),vec3(0),vec3(1));
     }
     color+=c*w;normal+=n*w;roughness+=r*w;
   }
 }
}
vec3 groundWorldNormal(vec3 micro,vec2 additional_slope){
 vec2 slope=ground_macro_slope+ground_detail_slope+additional_slope;vec3 geom=normalize(vec3(-slope.x,1,-slope.y));
 vec3 tangent=normalize(vec3(max(geom.y,.01),-geom.x,0));vec3 bitangent=normalize(cross(geom,tangent));
 return normalize(tangent*micro.x+bitangent*micro.y+geom*micro.z);
}
void fragment(){
 if(terrain_height_probe){
   vec3 packed=fract((ground_position.y+32.0)/8192.0*vec3(1,255,65025));packed-=packed.yzz*vec3(1.0/255.0,1.0/255.0,0);
   vec3 linear=mix(packed/12.92,pow((packed+.055)/1.055,vec3(2.4)),step(vec3(.04045),packed));
   ALBEDO=vec3(0);EMISSION=linear;SPECULAR=0.0;ROUGHNESS=1.0;
 }else if(terrain_normal_probe){
   vec2 dx=dFdx(ground_position.xz),dy=dFdy(ground_position.xz);
   MesoSurface m=mesoSurface(ground_position.xz,sqrt(dot(dx,dx)+dot(dy,dy)),false);
   vec3 n=groundWorldNormal(vec3(0,0,1),m.physical_slope-ground_detail_slope);
   vec3 display=n*.5+.5;
   ALBEDO=vec3(0);EMISSION=mix(display/12.92,pow((display+.055)/1.055,vec3(2.4)),step(vec3(.04045),display));SPECULAR=0.0;
 }else{
 vec4 info=info_smooth?texture(info_image_linear,UV):texture(info_image,UV);
 vec3 original=texture(map_image,UV).rgb;
 ALBEDO=vec3(0);EMISSION=original;ROUGHNESS=1.0;SPECULAR=0.0;
 if(ground_view>0){
   vec2 dx=dFdx(ground_position.xz);vec2 dy=dFdy(ground_position.xz);
   vec4 native_water=texture(ground_water,UV);float vector_river=texture(river_footprint,UV).a;
   MesoSurface meso=mesoSurface(ground_position.xz,sqrt(dot(dx,dx)+dot(dy,dy)),ground_view!=3);
   vec2 texture_world=ground_position.xz;vec2 texture_dx=dx,texture_dy=dy;
   if(ground_stochastic){texture_world+=meso.warp;texture_dx=meso.jacobian*dx;texture_dy=meso.jacobian*dy;}
   vec2 p=UV*height_n-.5;ivec2 base=ivec2(floor(p));vec2 t=fract(p);
   vec3 color=vec3(0);vec3 micro=vec3(0);float roughness=0.0;
   vec3 surface_color=vec3(0);vec3 surface_normal=vec3(0);float surface_roughness=0.0;float surface_coverage=0.0;
   if(ground_view!=3){
     cover_cell(base,(1.0-t.x)*(1.0-t.y),texture_world,texture_dx,texture_dy,meso.cover_mod,surface_color,surface_normal,surface_roughness,surface_coverage);
     cover_cell(base+ivec2(1,0),t.x*(1.0-t.y),texture_world,texture_dx,texture_dy,meso.cover_mod,surface_color,surface_normal,surface_roughness,surface_coverage);
     cover_cell(base+ivec2(0,1),(1.0-t.x)*t.y,texture_world,texture_dx,texture_dy,meso.cover_mod,surface_color,surface_normal,surface_roughness,surface_coverage);
     cover_cell(base+ivec2(1,1),t.x*t.y,texture_world,texture_dx,texture_dy,meso.cover_mod,surface_color,surface_normal,surface_roughness,surface_coverage);
   }
   // Keep these chart values out of the cover-pass live register set. The
   // catalogue's rock repeats are <=5.4m; by 8m/px all photo detail is gone.
   RockProjection projection;projection.height=ground_position.y;projection.dh=vec2(dFdx(ground_position.y),dFdy(ground_position.y));
   projection.amount=1.0;projection.enabled=max(native_water.a,vector_river)<.999&&max(length(texture_dx),length(texture_dy))<8.0;
   projection.tangent=vec3(1,0,0);projection.across=vec3(0,0,1);
   if(projection.enabled){
     vec2 physical_slope=ground_macro_slope+(meso_material_enabled&&meso_ready?meso.physical_slope:ground_detail_slope);
     vec3 physical_normal=normalize(vec3(-physical_slope.x,1,-physical_slope.y));
     rockProjectionBasis(physical_normal,ground_stochastic?meso.jacobian:mat2(vec2(1,0),vec2(0,1)),projection.tangent,projection.across);
   }
   // Interpolate four material responses, never the categorical IDs.
   {
   ground_cell(base,(1.0-t.x)*(1.0-t.y),texture_world,texture_dx,texture_dy,meso.cover_mod,projection,color,micro,roughness);
   ground_cell(base+ivec2(1,0),t.x*(1.0-t.y),texture_world,texture_dx,texture_dy,meso.cover_mod,projection,color,micro,roughness);
   ground_cell(base+ivec2(0,1),(1.0-t.x)*t.y,texture_world,texture_dx,texture_dy,meso.cover_mod,projection,color,micro,roughness);
   ground_cell(base+ivec2(1,1),t.x*t.y,texture_world,texture_dx,texture_dy,meso.cover_mod,projection,color,micro,roughness);
   }
   color+=surface_color;micro+=surface_normal;roughness+=surface_roughness;
   if(ground_stochastic){vec2 xy=transpose(meso.jacobian)*vec2(micro.x,-micro.y);micro=normalize(vec3(xy.x,-xy.y,micro.z));}
   if(ground_view!=2){color*=1.0+.18*meso.signal+.11*meso.grain-.045*meso.cavity;roughness=clamp(roughness+.06*meso.grain+meso.unresolved_roughness,.08,1.0);}
   vec2 meso_slope=ground_view==2?vec2(0):(meso_material_enabled&&meso_ready?meso.physical_slope-ground_detail_slope:vec2(0))+meso.grain_slope;
   float original_forest_scope=0.0;
   vec3 original_forest_normal=vec3(0,1,0);
   float original_forest_occlusion=1.0;
   float resolved_tree_cover=0.0;
   if(original_cover_enabled&&ground_view!=3&&ground_view!=2){
     vec4 cover=texture(original_cover,UV);
     vec3 open=texture(original_open,UV).rgb;
     vec3 closed=texture(original_closed,UV).rgb;
     float added=texture(montane_forest,UV).r;
     float total=texture(uForestField,UV).r;
     closed=mix(closed,montanePalette(),clamp(added/max(total,.00001),0.0,1.0));
     float footprint=max(max(length(dx),length(dy)),.02);
     // The historical tree model sits above the actual PBR soil. Its open
     // guide cancels itself in applyForest's colour ratio, retaining PBR detail
     // between crowns instead of replacing the whole cell with a flat colour.
     float unresolved_canopy=smoothstep(.35,3.0,footprint)*texture(forest_placement,UV).r;
     GroundMaterial legacy;legacy.albedo=mix(color,groundToLinear(texture(original_color,UV).rgb),unresolved_canopy);legacy.normal=groundWorldNormal(micro,meso_slope);legacy.roughness=roughness;legacy.occlusion=1.0;
     vec3 forest_reference=legacy.albedo;
     applyForest(legacy,ground_position.xz,footprint,original_light,open,open,closed,cover.b,resolved_tree_cover);
     legacy.albedo+=(1.0-montaneResolvedReveal(ground_position.xz,footprint))*added*(groundToLinear(montanePalette())-forest_reference);
     vec4 field=forestField(ground_position.xz,max(log2(footprint/(uForestRect.z/float(textureSize(uForestField,0).x))),0.0));
     original_forest_scope=groundSmooth(0.,.015,max(max(field.r,forestField(ground_position.xz,1.0).r),resolved_tree_cover));
     color=mix(color,legacy.albedo,original_forest_scope);
     original_forest_normal=legacy.normal;original_forest_occlusion=legacy.occlusion;
     roughness=mix(roughness,legacy.roughness,original_forest_scope);
   }
   vec4 attrs=texture(ground_attributes,UV);vec4 water=native_water;
   float pixel_footprint=sqrt(dot(dx,dx)+dot(dy,dy));
   vec2 shore=shoreDistance(ground_position.xz,pixel_footprint);
   if(water_shore_smooth&&water_shore_ready)water.bg=standingWater(shore,pixel_footprint);
   float wetness=clamp(attrs.r+(ground_state==1?-.28:(ground_state==2?.24:0.0)),0.0,1.0);
   float permanent=max(water.g,water.b);float river=vector_river;
   float water_mask=max(permanent,river);float snow=0.0;
   if(ground_state<3&&ground_auto_snow&&ground_view!=3){
     snow=texture(render_snow,UV).r*(1.0-water_mask)*(1.0-resolved_tree_cover);
     if(snow>.001){vec3 sc;vec3 sn;float sr;ground_sample(80,ground_position.xz,dx,dy,sc,sn,sr);color=mix(color,sc,snow);micro=mix(micro,sn,snow);roughness=mix(roughness,sr,snow);}
   }
   if(ground_state>=3&&ground_state<=9&&ground_view!=3){
     float local_temp=attrs.g*70.0-30.0;
     // An explicit scene anomaly, not a change to annual climate or history.
     float cold=1.0-smoothstep(-4.0,4.0,local_temp-18.0);
     snow=attrs.b*cold*(1.0-water_mask);
     if(ground_state==8||ground_state==9)snow*=.55;
     vec4 cover_shares=texelFetch(cover_weights,clamp(base,ivec2(0),ivec2(int(height_n)-1)),0);
     bool on_grass=surface_coverage>.25&&cover_shares.g>cover_shares.r&&cover_shares.g>cover_shares.b;
     int snow_type=ground_state==3?80:(ground_state==4?81:(ground_state==5?82:(ground_state==6?83:(ground_state==7?84:(ground_state==8?(on_grass?86:87):85)))));
     vec3 sc;vec3 sn;float sr;ground_sample(snow_type,ground_position.xz,dx,dy,sc,sn,sr);
     color=mix(color,sc,snow);micro=mix(micro,sn,snow);roughness=mix(roughness,sr,snow);
   }
   if(ground_state>=10&&ground_view!=3){
     float local_temp=attrs.g*70.0-30.0;
     float ice=(1.0-smoothstep(-3.0,3.0,local_temp-18.0))*max(permanent,wetness*.20);
     vec3 ic;vec3 inn;float ir;ground_sample(ground_state==10?88:89,ground_position.xz,dx,dy,ic,inn,ir);
     color=mix(color,ic,ice);micro=mix(micro,inn,ice);roughness=mix(roughness,ir,ice);water_mask*=1.0-ice;
   }
   color*=1.0-.20*wetness*(1.0-snow);
   meso_slope=ground_view==2?vec2(0):(meso_material_enabled&&meso_ready?meso.physical_slope-ground_detail_slope:vec2(0))+meso.grain_slope*(1.0-snow);
   vec3 world_normal=groundWorldNormal(micro,meso_slope);
   world_normal=normalize(mix(world_normal,original_forest_normal,original_forest_scope*(1.0-snow*(1.0-resolved_tree_cover))));
   vec3 water_color;vec3 water_normal;float water_roughness;
   water_color=color;water_normal=world_normal;water_roughness=roughness;
   if(water_mask>.0001)waterMaterial(ground_position.xz,dx,dy,water,shore,normalize(CAMERA_POSITION_WORLD-ground_position),water_color,water_normal,water_roughness);
   world_normal=normalize(mix(world_normal,water_normal,water_mask));
   NORMAL=normalize((VIEW_MATRIX*vec4(world_normal,0)).xyz);
   float overlay=info.a*info_opacity;
   ALBEDO=mix(color,water_color,water_mask)*(1.0-overlay);ROUGHNESS=mix(clamp(roughness-.25*wetness,.1,1.0),water_roughness,water_mask);SPECULAR=mix(.25,.85,water_mask)*(1.0-overlay);
   AO=mix(texture(ground_structure,UV).b*(1.0-.08*meso.cavity*(1.0-snow))*mix(1.0,original_forest_occlusion,original_forest_scope),1.0,water_mask);AO_LIGHT_AFFECT=0.0;
   EMISSION=info.rgb*overlay;
   if(ground_view==1&&ground_macro_reference&&ground_state==0&&ground_auto_snow){
     float footprint=max(length(dx),length(dy));float macro=smoothstep(4.0,24.0,footprint);
     float rock=texture(forest_placement,UV).b;
     vec3 open=groundToLinear(texture(original_open,UV).rgb);
     vec3 reference=original*mix(vec3(1),clamp(color/max(open,vec3(.02)),vec3(.65),vec3(1.5)),smoothstep(.25,.75,rock)*(1.0-water_mask));
     if(water_shore_smooth&&water_shore_ready){
       float shore_band=(1.0-smoothstep(60.0,120.0,min(abs(shore.x),abs(shore.y))))*(1.0-river);
       if(shore_band>0.0){
         vec3 dry=texture(water_reference_dry,UV).rgb*clamp(reference/max(original,vec3(.001)),vec3(.65),vec3(1.5));
         vec3 wet=texture(water_reference_wet,UV).rgb;
         reference=mix(reference,mix(dry,wet,max(water.g,water.b)),shore_band);
       }
     }
     if(original_cover_enabled)reference=mix(reference,groundToLinear(montanePalette()),texture(montane_forest,UV).r*(1.0-water_mask));
     ALBEDO*=1.0-macro;SPECULAR*=1.0-macro;
     EMISSION+=reference*macro*(1.0-overlay);
   }
   if(ground_view==2){EMISSION=mix(mix(color,water_color,water_mask),info.rgb,overlay);ALBEDO=vec3(0);}
   if(forest_coverage_probe){ALBEDO=vec3(0);EMISSION=groundToLinear(vec3(resolved_tree_cover));SPECULAR=0.0;AO=1.0;}
   if(water_domain_probe){ALBEDO=vec3(0);EMISSION=groundToLinear(vec3(water.b,water.g,river));SPECULAR=0.0;AO=1.0;}
   if(rock_normal_probe){vec3 display=world_normal*.5+.5;ALBEDO=vec3(0);EMISSION=mix(display/12.92,pow((display+.055)/1.055,vec3(2.4)),step(vec3(.04045),display));SPECULAR=0.0;AO=1.0;}
 }else{EMISSION=mix(original,info.rgb,info.a*info_opacity);}
 }
}
