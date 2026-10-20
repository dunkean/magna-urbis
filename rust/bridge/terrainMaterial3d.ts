/** Render3D extends the existing material; the original Render shader is untouched.
 * Spatial derivatives and footprint filtering keep each octave stationary in
 * world metres. Derivative damping follows the terrain synthesis approach
 * described by Inigo Quilez in "Behind Elevated"; this is an albedo/detail layer,
 * not an additional terrain generator.
 */
export const RENDER_3D_MATERIAL_GLSL = `
vec4 r3dNoise(vec3 p, uint salt) {
  ivec3 cell=ivec3(floor(p)); vec3 f=fract(p);
  vec3 u=f*f*f*(f*(f*6.-15.)+10.);
  vec3 du=30.*f*f*(f*(f-2.)+1.);
  float value=0.; vec3 derivative=vec3(0.);
  for(int z=0;z<2;z++)for(int y=0;y<2;y++)for(int x=0;x<2;x++){
    ivec3 corner=ivec3(x,y,z); uint h=surfaceHash(cell+corner,salt);
    vec3 gradient=vec3(float(h&1023u),float((h>>10u)&1023u),float((h>>20u)&1023u))/511.5-1.;
    vec3 w=mix(1.-u,u,vec3(corner));
    vec3 dw=mix(-du,du,vec3(corner));
    float v=dot(gradient,f-vec3(corner)), weight=w.x*w.y*w.z;
    value+=v*weight;
    derivative+=gradient*weight+v*vec3(dw.x*w.y*w.z,w.x*dw.y*w.z,w.x*w.y*dw.z);
  }
  return vec4(value,derivative)*1.7;
}
vec4 r3dFractal(vec3 p,float scale,float footprint,uint salt){
  const mat3 rotation=mat3(.36,.48,-.8,-.8,.6,0.,.48,.64,.6);
  mat3 orientation=mat3(1.); vec4 sum=vec4(0.); vec3 accumulated=vec3(0.);
  float amplitude=1.,wavelength=scale;
  for(int octave=0;octave<6;octave++){
    float resolved=1.-sstep(wavelength*.12,wavelength*.35,footprint);
    if(resolved<=0.)break;
    vec4 n=r3dNoise(orientation*p/wavelength,salt+uint(octave)*0x9e37u);
    vec3 gradient=transpose(orientation)*n.yzw;
    accumulated+=gradient*amplitude;
    float damp=1./(1.+.35*dot(accumulated,accumulated));
    sum+=vec4(n.x,gradient/wavelength)*(amplitude*resolved*damp);
    wavelength*=.5; amplitude*=.5; orientation=rotation*orientation;
  }
  return sum;
}
vec3 terrain3dMaterial(vec3 s,vec2 world,float footprint,float tpi,float shore,float openness){
  float fp=max(footprint,.03125);
  vec3 color=earthMaterial(s,world,max(fp,1.),tpi,shore,openness);
  vec3 point=vec3(world.x,s.x,world.y);
  float grade=length(s.yz);
  float vegetation=sstep(.005,.085,color.g-color.r)*(1.-sstep(.45,1.,grade));
  float rock=sstep(.18,.85,grade)*(1.-.5*vegetation);
  float snow=sstep(.72,.92,min(color.r,min(color.g,color.b)));
  // Resolved crowns / fractures / grains have fixed physical sizes. No octave
  // normalization by the number currently visible: zoom never pumps contrast.
  vec4 structure=r3dFractal(point,24.,fp,uMaterialSeed+0x751bu);
  vec3 warp=structure.yzw*3.;
  vec4 granules=r3dFractal(point+warp,2.,fp,uMaterialSeed+0x239du);
  float strataWidth=3.;
  float strataFade=1.-sstep(strataWidth*.12,strataWidth*.35,fp);
  float strata=sin((s.x+.35*structure.x)*6.2831853/strataWidth)*strataFade;
  float variation=mix(.025*granules.x,.09*structure.x+.025*granules.x,vegetation);
  variation+=rock*(.045*structure.x+.035*granules.x+.018*strata);
  variation*=1.-.8*snow;
  // Shallow normal detail, bounded independently of the mesh displacement.
  vec3 bump=(structure.yzw*.018+granules.yzw*.006)*(1.-snow);
  vec2 tangent=vec2(bump.x+bump.y*s.y,bump.z+bump.y*s.z);
  float relief=clamp(1.-dot(tangent,vec2(-.55,-.65)),.92,1.08);
  return clamp(color*(1.+clamp(variation,-.12,.12))*relief,vec3(0.),vec3(1.));
}
`;
