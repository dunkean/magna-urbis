/** Relief light of the Render v2 satellite ground: what makes the terrain's shape read from above
 * (baked sky occlusion and cast shadow of the height layer, macro slope light on ground and canopy).
 * Emitted at the head of RENDER_V2_GLSL, after the environment and canopy-mean modules, so the map,
 * the 3D ground and the material raster share it. The globals keep neutral values in programs that
 * never write them (material raster, exports). */
export const RENDER_V2_RELIEF_GLSL = `
// Relief of the fragment, written once by the ground programs (v2ReliefSet) from the shore ring texture and the
// height field: x sky occlusion (0 open sky .. 1 enclosed) and y horizon tangent toward the primary light, both
// baked per height layer (terrainForestBeach: reliefSky, reliefHorizon); zw slope of the landform (dh/dx, dh/dy
// at the height layer's cell scale, without micro-relief). All zero on a plain.
vec4 v2Relief=vec4(0.);
// 0 in programs that never set the relief (material raster, exports): their light stays neutral.
float v2ReliefLive=0.;
void v2ReliefSet(vec2 baked,vec2 slope){v2Relief=vec4(baked,slope);v2ReliefLive=1.;}
// Share of the primary light (unit vector to the light, X/up/Z) that clears the baked horizon. The penumbra spans
// more than the horizon's change across one baked texel, so the grid never shows; it narrows with a low sun so
// that level ground (horizon 0) stays fully lit at every elevation.
float v2ReliefSun(vec3 light){
  float sun=light.y/max(length(light.xz),1e-3),width=max(min(.3,sun),1e-3);
  return sstep(-.3*width,.7*width,sun-v2Relief.y);
}
// Slope light of the landform: a hillshade of the cell-scale slope, relief doubled, under a raking light (never
// above 40 degrees, so slopes separate at noon too), relative to level ground. Zero on a plain: flat ground keeps
// its brightness at every zoom. A closed canopy (cover 1) takes a stronger gain, because its rough crowns flatten
// the slope response of the light model. Lit faces only brighten in the sun (share sun of the primary light).
float v2ReliefForm(vec3 light,float cover,float sun){
  vec2 g=v2Relief.zw*2.;
  float up=min(light.y,.643),reach=sqrt(1.-up*up)/max(length(light.xz),1e-3);
  float d=(up-dot(g,light.xz)*reach)*inversesqrt(dot(g,g)+1.)-up;
  d=d>0.?d*sun:d*.8;
  return clamp(1.+mix(.35,.6,cover)*d,.72,1.3);
}
// groundReliefLight of the fragment (terrainGround: shadeTerrainGround): x ambient share left by the sky
// occlusion (enclosed ground still receives light bounced by the slopes around it), y share of the primary
// light, z gain of the landform (slope light, and a light overall dimming of enclosed ground).
vec3 v2ReliefShade(vec3 light,float cover){
  float sun=v2ReliefSun(light);
  vec3 shade=vec3(1.-.6*v2Relief.x,mix(.14,1.,sun),v2ReliefForm(light,cover,sun)*(1.-.12*v2Relief.x));
  return v2ReliefLive>.5?shade:vec3(1.);
}
`;
