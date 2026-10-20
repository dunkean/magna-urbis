import { GROUND_FIELD_GLSL } from './terrainGround';

/** Render3D shares a physical ground field; original Render remains untouched.
 * This compatibility wrapper returns unlit display RGB for retained rasters.
 * Interactive 2D/3D use terrainGroundMaterial + shadeTerrainGround directly.
 */
export const RENDER_3D_MATERIAL_GLSL = `${GROUND_FIELD_GLSL}
vec3 terrain3dMaterial(vec3 s,vec2 world,float footprint,float tpi,float shore,float openness){
  vec3 macroColor=earthMaterial(s,world,max(footprint,1.),tpi,shore,openness);
  GroundMaterial material=terrainGroundMaterial(s,world,footprint,macroColor,uMaterialClimate,uMaterialSeed);
  return groundToDisplay(material.albedo);
}
`;
