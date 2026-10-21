import { GROUND_FIELD_GLSL } from './terrainGround';
import { FOREST_GLSL } from './terrainForest';

/** Render3D shares a physical ground field; original Render remains untouched.
 * This compatibility wrapper returns unlit display RGB for retained rasters.
 * Interactive 2D/3D use terrainGroundMaterial + shadeTerrainGround directly.
 * Includes FOREST_GLSL: programs must emit FOREST_PRELUDE_GLSL before
 * NEURAL_EARTH_MATERIAL_GLSL and call applyForest before shading.
 */
export const RENDER_3D_MATERIAL_GLSL = `${GROUND_FIELD_GLSL}
${FOREST_GLSL}
float forestRasterLight(GroundMaterial m,vec3 l){return (.34+.16*clamp(m.normal.y,0.,1.))*m.occlusion+.7*max(dot(m.normal,l),0.);}
// light: X/up/Z sun direction. The raster stays unlit, so forest crowns, stand
// shadows and occlusion are baked relative to the bare ground's own lighting.
vec3 terrain3dMaterial(vec3 s,vec2 world,float footprint,float tpi,float shore,float openness,vec3 light){
  vec3 macroColor=earthMaterial(s,world,max(footprint,1.),tpi,shore,openness);
  GroundMaterial material=terrainGroundMaterial(s,world,footprint,macroColor,uMaterialClimate,uMaterialSeed);
  if(uForest==1){
    vec3 l=normalize(light);float bare=forestRasterLight(material,l);
    applyForest(material,world,footprint,l);
    return groundToDisplay(material.albedo*forestRasterLight(material,l)/max(bare,1e-3));
  }
  return groundToDisplay(material.albedo);
}
vec3 terrain3dMaterial(vec3 s,vec2 world,float footprint,float tpi,float shore,float openness){
  return terrain3dMaterial(s,world,footprint,tpi,shore,openness,vec3(-.5,.70710678,-.5));
}
`;
