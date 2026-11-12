/** Ambient + Lambert light, normalised to a horizontal roof. World y grows
 * southwards. An asymmetric NW sun separates all four sides of a hip roof;
 * no broad clipping bands collapse neighbouring pans to the same two tones. */
export function roofPlaneLight([nx, ny, nz]: readonly number[]): number {
  const length = Math.hypot(nx, ny, nz) || 1, x = nx / length, y = ny / length, z = nz / length;
  // NW sun + a weak south-east fill, so pans facing away from the sun keep distinct tones.
  const sun = Math.max(0, -.70 * x - .36 * y + .62 * z), fill = Math.max(0, (.35 * x + .55 * y + .76 * z) / 1.0026);
  // A shallow pan still needs a readable tone from above: a facing term by azimuth, faded on steep pans.
  const h = Math.hypot(x, y), facing = h > .001 ? -(.8 * x + .5 * y) / h * .2 * Math.min(1, z / .6) : 0;
  return (.3 + 1.1 * sun + .3 * fill) / (.3 + 1.1 * .62 + .3 * .76 / 1.0026) + facing;
}

/** Same light in 3D's x/up/z frame. Keep the existing wall light and the normal
 * map's fine relief; the geometric roof plane determines the broad tone. */
export const ROOF_PLANE_LIGHT_GLSL = `
float buildingLight(vec3 normal,vec3 plane){
  vec3 oldSun=normalize(vec3(-.4,.85,.3));
  float detail=.55+.45*abs(dot(normal,oldSun));
  if(plane.y<.05)return detail;
  vec3 p=normalize(plane);
  float sun=max(0.,dot(p,vec3(-.70,.62,-.36)));
  float fill=max(0.,dot(p,vec3(.35,.76,.55))/1.0026);
  float h=length(p.xz);
  float facing=h>.001?-(.8*p.x+.5*p.z)/h*.2*min(1.,p.y/.6):0.;
  float roof=(.3+1.1*sun+.3*fill)/(.3+1.1*.62+.3*.76/1.0026)+facing;
  return roof*detail/(.55+.45*abs(dot(plane,oldSun)));
}
`;
