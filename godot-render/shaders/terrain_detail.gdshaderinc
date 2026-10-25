// One bounded 9.5 m octave, fixed in world metres. The DEM is never modified.
uniform bool terrain_detail_enabled=true;
uniform float terrain_detail_amount=0.0;
uniform float terrain_grid_warp=0.0;
uniform vec2 terrain_grid_focus=vec2(20000);
float detailPermute(float x){return mod((34.0*x+1.0)*x,289.0);}
float detailHash(vec2 cell){return detailPermute(mod(cell.x,289.0)+detailPermute(mod(cell.y,289.0)))/144.0-1.0;}
vec3 detailNoise(vec2 world){
 vec2 p=world/9.5;vec2 cell=floor(p);vec2 t=fract(p);
 vec2 u=t*t*t*(t*(t*6.0-15.0)+10.0);vec2 du=30.0*t*t*(t-1.0)*(t-1.0)/9.5;
 float a=detailHash(cell),b=detailHash(cell+vec2(1,0)),c=detailHash(cell+vec2(0,1)),d=detailHash(cell+vec2(1,1));
 return vec3(mix(mix(a,b,u.x),mix(c,d,u.x),u.y),mix(b-a,d-c,u.y)*du.x,mix(c-a,d-b,u.x)*du.y);
}
float gridCoordinate(float t,float focus){
 if(terrain_grid_warp<.001)return t*40000.0;
 float q=t*2.0-1.0;return focus+(q<0.0?focus:40000.0-focus)*sinh(terrain_grid_warp*q)/sinh(terrain_grid_warp);
}
float detailAmplitude(vec2 uv,vec2 mesh_spacing){
 if(!terrain_detail_enabled)return 0.0;
 // The whole native water cell is protected, including the shore margin.
 vec4 water=textureLod(ground_water,uv,0.0);float river=textureLod(river_footprint,uv,0.0).a;
 float dry=1.0-smoothstep(.0,.05,max(max(water.g,water.b),max(water.r,river)));
 vec4 cover=textureLod(original_cover,uv,0.0);
 float amplitude=original_cover_enabled?mix(.55,.14,max(cover.r,cover.b)):.55;
 amplitude=mix(amplitude,.08,cover.g*(original_cover_enabled?1.0:0.0));
 return amplitude*dry*terrain_detail_amount*(1.0-smoothstep(2.0,8.0,max(mesh_spacing.x,mesh_spacing.y)));
}
