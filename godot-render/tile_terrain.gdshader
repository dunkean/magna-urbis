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
#include "res://shaders/surface_water.gdshaderinc"
void vertex(){
 vec2 mesh_spacing=vec2(gridCoordinate(min(UV.x+.5/height_n,1.0),terrain_grid_focus.x)-gridCoordinate(max(UV.x-.5/height_n,0.0),terrain_grid_focus.x),gridCoordinate(min(UV.y+.5/height_n,1.0),terrain_grid_focus.y)-gridCoordinate(max(UV.y-.5/height_n,0.0),terrain_grid_focus.y));
 UV=vec2(gridCoordinate(UV.x,terrain_grid_focus.x),gridCoordinate(UV.y,terrain_grid_focus.y))/40000.0;
 VERTEX.xz=UV*40000.0-20000.0;
 vec2 p=UV*height_n-0.5;vec2 base=floor(p);vec4 wx=weights(fract(p.x));vec4 wy=weights(fract(p.y));float h=0.0;
 vec4 gx=gradient_weights(fract(p.x));vec4 gy=gradient_weights(fract(p.y));vec2 gradient=vec2(0);
 for(int j=0;j<4;j++)for(int i=0;i<4;i++){
   float sample_height=textureLod(height_map,(base+vec2(float(i)-1.0,float(j)-1.0)+0.5)/height_n,0.0).r;
   h+=sample_height*wx[i]*wy[j];gradient+=sample_height*vec2(gx[i]*wy[j],wx[i]*gy[j])*height_n/40000.0;
 }
 vec3 detail=detailNoise(UV*40000.0)*detailAmplitude(UV,mesh_spacing);
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
void source_patch(int type_id,vec4 params,vec2 uv,vec2 dx,vec2 dy,ivec2 patch,float seed,float direction,out vec3 color,out vec3 normal,out float roughness){
 vec3 random=patch_random(patch,type_id,seed);
 if(params.z>.5&&type_id!=16&&type_id!=84&&ground_stochastic){
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
 vec2 at=rotation*uv+offset;
 vec2 gx=rotation*dx;vec2 gy=rotation*dy;
 vec4 nr=textureGrad(ground_normals,vec3(at,params.x),gx,gy);
 float height=textureGrad(ground_heights,vec3(at,params.x),gx,gy).r;
 vec3 source_mean=texelFetch(ground_palette,ivec2(type_id,3),0).gba;
 vec3 mean=texelFetch(ground_palette,ivec2(type_id,1),0).rgb;
 vec3 gain=texelFetch(ground_palette,ivec2(type_id,2),0).rgb;
 color=mean+(textureGrad(ground_colors,vec3(at,params.x),gx,gy).rgb-source_mean)*gain;
 normal=normalize(nr.rgb*2.0-1.0);normal.xy=transpose(rotation)*normal.xy;
 roughness=clamp(nr.a+(height-.5)*.04,.08,1.0);
}

// Linear source means and PBR detail share the same resolved palette.
void ground_sample(int type_id,vec2 metres,vec2 dx,vec2 dy,out vec3 color,out vec3 normal,out float roughness){
 vec4 params=texelFetch(ground_palette,ivec2(type_id,0),0);
 vec3 mean=texelFetch(ground_palette,ivec2(type_id,1),0).rgb;
 float detail=1.0-smoothstep(params.y*.12,params.y*.65,max(length(dx),length(dy)));
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
       source_patch(type_id,params,uv,dx/params.y,dy/params.y,patch==0?a:(patch==1?b:c),offset,angle,pc,pn,pr);
       sample_color+=pc*w[patch];sample_normal+=pn*w[patch];sample_roughness+=pr*w[patch];
     }
   }
   float contrast=min(1.4,inversesqrt(dot(w,w)));
   sample_color=clamp(mean+(sample_color-mean)*contrast,vec3(0),vec3(1));
   color=mix(mean,sample_color,detail);
   normal=normalize(mix(vec3(0,0,1),normalize(sample_normal),params.w*detail));
   roughness=mix(.85,sample_roughness,detail);
 }
}
void ground_cell(ivec2 cell,float cell_weight,vec2 metres,vec2 dx,vec2 dy,inout vec3 color,inout vec3 normal,inout float roughness){
 ivec2 valid=clamp(cell,ivec2(0),ivec2(int(height_n)-1));
 ivec4 ids=ivec4(round(texelFetch(ground_indices,valid,0)*255.0));vec4 shares=texelFetch(ground_weights,valid,0);
 ivec4 extra_ids=ivec4(round(texelFetch(ground_indices_extra,valid,0)*255.0));vec4 extra_shares=texelFetch(ground_weights_extra,valid,0);
 for(int k=0;k<6;k++){
   float w=(k<4?shares[k]:extra_shares[k-4])*cell_weight;
   int id=k<4?ids[k]:extra_ids[k-4];
   if(w>.0001){vec3 c;vec3 n;float r;ground_sample(id,metres,dx,dy,c,n,r);color+=c*w;normal+=n*w;roughness+=r*w;}
 }
}
void cover_cell(ivec2 cell,float cell_weight,vec2 metres,vec2 dx,vec2 dy,inout vec3 color,inout vec3 normal,inout float roughness,inout float coverage){
 ivec2 valid=clamp(cell,ivec2(0),ivec2(int(height_n)-1));
 ivec3 ids=ivec3(round(texelFetch(cover_indices,valid,0).rgb*255.0));vec4 shares=texelFetch(cover_weights,valid,0);
 coverage+=shares.a*cell_weight;
 for(int k=0;k<3;k++){
   float w=shares[k]*shares.a*cell_weight;
   if(w>.0001){vec3 c;vec3 n;float r;ground_sample(ids[k],metres,dx,dy,c,n,r);color+=c*w;normal+=n*w;roughness+=r*w;}
 }
}
void fragment(){
 vec4 info=info_smooth?texture(info_image_linear,UV):texture(info_image,UV);
 vec3 original=texture(map_image,UV).rgb;
 ALBEDO=vec3(0);EMISSION=original;ROUGHNESS=1.0;SPECULAR=0.0;
 if(ground_view>0){
   vec2 dx=dFdx(ground_position.xz);vec2 dy=dFdy(ground_position.xz);
   vec2 p=UV*height_n-.5;ivec2 base=ivec2(floor(p));vec2 t=fract(p);
   vec3 color=vec3(0);vec3 micro=vec3(0);float roughness=0.0;
   vec3 surface_color=vec3(0);vec3 surface_normal=vec3(0);float surface_roughness=0.0;float surface_coverage=0.0;
   if(ground_view!=3&&!original_cover_enabled){
     cover_cell(base,(1.0-t.x)*(1.0-t.y),ground_position.xz,dx,dy,surface_color,surface_normal,surface_roughness,surface_coverage);
     cover_cell(base+ivec2(1,0),t.x*(1.0-t.y),ground_position.xz,dx,dy,surface_color,surface_normal,surface_roughness,surface_coverage);
     cover_cell(base+ivec2(0,1),(1.0-t.x)*t.y,ground_position.xz,dx,dy,surface_color,surface_normal,surface_roughness,surface_coverage);
     cover_cell(base+ivec2(1,1),t.x*t.y,ground_position.xz,dx,dy,surface_color,surface_normal,surface_roughness,surface_coverage);
   }
   // Interpolate four material responses, never the categorical IDs.
   bool hidden_by_original=original_cover_enabled&&ground_view==1&&texture(original_cover,UV).b>=.025;
   if(surface_coverage<.999&&!hidden_by_original){
   ground_cell(base,(1.0-t.x)*(1.0-t.y),ground_position.xz,dx,dy,color,micro,roughness);
   ground_cell(base+ivec2(1,0),t.x*(1.0-t.y),ground_position.xz,dx,dy,color,micro,roughness);
   ground_cell(base+ivec2(0,1),(1.0-t.x)*t.y,ground_position.xz,dx,dy,color,micro,roughness);
   ground_cell(base+ivec2(1,1),t.x*t.y,ground_position.xz,dx,dy,color,micro,roughness);
   }
   color=color*(1.0-surface_coverage)+surface_color;
   micro=micro*(1.0-surface_coverage)+surface_normal;
   roughness=roughness*(1.0-surface_coverage)+surface_roughness;
   if(hidden_by_original){micro=vec3(0,0,1);roughness=.9;}
   float original_forest_scope=0.0;
   vec3 original_forest_normal=vec3(0,1,0);
   float original_forest_occlusion=1.0;
   if(original_cover_enabled&&ground_view!=3&&ground_view!=2){
     vec4 cover=texture(original_cover,UV);
     vec3 guide=texture(original_color,UV).rgb;
     vec3 open=texture(original_open,UV).rgb;
     vec3 closed=texture(original_closed,UV).rgb;
     float herb_or_sand=max(cover.r,cover.g);
     // The original guide controls cover and colour. Opaque grass/sand also
     // hides the substrate's mineral normal and specular response.
     color=mix(color,groundToLinear(open),herb_or_sand);
     micro=mix(micro,vec3(0,0,1),herb_or_sand);
     roughness=mix(roughness,mix(.95,.83,cover.g),herb_or_sand);
     float footprint=max(max(length(dx),length(dy)),.02);
     vec3 macro=forestRootSurface(ground_position.xz);
     GroundMaterial legacy=terrainGroundMaterial(macro,ground_position.xz,footprint,guide,uMaterialClimate,uMaterialSeed);
     float resolved;
     applyForest(legacy,ground_position.xz,footprint,original_light,guide,open,closed,cover.b,resolved);
     vec4 field=forestField(ground_position.xz,max(log2(footprint/(uForestRect.z/float(textureSize(uForestField,0).x))),0.0));
     original_forest_scope=groundSmooth(0.,.025,max(max(cover.b,field.r),max(resolved,forestBankCover(ground_position.xz,footprint))));
     color=mix(color,legacy.albedo,original_forest_scope);
     original_forest_normal=legacy.normal;original_forest_occlusion=legacy.occlusion;
     roughness=mix(roughness,legacy.roughness,original_forest_scope);
   }
   vec4 attrs=texture(ground_attributes,UV);vec4 water=texture(ground_water,UV);
   float wetness=clamp(attrs.r+(ground_state==1?-.28:(ground_state==2?.24:0.0)),0.0,1.0);
   float permanent=max(water.g,water.b);float river=texture(river_footprint,UV).a;
   float water_mask=max(permanent,river);float snow=0.0;
   if(ground_state<3&&ground_auto_snow&&ground_view!=3){
     snow=texture(render_snow,UV).r*(1.0-water_mask)*(1.0-original_forest_scope);
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
   vec3 geom=normalize(ground_geometric_normal);
   if(geom.y<0.0)geom=-geom;
   vec3 tangent=normalize(vec3(max(geom.y,.01),-geom.x,0));vec3 bitangent=normalize(cross(geom,tangent));
   vec3 world_normal=normalize(tangent*micro.x+bitangent*micro.y+geom*micro.z);
   world_normal=normalize(mix(world_normal,original_forest_normal,original_forest_scope));
   vec3 water_color;vec3 water_normal;float water_roughness;
   waterMaterial(ground_position.xz,dx,dy,water,normalize(CAMERA_POSITION_WORLD-ground_position),water_color,water_normal,water_roughness);
   world_normal=normalize(mix(world_normal,water_normal,water_mask));
   NORMAL=normalize((VIEW_MATRIX*vec4(world_normal,0)).xyz);
   float overlay=info.a*info_opacity;
   ALBEDO=mix(color,water_color,water_mask)*(1.0-overlay);ROUGHNESS=mix(clamp(roughness-.25*wetness,.1,1.0),water_roughness,water_mask);SPECULAR=mix(.25,.85,water_mask)*(1.0-overlay);
   AO=mix(texture(ground_structure,UV).b*mix(1.0,original_forest_occlusion,original_forest_scope),1.0,water_mask);AO_LIGHT_AFFECT=0.0;
   EMISSION=info.rgb*overlay;
   if(ground_view==2){EMISSION=mix(mix(color,water_color,water_mask),info.rgb,overlay);ALBEDO=vec3(0);}
 }else{EMISSION=mix(original,info.rgb,info.a*info_opacity);}
}
