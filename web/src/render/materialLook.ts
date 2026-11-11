import { terrainStyle } from './terrainStyle';
import { WATER_SURFACE_GLSL, waterFunctionGlsl } from './waterStyle';

/** A retained forest field represents procedural-canopy; painted/diagnostic grounds never get cover. */
export function groundCoverActive(variant: number, brushes: boolean, procedural: boolean, enabled = true): number {
  return +(enabled && procedural && !brushes && variant <= 1);
}

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
uniform vec2 uWaterSeason;
${waterFunctionGlsl('materialWaterRamp', terrainStyle('render3d').water)}
vec3 materialWater(vec2 world,float position,float px){
  float shelf=1.-smoothstep(0.,.035,position);
  float rim=smoothstep(.002,.006,position)*(1.-smoothstep(.012,.025,position));
  vec3 color=waterSurfaceShade(materialWaterRamp(position),world,px,shelf,rim,1.);
  color=mix(color,color*vec3(.80,.90,1.)+vec3(0.,.01,.02),.35*uWaterSeason.x);
  // Frozen as a whole (same rule as the regime of rivers and lakes), never by depth: a depth-graded sheet left white
  // patches on the shallow or narrow reaches of an open river.
  float ice=step(.5,uWaterSeason.y);
  return mix(color,vec3(.84,.89,.91),ice);
}
`;
