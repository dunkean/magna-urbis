// Keep the existing three stochastic photo samples; change their coordinate
// charts instead of sampling three additional world projections per material.
uniform bool rock_projection_enabled=true;
uniform bool rock_detail_enabled=true;
struct RockProjection{
 float height;vec2 dh;vec3 tangent;vec3 across;float amount;bool enabled;
};
void rockProjectionBasis(vec3 n,mat2 warp,out vec3 tangent,out vec3 across){
 vec3 t=normalize(vec3(n.y,-n.x,0)),b=cross(t,n);mat2 undo=inverse(transpose(warp));
 vec3 u=t*undo[0].x+b*undo[1].x,v=t*undo[0].y+b*undo[1].y;
 vec2 uxz=warp*u.xz,vxz=warp*v.xz;tangent=vec3(uxz.x,u.y,uxz.y);across=vec3(vxz.x,v.y,vxz.y);
}
vec3 rockAnchor(vec2 world){
 vec2 p=world/40000.0*height_n-.5;ivec2 base=ivec2(floor(p)),last=ivec2(int(height_n)-1);vec2 t=fract(p);
 float a=texelFetch(height_map,clamp(base,ivec2(0),last),0).r,b=texelFetch(height_map,clamp(base+ivec2(1,0),ivec2(0),last),0).r;
 float c=texelFetch(height_map,clamp(base+ivec2(0,1),ivec2(0),last),0).r,d=texelFetch(height_map,clamp(base+ivec2(1,1),ivec2(0),last),0).r;
 return vec3(mix(mix(a,b,t.x),mix(c,d,t.x),t.y),vec2(mix(b-a,d-c,t.y),mix(c-a,d-b,t.x))*(height_n/40000.0));
}
float rockChart(RockProjection p,vec2 anchor,float scale,inout vec2 uv,inout vec2 dx,inout vec2 dy,out vec3 qx,out vec3 qz){
 vec3 field=rockAnchor(anchor),n=normalize(vec3(-field.y,1,-field.z));
 vec3 tangent=normalize(vec3(n.y,-n.x,0)),across=cross(tangent,n);
 // This weight is fixed at the patch anchor, so no omitted grad(weight)
 // term, camera-selected frame, or view-dependent stochastic hash occurs.
 float amount=smoothstep(.46630766,1.42814801,length(field.yz))*p.amount;
 qx=mix(vec3(1,0,0),tangent,amount);qz=mix(vec3(0,0,1),across,amount);
 if(amount>0.0){
   vec2 base=anchor/scale;
   vec3 v=vec3(uv.x-base.x,(p.height-field.x)/scale,uv.y-base.y);
   vec3 gx=vec3(dx.x,p.dh.x/scale,dx.y),gy=vec3(dy.x,p.dh.y/scale,dy.y);
   uv=base+vec2(dot(v,qx),dot(v,qz));
   dx=vec2(dot(gx,qx),dot(gx,qz));dy=vec2(dot(gy,qx),dot(gy,qz));
 }
 return amount;
}
vec3 rockChartNormal(vec3 micro,vec3 qx,vec3 qz,RockProjection p){
 // Pull back a height gradient, not the anchor's complete normal. A neutral
 // normal map therefore leaves the current physical terrain normal intact.
 vec3 gradient=(-micro.x*qx+micro.y*qz)/max(micro.z,.2);
 // The warp and inverse of the established final 2D pullback have already
 // been folded into these two vectors once per pixel, not once per sample.
 return normalize(vec3(-dot(gradient,p.tangent),dot(gradient,p.across),1));
}
