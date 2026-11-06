import { terrainStyle } from './terrainStyle';
import { WATER_SURFACE_GLSL, waterFunctionGlsl } from './waterStyle';

/** Display-only grades: no physical height, cover or lighting resources change. */
export const MOONLIGHT_GLSL = `
vec3 moonlight(vec3 c){float y=dot(c,vec3(.2126,.7152,.0722));return c*vec3(.16,.23,.38)+vec3(.018,.029,.065)*(.35+y);}
`;
/** Same grade for the material raster/export backend; sRGB matches the display shader. */
export function moonlightSvg(body: string, id: string): string {
  return body?`<defs><filter id="${id}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values=".1638268 .0128736 .0012996 0 .0063 .0061654 .2507408 .0020938 0 .01015 .013819 .046488 .384693 0 .02275 0 0 0 1 0"/></filter></defs><g filter="url(#${id})">${body}</g>`:'';
}
/** The material water ramp and surface shading, also usable over a cartographic ground. */
export const MATERIAL_WATER_GLSL = `${WATER_SURFACE_GLSL}
${waterFunctionGlsl('materialWaterRamp', terrainStyle('render3d').water)}
vec3 materialWater(vec2 world,float position,float px){
  float shelf=1.-smoothstep(0.,.035,position);
  float rim=smoothstep(.002,.006,position)*(1.-smoothstep(.012,.025,position));
  return waterSurfaceShade(materialWaterRamp(position),world,px,shelf,rim,1.);
}
`;
